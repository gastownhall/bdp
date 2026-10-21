/** NEW ordinary installed closure cases: real HTTP, no scheduler/clock/policy controls. */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { expect } from "vitest";
import {
  createRawHttpExchangeExecutor,
  createJsonSchemaValidator,
  type ExactHttpExchangeRequest,
} from "@bdp/conformance";
import { bindServedProfileConfiguration } from "@bdp/conformance/testing";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "./read-update-cumulative-product-configuration.js";
import { installedContractsDigest } from "./installed-contract-identity.js";
import protocol from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
export const entry = process.env.BDP_RU_CLOSURE_ENTRY;
export const scope = "https://reference.invalid/acme/";
export const validator = createJsonSchemaValidator(protocol);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export type ClosureContext = {
  exchange(target: string, body?: unknown, key?: string): Promise<{ wire: any; value: any }>;
  results: Record<string, unknown>;
};
/** Same actual absence check, outside finalization's lexical throw restriction. */
async function assertRemoved(directory: string) {
  try {
    await access(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw Error("owned store still present");
}
export async function withRUClosure(
  name: string,
  run: (c: ClosureContext) => Promise<void>,
  additionalSchema = false,
) {
  const build = process.env.BDP_RU_CLOSURE_BUILD,
    output = process.env.BDP_RU_CLOSURE_OUTPUT,
    bank = process.env.BDP_RU_CLOSURE_CREDENTIALS,
    source = process.env.BDP_RU_CLOSURE_SOURCE;
  if (!entry || !build || !output || !bank || !source)
    throw Error("explicit installed/source/build/output/credential inputs required");
  const bankBytes = await readFile(bank),
    credentials = JSON.parse(bankBytes.toString("utf8")) as RUCampaignCredentials;
  expect(Object.keys(credentials).sort()).toEqual(["operator", "other", "restricted"]);
  for (const token of Object.values(credentials)) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new Set(Object.values(credentials)).size).toBe(3);
  const modules = [];
  for (const file of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
    const actual = await readFile(path.join(path.dirname(entry), file));
    expect(actual.equals(await readFile(path.join(build, file))), file).toBe(true);
    modules.push({ file, bytes: actual.length, sha256: sha(actual) });
  }
  const protocolBytes = await readFile(
    new URL("../../../schemas/bdp-v0.schema.json", import.meta.url),
  );
  expect(
    protocolBytes.equals(
      await readFile(path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json")),
    ),
  ).toBe(true);
  const runtime = await import(
    pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
  );
  const baseFixture = await readFile(
    new URL("./read-update-cumulative-product-fixture.json", import.meta.url),
  );
  const extraBytes = await readFile(
    new URL("./read-update-cumulative-ordinary-closure-fixture.json", import.meta.url),
  );
  const extra = JSON.parse(extraBytes.toString("utf8"));
  for (const raw of [baseFixture, extraBytes]) {
    expect(raw.length).toBeLessThanOrEqual(4194304);
    let nodes = 0,
      maxDepth = 0;
    const stack: [unknown, number][] = [[JSON.parse(raw.toString("utf8")), 1]];
    while (stack.length) {
      const [v, d] = stack.pop()!;
      nodes++;
      maxDepth = Math.max(maxDepth, d);
      if (Array.isArray(v)) for (const child of v) stack.push([child, d + 1]);
      else if (v !== null && typeof v === "object") {
        nodes += Object.keys(v).length;
        for (const child of Object.values(v)) stack.push([child, d + 1]);
      }
    }
    expect(nodes).toBeLessThanOrEqual(100000);
    expect(maxDepth).toBeLessThanOrEqual(128);
  }
  const failures: unknown[] = [],
    wires: unknown[] = [],
    results: Record<string, unknown> = {};
  const native: Record<string, unknown> = {};
  let directory: string | undefined,
    server: any,
    ready: Record<string, unknown> | undefined,
    binding: unknown,
    configurationMetadata: unknown,
    removed = false;
  let terminal: Promise<unknown> | undefined;
  const controller = new AbortController(),
    timer = setTimeout(() => {
      controller.abort(Error("ordinary closure90s"));
      if (server?.child.connected) server.child.send({ command: "close" });
    }, 90000);
  try {
    directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-ordinary-closure-"));
    const port = await helpers.availablePort();
    const config = cumulativeRUConfiguration(
      { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
      runtime.referenceTypeArtifacts(scope),
      credentials,
    );
    if (additionalSchema) {
      config.contracts.descriptors.push(...extra.artifacts.descriptors);
      config.contracts.schemas.push(...extra.artifacts.schemas);
    }
    const expected = runtime.captureInstalledReferenceConfiguration(config);
    configurationMetadata = {
      ...config,
      credentials: config.credentials.map(({ principal, token }) => ({
        principal,
        tokenSHA256: sha(Buffer.from(token)),
      })),
      capturedIdentity: expected.identity,
    };
    server = await helpers.launchInstalledReference(entry, config);
    ready = server.ready;
    native.pid = server.child.pid;
    terminal = new Promise((resolve) =>
      server.child.once("close", (code: number | null, signal: string | null) =>
        resolve({
          code,
          signal,
          closeObserved: true,
          stdoutEOF: server.child.stdout.readableEnded,
          stderrEOF: server.child.stderr.readableEnded,
        }),
      ),
    );
    expect(ready!.configurationIdentity).toBe(expected.identity);
    if (!additionalSchema)
      expect(ready!.configurationIdentity).toBe(
        "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
      );
    else
      expect(ready!.configurationIdentity).not.toBe(
        "9af00876e91f71137ff31c226d368590a018ce2367cdb93110ea246dc7420d46",
      );
    binding = bindServedProfileConfiguration({
      scope,
      profile: "read-update",
      history: false,
      // The reusable installation was packed at5f3. Its76server modules + schema
      // are checked byte-for-byte against the current compatible build above.
      sourceCommit: "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c",
      installedPayloadDigest: ready!.payloadIdentity as string,
      installedContractsDigest: installedContractsDigest(ready!.artifactIdentity),
      policyDigest: ready!.policyIdentity as string,
      authenticationDigest: ready!.authenticationIdentity as string,
      fixture: { bytes: additionalSchema ? extraBytes : baseFixture },
    });
    let requests = 0;
    async function exchange(target: string, body?: unknown, key?: string) {
      controller.signal.throwIfAborted();
      expect(++requests).toBeLessThanOrEqual(100);
      const method = body === undefined ? "GET" : "POST",
        url = new URL(target, scope).href;
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: "127.0.0.1", port },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 1048576,
          exactMode: {
            scope,
            profile: "read-update",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "operator",
            credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${credentials.operator}` }),
          },
        },
      );
      const request: ExactHttpExchangeRequest = {
        method,
        url,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: key! },
                ],
          ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
        },
      };
      const wire = await execute(request);
      wires.push({
        method,
        url,
        requestBody: body === undefined ? undefined : JSON.stringify(body),
        authoredHeaders: request.raw.headerLines,
        actualSafeHeaders: wire.exactRequest?.headerLines.filter(
          (h) => h.name.toLowerCase() !== "authorization",
        ),
        writeState: wire.exactRequest?.writeState,
        requestDigest: wire.exactRequest?.bodyDigest,
        status: wire.status,
        headers: wire.headers,
        bodyText: wire.bodyText,
        wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
      });
      expect(wire.exactRequest?.writeState).toBe("complete");
      expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
      expect(wire.headers["cache-control"]).toBe("private, no-store");
      return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
    }
    await run({ exchange, results });
  } catch (error) {
    failures.push(error);
    if (error instanceof Error && "qualificationProcess" in error)
      native.qualificationFailure = error.qualificationProcess;
  } finally {
    clearTimeout(timer);
    if (server) {
      try {
        native.exit = await server.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          native.terminal = await Promise.race([
            terminal,
            new Promise((_, reject) => {
              deadline = setTimeout(() => {
                server.child.kill("SIGKILL");
                reject(Error("native EOF10s"));
              }, 10000);
            }),
          ]);
          expect(native.terminal).toEqual({
            code: 0,
            signal: null,
            closeObserved: true,
            stdoutEOF: true,
            stderrEOF: true,
          });
        } finally {
          clearTimeout(deadline);
        }
      } catch (error) {
        failures.push(error);
      }
      native.raw = server.output();
    }
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        await assertRemoved(directory);
        removed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    const records = {
      case: name,
      source,
      actualPackedSource: "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c",
      sourceMeaning: "current compatible source tree, not a relabel of package generation",
      entry,
      ordinaryDeployment: true,
      additionalSchema,
      configurationIdentity: ready?.configurationIdentity,
      configurationMetadata,
      ready,
      binding,
      baseFixture: { bytes: baseFixture.length, sha256: sha(baseFixture) },
      additionalFixture: {
        bytes: extraBytes.length,
        sha256: sha(extraBytes),
        selected: additionalSchema,
      },
      credentialBank: { bytes: bankBytes.length, sha256: sha(bankBytes), rawPublished: false },
      modules,
      protocolSHA256: sha(protocolBytes),
      native,
      storeRemoved: removed,
      wires,
      results,
      failures: failures.map((e) => inspect(e, { depth: 10 })),
      wholeProfileAward: false,
    };
    try {
      await writeFile(
        path.join(output, name + "-native-terminal.private.json"),
        JSON.stringify({ native, storeRemoved: removed, failures: records.failures }, null, 2),
        { mode: 0o600 },
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      await writeFile(path.join(output, name + "-case.json"), JSON.stringify(records, null, 2), {
        mode: 0o600,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "ordinary RU closure case/finalization");
}
export function resource(
  value: any,
  id: string,
  type: string,
  properties: unknown,
  metadata: unknown = {},
  extra: Record<string, unknown> = {},
) {
  expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(value).toEqual({
    id: scope + id,
    type: scope + "types/" + type,
    revision: value.revision,
    properties,
    metadata,
    ...extra,
  });
  return value;
}
export function success(response: any, outcome: "created" | "updated", expected: any) {
  expect(response.wire.status).toBe(200);
  expect(response.value).toEqual({ outcome, resource: expected });
  return response.value;
}
export function problem(
  response: any,
  code: string,
  status: number,
  retry: string,
  extra: Record<string, unknown> = {},
) {
  expect(response.wire.status).toBe(status);
  expect(response.wire.headers["content-type"]).toMatch(/^application\/problem\+json/);
  expect(validator.validate("#/$defs/readUpdateProblem", response.value)).toEqual([]);
  expect(response.value).toEqual({
    type:
      "https://github.com/gastownhall/bdp/problems/" +
      (code === "validation-failed" ? "validation" : "conflict"),
    code,
    status,
    retry,
    ...extra,
  });
  return response.value;
}
