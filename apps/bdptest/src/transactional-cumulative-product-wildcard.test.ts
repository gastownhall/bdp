/** Full mixed/wildcard ownership literal assertions ported onto cumulative fixture. */
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
const mixed = scope + "types/mixed",
  only = scope + "types/only",
  plain = scope + "types/plain",
  explicit = scope + "types/explicit",
  empty = scope + "types/empty",
  wild = scope + "types/wild",
  other = scope + "types/other";
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
const descriptors = JSON.parse(Buffer.from(productFixtureSource.bytes).toString("utf8"))
  .artifacts.descriptors.filter((d: { retrievalUri: string }) =>
    [mixed, only].includes(d.retrievalUri),
  )
  .map((d: { utf8: string }) => JSON.parse(d.utf8));
type Row = Record<string, unknown>;
function object(v: unknown): Row {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw Error("record required");
  return v as Row;
}
function text(v: unknown): string {
  if (typeof v !== "string") throw Error("string required");
  return v;
}
function revision(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(v)) throw Error("revision required");
  return v;
}
function ownedOracle(actual: unknown, expected: Row, links: readonly Row[]) {
  expect(actual).toEqual(expected);
  const owned = object(object(actual).ownedLinks);
  expect(owned).not.toHaveProperty("*");
  const flattened = Object.entries(owned).flatMap(([type, values]) => {
    if (!Array.isArray(values)) throw new Error("owned array required");
    for (const value of values) expect(object(value).type).toBe(type);
    const ids = values.map((v) => text(object(v).id));
    expect(ids).toEqual([...ids].sort());
    return values;
  });
  expect(flattened).toHaveLength(links.length);
  for (const link of links) expect(flattened).toContainEqual(link);
}

it.skipIf(!productEntry)(
  "NEW cumulative mixed/wildcard closure and max/noop source revisions",
  async () => {
    await withProductCampaign("wildcard", bundle, async (campaign) => {
      const c = await productSession(campaign, "wildcard");
      let key = 0,
        commits = 0;
      async function exchange(target: string, operations?: unknown[], status = 200) {
        const r = operations
          ? await c.batch(operations, `wild-${key++}`)
          : await c.exchange(target);
        expect(r.wire.status, r.wire.bodyText).toBe(status);
        expect(r.wire.headers["cache-control"]).toBe("private, no-store");
        return { r: r.wire, value: object(r.value) };
      }
      async function commit(operations: unknown[]) {
        const positions = [1, 2, 2, 3, 4, 5, 6, 7];
        const wanted = positions[commits++];
        if (wanted === undefined) throw Error("extra authored commit");
        c.position(`pos-${wanted}`);
        const r = (await exchange("operations/batch", operations)).value;
        expect(r.status).toBe("completed");
        expect(r.detail).toBe("available");
        expect(r.requiredPosition).toBe(`pos-${wanted}`);
        return r;
      }
      try {
        const bead = (id: string, type: string) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { n: 1 },
        });
        const initial = await commit([bead("a", mixed), bead("b", plain), bead("n", only)]);
        const results = initial.results as Row[];
        const a0 = object(object(results[0]).resource),
          b0 = object(object(results[1]).resource),
          n0 = object(object(results[2]).resource);
        for (const v of [a0, b0, n0]) revision(v.revision);
        const expectedA = (rev: unknown, ownedLinks: Row) => ({
          id: `${scope}beads/a`,
          type: mixed,
          revision: revision(rev),
          properties: { n: 1 },
          metadata: {},
          ownedLinks,
        });
        const explicitEmpty = { [explicit]: [], [empty]: [] };
        ownedOracle((await exchange("beads/a")).value, expectedA(a0.revision, explicitEmpty), []);
        expect((await exchange("beads/n")).value).toEqual({
          id: `${scope}beads/n`,
          type: only,
          revision: n0.revision,
          properties: { n: 1 },
          metadata: {},
          ownedLinks: {},
        });
        expect((await exchange("beads/b")).value).toEqual({
          id: `${scope}beads/b`,
          type: plain,
          revision: b0.revision,
          properties: { n: 1 },
          metadata: {},
        });
        for (const d of descriptors.slice(0, 2)) expect((await exchange(d.id)).value).toEqual(d);
        const makeLink = (id: string, type: string) => ({
          operation: "createLink",
          id: `links/${id}`,
          type,
          source: { uri: "beads/a", revision: a0.revision },
          target: { uri: "beads/b", revision: b0.revision },
          properties: { n: 1 },
        });
        const created = await commit([makeLink("z", wild)]);
        const c = object((created.results as Row[])[0]);
        expect(c.source).toBe(`${scope}beads/a`);
        expect(c.sourceRevision).not.toBe(a0.revision);
        const z = {
          id: `${scope}links/z`,
          type: wild,
          revision: revision(object(c.resource).revision),
          source: { uri: `${scope}beads/a`, revision: a0.revision },
          target: { uri: `${scope}beads/b`, revision: b0.revision },
          properties: { n: 1 },
          metadata: {},
        };
        expect((await exchange("links/z")).value).toEqual(z);
        ownedOracle(
          (await exchange("beads/a")).value,
          expectedA(c.sourceRevision, { ...explicitEmpty, [wild]: [z] }),
          [z],
        );
        expect((await exchange("beads/b")).value).toEqual(b0);
        const noOp = await commit([
          {
            operation: "updateLink",
            link: "links/z",
            propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
          },
        ]);
        expect(noOp).not.toHaveProperty("effectPosition");
        expect(noOp.requiredPosition).toBe(created.effectPosition);
        expect((noOp.results as Row[])[0]).toEqual({
          operationIndex: 0,
          outcome: "updated",
          resource: z,
          source: `${scope}beads/a`,
          sourceRevision: c.sourceRevision,
        });
        const updated = await commit([
          {
            operation: "updateLink",
            link: "links/z",
            propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
            metadataChange: [{ op: "add", path: "/note", value: "second" }],
          },
        ]);
        const u = object((updated.results as Row[])[0]),
          z2 = {
            ...z,
            revision: revision(object(u.resource).revision),
            properties: { n: 2 },
            metadata: { note: "second" },
          };
        expect(z2.revision).not.toBe(z.revision);
        expect(u.sourceRevision).not.toBe(c.sourceRevision);
        expect((await exchange("links/z")).value).toEqual(z2);
        ownedOracle(
          (await exchange("beads/a")).value,
          expectedA(u.sourceRevision, { ...explicitEmpty, [wild]: [z2] }),
          [z2],
        );
        expect((await exchange("beads/b")).value).toEqual(b0);
        const eReceipt = await commit([makeLink("e", explicit)]),
          er = object((eReceipt.results as Row[])[0]);
        const e = {
          ...z,
          id: `${scope}links/e`,
          type: explicit,
          revision: revision(object(er.resource).revision),
        };
        const a2 = expectedA(er.sourceRevision, { [explicit]: [e], [empty]: [], [wild]: [z2] });
        const beforeType = (await exchange("beads/a")).value;
        ownedOracle(beforeType, a2, [e, z2]);
        const failedType = (await exchange("operations/batch", [makeLink("e-over", explicit)]))
          .value;
        expect(failedType).toMatchObject({
          status: "failed",
          problem: { code: "validation-failed", status: 422, operationIndex: 0 },
        });
        expect(failedType).not.toHaveProperty("effectPosition");
        expect(failedType.requiredPosition).toBe(eReceipt.effectPosition);
        expect((await exchange("beads/a")).value).toEqual(beforeType);
        expect((await exchange("links/e-over", undefined, 404)).value.code).toBe(
          "resource-not-found",
        );
        const ar = await commit([makeLink("a", wild)]),
          ac = object((ar.results as Row[])[0]);
        const aLink = {
          ...z,
          id: `${scope}links/a`,
          revision: revision(object(ac.resource).revision),
        };
        const full = expectedA(ac.sourceRevision, {
          [explicit]: [e],
          [empty]: [],
          [wild]: [aLink, z2],
        });
        ownedOracle((await exchange("beads/a")).value, full, [e, aLink, z2]);
        const failedTotal = (
          await exchange("operations/batch", [
            {
              operation: "updateLink",
              link: "links/z",
              propertiesChange: [{ op: "replace", path: "/n", value: 99 }],
            },
            makeLink("over", other),
          ])
        ).value;
        expect(failedTotal).toMatchObject({
          status: "failed",
          problem: { code: "validation-failed", status: 422, operationIndex: 1 },
        });
        expect(failedTotal).not.toHaveProperty("effectPosition");
        expect(failedTotal.requiredPosition).toBe(ar.effectPosition);
        expect((await exchange("beads/a")).value).toEqual(full);
        expect((await exchange("links/z")).value).toEqual(z2);
        expect((await exchange("links/over", undefined, 404)).value.code).toBe(
          "resource-not-found",
        );
        expect((await exchange("beads/b")).value).toEqual(b0);
        const deleted = await commit([{ operation: "deleteLink", link: "links/z" }]),
          dr = object((deleted.results as Row[])[0]);
        expect(dr).toEqual({
          operationIndex: 0,
          outcome: "deleted",
          deleted: {
            resourceKind: "link",
            resource: { id: z2.id, type: wild, revision: z2.revision },
          },
          source: `${scope}beads/a`,
          sourceRevision: dr.sourceRevision,
        });
        expect(dr.sourceRevision).not.toBe(ac.sourceRevision);
        ownedOracle(
          (await exchange("beads/a")).value,
          expectedA(dr.sourceRevision, { [explicit]: [e], [empty]: [], [wild]: [aLink] }),
          [e, aLink],
        );
        expect((await exchange("links/z", undefined, 404)).value.code).toBe("resource-not-found");
        const last = await commit([{ operation: "deleteLink", link: "links/a" }]),
          lr = object((last.results as Row[])[0]);
        expect(lr.sourceRevision).not.toBe(dr.sourceRevision);
        ownedOracle(
          (await exchange("beads/a")).value,
          expectedA(lr.sourceRevision, { [explicit]: [e], [empty]: [] }),
          [e],
        );
        expect((await exchange("beads/b")).value).toEqual(b0);
        expect((await exchange("links/e")).value).toEqual(e);

        campaign.results.wildcard = {
          state: "pass",
          assertionSource: "transactional-wildcard-ownership-installed.test.ts",
          wholeRowsComplete: false,
        };
      } finally {
        await c.close();
      }
    });
  },
  70000,
);
