import { request as nodeRequest, type Server } from "node:http";
import { type ReadProblem, readProblem, type ScopeReadOperation } from "@bdp/protocol";
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createHttpHandler,
  createNodeHttpServer,
  createPublicReadControls,
  createReadServer,
  listenNodeHttpServer,
  type ReadServer,
  type ScopePort,
  scopePortProblem,
  scopePortSuccess,
} from "./index.js";
import { applyReadHttpSemantics } from "./read-http.js";

const SCOPE = "https://beads.example/read-http/";
const TYPE = "https://work.example/types/task";

describe("shared Read HTTP semantics through the public server", () => {
  let withdraw: () => void;
  const servers: ReadServer[] = [];
  const listeners: Server[] = [];
  beforeEach(() => {
    withdraw = establishReadConformanceEvidenceForTesting("bdptest");
  });
  afterEach(async () => {
    for (const listener of listeners.splice(0)) await closeNodeHttpServer(listener);
    for (const server of servers.splice(0)) await server.close();
    withdraw();
  });

  function fixture(
    options: {
      revision?: string;
      problem?: ReadProblem;
      fault?: Error;
      denied?: boolean;
      properties?: Record<string, unknown>;
    } = {},
  ) {
    const calls: ScopeReadOperation[] = [];
    const controls = createPublicReadControls({
      scope: SCOPE,
      limits: {
        page: { defaultItems: 10, maximumItems: 20 },
        selector: { bytes: 1000, depth: 20, nodes: 100 },
        cursorTtlMilliseconds: 60_000,
      },
    });
    const port: ScopePort = {
      async perform(operation) {
        calls.push(operation);
        if (options.fault) throw options.fault;
        if (options.problem) return scopePortProblem(options.problem);
        if (operation.kind === "resource") {
          if (operation.resource === "type")
            return scopePortSuccess({
              id: operation.id,
              name: "Task",
              describes: "bead",
              conformsTo: [],
            } as never);
          return scopePortSuccess({
            id: operation.id,
            type: TYPE,
            revision: options.revision ?? "rev-1",
            properties: options.properties ?? {},
            ...(operation.resource === "link"
              ? { source: `${SCOPE}beads/a`, target: `${SCOPE}beads/b` }
              : {}),
          } as never);
        }
        if (operation.kind === "properties")
          return scopePortSuccess({ updatedAt: "2099-01-01T00:00:00Z" } as never);
        if (
          options.properties &&
          operation.kind === "collection" &&
          operation.collection === "beads"
        )
          return scopePortSuccess({
            items: [
              {
                id: `${SCOPE}beads/a`,
                type: TYPE,
                revision: "rev-1",
                properties: options.properties,
              },
            ],
            next: null,
          } as never);
        return scopePortSuccess({ items: [], next: null } as never);
      },
    };
    const server = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port,
      aliases: { latest: `${SCOPE}beads/a` },
      readControls: options.denied
        ? {
            ...controls,
            unauthenticatedChallenge: 'Basic realm="read"',
            identityFor: () => readProblem("unauthenticated"),
          }
        : controls,
    });
    servers.push(server);
    const handler = createHttpHandler(server);
    return {
      server,
      handler,
      calls,
      get: (
        target: string,
        headers: ConstructorParameters<typeof Headers>[0] = {},
        method = "GET",
      ) => handler(new Request(new URL(target, SCOPE), { headers, method })),
    };
  }

  it.each([
    [undefined, 200],
    ["*/*", 200],
    ["application/*", 200],
    ["APPLICATION/JSON", 200],
    ["text/html, application/json;q=0.001", 200],
    ["application/json;q=0, */*;q=1", 406],
    ["application/*;q=0, */*;q=1", 406],
    ["application/json;q=1, application/*;q=0", 200],
    ["image/png", 406],
    ["", 406],
    ["application/json;q=0.000", 406],
    ["application/json;q=1.000", 200],
    ["application/json;Q=0", 406],
    ["application/json;q=0.0001", 406],
    ["application/json;q=1.1", 406],
    ['application/json;q="1"', 406],
    ['application/json;profile="a,b;c"', 406],
    ['application/json;profile="a,b;c", */*;q=0.5', 200],
    ['text/plain;note="\\",application/json", image/png', 406],
    [", , application/json ; ; q=1. ,", 200],
    ["application/json-seq", 406],
    ["application/json;charset=utf-8", 406],
    ["application/json; charset=UTF-8", 406],
    ["application/json;q=0.9;charset=utf-8", 406],
    ["application/json;charset=utf-8, */*;q=0.8", 200],
  ])("negotiates JSON for Accept %s", async (accept, status) => {
    const { get, calls } = fixture();
    const response = await get("beads/a", accept === undefined ? {} : { Accept: accept });
    expect(response.status).toBe(status);
    expect(calls).toHaveLength(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("etag")).toBe(status === 406 ? null : '"rev-1"');
    if (status === 406) {
      expect(response.body).toBeUndefined();
      expect(response.headers.has("content-type")).toBe(false);
      expect(response.headers.get("content-length")).toBe("0");
    } else expect(response.body).toMatchObject({ revision: "rev-1" });
  });

  it.each([
    [{ "If-Match": '"rev-1"' }, 200],
    [{ "If-Match": 'W/"rev-1"' }, 412],
    [{ "If-Match": 'w/"rev-1"' }, 412],
    [{ "If-None-Match": 'w/"rev-1"' }, 200],
    [{ "If-None-Match": String.raw`"rev1\", "rev-1"` }, 304],
    [{ "If-Match": '"different", "rev-1"' }, 200],
    [{ "If-Match": "*" }, 200],
    [{ "If-Match": '"missing"', "If-None-Match": "*" }, 412],
    [{ "If-Match": '"rev-1"', "If-None-Match": 'W/"rev-1"' }, 304],
    [{ "If-None-Match": '"rev-1"' }, 304],
    [{ "If-None-Match": 'W/"rev-1"' }, 304],
    [{ "If-None-Match": '"other", W/"rev-1"' }, 304],
    [{ "If-None-Match": "*" }, 304],
    [{ "If-None-Match": ', , W/"rev-1", ,' }, 304],
    [{ "If-None-Match": '"other"' }, 200],
    [{ "If-Match": "rev-1" }, 412],
    [{ "If-None-Match": "rev-1" }, 200],
    [{ "If-None-Match": '*, "rev-1"' }, 200],
    [{ "If-Match": '*, "rev-1"' }, 412],
    [{ "If-Match": '"rev-1" trailing' }, 412],
    [{ "If-None-Match": '"rev-1" trailing' }, 200],
  ])("evaluates tag preconditions %j", async (headers, status) => {
    const { get } = fixture();
    const response = await get("beads/a", headers);
    expect(response.status).toBe(status);
    expect(response.headers.get("etag")).toBe('"rev-1"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    if (status !== 200) {
      expect(response.body).toBeUndefined();
      expect(response.headers.has("content-type")).toBe(false);
      if (status === 304) expect(response.headers.has("content-length")).toBe(false);
    }
  });

  it.each(["part,one", String.raw`part\one`, ""])(
    "compares opaque revision bytes %s",
    async (revision) => {
      // Empty revisions are not valid BDP records; exercise the valid empty HTTP
      // tag directly below while using real records for comma and backslash.
      if (revision === "") {
        const response = applyReadHttpSemantics(
          new Request(SCOPE, { headers: { "If-None-Match": 'W/""' } }),
          {
            status: 200,
            headers: new Headers({ "content-type": "application/json", etag: '""' }),
            body: {},
          },
        );
        expect(response.status).toBe(304);
        return;
      }
      const { get } = fixture({ revision });
      const response = await get("beads/a", { "If-None-Match": `"other", W/"${revision}"` });
      expect(response.status).toBe(304);
    },
  );

  it("compares obs-text bytes in HTTP entity tags", () => {
    // BDP revisions encode non-ASCII bytes before producing validators; this
    // exercises the HTTP grammar directly without changing that projection.
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "application/json", etag: '"rév"' }),
      body: {},
    };
    expect(
      applyReadHttpSemantics(
        new Request(SCOPE, { headers: { "If-None-Match": '"other", W/"rév"' } }),
        response,
      ).status,
    ).toBe(304);
    expect(
      applyReadHttpSemantics(new Request(SCOPE, { headers: { "If-Match": '"rev"' } }), response)
        .status,
    ).toBe(412);
  });

  it("never strongly matches a weak current validator", () => {
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "application/json", etag: 'W/"rev"' }),
      body: {},
    };
    expect(
      applyReadHttpSemantics(new Request(SCOPE, { headers: { "If-Match": '"rev"' } }), response)
        .status,
    ).toBe(412);
    expect(
      applyReadHttpSemantics(
        new Request(SCOPE, { headers: { "If-None-Match": '"rev"' } }),
        response,
      ).status,
    ).toBe(304);
  });

  it.each(["bdp.json", "beads/", "links/", "types/", "types/task", "beads/a?view=properties"])(
    "handles absent validators on %s",
    async (target) => {
      const { get } = fixture();
      expect((await get(target, { "If-Match": '"specific"' })).status).toBe(412);
      expect((await get(target, { "If-Match": "*" })).status).toBe(200);
      expect((await get(target, { "If-None-Match": "*" })).status).toBe(304);
      expect((await get(target, { "If-None-Match": '"specific"' })).status).toBe(200);
      expect((await get(target, { Accept: "image/png", "If-None-Match": "*" })).status).toBe(406);
    },
  );

  it.each(["beads/a", "beads/a?view=properties", "bdp.json"])(
    "does not invent modification dates on %s",
    async (target) => {
      const { get } = fixture();
      const response = await get(target, {
        "If-Modified-Since": "Wed, 01 Jan 2100 00:00:00 GMT",
        "If-Unmodified-Since": "Sat, 01 Jan 2000 00:00:00 GMT",
      });
      expect(response.status).toBe(200);
      expect(response.headers.has("last-modified")).toBe(false);
    },
  );

  it.each([
    "resource-not-found",
    "resource-erased",
    "cursor-expired",
    "foreign-view",
    "invalid-parameter",
    "limit-exceeded",
  ] as const)("keeps ordinary %s before negotiation and conditions", async (code) => {
    const { get } = fixture({ problem: readProblem(code) });
    const normal = await get("beads/a");
    const guarded = await get("beads/a", { Accept: "image/png", "If-None-Match": "*" });
    expect(guarded.status).toBe(normal.status);
    expect(guarded.body).toEqual(normal.body);
    expect(guarded.headers.get("content-type")).toBe("application/problem+json");
  });

  it("keeps authentication before negotiation without consulting the port", async () => {
    const { get, calls } = fixture({ denied: true });
    const response = await get("beads/a", { Accept: "image/png", "If-None-Match": "*" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="read"');
    expect(calls).toHaveLength(0);
  });

  it("keeps alias redirects before negotiation and conditions", async () => {
    const { get } = fixture();
    const response = await get("alias/latest", {
      Accept: "image/png",
      "If-Match": '"absent"',
      "If-None-Match": "*",
    });
    expect(response.status).toBe(307);
    expect(response.body).toBeUndefined();
  });

  it.each([
    [{}, 204],
    [{ "If-Match": "*" }, 204],
    [{ "If-Match": '"specific"' }, 412],
    [{ "If-None-Match": "*" }, 304],
    [{ "If-None-Match": '"specific"' }, 204],
    [{ "If-Match": '"specific"', "If-None-Match": "*" }, 412],
  ])("conditions the existing zero-length Scope representation %j", async (headers, status) => {
    const { get } = fixture();
    for (const method of ["GET", "HEAD"]) {
      const response = await get("", { ...headers, Accept: "image/png" }, method);
      expect(response.status).toBe(status);
      expect(response.body).toBeUndefined();
      expect(response.headers.get("link")).toBe(
        `<${SCOPE}bdp.json>; rel="service-desc"; type="application/json"`,
      );
      expect(response.headers.has("content-type")).toBe(false);
      expect(response.headers.has("vary")).toBe(false);
      expect(response.headers.has("etag")).toBe(false);
      if (status === 304) expect(response.headers.has("content-length")).toBe(false);
      if (status === 412) expect(response.headers.get("content-length")).toBe("0");
    }
  });

  it.each(["GET", "HEAD"])(
    "keeps authorization-dependent discovery private on %s",
    async (method) => {
      const { get, calls } = fixture();
      const anonymous = await get("bdp.json", {}, method);
      expect(anonymous.status).toBe(200);
      expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
      for (const credentials of [{ Cookie: "session=1" }, { Authorization: "Bearer secret" }]) {
        const denied = await get("bdp.json", credentials, method);
        expect(denied.status).toBe(403);
        expect(denied.headers.get("cache-control")).toBe("private, no-store");
        if (method === "GET") expect(denied.body).toMatchObject({ code: "forbidden" });
        else expect(denied.body).toBeUndefined();
      }
      for (const headers of [
        { Accept: "image/png" },
        { "If-None-Match": "*" },
        { "If-Match": '"absent"' },
      ]) {
        const response = await get("bdp.json", headers, method);
        expect(response.status).toBe(headers.Accept ? 406 : headers["If-None-Match"] ? 304 : 412);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toBe("Accept");
        expect(response.body).toBeUndefined();
      }
      expect(calls).toHaveLength(0);
    },
  );

  it.each([{}, { "If-None-Match": "*" }, { "If-Match": '"missing"' }, { Accept: "image/png" }])(
    "strips HEAD bodies while preserving GET decisions and headers %j",
    async (headers) => {
      const { get } = fixture();
      for (const target of ["beads/a", "beads/", "bdp.json", "not-a-route"]) {
        const normal = await get(target, headers);
        const head = await get(target, headers, "HEAD");
        expect(head.status).toBe(normal.status);
        expect(head.body).toBeUndefined();
        for (const [key, value] of normal.headers) expect(head.headers.get(key)).toBe(value);
        if (normal.body !== undefined)
          expect(head.headers.get("content-length")).toBe(
            String(Buffer.byteLength(JSON.stringify(normal.body))),
          );
      }
    },
  );

  it("serves deep Resources and collections over real GET/HEAD with exact UTF-8 lengths", async () => {
    const depth = 12_000;
    const deep = `${"[1,".repeat(depth)}"é😀"${"]".repeat(depth)}`;
    const properties = { deep: JSON.parse(deep) as unknown };
    expect(() => JSON.stringify(properties)).toThrow(RangeError);
    const { server } = fixture({ properties });
    const errors: unknown[] = [];
    const listener = createNodeHttpServer(server, { onError: (error) => errors.push(error) });
    listeners.push(listener);
    await listenNodeHttpServer(listener, {
      host: "127.0.0.1",
      port: 0,
      onError: (error) => errors.push(error),
    });
    const address = listener.address();
    if (address === null || typeof address === "string") throw new Error("No listener address");
    const send = (method: "GET" | "HEAD", path: string) =>
      new Promise<{
        status: number;
        body: string;
        headers: import("node:http").IncomingHttpHeaders;
      }>((resolve, reject) => {
        const request = nodeRequest(
          { host: "127.0.0.1", port: address.port, method, path: `/read-http/${path}` },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      });
    const record = `{"id":"${SCOPE}beads/a","type":"${TYPE}","revision":"rev-1","properties":{"deep":${deep}}}`;
    for (const [path, expected] of [
      ["beads/a", record],
      ["beads/", `{"items":[${record}],"next":null}`],
    ]) {
      if (path === undefined || expected === undefined) throw new Error("missing HTTP fixture");
      const get = await send("GET", path);
      const head = await send("HEAD", path);
      expect(get.status).toBe(200);
      expect(head.status).toBe(200);
      expect(get.body).toBe(expected);
      expect(head.body).toBe("");
      expect(get.headers["content-length"]).toBe(String(Buffer.byteLength(expected)));
      expect(head.headers["content-length"]).toBe(get.headers["content-length"]);
      expect(head.headers.etag).toBe(get.headers.etag);
    }
    expect(errors).toEqual([]);
  });

  it("preserves actual Node wire bodylessness, list headers and ordinary fault precedence", async () => {
    const options: { fault?: Error; properties: Record<string, string> } = {
      properties: { title: "café — naïve ✅ 日本語" },
    };
    const { server } = fixture(options);
    const errors: unknown[] = [];
    const listener = createNodeHttpServer(server, { onError: (error) => errors.push(error) });
    listeners.push(listener);
    await listenNodeHttpServer(listener, {
      host: "127.0.0.1",
      port: 0,
      onError: (error) => errors.push(error),
    });
    const address = listener.address();
    if (address === null || typeof address === "string") throw new Error("No listener address");
    const send = (method: string, path: string, headers: Record<string, string | string[]>) =>
      new Promise<{
        status: number;
        headers: import("node:http").IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        const request = nodeRequest(
          { host: "127.0.0.1", port: address.port, method, path: `/read-http/${path}`, headers },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString(),
              }),
            );
            response.on("error", reject);
          },
        );
        request.on("error", reject);
        request.end();
      });
    const full = await send("GET", "beads/a", {});
    expect(full.status).toBe(200);
    expect(JSON.parse(full.body).properties).toEqual(options.properties);
    expect(Buffer.byteLength(full.body)).toBeGreaterThan(full.body.length);
    expect(full.headers["content-length"]).toBe(String(Buffer.byteLength(full.body)));
    for (const method of ["GET", "HEAD"]) {
      const conditional = await send(method, "beads/a", {
        "If-None-Match": ['"other"', 'W/"rev-1"'],
      });
      expect(conditional.status).toBe(304);
      expect(conditional.body).toBe("");
      expect(conditional.headers.etag).toBe(full.headers.etag);
      expect(conditional.headers.vary).toBe("Accept");
      expect(conditional.headers["cache-control"]).toBe(full.headers["cache-control"]);
      expect(conditional.headers["content-length"]).toBeUndefined();
      const mismatch = await send(method, "beads/a", { "If-Match": 'W/"rev-1"' });
      expect(mismatch.status).toBe(412);
      expect(mismatch.body).toBe("");
      expect(mismatch.headers.etag).toBe(full.headers.etag);
      expect(mismatch.headers.vary).toBe("Accept");
      const refusal = await send(method, "beads/a", {
        Accept: ["application/json;q=0", "*/*;q=1"],
        "If-None-Match": "*",
      });
      expect(refusal.status).toBe(406);
      expect(refusal.body).toBe("");
      expect(refusal.headers.etag).toBeUndefined();
      const missing = await send(method, "missing", { Accept: "image/png", "If-None-Match": "*" });
      expect(missing.status).toBe(404);
      expect(
        method === "HEAD"
          ? missing.body === ""
          : JSON.parse(missing.body).code === "resource-not-found",
      ).toBe(true);
    }
    const head = await send("HEAD", "beads/a", {});
    expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe(full.headers["content-length"]);
    expect((await send("POST", "beads/a", { Accept: "image/png", "If-Match": "*" })).status).toBe(
      405,
    );
    expect(errors).toEqual([]);
    const fault = new Error("private backend fault");
    options.fault = fault;
    for (const method of ["GET", "HEAD"]) {
      const failure = await send(method, "beads/a", { Accept: "image/png", "If-None-Match": "*" });
      expect(failure.status).toBe(500);
      expect(failure.body).toBe("");
      expect(failure.headers.etag).toBeUndefined();
      expect(failure.headers["content-type"]).toBeUndefined();
      expect(failure.headers["content-length"]).toBe("0");
    }
    expect(errors).toEqual([fault, fault]);
  });

  it("does not suppress invalid backend data or an unexpected internal failure with 406", async () => {
    const fault = new Error("private failure");
    const { get } = fixture({ fault });
    await expect(get("beads/a", { Accept: "image/png", "If-None-Match": "*" })).rejects.toBe(fault);
    const invalid = fixture({ revision: "" });
    await expect(invalid.get("beads/a", { Accept: "image/png" })).rejects.toThrow();
  });
});
