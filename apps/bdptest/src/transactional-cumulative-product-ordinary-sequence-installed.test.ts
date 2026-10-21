/** NEW ordinary sequence composition: declaration order, partial commits and retained member dispositions. */
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
  sha,
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
  "NEW current cumulative sequence partial commits, bindings and relocated retained results",
  async () => {
    await withProductCampaign("sequence", bundle, async (campaign) => {
      const child = await campaign.launch("sequence", false, campaign.signal),
        address = new URL(child.ready.listenUrl);
      const token = campaign.roles.find((r) => r.ref === "operator")!.token;
      let requests = 0,
        position = "pos-3",
        epoch: string | undefined,
        view: string | undefined;
      try {
        async function exchange(target: string, body?: unknown) {
          expect(++requests).toBeLessThanOrEqual(28);
          const rawBody = body === undefined ? undefined : JSON.stringify(body);
          const method = rawBody === undefined ? "GET" : "POST",
            url = new URL(target, scope).href;
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
                resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
              },
            },
          );
          const request: ExactHttpExchangeRequest = {
            method,
            url,
            signal: campaign.signal,
            credentialRef: "operator",
            raw: {
              headerLines:
                rawBody === undefined ? [] : [{ name: "Content-Type", value: "application/json" }],
              ...(rawBody === undefined ? {} : { bodyBytes: Buffer.from(rawBody, "utf8") }),
            },
          };
          const result = await execute(request);
          campaign.observe("sequence", request, result);
          expect(result.exactRequest?.writeState).toBe("complete");
          if (rawBody !== undefined)
            expect(result.exactRequest?.bodyDigest).toBe(sha(Buffer.from(rawBody)));
          expect(result.wireResponseBytes?.length).toBeGreaterThan(0);
          for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
            expect(result.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
          epoch ??= result.headers["bdp-scope-epoch"];
          view ??= result.headers["bdp-authorization-view"];
          expect(result.headers["bdp-scope-epoch"]).toBe(epoch);
          expect(result.headers["bdp-authorization-view"]).toBe(view);
          expect(result.headers["bdp-scope-position"]).toBe(position);
          return { wire: result, value: JSON.parse(result.bodyText) };
        }

        const type = scope + "types/task",
          strict = scope + "types/strict";
        const members = [
          {
            operation: "createBead",
            id: "beads/a",
            type,
            properties: { title: "initial" },
            name: "source",
            idempotencyKey: "seq-source",
          },
          {
            operation: "createBead",
            id: "beads/bad",
            type: strict,
            properties: { n: "not-an-integer" },
            name: "failedCreator",
            idempotencyKey: "seq-failed",
          },
          {
            operation: "updateBead",
            bead: "@failedCreator",
            propertiesChange: [{ op: "add", path: "/title", value: "never" }],
            idempotencyKey: "seq-dependent",
          },
          {
            operation: "updateBead",
            bead: "@source",
            propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
            idempotencyKey: "seq-change",
          },
          {
            operation: "createBead",
            id: "beads/b",
            type,
            properties: { title: "independent" },
            name: "later",
            idempotencyKey: "seq-later",
          },
          {
            operation: "updateBead",
            bead: "@source",
            propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
            idempotencyKey: "seq-noop",
          },
        ];
        function row(value: any, id: string, title: string) {
          expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
          expect(value).toEqual({
            id: scope + "beads/" + id,
            type,
            revision: value.revision,
            properties: { title },
            metadata: {},
          });
          return value;
        }
        const first = await exchange("operations/sequence", { operations: members });
        expect(first.wire.status).toBe(200);
        expect(first.wire.headers["cache-control"]).toBe("private, no-store");
        expect(first.value.results).toHaveLength(6);
        expect(Object.keys(first.value)).toEqual(["results"]);
        const result = first.value.results;
        const original = row(result[0].resource, "a", "initial"),
          changed = row(result[3].resource, "a", "changed"),
          independent = row(result[4].resource, "b", "independent");
        expect(changed.revision).not.toBe(original.revision);
        for (const [index, outcome, resource] of [
          [0, "created", original],
          [3, "updated", changed],
          [4, "created", independent],
          [5, "updated", changed],
        ] as const)
          expect(result[index]).toEqual({
            operationIndex: index,
            ...(members[index]!.name === undefined ? {} : { operationName: members[index]!.name }),
            outcome,
            resource,
          });
        expect(result[1]).toMatchObject({
          operationIndex: 1,
          operationName: "failedCreator",
          code: "validation-failed",
          status: 422,
          retry: "never",
        });
        expect(result[1]).not.toHaveProperty("resource");
        expect(result[1]).not.toHaveProperty("outcome");
        expect(result[2]).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/request",
          code: "binding-unavailable",
          status: 400,
          retry: "never",
          operationIndex: 2,
        });
        const reordered = [
          { ...members[4]!, name: "laterAgain" },
          members[0]!,
          members[1]!,
          members[2]!,
          members[3]!,
          members[5]!,
        ];
        const retry = await exchange("operations/sequence", { operations: reordered });
        expect(retry.wire.status).toBe(200);
        expect(retry.value).toEqual({
          results: [4, 0, 1, 2, 3, 5].map((old, i) => ({
            ...result[old],
            operationIndex: i,
            ...(reordered[i]!.name === undefined ? {} : { operationName: reordered[i]!.name }),
          })),
        });
        const a = await exchange("beads/a"),
          b = await exchange("beads/b"),
          bad = await exchange("beads/bad");
        expect(a.wire.status).toBe(200);
        expect(a.value).toEqual(changed);
        expect(b.wire.status).toBe(200);
        expect(b.value).toEqual(independent);
        expect(bad.wire.status).toBe(404);
        expect(bad.value.code).toBe("resource-not-found");
        const groups: any[] = [];
        let next: string | null = "changes/?after=genesis";
        for (let page = 0; next !== null; page++) {
          expect(page).toBeLessThan(4);
          const feed = await exchange(next);
          expect(feed.wire.status).toBe(200);
          groups.push(...feed.value.groups);
          next = feed.value.next;
          expect(next === null || typeof next === "string").toBe(true);
        }
        expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
        expect(groups.map((g) => g.changes)).toEqual([
          [{ operation: "upsert", resourceKind: "bead", resource: original }],
          [{ operation: "upsert", resourceKind: "bead", resource: changed }],
          [{ operation: "upsert", resourceKind: "bead", resource: independent }],
        ]);
        expect(groups.flatMap((g) => g.events.map((e: any) => [e.type, e.subject]))).toEqual([
          ["created", scope + "beads/a"],
          ["updated", scope + "beads/a"],
          ["created", scope + "beads/b"],
        ]);
        campaign.results.sequence = {
          members,
          first: first.value,
          reordered,
          retry: retry.value,
          original,
          changed,
          independent,
          groups,
          requests,
          wholeContract: false,
          residuals: [
            "No live interleaving, pending owner, disconnect, clock-expired or erased permission case",
          ],
        };
      } finally {
        await child.close();
      }
    });
  },
  65000,
);
