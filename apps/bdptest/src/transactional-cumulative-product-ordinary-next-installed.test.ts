/** NEW current-payload composition: captured schemas and ordinary retained collection pages. */
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
const type = scope + "types/task";
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
function bead(value: unknown, id: string, title: string): Row {
  const row = value as Row;
  expect(row.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(row).toEqual({
    id: scope + "beads/" + id,
    type,
    revision: row.revision,
    properties: { title },
    metadata: {},
  });
  return row;
}
function retained(pages: Array<{ items: Row[]; next: string | null }>, expected: Row[]) {
  expect(pages).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    expect(pages[i]?.items).toEqual([expected[i]]);
    if (i < 2) expect(pages[i]?.next).toBeTypeOf("string");
    else expect(pages[i]?.next).toBeNull();
  }
}
it("NEW current composition retained-page oracle rejects changed postimage/order and duplicate", () => {
  const rows = ["b1", "b2", "b3"].map((id) => ({
    id: scope + "beads/" + id,
    type,
    revision: "r-" + id,
    properties: { title: "selected" },
    metadata: {},
  }));
  const pages = rows.map((row, i) => ({
    items: [row],
    next: i === 2 ? null : scope + "beads/?cursor=" + i,
  }));
  retained(pages, rows);
  for (const bad of [
    [pages[1]!, pages[0]!, pages[2]!],
    [pages[0]!, pages[0]!, pages[2]!],
    [pages[0]!, { ...pages[1]!, items: [{ ...rows[1]!, revision: "changed" }] }, pages[2]!],
  ])
    expect(() => retained(bad, rows)).toThrow();
});
it.skipIf(!productEntry)(
  "NEW current composition all captured Type and schema representations",
  async () => {
    await withProductCampaign("types-schemas", bundle, async (campaign) => {
      const c = await productSession(campaign, "types-schemas");
      const fixture = JSON.parse(productFixtureSource.bytes.toString("utf8")) as {
        artifacts: {
          descriptors: Array<{ retrievalUri: string; utf8: string }>;
          schemas: Array<{ retrievalUri: string; utf8: string }>;
        };
      };
      try {
        const inventory = await c.exchange("types/?limit=32");
        expect(inventory.wire.status).toBe(200);
        expect(inventory.value).toEqual({
          items: fixture.artifacts.descriptors
            .map((d) => {
              const authored = JSON.parse(d.utf8);
              return { id: authored.id, name: authored.name, describes: authored.describes };
            })
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
          next: null,
        });
        for (const descriptor of fixture.artifacts.descriptors) {
          const actual = await c.exchange(descriptor.retrievalUri);
          expect(actual.wire.status).toBe(200);
          expect(actual.value).toEqual(JSON.parse(descriptor.utf8));
          expect(actual.value.id).toBe(descriptor.retrievalUri);
        }
        for (const schema of fixture.artifacts.schemas) {
          const actual = await c.exchange(schema.retrievalUri);
          expect(actual.wire.status).toBe(200);
          expect(actual.wire.bodyText).toBe(schema.utf8);
          expect(actual.wire.bodyOctets).toBe(Buffer.byteLength(schema.utf8));
          expect(actual.wire.headers["content-length"]).toBe(
            String(Buffer.byteLength(schema.utf8)),
          );
          expect(actual.wire.headers["content-type"]).toBe("application/json");
          expect(actual.wire.headers["cache-control"]).toBe("private, no-store");
          expect(actual.wire.headers.vary).toBe("Accept");
          expect(actual.wire.headers.etag).toBeUndefined();
          expect(actual.wire.headers["last-modified"]).toBeUndefined();
          const head = await c.exchange(schema.retrievalUri, undefined, undefined, {
            method: "HEAD",
          });
          expect(head.wire.status).toBe(200);
          expect(head.wire.bodyText).toBe("");
          expect(head.wire.bodyOctets).toBe(0);
          for (const key of [
            "content-length",
            "content-type",
            "cache-control",
            "vary",
            "bdp-scope-epoch",
            "bdp-authorization-view",
            "bdp-scope-position",
          ])
            expect(head.wire.headers[key]).toBe(actual.wire.headers[key]);
          for (const [headers, status] of [
            [[{ name: "Accept", value: "text/plain" }], 406],
            [[{ name: "If-None-Match", value: "*" }], 304],
            [[{ name: "If-Match", value: '"missing"' }], 412],
          ] as const) {
            const selected = await c.exchange(schema.retrievalUri, undefined, undefined, {
              headers: [...headers],
            });
            expect(selected.wire.status).toBe(status);
            expect(selected.wire.bodyText).toBe("");
            expect(selected.wire.bodyOctets).toBe(0);
            expect(selected.wire.headers["cache-control"]).toBe("private, no-store");
            expect(selected.wire.headers.vary).toBe("Accept");
            expect(selected.wire.headers.etag).toBeUndefined();
          }
        }
        campaign.results["types-schemas"] = {
          descriptors: 11,
          schemas: 3,
          requests: 27,
          referenceSchemasNotSelected: true,
          wholeContract: false,
        };
      } finally {
        await c.close();
      }
    });
  },
  65000,
);
it.skipIf(!productEntry)(
  "NEW current composition selector continuation immutable across ordinary mutation",
  async () => {
    await withProductCampaign("continuation", bundle, async (campaign) => {
      const c = await productSession(campaign, "continuation");
      try {
        c.position("pos-1");
        const seed = await c.batch(
          ["a0", "b1", "b2", "b3"].map((id) => ({
            operation: "createBead",
            id: "beads/" + id,
            type,
            properties: { title: id === "a0" ? "excluded" : "selected" },
          })),
          "continuation-seed",
        );
        expect(seed.wire.status).toBe(200);
        expect(seed.value.status).toBe("completed");
        expect(seed.value.results).toHaveLength(4);
        const rows = seed.value.results.map((r: { resource: unknown }, i: number) =>
          bead(r.resource, ["a0", "b1", "b2", "b3"][i]!, i === 0 ? "excluded" : "selected"),
        );
        const expected = rows.slice(1);
        const url = new URL("beads/", scope);
        url.searchParams.set("type", type);
        url.searchParams.set("selector", '$[?@.properties.title == "selected"]');
        url.searchParams.set("limit", "1");
        const first = await c.exchange(url.href);
        expect(first.wire.status).toBe(200);
        expect(first.value.items).toEqual([expected[0]]);
        const pages = [first.value];
        c.position("pos-2");
        const change = await c.batch(
          [
            {
              operation: "updateBead",
              bead: "beads/b2",
              propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
            },
            { operation: "createBead", id: "beads/b4", type, properties: { title: "selected" } },
          ],
          "continuation-change",
        );
        expect(change.wire.status).toBe(200);
        expect(change.value.status).toBe("completed");
        expect(change.value.results).toHaveLength(2);
        const changed = bead(change.value.results[0].resource, "b2", "changed"),
          added = bead(change.value.results[1].resource, "b4", "selected");
        expect(changed.revision).not.toBe(expected[1]?.revision);
        const consumed: string[] = [];
        for (let i = 0; i < 2; i++) {
          const next = pages[i].next;
          expect(next).toBeTypeOf("string");
          expect(consumed).not.toContain(next);
          expect(new URL(next).origin).toBe(new URL(scope).origin);
          consumed.push(next);
          const tail = await c.exchange(next);
          expect(tail.wire.status).toBe(200);
          pages.push(tail.value);
        }
        retained(pages, expected);
        url.searchParams.set("limit", "10");
        const fresh = await c.exchange(url.href);
        expect(fresh.wire.status).toBe(200);
        expect(fresh.value).toEqual({ items: [expected[0], expected[2], added], next: null });
        const current = await c.exchange("beads/b2");
        expect(current.wire.status).toBe(200);
        expect(current.value).toEqual(changed);
        campaign.results.continuation = {
          authoredSeed: ["a0", "b1", "b2", "b3"],
          expected,
          changed,
          added,
          pages,
          consumed,
          fresh: fresh.value,
          sourcePosition: "pos-1",
          servingPosition: "pos-2",
          wholeContract: false,
        };
      } finally {
        await c.close();
      }
    });
  },
  65000,
);
