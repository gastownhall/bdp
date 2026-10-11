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
function developmentActions(): ScenarioActionExecutor {
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
    const target = new URL(string(input.target), execution.scope).href;
    if (!target.startsWith(execution.scope)) throw new Error("action target escaped the Scope");
    const body = structuredClone(record(second ? input.secondBody : (input.body ?? {})));
    if (input.expectedRevisionBinding !== undefined)
      body.expectedRevision = string(execution.bindings[string(input.expectedRevisionBinding)]);
    const key = input.key === undefined ? undefined : string(input.key);
    const response =
      input.method === "GET"
        ? await transport.get(target, { signal: execution.signal })
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
    return {
      status: response.status,
      headers: response.headers,
      ...(response.kind === "json" ? { body: response.body } : {}),
    };
  }
  return async (execution) => {
    if (execution.family !== "client") throw new Error("unsupported development action family");
    if (execution.operation === "development.raw")
      return executeDevelopmentRawAction(execution, token);
    if (execution.operation === "development.request") return request(execution);
    if (execution.operation === "development.race")
      return Promise.all([request(execution), request(execution, true)]);
    throw new Error("unsupported development action");
  };
}

async function runDevelopmentMatrix(bundle: ConformanceArtifactBundle, selection?: string[]) {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-development-matrix-"));
  let server: Awaited<ReturnType<typeof startDevelopmentReferenceServer>> | undefined;
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
    const result = await runConformanceMatrix({
      scope,
      profile: "read-update",
      seed: 0,
      artifactBundle: bundle,
      execute: async () => {
        throw new Error("development manifest must use the SDK action lane");
      },
      actionExecutor: developmentActions(),
      declaredTargetLabel: "development-only-non-attesting-bdptest",
      ...(selection === undefined ? {} : { scenarioSelection: selection }),
      harness: {
        async prepare(scenario, _scope, _seed, fixture) {
          server = await startDevelopmentReferenceServer({
            directory: path.join(directory, scenario.id),
            port,
            create: true,
            token,
          });
          return { capabilities: fixture.capabilities };
        },
        async cleanup() {
          await server?.close();
          server = undefined;
        },
      },
    });
    return result;
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe("DEVELOPMENT ONLY: non-attesting Read+Update contract observations", () => {
  it("executes every diagnostic binding against real HTTP with SDK and raw receiving observations", async () => {
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
  });

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
