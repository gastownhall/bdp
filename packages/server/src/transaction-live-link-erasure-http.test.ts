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

it("serves atomic unowned-Link correction and tombstone over actual HTTP/SSE, preserves opaque cursors and reopens with erased replay", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-link-http-")),
    scope = "https://live-link-http.test/s/",
    bead = `${scope}types/task`,
    link = `${scope}types/link`,
    token = randomBytes(32).toString("base64url");
  const options = {
    directory,
    scope,
    port: 0,
    create: true,
    types: [
      parseTypeDescriptor({ id: bead, name: "Task", describes: "bead", conformsTo: [] }),
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
      "LIVE_LINK_HTTP_RESPONSE " +
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
    const create = {
      operations: [
        { operation: "createBead", id: "beads/a", type: bead, properties: { safe: "a" } },
        { operation: "createBead", id: "beads/b", type: bead, properties: { safe: "b" } },
        {
          operation: "createLink",
          id: "links/l",
          type: link,
          source: "beads/a",
          target: "beads/b",
          properties: { secret: "link-http-old" },
          metadata: { secret: "link-http-meta" },
        },
      ],
    };
    const created = await request("operations/batch", create, "create");
    expect(created.status).toBe(200);
    const old = created.value.results[2].resource,
      epoch = created.headers.get("bdp-scope-epoch"),
      view = created.headers.get("bdp-authorization-view");
    const saved = await request("snapshot"),
      page = await request("beads/?limit=1"),
      feed = await request("changes/?after=genesis"),
      events = await request("events/");
    expect(saved.status).toBe(200);
    expect(page.status).toBe(200);
    expect(page.value.next).toBeTypeOf("string");
    const checkpoint = feed.value.groups[0].checkpoint,
      oldCursor = events.value.events.find(
        (event: { type: string; subject: string }) =>
          event.type === "linked" && event.subject === old.id,
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
    const corrected = admin.correctLiveLinkVersion(
      old.id,
      old.revision,
      prepareTransactionSingleton(
        scope,
        "updateLink",
        JSON.stringify({
          link: old.id,
          expectedRevision: old.revision,
          propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
          metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
        }),
      ),
    );
    const next = corrected.group.changes[0]!.resource;
    await stream.until(() => stream!.frames.some((frame) => frame.includes('"position":"pos-2"')));
    const groups = () =>
      stream!.frames
        .filter((frame) => frame.startsWith("id: "))
        .map((frame) => JSON.parse(frame.split("\ndata: ")[1]!));
    expect(groups()[0]).toMatchObject({
      position: "pos-2",
      scopeEpoch: epoch,
      authorizationView: view,
      changes: corrected.group.changes,
      erasures: corrected.group.erasures,
      eventCount: 1,
      events: [
        {
          type: "updated",
          subject: old.id,
          data: {
            previousRevision: old.revision,
            revision: next.revision,
            change: [{ op: "replace", path: "", value: { corrected: true } }],
            metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
          },
        },
      ],
    });
    expect((await request(page.value.next)).status).toBe(410);
    expect((await request(saved.value.id)).status).toBe(410);
    expect((await request(`changes/?after=${encodeURIComponent(checkpoint)}`)).status).toBe(410);
    expect((await request("links/l")).value).toEqual(next);
    expect((await request("beads/a")).value).toEqual(created.value.results[0].resource);
    const exclusive = await request(`events/?after=${encodeURIComponent(oldCursor)}`);
    expect(exclusive.status).toBe(200);
    expect(exclusive.value.events.map((event: { type: string }) => event.type)).toEqual([
      "linked",
      "updated",
    ]);
    const deleted = admin.tombstoneLiveLinkVersion(old.id, next.revision);
    expect(deleted).not.toHaveProperty("receipt");
    await stream.until(() => stream!.frames.some((frame) => frame.includes('"position":"pos-3"')));
    expect(groups()).toHaveLength(2);
    expect(groups()[1]).toMatchObject({
      position: "pos-3",
      scopeEpoch: epoch,
      authorizationView: view,
      transaction: deleted.group.transaction,
      projectionAdvance: false,
      erasures: deleted.group.erasures,
      changes: [
        {
          operation: "tombstone",
          resourceKind: "link",
          resource: { id: old.id, type: old.type, revision: next.revision },
        },
      ],
      eventCount: 1,
      events: [{ type: "deleted", subject: old.id, data: { revision: next.revision } }],
    });
    expect(Object.keys(groups()[1].events[0].data)).toEqual(["revision"]);
    for (const group of groups()) {
      expect(group).not.toHaveProperty("erasurePruned");
      expect(JSON.stringify(group)).not.toContain("link-http-old");
      expect(JSON.stringify(group)).not.toContain("link-http-meta");
    }
    const after = await request(`events/?after=${encodeURIComponent(oldCursor)}`);
    expect(after.status).toBe(200);
    expect(after.value.events.map((event: { type: string }) => event.type)).toEqual(["deleted"]);
    expect((await request("links/l")).status).toBe(404);
    const receipt = await request(created.value.id),
      replay = await request("operations/batch", create, "create");
    expect(receipt.status).toBe(200);
    expect(receipt.value.results[2]).toEqual({
      operationIndex: 2,
      outcome: "erased",
      erased: { id: old.id, type: old.type, revision: old.revision },
    });
    expect(replay.value.results).toEqual(receipt.value.results);
    expect(replay.value.id).toBe(created.value.id);
    await stream.close();
    console.log(
      "LIVE_LINK_SSE_EVIDENCE " +
        JSON.stringify({ status: stream.status, frames: groups(), destroyed: stream.destroyed }),
    );
    await runtime.close();
    expect(() => admin.tombstoneLiveLinkVersion(old.id, next.revision)).toThrow(
      "transaction runtime is closing",
    );
    runtime = await startTransactionRuntime({ ...options, create: false });
    const fresh = await request("snapshot"),
      again = await request("operations/batch", create, "create");
    expect(fresh.value.links.items).toEqual([]);
    expect(fresh.value.beads.items).toEqual(
      created.value.results.slice(0, 2).map((result: { resource: unknown }) => result.resource),
    );
    expect(fresh.value.erasures).toEqual([...corrected.group.erasures, ...deleted.group.erasures]);
    expect(again.value.results).toEqual(receipt.value.results);
    expect(again.value.id).toBe(created.value.id);
    for (const value of [fresh, again, after, receipt, replay]) {
      expect(value.text).not.toContain("link-http-old");
      expect(value.text).not.toContain("link-http-meta");
      expect(value.headers.get("bdp-scope-epoch")).toBe(epoch);
      expect(value.headers.get("bdp-authorization-view")).toBe(view);
      expect(value.headers.get("bdp-scope-position")).toBe("pos-3");
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const errors: unknown[] = failed ? [failure] : [];
    let runtimeClosed = false;
    let temporaryStoreRemoved = false;
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
      "LIVE_LINK_HTTP_CLEANUP " +
        JSON.stringify({ runtimeClosed, temporaryStoreRemoved, failureCount: errors.length }),
    );
    if (errors.length)
      throw new AggregateError(errors, "Link HTTP fixture body/finalization failed");
  }
}, 15000);
