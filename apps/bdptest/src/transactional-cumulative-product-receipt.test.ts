/** Existing full receipt-page assertions on SAME cumulative installed fixture and credentials. */
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
const type = scope + "types/task";
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
it.skipIf(!productEntry)(
  "NEW cumulative receipt32plus1 boundaries, principal binding and genuine reopen",
  async () => {
    await withProductCampaign("receipt-pages", bundle, async (campaign) => {
      const c = await productSession(campaign, "receipt-pages");
      async function send(
        target: string,
        principal: "writer" | "other" = "writer",
        method: "GET" | "HEAD" | "POST" = "GET",
        body?: unknown,
        key?: string,
      ) {
        return (
          await c.exchange(target, body, key, {
            method,
            role: principal === "writer" ? "operator" : "principal-b",
          })
        ).wire;
      }
      async function pair(url: string, expectedBody: string) {
        const get = await send(url);
        expect(get.status).toBe(200);
        expect(get.bodyText).toBe(expectedBody);
        const head = await send(url, "writer", "HEAD");
        expect(head.status).toBe(200);
        expect(head.bodyText).toBe("");
        for (const response of [get, head]) {
          expect(response.headers["cache-control"]).toBe("private, no-store");
          expect(response.headers.etag).toBeUndefined();
          expect(response.headers["last-modified"]).toBeUndefined();
          expect(response.headers["content-type"]).toBe("application/json");
        }
        expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.bodyText)));
      }
      async function foreign(url: string) {
        const get = await send(url, "other");
        expect(get.status).toBe(404);
        expect(JSON.parse(get.bodyText).code).toBe("resource-not-found");
        const head = await send(url, "other", "HEAD");
        expect(head.status).toBe(404);
        expect(head.bodyText).toBe("");
      }
      try {
        const ids = Array.from({ length: 32 }, (_, i) => `r${String(i).padStart(2, "0")}`);
        c.position("pos-1");
        const seed = await send(
          "operations/batch",
          "writer",
          "POST",
          {
            operations: ids.map((id) => ({
              operation: "createBead",
              id: `beads/${id}`,
              type,
              properties: { label: id, n: 0 },
              metadata: { stage: "seed" },
            })),
          },
          "receipt-pages-seed",
        );
        expect(seed.status).toBe(200);
        const seeded = JSON.parse(seed.bodyText);
        expect(seeded.status).toBe("completed");
        expect(seeded.results).toHaveLength(32);
        expect(seeded.next).toBeNull();
        c.position("pos-2");
        const updated = await send(
          "operations/update-where",
          "writer",
          "POST",
          {
            collection: "beads",
            selector: "$[?@.properties.n == 0]",
            change: [{ op: "replace", path: "/n", value: 1 }],
            cardinality: { min: 32, max: 32 },
          },
          "receipt-pages-update",
        );
        expect(updated.status).toBe(200);
        const receipt = JSON.parse(updated.bodyText);
        expect(receipt.status).toBe("completed");
        expect(receipt.requiredPosition).toBe("pos-2");
        expect(receipt.effectPosition).toBe("pos-2");
        expect(receipt.results).toHaveLength(32);
        expect(receipt.results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 32 });
        expect(typeof receipt.next).toBe("string");
        const pageUrl = receipt.next as string;
        expect(pageUrl.startsWith(`${receipt.id}/pages/`)).toBe(true);
        const pageResponse = await send(pageUrl);
        expect(pageResponse.status).toBe(200);
        const page = JSON.parse(pageResponse.bodyText);
        expect(Object.keys(page).sort()).toEqual(["next", "receipt", "results"]);
        expect(page.receipt).toBe(receipt.id);
        expect(page.next).toBeNull();
        expect(page.results).toHaveLength(1);
        const entries = [...receipt.results, ...page.results];
        expect(entries).toHaveLength(33);
        expect(entries.slice(1).map((result) => result.resource.id)).toEqual(
          ids.map((id) => `${scope}beads/${id}`),
        );
        for (const [index, result] of entries.slice(1).entries()) {
          const before = seeded.results[index].resource;
          expect(result).toEqual({
            operationIndex: 0,
            outcome: "updated",
            resource: {
              id: `${scope}beads/${ids[index]}`,
              type,
              revision: expect.any(String),
              properties: { label: ids[index], n: 1 },
              metadata: { stage: "seed" },
            },
          });
          expect(result.resource.revision).not.toBe(before.revision);
        }
        expect(receipt.results.at(-1).resource.id).toBe(`${scope}beads/r30`);
        expect(page.results[0].resource.id).toBe(`${scope}beads/r31`);
        await pair(receipt.id, updated.bodyText);
        await pair(pageUrl, pageResponse.bodyText);
        await foreign(receipt.id);
        await foreign(pageUrl);
        await c.close();
        await c.reopen();
        await pair(receipt.id, updated.bodyText);
        await pair(pageUrl, pageResponse.bodyText);
        await foreign(receipt.id);
        await foreign(pageUrl);
        // A normal later commit changes serving context, never these retained boundaries/postimages.
        c.position("pos-3");
        const later = await send(
          "operations/update-bead",
          "writer",
          "POST",
          { bead: "beads/r00", propertiesChange: [{ op: "replace", path: "/n", value: 2 }] },
          "receipt-pages-later",
        );
        expect(later.status).toBe(200);
        expect(JSON.parse(later.bodyText).status).toBe("completed");
        await pair(receipt.id, updated.bodyText);
        await pair(pageUrl, pageResponse.bodyText);

        campaign.results["receipt-pages"] = {
          state: "pass",
          assertionSource: "transactional-receipt-pages-product-installed.test.ts",
          sameCumulativeConfiguration: true,
          untested: ["24h expiry", "rotated policy", "History"],
          wholeRowsComplete: false,
        };
      } finally {
        await c.close();
      }
    });
  },
  70000,
);
