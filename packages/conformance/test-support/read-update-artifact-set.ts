/** Source-only two-artifact planning boundary. No execution, qualification or public admission. */
import { createHash } from "node:crypto";
import {
  copySourceBytes,
  createCumulativeReadUpdateArtifactBundle,
  CUMULATIVE_MANIFEST_MAX_BYTES,
  parseBoundedJson,
  type ConformanceArtifactBundle,
  type ConformanceArtifactSource,
} from "../src/artifact-bundle.js";
import { canonicalJson } from "../src/canonical-json.js";
import {
  assertCanonicalProfileContractSelection,
  type ProfileContractSelection,
} from "../src/profile-contract-selection.js";
import { ownData } from "./profile-contract-plan.js";

const INDEX_MAX_BYTES = 16_384;
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
// Deliberately closed to ordinary flat matrix filenames; never an import resolver.
const SOURCE = /^matrices\/[a-z0-9]+(?:[.-][a-z0-9]+)*\.json$/;

export interface ReadUpdateArtifactSetSources {
  readonly index: ConformanceArtifactSource;
  readonly fixture: ConformanceArtifactSource;
  readonly coverage: ConformanceArtifactSource;
  readonly manifests: Readonly<Record<string, ConformanceArtifactSource>>;
}
interface IndexEntry {
  readonly id: string;
  readonly source: string;
}
interface CoverageRow {
  readonly id: string;
  readonly status: "bounded-observation" | "omitted";
  /** Authored review decision only; this validator does not grant whole-contract credit. */
  readonly wholeContract: boolean;
  readonly reason: string;
  readonly bindings: readonly {
    readonly scenario: string;
    readonly assertions: readonly string[];
  }[];
}
export interface ReadUpdateArtifactSet {
  readonly claimEligible: false;
  readonly selection: ProfileContractSelection;
  readonly index: { readonly version: 1; readonly shards: readonly IndexEntry[] };
  readonly coverage: {
    readonly version: 1;
    readonly claimEligible: false;
    readonly rows: readonly CoverageRow[];
  };
  readonly shards: readonly {
    readonly id: string;
    readonly source: string;
    readonly bundle: ConformanceArtifactBundle;
    readonly scenarioIds: readonly string[];
    readonly sourceBytes: number;
  }[];
  readonly requirements: readonly { readonly id: string; readonly owner: string | null }[];
  readonly digests: {
    readonly setDigest: string;
    readonly indexDigest: string;
    readonly coverageDigest: string;
    readonly fixtureDigest: string;
    readonly catalogDigests: Readonly<Record<string, string>>;
  };
  /** Unique captured input bytes only, not repeated parses, retained reports or heap allocation. */
  readonly sourceBytes: {
    readonly index: number;
    readonly fixture: number;
    readonly coverage: number;
    readonly manifests: number;
  };
}
const sets = new WeakMap<ReadUpdateArtifactSet, ReadUpdateArtifactSetSources>();

function source(
  input: unknown,
  kind: "manifest" | "fixture",
  role: string,
  limit?: number,
): ConformanceArtifactSource {
  try {
    const fields = ownData(input, ["bytes", "label"], ["bytes"]);
    if (fields.label !== undefined && typeof fields.label !== "string")
      throw Error("source label must be a string");
    // Role is fixed or derived from the validated index. Caller labels are not
    // attribution authority; intrinsic copying performs all byte/type/size checks.
    return {
      bytes: copySourceBytes({ bytes: fields.bytes as Uint8Array }, kind, limit),
      label: role,
    };
  } catch (cause) {
    throw Error(`${role}: ${cause instanceof Error ? cause.message : "invalid source"}`, { cause });
  }
}
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function parseIndex(bytes: Uint8Array): { version: 1; shards: IndexEntry[] } {
  const input = ownData(parseBoundedJson(bytes, "manifest", "artifact-set index"), [
    "version",
    "shards",
  ]);
  if (input.version !== 1 || !Array.isArray(input.shards) || input.shards.length !== 2)
    throw Error("artifact set requires version 1 and exactly two shards");
  const shards = input.shards.map((value) => {
    const entry = ownData(value, ["id", "source"]);
    if (
      typeof entry.id !== "string" ||
      entry.id.length > 128 ||
      !ID.test(entry.id) ||
      typeof entry.source !== "string" ||
      entry.source.length > 256 ||
      !SOURCE.test(entry.source)
    )
      throw Error("invalid artifact-set shard ID or matrix source name");
    return { id: entry.id, source: entry.source };
  });
  if (
    new Set(shards.map((s) => s.id)).size !== 2 ||
    new Set(shards.map((s) => s.source)).size !== 2
  )
    throw Error("duplicate artifact-set shard ID or source");
  return { version: 1, shards };
}

export function createReadUpdateArtifactSet(
  selection: ProfileContractSelection,
  input: ReadUpdateArtifactSetSources,
): ReadUpdateArtifactSet {
  assertCanonicalProfileContractSelection(selection);
  if (selection.profile !== "read-update" || selection.history)
    throw Error("artifact set requires canonical baseline Read+Update selection");
  const fields = ownData(input, ["index", "fixture", "coverage", "manifests"]);
  const indexSource = source(fields.index, "manifest", "artifact-set index", INDEX_MAX_BYTES);
  const index = parseIndex(indexSource.bytes);
  const manifestFields = ownData(
    fields.manifests,
    index.shards.map((s) => s.source),
  );
  const fixture = source(fields.fixture, "fixture", "artifact-set fixture");
  const coverage = source(fields.coverage, "fixture", "artifact-set coverage");
  const manifests = Object.fromEntries(
    index.shards.map((s) => [
      s.source,
      source(
        manifestFields[s.source],
        "manifest",
        `${s.id} (${s.source})`,
        CUMULATIVE_MANIFEST_MAX_BYTES,
      ),
    ]),
  );
  // Every caller source has been captured. The factories only see detached bytes below.
  const positions = new Map(selection.required.map((row, n) => [row.id, n]));
  const owners = new Map<string, string>();
  const plans = new Map<string, ConformanceArtifactBundle["manifest"]["scenarios"][number]>();
  const shards = index.shards.map((entry) => {
    const captured = manifests[entry.source]!;
    const bundle = createCumulativeReadUpdateArtifactBundle(selection, {
      manifest: captured,
      fixture,
    });
    if (bundle.manifest.scenarios.length === 0) throw Error("artifact-set shard must not be empty");
    let previous = -1;
    for (const row of bundle.manifest.scenarios) {
      for (const gate of ["setup", "applicability"] as const) {
        if (
          row[gate].requires.some((capability) => !bundle.fixture.capabilities.includes(capability))
        )
          throw Error(
            `${entry.id} (${entry.source}): owned scenario ${row.id} has unavailable ${gate} capabilities`,
          );
      }
      const position = positions.get(row.id)!; // Ordinary cumulative factory validates membership.
      if (position <= previous) throw Error("shard scenarios must follow canonical required order");
      previous = position;
      if (owners.has(row.id)) throw Error(`duplicate scenario owner: ${row.id}`);
      owners.set(row.id, entry.id);
      plans.set(row.id, row);
    }
    return {
      ...entry,
      bundle,
      scenarioIds: bundle.manifest.scenarios.map((r) => r.id),
      sourceBytes: captured.bytes.byteLength,
    };
  });
  for (const [id, row] of plans) {
    for (const action of row.actions ?? row.requests) {
      const prerequisite = action.prerequisiteScenario;
      if (
        prerequisite !== undefined &&
        (!plans.has(prerequisite) ||
          owners.get(prerequisite) !== owners.get(id) ||
          positions.get(prerequisite)! >= positions.get(id)!)
      )
        throw Error(
          `prerequisite must be earlier and implemented in the same shard: ${id} -> ${prerequisite}`,
        );
    }
  }
  const inventory = ownData(parseBoundedJson(coverage.bytes, "fixture", "artifact-set coverage"), [
    "version",
    "claimEligible",
    "rows",
  ]);
  if (
    inventory.version !== 1 ||
    inventory.claimEligible !== false ||
    !Array.isArray(inventory.rows) ||
    inventory.rows.length !== selection.required.length
  )
    throw Error(
      "coverage must contain the complete canonical required inventory with claimEligible false",
    );
  const rows: CoverageRow[] = inventory.rows.map((value, n) => {
    const row = ownData(value, ["id", "status", "wholeContract", "reason", "bindings"]);
    if (
      row.id !== selection.required[n]!.id ||
      typeof row.wholeContract !== "boolean" ||
      typeof row.reason !== "string" ||
      row.reason.trim().length === 0 ||
      !Array.isArray(row.bindings)
    )
      throw Error("invalid or out-of-order coverage row");
    const plan = plans.get(row.id as string);
    if (!plan) {
      if (row.status !== "omitted" || row.wholeContract !== false || row.bindings.length !== 0)
        throw Error("unplanned requirement must be omitted with no binding or whole credit");
      return {
        id: row.id as string,
        status: "omitted",
        wholeContract: false,
        reason: row.reason,
        bindings: [],
      };
    }
    const expected = (plan.actions ?? plan.requests).flatMap((action) =>
      action.assertions.map((a) => `${action.id}.${a.id}`),
    );
    // Dots remain legal in both IDs. Joined names must be unique within this
    // artifact; across artifacts the exact manifest digest pins their split.
    // Coverage and manifest identities jointly bind the authored assertions.
    if (new Set(expected).size !== expected.length)
      throw Error("duplicate joined action/assertion binding identifier");
    if (row.status !== "bounded-observation" || row.bindings.length !== 1 || expected.length === 0)
      throw Error("planned requirement needs exactly one nonempty ordered coverage binding");
    const binding = ownData(row.bindings[0], ["scenario", "assertions"]);
    if (
      binding.scenario !== row.id ||
      !Array.isArray(binding.assertions) ||
      canonicalJson(binding.assertions) !== canonicalJson(expected)
    )
      throw Error("coverage binding must equal all ordered action/assertion IDs");
    return {
      id: row.id as string,
      status: "bounded-observation",
      wholeContract: row.wholeContract,
      reason: row.reason,
      bindings: [{ scenario: row.id as string, assertions: [...expected] }],
    };
  });
  const descriptor = {
    indexDigest: digest(indexSource.bytes),
    coverageDigest: digest(coverage.bytes),
    fixtureDigest: digest(fixture.bytes),
    catalogDigests: selection.catalogDigests,
    shards: shards.map(({ id, bundle, scenarioIds }) => ({
      id,
      manifestDigest: bundle.digests.manifestDigest,
      scenarioIds,
    })),
  };
  const set: ReadUpdateArtifactSet = freeze({
    claimEligible: false,
    selection,
    index,
    coverage: { version: 1, claimEligible: false, rows },
    shards,
    requirements: selection.required.map(({ id }) => ({ id, owner: owners.get(id) ?? null })),
    digests: {
      setDigest: digest(canonicalJson(descriptor)),
      indexDigest: descriptor.indexDigest,
      coverageDigest: descriptor.coverageDigest,
      fixtureDigest: descriptor.fixtureDigest,
      catalogDigests: selection.catalogDigests,
    },
    sourceBytes: {
      index: indexSource.bytes.byteLength,
      fixture: fixture.bytes.byteLength,
      coverage: coverage.bytes.byteLength,
      manifests: shards.reduce((total, shard) => total + shard.sourceBytes, 0),
    },
  });
  sets.set(set, { index: indexSource, fixture, coverage, manifests });
  return set;
}

export function assertReadUpdateArtifactSet(value: ReadUpdateArtifactSet): void {
  if (!sets.has(value)) throw Error("factory-created Read+Update artifact set required");
}
/** Planner inputs are fresh copies; callers cannot mutate the set's retained exact bytes. */
export function copyReadUpdateArtifactSetSources(
  set: ReadUpdateArtifactSet,
): ReadUpdateArtifactSetSources {
  assertReadUpdateArtifactSet(set);
  const captured = sets.get(set)!;
  const copy = (s: ConformanceArtifactSource) => ({ bytes: new Uint8Array(s.bytes) });
  return {
    index: copy(captured.index),
    fixture: copy(captured.fixture),
    coverage: copy(captured.coverage),
    manifests: Object.fromEntries(
      Object.entries(captured.manifests).map(([name, s]) => [name, copy(s)]),
    ),
  };
}
