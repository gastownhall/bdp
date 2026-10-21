/** Existing mutation surface assertions on NEW cumulative config, no historical17 execution. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  type ExactHttpExchangeRequest,
  type HttpExchangeResponse,
  type HttpMethod,
} from "@bdp/conformance";
import { parseTransactionalDiscovery, parseTransactionalOperationDirectory } from "@bdp/protocol";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  withProductCampaign,
  productEntry,
  productFixtureSource,
  productScope as scope,
} from "../test-support/transactional-cumulative-product-runtime.js";
import schemaDocument from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
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
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
function context(response: Pick<HttpExchangeResponse, "headers">, position: string) {
  for (const name of contextNames) expect(response.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function methodOracle(
  response: Pick<HttpExchangeResponse, "status" | "headers" | "bodyText" | "bodyOctets">,
  allow: string,
) {
  expect(response.status).toBe(405);
  expect(response.headers.allow).toBe(allow);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.bodyText).toBe("");
  expect(response.bodyOctets).toBe(0);
}
function receiptOracle(
  value: Record<string, unknown>,
  status: "completed" | "failed",
  code?: string,
  retry?: string,
) {
  expect(value.status).toBe(status);
  if (status === "failed") {
    expect(value).not.toHaveProperty("next");
    expect(value).not.toHaveProperty("results");
    expect(value.problem).toMatchObject({ code, retry });
  } else {
    expect(value.next).toBeNull();
    expect(value.results).toHaveLength(1);
  }
}
function nonAdmissionOracle(
  before: Pick<HttpExchangeResponse, "status" | "bodyText">,
  accepted: Record<string, unknown>,
  replay: Record<string, unknown>,
) {
  expect(before.status).toBe(401);
  expect(JSON.parse(before.bodyText)).toMatchObject({
    code: "unauthenticated",
    status: 401,
    retry: "after-state-change",
  });
  receiptOracle(accepted, "completed");
  expect(accepted.results).toMatchObject([
    {
      outcome: "created",
      resource: { id: `${scope}beads/anonymous-key`, properties: { title: "only-effect" } },
    },
  ]);
  expect(replay).toEqual(accepted);
}

type Session = {
  exchange(
    method: HttpMethod,
    url: string,
    body?: unknown,
    key?: string,
    anonymous?: boolean,
  ): Promise<HttpExchangeResponse>;
  targets: Record<string, string>;
  schema: ReturnType<typeof createJsonSchemaValidator>;
};

async function withCumulative(label: string, run: (c: Session) => Promise<void>) {
  await withProductCampaign("mutation-" + label, bundle, async (campaign) => {
    const child = await campaign.launch("mutation-" + label, false, campaign.signal),
      dial = new URL(String(child.ready.listenUrl)),
      token = campaign.roles.find((r) => r.ref === "operator")!.token;
    let requests = 0;
    const exchange: Session["exchange"] = async (method, url, input, key, anonymous = false) => {
      expect(++requests).toBeLessThanOrEqual(100);
      const credentialRef = anonymous ? "anonymous" : "operator",
        bytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: dial.hostname, port: Number(dial.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 131072,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: credentialRef,
            credentialHandles: [
              { id: "operator", headerNames: ["authorization"] },
              { id: "anonymous", headerNames: [] },
            ],
            resolveCredentials: ({ credentialRef: selected }) =>
              selected === "anonymous" ? {} : { authorization: `Bearer ${token}` },
          },
        },
      );
      const request: ExactHttpExchangeRequest = {
        method,
        url,
        credentialRef,
        signal: campaign.signal,
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...(bytes === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key ?? "unused" },
                ]),
          ],
          ...(bytes === undefined ? {} : { bodyBytes: bytes }),
        },
      };
      const response = await execute(request);
      campaign.observe("mutation-" + label, request, response);
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      return response;
    };
    try {
      const discovery = await exchange("GET", scope + "bdp.json");
      expect(discovery.status).toBe(200);
      context(discovery, "pos-0");
      const doc = parseTransactionalDiscovery(JSON.parse(discovery.bodyText));
      const directory = await exchange("GET", doc.operations);
      expect(directory.status).toBe(200);
      context(directory, "pos-0");
      const declared = parseTransactionalOperationDirectory(JSON.parse(directory.bodyText));
      const targets = Object.fromEntries(
        Object.entries(declared).map(([name, reference]) => [
          name,
          new URL(reference, doc.operations).href,
        ]),
      );
      expect(targets).toEqual(campaign.baseline.operationTargets);
      await run({ exchange, targets, schema: createJsonSchemaValidator(schemaDocument) });
      campaign.results[label] = {
        state: "pass",
        requests,
        assertionSource: "transactional-mutation-surface-installed.test.ts",
        wholeRowsComplete: false,
      };
    } finally {
      await child.close();
    }
  });
}
function create(id: string) {
  return {
    id: `beads/${id}`,
    type,
    properties: { title: id === "anonymous-key" ? "only-effect" : id },
    metadata: {},
  };
}
async function receipt(
  session: Session,
  name: string,
  input: unknown,
  key: string,
  status: "completed" | "failed" = "completed",
  code?: string,
  retry?: string,
) {
  const response = await session.exchange(
    "POST",
    session.targets[name] ?? "missing-target",
    input,
    key,
  );
  expect(response.status, response.bodyText).toBe(200);
  const value = JSON.parse(response.bodyText) as Record<string, unknown>;
  expect(session.schema.validate("#/$defs/mutationReceipt", value)).toEqual([]);
  receiptOracle(value, status, code, retry);
  return { response, value };
}

it.skipIf(!productEntry)(
  "installed mutation methods advertise exact Allow over all twelve discovered targets",
  async () =>
    withCumulative("methods", async ({ exchange, targets }) => {
      const methods: HttpMethod[] = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"];
      for (const target of Object.values(targets))
        for (const method of methods) methodOracle(await exchange(method, target), "POST");
      for (const method of ["POST", "OPTIONS", "PUT", "PATCH", "DELETE"] as const)
        methodOracle(await exchange(method, `${scope}operations/`), "GET, HEAD");
      const state = await exchange("GET", `${scope}beads/?limit=32`);
      expect(state.status).toBe(200);
      context(state, "pos-0");
      expect(JSON.parse(state.bodyText)).toEqual({ items: [], next: null });
    }),
  45000,
);

it.skipIf(!productEntry)(
  "installed anonymous mutation creates no disposition before same-key authenticated success",
  async () =>
    withCumulative("anonymous", async (session) => {
      const input = create("anonymous-key"),
        key = "same-key-after-anonymous";
      const anonymous = await session.exchange(
        "POST",
        session.targets.createBead ?? "missing",
        input,
        key,
        true,
      );
      expect(anonymous.status).toBe(401);
      const missing = await session.exchange("GET", `${scope}beads/anonymous-key`);
      expect(missing.status).toBe(404);
      context(missing, "pos-0");
      const accepted = await receipt(session, "createBead", input, key);
      context(accepted.response, "pos-1");
      const current = await session.exchange("GET", `${scope}beads/anonymous-key`);
      expect(current.status).toBe(200);
      context(current, "pos-1");
      expect(JSON.parse(current.bodyText)).toEqual(
        (accepted.value.results as { resource: unknown }[])[0]?.resource,
      );
      const replay = await receipt(session, "createBead", input, key);
      context(replay.response, "pos-1");
      nonAdmissionOracle(anonymous, accepted.value, replay.value);
      const listing = await session.exchange("GET", `${scope}beads/?limit=32`);
      context(listing, "pos-1");
      expect(JSON.parse(listing.bodyText)).toEqual({
        items: [JSON.parse(current.bodyText)],
        next: null,
      });
    }),
  45000,
);

it.skipIf(!productEntry)(
  "installed alias uniqueness precedes target lookup and alias deletion releases only its path",
  async () =>
    withCumulative("uniqueness", async (session) => {
      const historical = await receipt(
        session,
        "createBead",
        create("reserved"),
        "reserved-create",
      );
      const original = (historical.value.results as { resource: { revision: string } }[])[0]
        ?.resource;
      expect(original?.revision).toBeTypeOf("string");
      await receipt(
        session,
        "deleteBead",
        { bead: "beads/reserved", expectedRevision: original?.revision },
        "reserved-delete",
      );
      const collision = await receipt(
        session,
        "putAlias",
        { alias: "alias/reserved", target: "beads/unknown" },
        "reserved-put",
        "failed",
        "identity-taken",
        "never",
      );
      context(collision.response, "pos-2");
      const target = await receipt(session, "createBead", create("target"), "target-create");
      const aliasCreated = await receipt(
        session,
        "putAlias",
        { alias: "alias/live", target: "beads/target" },
        "live-put",
      );
      context(aliasCreated.response, "pos-3");
      expect(aliasCreated.value).not.toHaveProperty("effectPosition");
      const held = await receipt(
        session,
        "createBead",
        create("live"),
        "live-collision",
        "failed",
        "alias-path-taken",
        "after-state-change",
      );
      context(held.response, "pos-3");
      const redirected = await session.exchange("GET", `${scope}alias/live`);
      expect(redirected.status).toBe(307);
      expect(redirected.headers.location).toBe(`${scope}beads/target`);
      context(redirected, "pos-3");
      const aliasDeleted = await receipt(
        session,
        "deleteAlias",
        { alias: "alias/live" },
        "live-delete",
      );
      context(aliasDeleted.response, "pos-3");
      expect(aliasDeleted.value).not.toHaveProperty("effectPosition");
      const released = await receipt(session, "createBead", create("live"), "live-new-key");
      context(released.response, "pos-4");
      const current = await session.exchange("GET", `${scope}beads/live`);
      expect(current.status).toBe(200);
      context(current, "pos-4");
      expect(JSON.parse(current.bodyText)).toEqual(
        (released.value.results as { resource: unknown }[])[0]?.resource,
      );
      const unchanged = await session.exchange("GET", `${scope}beads/target`);
      expect(unchanged.status).toBe(200);
      expect(JSON.parse(unchanged.bodyText)).toEqual(
        (target.value.results as { resource: unknown }[])[0]?.resource,
      );
      const reserved = await session.exchange("GET", `${scope}beads/reserved`);
      expect(reserved.status).toBe(404);
      context(reserved, "pos-4");
    }),
  45000,
);
