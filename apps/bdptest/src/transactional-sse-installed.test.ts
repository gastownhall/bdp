/** Private raw-stream evidence; not a finite exchange or public profile claim. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { recordRawSse } from "@bdp/server/testing";
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
function installedExchanges(address: URL, token: string, controller: AbortController) {
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
    return {
      bodyText: response.bodyText,
      parsed: JSON.parse(response.bodyText) as { groups: unknown[] },
    };
  };
  const create = (id: string) =>
    exchange("operations/batch", {
      operations: [{ operation: "createBead", id: `beads/${id}`, type, properties: { n: 100 } }],
    });
  return { exchange, create };
}
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
    const { exchange, create } = installedExchanges(address, token, controller);
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
    expect(JSON.parse(first.split("\ndata: ")[1]!)).toEqual(finite.parsed.groups[0]);
    expect(finite.bodyText).toContain(first.split("\ndata: ")[1]!);
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

type ReconnectGroup = {
  checkpoint: string;
  position: string;
  previousPosition: string;
  transaction: string;
  eventCount: number;
  changes: {
    operation: string;
    resourceKind: string;
    resource: { id: string; type: string; properties: unknown };
  }[];
  events: unknown[];
};

it("installed same start=now URL replays offline G2 before live G3 from the saved checkpoint", async () => {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("installed SSE reconnect cohort deadline")),
    45000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sse-reconnect-installed-"));
  const token = randomBytes(32).toString("base64url");
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  const streams: ReturnType<typeof recordRawSse>[] = [];
  const failures: unknown[] = [];
  const requests: { method: string; target: string; category: "finite" | "sse" }[] = [];
  let phase = "launch",
    report: Record<string, unknown> | undefined;
  const frames = (stream: ReturnType<typeof recordRawSse>) =>
    stream.frames.filter((frame) => frame.startsWith("id: "));
  const decode = (frame: string, id: string, position: string, previousPosition: string) => {
    const data = frame.split("\ndata: ")[1]!;
    const value = JSON.parse(data) as ReconnectGroup;
    expect(frame).toBe(`id: ${value.checkpoint}\nevent: change-group\ndata: ${data}`);
    expect(value).toMatchObject({
      position,
      previousPosition,
      projectionAdvance: false,
      eventCount: 1,
      erasures: [],
    });
    expect(value.changes).toHaveLength(1);
    expect(value.changes[0]).toMatchObject({
      operation: "upsert",
      resourceKind: "bead",
      resource: { id: `${scope}beads/${id}`, type, properties: { n: 100 }, metadata: {} },
    });
    expect(value.events).toHaveLength(1);
    expect(value.events[0]).toMatchObject({
      source: `${scope}events/`,
      type: "created",
      subject: `${scope}beads/${id}`,
      subjectType: type,
      ordinal: 0,
      transaction: value.transaction,
    });
    return { value, data };
  };
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
    const { exchange, create } = installedExchanges(address, token, controller);
    const open = (checkpoint?: string) => {
      requests.push({ method: "GET", target: `${scope}changes/?start=now`, category: "sse" });
      const stream = recordRawSse({
        dial: address.href,
        host: "reference.invalid",
        target: "/acme/changes/?start=now",
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
          ...(checkpoint === undefined ? [] : [["Last-Event-ID", checkpoint] as [string, string]]),
        ],
        signal: controller.signal,
        timeoutMs: 25000,
      });
      streams.push(stream);
      return stream;
    };
    const commit = async (id: string, position: string) => {
      requests.push({ method: "POST", target: `${scope}operations/batch`, category: "finite" });
      const result = await create(id);
      expect(result.parsed).toMatchObject({
        status: "completed",
        requiredPosition: position,
        effectPosition: position,
        results: [
          {
            operationIndex: 0,
            outcome: "created",
            resource: { id: `${scope}beads/${id}`, type, properties: { n: 100 } },
          },
        ],
      });
    };
    const finite = async (after: string, expected: ReturnType<typeof decode>) => {
      const target = `changes/?after=${after}`;
      requests.push({ method: "GET", target: new URL(target, scope).href, category: "finite" });
      const response = await exchange(target);
      expect(response.parsed.groups).toEqual([expected.value]);
      expect(response.bodyText).toContain(expected.data);
      return response.bodyText;
    };
    phase = "request-1-initial-stream";
    const first = open();
    await first.ready;
    expect(first.status).toBe(200);
    expect(first.headers["bdp-scope-position"]).toBe("pos-0");
    expect(frames(first)).toEqual([]);
    phase = "request-2-G1-commit-and-frame";
    await commit("g1", "pos-1");
    await first.until(() => frames(first).length === 1);
    const g1 = decode(frames(first)[0]!, "g1", "pos-1", "pos-0");
    phase = "request-3-G1-finite-parity-and-apply";
    const finiteG1 = await finite("genesis", g1);
    // Apply the complete validated group before choosing its checkpoint. This
    // small test-local state is not a claim of a general durable replica.
    const applied = new Map<string, unknown>();
    for (const change of g1.value.changes) applied.set(change.resource.id, change.resource);
    expect([...applied.keys()]).toEqual([`${scope}beads/g1`]);
    const saved = g1.value.checkpoint;
    phase = "disconnect-initial-stream";
    await first.close();
    expect(first.destroyed).toBe(true);
    phase = "request-4-offline-G2-commit";
    await commit("g2", "pos-2");
    phase = "request-5-saved-checkpoint-reconnect";
    const resumed = open(saved);
    await resumed.ready;
    expect(resumed.status).toBe(200);
    phase = "offline-G2-before-live-G3";
    try {
      await resumed.until(() => frames(resumed).length > 0);
    } catch (cause) {
      throw new Error(
        "offline-G2-before-live-G3: saved-checkpoint replay did not deliver the offline group",
        { cause },
      );
    }
    const g2 = decode(frames(resumed)[0]!, "g2", "pos-2", "pos-1");
    expect(g2.value.checkpoint).not.toBe(saved);
    phase = "request-6-G2-finite-parity";
    const finiteG2 = await finite(saved, g2);
    phase = "request-7-live-G3-commit-and-frame";
    await commit("g3", "pos-3");
    await resumed.until(() => frames(resumed).length >= 2);
    const g3 = decode(frames(resumed)[1]!, "g3", "pos-3", "pos-2");
    phase = "request-8-G3-finite-parity";
    const finiteG3 = await finite(g2.value.checkpoint, g3);
    await resumed.close();
    expect(frames(resumed).map((f) => JSON.parse(f.split("\ndata: ")[1]!).checkpoint)).toEqual([
      g2.value.checkpoint,
      g3.value.checkpoint,
    ]);
    expect(frames(first)).toHaveLength(1);
    for (const stream of streams) {
      expect(stream.headers).toMatchObject({
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        vary: "Accept",
        "x-bdp-development": "non-attesting",
      });
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(stream.headers[name]).toBeTruthy();
    }
    expect(requests).toHaveLength(8);
    expect(requests.filter((r) => r.category === "finite")).toHaveLength(6);
    phase = "complete";
    report = {
      observation: "private-installed-changefeed-start-now-resume",
      claimEligible: false,
      source,
      workspaceDirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      node: process.version,
      settings: actualSettings,
      deadlines: { finite: 5000, recorder: 25000, cohort: 45000, cleanup: 10000 },
      requests,
      savedCheckpoint: saved,
      finiteResponseTexts: [finiteG1, finiteG2, finiteG3],
    };
  } catch (error) {
    failures.push(error);
  } finally {
    for (const stream of streams) {
      try {
        await stream.close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await child?.close();
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(deadline);
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  const directoryRemoved = !existsSync(directory);
  if (!directoryRemoved)
    failures.push(new Error("installed SSE reconnect directory remains after cleanup"));
  const observations = streams.map((stream) => ({
    status: stream.status,
    headers: stream.headers,
    frames: stream.frames,
    wireBytes: stream.wireBytes.length,
    wireSha256: createHash("sha256").update(stream.wireBytes).digest("hex"),
    wireResponseBase64: stream.wireBytes.toString("base64"),
    destroyed: stream.destroyed,
  }));
  console.log(
    JSON.stringify({
      ...report,
      observation: "private-installed-changefeed-start-now-resume",
      source,
      phase,
      requests,
      streams: observations,
      failures: failures.map((e) => (e instanceof Error ? e.message : String(e))),
      childClosed:
        child === undefined || child.child.exitCode !== null || child.child.signalCode !== null,
      directoryRemoved,
      claimEligible: false,
    }),
  );
  if (failures.length)
    throw new AggregateError(failures, "installed SSE reconnect observation or cleanup failed");
}, 60000);
