import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  createArtifactEvidenceWriter,
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
    expect(summary.observedStatePartitions.pass).toEqual(ids);
    expect(summary.observedStatePartitions.fail).toEqual([]);
    expect(summary.uncoveredIds).toEqual(selection.required.map((r) => r.id));
    for (const mapped of summary.requiredObservations) {
      const owning = observations[mapped.owner === "shard-1" ? 1 : 0]!;
      const observation = mapped.observation!;
      expect(observation.resultDigest).toBe(hash(owning.result));
      expect(owning.result.scenarios[observation.rowIndex]!.id).toBe(mapped.id);
      expect(observation.state).toBe(owning.result.scenarios[observation.rowIndex]!.state);
      if (mapped.owner === null) expect(mapped).toMatchObject({ reason: "not-planned" });
    }
    expect(summary.omittedRequiredIds).toHaveLength(selection.required.length - 2);
    expect(summary.reviewedWholeIds).toEqual([]);
    expect(summary.shards[0]!.resultIds).toContain(ids[1]);
    expect(summary.shards[1]!.resultIds).toEqual([ids[1]]);
    expect(summary.shards[0]!.routes.some((r) => r.url.endsWith("unused"))).toBe(false);
    expect(summary.shards[0]!.resultDigest).toBe(hash(observations[0]!.result));
    expect(summary.shards[1]!.resultDigest).toBe(hash(observations[1]!.result));
  });
  it.each([
    ["missing", `missing or extra report`],
    ["extra", `missing or extra report`],
    ["duplicate", `owned plans mismatch`],
    ["source", `source mismatch`],
    ["catalog", `catalog source map mismatch`],
    ["fixture", `report artifacts mismatch`],
    ["manifest", `report artifacts mismatch`],
    ["planned-manifest", `planned manifest mismatch`],
    ["routes", `routes mismatch`],
    ["route-digest", `route digest mismatch`],
    ["ready-configuration", `actual runtime configuration mismatch`],
    ["ready-policy", `actual policy mismatch`],
    ["session-configuration", `actual runtime configuration mismatch`],
    ["cleanup", `cleanup incomplete`],
    ["missing-result", `result IDs mismatch`],
    ["duplicate-result", `result IDs mismatch`],
    ["extra-continuation", `result IDs mismatch`],
    ["false-pass", `unplanned outcome ${ids[1]}`],
    ["missing-unplanned", `result IDs mismatch`],
    ["unplanned-exchange", `unplanned exchanges ${ids[1]}`],
    ["owned-failure", `owned outcome ${ids[1]}`],
    ["selection", `requested selection mismatch`],
    ["selected-order", `selected IDs mismatch`],
    ["row-cleanup", `row cleanup failure ${ids[1]}`],
  ])("rejects %s association at its intended discriminator", (kind, label) => {
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
    if (kind === "planned-manifest") second.plannedManifestDigest = "0".repeat(64);
    if (kind === "routes") second.exactConfiguration.routes.pop();
    if (kind === "route-digest")
      second.result.declarations.exactConfigurationDigest = "0".repeat(64);
    if (kind === "ready-configuration")
      second.baselineReceipt.configurationIdentity = "0".repeat(64);
    if (kind === "ready-policy") second.baselineReceipt.policyIdentity = "0".repeat(64);
    if (kind === "session-configuration") second.sessions[0].configurationIdentity = "0".repeat(64);
    if (kind === "cleanup") second.cleanupComplete = false;
    if (kind === "row-cleanup")
      second.result.scenarios[0].cleanupError = "synthetic cleanup failed";
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
    expect(() => associateArtifactObservations(set, sourceCommit, input)).toThrow(label);
  });
});

describe("private attempt persistence (synthetic metadata only)", () => {
  function output() {
    const directory = mkdtempSync(path.join(tmpdir(), "artifact-evidence-unit-"));
    const filename = path.join(directory, "summary.json");
    return {
      filename,
      close: () => rmSync(directory, { recursive: true, force: true }),
      read: (suffix: string) => JSON.parse(readFileSync(filename + suffix, "utf8")),
    };
  }
  it("retains exact detached runner results and safe wrappers before cleanup; no invented unrun result", () => {
    const files = output();
    try {
      const { set, observations } = setup();
      const secret = "unit-credential-sentinel";
      const writer = createArtifactEvidenceWriter(set, sourceCommit, files.filename, [secret]);
      const first = observations[0]!;
      first.baselineReceipt.arbitraryStderr = secret;
      Object.assign(first, { exception: secret, targetEntry: secret });
      const authentic = structuredClone(first.result);
      writer.start(0);
      writer.acquired(0);
      writer.returned(0, first);
      Object.assign(first.result, { scenarios: [] });
      writer.cleaned(0, "failed");
      writer.failedSet();
      const retained = files.read(".shard-0.json");
      expect(retained.result).toEqual(authentic);
      expect(retained).toMatchObject({
        cleanupComplete: false,
        cleanupStatus: "failed",
        claimEligible: false,
      });
      expect(JSON.stringify(retained)).not.toContain(secret);
      expect(files.read(".attempt.json")).toMatchObject({
        outcome: "failed",
        claimEligible: false,
        shards: [
          { evidence: "retained", cleanup: "failed" },
          { status: "unobserved", evidence: "absent", cleanup: "not-started" },
        ],
      });
      expect(existsSync(files.filename + ".shard-1.json")).toBe(false);
      expect(() => writer.succeeded({ outcome: "observed" })).toThrow("incomplete");
      expect(existsSync(files.filename)).toBe(false);
      const prior = readFileSync(files.filename + ".attempt.json", "utf8");
      expect(() =>
        createArtifactEvidenceWriter(set, sourceCommit, files.filename, [secret]),
      ).toThrow("fresh attempt");
      expect(readFileSync(files.filename + ".attempt.json", "utf8")).toBe(prior);
    } finally {
      files.close();
    }
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a failed cleanup file replacement preserves previously returned bytes",
    () => {
      const files = output();
      try {
        const { set, observations } = setup();
        const writer = createArtifactEvidenceWriter(set, sourceCommit, files.filename, [
          "sentinel",
        ]);
        writer.start(0);
        writer.acquired(0);
        writer.returned(0, observations[0]!);
        const original = readFileSync(`${files.filename}.shard-0.json`, "utf8");
        chmodSync(path.dirname(files.filename), 0o500);
        try {
          expect(() => writer.cleaned(0, "failed")).toThrow();
        } finally {
          chmodSync(path.dirname(files.filename), 0o700);
        }
        expect(readFileSync(`${files.filename}.shard-0.json`, "utf8")).toBe(original);
        writer.failedSet();
        expect(files.read(".attempt.json")).toMatchObject({
          outcome: "failed",
          shards: [
            { cleanup: "failed", evidence: "retained" },
            { status: "unobserved", evidence: "absent" },
          ],
        });
        expect(existsSync(files.filename)).toBe(false);
      } finally {
        files.close();
      }
    },
  );
  it("binds the exact written wrapper bytes separately from canonical genuine results", () => {
    const files = output();
    try {
      const { set, observations } = setup();
      const writer = createArtifactEvidenceWriter(set, sourceCommit, files.filename, ["sentinel"]);
      for (const [index, report] of observations.entries()) {
        writer.start(index);
        writer.acquired(index);
        writer.returned(index, report);
        writer.cleaned(index, "complete");
      }
      writer.succeeded(associateArtifactObservations(set, sourceCommit, observations));
      const summary = files.read("");
      for (const bound of summary.writtenReports) {
        const bytes = readFileSync(bound.report);
        expect(bound.writtenReportBytes).toBe(bytes.length);
        expect(bound.writtenReportDigest).toBe(createHash("sha256").update(bytes).digest("hex"));
        expect(bound.resultDigest).toBe(hash(JSON.parse(bytes.toString()).result));
        expect(bound.writtenReportDigest).not.toBe(bound.resultDigest);
      }
      expect(files.read(".attempt.json").observedStatePartitions.pass).toEqual(ids);
    } finally {
      files.close();
    }
  });
  it("screens the actual successful summary before creating its output file", () => {
    const files = output();
    try {
      const { set, observations } = setup();
      const secret = "success-summary-secret";
      const writer = createArtifactEvidenceWriter(set, sourceCommit, files.filename, [secret]);
      for (const [index, report] of observations.entries()) {
        writer.start(index);
        writer.acquired(index);
        writer.returned(index, report);
        writer.cleaned(index, "complete");
      }
      expect(() =>
        writer.succeeded({
          ...associateArtifactObservations(set, sourceCommit, observations),
          unexpected: secret,
        }),
      ).toThrow("credential-bearing evidence withheld");
      writer.failedSet();
      expect(existsSync(files.filename)).toBe(false);
      expect(JSON.stringify(files.read(".attempt.json"))).not.toContain(secret);
      expect(files.read(".attempt.json").outcome).toBe("failed");
    } finally {
      files.close();
    }
  });
  it.each(["literal", "base64", "percent", "key"])(
    "withholds credential-bearing genuine %s result before writing it",
    (encoding) => {
      const files = output();
      try {
        const { set, observations } = setup();
        const secret = "unit/credential?secret=123";
        const writer = createArtifactEvidenceWriter(set, sourceCommit, files.filename, [secret]);
        const value =
          encoding === "base64"
            ? Buffer.from(secret).toString("base64")
            : encoding === "percent"
              ? encodeURIComponent(secret)
              : secret;
        Object.assign(
          observations[0]!.result.declarations,
          encoding === "key" ? { [secret]: "withheld key" } : { targetLabel: value },
        );
        writer.start(0);
        writer.acquired(0);
        expect(() => writer.returned(0, observations[0]!)).toThrow(
          "credential-bearing evidence withheld",
        );
        writer.cleaned(0, "complete");
        expect(existsSync(files.filename + ".shard-0.json")).toBe(false);
        expect(existsSync(files.filename)).toBe(false);
        const ledger = files.read(".attempt.json");
        expect(ledger).toMatchObject({
          outcome: "failed",
          shards: [{ evidence: "withheld-credential", status: "failed" }, { status: "unobserved" }],
        });
        expect(JSON.stringify(ledger)).not.toContain(secret);
        expect(JSON.stringify(ledger)).not.toContain(value);
      } finally {
        files.close();
      }
    },
  );
});
