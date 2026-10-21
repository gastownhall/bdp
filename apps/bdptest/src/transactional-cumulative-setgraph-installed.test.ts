/** Only NEW finite TX set/graph scenarios; no existing236/550 campaign replay. */
import { expect, it } from "vitest";
import {
  installed,
  scope,
  withSetgraph,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-setgraph-runtime.js";
const task = scope + "types/task",
  plain = scope + "types/plain",
  only = scope + "types/only",
  mixed = scope + "types/mixed",
  explicit = scope + "types/explicit",
  empty = scope + "types/empty",
  wild = scope + "types/wild",
  relationship = scope + "types/relationship";
const bead = (id: string, type: string, n: number) => ({
  operation: "createBead",
  id: "beads/" + id,
  type,
  properties: { n },
});
const link = (id: string, type: string, source: string, target: string, n = 0) => ({
  operation: "createLink",
  id: "links/" + id,
  type,
  source: "beads/" + source,
  target: "beads/" + target,
  properties: { n },
});
const identity = (r: any, kind: "bead" | "link") => ({
  resourceKind: kind,
  resource: { id: r.id, type: r.type, revision: r.revision },
});
function events(g: any, expected: unknown[]) {
  expect(g.eventCount).toBe(expected.length);
  expect(g.events).toHaveLength(expected.length);
  expect(g.events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null])).toEqual(
    expected,
  );
  for (const e of g.events) {
    expect(validator.validate("#/$defs/event", e)).toEqual([]);
    expect(e.transaction).toBe(g.transaction);
  }
}
it.skipIf(!installed)(
  "NEW TX setgraph concurrent Type-owned last-slot keeps one complete Link and retained outcomes",
  async () => {
    await withSetgraph("type-owned-race", async (c) => {
      c.position("pos-1");
      const seed = receipt(
        await c.batch([bead("s", mixed, 1), bead("t", plain, 2)], "race-seed"),
        "completed",
        "pos-1",
        "race-seed",
        "pos-1",
      );
      const s0 = row(
          seed.results[0].resource,
          "beads/s",
          "mixed",
          { n: 1 },
          { ownedLinks: { [explicit]: [], [empty]: [] } },
        ),
        t = row(seed.results[1].resource, "beads/t", "plain", { n: 2 });
      const bodies = [link("x", explicit, "s", "t", 1), link("y", explicit, "s", "t", 2)].map(
          ({ operation: _operation, ...body }) => body,
        ),
        keys = ["race-x", "race-y"];
      c.position("pos-2");
      const responses = await Promise.all(
        bodies.map((body, i) => c.exchange("operations/create-link", body, keys[i])),
      );
      const wins = responses
          .map((r: any, i: number) => ({ r, i }))
          .filter(({ r }: any) => r.value.status === "completed"),
        losses = responses
          .map((r: any, i: number) => ({ r, i }))
          .filter(({ r }: any) => r.value.status === "failed");
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      const { r: wr, i: wi } = wins[0]!,
        { r: lr, i: li } = losses[0]!;
      const win = receipt(wr, "completed", "pos-2", keys[wi]!, "pos-2"),
        lost = receipt(lr, "failed", "pos-2", keys[li]!);
      expect(lost.problem).toMatchObject({
        type: "https://github.com/gastownhall/bdp/problems/validation",
        code: "validation-failed",
        status: 422,
        retry: "never",
        operationIndex: 0,
      });
      expect(lost.problem.diagnostics.length).toBeGreaterThan(0);
      expect(lost.problem.diagnostics.some((d: any) => d.type === mixed)).toBe(true);
      const winner = row(
        win.results[0].resource,
        wi === 0 ? "links/x" : "links/y",
        "explicit",
        { n: wi + 1 },
        { source: s0.id, target: t.id },
      );
      expect(win.results).toEqual([
        {
          operationIndex: 0,
          outcome: "created",
          resource: winner,
          source: s0.id,
          sourceRevision: win.results[0].sourceRevision,
        },
      ]);
      const current = {
        ...s0,
        revision: win.results[0].sourceRevision,
        ownedLinks: { [explicit]: [winner], [empty]: [] },
      };
      expect(current.revision).not.toBe(s0.revision);
      expect((await c.exchange("beads/s")).value).toEqual(current);
      expect((await c.exchange("beads/t")).value).toEqual(t);
      expect((await c.exchange("links/")).value).toEqual({ items: [winner], next: null });
      expect((await c.exchange(li === 0 ? "links/x" : "links/y")).wire.status).toBe(404);
      for (let i = 0; i < 2; i++) {
        expect((await c.exchange("operations/create-link", bodies[i], keys[i])).value).toEqual(
          responses[i].value,
        );
        expect((await c.exchange(responses[i].value.id)).value).toEqual(responses[i].value);
      }
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      events(groups[1], [
        [0, "created", winner.id, null],
        [1, "linked", winner.id, "source"],
        [2, "linked", winner.id, "target"],
        [3, "updated", s0.id, null],
      ]);
      expect(groups[1].changes).toHaveLength(2);
      expect(groups[1].changes).toEqual(
        expect.arrayContaining([
          { operation: "upsert", resourceKind: "bead", resource: current },
          { operation: "upsert", resourceKind: "link", resource: winner },
        ]),
      );
      c.results.race = {
        win,
        lost,
        s0,
        current,
        t,
        winner,
        groups,
        classification:
          "Type-owned max1 serializability/validation422; NOT Scope aggregate409; native Scope policy[]",
      };
    });
  },
  85000,
);
it.skipIf(!installed)(
  "NEW TX setgraph DeleteWhere selects complete post-prefix set in canonical order and zero match makes no Event",
  async () => {
    await withSetgraph("delete-complete", async (c) => {
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [bead("z", task, 7), bead("m", task, 7), bead("a", task, 7), bead("keep", task, 9)],
          "delete-seed",
        ),
        "completed",
        "pos-1",
        "delete-seed",
        "pos-1",
      );
      const initial = seed.results.map((r: any, i: number) =>
        row(r.resource, ["beads/z", "beads/m", "beads/a", "beads/keep"][i]!, "task", {
          n: i === 3 ? 9 : 7,
        }),
      );
      const initialPage = await c.exchange("beads/");
      expect(initialPage.value.items).toEqual([initial[2], initial[3]]);
      expect(typeof initialPage.value.next).toBe("string");
      const initialTail = await c.exchange(initialPage.value.next);
      expect(initialTail.value).toEqual({ items: [initial[1], initial[0]], next: null });
      expect([...initialPage.value.items, ...initialTail.value.items]).toEqual([
        initial[2],
        initial[3],
        initial[1],
        initial[0],
      ]);
      c.position("pos-2");
      const removed = receipt(
        await c.batch(
          [
            {
              operation: "updateBead",
              bead: "beads/keep",
              propertiesChange: [{ op: "replace", path: "/n", value: 7 }],
            },
            {
              operation: "deleteWhere",
              collection: "beads",
              selector: "$[?@.properties.n == 7]",
              cardinality: { min: 4, max: 4 },
            },
          ],
          "delete-post-prefix",
        ),
        "completed",
        "pos-2",
        "delete-post-prefix",
        "pos-2",
      );
      const changed = row(removed.results[0].resource, "beads/keep", "task", { n: 7 }),
        selected = [initial[2], changed, initial[1], initial[0]];
      expect(removed.results).toEqual([
        { operationIndex: 0, outcome: "updated", resource: changed },
        { operationIndex: 1, outcome: "matched", count: 4 },
        ...selected.map((r) => ({
          operationIndex: 1,
          outcome: "deleted",
          deleted: identity(r, "bead"),
        })),
      ]);
      expect((await c.exchange("beads/")).value).toEqual({ items: [], next: null });
      for (const r of selected) expect((await c.exchange(r.id)).wire.status).toBe(404);
      const before = await feed(c);
      expect(before.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      events(before[1], [
        [0, "updated", changed.id, null],
        ...selected.map((r, i) => [i + 1, "deleted", r.id, null]),
      ]);
      expect(before[1].changes).toHaveLength(4);
      expect(before[1].changes).toEqual(
        expect.arrayContaining(
          selected.map((r) => ({ operation: "tombstone", ...identity(r, "bead") })),
        ),
      );
      for (const [i, r] of selected.entries())
        expect(before[1].events[i + 1].data).toEqual({ revision: r.revision });
      const zeroBody = { collection: "beads", selector: "$[?@.properties.n == 7]" };
      const zero = receipt(
        await c.exchange("operations/delete-where", zeroBody, "delete-zero"),
        "completed",
        "pos-2",
        "delete-zero",
      );
      expect(zero.results).toEqual([{ operationIndex: 0, outcome: "matched", count: 0 }]);
      expect((await c.exchange("operations/delete-where", zeroBody, "delete-zero")).value).toEqual(
        zero,
      );
      expect(await feed(c)).toEqual(before);
      c.results.deletion = { initial, changed, selected, removed, zero, groups: before };
    });
  },
  85000,
);
it.skipIf(!installed)(
  "NEW TX setgraph provenance fans out to selected owned Links and each fresh source version in canonical Event order",
  async () => {
    await withSetgraph("provenance-fanout", async (c) => {
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [
            bead("s", only, 1),
            bead("u", only, 2),
            bead("t", plain, 3),
            link("z", wild, "s", "t"),
            link("a", wild, "u", "t"),
          ],
          "fan-seed",
        ),
        "completed",
        "pos-1",
        "fan-seed",
        "pos-1",
      );
      const s0 = row(seed.results[0].resource, "beads/s", "only", { n: 1 }, { ownedLinks: {} }),
        u0 = row(seed.results[1].resource, "beads/u", "only", { n: 2 }, { ownedLinks: {} }),
        t = row(seed.results[2].resource, "beads/t", "plain", { n: 3 });
      const z0 = row(
          seed.results[3].resource,
          "links/z",
          "wild",
          { n: 0 },
          { source: s0.id, target: t.id },
        ),
        a0 = row(
          seed.results[4].resource,
          "links/a",
          "wild",
          { n: 0 },
          { source: u0.id, target: t.id },
        );
      const oldSources = [
        { ...u0, revision: seed.results[4].sourceRevision, ownedLinks: { [wild]: [a0] } },
        { ...s0, revision: seed.results[3].sourceRevision, ownedLinks: { [wild]: [z0] } },
      ];
      const attribution = { actor: { id: "writer:setgraph", basis: "writer-supplied" } },
        change = [{ op: "replace", path: "/n", value: 1 }];
      c.position("pos-2");
      const updated = receipt(
        await c.exchange(
          "operations/update-where",
          {
            collection: "links",
            selector: "$[?@.properties.n == 0]",
            change,
            revisionProvenance: attribution,
          },
          "fan-update",
        ),
        "completed",
        "pos-2",
        "fan-update",
        "pos-2",
      );
      expect(updated.results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 2 });
      const a1 = row(
          updated.results[1].resource,
          "links/a",
          "wild",
          { n: 1 },
          { source: u0.id, target: t.id, revisionProvenance: attribution },
        ),
        z1 = row(
          updated.results[2].resource,
          "links/z",
          "wild",
          { n: 1 },
          { source: s0.id, target: t.id, revisionProvenance: attribution },
        );
      const sources = oldSources.map((r, i) => ({
        ...r,
        revision: updated.results[i + 1].sourceRevision,
        ownedLinks: { [wild]: [[a1, z1][i]] },
        revisionProvenance: attribution,
      }));
      expect(updated.results).toEqual([
        { operationIndex: 0, outcome: "matched", count: 2 },
        ...[a1, z1].map((r, i) => ({
          operationIndex: 0,
          outcome: "updated",
          resource: r,
          source: sources[i].id,
          sourceRevision: sources[i].revision,
        })),
      ]);
      for (const r of [a1, z1, ...sources, t]) expect((await c.exchange(r.id)).value).toEqual(r);
      const before = await feed(c);
      events(before[1], [
        [0, "updated", a1.id, null],
        [1, "updated", u0.id, null],
        [2, "updated", z1.id, null],
        [3, "updated", s0.id, null],
      ]);
      for (let i = 0; i < 2; i++) {
        const old = [a0, z0][i],
          fresh = [a1, z1][i];
        const linkDelta = {
          previousRevision: old.revision,
          revision: fresh.revision,
          change,
          revisionProvenance: attribution,
        };
        expect(before[1].events[2 * i].data).toEqual(linkDelta);
        expect(before[1].events[2 * i + 1].data).toEqual({
          previousRevision: oldSources[i].revision,
          revision: sources[i].revision,
          revisionProvenance: attribution,
          ownedLink: { operation: "updated", link: { id: fresh.id, type: wild, ...linkDelta } },
        });
      }
      const deletedAttribution = { actor: { id: "writer:cleanup", basis: "unknown" } };
      c.position("pos-3");
      const deleted = receipt(
        await c.exchange(
          "operations/delete-where",
          {
            collection: "links",
            selector: "$[?@.properties.n == 1]",
            revisionProvenance: deletedAttribution,
          },
          "fan-delete",
        ),
        "completed",
        "pos-3",
        "fan-delete",
        "pos-3",
      );
      expect(deleted.results).toEqual([
        { operationIndex: 0, outcome: "matched", count: 2 },
        ...[a1, z1].map((r, i) => ({
          operationIndex: 0,
          outcome: "deleted",
          deleted: identity(r, "link"),
          source: sources[i].id,
          sourceRevision: deleted.results[i + 1].sourceRevision,
        })),
      ]);
      const finalSources = sources.map((r, i) => ({
        ...r,
        revision: deleted.results[i + 1].sourceRevision,
        ownedLinks: {},
        revisionProvenance: deletedAttribution,
      }));
      for (const r of [...finalSources, t]) expect((await c.exchange(r.id)).value).toEqual(r);
      expect((await c.exchange("links/")).value).toEqual({ items: [], next: null });
      const groups = await feed(c);
      expect(groups[1]).toEqual(before[1]);
      events(groups[2], [
        [0, "deleted", a1.id, null],
        [1, "unlinked", a1.id, "source"],
        [2, "unlinked", a1.id, "target"],
        [3, "updated", u0.id, null],
        [4, "deleted", z1.id, null],
        [5, "unlinked", z1.id, "source"],
        [6, "unlinked", z1.id, "target"],
        [7, "updated", s0.id, null],
      ]);
      for (let i = 0; i < 2; i++) {
        const r = [a1, z1][i];
        expect(groups[2].events[4 * i].data).toEqual({ revision: r.revision });
        expect(groups[2].events[4 * i + 3].data).toEqual({
          previousRevision: sources[i].revision,
          revision: finalSources[i].revision,
          revisionProvenance: deletedAttribution,
          ownedLink: {
            operation: "deleted",
            link: { id: r.id, type: r.type, revision: r.revision },
          },
        });
      }
      c.results.fanout = {
        a0,
        z0,
        a1,
        z1,
        oldSources,
        sources,
        finalSources,
        t,
        attribution,
        deletedAttribution,
        updated,
        deleted,
        groups,
      };
    });
  },
  85000,
);
it.skipIf(!installed)(
  "NEW TX setgraph self-Link creation and deletion keep two graph endpoint labels while update is deduplicated",
  async () => {
    await withSetgraph("self-link", async (c) => {
      c.position("pos-1");
      const seed = receipt(
          await c.batch([bead("self", task, 1)], "self-seed"),
          "completed",
          "pos-1",
          "self-seed",
          "pos-1",
        ),
        b = row(seed.results[0].resource, "beads/self", "task", { n: 1 });
      c.position("pos-2");
      const created = receipt(
          await c.batch([link("self", relationship, "self", "self", 0)], "self-create"),
          "completed",
          "pos-2",
          "self-create",
          "pos-2",
        ),
        l0 = row(
          created.results[0].resource,
          "links/self",
          "relationship",
          { n: 0 },
          { source: b.id, target: b.id },
        );
      c.position("pos-3");
      const change = [{ op: "replace", path: "/n", value: 1 }],
        updated = receipt(
          await c.exchange(
            "operations/update-link",
            { link: "links/self", propertiesChange: change },
            "self-update",
          ),
          "completed",
          "pos-3",
          "self-update",
          "pos-3",
        ),
        l1 = row(
          updated.results[0].resource,
          "links/self",
          "relationship",
          { n: 1 },
          { source: b.id, target: b.id },
        );
      c.position("pos-4");
      const deleted = receipt(
        await c.exchange(
          "operations/delete-link",
          { link: "links/self", expectedRevision: l1.revision },
          "self-delete",
        ),
        "completed",
        "pos-4",
        "self-delete",
        "pos-4",
      );
      expect(deleted.results).toEqual([
        { operationIndex: 0, outcome: "deleted", deleted: identity(l1, "link") },
      ]);
      expect((await c.exchange("beads/self")).value).toEqual(b);
      expect((await c.exchange("links/self")).wire.status).toBe(404);
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3", "pos-4"]);
      events(groups[1], [
        [0, "created", l0.id, null],
        [1, "linked", l0.id, "source"],
        [2, "linked", l0.id, "target"],
      ]);
      events(groups[2], [[0, "updated", l0.id, null]]);
      events(groups[3], [
        [0, "deleted", l0.id, null],
        [1, "unlinked", l0.id, "source"],
        [2, "unlinked", l0.id, "target"],
      ]);
      const graph = (endpoint: string) => ({
        endpoint,
        link: { id: l0.id, type: relationship },
        source: b.id,
        target: b.id,
      });
      for (const g of [groups[1], groups[3]]) {
        expect(g.events[1].data).toEqual(graph("source"));
        expect(g.events[2].data).toEqual(graph("target"));
      }
      expect(groups[2].events[0].data).toEqual({
        previousRevision: l0.revision,
        revision: l1.revision,
        change,
      });
      const page = await c.exchange("beads/self?view=events");
      expect(page.wire.status).toBe(200);
      expect(page.value.next).toBeNull();
      const projected = page.value.events.filter((e: any) => e.subject === l0.id);
      expect(projected.map((e: any) => [e.type, e.ordinal, e.data.endpoint ?? null])).toEqual([
        ["linked", 1, "source"],
        ["linked", 2, "target"],
        ["updated", 0, null],
        ["unlinked", 1, "source"],
        ["unlinked", 2, "target"],
      ]);
      const semantic = (e: any) => ({
        transaction: e.transaction,
        ordinal: e.ordinal,
        time: e.time,
        subject: e.subject,
        subjectType: e.subjectType,
        type: e.type,
        data: e.data,
      });
      expect(projected.map(semantic)).toEqual(
        [
          groups[1].events[1],
          groups[1].events[2],
          groups[2].events[0],
          groups[3].events[1],
          groups[3].events[2],
        ].map(semantic),
      );
      c.results.self = { b, l0, l1, created, updated, deleted, groups, endpointSource: page.value };
    });
  },
  85000,
);
