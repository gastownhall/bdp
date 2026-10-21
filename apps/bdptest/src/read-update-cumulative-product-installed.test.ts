/** Replacement selected-configuration carrier. No protocol/profile award is made here. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  createRawHttpScenarioTarget,
  type ExactHttpModeOptions,
  runConformanceMatrix,
} from "@bdp/conformance";
import {
  assertSameServedProfileConfiguration,
  bindServedProfileConfiguration,
  createReadUpdateArtifactSet,
  loadProfileContractSelection,
  planProfileExecution,
} from "@bdp/conformance/testing";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import { installedContractsDigest } from "../test-support/installed-contract-identity.js";
import {
  exactNativeReadAdapter,
  seedInstalledReadFixture,
} from "../test-support/installed-read-fixture.js";
import {
  type ArtifactEvidenceWriter,
  type ArtifactObservation,
  artifactRoutes,
  associateArtifactObservations,
  createArtifactEvidenceWriter,
} from "../test-support/read-update-artifact-execution.js";
import { createCumulativeRUClient } from "../test-support/read-update-cumulative-product-client.js";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-product-configuration.js";
import { cumulativeRUObservationSchema } from "../test-support/read-update-cumulative-product-schema.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_RU_CUMULATIVE_INSTALLED_ENTRY;
const build = process.env.BDP_RU_CUMULATIVE_BUILD;
const evidenceDirectory = process.env.BDP_RU_CUMULATIVE_EVIDENCE;
const credentialFile = process.env.BDP_RU_CUMULATIVE_CREDENTIALS;
const targetedFile = process.env.BDP_RU_CUMULATIVE_TARGETED_IDS;
const sourceCommit = "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c";
const scope = "https://reference.invalid/acme/";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const source = (name: string) => ({ bytes: readFileSync(path.join(root, name)) });
const base = "apps/bdptest/test-support/read-update-cumulative-product-";
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
type Serving = Awaited<ReturnType<typeof helpers.launchInstalledReference>>;
type Binding = ReturnType<typeof bindServedProfileConfiguration>;
type Report = ArtifactObservation & {
  observations: unknown[];
  setupObservations: unknown[];
  nativeReadObservations: unknown[];
  processes: Record<string, unknown>[];
};
function artifactSet() {
  return createReadUpdateArtifactSet(loadProfileContractSelection("read-update"), {
    index: source(`${base}index.json`),
    fixture: source(`${base}fixture.json`),
    coverage: source(`${base}coverage.json`),
    manifests: {
      "matrices/read-update-cumulative-product-baseline.json": source(`${base}baseline.json`),
      "matrices/read-update-cumulative-product-continuation.json": source(
        `${base}continuation.json`,
      ),
    },
  });
}

it.skipIf(!entry)(
  "executes the new two-shard fixed-configuration packed RU carrier",
  async () => {
    if (!entry || !build || !evidenceDirectory || !credentialFile)
      throw Error("explicit packed carrier inputs required");
    const credentials = JSON.parse(readFileSync(credentialFile, "utf8")) as RUCampaignCredentials;
    const secrets = Object.values(credentials);
    if (
      Object.keys(credentials).sort().join() !== "operator,other,restricted" ||
      secrets.some((secret) => typeof secret !== "string" || secret.length < 32) ||
      new Set(secrets).size !== 3
    )
      throw Error("three distinct owned campaign credentials required");
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(Error("RU aggregate 90000ms budget exceeded")),
      90000,
    );
    const failures: unknown[] = [];
    let evidence: ArtifactEvidenceWriter | undefined;
    const reports: Report[] = [];
    const moduleBindings: { name: string; bytes: number; sha256: string }[] = [];
    let completed = false;
    try {
      const installed = path.dirname(entry);
      for (const name of readdirSync(build)
        .filter((name) => name.endsWith(".js"))
        .sort()) {
        const actual = readFileSync(path.join(installed, name));
        expect(actual.equals(readFileSync(path.join(build, name))), name).toBe(true);
        moduleBindings.push({ name, bytes: actual.length, sha256: sha(actual) });
      }
      const schema = readFileSync(
        path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"),
      );
      expect(schema.equals(readFileSync(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
      moduleBindings.push({
        name: "@bdp/protocol/schemas/bdp-v0.schema.json",
        bytes: schema.length,
        sha256: sha(schema),
      });
      const runtime = (await import(
        pathToFileURL(path.join(installed, "installed-reference-configuration.js")).href
      )) as {
        referenceTypeArtifacts(scope: string): TypeDescriptor[];
        captureInstalledReferenceConfiguration(config: unknown): {
          identity: string;
          artifactIdentity: string;
          policyIdentity: string;
          authenticationIdentity: string;
        };
      };
      const descriptors = runtime.referenceTypeArtifacts(scope);
      const set = artifactSet();
      const targeted: string[] | undefined = targetedFile
        ? JSON.parse(readFileSync(targetedFile, "utf8"))
        : undefined;
      if (
        targeted &&
        (!Array.isArray(targeted) ||
          targeted.length === 0 ||
          new Set(targeted).size !== targeted.length ||
          targeted.some(
            (id) =>
              typeof id !== "string" || !set.shards.some((shard) => shard.scenarioIds.includes(id)),
          ))
      )
        throw Error("invalid explicit targeted diagnostic selection");
      evidence = createArtifactEvidenceWriter(
        set,
        sourceCommit,
        path.join(evidenceDirectory, "carrier.json"),
        secrets,
      );
      const validator = createJsonSchemaValidator(cumulativeRUObservationSchema);
      const timing: Record<string, unknown>[] = [];
      for (let index = 0; index < set.shards.length; index++) {
        controller.signal.throwIfAborted();
        const shard = set.shards[index]!;
        const selectedIds = targeted
          ? shard.scenarioIds.filter((id) => targeted.includes(id))
          : [...shard.scenarioIds];
        if (selectedIds.length === 0) continue;
        const begin = performance.now();
        const remaining = Math.max(0, 90000 - (begin - started));
        evidence.start(index);
        evidence.timed(index, {
          budgetRemainingMsAtStart: remaining,
          elapsedMs: begin - started,
          outcome: "running",
        });
        const directory = mkdtempSync(path.join(tmpdir(), "bdp-ru-cumulative-carrier-"));
        const processes: Record<string, unknown>[] = [];
        const observations: unknown[] = [],
          setupObservations: unknown[] = [],
          nativeReadObservations: unknown[] = [];
        const errors: unknown[] = [];
        const closers: (() => Promise<void>)[] = [];
        let report: Report | undefined;
        let current = "bootstrap";
        let target: ReturnType<typeof createRawHttpScenarioTarget> | undefined;
        try {
          const port = await helpers.availablePort();
          const dialRoute = { transport: "plain" as const, host: "127.0.0.1", port };
          const configuration = (name: string) =>
            cumulativeRUConfiguration(
              {
                scope,
                directory: path.join(directory, name),
                create: true,
                listener: { host: "127.0.0.1", port },
              },
              descriptors,
              credentials,
            );
          const expected = runtime.captureInstalledReferenceConfiguration(
            configuration("bootstrap"),
          );
          const mode: ExactHttpModeOptions = {
            scope,
            profile: "read-update",
            routes: artifactRoutes(shard.bundle, scope),
            // Only the genuine request-size refusal probes exceed the installed65536 bound.
            maximumRequestBodyBytes: 131072,
            maximumRequestHeaderBytes: 16384,
            defaultCredentialRef: "operator",
            credentialHandles: [
              ...["operator", "restricted", "other"].map((id) => ({
                id,
                headerNames: ["authorization"],
              })),
              { id: "anonymous", headerNames: [] },
              { id: "unknown", headerNames: ["authorization"] },
            ],
            resolveCredentials: ({ credentialRef }) => {
              if (credentialRef === "anonymous") return {};
              if (credentialRef === "unknown")
                return { authorization: "Bearer deliberately-unrecognized-ru-credential" };
              if (!Object.hasOwn(credentials, credentialRef))
                throw Error("unselected credential handle");
              return {
                authorization: `Bearer ${credentials[credentialRef as keyof RUCampaignCredentials]}`,
              };
            },
          };
          function bind(ready: Record<string, unknown>): Binding {
            expect(ready).toMatchObject({
              scope,
              profile: "read-update",
              history: false,
              configurationIdentity: expected.identity,
              artifactIdentity: expected.artifactIdentity,
              policyIdentity: expected.policyIdentity,
              authenticationIdentity: expected.authenticationIdentity,
            });
            return bindServedProfileConfiguration({
              scope,
              profile: "read-update",
              history: false,
              sourceCommit,
              installedPayloadDigest: ready.payloadIdentity as string,
              installedContractsDigest: installedContractsDigest(ready.artifactIdentity),
              policyDigest: ready.policyIdentity as string,
              authenticationDigest: ready.authenticationIdentity as string,
              fixture: source(`${base}fixture.json`),
            });
          }
          function owned(child: Serving, scenario: string) {
            evidence!.acquired(index);
            const terminal: Record<string, unknown> = {
              scenario,
              pid: child.child.pid,
              closeObserved: false,
            };
            processes.push(terminal);
            const closed = new Promise<void>((resolve) =>
              child.child.once("close", (code: number | null, signal: string | null) => {
                Object.assign(terminal, {
                  code,
                  signal,
                  closeObserved: true,
                  stdoutEOF: child.child.stdout?.readableEnded,
                  stderrEOF: child.child.stderr?.readableEnded,
                });
                resolve();
              }),
            );
            let finishing: Promise<void> | undefined;
            const finish = () =>
              (finishing ??= (async () => {
                const errors: unknown[] = [];
                try {
                  await child.close();
                } catch (error) {
                  errors.push(error);
                  if (child.child.exitCode === null && child.child.signalCode === null) {
                    terminal.forcedCleanupSignal = "SIGKILL";
                    child.child.kill("SIGKILL");
                  }
                }
                try {
                  await Promise.race([
                    closed,
                    new Promise<never>((_resolve, reject) => {
                      const timer = setTimeout(
                        () => reject(Error("owned child close deadline")),
                        10000,
                      );
                      closed.finally(() => clearTimeout(timer)).catch(() => undefined);
                    }),
                  ]);
                } catch (error) {
                  errors.push(error);
                }
                if (
                  terminal.closeObserved !== true ||
                  terminal.stdoutEOF !== true ||
                  terminal.stderrEOF !== true
                )
                  errors.push(Error("owned installed child did not fully close"));
                if (terminal.code !== 0 || terminal.signal !== null)
                  errors.push(Error("unexpected installed terminal result"));
                if (errors.length)
                  throw new AggregateError(errors, "installed child cleanup failed");
              })());
            closers.push(finish);
            return finish;
          }
          const bootstrap = await helpers.launchInstalledReference(
            entry,
            configuration("bootstrap"),
          );
          const closeBootstrap = owned(bootstrap, "bootstrap");
          let baseline!: Binding;
          const baselineReceipt = bootstrap.ready as Record<string, unknown>;
          const bootstrapErrors: unknown[] = [];
          try {
            baseline = bind(baselineReceipt);
            if (reports[0])
              assertSameServedProfileConfiguration(reports[0].configuration, baseline);
          } catch (error) {
            bootstrapErrors.push(error);
          }
          try {
            await closeBootstrap();
          } catch (error) {
            bootstrapErrors.push(error);
          }
          if (bootstrapErrors.length) throw new AggregateError(bootstrapErrors, "bootstrap failed");
          const plan = planProfileExecution(loadProfileContractSelection("read-update"), baseline, {
            configuration: baseline,
            manifest: source(`${base}${index === 0 ? "baseline" : "continuation"}.json`),
          });
          const sessions: Record<string, unknown>[] = [];
          let restartCurrent: (() => Promise<unknown>) | undefined;

          target = createRawHttpScenarioTarget(
            async (scenario, _scope, _seed, fixture, signal) => {
              current = scenario.id;
              signal.throwIfAborted();
              const child = await helpers.launchInstalledReference(
                entry,
                configuration(scenario.id),
              );
              let close = owned(child, scenario.id);
              let reopens = 0;
              restartCurrent = async () => {
                if (++reopens !== 1) throw Error("only one declared normal reopen per scenario");
                controller.signal.throwIfAborted();
                await close();
                const reopened = await helpers.launchInstalledReference(entry, {
                  ...configuration(scenario.id),
                  create: false,
                });
                close = owned(reopened, `${scenario.id}@reopen`);
                assertSameServedProfileConfiguration(baseline, bind(reopened.ready));
                const actual = {
                  scenario: scenario.id,
                  operation: "normal-close-and-reopen",
                  ready: reopened.ready,
                };
                observations.push(actual);
                return actual;
              };
              try {
                assertSameServedProfileConfiguration(baseline, bind(child.ready));
                sessions.push({ scenario: scenario.id, ...child.ready });
                if (
                  Array.isArray(fixture.readSeedScenarios) &&
                  fixture.readSeedScenarios.includes(scenario.id)
                )
                  await seedInstalledReadFixture(
                    fixture,
                    scope,
                    createRawHttpExchangeExecutor(dialRoute, { exactMode: mode }),
                    signal,
                    (observation) => setupObservations.push({ scenario: current, observation }),
                  );
                return {
                  capabilities: fixture.capabilities,
                  bindings: fixture.bindings,
                  dialRoute,
                  close: () => close(),
                };
              } catch (error) {
                try {
                  await close();
                } catch (cleanup) {
                  throw new AggregateError([error, cleanup], "scenario setup and cleanup failed", {
                    cause: error,
                  });
                }
                throw error;
              }
            },
            { exactMode: mode, requestTimeoutMs: 5000 },
          );
          if (!target.exactConfiguration) throw Error("actual exact configuration missing");
          const executeClient = createCumulativeRUClient(mode, dialRoute, (observation) =>
            observations.push({ scenario: current, observation }),
          );
          const result = await runConformanceMatrix({
            scope,
            profile: "read-update",
            seed: 0,
            signal: controller.signal,
            artifactBundle: shard.bundle,
            scenarioSelection: selectedIds,
            execute: exactNativeReadAdapter(target.execute, (observation) =>
              nativeReadObservations.push({ scenario: current, observation }),
            ),
            exactExecution: { execute: target.execute, configuration: target.exactConfiguration },
            actionExecutor: async (execution) => {
              if (
                execution.family === "lifecycle" &&
                execution.operation === "cumulative.restart"
              ) {
                if (
                  execution.scope !== scope ||
                  execution.input === null ||
                  typeof execution.input !== "object" ||
                  Array.isArray(execution.input) ||
                  Object.keys(execution.input).length !== 0 ||
                  !restartCurrent
                )
                  throw Error("unbound ordinary reopen request");
                return restartCurrent();
              }
              return executeClient(execution);
            },
            harness: target.harness,
            schemaValidator: validator,
            declaredTargetLabel: "packed-fixed-configuration-cumulative-ru-candidate",
          });
          report = {
            sourceCommit,
            configuration: baseline,
            baselineReceipt,
            sessions,
            result,
            exactConfiguration: target.exactConfiguration,
            plannedManifestDigest: plan.manifestDigest,
            catalogSources: loadProfileContractSelection("read-update").catalogDigests,
            plannedIds: selectedIds,
            requiredIds: set.requirements.map((row) => row.id),
            cleanupComplete: false,
            observations,
            setupObservations,
            nativeReadObservations,
            processes,
          };
          evidence.returned(index, report);
        } catch (error) {
          errors.push(error);
        }
        try {
          await target?.close();
        } catch (error) {
          errors.push(error);
        }
        for (const close of closers) {
          try {
            await close();
          } catch (error) {
            errors.push(error);
          }
        }
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (error) {
          errors.push(error);
        }
        const cleanupComplete =
          !existsSync(directory) &&
          processes.every(
            (row) => row.closeObserved === true && row.stdoutEOF === true && row.stderrEOF === true,
          ) &&
          (!report || report.result.scenarios.every((row) => row.cleanupError === undefined));
        if (report) {
          report = { ...report, cleanupComplete };
          evidence.returned(index, report);
          reports.push(report);
        }
        evidence.cleaned(index, cleanupComplete ? "complete" : "failed");
        const passed =
          errors.length === 0 &&
          !!report &&
          report.result.scenarios.every((row) => row.state === "pass");
        evidence.timed(index, {
          budgetRemainingMsAtStart: remaining,
          elapsedMs: performance.now() - started,
          outcome: controller.signal.aborted ? "aborted" : passed ? "pass" : "failed",
        });
        timing.push({
          id: shard.id,
          budgetRemainingMsAtStart: remaining,
          elapsedMs: performance.now() - begin,
          passed,
        });
        if (errors.length) {
          evidence.failed(index, controller.signal.aborted);
          throw new AggregateError(errors, "RU shard execution/cleanup failed");
        }
        if (!passed) {
          evidence.failed(index, controller.signal.aborted);
          throw Error(`RU shard ${shard.id} did not pass`);
        }
      }
      controller.signal.throwIfAborted();
      if (!targeted) {
        const progress = associateArtifactObservations(set, sourceCommit, reports, {
          credentialHandles: [
            ...["operator", "restricted", "other"].map((id) => ({
              id,
              headerNames: ["authorization"],
            })),
            { id: "anonymous", headerNames: [] },
            { id: "unknown", headerNames: ["authorization"] },
          ],
          selectionModes: set.shards.map((shard) => ({
            id: shard.id,
            mode: "owned-exact" as const,
          })),
        });
        evidence.succeeded({
          claimEligible: false,
          sourceCommit,
          status: "BOUNDED_INSTALLED_CARRIER_NOT_PROFILE_QUALIFICATION",
          progress,
          moduleBindings,
          timing,
          aggregateElapsedMs: performance.now() - started,
          aggregateBudgetMs: 90000,
          required: set.requirements.length,
          represented: set.shards.reduce((n, shard) => n + shard.scenarioIds.length, 0),
          fullClauseReviewStillRequired: true,
        });
      } else {
        writeFileSync(
          path.join(evidenceDirectory, "targeted-summary.json"),
          JSON.stringify(
            {
              status: "TARGETED_FAILED_OR_UNRUN_REVALIDATION_ONLY",
              claimEligible: false,
              targetedFile,
              requestedIds: targeted,
              observedIds: reports.flatMap((report) =>
                report.result.scenarios.map((row) => row.id),
              ),
              fullAssociationNotAttempted: true,
              sourceCommit,
              elapsedMs: performance.now() - started,
            },
            null,
            2,
          ) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      }
      completed = true;
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(timer);
    }
    if (!completed) {
      try {
        evidence?.failedSet();
      } catch (error) {
        failures.push(error);
      }
    }
    // Persist causes even if qualification result assertions or cleanup fail.
    const serialized =
      JSON.stringify(
        {
          completed,
          sourceCommit,
          moduleBindings,
          failures: failures.map((error) => inspect(error, { depth: 12 })),
          elapsedMs: performance.now() - started,
          aborted: controller.signal.aborted,
        },
        null,
        2,
      ) + "\n";
    let redacted = serialized;
    for (const secret of secrets)
      redacted = redacted.replaceAll(secret, "[REDACTED-owned-credential]");
    if (redacted !== serialized)
      writeFileSync(path.join(evidenceDirectory, "completion.private.json"), serialized, {
        flag: "wx",
        mode: 0o600,
      });
    writeFileSync(path.join(evidenceDirectory, "completion.json"), redacted, {
      flag: "wx",
      mode: 0o600,
    });
    if (failures.length) throw new AggregateError(failures, "new RU cumulative carrier failed");
  },
  120000,
);
