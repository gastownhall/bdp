import { describe, expect, it } from "vitest";
import {
  createReadUpdateFetchTransport,
  type ReadUpdateFetchTransportOptions,
  ReadUpdateTransportError,
  type ReadUpdateTransportLimits,
} from "./read-update-transport.js";

const scope = "https://example.test/acme/";
const target = `${scope}operations/create-bead`;
const limits: ReadUpdateTransportLimits = {
  requestBodyBytes: 1_048_576,
  responseBodyBytes: 1_048_576,
  responseTimeoutMs: 200,
  cleanupTimeoutMs: 10,
};
function response(
  text: ConstructorParameters<typeof Response>[0] = "{}",
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
  url = target,
): Response {
  const value = new Response(text, { status, headers });
  Object.defineProperty(value, "url", { value: url });
  return value;
}
function client(fetcher: typeof fetch, overrides: Partial<ReadUpdateFetchTransportOptions> = {}) {
  return createReadUpdateFetchTransport({
    scope,
    limits,
    fetchImplementation: fetcher,
    ...overrides,
  });
}
const post = { bodyText: "{}", idempotencyKey: "key_A-1" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Read+Update bounded transport", () => {
  it("sends original numeric/escape bytes and one exact singleton key with confined credentials", async () => {
    const text = '{"properties":{"n":9007199254740993,"x":"\\ud83d\\ude00","a":"é"}}';
    let calls = 0;
    const transport = client(
      async (url, init) => {
        calls++;
        expect(url).toBe(target);
        expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(text);
        expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "manual" });
        expect(init?.headers).toEqual({
          accept: "application/json",
          authorization: "Bearer secret",
          "content-type": "application/json",
          "idempotency-key": "Case_Sensitive",
        });
        return response();
      },
      { credential: () => "secret" },
    );
    expect(
      await transport.post(target, { bodyText: text, idempotencyKey: "Case_Sensitive" }),
    ).toMatchObject({ kind: "json", status: 200 });
    expect(calls).toBe(1);
  });
  it("keeps sequence keys in body and uses GET for Scope/directory with actual Link metadata", async () => {
    const requests: RequestInit[] = [];
    const transport = client(async (url, init) => {
      requests.push(init ?? {});
      return url === scope
        ? response(null, 204, { link: '<bdp.json>; rel="service-desc"' }, scope)
        : response("{}", 200, undefined, String(url));
    });
    expect(await transport.get(scope)).toMatchObject({
      kind: "empty",
      status: 204,
      headers: { link: '<bdp.json>; rel="service-desc"' },
    });
    await transport.get(`${scope}operations/`);
    await transport.post(`${scope}operations/sequence`, { bodyText: '{"operations":[]}' });
    expect(requests.map((r) => r.method)).toEqual(["GET", "GET", "POST"]);
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[2]?.headers).not.toHaveProperty("idempotency-key");
  });
  it.each([
    "https://evil.test/acme/x",
    "https://example.test/acme-sibling/x",
    "https://example.test/acme/../private",
    "https://user:pass@example.test/acme/x",
  ])("refuses unsafe destination before credential or fetch: %s", async (url) => {
    let calls = 0;
    const transport = client(
      async () => {
        calls++;
        return response();
      },
      {
        credential: () => {
          calls++;
          return "secret";
        },
      },
    );
    await expect(transport.post(url, post)).rejects.toMatchObject({
      code: "invalid-input",
      submission: "not-submitted",
    });
    expect(calls).toBe(0);
  });
  it.each(["", "bad key", "key\n", "key\r", "a".repeat(257), "clé", "\ud800"])(
    "refuses invalid direct keys without dispatch: %j",
    async (key) => {
      let calls = 0;
      await expect(
        client(async () => {
          calls++;
          return response();
        }).post(target, { ...post, idempotencyKey: key }),
      ).rejects.toMatchObject({ code: "invalid-input", submission: "not-submitted" });
      expect(calls).toBe(0);
    },
  );
  it("rejects unpaired raw UTF16 before encoding and measures request UTF8 octets", async () => {
    let calls = 0;
    const transport = client(
      async () => {
        calls++;
        return response();
      },
      { limits: { ...limits, requestBodyBytes: 4 } },
    );
    await expect(transport.post(target, { bodyText: '"\ud800"' })).rejects.toMatchObject({
      code: "invalid-input",
      submission: "not-submitted",
    });
    await transport.post(target, { bodyText: '"é"' });
    await expect(transport.post(target, { bodyText: '"éé"' })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(calls).toBe(1);
  });
  it("captures per-call inputs and factory limits/provider before an async credential await", async () => {
    let release!: (token: string) => void;
    const mutableLimits = { ...limits };
    const options = {
      scope,
      limits: mutableLimits,
      credential: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      fetchImplementation: async (_url: unknown, init?: RequestInit) => {
        expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('{"n":1}');
        expect(init?.headers).toHaveProperty("idempotency-key", "original");
        return response();
      },
    };
    const transport = createReadUpdateFetchTransport(options);
    const input = { bodyText: '{"n":1}', idempotencyKey: "original" };
    const result = transport.post(target, input);
    input.bodyText = "changed";
    input.idempotencyKey = "changed";
    mutableLimits.responseBodyBytes = 1;
    options.credential = () => Promise.resolve("different");
    await tick();
    release("first");
    await expect(result).resolves.toMatchObject({ kind: "json" });
  });
  it("supports credential rotation without retries or ambient cookies", async () => {
    let current = "first";
    const tokens: string[] = [];
    const transport = client(
      async (_url, init) => {
        tokens.push(((init?.headers ?? {}) as Record<string, string>).authorization ?? "");
        return response();
      },
      { credential: () => current },
    );
    await transport.post(target, post);
    current = "second";
    await transport.post(target, post);
    expect(tokens).toEqual(["Bearer first", "Bearer second"]);
  });
  it.each(["token\n", "bad token", "", "é"])(
    "refuses invalid credential without dispatch: %j",
    async (token) => {
      let calls = 0;
      await expect(
        client(
          async () => {
            calls++;
            return response();
          },
          { credential: () => token },
        ).post(target, post),
      ).rejects.toMatchObject({ code: "invalid-input", submission: "not-submitted" });
      expect(calls).toBe(0);
    },
  );
  it.each([406, 500])(
    "returns actual native bodyless HTTP%s without manufacturing a Problem",
    async (status) => {
      const result = await client(async () => response(null, status, { "retry-after": "7" })).post(
        target,
        post,
      );
      expect(result).toMatchObject({ kind: "empty", status, retryAfter: "7" });
      expect(result).not.toHaveProperty("problem");
      expect(result).not.toHaveProperty("body");
      await expect(
        client(async () => response("{}", status)).post(target, post),
      ).rejects.toMatchObject({
        code: "invalid-response",
        submission: "unknown",
        httpStatus: status,
      });
    },
  );
  it("preserves direct problem JSON/media parameters/status/Retry-After, but no cookies", async () => {
    const result = await client(async () =>
      response('{"code":"idempotency-in-progress","retry":"after-delay"}', 409, {
        "content-type": "Application/Problem+JSON; charset=utf-8",
        "retry-after": "Thu, 10 Sep 2026 19:00:00 GMT",
        "cache-control": "private, no-store",
        "set-cookie": "secretCookie",
        authorization: "secret",
      }),
    ).post(target, post);
    expect(result).toMatchObject({
      kind: "json",
      status: 409,
      contentType: "Application/Problem+JSON; charset=utf-8",
      retryAfter: "Thu, 10 Sep 2026 19:00:00 GMT",
    });
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(result.headers).not.toHaveProperty("authorization");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.headers)).toBe(true);
  });
  it.each([
    '{"a":1,"\\u0061":2}',
    '{"a":"\\ud800"}',
    '{"\\udc00":0}',
    '{"n":9007199254740993}',
    '{"n":1e999}',
    '{"n":1e-999}',
    '{"n":0.10000000000000000555}',
    "{",
    "",
  ])("rejects malformed or lossy response %s", async (body) => {
    await expect(client(async () => response(body)).post(target, post)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "unknown",
      httpStatus: 200,
    });
  });
  it("accepts scalar, exact numeric and deep immutable responses without a hidden128 cap", async () => {
    const depth = 9000;
    const raw = `${'[{"v":'.repeat(depth)}1.0${"}]".repeat(depth)}`;
    const result = await client(async () => response(raw)).post(target, post);
    expect(result.kind).toBe("json");
    if (result.kind !== "json") throw Error("expected JSON");
    let value = result.body as unknown;
    for (let n = 0; n < depth; n++) {
      expect(Object.isFrozen(value)).toBe(true);
      value = (value as { v: unknown }[])[0]?.v;
    }
    expect(value).toBe(1);
    const scalar = await client(async () => response('{"😀":[0,-0.0,1e300,"é"]}')).post(
      target,
      post,
    );
    expect(scalar.kind).toBe("json");
  });
  it("rejects fatal UTF8 and wrong media without leaking response/request details", async () => {
    for (const res of [
      response(new Uint8Array([0xff])),
      response("secretBody", 200, { "content-type": "text/html" }),
    ]) {
      try {
        await client(async () => res, { credential: () => "secretToken" }).post(target, {
          bodyText: '"secretRequest"',
          idempotencyKey: "secretKey",
        });
        throw Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ReadUpdateTransportError);
        expect(JSON.stringify(error) + String(error)).not.toMatch(/secret/);
      }
    }
  });
  it("does not follow redirects, cancels their bodies and never retries", async () => {
    let calls = 0,
      cancelled = 0;
    const stream = new ReadableStream({
      cancel() {
        cancelled++;
      },
    });
    await expect(
      client(async () => {
        calls++;
        return response(stream, 307, { location: "https://evil.test/" });
      }).post(target, post),
    ).rejects.toMatchObject({ code: "invalid-response", submission: "unknown", httpStatus: 307 });
    expect(calls).toBe(1);
    expect(cancelled).toBe(1);
  });
  it("rejects a changed response URL and sanitizes fetch/credential failures", async () => {
    await expect(
      client(async () => response("{}", 200, undefined, "https://evil.test/")).post(target, post),
    ).rejects.toMatchObject({ code: "invalid-response", submission: "unknown" });
    for (const phase of ["credential", "fetch"]) {
      const transport = client(
        async () => {
          throw Error("secretKey secretBody secretToken");
        },
        phase === "credential"
          ? {
              credential: () => {
                throw Error("secretToken");
              },
            }
          : {},
      );
      try {
        await transport.post(target, post);
        throw Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ReadUpdateTransportError);
        expect(JSON.stringify(error) + String(error)).not.toMatch(/secret/);
        expect((error as ReadUpdateTransportError).submission).toBe(
          phase === "credential" ? "not-submitted" : "unknown",
        );
      }
    }
  });
  it("measures chunk bytes independently of Content-Length and cancels an oversized body", async () => {
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('"éé"'));
      },
      cancel() {
        cancelled++;
      },
    });
    await expect(
      client(
        async () =>
          response(stream, 200, { "content-type": "application/json", "content-length": "1" }),
        { limits: { ...limits, responseBodyBytes: 5 } },
      ).post(target, post),
    ).rejects.toMatchObject({ code: "response-too-large", submission: "unknown" });
    expect(cancelled).toBe(1);
  });
  it("refuses preaborted calls without credential/fetch and marks post-dispatch abort uncertain", async () => {
    let calls = 0;
    const before = new AbortController();
    before.abort("secretReason");
    await expect(
      client(async () => {
        calls++;
        return response();
      }).post(target, { ...post, signal: before.signal }),
    ).rejects.toMatchObject({ code: "aborted", submission: "not-submitted" });
    expect(calls).toBe(0);
    const after = new AbortController();
    const pending = client(async () => {
      calls++;
      after.abort("secretReason");
      return new Promise<Response>(() => {});
    }).post(target, { ...post, signal: after.signal });
    await expect(pending).rejects.toMatchObject({ code: "aborted", submission: "unknown" });
    expect(calls).toBe(1);
  });
  it("bounds an uncooperative credential and an uncooperative Fetch independently of their signals", async () => {
    const short = { ...limits, responseTimeoutMs: 15 };
    let calls = 0;
    await expect(
      client(
        async () => {
          calls++;
          return response();
        },
        { limits: short, credential: () => new Promise(() => {}) },
      ).post(target, post),
    ).rejects.toMatchObject({ code: "timeout", submission: "not-submitted" });
    expect(calls).toBe(0);
    await expect(
      client(
        async () => {
          calls++;
          return new Promise(() => {});
        },
        { limits: short },
      ).post(target, post),
    ).rejects.toMatchObject({ code: "timeout", submission: "unknown" });
    expect(calls).toBe(1);
  });
  it("cancels a late Fetch response after timeout and observes bounded cleanup", async () => {
    let release!: (r: Response) => void;
    let cancelled = 0;
    const transport = client(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      { limits: { ...limits, responseTimeoutMs: 15 } },
    );
    await expect(transport.post(target, post)).rejects.toMatchObject({
      code: "timeout",
      submission: "unknown",
    });
    release(
      response(
        new ReadableStream({
          cancel() {
            cancelled++;
            return new Promise(() => {});
          },
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cancelled).toBe(1);
  });
  it("bounds a hung stream read and hung cancellation then releases its reader lock", async () => {
    let cancelled = 0;
    const stream = new ReadableStream({
      cancel() {
        cancelled++;
        return new Promise(() => {});
      },
    });
    await expect(
      client(async () => response(stream), { limits: { ...limits, responseTimeoutMs: 15 } }).post(
        target,
        post,
      ),
    ).rejects.toMatchObject({ code: "timeout", submission: "unknown" });
    expect(cancelled).toBeGreaterThanOrEqual(1);
    expect(stream.locked).toBe(false);
  });
  it("sanitizes external errors even if they impersonate the exported local error class", async () => {
    const hostile = Object.assign(new ReadUpdateTransportError("network", "unknown"), {
      secret: "secretKey secretBody secretToken",
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(hostile);
      },
    });
    try {
      await client(async () => response(stream)).post(target, post);
      throw Error("expected failure");
    } catch (failure) {
      expect(failure).toBeInstanceOf(ReadUpdateTransportError);
      expect(failure).not.toBe(hostile);
      expect(JSON.stringify(failure) + String(failure)).not.toContain("secret");
    }
  });
  it("sanitizes a throwing configuration accessor", () => {
    try {
      createReadUpdateFetchTransport({
        scope,
        get limits(): ReadUpdateTransportLimits {
          throw Error("secretToken");
        },
      });
      throw Error("expected failure");
    } catch (failure) {
      expect(failure).toBeInstanceOf(ReadUpdateTransportError);
      expect(JSON.stringify(failure) + String(failure)).not.toContain("secret");
    }
  });
  it("retains actual response media and Retry-After on a malformed response", async () => {
    await expect(
      client(async () =>
        response("not JSON", 503, {
          "content-type": "application/problem+json; charset=utf-8",
          "retry-after": "17",
        }),
      ).post(target, post),
    ).rejects.toMatchObject({
      code: "invalid-response",
      submission: "unknown",
      httpStatus: 503,
      contentType: "application/problem+json; charset=utf-8",
      retryAfter: "17",
    });
  });
  it("honors the deadline even when empty-chunk microtasks starve the timer", async () => {
    let pulls = 0,
      cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled++;
      },
    });
    const started = performance.now();
    await expect(
      client(async () => response(stream), {
        limits: { ...limits, responseTimeoutMs: 15 },
      }).post(target, post),
    ).rejects.toMatchObject({ code: "timeout", submission: "unknown" });
    expect(pulls).toBeGreaterThan(1);
    expect(cancelled).toBe(1);
    expect(stream.locked).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "requires explicit finite positive safe budgets: %s",
    (value) => {
      expect(() =>
        client(async () => response(), { limits: { ...limits, responseBodyBytes: value } }),
      ).toThrow(ReadUpdateTransportError);
    },
  );
  it("rejects missing budgets and overflowing timers", () => {
    expect(() =>
      createReadUpdateFetchTransport({ scope } as ReadUpdateFetchTransportOptions),
    ).toThrow(ReadUpdateTransportError);
    expect(() =>
      client(async () => response(), { limits: { ...limits, responseTimeoutMs: 2_147_483_648 } }),
    ).toThrow(ReadUpdateTransportError);
  });
});
