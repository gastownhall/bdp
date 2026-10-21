/** NEW selected-config cumulative carrier, not the historical17 test. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createRawHttpExchangeExecutor,
  createJsonSchemaValidator,
  type ExactHttpExchangeRequest,
  type HttpExchangeRequest,
  type ExactHttpModeOptions,
} from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
  runCumulativeTransactionalMatrix,
} from "@bdp/conformance/testing";
import { createTransactionalExecutionBinding } from "../test-support/transactional-execution-binding.js";
import {
  withProductCampaign,
  productEntry,
  productFixtureSource,
  productSource,
  productScope as scope,
} from "../test-support/transactional-cumulative-product-runtime.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
const manifestSource = {
  bytes: readFileSync(
    new URL("../test-support/transactional-cumulative-product-read-manifest.json", import.meta.url),
  ),
};
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  { manifest: manifestSource, fixture: productFixtureSource },
);
const inheritedReadIds = [
  "read.discovery.scope-service-desc",
  "read.discovery.canonical-navigation",
  "read.http.get-head",
  "read.http.method-405",
  "read.http.cache-cors",
  "read.http.accept-negotiation",
  "read.http.conditional-reads",
  "read.http.head-conditional-parity",
] as const;
const selectedReadIds = process.env.BDP_CUMULATIVE_PRODUCT_SCENARIOS?.split(",") ?? [
  ...inheritedReadIds,
];
if (
  selectedReadIds.some(
    (id) => !inheritedReadIds.includes(id as (typeof inheritedReadIds)[number]),
  ) ||
  new Set(selectedReadIds).size !== selectedReadIds.length
)
  throw Error("invalid explicit Read selection");
const inheritedRequests: Record<string, readonly (readonly [string, string, number, string?])[]> = {
  "read.discovery.scope-service-desc": [
    ["GET", "", 204],
    ["GET", "bdp.json", 200],
    ["HEAD", "", 204],
    ["HEAD", "bdp.json", 200],
  ],
  "read.discovery.canonical-navigation": [
    ["GET", "bdp.json", 200],
    ["GET", "beads/", 200],
    ["GET", "links/", 200],
    ["GET", "types/?limit=32", 200],
    ["GET", "types/task", 200],
  ],
  "read.http.get-head": [
    ["GET", "", 204],
    ["HEAD", "", 204],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "bdp.json", 200],
    ["HEAD", "bdp.json", 200],
    ["GET", "beads/", 200],
    ["HEAD", "beads/", 200],
    ["GET", "links/", 200],
    ["HEAD", "links/", 200],
    ["GET", "types/", 200],
    ["HEAD", "types/", 200],
    ["GET", "types/task", 200],
    ["HEAD", "types/task", 200],
    ["GET", "beads/a?view=properties", 200],
    ["HEAD", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=links", 200],
    ["HEAD", "beads/a?view=links", 200],
  ],
  "read.http.method-405": [
    ["POST", "", 405],
    ["POST", "beads/a", 405],
    ["POST", "bdp.json", 405],
    ["POST", "beads/", 405],
  ],
  "read.http.cache-cors": [
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 403],
    ["OPTIONS", "beads/a", 405],
    ["GET", "bdp.json", 200],
    ["GET", "beads/", 200],
    ["GET", "links/", 200],
    ["GET", "types/", 200],
  ],
  "read.http.accept-negotiation": [
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 406],
    ["HEAD", "beads/a", 406],
    ["GET", "beads/missing", 404],
    ["GET", "beads/a", 401, "anonymous"],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/a", 406],
    ["HEAD", "beads/a", 406],
    ["GET", "beads/a", 406],
    ["HEAD", "beads/a", 406],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/a", 406],
    ["HEAD", "beads/a", 406],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
  ],
  "read.http.conditional-reads": [
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 304],
    ["HEAD", "beads/a", 304],
    ["GET", "beads/a", 412],
    ["GET", "beads/missing", 404],
    ["GET", "beads/a", 401, "anonymous"],
    ["GET", "beads/a", 412],
    ["GET", "beads/a", 304],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 412],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 304],
    ["GET", "beads/a", 304],
    ["GET", "beads/a", 200],
    ["GET", "bdp.json", 412],
    ["GET", "bdp.json", 200],
    ["GET", "bdp.json", 304],
    ["GET", "bdp.json", 200],
    ["GET", "beads/", 412],
    ["GET", "beads/", 200],
    ["GET", "beads/", 304],
    ["GET", "beads/", 200],
    ["GET", "types/task", 412],
    ["GET", "types/task", 200],
    ["GET", "types/task", 304],
    ["GET", "types/task", 200],
    ["GET", "beads/a?view=properties", 412],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=properties", 304],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a", 200],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "beads/a?view=properties", 200],
    ["GET", "bdp.json", 200],
    ["GET", "bdp.json", 200],
    ["GET", "bdp.json", 200],
    ["GET", "bdp.json", 200],
    ["GET", "bdp.json", 200],
    ["GET", "beads/a", 406],
    ["GET", "beads/?limit=0", 400],
  ],
  "read.http.head-conditional-parity": [
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/missing", 404],
    ["HEAD", "beads/missing", 404],
    ["GET", "beads/a", 401, "anonymous"],
    ["HEAD", "beads/a", 401, "anonymous"],
    ["GET", "beads/a", 304],
    ["HEAD", "beads/a", 304],
    ["GET", "beads/a", 412],
    ["HEAD", "beads/a", 412],
    ["GET", "bdp.json", 412],
    ["HEAD", "bdp.json", 412],
    ["GET", "bdp.json", 304],
    ["HEAD", "bdp.json", 304],
    ["GET", "beads/a", 200],
    ["HEAD", "beads/a", 200],
    ["GET", "beads/?limit=0", 400],
    ["HEAD", "beads/?limit=0", 400],
  ],
};
function inheritedReadContext(headers: Readonly<Record<string, string | undefined>>) {
  const result: Record<string, string> = {};
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"]) {
    const value = headers[name];
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
      throw new Error(`missing or malformed inherited Read context: ${name}`);
    result[name] = value;
  }
  if (result["bdp-scope-position"] !== "pos-1")
    throw new Error("unexpected seeded observation position");
  return result;
}
function inheritedDiscovery(value: unknown) {
  expect(
    createJsonSchemaValidator(schema).validate("#/$defs/transactionalDiscovery", value),
  ).toEqual([]);
  const body = value as Record<string, unknown>;
  expect(body.bdpVersion).toBe("0");
  expect(body.profile).toBe("transactional");
  expect(body.scope).toBe(scope);
  for (const [name, path] of Object.entries({
    beads: "beads/",
    links: "links/",
    types: "types/",
    operations: "operations/",
    aliases: "alias/",
    receipts: "receipts/",
    snapshot: "snapshot",
    changes: "changes/",
    events: "events/",
  }))
    expect(body[name], name).toBe(scope + path);
}
function inheritedServiceDescriptor(value: string | undefined) {
  if (value === undefined) throw new Error("service-desc missing");
  const match = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(value);
  if (!match?.[1]) throw new Error("invalid configured service-desc Link");
  expect(new URL(match[1], scope).href).toBe(scope + "bdp.json");
}
type InheritedReadProbe = {
  scenario: string;
  action: string;
  method: string;
  url: string;
  headerLines: readonly { name: string; value: string }[];
};
// Source-owned receiving-stage selection: only these exact finite parser probes.
// Status/code alone never classify an owner-observed response as pre-owner.
function isPreOwnerInheritedQuery(probe: InheritedReadProbe) {
  const declared =
    (probe.scenario === "read.http.conditional-reads" &&
      probe.action === "query-before-conditional" &&
      probe.method === "GET") ||
    (probe.scenario === "read.http.head-conditional-parity" &&
      ((probe.action === "parity-4-get" && probe.method === "GET") ||
        (probe.action === "parity-4-head" && probe.method === "HEAD")));
  return (
    declared &&
    probe.url === scope + "beads/?limit=0" &&
    JSON.stringify(probe.headerLines) ===
      JSON.stringify([
        { name: "accept", value: "application/json" },
        { name: "if-none-match", value: "*" },
      ])
  );
}
function inheritedResponseContext(
  probe: InheritedReadProbe,
  response: {
    status: number;
    headers: Readonly<Record<string, string | undefined>>;
    bodyText: string;
  },
  expected: Readonly<Record<string, string | undefined>>,
) {
  if (isPreOwnerInheritedQuery(probe)) {
    expect(response.status).toBe(400);
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(response.headers[name], name).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("private, no-store");
    if (probe.method === "HEAD") expect(response.bodyText).toBe("");
    else {
      expect(response.headers["content-type"]).toBe("application/problem+json");
      const problem = JSON.parse(response.bodyText);
      expect(createJsonSchemaValidator(schema).validate("#/$defs/readProblem", problem)).toEqual(
        [],
      );
      expect(problem.code).toBe("invalid-parameter");
      expect(problem.status).toBe(400);
    }
    return;
  }
  if (![401, 403, 405].includes(response.status))
    expect(inheritedReadContext(response.headers)).toEqual(inheritedReadContext(expected));
}

it.skipIf(!productEntry)(
  "NEW cumulative installed ordinary bundle joins inheritedRead under one actual configuration",
  async () => {
    await withProductCampaign("ordinary", bundle, async (campaign) => {
      const contexts = new Map<string, Record<string, string>>(),
        offsets = new Map<string, number>();
      let active: string | undefined;
      const routes: ExactHttpModeOptions["routes"] = Array.from(
        new Map(
          Object.values(inheritedRequests).flatMap((rows) =>
            rows.map(
              ([method, target]) =>
                [
                  `${method} ${target}`,
                  { method: method as "GET" | "HEAD" | "POST" | "OPTIONS", url: scope + target },
                ] as const,
            ),
          ),
        ).values(),
      );
      const exactMode: ExactHttpModeOptions = {
        scope,
        profile: "transactional",
        routes: [...routes, { method: "POST", url: scope + "operations/batch" }],
        maximumRequestHeaderBytes: 16384,
        maximumRequestBodyBytes: 65536,
        defaultCredentialRef: "operator",
        credentialHandles: [
          ...campaign.roles.map((r) => ({ id: r.ref, headerNames: ["authorization"] })),
          { id: "anonymous", headerNames: [] },
        ],
        resolveCredentials: ({ credentialRef }) => {
          if (credentialRef === "anonymous") return {};
          const role = campaign.roles.find((r) => r.ref === credentialRef);
          if (!role) throw Error("unknown source credential handle");
          return { authorization: `Bearer ${role.token}` };
        },
      };
      const target = createTransactionalExecutionBinding({
        baseline: campaign.baseline,
        sourceCommit: productSource!,
        fixtureSource: productFixtureSource,
        exactMode,
        launch: async (id, reopen, signal) => {
          expect(reopen).toBe(false);
          const child = await campaign.launch(id, reopen, signal);
          active = id;
          try {
            const address = new URL(String(child.ready.listenUrl));
            const execute = createRawHttpExchangeExecutor(
              { transport: "plain", host: address.hostname, port: Number(address.port) },
              { exactMode, requestTimeoutMs: 5000 },
            );
            const request: ExactHttpExchangeRequest = {
              method: "POST",
              url: scope + "operations/batch",
              credentialRef: "operator",
              signal,
              raw: {
                headerLines: [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: "inherited-fixture-seed" },
                ],
                bodyBytes: Buffer.from(
                  '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"inherited-read"},"metadata":{}}]}',
                ),
              },
            };
            const seed = await execute(request);
            campaign.observe(id, request, seed);
            expect(seed.status).toBe(200);
            expect(seed.exactRequest?.writeState).toBe("complete");
            expect(JSON.parse(seed.bodyText)).toMatchObject({
              status: "completed",
              detail: "available",
              requiredPosition: "pos-1",
              effectPosition: "pos-1",
            });
            contexts.set(id, inheritedReadContext(seed.headers));
            offsets.set(id, 0);
            return child;
          } catch (error) {
            try {
              await child.close();
            } catch (cleanup) {
              throw new AggregateError([error, cleanup], "seed and close failed");
            }
            throw error;
          }
        },
      });
      const executeInherited = async (request: ExactHttpExchangeRequest | HttpExchangeRequest) => {
        if (!request.raw) throw Error("exact raw inherited request required");
        if (!active) throw Error("missing actual selected session");
        const id = active,
          index = offsets.get(id) ?? 0,
          expected = inheritedRequests[id]?.[index];
        if (!expected) throw Error("extra/unselected source request");
        expect(request.method).toBe(expected[0]);
        expect(request.url).toBe(scope + expected[1]);
        expect(request.credentialRef ?? "operator").toBe(expected[3] ?? "operator");
        const response = await target.target.execute(request);
        campaign.observe(id, request, response);
        offsets.set(id, index + 1);
        expect(response.status).toBe(expected[2]);
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.byteLength).toBeGreaterThan(0);
        if (response.status === 204 && request.url === scope)
          inheritedServiceDescriptor(response.headers.link);
        if (
          response.status === 200 &&
          request.method === "GET" &&
          request.url === scope + "bdp.json"
        )
          inheritedDiscovery(JSON.parse(response.bodyText));
        const action = bundle.manifest.scenarios.find((r) => r.id === id)?.actions?.[index];
        if (!action) throw Error("source action missing");
        inheritedResponseContext(
          {
            scenario: id,
            action: action.id,
            method: request.method,
            url: request.url,
            headerLines: request.raw.headerLines,
          },
          response,
          contexts.get(id)!,
        );
        if (request.method === "HEAD" || [204, 304, 405, 406, 412].includes(response.status))
          expect(response.bodyOctets).toBe(0);
        return response;
      };
      try {
        const result = await runCumulativeTransactionalMatrix(
          {
            scope,
            profile: "transactional",
            seed: 0,
            signal: campaign.signal,
            artifactBundle: bundle,
            scenarioSelection: selectedReadIds,
            execute: async (request) => {
              if (!request.headers || request.raw) throw Error("unexpected semantic request");
              return executeInherited({
                method: request.method,
                url: request.url,
                signal: request.signal,
                credentialRef: "operator",
                raw: {
                  headerLines: Object.entries(request.headers).map(([name, value]) => ({
                    name,
                    value,
                  })),
                },
              });
            },
            exactExecution: {
              configuration: target.target.exactConfiguration!,
              execute: executeInherited,
            },
            harness: target.target.harness,
            schemaValidator: createJsonSchemaValidator(schema),
            declaredTargetLabel: "new-fixed-config-cumulative-product",
            prepareTimeoutMs: 10000,
            cleanupTimeoutMs: 10000,
            requestTimeoutMs: 5000,
          },
          target.context,
        );
        campaign.results["read-core-0"] = result;
        expect(result.scenarios.map((r) => r.id)).toEqual(selectedReadIds);
        for (const row of result.scenarios) {
          expect(row.state, row.id).toBe("pass");
          expect(offsets.get(row.id)).toBe(inheritedRequests[row.id]!.length);
        }
        expect(result.claimEligible).toBe(false);
      } finally {
        await target.target.close();
      }
    });
  },
  70000,
);
