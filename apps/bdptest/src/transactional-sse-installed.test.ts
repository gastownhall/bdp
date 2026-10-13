/** Private raw-stream evidence; not a finite exchange or public profile claim. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw Error("installed SSE override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`,
  schema = `${scope}schemas/task`;
const artifacts = {
  descriptors: [
    {
      retrievalUri: type,
      utf8: JSON.stringify({
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
    },
  ],
  schemas: [
    {
      retrievalUri: schema,
      utf8: JSON.stringify({
        $id: schema,
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
it("installed actual-default SSE survives fifteen seconds then delivers a live group over canonical Host", async () => {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("installed SSE cohort deadline")),
    45000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sse-installed-")),
    token = randomBytes(32).toString("base64url");
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let stream: ReturnType<typeof recordRawSse> | undefined;
  const failures: unknown[] = [];
  let report: unknown;
  try {
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    const binding = installedTransactionBinding(child.ready, source, fixture);
    const installedConfiguration = (await import(
      pathToFileURL(path.join(path.dirname(entry), "transaction-runtime-configuration.js")).href
    )) as typeof import("../../../packages/server/src/transaction-runtime-configuration.js");
    const actualSettings = installedConfiguration.TRANSACTION_RUNTIME_DEFAULTS;
    expect(child.ready.runtimeConfigurationIdentity).toBe(
      installedConfiguration.transactionRuntimeDigest({
        revision: "transaction-runtime-1",
        scope,
        artifactIdentity: child.ready.artifactIdentity,
        settings: actualSettings,
        authorityMode: "canonical",
        policyIdentity: child.ready.policyIdentity,
        authenticationIdentity: child.ready.authenticationIdentity,
        profile: "transactional",
        history: false,
      }),
    );
    const address = new URL(child.ready.listenUrl as string);
    let key = 0;
    const exchange = async (target: string, body?: unknown) => {
      const url = new URL(target, scope).href,
        method = body === undefined ? ("GET" as const) : ("POST" as const);
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: address.hostname, port: Number(address.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 65536,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: "writer",
            credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines:
            body === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: `sse_${key++}` },
                ],
          ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
        },
      });
      expect(response.status, response.bodyText).toBe(200);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      return JSON.parse(response.bodyText) as { groups: unknown[] };
    };
    const create = (id: string) =>
      exchange("operations/batch", {
        operations: [{ operation: "createBead", id: `beads/${id}`, type, properties: { n: 100 } }],
      });
    await create("before");
    const finite = await exchange("changes/?after=genesis");
    stream = recordRawSse({
      dial: address.href,
      host: "reference.invalid",
      target: "/acme/changes/?after=genesis",
      headers: [
        ["Authorization", `Bearer ${token}`],
        ["Accept", "text/event-stream"],
      ],
      signal: controller.signal,
      timeoutMs: 25000,
    });
    const current = stream;
    await current.until(() => current.frames.some((f) => f.startsWith("id: ")));
    const first = current.frames.find((f) => f.startsWith("id: "))!;
    expect(JSON.parse(first.split("\ndata: ")[1]!)).toEqual(finite.groups[0]);
    const idleStarted = performance.now();
    await delay(15100, undefined, { signal: controller.signal });
    expect(current.destroyed).toBe(false);
    expect(current.frames.filter((f) => f.startsWith("id: "))).toHaveLength(1);
    const comments = current.frames.filter((f) => f.startsWith(":"));
    expect(comments.length).toBeGreaterThanOrEqual(2);
    expect(comments.every((f) => !f.includes("id:"))).toBe(true);
    await create("after");
    await current.until(() => current.frames.filter((f) => f.startsWith("id: ")).length === 2);
    const elapsedIdle = performance.now() - idleStarted;
    expect(elapsedIdle).toBeGreaterThanOrEqual(15000);
    expect(current.headers).toMatchObject({
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      vary: "Accept",
      "x-bdp-development": "non-attesting",
    });
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(current.headers[name]).toBeTruthy();
    report = {
      observation: "private-installed-changefeed-sse",
      claimEligible: false,
      source,
      workspaceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      node: process.version,
      settings: actualSettings,
      deadlines: { ...actualSettings.transport, recorder: 25000, cohort: 45000, cleanup: 10000 },
      idleMilliseconds: elapsedIdle,
      streamMilliseconds: current.elapsedMs,
      comments: comments.length,
      groupFrames: 2,
      wireBytes: current.wireBytes.length,
      wireResponseBase64: current.wireBytes.toString("base64"),
      wireSha256: createHash("sha256").update(current.wireBytes).digest("hex"),
      headers: current.headers,
      frames: current.frames,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await stream?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await child?.close();
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(deadline);
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length)
    throw new AggregateError(failures, "installed SSE observation or cleanup failed");
  console.log(JSON.stringify(report));
}, 60000);
