import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  selectApplicableScenariosForProfile,
  type ExactConformanceRunResult,
} from "@bdp/conformance";
import {
  bindServedProfileConfiguration,
  createReadUpdateArtifactSet,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  artifactRoutes,
  associateArtifactObservations,
  type ArtifactObservation,
} from "../test-support/read-update-artifact-execution.js";
const selection = loadProfileContractSelection("read-update");
const ids = selection.required.slice(0, 2).map((r) => r.id);
const scope = "https://reference.invalid/acme/";
const sourceCommit = "a".repeat(40);
const bytes = (input: unknown) => ({ bytes: Buffer.from(JSON.stringify(input)) });
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function setup() {
  const fixture = bytes({
    fixtureVersion: 1,
    id: "association-unit-fixture",
    seed: 0,
    capabilities: ["association-unit"],
    bindings: { unused: "beads/unused" },
  });
  const names = ["matrices/baseline.json", "matrices/continuation.json"];
  const set = createReadUpdateArtifactSet(selection, {
    index: bytes({
      version: 1,
      shards: names.map((source, index) => ({ id: `shard-${index}`, source })),
    }),
    fixture,
    coverage: bytes({
      version: 1,
      claimEligible: false,
      rows: selection.required.map(({ id }) => ({
        id,
        status: ids.includes(id) ? "bounded-observation" : "omitted",
        wholeContract: false,
        reason: "Synthetic association validator input; not runtime evidence",
        bindings: ids.includes(id) ? [{ scenario: id, assertions: ["observe.status"] }] : [],
      })),
    }),
    manifests: Object.fromEntries(
      names.map((name, index) => [
        name,
        bytes({
          manifestVersion: 2,
          catalogId: "read-update-v1",
          scenarios: [
            {
              id: ids[index],
              requiredProfile: "read",
              setup: { fixture: "association-unit-fixture", requires: [] },
              cleanup: { resetFixture: true },
              applicability: { requires: [] },
              requests: [
                {
                  id: "observe",
                  method: "GET",
                  target: { binding: "scope" },
                  raw: { headerLines: [] },
                  captures: [],
                  assertions: [{ id: "status", kind: "status", equals: 200 }],
                },
              ],
            },
          ],
        }),
      ]),
    ),
  });
  const configuration = bindServedProfileConfiguration({
    scope,
    profile: "read-update",
    history: false,
    sourceCommit,
    installedPayloadDigest: "b".repeat(64),
    installedContractsDigest: "c".repeat(64),
    policyDigest: "d".repeat(64),
    authenticationDigest: "e".repeat(64),
    fixture,
  });
  const receipt = {
    scope,
    profile: "read-update",
    history: false,
    payloadIdentity: configuration.installedPayloadDigest,
    artifactIdentity: `development-schema5-${configuration.installedContractsDigest}`,
    policyIdentity: configuration.policyDigest,
    authenticationIdentity: configuration.authenticationDigest,
    configurationIdentity: "f".repeat(64),
  };
  const observations: ArtifactObservation[] = set.shards.map((shard, index) => {
    const selected =
      index === 0
        ? selectApplicableScenariosForProfile(shard.bundle.catalog, "read-update").map((s) => s.id)
        : shard.scenarioIds;
    const exactConfiguration = {
      scope,
      profile: "read-update" as const,
      routes: artifactRoutes(shard.bundle, scope),
      maximumRequestHeaderBytes: 16384,
      maximumRequestBodyBytes: 131072,
      defaultCredentialRef: "operator",
      credentialHandles: [
        { id: "operator", headerNames: ["authorization"] },
        { id: "anonymous", headerNames: [] },
        { id: "unknown", headerNames: ["authorization"] },
      ],
    };
    const { defaultCredentialRef: _, credentialHandles: __, ...projection } = exactConfiguration;
    const result: ExactConformanceRunResult = {
      reportVersion: 4,
      scope,
      profile: "read-update",
      seed: 0,
      selectedScenarioIds: selected,
      ...(index === 0 ? {} : { scenarioSelection: shard.scenarioIds }),
      artifacts: shard.bundle.digests,
      declarations: {
        targetLabel: "synthetic association unit input",
        exactConfigurationDigest: hash(projection),
      },
      claimEligible: false,
      scenarios: selected.map((id) => ({
        id,
        requiredProfile: selection.catalog.scenarios.find((r) => r.id === id)!.requiredProfile,
        state: shard.scenarioIds.includes(id) ? "pass" : "harness-error",
        ...(shard.scenarioIds.includes(id) ? {} : { category: "not-implemented" as const }),
        requirements: [],
        exchanges: [],
      })),
    };
    return {
      sourceCommit,
      configuration,
      baselineReceipt: { ...receipt },
      sessions: shard.scenarioIds.map((scenario) => ({ scenario, ...receipt })),
      result,
      exactConfiguration,
      plannedManifestDigest: shard.bundle.digests.manifestDigest,
      catalogSources: selection.catalogDigests,
      plannedIds: shard.scenarioIds,
      requiredIds: selection.required.map((s) => s.id),
      cleanupComplete: true,
    };
  });
  return { set, observations };
}
describe("private installed artifact report association (synthetic metadata only)", () => {
  it("retains separate reports and explicit unplanned required witnesses", () => {
    const { set, observations } = setup();
    observations[0]!.baselineReceipt.arbitraryChildStderr = "secret sentinel";
    const summary = associateArtifactObservations(set, sourceCommit, observations);
    expect(JSON.stringify(summary)).not.toContain("secret sentinel");
    expect(summary.claimEligible).toBe(false);
    expect(summary.authoredIds).toEqual(ids);
    expect(summary.observedIds).toEqual(ids);
    expect(summary.omittedRequiredIds).toHaveLength(selection.required.length - 2);
    expect(summary.reviewedWholeIds).toEqual([]);
    expect(summary.shards[0]!.resultIds).toContain(ids[1]);
    expect(summary.shards[1]!.resultIds).toEqual([ids[1]]);
    expect(summary.shards[0]!.routes.some((r) => r.url.endsWith("unused"))).toBe(false);
    expect(summary.shards[0]!.reportDigest).toBe(hash(observations[0]!.result));
    expect(summary.shards[1]!.reportDigest).toBe(hash(observations[1]!.result));
  });
  it.each([
    "missing",
    "extra",
    "duplicate",
    "source",
    "catalog",
    "fixture",
    "manifest",
    "routes",
    "route-digest",
    "ready-configuration",
    "ready-policy",
    "session-configuration",
    "cleanup",
    "missing-result",
    "duplicate-result",
    "extra-continuation",
    "false-pass",
    "missing-unplanned",
    "unplanned-exchange",
    "owned-failure",
    "selection",
    "selected-order",
  ])("rejects %s association", (kind) => {
    const { set, observations } = setup();
    // Keep genuinely branded served configuration objects; mutate plain observation
    // metadata only, exactly where the association boundary compares it.
    const input: any[] = observations.map((r) => ({
      ...structuredClone(r),
      configuration: r.configuration,
    }));
    const second = input[1];
    if (kind === "missing") input.pop();
    if (kind === "extra") input.push(second);
    if (kind === "duplicate") input[1] = input[0];
    if (kind === "source") second.sourceCommit = "0".repeat(40);
    if (kind === "catalog") second.catalogSources = {};
    if (kind === "fixture") second.result.artifacts.fixtureDigest = "0".repeat(64);
    if (kind === "manifest") second.result.artifacts.manifestDigest = "0".repeat(64);
    if (kind === "routes") second.exactConfiguration.routes.pop();
    if (kind === "route-digest")
      second.result.declarations.exactConfigurationDigest = "0".repeat(64);
    if (kind === "ready-configuration")
      second.baselineReceipt.configurationIdentity = "0".repeat(64);
    if (kind === "ready-policy") second.baselineReceipt.policyIdentity = "0".repeat(64);
    if (kind === "session-configuration") second.sessions[0].configurationIdentity = "0".repeat(64);
    if (kind === "cleanup") second.cleanupComplete = false;
    if (kind === "missing-result") second.result.scenarios = [];
    if (kind === "duplicate-result") second.result.scenarios.push(second.result.scenarios[0]);
    if (kind === "extra-continuation") second.result.scenarios.push(input[0].result.scenarios[0]);
    if (kind === "false-pass")
      input[0].result.scenarios.find((r: { id: string }) => r.id === ids[1]).state = "pass";
    if (kind === "missing-unplanned") input[0].result.scenarios.splice(2, 1);
    if (kind === "unplanned-exchange")
      input[0].result.scenarios.find((r: { id: string }) => r.id === ids[1]).exchanges.push({});
    if (kind === "owned-failure") second.result.scenarios[0].state = "fail";
    if (kind === "selection") second.result.scenarioSelection = undefined;
    if (kind === "selected-order") input[0].result.selectedScenarioIds.reverse();
    expect(() => associateArtifactObservations(set, sourceCommit, input)).toThrow();
  });
});
