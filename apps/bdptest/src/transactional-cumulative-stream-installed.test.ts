/** NEW successful SSE HEAD and one Scope-changefeed reconnect; no consumer claim. */
import { expect, it } from "vitest";
import {
  installed,
  scope,
  withStream,
  receipt,
  feed,
  row,
  validator,
} from "../test-support/transactional-cumulative-stream-runtime.js";
const task = scope + "types/task",
  relationship = scope + "types/relationship";
const seed = [
  { operation: "createBead", id: "beads/a", type: task, properties: { n: 1 } },
  { operation: "createBead", id: "beads/b", type: task, properties: { n: 2 } },
  {
    operation: "createLink",
    id: "links/ab",
    type: relationship,
    source: "beads/a",
    target: "beads/b",
    properties: { n: 3 },
  },
];
function metadata(headers: Record<string, string>, context: Record<string, string>) {
  expect(headers["content-type"]).toBe("text/event-stream");
  expect(headers["cache-control"]).toBe("no-store, no-transform");
  for (const n of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(headers[n]).toBe(context[n]);
  expect(headers["x-bdp-development-limit"]).toBeUndefined();
}
function group(g: any, r: any, previous: string, expected: unknown[]) {
  expect(g).toMatchObject({
    scopeEpoch: r.scopeEpoch,
    authorizationView: r.authorizationView,
    position: r.effectPosition,
    previousPosition: previous,
    projectionAdvance: false,
    transaction: r.transaction,
    erasures: [],
    eventCount: expected.length,
  });
  expect(g.events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null])).toEqual(
    expected,
  );
  expect(g.events).toHaveLength(expected.length);
  for (const e of g.events) {
    expect(validator.validate("#/$defs/event", e)).toEqual([]);
    expect(e.transaction).toBe(r.transaction);
    expect(e.source).toBe(scope + "events/");
    expect(Number.isFinite(Date.parse(e.time))).toBe(true);
  }
}
it.skipIf(!installed)(
  "NEW TX stream acceptable SSE HEAD ends bodyless on three inherited sources",
  async () => {
    await withStream("sse-head", async (c) => {
      c.position("pos-1");
      const r = receipt(
        await c.batch(seed, "stream-head-seed"),
        "completed",
        "pos-1",
        "stream-head-seed",
        "pos-1",
      );
      const baseline = await feed(c);
      expect(baseline).toHaveLength(1);
      for (const target of ["changes/?after=genesis", "events/", "beads/a?view=events"]) {
        const res = await c.exchange(target, undefined, undefined, {
          method: "HEAD",
          headers: { Accept: "text/event-stream" },
        });
        expect(res.wire.status, target).toBe(200);
        metadata(res.wire.headers, {
          "bdp-scope-epoch": r.scopeEpoch,
          "bdp-authorization-view": r.authorizationView,
          "bdp-scope-position": "pos-1",
        });
        expect(res.wire.bodyText).toBe("");
        expect(res.value).toBeUndefined();
        expect(res.wire.headers["bdp-scope-position"]).toBe("pos-1");
      }
      expect(await feed(c)).toEqual(baseline);
      row((await c.exchange("beads/a")).value, "beads/a", "task", { n: 1 });
      c.results.head = {
        receipt: r,
        baseline,
        sources: 3,
        finiteExactResponses: true,
        noDeliveryAcknowledgment: true,
      };
    });
  },
);
it.skipIf(!installed)(
  "NEW TX stream served Scope checkpoint overrides conflicting valid after exclusively",
  async () => {
    await withStream("scope-reconnect", async (c) => {
      c.position("pos-1");
      const r1 = receipt(
        await c.batch(seed, "stream-first"),
        "completed",
        "pos-1",
        "stream-first",
        "pos-1",
      );
      const g1 = (await feed(c))[0];
      group(g1, r1, "pos-0", [
        [0, "created", scope + "beads/a", null],
        [1, "created", scope + "beads/b", null],
        [2, "created", scope + "links/ab", null],
        [3, "linked", scope + "links/ab", "source"],
        [4, "linked", scope + "links/ab", "target"],
      ]);
      let served: string | undefined;
      await c.stream("changes/?after=genesis", undefined, async (rec: any) => {
        expect(rec.status).toBe(200);
        await rec.until(() => rec.frames.some((f: string) => f.startsWith("id: ")));
        expect(rec.frames.filter((f: string) => f.startsWith("id: "))).toHaveLength(1);
        const frame = rec.frames.find((f: string) => f.startsWith("id: "))!;
        const lines = frame.split("\n");
        expect(lines[1]).toBe("event: change-group");
        const actual = JSON.parse(lines.slice(2).join("\n").slice(6));
        expect(actual).toEqual(g1);
        served = lines[0].slice(4);
        expect(served).toBe(g1.checkpoint);
        metadata(rec.headers, {
          "bdp-scope-epoch": r1.scopeEpoch,
          "bdp-authorization-view": r1.authorizationView,
          "bdp-scope-position": "pos-1",
        });
      });
      // The observed full group is retained in results. This is a controlled transport
      // reconnect using that served ID, not a claim of durable client application.
      c.position("pos-2");
      const r2 = receipt(
        await c.batch(
          [{ operation: "createBead", id: "beads/c", type: task, properties: { n: 4 } }],
          "stream-later",
        ),
        "completed",
        "pos-2",
        "stream-later",
        "pos-2",
      );
      const all = await feed(c);
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(g1);
      const g2 = all[1];
      group(g2, r2, "pos-1", [[0, "created", scope + "beads/c", null]]);
      const expected = row(r2.results[0].resource, "beads/c", "task", { n: 4 });
      expect(g2.changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: expected },
      ]);
      expect(g2.events[0].data).toEqual({
        revision: expected.revision,
        properties: { n: 4 },
        metadata: {},
      });
      const conflicting = "changes/?after=" + encodeURIComponent(g2.checkpoint);
      const empty = await c.exchange(conflicting);
      expect(empty.value.groups).toEqual([]);
      expect(empty.value.next).toBeNull();
      await c.stream(conflicting, served, async (rec: any) => {
        expect(rec.status).toBe(200);
        await rec.until(() => rec.frames.some((f: string) => f.startsWith("id: ")));
        const frames = rec.frames.filter((f: string) => f.startsWith("id: "));
        expect(frames).toHaveLength(1);
        const lines = frames[0].split("\n");
        expect(lines[0]).toBe("id: " + g2.checkpoint);
        expect(lines[1]).toBe("event: change-group");
        expect(JSON.parse(lines.slice(2).join("\n").slice(6))).toEqual(g2);
        metadata(rec.headers, {
          "bdp-scope-epoch": r2.scopeEpoch,
          "bdp-authorization-view": r2.authorizationView,
          "bdp-scope-position": "pos-2",
        });
      });
      expect(await feed(c)).toEqual(all);
      c.results.reconnect = {
        first: r1,
        later: r2,
        baseline: g1,
        expectedLater: g2,
        servedCheckpoint: served,
        conflictingAfter: g2.checkpoint,
        withoutHeader: empty.value,
        exclusive: true,
        durableConsumerQualified: false,
      };
    });
  },
);
