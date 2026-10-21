/** NEW installed initial-HEAD branch; no runtime or retention-policy change. */
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

it.skipIf(!installed)(
  "NEW TX initial Snapshot HEAD preserves native handle capacity and issued page",
  async () => {
    await withStream("snapshot-head-capacity", async (c) => {
      const operations = Array.from({ length: 33 }, (_, n) => ({
        operation: "createBead",
        id: `beads/h${String(n).padStart(2, "0")}`,
        type: scope + "types/task",
        properties: { n },
      }));
      const resources: any[] = [];
      for (const [batch, position, key] of [
        [operations.slice(0, 32), "pos-1", "head-snapshot-seed32"],
        [operations.slice(32), "pos-2", "head-snapshot-seed1"],
      ] as const) {
        c.position(position);
        const r = receipt(await c.batch(batch, key), "completed", position, key, position);
        expect(r.results).toHaveLength(batch.length);
        expect(r.next).toBeNull();
        for (const [index, entry] of r.results.entries()) {
          const n = resources.length;
          expect(entry).toEqual({
            operationIndex: index,
            outcome: "created",
            resource: row(entry.resource, operations[n]!.id, "task", { n }),
          });
          resources.push(entry.resource);
        }
      }
      const cache = (r: any) => {
        expect(r.wire.headers["cache-control"]).toBe("private, no-store");
        expect(r.wire.headers.etag).toBeUndefined();
        expect(r.wire.headers["last-modified"]).toBeUndefined();
        expect(r.wire.headers.location).toBeUndefined();
        expect(r.wire.headers["x-bdp-development-limit"]).toBeUndefined();
      };
      const head = async () => {
        const r = await c.exchange("snapshot", undefined, undefined, { method: "HEAD" });
        expect(r.wire.status).toBe(200);
        expect(r.wire.headers["content-type"]).toBe("application/json");
        expect(r.wire.headers["content-length"]).toBeUndefined();
        expect(r.wire.bodyText).toBe("");
        expect(r.value).toBeUndefined();
        cache(r);
      };
      await head();
      await head();
      const captures: any[] = [];
      for (let n = 0; n < 8; n++) {
        if (n === 7) {
          await head();
          await head();
          await head();
        }
        const r = await c.exchange("snapshot");
        expect(r.wire.status).toBe(200);
        cache(r);
        const s = r.value;
        expect(validator.validate("#/$defs/snapshotManifest", s)).toEqual([]);
        expect(s.id).toMatch(
          /^https:\/\/reference\.invalid\/acme\/snapshot\?snapshot=[0-9a-f-]{36}$/,
        );
        expect(Date.parse(s.expiresAt)).toBeGreaterThan(Date.parse(r.wire.headers.date));
        expect(s.checkpoint).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(s.beads.next).toMatch(/^https:\/\/reference\.invalid\/acme\/snapshot\?snapshot=/);
        const page = new URL(s.beads.next);
        expect(page.searchParams.get("snapshot")).toBe(new URL(s.id).searchParams.get("snapshot"));
        expect(page.searchParams.get("stream")).toBe("beads");
        expect(page.searchParams.get("page")).toMatch(/^sp_1_[A-Za-z0-9_-]{43}$/);
        expect(s).toEqual({
          id: s.id,
          scope,
          scopeEpoch: r.wire.headers["bdp-scope-epoch"],
          authorizationView: r.wire.headers["bdp-authorization-view"],
          scopePosition: "pos-2",
          checkpoint: s.checkpoint,
          expiresAt: s.expiresAt,
          erasures: [],
          beads: { items: resources.slice(0, 32), next: s.beads.next },
          links: { items: [], next: null },
        });
        captures.push(s);
      }
      expect(new Set(captures.map((s) => s.id)).size).toBe(8);
      const refused = await c.exchange("snapshot");
      expect(refused.wire.status).toBe(503);
      expect(validator.validate("#/$defs/transactionalProblem", refused.value)).toEqual([]);
      expect(refused.value).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
      });
      expect(refused.wire.headers["retry-after"]).toMatch(/^[0-9]+$/);
      expect(Number(refused.wire.headers["retry-after"])).toBeGreaterThan(0);
      const headRefusal = await c.exchange("snapshot", undefined, undefined, { method: "HEAD" });
      expect(headRefusal.wire.status).toBe(503);
      expect(headRefusal.wire.bodyText).toBe("");
      expect(headRefusal.value).toBeUndefined();
      for (const name of [
        "content-type",
        "cache-control",
        "bdp-scope-epoch",
        "bdp-authorization-view",
        "bdp-scope-position",
      ])
        expect(headRefusal.wire.headers[name]).toBe(refused.wire.headers[name]);
      expect(Number(headRefusal.wire.headers["retry-after"])).toBeGreaterThan(0);
      const original = captures[0];
      const retained = await c.exchange(original.id);
      expect(retained.wire.status).toBe(200);
      expect(retained.value).toEqual(original);
      cache(retained);
      const page = await c.exchange(original.beads.next);
      expect(page.wire.status).toBe(200);
      expect(page.value).toEqual({ items: [resources[32]], next: null });
      cache(page);
      const pageHead = await c.exchange(original.beads.next, undefined, undefined, {
        method: "HEAD",
      });
      expect(pageHead.wire.status).toBe(200);
      expect(pageHead.wire.bodyText).toBe("");
      expect(pageHead.wire.headers["content-length"]).toBe(page.wire.headers["content-length"]);
      cache(pageHead);
      expect((await c.exchange("beads/h32")).value).toEqual(resources[32]);
      const changes = await feed(c);
      expect(changes.map((g: any) => g.position)).toEqual(["pos-1", "pos-2"]);
      expect(changes.map((g: any) => g.eventCount)).toEqual([32, 1]);
      expect(changes.flatMap((g: any) => g.changes)).toEqual(
        resources.map((resource) => ({ operation: "upsert", resourceKind: "bead", resource })),
      );
      c.results.snapshot = {
        resources,
        captures,
        firstPage: page.value,
        capacityRefusal: refused.value,
        unchangedGroups: changes,
        repeatedHead: 5,
        currentNativeLimit: 8,
        normativeInternalAllocationPolicy: "implementation detail; no usable HEAD handle",
      };
    });
  },
  85000,
);
