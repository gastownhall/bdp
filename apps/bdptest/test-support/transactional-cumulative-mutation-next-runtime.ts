/** NEW mutation fixture adapter over the frozen cumulative launcher, binding and raw transport. */
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  type ExactHttpExchangeRequest,
} from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  withProductCampaign,
  productFixtureSource,
  productScope as scope,
  type Campaign,
} from "./transactional-cumulative-product-runtime.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
export { productEntry, productScope as scope } from "./transactional-cumulative-product-runtime.js";
export const validator = createJsonSchemaValidator(schema);
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  {
    manifest: {
      bytes: readFileSync(
        new URL("./transactional-cumulative-product-read-manifest.json", import.meta.url),
      ),
    },
    fixture: productFixtureSource,
  },
);
export type MutationCase = Awaited<ReturnType<typeof context>>;
async function context(campaign: Campaign, name: string) {
  const child = await campaign.launch(name, false, campaign.signal),
    address = new URL(child.ready.listenUrl);
  const operator = campaign.roles.find((r) => r.ref === "operator");
  if (!operator) throw Error("missing fixed operator role");
  const token = operator.token;
  let position = "pos-0",
    epoch: string | undefined,
    view: string | undefined,
    requests = 0;
  async function exchange(
    target: string,
    body?: unknown,
    key?: string,
    options: {
      method?: "GET" | "HEAD" | "POST";
      stage?: "owner-observed" | "carrier-syntax";
      keys?: string[];
      headers?: Array<{ name: string; value: string }>;
    } = {},
  ) {
    expect(++requests).toBeLessThanOrEqual(120);
    const method = options.method ?? (body === undefined ? "GET" : "POST"),
      url = new URL(target, scope).href;
    expect(url.startsWith(scope)).toBe(true);
    expect(new URL(url).hash).toBe("");
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
        headerLines: [
          ...(body === undefined
            ? []
            : [
                { name: "Content-Type", value: "application/json" },
                ...(options.keys ?? (key === undefined ? [] : [key])).map((value) => ({
                  name: "Idempotency-Key",
                  value,
                })),
              ]),
          ...(options.headers ?? []),
        ],
        ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
      },
    };
    const wire = await execute(request);
    campaign.observe(name, request, wire);
    expect(wire.exactRequest?.writeState).toBe("complete");
    expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
    if ((options.stage ?? "owner-observed") === "owner-observed") {
      for (const n of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(wire.headers[n]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      epoch ??= wire.headers["bdp-scope-epoch"];
      view ??= wire.headers["bdp-authorization-view"];
      expect(wire.headers["bdp-scope-epoch"]).toBe(epoch);
      expect(wire.headers["bdp-authorization-view"]).toBe(view);
      expect(wire.headers["bdp-scope-position"]).toBe(position);
    }
    // Carrier syntax paths retain actual headers, but claim no generic receiving-stage context exception.
    return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
  }
  return {
    exchange,
    position(p: string) {
      position = p;
    },
    batch: (operations: unknown[], key: string) =>
      exchange("operations/batch", { operations }, key),
    close: () => child.close(),
    requests: () => requests,
  };
}
export async function withMutationCase(
  name: string,
  run: (c: MutationCase, campaign: Campaign) => Promise<void>,
) {
  await withProductCampaign(name, bundle, async (campaign) => {
    const c = await context(campaign, name),
      errors: unknown[] = [];
    try {
      await run(c, campaign);
    } catch (error) {
      errors.push(error);
    }
    try {
      await c.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "NEW mutation case and independent close failures");
  });
}
export function row(
  value: any,
  id: string,
  type: string,
  properties: unknown,
  metadata: unknown = {},
  extra: Record<string, unknown> = {},
) {
  expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(value).toEqual({
    id: scope + id,
    type: scope + "types/" + type,
    revision: value.revision,
    properties,
    metadata,
    ...extra,
  });
  return value;
}
export function receipt(
  response: any,
  status: "completed" | "failed",
  position: string,
  key: string,
  effect?: string,
) {
  expect(response.wire.status).toBe(200);
  expect(validator.validate("#/$defs/mutationReceipt", response.value)).toEqual([]);
  expect(response.wire.headers["cache-control"]).toBe("private, no-store");
  expect(response.wire.headers.etag).toBeUndefined();
  expect(response.wire.headers["last-modified"]).toBeUndefined();
  expect(response.value).toMatchObject({
    status,
    detail: "available",
    idempotencyKey: key,
    requiredPosition: position,
  });
  if (effect === undefined) expect(response.value).not.toHaveProperty("effectPosition");
  else expect(response.value.effectPosition).toBe(effect);
  if (status === "failed") {
    expect(response.value).not.toHaveProperty("results");
    expect(response.value).not.toHaveProperty("next");
    expect(response.value.problem.code).not.toBe("temporarily-unavailable");
  }
  return response.value;
}
export async function feed(c: MutationCase) {
  const groups: any[] = [];
  let next: string | null = "changes/?after=genesis";
  for (let i = 0; next !== null; i++) {
    expect(i).toBeLessThan(8);
    const r = await c.exchange(next);
    expect(r.wire.status).toBe(200);
    expect(r.wire.headers.etag).toBeUndefined();
    expect(r.wire.headers["last-modified"]).toBeUndefined();
    groups.push(...r.value.groups);
    next = r.value.next;
    expect(next === null || typeof next === "string").toBe(true);
  }
  return groups;
}
