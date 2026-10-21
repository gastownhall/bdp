/** NEW fresh packed boundary for Donna's known/unexpired/matching-context ruling. */
import { expect, it } from "vitest";
import { start, scope, entry } from "../test-support/transactional-retained-unorderable-runtime.js";
const title =
  "NEW packed retained Snapshot and page unorderable minima use original bounded503 without renewal";
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("retained-unorderable");
    try {
      await h.launch();
      const operations = Array.from({ length: 33 }, (_, i) => ({
        operation: "createBead",
        id: `beads/r${String(i).padStart(2, "0")}`,
        type: scope + "types/task",
        properties: { title: `r${String(i).padStart(2, "0")}`, label: "snapshot", n: i },
        metadata: {},
      }));
      const batch = await h.send(
        "operations/batch",
        "POST",
        { operations: operations.slice(0, 32) },
        "minimum-seed32",
      );
      expect(batch.status).toBe(200);
      expect(batch.value.status).toBe("completed");
      expect(batch.value.results).toHaveLength(32);
      const { operation: _operation, ...lastBody } = operations[32]!;
      const last = await h.send("operations/create-bead", "POST", lastBody, "minimum-extra");
      expect(last.status).toBe(200);
      expect(last.value.status).toBe("completed");
      const records = [
        ...batch.value.results.map((r: { resource: unknown }) => r.resource),
        last.value.results[0].resource,
      ];
      for (const [i, record] of records.entries()) {
        const { operation: _op, ...expected } = operations[i]!;
        expect(record).toEqual({
          ...expected,
          id: scope + expected.id,
          revision: expect.stringMatching(/.+/),
        });
      }
      const captured = await h.send("snapshot");
      expect(captured.status).toBe(200);
      const saved = captured.value;
      expect(saved.scopePosition).toBe("pos-2");
      expect(saved.scope).toBe(scope);
      expect(saved.beads.items).toEqual(records.slice(0, 32));
      expect(saved.beads.next).toMatch(/^https:\/\/reference.invalid\/acme\/snapshot\?/);
      expect(saved.links).toEqual({ items: [], next: null });
      expect(saved.erasures).toEqual([]);
      expect(saved.expiresAt).toBe(new Date(1300000).toISOString());
      const page = await h.send(saved.beads.next);
      expect(page.status).toBe(200);
      expect(page.value).toEqual({ items: [records[32]], next: null });
      const later = await h.send(
        "operations/update-bead",
        "POST",
        {
          bead: "beads/r00",
          expectedRevision: records[0].revision,
          propertiesChange: [{ op: "replace", path: "/n", value: 999 }],
        },
        "minimum-later",
      );
      expect(later.value.requiredPosition).toBe("pos-3");
      expect(later.value.results[0].resource).toEqual({
        ...records[0],
        revision: expect.stringMatching(/.+/),
        properties: { ...operations[0]!.properties, n: 999 },
      });
      const tuple = (minimum: string) => ({
        "bdp-scope-epoch": saved.scopeEpoch,
        "bdp-authorization-view": saved.authorizationView,
        "bdp-minimum-scope-position": minimum,
        "if-none-match": "*",
      });
      for (const url of [saved.id, saved.beads.next])
        for (const method of ["GET", "HEAD"] as const) {
          const old = await h.send(url, method, undefined, undefined, "operator", tuple("pos-3"));
          expect(old.status).toBe(409);
          expect(old.headers["bdp-scope-position"]).toBe("pos-3");
          if (method === "GET")
            expect(old.value).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              title: "snapshot-position-too-old",
              status: 409,
              code: "snapshot-position-too-old",
              retry: "after-state-change",
            });
          else expect(old.bodyText).toBe("");
        }
      const probes = [
        { url: saved.id, method: "GET" as const, token: "opaque" },
        { url: saved.id, method: "HEAD" as const, token: "opaque" },
        { url: saved.beads.next as string, method: "GET" as const, token: "pos-01" },
        { url: saved.beads.next as string, method: "HEAD" as const, token: "pos-01" },
      ];
      const results = await Promise.all(
        probes.map(async (p) => ({
          probe: p,
          response: await h.send(p.url, p.method, undefined, undefined, "operator", tuple(p.token)),
        })),
      );
      for (const { probe, response: r } of results) {
        expect(r.status).toBe(503);
        expect(r.elapsedMs).toBeGreaterThanOrEqual(1000);
        expect(r.headers["content-type"]).toBe("application/problem+json");
        expect(r.headers["retry-after"]).toBe("1");
        expect(r.headers["bdp-scope-epoch"]).toBe(saved.scopeEpoch);
        expect(r.headers["bdp-authorization-view"]).toBe(saved.authorizationView);
        expect(r.headers["bdp-scope-position"]).toBe("pos-3");
        expect(r.headers.etag).toBeUndefined();
        expect(r.headers["last-modified"]).toBeUndefined();
        if (probe.method === "GET")
          expect(r.value).toEqual({
            type: "https://github.com/gastownhall/bdp/problems/unavailable",
            code: "temporarily-unavailable",
            status: 503,
            retry: "after-delay",
          });
        else expect(r.bodyText).toBe("");
      }
      expect((await h.send(saved.id)).value).toEqual(saved);
      expect((await h.send(saved.beads.next)).value).toEqual(page.value);
      const clock = await h.control("advance", { now: 1300001 });
      expect((clock.ready as { now: number }).now).toBe(1300001);
      for (const url of [saved.id, saved.beads.next])
        for (const method of ["GET", "HEAD"] as const) {
          const expired = await h.send(
            url,
            method,
            undefined,
            undefined,
            "operator",
            tuple("opaque"),
          );
          expect(expired.status).toBe(410);
          expect(expired.headers["bdp-scope-position"]).toBe("pos-3");
          if (method === "GET")
            expect(expired.value).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/gone",
              code: "cursor-expired",
              status: 410,
              retry: "after-state-change",
            });
          else expect(expired.bodyText).toBe("");
        }
      h.facts.saved = saved;
      h.facts.page = page.value;
      h.facts.completeRecords = records;
      h.facts.probes = results.map(({ probe, response }) => ({
        probe,
        status: response.status,
        elapsedMs: response.elapsedMs,
      }));
      h.facts.clock = clock;
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
    }
  },
  90000,
);
