import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createRawHttpScenarioTarget,
  createRawHttpExchangeExecutor,
  createJsonSchemaValidator,
  runConformanceMatrix,
  type ExactHttpModeOptions,
  type RawHttpExchangeExecutor,
} from "@bdp/conformance";
import {
  createCumulativeReadUpdateArtifactBundle,
  loadProfileContractSelection,
  bindServedProfileConfiguration,
  assertSameServedProfileConfiguration,
  planProfileExecution,
  createReadUpdateArtifactSet,
  assertReadUpdateArtifactSet,
  copyReadUpdateArtifactSetSources,
  type ReadUpdateArtifactSet,
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
import {
  artifactRoutes,
  associateArtifactObservations,
  createArtifactEvidenceWriter,
  type ArtifactEvidenceWriter,
  type ArtifactObservation,
} from "../test-support/read-update-artifact-execution.js";
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
  artifact?: {
    set: ReadUpdateArtifactSet;
    shardId: string;
    expected?: Pick<ArtifactObservation, "configuration" | "baselineReceipt">;
  },
  lifecycle?: {
    launched?(child: ChildProcess): void;
    observed?(): void;
    returned?(report: ArtifactObservation): void;
    cleaned?(status: "complete" | "failed"): void;
    // Source-test-only fault after the real target has drained; no fake child close.
    afterClose?(): void;
  },
  numericControl?: "digest" | "changed-number" | "refusal-success",
) {
  signal?.throwIfAborted();
  if (artifact) assertReadUpdateArtifactSet(artifact.set);
  const shard = artifact?.set.shards.find((s) => s.id === artifact.shardId);
  if (artifact && !shard) throw Error("unknown artifact shard");
  if (artifact && (manifestValue !== undefined || fixtureValue !== undefined))
    throw Error("artifact source overrides are not permitted");
  const capturedSources = artifact ? copyReadUpdateArtifactSetSources(artifact.set) : undefined;
  const selection = loadProfileContractSelection("read-update");
  const fixtureSource =
    capturedSources?.fixture ??
    (fixtureValue === undefined
      ? source("packages/conformance/fixtures/read-update-reference-v1.json")
      : { bytes: Buffer.from(JSON.stringify(fixtureValue)) });
  const manifestSource =
    (shard && capturedSources?.manifests[shard.source]) ??
    (manifestValue === undefined
      ? source("packages/conformance/matrices/read-update-v1.json")
      : { bytes: Buffer.from(JSON.stringify(manifestValue)) });
  const bundle =
    shard?.bundle ??
    createCumulativeReadUpdateArtifactBundle(selection, {
      manifest: manifestSource,
      fixture: fixtureSource,
    });
  const coverage = JSON.parse(
    source("packages/conformance/test-support/read-update-coverage-v1.json").bytes.toString(),
  ) as { rows: { id: string; wholeContract: boolean }[] };
  const port = await helpers.availablePort();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-cumulative-ru-"));
  const dialRoute = { transport: "plain" as const, host: "127.0.0.1", port };
  const mode: ExactHttpModeOptions = {
    scope,
    profile: "read-update",
    // Harness capacity exceeds installed65536 only to observe its actual body-size refusal.
    maximumRequestBodyBytes: 131072,
    maximumRequestHeaderBytes: 16384,
    routes: artifactRoutes(bundle, scope),
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
  // All three are assigned by successful bootstrap; failures are rethrown after cleanup.
  let baseline!: ReturnType<typeof bindReceipt>;
  let baselineReceipt!: Record<string, unknown>;
  let executionPlan!: ReturnType<typeof planProfileExecution>;
  let bootstrapCleanupFailed = false;
  try {
    signal?.throwIfAborted();
    const bootstrap = await helpers.launchInstalledReference(entry, bootstrapConfig);
    let bootstrapError: unknown;
    let bootstrapFailed = false;
    try {
      lifecycle?.launched?.(bootstrap.child);
      signal?.throwIfAborted();
      baselineReceipt = bootstrap.ready;
      baseline = bindReceipt(baselineReceipt);
      if (artifact?.expected) {
        assertSameServedProfileConfiguration(artifact.expected.configuration, baseline);
        expect(baselineReceipt.configurationIdentity).toBe(
          artifact.expected.baselineReceipt.configurationIdentity,
        );
      }
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
    } catch (error) {
      bootstrapFailed = true;
      bootstrapError = error;
    }
    try {
      await closeInstalledChild(bootstrap);
    } catch (cleanup) {
      bootstrapCleanupFailed = true;
      if (bootstrapFailed)
        throw new AggregateError(
          [bootstrapError, cleanup],
          "bootstrap execution and cleanup failed",
          { cause: bootstrapError },
        );
      throw cleanup;
    }
    if (bootstrapFailed) throw bootstrapError;
  } catch (error) {
    try {
      rmSync(directory, { recursive: true, force: true });
      lifecycle?.cleaned?.(bootstrapCleanupFailed ? "failed" : "complete");
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "bootstrap failure and evidence cleanup failed", {
        cause: error,
      });
    }
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
      signal.throwIfAborted();
      const child = await helpers.launchInstalledReference(entry, configuration);
      try {
        lifecycle?.launched?.(child.child);
        signal.throwIfAborted();
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
        try {
          await closeInstalledChild(child);
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "scenario execution and cleanup failed", {
            cause: error,
          });
        }
        throw error;
      }
    },
    { exactMode, requestTimeoutMs: 5000 },
  );
  let numericControlRecord: unknown;
  const executeExact: RawHttpExchangeExecutor = async (request) => {
    const key = request.raw?.headerLines.find(
      (h) => h.name.toLowerCase() === "idempotency-key",
    )?.value;
    const hit =
      numericControl &&
      currentScenario === "read-update.numeric-model.same-value-no-op" &&
      key ===
        (numericControl === "refusal-success" ? "num-subject-inadmissible" : "num-subject-decimal");
    let sent = request;
    if (hit && numericControl === "changed-number") {
      if (!request.raw?.bodyBytes) throw Error("numeric control requires authored bytes");
      const original = Buffer.from(request.raw.bodyBytes).toString("utf8");
      expect(original).toContain('"one":1.0');
      sent = {
        ...request,
        raw: { ...request.raw, bodyBytes: Buffer.from(original.replace('"one":1.0', '"one":2.0')) },
      };
    }
    const actual = await target.execute(sent);
    if (!hit) return actual;
    counterfactualApplications++;
    if (numericControl === "digest") {
      if (!actual.exactRequest?.bodyDigest) throw Error("missing actual serializer digest");
      return {
        ...actual,
        exactRequest: {
          ...actual.exactRequest,
          bodyDigest:
            actual.exactRequest.bodyDigest === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
        },
      };
    }
    if (numericControl === "refusal-success") {
      if (!numericControlRecord) throw Error("missing independently observed prior Resource");
      const bodyText = JSON.stringify({ outcome: "updated", resource: numericControlRecord });
      // Assertion-input control after a real refused exchange; not a wire-transparent target.
      return { ...actual, status: 200, bodyText, bodyOctets: Buffer.byteLength(bodyText) };
    }
    return actual;
  };
  async function observe() {
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
      exactExecution: { execute: executeExact, configuration: target.exactConfiguration },
      actionExecutor: async (execution) => {
        const actual = await executeClient(execution);
        lifecycle?.observed?.();
        const clientAction = bundle.manifest.scenarios
          .find((row) => row.id === currentScenario)
          ?.actions?.filter((action) => action.family === "client")[retryClientIndex++];
        if (
          numericControl === "refusal-success" &&
          currentScenario === "read-update.numeric-model.same-value-no-op" &&
          clientAction?.id === "num-subject-restored-read"
        ) {
          numericControlRecord = structuredClone((actual as { body: unknown }).body);
        }
        if (
          retryControl?.scenario === currentScenario &&
          retryControl.action === clientAction?.id
        ) {
          // Positional selection must still identify the exact executed client input.
          if (clientAction.family !== "client") throw Error("control requires client action");
          expect(clientAction.input).toEqual(execution.input);
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
              resource: {
                properties: Record<string, unknown>;
                metadata: Record<string, unknown>;
              };
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
    const report = {
      claimEligible: false,
      cleanupComplete: false,
      exactConfiguration: target.exactConfiguration,
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
        .filter(
          (id) =>
            !(artifact?.set.coverage ?? coverage).rows.find((row) => row.id === id)?.wholeContract,
        ),
      sessions,
      observations,
      setupObservations,
      nativeReadObservations,
      result,
    };
    // The runner's genuine partial/failed result must survive post-return aborts,
    // assertion failures and target cleanup failures.
    lifecycle?.returned?.(report);
    return report;
  }
  const execution = await observe().then(
    (report) => ({ ok: true as const, report }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const cleanupErrors: unknown[] = [];
  try {
    await target.close();
    lifecycle?.afterClose?.();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  const cleanupComplete =
    cleanupErrors.length === 0 &&
    (!execution.ok ||
      execution.report.result.scenarios.every((row) => row.cleanupError === undefined));
  if (execution.ok) execution.report.cleanupComplete = cleanupComplete;
  try {
    lifecycle?.cleaned?.(cleanupComplete ? "complete" : "failed");
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (
    cleanupErrors.length ||
    (!execution.ok && signal?.aborted && execution.error !== signal.reason)
  ) {
    const prior = signal?.aborted ? signal.reason : !execution.ok ? execution.error : undefined;
    throw new AggregateError(
      [
        ...new Set([
          ...(signal?.aborted ? [signal.reason] : []),
          ...(!execution.ok ? [execution.error] : []),
          ...cleanupErrors,
        ]),
      ],
      "artifact execution or cleanup failed",
      { cause: prior ?? cleanupErrors[0] },
    );
  }
  if (!execution.ok) throw execution.error;
  return execution.report;
}

function installedArtifactSet() {
  const selection = loadProfileContractSelection("read-update");
  const base = "packages/conformance/";
  return createReadUpdateArtifactSet(selection, {
    index: source(`${base}test-support/read-update-artifact-set-v1.json`),
    fixture: source(`${base}fixtures/read-update-reference-v1.json`),
    coverage: source(`${base}test-support/read-update-coverage-v1.json`),
    manifests: {
      "matrices/read-update-v1.json": source(`${base}matrices/read-update-v1.json`),
      "matrices/read-update-reference-continuation-v1.json": source(
        `${base}matrices/read-update-reference-continuation-v1.json`,
      ),
    },
  });
}
async function runShard(
  set: ReadUpdateArtifactSet,
  index: number,
  signal: AbortSignal,
  lifecycle?: Parameters<typeof run>[12],
  expected?: Pick<ArtifactObservation, "configuration" | "baselineReceipt">,
  evidence?: ArtifactEvidenceWriter,
) {
  try {
    evidence?.start(index);
    signal.throwIfAborted();
    const shard = set.shards[index]!;
    const report = await run(
      undefined,
      index === 0 ? undefined : [...shard.scenarioIds],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      signal,
      undefined,
      undefined,
      { set, shardId: shard.id, ...(expected ? { expected } : {}) },
      {
        ...lifecycle,
        launched(child) {
          evidence?.acquired(index);
          lifecycle?.launched?.(child);
        },
        returned(report) {
          evidence?.returned(index, report);
          lifecycle?.returned?.(report);
        },
        cleaned(status) {
          evidence?.cleaned(index, status);
          lifecycle?.cleaned?.(status);
        },
      },
    );
    signal.throwIfAborted();
    return report;
  } catch (error) {
    const original =
      signal.aborted &&
      error !== signal.reason &&
      !(error instanceof Error && error.cause === signal.reason)
        ? new AggregateError([signal.reason, error], "artifact abort and execution failed", {
            cause: signal.reason,
          })
        : error;
    try {
      evidence?.failed(index, signal.aborted);
    } catch (persistence) {
      throw new AggregateError(
        [original, persistence],
        "artifact failure evidence could not be saved",
        { cause: original },
      );
    }
    throw original;
  }
}

it("executes the partial cumulative RU matrix against actual installed factory HTTP and afterstate", async () => {
  // One aggregate budget for both shards and 52 isolated scenario authorities.
  // Abort cooperatively before the outer ceiling so existing finally blocks close stores.
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(Error("cumulative run budget exceeded")), 90000);
  let evidence: ArtifactEvidenceWriter | undefined;
  try {
    const set = installedArtifactSet();
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const filename = process.env.BDP_CUMULATIVE_REPORT_PATH;
    evidence = createArtifactEvidenceWriter(set, sourceCommit, filename, [token, wrongToken]);
    const reports: Awaited<ReturnType<typeof run>>[] = [];
    const timing: {
      id: string;
      budgetRemainingMsAtStart: number;
      elapsedMs: number;
      remainingMs: number;
      outcome: "running" | "pass" | "failed" | "aborted";
    }[] = [];
    for (let index = 0; index < set.shards.length; index++) {
      const stage = {
        id: set.shards[index]!.id,
        budgetRemainingMsAtStart: Math.max(0, 90000 - (performance.now() - started)),
        elapsedMs: performance.now() - started,
        remainingMs: Math.max(0, 90000 - (performance.now() - started)),
        outcome: "running" as "running" | "pass" | "failed" | "aborted",
      };
      timing.push(stage);
      evidence.timed(index, stage);
      const observed = await runShard(
        set,
        index,
        controller.signal,
        undefined,
        reports[0],
        evidence,
      ).then(
        (report) => ({ ok: true as const, report }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      stage.elapsedMs = performance.now() - started;
      stage.remainingMs = Math.max(0, 90000 - stage.elapsedMs);
      stage.outcome = controller.signal.aborted
        ? "aborted"
        : observed.ok &&
            set.shards[index]!.scenarioIds.every(
              (id) => observed.report.result.scenarios.find((r) => r.id === id)?.state === "pass",
            )
          ? "pass"
          : "failed";
      try {
        evidence.timed(index, stage);
      } catch (persistence) {
        if (!observed.ok)
          throw new AggregateError(
            [observed.error, persistence],
            "stage failure evidence could not be saved",
            { cause: observed.error },
          );
        throw persistence;
      }
      if (!observed.ok) throw observed.error;
      reports.push(observed.report);
    }
    controller.signal.throwIfAborted();
    const progress = associateArtifactObservations(
      set,
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      reports,
    );
    const report = reports[0]!;
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
      "3224c31c83988dc0606cb76ee1f4ba8e6394159bdf7daaccc301461316cc2477",
    );
    expect(report.uncoveredIds).toHaveLength(99);
    expect(report.uncoveredIds).toContain("read-update.singleton.update-bead");
    expect(report.sessions).toHaveLength(report.plannedIds.length);
    expect(report.observations.length).toBeGreaterThan(30);
    expect(JSON.stringify(report)).not.toContain(token);
    expect(JSON.stringify(report)).not.toContain(wrongToken);
    for (const observed of reports) {
      expect(observed.sessions).toHaveLength(observed.plannedIds.length);
      expect(observed.cleanupComplete).toBe(true);
      expect(JSON.stringify(observed)).not.toContain(token);
      expect(JSON.stringify(observed)).not.toContain(wrongToken);
      for (const item of observed.observations as {
        observation: { observation: { bodyOctets: number } };
      }[])
        expect(item.observation.observation.bodyOctets).toBeLessThanOrEqual(65536);
    }
    expect(progress.authoredIds).toHaveLength(52);
    expect(progress.reviewedWholeIds).toHaveLength(30);
    expect(progress.omittedRequiredIds).toHaveLength(77);
    expect(progress.shards[1]!.selectedIds).toEqual([attributionId, continuationId, numericId]);
    // Independently enumerated fixed client GETs, raw discovery/alias GETs,
    // numeric raw mutations and the nine mandatory carriers. No route helper.
    expect(progress.shards[1]!.routes).toEqual([
      { method: "GET", url: `${scope}operations/` },
      { method: "GET", url: `${scope}beads/att-subject` },
      { method: "GET", url: `${scope}beads/att-owner` },
      { method: "GET", url: `${scope}beads/att-target` },
      { method: "GET", url: `${scope}links/att-unowned` },
      { method: "GET", url: `${scope}links/att-owned` },
      { method: "GET", url: `${scope}beads/rc-source` },
      { method: "GET", url: `${scope}beads/rc-target` },
      { method: "GET", url: `${scope}links/rc-live` },
      { method: "GET", url: `${scope}beads/rc-rc-sequence-wrong-tail` },
      { method: "GET", url: `${scope}beads/rc-missing` },
      { method: "GET", url: `${scope}beads/num-subject` },
      { method: "GET", url: `${scope}beads/num-target` },
      { method: "GET", url: `${scope}links/num-link` },
      { method: "GET", url: `${scope}` },
      { method: "GET", url: `${scope}bdp.json` },
      { method: "GET", url: `${scope}types/task` },
      { method: "GET", url: `${scope}types/relates` },
      { method: "GET", url: `${scope}types/decision` },
      { method: "GET", url: `${scope}alias/rc-locator-live` },
      { method: "GET", url: `${scope}beads/?limit=100` },
      { method: "GET", url: `${scope}links/?limit=100` },
      { method: "GET", url: `${scope}alias/rc-locator-put-local` },
      { method: "GET", url: `${scope}alias/rc-locator-put-absolute` },
      { method: "GET", url: `${scope}alias/rc-locator-missing` },
      { method: "GET", url: `${scope}alias/rc-locator-missing-absolute` },
      { method: "POST", url: `${scope}operations/update-bead` },
      { method: "POST", url: `${scope}operations/update-link` },
      { method: "POST", url: `${scope}operations/sequence` },
      { method: "POST", url: `${scope}operations/create-bead` },
      { method: "POST", url: `${scope}operations/delete-bead` },
      { method: "POST", url: `${scope}operations/create-link` },
      { method: "POST", url: `${scope}operations/delete-link` },
      { method: "POST", url: `${scope}operations/put-alias` },
      { method: "POST", url: `${scope}operations/delete-alias` },
    ]);
    expect(progress.shards[1]!.routes).toHaveLength(35);
    expect(progress.shards[1]!.routeDigest).toBe(
      "6713ab2c41b09869b664f372de1ef1390c00cfd24b154ea717f7ee6d62c35059",
    );
    expect(progress.observedStatePartitions.pass).toEqual(progress.authoredIds);
    expect(progress.observedStatePartitions.fail).toEqual([]);
    expect(progress.observedStatePartitions.notRun).toEqual([]);
    expect(progress.observedStatePartitions.notImplemented).toEqual(progress.omittedRequiredIds);
    expect(progress.observedStatePartitions.unobserved).toEqual([]);
    expect(progress.uncoveredIds).toEqual(
      set.coverage.rows.filter((r) => !r.wholeContract).map((r) => r.id),
    );
    expect(progress.uncoveredIds).toHaveLength(99);
    expect(JSON.stringify(progress)).not.toContain(token);
    expect(JSON.stringify(progress)).not.toContain(wrongToken);
    controller.signal.throwIfAborted();
    expect(performance.now() - started).toBeLessThan(90000);
    evidence.succeeded({
      ...progress,
      sourceDirty: reports.some((r) => r.sourceDirty),
      timing,
      outcome: "observed",
      ...(filename ? { childReports: set.shards.map((s) => `${filename}.${s.id}.json`) } : {}),
    });
  } catch (error) {
    try {
      evidence?.failedSet();
    } catch (persistence) {
      throw new AggregateError([error, persistence], "set failure evidence could not be saved", {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    "3224c31c83988dc0606cb76ee1f4ba8e6394159bdf7daaccc301461316cc2477",
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

it("refuses an already cancelled aggregate before launching any installed child", async () => {
  const children: ChildProcess[] = [];
  await expect(
    run(
      undefined,
      ["read-update.singleton.create-bead"],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      AbortSignal.abort(Error("test aggregate cancellation")),
      undefined,
      undefined,
      undefined,
      {
        launched(child) {
          children.push(child);
        },
      },
    ),
  ).rejects.toThrow("test aggregate cancellation");
  expect(children).toEqual([]);
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
  expect(report.uncoveredIds).toHaveLength(99);
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
    label: "conflict body replaced while HTTP status remains 409",
    scenario: retryRows[1]!,
    action: "b-conflict",
    path: ["body"],
    value: {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      status: 404,
      retry: "after-state-change",
    },
    failed: "complete-problem-body",
  },
  {
    label: "cross-carrier name changed",
    scenario: retryRows[1]!,
    action: "a-replay",
    path: ["body", "results", "0", "operationName"],
    value: "wrong",
    failed: "name-0",
  },
  {
    label: "repeated replay changes retained result",
    scenario: retryRows[0]!,
    action: "reordered-again",
    path: ["body", "results", "0", "resource"],
    binding: "position-b-live",
    failed: "same-results",
  },
  {
    label: "fresh member GET loses committed value",
    scenario: retryRows[0]!,
    action: "d-after",
    path: ["body", "properties", "n"],
    value: 0,
    failed: "postimage",
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

const admissionRows = [
  "read-update.singleton.idempotency-key-required",
  "read-update.singleton.unsupported-media-type",
] as const;
it("observes key and media admission against installed HTTP with paired afterstate", async () => {
  const report = await run(undefined, [...admissionRows]);
  if (process.env.BDP_ADMISSION_REPORT_PATH)
    writeFileSync(process.env.BDP_ADMISSION_REPORT_PATH, JSON.stringify(report, null, 2));
  for (const id of admissionRows)
    expect(
      report.result.scenarios.find((row) => row.id === id),
      JSON.stringify(report.result),
    ).toMatchObject({ state: "pass" });
  expect(report.uncoveredIds).toHaveLength(99);
  expect(report.result.claimEligible).toBe(false);
}, 30000);

it("pins admission action, request-byte and live-identity budgets without hidden setup", () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const fixture = JSON.parse(
    source("packages/conformance/fixtures/read-update-reference-v1.json").bytes.toString(),
  );
  const fixtureValue = (pointer: string): unknown =>
    pointer
      .split("/")
      .slice(1)
      .reduce<unknown>(
        (value, field) =>
          (value as Record<string, unknown>)[field.replaceAll("~1", "/").replaceAll("~0", "~")],
        fixture,
      );
  const ledgers = [
    { id: admissionRows[0], actions: 284, raw: 196, client: 88, peak: { beads: 36, links: 3 } },
    { id: admissionRows[1], actions: 183, raw: 149, client: 34, peak: { beads: 11, links: 4 } },
    {
      id: "read-update.singleton.no-local-bindings",
      actions: 99,
      raw: 46,
      client: 53,
      peak: { beads: 5, links: 6 },
    },
    {
      id: "read-update.alias.non-canonical-target",
      actions: 72,
      raw: 43,
      client: 29,
      peak: { beads: 4, links: 2 },
    },
  ];
  const kinds: Record<string, string> = {
    "create-bead": "createBead",
    "update-bead": "updateBead",
    "delete-bead": "deleteBead",
    "create-link": "createLink",
    "update-link": "updateLink",
    "delete-link": "deleteLink",
    "put-alias": "putAlias",
    "delete-alias": "deleteAlias",
    sequence: "sequence",
  };
  for (const ledger of ledgers) {
    const row = manifest.scenarios.find((row: { id: string }) => row.id === ledger.id);
    expect(row.actions).toHaveLength(ledger.actions);
    expect(row.actions.filter((a: { family: string }) => a.family === "http")).toHaveLength(
      ledger.raw,
    );
    expect(row.actions.filter((a: { family: string }) => a.family === "client")).toHaveLength(
      ledger.client,
    );
    const live: Record<string, Set<string>> = { beads: new Set(), links: new Set() };
    const peak = { beads: 0, links: 0 };
    for (const action of row.actions) {
      if (action.raw?.body)
        expect(Buffer.byteLength(action.raw.body.value)).toBeLessThanOrEqual(65536);
      if (action.method === "GET" && ["beads", "links"].includes(action.target?.binding)) {
        const collection = action.target.binding;
        expect(action.target.query).toEqual({ limit: "100" });
        expect(action.assertions.find((a: { id: string }) => a.id === "schema")).toEqual({
          id: "schema",
          kind: "json-schema",
          schema: `#/$defs/current${collection === "beads" ? "Bead" : "Link"}Collection`,
        });
        expect(action.assertions.find((a: { id: string }) => a.id === "complete")).toMatchObject({
          pointer: "/next",
          equals: null,
        });
        const identities = action.assertions.find((a: { id: string }) => a.id === "identities");
        expect(
          identities.fixturePointer ? fixtureValue(identities.fixturePointer) : identities.equals,
        ).toEqual([...live[collection]!].sort().map((id) => [`${scope}${id}`]));
      }
      const success = action.assertions.some(
        (a: { id: string; equals?: unknown }) => a.id === "status" && a.equals === 200,
      );
      const method = action.method ?? action.input?.method;
      if (!success || method !== "POST") continue;
      const body = action.raw?.body ? JSON.parse(action.raw.body.value) : action.input.body;
      const kind = kinds[action.target?.path ?? action.input.targetBinding];
      const records = kind === "sequence" ? body.operations : [{ ...body, operation: kind }];
      for (const [index, operation] of records.entries()) {
        // A reached failure in a mixed Sequence is not a successful Resource creation.
        if (
          kind === "sequence" &&
          action.assertions.some(
            (a: { pointer?: string; equals?: { status?: number }; fixturePointer?: string }) =>
              a.pointer === `/body/results/${index}` &&
              ((a.fixturePointer
                ? (fixtureValue(a.fixturePointer) as { status?: number })
                : a.equals
              )?.status ?? 0) >= 400,
          )
        )
          continue;
        const collection = operation.operation.includes("Bead") ? "beads" : "links";
        if (operation.operation.startsWith("create")) live[collection]!.add(operation.id);
        if (operation.operation === "deleteBead") live.beads!.delete(operation.bead);
        if (operation.operation === "deleteLink") live.links!.delete(operation.link);
        peak.beads = Math.max(peak.beads, live.beads!.size);
        peak.links = Math.max(peak.links, live.links!.size);
      }
    }
    expect(peak).toEqual(ledger.peak);
    expect(peak.beads).toBeLessThanOrEqual(64);
    expect(peak.links).toBeLessThanOrEqual(16);
  }
});

it.each([
  [0, "key-repeat-distinct", "single-key", 200, "status"],
  [0, "key-long", "length-256", 200, "status"],
  [0, "key-route-delete-link-repeated", "single-key", 200, "status"],
  [0, "key-route-update-bead-malformed", "valid-key", 200, "status"],
  [1, "media-route-sequence-wrong-parameters", "json-media", 200, "status"],
  [1, "media-route-create-link-corrected", "wrong-media", 415, "status"],
  [1, "media-route-create-link-corrected-bare", "wrong-media", 415, "status"],
  [1, "media-parameter-charset", "wrong-media", 415, "status"],
] as const)(
  "detects admission raw input boundary %s/%s/%s",
  async (index, actionId, control, status, assertion) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const id = admissionRows[index];
    const row = manifest.scenarios.find((row: { id: string }) => row.id === id);
    const action = row.actions.find((a: { id: string }) => a.id === actionId);
    if (control === "single-key") action.raw.headerLines.pop();
    else if (control === "valid-key")
      action.raw.headerLines.find(
        (line: { name: string }) => line.name === "idempotency-key",
      ).value = "valid-control";
    else if (control === "json-media")
      action.raw.headerLines.find((line: { name: string }) => line.name === "content-type").value =
        "application/json; charset=iso-8859-1; arbitrary=ignored";
    else if (control === "length-256")
      action.raw.headerLines.find(
        (line: { name: string }) => line.name === "idempotency-key",
      ).value = "x".repeat(256);
    else
      action.raw.headerLines.find((line: { name: string }) => line.name === "content-type").value =
        "text/plain";
    const report = await run(manifest, [id]);
    const observed = report.result.scenarios.find((row) => row.id === id);
    expect(observed?.state).toBe("fail");
    const exchange = observed?.exchanges.find((exchange) => exchange.request.id === actionId);
    expect(exchange?.response?.status).toBe(status);
    const expectedFailures =
      status === 200
        ? [assertion, "schema", "problem"]
        : [
            assertion,
            "schema",
            "outcome-0",
            "type-0",
            ...(actionId.includes("create-link") ? ["source-0", "target-0"] : []),
            "properties-0",
            "metadata-0",
            "id-0",
          ];
    expect(exchange?.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual(
      expectedFailures,
    );
    // A valid mutation may change later state; refused corrections may prevent it.
    // The runner stops at this first failed exchange, so those downstream effects
    // are not additional assertion failures or evidence from this control run.
    expect(observed?.exchanges.at(-1)?.request.id).toBe(actionId);
  },
  30000,
);

it.each([
  {
    scenario: admissionRows[0]!,
    action: "key-empty-corrected",
    path: ["status"],
    value: 409,
    failed: "status",
  },
  {
    scenario: admissionRows[0]!,
    action: "key-empty-corrected-0-read",
    path: ["body", "properties", "n"],
    value: 999,
    failed: "postimage",
  },
  {
    scenario: admissionRows[1]!,
    action: "media-plain-corrected",
    path: ["status"],
    value: 409,
    failed: "status",
  },
  {
    scenario: admissionRows[1]!,
    action: "media-plain-corrected-0-read",
    path: ["body", "properties", "n"],
    value: 1,
    failed: "postimage",
  },
])(
  "detects admission corrected disposition or state corruption $action",
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
    const action = row?.actions?.find((a) => a.action.id === control.action);
    expect(action?.assertions.filter((a) => !a.passed).map((a) => a.id)).toContain(control.failed);
  },
  30000,
);

it("pairs every malformed key with identical body and route and only a valid key correction", () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const row = manifest.scenarios.find((row: { id: string }) => row.id === admissionRows[0]);
  const corpus = ["empty", "long", "quoted", "space", "tab", "punctuation", "comma", "latin"];
  for (const name of corpus) {
    const bad = row.actions.find((a: { id: string }) => a.id === `key-${name}`);
    const corrected = row.actions.find((a: { id: string }) => a.id === `key-${name}-corrected`);
    expect(corrected.input.body).toEqual(JSON.parse(bad.raw.body.value));
    expect(corrected.input.targetBinding).toBe(bad.target.path);
    expect(corrected.input.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(
      bad.raw.headerLines.find((line: { name: string }) => line.name === "idempotency-key").value,
    ).not.toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    const sequenceBad = row.actions.find((a: { id: string }) => a.id === `sequence-key-${name}`);
    const sequenceGood = row.actions.find(
      (a: { id: string }) => a.id === `sequence-key-${name}-corrected`,
    );
    const expected = JSON.parse(sequenceBad.raw.body.value);
    expect(expected.operations[1].idempotencyKey).not.toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(sequenceGood.input.body.operations[1].idempotencyKey).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expected.operations[1].idempotencyKey = sequenceGood.input.body.operations[1].idempotencyKey;
    expect(sequenceGood.input.body).toEqual(expected);
    expect(sequenceGood.input.targetBinding).toBe(sequenceBad.target.path);
  }
});

it.each(["alias-location", "stale-collection-record"] as const)(
  "detects admission independent %s oracle mismatch",
  async (control) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const row = manifest.scenarios.find((row: { id: string }) => row.id === admissionRows[0]);
    const actionId =
      control === "alias-location" ? "key-route-put-alias-alias-after" : "key-empty-after-beads";
    const action = row.actions.find((a: { id: string }) => a.id === actionId);
    let assertionId: string;
    if (control === "alias-location") {
      assertionId = "location";
      action.assertions.find((a: { id: string }) => a.id === assertionId).equals =
        `${scope}beads/ak-target`;
    } else {
      const assertion = action.assertions.find(
        (a: { equalsBinding?: string }) =>
          a.equalsBinding === "key-route-update-bead-corrected-0-record",
      );
      assertionId = assertion.id;
      assertion.equalsBinding = "ak-seed-update-0-record";
    }
    const report = await run(manifest, [admissionRows[0]]);
    const observed = report.result.scenarios.find((row) => row.id === admissionRows[0]);
    expect(observed?.state).toBe("fail");
    const exchange = observed?.exchanges.find((exchange) => exchange.request.id === actionId);
    expect(exchange?.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  30000,
);

it("pins admission carrier completion, same-body key corrections and same-key media corrections", () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const keyRow = manifest.scenarios.find((row: { id: string }) => row.id === admissionRows[0]);
  const mediaRow = manifest.scenarios.find((row: { id: string }) => row.id === admissionRows[1]);
  const actionById = (row: typeof keyRow, id: string) => {
    const action = row.actions.find((a: { id: string }) => a.id === id);
    expect(action, id).toBeDefined();
    return action;
  };
  const withoutId = (action: Record<string, unknown>) => {
    const { id, ...rest } = action;
    expect(id).toBeTypeOf("string");
    return rest;
  };
  const headerValues = (action: (typeof keyRow.actions)[number], name: string) =>
    action.raw.headerLines
      .filter((h: { name: string }) => h.name.toLowerCase() === name)
      .map((h: { value: string }) => h.value);
  const unchangedState = (row: typeof keyRow, prefix: string, refused: string, alias: boolean) => {
    for (const collection of ["beads", "links"])
      expect(withoutId(actionById(row, `${refused}-after-${collection}`))).toEqual(
        withoutId(actionById(row, `${prefix}-before-${collection}`)),
      );
    if (alias)
      expect(withoutId(actionById(row, `${refused}-alias-after`))).toEqual(
        withoutId(actionById(row, `${prefix}-alias-before`)),
      );
  };
  const routes = [
    "create-bead",
    "update-bead",
    "delete-bead",
    "create-link",
    "update-link",
    "delete-link",
    "put-alias",
    "delete-alias",
  ];
  for (const route of routes) {
    const missing = keyRow.actions.find((a: { id: string }) => a.id === `key-route-${route}`);
    const good = keyRow.actions.find(
      (a: { id: string }) => a.id === `key-route-${route}-corrected`,
    );
    expect(good.input.body).toEqual(JSON.parse(missing.raw.body.value));
    expect(good.input.targetBinding).toBe(route);
    unchangedState(keyRow, missing.id, missing.id, route.endsWith("alias"));
    if (route !== "create-bead") {
      for (const suffix of ["malformed", "repeated"]) {
        const bad = keyRow.actions.find(
          (a: { id: string }) => a.id === `key-route-${route}-${suffix}`,
        );
        expect(bad.target).toEqual(missing.target);
        expect(bad.raw.body).toEqual(missing.raw.body);
        const keys = bad.raw.headerLines.filter(
          (h: { name: string }) => h.name.toLowerCase() === "idempotency-key",
        );
        if (suffix === "malformed")
          expect(keys.map((h: { value: string }) => h.value)).toEqual(["bad.key"]);
        else
          expect(keys.map((h: { value: string }) => h.value)).toEqual([
            good.input.idempotencyKey,
            good.input.idempotencyKey,
          ]);
        unchangedState(keyRow, missing.id, bad.id, route.endsWith("alias"));
      }
    }
  }
  for (const route of [...routes, "sequence"]) {
    const prefix = `media-route-${route}`;
    const missing = mediaRow.actions.find((a: { id: string }) => a.id === prefix);
    const good = mediaRow.actions.find((a: { id: string }) => a.id === `${prefix}-corrected`);
    expect(good.target).toEqual(missing.target);
    expect(good.raw.body).not.toEqual(missing.raw.body);
    expect(headerValues(good, "content-type")).toEqual([
      "application/json; charset=iso-8859-1; arbitrary=ignored",
    ]);
    unchangedState(mediaRow, prefix, missing.id, route.endsWith("alias"));
    const bare = actionById(mediaRow, `${prefix}-corrected-bare`);
    const expectedBare = structuredClone(good);
    expectedBare.id = bare.id;
    expectedBare.raw.headerLines.find(
      (h: { name: string }) => h.name.toLowerCase() === "content-type",
    ).value = "application/json";
    expect(bare).toEqual(expectedBare);
    expect(mediaRow.actions.indexOf(bare)).toBe(mediaRow.actions.indexOf(good) + 1);
    for (const [suffix, media] of [
      ["wrong", "text/plain"],
      ["wrong-parameters", "text/plain; charset=utf-8; arbitrary=ignored"],
    ]) {
      const bad = mediaRow.actions.find((a: { id: string }) => a.id === `${prefix}-${suffix}`);
      expect(bad.target).toEqual(missing.target);
      expect(bad.raw.body).toEqual(missing.raw.body);
      expect(headerValues(bad, "content-type")).toEqual([media]);
      expect(headerValues(bad, "idempotency-key")).toEqual(headerValues(good, "idempotency-key"));
      if (route === "sequence")
        expect(
          JSON.parse(bad.raw.body.value).operations.map(
            (m: { idempotencyKey: string }) => m.idempotencyKey,
          ),
        ).toEqual(
          JSON.parse(good.raw.body.value).operations.map(
            (m: { idempotencyKey: string }) => m.idempotencyKey,
          ),
        );
      unchangedState(mediaRow, prefix, bad.id, route.endsWith("alias"));
    }
    if (route === "sequence") {
      expect(
        JSON.parse(good.raw.body.value).operations.map(
          (m: { idempotencyKey: string }) => m.idempotencyKey,
        ),
      ).toEqual(
        JSON.parse(missing.raw.body.value).operations.map(
          (m: { idempotencyKey: string }) => m.idempotencyKey,
        ),
      );
    } else
      expect(headerValues(good, "idempotency-key")).toEqual(
        headerValues(missing, "idempotency-key"),
      );
  }
});

const referenceRows = [
  "read-update.singleton.no-local-bindings",
  "read-update.alias.non-canonical-target",
] as const;
it("observes reference syntax and retained category failures against installed HTTP", async () => {
  const report = await run(undefined, [...referenceRows]);
  if (process.env.BDP_REFERENCE_REPORT_PATH)
    writeFileSync(process.env.BDP_REFERENCE_REPORT_PATH, JSON.stringify(report, null, 2));
  for (const id of referenceRows)
    expect(
      report.result.scenarios.find((row) => row.id === id),
      JSON.stringify(report.result),
    ).toMatchObject({ state: "pass" });
  expect(report.uncoveredIds).toHaveLength(99);
  expect(report.result.claimEligible).toBe(false);
}, 30000);

it.each([
  [0, "ra-create-link-source-pin", "source-pin", 200],
  [1, "rb-alias-local", "missing-bead", 404],
  [1, "rb-endpoint-source", "valid-endpoint", 200],
  [1, "rb-seed-alias", "wrong-absolute-category", 422],
  [1, "rb-seed-link", "wrong-pinned-category", 422],
] as const)(
  "detects reference input correction %s/%s/%s",
  async (index, actionId, control, status) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const id = referenceRows[index];
    const row = manifest.scenarios.find((r: { id: string }) => r.id === id);
    const action = row.actions.find((a: { id: string }) => a.id === actionId);
    if (control === "source-pin") action.input.body.source.uri = "beads/ra-source";
    else if (control === "missing-bead") action.input.body.target = "beads/rb-missing-control";
    else if (control === "wrong-absolute-category")
      action.input.body.target = `${scope}links/rb-live`;
    else if (control === "wrong-pinned-category") action.input.body.source.uri = "links/rb-live";
    else action.input.body.source = "beads/rb-source";
    const report = await run(manifest, [id]);
    const observed = report.result.scenarios.find((r) => r.id === id);
    expect(observed?.state).toBe("fail");
    expect(
      observed?.actions
        ?.find((a) => a.action.id === actionId)
        ?.assertions.filter((a) => !a.passed)
        .map((a) => a.id),
    ).toContain("status");
    const clientIndex = row.actions
      .filter((a: { family: string }) => a.family === "client")
      .findIndex((a: { id: string }) => a.id === actionId);
    expect(
      (report.observations as { scenario: string; observation: { status: number } }[]).filter(
        (o) => o.scenario === id,
      )[clientIndex]?.observation,
    ).toMatchObject({ status });
  },
  30000,
);

it.each([
  {
    scenario: referenceRows[1],
    action: "rb-seed-link",
    path: ["body", "resource", "source", "revision"],
    value: "wrong-pin",
    failed: "source-0",
  },
  {
    scenario: referenceRows[1],
    action: "rb-seed-link",
    path: ["body", "resource", "target", "revision"],
    value: "wrong-pin",
    failed: "target-0",
  },
  {
    scenario: referenceRows[0],
    action: "ra-create-link-source-pin-corrected",
    path: ["body", "resource", "source", "revision"],
    value: "wrong-pin",
    failed: "source-0",
  },
  {
    scenario: referenceRows[0],
    action: "ra-update-bead-corrected-0-read",
    path: ["body", "properties", "n"],
    value: 1,
    failed: "postimage",
  },
  {
    scenario: referenceRows[0],
    action: "ra-metadata-literal",
    path: ["body", "resource", "metadata", "tag"],
    value: "wrong",
    failed: "metadata-0",
  },
  {
    scenario: referenceRows[1],
    action: "rb-alias-replay",
    path: ["body", "title"],
    value: "added",
    failed: "complete-problem",
  },
  {
    scenario: referenceRows[1],
    action: "rb-alias-conflict",
    path: ["body", "code"],
    value: "resource-not-found",
    failed: "complete-problem",
  },
  {
    scenario: referenceRows[1],
    action: "rb-sequence-alias",
    path: ["status"],
    value: 422,
    failed: "status",
  },
  {
    scenario: referenceRows[1],
    action: "rb-sequence-endpoint",
    path: ["body", "results", "1", "resource", "properties", "n"],
    value: 999,
    failed: "properties-0",
  },
])(
  "detects reference post-wire corruption $action",
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
    const row = report.result.scenarios.find((r) => r.id === control.scenario);
    expect(row?.state).toBe("fail");
    expect(
      row?.actions
        ?.find((a) => a.action.id === control.action)
        ?.assertions.filter((a) => !a.passed)
        .map((a) => a.id),
    ).toContain(control.failed);
  },
  30000,
);

it("binds a changed reference fixture oracle and rejects its wrong complete Problem expectation", async () => {
  const fixtureSource = source("packages/conformance/fixtures/read-update-reference-v1.json");
  const fixture = JSON.parse(fixtureSource.bytes.toString());
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const row = manifest.scenarios.find((r: { id: string }) => r.id === referenceRows[1]);
  const assertion = row.actions
    .find((a: { id: string }) => a.id === "rb-alias-local")
    .assertions.find((a: { id: string }) => a.id === "complete-problem");
  const name = assertion.fixturePointer.split("/").at(-1);
  fixture.oracles.referenceEvidence[name].diagnostics[0].message = "incorrect independent oracle";
  const report = await run(undefined, [referenceRows[1]], false, false, fixture);
  const changedDigest = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
  expect(changedDigest).not.toBe(createHash("sha256").update(fixtureSource.bytes).digest("hex"));
  expect(report.configuration.fixtureDigest).toBe(changedDigest);
  expect(report.reportBinding.artifacts.fixtureDigest).toBe(changedDigest);
  const observed = report.result.scenarios.find((r) => r.id === referenceRows[1]);
  expect(observed?.state).toBe("fail");
  expect(
    observed?.actions
      ?.find((a) => a.action.id === "rb-alias-local")
      ?.assertions.filter((a) => !a.passed)
      .map((a) => a.id),
  ).toContain("complete-problem");
}, 30000);

it("pins all thirteen reference syntax vectors and literal opaque pin corrections", () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const row = manifest.scenarios.find((r: { id: string }) => r.id === referenceRows[0]);
  const vectors = [
    ["update-bead", "bead"],
    ["delete-bead", "bead"],
    ["create-link-source", "source"],
    ["create-link-source-pin", "source"],
    ["create-link-target", "target"],
    ["create-link-target-pin", "target"],
    ["update-link", "link"],
    ["delete-link", "link"],
    ["put-target", "target"],
    ["put-alias", "alias"],
    ["delete-alias", "alias"],
    ["create-bead-id", "id"],
    ["create-link-id", "id"],
  ];
  for (const [label, field] of vectors) {
    const bad = row.actions.find((a: { id: string }) => a.id === `ra-${label}`);
    const good = row.actions.find((a: { id: string }) => a.id === `ra-${label}-corrected`);
    expect(bad.input.idempotencyKey).toBe(good.input.idempotencyKey);
    expect(bad.input.targetBinding).toBe(good.input.targetBinding);
    const expected = structuredClone(bad.input.body);
    if (label!.endsWith("-pin")) {
      expect(expected[field!]).toEqual({ uri: "@made", revision: "fixture-pin" });
      expect(good.input.body[field!].revision).toBe("fixture-pin");
      expected[field!].uri = good.input.body[field!].uri;
    } else {
      expect(expected[field!]).toBe("@made");
      expected[field!] = good.input.body[field!];
    }
    expect(good.input.body).toEqual(expected);
    expect(bad.input.bodyBindings).toBeUndefined();
    expect(good.input.bodyBindings).toBeUndefined();
  }
});

it("detects reference live alias oracle corruption after fresh corrected put", async () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const row = manifest.scenarios.find((r: { id: string }) => r.id === referenceRows[1]);
  const action = row.actions.find((a: { id: string }) => a.id === "rb-alias-fresh-0-read");
  action.assertions.find((a: { id: string }) => a.id === "location").equals =
    `${scope}beads/rb-source`;
  const report = await run(manifest, [referenceRows[1]]);
  const observed = report.result.scenarios.find((r) => r.id === referenceRows[1]);
  expect(observed?.state).toBe("fail");
  expect(
    observed?.exchanges
      .find((a) => a.request.id === action.id)
      ?.assertions.filter((a) => !a.passed)
      .map((a) => a.id),
  ).toEqual(["location"]);
}, 30000);

it("pins admitted absolute alias target and opaque pinned endpoint comparators in category row", () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const row = manifest.scenarios.find((r: { id: string }) => r.id === referenceRows[1]);
  const alias = row.actions.find((a: { id: string }) => a.id === "rb-seed-alias");
  expect(alias.input.body.target).toBe(`${scope}beads/rb-source`);
  expect(alias.assertions.find((a: { id: string }) => a.id === "status")).toMatchObject({
    equals: 200,
  });
  const aliasRead = row.actions.find((a: { id: string }) => a.id === "rb-seed-alias-0-read");
  expect(aliasRead.assertions.find((a: { id: string }) => a.id === "status")).toMatchObject({
    equals: 307,
  });
  expect(aliasRead.assertions.find((a: { id: string }) => a.id === "location")).toMatchObject({
    equals: `${scope}beads/rb-source`,
  });
  const link = row.actions.find((a: { id: string }) => a.id === "rb-seed-link");
  expect(link.input.body.source).toEqual({ uri: "beads/rb-source", revision: "fixture-pin" });
  expect(link.input.body.target).toEqual({ uri: "beads/rb-target", revision: "fixture-pin" });
  expect(link.assertions.find((a: { id: string }) => a.id === "status")).toMatchObject({
    equals: 200,
  });
  expect(link.assertions.find((a: { id: string }) => a.id === "source-0")).toMatchObject({
    equals: { uri: `${scope}beads/rb-source`, revision: "fixture-pin" },
  });
  expect(link.assertions.find((a: { id: string }) => a.id === "target-0")).toMatchObject({
    equals: { uri: `${scope}beads/rb-target`, revision: "fixture-pin" },
  });
  expect(link.input.bodyBindings).toBeUndefined();
});

it.each(["identities", "stale-record"] as const)(
  "detects named reference collection oracle corruption %s",
  async (control) => {
    const manifest = JSON.parse(
      source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
    );
    const row = manifest.scenarios.find((r: { id: string }) => r.id === referenceRows[0]);
    const action = row.actions.find((a: { id: string }) => a.id === "ra-final-beads");
    const assertionId = control === "identities" ? "identities" : "record-4";
    const assertion = action.assertions.find((a: { id: string }) => a.id === assertionId);
    if (control === "identities") {
      expect(assertion.fixturePointer).toBe("/oracles/referenceEvidence/identities-9");
      const fixture = JSON.parse(
        source("packages/conformance/fixtures/read-update-reference-v1.json").bytes.toString(),
      );
      assertion.equals = structuredClone(fixture.oracles.referenceEvidence["identities-9"]);
      assertion.equals[0][0] = `${scope}beads/incorrect-collection-identity`;
      delete assertion.fixturePointer;
    } else {
      expect(assertion.equalsBinding).toBe("ra-update-bead-corrected-0-record");
      // Same Resource identity, stale properties and revision from the actual earlier create.
      assertion.equalsBinding = "ra-seed-update-0-record";
    }
    const report = await run(manifest, [referenceRows[0]]);
    const observed = report.result.scenarios.find((r) => r.id === referenceRows[0]);
    expect(observed?.state).toBe("fail");
    expect(observed?.exchanges.at(-1)?.request.id).toBe(action.id);
    const exchange = observed?.exchanges.find((a) => a.request.id === action.id);
    expect(exchange?.response?.status).toBe(200);
    expect(exchange?.assertions.filter((a) => !a.passed).map((a) => a.id)).toEqual([assertionId]);
  },
  30000,
);

const continuationId = "read-update.alias.unknown-subject";
const continuationSource =
  "packages/conformance/matrices/read-update-reference-continuation-v1.json";
it.each([
  { action: "rc-delete-replay", path: ["status"], value: 200, failed: "status" },
  {
    action: "rc-sequence-wrong-0-read",
    path: ["body", "properties", "n"],
    value: 999,
    failed: "postimage",
  },
])(
  "detects restored C post-wire corruption $action",
  async (control) => {
    const manifest = JSON.parse(source(continuationSource).bytes.toString());
    const report = await run(
      manifest,
      [continuationId],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { ...control, scenario: continuationId },
    );
    expect(report.counterfactualApplications).toBe(1);
    const observed = report.result.scenarios[0]!;
    expect(observed.state).toBe("fail");
    expect(
      observed.actions
        ?.find((a) => a.action.id === control.action)
        ?.assertions.filter((a) => !a.passed)
        .map((a) => a.id),
    ).toEqual([control.failed]);
  },
  30000,
);
it("detects restored C retained-delete live-alias Location corruption", async () => {
  const manifest = JSON.parse(source(continuationSource).bytes.toString());
  const action = manifest.scenarios
    .find((r: { id: string }) => r.id === continuationId)
    .actions.find((a: { id: string }) => a.id === "rc-delete-replay-alias");
  action.assertions.find((a: { id: string }) => a.id === "location").equals =
    `${scope}beads/rc-source`;
  const report = await run(manifest, [continuationId]);
  expect(report.result.scenarios[0]!.state).toBe("fail");
  expect(
    report.result.scenarios[0]!.exchanges.find((e) => e.request.id === action.id)
      ?.assertions.filter((a) => !a.passed)
      .map((a) => a.id),
  ).toEqual(["location"]);
}, 30000);
it("binds restored C independent oracle corruption and fails its actual comparison", async () => {
  const manifest = JSON.parse(source(continuationSource).bytes.toString());
  const fixture = JSON.parse(
    source("packages/conformance/fixtures/read-update-reference-v1.json").bytes.toString(),
  );
  const action = manifest.scenarios
    .find((r: { id: string }) => r.id === continuationId)
    .actions.find((a: { id: string }) => a.id === "rc-put-local");
  const pointer = action.assertions.find(
    (a: { id: string }) => a.id === "complete-problem",
  ).fixturePointer;
  const key = pointer.split("/").at(-1);
  fixture.oracles.referenceEvidence[key].code = "incorrect-independent-oracle";
  const report = await run(manifest, [continuationId], false, false, fixture);
  expect(report.reportBinding.artifacts.fixtureDigest).not.toBe(
    installedArtifactSet().digests.fixtureDigest,
  );
  expect(report.result.scenarios[0]!.state).toBe("fail");
  expect(
    report.result.scenarios[0]!.actions?.find((a) => a.action.id === action.id)
      ?.assertions.filter((a) => !a.passed)
      .map((a) => a.id),
  ).toEqual(["complete-problem"]);
}, 30000);
function smallExecutionSet() {
  const set = installedArtifactSet();
  const captured = copyReadUpdateArtifactSetSources(set);
  const name = set.shards[0]!.source;
  const manifest = JSON.parse(Buffer.from(captured.manifests[name]!.bytes).toString());
  manifest.scenarios = manifest.scenarios.filter(
    (r: { id: string }) => r.id === "read-update.singleton.create-bead",
  );
  const continuationName = set.shards[1]!.source;
  const continuation = JSON.parse(
    Buffer.from(captured.manifests[continuationName]!.bytes).toString(),
  );
  continuation.scenarios = continuation.scenarios.filter(
    (r: { id: string }) => r.id === continuationId,
  );
  const ids = new Set([manifest.scenarios[0].id, continuationId]);
  const coverage = JSON.parse(Buffer.from(captured.coverage.bytes).toString());
  coverage.rows = coverage.rows.map((row: { id: string }) =>
    ids.has(row.id)
      ? { ...row, wholeContract: false }
      : { ...row, status: "omitted", wholeContract: false, bindings: [] },
  );
  return createReadUpdateArtifactSet(loadProfileContractSelection("read-update"), {
    ...captured,
    coverage: { bytes: Buffer.from(JSON.stringify(coverage)) },
    manifests: {
      ...captured.manifests,
      [name]: { bytes: Buffer.from(JSON.stringify(manifest)) },
      [continuationName]: { bytes: Buffer.from(JSON.stringify(continuation)) },
    },
  });
}
it.each(["before-continuation", "after-continuation-launch", "during-continuation"] as const)(
  "drains actual segmented children on abort %s",
  async (when) => {
    const set = smallExecutionSet();
    const controller = new AbortController();
    const children: ChildProcess[] = [];
    const lifecycle = {
      launched(child: ChildProcess) {
        children.push(child);
      },
    };
    const first = await runShard(set, 0, controller.signal, lifecycle);
    expect(
      first.result.scenarios.find((r) => r.id === "read-update.singleton.create-bead")?.state,
    ).toBe("pass");
    const firstCount = children.length;
    if (when === "before-continuation") controller.abort(Error("bounded test abort"));
    let observations = 0;
    await expect(
      runShard(
        set,
        1,
        controller.signal,
        {
          launched(child) {
            lifecycle.launched(child);
            if (when === "after-continuation-launch") controller.abort(Error("bounded test abort"));
          },
          observed() {
            observations++;
            controller.abort(Error("bounded test abort"));
          },
        },
        first,
      ),
    ).rejects.toThrow("bounded test abort");
    expect(observations).toBe(when === "during-continuation" ? 1 : 0);
    expect(children.length).toBe(
      firstCount +
        (when === "before-continuation" ? 0 : when === "after-continuation-launch" ? 1 : 2),
    );
    for (const child of children)
      expect(child.exitCode === 0 || child.signalCode === "SIGTERM").toBe(true);
  },
  30000,
);
it("keeps dependent-only selection as an unexecuted runner prerequisite failure", async () => {
  const id = "read.discovery.canonical-navigation";
  const report = await run(undefined, [id]);
  expect(report.result.scenarios[0]).toMatchObject({
    state: "harness-error",
    category: "not-run",
    prerequisiteFailure: { reason: "prerequisite was not selected or did not run" },
  });
  expect(report.sessions).toEqual([]);
  expect(report.result.scenarios[0]!.exchanges).toEqual([]);
}, 30000);
it("blocks a same-shard dependent after an actually failed prerequisite", async () => {
  const manifest = JSON.parse(
    source("packages/conformance/matrices/read-update-v1.json").bytes.toString(),
  );
  const id = "read.discovery.scope-service-desc";
  const prerequisite = manifest.scenarios.find((r: { id: string }) => r.id === id);
  const status = prerequisite.actions[0].assertions.find(
    (a: { kind: string }) => a.kind === "status",
  );
  delete status.oneOf;
  status.equals = 599;
  const report = await run(manifest, [id, "read.discovery.canonical-navigation"]);
  expect(report.result.scenarios[0]!.state).toBe("fail");
  expect(report.result.scenarios[1]).toMatchObject({ state: "harness-error", category: "not-run" });
  expect(report.sessions).toHaveLength(1);
}, 30000);

it("checks the actual second bootstrap configuration before starting its scenario", async () => {
  const set = smallExecutionSet();
  const controller = new AbortController();
  const first = await runShard(set, 0, controller.signal);
  const children: ChildProcess[] = [];
  const mismatched = {
    configuration: first.configuration,
    baselineReceipt: { ...first.baselineReceipt, configurationIdentity: "0".repeat(64) },
  };
  await expect(
    runShard(
      set,
      1,
      controller.signal,
      {
        launched(child) {
          children.push(child);
        },
      },
      mismatched,
    ),
  ).rejects.toThrow();
  expect(children).toHaveLength(1);
  expect(children[0]!.exitCode === 0 || children[0]!.signalCode === "SIGTERM").toBe(true);
}, 30000);

it.each([
  "during-continuation",
  "before-continuation",
  "during-baseline",
  "startup-failure",
  "cleanup-failure",
] as const)(
  "retains actual artifact attempt evidence on %s",
  async (when) => {
    const directory = mkdtempSync(path.join(tmpdir(), "artifact-failure-evidence-"));
    const filename = path.join(directory, "summary.json");
    const children: ChildProcess[] = [];
    try {
      const set = smallExecutionSet();
      const controller = new AbortController();
      const original = Error("bounded original abort");
      const cleanup = Error("bounded cleanup failure");
      const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const writer = createArtifactEvidenceWriter(set, sourceCommit, filename, [token, wrongToken]);
      let actual: ArtifactObservation | undefined;
      const lifecycle = {
        launched(child: ChildProcess) {
          children.push(child);
          if (when === "startup-failure") throw original;
        },
        returned(report: ArtifactObservation) {
          expect(report.cleanupComplete).toBe(false);
          actual = report;
        },
      };
      let first: Awaited<ReturnType<typeof run>> | undefined;
      let caught: unknown;
      try {
        first = await runShard(
          set,
          0,
          controller.signal,
          {
            ...lifecycle,
            ...(when === "during-baseline"
              ? {
                  observed() {
                    controller.abort(original);
                  },
                }
              : {}),
          },
          undefined,
          writer,
        );
        expect(
          first.result.scenarios.find((r) => r.id === "read-update.singleton.create-bead")!.state,
        ).toBe("pass");
        if (when === "before-continuation") controller.abort(original);
        await runShard(
          set,
          1,
          controller.signal,
          {
            ...lifecycle,
            observed() {
              controller.abort(original);
            },
            ...(when === "cleanup-failure"
              ? {
                  afterClose() {
                    throw cleanup;
                  },
                }
              : {}),
          },
          first,
          writer,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      if (when === "cleanup-failure") {
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).cause).toBe(original);
        expect((caught as AggregateError).errors).toEqual([original, cleanup]);
      } else expect(caught).toBe(original);
      expect(existsSync(filename)).toBe(false);
      const attempt = JSON.parse(readFileSync(filename + ".attempt.json", "utf8"));
      expect(attempt).toMatchObject({ claimEligible: false, outcome: "failed" });
      if (when === "startup-failure") {
        expect(attempt.shards).toMatchObject([
          { status: "failed", evidence: "absent", cleanup: "complete" },
          { status: "unobserved", evidence: "absent", cleanup: "not-started" },
        ]);
        expect(existsSync(`${filename}.${set.shards[0]!.id}.json`)).toBe(false);
        expect(existsSync(`${filename}.${set.shards[1]!.id}.json`)).toBe(false);
        expect(children).toHaveLength(1);
        expect(children[0]!.exitCode === 0 || children[0]!.signalCode === "SIGTERM").toBe(true);
        return;
      }
      const baseline = JSON.parse(readFileSync(`${filename}.${set.shards[0]!.id}.json`, "utf8"));
      expect(baseline.result).toEqual(first?.result ?? actual!.result);
      expect(baseline.cleanupComplete).toBe(true);
      if (when === "during-baseline") {
        expect(attempt.shards[1]).toMatchObject({
          status: "unobserved",
          evidence: "absent",
          cleanup: "not-started",
        });
        expect(existsSync(`${filename}.${set.shards[1]!.id}.json`)).toBe(false);
      } else if (when === "before-continuation") {
        expect(attempt.shards[1]).toMatchObject({
          status: "aborted",
          evidence: "absent",
          cleanup: "not-started",
        });
        expect(existsSync(`${filename}.${set.shards[1]!.id}.json`)).toBe(false);
      } else {
        const partial = JSON.parse(readFileSync(`${filename}.${set.shards[1]!.id}.json`, "utf8"));
        expect(partial.result).toEqual(actual!.result);
        const mapped = attempt.requiredObservations.find(
          (r: { id: string }) => r.id === continuationId,
        );
        expect(mapped.observation).toMatchObject({
          shardId: set.shards[1]!.id,
          rowIndex: 0,
          state: partial.result.scenarios[0].state,
        });
        expect(partial.result.scenarios[0].state).not.toBe("pass");
        expect(partial.result.scenarios[0].actions.length).toBeGreaterThan(0);
        expect(partial.cleanupStatus).toBe(when === "cleanup-failure" ? "failed" : "complete");
        expect(attempt.shards[1]).toMatchObject({ status: "aborted", evidence: "retained" });
      }
      for (const child of children)
        expect(child.exitCode === 0 || child.signalCode === "SIGTERM").toBe(true);
      expect(children.length).toBeGreaterThan(0);
      expect(JSON.stringify(attempt)).not.toContain(token);
      expect(JSON.stringify(baseline)).not.toContain(token);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
it("retains actual returned continuation assertion failure without a successful summary", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "artifact-assertion-evidence-"));
  const filename = path.join(directory, "summary.json");
  const children: ChildProcess[] = [];
  try {
    const original = smallExecutionSet();
    const sources = copyReadUpdateArtifactSetSources(original);
    const name = original.shards[1]!.source;
    const manifest = JSON.parse(Buffer.from(sources.manifests[name]!.bytes).toString());
    const action = manifest.scenarios[0].actions.find((a: { assertions: { kind: string }[] }) =>
      a.assertions.some((r) => r.kind === "status"),
    );
    const status = action.assertions.find((r: { kind: string }) => r.kind === "status");
    delete status.oneOf;
    status.equals = 599;
    const set = createReadUpdateArtifactSet(loadProfileContractSelection("read-update"), {
      ...sources,
      manifests: { ...sources.manifests, [name]: { bytes: Buffer.from(JSON.stringify(manifest)) } },
    });
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const writer = createArtifactEvidenceWriter(set, sourceCommit, filename, [token, wrongToken]);
    const controller = new AbortController();
    const lifecycle = {
      launched(child: ChildProcess) {
        children.push(child);
      },
    };
    const first = await runShard(set, 0, controller.signal, lifecycle, undefined, writer);
    const second = await runShard(set, 1, controller.signal, lifecycle, first, writer);
    expect(second.result.scenarios[0]!.state).toBe("fail");
    expect(() => associateArtifactObservations(set, sourceCommit, [first, second])).toThrow(
      "owned outcome",
    );
    writer.failedSet();
    for (const [index, report] of [first, second].entries()) {
      const retained = JSON.parse(
        readFileSync(`${filename}.${set.shards[index]!.id}.json`, "utf8"),
      );
      expect(retained.result).toEqual(report.result);
      expect(retained.cleanupComplete).toBe(true);
    }
    expect(JSON.parse(readFileSync(filename + ".attempt.json", "utf8"))).toMatchObject({
      claimEligible: false,
      outcome: "failed",
      failureStage: "assertion",
    });
    expect(existsSync(filename)).toBe(false);
    for (const child of children)
      expect(child.exitCode === 0 || child.signalCode === "SIGTERM").toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "preserves actual abort and IO causes when returned-evidence persistence is denied",
  async () => {
    const { chmodSync } = await import("node:fs");
    const directory = mkdtempSync(path.join(tmpdir(), "native-abort-io-"));
    const filename = path.join(directory, "summary.json");
    const children: ChildProcess[] = [];
    const set = smallExecutionSet();
    const controller = new AbortController();
    const original = Error("native original cancellation");
    const writer = createArtifactEvidenceWriter(
      set,
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      filename,
      [token, wrongToken],
    );
    let caught: unknown;
    try {
      const first = await runShard(
        set,
        0,
        controller.signal,
        {
          launched(child) {
            children.push(child);
          },
        },
        undefined,
        writer,
      );
      const before = readFileSync(`${filename}.${set.shards[0]!.id}.json`, "utf8");
      try {
        await runShard(
          set,
          1,
          controller.signal,
          {
            launched(child) {
              children.push(child);
            },
            observed() {
              controller.abort(original);
              chmodSync(directory, 0o500);
            },
          },
          first,
          writer,
        );
      } catch (error) {
        caught = error;
      } finally {
        chmodSync(directory, 0o700);
      }
      const causes: unknown[] = [];
      const visit = (error: unknown) => {
        if (causes.includes(error)) return;
        causes.push(error);
        if (error instanceof Error && error.cause !== undefined) visit(error.cause);
        if (error instanceof AggregateError) error.errors.forEach(visit);
      };
      visit(caught);
      expect(readFileSync(`${filename}.${set.shards[0]!.id}.json`, "utf8")).toBe(before);
      expect(existsSync(filename)).toBe(false);
      expect(
        children.every((child) => child.exitCode === 0 || child.signalCode === "SIGTERM"),
      ).toBe(true);
      expect(
        causes.some(
          (error) => error instanceof Error && "code" in error && error.code === "EACCES",
        ),
      ).toBe(true);
      expect(causes).toContain(original);
    } finally {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);

const attributionId = "read-update.singleton.attribution";
const numericId = "read-update.numeric-model.same-value-no-op";
it.each([attributionId, numericId])(
  "observes installed attribution/numeric row %s",
  async (id) => {
    const manifest = JSON.parse(source(continuationSource).bytes.toString());
    const report = await run(manifest, [id]);
    expect(report.result.scenarios[0], JSON.stringify(report.result.scenarios[0])).toMatchObject({
      state: "pass",
    });
    expect(report.result.claimEligible).toBe(false);
    expect(report.cleanupComplete).toBe(true);
    if (id === numericId) {
      const raw = report.result.scenarios[0]!.exchanges.filter((e) => e.request.method === "POST");
      expect(raw).toHaveLength(10);
      for (const exchange of raw) {
        expect(exchange.request.exact).toMatchObject({
          source: "raw-http1-serializer",
          writeState: "complete",
          bodyPresent: true,
        });
        expect(exchange.request.exact).not.toHaveProperty("bodyDigest");
        expect(exchange.request.exact!.bodyOctets).toBeLessThan(4096);
      }
    }
    const filename = process.env.BDP_ATTRIBUTION_NUMERIC_REPORT_PATH;
    if (filename) {
      const safe = JSON.stringify(report, null, 2);
      expect(safe).not.toContain(token);
      expect(safe).not.toContain(wrongToken);
      writeFileSync(`${filename}.${id === attributionId ? "attribution" : "numeric"}.json`, safe);
    }
  },
  30000,
);

const attributionNumericControls: (RetryControl & { label: string; failed: string[] })[] = [
  {
    label: "minted actor basis",
    scenario: attributionId,
    action: "att-subject-metadata",
    path: ["body", "resource", "revisionProvenance", "actor", "basis"],
    value: "writer-supplied",
    failed: ["actor-only"],
  },
  {
    label: "owner attribution fanout",
    scenario: attributionId,
    action: "att-owned-create-owner",
    path: ["body", "revisionProvenance", "actor", "id"],
    value: "writer:wrong",
    failed: ["actor", "same-envelope"],
  },
  {
    label: "entire no-op context",
    scenario: attributionId,
    action: "att-subject-context-noop",
    path: ["body", "resource", "revisionProvenance", "message", "value"],
    value: "changed despite no-op",
    failed: ["postimage"],
  },
  {
    label: "omitted envelope",
    scenario: attributionId,
    action: "att-subject-absence-0",
    path: ["body", "resource", "revisionProvenance"],
    value: { actor: { id: "writer:injected", basis: "unknown" } },
    failed: ["no-provenance"],
  },
  {
    label: "context-only absent actor",
    scenario: attributionId,
    action: "att-unowned-absence-3",
    path: ["body", "resource", "revisionProvenance", "actor"],
    value: { id: "writer:injected", basis: "unknown" },
    failed: ["actor"],
  },
  {
    label: "owned inline Link",
    scenario: attributionId,
    action: "att-owned-properties-owner",
    path: ["body", "ownedLinks", `${scope}types/relates`, "0", "properties", "n"],
    value: 999,
    failed: ["inline-link"],
  },
  {
    label: "unchanged target",
    scenario: attributionId,
    action: "att-owned-create-target",
    path: ["body", "properties", "target"],
    value: "mutated",
    failed: ["postimage"],
  },
  {
    label: "deletion owner attribution",
    scenario: attributionId,
    action: "att-owned-delete-owner",
    path: ["body", "revisionProvenance"],
    binding: "att-owned-metadata-owner-provenance",
    failed: ["actor", "agent", "message"],
  },
  {
    label: "numeric no-op revision",
    scenario: numericId,
    action: "num-subject-current-noop",
    path: ["body", "resource", "revision"],
    value: "opaque-corruption",
    failed: ["postimage"],
  },
  {
    label: "numeric no-op GET envelope",
    scenario: numericId,
    action: "num-subject-decimal-read",
    path: ["body", "revisionProvenance", "actor", "id"],
    value: "writer:corruption",
    failed: ["postimage"],
  },
  {
    label: "numeric real change old state",
    scenario: numericId,
    action: "num-subject-properties-change",
    path: ["body", "resource"],
    binding: "num-subject-initial",
    failed: ["properties", "actor-only"],
  },
  {
    label: "numeric refusal unchanged GET",
    scenario: numericId,
    action: "num-subject-after-inadmissible",
    path: ["body", "metadata", "number"],
    value: 99,
    failed: ["postimage"],
  },
];
it.each(attributionNumericControls)(
  "detects attribution/numeric post-wire $label",
  async (control) => {
    const manifest = JSON.parse(source(continuationSource).bytes.toString());
    const report = await run(
      manifest,
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
    expect(report.cleanupComplete).toBe(true);
    const row = report.result.scenarios[0]!;
    expect(row.state).toBe("fail");
    expect(
      row.actions
        ?.find((a) => a.action.id === control.action)
        ?.assertions.filter((a) => !a.passed)
        .map((a) => a.id),
    ).toEqual(control.failed);
  },
  30000,
);
it.each([
  { mode: "digest", action: "num-subject-decimal", failed: ["authored-body"] },
  { mode: "changed-number", action: "num-subject-decimal", failed: ["authored-body", "postimage"] },
  {
    mode: "refusal-success",
    action: "num-subject-inadmissible",
    failed: ["status", "body-schema", "complete-problem"],
  },
] as const)(
  "detects attribution/numeric exact raw $mode",
  async ({ mode, action, failed }) => {
    const manifest = JSON.parse(source(continuationSource).bytes.toString());
    const report = await run(
      manifest,
      [numericId],
      false,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mode,
    );
    expect(report.counterfactualApplications).toBe(1);
    expect(report.cleanupComplete).toBe(true);
    const row = report.result.scenarios[0]!;
    expect(row.state).toBe("fail");
    expect(
      row.exchanges
        .find((e) => e.request.id === action)
        ?.assertions.filter((a) => !a.passed)
        .map((a) => a.id),
    ).toEqual(failed);
  },
  30000,
);

it("pins attribution/numeric source budgets, raw literals and prior scenario bytes", () => {
  const bytes = source(continuationSource).bytes;
  const manifest = JSON.parse(bytes.toString());
  const fixtureBytes = source("packages/conformance/fixtures/read-update-reference-v1.json").bytes;
  const coverageBytes = source(
    "packages/conformance/test-support/read-update-coverage-v1.json",
  ).bytes;
  const nodes = (value: unknown): number =>
    1 +
    (value !== null && typeof value === "object"
      ? Object.values(value).reduce<number>((sum, entry) => sum + nodes(entry), 0)
      : 0);
  expect(bytes.length - 114182).toBeLessThanOrEqual(650 * 1024);
  expect(nodes(manifest) - 3158).toBeLessThanOrEqual(24000);
  expect(fixtureBytes.length - 28753).toBeLessThanOrEqual(32768);
  expect(coverageBytes.length - 590847).toBeLessThanOrEqual(65536);
  expect(
    createHash("sha256")
      .update(source("packages/conformance/matrices/read-update-v1.json").bytes)
      .digest("hex"),
  ).toBe("c86b33535f25a1d117ce021a3bb70164f5635bdaee50758e3428c130ccc3227f");
  const text = bytes.toString();
  const start = text.lastIndexOf(
    "    {",
    text.indexOf('      "id": "read-update.alias.unknown-subject"'),
  );
  const end = text.indexOf("\n    },\n    {", start) + "\n    }".length;
  expect(createHash("sha256").update(text.slice(start, end)).digest("hex")).toBe(
    "39eb2fe22d25eada2c43490f37b6cb5d66950bd90042af1ae954036426e07f2a",
  );
  const set = installedArtifactSet();
  expect(set.shards[1]!.scenarioIds).toEqual([attributionId, continuationId, numericId]);
  const keys: string[] = [];
  let totalActions = 0;
  for (const [id, count, ids] of [
    [
      attributionId,
      69,
      [
        "beads/att-subject",
        "beads/att-owner",
        "beads/att-target",
        "links/att-unowned",
        "links/att-owned",
      ],
    ],
    [numericId, 73, ["beads/num-subject", "beads/num-target", "links/num-link"]],
  ] as const) {
    const row = set.shards[1]!.bundle.manifest.scenarios.find((r) => r.id === id)!;
    expect(row.actions).toHaveLength(count);
    expect(row.actions!.length).toBeLessThanOrEqual(75);
    totalActions += row.actions!.length;
    const created: unknown[] = [];
    for (const action of row.actions!) {
      if (action.family === "client") {
        const input = action.input as {
          method: string;
          idempotencyKey?: string;
          body?: { id?: string };
          targetBinding: string;
        };
        if (input.method === "POST") {
          keys.push(input.idempotencyKey!);
          expect(Buffer.byteLength(JSON.stringify(input.body))).toBeLessThan(4096);
          if (input.targetBinding.startsWith("create-")) created.push(input.body!.id);
        }
      } else if (action.family === "http" && action.method === "POST") {
        keys.push(
          action.raw!.headerLines.find((h) => h.name.toLowerCase() === "idempotency-key")!.value,
        );
        expect(action.raw!.body!.encoding).toBe("utf8");
        expect(Buffer.byteLength(action.raw!.body!.value)).toBeLessThan(4096);
        expect(action.assertions.filter((a) => a.kind === "request-authored-body")).toHaveLength(1);
        expect(action.assertions).toContainEqual({
          id: "complete-write",
          kind: "request-write-state",
          equals: "complete",
        });
      }
    }
    expect(created).toEqual(ids);
    const coverage = set.coverage.rows.find((r) => r.id === id)!;
    expect(coverage.wholeContract).toBe(false);
    expect(coverage.bindings).toEqual([
      {
        scenario: id,
        assertions: row.actions!.flatMap((a) => a.assertions.map((q) => `${a.id}.${q.id}`)),
      },
    ]);
  }
  expect(totalActions).toBeLessThanOrEqual(150);
  expect(new Set(keys).size).toBe(keys.length);
  const numeric = manifest.scenarios.find((r: { id: string }) => r.id === numericId);
  for (const name of ["subject", "link"]) {
    const raw = (id: string) =>
      numeric.actions.find((a: { id: string }) => a.id === `num-${name}-${id}`).raw.body
        .value as string;
    expect(raw("decimal")).toContain('"one":1.0');
    expect(raw("decimal")).toContain('"large":1E300');
    expect(raw("decimal")).toContain('"zero":-0.0');
    expect(raw("exponent")).toContain('"one":1e0');
    expect(raw("exponent")).toContain('"large":1' + "0".repeat(300));
    expect(raw("inadmissible")).toContain('"bad":9007199254740993');
  }
  expect(attributionNumericControls.length + 3).toBeLessThanOrEqual(16);
});
