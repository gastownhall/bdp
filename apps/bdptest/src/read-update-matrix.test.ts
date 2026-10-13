import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createRawHttpScenarioTarget,
  createRawHttpExchangeExecutor,
  createJsonSchemaValidator,
  runConformanceMatrix,
  type ExactHttpModeOptions,
} from "@bdp/conformance";
import {
  createCumulativeReadUpdateArtifactBundle,
  loadProfileContractSelection,
  bindServedProfileConfiguration,
  assertSameServedProfileConfiguration,
  planProfileExecution,
} from "@bdp/conformance/testing";
import { expect, it } from "vitest";
import { installedObservationSchema } from "../test-support/installed-body-schema.js";
import { installedContractsDigest } from "../test-support/installed-contract-identity.js";
import { createInstalledExactClient } from "../test-support/read-update-exact-client.js";
import {
  exactNativeReadAdapter,
  seedInstalledReadFixture,
} from "../test-support/installed-read-fixture.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  referenceConfiguration(
    directory: string,
    port: number,
    token: string,
    scope: string,
  ): Record<string, unknown>;
  launchInstalledReference(
    entry: string,
    configuration: unknown,
  ): Promise<{ ready: Record<string, unknown>; close(): Promise<unknown> }>;
};
const token = "cumulative_fixture_operator_0123456789";
const wrongToken = "cumulative_unknown_operator_0123456789";
const scope = "https://reference.invalid/acme/";
const source = (relative: string) => ({ bytes: readFileSync(path.join(root, relative)) });
const defaultEntry = path.join(root, "packages/server/dist/installed-reference-process.js");
const entry = process.env.BDP_CUMULATIVE_INSTALLED_ENTRY ?? defaultEntry;
const configModule = (await import(
  pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
)) as {
  captureInstalledReferenceConfiguration(input: unknown): {
    identity: string;
    artifactIdentity: string;
    policyIdentity: string;
    authenticationIdentity: string;
    profile: "read-update";
    history: false;
  };
};
type W1Counterfactual =
  | "patch-array"
  | "noop-provenance"
  | "link-pin"
  | "deleted-revision"
  | "alias-target"
  | "alias-revision"
  | "target-revision"
  | "resource-header"
  | "alias-header"
  | "closed-body";
type W1bCounterfactual =
  | "source-revision"
  | "owner-inline-link"
  | "link-noop-provenance"
  | "owner-noop-provenance"
  | "noop-source-revision"
  | "link-metadata"
  | "unowned-source-pair"
  | "target-postimage"
  | "stale-link"
  | "owned-plane"
  | "unowned-source-only";
async function run(
  manifestValue?: unknown,
  selectedIds?: string[],
  mismatchedPolicy = false,
  corruptNoopResponse = false,
  fixtureValue?: unknown,
  w1Counterfactual?: W1Counterfactual,
  w1bCounterfactual?: W1bCounterfactual,
) {
  const selection = loadProfileContractSelection("read-update");
  const fixtureSource =
    fixtureValue === undefined
      ? source("packages/conformance/fixtures/read-update-reference-v1.json")
      : { bytes: Buffer.from(JSON.stringify(fixtureValue)) };
  const manifestSource =
    manifestValue === undefined
      ? source("packages/conformance/matrices/read-update-v1.json")
      : { bytes: Buffer.from(JSON.stringify(manifestValue)) };
  const bundle = createCumulativeReadUpdateArtifactBundle(selection, {
    manifest: manifestSource,
    fixture: fixtureSource,
  });
  const coverage = JSON.parse(
    source("packages/conformance/test-support/read-update-coverage-v1.json").bytes.toString(),
  ) as { rows: { id: string; wholeContract: boolean }[] };
  const port = await helpers.availablePort();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-cumulative-ru-"));
  const dialRoute = { transport: "plain" as const, host: "127.0.0.1", port };
  const knownReadBindings: Record<string, string> = {
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
  const readRoutes = bundle.manifest.scenarios.flatMap((row) =>
    (row.actions ?? []).flatMap((action) => {
      if (action.family !== "http") return [];
      const base = knownReadBindings[action.target.binding];
      if (!base) throw Error("Read target binding is not in the fixed fixture");
      const url = new URL(action.target.path ?? "", base);
      for (const [key, input] of Object.entries(action.target.query ?? {})) {
        for (const value of Array.isArray(input) ? input : [input]) {
          if (typeof value !== "string") throw Error("Read fixture query requires literal strings");
          url.searchParams.append(key, value);
        }
      }
      return [{ method: action.method, url: url.href }];
    }),
  );
  // Only fixed client GET targets actually referenced by an action join the
  // allowlist. Captured Bead identities retain the existing per-request route gate.
  const clientReadRoutes = bundle.manifest.scenarios.flatMap((row) =>
    (row.actions ?? []).flatMap((action) => {
      if (action.family !== "client" || action.operation !== "installed.exact-request") return [];
      const input = action.input as { method?: string; targetBinding?: string };
      if (input.method !== "GET" || typeof input.targetBinding !== "string") return [];
      const url = knownReadBindings[input.targetBinding];
      return url === undefined ? [] : [{ method: "GET" as const, url }];
    }),
  );
  const mode: ExactHttpModeOptions = {
    scope,
    profile: "read-update",
    maximumRequestBodyBytes: 65536,
    maximumRequestHeaderBytes: 16384,
    routes: [
      ...clientReadRoutes,
      ...readRoutes.filter(
        (route, index) =>
          readRoutes.findIndex(
            (other) => other.method === route.method && other.url === route.url,
          ) === index,
      ),
      { method: "POST" as const, url: scope },
      ...[
        "create-bead",
        "update-bead",
        "delete-bead",
        "create-link",
        "update-link",
        "delete-link",
        "put-alias",
        "delete-alias",
      ].map((suffix) => ({ method: "POST" as const, url: `${scope}operations/${suffix}` })),
    ],
    defaultCredentialRef: "operator",
    credentialHandles: [
      { id: "operator", headerNames: ["authorization"] },
      { id: "anonymous", headerNames: [] },
      { id: "unknown", headerNames: ["authorization"] },
    ],
    resolveCredentials: ({ credentialRef }) =>
      credentialRef === "anonymous"
        ? {}
        : { authorization: `Bearer ${credentialRef === "operator" ? token : wrongToken}` },
  };
  const uniqueRoutes = mode.routes.filter(
    (route, index) =>
      mode.routes.findIndex((other) => other.method === route.method && other.url === route.url) ===
      index,
  );
  const exactMode = { ...mode, routes: uniqueRoutes };
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  function bindReceipt(ready: Record<string, unknown>) {
    if (ready.profile !== "read-update" || ready.history !== false || ready.scope !== scope)
      throw Error("installed receipt profile, History or Scope mismatch");
    return bindServedProfileConfiguration({
      scope,
      profile: ready.profile,
      history: ready.history,
      sourceCommit,
      installedPayloadDigest: ready.payloadIdentity as string,
      installedContractsDigest: installedContractsDigest(ready.artifactIdentity),
      policyDigest: ready.policyIdentity as string,
      authenticationDigest: ready.authenticationIdentity as string,
      fixture: fixtureSource,
    });
  }
  const bootstrapConfig = helpers.referenceConfiguration(
    path.join(directory, "bootstrap"),
    port,
    token,
    scope,
  );
  const expectedCapture = configModule.captureInstalledReferenceConfiguration(bootstrapConfig);
  let baseline: ReturnType<typeof bindReceipt>;
  let baselineReceipt: Record<string, unknown>;
  let executionPlan: ReturnType<typeof planProfileExecution>;
  try {
    const bootstrap = await helpers.launchInstalledReference(entry, bootstrapConfig);
    try {
      baselineReceipt = bootstrap.ready;
      baseline = bindReceipt(baselineReceipt);
      expect(baselineReceipt.configurationIdentity).toBe(expectedCapture.identity);
      expect(baselineReceipt.artifactIdentity).toBe(expectedCapture.artifactIdentity);
      const expected = bindReceipt({
        ...baselineReceipt,
        profile: expectedCapture.profile,
        history: expectedCapture.history,
        artifactIdentity: expectedCapture.artifactIdentity,
        policyIdentity: mismatchedPolicy ? "0".repeat(64) : expectedCapture.policyIdentity,
        authenticationIdentity: expectedCapture.authenticationIdentity,
      });
      assertSameServedProfileConfiguration(expected, baseline);
      expect(baseline.fixtureDigest).toBe(bundle.digests.fixtureDigest);
      executionPlan = planProfileExecution(selection, baseline, {
        configuration: baseline,
        manifest: manifestSource,
      });
      expect(executionPlan.manifestDigest).toBe(bundle.digests.manifestDigest);
    } finally {
      await bootstrap.close();
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const sessions: Record<string, unknown>[] = [];
  const observations: unknown[] = [];
  const setupObservations: unknown[] = [];
  const nativeReadObservations: unknown[] = [];
  let currentScenario = "";
  let counterfactualApplications = 0;
  let aliasPutObserved = false;
  const target = createRawHttpScenarioTarget(
    async (scenario, _scope, _seed, fixture, signal) => {
      currentScenario = scenario.id;
      const configuration = helpers.referenceConfiguration(
        path.join(directory, scenario.id),
        port,
        token,
        scope,
      );
      const captured = configModule.captureInstalledReferenceConfiguration(configuration);
      const child = await helpers.launchInstalledReference(entry, configuration);
      try {
        assertSameServedProfileConfiguration(baseline, bindReceipt(child.ready));
        expect(child.ready.scope).toBe(scope);
        expect(child.ready.configurationIdentity).toBe(captured.identity);
        expect(child.ready.artifactIdentity).toBe(captured.artifactIdentity);
        if (sessions[0]) {
          expect(child.ready.configurationIdentity).toBe(sessions[0].configurationIdentity);
          expect(child.ready.payloadIdentity).toBe(sessions[0].payloadIdentity);
        }
        sessions.push({ scenario: scenario.id, ...child.ready });
        if (
          Array.isArray(fixture.readSeedScenarios) &&
          fixture.readSeedScenarios.includes(scenario.id)
        )
          await seedInstalledReadFixture(
            fixture,
            scope,
            createRawHttpExchangeExecutor(dialRoute, { exactMode }),
            signal,
            (observation) => setupObservations.push({ scenario: scenario.id, observation }),
          );
        return {
          capabilities: fixture.capabilities,
          bindings: fixture.bindings,
          dialRoute,
          close: async () => {
            await child.close();
          },
        };
      } catch (error) {
        await child.close();
        throw error;
      }
    },
    { exactMode, requestTimeoutMs: 5000 },
  );
  try {
    if (!target.exactConfiguration) throw Error("exact target configuration missing");
    const executeClient = createInstalledExactClient(exactMode, dialRoute, (observation) =>
      observations.push({ scenario: currentScenario, observation }),
    );
    const result = await runConformanceMatrix({
      scope,
      profile: "read-update",
      seed: 0,
      artifactBundle: bundle,
      ...(selectedIds === undefined ? {} : { scenarioSelection: selectedIds }),
      execute: exactNativeReadAdapter(target.execute, (observation) =>
        nativeReadObservations.push({ scenario: currentScenario, observation }),
      ),
      exactExecution: { execute: target.execute, configuration: target.exactConfiguration },
      actionExecutor: async (execution) => {
        const actual = await executeClient(execution);
        const w1Input = execution.input as {
          method?: string;
          targetBinding?: string;
          idempotencyKey?: string;
        };
        if (w1Input.idempotencyKey === "put-alias") aliasPutObserved = true;
        if (
          w1Counterfactual === "target-revision" &&
          aliasPutObserved &&
          w1Input.method === "GET" &&
          w1Input.targetBinding === "w1.a" &&
          counterfactualApplications === 0
        ) {
          const corrupted = structuredClone(actual) as { body: { revision: string } };
          corrupted.body.revision = "fabricated-target-revision";
          counterfactualApplications++;
          return corrupted;
        }
        if (
          corruptNoopResponse &&
          (execution.input as { idempotencyKey?: string }).idempotencyKey === "noop"
        ) {
          // Counterfactual only: corrupt the returned value after real HTTP and
          // observation capture. The store and subsequent GET remain untouched.
          const corrupted = structuredClone(actual) as {
            body: { resource: { revision: string } };
          };
          corrupted.body.resource.revision = "incorrect-noop-response-revision";
          return corrupted;
        }
        const selectedKey: Partial<Record<W1Counterfactual, string>> = {
          "patch-array": "merge-replace",
          "noop-provenance": "combined-noop",
          "link-pin": "create-local-pin",
          "deleted-revision": "delete-link",
          "alias-target": "repoint-alias",
          "alias-revision": "put-alias",
          "resource-header": "update-bead",
          "alias-header": "put-alias",
          "closed-body": "create-a",
        };
        if (
          w1Counterfactual &&
          w1Input.method === "POST" &&
          (execution.input as { idempotencyKey?: string }).idempotencyKey ===
            selectedKey[w1Counterfactual]
        ) {
          // Counterfactual output after actual HTTP and observation capture. Never
          // mutate the authority or claim these substituted values as wire facts.
          const corrupted = structuredClone(actual) as {
            headers: Record<string, string>;
            body: {
              resource: {
                properties: { array: unknown[] };
                revisionProvenance: { actor: unknown };
                source: { revision: string };
              };
              deleted: { resource: { revision: string } };
              target: string;
              unexpected?: boolean;
              revision?: string;
            };
          };
          counterfactualApplications++;
          if (w1Counterfactual === "patch-array")
            corrupted.body.resource.properties.array.reverse();
          if (w1Counterfactual === "noop-provenance")
            corrupted.body.resource.revisionProvenance.actor = {
              id: "writer:corrupted",
              basis: "writer-supplied",
            };
          if (w1Counterfactual === "link-pin")
            corrupted.body.resource.source.revision = "different opaque pin";
          if (w1Counterfactual === "deleted-revision")
            corrupted.body.deleted.resource.revision = "newly-minted-wrong-delete-revision";
          if (w1Counterfactual === "alias-target") corrupted.body.target = `${scope}beads/w1-a`;
          if (w1Counterfactual === "alias-revision")
            corrupted.body.revision = "fabricated-alias-revision";
          if (w1Counterfactual === "resource-header")
            corrupted.headers.etag = '"incorrect-mutation-etag"';
          if (w1Counterfactual === "alias-header")
            corrupted.headers.location = `${scope}alias/w1-locator`;
          if (w1Counterfactual === "closed-body") corrupted.body.unexpected = true;
          return corrupted;
        }
        const w1bInput = execution.input as {
          idempotencyKey?: string;
          targetBinding: string;
          method: string;
        };
        const w1bKey: Partial<Record<W1bCounterfactual, string>> = {
          "stale-link": "stale-link-properties",
          "unowned-source-only": "unowned-create",
          "source-revision": "owned-create",
          "link-noop-provenance": "owned-noop",
          "noop-source-revision": "owned-noop",
          "link-metadata": "owned-metadata",
          "unowned-source-pair": "unowned-create",
        };
        const w1bRead: Partial<Record<W1bCounterfactual, string>> = {
          "owned-plane": "owner-deleted-id",
          "owner-inline-link": "owner-metadata-id",
          "owner-noop-provenance": "owner-noop-id",
          "target-postimage": "target-id",
        };
        if (
          w1bCounterfactual &&
          counterfactualApplications === 0 &&
          ((w1bInput.method === "POST" && w1bInput.idempotencyKey === w1bKey[w1bCounterfactual]) ||
            (w1bInput.method === "GET" && w1bInput.targetBinding === w1bRead[w1bCounterfactual]))
        ) {
          // Deliberate assertion input, after the actual request/response is recorded.
          const corrupted = structuredClone(actual) as { body: Record<string, unknown> };
          const body = corrupted.body;
          counterfactualApplications++;
          if (
            w1bCounterfactual === "source-revision" ||
            w1bCounterfactual === "noop-source-revision"
          )
            body.sourceRevision = "wrong-source-revision";
          if (w1bCounterfactual === "stale-link") body.code = "alias-path-taken";
          if (w1bCounterfactual === "unowned-source-only")
            body.source = `${scope}beads/w1b-unowned-source`;
          if (w1bCounterfactual === "owned-plane") {
            (body.ownedLinks as Record<string, unknown[]>)[`${scope}types/relates`]?.push(
              structuredClone(execution.bindings["link-metadata"]),
            );
          }
          if (w1bCounterfactual === "link-metadata")
            (body.resource as { metadata: Record<string, unknown> }).metadata.tag =
              "not-the-stored-metadata";
          if (w1bCounterfactual === "link-noop-provenance")
            (
              body.resource as { revisionProvenance: Record<string, unknown> }
            ).revisionProvenance.actor = { id: "writer:wrong-noop", basis: "writer-supplied" };
          if (w1bCounterfactual === "owner-noop-provenance")
            (body.revisionProvenance as Record<string, unknown>).actor = {
              id: "writer:wrong-owner",
              basis: "writer-supplied",
            };
          if (w1bCounterfactual === "owner-inline-link") {
            const link = (
              body.ownedLinks as Record<string, { properties: Record<string, unknown> }[]>
            )[`${scope}types/relates`]?.[0];
            if (!link) throw Error("actual owner inline Link missing");
            link.properties.edge = 999;
          }
          if (w1bCounterfactual === "unowned-source-pair") {
            body.source = `${scope}beads/w1b-unowned-source`;
            body.sourceRevision = "not-permitted-on-unowned-result";
          }
          if (w1bCounterfactual === "target-postimage")
            (body.metadata as Record<string, unknown>).tag = "incorrect-target-change";
          return corrupted;
        }
        return actual;
      },
      harness: target.harness,
      schemaValidator: createJsonSchemaValidator(installedObservationSchema),
      declaredTargetLabel: "installed-cumulative-read-update-candidate",
    });
    return {
      claimEligible: false,
      counterfactualApplications,
      sourceCommit,
      configuration: baseline,
      baselineReceipt,
      reportBinding: {
        artifacts: result.artifacts,
        exactConfigurationDigest:
          "exactConfigurationDigest" in result.declarations
            ? result.declarations.exactConfigurationDigest
            : undefined,
      },
      sourceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
          .length > 0,
      targetEntry: entry,
      catalogSources: selection.catalogDigests,
      plannedManifestDigest: executionPlan.manifestDigest,
      requiredIds: selection.required.map((row) => row.id),
      plannedIds: bundle.manifest.scenarios.map((row) => row.id),
      uncoveredIds: selection.required
        .map((row) => row.id)
        .filter((id) => !coverage.rows.find((row) => row.id === id)?.wholeContract),
      sessions,
      observations,
      setupObservations,
      nativeReadObservations,
      result,
    };
  } finally {
    await target.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

it("executes the partial cumulative RU matrix against actual installed factory HTTP and afterstate", async () => {
  const report = await run();
  for (const row of report.result.scenarios)
    expect(row, JSON.stringify(row)).toMatchObject({
      state: !report.plannedIds.includes(row.id) ? "harness-error" : "pass",
    });
  expect(report.result.claimEligible).toBe(false);
  expect(report.plannedManifestDigest).toBe(report.reportBinding.artifacts.manifestDigest);
  // Pin the existing runner projection; credential identity is bound separately in configuration.
  expect(report.reportBinding.exactConfigurationDigest).toBe(
    "f04e98d80971e813b73d1b57d225c0a6bfb0669647d6bbf9b026a908bbf37f26",
  );
  expect(report.uncoveredIds).toHaveLength(102);
  expect(report.uncoveredIds).toContain("read-update.singleton.update-bead");
  expect(report.sessions).toHaveLength(report.plannedIds.length);
  expect(report.observations.length).toBeGreaterThan(30);
  expect(JSON.stringify(report)).not.toContain(token);
  expect(JSON.stringify(report)).not.toContain(wrongToken);
  if (process.env.BDP_CUMULATIVE_REPORT_PATH)
    writeFileSync(process.env.BDP_CUMULATIVE_REPORT_PATH, JSON.stringify(report, null, 2));
}, 30000);

it("fails actual response comparisons for mutated captures and postimages", async () => {
  const original = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  for (const control of ["old-revision", "wrong-postimage"] as const) {
    const manifest = structuredClone(original);
    const scenario = manifest.scenarios.find(
      (row: { id: string }) => row.id === "read-update.singleton.update-bead",
    );
    const action = scenario.actions.find(
      (row: { id: string }) => row.id === (control === "old-revision" ? "noop" : "read-update"),
    );
    if (control === "old-revision") action.input.bodyBindings.expectedRevision = "a-rev";
    else
      action.assertions.find((row: { id: string }) => row.id === "postimage").equalsBinding =
        "a-record";
    const report = await run(manifest, [scenario.id]);
    expect(report.result.scenarios[0]?.state).toBe("fail");
    expect(report.observations.length).toBeGreaterThan(2);
  }
}, 30000);

it.each(["anonymous", "unknown"])(
  "rejects %s credentials and proves the refused create did not execute",
  async (credentialRef) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const scenario = manifest.scenarios.find(
      (row: { id: string }) => row.id === "read-update.singleton.create-bead",
    );
    const create = scenario.actions.find((row: { id: string }) => row.id === "create");
    const refused = structuredClone(create);
    refused.id = "refused";
    refused.input.credentialRef = credentialRef;
    refused.captures = [];
    refused.assertions = [
      { id: "unauthorized", kind: "json-pointer", pointer: "/status", exists: true, equals: 401 },
    ];
    scenario.actions.splice(scenario.actions.indexOf(create), 0, refused);
    // The identical authorized create subsequently succeeds, then real GETs
    // verify its result. A wrongly executed denied create would be identity-taken.
    const report = await run(manifest, [scenario.id]);
    expect(report.result.scenarios[0], JSON.stringify(report.result.scenarios[0])).toMatchObject({
      state: "pass",
    });
  },
  30000,
);

it("rejects mismatched observed configuration identity before any matrix request", async () => {
  await expect(run(undefined, undefined, true)).rejects.toThrow("configuration");
});

it("rejects response-only no-op revision corruption after actual HTTP", async () => {
  const report = await run(undefined, ["read-update.singleton.update-bead"], false, true);
  expect(report.result.scenarios[0]?.state).toBe("fail");
  const noop = report.result.scenarios[0]?.actions?.find((row) => row.action.id === "noop");
  expect(noop?.assertions.filter((row) => !row.passed).map((row) => row.id)).toEqual([
    "retained-postimage",
  ]);
  expect(JSON.stringify(report.observations)).not.toContain("incorrect-noop-response-revision");
}, 30000);

it.each([
  ["read.types.descriptor", "task", "identity", "types/not-task"],
  ["read.discovery.canonical-navigation", "discovery", "beads-navigation", "links/"],
  ["read.collections.invalid-query", "unsupported-parameter", "status", 200],
] as const)(
  "rejects a wrong inherited Read expectation for %s",
  async (id, actionId, assertionId, expected) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const scenario = manifest.scenarios.find((row: { id: string }) => row.id === id);
    const action = scenario.actions.find((row: { id: string }) => row.id === actionId);
    action.assertions.find((row: { id: string }) => row.id === assertionId).equals = expected;
    const report = await run(manifest, ["read.discovery.scope-service-desc", id]);
    const observed = report.result.scenarios.find((row) => row.id === id);
    expect(observed?.state).toBe("fail");
    const exchange = observed?.exchanges.find((row) => row.request.id === actionId);
    expect(exchange?.assertions.filter((row) => !row.passed).map((row) => row.id)).toEqual([
      assertionId,
    ]);
  },
  30000,
);

it("rejects a missing seed Resource through actual public setup", async () => {
  const fixture = JSON.parse(
    source("packages/conformance/fixtures/read-update-reference-v1.json").bytes.toString(),
  );
  fixture.readSeed.beads.pop();
  const report = await run(undefined, ["read.resource.link-record"], false, false, fixture);
  expect(report.result.scenarios[0]?.state).toBe("harness-error");
  expect(report.setupObservations.length).toBeGreaterThan(0);
});

it.each(["properties", "collection", "condition"] as const)(
  "detects incorrect independent Read %s expectations",
  async (kind) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const id =
      kind === "properties"
        ? "read.resource.properties-view"
        : kind === "collection"
          ? "read.collections.beads"
          : "read.http.conditional-reads";
    const scenario = manifest.scenarios.find((row: { id: string }) => row.id === id);
    const action = scenario.actions.find(
      (row: { id: string }) =>
        row.id ===
        (kind === "properties"
          ? "bead-properties"
          : kind === "collection"
            ? "beads"
            : "strong-none"),
    );
    const assertion = action.assertions.find(
      (row: { id: string }) =>
        row.id ===
        (kind === "properties"
          ? "fixture-bead-properties"
          : kind === "collection"
            ? "fixture-bead-records"
            : "status"),
    );
    delete assertion.fixturePointer;
    if (kind === "properties") assertion.value = { incorrect: true };
    else if (kind === "collection") assertion.equals = [["incorrect", "incorrect", {}, {}]];
    else assertion.equals = 200;
    const report = await run(manifest, ["read.discovery.scope-service-desc", id]);
    const observed = report.result.scenarios.find((row) => row.id === id);
    expect(observed?.state).toBe("fail");
    expect(
      observed?.exchanges
        .find((row) => row.request.id === action.id)
        ?.assertions.filter((row) => !row.passed)
        .map((row) => row.id),
    ).toEqual([assertion.id]);
  },
);

it.each([
  [
    "patch-array",
    "read-update.singleton.document-patch-merge-replace",
    "merge-replace",
    "properties",
  ],
  [
    "noop-provenance",
    "read-update.singleton.document-patch-atomicity",
    "combined-noop",
    "retained-envelope",
  ],
  ["link-pin", "read-update.singleton.create-link", "create-local-pin", "source"],
  ["deleted-revision", "read-update.singleton.delete-link", "delete-link", "final-revision"],
  ["alias-target", "read-update.alias.put-repoints", "repoint-alias", "alias-result"],
  ["resource-header", "read-update.singleton.result-headers", "update-bead", "no-etag"],
  ["alias-header", "read-update.singleton.result-headers", "put-alias", "no-location"],
  ["closed-body", "read-update.singleton.document-patch-atomicity", "create-a", "body-schema"],
] as const)(
  "detects W1 %s response corruption after actual HTTP",
  async (control, id, actionId, assertionId) => {
    const report = await run(undefined, [id], false, false, undefined, control);
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe("fail");
    const action = row?.actions?.find((action) => action.action.id === actionId);
    expect(
      action?.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
    ).toEqual([assertionId]);
  },
  30000,
);

it.each([
  [
    "stale-link",
    "read-update.singleton.owned-link-source-revision",
    "stale-link-properties",
    ["revision-mismatch"],
  ],
  [
    "owned-plane",
    "read-update.singleton.owned-link-source-revision",
    "owner-after-deleted",
    ["empty-owned-plane"],
  ],
  [
    "unowned-source-only",
    "read-update.singleton.owned-link-source-revision",
    "unowned-create",
    ["body-schema", "no-source"],
  ],
  [
    "source-revision",
    "read-update.singleton.owned-link-source-revision",
    "owner-after-created",
    ["source-revision"],
  ],
  [
    "owner-inline-link",
    "read-update.singleton.owned-link-source-revision",
    "owner-after-metadata",
    ["current-owned-link"],
  ],
  [
    "link-noop-provenance",
    "read-update.singleton.owned-link-no-op",
    "owned-noop",
    ["retained-link-envelope"],
  ],
  [
    "owner-noop-provenance",
    "read-update.singleton.owned-link-no-op",
    "owner-after-noop",
    ["retained-owner", "actor"],
  ],
  [
    "noop-source-revision",
    "read-update.singleton.owned-link-no-op",
    "owned-noop",
    ["retained-source-revision"],
  ],
  ["link-metadata", "read-update.singleton.update-link", "owned-metadata", ["metadata"]],
  [
    "unowned-source-pair",
    "read-update.singleton.owned-link-source-revision",
    "unowned-create",
    ["no-source", "no-source-revision"],
  ],
  [
    "target-postimage",
    "read-update.singleton.owned-link-source-revision",
    "target-after-created",
    ["target-unchanged"],
  ],
] as const)(
  "detects W1b %s assertion-input corruption after actual HTTP",
  async (control, id, actionId, assertionIds) => {
    const report = await run(undefined, [id], false, false, undefined, undefined, control);
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe("fail");
    const action = row?.actions?.find((action) => action.action.id === actionId);
    expect(
      action?.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
    ).toEqual(assertionIds);
  },
  30000,
);

it.each([
  ["alias-revision", "put-alias", ["body-schema", "alias-result"]],
  ["target-revision", "put-alias-a", ["postimage"]],
] as const)(
  "detects row-local alias %s corruption after actual HTTP",
  async (control, actionId, failed) => {
    const report = await run(
      undefined,
      ["read-update.alias.no-version-minted"],
      false,
      false,
      undefined,
      control,
    );
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find(
      (row) => row.id === "read-update.alias.no-version-minted",
    );
    expect(row?.state).toBe("fail");
    expect(
      row?.actions
        ?.find((action) => action.action.id === actionId)
        ?.assertions.filter((assertion) => !assertion.passed)
        .map((assertion) => assertion.id),
    ).toEqual(failed);
  },
  30000,
);

it("does not admit an unused fixture binding as a fixed client GET route", async () => {
  const fixture = JSON.parse(
    source("packages/conformance/fixtures/read-update-reference-v1.json").bytes.toString(),
  );
  fixture.bindings["unused.client-target"] = "links/never-requested";
  const report = await run(undefined, ["read-update.singleton.create-bead"], false, false, fixture);
  expect(
    report.result.scenarios.find((row) => row.id === "read-update.singleton.create-bead")?.state,
  ).toBe("pass");
  expect(report.reportBinding.exactConfigurationDigest).toBe(
    "f04e98d80971e813b73d1b57d225c0a6bfb0669647d6bbf9b026a908bbf37f26",
  );
}, 30000);
