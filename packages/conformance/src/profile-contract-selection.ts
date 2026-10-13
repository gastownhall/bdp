/** Canonical cumulative catalog source. Internal only; no package-root export. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isProtocolProfile, type ProtocolProfile } from "@bdp/protocol";
import { canonicalJson } from "./canonical-json.js";
import { loadScenarioCatalogJson, type ScenarioCatalog, type ScenarioMetadata } from "./catalog.js";
import { retiredScenarioIds, selectNormativeScenariosForProfile } from "./selection.js";

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

/** The ordinary loader has no caller-supplied requirement source seam. */
export function loadProfileContractSelection(
  profile: ProtocolProfile,
  history = false,
): ProfileContractSelection {
  const directory = new URL("../catalog/", import.meta.url);
  const selection = inspectProfileContractSourcesForTest(
    profile,
    history,
    (name) => readFileSync(new URL(name, directory), "utf8"),
    readdirSync(directory).filter((name) => name.endsWith(".json")),
  );
  selections.add(selection);
  return selection;
}

/** Negative-control inspection only. Its result cannot enter planProfileExecution. */
export function inspectProfileContractSourcesForTest(
  profile: ProtocolProfile,
  history: boolean,
  readSource: (name: string) => string,
  catalogFiles: readonly string[] = [...coreCatalogs, ...companionCatalogs, historyCatalog],
): ProfileContractSelection {
  const classified = new Set<string>([...coreCatalogs, ...companionCatalogs, historyCatalog]);
  if (
    catalogFiles.length !== classified.size ||
    new Set(catalogFiles).size !== classified.size ||
    catalogFiles.some((name) => !classified.has(name))
  )
    throw new Error(
      "catalog directory must contain exactly the classified core, companion and optional files",
    );
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
  return selection;
}

export function assertCanonicalProfileContractSelection(selection: ProfileContractSelection): void {
  if (!selections.has(selection))
    throw new Error("factory-loaded complete catalog selection required");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}
