/** NEW association-option tests. Every report below is synthetic metadata, never installed evidence.
 * Setup ported literally from read-update-artifact-execution.test.ts at5f3a67e8. */
import { createHash } from "node:crypto";
import {
  canonicalJson,
  type ExactConformanceRunResult,
  selectApplicableScenariosForProfile,
} from "@bdp/conformance";
import {
  bindServedProfileConfiguration,
  createReadUpdateArtifactSet,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import { expect, it } from "vitest";
import {
  type ArtifactAssociationOptions,
  type ArtifactObservation,
  artifactRoutes,
  associateArtifactObservations,
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

const handles = [
  ...["operator", "restricted", "other"].map((id) => ({ id, headerNames: ["authorization"] })),
  { id: "anonymous", headerNames: [] },
  { id: "unknown", headerNames: ["authorization"] },
];
function ownedSetup() {
  const { set, observations } = setup();
  const actual = observations.map((row, index): ArtifactObservation => {
    const result = row.result;
    if (result.reportVersion !== 4) throw Error("synthetic setup requires exact report4");
    return {
      ...row,
      exactConfiguration: {
        ...row.exactConfiguration,
        credentialHandles: structuredClone(handles),
      },
      result: {
        ...result,
        scenarioSelection: [...set.shards[index]!.scenarioIds],
        selectedScenarioIds: [...set.shards[index]!.scenarioIds],
        scenarios: result.scenarios.filter((scenario) =>
          set.shards[index]!.scenarioIds.includes(scenario.id),
        ),
      },
    };
  });
  const options: ArtifactAssociationOptions = {
    credentialHandles: handles,
    selectionModes: set.shards.map((shard) => ({ id: shard.id, mode: "owned-exact" })),
  };
  return { set, actual, options };
}
it("preserves the legacy three-handle/unfiltered-first association when no options are passed", () => {
  const { set, observations } = setup();
  const result = associateArtifactObservations(set, sourceCommit, observations);
  expect(result.shards.map((shard) => shard.selectionMode)).toEqual(["unfiltered", "owned-exact"]);
  expect(result.authoredIds).toEqual(ids);
  expect(result.claimEligible).toBe(false);
});
it("joins all five actual handles and exact complete owner IDs in both explicitly selected shards", () => {
  const { set, actual, options } = ownedSetup();
  const result = associateArtifactObservations(set, sourceCommit, actual, options);
  expect(result.shards.map((shard) => shard.selectionMode)).toEqual(["owned-exact", "owned-exact"]);
  expect(result.shards.map((shard) => shard.requestedIds)).toEqual(
    set.shards.map((shard) => shard.scenarioIds),
  );
  expect(result.authoredIds).toEqual(ids);
  expect(result.observedStatePartitions.pass).toEqual(ids);
  expect(result.claimEligible).toBe(false);
});
it.each([
  "wrong-handle",
  "missing-handle",
  "extra-handle",
  "missing-request",
  "extra-request",
  "missing-selected",
  "extra-selected",
  "missing-result",
  "extra-result",
  "filter",
  "mode-shard",
  "mode-value",
  "cleanup",
  "ready-source",
])("refuses NEW option boundary %s", (kind) => {
  const { set, actual, options } = ownedSetup();
  const input = actual.map((row) => ({
    ...structuredClone(row),
    configuration: row.configuration,
  }));
  const first = input[0]!;
  const credentialHandles = [...first.exactConfiguration.credentialHandles];
  if (kind === "wrong-handle")
    credentialHandles[1] = { id: "wrong-principal", headerNames: ["authorization"] };
  if (kind === "missing-handle") credentialHandles.pop();
  if (kind === "extra-handle")
    credentialHandles.push({ id: "unselected", headerNames: ["authorization"] });
  Object.assign(first.exactConfiguration, { credentialHandles });
  if (kind === "missing-request") Object.assign(first.result, { scenarioSelection: undefined });
  if (kind === "extra-request") Object.assign(first.result, { scenarioSelection: ids });
  if (kind === "missing-selected") Object.assign(first.result, { selectedScenarioIds: [] });
  if (kind === "extra-selected") Object.assign(first.result, { selectedScenarioIds: ids });
  if (kind === "missing-result") Object.assign(first.result, { scenarios: [] });
  if (kind === "extra-result")
    Object.assign(first.result, {
      scenarios: [...first.result.scenarios, input[1]!.result.scenarios[0]],
    });
  if (kind === "filter") Object.assign(first.result, { scenarioFilter: ids });
  if (kind === "cleanup") Object.assign(first, { cleanupComplete: false });
  if (kind === "ready-source") first.baselineReceipt.payloadIdentity = "0".repeat(64);
  let selectedOptions = options;
  if (kind === "mode-shard")
    selectedOptions = {
      ...options,
      selectionModes: [{ id: "wrong-shard", mode: "owned-exact" }, options.selectionModes![1]!],
    };
  if (kind === "mode-value")
    selectedOptions = {
      ...options,
      selectionModes: [
        { id: set.shards[0]!.id, mode: "arbitrary-subset" },
        options.selectionModes![1]!,
      ],
    } as unknown as ArtifactAssociationOptions;
  expect(() => associateArtifactObservations(set, sourceCommit, input, selectedOptions)).toThrow();
});

it.each(["missing-default", "default-without-authorization"])(
  "rejects impossible default binding %s even when both metadata sides agree",
  (kind) => {
    const { set, actual, options } = ownedSetup();
    const impossible =
      kind === "missing-default"
        ? handles.filter((handle) => handle.id !== "operator")
        : handles.map((handle) =>
            handle.id === "operator" ? { id: handle.id, headerNames: [] } : handle,
          );
    const reports = actual.map((row) => ({
      ...row,
      exactConfiguration: { ...row.exactConfiguration, credentialHandles: impossible },
    }));
    expect(() =>
      associateArtifactObservations(set, sourceCommit, reports, {
        ...options,
        credentialHandles: impossible,
      }),
    ).toThrow("default credential handle");
  },
);
