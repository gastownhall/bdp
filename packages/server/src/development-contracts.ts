/** Private administrative configuration for bounded development authorities.
 * Exact offline artifacts, existing guarded compiler, no public installation API.
 */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  stringifyJsonValue,
  assertCanonicalPathSegments,
  type MaximumEndpointMultiplicityPolicy,
  type PropertyValidator,
  type TypeDescriptor,
} from "@bdp/protocol";
import {
  ingestContractArtifacts,
  type ContractArtifactBundleInput,
  type ContractArtifactEntry,
  type ContractArtifactLimits,
} from "./installed-contract-artifact.js";
import { compilePrivateSchemaEvaluator, EVALUATOR_CEILINGS } from "./installed-schema-evaluator.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import type { ResourceContractRegistry, InstalledResourceContract } from "./resource-evaluator.js";

export function administrativeData(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("plain administrative data required");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((k) => !descriptors[k] || !Object.hasOwn(descriptors[k], "value"))
  )
    throw new TypeError("exact administrative data fields required");
  return Object.fromEntries(keys.map((k) => [k, descriptors[k]?.value]));
}
export function administrativeArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || value.length > maximum)
    throw new TypeError("bounded administrative array required");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== value.length + 1)
    throw new TypeError("dense administrative array required");
  return Array.from({ length: value.length }, (_, i) => {
    const field = fields[String(i)];
    if (!field || !Object.hasOwn(field, "value"))
      throw new TypeError("administrative accessor refused");
    return field.value;
  });
}

/** Exact immutable installation capture; policy constants are witnesses, not overrides. */
export interface DevelopmentContractCapture {
  readonly artifacts: readonly ContractArtifactEntry[];
  readonly artifactLimits: ContractArtifactLimits;
  readonly graphLimits: typeof SCHEMA_GRAPH_CEILINGS;
  readonly evaluatorLimits: typeof EVALUATOR_CEILINGS;
}
export interface DevelopmentContracts {
  readonly capture: DevelopmentContractCapture;
  readonly identity: string;
  readonly descriptors: readonly TypeDescriptor[];
  readonly types: Readonly<Record<string, string>>;
  readonly registry: ResourceContractRegistry;
}
const installed = new WeakSet<object>();
export function assertDevelopmentContracts(value: DevelopmentContracts): void {
  if (!installed.has(value)) throw new TypeError("compiled administrative contract required");
}
export function compileDevelopmentContracts(
  input: ContractArtifactBundleInput,
): DevelopmentContracts {
  const captured = ingestContractArtifacts(input);
  // Reconstruct solely from captured bytes: caller mutation/accessors cannot alter compilation.
  const artifact = (kind: "descriptor" | "schema") =>
    captured.artifacts
      .filter((a) => a.kind === kind)
      .map((a) => ({
        retrievalUri: a.retrievalUri,
        utf8Bytes: Buffer.from(a.bytesBase64, "base64"),
      }));
  const bundle = {
    descriptors: artifact("descriptor"),
    schemas: artifact("schema"),
    limits: captured.receipt.limits,
  };
  const types: Record<string, string> = Object.create(null);
  const contracts = new Map<string, InstalledResourceContract>();
  for (const descriptor of captured.descriptors) {
    if (Buffer.byteLength(JSON.stringify(descriptor.id)) > 4096)
      throw new RangeError("Type diagnostic identifier bound");
    types[descriptor.id] = stringifyJsonValue(descriptor);
    let validateProperties: PropertyValidator | undefined;
    if (descriptor.propertiesSchema !== undefined) {
      const compiled = compilePrivateSchemaEvaluator({
        bundle,
        entry: { kind: "descriptor", typeId: descriptor.id },
        graphLimits: SCHEMA_GRAPH_CEILINGS,
        limits: EVALUATOR_CEILINGS,
      });
      if (compiled.kind !== "compiled")
        throw new TypeError(`administrative schema refused: ${compiled.reason}`);
      validateProperties = (properties, emitter) => {
        const outcome = compiled.evaluateUtf8(Buffer.from(stringifyJsonValue(properties)));
        if (outcome.kind !== "evaluated")
          throw new Error("installed schema evaluation did not complete");
        if (outcome.valid) {
          if (!outcome.diagnosticsComplete)
            throw new Error("installed schema evaluation did not complete");
          return { valid: true };
        }
        if (!outcome.diagnostics.length) throw new Error("invalid schema result lacks diagnostics");
        for (const diagnostic of outcome.diagnostics) {
          if (
            Buffer.byteLength(JSON.stringify(diagnostic.schemaLocation)) > 16384 ||
            Buffer.byteLength(JSON.stringify(diagnostic.message)) > 1024
          )
            throw new Error("installed diagnostic metadata exceeds qualified bound");
          if (!emitter.emit(diagnostic)) return { valid: false, diagnosticsComplete: false };
        }
        // A confirmed prefix can satisfy a tighter receiver bound. Only claim
        // completeness when the evaluator actually reached its end.
        if (!outcome.diagnosticsComplete)
          throw new Error("installed schema evaluation did not complete");
        return { valid: false, diagnosticsComplete: true };
      };
    }
    contracts.set(
      descriptor.id,
      Object.freeze({ descriptor, ...(validateProperties ? { validateProperties } : {}) }),
    );
  }
  const value: DevelopmentContracts = Object.freeze({
    capture: Object.freeze({
      artifacts: captured.artifacts,
      artifactLimits: captured.receipt.limits,
      graphLimits: SCHEMA_GRAPH_CEILINGS,
      evaluatorLimits: EVALUATOR_CEILINGS,
    }),
    identity: `development-schema5-${createHash("sha256")
      .update(
        stringifyJsonValue({
          artifacts: captured.sha256,
          artifactLimits: captured.receipt.limits,
          graphLimits: SCHEMA_GRAPH_CEILINGS,
          evaluatorLimits: EVALUATOR_CEILINGS,
        }),
      )
      .digest("hex")}`,
    descriptors: captured.descriptors,
    types: Object.freeze(types),
    registry: Object.freeze({
      get: (id: string, bytes: string) => (types[id] === bytes ? contracts.get(id) : undefined),
    }),
  });
  installed.add(value);
  return value;
}

export interface DevelopmentAccess {
  readonly create: boolean;
  readonly write: boolean;
  readonly hidden: readonly string[];
  readonly readOnly: readonly string[];
}
export interface DevelopmentAccessSnapshot extends DevelopmentAccess {
  readonly identity: string;
}
export interface DevelopmentAccessPolicy {
  identity(): string;
  capture(principal: string): DevelopmentAccessSnapshot;
}
const policies = new WeakSet<object>();
export function assertDevelopmentAccessPolicy(value: DevelopmentAccessPolicy): void {
  if (!policies.has(value)) throw new TypeError("administrative access policy required");
}
function access(value: DevelopmentAccess): DevelopmentAccessSnapshot {
  if (!value || typeof value !== "object" || isProxy(value))
    throw new TypeError("invalid access policy");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 4 ||
    ["create", "write", "hidden", "readOnly"].some(
      (k) => !fields[k] || !Object.hasOwn(fields[k], "value"),
    )
  )
    throw new TypeError("invalid access policy fields");
  if (typeof fields.create?.value !== "boolean" || typeof fields.write?.value !== "boolean")
    throw new TypeError("invalid access flags");
  const ids = (v: unknown): readonly string[] => {
    const values = administrativeArray(v, 1000).map((id) => {
      if (typeof id !== "string" || (!id.startsWith("beads/") && !id.startsWith("links/")))
        throw new TypeError("invalid access resource identity");
      assertCanonicalPathSegments(id, "access resource identity");
      return id;
    });
    return Object.freeze([...new Set(values)].sort());
  };
  const snapshot = {
    create: fields.create.value as boolean,
    write: fields.write.value as boolean,
    hidden: ids(fields.hidden?.value),
    readOnly: ids(fields.readOnly?.value),
  };
  return Object.freeze({
    ...snapshot,
    identity: createHash("sha256").update(stringifyJsonValue(snapshot)).digest("hex"),
  });
}
/** Private operator handle replaces access atomically between synchronous owner turns.
 * Existing captures retain immutable values. No mutation request can reach replace.
 */
export function createDevelopmentAccessPolicy(
  initial: Readonly<Record<string, DevelopmentAccess>>,
) {
  const snapshots = new Map<string, DevelopmentAccessSnapshot>();
  function replace(principal: string, value: DevelopmentAccess) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(principal)) throw new TypeError("invalid stable principal");
    snapshots.set(principal, access(value));
  }
  if (!initial || typeof initial !== "object" || isProxy(initial))
    throw new TypeError("principal policies required");
  for (const [principal, value] of Object.entries(
    administrativeData(initial, Object.keys(initial)),
  ))
    replace(principal, value as DevelopmentAccess);
  const policy: DevelopmentAccessPolicy = Object.freeze({
    identity: () =>
      createHash("sha256")
        .update(stringifyJsonValue([...snapshots.entries()].sort()))
        .digest("hex"),
    capture: (principal: string) => {
      const current = snapshots.get(principal);
      if (!current) throw new TypeError("principal lacks administrative policy");
      return current;
    },
  });
  policies.add(policy);
  return Object.freeze({ policy, replace });
}

/** Canonical semantic set shared by persisted installation and Read/write policy. */
export function captureDevelopmentAggregatePolicy(
  input: unknown,
  descriptors: readonly TypeDescriptor[],
): readonly MaximumEndpointMultiplicityPolicy[] {
  const entries = administrativeArray(input, 1000).map((item) => {
    const value = administrativeData(item, ["endpoint", "linkConformsTo", "max"]);
    if (
      (value.endpoint !== "source" && value.endpoint !== "target") ||
      typeof value.linkConformsTo !== "string" ||
      !descriptors.some((d) => d.id === value.linkConformsTo && d.describes === "link") ||
      typeof value.max !== "number" ||
      !Number.isSafeInteger(value.max) ||
      value.max < 1
    )
      throw new TypeError("invalid installed aggregate policy");
    return Object.freeze({
      endpoint: value.endpoint,
      linkConformsTo: value.linkConformsTo,
      max: value.max,
    }) as MaximumEndpointMultiplicityPolicy;
  });
  const canonical = new Map(entries.map((entry) => [stringifyJsonValue(entry), entry]));
  return Object.freeze(
    [...canonical.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, entry]) => entry),
  );
}
