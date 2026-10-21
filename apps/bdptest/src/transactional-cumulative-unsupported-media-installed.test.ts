/** One NEW packed receiving witness; source/runtime bindings remain independently selected. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createRawHttpExchangeExecutor, type ExactHttpExchangeRequest } from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  withProductCampaign,
  productEntry,
  productFixtureSource,
  productScope as scope,
  sha,
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
  "NEW packed TX unsupported media refuses before admission then same key first executes and replays once",
  async () => {
    await withProductCampaign("unsupported-media", bundle, async (campaign) => {
      const child = await campaign.launch("unsupported-media", false, campaign.signal);
      try {
        expect(campaign.baseline.runtimeConfigurationIdentity).toBe(
          "73bdc0e24d65a8ab4444c5698b84d368a39cdcbbe2caad3ef7d913a317b1930b",
        );
        expect(campaign.baseline.served.installedPayloadDigest).toBe(
          "55eecd3507f4e942ae8a09da72fc1c97afe6659d278461977e51a03932dd8857",
        );
        const address = new URL(String(child.ready.listenUrl));
        const key = "unsupported-media-1";
        const id = scope + "beads/media-boundary";
        const type = scope + "types/task";
        const properties = { label: "media-boundary", n: 7 };
        const metadata = { stage: "receiving" };
        const request = {
          operations: [
            { operation: "createBead", id: "beads/media-boundary", type, properties, metadata },
          ],
        };
        let count = 0;
        async function exchange(target: string, body?: unknown, contentType = "application/json") {
          expect(++count).toBeLessThanOrEqual(16);
          const method = body === undefined ? "GET" : "POST";
          const url = new URL(target, scope).href;
          const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
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
                credentialHandles: campaign.roles.map((r) => ({
                  id: r.ref,
                  headerNames: ["authorization"],
                })),
                resolveCredentials: ({ credentialRef }) => {
                  const role = campaign.roles.find((r) => r.ref === credentialRef);
                  if (!role) throw Error("unbound exact credential");
                  return { authorization: `Bearer ${role.token}` };
                },
              },
            },
          );
          const authored: ExactHttpExchangeRequest = {
            method,
            url,
            signal: campaign.signal,
            credentialRef: "operator",
            raw: {
              headerLines: [
                { name: "Accept", value: "application/json" },
                ...(raw
                  ? [
                      { name: "Content-Type", value: contentType },
                      { name: "Idempotency-Key", value: key },
                    ]
                  : []),
              ],
              ...(raw ? { bodyBytes: raw } : {}),
            },
          };
          const wire = await execute(authored);
          campaign.observe("unsupported-media", authored, wire);
          expect(wire.exactRequest?.writeState).toBe("complete");
          expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
          if (raw) expect(wire.exactRequest?.bodyDigest).toBe(sha(raw));
          expect(wire.headers["cache-control"]).toBe("private, no-store");
          return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
        }
        function current(response: Awaited<ReturnType<typeof exchange>>, position: string) {
          expect(response.wire.headers["bdp-scope-epoch"]).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(response.wire.headers["bdp-authorization-view"]).toBe("development-all-visible");
          expect(response.wire.headers["bdp-scope-position"]).toBe(position);
        }
        const before = await exchange("beads/?limit=32");
        expect(before.wire.status).toBe(200);
        current(before, "pos-0");
        expect(before.value).toEqual({ items: [], next: null });
        const initialFeed = await exchange("changes/?after=genesis");
        expect(initialFeed.wire.status).toBe(200);
        current(initialFeed, "pos-0");
        expect(initialFeed.value.groups).toEqual([]);
        expect(initialFeed.value.next).toBeNull();
        expect(initialFeed.value.observedHeadPosition).toBe("pos-0");
        const refused = await exchange("operations/batch", request, "text/plain");
        expect(refused.wire.status).toBe(415);
        expect(refused.value).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/request",
          code: "unsupported-media-type",
          status: 415,
          retry: "never",
        });
        expect(refused.wire.headers["content-type"]).toBe("application/problem+json");
        for (const field of [
          "bdp-scope-epoch",
          "bdp-authorization-view",
          "bdp-scope-position",
          "location",
          "etag",
          "last-modified",
          "retry-after",
        ])
          expect(refused.wire.headers[field], field).toBeUndefined();
        expect(refused.value).not.toHaveProperty("id");
        expect(refused.value).not.toHaveProperty("transaction");
        const afterRefusal = await exchange("beads/?limit=32");
        expect(afterRefusal.wire.status).toBe(200);
        current(afterRefusal, "pos-0");
        expect(afterRefusal.value).toEqual(before.value);
        const feedAfterRefusal = await exchange("changes/?after=genesis");
        expect(feedAfterRefusal.wire.status).toBe(200);
        current(feedAfterRefusal, "pos-0");
        expect(feedAfterRefusal.value).toEqual(initialFeed.value);
        const absent = await exchange(id);
        expect(absent.wire.status).toBe(404);
        current(absent, "pos-0");
        expect(absent.value).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/not-found",
          code: "resource-not-found",
          status: 404,
          retry: "after-state-change",
        });
        const first = await exchange("operations/batch", request);
        expect(first.wire.status).toBe(200);
        current(first, "pos-1");
        const receipt = first.value;
        expect(receipt).toMatchObject({
          status: "completed",
          detail: "available",
          idempotencyKey: key,
          requiredPosition: "pos-1",
          effectPosition: "pos-1",
          next: null,
        });
        expect(receipt.id).toMatch(/^https:\/\/reference\.invalid\/acme\/receipts\/.+$/);
        expect(receipt.transaction).toMatch(/^.+$/);
        expect(receipt.results).toHaveLength(1);
        const revision = receipt.results[0].resource.revision;
        expect(revision).toMatch(/^.+$/);
        const expected = { id, type, revision, properties, metadata };
        expect(receipt.results).toEqual([
          { operationIndex: 0, outcome: "created", resource: expected },
        ]);
        const read = await exchange(id);
        expect(read.wire.status).toBe(200);
        current(read, "pos-1");
        expect(read.value).toEqual(expected);
        const receiptRead = await exchange(receipt.id);
        expect(receiptRead.wire.status).toBe(200);
        current(receiptRead, "pos-1");
        expect(receiptRead.wire.bodyText).toBe(first.wire.bodyText);
        const retry = await exchange("operations/batch", request);
        expect(retry.wire.status).toBe(200);
        current(retry, "pos-1");
        expect(retry.wire.bodyText).toBe(first.wire.bodyText);
        const feed = await exchange("changes/?after=genesis");
        expect(feed.wire.status).toBe(200);
        current(feed, "pos-1");
        expect(feed.value.next).toBeNull();
        expect(feed.value.observedHeadPosition).toBe("pos-1");
        expect(feed.value.groups).toHaveLength(1);
        const group = feed.value.groups[0];
        expect(group).toMatchObject({
          scopeEpoch: receipt.scopeEpoch,
          authorizationView: receipt.authorizationView,
          position: "pos-1",
          previousPosition: "pos-0",
          projectionAdvance: false,
          transaction: receipt.transaction,
          erasures: [],
          eventCount: 1,
        });
        expect(group.changes).toEqual([
          { operation: "upsert", resourceKind: "bead", resource: expected },
        ]);
        expect(group.events).toHaveLength(1);
        const event = group.events[0];
        expect(event).toEqual({
          id: expect.any(String),
          ordinal: 0,
          type: "created",
          source: scope + "events/",
          subject: id,
          subjectType: type,
          transaction: receipt.transaction,
          time: expect.any(String),
          data: { revision, properties, metadata },
        });
        expect(Number.isFinite(Date.parse(event.time))).toBe(true);
        const final = await exchange("beads/?limit=32");
        expect(final.wire.status).toBe(200);
        current(final, "pos-1");
        expect(final.value).toEqual({ items: [expected], next: null });
        expect(count).toBe(12);
        campaign.results["unsupported-media"] = {
          authoredRequest: request,
          requestBytes: Buffer.byteLength(JSON.stringify(request)),
          expected,
          receipt,
          initialFeed: initialFeed.value,
          finalGroup: group,
          exactKeyReused: true,
          fullCurrentRecords: final.value,
          wireCount: count,
        };
      } finally {
        await child.close();
      }
    });
  },
  90000,
);
