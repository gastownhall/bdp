import { expect, it } from "vitest";
import {
  installed,
  withWideFailure,
  scope,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-wide-failure-runtime.js";

it.skipIf(!installed)(
  "NEW TX wide-failure rolls back a staged update at the genuine 33-match transaction limit and retains the whole failed receipt",
  async () => {
    await withWideFailure("matched-resources-wide-failure", async (c) => {
      const ids = Array.from({ length: 33 }, (_, i) => `beads/w${String(i).padStart(2, "0")}`);
      const properties = ids.map((id) => ({ n: 0, label: id }));
      const operations = ids.map((id, i) => ({
        operation: "createBead",
        id,
        type: scope + "types/task",
        properties: properties[i],
      }));
      c.position("pos-1");
      const first = receipt(
        await c.batch(operations.slice(0, 32), "wide-seed-32"),
        "completed",
        "pos-1",
        "wide-seed-32",
        "pos-1",
      );
      c.position("pos-2");
      const second = receipt(
        await c.batch(operations.slice(32), "wide-seed-1"),
        "completed",
        "pos-2",
        "wide-seed-1",
        "pos-2",
      );
      // Full semantic expected records are authored above; only opaque revisions come from the real creations.
      const records = [...first.results, ...second.results].map((r: any, i: number) => {
        expect(r).toEqual({
          operationIndex: i === 32 ? 0 : i,
          outcome: "created",
          resource: r.resource,
        });
        return row(r.resource, ids[i]!, "task", properties[i]);
      });
      expect(new Set(records.map((r) => r.revision)).size).toBe(33);
      async function collection() {
        const result: any[] = [];
        let next: string | null = "beads/?limit=32";
        for (let pages = 0; next !== null; pages++) {
          expect(pages).toBeLessThan(2);
          const response: any = await c.exchange(next);
          expect(response.wire.status).toBe(200);
          expect(Object.keys(response.value).sort()).toEqual(["items", "next"]);
          result.push(...response.value.items);
          next = response.value.next;
        }
        expect(result).toEqual(records);
        return result;
      }
      const before = await collection();
      const originalGroups = await feed(c);
      expect(originalGroups).toHaveLength(2);
      for (const [i, group] of originalGroups.entries()) {
        const expected = i === 0 ? records.slice(0, 32) : records.slice(32);
        expect(group.position).toBe(`pos-${i + 1}`);
        expect(group.previousPosition).toBe(`pos-${i}`);
        expect(group.projectionAdvance).toBe(false);
        expect(group.transaction).toBe([first, second][i].transaction);
        expect(group.erasures).toEqual([]);
        expect(group.changes).toEqual(
          expected.map((resource) => ({ operation: "upsert", resourceKind: "bead", resource })),
        );
        expect(group.eventCount).toBe(expected.length);
        expect(group.events).toHaveLength(expected.length);
        for (const [ordinal, event] of group.events.entries()) {
          expect(validator.validate("#/$defs/event", event)).toEqual([]);
          expect(event).toMatchObject({
            ordinal,
            type: "created",
            subject: expected[ordinal].id,
            transaction: group.transaction,
            source: scope + "events/",
            data: {
              revision: expected[ordinal].revision,
              properties: expected[ordinal].properties,
              metadata: {},
            },
          });
        }
      }
      const body = {
        operations: [
          {
            operation: "updateBead",
            bead: ids[0],
            expectedRevision: records[0].revision,
            propertiesChange: [{ op: "replace", path: "/label", value: "MUST-ROLL-BACK" }],
          },
          { operation: "deleteWhere", collection: "beads", selector: "$[?@.properties.n == 0]" },
        ],
      };
      const key = "wide-post-admission-limit";
      const failed = receipt(
        await c.exchange("operations/batch", body, key),
        "failed",
        "pos-2",
        key,
      );
      expect(failed.problem).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/size",
        status: 413,
        code: "limit-exceeded",
        retry: "never",
        limit: "transaction.matchedResources",
      });
      expect(failed).not.toHaveProperty("results");
      expect(failed.problem).not.toHaveProperty("operationIndex");
      expect(failed.problem).not.toHaveProperty("operationName");
      expect((await c.exchange("operations/batch", body, key)).value).toEqual(failed);
      expect((await c.exchange(failed.id)).value).toEqual(failed);
      expect(await collection()).toEqual(before);
      expect(await feed(c)).toEqual(originalGroups);
      c.results.transactionWide = {
        sourceLimit: { matchedResources: 32, inducedEvents: 256, publicAdvertisementClaim: false },
        expectedRecords: records,
        before,
        originalGroups,
        submitted: body,
        failed,
        after: records,
        originalGroupCount: 2,
        originalEventCount: 33,
      };
    });
  },
);
