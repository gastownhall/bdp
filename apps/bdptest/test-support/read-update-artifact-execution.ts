/** Private installed-test association only. Never a ConformanceRunResult or admission artifact. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  canonicalJson,
  selectApplicableScenariosForProfile,
  type ConformanceRunResult,
  type ExactHttpConfiguration,
} from "@bdp/conformance";
import {
  assertReadUpdateArtifactSet,
  assertSameServedProfileConfiguration,
  bindServedProfileConfiguration,
  type ReadUpdateArtifactSet,
} from "@bdp/conformance/testing";
import { installedContractsDigest } from "./installed-contract-identity.js";

type Bundle = ReadUpdateArtifactSet["shards"][number]["bundle"];
export function artifactRoutes(bundle: Bundle, scope: string) {
  const known: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(bundle.fixture.bindings).map(([key, value]) => [
        key,
        new URL(value, scope).href,
      ]),
    ),
    scope,
    "service-desc": `${scope}bdp.json`,
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    operations: `${scope}operations/`,
  };
  const reads = bundle.manifest.scenarios.flatMap((row) =>
    (row.actions ?? row.requests).flatMap((action) => {
      if ("family" in action && action.family !== "http") return [];
      const base = known[action.target.binding];
      if (!base) throw Error("Read target binding is not in the fixed fixture");
      const url = new URL(action.target.path ?? "", base);
      for (const [key, input] of Object.entries(action.target.query ?? {}))
        for (const value of Array.isArray(input) ? input : [input]) {
          if (typeof value !== "string") throw Error("Read fixture query requires literal strings");
          url.searchParams.append(key, value);
        }
      return [{ method: action.method, url: url.href }];
    }),
  );
  const clients = bundle.manifest.scenarios.flatMap((row) =>
    (row.actions ?? []).flatMap((action) => {
      if (action.family !== "client" || action.operation !== "installed.exact-request") return [];
      const input = action.input as Record<string, unknown>;
      if (input.method !== "GET" || typeof input.targetBinding !== "string") return [];
      const url = known[input.targetBinding];
      return url === undefined ? [] : [{ method: "GET" as const, url }];
    }),
  );
  const routes = [
    ...clients,
    ...reads,
    ...[
      "sequence",
      "create-bead",
      "update-bead",
      "delete-bead",
      "create-link",
      "update-link",
      "delete-link",
      "put-alias",
      "delete-alias",
    ].map((suffix) => ({ method: "POST" as const, url: `${scope}operations/${suffix}` })),
  ];
  return routes.filter(
    (r, n) => routes.findIndex((other) => r.method === other.method && r.url === other.url) === n,
  );
}
export type ArtifactObservation = {
  readonly sourceCommit: string;
  readonly configuration: ReturnType<typeof bindServedProfileConfiguration>;
  readonly baselineReceipt: Record<string, unknown>;
  readonly sessions: readonly Record<string, unknown>[];
  readonly result: ConformanceRunResult;
  readonly exactConfiguration: ExactHttpConfiguration;
  readonly plannedManifestDigest: string | undefined;
  readonly catalogSources: Readonly<Record<string, string>>;
  readonly plannedIds: readonly string[];
  readonly requiredIds: readonly string[];
  readonly cleanupComplete: boolean;
};
function equal(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw Error(`artifact-set ${label} mismatch`);
}
function readySummary(receipt: Record<string, unknown>) {
  return Object.fromEntries(
    [
      "scope",
      "profile",
      "history",
      "payloadIdentity",
      "artifactIdentity",
      "policyIdentity",
      "authenticationIdentity",
      "configurationIdentity",
      "listenUrl",
    ]
      .filter((key) => receipt[key] !== undefined)
      .map((key) => [key, receipt[key]]),
  );
}
function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function associateArtifactObservations(
  set: ReadUpdateArtifactSet,
  sourceCommit: string,
  observations: readonly ArtifactObservation[],
) {
  assertReadUpdateArtifactSet(set);
  if (observations.length !== set.shards.length)
    throw Error("artifact-set missing or extra report");
  const first = observations[0]!;
  const summary = set.shards.map((shard, index) => {
    const report = observations[index]!;
    const { result, configuration } = report;
    if (!report.cleanupComplete) throw Error("artifact-set cleanup incomplete");
    equal(report.sourceCommit, sourceCommit, "source");
    equal(configuration.sourceCommit, sourceCommit, "configuration source");
    assertSameServedProfileConfiguration(first.configuration, configuration);
    equal(configuration.fixtureDigest, set.digests.fixtureDigest, "configuration fixture");
    equal(configuration.profile, "read-update", "profile");
    equal(configuration.history, false, "History");
    equal(report.catalogSources, set.digests.catalogDigests, "catalog source map");
    equal(report.plannedIds, shard.scenarioIds, "owned plans");
    equal(
      report.requiredIds,
      set.requirements.map((r) => r.id),
      "required inventory",
    );
    equal(report.plannedManifestDigest, shard.bundle.digests.manifestDigest, "planned manifest");
    equal(result.artifacts, shard.bundle.digests, "report artifacts");
    equal(result.profile, configuration.profile, "report profile");
    equal(result.scope, configuration.scope, "report Scope");
    equal(result.claimEligible, false, "claim");
    equal(result.reportVersion, 4, "report version");
    equal(result.seed, shard.bundle.fixture.seed, "seed");
    equal(result.scenarioFilter, undefined, "filter");
    const selected =
      index === 0
        ? selectApplicableScenariosForProfile(shard.bundle.catalog, "read-update").map((r) => r.id)
        : shard.scenarioIds;
    equal(
      result.scenarioSelection,
      index === 0 ? undefined : shard.scenarioIds,
      "requested selection",
    );
    equal(result.selectedScenarioIds, selected, "selected IDs");
    equal(
      result.scenarios.map((r) => r.id),
      selected,
      "result IDs",
    );
    const owned = new Set(shard.scenarioIds);
    for (const row of result.scenarios) {
      if (owned.has(row.id)) equal(row.state, "pass", `owned outcome ${row.id}`);
      else {
        equal(row.state, "harness-error", `unplanned outcome ${row.id}`);
        equal(row.category, "not-implemented", `unplanned category ${row.id}`);
        equal(row.exchanges, [], `unplanned exchanges ${row.id}`);
        equal(row.actions?.length ?? 0, 0, `unplanned actions ${row.id}`);
      }
    }
    const exact = report.exactConfiguration;
    equal(exact.scope, configuration.scope, "route Scope");
    equal(exact.profile, configuration.profile, "route profile");
    equal(exact.routes, artifactRoutes(shard.bundle, configuration.scope), "routes");
    equal(exact.defaultCredentialRef, "operator", "default credential handle");
    equal(
      exact.credentialHandles,
      [
        { id: "operator", headerNames: ["authorization"] },
        { id: "anonymous", headerNames: [] },
        { id: "unknown", headerNames: ["authorization"] },
      ],
      "credential handles",
    );
    equal(exact.maximumRequestHeaderBytes, 16384, "header bound");
    equal(exact.maximumRequestBodyBytes, 131072, "body bound");
    const routeDigest = digest({
      scope: exact.scope,
      profile: exact.profile,
      routes: exact.routes,
      maximumRequestHeaderBytes: exact.maximumRequestHeaderBytes,
      maximumRequestBodyBytes: exact.maximumRequestBodyBytes,
    });
    equal(
      "exactConfigurationDigest" in result.declarations
        ? result.declarations.exactConfigurationDigest
        : undefined,
      routeDigest,
      "route digest",
    );
    equal(
      report.sessions.map((s) => s.scenario),
      shard.scenarioIds,
      "actual sessions",
    );
    for (const receipt of [report.baselineReceipt, ...report.sessions]) {
      equal(
        receipt.configurationIdentity,
        first.baselineReceipt.configurationIdentity,
        "actual runtime configuration",
      );
      equal(receipt.scope, configuration.scope, "actual Scope");
      equal(receipt.profile, configuration.profile, "actual profile");
      equal(receipt.history, configuration.history, "actual History");
      equal(receipt.payloadIdentity, configuration.installedPayloadDigest, "actual payload");
      equal(
        installedContractsDigest(receipt.artifactIdentity),
        configuration.installedContractsDigest,
        "actual contracts",
      );
      equal(receipt.policyIdentity, configuration.policyDigest, "actual policy");
      equal(
        receipt.authenticationIdentity,
        configuration.authenticationDigest,
        "actual authentication",
      );
    }
    return {
      id: shard.id,
      source: shard.source,
      selectionMode: index === 0 ? "unfiltered" : "owned-exact",
      requestedIds: result.scenarioSelection ?? null,
      selectedIds: result.selectedScenarioIds,
      resultIds: result.scenarios.map((r) => r.id),
      manifestDigest: shard.bundle.digests.manifestDigest,
      routeDigest,
      routes: exact.routes,
      reportDigest: digest(result),
      reportBytes: Buffer.byteLength(JSON.stringify(result)),
      actualBootstrap: readySummary(report.baselineReceipt),
      actualSessions: report.sessions.map((s) => ({ scenario: s.scenario, ...readySummary(s) })),
      cleanupComplete: true,
    };
  });
  return {
    claimEligible: false as const,
    sourceCommit,
    ...set.digests,
    sourceBytes: set.sourceBytes,
    configuration: first.configuration,
    runtimeConfigurationIdentity: first.baselineReceipt.configurationIdentity,
    requiredOwnership: set.requirements,
    authoredIds: set.requirements.filter((r) => r.owner !== null).map((r) => r.id),
    observedIds: set.requirements.filter((r) => r.owner !== null).map((r) => r.id),
    reviewedWholeIds: set.coverage.rows.filter((r) => r.wholeContract).map((r) => r.id),
    omittedRequiredIds: set.requirements.filter((r) => r.owner === null).map((r) => r.id),
    optionalCatalogIds: first.result.selectedScenarioIds.filter(
      (id) => !set.requirements.some((r) => r.id === id),
    ),
    shards: summary,
  };
}
