import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
import { prepareTransactionSingleton } from "./transaction-batch.js";
import {
  startTransactionRuntime,
  transactionRuntimeAdministration,
} from "./transaction-runtime.js";

it("serves direct owning-Bead correction over HTTP/SSE preserving both unchanged first-class Links across reopen", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-owned-bead-http-")),
    scope = "https://live-owned-bead-http.test/s/",
    bead = `${scope}types/task`,
    link = `${scope}types/link`,
    token = randomBytes(32).toString("base64url");
  const options = {
    directory,
    scope,
    port: 0,
    create: true,
    types: [
      parseTypeDescriptor({
        id: bead,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 4 } },
      }),
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ],
    credentials: [{ token, principal: "p", canMutate: true }],
  };
  let runtime!: Awaited<ReturnType<typeof startTransactionRuntime>>;
  let stream: ReturnType<typeof recordRawSse> | undefined;
  let failed = false;
  let failure: unknown;
  const errors: unknown[] = [];
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
      "OWNED_BEAD_HTTP_RESPONSE " +
        JSON.stringify({
          url: url.href,
          status: response.status,
          headers: Object.fromEntries(response.headers),
          bodyBase64: Buffer.from(text).toString("base64"),
          credentialsRedacted: true,
        }),
    );
    return {
      status: response.status,
      headers: response.headers,
      text,
      value: text ? JSON.parse(text) : undefined,
    };
  }
  try {
    runtime = await startTransactionRuntime(options);
    expect(Object.keys(runtime).sort()).toEqual([
      "close",
      "configurationMetadata",
      "listenUrl",
      "replaceAuthorizationPolicy",
      "scope",
      "targets",
    ]);
    expect(() => transactionRuntimeAdministration({ ...runtime })).toThrow(
      "authentic transaction runtime required",
    );
    const admin = transactionRuntimeAdministration(runtime);
    const initial = await request(
      "operations/batch",
      {
        operations: [
          { operation: "createBead", id: "beads/a", type: bead, properties: { safe: true } },
          { operation: "createBead", id: "beads/b", type: bead, properties: { target: true } },
          {
            operation: "createLink",
            id: "links/first",
            type: link,
            source: "beads/a",
            target: "beads/b",
            properties: { healthy: "first" },
          },
          {
            operation: "createLink",
            id: "links/second",
            type: link,
            source: "beads/a",
            target: "beads/b",
            properties: { healthy: "second" },
          },
        ],
      },
      "initial",
    );
    expect(initial.status).toBe(200);
    const links = [initial.value.results[2].resource, initial.value.results[3].resource];
    const marker = {
      bead: scope + "beads/a",
      propertiesChange: [{ op: "replace", path: "", value: { secret: "owner-old-properties" } }],
      metadataChange: [{ op: "replace", path: "", value: { secret: "owner-old-metadata" } }],
    };
    const marked = await request("operations/update-bead", marker, "marked");
    expect(marked.status).toBe(200);
    const before = marked.value.results[0].resource;
    expect(before.ownedLinks).toEqual({ [link]: links });
    const epoch = marked.headers.get("bdp-scope-epoch"),
      view = marked.headers.get("bdp-authorization-view");
    const snapshot = await request("snapshot"),
      page = await request("beads/?limit=1"),
      feed = await request("changes/?after=genesis"),
      events = await request("events/");
    expect(snapshot.status).toBe(200);
    expect(page.status).toBe(200);
    expect(page.value.next).toBeTypeOf("string");
    expect(feed.status).toBe(200);
    expect(events.status).toBe(200);
    expect(feed.value.groups.map((group: { position: string }) => group.position)).toEqual([
      "pos-1",
    ]);
    expect(feed.value.next).toBeTypeOf("string");
    const tailFeed = await request(feed.value.next);
    expect(tailFeed.status).toBe(200);
    expect(tailFeed.value.groups.map((group: { position: string }) => group.position)).toEqual([
      "pos-2",
    ]);
    expect(tailFeed.value.next).toBeNull();
    const checkpoint = tailFeed.value.groups[0].checkpoint;
    const cursor = events.value.events.find(
      (event: { type: string; subject: string; data: { revision?: string } }) =>
        event.type === "updated" &&
        event.subject === before.id &&
        event.data.revision === before.revision,
    ).id;
    stream = recordRawSse({
      dial: runtime.listenUrl,
      host: new URL(runtime.listenUrl).host,
      target: `/s/changes/?after=${encodeURIComponent(checkpoint)}`,
      headers: [
        ["Authorization", `Bearer ${token}`],
        ["Accept", "text/event-stream"],
      ],
      signal: new AbortController().signal,
      timeoutMs: 10000,
    });
    await stream.ready;
    expect(stream.status).toBe(200);
    const result = admin.correctLiveBeadVersion(
      before.id,
      before.revision,
      prepareTransactionSingleton(
        scope,
        "updateBead",
        JSON.stringify({
          bead: before.id,
          expectedRevision: before.revision,
          propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
          metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
        }),
      ),
    );
    expect(result).not.toHaveProperty("receipt");
    expect(result.group.changes).toHaveLength(1);
    expect(result.group.erasures).toHaveLength(1);
    expect(result.group.erasures[0]).toMatchObject({
      subject: before.id,
      revision: before.revision,
    });
    const after = result.group.changes[0]!.resource;
    expect("ownedLinks" in after ? after.ownedLinks : undefined).toEqual(before.ownedLinks);
    expect(after.revision).not.toBe(before.revision);
    await stream.until(() => stream!.frames.some((frame) => frame.includes('"position":"pos-3"')));
    const frames = stream.frames.filter((frame) => frame.startsWith("id: "));
    expect(frames).toHaveLength(1);
    const group = JSON.parse(frames[0]!.split("\ndata: ")[1]!);
    expect(group).toMatchObject({
      position: "pos-3",
      scopeEpoch: epoch,
      authorizationView: view,
      changes: result.group.changes,
      erasures: result.group.erasures,
      eventCount: 1,
    });
    expect(group.events[0].data).toEqual({
      previousRevision: before.revision,
      revision: after.revision,
      change: [{ op: "replace", path: "", value: { corrected: true } }],
      metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
    });
    expect(group.events[0].data).not.toHaveProperty("ownedLink");
    expect(frames[0]).not.toContain("owner-old-");
    console.log(
      "OWNED_BEAD_SSE_EVIDENCE " + JSON.stringify({ status: stream.status, frames: [group] }),
    );
    expect((await request(snapshot.value.id)).status).toBe(410);
    expect((await request(page.value.next)).status).toBe(410);
    expect((await request(`changes/?after=${encodeURIComponent(checkpoint)}`)).status).toBe(410);
    expect((await request("beads/a")).value).toEqual(after);
    expect((await request("beads/b")).value).toEqual(initial.value.results[1].resource);
    for (const original of links) expect((await request(original.id)).value).toEqual(original);
    const exclusive = await request(`events/?after=${encodeURIComponent(cursor)}`);
    expect(exclusive.status).toBe(200);
    expect(exclusive.value.events).toHaveLength(1);
    expect(exclusive.value.events[0].data).toEqual(group.events[0].data);
    const receipt = await request(marked.value.id),
      replay = await request("operations/update-bead", marker, "marked");
    expect(receipt.status).toBe(200);
    expect(receipt.value.results).toMatchObject([{ outcome: "erased" }]);
    expect(replay.value).toEqual(receipt.value);
    await stream.close();
    await runtime.close();
    runtime = await startTransactionRuntime({ ...options, create: false });
    const fresh = await request("snapshot");
    expect(fresh.status).toBe(200);
    expect(fresh.value.beads.items).toContainEqual(after);
    expect(fresh.value.links.items).toEqual(links);
    expect(fresh.value.erasures).toEqual(result.group.erasures);
    for (const response of [fresh, receipt, replay, exclusive]) {
      expect(response.text).not.toContain("owner-old-");
      expect(response.headers.get("bdp-scope-epoch")).toBe(epoch);
      expect(response.headers.get("bdp-authorization-view")).toBe(view);
      expect(response.headers.get("bdp-scope-position")).toBe("pos-3");
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (failed) errors.push(failure);
    let runtimeClosed = false,
      temporaryStoreRemoved = false;
    try {
      if (stream) await stream.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (runtime) {
        await runtime.close();
        runtimeClosed = true;
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      rmSync(directory, { recursive: true, force: true });
      temporaryStoreRemoved = true;
    } catch (error) {
      errors.push(error);
    }
    console.log(
      "OWNED_BEAD_HTTP_CLEANUP " +
        JSON.stringify({ runtimeClosed, temporaryStoreRemoved, failureCount: errors.length }),
    );
  }
  if (errors.length) throw new AggregateError(errors, "owning-Bead HTTP body/finalization failed");
}, 15000);
