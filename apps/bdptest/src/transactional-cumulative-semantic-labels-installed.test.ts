import { expect, it } from "vitest";
import {
  installed,
  withSemanticLabels,
  scope,
  row,
  receipt,
  feed,
  validator,
} from "../test-support/transactional-cumulative-semantic-labels-runtime.js";

async function collection(c: any, expected: unknown[]) {
  const response = await c.exchange("beads/");
  expect(response.wire.status).toBe(200);
  expect(response.value).toEqual({ items: expected, next: null });
  return response.value;
}
function creationResults(r: any, names: string[], properties: unknown[]) {
  return names.map((name, i) => {
    const resource = r.results[i].resource;
    expect(r.results[i]).toEqual({
      operationIndex: i,
      operationName: name,
      outcome: "created",
      resource,
    });
    expect(resource.id).toMatch(
      /^https:\/\/reference\.invalid\/acme\/beads\/[A-Za-z0-9_-]{1,256}$/,
    );
    return row(resource, resource.id.slice(scope.length), "task", properties[i]);
  });
}
function group(g: any, r: any, created: any[], changed: any, change: unknown[]) {
  expect(g.position).toBe("pos-1");
  expect(g.previousPosition).toBe("pos-0");
  expect(g.transaction).toBe(r.transaction);
  expect(g.projectionAdvance).toBe(false);
  expect(g.erasures).toEqual([]);
  const final = created
    .map((resource) => (resource.id === changed.id ? changed : resource))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  expect(g.changes).toHaveLength(final.length);
  expect(
    [...g.changes].sort((a, b) =>
      a.resource.id < b.resource.id ? -1 : a.resource.id > b.resource.id ? 1 : 0,
    ),
  ).toEqual(final.map((resource) => ({ operation: "upsert", resourceKind: "bead", resource })));
  expect(g.eventCount).toBe(created.length + 1);
  expect(g.events).toHaveLength(created.length + 1);
  for (const [ordinal, event] of g.events.entries()) {
    expect(validator.validate("#/$defs/event", event)).toEqual([]);
    const original = ordinal < created.length ? created[ordinal] : created[0];
    expect(event).toMatchObject({
      ordinal,
      type: ordinal < created.length ? "created" : "updated",
      subject: original.id,
      transaction: r.transaction,
      source: scope + "events/",
    });
    expect(event.data).toEqual(
      ordinal < created.length
        ? { revision: original.revision, properties: original.properties, metadata: {} }
        : { previousRevision: original.revision, revision: changed.revision, change },
    );
  }
  return final;
}
async function conflict(c: any, operations: unknown[], key: string) {
  const response = await c.batch(operations, key);
  expect(response.wire.status).toBe(409);
  expect(response.value).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    status: 409,
    code: "idempotency-conflict",
    retry: "never",
  });
  expect(response.wire.headers["cache-control"]).toBe("private, no-store");
  expect(response.wire.headers.etag).toBeUndefined();
  expect(response.wire.headers["last-modified"]).toBeUndefined();
}

it.skipIf(!installed)(
  "NEW TX supplied creator label renaming and canonical URL recover the same complete receipt",
  async () => {
    await withSemanticLabels("supplied-creator", async (c) => {
      const change = [{ op: "replace", path: "/n", value: 1 }];
      const body = (name: string, reference: string) => [
        {
          operation: "createBead",
          id: "beads/supplied",
          name,
          type: scope + "types/task",
          properties: { n: 0 },
        },
        { operation: "updateBead", bead: reference, propertiesChange: change },
      ];
      const key = "semantic-supplied";
      c.position("pos-1");
      const original = receipt(
        await c.batch(body("creator", "@creator"), key),
        "completed",
        "pos-1",
        key,
        "pos-1",
      );
      const [created] = creationResults(original, ["creator"], [{ n: 0 }]);
      expect(created.id).toBe(scope + "beads/supplied");
      const changed = row(original.results[1].resource, "beads/supplied", "task", { n: 1 });
      expect(original.results).toHaveLength(2);
      expect(original.results[1]).toEqual({
        operationIndex: 1,
        outcome: "updated",
        resource: changed,
      });
      expect(changed.revision).not.toBe(created.revision);
      const groups = await feed(c);
      expect(groups).toHaveLength(1);
      const records = group(groups[0], original, [created], changed, change);
      const before = await collection(c, records);
      expect((await c.batch(body("renamed", "@renamed"), key)).value).toEqual(original);
      expect((await c.batch(body("another-name", scope + "beads/supplied"), key)).value).toEqual(
        original,
      );
      expect((await c.exchange(original.id)).value).toEqual(original);
      const after = await collection(c, records);
      expect(await feed(c)).toEqual(groups);
      c.results.supplied = {
        original,
        created,
        changed,
        before,
        after,
        groups,
        canonicalReference: scope + "beads/supplied",
      };
    });
  },
  90000,
);

it.skipIf(!installed)(
  "NEW TX omitted creator index survives renaming but differs from another slot or allocated URL",
  async () => {
    await withSemanticLabels("omitted-creators", async (c) => {
      const change = [{ op: "replace", path: "/n", value: 1 }];
      const body = (left: string, right: string, reference: string) => [
        { operation: "createBead", name: left, type: scope + "types/task", properties: { n: 0 } },
        { operation: "createBead", name: right, type: scope + "types/task", properties: { n: 0 } },
        { operation: "updateBead", bead: reference, propertiesChange: change },
      ];
      const key = "semantic-omitted";
      c.position("pos-1");
      const original = receipt(
        await c.batch(body("left", "right", "@left"), key),
        "completed",
        "pos-1",
        key,
        "pos-1",
      );
      const created = creationResults(original, ["left", "right"], [{ n: 0 }, { n: 0 }]);
      expect(created[0].id).not.toBe(created[1].id);
      const changed = row(original.results[2].resource, created[0].id.slice(scope.length), "task", {
        n: 1,
      });
      expect(original.results).toHaveLength(3);
      expect(original.results[2]).toEqual({
        operationIndex: 2,
        outcome: "updated",
        resource: changed,
      });
      expect(changed.revision).not.toBe(created[0].revision);
      const groups = await feed(c);
      expect(groups).toHaveLength(1);
      const records = group(groups[0], original, created, changed, change);
      const before = await collection(c, records);
      expect((await c.batch(body("alpha", "beta", "@alpha"), key)).value).toEqual(original);
      await conflict(c, body("alpha", "beta", "@beta"), key);
      await conflict(c, body("alpha", "beta", created[0].id), key);
      expect((await c.exchange(original.id)).value).toEqual(original);
      const after = await collection(c, records);
      expect(await feed(c)).toEqual(groups);
      c.results.omitted = {
        original,
        created,
        changed,
        before,
        after,
        groups,
        creatorIndex: 0,
        otherCreatorIndex: 1,
        allocatedURL: created[0].id,
      };
    });
  },
  90000,
);
