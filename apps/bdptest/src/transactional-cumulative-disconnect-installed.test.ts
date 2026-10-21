/** NEW actual socket loss after native admission; no emulated transaction outcome. */
import { expect, it } from "vitest";
import {
  start,
  scope,
  entry,
} from "../test-support/transactional-cumulative-disconnect-runtime.js";
const title =
  "NEW TX admitted raw socket disconnect preserves one native execution and terminal receipt";
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("admitted-disconnect");
    try {
      await h.launch();
      const create = {
        type: scope + "types/task",
        properties: { title: "lost acknowledgement", label: "real-socket", n: 7 },
        metadata: { transport: "admitted-disconnect" },
      };
      const key = "disconnected-allocated-create";
      const lost = await h.submitLost({
        operations: [{ operation: "createBead", idempotencyKey: key, ...create }],
      });
      const admitted = await h.control("await", { ordinal: 1 });
      const held = [{ ordinal: 1, cancelled: false, released: false }];
      expect(admitted.state).toEqual(held);
      const before = await h.send("operations/create-bead", "POST", create, key);
      expect(before.status).toBe(202);
      expect(before.value).toEqual({
        id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/receipts\/.+$/),
        status: "pending",
        idempotencyKey: key,
        scopeEpoch: before.headers["bdp-scope-epoch"],
        authorizationView: before.headers["bdp-authorization-view"],
        transaction: expect.stringMatching(/.+/),
      });
      expect(before.headers["bdp-scope-position"]).toBe("pos-0");
      await lost.destroyBeforeResponse();
      expect(lost.evidence).toMatchObject({
        writeComplete: true,
        deliberatelyDestroyed: true,
        closed: true,
        destroyed: true,
        beforeDestroyResponseBytes: 0,
        responsePrefixBytes: 0,
        responseComplete: false,
        outcomeFromTransport: "UNKNOWN",
      });
      expect(lost.evidence.bytesWritten).toBe(lost.evidence.requestBytes);
      const still = await h.send("operations/create-bead", "POST", create, key);
      expect(still.status).toBe(202);
      expect(still.value).toEqual(before.value);
      const retained = await h.send(before.value.id);
      expect(retained.value).toEqual(before.value);
      const empty = await h.send("changes/?after=genesis");
      expect(empty.value.groups).toEqual([]);
      expect(empty.value.observedHeadPosition).toBe("pos-0");
      expect((await h.control("await", { ordinal: 1 })).state).toEqual(held);
      const released = await h.control("release", { ordinal: 1 });
      expect(released.state).toEqual([{ ordinal: 1, cancelled: false, released: true }]);
      let retry = await h.send("operations/create-bead", "POST", create, key);
      for (let i = 0; retry.status === 202 && i < 8; i++)
        retry = await h.send("operations/create-bead", "POST", create, key);
      expect(retry.status).toBe(200);
      const receipt = retry.value;
      expect(receipt).toEqual({
        ...before.value,
        status: "completed",
        detail: "available",
        requiredPosition: "pos-1",
        effectPosition: "pos-1",
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Z$/),
        results: [{ operationIndex: 0, outcome: "created", resource: expect.any(Object) }],
        next: null,
      });
      expect(Number.isFinite(Date.parse(receipt.expiresAt))).toBe(true);
      const record = receipt.results[0].resource;
      expect(record).toEqual({
        ...create,
        id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/beads\/[A-Za-z0-9_-]+$/),
        revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
      });
      expect((await h.send(record.id)).value).toEqual(record);
      expect((await h.send(receipt.id)).value).toEqual(receipt);
      const again = await h.send("operations/create-bead", "POST", create, key);
      expect(again.status).toBe(200);
      expect(again.value).toEqual(receipt);
      const mismatch = await h.send(
        "operations/create-bead",
        "POST",
        { ...create, properties: { ...create.properties, n: 8 } },
        key,
      );
      expect(mismatch.status).toBe(409);
      expect(mismatch.value.code).toBe("idempotency-conflict");
      const collection = await h.send("beads/");
      expect(collection.value.items).toEqual([record]);
      expect(collection.value.next).toBeNull();
      const page = await h.send("changes/?after=genesis");
      expect(page.value.next).toBeNull();
      expect(page.value.observedHeadPosition).toBe("pos-1");
      expect(page.value.groups).toHaveLength(1);
      const group = page.value.groups[0];
      expect(group).toEqual({
        scopeEpoch: receipt.scopeEpoch,
        authorizationView: receipt.authorizationView,
        checkpoint: expect.stringMatching(/.+/),
        position: "pos-1",
        previousPosition: "pos-0",
        projectionAdvance: false,
        transaction: receipt.transaction,
        changes: [{ operation: "upsert", resourceKind: "bead", resource: record }],
        erasures: [],
        eventCount: 1,
        events: [
          {
            id: expect.stringMatching(/.+/),
            ordinal: 0,
            type: "created",
            source: scope + "events/",
            subject: record.id,
            subjectType: create.type,
            transaction: receipt.transaction,
            time: expect.stringMatching(/.+/),
            data: {
              revision: record.revision,
              properties: create.properties,
              metadata: create.metadata,
            },
          },
        ],
      });
      expect(Number.isFinite(Date.parse(group.events[0].time))).toBe(true);
      const after = await h.control("await", { ordinal: 1 });
      expect(after.state).toEqual([{ ordinal: 1, cancelled: false, released: true }]);
      expect((await h.send("changes/?after=genesis")).value).toEqual(page.value);
      h.facts.before = before.value;
      h.facts.afterSocketClose = still.value;
      h.facts.terminalReceipt = receipt;
      h.facts.record = record;
      h.facts.group = group;
      h.facts.finalNativeTurns = after.state;
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
    }
  },
  90000,
);
