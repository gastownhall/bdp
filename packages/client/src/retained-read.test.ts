import { describe, expect, it } from "vitest";
import { RetainedWriteBinding } from "./retained-write.js";
import { RetainedClient, RetainedClientError } from "./retained-read.js";
import {
  createRetainedFetchTransport,
  RetainedTransportError,
  type RetainedFetchTransportOptions,
} from "./retained-transport.js";

const media = "application/vnd.bdp.v0.1+json";
const scope = "https://records.example/work/";
const resource = `${scope}note@literal`;
const description = "https://navigation.example/contract?literal=%2B%2f";
// Core fixes every operation at <scope>/bdp/operations/NAME; there is no directory.
const directory = {
  createBead: `${scope}bdp/operations/createBead`,
  updateBead: `${scope}bdp/operations/updateBead`,
  deleteBead: `${scope}bdp/operations/deleteBead`,
  createLink: `${scope}bdp/operations/createLink`,
  updateLink: `${scope}bdp/operations/updateLink`,
  deleteLink: `${scope}bdp/operations/deleteLink`,
  putAlias: `${scope}bdp/operations/putAlias`,
  deleteAlias: `${scope}bdp/operations/deleteAlias`,
};
const record = {
  id: resource,
  type: { uri: "https://types.example/note", revision: "+ /@=exact" },
  revision: "opaque + /@=",
  properties: { id: "literal", source: null, items: [], next: "literal" },
  metadata: {},
};
const linkHeader = `<${description}>; rel="service-desc"; type="application/vnd.bdp.v0.1+json"`;
const limits = {
  requestBodyBytes: 65536,
  responseBodyBytes: 65536,
  responseTimeoutMs: 1000,
  cleanupTimeoutMs: 10,
};
function discovery(profile: "core" | "write" = "core") {
  return {
    bdpVersion: "0.1",
    profile,
    scope,
    specRevision: "0123456789abcdef0123456789abcdef01234567",
    ...(profile === "write" ? { aliases: `${scope}names/` } : {}),
  };
}
function response(
  url: string,
  value: unknown,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  const body =
    value === null || status === 204 || status === 304
      ? null
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const result = new Response(body, {
    status,
    headers: {
      ...([405, 406, 412, 500].includes(status) ? {} : { "content-type": media }),
      "cache-control": "private, no-store",
      ...headers,
    },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function client(
  fetcher: typeof fetch,
  options: Partial<RetainedFetchTransportOptions> = {},
  timeout = 1000,
) {
  return new RetainedClient({
    transport: createRetainedFetchTransport({
      limits,
      allowTarget: () => true,
      fetchImplementation: fetcher,
      ...options,
    }),
    maximumDocumentBytes: 65536,
    maximumRequestBodyBytes: 65536,
    operationTimeoutMs: timeout,
  });
}
function pointFetcher(
  profile: "core" | "write" = "core",
  change: Record<string, string> = {},
  value: unknown = record,
  status = 200,
): typeof fetch {
  return async (input) => {
    const url = String(input);
    return url === description
      ? response(url, discovery(profile))
      : response(
          url,
          value,
          { "bdp-resource-kind": "bead", link: linkHeader, etag: '"native-etag"', ...change },
          status,
        );
  };
}

describe("retained client current point reads", () => {
  it("retains full native Resource bytes without a DTO or JSON serialization step", async () => {
    const text =
      ' { "id":"https://records.example/work/note@literal", "type":{"uri":"https://types.example/note","revision":"+ /@=exact"}, "revision":"opaque + /@=", "properties":{"n":1.00}, "metadata":{} }\n';
    const bytes = new TextEncoder().encode(text);
    const result = await client(async (input) =>
      String(input) === description
        ? response(description, discovery())
        : response(String(input), text, {
            "bdp-resource-kind": "bead",
            link: linkHeader,
            "content-length": String(bytes.byteLength),
            etag: '"full-native-etag"',
          }),
    ).read({ reference: resource });
    expect(result).toMatchObject({
      kind: "success",
      value: {
        resourceKind: "bead",
        scope,
        body: {
          type: { uri: "https://types.example/note", revision: "+ /@=exact" },
          properties: { n: 1 },
          metadata: {},
        },
      },
    });
    if (result.kind !== "success") throw Error("missing full Resource result");
    expect(result.nativeBody).toEqual(bytes);
    expect(result.http.headers["content-length"]).toBe(String(result.nativeBody!.byteLength));
  });
  it.each(["plain", "bom"] as const)(
    "retains original %s UTF-8 bytes alongside parsed properties",
    async (prefix) => {
      const text = `${prefix === "bom" ? "\uFEFF" : ""} { "n":1.00, "literal":"é", "items":[], "next":null }\n`;
      const expected = new TextEncoder().encode(text);
      const result = await client(async (input) =>
        String(input) === description
          ? response(description, discovery())
          : response(String(input), text, {
              "bdp-resource-kind": "bead",
              link: linkHeader,
              "content-length": String(expected.byteLength),
              etag: '"received-native-etag"',
            }),
      ).read({ reference: resource, view: "properties" });
      expect(result).toMatchObject({
        kind: "success",
        value: { body: { n: 1, literal: "é", items: [], next: null } },
        http: {
          headers: {
            "content-length": String(expected.byteLength),
            etag: '"received-native-etag"',
          },
        },
      });
      if (result.kind !== "success") throw Error("missing native properties result");
      expect(result.nativeBody).toEqual(expected);
      expect(result.nativeBody).not.toEqual(
        new TextEncoder().encode(JSON.stringify(result.value.body)),
      );
    },
  );
  it("retains original native Problem bytes and matching representation headers", async () => {
    const text =
      ' { "type":"https://github.com/gastownhall/bdp/problems/not-found", "code":"resource-not-found", "retry":"after-state-change", "extension":1.00 }\n';
    const bytes = new TextEncoder().encode(text);
    const result = await client(async (input) =>
      response(
        String(input),
        text,
        { "content-type": "application/problem+json", "content-length": String(bytes.byteLength) },
        404,
      ),
    ).read({ reference: resource });
    expect(result).toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found", extension: 1 },
      http: { status: 404, headers: { "content-length": String(bytes.byteLength) } },
    });
    if (result.kind !== "problem") throw Error("missing native Problem");
    expect(result.nativeBody).toEqual(bytes);
  });
  it.each(["core", "write"] as const)(
    "reads a literal absolute @ URL under %s discovery",
    async (profile) => {
      const observed: string[] = [];
      const fetcher = pointFetcher(profile);
      const result = await client(async (input, init) => {
        observed.push(String(input));
        return fetcher(input, init);
      }).read({ reference: resource });
      expect(observed).toEqual([
        "https://records.example/work/note@literal",
        "https://navigation.example/contract?literal=%2B%2f",
      ]);
      expect(result).toMatchObject({
        kind: "success",
        value: { resourceKind: "bead", scope, representation: "resource", body: record },
      });
    },
  );
  it("uses the actual properties view without fetching a full record", async () => {
    const seen: string[] = [];
    const result = await client(async (input) => {
      const url = String(input);
      seen.push(url);
      return url === description
        ? response(url, discovery())
        : response(url, record.properties, { "bdp-resource-kind": "link", link: linkHeader });
    }).read({ reference: resource, view: "properties", expectedKind: "link" });
    expect(seen).toEqual([`${resource}?view=properties`, description]);
    expect(result).toMatchObject({
      kind: "success",
      value: { resourceKind: "link", body: record.properties },
    });
  });
  it.each([
    ["missing-kind", { "bdp-resource-kind": "" }],
    ["kind-list", { "bdp-resource-kind": "bead, link" }],
    ["capital-kind", { "bdp-resource-kind": "Bead" }],
    ["missing-owner", { link: "" }],
    [
      "ambiguous-owner",
      { link: `${linkHeader}, <https://other.example/contract>; rel="service-desc"` },
    ],
    ["old-media", { "content-type": "application/json" }],
  ])("refuses %s before successful delivery", async (_label, headers) => {
    await expect(
      client(pointFetcher("core", headers)).read({ reference: resource }),
    ).rejects.toThrow();
  });
  it("checks asserted kind without deriving it from the path or body", async () => {
    await expect(
      client(pointFetcher()).read({ reference: resource, expectedKind: "link" }),
    ).rejects.toBeInstanceOf(RetainedClientError);
  });
  it("refuses an unrelated explicit Scope without falling back to that Scope", async () => {
    const seen: string[] = [];
    const fetcher = pointFetcher();
    await expect(
      client(async (input, init) => {
        seen.push(String(input));
        return fetcher(input, init);
      }).read({ reference: resource, scope: "https://unrelated.example/" }),
    ).rejects.toThrow();
    expect(seen).toEqual([resource, description]);
  });
  it("preserves successful HEAD metadata without inventing a body", async () => {
    const seen: { url: string; method: string }[] = [];
    const result = await client(async (input, init) => {
      const url = String(input);
      seen.push({ url, method: init?.method ?? "GET" });
      return url === description
        ? response(url, discovery())
        : response(url, null, { "bdp-resource-kind": "bead", link: linkHeader });
    }).read({ reference: resource, method: "HEAD" });
    expect(result).toMatchObject({
      kind: "success",
      http: { status: 200 },
      value: { resourceKind: "bead" },
    });
    if (result.kind === "success") expect(Object.hasOwn(result.value, "body")).toBe(false);
    expect(Object.hasOwn(result, "nativeBody")).toBe(false);
    expect(seen).toEqual([
      { url: resource, method: "HEAD" },
      { url: description, method: "GET" },
    ]);
  });
  it("passes native conditional validators and preserves bodyless 304", async () => {
    let headers: Headers | undefined;
    const fetcher = pointFetcher("core", {}, null, 304);
    const result = await client(async (input, init) => {
      if (String(input) === resource) headers = new Headers(init?.headers);
      return fetcher(input, init);
    }).read({ reference: resource, ifNoneMatch: 'W/"supplied-native-validator"' });
    expect(headers?.get("if-none-match")).toBe('W/"supplied-native-validator"');
    expect(result).toMatchObject({ kind: "success", http: { status: 304 } });
    if (result.kind === "success") expect(result.value.body).toBeUndefined();
    expect(Object.hasOwn(result, "nativeBody")).toBe(false);
  });
  it.each([406, 412, 500])(
    "preserves native bodyless HTTP %s without a synthetic Problem",
    async (status) => {
      const result = await client(async (input) => response(String(input), null, {}, status)).read({
        reference: resource,
      });
      expect(result).toMatchObject({ kind: "http", http: { status } });
      expect(Object.hasOwn(result, "problem")).toBe(false);
      expect(Object.hasOwn(result, "nativeBody")).toBe(false);
    },
  );
  it("returns a native Problem without configured/local fallback", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
    };
    const result = await client(async (input) =>
      response(String(input), problem, { "content-type": "application/problem+json" }, 404),
    ).read({ reference: resource });
    expect(result).toMatchObject({ kind: "problem", problem });
  });
  it("refuses a pinned/History intent before network rather than substituting current", () => {
    let calls = 0;
    expect(() =>
      client(async () => {
        calls++;
        throw Error();
      }).read({ reference: { uri: resource, revision: "literal + /@=" } }),
    ).toThrow();
    expect(calls).toBe(0);
  });
  it("does not dispatch a pre-aborted read", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(
      client(async () => {
        calls++;
        throw Error();
      }).read({ reference: resource, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted", submission: "not-submitted" });
    expect(calls).toBe(0);
  });
  it("applies the operation deadline to credential acquisition before fetch", async () => {
    let calls = 0;
    let credentialSignal: AbortSignal | undefined;
    const selected = client(
      async () => {
        calls++;
        throw Error();
      },
      {
        credentialForTarget: (_url, signal) => {
          credentialSignal = signal;
          return new Promise(() => {});
        },
      },
      15,
    );
    await expect(selected.read({ reference: resource })).rejects.toMatchObject({
      code: "timeout",
      submission: "not-submitted",
    });
    expect(credentialSignal?.aborted).toBe(true);
    expect(calls).toBe(0);
  });
  it("preserves the first client operation timeout when its caller aborts during late-body settlement", async () => {
    const caller = new AbortController();
    let cancelling!: () => void, release!: () => void;
    const cancellationStarted = new Promise<void>((resolve) => {
      cancelling = resolve;
    });
    const cancellationReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    let transportSignal: AbortSignal | null | undefined;
    const received = new Response(
      new ReadableStream({
        cancel() {
          cancelling();
          return cancellationReleased;
        },
      }),
      { headers: { "content-type": media } },
    );
    Object.defineProperty(received, "url", { value: resource });
    const selected = client(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          transportSignal = init?.signal;
          init!.signal!.addEventListener("abort", () => resolve(received), { once: true });
        }),
      { limits: { ...limits, responseTimeoutMs: 1000, cleanupTimeoutMs: 200 } },
      15,
    );
    const pending = selected
      .read({ reference: resource, signal: caller.signal })
      .catch((error: unknown) => error);
    try {
      await Promise.race([
        cancellationStarted,
        pending.then(() => {
          throw Error("read returned before late cancellation began");
        }),
      ]);
      expect(transportSignal?.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
      caller.abort("later caller reason");
    } finally {
      release();
    }
    const error = await pending;
    expect(error).toBeInstanceOf(RetainedTransportError);
    expect(error).toMatchObject({
      code: "timeout",
      submission: "not-submitted",
      abortSettlement: { status: "settled", bodyCancellation: "completed" },
    });
    expect(JSON.stringify(error)).not.toContain("later caller reason");
  });
});

describe("retained transport and native Write delivery", () => {
  it.each(["GET", "POST"] as const)(
    "observes late-response cancellation before returning %s abort",
    async (method) => {
      const controller = new AbortController();
      let fetched!: () => void, cancelling!: () => void, release!: () => void;
      const dispatched = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      const cancellationStarted = new Promise<void>((resolve) => {
        cancelling = resolve;
      });
      const cancellationReleased = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          cancelling();
          return cancellationReleased;
        },
      });
      const received = new Response(stream, { headers: { "content-type": media } });
      Object.defineProperty(received, "url", { value: resource });
      const transport = createRetainedFetchTransport({
        limits: { ...limits, cleanupTimeoutMs: 200 },
        allowTarget: () => true,
        fetchImplementation: (_input, init) =>
          new Promise<Response>((resolve) => {
            init!.signal!.addEventListener("abort", () => resolve(received), { once: true });
            fetched();
          }),
      });
      let returned = false;
      const operation =
        method === "GET"
          ? transport.get(resource, { signal: controller.signal })
          : transport.post(resource, {
              signal: controller.signal,
              bodyText: "{}",
              idempotencyKey: "saved",
            });
      const pending = operation.then(
        (value) => {
          returned = true;
          return value;
        },
        (error: unknown) => {
          returned = true;
          return error;
        },
      );
      try {
        await Promise.race([
          dispatched,
          pending.then(() => {
            throw Error("operation returned without dispatch");
          }),
        ]);
        controller.abort("secret reason");
        await Promise.race([
          cancellationStarted,
          pending.then(() => {
            throw Error("operation returned before late cancellation began");
          }),
        ]);
        await Promise.resolve();
        expect(returned).toBe(false);
      } finally {
        release();
      }
      const error = await pending;
      expect(error).toBeInstanceOf(RetainedTransportError);
      expect(error).toMatchObject({
        code: "aborted",
        submission: method === "POST" ? "unknown" : "not-submitted",
        abortSettlement: { status: "settled", bodyCancellation: "completed" },
      });
      expect(Object.isFrozen((error as RetainedTransportError).abortSettlement)).toBe(true);
      expect(JSON.stringify(error)).not.toContain("secret reason");
      expect(stream.locked).toBe(false);
    },
  );
  it("reports the cap when a late response body refuses to settle within its finite window", async () => {
    const controller = new AbortController();
    let fetched!: () => void, release!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    const cancellation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Response(
      new ReadableStream({
        cancel() {
          return cancellation;
        },
      }),
      { headers: { "content-type": media } },
    );
    Object.defineProperty(received, "url", { value: resource });
    const transport = createRetainedFetchTransport({
      limits: { ...limits, cleanupTimeoutMs: 10 },
      allowTarget: () => true,
      fetchImplementation: (_input, init) =>
        new Promise<Response>((resolve) => {
          init!.signal!.addEventListener("abort", () => resolve(received), { once: true });
          fetched();
        }),
    });
    const pending = transport
      .get(resource, { signal: controller.signal })
      .catch((error: unknown) => error);
    try {
      await dispatched;
      controller.abort();
      const error = await pending;
      expect(error).toMatchObject({
        code: "aborted",
        submission: "not-submitted",
        abortSettlement: { status: "cap-exceeded", bodyCancellation: "pending" },
      });
    } finally {
      release();
      await Promise.resolve();
    }
  });
  it("reports an uncooperative fetch cap and attempts cancellation if a response arrives later", async () => {
    const controller = new AbortController();
    let fetched!: () => void, release!: (response: Response) => void, cancelled!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const transport = createRetainedFetchTransport({
      limits: { ...limits, cleanupTimeoutMs: 10 },
      allowTarget: () => true,
      fetchImplementation: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
          fetched();
        }),
    });
    const pending = transport
      .get(resource, { signal: controller.signal })
      .catch((error: unknown) => error);
    const received = new Response(
      new ReadableStream({
        cancel() {
          cancelled();
        },
      }),
      { headers: { "content-type": media } },
    );
    Object.defineProperty(received, "url", { value: resource });
    let error: unknown;
    try {
      await dispatched;
      controller.abort();
      error = await pending;
      expect(error).toMatchObject({
        code: "aborted",
        submission: "not-submitted",
        abortSettlement: { status: "cap-exceeded", bodyCancellation: "not-acquired" },
      });
    } finally {
      release(received);
      await cancellation;
    }
    expect((error as RetainedTransportError).abortSettlement).toEqual({
      status: "cap-exceeded",
      bodyCancellation: "not-acquired",
    });
  });
  it("preserves the original deadline diagnosis while settlement observes a later caller abort", async () => {
    const controller = new AbortController();
    let cancelling!: () => void, release!: () => void;
    const cancellationStarted = new Promise<void>((resolve) => {
      cancelling = resolve;
    });
    const cancellationReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Response(
      new ReadableStream({
        cancel() {
          cancelling();
          return cancellationReleased;
        },
      }),
      { headers: { "content-type": media } },
    );
    Object.defineProperty(received, "url", { value: resource });
    const transport = createRetainedFetchTransport({
      limits: { ...limits, responseTimeoutMs: 15, cleanupTimeoutMs: 200 },
      allowTarget: () => true,
      fetchImplementation: (_input, init) =>
        new Promise<Response>((resolve) => {
          init!.signal!.addEventListener("abort", () => resolve(received), { once: true });
        }),
    });
    const pending = transport
      .post(resource, { signal: controller.signal, bodyText: "{}", idempotencyKey: "saved" })
      .catch((error: unknown) => error);
    try {
      await cancellationStarted;
      controller.abort();
    } finally {
      release();
    }
    expect(await pending).toMatchObject({
      code: "timeout",
      submission: "unknown",
      abortSettlement: { status: "settled", bodyCancellation: "completed" },
    });
  });
  it("distinguishes a rejected late body-cancel attempt from completed cleanup", async () => {
    const controller = new AbortController();
    let fetched!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    const received = new Response(
      new ReadableStream({
        cancel() {
          return Promise.reject(Error("secret cleanup cause"));
        },
      }),
      { headers: { "content-type": media } },
    );
    Object.defineProperty(received, "url", { value: resource });
    const transport = createRetainedFetchTransport({
      limits,
      allowTarget: () => true,
      fetchImplementation: (_input, init) =>
        new Promise<Response>((resolve) => {
          init!.signal!.addEventListener("abort", () => resolve(received), { once: true });
          fetched();
        }),
    });
    const pending = transport
      .get(resource, { signal: controller.signal })
      .catch((error: unknown) => error);
    await dispatched;
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({
      code: "aborted",
      abortSettlement: { status: "settled", bodyCancellation: "failed" },
    });
    expect(JSON.stringify(error)).not.toContain("secret cleanup cause");
  });
  it("refuses Write on a Core-only discovery without guessing an operations path", async () => {
    const seen: string[] = [];
    const selected = client(async (input) => {
      const url = String(input);
      seen.push(url);
      return url === scope
        ? response(url, null, { link: linkHeader }, 204)
        : response(url, discovery());
    });
    await expect(selected.bindWrite(scope)).rejects.toMatchObject({ code: "unsupported-feature" });
    expect(seen).toEqual([scope, description]);
  });
  it("names a discovery that still carries a retired navigation member, and sends nothing more", async () => {
    for (const retired of [
      { operations: `${scope}bdp/operations` },
      { events: `${scope}bdp/events` },
    ]) {
      const seen: string[] = [];
      const selected = client(async (input) => {
        const url = String(input);
        seen.push(url);
        if (url === scope) return response(url, null, { link: linkHeader }, 204);
        return response(url, { ...discovery("write"), ...retired });
      });
      // Closed discovery refuses the retired member before anything is bound or sent.
      await expect(selected.bindWrite(scope)).rejects.toMatchObject({
        code: "invalid-response",
        submission: "not-submitted",
        detail: "invalid retained v0.1 retainedDiscovery",
      });
      expect(seen).toEqual([scope, description]);
    }
  });
  it("uses one target-aware credential policy for irregular discovery and saved delivery", async () => {
    const seen: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string | undefined;
    }[] = [];
    const credentialTargets: string[] = [];
    let token = "first-token";
    const text =
      ' { "id":"note@literal", "type":"https://types.example/note", "properties":{"n":1.00} }\n';
    const success = {
      outcome: "created",
      changed: true,
      resource: { ...record, type: "https://types.example/note", properties: { n: 1 } },
    };
    const selected = client(
      async (input, init) => {
        const url = String(input),
          headers = Object.fromEntries(new Headers(init?.headers));
        seen.push({
          url,
          method: init?.method ?? "GET",
          headers,
          body: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : undefined,
        });
        if (url === scope) return response(url, null, { link: linkHeader }, 204);
        if (url === description) return response(url, discovery("write"));
        return response(url, success);
      },
      {
        credentialForTarget: (url) => {
          credentialTargets.push(url);
          return url.startsWith(`${scope}bdp/operations/`) ? token : undefined;
        },
      },
    );
    const bound = await selected.bindWrite(scope);
    expect(bound.kind).toBe("success");
    if (bound.kind !== "success") throw Error("missing Write binding");
    const prepared = bound.value.prepare("createBead", text, "original-key");
    expect(await selected.submit(prepared)).toMatchObject({ kind: "success", value: success });
    token = "rotated-token";
    expect(await selected.submit(prepared)).toMatchObject({ kind: "success", value: success });
    // Discovery alone binds Write: no directory is requested.
    expect(credentialTargets).toEqual([
      scope,
      description,
      directory.createBead,
      directory.createBead,
    ]);
    expect(
      seen.slice(-2).map(({ url, method, body, headers }) => ({
        url,
        method,
        body,
        media: headers["content-type"],
        key: headers["idempotency-key"],
        auth: headers.authorization,
      })),
    ).toEqual(
      ["first-token", "rotated-token"].map((value) => ({
        url: directory.createBead,
        method: "POST",
        body: text,
        media: "application/vnd.bdp.v0.1+json",
        key: "original-key",
        auth: `Bearer ${value}`,
      })),
    );
    expect(seen.slice(0, 2).every((x) => x.headers.authorization === undefined)).toBe(true);
  });
  it("delivers the exact native retained conflict through the client", async () => {
    const binding = new RetainedWriteBinding({
      scope,
      maximumDocumentBytes: 65536,
      maximumRequestBodyBytes: 65536,
      discovery: { contentType: media, bodyText: JSON.stringify(discovery("write")) },
    });
    const prepared = binding.prepare(
      "createBead",
      '{"type":"https://types.example/note"}',
      "saved-key",
    );
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "idempotency-conflict",
      retry: "never",
    };
    const result = await client(async (input) =>
      response(String(input), problem, { "content-type": "application/problem+json" }, 409),
    ).submit(prepared);
    expect(result).toMatchObject({ kind: "problem", problem, http: { status: 409 } });
    expect(Object.hasOwn(result, "value")).toBe(false);
  });
  it("checks target policy before credentials or network", async () => {
    let credentials = 0,
      fetched = 0;
    const transport = createRetainedFetchTransport({
      limits,
      allowTarget: () => false,
      credentialForTarget: () => {
        credentials++;
        return "token";
      },
      fetchImplementation: async () => {
        fetched++;
        throw Error();
      },
    });
    await expect(transport.get(resource)).rejects.toMatchObject({
      code: "invalid-input",
      submission: "not-submitted",
    });
    expect(credentials).toBe(0);
    expect(fetched).toBe(0);
  });
  it("rejects header injection before credential acquisition or fetch", async () => {
    let calls = 0;
    const transport = createRetainedFetchTransport({
      limits,
      allowTarget: () => true,
      credentialForTarget: () => {
        calls++;
        return "token";
      },
      fetchImplementation: async () => {
        calls++;
        throw Error();
      },
    });
    await expect(
      transport.get(resource, { ifNoneMatch: '"tag"\r\nauthorization: injected' }),
    ).rejects.toMatchObject({ code: "invalid-input", submission: "not-submitted" });
    expect(calls).toBe(0);
  });
  it("preserves the actual conflict diagnosis rather than mapping every 409 to revision mismatch", async () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "idempotency-conflict",
      retry: "never",
    };
    const transport = createRetainedFetchTransport({
      limits,
      allowTarget: () => true,
      fetchImplementation: async (input) =>
        response(String(input), problem, { "content-type": "application/problem+json" }, 409),
    });
    const result = await transport.post(directory.createBead, {
      bodyText: "{}",
      idempotencyKey: "saved",
    });
    expect(result).toMatchObject({ status: 409, kind: "json", body: problem });
  });
  it("retains unknown submission on a POST whose response never arrives", async () => {
    let dispatched = false;
    const transport = createRetainedFetchTransport({
      limits: { ...limits, responseTimeoutMs: 15 },
      allowTarget: () => true,
      fetchImplementation: async () => {
        dispatched = true;
        return new Promise(() => {});
      },
    });
    await expect(
      transport.post(directory.createBead, { bodyText: "{}", idempotencyKey: "saved" }),
    ).rejects.toMatchObject({ code: "timeout", submission: "unknown" });
    expect(dispatched).toBe(true);
  });
  it("refuses redirects without forwarding credentials or following", async () => {
    let calls = 0;
    await expect(
      client(
        async (input) => {
          calls++;
          return response(String(input), "", { location: "https://other.example/" }, 307);
        },
        { credentialForTarget: () => "token" },
      ).read({ reference: resource }),
    ).rejects.toBeInstanceOf(RetainedTransportError);
    expect(calls).toBe(1);
  });
  it("bounds invalid response streams and settles cancellation before rejecting", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(20));
      },
      cancel() {
        cancelled = true;
      },
    });
    const transport = createRetainedFetchTransport({
      limits: { ...limits, responseBodyBytes: 10 },
      allowTarget: () => true,
      fetchImplementation: async () => {
        const r = new Response(stream, { headers: { "content-type": media } });
        Object.defineProperty(r, "url", { value: resource });
        return r;
      },
    });
    await expect(transport.get(resource)).rejects.toMatchObject({ code: "response-too-large" });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
});

describe("native ordinary page delivery", () => {
  const inventory = scope + "bdp/beads?limit=1";
  const next = scope + "odd-list?fixed=%2f&cursor=a%2Bb&limit=2";
  function fetchPages(
    value: unknown = { items: [record], next },
    headers: Record<string, string> = {},
  ) {
    const calls: string[] = [];
    const sdk = client(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === scope) return response(url, null, { link: linkHeader }, 204);
      if (url === description) return response(url, discovery());
      return response(url, value, { link: linkHeader, "bdp-collection-kind": "bead", ...headers });
    });
    return { calls, sdk };
  }
  it("uses the fixed Scope inventory route, returns one complete native page and follows issued bytes exactly", async () => {
    const { sdk, calls } = fetchPages();
    const reply = await sdk.list({ scope, kind: "bead", limit: 1 });
    expect(reply.kind).toBe("success");
    if (reply.kind !== "success") throw new Error("expected page");
    expect(reply.value.page).toEqual({ items: [record], next });
    expect(new TextDecoder().decode(reply.nativeBody)).toBe(
      JSON.stringify({ items: [record], next }),
    );
    expect(calls).toHaveLength(4);
    expect(calls[2]).toBe(inventory);
    await sdk.readPage({ url: next, scope, collectionKind: "bead" });
    expect(calls[4]).toBe(next);
  });
  it("uses the fixed Bead and Link routes without discovery members", async () => {
    const calls: string[] = [];
    const link = { ...record, source: resource, target: resource };
    const sdk = client(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === scope) return response(url, null, { link: linkHeader }, 204);
      if (url === description) return response(url, discovery());
      const kind = url.endsWith("/bdp/beads") ? "bead" : "link";
      return response(
        url,
        { items: [kind === "bead" ? record : link], next: null },
        { link: linkHeader, "bdp-collection-kind": kind },
      );
    });

    expect((await sdk.list({ scope, kind: "bead" })).kind).toBe("success");
    expect((await sdk.list({ scope, kind: "link" })).kind).toBe("success");
    expect(calls).toContain(`${scope}bdp/beads`);
    expect(calls).toContain(`${scope}bdp/links`);
  });
  it("requires actual collection metadata even for empty pages", async () => {
    const { sdk } = fetchPages({ items: [], next: null }, { "bdp-collection-kind": "link" });
    await expect(sdk.list({ scope, kind: "bead" })).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it.each([
    { items: [{ ...record, metadata: undefined }], next: null },
    { items: [record, record], next: null },
    { items: [{ ...record, links: { items: [], next: null } }], next: null },
    { items: [], next: "https://foreign.example/cursor" },
    { items: [], next: null, total: 0 },
  ])("refuses invalid or foreign native page %j", async (value) => {
    const { sdk } = fetchPages(value);
    await expect(sdk.list({ scope, kind: "bead" })).rejects.toThrow();
  });
  it("does not silently fetch past an empty resumable page", async () => {
    const { sdk, calls } = fetchPages({ items: [], next });
    const reply = await sdk.list({ scope, kind: "bead" });
    expect(reply.kind === "success" && reply.value.page).toEqual({ items: [], next });
    expect(calls).not.toContain(next);
  });
});

it("resolves a native alias by GET without fetching its target", async () => {
  const alias = scope + "names/one";
  const calls: string[] = [];
  const sdk = client(async (input, init) => {
    calls.push(String(input));
    expect(init?.method).toBe("GET");
    return response(String(input), null, { location: resource }, 307);
  });
  const reply = await sdk.resolveAlias(alias, scope);
  expect(reply.kind === "success" && reply.value).toEqual({ alias, target: resource });
  expect(calls).toEqual([alias]);
});

it("refuses unknown required options on list and incident before any network", () => {
  const sdk = client(async () => {
    throw new Error("must not dispatch");
  });
  expect(() =>
    sdk.list({ scope, kind: "bead", fields: {} } as unknown as Parameters<typeof sdk.list>[0]),
  ).toThrowError(expect.objectContaining({ code: "unsupported-feature" }));
  expect(() =>
    sdk.incident({
      scope,
      bead: resource,
      conformsTo: "https://types.invalid/T",
    } as unknown as Parameters<typeof sdk.incident>[0]),
  ).toThrowError(expect.objectContaining({ code: "unsupported-feature" }));
});

it("accepts public inventory pages without an unnecessary private cache directive", async () => {
  const sdk = client(async (input) => {
    const url = String(input);
    if (url === scope) return response(url, null, { link: linkHeader }, 204);
    if (url === description) return response(url, discovery());
    return response(
      url,
      { items: [], next: null },
      { link: linkHeader, "bdp-collection-kind": "bead", "cache-control": "no-store" },
    );
  });
  await expect(sdk.list({ scope, kind: "bead" })).resolves.toMatchObject({
    kind: "success",
    value: { page: { items: [], next: null } },
  });
});
