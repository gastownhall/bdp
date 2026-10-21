/** NEW ordinary TX Links collection joins; source-owned finite cases, no RU truth transfer. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createJsonSchemaValidator, createRawHttpExchangeExecutor } from "@bdp/conformance";
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
} from "../test-support/transactional-cumulative-read-campaign.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const manifest = {
  bytes: readFileSync(
    new URL("../test-support/transactional-cumulative-read-manifest.json", import.meta.url),
  ),
};
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  { manifest, fixture: productFixtureSource },
);
const validator = createJsonSchemaValidator(schema);
const linkType = scope + "types/relationship",
  beadType = scope + "types/task";
function completePage(value: unknown, items: unknown[], next: unknown) {
  expect(next === null || (typeof next === "string" && next.startsWith(scope + "links/?"))).toBe(
    true,
  );
  expect(value).toEqual({ items, next });
}
it("NEW Links Read artifact selection and complete-page negative oracles", () => {
  for (const x of [manifest, productFixtureSource])
    expect(x.bytes.length).toBeLessThanOrEqual(1048576);
  expect(bundle.manifest.scenarios.map((r) => r.id)).toEqual([
    "read.collections.links",
    "read.collections.structural-predicates",
    "read.collections.invalid-query",
  ]);
  expect(bundle.fixture.id).toBe("tx-cumulative-product-v1");
  const row = { id: scope + "links/a", revision: "r", metadata: { flag: true } };
  completePage({ items: [row], next: null }, [row], null);
  for (const bad of [
    { items: [], next: null },
    { items: [row, row], next: null },
    { items: [{ ...row, metadata: {} }], next: null },
  ])
    expect(() => completePage(bad, [row], null)).toThrow();
});
it.skipIf(!productEntry)(
  "NEW ordinary TX complete canonical Links pages and structural set algebra",
  async () => {
    await withProductCampaign("links-collection", bundle, async (campaign) => {
      const c = await productSession(campaign, "links-collection");
      try {
        // Deliberately noncanonical insertion order; self Link exercises endpoint OR without duplication.
        const authored = [
          { id: "links/z-in", source: "beads/b", target: "beads/a", title: "in" },
          { id: "links/y-away", source: "beads/b", target: "beads/c", title: "away" },
          {
            id: "links/m-external",
            source: "beads/a",
            target: "urn:outside:Exact",
            title: "external",
          },
          { id: "links/b-self", source: "beads/a", target: "beads/a", title: "self" },
          { id: "links/a-out", source: "beads/a", target: "beads/b", title: "out" },
        ];
        c.position("pos-1");
        const seed = await c.batch(
          [
            ...["a", "b", "c"].map((id) => ({
              operation: "createBead",
              id: "beads/" + id,
              type: beadType,
              properties: { title: id },
              metadata: {},
            })),
            ...authored.map((r) => ({
              operation: "createLink",
              id: r.id,
              type: linkType,
              source: r.source,
              target: r.target,
              properties: { title: r.title, nested: { retained: [true, null, 7] } },
              metadata: { complete: true, label: r.title },
            })),
          ],
          "links-read-seed",
        );
        expect(seed.wire.status).toBe(200);
        expect(seed.value.status).toBe("completed");
        expect(seed.value.results).toHaveLength(8);
        const records = authored.map((r, i) => {
          const actual = seed.value.results[i + 3].resource;
          expect(actual.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
          // Only the genuinely allocated opaque revision is captured; every other field is authored literally.
          const expected = {
            id: scope + r.id,
            type: linkType,
            revision: actual.revision,
            source: scope + r.source,
            target: r.target.startsWith("urn:") ? r.target : scope + r.target,
            properties: { title: r.title, nested: { retained: [true, null, 7] } },
            metadata: { complete: true, label: r.title },
          };
          expect(validator.validate("#/$defs/currentLinkRecord", actual)).toEqual([]);
          expect(actual).toEqual(expected);
          return expected;
        });
        const byName = Object.fromEntries(records.map((r) => [r.id.slice(scope.length), r]));
        const ordered = ["a-out", "b-self", "m-external", "y-away", "z-in"].map(
          (id) => byName["links/" + id],
        );
        const full = await c.exchange("links/?limit=32");
        expect(full.wire.status).toBe(200);
        expect(full.wire.headers["cache-control"]).toBe("private, no-store");
        completePage(full.value, ordered, null);
        const head = await c.exchange("links/?limit=32", undefined, undefined, { method: "HEAD" });
        expect(head.wire.status).toBe(200);
        expect(head.wire.bodyText).toBe("");
        for (const name of [
          "content-type",
          "content-length",
          "cache-control",
          "etag",
          "last-modified",
          "bdp-scope-epoch",
          "bdp-authorization-view",
          "bdp-scope-position",
        ])
          expect(head.wire.headers[name]).toBe(full.wire.headers[name]);
        let next: string | null = "links/?limit=2";
        const traversed: unknown[] = [];
        for (let page = 0; next !== null; page++) {
          expect(page).toBeLessThan(3);
          const result = await c.exchange(next);
          expect(result.wire.status).toBe(200);
          expect(result.wire.headers["cache-control"]).toBe("private, no-store");
          completePage(result.value, ordered.slice(page * 2, page * 2 + 2), result.value.next);
          if (page < 2) expect(result.value.next).toBeTypeOf("string");
          else expect(result.value.next).toBeNull();
          traversed.push(...result.value.items);
          next = result.value.next;
        }
        expect(traversed).toEqual(ordered);
        const queries: Array<[Record<string, string>, string[]]> = [
          [{ source: "beads/a" }, ["a-out", "b-self", "m-external"]],
          [{ target: scope + "beads/a" }, ["b-self", "z-in"]],
          [{ endpoint: "beads/a" }, ["a-out", "b-self", "m-external", "z-in"]],
          [
            {
              source: scope + "beads/a",
              target: "beads/b",
              type: linkType,
              conformsTo: linkType,
              selector: '$[?@.properties.title == "out"]',
            },
            ["a-out"],
          ],
          [{ source: "beads/b", endpoint: "beads/a" }, ["z-in"]],
          [{ target: "urn:outside:Exact" }, ["m-external"]],
          [{ endpoint: "urn:outside:exact" }, []],
        ];
        for (const [query, ids] of queries) {
          const result = await c.exchange(
            "links/?" + new URLSearchParams({ limit: "32", ...query }),
          );
          expect(result.wire.status).toBe(200);
          completePage(
            result.value,
            ids.map((id) => byName["links/" + id]),
            null,
          );
        }
        campaign.results.links = {
          complete: ordered,
          pages: traversed,
          queryCount: queries.length,
          requests: 13,
          mutationPosition: "pos-1",
          noConcurrentMutationSelected: true,
        };
      } finally {
        await c.close();
      }
    });
  },
  90000,
);
it.skipIf(!productEntry)(
  "NEW ordinary TX repeated and unsupported collection query refusals",
  async () => {
    await withProductCampaign("collection-errors", bundle, async (campaign) => {
      const child = await campaign.launch("collection-errors", false, campaign.signal);
      try {
        const address = new URL(child.ready.listenUrl),
          operator = campaign.roles.find((r) => r.ref === "operator")!;
        const repeated = [
          "type",
          "conformsTo",
          "source",
          "target",
          "endpoint",
          "selector",
          "limit",
          "cursor",
        ];
        const queries = [
          ...repeated.map((name) => `${name}=a&${name}=b`),
          "unknown=1",
          "view=properties",
          "include=links",
        ];
        let referenceProblem: unknown;
        for (const [i, query] of [...queries, queries[0]!].entries()) {
          const method = i === queries.length ? "HEAD" : "GET",
            url = scope + "links/?" + query;
          const execute = createRawHttpExchangeExecutor(
            { transport: "plain", host: address.hostname, port: Number(address.port) },
            {
              requestTimeoutMs: 5000,
              maximumBodyBytes: 1048576,
              exactMode: {
                scope,
                profile: "transactional",
                routes: [{ method, url }],
                maximumRequestHeaderBytes: 16384,
                maximumRequestBodyBytes: 65536,
                defaultCredentialRef: "operator",
                credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
                resolveCredentials: () => ({ authorization: `Bearer ${operator.token}` }),
              },
            },
          );
          const request = {
            method,
            url,
            signal: campaign.signal,
            credentialRef: "operator",
            raw: { headerLines: [] },
          } as const;
          const wire = await execute(request);
          campaign.observe("collection-errors", request, wire);
          expect(wire.exactRequest?.writeState).toBe("complete");
          expect(wire.status).toBe(400);
          expect(wire.headers["cache-control"]).toBe("private, no-store");
          // Exact prepared collection-parameter refusal precedes owner observation; no invented context is required.
          if (method === "HEAD") expect(wire.bodyText).toBe("");
          else {
            const value = JSON.parse(wire.bodyText);
            expect(value).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/request",
              status: 400,
              code: "invalid-parameter",
              retry: "never",
            });
            referenceProblem ??= value;
            expect(value).toEqual(referenceProblem);
          }
        }
        campaign.results.refusals = {
          repeated,
          unsupported: ["unknown", "view", "include"],
          requests: 12,
          contextStage: "prepared-route-before-owner",
          noMutation: true,
        };
      } finally {
        await child.close();
      }
    });
  },
  90000,
);
