/** Source-only planning for future served runners. Never evidence or admission. */
import { canonicalJson } from "../src/canonical-json.js";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { isProtocolProfile, type ProtocolProfile } from "@bdp/protocol";
import {
  type ConformanceArtifactSource,
  type ConformanceFixture,
  copySourceBytes,
  CUMULATIVE_MANIFEST_MAX_BYTES,
  parseBoundedJson,
  parseFixtureJson,
  validateFixtureOraclePointers,
} from "../src/artifact-bundle.js";
import { parseExecutableScenarioManifest } from "../src/executable-manifest.js";
import { isCanonicalScope } from "../src/runner.js";
import { profileIncludes } from "../src/selection.js";
import {
  assertCanonicalProfileContractSelection,
  type ProfileContractSelection,
} from "../src/profile-contract-selection.js";
export {
  loadProfileContractSelection,
  inspectProfileContractSourcesForTest,
  type ProfileContractSelection,
} from "../src/profile-contract-selection.js";

const configurations = new WeakMap<object, ConformanceFixture>();

/**
 * Non-secret identity inputs captured from ONE installed service/fixture by a
 * trusted launcher. Digests follow existing SHA-256 artifact conventions.
 * This validates equality/shape, not the truth of a supplied observation.
 */
export interface ServedProfileConfiguration {
  readonly scope: string;
  readonly profile: ProtocolProfile;
  readonly history: boolean;
  readonly sourceCommit: string;
  readonly installedPayloadDigest: string;
  /** Exact installed descriptors, schema closure and their pinned identities. */
  readonly installedContractsDigest: string;
  /** Includes aggregate/visibility/operation policy, without credentials. */
  readonly policyDigest: string;
  /** Non-secret trusted credential-to-principal configuration identity. */
  readonly authenticationDigest: string;
  /** Exact fixture bytes, as in ConformanceArtifactDigests.fixtureDigest. */
  readonly fixtureDigest: string;
  readonly fixtureId: string;
  /** Fixture's declared capabilities, not a list of supposedly passing rows. */
  readonly capabilities: readonly string[];
}

export type ServedProfileConfigurationInput = Omit<
  ServedProfileConfiguration,
  "fixtureDigest" | "fixtureId" | "capabilities"
> & { readonly fixture: ConformanceArtifactSource };

const configurationKeys = [
  "scope",
  "profile",
  "history",
  "sourceCommit",
  "installedPayloadDigest",
  "installedContractsDigest",
  "policyDigest",
  "authenticationDigest",
  "fixture",
] as const;

/** Own data only. Callers never supply behavior through a binding or source. */
export function ownData(
  value: unknown,
  allowed: readonly string[],
  required = allowed,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value))
    throw new Error("planning input must be a plain data record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("planning input must be a plain data record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key))
      throw new Error("planning input must contain exactly the allowed fields");
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new Error("planning input requires own enumerable data fields");
    captured[key] = descriptor.value;
  }
  if (required.some((key) => !Object.hasOwn(captured, key)))
    throw new Error("planning input is missing required fields");
  return captured;
}

function primitiveString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${field}: primitive string required`);
  return value;
}

function snapshotSource(input: unknown, kind: "fixture" | "manifest", maximumBytes?: number) {
  const source = ownData(input, ["bytes", "label"], ["bytes"]);
  const label =
    source.label === undefined ? undefined : primitiveString(source.label, "source label");
  const bytes = copySourceBytes({ bytes: source.bytes as Uint8Array }, kind, maximumBytes);
  return { bytes, label };
}

export function bindServedProfileConfiguration(
  input: ServedProfileConfigurationInput,
): ServedProfileConfiguration {
  const captured = ownData(input, configurationKeys);
  const scope = primitiveString(captured.scope, "scope");
  const profile = captured.profile;
  const history = captured.history;
  const sourceCommit = primitiveString(captured.sourceCommit, "source commit");
  const installedPayloadDigest = primitiveString(
    captured.installedPayloadDigest,
    "installedPayloadDigest",
  );
  const installedContractsDigest = primitiveString(
    captured.installedContractsDigest,
    "installedContractsDigest",
  );
  const policyDigest = primitiveString(captured.policyDigest, "policyDigest");
  const authenticationDigest = primitiveString(
    captured.authenticationDigest,
    "authenticationDigest",
  );
  if (!isCanonicalScope(scope))
    throw new Error("served configuration requires a canonical HTTP Scope");
  if (!isProtocolProfile(profile) || typeof history !== "boolean")
    throw new Error("served configuration requires profile and History selection");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("invalid source commit");
  for (const [key, value] of Object.entries({
    installedPayloadDigest,
    installedContractsDigest,
    policyDigest,
    authenticationDigest,
  }))
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`invalid ${key}`);
  const source = snapshotSource(captured.fixture, "fixture");
  const fixture = parseFixtureJson(
    parseBoundedJson(source.bytes, "fixture", source.label),
    source.label,
  );
  const bound = freeze({
    scope,
    profile,
    history,
    sourceCommit,
    installedPayloadDigest,
    installedContractsDigest,
    policyDigest,
    authenticationDigest,
    fixtureDigest: digest(source.bytes),
    fixtureId: fixture.id,
    capabilities: [...fixture.capabilities].sort(),
  });
  configurations.set(bound, fixture);
  return bound;
}

function assertBoundConfiguration(value: ServedProfileConfiguration): ConformanceFixture {
  const fixture = configurations.get(value);
  if (!fixture) throw new Error("factory-bound served configuration required");
  return fixture;
}

export function assertSameServedProfileConfiguration(
  expected: ServedProfileConfiguration,
  actual: ServedProfileConfiguration,
): void {
  assertBoundConfiguration(expected);
  assertBoundConfiguration(actual);
  if (canonicalJson(expected) !== canonicalJson(actual))
    throw new Error("served configuration mismatch; cannot combine different targets");
}

export interface PlannedProfileRequirement {
  readonly id: string;
  readonly readiness:
    | "unplanned"
    | "applicability-unresolved"
    | "setup-unavailable"
    | "ready-unexecuted"
    | "carrier-unsupported"
    | "prerequisite-blocked";
  readonly missingApplicability: readonly string[];
  readonly missingSetup: readonly string[];
  readonly blockedPrerequisites: readonly string[];
}

export interface ProfileExecutionPlan {
  readonly claimEligible: false;
  readonly configuration: ServedProfileConfiguration;
  readonly catalogDigests: Readonly<Record<string, string>>;
  readonly manifestDigest?: string;
  readonly carrierBlocker?: string;
  readonly transportAdmission?: "private-exact-available";
  readonly retiredIds: readonly string[];
  /** Every selected obligation remains here, including absent manifest rows. */
  readonly requirements: readonly PlannedProfileRequirement[];
  /** No row has observations yet, including ready-unexecuted rows. */
  readonly unobservedIds: readonly string[];
}

/**
 * Uses the real executable manifest parser; no second action/fixture language.
 * ready-unexecuted is structural readiness, conditional on the runner enforcing
 * matching exact transport configuration before observing a non-Read target.
 * TX structural readiness does not admit TX exact transport, which remains a
 * separate implementation gate. It supplies no execution admission or observation.
 * Missing applicability is a review obligation, never a waiver.
 */
export function planProfileExecution(
  selection: ProfileContractSelection,
  configuration: ServedProfileConfiguration,
  execution?: {
    readonly configuration: ServedProfileConfiguration;
    readonly manifest: ConformanceArtifactSource;
  },
): ProfileExecutionPlan {
  assertCanonicalProfileContractSelection(selection);
  const fixture = assertBoundConfiguration(configuration);
  const bound = configuration;
  if (bound.profile !== selection.profile || bound.history !== selection.history)
    throw new Error("selection and served configuration disagree");
  let source: ReturnType<typeof snapshotSource> | undefined;
  if (execution !== undefined) {
    const captured = ownData(execution, ["configuration", "manifest"]);
    assertSameServedProfileConfiguration(
      bound,
      captured.configuration as ServedProfileConfiguration,
    );
    source = snapshotSource(
      captured.manifest,
      "manifest",
      selection.profile === "read-update" && !selection.history
        ? CUMULATIVE_MANIFEST_MAX_BYTES
        : undefined,
    );
  }
  const manifest =
    source === undefined
      ? undefined
      : parseExecutableScenarioManifest(
          parseBoundedJson(source.bytes, "manifest", source.label),
          source.label,
        );
  if (
    manifest &&
    source &&
    !(manifest.catalogId === "read-update-v1" && manifest.manifestVersion === 2)
  )
    copySourceBytes({ bytes: source.bytes }, "manifest"); // Other carriers retain the ordinary source budget.
  if (manifest) validateFixtureOraclePointers(manifest, fixture);
  // The current ordinary artifact factory accepts read-v1. The runner permits
  // v1 non-Read lacks the exact execution binding and remains unsupported.
  // v2 Read+Update requires matching exact execution configuration; this plan
  // is not execution, qualification or proof that such a target was observed.
  // Separate cumulative RU/TX factories support baseline (no History) only.
  // TX carrier planning does not enable the still-closed exact transport gate.
  const carrierBlocker =
    manifest === undefined ||
    (manifest.catalogId === "transactional-v1" &&
      !bound.history &&
      manifest.manifestVersion === 2 &&
      bound.profile === "transactional") ||
    (manifest.catalogId === "read-update-v1" &&
      !bound.history &&
      manifest.manifestVersion === 2 &&
      bound.profile === "read-update") ||
    (manifest.catalogId === "read-v1" &&
      (bound.profile === "read" ||
        (bound.profile === "read-update" && manifest.manifestVersion === 2)))
      ? undefined
      : `current normative artifact/runner carrier does not support ${manifest.catalogId} version ${manifest.manifestVersion} on ${bound.profile}`;
  const required = new Map(selection.required.map((row) => [row.id, row]));
  for (const row of manifest?.scenarios ?? []) {
    if (selection.retiredIds.includes(row.id))
      throw new Error(`manifest includes retired requirement: ${row.id}`);
    const contract = required.get(row.id);
    if (
      !contract ||
      !profileIncludes(bound.profile, row.requiredProfile) ||
      contract.requiredProfile !== row.requiredProfile
    )
      throw new Error(`manifest row is not a selected requirement: ${row.id}`);
    if (row.setup.fixture !== bound.fixtureId)
      throw new Error(`manifest fixture mismatch: ${row.id}`);
  }
  const declared = new Set(bound.capabilities);
  const executable = new Map(manifest?.scenarios.map((row) => [row.id, row]));
  const positions = new Map(selection.catalog.scenarios.map((row, index) => [row.id, index]));
  const earlier = (id: string, dependency: string) =>
    (positions.get(dependency) ?? Infinity) < (positions.get(id) ?? -1);
  const dependencies = new Map(
    [...executable].map(([id, row]) => [
      id,
      [
        ...new Set(
          (row.actions ?? row.requests).flatMap((action) =>
            action.prerequisiteScenario === undefined ? [] : [action.prerequisiteScenario],
          ),
        ),
      ],
    ]),
  );
  const base = (id: string) => {
    const row = executable.get(id);
    const missingApplicability =
      row?.applicability.requires.filter((key) => !declared.has(key)) ?? [];
    const missingSetup = row?.setup.requires.filter((key) => !declared.has(key)) ?? [];
    return { row, missingApplicability, missingSetup };
  };
  // Dependencies must precede their consumer in canonical catalog order.
  // Resolve each row once in that order: shared DAGs stay linear, and missing,
  // retired or later dependencies (including cycles) remain unavailable.
  const dependencyReady = new Map<string, boolean>();
  for (const { id } of selection.catalog.scenarios) {
    if (!required.has(id)) continue;
    const { row, missingApplicability, missingSetup } = base(id);
    dependencyReady.set(
      id,
      !!row &&
        !missingApplicability.length &&
        !missingSetup.length &&
        (dependencies.get(id) ?? []).every(
          (dependency) => earlier(id, dependency) && dependencyReady.get(dependency) === true,
        ),
    );
  }
  const requirements: PlannedProfileRequirement[] = selection.required.map(({ id }) => {
    const { row, missingApplicability, missingSetup } = base(id);
    const blockedPrerequisites = (dependencies.get(id) ?? []).filter(
      (dependency) => !earlier(id, dependency) || dependencyReady.get(dependency) !== true,
    );
    return {
      id,
      missingApplicability,
      missingSetup,
      blockedPrerequisites,
      readiness: !row
        ? "unplanned"
        : carrierBlocker
          ? "carrier-unsupported"
          : blockedPrerequisites.length
            ? "prerequisite-blocked"
            : missingApplicability.length
              ? "applicability-unresolved"
              : missingSetup.length
                ? "setup-unavailable"
                : "ready-unexecuted",
    };
  });
  return freeze({
    claimEligible: false,
    configuration: bound,
    catalogDigests: selection.catalogDigests,
    ...(source === undefined ? {} : { manifestDigest: digest(source.bytes) }),
    ...(carrierBlocker === undefined ? {} : { carrierBlocker }),
    ...(bound.profile === "transactional"
      ? { transportAdmission: "private-exact-available" as const }
      : {}),
    retiredIds: selection.retiredIds,
    requirements,
    unobservedIds: requirements.map(({ id }) => id),
  });
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}
