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
  it.each(["Buffer", "Uint8Array"])(
    "accumulates many reused one-byte %s chunks at the exact budget",
    async (kind) => {
      const text = JSON.stringify({ value: "é".repeat(1024) });
      const encoded = new TextEncoder().encode(text);
      const chunk = kind === "Buffer" ? Buffer.alloc(1) : new Uint8Array(1);
      let index = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (index === encoded.length) {
              chunk[0] = 0;
              controller.close();
            } else {
              chunk[0] = encoded[index++]!;
              controller.enqueue(chunk);
            }
          },
        },
        { highWaterMark: 0 },
      );
      const result = await client(async () => response(stream), {
        limits: { ...limits, responseBodyBytes: encoded.length },
      }).get(target);
      expect(result).toMatchObject({ kind: "json", body: { value: "é".repeat(1024) } });
      expect(index).toBe(encoded.length);
      expect(chunk[0]).toBe(0);
    },
  );
  it("rejects the first byte beyond a non-power-of-two budget and releases the reader", async () => {
    let pulls = 0,
      cancelled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(Buffer.from("x"));
        },
        cancel() {
          cancelled++;
        },
      },
      { highWaterMark: 0 },
    );
    await expect(
      client(async () => response(stream), {
        limits: { ...limits, responseBodyBytes: 257 },
      }).get(target),
    ).rejects.toMatchObject({ code: "response-too-large", submission: "not-submitted" });
    expect(pulls).toBe(258);
    expect(cancelled).toBe(1);
    expect(stream.locked).toBe(false);
  });
  it("retains selected frozen headers on redirects and malformed challenges without following", async () => {
    for (const status of [307, 401]) {
      let calls = 0;
      const received = response("not JSON", status, {
        "content-type": "application/problem+json",
        "retry-after": "9",
        location: "https://other.test/",
        "www-authenticate": 'Bearer realm="test"',
        link: '<bdp.json>; rel="service-desc"',
        "set-cookie": "secret-cookie",
        authorization: "secret-authorization",
      });
      const transport = client(
        async () => {
          calls++;
          return received;
        },
        { credential: () => "secret-token" },
      );
      let caught: unknown;
      try {
        await transport.post(target, { bodyText: '"secret-body"', idempotencyKey: "secret-key" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ReadUpdateTransportError);
      expect(caught).toMatchObject({
        code: status === 307 ? "redirect" : "invalid-response",
        submission: "unknown",
        httpStatus: status,
        contentType: "application/problem+json",
        retryAfter: "9",
        headers: {
          location: "https://other.test/",
          "www-authenticate": 'Bearer realm="test"',
          link: '<bdp.json>; rel="service-desc"',
        },
      });
      const headers = (caught as ReadUpdateTransportError).headers;
      expect(Object.isFrozen(headers)).toBe(true);
      received.headers.set("location", "https://changed.test/");
      expect(headers?.location).toBe("https://other.test/");
      expect(JSON.stringify(caught)).not.toContain("secret");
      expect(calls).toBe(1);
    }
  });
  it("rejects unsupported media without reading and bodyless violations on their first bytes", async () => {
    for (const status of [200, 500]) {
      let pulls = 0,
        cancelled = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(Buffer.from("unexpected"));
          },
          cancel() {
            cancelled++;
          },
        },
        { highWaterMark: 0 },
      );
      await expect(
        client(
          async () => response(stream, status, { "content-type": "text/html", allow: "GET" }),
          {
            limits: { ...limits, responseBodyBytes: 1 },
          },
        ).get(target),
      ).rejects.toMatchObject({
        code: "invalid-response",
        submission: "not-submitted",
        httpStatus: status,
        headers: { allow: "GET" },
      });
      expect(pulls).toBe(status === 200 ? 0 : 1);
      expect(cancelled).toBe(1);
      expect(stream.locked).toBe(false);
    }
  });
  it("bypasses ambient caches on successive GETs with rotated credentials", async () => {
    let token = "first";
    const tokens: string[] = [];
    const transport = client(
      async (_url, init) => {
        expect(init?.cache).toBe("no-store");
        expect(init?.credentials).toBe("omit");
        tokens.push(new Headers(init?.headers).get("authorization") ?? "");
        return response();
      },
      { credential: () => token },
    );
    await transport.get(target);
    token = "second";
    await transport.get(target);
    expect(tokens).toEqual(["Bearer first", "Bearer second"]);
  });
  it("marks a dispatched GET network failure not-submitted", async () => {
    await expect(
      client(async () => {
        throw Error("foreign-secret");
      }).get(target),
    ).rejects.toMatchObject({
      code: "network",
      submission: "not-submitted",
      headers: undefined,
    });
  });
  it.each(["GET", "POST"])(
    "honors caller abort during an active %s body read and releases the reader",
    async (method) => {
      const abort = new AbortController();
      let notify!: () => void;
      const reading = new Promise<void>((resolve) => {
        notify = resolve;
      });
      let pulls = 0,
        cancelled = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (++pulls === 1) {
              controller.enqueue(Buffer.from("{"));
              return undefined;
            } else {
              notify();
              return new Promise(() => {});
            }
          },
          cancel() {
            cancelled++;
          },
        },
        { highWaterMark: 0 },
      );
      const transport = client(async () => response(stream));
      const pending =
        method === "GET"
          ? transport.get(target, { signal: abort.signal })
          : transport.post(target, { ...post, signal: abort.signal });
      const assertion = expect(pending).rejects.toMatchObject({
        code: "aborted",
        httpStatus: 200,
        submission: method === "GET" ? "not-submitted" : "unknown",
        headers: { "content-type": "application/json" },
      });
      await reading;
      abort.abort("secret-abort-reason");
      await assertion;
      expect(pulls).toBe(2);
      expect(cancelled).toBe(1);
      expect(stream.locked).toBe(false);
    },
  );
  it("discovers a human Scope representation using probe-only wildcard negotiation", async () => {
    const accepts: string[] = [];
    const transport = client(async (url, init) => {
      expect(url).toBe(scope);
      const accept = new Headers(init?.headers).get("accept") ?? "";
      accepts.push(accept);
      if (accept === "application/json") return response(null, 406, {}, scope);
      expect(accept).toBe("*/*");
      return response(
        "<html>Human-readable Scope</html>",
        200,
        {
          "content-type": "text/html",
          link: '<bdp.json>; rel="service-desc"',
        },
        scope,
      );
    });
    expect(await transport.get(scope)).toMatchObject({ kind: "empty", status: 406 });
    expect(await transport.probeScope()).toMatchObject({
      kind: "scope-probe",
      status: 200,
      contentType: "text/html",
      headers: { link: '<bdp.json>; rel="service-desc"' },
    });
    expect(accepts).toEqual(["application/json", "*/*"]);
  });

  it.each(["Buffer", "Uint8Array"])(
    "copies retained %s chunks before producer reuse",
    async (kind) => {
      const chunk =
        kind === "Buffer" ? Buffer.from('{"n":1}') : new TextEncoder().encode('{"n":1}');
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (++pulls === 1) controller.enqueue(chunk);
            else {
              chunk[5] = 50;
              controller.close();
            }
          },
        },
        { highWaterMark: 0 },
      );
      expect(await client(async () => response(stream)).post(target, post)).toMatchObject({
        kind: "json",
        body: { n: 1 },
      });
      expect(pulls).toBe(2);
      expect(chunk[5]).toBe(50);
    },
  );
  it.each(["text/html", "text/markdown", "application/json", "application/octet-stream"])(
    "probes only the configured Scope and ignores its 200 body (%s)",
    async (media) => {
      let cancelled = 0;
      let pulls = 0;
      let credentials = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulls++;
            throw Error("Scope body must not be read");
          },
          cancel() {
            cancelled++;
          },
        },
        { highWaterMark: 0 },
      );
      const transport = client(
        async (url, init) => {
          expect(url).toBe(scope);
          expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "manual" });
          expect(init?.body).toBeUndefined();
          expect(init?.headers).toEqual({
            accept: "*/*",
            authorization: "Bearer scope-token",
          });
          return response(
            stream,
            200,
            {
              "content-type": media,
              link: '<bdp.json>; rel="service-desc"',
              "retry-after": "7",
              "content-length": "999999999",
            },
            scope,
          );
        },
        {
          credential: () => {
            credentials++;
            return "scope-token";
          },
          limits: { ...limits, responseBodyBytes: 1 },
        },
      );
      const result = await transport.probeScope();
      expect(result).toMatchObject({
        kind: "scope-probe",
        status: 200,
        url: scope,
        contentType: media,
        retryAfter: "7",
        headers: { link: '<bdp.json>; rel="service-desc"' },
      });
      expect(result).not.toHaveProperty("body");
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.headers)).toBe(true);
      expect([credentials, pulls, cancelled]).toEqual([1, 0, 1]);
    },
  );
  it("accepts a bodyless 204 Scope but rejects actual bytes from an adversarial 204 Response", async () => {
    expect(await client(async () => response(null, 204, {}, scope)).probeScope()).toMatchObject({
      kind: "scope-probe",
      status: 204,
      contentType: null,
    });
    for (const text of ["", "x"]) {
      // Native Response prevents constructing a 204 body. Override only status
      // to exercise a custom Fetch response while retaining an actual byte stream.
      const received = response(text, 200, {}, scope);
      Object.defineProperty(received, "status", { value: 204 });
      const pending = client(async () => received).probeScope();
      if (text === "")
        await expect(pending).resolves.toMatchObject({ kind: "scope-probe", status: 204 });
      else
        await expect(pending).rejects.toMatchObject({
          code: "invalid-response",
          httpStatus: 204,
          submission: "not-submitted",
        });
    }
  });
  it("bounds uninterpreted Scope cancellation without waiting for physical completion", async () => {
    let cancelled = 0;
    const stream = new ReadableStream(
      {
        cancel() {
          cancelled++;
          return new Promise(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    const started = performance.now();
    expect(await client(async () => response(stream, 200, {}, scope)).probeScope()).toMatchObject({
      kind: "scope-probe",
    });
    expect(cancelled).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it("preserves the response deadline and caller cancellation during Scope probing", async () => {
    const abort = new AbortController();
    abort.abort();
    let calls = 0;
    const transport = client(async () => {
      calls++;
      return response(null, 204, {}, scope);
    });
    await expect(transport.probeScope({ signal: abort.signal })).rejects.toMatchObject({
      code: "aborted",
      submission: "not-submitted",
    });
    expect(calls).toBe(0);
    await expect(
      client(async () => new Promise(() => {}), {
        limits: { ...limits, responseTimeoutMs: 15 },
      }).probeScope(),
    ).rejects.toMatchObject({ code: "timeout", submission: "not-submitted" });
    const stream = new ReadableStream(
      { cancel: () => new Promise(() => {}) },
      { highWaterMark: 0 },
    );
    await expect(
      client(async () => response(stream, 200, {}, scope), {
        limits: { ...limits, responseTimeoutMs: 10, cleanupTimeoutMs: 20 },
      }).probeScope(),
    ).rejects.toMatchObject({ code: "timeout", httpStatus: 200, submission: "not-submitted" });
  });
  it("keeps Scope errors and native faults on normal decoding paths with actual context", async () => {
    const headers = { "content-type": "application/problem+json", "retry-after": "9" };
    expect(
      await client(async () =>
        response('{"code":"temporarily-unavailable"}', 503, headers, scope),
      ).probeScope(),
    ).toMatchObject({
      kind: "json",
      status: 503,
      contentType: headers["content-type"],
      retryAfter: "9",
      body: { code: "temporarily-unavailable" },
    });
    await expect(
      client(async () => response("not JSON", 503, headers, scope)).probeScope(),
    ).rejects.toMatchObject({ code: "invalid-response", httpStatus: 503, retryAfter: "9" });
    expect(await client(async () => response(null, 406, {}, scope)).probeScope()).toMatchObject({
      kind: "empty",
      status: 406,
    });
    await expect(
      client(async () =>
        response("landing", 307, { location: "https://evil.test/" }, scope),
      ).probeScope(),
    ).rejects.toMatchObject({
      code: "redirect",
      httpStatus: 307,
      submission: "not-submitted",
    });
  });
  it("never applies Scope body ignoring to ordinary GET or POST, including the Scope URL", async () => {
    const transport = client(async (url) =>
      response("<html>landing</html>", 200, { "content-type": "text/html" }, String(url)),
    );
    await expect(transport.get(scope)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: 200,
    });
    await expect(transport.post(scope, post)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: 200,
    });
  });
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
    ).rejects.toMatchObject({ code: "redirect", submission: "unknown", httpStatus: 307 });
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
