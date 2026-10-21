/** Four NEW ordinary mutation/receipt/Event scenarios on the frozen cumulative configuration. */
import { expect, it } from "vitest";
import {
  productEntry,
  scope,
  withMutationCase,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-mutation-next-runtime.js";
const task = scope + "types/task",
  relationship = scope + "types/relationship",
  mixed = scope + "types/mixed",
  plain = scope + "types/plain",
  wild = scope + "types/wild";
const deleted = (r: any, kind: "bead" | "link") => ({
  resourceKind: kind,
  resource: { id: r.id, type: r.type, revision: r.revision },
});
function delta(actual: any, expected: unknown) {
  expect(actual).toEqual(expected);
}
it("NEW mutation delta oracle refuses snapshots, wrong prior revision and omitted metadata patch", () => {
  const expected = {
    previousRevision: "old",
    revision: "new",
    metadataChange: [{ op: "add", path: "/note", value: "kept" }],
  };
  delta(expected, expected);
  for (const bad of [
    { ...expected, properties: { n: 1 } },
    { ...expected, previousRevision: "other" },
    { previousRevision: "old", revision: "new" },
  ])
    expect(() => delta(bad, expected)).toThrow();
});
it.skipIf(!productEntry)(
  "NEW cumulative singleton complete document patches, atomic validation and revision guards",
  async () => {
    await withMutationCase("patch-guards", async (c, campaign) => {
      const p0 = { title: "old", object: { keep: true }, items: ["a", "c"], nullable: "x" },
        m0 = { flag: 1, empty: null };
      c.position("pos-1");
      const created = receipt(
        await c.exchange(
          "operations/create-bead",
          { id: "beads/a", type: task, properties: p0, metadata: m0 },
          "patch-create",
        ),
        "completed",
        "pos-1",
        "patch-create",
        "pos-1",
      );
      const a0 = row(created.results[0].resource, "beads/a", "task", p0, m0);
      expect(created.results).toEqual([{ operationIndex: 0, outcome: "created", resource: a0 }]);
      const propertiesChange = [
          { op: "add", path: "/title", value: "new" },
          { op: "add", path: "/items/1", value: "b" },
          { op: "add", path: "/items/-", value: "d" },
          { op: "add", path: "/nullable", value: null },
          { op: "remove", path: "/object/keep" },
          { op: "add", path: "/a~1b", value: { "~": 1 } },
        ],
        metadataChange = [{ op: "replace", path: "", value: { tag: "v", nested: { n: 1 } } }];
      const p1 = {
          title: "new",
          object: {},
          items: ["a", "b", "c", "d"],
          nullable: null,
          "a/b": { "~": 1 },
        },
        m1 = { tag: "v", nested: { n: 1 } };
      c.position("pos-2");
      const updated = receipt(
        await c.exchange(
          "operations/update-bead",
          { bead: "beads/a", expectedRevision: a0.revision, propertiesChange, metadataChange },
          "patch-both",
        ),
        "completed",
        "pos-2",
        "patch-both",
        "pos-2",
      );
      const a1 = row(updated.results[0].resource, "beads/a", "task", p1, m1);
      expect(a1.revision).not.toBe(a0.revision);
      expect(updated.results).toEqual([{ operationIndex: 0, outcome: "updated", resource: a1 }]);
      const noop = receipt(
        await c.exchange(
          "operations/update-bead",
          {
            bead: "beads/a",
            propertiesChange: [{ op: "replace", path: "", value: p1 }],
            metadataChange: [{ op: "replace", path: "", value: { nested: { n: 1 }, tag: "v" } }],
          },
          "patch-noop",
        ),
        "completed",
        "pos-2",
        "patch-noop",
      );
      expect(noop.results).toEqual([{ operationIndex: 0, outcome: "updated", resource: a1 }]);
      const bad = {
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/title", value: "must-rollback" }],
        metadataChange: [{ op: "replace", path: "", value: [] }],
      };
      const failed = receipt(
        await c.exchange("operations/update-bead", bad, "patch-bad-metadata"),
        "failed",
        "pos-2",
        "patch-bad-metadata",
      );
      expect(failed.problem).toMatchObject({
        code: "validation-failed",
        status: 422,
        operationIndex: 0,
      });
      expect(failed.problem.diagnostics.length).toBeGreaterThan(0);
      expect(failed.problem.diagnostics.some((d: any) => d.document === "metadata")).toBe(true);
      const retry = await c.exchange("operations/update-bead", bad, "patch-bad-metadata");
      expect(retry.value).toEqual(failed);
      expect((await c.exchange("beads/a")).value).toEqual(a1);
      c.position("pos-3");
      const strictMade = receipt(
        await c.exchange(
          "operations/create-bead",
          {
            id: "beads/s",
            type: scope + "types/strict",
            properties: { n: 1, title: "strict" },
            metadata: {},
          },
          "strict-create",
        ),
        "completed",
        "pos-3",
        "strict-create",
        "pos-3",
      );
      const s0 = row(strictMade.results[0].resource, "beads/s", "strict", {
        n: 1,
        title: "strict",
      });
      const invalid = receipt(
        await c.exchange(
          "operations/update-bead",
          {
            bead: "beads/s",
            propertiesChange: [{ op: "remove", path: "/n" }],
            metadataChange: [{ op: "add", path: "/notASchemaField", value: [null, true] }],
          },
          "strict-required",
        ),
        "failed",
        "pos-3",
        "strict-required",
      );
      expect(invalid.problem).toMatchObject({
        code: "validation-failed",
        status: 422,
        operationIndex: 0,
      });
      expect(
        invalid.problem.diagnostics.some(
          (d: any) =>
            d.type === scope + "types/strict" &&
            d.instanceLocation === "" &&
            typeof d.schemaLocation === "string" &&
            d.schemaLocation.includes("/required"),
        ),
      ).toBe(true);
      expect((await c.exchange("beads/s")).value).toEqual(s0);
      const guarded = {
        bead: "beads/s",
        expectedRevision: "wrong-observed-revision",
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        metadataChange: [{ op: "add", path: "/free", value: [null, true] }],
      };
      const mismatch = receipt(
        await c.exchange("operations/update-bead", guarded, "strict-stale"),
        "failed",
        "pos-3",
        "strict-stale",
      );
      expect(mismatch.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "revision-mismatch",
        status: 409,
        retry: "after-state-change",
        operationIndex: 0,
      });
      expect((await c.exchange("beads/s")).value).toEqual(s0);
      c.position("pos-4");
      const good = receipt(
        await c.exchange(
          "operations/update-bead",
          { ...guarded, expectedRevision: s0.revision },
          "strict-current",
        ),
        "completed",
        "pos-4",
        "strict-current",
        "pos-4",
      );
      const s1 = row(
        good.results[0].resource,
        "beads/s",
        "strict",
        { n: 2, title: "strict" },
        { free: [null, true] },
      );
      expect(s1.revision).not.toBe(s0.revision);
      c.position("pos-5");
      const cleared = receipt(
        await c.exchange(
          "operations/update-bead",
          {
            bead: "beads/a",
            propertiesChange: [{ op: "replace", path: "", value: {} }],
            metadataChange: [{ op: "replace", path: "", value: {} }],
          },
          "patch-clear",
        ),
        "completed",
        "pos-5",
        "patch-clear",
        "pos-5",
      );
      const a2 = row(cleared.results[0].resource, "beads/a", "task", {});
      expect(a2.revision).not.toBe(a1.revision);
      expect((await c.exchange("beads/a?view=properties")).value).toEqual({});
      expect((await c.exchange("beads/a")).value).toEqual(a2);
      const oldFailed = await c.exchange(failed.id);
      expect(oldFailed.wire.status).toBe(200);
      expect(oldFailed.value).toEqual(failed);
      expect(oldFailed.wire.headers["bdp-scope-position"]).toBe("pos-5");
      expect(oldFailed.value.requiredPosition).toBe("pos-2");
      const head = await c.exchange(failed.id, undefined, undefined, { method: "HEAD" });
      expect(head.wire.status).toBe(200);
      expect(head.wire.bodyText).toBe("");
      expect(head.wire.headers["cache-control"]).toBe("private, no-store");
      expect(head.wire.headers.etag).toBeUndefined();
      expect(head.wire.headers["last-modified"]).toBeUndefined();
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3", "pos-4", "pos-5"]);
      expect(groups.map((g) => g.changes)).toEqual(
        [a0, a1, s0, s1, a2].map((resource) => [
          { operation: "upsert", resourceKind: "bead", resource },
        ]),
      );
      delta(groups[1].events[0].data, {
        previousRevision: a0.revision,
        revision: a1.revision,
        change: propertiesChange,
        metadataChange,
      });
      campaign.results.patch = {
        a0,
        a1,
        a2,
        s0,
        s1,
        failed,
        invalid,
        mismatch,
        groups,
        requests: c.requests(),
        wholeContract: false,
      };
    });
  },
  65000,
);
it.skipIf(!productEntry)(
  "NEW cumulative batch receiving precedence, complete rollback and ordered deletion safety",
  async () => {
    await withMutationCase("batch-delete", async (c, campaign) => {
      const create = (id: string, name?: string) => ({
        operation: "createBead",
        id: "beads/" + id,
        type: task,
        properties: { title: id },
        ...(name ? { name } : {}),
      });
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [
            create("a"),
            create("b"),
            {
              operation: "createLink",
              id: "links/l",
              type: relationship,
              source: "beads/a",
              target: "beads/b",
              properties: { title: "l" },
            },
          ],
          "batch-seed",
        ),
        "completed",
        "pos-1",
        "batch-seed",
        "pos-1",
      );
      const a = row(seed.results[0].resource, "beads/a", "task", { title: "a" }),
        b = row(seed.results[1].resource, "beads/b", "task", { title: "b" }),
        l = row(
          seed.results[2].resource,
          "links/l",
          "relationship",
          { title: "l" },
          {},
          { source: a.id, target: b.id },
        );
      const link = {
        operation: "createLink",
        id: "links/never",
        type: relationship,
        source: "beads/a",
        target: "beads/b",
        properties: {},
      };
      const malformed = [
        { operations: [create("never")], idempotencyKey: "body-key" },
        { operations: [{ ...create("never"), idempotencyKey: "member-key" }] },
        { operations: [create("never")], undefinedField: true },
        { operations: [create("never", "same"), create("never2", "same")] },
        { operations: [{ ...link, source: "@unknown" }] },
        { operations: [{ ...link, source: "@future" }, create("future", "future")] },
        {
          operations: [
            { ...link, name: "wrongkind" },
            { ...link, id: "links/never2", source: "@wrongkind" },
          ],
        },
      ];
      for (const body of malformed) {
        const r = await c.exchange("operations/batch", body, "batch-seed", {
          stage: "carrier-syntax",
        });
        expect(r.wire.status).toBe(400);
        expect(r.value).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/request",
          code: "malformed-request",
          status: 400,
          retry: "never",
        });
      }
      for (const keys of [[], ["one", "two"]]) {
        const r = await c.exchange(
          "operations/batch",
          { operations: [create("never")] },
          undefined,
          { stage: "carrier-syntax", keys },
        );
        expect(r.wire.status).toBe(400);
        expect(r.value.code).toBe("malformed-request");
      }
      expect((await c.exchange(seed.id)).value).toEqual(seed);
      expect((await c.exchange("beads/never")).wire.status).toBe(404);
      expect((await c.exchange("links/never")).wire.status).toBe(404);
      const incident = receipt(
        await c.exchange(
          "operations/delete-bead",
          { bead: "beads/a", expectedRevision: a.revision },
          "delete-incident",
        ),
        "failed",
        "pos-1",
        "delete-incident",
      );
      expect(incident.problem).toMatchObject({
        code: "incident-links-exist",
        status: 409,
        operationIndex: 0,
      });
      const rollbackOps = [
        { operation: "deleteLink", link: "links/l" },
        { operation: "deleteBead", bead: "beads/a", expectedRevision: "wrong" },
      ];
      const rollback = receipt(
        await c.batch(rollbackOps, "delete-rollback"),
        "failed",
        "pos-1",
        "delete-rollback",
      );
      expect(rollback.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "revision-mismatch",
        status: 409,
        retry: "after-state-change",
        operationIndex: 1,
      });
      expect((await c.batch(rollbackOps, "delete-rollback")).value).toEqual(rollback);
      expect((await c.exchange("links/l")).value).toEqual(l);
      expect((await c.exchange("beads/a")).value).toEqual(a);
      expect((await c.exchange("beads/b")).value).toEqual(b);
      c.position("pos-2");
      const removed = receipt(
        await c.batch(
          [
            { operation: "deleteLink", link: "links/l", expectedRevision: l.revision },
            { operation: "deleteBead", bead: "beads/a", expectedRevision: a.revision },
            { operation: "deleteBead", bead: "beads/b", expectedRevision: b.revision },
          ],
          "delete-in-order",
        ),
        "completed",
        "pos-2",
        "delete-in-order",
        "pos-2",
      );
      expect(removed.results).toEqual(
        [l, a, b].map((resource, operationIndex) => ({
          operationIndex,
          outcome: "deleted",
          deleted: deleted(resource, operationIndex === 0 ? "link" : "bead"),
        })),
      );
      for (const target of [
        "links/l",
        "links/l?view=properties",
        "beads/a",
        "beads/a?view=properties",
        "beads/a?view=links",
        "beads/b",
      ]) {
        const gone = await c.exchange(target);
        expect(gone.wire.status).toBe(404);
        expect(gone.value.code).toBe("resource-not-found");
      }
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      expect(groups[1].changes).toEqual(
        [a, b, l].map((r, i) => ({
          operation: "tombstone",
          ...deleted(r, i === 2 ? "link" : "bead"),
        })),
      );
      expect(
        groups[1].events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null]),
      ).toEqual([
        [0, "deleted", l.id, null],
        [1, "unlinked", l.id, "source"],
        [2, "unlinked", l.id, "target"],
        [3, "deleted", a.id, null],
        [4, "deleted", b.id, null],
      ]);
      campaign.results.batch = {
        malformedCount: malformed.length + 2,
        a,
        b,
        l,
        seed,
        incident,
        rollback,
        removed,
        groups,
        requests: c.requests(),
        contextForReceivingSyntax: "raw retained, not a generic exception or predicate claim",
        wholeContract: false,
      };
    });
  },
  65000,
);
it.skipIf(!productEntry)(
  "NEW cumulative owned batch intermediate revisions and content-free Event deltas",
  async () => {
    await withMutationCase("owned-events", async (c, campaign) => {
      const emptyOwned = { [scope + "types/explicit"]: [], [scope + "types/empty"]: [] };
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [
            { operation: "createBead", id: "beads/a", type: mixed, properties: { n: 1 } },
            { operation: "createBead", id: "beads/b", type: plain, properties: { n: 1 } },
          ],
          "owned-seed",
        ),
        "completed",
        "pos-1",
        "owned-seed",
        "pos-1",
      );
      const a0 = row(
          seed.results[0].resource,
          "beads/a",
          "mixed",
          { n: 1 },
          {},
          { ownedLinks: emptyOwned },
        ),
        b = row(seed.results[1].resource, "beads/b", "plain", { n: 1 });
      const meta = [{ op: "add", path: "/note", value: "first" }],
        prop = [{ op: "replace", path: "/n", value: 2 }];
      const operations = [
        {
          operation: "createLink",
          id: "links/l",
          name: "owned",
          type: wild,
          source: "beads/a",
          target: "beads/b",
          properties: { n: 1 },
        },
        { operation: "updateLink", link: "@owned", metadataChange: meta },
        { operation: "updateLink", link: "@owned", propertiesChange: prop },
      ];
      c.position("pos-2");
      const changed = receipt(
        await c.batch(operations, "owned-three-transitions"),
        "completed",
        "pos-2",
        "owned-three-transitions",
        "pos-2",
      );
      expect(changed.results).toHaveLength(3);
      const l1 = row(
          changed.results[0].resource,
          "links/l",
          "wild",
          { n: 1 },
          {},
          { source: a0.id, target: b.id },
        ),
        l2 = row(
          changed.results[1].resource,
          "links/l",
          "wild",
          { n: 1 },
          { note: "first" },
          { source: a0.id, target: b.id },
        ),
        l3 = row(
          changed.results[2].resource,
          "links/l",
          "wild",
          { n: 2 },
          { note: "first" },
          { source: a0.id, target: b.id },
        );
      const [s1, s2, s3] = changed.results.map((r: any) => r.sourceRevision);
      expect(new Set([a0.revision, s1, s2, s3]).size).toBe(4);
      expect(new Set([l1.revision, l2.revision, l3.revision]).size).toBe(3);
      expect(changed.results).toEqual([
        {
          operationIndex: 0,
          operationName: "owned",
          outcome: "created",
          resource: l1,
          source: a0.id,
          sourceRevision: s1,
        },
        { operationIndex: 1, outcome: "updated", resource: l2, source: a0.id, sourceRevision: s2 },
        { operationIndex: 2, outcome: "updated", resource: l3, source: a0.id, sourceRevision: s3 },
      ]);
      const a3 = { ...a0, revision: s3, ownedLinks: { ...emptyOwned, [wild]: [l3] } };
      expect((await c.exchange("beads/a")).value).toEqual(a3);
      expect((await c.exchange("links/l")).value).toEqual(l3);
      expect((await c.exchange("beads/b")).value).toEqual(b);
      const groupsBefore = await feed(c);
      expect(groupsBefore.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      const g = groupsBefore[1];
      expect(g.eventCount).toBe(8);
      expect(g.events).toHaveLength(8);
      for (const e of g.events) expect(validator.validate("#/$defs/event", e)).toEqual([]);
      expect(g.changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: a3 },
        { operation: "upsert", resourceKind: "link", resource: l3 },
      ]);
      expect(
        g.events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null]),
      ).toEqual([
        [0, "created", l1.id, null],
        [1, "linked", l1.id, "source"],
        [2, "linked", l1.id, "target"],
        [3, "updated", a0.id, null],
        [4, "updated", l1.id, null],
        [5, "updated", a0.id, null],
        [6, "updated", l1.id, null],
        [7, "updated", a0.id, null],
      ]);
      delta(g.events[0].data, {
        revision: l1.revision,
        properties: { n: 1 },
        metadata: {},
        source: a0.id,
        target: b.id,
      });
      const linkMeta = {
          id: l1.id,
          type: wild,
          previousRevision: l1.revision,
          revision: l2.revision,
          metadataChange: meta,
        },
        linkProp = {
          id: l1.id,
          type: wild,
          previousRevision: l2.revision,
          revision: l3.revision,
          change: prop,
        };
      delta(g.events[3].data, {
        previousRevision: a0.revision,
        revision: s1,
        ownedLink: { operation: "created", link: l1 },
      });
      delta(g.events[4].data, {
        previousRevision: l1.revision,
        revision: l2.revision,
        metadataChange: meta,
      });
      delta(g.events[5].data, {
        previousRevision: s1,
        revision: s2,
        ownedLink: { operation: "updated", link: linkMeta },
      });
      delta(g.events[6].data, {
        previousRevision: l2.revision,
        revision: l3.revision,
        change: prop,
      });
      delta(g.events[7].data, {
        previousRevision: s2,
        revision: s3,
        ownedLink: { operation: "updated", link: linkProp },
      });
      const noop = receipt(
        await c.exchange(
          "operations/update-link",
          {
            link: "links/l",
            propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
            metadataChange: [{ op: "replace", path: "/note", value: "first" }],
          },
          "owned-noop",
        ),
        "completed",
        "pos-2",
        "owned-noop",
      );
      expect(noop.results).toEqual([
        { operationIndex: 0, outcome: "updated", resource: l3, source: a0.id, sourceRevision: s3 },
      ]);
      expect((await c.exchange("beads/a")).value).toEqual(a3);
      c.position("pos-3");
      const removed = receipt(
        await c.exchange(
          "operations/delete-link",
          { link: "links/l", expectedRevision: l3.revision },
          "owned-delete",
        ),
        "completed",
        "pos-3",
        "owned-delete",
        "pos-3",
      );
      const last = removed.results[0];
      expect(last).toEqual({
        operationIndex: 0,
        outcome: "deleted",
        deleted: deleted(l3, "link"),
        source: a0.id,
        sourceRevision: last.sourceRevision,
      });
      expect(last.sourceRevision).not.toBe(s3);
      const a4 = { ...a0, revision: last.sourceRevision };
      expect((await c.exchange("beads/a")).value).toEqual(a4);
      expect((await c.exchange("beads/b")).value).toEqual(b);
      expect((await c.exchange("links/l")).wire.status).toBe(404);
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      expect(groups[1]).toEqual(g);
      const d = groups[2];
      expect(d.eventCount).toBe(4);
      expect(
        d.events.map((e: any) => [e.ordinal, e.type, e.subject, e.data.endpoint ?? null]),
      ).toEqual([
        [0, "deleted", l3.id, null],
        [1, "unlinked", l3.id, "source"],
        [2, "unlinked", l3.id, "target"],
        [3, "updated", a0.id, null],
      ]);
      delta(d.events[0].data, { revision: l3.revision });
      delta(d.events[3].data, {
        previousRevision: s3,
        revision: last.sourceRevision,
        ownedLink: { operation: "deleted", link: { id: l3.id, type: wild, revision: l3.revision } },
      });
      expect(d.changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: a4 },
        { operation: "tombstone", ...deleted(l3, "link") },
      ]);
      campaign.results.owned = {
        a0,
        b,
        l1,
        l2,
        l3,
        a3,
        a4,
        changed,
        noop,
        removed,
        groups,
        requests: c.requests(),
        wholeContract: false,
      };
    });
  },
  65000,
);
it.skipIf(!productEntry)(
  "NEW cumulative metadata-only incident-Link facts at both endpoint sources",
  async () => {
    await withMutationCase("incident-metadata", async (c, campaign) => {
      c.position("pos-1");
      const seed = receipt(
        await c.batch(
          [
            { operation: "createBead", id: "beads/a", type: task, properties: { title: "a" } },
            { operation: "createBead", id: "beads/b", type: task, properties: { title: "b" } },
            {
              operation: "createLink",
              id: "links/l",
              type: relationship,
              source: "beads/a",
              target: "beads/b",
              properties: { n: 0 },
            },
          ],
          "incident-seed",
        ),
        "completed",
        "pos-1",
        "incident-seed",
        "pos-1",
      );
      const a = row(seed.results[0].resource, "beads/a", "task", { title: "a" }),
        b = row(seed.results[1].resource, "beads/b", "task", { title: "b" }),
        l0 = row(
          seed.results[2].resource,
          "links/l",
          "relationship",
          { n: 0 },
          {},
          { source: a.id, target: b.id },
        );
      const first = [{ op: "add", path: "/note", value: "first" }],
        second = [{ op: "replace", path: "/note", value: "second" }],
        equal = [{ op: "replace", path: "/n", value: 0 }];
      c.position("pos-2");
      const one = receipt(
        await c.exchange(
          "operations/update-link",
          { link: "links/l", metadataChange: first },
          "incident-first",
        ),
        "completed",
        "pos-2",
        "incident-first",
        "pos-2",
      );
      const l1 = row(
        one.results[0].resource,
        "links/l",
        "relationship",
        { n: 0 },
        { note: "first" },
        { source: a.id, target: b.id },
      );
      expect(one.results).toEqual([{ operationIndex: 0, outcome: "updated", resource: l1 }]);
      c.position("pos-3");
      const two = receipt(
        await c.exchange(
          "operations/update-link",
          { link: "links/l", propertiesChange: equal, metadataChange: second },
          "incident-second",
        ),
        "completed",
        "pos-3",
        "incident-second",
        "pos-3",
      );
      const l2 = row(
        two.results[0].resource,
        "links/l",
        "relationship",
        { n: 0 },
        { note: "second" },
        { source: a.id, target: b.id },
      );
      expect(two.results).toEqual([{ operationIndex: 0, outcome: "updated", resource: l2 }]);
      expect(new Set([l0.revision, l1.revision, l2.revision]).size).toBe(3);
      expect((await c.exchange("beads/a")).value).toEqual(a);
      expect((await c.exchange("beads/b")).value).toEqual(b);
      const sources = ["links/l?view=events", "beads/a?view=events", "beads/b?view=events"],
        before: any[] = [];
      for (const target of sources) {
        const r = await c.exchange(target);
        expect(r.wire.status).toBe(200);
        expect(r.value.next).toBeNull();
        expect(r.value.source).toBe(scope + target);
        for (const e of r.value.events) expect(validator.validate("#/$defs/event", e)).toEqual([]);
        before.push(r.value);
      }
      const updates = before[0].events.filter((e: any) => e.type === "updated");
      expect(updates).toHaveLength(2);
      delta(updates[0].data, {
        previousRevision: l0.revision,
        revision: l1.revision,
        metadataChange: first,
      });
      delta(updates[1].data, {
        previousRevision: l1.revision,
        revision: l2.revision,
        change: equal,
        metadataChange: second,
      });
      const semantic = (e: any) => ({
        transaction: e.transaction,
        ordinal: e.ordinal,
        time: e.time,
        subject: e.subject,
        subjectType: e.subjectType,
        type: e.type,
        data: e.data,
      });
      for (const page of before.slice(1))
        expect(
          page.events.filter((e: any) => e.subject === l0.id && e.type === "updated").map(semantic),
        ).toEqual(updates.map(semantic));
      const noop = receipt(
        await c.exchange(
          "operations/update-link",
          { link: "links/l", propertiesChange: equal, metadataChange: second },
          "incident-noop",
        ),
        "completed",
        "pos-3",
        "incident-noop",
      );
      expect(noop.results).toEqual([{ operationIndex: 0, outcome: "updated", resource: l2 }]);
      for (const [i, target] of sources.entries())
        expect((await c.exchange(target)).value).toEqual(before[i]);
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      expect(groups.slice(1).map((g) => g.events.length)).toEqual([1, 1]);
      expect(groups.slice(1).map((g) => g.changes)).toEqual(
        [l1, l2].map((resource) => [{ operation: "upsert", resourceKind: "link", resource }]),
      );
      campaign.results.incident = {
        a,
        b,
        l0,
        l1,
        l2,
        one,
        two,
        noop,
        before,
        groups,
        requests: c.requests(),
        sourceDomain:
          "Event cursors/source differ across sources; SAME transaction/ordinal/time/subject/type/data facts, no cross-source cursor-equality claim",
        wholeContract: false,
      };
    });
  },
  65000,
);
