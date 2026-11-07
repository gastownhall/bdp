import { stringifyJsonValue } from "@bdp/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  CALLABLE_BATCH_TYPE,
  CALLABLE_QUERY_TYPE,
  type CallableDeclaration,
  callableMount,
  createStaticCallableCatalog,
} from "./callable.js";
import { RetainedClient, RetainedClientError } from "./retained-read.js";
import { createRetainedFetchTransport, RetainedTransportError } from "./retained-transport.js";

const media = "application/vnd.bdp.v0.1+json";
const problemMedia = "application/problem+json";
const scope = "https://records.example/work/";
const descriptionUrl = `${scope}bdp/discovery`;
const CALLABLES = "https://github.com/gastownhall/bdp/capabilities/callables";
const IDEMPOTENCY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
const conflict = "https://github.com/gastownhall/bdp/problems/conflict";

const query: CallableDeclaration = {
  name: "find-room",
  type: CALLABLE_QUERY_TYPE,
  description: "Find a room.",
  parameters: [],
};
const batch: CallableDeclaration = {
  name: "rooms/reserve",
  type: CALLABLE_BATCH_TYPE,
  description: "Reserve a room.",
  parameters: [],
};

function discovery(
  options: { idempotency?: boolean; callables?: boolean; profile?: "core" | "write" } = {},
) {
  const { idempotency = false, callables = true, profile = "write" } = options;
  return {
    bdpVersion: "0.1",
    profile,
    scope,
    specRevision: "0123456789abcdef0123456789abcdef01234567",
    ...(profile === "write" ? { operations: `${scope}bdp/write` } : {}),
    capabilities: {
      ...(callables ? { [CALLABLES]: { "1": {} } } : {}),
      ...(idempotency ? { [IDEMPOTENCY]: { "1": {} } } : {}),
    },
  };
}
function reply(url: string, status: number, body: string | null, contentType?: string): Response {
  const result = new Response(body, {
    status,
    headers: {
      ...(contentType === undefined ? {} : { "content-type": contentType }),
      ...(url === scope
        ? { link: `<${descriptionUrl}>; rel="service-desc"; type="${media}"` }
        : {}),
    },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function harness(
  advertised: Parameters<typeof discovery>[0],
  answer: { status: number; body: unknown; contentType?: string },
) {
  const posts: { url: string; headers: Headers; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({
        url,
        headers: new Headers(init.headers),
        body: new TextDecoder().decode(init.body as Uint8Array),
      });
      return reply(
        url,
        answer.status,
        typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
        answer.contentType ?? (answer.status === 200 ? media : problemMedia),
      );
    }
    if (url === scope) return reply(url, 204, null);
    if (url === descriptionUrl)
      return reply(url, 200, JSON.stringify(discovery(advertised)), media);
    throw new Error(`unexpected request to ${url}`);
  };
  const client = new RetainedClient({
    transport: createRetainedFetchTransport({
      fetchImplementation: fetcher,
      allowTarget: () => true,
      limits: {
        requestBodyBytes: 65536,
        responseBodyBytes: 65536,
        responseTimeoutMs: 1000,
        cleanupTimeoutMs: 10,
      },
    }),
    maximumDocumentBytes: 65536,
    maximumRequestBodyBytes: 65536,
    operationTimeoutMs: 1000,
  });
  return { client, posts };
}
async function bind(client: RetainedClient) {
  const bound = await client.bindCallables(scope);
  if (bound.kind !== "success") throw new Error("binding failed");
  return bound.value;
}

describe("the static catalog", () => {
  it("lists and gets declarations, loading them once at first use", async () => {
    const load = vi.fn(() => [query, batch]);
    const catalog = createStaticCallableCatalog(load);
    expect(load).not.toHaveBeenCalled();
    await expect(catalog.list()).resolves.toEqual([query, batch]);
    await expect(catalog.get("rooms/reserve")).resolves.toBe(batch);
    await expect(catalog.get("absent")).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("the mount", () => {
  it("is the fixed namespace plus the name, each segment encoded canonically", () => {
    expect(callableMount(scope, "reserve-room")).toBe(`${scope}bdp/call/reserve-room`);
    expect(callableMount(scope, "rooms/reserve")).toBe(`${scope}bdp/call/rooms/reserve`);
    expect(callableMount(scope, "a b/é~:%")).toBe(`${scope}bdp/call/a%20b/%C3%A9~:%25`);
  });
  it.each(["", "a//b", "..", "a/./b", "a\u0001"])("refuses the name %j", (name) => {
    expect(() => callableMount(scope, name)).toThrow();
  });
});

describe("invoking a Callable", () => {
  it("posts a query with only its arguments, no key and the selected media", async () => {
    const { client, posts } = harness(
      { idempotency: true },
      { status: 200, body: { result: { rooms: [] } } },
    );
    const binding = await bind(client);
    const prepared = binding.prepare({ declaration: query, arguments: { size: 4 } });
    const reply = await client.invokeCallable(prepared);
    expect(reply).toMatchObject({ kind: "success", value: { result: { rooms: [] } } });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`${scope}bdp/call/find-room`);
    expect(JSON.parse(posts[0]?.body ?? "")).toEqual({ arguments: { size: 4 } });
    expect(posts[0]?.headers.get("content-type")).toBe(media);
    expect(posts[0]?.headers.has("idempotency-key")).toBe(false);
  });

  it("carries provenance and one minted key on a batch under idempotency", async () => {
    const { client, posts } = harness(
      { idempotency: true },
      { status: 200, body: { result: { id: "r1" }, changed: true } },
    );
    const binding = await bind(client);
    expect(binding.idempotencyAdvertised).toBe(true);
    const provenance = { actor: { id: "sam", basis: "writer-supplied" } };
    const prepared = binding.prepare({
      declaration: batch,
      arguments: {},
      revisionProvenance: provenance,
    });
    expect(prepared.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    const reply = await client.invokeCallable(prepared);
    expect(reply).toMatchObject({
      kind: "success",
      value: { changed: true, result: { id: "r1" } },
    });
    expect(posts[0]?.url).toBe(`${scope}bdp/call/rooms/reserve`);
    expect(JSON.parse(posts[0]?.body ?? "")).toEqual({
      arguments: {},
      revisionProvenance: provenance,
    });
    expect(posts[0]?.headers.get("idempotency-key")).toBe(prepared.idempotencyKey);
  });

  it("uses a supplied key under idempotency and sends none on a Scope without it", async () => {
    const withKey = harness(
      { idempotency: true },
      { status: 200, body: { result: null, changed: false } },
    );
    const prepared = (await bind(withKey.client)).prepare({
      declaration: batch,
      arguments: {},
      idempotencyKey: "same_KEY-1",
    });
    await withKey.client.invokeCallable(prepared);
    expect(withKey.posts[0]?.headers.get("idempotency-key")).toBe("same_KEY-1");

    const without = harness({}, { status: 200, body: { result: null, changed: false } });
    const binding = await bind(without.client);
    expect(binding.idempotencyAdvertised).toBe(false);
    await without.client.invokeCallable(binding.prepare({ declaration: batch, arguments: {} }));
    expect(without.posts[0]?.headers.has("idempotency-key")).toBe(false);
  });

  it("refuses before transmission what the declaration or Scope does not admit", async () => {
    const { client, posts } = harness({}, { status: 200, body: { result: null } });
    const binding = await bind(client);
    const refused = (input: Parameters<typeof binding.prepare>[0], code: string) => {
      expect(() => binding.prepare(input)).toThrow(expect.objectContaining({ code }));
    };
    refused({ declaration: batch, arguments: {}, idempotencyKey: "k" }, "unsupported-feature");
    refused({ declaration: query, arguments: {}, idempotencyKey: "k" }, "invalid-input");
    refused({ declaration: query, arguments: {}, revisionProvenance: {} }, "invalid-input");
    refused({ declaration: { ...query, name: "a//b" }, arguments: {} }, "invalid-input");
    const keyed = harness({ idempotency: true }, { status: 200, body: { result: null } });
    const under = await bind(keyed.client);
    expect(() =>
      under.prepare({ declaration: batch, arguments: {}, idempotencyKey: "not valid" }),
    ).toThrow(RetainedClientError);
    expect(posts).toEqual([]);
    expect(keyed.posts).toEqual([]);
  });

  it("refuses a Scope that does not advertise Callables1, and says so", async () => {
    const absent = harness({ callables: false }, { status: 200, body: { result: null } });
    await expect(absent.client.bindCallables(scope)).rejects.toMatchObject({
      code: "unsupported-feature",
      detail: expect.stringContaining("Callables1"),
    });
  });

  it("admits a batch on a Core Scope advertising Callables1: the capability is what counts", async () => {
    const core = harness({ profile: "core" }, { status: 200, body: { result: null } });
    const binding = await bind(core.client);
    expect(binding.prepare({ declaration: batch, arguments: {} }).kind).toBe("batch");
    expect(binding.prepare({ declaration: query, arguments: {} }).kind).toBe("query");
  });

  it.each([
    ["a query carrying changed", query, { result: 1, changed: true }],
    ["a batch without changed", batch, { result: 1 }],
    ["a missing result", query, {}],
    ["an unknown member", query, { result: 1, extra: true }],
    ["a non-boolean changed", batch, { result: 1, changed: "yes" }],
  ])(
    "treats %s as an invalid response of unknown disposition",
    async (_label, declaration, body) => {
      const { client } = harness({}, { status: 200, body });
      const prepared = (await bind(client)).prepare({ declaration, arguments: {} });
      await expect(client.invokeCallable(prepared)).rejects.toMatchObject({
        code: "invalid-response",
        submission: "unknown",
      });
    },
  );
});

describe("Problems from a mount", () => {
  const invoke = async (status: number, body: unknown, contentType?: string) => {
    const { client } = harness({}, { status, body, ...(contentType ? { contentType } : {}) });
    return client.invokeCallable(
      (await bind(client)).prepare({ declaration: batch, arguments: {} }),
    );
  };

  it("keeps a callable-error's error value intact, with the received bytes", async () => {
    const text = `{"type":"${conflict}","status":409,"code":"callable-error","retry":"after-state-change","error":{"reason":"room-taken","weight":1.5,"nested":[null,{"a":{}}]}}`;
    const reply = await invoke(409, text);
    if (reply.kind !== "problem") throw new Error("expected a Problem");
    expect(reply.problem.code).toBe("callable-error");
    expect(reply.http.status).toBe(409);
    expect(new TextDecoder().decode(reply.nativeBody)).toBe(text);
    expect(stringifyJsonValue(reply.problem.error)).toBe(
      '{"reason":"room-taken","weight":1.5,"nested":[null,{"a":{}}]}',
    );
  });

  it.each([
    [404, "callable-not-found", "not-found"],
    [503, "callable-unavailable", "unavailable"],
  ])("parses the added %i %s", async (status, code, family) => {
    const reply = await invoke(status, {
      type: `https://github.com/gastownhall/bdp/problems/${family}`,
      code,
      retry: "after-state-change",
    });
    expect(reply).toMatchObject({ kind: "problem", problem: { code } });
  });

  it("parses a standard 5xx Problem, which has no error member", async () => {
    const reply = await invoke(503, {
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    if (reply.kind !== "problem") throw new Error("expected a Problem");
    expect(reply.problem.code).toBe("temporarily-unavailable");
    expect(Object.hasOwn(reply.problem, "error")).toBe(false);
  });

  it.each([
    [
      "callable-error without error",
      409,
      { code: "callable-error", retry: "after-state-change", type: conflict },
    ],
    [
      "error on another added code",
      404,
      {
        code: "callable-not-found",
        retry: "after-state-change",
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        error: 1,
      },
    ],
    [
      "callable-error at another status",
      500,
      { code: "callable-error", retry: "after-state-change", type: conflict, error: 1 },
    ],
    [
      "the wrong family",
      409,
      {
        code: "callable-error",
        retry: "after-state-change",
        type: "https://github.com/gastownhall/bdp/problems/request",
        error: 1,
      },
    ],
    ["the wrong retry", 409, { code: "callable-error", retry: "never", type: conflict, error: 1 }],
  ])("refuses %s", async (_label, status, body) => {
    await expect(invoke(status, body)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "unknown",
    });
  });

  it("reports a non-Problem 5xx as a transport failure of unknown disposition", async () => {
    const failure = invoke(502, "<html>upstream</html>", "text/html");
    await expect(failure).rejects.toBeInstanceOf(RetainedTransportError);
    await expect(failure).rejects.toMatchObject({ submission: "unknown" });
  });
});
