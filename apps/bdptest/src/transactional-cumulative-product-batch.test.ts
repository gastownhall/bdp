/** Reused literal positive batch/set assertions on the NEW cumulative fixture/configuration. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  withProductCampaign,
  productSession,
  productEntry,
  productFixtureSource,
  productScope as scope,
} from "../test-support/transactional-cumulative-product-runtime.js";
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  {
    manifest: {
      bytes: readFileSync(
        new URL(
          "../test-support/transactional-cumulative-product-read-manifest.json",
          import.meta.url,
        ),
      ),
    },
    fixture: productFixtureSource,
  },
);
const type = scope + "types/task",
  linkType = scope + "types/relationship";
type Context = Awaited<ReturnType<typeof productSession>>;
async function withCumulative(name: string, run: (c: Context) => Promise<void>) {
  await withProductCampaign("batch-" + name, bundle, async (campaign) => {
    const c = await productSession(campaign, "batch-" + name);
    try {
      await run(c);
      campaign.results[name] = {
        state: "pass",
        assertionSource: "transactional-batch-set-product-installed.test.ts",
        sameCumulativeConfiguration: true,
        wholeRowsComplete: false,
      };
    } finally {
      await c.close();
    }
  });
}
const create = (id: string, name?: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { label: id, n: 0 },
  metadata: { stage: "seed" },
  ...(name ? { name } : {}),
});
const update = (id: string, n: number) => ({
  operation: "updateBead",
  bead: id,
  propertiesChange: [{ op: "replace", path: "/n", value: n }],
});
const bead = (id: string, n: number, revision: unknown = expect.any(String)) => ({
  id: `${scope}beads/${id}`,
  type,
  revision,
  properties: { label: id, n },
  metadata: { stage: "seed" },
});
function complete(r: Awaited<ReturnType<Context["exchange"]>>, position: string, effect: boolean) {
  expect(r.wire.status).toBe(200);
  expect(r.value.status).toBe("completed");
  expect(r.value.detail).toBe("available");
  expect(r.value.requiredPosition).toBe(position);
  expect(r.value.next).toBeNull();
  if (effect) expect(r.value.effectPosition).toBe(position);
  else expect(r.value).not.toHaveProperty("effectPosition");
}
async function groups(c: Context) {
  const result: Array<{
    position: string;
    events: Array<{ type: string; subject: string; data?: unknown }>;
    changes: unknown[];
  }> = [];
  let target: string | null = "changes/?after=genesis";
  for (let page = 0; target !== null; page++) {
    expect(page).toBeLessThan(4);
    const r = await c.exchange(target);
    expect(r.wire.status).toBe(200);
    expect(Array.isArray(r.value.groups)).toBe(true);
    result.push(...r.value.groups);
    target = r.value.next;
  }
  return result;
}
async function seed(c: Context) {
  c.position("pos-1");
  const r = await c.batch([create("a"), create("b")], "seed");
  complete(r, "pos-1", true);
  expect(r.value.results).toEqual(
    ["a", "b"].map((id, i) => ({ operationIndex: i, outcome: "created", resource: bead(id, 0) })),
  );
  return r.value.results.map((r: { resource: unknown }) => r.resource);
}
function failed(r: Awaited<ReturnType<Context["exchange"]>>, position: string, pointer: string) {
  expect(r.wire.status).toBe(200);
  expect(r.value.status).toBe("failed");
  expect(r.value.requiredPosition).toBe(position);
  expect(r.value).not.toHaveProperty("results");
  expect(r.value).not.toHaveProperty("next");
  expect(r.value).not.toHaveProperty("effectPosition");
  expect(r.value.problem).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code: "cardinality-violated",
    status: 409,
    retry: "after-state-change",
    operationIndex: 1,
    pointer,
  });
}

it.skipIf(!productEntry)(
  "packed batch resolves ordinary labels and opaque PinnedReference uri labels with staged order",
  async () =>
    withCumulative("labels", async (c) => {
      c.position("pos-1");
      const r = await c.batch(
        [
          create("a", "first"),
          create("b", "second"),
          update("@first", 1),
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "@first",
            target: { uri: "@second", revision: "opaque-byte-identical-pin" },
            properties: { weight: 7 },
            metadata: { purpose: "labels" },
          },
        ],
        "local-labels",
      );
      complete(r, "pos-1", true);
      expect(r.value.results).toEqual([
        { operationIndex: 0, operationName: "first", outcome: "created", resource: bead("a", 0) },
        { operationIndex: 1, operationName: "second", outcome: "created", resource: bead("b", 0) },
        { operationIndex: 2, outcome: "updated", resource: bead("a", 1) },
        {
          operationIndex: 3,
          outcome: "created",
          resource: {
            id: `${scope}links/l`,
            type: linkType,
            revision: expect.any(String),
            properties: { weight: 7 },
            metadata: { purpose: "labels" },
            source: `${scope}beads/a`,
            target: { uri: `${scope}beads/b`, revision: "opaque-byte-identical-pin" },
          },
        },
      ]);
      expect(r.value.results[2].resource.revision).not.toBe(r.value.results[0].resource.revision);
      for (const [url, expected] of [
        ["beads/a", r.value.results[2].resource],
        ["beads/b", r.value.results[1].resource],
        ["links/l", r.value.results[3].resource],
      ] as const) {
        const read = await c.exchange(url);
        expect(read.wire.status).toBe(200);
        expect(read.value).toEqual(expected);
      }
      const g = await groups(c);
      expect(g.map((g) => g.position)).toEqual(["pos-1"]);
      expect(g[0]!.events.map((e) => [e.type, e.subject])).toEqual([
        ["created", `${scope}beads/a`],
        ["created", `${scope}beads/b`],
        ["updated", `${scope}beads/a`],
        ["created", `${scope}links/l`],
        ["linked", `${scope}links/l`],
        ["linked", `${scope}links/l`],
      ]);
      expect(g[0]!.events.slice(4).map((e) => e.data)).toEqual(
        ["source", "target"].map((endpoint) => ({
          endpoint,
          link: { id: `${scope}links/l`, type: linkType },
          source: `${scope}beads/a`,
          target: { uri: `${scope}beads/b`, revision: "opaque-byte-identical-pin" },
        })),
      );
    }),
  30000,
);

it.skipIf(!productEntry)(
  "packed batch rollback retries the same failed receipt and preserves all-noop versus mixed entries/groups",
  async () =>
    withCumulative("rollback-noop", async (c) => {
      const originals = await seed(c),
        beforeGroups = await groups(c);
      const ops = [
        update("beads/a", 99),
        {
          operation: "updateWhere",
          collection: "beads",
          selector: "$[?@.properties.n == 999]",
          change: [{ op: "replace", path: "/n", value: 8 }],
          cardinality: { min: 1 },
        },
      ];
      const rejected = await c.batch(ops, "rollback");
      failed(rejected, "pos-1", "/operations/1/cardinality/min");
      const retry = await c.batch(ops, "rollback");
      expect(retry.wire.status).toBe(200);
      expect(retry.wire.bodyText).toBe(rejected.wire.bodyText);
      for (const [i, id] of ["a", "b"].entries())
        expect((await c.exchange(`beads/${id}`)).value).toEqual(originals[i]);
      expect(await groups(c)).toEqual(beforeGroups);
      const noop = await c.batch([update("beads/a", 0), update("beads/b", 0)], "all-noop");
      complete(noop, "pos-1", false);
      expect(noop.value.results).toEqual(
        originals.map((resource: unknown, operationIndex: number) => ({
          operationIndex,
          outcome: "updated",
          resource,
        })),
      );
      expect(await groups(c)).toEqual(beforeGroups);
      c.position("pos-2");
      const mixed = await c.batch([update("beads/a", 1), update("beads/b", 0)], "mixed");
      complete(mixed, "pos-2", true);
      expect(mixed.value.results).toEqual([
        { operationIndex: 0, outcome: "updated", resource: bead("a", 1) },
        { operationIndex: 1, outcome: "updated", resource: originals[1] },
      ]);
      expect(mixed.value.results[0].resource.revision).not.toBe(
        (originals[0] as { revision: string }).revision,
      );
      expect((await c.exchange("beads/a")).value).toEqual(mixed.value.results[0].resource);
      expect((await c.exchange("beads/b")).value).toEqual(originals[1]);
      const after = await groups(c);
      expect(after.map((g) => g.position)).toEqual(["pos-1", "pos-2"]);
      expect(after[1]!.events.map((e) => [e.type, e.subject])).toEqual([
        ["updated", `${scope}beads/a`],
      ]);
      expect(after[1]!.changes).toHaveLength(1);
    }),
  30000,
);

it.skipIf(!productEntry)(
  "packed set cardinality includes both endpoints and rolls back complete prior effects below and above range",
  async () =>
    withCumulative("cardinality", async (c) => {
      await seed(c);
      const set = (n: number, value: number, cardinality: unknown) => ({
        operation: "updateWhere",
        collection: "beads",
        selector: `$[?@.properties.n == ${n}]`,
        change: [{ op: "replace", path: "/n", value }],
        cardinality,
      });
      let current: unknown[] = [];
      for (const [from, to, cardinality] of [
        [0, 1, { min: 2, max: 3 }],
        [1, 2, { min: 1, max: 2 }],
      ] as const) {
        c.position(`pos-${to + 1}`);
        const r = await c.batch([set(from, to, cardinality)], `inclusive-${to}`);
        complete(r, `pos-${to + 1}`, true);
        expect(r.value.results).toEqual([
          { operationIndex: 0, outcome: "matched", count: 2 },
          ...["a", "b"].map((id) => ({
            operationIndex: 0,
            outcome: "updated",
            resource: bead(id, to),
          })),
        ]);
        current = r.value.results.slice(1).map((e: { resource: unknown }) => e.resource);
      }
      const baseline = await groups(c);
      expect(baseline.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      for (const [label, range, bound] of [
        ["below", { min: 3 }, "min"],
        ["above", { max: 1 }, "max"],
      ] as const) {
        const r = await c.batch(
          [
            {
              operation: "updateBead",
              bead: "beads/a",
              propertiesChange: [{ op: "replace", path: "/label", value: "temporary-rolled-back" }],
            },
            set(2, 9, range),
          ],
          `outside-${label}`,
        );
        failed(r, "pos-3", `/operations/1/cardinality/${bound}`);
        for (const [i, id] of ["a", "b"].entries())
          expect((await c.exchange(`beads/${id}`)).value).toEqual(current[i]);
        expect(await groups(c)).toEqual(baseline);
      }
    }),
  30000,
);
