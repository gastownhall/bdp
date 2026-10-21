import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
import {
  startTransactionRuntime,
  transactionRuntimeAdministration,
} from "./transaction-runtime.js";

const scope = "https://erasure-http.test/s/",
  type = `${scope}types/task`;
const clean: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});
it("publishes a complete historical erasure to caught-up SSE, fences finite/reconnect, and preserves receipt pages and exclusive Event cursors across reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-erasure-http-"));
  const token = randomBytes(32).toString("base64url");
  const options = {
    directory,
    scope,
    port: 0,
    create: true,
    types: [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })],
    credentials: [{ token, principal: "p", canMutate: true }],
  };
  let runtime = await startTransactionRuntime(options, { receiptMaximumItems: 1 });
  const streams: ReturnType<typeof recordRawSse>[] = [];
  clean.push(async () => {
    try {
      for (const stream of streams) await stream.close();
      await runtime.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const observations: unknown[] = [];
  async function request(target: string, method = "GET", body?: string, key?: string) {
    const logical = new URL(target, scope);
    const response = await fetch(new URL(logical.pathname + logical.search, runtime.listenUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": key! }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    observations.push({
      method,
      target: logical.href,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      utf8Base64: Buffer.from(text).toString("base64"),
    });
    console.log("ERASURE_HTTP_RESPONSE " + JSON.stringify(observations.at(-1)));
    return {
      status: response.status,
      headers: response.headers,
      text,
      value: text ? JSON.parse(text) : undefined,
    };
  }
  const originalBody = JSON.stringify({
    operations: [
      { operation: "createBead", id: "beads/b", type, properties: { safe: true } },
      {
        operation: "createBead",
        id: "beads/a",
        type,
        properties: { secret: "erased-http-original" },
      },
    ],
  });
  const created = await request("operations/batch", "POST", originalBody, "create");
  expect(created.status).toBe(200);
  const originalPageUrl = created.value.next as string;
  const page = await request(originalPageUrl),
    original = page.value.results[0].resource;
  const snapshot = await request("snapshot");
  expect(snapshot.status).toBe(200);
  const initial = await request("changes/?after=genesis");
  const checkpoint1 = initial.value.groups[0].checkpoint as string;
  const firstEventPage = await request("events/");
  const eventPage = await request(firstEventPage.value.next);
  const eventCursor = eventPage.value.events.find(
    (event: { subject: string }) => event.subject === original.id,
  ).id as string;
  const controller = new AbortController();
  const stream = recordRawSse({
    dial: runtime.listenUrl,
    host: new URL(runtime.listenUrl).host,
    target: `/s/changes/?after=${encodeURIComponent(checkpoint1)}`,
    headers: [
      ["Authorization", `Bearer ${token}`],
      ["Accept", "text/event-stream"],
    ],
    signal: controller.signal,
    timeoutMs: 5000,
  });
  streams.push(stream);
  await stream.ready;
  const update = await request(
    "operations/batch",
    "POST",
    JSON.stringify({
      operations: [
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/secret", value: "replacement" }],
        },
      ],
    }),
    "update",
  );
  expect(update.status).toBe(200);
  await stream.until(() => stream.frames.some((frame) => frame.includes('"position":"pos-2"')));
  const result = transactionRuntimeAdministration(runtime).eraseHistoricalVersions([
    { subject: original.id, revision: original.revision },
  ]);
  await stream.until(() => stream.frames.some((frame) => frame.includes('"position":"pos-3"')));
  const groupFrames = stream.frames.filter((frame) => frame.startsWith("id: "));
  expect(groupFrames).toHaveLength(2);
  const erasure = JSON.parse(groupFrames[1]!.split("\ndata: ")[1]!);
  expect(erasure).toMatchObject({
    position: "pos-3",
    projectionAdvance: false,
    changes: [],
    events: [],
    eventCount: 0,
    erasures: result.group.erasures,
  });
  expect(erasure).not.toHaveProperty("erasurePruned");
  expect(erasure.scopeEpoch).toBe(created.headers.get("bdp-scope-epoch"));
  expect((await request(`changes/?after=${encodeURIComponent(checkpoint1)}`)).status).toBe(410);
  expect((await request(snapshot.value.id)).status).toBe(410);
  const erasedPage = await request(originalPageUrl);
  expect(erasedPage.status).toBe(200);
  expect(erasedPage.value.results[0]).toEqual({
    operationIndex: 1,
    outcome: "erased",
    erased: { id: original.id, type: original.type, revision: original.revision },
  });
  const eventsAfter = await request(`events/?after=${encodeURIComponent(eventCursor)}`);
  expect(eventsAfter.status).toBe(200);
  expect(eventsAfter.text).not.toContain("erased-http-original");
  const fresh = await request("snapshot");
  expect(fresh.value.erasures).toEqual(result.group.erasures);
  expect(fresh.text).not.toContain("erased-http-original");
  // Disconnect/reconnect is a new admission, never the caught-up-stream exception.
  await stream.close();
  const reconnect = recordRawSse({
    dial: runtime.listenUrl,
    host: new URL(runtime.listenUrl).host,
    target: `/s/changes/?after=${encodeURIComponent(checkpoint1)}`,
    headers: [
      ["Authorization", `Bearer ${token}`],
      ["Accept", "text/event-stream"],
    ],
    signal: new AbortController().signal,
    timeoutMs: 3000,
  });
  streams.push(reconnect);
  await reconnect.closed;
  expect(reconnect.status).toBe(410);
  expect(reconnect.body).not.toContain("erased-http-original");
  await runtime.close();
  runtime = await startTransactionRuntime(
    { ...options, create: false },
    { receiptMaximumItems: 1 },
  );
  const replay = await request("operations/batch", "POST", originalBody, "create");
  expect(replay.status).toBe(200);
  expect(replay.value.id).toBe(created.value.id);
  expect(replay.headers.get("bdp-scope-epoch")).toBe(created.headers.get("bdp-scope-epoch"));
  const reopenedPage = await request(originalPageUrl);
  expect(reopenedPage.value).toEqual(erasedPage.value);
  expect((await request("snapshot")).value.erasures).toEqual(result.group.erasures);
  expect((await request(`events/?after=${encodeURIComponent(eventCursor)}`)).status).toBe(200);
  console.log(
    "ERASURE_HTTP_EVIDENCE " +
      JSON.stringify({
        observations,
        sse: [
          { rawBase64: stream.wireBytes.toString("base64"), status: stream.status },
          { rawBase64: reconnect.wireBytes.toString("base64"), status: reconnect.status },
        ],
        generations: 2,
        credentialsRedacted: true,
      }),
  );
}, 20000);
