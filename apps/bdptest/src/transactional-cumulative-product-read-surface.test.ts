/** Existing resource/alias/incident positive assertions composed under cumulative fixture. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createJsonSchemaValidator } from "@bdp/conformance";
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
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const validator = createJsonSchemaValidator(schema),
  type = scope + "types/task",
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
function page(value: unknown, expected: readonly unknown[]) {
  expect(value).toEqual({ items: expected, next: null });
}
function record(value: unknown, expected: unknown, kind: "bead" | "link") {
  expect(
    validator.validate(
      kind === "bead" ? "#/$defs/currentBeadRecord" : "#/$defs/currentLinkRecord",
      value,
    ),
  ).toEqual([]);
  expect(value).toEqual(expected);
}
it("NEW cumulative incident/fullrecord oracle refuses direction/duplicate/endpoint/revision and embedded incidents", () => {
  const a = {
    id: scope + "links/a",
    type: linkType,
    revision: "r-a",
    source: scope + "beads/a",
    target: scope + "beads/b",
    properties: {},
    metadata: {},
  };
  page({ items: [a], next: null }, [a]);
  for (const items of [
    [],
    [a, a],
    [{ ...a, source: scope + "beads/b" }],
    [{ ...a, revision: "wrong" }],
  ])
    expect(() => page({ items, next: null }, [a])).toThrow();
  const b = {
    id: scope + "beads/a",
    type,
    revision: "r-a",
    properties: { title: "a", open: { kept: [1, null, true] } },
    metadata: { flag: true },
  };
  record(b, b, "bead");
  for (const bad of [
    { ...b, links: [] },
    { ...b, properties: { title: "a" } },
    { ...b, metadata: {} },
  ])
    expect(() => record(bad, b, "bead")).toThrow();
});
it.skipIf(!productEntry)(
  "NEW cumulative complete Resource/properties/incident direction views",
  async () => {
    await withProductCampaign("resource-incident", bundle, async (campaign) => {
      const c = await productSession(campaign, "resource-incident");
      try {
        const aProperties = {
            title: "a",
            undeclared: { nested: [1, null, "x"] },
            metadata: { domainProperty: true },
            revisionProvenance: { ordinaryProperty: true },
          },
          aMetadata = { flag: true, nested: { count: 3 } };
        const authored = [
          { id: "links/z-in", source: "beads/b", target: "beads/a", title: "incoming" },
          { id: "links/a-out", source: "beads/a", target: "beads/b", title: "outgoing" },
          { id: "links/m-self", source: "beads/a", target: "beads/a", title: "self" },
        ];
        c.position("pos-1");
        const seeded = await c.batch(
          [
            {
              operation: "createBead",
              id: "beads/a",
              type,
              properties: aProperties,
              metadata: aMetadata,
            },
            {
              operation: "createBead",
              id: "beads/b",
              type,
              properties: { title: "b", unknown: true },
              metadata: {},
            },
            ...authored.map(({ id, source, target, title }) => ({
              operation: "createLink",
              id,
              type: linkType,
              source,
              target,
              properties: { title, extra: { retained: true } },
              metadata: { link: true },
            })),
          ],
          "resource-seed",
        );
        expect(seeded.wire.status).toBe(200);
        expect(seeded.value.status).toBe("completed");
        expect(seeded.value.results).toHaveLength(5);
        const a = {
            id: scope + "beads/a",
            type,
            revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
            properties: aProperties,
            metadata: aMetadata,
          },
          b = {
            id: scope + "beads/b",
            type,
            revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
            properties: { title: "b", unknown: true },
            metadata: {},
          };
        record(seeded.value.results[0].resource, a, "bead");
        record(seeded.value.results[1].resource, b, "bead");
        const retainedBeads = seeded.value.results
          .slice(0, 2)
          .map((r: { resource: unknown }) => r.resource);
        const links = authored.map((r, i) => {
          const value = seeded.value.results[i + 2].resource;
          const expected = {
            id: scope + r.id,
            type: linkType,
            revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
            source: scope + r.source,
            target: scope + r.target,
            properties: { title: r.title, extra: { retained: true } },
            metadata: { link: true },
          };
          record(value, expected, "link");
          return value;
        });
        for (const [id, expected] of [
          ["beads/a", retainedBeads[0]],
          ["beads/b", retainedBeads[1]],
          ...links.map((r: { id: string }) => [r.id, r] as const),
        ] as const) {
          const read = await c.exchange(id);
          expect(read.wire.status).toBe(200);
          expect(read.value).toEqual(expected);
        }
        const full = await c.exchange("beads/a"),
          properties = await c.exchange("beads/a?view=properties");
        expect(properties.wire.status).toBe(200);
        expect(properties.value).toEqual(aProperties);
        expect(full.wire.headers.etag).toBe(
          JSON.stringify(seeded.value.results[0].resource.revision),
        );
        expect(properties.wire.headers.etag).toBe(full.wire.headers.etag);

        const suffixes = [
          "?view=links&direction=inbound&limit=32",
          "?view=links&direction=outbound&limit=32",
          "?view=links&direction=both&limit=32",
          "?view=links&limit=32",
        ];
        const wanted = [
          [links[2], links[0]],
          [links[1], links[2]],
          [links[1], links[2], links[0]],
          [links[1], links[2], links[0]],
        ];
        for (const [i, suffix] of suffixes.entries()) {
          const get = await c.exchange("beads/a" + suffix);
          expect(get.wire.status).toBe(200);
          page(get.value, wanted[i]!);
          const head = await c.exchange("beads/a" + suffix, undefined, undefined, {
            method: "HEAD",
          });
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
            expect(head.wire.headers[name]).toBe(get.wire.headers[name]);
        }
        // Explicit pin remains opaque; ordinary current reads carry the complete authored spelling.
        c.position("pos-2");
        const pinned = await c.batch(
          [
            {
              operation: "createLink",
              id: "links/pin",
              type: linkType,
              source: { uri: "beads/a", revision: seeded.value.results[0].resource.revision },
              target: { uri: "beads/b", revision: "opaque+% /☃" },
              properties: { title: "pin", unknown: [false, 2] },
              metadata: { pin: true },
            },
          ],
          "resource-pin",
        );
        expect(pinned.value.status).toBe("completed");
        const expectedPin = {
          id: scope + "links/pin",
          type: linkType,
          revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
          source: { uri: scope + "beads/a", revision: seeded.value.results[0].resource.revision },
          target: { uri: scope + "beads/b", revision: "opaque+% /☃" },
          properties: { title: "pin", unknown: [false, 2] },
          metadata: { pin: true },
        };
        record(pinned.value.results[0].resource, expectedPin, "link");
        const pin = await c.exchange("links/pin");
        record(pin.value, expectedPin, "link");
        for (const [i, id] of ["a", "b"].entries())
          expect((await c.exchange("beads/" + id)).value).toEqual(retainedBeads[i]);
        campaign.results["resource-incident"] = {
          state: "pass",
          assertionSources: [
            "transactional-resource-records-installed.test.ts",
            "transactional-incident-directions-installed.test.ts",
          ],
          wholeRowsComplete: false,
          unselected: ["external endpoint deployment", "hidden policy", "incident pagination"],
        };
      } finally {
        await c.close();
      }
    });
  },
  70000,
);
function redirect(
  response: { status: number; headers: Readonly<Record<string, string>>; bodyText: string },
  target: string,
) {
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe(target);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.bodyText).toBe("");
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(response.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
}
it("NEW cumulative redirect oracle rejects representation/wrongLocation/missing requiredheader/body", () => {
  const good = {
    status: 307,
    headers: {
      location: scope + "beads/a",
      "cache-control": "private, no-store",
      "bdp-scope-epoch": "epoch",
      "bdp-authorization-view": "view",
      "bdp-scope-position": "pos-1",
    },
    bodyText: "",
  };
  redirect(good, scope + "beads/a");
  for (const bad of [
    { ...good, status: 200 },
    { ...good, headers: { ...good.headers, location: scope + "beads/b" } },
    { ...good, headers: { ...good.headers, "bdp-scope-epoch": "" } },
    { ...good, bodyText: "x" },
  ])
    expect(() => redirect(bad, scope + "beads/a")).toThrow();
});
it.skipIf(!productEntry)(
  "NEW cumulative live alias redirects/repoint and owner-observed unknown",
  async () => {
    await withProductCampaign("alias", bundle, async (campaign) => {
      const c = await productSession(campaign, "alias");
      try {
        c.position("pos-1");
        const seed = await c.batch(
          ["a", "b"].map((id) => ({
            operation: "createBead",
            id: "beads/" + id,
            type,
            properties: { title: id },
            metadata: {},
          })),
          "alias-beads",
        );
        expect(seed.value.status).toBe("completed");
        for (const target of ["a", "b"]) {
          const alias = await c.exchange(
            "operations/put-alias",
            { alias: "alias/work", target: "beads/" + target },
            "alias-" + target,
          );
          expect(alias.value.status).toBe("completed");
          for (const method of ["GET", "HEAD"] as const) {
            redirect(
              (await c.exchange("alias/work", undefined, undefined, { method })).wire,
              scope + "beads/" + target,
            );
          }
        }
        for (const method of ["GET", "HEAD"] as const) {
          const r = await c.exchange("alias/missing", undefined, undefined, { method });
          expect(r.wire.status).toBe(404);
          expect(r.wire.headers.location).toBeUndefined();
          expect(r.wire.headers["cache-control"]).toBe("private, no-store");
          if (method === "HEAD") expect(r.wire.bodyText).toBe("");
          else expect(r.value).toMatchObject({ code: "resource-not-found", status: 404 });
        }
        campaign.results.alias = {
          state: "pass",
          wholeRowsComplete: false,
          unselected: ["query-bearing pre-owner refusal", "historical alias/address collision"],
        };
      } finally {
        await c.close();
      }
    });
  },
  70000,
);
