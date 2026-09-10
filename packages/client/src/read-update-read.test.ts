import { createServer } from "node:http";
import type { AdmittedJsonValue, ScopeReadOperation } from "@bdp/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  BdpClient,
  BdpReadUpdateClient,
  createFetchTransport,
  createReadUpdateFetchTransport,
  isBdpClientProblem,
  type ReadUpdateAliasResponse,
  ReadUpdateClientError,
  type ReadUpdateHttpResponse,
  type ReadUpdateTransport,
} from "./index.js";

const scope = "https://example.test/s/";
const bead = {
  id: `${scope}beads/team/a`,
  type: "https://types.example/task",
  revision: "r1",
  properties: {},
};
const link = {
  id: `${scope}links/team/l`,
  type: "https://types.example/link",
  revision: "l1",
  source: bead.id,
  target: "urn:external",
  properties: {},
};
const descriptor = {
  id: `${scope}descriptors/task`,
  name: "Task",
  describes: "bead",
  conformsTo: [],
};
const discovery = {
  bdpVersion: "0",
  profile: "read-update",
  scope,
  beads: `${scope}beads/`,
  links: `${scope}links/`,
  types: `${scope}types/`,
  aliases: `${scope}alias/`,
  operations: `${scope}operations/`,
};
const page = { items: [], next: null };
const first = { kind: "collection", collection: "beads" } as const;
const limits = {
  requestBodyBytes: 1048576,
  responseBodyBytes: 1048576,
  responseTimeoutMs: 1000,
  cleanupTimeoutMs: 10,
};
function response(
  body: unknown,
  url: string,
  status = 200,
  headers: Record<string, string> = {},
): ReadUpdateHttpResponse {
  const selected = {
    "content-type": status >= 400 ? "application/problem+json" : "application/json",
    "cache-control": "private, no-store",
    ...headers,
  };
  return {
    kind: "json",
    body: body as AdmittedJsonValue,
    url,
    status,
    contentType: selected["content-type"],
    retryAfter: null,
    headers: selected,
  };
}
function redirect(
  alias: string,
  target = bead.id,
  cache = "private, no-store",
): ReadUpdateAliasResponse {
  return {
    kind: "alias-redirect",
    status: 307,
    url: alias,
    contentType: null,
    retryAfter: null,
    headers: { location: target, "cache-control": cache },
  };
}
function harness(
  body: unknown = page,
  overrides: Partial<Omit<ReadUpdateTransport, "resolveAlias">> & {
    resolveAlias?: ReadUpdateTransport["resolveAlias"];
  } = {},
  timeout = 1000,
) {
  const calls: string[] = [];
  const { resolveAlias: overrideAlias, ...requiredOverrides } = overrides;
  const transport: ReadUpdateTransport = {
    probeScope: async () => {
      calls.push(scope);
      return {
        kind: "scope-probe",
        status: 204,
        url: scope,
        contentType: null,
        retryAfter: null,
        headers: { link: '<bdp.json>; rel="service-desc"' },
      };
    },
    get: async (url) => {
      calls.push(url);
      return response(url === `${scope}bdp.json` ? discovery : body, url);
    },
    post: async () => {
      throw Error("unexpected command");
    },
    ...(Object.hasOwn(overrides, "resolveAlias")
      ? overrideAlias === undefined
        ? {}
        : { resolveAlias: overrideAlias }
      : {
          resolveAlias: async (alias: string) => {
            calls.push(alias);
            return redirect(alias);
          },
        }),
    ...requiredOverrides,
  };
  return {
    client: new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: timeout }),
    calls,
    transport,
  };
}
function nativeResponse(
  body: string | null,
  url: string,
  status = 200,
  headers: Record<string, string> = {},
) {
  const value = new Response(body, {
    status,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      "cache-control": "private, no-store",
      ...headers,
    },
  });
  Object.defineProperty(value, "url", { value: url });
  return value;
}
const variants: readonly [string, ScopeReadOperation, unknown][] = [
  [
    "Bead collection",
    { kind: "collection", collection: "beads", selector: "status == 'in progress'", limit: 2 },
    page,
  ],
  [
    "Link collection",
    {
      kind: "collection",
      collection: "links",
      type: "https://types.example/link",
      conformsTo: "urn:base",
      source: bead.id,
      target: "urn:external",
      endpoint: "https://external.test/a?q=x%20y",
      limit: 2,
    },
    page,
  ],
  ["Type inventory", { kind: "collection", collection: "types", limit: 2 }, page],
  ["Bead", { kind: "resource", resource: "bead", id: bead.id }, bead],
  ["Link", { kind: "resource", resource: "link", id: link.id }, link],
  ["Type descriptor", { kind: "resource", resource: "type", id: descriptor.id }, descriptor],
  ["Bead properties", { kind: "properties", resource: "bead", id: bead.id }, { status: "open" }],
  [
    "Link properties",
    { kind: "properties", resource: "link", id: link.id },
    { reason: "dependency" },
  ],
  [
    "Incident Links",
    { kind: "bead-links", bead: bead.id, direction: "outbound", limit: 2 },
    { items: [link], next: null },
  ],
];

describe("Read+Update shared Read session", () => {
  it.each(variants)(
    "executes %s through both public Fetch wrappers with identical final URL bytes",
    async (_name, request, body) => {
      const legacyUrls: string[] = [],
        ruUrls: string[] = [];
      const legacy = new BdpClient({
        scope,
        transport: createFetchTransport(async (input) => {
          const url = String(input);
          legacyUrls.push(url);
          if (url === scope)
            return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
          return nativeResponse(
            JSON.stringify(
              url === `${scope}bdp.json`
                ? { ...discovery, profile: "read", aliases: undefined, operations: undefined }
                : body,
            ),
            url,
          );
        }),
      });
      const ru = new BdpReadUpdateClient({
        scope,
        settlementTimeoutMs: 1000,
        transport: createReadUpdateFetchTransport({
          scope,
          limits,
          fetchImplementation: async (input, init) => {
            const url = String(input);
            ruUrls.push(url);
            expect(init).toMatchObject({
              method: "GET",
              credentials: "omit",
              redirect: "manual",
              cache: "no-store",
            });
            if (url === scope)
              return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
            return nativeResponse(
              JSON.stringify(url === `${scope}bdp.json` ? discovery : body),
              url,
            );
          },
        }),
      });
      try {
        expect(await legacy.perform(request)).toEqual(body);
        const result = await ru.read(request);
        expect(result).toMatchObject({
          kind: "success",
          value: body,
          http: { status: 200, url: legacyUrls.at(-1) },
        });
        expect(ruUrls).toEqual(legacyUrls);
        expect(ruUrls).toHaveLength(3);
        await ru.read(request);
        expect(ruUrls.slice(3)).toEqual(ruUrls.slice(0, 3));
      } finally {
        await legacy.close();
        await ru.close();
      }
    },
  );

  it("preserves static public HTML Scope and public discovery without imposing an authorization-dependent cache rule", async () => {
    const transport = createReadUpdateFetchTransport({
      scope,
      limits,
      fetchImplementation: async (input) => {
        const url = String(input);
        if (url === scope) {
          const value = new Response("<html>public documentation</html>", {
            status: 200,
            headers: {
              "content-type": "text/html",
              link: '<bdp.json>; rel="service-desc"',
              "cache-control": "public, max-age=3600",
            },
          });
          Object.defineProperty(value, "url", { value: url });
          return value;
        }
        return nativeResponse(
          JSON.stringify(url.endsWith("bdp.json") ? discovery : page),
          url,
          200,
          {
            "cache-control": url.endsWith("bdp.json")
              ? "public, max-age=3600"
              : "private, no-store",
          },
        );
      },
    });
    const client = new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: 1000 });
    await expect(client.read(first)).resolves.toMatchObject({ kind: "success" });
  });
  it("retains canonical inline owned Link controls and rejects raw local dot traversal", async () => {
    let body: unknown = { ...bead, ownedLinks: { [link.type]: [link] } };
    const h = harness(page, {
      get: async (url) => response(url.endsWith("bdp.json") ? discovery : body, url),
    });
    const request = { kind: "resource", resource: "bead", id: bead.id } as const;
    await expect(h.client.read(request)).resolves.toMatchObject({ kind: "success", value: body });
    body = {
      ...bead,
      ownedLinks: { [link.type]: [{ ...link, target: `${scope}../other/beads/a` }] },
    };
    await expect(h.client.read(request)).rejects.toMatchObject({ code: "invalid-response" });
    const legacy = new BdpClient({
      scope,
      transport: createFetchTransport(async (input) => {
        const url = String(input);
        if (url === scope)
          return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
        return nativeResponse(
          JSON.stringify(
            url.endsWith("bdp.json")
              ? { ...discovery, profile: "read", aliases: undefined, operations: undefined }
              : body,
          ),
          url,
        );
      }),
    });
    expect(isBdpClientProblem(await legacy.perform(request))).toBe(true);
    await legacy.close();
  });
  it("reports registry capacity without misattributing the last HTTP response", async () => {
    const h = harness({ items: [], next: `${scope}beads/?cursor=same` });
    for (let i = 0; i < 1024; i++) await h.client.read(first);
    await expect(h.client.read(first)).rejects.toMatchObject({
      code: "invalid-input",
      submission: "not-submitted",
      httpStatus: undefined,
      headers: undefined,
    });
    await h.client.close();
  });
  it.each(["read", "transactional", "future"])(
    "refuses %s discovery before Read dispatch",
    async (profile) => {
      const h = harness(page, { get: async (url) => response({ ...discovery, profile }, url) });
      await expect(h.client.read(first)).rejects.toMatchObject({
        code: "invalid-response",
        submission: "not-submitted",
        httpStatus: 200,
      });
      expect(h.calls).toEqual([scope]);
    },
  );
  it.each(["beads", "links", "types", "aliases", "operations"])(
    "requires the advertised %s root",
    async (field) => {
      let gets = 0;
      const h = harness(page, {
        get: async (url) => {
          gets++;
          return response({ ...discovery, [field]: `${scope}other/` }, url);
        },
      });
      await expect(h.client.read(first)).rejects.toMatchObject({ code: "invalid-response" });
      expect(gets).toBe(1);
    },
  );
  it("keeps local URL refusal free of prior discovery context", async () => {
    const h = harness();
    await expect(
      h.client.read({ kind: "resource", resource: "bead", id: "https://outside.test/beads/a" }),
    ).rejects.toMatchObject({
      code: "invalid-input",
      submission: "not-submitted",
      httpStatus: undefined,
      headers: undefined,
    });
    expect(h.calls).toEqual([scope, `${scope}bdp.json`]);
  });
  it("rejects unsupported runtime discovery algebra before navigation", async () => {
    const h = harness();
    await expect(
      h.client.read({ kind: "scope-discovery", scope } as unknown as ScopeReadOperation),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(h.calls).toEqual([]);
  });
  it.each(["read", "alias"])(
    "sanitizes forged public errors thrown by %s option traps",
    async (operation) => {
      const h = harness();
      const options = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new ReadUpdateClientError("closed", "unknown", 418, "secret", "secret", {
              secret: "secret",
            });
          },
        },
      );
      const pending =
        operation === "read"
          ? h.client.read(first, options)
          : h.client.resolveAlias(`${scope}alias/a`, options);
      await expect(pending).rejects.toMatchObject({
        code: "invalid-input",
        submission: "not-submitted",
        httpStatus: undefined,
        headers: undefined,
      });
      expect(h.calls).toEqual([]);
    },
  );
  it("captures request/options and preserves owner-before-abort-before-request precedence", async () => {
    const h = harness();
    const other = harness();
    const aborted = AbortSignal.abort();
    const hostile = Object.defineProperty({}, "kind", {
      get: () => {
        throw Error("must not inspect");
      },
    }) as ScopeReadOperation;
    await expect(
      h.client.read(hostile, {
        continuationScope: other.client.createContinuationScope(),
        signal: aborted,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(h.client.read(hostile, { signal: aborted })).rejects.toMatchObject({
      code: "aborted",
    });
    const request = { ...first };
    const pending = h.client.read(request);
    Object.assign(request, { collection: "links" });
    await expect(pending).resolves.toMatchObject({ kind: "success" });
    expect(h.calls.at(-1)).toBe(`${scope}beads/`);
  });

  it.each([405, 406, 500])("retains native empty %s and actual metadata", async (status) => {
    const h = harness(page, {
      get: async (url) =>
        url.endsWith("bdp.json")
          ? response(discovery, url)
          : {
              kind: "empty",
              status,
              url,
              contentType: null,
              retryAfter: null,
              headers: { allow: "GET, HEAD" },
            },
    });
    await expect(h.client.read(first)).resolves.toMatchObject({
      kind: "http",
      http: { status, headers: { allow: "GET, HEAD" } },
    });
  });
  it.each([304, 412])("rejects unsolicited %s for unconditional Read", async (status) => {
    const h = harness(page, {
      get: async (url) =>
        url.endsWith("bdp.json")
          ? response(discovery, url)
          : { kind: "empty", status, url, contentType: null, retryAfter: null, headers: {} },
    });
    await expect(h.client.read(first)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: status,
    });
  });
  const forbidden = {
    type: "https://github.com/gastownhall/bdp/problems/authorization",
    code: "forbidden",
    retry: "after-state-change",
  };
  it.each(["page", "discovery"])(
    "uses Read Problem law for %s with absent status member",
    async (stage) => {
      const h = harness(page, {
        get: async (url) =>
          url.endsWith("bdp.json") && stage === "page"
            ? response(discovery, url)
            : response(forbidden, url, 403),
      });
      await expect(h.client.read(first)).resolves.toMatchObject({
        kind: "problem",
        problem: forbidden,
        http: { status: 403 },
      });
    },
  );
  it.each([404, 422])("rejects code/status mismatch at actual status %s", async (status) => {
    const h = harness(page, {
      get: async (url) =>
        url.endsWith("bdp.json") ? response(discovery, url) : response(forbidden, url, status),
    });
    await expect(h.client.read(first)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: status,
    });
  });
  it("does not accept a mutation-only Problem", async () => {
    const body = {
      type: "https://github.com/gastownhall/bdp/problems/validation",
      code: "validation-failed",
      retry: "never",
      diagnostics: [{ message: "bad", instanceLocation: "/properties" }],
    };
    const h = harness(page, {
      get: async (url) =>
        url.endsWith("bdp.json") ? response(discovery, url) : response(body, url, 422),
    });
    await expect(h.client.read(first)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: 422,
    });
  });
  it.each([
    "",
    'private="field", no-store',
    'extension="a, private, no-store,z"',
    'private, no-store="x"',
  ])("requires whole cache protections: %s", async (cache) => {
    const h = harness(page, {
      get: async (url) =>
        response(url.endsWith("bdp.json") ? discovery : page, url, 200, { "cache-control": cache }),
    });
    await expect(h.client.read(first)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: 200,
    });
  });
  it.each([
    ["wrong id", { ...bead, id: `${scope}beads/other` }],
    ["wrong category", link],
    [
      "foreign inline link",
      {
        ...bead,
        ownedLinks: {
          "https://types.example/link": [{ ...link, id: "https://outside.test/links/l" }],
        },
      },
    ],
    ["wrong owned type", { ...bead, ownedLinks: { "https://types.example/different": [link] } }],
  ])("rejects malformed served Bead: %s", async (_name, body) => {
    const h = harness(body);
    await expect(
      h.client.read({ kind: "resource", resource: "bead", id: bead.id }),
    ).rejects.toMatchObject({ code: "invalid-response", httpStatus: 200 });
  });
  it("rejects off-Scope next without issuing a continuation", async () => {
    const next = "https://outside.test/beads/?cursor=x";
    const h = harness({ items: [], next });
    await expect(h.client.read(first)).rejects.toMatchObject({ code: "invalid-response" });
    await expect(h.client.read({ ...first, continuation: next })).rejects.toMatchObject({
      code: "invalid-input",
      httpStatus: undefined,
    });
  });
  it("inherits incident direction for authoritative continuation bytes", async () => {
    const next = `${scope}beads/team/a?view=links&cursor=a%2Bb%20c`;
    let body: unknown = { items: [link], next };
    const h = harness(page, {
      get: async (url) => response(url.endsWith("bdp.json") ? discovery : body, url),
    });
    await expect(
      h.client.read({ kind: "bead-links", bead: bead.id, direction: "outbound" }),
    ).resolves.toMatchObject({ kind: "success" });
    body = { items: [{ ...link, source: "urn:external", target: bead.id }], next: null };
    await expect(
      h.client.read({ kind: "bead-links", bead: bead.id, continuation: next }),
    ).rejects.toMatchObject({ code: "invalid-response" });
    body = { items: [link], next: null };
    await expect(
      h.client.read({ kind: "bead-links", bead: bead.id, continuation: next }),
    ).resolves.toMatchObject({ kind: "success", http: { url: next } });
  });
  it.each(["abort", "timeout"])(
    "restores a leased page by public %s settlement despite an unsettled inner transport",
    async (mode) => {
      const next = `${scope}beads/?cursor=a%2Bb%20c`;
      let sends = 0,
        release!: (value: ReadUpdateHttpResponse) => void;
      // A separate captured transport switches behavior through state, not method replacement.
      const original = harness(
        page,
        {
          get: async (url) => {
            if (url.endsWith("bdp.json")) return response(discovery, url);
            if (!url.includes("cursor=")) return response({ items: [], next }, url);
            sends++;
            return sends === 1
              ? new Promise((done) => {
                  release = done;
                })
              : response(page, url);
          },
        },
        mode === "timeout" ? 20 : 1000,
      );
      await original.client.read(first);
      const controller = new AbortController();
      const pending = original.client.read(
        { ...first, continuation: next },
        { signal: controller.signal },
      );
      while (sends === 0) await Promise.resolve();
      if (mode === "abort") controller.abort();
      await expect(pending).rejects.toMatchObject({
        code: mode === "abort" ? "aborted" : "timeout",
        submission: "not-submitted",
      });
      await expect(original.client.read({ ...first, continuation: next })).resolves.toMatchObject({
        kind: "success",
      });
      release(response({ items: [], next: `${scope}beads/?cursor=unseen` }, next));
      await Promise.resolve();
      await Promise.resolve();
      await expect(
        original.client.read({ ...first, continuation: `${scope}beads/?cursor=unseen` }),
      ).rejects.toMatchObject({ code: "invalid-input" });
      await original.client.close();
    },
  );
  it("does not consume or issue a page when validation crosses the final deadline", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const next = `${scope}beads/?cursor=old`,
      unseen = `${scope}beads/?cursor=unseen`;
    let body: unknown = { items: [], next };
    const h = harness(
      page,
      { get: async (url) => response(url.endsWith("bdp.json") ? discovery : body, url) },
      100,
    );
    try {
      await h.client.read(first);
      body = new Proxy(
        { items: [], next: unseen },
        {
          ownKeys(target) {
            now = 101;
            return Reflect.ownKeys(target);
          },
        },
      );
      await expect(h.client.read({ ...first, continuation: next })).rejects.toMatchObject({
        code: "timeout",
      });
      body = page;
      await expect(h.client.read({ ...first, continuation: unseen })).rejects.toMatchObject({
        code: "invalid-input",
      });
      await expect(h.client.read({ ...first, continuation: next })).resolves.toMatchObject({
        kind: "success",
      });
    } finally {
      clock.mockRestore();
      await h.client.close();
    }
  });
  it("keeps duplicate issuance, owners, concurrent leases and forgetting independent", async () => {
    const next = `${scope}beads/?cursor=same`;
    let body: unknown = { items: [], next };
    const h = harness(page, {
      get: async (url) => response(url.endsWith("bdp.json") ? discovery : body, url),
    });
    const owner = h.client.createContinuationScope(),
      other = h.client.createContinuationScope();
    await h.client.read(first, { continuationScope: owner });
    await h.client.read(first, { continuationScope: owner });
    await h.client.read(first, { continuationScope: other });
    body = page;
    await Promise.all([
      h.client.read({ ...first, continuation: next }, { continuationScope: owner }),
      h.client.read({ ...first, continuation: next }, { continuationScope: owner }),
    ]);
    await expect(
      h.client.read({ ...first, continuation: next }, { continuationScope: owner }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    h.client.forgetContinuations(other);
    await expect(
      h.client.read({ ...first, continuation: next }, { continuationScope: other }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await h.client.close();
    expect(() => h.client.createContinuationScope()).toThrowError(/closed/);
    expect(() => h.client.forgetContinuations(owner)).toThrowError(/closed/);
  });
  it.each([false, true])("close fences late initial/leased page (leased=%s)", async (leased) => {
    const next = `${scope}beads/?cursor=next`;
    let wait = false,
      started = false,
      release!: (value: ReadUpdateHttpResponse) => void;
    const h = harness(page, {
      get: async (url) => {
        if (url.endsWith("bdp.json")) return response(discovery, url);
        if (wait) {
          started = true;
          return new Promise((done) => {
            release = done;
          });
        }
        return response({ items: [], next }, url);
      },
    });
    if (leased) await h.client.read(first);
    wait = true;
    const pending = h.client.read(leased ? { ...first, continuation: next } : first);
    while (!started) await Promise.resolve();
    await h.client.close();
    await expect(pending).rejects.toMatchObject({ code: "closed", submission: "not-submitted" });
    release(
      response({ items: [], next: `${scope}beads/?cursor=late` }, leased ? next : `${scope}beads/`),
    );
    await Promise.resolve();
    await expect(h.client.read(first)).rejects.toMatchObject({ code: "closed" });
  });

  it.each([
    [`${scope}../other/beads/b`, false],
    [`${scope}%2e%2e/other/beads/b`, false],
    [`${scope}beads/b`, true],
    ["http://example.test/s/beads/b", true],
    ["https://example.test/s%2fother/beads/b", true],
    ["https://example.test/s%5cother/beads/b", true],
  ])("shared endpoint classifier preserves actual Scope boundary %s", async (target, accepted) => {
    const body = { ...link, target };
    const ru = harness(body);
    const legacy = new BdpClient({
      scope,
      transport: createFetchTransport(async (input) => {
        const url = String(input);
        if (url === scope)
          return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
        return nativeResponse(
          JSON.stringify(
            url.endsWith("bdp.json")
              ? { ...discovery, profile: "read", aliases: undefined, operations: undefined }
              : body,
          ),
          url,
        );
      }),
    });
    const request = { kind: "resource", resource: "link", id: link.id } as const;
    const legacyResult = await legacy.perform(request);
    expect(isBdpClientProblem(legacyResult)).toBe(!accepted);
    if (accepted)
      await expect(ru.client.read(request)).resolves.toMatchObject({
        kind: "success",
        value: body,
      });
    else await expect(ru.client.read(request)).rejects.toMatchObject({ code: "invalid-response" });
    await legacy.close();
    await ru.client.close();
  });

  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"a":"\\ud800"}',
    '{"\\udfff":0}',
    '{"a":9007199254740993}',
    '{"a":1e10000}',
  ])("rejects invalid raw Read properties %s through actual transport", async (text) => {
    const transport = createReadUpdateFetchTransport({
      scope,
      limits,
      fetchImplementation: async (input) => {
        const url = String(input);
        if (url === scope)
          return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
        return nativeResponse(url.endsWith("bdp.json") ? JSON.stringify(discovery) : text, url);
      },
    });
    const client = new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: 1000 });
    await expect(
      client.read({ kind: "properties", resource: "bead", id: bead.id }),
    ).rejects.toMatchObject({ code: "transport", submission: "not-submitted" });
  });
  it("accepts deep exact values and scalar strings through the actual transport", async () => {
    const text = `{"deep":${"[".repeat(2000)}{"n":9007199254740992,"text":"🌍","default":1,"__proto__":2}${"]".repeat(2000)}}`;
    const transport = createReadUpdateFetchTransport({
      scope,
      limits,
      fetchImplementation: async (input) => {
        const url = String(input);
        if (url === scope)
          return nativeResponse(null, url, 204, { link: '<bdp.json>; rel="service-desc"' });
        return nativeResponse(url.endsWith("bdp.json") ? JSON.stringify(discovery) : text, url);
      },
    });
    const client = new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: 1000 });
    const result = await client.read({ kind: "properties", resource: "bead", id: bead.id });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw Error("expected success");
    let value: unknown = result.value.deep;
    for (let i = 0; i < 2000; i++) {
      expect(Array.isArray(value)).toBe(true);
      value = (value as unknown[])[0];
    }
    expect(value).toEqual({ n: 9007199254740992, text: "🌍", default: 1, ["__proto__"]: 2 });
  });
});

describe("Read+Update explicit alias resolution", () => {
  const alias = `${scope}alias/team/task`;
  it("returns a fresh one-hop result and leaves later target authorization independent", async () => {
    let target = bead.id;
    const h = harness(page, {
      resolveAlias: async (url) => redirect(url, target),
      get: async (url) =>
        url.endsWith("bdp.json")
          ? response(discovery, url)
          : response(
              {
                type: "https://github.com/gastownhall/bdp/problems/not-found",
                code: "resource-not-found",
                retry: "after-state-change",
              },
              url,
              404,
            ),
    });
    await expect(h.client.resolveAlias(alias)).resolves.toMatchObject({
      kind: "success",
      value: { alias, target },
      http: { status: 307, url: alias },
    });
    target = `${scope}beads/new`;
    await expect(h.client.resolveAlias(alias)).resolves.toMatchObject({
      kind: "success",
      value: { alias, target },
    });
    await expect(
      h.client.read({ kind: "resource", resource: "bead", id: target }),
    ).resolves.toMatchObject({ kind: "problem", http: { status: 404 } });
    expect(h.calls).toEqual([scope, scope, scope]);
  });
  it.each([
    "relative",
    `${scope}alias/`,
    `${scope}alias/a?`,
    `${scope}alias/a#`,
    `${scope}alias/%2F`,
    `${scope}alias/a/../b`,
    "https://outside.test/s/alias/a",
  ])("rejects alias input %s before navigation", async (input) => {
    const h = harness();
    await expect(h.client.resolveAlias(input)).rejects.toMatchObject({
      code: "invalid-input",
      httpStatus: undefined,
    });
    expect(h.calls).toEqual([]);
  });
  it("does not require alias support for operation-only transports", async () => {
    const h = harness(page, { resolveAlias: undefined });
    await expect(h.client.resolveAlias(alias)).rejects.toMatchObject({ code: "invalid-input" });
    expect(h.calls).toEqual([]);
    await expect(h.client.read(first)).resolves.toMatchObject({ kind: "success" });
  });
  it.each([
    "beads/team/a",
    `${scope}links/l`,
    `${scope}alias/chain`,
    "https://outside.test/beads/a",
    `${scope}beads/a?`,
    `${scope}beads/a#`,
    `${scope}beads/a,${scope}beads/b`,
    `${scope}beads/%2F`,
    `${scope}beads/a/../b`,
  ])("rejects Location %s with the actual307 context", async (target) => {
    const h = harness(page, { resolveAlias: async (url) => redirect(url, target) });
    await expect(h.client.resolveAlias(alias)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "not-submitted",
      httpStatus: 307,
    });
  });
  it.each([
    "",
    'private="field", no-store',
    'extension="x, private,no-store,z"',
    'private, no-store="x"',
  ])("rejects alias cache %s", async (cache) => {
    const h = harness(page, { resolveAlias: async (url) => redirect(url, bead.id, cache) });
    await expect(h.client.resolveAlias(alias)).rejects.toMatchObject({
      code: "invalid-response",
      httpStatus: 307,
    });
  });
  it("accepts harmless quoted cache extensions without interpreting their contents", async () => {
    const h = harness(page, {
      resolveAlias: async (url) =>
        redirect(url, bead.id, 'private, extension="x, \\"q\\"", no-store'),
    });
    await expect(h.client.resolveAlias(alias)).resolves.toMatchObject({ kind: "success" });
  });
  it("makes no follow request and uses fresh credentials through native Node HTTP", async () => {
    const requests: { url: string; authorization: string | undefined }[] = [];
    let root = "",
      token: string | undefined = "first";
    const server = createServer((req, res) => {
      requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
      res.setHeader("Cache-Control", "private, no-store");
      if (req.url === "/s/") {
        res.writeHead(204, { link: '<bdp.json>; rel="service-desc"' });
        res.end();
        return;
      }
      if (req.url === "/s/bdp.json") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ...discovery,
            scope: root,
            beads: `${root}beads/`,
            links: `${root}links/`,
            types: `${root}types/`,
            aliases: `${root}alias/`,
            operations: `${root}operations/`,
          }),
        );
        return;
      }
      res.writeHead(307, { location: `${root}beads/a` });
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (address === null || typeof address === "string") throw Error("address missing");
    root = `http://127.0.0.1:${address.port}/s/`;
    const client = new BdpReadUpdateClient({
      scope: root,
      settlementTimeoutMs: 1000,
      transport: createReadUpdateFetchTransport({ scope: root, limits, credential: () => token }),
    });
    try {
      await expect(client.resolveAlias(`${root}alias/a`)).resolves.toMatchObject({
        kind: "success",
        value: { alias: `${root}alias/a`, target: `${root}beads/a` },
      });
      token = undefined;
      await expect(client.resolveAlias(`${root}alias/a`)).resolves.toMatchObject({
        kind: "success",
      });
      expect(requests.map((request) => request.url)).toEqual([
        "/s/",
        "/s/bdp.json",
        "/s/alias/a",
        "/s/",
        "/s/bdp.json",
        "/s/alias/a",
      ]);
      expect(requests.slice(0, 3).map((request) => request.authorization)).toEqual([
        "Bearer first",
        "Bearer first",
        "Bearer first",
      ]);
      expect(requests.slice(3).map((request) => request.authorization)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
