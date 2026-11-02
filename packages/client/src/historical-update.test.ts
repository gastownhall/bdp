import { expect, it } from "vitest";
import { RetainedWriteBinding } from "./retained-write.js";
import { RetainedClient } from "./retained-read.js";
import {
  createHistoricalUpdateFetchTransport,
  createRetainedFetchTransport,
} from "./retained-transport.js";
const base = "application/vnd.bdp.v0.1+json";
const feature = "application/vnd.bdp.v0.1.historical-update.v1+json";
const capability = "https://github.com/gastownhall/bdp/capabilities/historical-update";
const scope = "https://owner.example/";
const id = `${scope}note`;
const destination = "https://delivery.example/update?literal=%2B%2f";
const discovery = {
  bdpVersion: "0.1",
  profile: "write",
  scope,
  beads: `${scope}beads`,
  links: `${scope}links`,
  aliases: `${scope}aliases/`,
  operations: `${scope}verbs`,
};
const directory = Object.fromEntries(
  [
    "createBead",
    "updateBead",
    "deleteBead",
    "createLink",
    "updateLink",
    "deleteLink",
    "putAlias",
    "deleteAlias",
  ].map((k) => [k, k === "updateBead" ? destination : `https://delivery.example/${k}`]),
);
function binding(versions: unknown = { "1": { atomicBatch: false } }) {
  return new RetainedWriteBinding({
    scope,
    discovery: {
      contentType: base,
      bodyText: JSON.stringify({ ...discovery, capabilities: { [capability]: versions } }),
    },
    directory: { contentType: base, bodyText: JSON.stringify(directory) },
    maximumDocumentBytes: 65536,
    maximumRequestBodyBytes: 65536,
  });
}
const body = ` { "bead":"${id}", "fromRevision":"source + /@=", "expectedRevision":"current + /@=" }\n`;
const resource = { id, type: `${scope}Note`, revision: "new", properties: {}, metadata: {} };
const result = { outcome: "updated", changed: true, resource };
const context = { fromRevision: "source + /@=", previousRevision: "current + /@=" };
const limits = {
  requestBodyBytes: 65536,
  responseBodyBytes: 65536,
  responseTimeoutMs: 1000,
  cleanupTimeoutMs: 10,
};
function client(fetcher: typeof fetch, selected = true) {
  const opts = {
    limits,
    allowTarget: (url: string) => url === destination,
    fetchImplementation: fetcher,
  };
  return new RetainedClient({
    transport: createRetainedFetchTransport(opts),
    ...(selected ? { historicalUpdateTransport: createHistoricalUpdateFetchTransport(opts) } : {}),
    maximumDocumentBytes: 65536,
    maximumRequestBodyBytes: 65536,
    operationTimeoutMs: 1000,
  });
}
function response(value: unknown, media = feature, status = 200) {
  const response = new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "content-type": media, "cache-control": "private, no-store" },
  });
  Object.defineProperty(response, "url", { value: destination });
  return response;
}
it("freezes selected feature headers and exact bytes while base preparation stays closed", () => {
  const b = binding();
  expect(b.historicalUpdateSupported).toBe(true);
  expect(() => b.prepare("updateBead", body, "key")).toThrow();
  const prepared = b.prepareHistoricalUpdate(body, "key");
  expect(prepared).toMatchObject({
    url: destination,
    bodyText: body,
    headers: { accept: feature, "content-type": feature, "idempotency-key": "key" },
  });
  expect(Object.isFrozen(prepared.headers)).toBe(true);
  expect(() => binding({ "2": {} }).prepareHistoricalUpdate(body, "key")).toThrow();
});
it("delivers exact frozen bytes with feature media and retains native wrapper bytes", async () => {
  let calls = 0;
  const native = ` { "result":${JSON.stringify(result)}, "historicalUpdate":${JSON.stringify(context)} }\n`;
  const reply = await client(async (url, init) => {
    calls++;
    expect(String(url)).toBe(destination);
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(body);
    expect(new Headers(init?.headers).get("accept")).toBe(feature);
    expect(new Headers(init?.headers).get("content-type")).toBe(feature);
    return response(native);
  }).submit(binding().prepareHistoricalUpdate(body, "key"));
  expect(calls).toBe(1);
  expect(reply).toMatchObject({ kind: "success", value: { result, historicalUpdate: context } });
  if (reply.kind !== "success") throw Error("missing result");
  expect(reply.nativeBody).toEqual(new TextEncoder().encode(native));
});
it.each([
  { fromRevision: "wrong", previousRevision: context.previousRevision },
  { fromRevision: context.fromRevision, previousRevision: "wrong" },
])("refuses contradictory changed-version evidence after submission", async (evidence) => {
  await expect(
    client(async () => response({ result, historicalUpdate: evidence })).submit(
      binding().prepareHistoricalUpdate(body, "key"),
    ),
  ).rejects.toMatchObject({ code: "invalid-response", submission: "unknown" });
});
it("preserves original no-op context rather than rewriting it from this request", async () => {
  const original = { fromRevision: "older", previousRevision: "older-current" };
  const reply = await client(async () =>
    response({ result: { ...result, changed: false }, historicalUpdate: original }),
  ).submit(binding().prepareHistoricalUpdate(body, "key"));
  expect(reply).toMatchObject({ kind: "success", value: { historicalUpdate: original } });
});
it("refuses missing explicit feature transport and mismatched frozen media before network", () => {
  let calls = 0;
  const c = client(async () => {
    calls++;
    return response({});
  }, false);
  const prepared = binding().prepareHistoricalUpdate(body, "key");
  expect(() => c.submit(prepared)).toThrow();
  expect(() =>
    c.submit({ ...prepared, headers: { ...prepared.headers, "content-type": base } }),
  ).toThrow();
  expect(calls).toBe(0);
});
it("accepts feature-local capability refusal without widening the base Problem parser", async () => {
  const problem = {
    type: "https://github.com/gastownhall/bdp/problems/request",
    status: 422,
    code: "capability-not-supported",
    retry: "after-state-change",
    capability,
    capabilityVersion: "1",
    pointer: "/fromRevision",
  };
  const reply = await client(async () => response(problem, "application/problem+json", 422)).submit(
    binding().prepareHistoricalUpdate(body, "key"),
  );
  expect(reply).toMatchObject({ kind: "problem", problem });
});
