/** Reused full67-record Snapshot/exclusive-feed literal assertions on cumulative config. */
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
const beadType = scope + "types/task",
  linkType = scope + "types/relationship";
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
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, string>;
  metadata: Record<string, unknown>;
  source?: string;
  target?: string;
};
type Page = { items: Row[]; next: string | null };
type Manifest = {
  id: string;
  scope: string;
  scopeEpoch: string;
  authorizationView: string;
  scopePosition: string;
  checkpoint: string;
  expiresAt: string;
  erasures: unknown[];
  beads: Page;
  links: Page;
};
function baseline(
  actual: { beads: Row[]; links: Row[] },
  expected: { beads: Row[]; links: Row[] },
) {
  expect(actual).toEqual(expected);
  for (const rows of [actual.beads, actual.links])
    expect(rows.map((row) => row.id)).toEqual([...rows.map((row) => row.id)].sort());
  const ids = new Set(actual.beads.map((row) => row.id));
  for (const row of actual.links) {
    expect(ids.has(String(row.source))).toBe(true);
    expect(ids.has(String(row.target))).toBe(true);
  }
}

it.skipIf(!productEntry)(
  "NEW cumulative Snapshot fullbaseline exclusive rendezvous",
  async () => {
    await withProductCampaign("snapshot-rendezvous", bundle, async (campaign) => {
      const c = await productSession(campaign, "snapshot-rendezvous");
      let commits = 0;
      async function exchange(target: string, method: "GET" | "POST" = "GET", body?: unknown) {
        if (method === "POST") c.position(`pos-${++commits}`);
        const r = await c.exchange(
          target,
          body,
          method === "POST" ? `snapshot-${commits}` : undefined,
          { method },
        );
        expect(r.wire.status, r.wire.bodyText).toBe(200);
        return { body: r.value, headers: r.wire.headers };
      }
      try {
        const beads = Array.from({ length: 34 }, (_, i) => ({
          operation: "createBead",
          id: `beads/b${String(i).padStart(2, "0")}`,
          type: beadType,
          properties: { title: `bead-${i}` },
        }));
        const links = Array.from({ length: 33 }, (_, i) => ({
          operation: "createLink",
          id: `links/l${String(i).padStart(2, "0")}`,
          type: linkType,
          source: "beads/b00",
          target: "beads/b01",
          properties: { title: `link-${i}` },
        }));
        const expected: { beads: Row[]; links: Row[] } = { beads: [], links: [] };
        const operations = [...beads, ...links];
        for (let start = 0; start < operations.length; start += 32) {
          const selected = operations.slice(start, start + 32),
            seeded = await exchange("operations/batch", "POST", { operations: selected });
          expect(seeded.body.status).toBe("completed");
          expect(seeded.body.results).toHaveLength(selected.length);
          selected.forEach((op, i) => {
            const resource = seeded.body.results[i].resource as Row;
            expect(typeof resource.revision).toBe("string");
            expect(resource.revision.length).toBeGreaterThan(0);
            const wanted = {
              id: new URL(op.id, scope).href,
              type: op.type,
              revision: resource.revision,
              properties: op.properties,
              metadata: {},
              ...("source" in op
                ? { source: `${scope}beads/b00`, target: `${scope}beads/b01` }
                : {}),
            };
            expect(resource).toEqual(wanted);
            expected[op.operation === "createBead" ? "beads" : "links"].push(wanted);
          });
        }
        const captured = await exchange("snapshot"),
          manifest = captured.body as Manifest;
        expect(manifest.scope).toBe(scope);
        expect(manifest.scopePosition).toBe("pos-3");
        expect(manifest.erasures).toEqual([]);
        expect(typeof manifest.checkpoint).toBe("string");
        expect(manifest.checkpoint.length).toBeGreaterThan(0);
        for (const [name, value] of [
          ["bdp-scope-epoch", manifest.scopeEpoch],
          ["bdp-authorization-view", manifest.authorizationView],
          ["bdp-scope-position", manifest.scopePosition],
        ])
          expect(captured.headers[name!]).toBe(value);
        expect(manifest.beads.next).not.toBeNull();
        expect(manifest.links.next).not.toBeNull();
        const pages: unknown[] = [];
        async function collect(first: Page, position: string) {
          const items = [...first.items];
          let next = first.next;
          const visited = new Set<string>();
          while (next !== null) {
            expect(visited.size).toBeLessThan(4);
            expect(visited.has(next)).toBe(false);
            visited.add(next);
            const page = await exchange(next);
            expect(page.headers["bdp-scope-epoch"]).toBe(manifest.scopeEpoch);
            expect(page.headers["bdp-authorization-view"]).toBe(manifest.authorizationView);
            expect(page.headers["bdp-scope-position"]).toBe(position);
            expect(Object.keys(page.body).sort()).toEqual(["items", "next"]);
            items.push(...page.body.items);
            pages.push({ url: next, body: page.body });
            next = page.body.next;
          }
          return items;
        }
        const original = {
          beads: await collect(manifest.beads, "pos-3"),
          links: await collect(manifest.links, "pos-3"),
        };
        baseline(original, expected);
        expect(original.beads).toHaveLength(34);
        expect(original.links).toHaveLength(33);
        const laterOperations = [
          {
            operation: "updateBead",
            bead: "beads/b00",
            propertiesChange: [{ op: "replace", path: "/title", value: "after-bead" }],
          },
          {
            operation: "updateLink",
            link: "links/l00",
            propertiesChange: [{ op: "replace", path: "/title", value: "after-link" }],
          },
          {
            operation: "createBead",
            id: "beads/new",
            type: beadType,
            properties: { title: "after-new" },
          },
        ];
        const later = await exchange("operations/batch", "POST", { operations: laterOperations });
        expect(later.body.status).toBe("completed");
        expect(later.body.effectPosition).toBe("pos-4");
        expect(later.body.results).toHaveLength(3);
        const oldBead = expected.beads[0]!,
          oldLink = expected.links[0]!;
        const changed = [
          {
            ...oldBead,
            revision: later.body.results[0].resource.revision,
            properties: { title: "after-bead" },
          },
          {
            ...oldLink,
            revision: later.body.results[1].resource.revision,
            properties: { title: "after-link" },
          },
          {
            id: `${scope}beads/new`,
            type: beadType,
            revision: later.body.results[2].resource.revision,
            properties: { title: "after-new" },
            metadata: {},
          },
        ];
        expect(changed[0]!.revision).not.toBe(oldBead.revision);
        expect(changed[1]!.revision).not.toBe(oldLink.revision);
        later.body.results.forEach((item: { resource: Row }, i: number) => {
          expect(item.resource).toEqual(changed[i]);
        });
        const after = new URL("changes/", scope);
        after.searchParams.set("after", manifest.checkpoint);
        let next: string | null = after.href;
        const groups = [],
          feedPages = [],
          visited = new Set<string>();
        while (next !== null) {
          expect(visited.size).toBeLessThan(4);
          expect(visited.has(next)).toBe(false);
          visited.add(next);
          const requested = new URL(next).searchParams.get("after"),
            page = await exchange(next);
          expect(page.body.after).toBe(requested);
          expect(page.body.scope).toBe(scope);
          expect(page.body.scopeEpoch).toBe(manifest.scopeEpoch);
          expect(page.body.authorizationView).toBe(manifest.authorizationView);
          expect(page.body.observedHeadPosition).toBe("pos-4");
          expect(page.headers["bdp-scope-epoch"]).toBe(manifest.scopeEpoch);
          expect(page.headers["bdp-authorization-view"]).toBe(manifest.authorizationView);
          expect(page.headers["bdp-scope-position"]).toBe("pos-4");
          groups.push(...page.body.groups);
          feedPages.push(page.body);
          next = page.body.next;
        }
        expect(groups).toHaveLength(1);
        const group = groups[0]!;
        expect(group).toMatchObject({
          scopeEpoch: manifest.scopeEpoch,
          authorizationView: manifest.authorizationView,
          position: "pos-4",
          previousPosition: manifest.scopePosition,
          transaction: later.body.transaction,
          projectionAdvance: false,
          eventCount: 3,
          erasures: [],
        });
        expect(group.checkpoint).not.toBe(manifest.checkpoint);
        expect([...group.changes].sort((a, b) => (a.resource.id < b.resource.id ? -1 : 1))).toEqual(
          changed
            .map((resource) => ({
              operation: "upsert",
              resourceKind: resource.type === beadType ? "bead" : "link",
              resource,
            }))
            .sort((a, b) => (a.resource.id < b.resource.id ? -1 : 1)),
        );
        expect(
          group.events.map((event: { ordinal: number; type: string; subject: string }) => [
            event.ordinal,
            event.type,
            event.subject,
          ]),
        ).toEqual([
          [0, "updated", oldBead.id],
          [1, "updated", oldLink.id],
          [2, "created", `${scope}beads/new`],
        ]);
        expect(group.events[0].data).toMatchObject({
          previousRevision: oldBead.revision,
          revision: changed[0]!.revision,
        });
        expect(group.events[1].data).toMatchObject({
          previousRevision: oldLink.revision,
          revision: changed[1]!.revision,
        });
        for (const event of group.events) expect(event.transaction).toBe(group.transaction);
        const refetched = await exchange(manifest.id);
        expect(refetched.body).toEqual(manifest);
        expect(refetched.headers["bdp-scope-position"]).toBe("pos-4");
        const retained = {
          beads: await collect(refetched.body.beads, "pos-4"),
          links: await collect(refetched.body.links, "pos-4"),
        };
        baseline(retained, expected);
        baseline(original, expected);
        for (const resource of changed) {
          const fresh = await exchange(resource.id);
          expect(fresh.body).toEqual(resource);
        }
        campaign.results["snapshot-rendezvous"] = {
          manifest,
          original,
          retained,
          pages,
          feedPages,
          groups,
          expectedLaterPostimages: changed,
          baselineCount: { beads: 34, links: 33 },
          checkpointSource:
            "The one actual manifest.checkpoint, verbatim; no genesis/start-now/substitute feed.",
        };
      } finally {
        await c.close();
      }
    });
  },
  70000,
);
