import { createHash } from "node:crypto";

import { parseScenarioCatalog, type ScenarioCatalog } from "./catalog.js";
import {
  parseExecutableScenarioManifest,
  type ExecutableScenarioManifest,
  type JsonValue,
} from "./executable-manifest.js";

const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ARTIFACT_ID_MAX_LENGTH = 128;
const ARTIFACT_MAX_BYTES = 1_048_576;
const ARTIFACT_MAX_JSON_DEPTH = 128;
const ARTIFACT_MAX_JSON_NODES = 100_000;
const ARTIFACT_MAX_CONTAINER_ENTRIES = 10_000;
const PRIVATE_WIRE_SENTINEL_MAX_BYTES = 256;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

export interface ConformanceArtifactSource {
  /** Exact source bytes. The bundle copies these before parsing or hashing. */
  readonly bytes: Uint8Array;
  /** Non-secret diagnostic label. It is never included in a report. */
  readonly label?: string;
}

export interface ConformanceArtifactBundleSources {
  readonly catalog: ConformanceArtifactSource;
  readonly manifest: ConformanceArtifactSource;
  readonly fixture: ConformanceArtifactSource;
}

/**
 * The portable fixture remains extensible, but its identity and harness-facing
 * setup fields are closed and validated at the artifact boundary.
 */
export interface ConformanceFixture {
  readonly [key: string]: JsonValue;
  readonly fixtureVersion: 1;
  readonly id: string;
  readonly seed: number;
  readonly capabilities: readonly string[];
  readonly bindings: Readonly<Record<string, string>>;
}

export interface ConformanceArtifactDigests {
  readonly catalogDigest: string;
  readonly manifestDigest: string;
  readonly fixtureDigest: string;
}

/**
 * A factory-created, immutable binding between exact source bytes and the
 * parsed objects consumed by a run. Structural lookalikes are rejected by the
 * runner; callers cannot pair independently parsed objects with these digests.
 */
export interface ConformanceArtifactBundle {
  readonly catalog: ScenarioCatalog;
  readonly manifest: ExecutableScenarioManifest;
  readonly fixture: ConformanceFixture;
  readonly digests: ConformanceArtifactDigests;
}

export class ConformanceArtifactBundleError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ConformanceArtifactBundleError";
  }
}

const factoryCreatedBundles = new WeakSet<ConformanceArtifactBundle>();

export function createConformanceArtifactBundle(
  sources: ConformanceArtifactBundleSources,
): ConformanceArtifactBundle {
  const catalogBytes = copySourceBytes(sources.catalog, "catalog");
  const manifestBytes = copySourceBytes(sources.manifest, "manifest");
  const fixtureBytes = copySourceBytes(sources.fixture, "fixture");
  const catalog = parseScenarioCatalog(
    parseBoundedJson(catalogBytes, "catalog", sources.catalog.label),
    sources.catalog.label,
  );
  const manifest = parseExecutableScenarioManifest(
    parseBoundedJson(manifestBytes, "manifest", sources.manifest.label),
    sources.manifest.label,
  );
  const fixture = parseFixtureJson(
    parseBoundedJson(fixtureBytes, "fixture", sources.fixture.label),
    sources.fixture.label,
  );

  if (manifest.catalogId !== `read-v${catalog.catalogVersion}`) {
    throw new ConformanceArtifactBundleError(
      "manifest catalogId does not match the bound catalog source",
    );
  }
  for (const scenario of manifest.scenarios) {
    if (scenario.setup.fixture !== fixture.id) {
      throw new ConformanceArtifactBundleError(
        `scenario '${scenario.id}' names fixture '${scenario.setup.fixture}' instead of the bound fixture`,
      );
    }
  }
  validateFixtureOraclePointers(manifest, fixture);

  const bundle = deepFreeze({
    catalog,
    manifest,
    fixture,
    digests: {
      catalogDigest: sha256(catalogBytes),
      manifestDigest: sha256(manifestBytes),
      fixtureDigest: sha256(fixtureBytes),
    },
  }) satisfies ConformanceArtifactBundle;
  factoryCreatedBundles.add(bundle);
  return bundle;
}

function validateFixtureOraclePointers(
  manifest: ExecutableScenarioManifest,
  fixture: ConformanceFixture,
): void {
  for (const scenario of manifest.scenarios) {
    for (const action of scenario.actions ?? scenario.requests) {
      if ("inputFixturePointer" in action && action.inputFixturePointer !== undefined) {
        const input = jsonPointer(fixture, action.inputFixturePointer);
        if (input === undefined)
          throw new ConformanceArtifactBundleError(
            "programmable action fixture input pointer did not resolve",
          );
      }
      for (const assertion of action.assertions) {
        if (!("fixturePointer" in assertion) || assertion.fixturePointer === undefined) continue;
        const expected = jsonPointer(fixture, assertion.fixturePointer);
        if (expected === undefined)
          throw new ConformanceArtifactBundleError("fixture oracle pointer did not resolve");
        if (
          assertion.kind === "wire-not-contains" &&
          (typeof expected !== "string" ||
            expected.length === 0 ||
            new TextEncoder().encode(expected).byteLength > PRIVATE_WIRE_SENTINEL_MAX_BYTES)
        )
          throw new ConformanceArtifactBundleError(
            `private wire sentinel must be a non-empty string no larger than ${PRIVATE_WIRE_SENTINEL_MAX_BYTES} UTF-8 bytes`,
          );
        if (
          (assertion.kind === "json-equals" || assertion.kind === "json-pointer") &&
          assertion.normalize === "iso-timestamps" &&
          !(assertion.timestampPointers ?? []).every((pointer) => {
            const timestamp = jsonPointer(expected, pointer);
            return typeof timestamp === "string" && isCanonicalIsoTimestamp(timestamp);
          })
        )
          throw new ConformanceArtifactBundleError(
            "timestamp-normalized fixture oracle pointers must resolve to canonical ISO timestamps",
          );
        if (
          assertion.kind === "json-pointer" &&
          assertion.normalize === "scope-relative-url" &&
          typeof expected !== "string"
        )
          throw new ConformanceArtifactBundleError(
            "normalized json-pointer fixture oracle must be a string",
          );
        if (assertion.kind === "json-array-set" && !Array.isArray(expected))
          throw new ConformanceArtifactBundleError(
            "json-array-set fixture oracle must be an array",
          );
        if (
          assertion.kind === "json-array-set" &&
          assertion.normalize !== undefined &&
          Array.isArray(expected) &&
          expected.some((value) => typeof value !== "string")
        )
          throw new ConformanceArtifactBundleError(
            "normalized json-array-set fixture oracle values must be strings",
          );
        if (
          assertion.kind === "json-array-tuples" &&
          (!Array.isArray(expected) ||
            expected.some(
              (tuple) => !Array.isArray(tuple) || tuple.length !== assertion.projections.length,
            ))
        )
          throw new ConformanceArtifactBundleError(
            "json-array-tuples fixture oracle must match the projection shape",
          );
        if (
          assertion.kind === "json-array-tuples" &&
          Array.isArray(expected) &&
          expected.some(
            (tuple) =>
              Array.isArray(tuple) &&
              tuple.some(
                (value, index) =>
                  assertion.projections[index]?.normalize !== undefined &&
                  typeof value !== "string",
              ),
          )
        )
          throw new ConformanceArtifactBundleError(
            "normalized json-array-tuples fixture oracle cells must be strings",
          );
      }
    }
  }
}

function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
      current = current[Number(key)];
    } else {
      if (!Object.hasOwn(current, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Internal runtime provenance check used by the runner. */
export function assertFactoryCreatedArtifactBundle(
  value: ConformanceArtifactBundle,
): asserts value is ConformanceArtifactBundle {
  if (!factoryCreatedBundles.has(value)) {
    throw new ConformanceArtifactBundleError(
      "artifactBundle must be created from source bytes by createConformanceArtifactBundle",
    );
  }
}

function copySourceBytes(
  source: ConformanceArtifactSource,
  kind: keyof ConformanceArtifactBundleSources,
): Uint8Array {
  const bytes = source.bytes;
  let byteLength: number;
  try {
    if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined || TYPED_ARRAY_TAG_GETTER === undefined)
      throw new Error("missing intrinsic");
    const tag = Reflect.apply(TYPED_ARRAY_TAG_GETTER, bytes, []) as unknown;
    if (tag !== "Uint8Array") throw new Error("not Uint8Array");
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, bytes, []) as number;
  } catch {
    throw new ConformanceArtifactBundleError(`${kind} source bytes must be a Uint8Array`);
  }
  if (byteLength > ARTIFACT_MAX_BYTES) {
    throw new ConformanceArtifactBundleError(
      `${kind} source must not exceed ${ARTIFACT_MAX_BYTES} bytes`,
    );
  }
  const copy = new Uint8Array(byteLength);
  Reflect.apply(UINT8_ARRAY_SET, copy, [bytes]);
  return copy;
}

function decodeUtf8(bytes: Uint8Array, kind: string, label: string | undefined): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ConformanceArtifactBundleError(`${label ?? kind}: source is not valid UTF-8`, {
      cause,
    });
  }
}

function parseBoundedJson(
  bytes: Uint8Array,
  kind: keyof ConformanceArtifactBundleSources,
  sourceLabel?: string,
): unknown {
  const text = decodeUtf8(bytes, kind, sourceLabel);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ConformanceArtifactBundleError(`${sourceLabel ?? kind}: invalid JSON`, {
      cause,
    });
  }
  assertJsonComplexity(value, sourceLabel ?? kind);
  return value;
}

function assertJsonComplexity(value: unknown, label: string): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > ARTIFACT_MAX_JSON_NODES)
      throw new ConformanceArtifactBundleError(
        `${label}: JSON must not exceed ${ARTIFACT_MAX_JSON_NODES} nodes`,
      );
    if (current.depth > ARTIFACT_MAX_JSON_DEPTH)
      throw new ConformanceArtifactBundleError(
        `${label}: JSON must not exceed depth ${ARTIFACT_MAX_JSON_DEPTH}`,
      );
    if (typeof current.value === "number" && !Number.isFinite(current.value))
      throw new ConformanceArtifactBundleError(`${label}: JSON numbers must be finite`);
    if (typeof current.value !== "object" || current.value === null) continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length > ARTIFACT_MAX_CONTAINER_ENTRIES)
      throw new ConformanceArtifactBundleError(
        `${label}: a JSON container must not exceed ${ARTIFACT_MAX_CONTAINER_ENTRIES} entries`,
      );
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
}

function parseFixtureJson(value: unknown, sourceLabel?: string): ConformanceFixture {
  if (!isPlainRecord(value)) {
    throw new ConformanceArtifactBundleError(`${sourceLabel ?? "fixture"}: must be a JSON object`);
  }
  if (value.fixtureVersion !== 1) {
    throw new ConformanceArtifactBundleError(
      `${sourceLabel ?? "fixture"}: fixtureVersion must equal 1`,
    );
  }
  if (
    typeof value.id !== "string" ||
    value.id.length > ARTIFACT_ID_MAX_LENGTH ||
    !ARTIFACT_ID_PATTERN.test(value.id)
  ) {
    throw new ConformanceArtifactBundleError(
      `${sourceLabel ?? "fixture"}: id must be 1..128 lowercase identifier characters`,
    );
  }
  if (!Number.isSafeInteger(value.seed) || (value.seed as number) < 0) {
    throw new ConformanceArtifactBundleError(
      `${sourceLabel ?? "fixture"}: seed must be a non-negative safe integer`,
    );
  }
  const capabilities = readUniqueIdentifiers(value.capabilities, sourceLabel, "capabilities");
  const bindings = readBindings(value.bindings, sourceLabel);
  return deepFreeze({
    ...value,
    fixtureVersion: 1,
    id: value.id,
    seed: value.seed as number,
    capabilities,
    bindings,
  }) as ConformanceFixture;
}

function readUniqueIdentifiers(
  value: unknown,
  sourceLabel: string | undefined,
  member: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConformanceArtifactBundleError(
      `${sourceLabel ?? "fixture"}: ${member} must be a non-empty array`,
    );
  }
  const identifiers = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length > ARTIFACT_ID_MAX_LENGTH ||
      !ARTIFACT_ID_PATTERN.test(candidate)
    ) {
      throw new ConformanceArtifactBundleError(
        `${sourceLabel ?? "fixture"}: ${member} entries must be lowercase identifiers`,
      );
    }
    if (identifiers.has(candidate)) {
      throw new ConformanceArtifactBundleError(
        `${sourceLabel ?? "fixture"}: ${member} entries must be unique`,
      );
    }
    identifiers.add(candidate);
  }
  return [...identifiers];
}

function readBindings(
  value: unknown,
  sourceLabel: string | undefined,
): Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) {
    throw new ConformanceArtifactBundleError(
      `${sourceLabel ?? "fixture"}: bindings must be a JSON object`,
    );
  }
  const bindings: Record<string, string> = {};
  for (const [name, target] of Object.entries(value)) {
    if (name.length > ARTIFACT_ID_MAX_LENGTH || !ARTIFACT_ID_PATTERN.test(name)) {
      throw new ConformanceArtifactBundleError(
        `${sourceLabel ?? "fixture"}: binding names must be lowercase identifiers`,
      );
    }
    if (typeof target !== "string" || target.length === 0) {
      throw new ConformanceArtifactBundleError(
        `${sourceLabel ?? "fixture"}: binding values must be non-empty strings`,
      );
    }
    bindings[name] = target;
  }
  return bindings;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  const pending: object[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const entry of Object.values(current)) {
      if (typeof entry === "object" && entry !== null) pending.push(entry);
    }
    if (!Object.isFrozen(current)) Object.freeze(current);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
