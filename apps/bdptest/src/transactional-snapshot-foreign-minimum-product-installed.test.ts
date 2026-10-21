/** NEW ordinary installed witness: known current unexpired Snapshot rejects foreign minimum context. */
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
it.skipIf(!productEntry)(
  "NEW packed known current unexpired Snapshot manifest and page reject foreign minimum context before position ordering",
  async () => {
    await withProductCampaign("retained-foreign-minimum", bundle, async (campaign) => {
      const c = await productSession(campaign, "retained-foreign-minimum");
      try {
        const ids = Array.from({ length: 33 }, (_, i) => `r${String(i).padStart(2, "0")}`);
        const records: unknown[] = [];
        for (const [index, chunk] of [ids.slice(0, 32), ids.slice(32)].entries()) {
          c.position(`pos-${index + 1}`);
          const seed = await c.batch(
            chunk.map((id) => ({
              operation: "createBead",
              id: `beads/${id}`,
              type: scope + "types/task",
              properties: { label: id, n: 0 },
              metadata: { stage: "retained" },
            })),
            `foreign-minimum-seed-${index}`,
          );
          expect(seed.wire.status).toBe(200);
          expect(seed.value.status).toBe("completed");
          records.push(...seed.value.results.map((r: { resource: unknown }) => r.resource));
        }
        const captured = await c.exchange("snapshot");
        expect(captured.wire.status).toBe(200);
        const saved = captured.value;
        expect(saved.scopePosition).toBe("pos-2");
        expect(saved.beads.items).toEqual(records.slice(0, 32));
        expect(saved.links).toEqual({ items: [], next: null });
        expect(typeof saved.beads.next).toBe("string");
        const page = await c.exchange(saved.beads.next);
        expect(page.wire.status).toBe(200);
        expect(page.value).toEqual({ items: records.slice(32), next: null });
        const cases = [];
        for (const [target, body] of [
          [saved.id, captured.wire.bodyText],
          [saved.beads.next, page.wire.bodyText],
        ]) {
          for (const foreign of ["epoch", "view"] as const) {
            const status = foreign === "epoch" ? 410 : 409;
            const problem = {
              type: `https://github.com/gastownhall/bdp/problems/${foreign === "epoch" ? "gone" : "conflict"}`,
              code: foreign === "epoch" ? "cursor-expired" : "foreign-view",
              status,
              retry: "after-state-change",
            };
            // Foreign view uses an opaque minimum: context failure precedes ordering.
            const headers = [
              {
                name: "BDP-Scope-Epoch",
                value: foreign === "epoch" ? "foreign_epoch" : saved.scopeEpoch,
              },
              {
                name: "BDP-Authorization-View",
                value: foreign === "view" ? "foreign_view" : saved.authorizationView,
              },
              {
                name: "BDP-Minimum-Scope-Position",
                value: foreign === "view" ? "opaque_minimum" : "genesis",
              },
            ];
            expect(saved.scopeEpoch).not.toBe("foreign_epoch");
            expect(saved.authorizationView).not.toBe("foreign_view");
            const get = await c.exchange(target, undefined, undefined, { headers });
            const head = await c.exchange(target, undefined, undefined, {
              method: "HEAD",
              headers,
            });
            for (const response of [get, head]) {
              expect.soft(response.wire.status).toBe(status);
              expect.soft(response.wire.headers["x-bdp-development-limit"]).toBeUndefined();
              expect.soft(response.wire.headers["cache-control"]).toBe("private, no-store");
              expect.soft(response.wire.headers["bdp-scope-epoch"]).toBe(saved.scopeEpoch);
              expect
                .soft(response.wire.headers["bdp-authorization-view"])
                .toBe(saved.authorizationView);
              expect.soft(response.wire.headers["bdp-scope-position"]).toBe("pos-2");
            }
            expect.soft(get.value).toEqual(problem);
            expect.soft(head.wire.bodyText).toBe("");
            expect
              .soft(head.wire.headers["content-length"])
              .toBe(String(Buffer.byteLength(JSON.stringify(problem))));
            cases.push({ target, foreign, status });
          }
          // SAME issued identity, complete body, anchor and expiry survive every refusal.
          const after = await c.exchange(target);
          expect(after.wire.status).toBe(200);
          expect(after.wire.bodyText).toBe(body);
        }
        campaign.results["retained-foreign-minimum"] = {
          saved,
          records,
          cases,
          expectedScopePosition: "pos-2",
          unchangedSavedBodies: true,
        };
      } finally {
        await c.close();
      }
    });
  },
  90000,
);
