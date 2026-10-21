import { expect, it } from "vitest";
import {
  installed,
  scope,
  withExpiredSequence,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-expired-sequence-runtime.js";
const type = scope + "types/task";
it.skipIf(!installed)(
  "NEW TX expired-sequence creation allocation differs from update and alias while a new dependent uses retained identity",
  async () => {
    await withExpiredSequence("expired-complements", async (c) => {
      const creation = { type, properties: { n: 0, label: "original" }, metadata: {} };
      c.position("pos-1");
      const createdReceipt = receipt(
        await c.exchange("operations/create-bead", creation, "expired-create"),
        "completed",
        "pos-1",
        "expired-create",
        "pos-1",
      );
      const created = row(
        createdReceipt.results[0].resource,
        createdReceipt.results[0].resource.id.slice(scope.length),
        "task",
        creation.properties,
      );
      expect(created.id).toMatch(
        /^https:\/\/reference\.invalid\/acme\/beads\/[A-Za-z0-9_-]{1,256}$/,
      );
      expect(createdReceipt.results).toEqual([
        { operationIndex: 0, outcome: "created", resource: created },
      ]);
      const update = {
        bead: created.id,
        expectedRevision: created.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      };
      c.position("pos-2");
      const updatedReceipt = receipt(
        await c.exchange("operations/update-bead", update, "expired-update"),
        "completed",
        "pos-2",
        "expired-update",
        "pos-2",
      );
      const updated = row(
        updatedReceipt.results[0].resource,
        created.id.slice(scope.length),
        "task",
        { n: 1, label: "original" },
      );
      expect(updatedReceipt.results).toEqual([
        { operationIndex: 0, outcome: "updated", resource: updated },
      ]);
      expect(updated.revision).not.toBe(created.revision);
      const alias = { alias: "alias/expired-name", target: created.id };
      const aliasReceipt = receipt(
        await c.exchange("operations/put-alias", alias, "expired-alias"),
        "completed",
        "pos-2",
        "expired-alias",
      );
      expect(aliasReceipt.results).toEqual([
        { operationIndex: 0, outcome: "created", alias: scope + alias.alias, target: created.id },
      ]);
      for (const r of [createdReceipt, updatedReceipt, aliasReceipt])
        expect(Date.parse(r.expiresAt)).toBe(87400000);
      const before = await feed(c);
      expect(before).toHaveLength(2);
      expect(
        before.map((g: any) => [g.position, g.previousPosition, g.transaction, g.eventCount]),
      ).toEqual([
        ["pos-1", "pos-0", createdReceipt.transaction, 1],
        ["pos-2", "pos-1", updatedReceipt.transaction, 1],
      ]);
      for (const [i, g] of before.entries()) {
        const resource = i === 0 ? created : updated;
        expect(g.changes).toEqual([{ operation: "upsert", resourceKind: "bead", resource }]);
        expect(g.erasures).toEqual([]);
        expect(g.projectionAdvance).toBe(false);
        expect(g.events).toHaveLength(1);
        const event = g.events[0];
        expect(validator.validate("#/$defs/event", event)).toEqual([]);
        expect(event).toMatchObject({
          ordinal: 0,
          type: i === 0 ? "created" : "updated",
          subject: created.id,
          transaction: g.transaction,
          source: scope + "events/",
        });
        expect(event.data).toEqual(
          i === 0
            ? { revision: created.revision, properties: creation.properties, metadata: {} }
            : {
                previousRevision: created.revision,
                revision: updated.revision,
                change: update.propertiesChange,
              },
        );
      }
      expect((await c.exchange(created.id)).value).toEqual(updated);
      const aliasBefore = await c.exchange(alias.alias);
      expect(aliasBefore.wire.status).toBe(307);
      expect(aliasBefore.wire.headers.location).toBe(created.id);
      expect(aliasBefore.wire.bodyText).toBe("");
      const transition = await c.control();
      const expired = {
        type: "https://github.com/gastownhall/bdp/problems/gone",
        status: 410,
        code: "idempotency-expired",
        retry: "never",
      };
      const operations = [
        {
          operation: "createBead",
          idempotencyKey: "expired-create",
          name: "expired-creator",
          ...creation,
        },
        { operation: "updateBead", idempotencyKey: "expired-update", ...update },
        { operation: "putAlias", idempotencyKey: "expired-alias", ...alias },
        {
          operation: "updateBead",
          idempotencyKey: "new-dependent",
          bead: "@expired-creator",
          expectedRevision: updated.revision,
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        },
      ];
      c.position("pos-3");
      const response = await c.exchange("operations/sequence", { operations });
      expect(response.wire.status).toBe(200);
      expect(validator.validate("#/$defs/transactionalSequenceResponse", response.value)).toEqual(
        [],
      );
      const final = row(
        response.value.results[3].resource,
        created.id.slice(scope.length),
        "task",
        { n: 2, label: "original" },
      );
      expect(final.revision).not.toBe(updated.revision);
      const expected = {
        results: [
          {
            ...expired,
            allocated: { id: created.id, type },
            operationIndex: 0,
            operationName: "expired-creator",
          },
          { ...expired, operationIndex: 1 },
          { ...expired, operationIndex: 2 },
          { operationIndex: 3, outcome: "updated", resource: final },
        ],
      };
      expect(response.value).toEqual(expected);
      expect((await c.exchange("operations/sequence", { operations })).value).toEqual(expected);
      expect((await c.exchange(created.id)).value).toEqual(final);
      expect((await c.exchange("beads/")).value).toEqual({ items: [final], next: null });
      const aliasAfter = await c.exchange(alias.alias);
      expect(aliasAfter.wire.status).toBe(307);
      expect(aliasAfter.wire.headers.location).toBe(created.id);
      expect(aliasAfter.wire.bodyText).toBe("");
      const after = await feed(c);
      expect(after).toHaveLength(3);
      expect(after.slice(0, 2)).toEqual(before);
      const last = after[2];
      expect(last).toMatchObject({
        position: "pos-3",
        previousPosition: "pos-2",
        projectionAdvance: false,
        eventCount: 1,
        erasures: [],
      });
      expect(last.changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: final },
      ]);
      expect(last.events).toHaveLength(1);
      expect(last.events[0]).toMatchObject({
        ordinal: 0,
        type: "updated",
        subject: created.id,
        source: scope + "events/",
        transaction: last.transaction,
      });
      expect(last.events[0].data).toEqual({
        previousRevision: updated.revision,
        revision: final.revision,
        change: [{ op: "replace", path: "/n", value: 2 }],
      });
      c.results.expired = {
        createdReceipt,
        updatedReceipt,
        aliasReceipt,
        created,
        updated,
        final,
        before,
        after,
        transition,
        sequence: { operations },
        response: expected,
        allocatedIdentityRetained: true,
        aliasBefore: aliasBefore.wire.headers,
        aliasAfter: aliasAfter.wire.headers,
      };
    });
  },
  90000,
);
