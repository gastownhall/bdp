import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { prepareTransactionSingleton } from "./transaction-batch.js";
import {
  startTransactionRuntime,
  transactionRuntimeAdministration,
} from "./transaction-runtime.js";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";

it("serves a complete live correction through existing HTTP/SSE and private administration, fencing old copies across reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-correction-http-"));
  const scope = "https://correction-http.test/s/",
    type = `${scope}types/task`,
    token = randomBytes(32).toString("base64url");
  const options = {
    directory,
    scope,
    port: 0,
    create: true,
    types: [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })],
    credentials: [{ token, principal: "p", canMutate: true }],
  };
  let runtime = await startTransactionRuntime(options);
  const streams: ReturnType<typeof recordRawSse>[] = [];
  async function request(target: string, body?: unknown, key?: string) {
    const url = new URL(target, scope);
    const response = await fetch(new URL(url.pathname + url.search, runtime.listenUrl), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": key! }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    console.log(
      "LIVE_CORRECTION_HTTP_RESPONSE " +
        JSON.stringify({
          target: url.href,
          status: response.status,
          headers: Object.fromEntries(response.headers),
          bodyBase64: Buffer.from(text).toString("base64"),
          credentialsRedacted: true,
        }),
    );
    return {
      status: response.status,
      text,
      value: text ? JSON.parse(text) : undefined,
      headers: response.headers,
    };
  }
  try {
    expect(Object.keys(runtime).sort()).toEqual([
      "close",
      "configurationMetadata",
      "listenUrl",
      "replaceAuthorizationPolicy",
      "scope",
      "targets",
    ]);
    expect(runtime).not.toHaveProperty("correctLiveBeadVersion");
    expect(() => transactionRuntimeAdministration({ ...runtime })).toThrow(
      "authentic transaction runtime required",
    );
    const create = {
      operations: [
        { operation: "createBead", id: "beads/a", type, properties: { safe: true } },
        {
          operation: "createBead",
          id: "beads/b",
          type,
          properties: { secret: "old-http-property" },
          metadata: { secret: "old-http-metadata" },
        },
      ],
    };
    const created = await request("operations/batch", create, "create");
    expect(created.status).toBe(200);
    const original = created.value.results[1].resource;
    const page = await request("beads/?limit=1");
    expect(page.status).toBe(200);
    expect(typeof page.value.next).toBe("string");
    const oldSnapshot = await request("snapshot");
    expect(oldSnapshot.status).toBe(200);
    const changes = await request("changes/?after=genesis");
    expect(changes.status).toBe(200);
    const checkpoint = changes.value.groups[0].checkpoint;
    const events = await request("events/");
    expect(events.status).toBe(200);
    const oldCursor = events.value.events.find(
      (event: { subject: string }) => event.subject === original.id,
    ).id;
    const stream = recordRawSse({
      dial: runtime.listenUrl,
      host: new URL(runtime.listenUrl).host,
      target: `/s/changes/?after=${encodeURIComponent(checkpoint)}`,
      headers: [
        ["Authorization", `Bearer ${token}`],
        ["Accept", "text/event-stream"],
      ],
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
    streams.push(stream);
    await stream.ready;
    const admin = transactionRuntimeAdministration(runtime);
    const corrected = admin.correctLiveBeadVersion(
      original.id,
      original.revision,
      prepareTransactionSingleton(
        scope,
        "updateBead",
        JSON.stringify({
          bead: original.id,
          propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
          metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
        }),
      ),
    );
    await stream.until(() => stream.frames.some((frame) => frame.includes('"position":"pos-2"')));
    const frames = stream.frames.filter((frame) => frame.startsWith("id: "));
    expect(frames).toHaveLength(1);
    const complete = JSON.parse(frames[0]!.split("\ndata: ")[1]!);
    expect(complete).toMatchObject({
      position: "pos-2",
      projectionAdvance: false,
      erasures: corrected.group.erasures,
      changes: corrected.group.changes,
      eventCount: 1,
    });
    expect(complete.events[0].data).toEqual(corrected.group.events[0]!.data);
    expect(frames[0]).not.toContain("old-http-");
    console.log(
      "LIVE_CORRECTION_SSE_EVIDENCE " +
        JSON.stringify({
          status: stream.status,
          framesBase64: frames.map((frame) => Buffer.from(frame).toString("base64")),
          credentialsRedacted: true,
        }),
    );
    expect((await request(page.value.next)).status).toBe(410);
    expect((await request(oldSnapshot.value.id)).status).toBe(410);
    expect((await request(`changes/?after=${encodeURIComponent(checkpoint)}`)).status).toBe(410);
    const current = await request("beads/b");
    expect(current.status).toBe(200);
    expect(current.value.properties).toEqual({ corrected: true });
    expect(current.value.metadata).toEqual({ corrected: true });
    const exclusive = await request(`events/?after=${encodeURIComponent(oldCursor)}`);
    expect(exclusive.status).toBe(200);
    expect(exclusive.value.events).toHaveLength(1);
    expect(exclusive.text).not.toContain("old-http-");
    const receipt = await request(created.value.id);
    expect(receipt.status).toBe(200);
    expect(receipt.value.results[1]).toMatchObject({ outcome: "erased" });
    expect(receipt.text).not.toContain("old-http-");
    await stream.close();
    await runtime.close();
    expect(() =>
      admin.correctLiveBeadVersion(
        original.id,
        original.revision,
        prepareTransactionSingleton(
          scope,
          "updateBead",
          JSON.stringify({
            bead: original.id,
            propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
          }),
        ),
      ),
    ).toThrow("transaction runtime is closing");
    runtime = await startTransactionRuntime({ ...options, create: false });
    const replay = await request("operations/batch", create, "create");
    expect(replay.status).toBe(200);
    expect(replay.value.id).toBe(created.value.id);
    expect(replay.value.results[1]).toMatchObject({ outcome: "erased" });
    expect(replay.headers.get("bdp-scope-epoch")).toBe(created.headers.get("bdp-scope-epoch"));
    const fresh = await request("snapshot");
    expect(fresh.status).toBe(200);
    expect(fresh.value.erasures).toEqual(corrected.group.erasures);
    expect(fresh.text).not.toContain("old-http-");
  } finally {
    for (const stream of streams) await stream.close();
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
