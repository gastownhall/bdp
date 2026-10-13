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
    {
      retrievalUri: `${scope}types/link`,
      utf8: JSON.stringify({
        id: `${scope}types/link`,
        name: "Link",
        describes: "link",
        conformsTo: [],
        propertiesSchema: schema,
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
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
it("installed Scope/Bead/Link Event SSE matches finite bytes and sparse Bead survives fifteen seconds", async () => {
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
      return {
        bodyText: response.bodyText,
        parsed: JSON.parse(response.bodyText) as { events: unknown[]; next: string | null },
      };
    };
    const observations: unknown[] = [];
    const frames = (r: ReturnType<typeof recordRawSse>) =>
      r.frames.filter((f) => f.startsWith("id: "));
    const parsed = (frame: string) => JSON.parse(frame.split("\ndata: ")[1]!);
    const run = (operations: unknown[]) => exchange("operations/batch", { operations });
    const create = (id: string) => ({
      operation: "createBead",
      id: `beads/${id}`,
      type,
      properties: { n: 0 },
    });
    await run([
      create("a"),
      create("b"),
      {
        operation: "createLink",
        id: "links/l",
        type: `${scope}types/link`,
        source: "beads/a",
        target: "beads/a",
        properties: { n: 0 },
      },
    ]);
    const open = (target: string) =>
      recordRawSse({
        dial: address.href,
        host: "reference.invalid",
        target: `/acme/${target}`,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
        ],
        signal: controller.signal,
        timeoutMs: 25000,
      });
    const observe = (r: ReturnType<typeof recordRawSse>, target: string) => ({
      target,
      headers: r.headers,
      frames: r.frames,
      elapsedMs: r.elapsedMs,
      wireBytes: r.wireBytes.length,
      wireResponseBase64: r.wireBytes.toString("base64"),
      wireSha256: createHash("sha256").update(r.wireBytes).digest("hex"),
    });
    for (const target of ["events/", "beads/a?view=events", "links/l?view=events"]) {
      const finite = await exchange(target);
      expect(finite.parsed.next).toBeNull();
      stream = open(target);
      const live = stream;
      await live.until(() => frames(live).length === finite.parsed.events.length);
      expect(frames(live).map(parsed)).toEqual(finite.parsed.events);
      for (const frame of frames(live))
        expect(finite.bodyText).toContain(frame.split("\ndata: ")[1]!);
      expect(live.headers).toMatchObject({
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        vary: "Accept",
        "x-bdp-development": "non-attesting",
      });
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(live.headers[name]).toBeTruthy();
      await live.close();
      observations.push(observe(live, target));
      stream = undefined;
    }
    const initial = await exchange("beads/a?view=events");
    const last = (initial.parsed.events.at(-1)! as { id: string }).id;
    for (let n = 1; n <= 12; n++)
      await run([
        {
          operation: "updateBead",
          bead: "beads/b",
          propertiesChange: [{ op: "replace", path: "/n", value: n }],
        },
      ]);
    const sparseTarget = `beads/a?view=events&after=${last}`;
    stream = open(sparseTarget);
    const current = stream;
    await current.ready;
    expect(current.status).toBe(200);
    const idleStarted = performance.now();
    await delay(15100, undefined, { signal: controller.signal });
    expect(current.destroyed).toBe(false);
    expect(frames(current)).toEqual([]);
    const comments = current.frames.filter((f) => f.startsWith(":"));
    expect(comments.length).toBeGreaterThanOrEqual(2);
    expect(comments.every((f) => !f.includes("id:"))).toBe(true);
    await run([
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      },
    ]);
    await current.until(() => frames(current).length === 1);
    expect(parsed(frames(current)[0]!).subject).toBe(`${scope}beads/a`);
    const finiteLive = await exchange(sparseTarget);
    expect(finiteLive.parsed.events).toEqual(frames(current).map(parsed));
    expect(finiteLive.bodyText).toContain(frames(current)[0]!.split("\ndata: ")[1]!);
    const elapsedIdle = performance.now() - idleStarted;
    expect(elapsedIdle).toBeGreaterThanOrEqual(15000);
    await current.close();
    observations.push(observe(current, sparseTarget));
    stream = undefined;
    expect(actualSettings.eventStream).toEqual({
      maximumGroupsPerObservation: 1,
      packetBytes: 4194304,
    });
    report = {
      observation: "private-installed-event-source-sse",
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
      liveEventFrames: 1,
      observations,
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
