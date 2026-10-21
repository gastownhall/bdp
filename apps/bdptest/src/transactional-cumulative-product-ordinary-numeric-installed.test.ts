/** Numeric literal admission assertions reused as a NEW current cumulative fixture composition. */
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
  sha,
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
  "NEW current cumulative raw numeric token admission, no-op, nested refusal and finite effects",
  async () => {
    await withProductCampaign("numeric", bundle, async (campaign) => {
      const child = await campaign.launch("numeric", false, campaign.signal),
        address = new URL(child.ready.listenUrl);
      const token = campaign.roles.find((r) => r.ref === "operator")!.token;
      let requests = 0,
        position = "pos-1",
        epoch: string | undefined,
        view: string | undefined;
      try {
        async function exchange(target: string, rawBody?: string) {
          expect(++requests).toBeLessThanOrEqual(28);
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
                rawBody === undefined
                  ? []
                  : [
                      { name: "Content-Type", value: "application/json" },
                      { name: "Idempotency-Key", value: `numeric-${requests}` },
                    ],
              ...(rawBody === undefined ? {} : { bodyBytes: Buffer.from(rawBody, "utf8") }),
            },
          };
          const result = await execute(request);
          campaign.observe("numeric", request, result);
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
        const properties = (n: number) => ({ n, z: 0, nested: { values: [0.1, 1e300] } });
        const metadata = { nested: { zero: 0, label: "retained" } };
        const initial = await exchange(
          "operations/create-bead",
          `{"id":"beads/a","type":"${type}","properties":{"n":1.0,"z":-0.0,"nested":{"values":[0.1,1e300]}},"metadata":{"nested":{"zero":-0,"label":"retained"}}}`,
        );
        expect(initial.wire.status).toBe(200);
        expect(initial.value.status).toBe("completed");
        const original = initial.value.results[0].resource;
        expect(original).toEqual({
          id: `${scope}beads/a`,
          type,
          revision: expect.any(String),
          properties: properties(1),
          metadata,
        });
        const assertReceipt = (
          response: Awaited<ReturnType<typeof exchange>>,
          resource: unknown,
          position: string,
        ) => {
          expect(response.wire.status).toBe(200);
          expect(response.value.status).toBe("completed");
          expect(response.value.results).toEqual([
            { operationIndex: 0, outcome: "updated", resource },
          ]);
          expect(response.value.requiredPosition).toBe(position);
          expect(response.wire.headers["bdp-scope-position"]).toBe(position);
        };
        for (const literal of ["1", "1.0", "1e0"]) {
          const noop = await exchange(
            "operations/update-bead",
            `{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":${literal}}]}`,
          );
          assertReceipt(noop, original, "pos-1");
          expect(noop.value).not.toHaveProperty("effectPosition");
        }
        for (const literal of ["-0", "0"]) {
          const noop = await exchange(
            "operations/update-bead",
            `{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/z","value":${literal}}]}`,
          );
          assertReceipt(noop, original, "pos-1");
          expect(noop.value).not.toHaveProperty("effectPosition");
        }
        position = "pos-2";
        const changed = await exchange(
          "operations/update-bead",
          '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":2}]}',
        );
        const current = changed.value.results[0].resource;
        expect(current.revision).not.toBe(original.revision);
        expect(current).toEqual({
          ...original,
          revision: current.revision,
          properties: properties(2),
        });
        assertReceipt(changed, current, "pos-2");
        expect(changed.value.effectPosition).toBe("pos-2");
        // The forbidden token remains text throughout request construction. JSON.parse is only
        // used for response oracles after the server has made its admission decision.
        const rejected = [
          {
            target: "operations/create-bead",
            body: `{"id":"beads/bad","type":"${type}","properties":{"n":9007199254740993,"z":0,"nested":{"values":[1]}}}`,
            pointer: "/properties/n",
            document: "properties",
          },
          {
            target: "operations/create-bead",
            body: `{"id":"beads/bad-nested","type":"${type}","properties":{"n":1,"z":0,"nested":{"values":[9007199254740993]}}}`,
            pointer: "/properties/nested/values/0",
            document: "properties",
          },
          {
            target: "operations/create-bead",
            body: `{"id":"beads/bad-meta","type":"${type}","properties":{"n":1,"z":0,"nested":{"values":[1]}},"metadata":{"nested":{"bad":9007199254740993}}}`,
            pointer: "/metadata/nested/bad",
            document: "metadata",
          },
          {
            target: "operations/update-bead",
            body: '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/nested","value":{"values":[9007199254740993]}}]}',
            pointer: "/propertiesChange/0/value/values/0",
            document: "properties",
          },
        ];
        for (const refusal of rejected) {
          const response = await exchange(refusal.target, refusal.body);
          expect(response.wire.status).toBe(200);
          expect(response.value.status).toBe("failed");
          expect(response.value.problem).toMatchObject({ code: "validation-failed", status: 422 });
          expect(response.value).not.toHaveProperty("results");
          expect(response.value).not.toHaveProperty("effectPosition");
          expect(response.value.requiredPosition).toBe("pos-2");
          expect(response.wire.headers["bdp-scope-position"]).toBe("pos-2");
          const diagnostics = response.value.problem.diagnostics;
          expect(diagnostics).toHaveLength(1);
          expect(diagnostics[0].message).toContain("unsupported number");
          if (refusal.target === "operations/create-bead")
            expect(diagnostics[0].instanceLocation).toBe(
              refusal.pointer.slice(`/${refusal.document}`.length),
            );
          else {
            expect(diagnostics[0].message).toContain(refusal.pointer);
            expect(diagnostics[0]).not.toHaveProperty("instanceLocation");
          }
          if (refusal.document === "metadata") expect(diagnostics[0].message).toContain("metadata");
          expect(diagnostics[0]).not.toHaveProperty("type");
          expect(diagnostics[0]).not.toHaveProperty("schemaLocation");
          expect(diagnostics[0].document ?? "properties").toBe(refusal.document);
          if (diagnostics[0].instanceLocation !== undefined)
            expect(diagnostics[0].instanceLocation).not.toMatch(
              /^\/(properties|metadata|propertiesChange)\//,
            );
        }
        for (const id of ["bad", "bad-nested", "bad-meta"]) {
          const missing = await exchange(`beads/${id}`);
          expect(missing.wire.status).toBe(404);
          expect(missing.value.code).toBe("resource-not-found");
        }
        const stored = await exchange("beads/a");
        expect(stored.value).toEqual(current);
        expect(stored.wire.bodyText).not.toContain("9007199254740992");
        async function changes() {
          const groups: { position: string; events: { type: string }[] }[] = [];
          let target: string | null = "changes/?after=genesis";
          for (let page = 0; target !== null; page++) {
            expect(page).toBeLessThan(5);
            const response = await exchange(target);
            expect(response.wire.status).toBe(200);
            expect(Array.isArray(response.value.groups)).toBe(true);
            groups.push(...response.value.groups);
            expect(response.value.next === null || typeof response.value.next === "string").toBe(
              true,
            );
            target = response.value.next;
          }
          return groups;
        }
        const priorGroups = await changes();
        expect(priorGroups.map((group) => group.position)).toEqual(["pos-1", "pos-2"]);
        expect(priorGroups.flatMap((group) => group.events.map((event) => event.type))).toEqual([
          "created",
          "updated",
        ]);
        position = "pos-3";
        const nearby = await exchange(
          "operations/update-bead",
          '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":9007199254740992}]}',
        );
        const final = nearby.value.results[0].resource;
        expect(final.revision).not.toBe(current.revision);
        expect(final).toEqual({
          ...current,
          revision: final.revision,
          properties: properties(9007199254740992),
        });
        assertReceipt(nearby, final, "pos-3");
        const finalStored = await exchange("beads/a");
        expect(finalStored.value).toEqual(final);
        expect(finalStored.wire.bodyText).toContain('"n":9007199254740992');
        const finalGroups = await changes();
        expect(finalGroups.map((group) => group.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
        expect(finalGroups.flatMap((group) => group.events.map((event) => event.type))).toEqual([
          "created",
          "updated",
          "updated",
        ]);

        campaign.results.numeric = {
          requests,
          original,
          current,
          final,
          priorGroups,
          finalGroups,
          rawUnrepresentableToken: "9007199254740993",
          fixtureDifference:
            "fixed cumulative Task schema is open; numeric admission applies recursively independently of schema keyword validation",
          wholeContract: false,
        };
      } finally {
        await child.close();
      }
    });
  },
  65000,
);
