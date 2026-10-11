import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadUpdateFetchTransport } from "@bdp/client";
import {
  runConformanceMatrix,
  type ConformanceArtifactBundle,
  type ScenarioActionExecution,
  type ScenarioActionExecutor,
} from "@bdp/conformance";
import { createDevelopmentReadUpdateArtifactBundle } from "@bdp/conformance/testing";
import { startDevelopmentReferenceServer } from "@bdp/server/development";
import { describe, expect, it } from "vitest";
import { createDevelopmentProcessActions } from "../test-support/development-process-actions.js";
import { executeDevelopmentRawAction } from "../test-support/development-raw-actions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const token = "development_matrix_local_credential_0123456789";
async function artifacts() {
  const source = async (name: string) => ({
    bytes: await readFile(path.join(root, "packages/conformance/development", name)),
  });
  return {
    catalog: await source("read-update-catalog-v1.json"),
    manifest: await source("read-update-manifest-v1.json"),
    fixture: await source("read-update-fixture-v1.json"),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("development action input must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("development action needs a string");
  return value;
}

/** Observation only: the shared runner evaluates every authored assertion. */
function developmentActions(
  processes: ReturnType<typeof createDevelopmentProcessActions>,
): ScenarioActionExecutor {
  async function request(execution: ScenarioActionExecution, second = false) {
    const input = record(execution.input);
    const transport = createReadUpdateFetchTransport({
      scope: execution.scope,
      credential: () => token,
      limits: {
        requestBodyBytes: 128 * 1024,
        responseBodyBytes: 2 * 1024 * 1024,
        responseTimeoutMs: 5000,
        cleanupTimeoutMs: 1000,
      },
    });
    const target = new URL(
      string(
        input.targetBinding === undefined
          ? input.target
          : execution.bindings[string(input.targetBinding)],
      ),
      execution.scope,
    ).href;
    if (!target.startsWith(execution.scope)) throw new Error("action target escaped the Scope");
    if (
      input.resolveAlias === true &&
      (input.method !== "GET" || !target.startsWith(`${execution.scope}alias/`))
    )
      throw new Error("alias observation requires GET at the current Scope's alias root");
    const get = input.resolveAlias === true ? transport.resolveAlias : transport.get;
    if (get === undefined) throw new Error("transport lacks alias resolution");
    const body = structuredClone(record(second ? input.secondBody : (input.body ?? {})));
    if (input.referenceBindings !== undefined)
      for (const [field, binding] of Object.entries(record(input.referenceBindings)))
        body[field] = string(execution.bindings[string(binding)]);
    if (input.absoluteReferences !== undefined) {
      if (!Array.isArray(input.absoluteReferences)) throw new Error("expected reference fields");
      for (const field of input.absoluteReferences.map(string)) {
        const value = body[field];
        body[field] =
          typeof value === "string"
            ? new URL(value, execution.scope).href
            : { ...record(value), uri: new URL(string(record(value).uri), execution.scope).href };
      }
    }
    if (input.expectedRevisionBinding !== undefined)
      body.expectedRevision = string(execution.bindings[string(input.expectedRevisionBinding)]);
    const key = input.key === undefined ? undefined : string(input.key);
    const response =
      input.method === "GET"
        ? await get(target, { signal: execution.signal })
        : input.method === "POST"
          ? await transport.post(target, {
              bodyText: JSON.stringify(body),
              ...(key === undefined
                ? {}
                : {
                    idempotencyKey:
                      execution.operation === "development.race"
                        ? `${key}-${second ? "second" : "first"}`
                        : key,
                  }),
              signal: execution.signal,
            })
          : undefined;
    if (response === undefined) throw new Error("unsupported development method");
    const identity =
      input.observeIdentity === true && response.kind === "json"
        ? string(record(record(response.body).resource).id)
        : undefined;
    const segments = identity?.slice(execution.scope.length).split("/");
    return {
      ...(identity === undefined || segments === undefined
        ? {}
        : {
            identity: {
              urlSerializationStable: new URL(identity).href === identity,
              ...(input.excludedIdentity === undefined
                ? {}
                : {
                    differsFromExcludedIdentity:
                      identity !== new URL(string(input.excludedIdentity), execution.scope).href,
                  }),
              inScope: identity.startsWith(execution.scope),
              root: segments[0],
              childSegments: segments.length - 1,
              emptySegments: segments.filter((value) => value.length === 0).length,
            },
          }),
      status: response.status,
      headers: response.headers,
      ...(response.kind === "json" ? { body: response.body } : {}),
    };
  }
  return async (execution) => {
    if (execution.family === "lifecycle") return processes.execute(execution);
    if (execution.family !== "client") throw new Error("unsupported development action family");
    if (execution.operation === "development.raw")
      return executeDevelopmentRawAction(execution, token);
    if (execution.operation === "development.request") return request(execution);
    if (execution.operation === "development.race")
      return Promise.all([request(execution), request(execution, true)]);
    throw new Error("unsupported development action");
  };
}

async function runDevelopmentMatrix(
  bundle: ConformanceArtifactBundle,
  selection?: string[],
  controls: {
    signal?: AbortSignal;
    afterAction?: (execution: ScenarioActionExecution) => void;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-development-matrix-"));
  let server: Awaited<ReturnType<typeof startDevelopmentReferenceServer>> | undefined;
  const processes = createDevelopmentProcessActions(token);
  try {
    server = await startDevelopmentReferenceServer({
      directory: path.join(directory, "bootstrap"),
      port: 0,
      create: true,
      token,
    });
    const scope = server.scope;
    const port = Number(new URL(scope).port);
    await server.close();
    server = undefined;
    const executeAction = developmentActions(processes);
    const result = await runConformanceMatrix({
      scope,
      profile: "read-update",
      seed: 0,
      artifactBundle: bundle,
      execute: async () => {
        throw new Error("development manifest must use the SDK action lane");
      },
      actionExecutor: async (execution) => {
        const observation = await executeAction(execution);
        controls.afterAction?.(execution);
        return observation;
      },
      ...(controls.signal === undefined ? {} : { signal: controls.signal }),
      declaredTargetLabel: "development-only-non-attesting-bdptest",
      ...(selection === undefined ? {} : { scenarioSelection: selection }),
      harness: {
        async prepare(scenario, _scope, _seed, fixture) {
          if (scenario.setup.requires.includes("development-retention-process"))
            await processes.prepare(path.join(directory, scenario.id), port, true);
          else if (scenario.setup.requires.includes("development-process"))
            await processes.prepare(path.join(directory, scenario.id), port);
          else
            server = await startDevelopmentReferenceServer({
              directory: path.join(directory, scenario.id),
              port,
              create: true,
              token,
            });
          return { capabilities: fixture.capabilities };
        },
        async cleanup() {
          await processes.close();
          await server?.close();
          server = undefined;
        },
      },
    });
    return result;
  } finally {
    await processes.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe("DEVELOPMENT ONLY: non-attesting Read+Update contract observations", () => {
  // The complete matrix starts several child processes and performs hundreds of actions.
  // Its aggregate budget is separate from unchanged action, HTTP, IPC and cleanup deadlines.
  it("executes every diagnostic binding against real HTTP, raw receiving and controlled process observations", async () => {
    const bundle = createDevelopmentReadUpdateArtifactBundle(await artifacts());
    const result = await runDevelopmentMatrix(bundle);
    expect(result.claimEligible).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.scenarios.map(({ id }) => id)).toEqual(
      bundle.manifest.scenarios.map(({ id }) => id),
    );
    for (const scenario of result.scenarios)
      expect(scenario, JSON.stringify(scenario)).toMatchObject({ state: "pass" });
    // Opt-in report is a diagnostic run, never a cohort or profile admission input.
    if (process.env.BDP_DEVELOPMENT_REPORT_PATH)
      await writeFile(
        process.env.BDP_DEVELOPMENT_REPORT_PATH,
        `${JSON.stringify(result, null, 2)}\n`,
      );
  }, 30_000);

  it("contains raw fixture requests to the current loopback Scope and fixed credentials", async () => {
    const execution: ScenarioActionExecution = {
      family: "client",
      operation: "development.raw",
      scope: "https://example.invalid/",
      bindings: {},
      signal: new AbortController().signal,
      input: { method: "POST", target: "development/create-bead", body: {}, headerLines: [] },
    };
    await expect(executeDevelopmentRawAction(execution, token)).rejects.toThrow("loopback Scope");
    await expect(
      executeDevelopmentRawAction(
        {
          ...execution,
          scope: "http://127.0.0.1:1/",
          input: { method: "POST", target: "https://example.invalid/", headerLines: [] },
        },
        token,
      ),
    ).rejects.toThrow("bounded fixture");
    await expect(
      executeDevelopmentRawAction(
        {
          ...execution,
          scope: "http://127.0.0.1:1/",
          input: {
            method: "POST",
            target: "development/create-bead",
            credential: "operator-provided",
            headerLines: [],
          },
        },
        token,
      ),
    ).rejects.toThrow("fixed development credential");
  });

  it("bounds alias setup observations to GET within the fixture alias root", async () => {
    const execute = developmentActions(createDevelopmentProcessActions(token));
    for (const input of [
      { method: "GET", target: "beads/a", resolveAlias: true },
      { method: "POST", target: "alias/a", resolveAlias: true },
      { method: "GET", target: "https://example.invalid/alias/a", resolveAlias: true },
    ])
      await expect(
        execute({
          family: "client",
          operation: "development.request",
          scope: "http://127.0.0.1:1/",
          bindings: {},
          signal: new AbortController().signal,
          input,
        }),
      ).rejects.toThrow(/current Scope's alias root|escaped the Scope/);
  });

  it("cleans up the parked child when the runner rejects its first observation", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.process-disconnect",
    );
    scenario.actions[0].assertions.find(
      (entry: { id: string }) => entry.id === "committed-prefix",
    ).equals = 404;
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({ state: "fail" });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("cleans up the parked child when the run is aborted at the observed barrier", async () => {
    const bundle = createDevelopmentReadUpdateArtifactBundle(await artifacts());
    const controller = new AbortController();
    const result = await runDevelopmentMatrix(
      bundle,
      ["development.read-update.process-disconnect"],
      {
        signal: controller.signal,
        afterAction(execution) {
          if (execution.operation === "development.process.submit") controller.abort();
        },
      },
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({ state: "harness-error", category: "aborted" });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it.each([
    null,
    {},
    [],
    { elapsedMs: "86400000" },
    { elapsedMs: -1 },
    { elapsedMs: 0.5 },
    { elapsedMs: 604800001 },
    { elapsedMs: 0, extra: true },
  ])("refuses malformed retention controls and cleans up the child: %j", async (input) => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.retention-reopen",
    );
    scenario.actions.find((entry: { id: string }) => entry.id === "before-expiry").input = input;
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({ state: "fail" });
    expect(result.scenarios[0]?.actions?.at(-1)).toMatchObject({
      action: { id: "before-expiry" },
      executionError: { category: "execution" },
    });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("refuses backward retention time after a completed reopen", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.retention-reopen",
    );
    scenario.actions.find((entry: { id: string }) => entry.id === "at-expiry").input = {
      elapsedMs: 0,
    };
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({ state: "fail" });
    expect(result.scenarios[0]?.actions?.at(-1)).toMatchObject({
      action: { id: "at-expiry" },
      executionError: { category: "execution" },
    });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("refuses ordinary process controls in the retention fixture", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.retention-reopen",
    );
    scenario.actions.find((entry: { id: string }) => entry.id === "before-expiry").operation =
      "development.process.reopen";
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({ state: "fail" });
    expect(result.scenarios[0]?.actions?.at(-1)).toMatchObject({
      action: { id: "before-expiry" },
      executionError: { category: "execution" },
    });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("cleans up the retention child after a failed observation following reopen", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.retention-reopen",
    );
    scenario.actions
      .find((entry: { id: string }) => entry.id === "retained-create")
      .assertions.find((entry: { id: string }) => entry.id === "properties").equals = {
      value: 999,
    };
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({ state: "fail" });
    expect(result.scenarios[0]?.actions?.at(-1)?.action.id).toBe("retained-create");
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("cleans up the retention child when the runner aborts after reopen", async () => {
    const bundle = createDevelopmentReadUpdateArtifactBundle(await artifacts());
    const controller = new AbortController();
    const result = await runDevelopmentMatrix(
      bundle,
      ["development.read-update.retention-reopen"],
      {
        signal: controller.signal,
        afterAction(execution) {
          if (execution.operation === "development.retention.reopen") controller.abort();
        },
      },
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.scenarios[0]).toMatchObject({ state: "harness-error", category: "aborted" });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("detects changed prefix JSON through the runner's digest-cardinality assertion", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    const scenario = manifest.scenarios.find(
      (entry: { id: string }) => entry.id === "development.read-update.process-disconnect",
    );
    scenario.actions.splice(4, 0, {
      id: "perturb-prefix",
      family: "client",
      operation: "development.request",
      input: {
        method: "POST",
        target: "development/update-bead",
        key: "perturb-prefix",
        body: {
          bead: "beads/prefix",
          propertiesChange: [{ op: "add", path: "/changed", value: true }],
        },
      },
      captures: [],
      assertions: [
        { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 200 },
      ],
    });
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [scenario.id]);
    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      actions: expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({ id: "equal" }),
          assertions: expect.arrayContaining([
            expect.objectContaining({ id: "prefix-identical", passed: false }),
          ]),
        }),
      ]),
    });
    expect(result.scenarios[0]?.cleanupError).toBeUndefined();
  });

  it("reports an authored contract mismatch instead of accepting an assertion-free observation", async () => {
    const sources = await artifacts();
    const manifest = JSON.parse(sources.manifest.bytes.toString());
    manifest.scenarios[0].actions[0].assertions.find(
      (assertion: { id: string }) => assertion.id === "properties",
    ).equals = { n: 999 };
    const bundle = createDevelopmentReadUpdateArtifactBundle({
      ...sources,
      manifest: { bytes: Buffer.from(JSON.stringify(manifest)) },
    });
    const result = await runDevelopmentMatrix(bundle, [manifest.scenarios[0].id]);
    expect(result.claimEligible).toBe(false);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      actions: [
        {
          assertions: expect.arrayContaining([
            { id: "properties", passed: false, message: expect.any(String) },
          ]),
        },
      ],
    });
  });
});
