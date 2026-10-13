/** Source-only planning for future served runners. Never evidence or admission. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isProtocolProfile, type ProtocolProfile } from "@bdp/protocol";
import type { ConformanceArtifactSource } from "../src/artifact-bundle.js";
import { canonicalJson } from "../src/canonical-json.js";
import {
  loadScenarioCatalogJson,
  type ScenarioCatalog,
  type ScenarioMetadata,
} from "../src/catalog.js";
import { loadExecutableScenarioManifestJson } from "../src/executable-manifest.js";
import {
  profileIncludes,
  retiredScenarioIds,
  selectNormativeScenariosForProfile,
} from "../src/selection.js";

const coreCatalogs = ["read-v1.json", "read-update-v1.json", "transactional-v1.json"] as const;
const companionCatalogs = ["numeric-model-v1.json", "owned-wildcard-v1.json"] as const;
const historyCatalog = "history-v1.json";
const selections = new WeakSet<object>();

export interface ProfileContractSelection {
  readonly profile: ProtocolProfile;
  readonly history: boolean;
  /** SHA-256 of each exact catalog source; never a diagnostic row inventory. */
  readonly catalogDigests: Readonly<Record<string, string>>;
  readonly catalog: ScenarioCatalog;
  readonly required: readonly ScenarioMetadata[];
  readonly retiredIds: readonly string[];
}

/**
 * The loader is the trusted repository source boundary, not a caller's proposed
 * requirement list. All core and companion files are loaded before selection.
 * No mirrored IDs/counts: the current committed catalogs remain authoritative.
 */
export function loadProfileContractSelection(
  profile: ProtocolProfile,
  history = false,
  readSource: (name: string) => string = (name) =>
    readFileSync(new URL(`../catalog/${name}`, import.meta.url), "utf8"),
): ProfileContractSelection {
  if (!isProtocolProfile(profile) || typeof history !== "boolean")
    throw new Error("valid profile and explicit History configuration required");
  const byId = new Map<string, ScenarioMetadata>();
  const origins = new Map<string, string>();
  const digests: Record<string, string> = {};
  for (const name of [
    ...coreCatalogs,
    ...companionCatalogs,
    ...(history ? [historyCatalog] : []),
  ]) {
    const text = readSource(name);
    const catalog = loadScenarioCatalogJson(text, name);
    if (catalog.scenarios.length === 0) throw new Error(`empty required catalog: ${name}`);
    digests[name] = digest(text);
    for (const row of catalog.scenarios) {
      if (row.id.startsWith("history.") !== (name === historyCatalog))
        throw new Error(`History must remain in its optional catalog: ${row.id}`);
      const previous = byId.get(row.id);
      if (previous !== undefined) {
        // Companion Read rows intentionally repeat the core's exact metadata.
        // Duplicate core definitions and conflicting copies are never merged.
        if (
          !companionCatalogs.some((companion) => companion === name) ||
          origins.get(row.id) !== "read-v1.json" ||
          canonicalJson(previous) !== canonicalJson(row)
        )
          throw new Error(`duplicate or conflicting requirement: ${row.id}`);
      } else {
        byId.set(row.id, row);
        origins.set(row.id, name);
      }
    }
  }
  const catalog: ScenarioCatalog = { catalogVersion: 1, scenarios: [...byId.values()] };
  const retirementOwners = new Map<string, string>();
  for (const row of catalog.scenarios)
    for (const id of row.retires ?? []) {
      if (retirementOwners.has(id)) throw new Error(`multiple retirements of requirement: ${id}`);
      retirementOwners.set(id, row.id);
    }
  // Validate all retirement edges even when planning a lower profile.
  retiredScenarioIds(catalog, "transactional");
  const selection = freeze({
    profile,
    history,
    catalogDigests: digests,
    catalog,
    required: selectNormativeScenariosForProfile(catalog, profile),
    retiredIds: [...retiredScenarioIds(catalog, profile)].sort(),
  });
  selections.add(selection);
  return selection;
}

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

const configurationKeys = [
  "scope",
  "profile",
  "history",
  "sourceCommit",
  "installedPayloadDigest",
  "installedContractsDigest",
  "policyDigest",
  "authenticationDigest",
  "fixtureDigest",
  "fixtureId",
  "capabilities",
] as const;

export function bindServedProfileConfiguration(
  input: ServedProfileConfiguration,
): ServedProfileConfiguration {
  if (
    Object.keys(input).length !== configurationKeys.length ||
    configurationKeys.some((key) => !Object.hasOwn(input, key))
  )
    throw new Error("served configuration must contain exactly the planning binding fields");
  const url = new URL(input.scope);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.href !== input.scope ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/")
  )
    throw new Error("served configuration requires a canonical HTTP Scope");
  if (!isProtocolProfile(input.profile) || typeof input.history !== "boolean")
    throw new Error("served configuration requires profile and History selection");
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) throw new Error("invalid source commit");
  for (const key of [
    "installedPayloadDigest",
    "installedContractsDigest",
    "policyDigest",
    "authenticationDigest",
    "fixtureDigest",
  ] as const)
    if (!/^[0-9a-f]{64}$/.test(input[key])) throw new Error(`invalid ${key}`);
  if (typeof input.fixtureId !== "string" || input.fixtureId.trim().length === 0)
    throw new Error("fixture identity required");
  if (
    !Array.isArray(input.capabilities) ||
    input.capabilities.some((value) => typeof value !== "string" || value.trim().length === 0) ||
    new Set(input.capabilities).size !== input.capabilities.length
  )
    throw new Error("unique fixture capabilities required");
  return freeze({ ...input, capabilities: [...input.capabilities].sort() });
}

export function assertSameServedProfileConfiguration(
  expected: ServedProfileConfiguration,
  actual: ServedProfileConfiguration,
): void {
  if (
    canonicalJson(bindServedProfileConfiguration(expected)) !==
    canonicalJson(bindServedProfileConfiguration(actual))
  )
    throw new Error("served configuration mismatch; cannot combine different targets");
}

export interface PlannedProfileRequirement {
  readonly id: string;
  readonly readiness:
    | "unplanned"
    | "applicability-unresolved"
    | "setup-unavailable"
    | "ready-unexecuted";
  readonly missingApplicability: readonly string[];
  readonly missingSetup: readonly string[];
}

export interface ProfileExecutionPlan {
  readonly claimEligible: false;
  readonly configuration: ServedProfileConfiguration;
  readonly catalogDigests: Readonly<Record<string, string>>;
  readonly manifestDigest?: string;
  readonly retiredIds: readonly string[];
  /** Every selected obligation remains here, including absent manifest rows. */
  readonly requirements: readonly PlannedProfileRequirement[];
  /** No row has observations yet, including ready-unexecuted rows. */
  readonly unobservedIds: readonly string[];
}

/**
 * Uses the real executable manifest parser; no second action/fixture language.
 * A future runner can execute ready-unexecuted IDs, then record real results
 * separately. Missing applicability is a review obligation, never a waiver.
 */
export function planProfileExecution(
  selection: ProfileContractSelection,
  configuration: ServedProfileConfiguration,
  execution?: {
    readonly configuration: ServedProfileConfiguration;
    readonly manifest: ConformanceArtifactSource;
  },
): ProfileExecutionPlan {
  if (!selections.has(selection))
    throw new Error("factory-loaded complete catalog selection required");
  const bound = bindServedProfileConfiguration(configuration);
  if (bound.profile !== selection.profile || bound.history !== selection.history)
    throw new Error("selection and served configuration disagree");
  if (execution) assertSameServedProfileConfiguration(bound, execution.configuration);
  const bytes = execution === undefined ? undefined : Uint8Array.from(execution.manifest.bytes);
  const manifest =
    bytes === undefined
      ? undefined
      : loadExecutableScenarioManifestJson(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          execution?.manifest.label,
        );
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
  const requirements: PlannedProfileRequirement[] = selection.required.map(({ id }) => {
    const row = executable.get(id);
    const missingApplicability =
      row?.applicability.requires.filter((key) => !declared.has(key)) ?? [];
    const missingSetup = row?.setup.requires.filter((key) => !declared.has(key)) ?? [];
    return {
      id,
      readiness:
        row === undefined
          ? "unplanned"
          : missingApplicability.length > 0
            ? "applicability-unresolved"
            : missingSetup.length > 0
              ? "setup-unavailable"
              : "ready-unexecuted",
      missingApplicability,
      missingSetup,
    };
  });
  return freeze({
    claimEligible: false,
    configuration: bound,
    catalogDigests: selection.catalogDigests,
    ...(bytes === undefined ? {} : { manifestDigest: digest(bytes) }),
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
