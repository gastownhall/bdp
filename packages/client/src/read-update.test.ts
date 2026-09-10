import { describe, expect, it, vi } from "vitest";
import type { AdmittedJsonValue } from "@bdp/protocol";
import { BdpReadUpdateClient, ReadUpdateClientError } from "./read-update.js";
import {
  createReadUpdateFetchTransport,
  ReadUpdateTransportError,
  type ReadUpdateHttpResponse,
  type ReadUpdateScopeProbeResponse,
  type ReadUpdateTransport,
} from "./read-update-transport.js";

const scope = "https://example.test/s/",
  type = "https://types.example/task",
  linkType = "https://types.example/relation";
const bead = { id: `${scope}beads/a`, type, revision: "r1", properties: {} };
const link = {
  id: `${scope}links/l`,
  type: linkType,
  revision: "l1",
  properties: {},
  source: bead.id,
  target: "urn:external",
};
const discovery = {
  bdpVersion: "0",
  profile: "read-update",
  scope,
  beads: `${scope}beads/`,
  links: `${scope}links/`,
  types: `${scope}types/`,
  operations: `${scope}operations/`,
  aliases: `${scope}alias/`,
};
const directory = {
  createBead: "create-bead",
  updateBeadProperties: "update-bead-properties",
  deleteBead: "delete-bead",
  createLink: "create-link",
  updateLinkProperties: "update-link-properties",
  deleteLink: "delete-link",
  putAlias: "put-alias",
  deleteAlias: "delete-alias",
  sequence: "sequence",
};
const problem = {
  type: "https://github.com/gastownhall/bdp/problems/validation",
  code: "validation-failed",
  status: 422,
  retry: "never",
  diagnostics: [{ message: "invalid properties", instanceLocation: "/properties/n" }],
};
function json(
  body: unknown,
  url = `${scope}operations/create-bead`,
  status = 200,
  extra: Record<string, string> = {},
): ReadUpdateHttpResponse {
  const headers: Record<string, string> = {
    "content-type": status >= 400 ? "application/problem+json" : "application/json",
    ...extra,
  };
  return {
    kind: "json",
    body: body as AdmittedJsonValue,
    status,
    url,
    contentType: headers["content-type"] ?? null,
    retryAfter: headers["retry-after"] ?? null,
    headers,
  };
}
function probe(linkHeader = '<bdp.json>; rel="service-desc"'): ReadUpdateScopeProbeResponse {
  return {
    kind: "scope-probe",
    status: 204,
    url: scope,
    contentType: null,
    retryAfter: null,
    headers: { link: linkHeader },
  };
}
function empty(url: string, status: number): ReadUpdateHttpResponse {
  return { kind: "empty", status, url, contentType: null, retryAfter: null, headers: {} };
}
interface Harness {
  client: BdpReadUpdateClient;
  calls: { method: string; url: string; bodyText?: string; key?: string }[];
  transport: ReadUpdateTransport;
}
function setup(
  reply: unknown = { outcome: "created", resource: bead },
  overrides: Partial<ReadUpdateTransport> = {},
  timeout = 250,
): Harness {
  const calls: Harness["calls"] = [];
  const transport: ReadUpdateTransport = {
    probeScope: async () => {
      calls.push({ method: "probe", url: scope });
      return probe();
    },
    get: async (url) => {
      calls.push({ method: "get", url });
      return json(url === `${scope}bdp.json` ? discovery : directory, url);
    },
    post: async (url, options) => {
      calls.push({
        method: "post",
        url,
        bodyText: options.bodyText,
        ...(options.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
      });
      return json(reply, url);
    },
    ...overrides,
  };
  return {
    client: new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: timeout }),
    calls,
    transport,
  };
}
const input = JSON.stringify({ type });
const options = { idempotencyKey: "exact_KEY-1" };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("BdpReadUpdateClient navigation and operations", () => {
  it("follows Scope Link and the exact RU directory without consuming the Scope body", async () => {
    const h = setup();
    expect((await h.client.discover()).kind).toBe("success");
    const result = await h.client.operationDirectory();
    expect(result).toMatchObject({ kind: "success", value: directory });
    expect(h.calls.map((c) => c.url)).toEqual([
      scope,
      `${scope}bdp.json`,
      scope,
      `${scope}bdp.json`,
      `${scope}operations/`,
    ]);
    if (result.kind !== "success") throw Error();
    expect(Object.isFrozen(result.value)).toBe(true);
  });
  it("works through actual Fetch transport with a permitted HTML Scope landing page", async () => {
    const seen: string[] = [];
    const transport = createReadUpdateFetchTransport({
      scope,
      limits: {
        requestBodyBytes: 10000,
        responseBodyBytes: 10000,
        responseTimeoutMs: 250,
        cleanupTimeoutMs: 10,
      },
      fetchImplementation: async (url) => {
        seen.push(String(url));
        const body = url === scope ? "<html>not discovery</html>" : JSON.stringify(discovery);
        const response = new Response(body, {
          headers:
            url === scope
              ? { "content-type": "text/html", link: '<bdp.json>; rel="service-desc"' }
              : { "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      },
    });
    const client = new BdpReadUpdateClient({ scope, transport, settlementTimeoutMs: 300 });
    expect(await client.discover()).toMatchObject({ kind: "success", value: discovery });
    expect(seen).toEqual([scope, `${scope}bdp.json`]);
  });
  it.each([
    ["createBead", { type, id: "beads/a" }, { outcome: "created", resource: bead }],
    [
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "replace", path: "", value: {} }] },
      { outcome: "updated", resource: bead },
    ],
    [
      "deleteBead",
      { bead: "beads/a", expectedRevision: "r1" },
      {
        outcome: "deleted",
        deleted: { resourceKind: "bead", resource: { id: bead.id, type, revision: "r1" } },
      },
    ],
    [
      "createLink",
      { type: linkType, id: "links/l", source: "beads/a", target: "urn:external" },
      { outcome: "created", resource: link, source: bead.id, sourceRevision: "r2" },
    ],
    [
      "updateLinkProperties",
      { link: "links/l", change: [{ op: "replace", path: "", value: {} }] },
      { outcome: "updated", resource: link },
    ],
    [
      "deleteLink",
      { link: "links/l", expectedRevision: "l1" },
      {
        outcome: "deleted",
        deleted: {
          resourceKind: "link",
          resource: { id: link.id, type: linkType, revision: "l1" },
        },
        source: bead.id,
        sourceRevision: "r2",
      },
    ],
    [
      "putAlias",
      { alias: "alias/lead", target: "beads/a" },
      { outcome: "created", alias: `${scope}alias/lead`, target: bead.id },
    ],
    ["deleteAlias", { alias: "alias/lead" }, { outcome: "deleted", alias: `${scope}alias/lead` }],
  ] as const)("submits and validates %s", async (operation, body, result) => {
    const h = setup(result);
    const text = JSON.stringify(body);
    const reply = await h.client.mutate(operation, text, options);
    expect(reply).toMatchObject({ kind: "success", value: result });
    expect(h.calls.at(-1)).toEqual({
      method: "post",
      url: `${scope}operations/${directory[operation]}`,
      bodyText: text,
      key: options.idempotencyKey,
    });
    expect(h.calls.filter((c) => c.method === "post")).toHaveLength(1);
  });
  it("keeps original lossless request text, key case and context omission through navigation", async () => {
    const text = `{ "type":"${type}","properties":{"n":9007199254740993,"escape":"\\u0061"} }`;
    const h = setup(undefined, {
      post: async (url, call) => {
        expect(call.bodyText).toBe(text);
        expect(call.idempotencyKey).toBe("Key_CASE");
        return json(problem, url, 422, { "cache-control": "private, no-store" });
      },
    });
    expect(await h.client.mutate("createBead", text, { idempotencyKey: "Key_CASE" })).toMatchObject(
      { kind: "problem", problem },
    );
  });
  it.each(["", "bad key", "key\n", "a".repeat(257)])(
    "rejects invalid key %j before any navigation",
    async (key) => {
      const h = setup();
      await expect(
        h.client.mutate("createBead", input, { idempotencyKey: key }),
      ).rejects.toMatchObject({ code: "invalid-input", submission: "not-submitted" });
      expect(h.calls).toHaveLength(0);
    },
  );
  it.each([
    `{"type":"${type}","type":"${type}"}`,
    `{"type":"${type}","id":"https://evil.test/beads/a"}`,
    `{"type":"${type}","properties":{"x":"\\ud800"}}`,
  ])("rejects invalid whole carrier before navigation: %s", async (text) => {
    const h = setup();
    await expect(h.client.mutate("createBead", text, options)).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(h.calls).toHaveLength(0);
  });
  it.each([
    '<https://evil.test/bdp.json>; rel="service-desc"',
    '<../bdp.json>; rel="service-desc"',
    '<bdp.json#>; rel="service-desc"',
    '<bdp.json>; rel="service-doc"',
  ])("refuses unsafe/missing service description: %s", async (header) => {
    let gets = 0;
    const h = setup(undefined, {
      probeScope: async () => probe(header),
      get: async () => {
        gets++;
        throw Error();
      },
    });
    await expect(h.client.discover()).rejects.toMatchObject({
      code: "invalid-response",
      submission: "not-submitted",
    });
    expect(gets).toBe(0);
  });
  it.each([
    { scope: "https://evil.test/s/" },
    { operations: "https://evil.test/operations/" },
    { aliases: `${scope}other/` },
    { profile: "read" },
  ])("refuses inconsistent discovery %# before directory or POST", async (patch) => {
    let posts = 0,
      gets = 0;
    const h = setup(undefined, {
      get: async (url) => {
        gets++;
        return json({ ...discovery, ...patch }, url);
      },
      post: async () => {
        posts++;
        throw Error();
      },
    });
    await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "not-submitted",
    });
    expect(posts).toBe(0);
    expect(gets).toBe(1);
  });
  it("rejects off-Scope directory target before POST even from an injected transport", async () => {
    let posts = 0;
    const h = setup(undefined, {
      get: async (url) =>
        json(
          url === `${scope}bdp.json`
            ? discovery
            : { ...directory, createBead: "https://evil.test/write" },
          url,
        ),
      post: async () => {
        posts++;
        throw Error();
      },
    });
    await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "not-submitted",
    });
    expect(posts).toBe(0);
  });
  it("ignores a service-desc anchored to another context and follows the Scope link", async () => {
    const h = setup(undefined, {
      probeScope: async () =>
        probe(
          '<https://evil.test/descriptor>; rel="service-desc"; anchor="https://elsewhere.test/", <bdp.json>; rel="service-desc"',
        ),
    });
    expect((await h.client.discover()).kind).toBe("success");
    expect(h.calls.map((c) => c.url)).toEqual([`${scope}bdp.json`]);
  });
  it("accepts deep valid request/postimage data without a hidden client depth cap", async () => {
    const depth = 9000;
    const text = `{"type":"${type}","properties":{"deep":${"[".repeat(depth)}1${"]".repeat(depth)}}}`;
    const properties = JSON.parse(text).properties;
    const h = setup({ outcome: "created", resource: { ...bead, properties } }, {}, 3000);
    const result = await h.client.mutate("createBead", text, options);
    expect(result.kind).toBe("success");
    expect(h.calls.at(-1)?.bodyText).toBe(text);
    if (result.kind !== "success" || !result.value.resource) throw Error();
    let current: unknown = result.value.resource.properties.deep;
    for (let index = 0; index < depth; index++) {
      expect(Object.isFrozen(current)).toBe(true);
      current = (current as unknown[])[0];
    }
    expect(current).toBe(1);
  });
  it("counts carrier preflight time in the delivery deadline before navigation", async () => {
    const h = setup(undefined, {}, 1);
    const depth = 20000;
    const text = `{"type":"${type}","properties":{"deep":${"[".repeat(depth)}1${"]".repeat(depth)}}}`;
    await expect(h.client.mutate("createBead", text, options)).rejects.toMatchObject({
      code: "timeout",
      submission: "not-submitted",
    });
    expect(h.calls).toHaveLength(0);
  });
  it("does not follow an injected response whose URL differs from the requested URL", async () => {
    const h = setup(undefined, { get: async () => json(discovery, "https://evil.test/bdp.json") });
    await expect(h.client.discover()).rejects.toMatchObject({ code: "invalid-response" });
  });
  it.each([
    { outcome: "updated", resource: bead },
    { outcome: "created", resource: link },
    { outcome: "created", resource: { ...bead, id: `${scope}beads/b` } },
    { outcome: "created", resource: { ...bead, type: linkType } },
    { outcome: "created", resource: { ...bead, id: "https://evil.test/beads/a" } },
  ])("rejects operation/category/id/type mismatch %# without retry", async (result) => {
    const h = setup(result);
    await expect(
      h.client.mutate("createBead", JSON.stringify({ type, id: "beads/a" }), options),
    ).rejects.toMatchObject({ code: "invalid-response", submission: "unknown", httpStatus: 200 });
    expect(h.calls.filter((c) => c.method === "post")).toHaveLength(1);
  });
  it.each(["etag", "location"])(
    "rejects prohibited singleton %s response metadata",
    async (name) => {
      const h = setup(undefined, {
        post: async (url) =>
          json({ outcome: "created", resource: bead }, url, 200, { [name]: "bad" }),
      });
      await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
        code: "invalid-response",
      });
    },
  );
  it("validates owned-Link source correspondence and canonical embedded Link identities", async () => {
    const wrongSource = setup({
      outcome: "created",
      resource: link,
      source: `${scope}beads/other`,
      sourceRevision: "r2",
    });
    await expect(
      wrongSource.client.mutate(
        "createLink",
        JSON.stringify({ type: linkType, source: "beads/a", target: "urn:external" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    const invalidOwned = setup({
      outcome: "created",
      resource: {
        ...bead,
        ownedLinks: { [linkType]: [{ ...link, id: "https://evil.test/links/l" }] },
      },
    });
    await expect(invalidOwned.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
  it.each([
    { ...link, source: "urn:a", target: "urn:b" },
    { ...link, target: { uri: "urn:external", revision: "invented-pin" } },
    { ...link, target: "urn:changed" },
    { ...link, target: `${scope}alias/lead` },
    { ...link, target: "HTTPS://EXAMPLE.TEST/s/beads/a" },
  ])("rejects endpoint/pin/canonicality mismatch %#", async (resource) => {
    const h = setup({ outcome: "created", resource });
    await expect(
      h.client.mutate(
        "createLink",
        JSON.stringify({ type: linkType, source: "beads/a", target: "urn:external" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it("preserves a caller pin and accepts retained alias resolution without current-state lookup", async () => {
    const old = `${scope}beads/old`;
    const result = {
      outcome: "created",
      resource: { ...link, source: { uri: old, revision: "pinned" }, target: bead.id },
    };
    const h = setup(result);
    expect(
      await h.client.mutate(
        "createLink",
        JSON.stringify({
          type: linkType,
          source: { uri: "alias/repointed", revision: "pinned" },
          target: "beads/a",
        }),
        options,
      ),
    ).toMatchObject({ kind: "success", value: result });
    expect(h.calls.filter((c) => c.method === "get").map((c) => c.url)).toEqual([
      `${scope}bdp.json`,
      `${scope}operations/`,
    ]);
  });
  it("rejects a successful alias chain and a hierarchical authority allocation", async () => {
    const alias = setup({ outcome: "created", alias: `${scope}alias/new`, target: bead.id });
    await expect(
      alias.client.mutate(
        "putAlias",
        JSON.stringify({ alias: "alias/new", target: "alias/old" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    const allocated = setup({ outcome: "created", resource: { ...bead, id: `${scope}beads/a/b` } });
    await expect(allocated.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "invalid-response",
    });
    // The same hierarchy is allowed when the creator explicitly supplies it.
    expect(
      (
        await allocated.client.mutate(
          "createBead",
          JSON.stringify({ type, id: "beads/a/b" }),
          options,
        )
      ).kind,
    ).toBe("success");
  });
  it("preserves selected received headers on local errors and strips injected credentials", async () => {
    const headers = {
      "www-authenticate": "Bearer realm=scope",
      allow: "POST",
      location: "https://elsewhere.test/",
      "set-cookie": "secretCookie",
      authorization: "secretToken",
    };
    const h = setup(undefined, {
      post: async () => {
        throw new ReadUpdateTransportError("redirect", "unknown", 307, null, null, headers);
      },
    });
    try {
      await h.client.mutate("createBead", input, options);
      throw Error();
    } catch (error) {
      expect(error).toMatchObject({
        code: "transport",
        submission: "unknown",
        httpStatus: 307,
        headers: {
          "www-authenticate": "Bearer realm=scope",
          allow: "POST",
          location: "https://elsewhere.test/",
        },
      });
      expect(JSON.stringify(error)).not.toContain("secret");
      expect(Object.isFrozen((error as ReadUpdateClientError).headers)).toBe(true);
    }
    const reply = setup(undefined, {
      post: async (url) =>
        json(problem, url, 422, { ...headers, "cache-control": "private, no-store" }),
    });
    const result = await reply.client.mutate("createBead", input, options);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("checks deleted final-live revision only where expectedRevision supplies direct evidence", async () => {
    const h = setup({
      outcome: "deleted",
      deleted: { resourceKind: "bead", resource: { id: bead.id, type, revision: "r2" } },
    });
    await expect(
      h.client.mutate(
        "deleteBead",
        JSON.stringify({ bead: "beads/a", expectedRevision: "r1" }),
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it.each([406, 500])(
    "returns actual native%d distinctly without retry or a fabricated Problem",
    async (status) => {
      let posts = 0;
      const h = setup(undefined, {
        post: async (url) => {
          posts++;
          return empty(url, status);
        },
      });
      expect(await h.client.mutate("createBead", input, options)).toMatchObject({
        kind: "http",
        http: { status },
      });
      expect(posts).toBe(1);
    },
  );
  it("returns canonical direct Problem extensions/status/Retry-After without synthetic member fields", async () => {
    const { status: _status, ...withoutStatus } = problem;
    const body = { ...withoutStatus, extension: { note: "kept" } };
    const h = setup(undefined, {
      post: async (url) =>
        json(body, url, 422, { "cache-control": "private, no-store", "retry-after": "12" }),
    });
    const result = await h.client.mutate("createBead", input, options);
    expect(result).toMatchObject({
      kind: "problem",
      problem: { extension: { note: "kept" } },
      http: { status: 422, retryAfter: "12" },
    });
    if (result.kind !== "problem") throw Error();
    expect(result.problem).not.toHaveProperty("operationIndex");
    expect(result.problem).not.toHaveProperty("status");
  });
  it.each([
    [problem, 409, { "cache-control": "private, no-store" }],
    [{ ...problem, status: undefined }, 409, { "cache-control": "private, no-store" }],
    [{ ...problem, retry: "after-delay" }, 422, { "cache-control": "private, no-store" }],
    [problem, 422, {}],
    [problem, 422, { "cache-control": "private, no-store", "content-type": "application/json" }],
  ] as const)(
    "rejects invalid direct Problem status/retry/media/cache mapping %#",
    async (body, status, headers) => {
      const copy = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      const h = setup(undefined, { post: async (url) => json(copy, url, status, headers) });
      await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
        code: "invalid-response",
        submission: "unknown",
      });
    },
  );
});

describe("Read+Update sequence and client lifetime", () => {
  const members = [
    { operation: "createBead", idempotencyKey: "a", name: "a", type },
    {
      operation: "updateBeadProperties",
      idempotencyKey: "b",
      bead: "@a",
      change: [{ op: "replace", path: "", value: {} }],
    },
    { operation: "deleteBead", idempotencyKey: "c", bead: "beads/missing" },
  ];
  const text = JSON.stringify({ operations: members });
  const result = {
    results: [
      { operationIndex: 0, operationName: "a", outcome: "created", resource: bead },
      { operationIndex: 1, outcome: "updated", resource: bead },
      { ...problem, operationIndex: 2 },
    ],
  };
  it("preserves raw sequence keys/order and continues validating results after a failure", async () => {
    const h = setup(result);
    expect(await h.client.sequence(text)).toMatchObject({ kind: "success", value: result });
    expect(h.calls.at(-1)).toEqual({
      method: "post",
      url: `${scope}operations/sequence`,
      bodyText: text,
    });
  });
  it.each([
    { ...result, results: result.results.slice(0, 2) },
    {
      ...result,
      results: [{ ...result.results[0], operationName: "other" }, ...result.results.slice(1)],
    },
    { ...result, results: [result.results[1], result.results[0], result.results[2]] },
    {
      ...result,
      results: [
        result.results[0],
        { operationIndex: 1, outcome: "updated", resource: { ...bead, id: `${scope}beads/b` } },
        result.results[2],
      ],
    },
    {
      ...result,
      results: [
        result.results[0],
        {
          operationIndex: 1,
          outcome: "deleted",
          deleted: { resourceKind: "bead", resource: { id: bead.id, type, revision: "r1" } },
        },
        result.results[2],
      ],
    },
  ])("rejects count/index/name/kind/observed-binding discrepancy %#", async (reply) => {
    const h = setup(reply);
    await expect(h.client.sequence(text)).rejects.toMatchObject({
      code: "invalid-response",
      submission: "unknown",
    });
  });
  it("rejects an invalid late sequence member before sending any request", async () => {
    const h = setup();
    await expect(
      h.client.sequence(
        JSON.stringify({
          operations: [
            ...members,
            { operation: "deleteBead", idempotencyKey: "a", bead: "beads/a" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(h.calls).toHaveLength(0);
  });
  it("does not infer a missing creator identity from an expired/withheld result", async () => {
    const expired = {
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "idempotency-expired",
      status: 410,
      retry: "never",
    };
    // Independent later member never requires reconstructing the failed creator.
    const h = setup({
      results: [
        { ...expired, operationIndex: 0, operationName: "a" },
        { operationIndex: 1, outcome: "updated", resource: bead },
      ],
    });
    const reply = await h.client.sequence(
      JSON.stringify({ operations: [members[0], { ...members[1], bead: "beads/a" }] }),
    );
    expect(reply.kind).toBe("success");
  });
  it("bounds a custom transport that ignores cancellation before mutation", async () => {
    const h = setup(undefined, { probeScope: () => new Promise(() => {}) }, 15);
    await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "timeout",
      submission: "not-submitted",
    });
  });
  it("bounds unknown delivery after POST and ignores a late result without retry", async () => {
    let release!: (v: ReadUpdateHttpResponse) => void,
      posts = 0;
    const h = setup(
      undefined,
      {
        post: () => {
          posts++;
          return new Promise((r) => {
            release = r;
          });
        },
      },
      15,
    );
    await expect(h.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "timeout",
      submission: "unknown",
      httpStatus: undefined,
    });
    release(json({ outcome: "created", resource: bead }));
    await tick();
    expect(posts).toBe(1);
  });
  it("close promptly settles concurrent uncooperative calls and rejects new calls", async () => {
    let starts = 0;
    const h = setup(
      undefined,
      {
        probeScope: () => {
          starts++;
          return new Promise(() => {});
        },
      },
      1000,
    );
    const one = h.client.discover(),
      two = h.client.operationDirectory();
    const settled = Promise.allSettled([one, two]);
    await tick();
    expect(starts).toBe(2);
    await h.client.close();
    expect((await settled).map((v) => v.status)).toEqual(["rejected", "rejected"]);
    await expect(one).rejects.toMatchObject({ code: "closed", submission: "not-submitted" });
    await expect(h.client.discover()).rejects.toMatchObject({ code: "closed" });
    await h.client.close();
  });
  it("caller abort ends only that call, with unknown mutation delivery after dispatch", async () => {
    const abort = new AbortController();
    let entered = false;
    const h = setup(undefined, {
      post: () => {
        entered = true;
        return new Promise(() => {});
      },
    });
    const pending = h.client.mutate("createBead", input, { ...options, signal: abort.signal });
    const observed = expect(pending).rejects.toMatchObject({
      code: "aborted",
      submission: "unknown",
    });
    await tick();
    expect(entered).toBe(true);
    abort.abort("secret");
    await observed;
    expect((await h.client.discover()).kind).toBe("success");
  });
  it("preaborted call performs no navigation and never exposes abort reasons", async () => {
    const h = setup(),
      abort = new AbortController();
    abort.abort("secretKey");
    const promise = h.client.discover({ signal: abort.signal });
    await expect(promise).rejects.toMatchObject({ code: "aborted", submission: "not-submitted" });
    expect(h.calls).toHaveLength(0);
    try {
      await promise;
    } catch (error) {
      expect(JSON.stringify(error) + String(error)).not.toContain("secretKey");
    }
  });
  it("keeps known pre-dispatch transport refusal distinct and sanitizes external exceptions", async () => {
    const known = setup(undefined, {
      post: async () => {
        throw new ReadUpdateTransportError("invalid-input", "not-submitted");
      },
    });
    await expect(known.client.mutate("createBead", input, options)).rejects.toMatchObject({
      code: "transport",
      submission: "not-submitted",
    });
    const h = setup(undefined, {
      post: async () => {
        throw Object.assign(new ReadUpdateClientError("closed", "not-submitted"), {
          secret: "secretKey",
        });
      },
    });
    try {
      await h.client.mutate("createBead", input, options);
      throw Error();
    } catch (error) {
      expect(error).toBeInstanceOf(ReadUpdateClientError);
      expect(error).toMatchObject({ code: "transport", submission: "unknown" });
      expect(JSON.stringify(error)).not.toContain("secret");
    }
  });
  it("captures configured methods and request key before asynchronous navigation", async () => {
    let release!: (v: ReadUpdateScopeProbeResponse) => void;
    let key: string | undefined;
    const h = setup(undefined, {
      probeScope: () =>
        new Promise((r) => {
          release = r;
        }),
      post: async (url, call) => {
        key = call.idempotencyKey;
        return json({ outcome: "created", resource: bead }, url);
      },
    });
    const inputOptions = { idempotencyKey: "original" };
    const pending = h.client.mutate("createBead", input, inputOptions);
    inputOptions.idempotencyKey = "changed";
    h.transport.post = async () => {
      throw Error("new method must not run");
    };
    await tick();
    release(probe());
    expect((await pending).kind).toBe("success");
    expect(key).toBe("original");
  });
  it.each([0, -1, 1.5, Infinity, NaN, 2_147_483_648])(
    "requires an explicit valid settlement deadline %s",
    (timeout) => {
      expect(() => setup(undefined, {}, timeout)).toThrow(ReadUpdateClientError);
    },
  );
});

describe("operation council regressions", () => {
  it("deducts partially consumed preflight time before scheduling a hanging exchange", async () => {
    vi.useFakeTimers();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = setup(undefined, { probeScope: () => new Promise(() => {}) }, 100);
    try {
      const pending = h.client.mutate("createBead", input, {
        get idempotencyKey() {
          now = 75;
          return "k";
        },
      });
      let delivered = false;
      const result = pending.catch((error: unknown) => {
        delivered = true;
        return error;
      });
      await vi.advanceTimersByTimeAsync(24);
      expect(delivered).toBe(false);
      now = 100;
      await vi.advanceTimersByTimeAsync(1);
      expect(delivered).toBe(true);
      expect(await result).toMatchObject({ code: "timeout", submission: "not-submitted" });
    } finally {
      await h.client.close();
      clock.mockRestore();
      vi.useRealTimers();
    }
  });
  it.each([
    "https://example.test/%73/beads/b",
    "https://example.test/s/beads/../beads/b",
    "https://example.test/s/../other/beads/b",
  ])("rejects disguised local endpoint %s in an update response", async (target) => {
    const h = setup({ outcome: "updated", resource: { ...link, target } });
    await expect(
      h.client.mutate(
        "updateLinkProperties",
        JSON.stringify({
          link: "links/l",
          change: [{ op: "replace", path: "", value: {} }],
        }),
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid-response", submission: "unknown" });
  });
  it.each([
    `${scope}beads/b`,
    "https://example.test/s%2fother/beads/b",
    "http://example.test/s/beads/b",
    "blob:https://example.test/s/beads/b",
  ])("accepts canonical or distinct external endpoint %s", async (target) => {
    const h = setup({ outcome: "updated", resource: { ...link, target } });
    expect(
      (
        await h.client.mutate(
          "updateLinkProperties",
          JSON.stringify({
            link: "links/l",
            change: [{ op: "replace", path: "", value: {} }],
          }),
          options,
        )
      ).kind,
    ).toBe("success");
  });
  it.each(["success", "permanent", "in-progress"])(
    "checks transient creator dependency: %s",
    async (variant) => {
      const transient = {
        type: "https://github.com/gastownhall/bdp/problems/rate-limit",
        code: "rate-limited",
        status: 429,
        retry: "after-delay",
        retryAfter: 1,
      };
      const dependent =
        variant === "success"
          ? { outcome: "updated", resource: bead }
          : variant === "permanent"
            ? problem
            : {
                type: "https://github.com/gastownhall/bdp/problems/conflict",
                code: "idempotency-in-progress",
                status: 409,
                retry: "after-delay",
                retryAfter: 1,
              };
      const h = setup({
        results: [
          { operationIndex: 0, operationName: "a", ...transient },
          { operationIndex: 1, ...dependent },
          { operationIndex: 2, outcome: "created", resource: bead },
        ],
      });
      const response = h.client.sequence(
        JSON.stringify({
          operations: [
            { operation: "createBead", idempotencyKey: "a", name: "a", type },
            {
              operation: "updateBeadProperties",
              idempotencyKey: "b",
              bead: "@a",
              change: [{ op: "replace", path: "", value: {} }],
            },
            { operation: "createBead", idempotencyKey: "c", type },
          ],
        }),
      );
      if (variant === "in-progress") expect((await response).kind).toBe("success");
      else
        await expect(response).rejects.toMatchObject({
          code: "invalid-response",
          submission: "unknown",
        });
    },
  );
});
