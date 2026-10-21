/** NEW actual receipt-root refusal and explicit Scope-changefeed intent observations. */
import { expect, it } from "vitest";
import {
  installed,
  scope,
  withRouteRefusals,
  receipt,
  row,
  feed,
  validator,
} from "../test-support/transactional-cumulative-route-refusals-runtime.js";
const task = scope + "types/task";
const bead = (id: string, n: number) => ({
  operation: "createBead",
  id: "beads/" + id,
  type: task,
  properties: { n },
});
function refusal(r: any, status: number, code: string, family: string, retry: string) {
  expect(r.wire.status).toBe(status);
  expect(r.wire.headers["content-type"]).toBe("application/problem+json");
  expect(r.wire.headers["cache-control"]).toBe("private, no-store");
  expect(r.wire.headers.etag).toBeUndefined();
  expect(r.wire.headers["last-modified"]).toBeUndefined();
  expect(r.value).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/" + family,
    status,
    code,
    retry,
  });
}
function head(h: any, g: any) {
  expect(h.wire.status).toBe(g.wire.status);
  expect(h.wire.bodyText).toBe("");
  expect(h.value).toBeUndefined();
  for (const name of [
    "content-type",
    "cache-control",
    "content-length",
    "bdp-scope-epoch",
    "bdp-authorization-view",
    "bdp-scope-position",
  ])
    expect(h.wire.headers[name], name).toBe(g.wire.headers[name]);
  expect(h.wire.headers["content-length"]).toBe(String(Buffer.byteLength(g.wire.bodyText)));
}
it.skipIf(!installed)(
  "NEW TX route-refusals discovered receipts root does not list or resolve an existing key",
  async () => {
    await withRouteRefusals("receipt-root", async (c) => {
      c.position("pos-1");
      const body = [bead("receipt-root", 1)],
        key = "route-root-key";
      const original = receipt(await c.batch(body, key), "completed", "pos-1", key, "pos-1");
      const expected = row(original.results[0].resource, "beads/receipt-root", "task", { n: 1 });
      const discovery = await c.exchange("bdp.json");
      expect(discovery.wire.status).toBe(200);
      expect(discovery.value.receipts).toBe(scope + "receipts/");
      const baseline = await feed(c);
      expect(baseline).toHaveLength(1);
      const headers = { "Idempotency-Key": key };
      const get = await c.exchange(discovery.value.receipts, undefined, undefined, { headers });
      refusal(get, 404, "resource-not-found", "not-found", "after-state-change");
      const h = await c.exchange(discovery.value.receipts, undefined, undefined, {
        method: "HEAD",
        headers,
      });
      head(h, get);
      // Recovery is the original mutation with its original key, never namespace lookup.
      const replay = receipt(await c.batch(body, key), "completed", "pos-1", key, "pos-1");
      expect(replay).toEqual(original);
      expect((await c.exchange(original.id)).value).toEqual(original);
      expect((await c.exchange(expected.id)).value).toEqual(expected);
      expect(await feed(c)).toEqual(baseline);
      c.results.root = {
        discovered: discovery.value.receipts,
        existingKey: key,
        original,
        replay,
        expected,
        baseline,
        rootGET: get.value,
        rootHEADbodyless: true,
      };
    });
  },
);
it.skipIf(!installed)(
  "NEW TX route-refusals missing start is invalid and served Last-Event-ID overrides explicit start now",
  async () => {
    await withRouteRefusals("changefeed-intent", async (c) => {
      c.position("pos-1");
      const first = receipt(
        await c.batch([bead("start-a", 1)], "start-first"),
        "completed",
        "pos-1",
        "start-first",
        "pos-1",
      );
      const baseline = await feed(c);
      expect(baseline).toHaveLength(1);
      const g1 = baseline[0];
      const get = await c.exchange("changes/", undefined, undefined, {
        headers: { Accept: "application/json" },
        expectedContext: "absent",
      });
      refusal(get, 400, "invalid-parameter", "request", "never");
      const h = await c.exchange("changes/", undefined, undefined, {
        method: "HEAD",
        headers: { Accept: "application/json" },
        expectedContext: "absent",
      });
      head(h, get);
      let served: string | undefined;
      await c.stream("changes/?after=genesis", undefined, async (rec: any) => {
        expect(rec.status).toBe(200);
        await rec.until(() => rec.frames.some((f: string) => f.startsWith("id: ")));
        const fs = rec.frames.filter((f: string) => f.startsWith("id: "));
        expect(fs).toHaveLength(1);
        const lines = fs[0].split("\n");
        expect(lines[1]).toBe("event: change-group");
        expect(JSON.parse(lines.slice(2).join("\n").slice(6))).toEqual(g1);
        served = lines[0].slice(4);
        expect(served).toBe(g1.checkpoint);
      });
      c.position("pos-2");
      const later = receipt(
        await c.batch([bead("start-b", 2)], "start-later"),
        "completed",
        "pos-2",
        "start-later",
        "pos-2",
      );
      const all = await feed(c);
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(g1);
      const g2 = all[1];
      const expected = row(later.results[0].resource, "beads/start-b", "task", { n: 2 });
      expect(g2).toMatchObject({
        scopeEpoch: later.scopeEpoch,
        authorizationView: later.authorizationView,
        position: "pos-2",
        previousPosition: "pos-1",
        projectionAdvance: false,
        transaction: later.transaction,
        erasures: [],
        eventCount: 1,
      });
      expect(g2.changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: expected },
      ]);
      expect(g2.events).toHaveLength(1);
      expect(validator.validate("#/$defs/event", g2.events[0])).toEqual([]);
      expect(g2.events[0]).toMatchObject({
        ordinal: 0,
        type: "created",
        source: scope + "events/",
        subject: expected.id,
        subjectType: task,
        transaction: later.transaction,
        data: { revision: expected.revision, properties: { n: 2 }, metadata: {} },
      });
      expect(Number.isFinite(Date.parse(g2.events[0].time))).toBe(true);
      const now = await c.exchange("changes/?start=now");
      expect(now.value.groups).toEqual([]);
      expect(now.value.next).toBeNull();
      expect(now.value.observedHeadPosition).toBe("pos-2");
      await c.stream("changes/?start=now", served, async (rec: any) => {
        expect(rec.status).toBe(200);
        expect(rec.headers["content-type"]).toBe("text/event-stream");
        expect(rec.headers["cache-control"]).toBe("no-store, no-transform");
        expect([
          rec.headers["bdp-scope-epoch"],
          rec.headers["bdp-authorization-view"],
          rec.headers["bdp-scope-position"],
        ]).toEqual([later.scopeEpoch, later.authorizationView, "pos-2"]);
        await rec.until(() => rec.frames.some((f: string) => f.startsWith("id: ")));
        const fs = rec.frames.filter((f: string) => f.startsWith("id: "));
        expect(fs).toHaveLength(1);
        const lines = fs[0].split("\n");
        expect(lines[0]).toBe("id: " + g2.checkpoint);
        expect(lines[1]).toBe("event: change-group");
        expect(JSON.parse(lines.slice(2).join("\n").slice(6))).toEqual(g2);
      });
      expect(await feed(c)).toEqual(all);
      expect((await c.exchange(expected.id)).value).toEqual(expected);
      c.results.intent = {
        first,
        later,
        missingIntent: get.value,
        firstGroup: g1,
        laterGroup: g2,
        servedCheckpoint: served,
        startNowWithoutHeader: now.value,
        exclusive: true,
        durableConsumerQualified: false,
      };
    });
  },
);
