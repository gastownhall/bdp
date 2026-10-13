import { execFileSync, type ChildProcess } from "node:child_process";
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
import { withSchemaCohort } from "../test-support/installed-schema-cohort.js";
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
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<unknown> }>;
};
async function closeInstalledChild(
  child: Awaited<ReturnType<typeof helpers.launchInstalledReference>>,
) {
  await child.close();
  // A settled exit alone is insufficient: the helper also observes forced SIGKILL exits.
  expect(child.child.exitCode === 0 || child.child.signalCode === "SIGTERM").toBe(true);
}
const token = "cumulative_fixture_operator_0123456789";
const wrongToken = "cumulative_unknown_operator_0123456789";
const scope = "https://reference.invalid/acme/";
const source = (relative: string) => ({ bytes: readFileSync(path.join(root, relative)) });
const defaultEntry = path.join(root, "packages/server/dist/installed-reference-process.js");
const entry = process.env.BDP_CUMULATIVE_INSTALLED_ENTRY ?? defaultEntry;
const configModule = (await import(
  pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
)) as {
  referenceTypeArtifacts(scope: string): import("@bdp/protocol").TypeDescriptor[];
  captureInstalledReferenceConfiguration(input: unknown): {
    identity: string;
    artifactIdentity: string;
    policyIdentity: string;
    authenticationIdentity: string;
    profile: "read-update";
    history: false;
  };
};
function cohortConfiguration(directory: string, port: number, token: string, scope: string) {
  return withSchemaCohort(
    helpers.referenceConfiguration(directory, port, token, scope),
    configModule.referenceTypeArtifacts(scope),
  );
}
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
  | "retained-noop-link"
  | "stale-unowned-link"
  | "stale-link"
  | "owned-plane"
  | "unowned-source-only";
type W2Counterfactual =
  | "index"
  | "missing-name"
  | "extra-name"
  | "wrong-name"
  | "problem"
  | "swap"
  | "binding-id"
  | "dependent-success"
  | "retained-failure"
  | "tail-state"
  | "prefix-present"
  | "corrected-conflict"
  | "link-name"
  | "alias-index";
type PatchControl =
  | "schema-document"
  | "schema-contract-code"
  | "schema-type"
  | "schema-keyword"
  | "schema-pointer"
  | "schema-afterstate"
  | "schema-metadata"
  | "schema-open"
  | "link-order"
  | "link-clear"
  | "link-result"
  | "link-get"
  | "refusal-get"
  | "diagnostic-document"
  | "diagnostic-type"
  | "problem-tuple";
type RetryControl = {
  scenario: string;
  action: string;
  path: readonly string[];
  value?: unknown;
  binding?: string;
};
async function run(
  manifestValue?: unknown,
  selectedIds?: string[],
  mismatchedPolicy = false,
  corruptNoopResponse = false,
  fixtureValue?: unknown,
  w1Counterfactual?: W1Counterfactual,
  w1bCounterfactual?: W1bCounterfactual,
  w2Counterfactual?: W2Counterfactual,
  signal?: AbortSignal,
  patchControl?: PatchControl,
  retryControl?: RetryControl,
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
    // Harness capacity exceeds installed65536 only to observe its actual body-size refusal.
    maximumRequestBodyBytes: 131072,
    maximumRequestHeaderBytes: 16384,
    routes: [
      ...clientReadRoutes,
      ...readRoutes,
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
  const bootstrapConfig = cohortConfiguration(
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
      await closeInstalledChild(bootstrap);
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
  let sequenceCalls = 0;
  let retryClientIndex = 0;
  let lastPatchKey = "";
  const target = createRawHttpScenarioTarget(
    async (scenario, _scope, _seed, fixture, signal) => {
      currentScenario = scenario.id;
      sequenceCalls = 0;
      retryClientIndex = 0;
      lastPatchKey = "";
      const configuration = cohortConfiguration(
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
            await closeInstalledChild(child);
          },
        };
      } catch (error) {
        await closeInstalledChild(child);
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
      ...(signal === undefined ? {} : { signal }),
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
        const clientAction = bundle.manifest.scenarios
          .find((row) => row.id === currentScenario)
          ?.actions?.filter((action) => action.family === "client")[retryClientIndex++];
        if (
          retryControl?.scenario === currentScenario &&
          retryControl.action === clientAction?.id
        ) {
          // Corrupt assertion input only, after the real wire observation was recorded.
          const changed = structuredClone(actual) as Record<string, unknown>;
          let parent = changed;
          for (const key of retryControl.path.slice(0, -1)) {
            const child = parent[key];
            if (child === null || typeof child !== "object") throw Error("missing control path");
            parent = child as Record<string, unknown>;
          }
          const key = retryControl.path.at(-1);
          if (key === undefined) throw Error("missing control field");
          parent[key] = structuredClone(
            retryControl.binding === undefined
              ? retryControl.value
              : execution.bindings[retryControl.binding],
          );
          counterfactualApplications++;
          return changed;
        }
        const w1Input = execution.input as {
          method?: string;
          targetBinding?: string;
          idempotencyKey?: string;
        };
        if (w1Input.method === "POST") lastPatchKey = w1Input.idempotencyKey ?? "";
        const patchMerge = currentScenario === "read-update.singleton.document-patch-merge-replace";
        const patchValidation =
          currentScenario === "read-update.singleton.document-patch-validation";
        const patchHit =
          (currentScenario === "read-update.validation.type-contract" &&
            patchControl === "schema-contract-code" &&
            w1Input.idempotencyKey === "schema-contract-bead-uninstalled") ||
          (currentScenario === "read-update.validation.diagnostics" &&
            ["schema-type", "schema-keyword", "schema-pointer", "schema-document"].includes(
              patchControl ?? "",
            ) &&
            w1Input.idempotencyKey === "schema-diagnostics-bead-base") ||
          (patchValidation &&
            patchControl === "schema-afterstate" &&
            w1Input.method === "GET" &&
            lastPatchKey === "schema-validation-link-base") ||
          (patchValidation &&
            patchControl === "schema-metadata" &&
            w1Input.idempotencyKey === "schema-validation-link-metadata") ||
          (patchValidation &&
            patchControl === "schema-open" &&
            w1Input.idempotencyKey === "schema-validation-bead-combined") ||
          (patchMerge &&
            patchControl === "link-order" &&
            w1Input.idempotencyKey === "link-merge-replace") ||
          (patchMerge &&
            patchControl === "link-clear" &&
            w1Input.idempotencyKey === "link-clear-properties") ||
          (patchMerge &&
            patchControl === "link-result" &&
            w1Input.idempotencyKey === "link-merge-replace") ||
          (patchMerge &&
            patchControl === "link-get" &&
            w1Input.method === "GET" &&
            lastPatchKey === "link-merge-replace") ||
          (patchValidation &&
            patchControl === "refusal-get" &&
            w1Input.method === "GET" &&
            lastPatchKey === "bead-metadata-array") ||
          (patchValidation &&
            ["diagnostic-document", "diagnostic-type", "problem-tuple"].includes(
              patchControl ?? "",
            ) &&
            w1Input.idempotencyKey === "bead-metadata-array");
        if (patchControl && patchHit && counterfactualApplications === 0) {
          // Actual serializer observation was captured above; alter only the assertion input.
          const changed = structuredClone(actual) as {
            status: number;
            body: {
              code?: string;
              resource: { properties: Record<string, unknown>; metadata: Record<string, unknown> };
              properties: Record<string, unknown>;
              diagnostics: Record<string, unknown>[];
            };
          };
          counterfactualApplications++;
          if (patchControl === "schema-contract-code")
            Object.assign(changed.body, {
              code: "validation-failed",
              retry: "never",
              diagnostics: [{ message: "counterfactual validation refusal" }],
            });
          if (patchControl === "schema-document") {
            const diagnostic = changed.body.diagnostics[0];
            if (!diagnostic) throw new Error("schema counterfactual requires a diagnostic");
            diagnostic.document = "metadata";
          }
          if (patchControl === "schema-type")
            changed.body.diagnostics[0]!.type = `${scope}types/schema-bead-child`;
          if (patchControl === "schema-keyword")
            changed.body.diagnostics[0]!.schemaLocation = `${scope}schemas/schema-bead-base#/type`;
          if (patchControl === "schema-pointer")
            changed.body.diagnostics[0]!.instanceLocation = "/propertiesChange/0/value";
          if (patchControl === "schema-afterstate") changed.body.properties.n = 9;
          if (patchControl === "schema-metadata") changed.body.resource.metadata.n = 999;
          if (patchControl === "schema-open")
            changed.body.resource.properties.opaque = { untouched: false };
          if (patchControl === "link-order") changed.body.resource.properties.ordered = "first";
          if (patchControl === "link-clear") changed.body.resource.properties.resurrected = true;
          if (patchControl === "link-result") changed.body.resource.properties.keep = "corrupt";
          if (patchControl === "link-get") changed.body.properties.keep = "corrupt";
          if (patchControl === "refusal-get") changed.body.properties.n = 9;
          if (patchControl === "diagnostic-document")
            changed.body.diagnostics[0]!.document = "properties";
          if (patchControl === "diagnostic-type")
            Object.assign(changed.body.diagnostics[0]!, {
              type: `${scope}types/task`,
              schemaLocation: `${scope}schemas/artificial#/type`,
            });
          if (patchControl === "problem-tuple")
            return {
              ...changed,
              status: 404,
              body: {
                type: "https://github.com/gastownhall/bdp/problems/not-found",
                code: "resource-not-found",
                status: 404,
                retry: "after-state-change",
              },
            };
          return changed;
        }
        if (w1Input.method === "POST" && w1Input.targetBinding === "sequence") sequenceCalls++;
        const memberControl = [
          "index",
          "missing-name",
          "extra-name",
          "wrong-name",
          "problem",
          "swap",
          "link-name",
          "alias-index",
        ].includes(w2Counterfactual ?? "");
        const w2SequenceControl =
          w1Input.method === "POST" &&
          w1Input.targetBinding === "sequence" &&
          ((memberControl && currentScenario === "read-update.sequence.member-problem-shape") ||
            (currentScenario === "read-update.sequence.local-bindings" &&
              ((w2Counterfactual === "binding-id" && sequenceCalls === 1) ||
                (w2Counterfactual === "dependent-success" && sequenceCalls === 2) ||
                (w2Counterfactual === "retained-failure" && sequenceCalls === 3))) ||
            (currentScenario === "read-update.sequence.carrier-rejection" &&
              w2Counterfactual === "corrected-conflict" &&
              sequenceCalls === 1));
        const w2ReadControl =
          w1Input.method === "GET" &&
          ((currentScenario === "read-update.sequence.local-bindings" &&
            w2Counterfactual === "tail-state" &&
            w1Input.targetBinding === "w2.beads.w2-independent") ||
            (currentScenario === "read-update.sequence.carrier-rejection" &&
              w2Counterfactual === "prefix-present" &&
              w1Input.targetBinding === "w2.beads.w2-count-0"));
        if (
          w2Counterfactual &&
          counterfactualApplications === 0 &&
          (w2SequenceControl || w2ReadControl)
        ) {
          // Sensitivity control after exact HTTP capture; the authority is untouched.
          const changed = structuredClone(actual) as {
            status: number;
            body: {
              results: (Record<string, unknown> & { resource?: { id: string } })[];
              properties: Record<string, unknown>;
            };
          };
          counterfactualApplications++;
          const results = changed.body.results;
          if (w2Counterfactual === "link-name") delete results[4]!.operationName;
          if (w2Counterfactual === "alias-index") results[5]!.operationIndex = 4;
          if (w2Counterfactual === "index") results[1]!.operationIndex = 9;
          if (w2Counterfactual === "missing-name") delete results[1]!.operationName;
          if (w2Counterfactual === "extra-name") results[2]!.operationName = "invented";
          if (w2Counterfactual === "wrong-name") results[0]!.operationName = "wrong";
          if (w2Counterfactual === "problem")
            Object.assign(results[1]!, {
              status: 404,
              type: "https://github.com/gastownhall/bdp/problems/not-found",
              code: "resource-not-found",
              retry: "after-state-change",
            });
          if (w2Counterfactual === "swap") [results[0], results[3]] = [results[3]!, results[0]!];
          if (w2Counterfactual === "binding-id")
            results[1]!.resource!.id = `${scope}beads/wrong-dependent`;
          if (w2Counterfactual === "dependent-success")
            results[1] = {
              operationIndex: 1,
              outcome: "created",
              resource: structuredClone(results[2]!.resource!),
            };
          if (w2Counterfactual === "retained-failure")
            results[1]!.detail = "not-the-retained-detail";
          if (w2Counterfactual === "tail-state") changed.body.properties.n = 999;
          if (w2Counterfactual === "prefix-present") changed.status = 200;
          if (w2Counterfactual === "corrected-conflict")
            results[0] = {
              operationIndex: 0,
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              code: "idempotency-conflict",
              status: 409,
              retry: "never",
            };
          return changed;
        }
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
          "retained-noop-link": "matching-link-noop",
          "stale-unowned-link": "stale-link-unowned-update",
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
          if (w1bCounterfactual === "stale-link" || w1bCounterfactual === "stale-unowned-link")
            body.code = "alias-path-taken";
          if (w1bCounterfactual === "retained-noop-link")
            (body.resource as { revision: string }).revision = "freshly-minted-on-noop";
          if (w1bCounterfactual === "unowned-source-only")
            body.source = `${scope}beads/w1b-unowned-source`;
          if (w1bCounterfactual === "owned-plane") {
            const plane = (body.ownedLinks as Record<string, unknown[]> | undefined)?.[
              `${scope}types/relates`
            ];
            if (!plane) throw Error("actual owner owned-Link plane missing");
            plane.push(structuredClone(execution.bindings["link-metadata"]));
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
  // One aggregate job starts 45 isolated authorities; Linux CI previously exceeded 30s.
  // Abort cooperatively before the outer ceiling so existing finally blocks close stores.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Error("cumulative run budget exceeded")), 90000);
  let report: Awaited<ReturnType<typeof run>>;
  try {
    report = await run(
      undefined,
      undefined,
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  controller.signal.throwIfAborted();
  if (process.env.BDP_CUMULATIVE_REPORT_PATH)
    writeFileSync(process.env.BDP_CUMULATIVE_REPORT_PATH, JSON.stringify(report, null, 2));
  for (const row of report.result.scenarios)
    expect(row, JSON.stringify(row)).toMatchObject({
      state: !report.plannedIds.includes(row.id) ? "harness-error" : "pass",
    });
  const carrierId = "read-update.sequence.carrier-rejection";
  const authored = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  ) as {
    scenarios: {
      id: string;
      actions: {
        id: string;
        family: string;
        raw?: { body?: { encoding: "utf8" | "base64"; value: string } };
        input?: { body?: unknown };
      }[];
    }[];
  };
  const carrier = authored.scenarios.find((row) => row.id === carrierId)!;
  const observed = report.result.scenarios.find((row) => row.id === carrierId)!;
  for (const action of carrier.actions.filter(
    (action) => action.family === "http" && action.raw?.body,
  )) {
    expect(
      observed.exchanges.find((exchange) => exchange.request.id === action.id)?.request.exact
        ?.bodyOctets,
    ).toBe(Buffer.from(action.raw!.body!.value, action.raw!.body!.encoding).byteLength);
  }
  // The elevated harness budget is consumed only by the explicit body-size probe.
  const bodyLimit = 65536;
  for (const row of authored.scenarios)
    for (const action of row.actions) {
      if (action.raw?.body && !(row.id === carrierId && action.id === "body-size"))
        expect(
          Buffer.from(action.raw.body.value, action.raw.body.encoding).byteLength,
          `${row.id}/${action.id}`,
        ).toBeLessThanOrEqual(bodyLimit);
      if (action.input?.body !== undefined)
        expect(
          Buffer.byteLength(JSON.stringify(action.input.body)),
          `${row.id}/${action.id}`,
        ).toBeLessThanOrEqual(bodyLimit);
    }
  // Actual serialized client bodies include values substituted from earlier captures.
  for (const item of report.observations as {
    observation: { observation: { bodyOctets: number } };
  }[])
    expect(item.observation.observation.bodyOctets).toBeLessThanOrEqual(bodyLimit);
  const countBody = carrier.actions.find((action) => action.id === "count-33")!.raw!.body!.value;
  const countMembers = JSON.parse(countBody).operations as { idempotencyKey: string }[];
  expect(countMembers).toHaveLength(33);
  expect(new Set(countMembers.map((member) => member.idempotencyKey)).size).toBe(33);
  expect(Buffer.byteLength(countBody)).toBeLessThan(65536);
  expect(
    Buffer.byteLength(
      carrier.actions.find((action) => action.id === "body-size")!.raw!.body!.value,
    ),
  ).toBeGreaterThan(65536);
  // Supplementary actual observation bounds; the diagnostics row remains partial.
  const diagnosticObservations = (
    report.observations as {
      scenario: string;
      observation: {
        request: { targetBinding: string };
        body?: {
          limits?: { validation: { diagnostics: number; diagnosticBytes: number } };
          diagnostics?: unknown[];
        };
      };
    }[]
  ).filter((item) => item.scenario === "read-update.validation.diagnostics");
  const observedLimits = diagnosticObservations.find(
    (item) => item.observation.request.targetBinding === "service-desc",
  )?.observation.body?.limits?.validation;
  expect(observedLimits).toMatchObject({ diagnostics: 32, diagnosticBytes: 524288 });
  const lists = diagnosticObservations.flatMap((item) =>
    item.observation.body?.diagnostics ? [item.observation.body.diagnostics] : [],
  );
  expect(lists).toHaveLength(4);
  for (const list of lists) {
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(observedLimits!.diagnostics);
    expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThanOrEqual(
      observedLimits!.diagnosticBytes,
    );
  }
  expect(report.result.claimEligible).toBe(false);
  expect(report.plannedManifestDigest).toBe(report.reportBinding.artifacts.manifestDigest);
  // Pin the existing runner projection; credential identity is bound separately in configuration.
  expect(report.reportBinding.exactConfigurationDigest).toBe(
    "092b9ac9abf64dcd02f592059bc6333b0a6dfc69efe9d50332086335474c8f3c",
  );
  expect(report.uncoveredIds).toHaveLength(103);
  expect(report.uncoveredIds).toContain("read-update.singleton.update-bead");
  expect(report.sessions).toHaveLength(report.plannedIds.length);
  expect(report.observations.length).toBeGreaterThan(30);
  expect(JSON.stringify(report)).not.toContain(token);
  expect(JSON.stringify(report)).not.toContain(wrongToken);
}, 120000);

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
    "retained-noop-link",
    "read-update.singleton.owned-link-no-op",
    "matching-link-noop",
    ["retained-link"],
  ],
  [
    "stale-unowned-link",
    "read-update.singleton.update-link",
    "stale-link-unowned-update",
    ["revision-mismatch"],
  ],
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
    "092b9ac9abf64dcd02f592059bc6333b0a6dfc69efe9d50332086335474c8f3c",
  );
}, 30000);

it.each([
  ["link-name", "member-problem-shape", "member-shapes", ["name-4"]],
  ["alias-index", "member-problem-shape", "member-shapes", ["indices", "index-5", "alias-result"]],
  ["index", "member-problem-shape", "member-shapes", ["indices", "index-1"]],
  ["missing-name", "member-problem-shape", "member-shapes", ["name-1"]],
  ["extra-name", "member-problem-shape", "member-shapes", ["name-2"]],
  ["wrong-name", "member-problem-shape", "member-shapes", ["name-0"]],
  ["problem", "member-problem-shape", "member-shapes", ["1-code", "1-status", "1-type", "1-retry"]],
  [
    "swap",
    "member-problem-shape",
    "member-shapes",
    ["indices", "index-0", "name-0", "index-3", "name-3"],
  ],
  ["binding-id", "local-bindings", "allocated-read", ["dependent-identity", "postimage"]],
  [
    "dependent-success",
    "local-bindings",
    "failed-bindings",
    ["1-code", "1-status", "1-type", "1-retry", "1-no-outcome"],
  ],
  ["retained-failure", "local-bindings", "retained-bindings", ["retained-results"]],
  ["tail-state", "local-bindings", "independent-read", ["properties", "postimage"]],
  ["prefix-present", "carrier-rejection", "count-absent-0", ["status"]],
  ["corrected-conflict", "carrier-rejection", "count-32", ["created-0"]],
] as const)(
  "detects W2 %s after real sequence HTTP",
  async (control, suffix, actionId, expected) => {
    const id = `read-update.sequence.${suffix}`;
    const report = await run(
      undefined,
      [id],
      false,
      false,
      undefined,
      undefined,
      undefined,
      control,
    );
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe("fail");
    expect(
      row?.actions
        ?.find((action) => action.action.id === actionId)
        ?.assertions.filter((assertion) => !assertion.passed)
        .map((assertion) => assertion.id),
    ).toEqual(expected);
  },
  30000,
);

it.each(["wrong-status", "wrong-code", "below-count-boundary", "base64"])(
  "checks W2 raw carrier %s refusal sensitivity or encoding equivalence",
  async (control) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const id = "read-update.sequence.carrier-rejection";
    const scenario = manifest.scenarios.find((row: { id: string }) => row.id === id);
    const action = scenario.actions.find((row: { id: string }) => row.id === "count-33");
    if (control === "base64") {
      action.raw.body.value = Buffer.from(action.raw.body.value).toString("base64");
      action.raw.body.encoding = "base64";
    } else if (control === "below-count-boundary") {
      const body = JSON.parse(action.raw.body.value);
      body.operations.pop();
      action.raw.body.value = JSON.stringify(body);
    } else
      action.assertions.find(
        (assertion: { id: string }) =>
          assertion.id === (control === "wrong-status" ? "status" : "code"),
      ).equals = control === "wrong-status" ? 400 : "request-too-large";
    const report = await run(manifest, [id]);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe(control === "base64" ? "pass" : "fail");
    const exchange = row?.exchanges.find((exchange) => exchange.request.id === "count-33");
    const failures = exchange?.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => assertion.id);
    if (control === "below-count-boundary") {
      expect(exchange?.response?.status).toBe(200);
      expect(failures).toContain("status");
    } else
      expect(failures).toEqual(
        control === "base64" ? [] : [control === "wrong-status" ? "status" : "code"],
      );
    expect(exchange?.request.exact?.bodyOctets).toBe(
      Buffer.from(action.raw.body.value, action.raw.body.encoding).byteLength,
    );
  },
  30000,
);

it("leaves singleton missing-key refusal to the actual authority after optional header omission", async () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const id = "read-update.singleton.create-bead";
  const scenario = manifest.scenarios.find((row: { id: string }) => row.id === id);
  const original = scenario.actions.find((row: { id: string }) => row.id === "create");
  const refused = structuredClone(original);
  refused.id = "missing-key";
  delete refused.input.idempotencyKey;
  refused.captures = [];
  refused.assertions = [
    { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 400 },
    {
      id: "problem",
      kind: "json-pointer",
      pointer: "/body/code",
      exists: true,
      equals: "malformed-request",
    },
    { id: "schema", kind: "json-schema", schema: "#/$defs/harnessInstalled_readUpdateProblem" },
  ];
  scenario.actions.splice(scenario.actions.indexOf(original), 0, refused);
  const report = await run(manifest, [id]);
  expect(report.result.scenarios.find((row) => row.id === id)?.state).toBe("pass");
}, 30000);

it("detects a mismatched advertised request body bound in the actual carrier discovery", async () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const id = "read-update.sequence.carrier-rejection";
  const row = manifest.scenarios.find((row: { id: string }) => row.id === id);
  row.actions
    .find((action: { id: string }) => action.id === "discovery")
    .assertions.find(
      (assertion: { id: string }) => assertion.id === "target-body-limit",
    ).equals = 65537;
  const report = await run(manifest, [id]);
  const result = report.result.scenarios.find((row) => row.id === id);
  expect(result?.state).toBe("fail");
  expect(
    result?.exchanges
      .find((exchange) => exchange.request.id === "discovery")
      ?.assertions.filter((assertion) => !assertion.passed)
      .map((assertion) => assertion.id),
  ).toEqual(["target-body-limit"]);
}, 30000);

it("stops the aggregate runner on cancellation without awarding a scenario pass", async () => {
  const id = "read-update.singleton.create-bead";
  const report = await run(
    undefined,
    [id],
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    AbortSignal.abort(Error("test aggregate cancellation")),
  );
  expect(report.sessions).toHaveLength(0);
  expect(report.observations).toHaveLength(0);
  expect(report.result.scenarios).toHaveLength(1);
  expect(report.result.scenarios[0]).toMatchObject({
    state: "harness-error",
    category: "not-run",
    reason: "matrix stopped before this scenario could run",
  });
  expect(report.result.claimEligible).toBe(false);
}, 30000);

it.each([
  ["link-order", "merge-replace", "link-merge-replace", ["properties"]],
  ["link-clear", "merge-replace", "link-clear-properties", ["properties"]],
  ["link-result", "merge-replace", "link-merge-replace", ["properties"]],
  ["link-get", "merge-replace", "link-read-patched", ["postimage"]],
  ["refusal-get", "validation", "after-bead-metadata-array", ["unchanged"]],
  ["diagnostic-document", "validation", "bead-metadata-array", ["document"]],
  [
    "diagnostic-type",
    "validation",
    "bead-metadata-array",
    ["diagnostic-type", "diagnostic-schema"],
  ],
  [
    "problem-tuple",
    "validation",
    "bead-metadata-array",
    ["status", "problem", "problem-status", "problem-type", "retry", "document-root", "document"],
  ],
] as const)(
  "detects document patch %s after actual HTTP",
  async (control, suffix, actionId, failures) => {
    const id = `read-update.singleton.document-patch-${suffix}`;
    const report = await run(
      undefined,
      [id],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      control,
    );
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe("fail");
    expect(
      row?.actions
        ?.find((action) => action.action.id === actionId)
        ?.assertions.filter((assertion) => !assertion.passed)
        .map((assertion) => assertion.id),
    ).toEqual(failures);
  },
  30000,
);

it.each([
  { exitCode: null, signalCode: null },
  { exitCode: null, signalCode: "SIGKILL" },
  { exitCode: 1, signalCode: null },
] as const)("rejects settled but unsuccessful installed child exit %j", async (exit) => {
  // Assertion sensitivity only; actual installed children are closed by each HTTP run.
  await expect(
    closeInstalledChild({
      child: exit as ChildProcess,
      ready: {},
      close: async () => undefined,
    }),
  ).rejects.toThrow();
});

it.each([
  [
    "schema-document",
    "read-update.validation.diagnostics",
    "schema-diagnostics-bead-base",
    "document",
  ],
  [
    "schema-contract-code",
    "read-update.validation.type-contract",
    "schema-contract-bead-uninstalled",
    "problem-code",
  ],
  [
    "schema-type",
    "read-update.validation.diagnostics",
    "schema-diagnostics-bead-base",
    "diagnostic-type",
  ],
  [
    "schema-keyword",
    "read-update.validation.diagnostics",
    "schema-diagnostics-bead-base",
    "keyword",
  ],
  [
    "schema-pointer",
    "read-update.validation.diagnostics",
    "schema-diagnostics-bead-base",
    "instance",
  ],
  [
    "schema-afterstate",
    "read-update.singleton.document-patch-validation",
    "after-schema-validation-link-base",
    "properties",
  ],
  [
    "schema-metadata",
    "read-update.singleton.document-patch-validation",
    "schema-validation-link-metadata",
    "metadata",
  ],
  [
    "schema-open",
    "read-update.singleton.document-patch-validation",
    "schema-validation-bead-combined",
    "properties",
  ],
] as const)(
  "detects effective schema %s assertion-input corruption after actual HTTP",
  async (control, id, action, assertion) => {
    const report = await run(
      undefined,
      [id],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      control,
    );
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === id);
    expect(row?.state).toBe("fail");
    const failures = row?.actions
      ?.find((a) => a.action.id === action)
      ?.assertions.filter((a) => !a.passed)
      .map((a) => a.id);
    expect(failures).toEqual(
      control === "schema-afterstate" ? ["postimage", "properties"] : [assertion],
    );
  },
  30000,
);

const retryRows = [
  "read-update.sequence.idempotent-retry",
  "read-update.idempotency.cross-carrier",
];
it("observes retained retry dispositions across actual installed carriers and current positions", async () => {
  const report = await run(undefined, retryRows);
  if (process.env.BDP_RETRY_REPORT_PATH)
    writeFileSync(process.env.BDP_RETRY_REPORT_PATH, JSON.stringify(report, null, 2));
  for (const id of retryRows)
    expect(
      report.result.scenarios.find((row) => row.id === id),
      JSON.stringify(report.result),
    ).toMatchObject({ state: "pass" });
  expect(report.uncoveredIds).toHaveLength(103);
  expect(report.result.claimEligible).toBe(false);
}, 30000);

// Problem title/instance/extensions are legal; these deterministic original failures have none.
// Controls require exact fixture equality, not a narrower protocol Problem schema.
const retryControls: (RetryControl & { label: string; failed: string })[] = [
  {
    label: "initial failure gains title",
    scenario: retryRows[0]!,
    action: "initial",
    path: ["body", "results", "1", "title"],
    value: "new initial title",
    failed: "complete-problem-body-results-1",
  },
  {
    label: "retained failure gains title",
    scenario: retryRows[1]!,
    action: "f-replay",
    path: ["body", "results", "0", "title"],
    value: "new title",
    failed: "complete-problem-body-results-0",
  },
  {
    label: "retained failure gains extension",
    scenario: retryRows[1]!,
    action: "f-replay",
    path: ["body", "results", "0", "vendorExtension"],
    value: { changed: true },
    failed: "complete-problem-body-results-0",
  },
  {
    label: "retained failure gains instance",
    scenario: retryRows[1]!,
    action: "g-replay",
    path: ["body", "instance"],
    value: "https://reference.invalid/other",
    failed: "complete-problem-body",
  },
  {
    label: "reordered failure gains extension",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "2", "vendorExtension"],
    value: "new",
    failed: "complete-problem-body-results-2",
  },
  {
    label: "fresh image instead of retained",
    scenario: retryRows[1]!,
    action: "a-replay",
    path: ["body", "results", "0", "resource"],
    binding: "a-live",
    failed: "retained-body-results-0",
  },
  {
    label: "retained revision",
    scenario: retryRows[1]!,
    action: "a-replay",
    path: ["body", "results", "0", "resource", "revision"],
    value: "corrupt-revision",
    failed: "retained-body-results-0",
  },
  {
    label: "old failure executes successfully",
    scenario: retryRows[1]!,
    action: "f-replay",
    path: ["body", "results", "0"],
    value: {
      operationIndex: 0,
      outcome: "updated",
      resource: {
        id: `${scope}beads/retry-cross-f`,
        type: `${scope}types/task`,
        revision: "corrupt-revision",
        properties: { n: 5 },
        metadata: { tag: "retry" },
      },
    },
    failed: "problem-code-body-results-0",
  },
  {
    label: "singleton carries sequence index",
    scenario: retryRows[1]!,
    action: "b-replay",
    path: ["body", "operationIndex"],
    value: 0,
    failed: "schema",
  },
  {
    label: "final GET silently rolled back",
    scenario: retryRows[1]!,
    action: "a-after-replay",
    path: ["body"],
    binding: "a-original",
    failed: "postimage",
  },
  {
    label: "changed record is not a conflict",
    scenario: retryRows[1]!,
    action: "b-conflict",
    path: ["status"],
    value: 200,
    failed: "status",
  },
  {
    label: "conflict overwrites retained image",
    scenario: retryRows[1]!,
    action: "a-final-replay",
    path: ["body", "resource"],
    binding: "a-live",
    failed: "retained-body",
  },
  {
    label: "old sequence index",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "0", "operationIndex"],
    value: 2,
    failed: "indices",
  },
  {
    label: "removed name returns",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "0", "operationName"],
    value: "oldTail",
    failed: "name-0",
  },
  {
    label: "added name lost",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "3", "operationName"],
    value: "wrong",
    failed: "name-3",
  },
  {
    label: "failure gains detail",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "2", "detail"],
    value: "not retained",
    failed: "absent-detail-body-results-2",
  },
  {
    label: "sequence replay refreshes image",
    scenario: retryRows[0]!,
    action: "reordered",
    path: ["body", "results", "0", "resource"],
    binding: "position-b-live",
    failed: "retained-body-results-0",
  },
  {
    label: "sequence GET regresses",
    scenario: retryRows[0]!,
    action: "b-after",
    path: ["body"],
    binding: "position-b-original",
    failed: "postimage",
  },
];
it.each(retryControls)(
  "detects retained-retry $label after actual wire capture",
  async (control) => {
    const report = await run(
      undefined,
      [control.scenario],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      control,
    );
    expect(report.counterfactualApplications).toBe(1);
    const row = report.result.scenarios.find((row) => row.id === control.scenario);
    expect(row?.state).toBe("fail");
    const exchange = row?.actions?.find((action) => action.action.id === control.action);
    expect(
      exchange?.assertions
        .filter((assertion) => !assertion.passed)
        .map((assertion) => assertion.id),
    ).toContain(control.failed);
  },
  30000,
);
