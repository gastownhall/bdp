/** NEW settled retained-receipt policy/minimum boundary, no old233 cohort replay. */
import { expect, it } from "vitest";
import {
  installed,
  scope,
  withRetained,
  row,
  receipt,
  validator,
} from "../test-support/transactional-cumulative-retained-runtime.js";
const type = scope + "types/task";
function currentHeaders(r: any, epoch: string, view: string) {
  expect(r.wire.headers["bdp-scope-epoch"]).toBe(epoch);
  expect(r.wire.headers["bdp-authorization-view"]).toBe(view);
  expect(r.wire.headers["bdp-scope-position"]).toBe("pos-2");
}
function receiptHeaders(r: any) {
  expect(r.wire.headers["cache-control"]).toBe("private, no-store");
  expect(r.wire.headers.etag).toBeUndefined();
  expect(r.wire.headers["last-modified"]).toBeUndefined();
}
it.skipIf(!installed)(
  "NEW TX retained one-result whole-withheld and failed execution fact keep recorded body distinct from replacement-view minimum",
  async () => {
    await withRetained("one-result-current-view", async (c) => {
      const body = { id: "beads/retained", type, properties: { n: 1 }, metadata: {} };
      c.position("pos-1");
      const initialResponse = await c.exchange("operations/create-bead", body, "retained-original"),
        completed = receipt(initialResponse, "completed", "pos-1", "retained-original", "pos-1");
      const original = row(completed.results[0].resource, "beads/retained", "task", { n: 1 });
      expect(completed.results).toEqual([
        { operationIndex: 0, outcome: "created", resource: original },
      ]);
      const failed = receipt(
        await c.exchange(
          "operations/update-bead",
          { bead: "beads/missing", propertiesChange: [{ op: "replace", path: "/n", value: 3 }] },
          "retained-failed",
        ),
        "failed",
        "pos-1",
        "retained-failed",
      );
      expect(failed.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        code: "resource-not-found",
        status: 404,
        retry: "after-state-change",
        operationIndex: 0,
      });
      c.position("pos-2");
      const changed = receipt(
          await c.exchange(
            "operations/update-bead",
            {
              bead: "beads/retained",
              expectedRevision: original.revision,
              propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
            },
            "retained-later",
          ),
          "completed",
          "pos-2",
          "retained-later",
          "pos-2",
        ),
        current = row(changed.results[0].resource, "beads/retained", "task", { n: 2 });
      expect(current.revision).not.toBe(original.revision);
      expect((await c.exchange("beads/retained")).value).toEqual(current);
      const before = await c.exchange(completed.id),
        failedBefore = await c.exchange(failed.id);
      expect(before.value).toEqual(completed);
      expect(failedBefore.value).toEqual(failed);
      const oldEpoch = completed.scopeEpoch,
        oldView = completed.authorizationView;
      currentHeaders(before, oldEpoch, oldView);
      expect(completed.requiredPosition).toBe("pos-1");
      expect(before.wire.headers["bdp-scope-position"]).toBe("pos-2");
      const transition = await c.control();
      c.newView();
      const snapshot = await c.exchange("snapshot");
      expect(snapshot.wire.status).toBe(200);
      expect(snapshot.value.scopeEpoch).toBe(oldEpoch);
      expect(snapshot.value.authorizationView).not.toBe(oldView);
      expect(snapshot.value.scopePosition).toBe("pos-2");
      expect(snapshot.value.beads).toEqual({ items: [], next: null });
      expect(snapshot.value.links).toEqual({ items: [], next: null });
      expect(snapshot.value.erasures).toEqual([]);
      const newView = snapshot.value.authorizationView;
      currentHeaders(snapshot, oldEpoch, newView);
      const hiddenResource = await c.exchange("beads/retained");
      expect(hiddenResource.wire.status).toBe(404);
      expect(hiddenResource.value.code).toBe("resource-not-found");
      const { results: _results, next: _next, expiresAt: _expiresAt, ...retained } = completed,
        withheld = { ...retained, detail: "withheld" };
      const expectedPairs = [
        [completed.id, withheld],
        [failed.id, failed],
      ] as const;
      async function checkPair(url: string, expected: any, minimum?: Record<string, string>) {
        const get = await c.exchange(url, undefined, undefined, { minimum });
        expect(get.wire.status).toBe(200);
        expect(get.value).toEqual(expected);
        expect(validator.validate("#/$defs/mutationReceipt", get.value)).toEqual([]);
        receiptHeaders(get);
        currentHeaders(get, oldEpoch, newView);
        const head = await c.exchange(url, undefined, undefined, { method: "HEAD", minimum });
        expect(head.wire.status).toBe(200);
        expect(head.wire.bodyText).toBe("");
        expect(head.wire.headers["content-length"]).toBe(
          String(Buffer.byteLength(get.wire.bodyText)),
        );
        receiptHeaders(head);
        currentHeaders(head, oldEpoch, newView);
        return get.value;
      }
      for (const [url, expected] of expectedPairs) await checkPair(url, expected);
      const minimum = {
        "bdp-scope-epoch": snapshot.wire.headers["bdp-scope-epoch"],
        "bdp-authorization-view": snapshot.wire.headers["bdp-authorization-view"],
        "bdp-minimum-scope-position": snapshot.wire.headers["bdp-scope-position"],
      };
      expect(minimum["bdp-minimum-scope-position"]).toBe("pos-2");
      for (const [url, expected] of expectedPairs) await checkPair(url, expected, minimum);
      const recordedMinimum = {
        "bdp-scope-epoch": completed.scopeEpoch,
        "bdp-authorization-view": completed.authorizationView,
        "bdp-minimum-scope-position": completed.requiredPosition,
      };
      for (const [url] of expectedPairs)
        for (const method of ["GET", "HEAD"] as const) {
          const refusal = await c.exchange(url, undefined, undefined, {
            method,
            minimum: recordedMinimum,
          });
          expect(refusal.wire.status).toBe(409);
          currentHeaders(refusal, oldEpoch, newView);
          expect(refusal.wire.headers["cache-control"]).toBe("private, no-store");
          if (method === "GET")
            expect(refusal.value).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              code: "foreign-view",
              status: 409,
              retry: "after-state-change",
            });
          else expect(refusal.wire.bodyText).toBe("");
        }
      for (const [url, expected] of expectedPairs)
        expect((await c.exchange(url)).value).toEqual(expected);
      const after = await c.exchange("snapshot");
      expect(after.value.scopePosition).toBe("pos-2");
      expect(after.value.authorizationView).toBe(newView);
      expect(after.value.beads).toEqual({ items: [], next: null });
      expect(after.value.erasures).toEqual([]);
      c.results.retained = {
        original,
        current,
        completed,
        failed,
        transition,
        withheld,
        oldEpoch,
        oldView,
        newView,
        snapshot: snapshot.value,
        minimum,
        recordedMinimum,
        after: after.value,
        unexercised:
          "No mixed relabel of an old body position into a newview, unknown order, foreign+expired Snapshot, positive History permission or page-loss fault selected",
      };
    });
  },
  85000,
);
