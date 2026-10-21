/** NEW genuine empty-policy projection advance; no fine-grained policy/provider fiction. */
import { expect, it } from "vitest";
import {
  installed,
  scope,
  withHiddenAdvance,
  row,
  receipt,
  validator,
} from "../test-support/transactional-cumulative-hidden-advance-runtime.js";
const task = scope + "types/task",
  relationship = scope + "types/relationship";
it.skipIf(!installed)(
  "NEW TX hidden-advance empty policy serves exact identifier-free new-view checkpoint",
  async () => {
    await withHiddenAdvance("projection-advance", async (c) => {
      c.position("pos-1");
      const original = receipt(
        await c.batch(
          [
            {
              operation: "createBead",
              id: "beads/hidden-a",
              type: task,
              properties: { n: 1, secret: "hidden-alpha" },
            },
            {
              operation: "createBead",
              id: "beads/hidden-b",
              type: task,
              properties: { n: 2, secret: "hidden-beta" },
            },
            {
              operation: "createLink",
              id: "links/hidden-ab",
              type: relationship,
              source: "beads/hidden-a",
              target: "beads/hidden-b",
              properties: { n: 3, secret: "hidden-link" },
            },
          ],
          "hidden-original",
        ),
        "completed",
        "pos-1",
        "hidden-original",
        "pos-1",
      );
      const a = row(original.results[0].resource, "beads/hidden-a", "task", {
          n: 1,
          secret: "hidden-alpha",
        }),
        b = row(original.results[1].resource, "beads/hidden-b", "task", {
          n: 2,
          secret: "hidden-beta",
        }),
        link = row(
          original.results[2].resource,
          "links/hidden-ab",
          "relationship",
          { n: 3, secret: "hidden-link" },
          { source: a.id, target: b.id },
        );
      const visible = await c.exchange("changes/?after=genesis");
      expect(visible.wire.status).toBe(200);
      expect(visible.value.groups).toHaveLength(1);
      expect(visible.value.next).toBeNull();
      const old = visible.value.groups[0];
      expect(old).toMatchObject({
        scopeEpoch: original.scopeEpoch,
        authorizationView: original.authorizationView,
        position: "pos-1",
        previousPosition: "pos-0",
        projectionAdvance: false,
        transaction: original.transaction,
        erasures: [],
        eventCount: 5,
      });
      expect(old.changes).toEqual(
        [a, b, link].map((resource, i) => ({
          operation: "upsert",
          resourceKind: i === 2 ? "link" : "bead",
          resource,
        })),
      );
      expect(
        old.events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null]),
      ).toEqual([
        [0, "created", a.id, null],
        [1, "created", b.id, null],
        [2, "created", link.id, null],
        [3, "linked", link.id, "source"],
        [4, "linked", link.id, "target"],
      ]);
      for (const e of old.events) {
        expect(validator.validate("#/$defs/event", e)).toEqual([]);
        expect(e.source).toBe(scope + "events/");
        expect(e.transaction).toBe(original.transaction);
        expect(Number.isFinite(Date.parse(e.time))).toBe(true);
      }
      const transition = await c.control();
      c.newView();
      // A new-view genesis request is genuine; the old-view checkpoint is retained
      // as old evidence and is never sent as though it belonged to the replacement view.
      const hidden = await c.exchange("changes/?after=genesis");
      expect(hidden.wire.status).toBe(200);
      expect(hidden.wire.headers["cache-control"]).toBe("private, no-store");
      expect(hidden.wire.headers["content-type"]).toBe("application/json");
      const epoch = hidden.wire.headers["bdp-scope-epoch"],
        view = hidden.wire.headers["bdp-authorization-view"];
      expect(epoch).toBe(original.scopeEpoch);
      expect(view).not.toBe(original.authorizationView);
      expect(hidden.wire.headers["bdp-scope-position"]).toBe("pos-1");
      expect(hidden.value.groups).toHaveLength(1);
      const advance = hidden.value.groups[0];
      expect(advance.checkpoint).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(advance.checkpoint).not.toBe(old.checkpoint);
      const expected = {
        scopeEpoch: epoch,
        authorizationView: view,
        checkpoint: advance.checkpoint,
        position: "pos-1",
        previousPosition: "pos-0",
        projectionAdvance: true,
        eventCount: 0,
        changes: [],
        erasures: [],
        events: [],
      };
      expect(advance).toEqual(expected);
      expect(advance).not.toHaveProperty("transaction");
      expect(hidden.value).toEqual({
        scope,
        scopeEpoch: epoch,
        authorizationView: view,
        after: "genesis",
        observedHeadPosition: "pos-1",
        groups: [expected],
        next: null,
      });
      const hiddenText = JSON.stringify(hidden.value),
        forbidden = [
          original.transaction,
          original.id,
          original.idempotencyKey,
          ...[a, b, link].flatMap((r) => [r.id, r.type, r.revision]),
          ...old.events.map((e: any) => e.id),
          "hidden-alpha",
          "hidden-beta",
          "hidden-link",
        ];
      for (const secret of forbidden) expect(hiddenText).not.toContain(secret);
      const suffix = await c.exchange("changes/?after=" + encodeURIComponent(advance.checkpoint));
      expect(suffix.wire.status).toBe(200);
      expect(suffix.value).toEqual({
        scope,
        scopeEpoch: epoch,
        authorizationView: view,
        after: advance.checkpoint,
        observedHeadPosition: "pos-1",
        groups: [],
        next: null,
      });
      const events = await c.exchange("events/");
      expect(events.wire.status).toBe(200);
      expect(events.value).toEqual({ source: scope + "events/", events: [], next: null });
      const snapshot = await c.exchange("snapshot");
      expect(snapshot.wire.status).toBe(200);
      expect(snapshot.value).toMatchObject({
        scopeEpoch: epoch,
        authorizationView: view,
        scopePosition: "pos-1",
        beads: { items: [], next: null },
        links: { items: [], next: null },
        erasures: [],
      });
      expect((await c.exchange("changes/?after=genesis")).value).toEqual(hidden.value);
      c.results.projection = {
        originalReceipt: original,
        fullOriginalGroup: old,
        originalRows: [a, b, link],
        transition,
        expectedAdvance: expected,
        actualNewPage: hidden.value,
        actualNewCheckpointSuffix: suffix.value,
        scopeEvents: events.value,
        emptySnapshot: snapshot.value,
        forbiddenOriginalValues: forbidden,
        oldCheckpointNeverReused: true,
      };
    });
  },
);
