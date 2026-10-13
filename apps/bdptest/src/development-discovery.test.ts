import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawPost } from "../test-support/raw-development-http.js";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createReadUpdateFetchTransport, BdpReadUpdateClient } from "@bdp/client";
import {
  parseReadUpdateDiscovery,
  parseReadUpdateOperationDirectory,
  parseReadUpdateMutationResult,
  parseReadUpdateSequenceResponse,
  parseBeadRecord,
  type ReadUpdateOperationDirectory,
} from "@bdp/protocol";
import {
  DEVELOPMENT_BEAD_TYPE as beadType,
  DEVELOPMENT_LINK_TYPE as linkType,
} from "@bdp/server/development";
import {
  startCanonicalDevelopmentFixture,
  startPrivateRuntime,
  canonicalDevelopmentComposition,
} from "../test-support/development-discovery.js";
import type { DevelopmentHttpComposition } from "../../../packages/server/src/development-runtime.js";
import type { LifecycleScheduler } from "../../../packages/server/src/sequence-executor.js";

const token = "development_discovery_credential_0123456789";
const auth = { authorization: `Bearer ${token}` };
const directories: string[] = [];
const servers: Awaited<ReturnType<typeof startCanonicalDevelopmentFixture>>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw Error("required observation missing");
  return value;
}
function directory() {
  const value = mkdtempSync(path.join(tmpdir(), "bdp-canonical-"));
  directories.push(value);
  return value;
}
async function start(scheduler?: LifecycleScheduler) {
  const dir = directory();
  const options = { directory: dir, port: 0, create: true, token };
  const server = await startCanonicalDevelopmentFixture(options, scheduler);
  servers.push(server);
  const transport = createReadUpdateFetchTransport({
    scope: server.scope,
    credential: () => token,
    limits: {
      requestBodyBytes: 128 * 1024,
      responseBodyBytes: 2 * 1024 * 1024,
      responseTimeoutMs: 5000,
      cleanupTimeoutMs: 1000,
    },
  });
  const probe = await transport.probeScope();
  expect(probe.status).toBe(204);
  const link = probe.headers.link;
  expect(link).toMatch(/; rel="service-desc"; type="application\/json"$/);
  const descriptor = new URL(required(/^<([^>]+)>/.exec(required(link))?.[1]), server.scope).href;
  const discoveryResponse = await transport.get(descriptor);
  if (discoveryResponse.kind !== "json") throw Error("missing discovery");
  const discovery = parseReadUpdateDiscovery(discoveryResponse.body);
  const received = await transport.get(discovery.operations);
  if (received.kind !== "json") throw Error("missing directory");
  const operations = parseReadUpdateOperationDirectory(received.body);
  const target = (name: keyof ReadUpdateOperationDirectory) =>
    new URL(operations[name], discovery.operations).href;
  async function wire(
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
    body?: string,
    signal?: AbortSignal,
  ) {
    const response = await fetch(new URL(url, server.scope), {
      method,
      headers: { ...auth, ...headers },
      redirect: "manual",
      ...(body === undefined ? {} : { body }),
      ...(signal === undefined ? {} : { signal }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      value: text ? JSON.parse(text) : undefined,
    };
  }
  const post = (name: keyof ReadUpdateOperationDirectory, input: unknown, key?: string) =>
    wire(
      target(name),
      "POST",
      {
        "content-type": "application/json",
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
      JSON.stringify(input),
    );
  return { server, dir, options, transport, discovery, descriptor, operations, target, wire, post };
}
function resource(response: Awaited<ReturnType<Awaited<ReturnType<typeof start>>["post"]>>) {
  expect(response.status, response.text).toBe(200);
  expect(response.headers.get("etag")).toBeNull();
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = parseReadUpdateMutationResult(response.value);
  if (!result.resource) throw Error("missing postimage");
  return result.resource;
}

// These observations exercise a source-only, non-attesting composition. They do not
// populate the normative catalogs, authorize installed advertisement or qualify U2 policy.
describe("private canonical Read+Update composition", () => {
  it("cold-navigates all eight singleton targets plus sequence and reads their actual effects", async () => {
    const h = await start();
    expect(new URL(h.server.scope).pathname).toBe("/acme/");
    expect(h.discovery).toMatchObject({
      profile: "read-update",
      aliases: `${h.server.scope}alias/`,
    });
    expect(Object.keys(h.operations).sort()).toEqual([
      "createBead",
      "createLink",
      "deleteAlias",
      "deleteBead",
      "deleteLink",
      "putAlias",
      "sequence",
      "updateBead",
      "updateLink",
    ]);
    const a = resource(
      await h.post(
        "createBead",
        { id: "beads/a", type: beadType, properties: { n: 1 }, metadata: { owner: "test" } },
        "a",
      ),
    );
    expect((await h.wire(a.id)).value).toEqual(a);
    const updated = resource(
      await h.post(
        "updateBead",
        {
          bead: a.id,
          expectedRevision: a.revision,
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        },
        "update",
      ),
    );
    expect((await h.wire(a.id)).value).toEqual(updated);
    const edge = resource(
      await h.post(
        "createLink",
        { id: "links/l", type: linkType, source: a.id, target: a.id, metadata: { owner: "old" } },
        "link",
      ),
    );
    const changed = resource(
      await h.post(
        "updateLink",
        {
          link: edge.id,
          expectedRevision: edge.revision,
          metadataChange: [{ op: "replace", path: "/owner", value: "new" }],
        },
        "ulink",
      ),
    );
    expect((await h.wire(edge.id)).value).toEqual(changed);
    const put = await h.post("putAlias", { alias: "alias/latest", target: a.id }, "alias");
    expect(put.value).toMatchObject({ outcome: "created", target: a.id });
    const alias = await h.wire(new URL("latest", h.discovery.aliases).href);
    expect(alias.status).toBe(307);
    expect(alias.headers.get("location")).toBe(a.id);
    expect(alias.text).toBe("");
    expect((await h.post("deleteAlias", { alias: "alias/latest" }, "unalias")).value.outcome).toBe(
      "deleted",
    );
    expect((await h.wire("alias/latest")).status).toBe(404);
    expect(
      (await h.post("deleteLink", { link: edge.id, expectedRevision: changed.revision }, "unlink"))
        .value.outcome,
    ).toBe("deleted");
    expect((await h.wire(edge.id)).status).toBe(404);
    expect(
      (await h.post("deleteBead", { bead: a.id, expectedRevision: updated.revision }, "delete"))
        .value.outcome,
    ).toBe("deleted");
    expect((await h.wire(a.id)).status).toBe(404);
    const sequence = await h.post("sequence", {
      operations: [
        { operation: "createBead", name: "new", idempotencyKey: "seq_create", type: beadType },
        {
          operation: "updateBead",
          bead: "@new",
          idempotencyKey: "seq_update",
          propertiesChange: [{ op: "add", path: "/n", value: 3 }],
        },
      ],
    });
    expect(sequence.status).toBe(200);
    const results = parseReadUpdateSequenceResponse(sequence.value).results;
    expect(results[1]).toMatchObject({ outcome: "updated", resource: { properties: { n: 3 } } });
    if (!results[1] || !("resource" in results[1]) || !results[1].resource)
      throw Error("no dependent result");
    const dependent = parseBeadRecord(results[1].resource);
    expect((await h.wire(dependent.id)).value).toEqual(dependent);
    const client = new BdpReadUpdateClient({
      scope: h.server.scope,
      transport: h.transport,
      settlementTimeoutMs: 5000,
    });
    try {
      expect(await client.discover()).toMatchObject({
        kind: "success",
        value: { profile: "read-update" },
      });
    } finally {
      client.close();
    }
  });

  it("preserves methods, HEAD, conditional Read and Accept on the canonical routes", async () => {
    const h = await start();
    for (const url of [h.server.scope, h.descriptor, h.discovery.operations]) {
      const get = await h.wire(url),
        head = await h.wire(url, "HEAD");
      expect(head.status).toBe(get.status);
      expect(head.text).toBe("");
      expect(head.headers.get("link")).toBe(get.headers.get("link"));
      expect((await h.wire(url, "GET", { "if-none-match": "*" })).status).toBe(304);
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const r = await h.wire(url, method);
        expect(r.status).toBe(405);
        expect(r.headers.get("allow")).toBe("GET, HEAD");
        expect(r.text).toBe("");
      }
    }
    for (const name of Object.keys(h.operations) as (keyof ReadUpdateOperationDirectory)[])
      for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const r = await h.wire(h.target(name), method);
        expect(r.status).toBe(405);
        expect(r.headers.get("allow")).toBe("POST");
        expect(r.text).toBe("");
      }
    for (const url of [h.descriptor, h.discovery.operations]) {
      const r = await h.wire(url, "GET", { accept: "text/plain" });
      expect(r.status).toBe(406);
      expect(r.text).toBe("");
    }
    const a = resource(await h.post("createBead", { id: "beads/a", type: beadType }, "a"));
    const get = await h.wire(a.id),
      head = await h.wire(a.id, "HEAD");
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(get.text)));
    expect(
      (await h.wire(a.id, "GET", { "if-none-match": required(get.headers.get("etag")) })).status,
    ).toBe(304);
    expect((await h.wire(a.id, "GET", { "if-match": '"wrong"' })).status).toBe(412);
    expect((await h.wire(a.id, "HEAD", { accept: "text/plain" })).status).toBe(406);
    expect((await h.wire(a.id, "POST")).status).toBe(405);
  });

  it("preserves cross-carrier keys, guards, retained failures and independent tail outcomes", async () => {
    const h = await start();
    const input = { id: "beads/a", type: beadType };
    const a = resource(await h.post("createBead", input, "same"));
    const replay = await h.post("sequence", {
      operations: [{ operation: "createBead", idempotencyKey: "same", ...input }],
    });
    expect(replay.value.results[0].resource).toEqual(a);
    const ops = [
      {
        operation: "updateBead",
        idempotencyKey: "failed",
        bead: a.id,
        expectedRevision: "wrong",
        propertiesChange: [{ op: "add", path: "/bad", value: true }],
      },
      { operation: "createBead", idempotencyKey: "tail", id: "beads/tail", type: beadType },
    ];
    const partial = await h.post("sequence", { operations: ops });
    expect(partial.value.results[0].code).toBe("revision-mismatch");
    expect(partial.value.results[1].outcome).toBe("created");
    expect((await h.wire(a.id)).value).toEqual(a);
    expect((await h.wire("beads/tail")).value).toEqual(partial.value.results[1].resource);
    const { operation: _op, idempotencyKey: _key, ...failed } = required(ops[0]);
    expect((await h.post("updateBead", failed, "failed")).value.code).toBe("revision-mismatch");
    expect(
      (await h.post("updateBead", { ...failed, expectedRevision: a.revision }, "failed")).value
        .code,
    ).toBe("idempotency-conflict");
    const tail = resource(await h.post("createBead", { id: "beads/tail", type: beadType }, "tail"));
    expect(tail).toEqual(partial.value.results[1].resource);
    expect((await h.post("sequence", { operations: ops })).value).toEqual(partial.value);
  });

  it("rejects receiving and negotiation failures before unknown key capture, preserving retained precedence", async () => {
    const h = await start();
    const input = JSON.stringify({ id: "beads/a", type: beadType });
    const headers = { "content-type": "application/json", "idempotency-key": "a" };
    const url = h.target("createBead");
    for (const [extra, body, status] of [
      [{ accept: "text/plain" }, input, 406],
      [{ "content-type": "text/plain" }, input, 415],
      [{ origin: "https://elsewhere.test" }, input, 403],
      [{}, "{", 400],
      [{}, "x".repeat(65537), 413],
    ] as const)
      expect((await h.wire(url, "POST", { ...headers, ...extra }, body)).status).toBe(status);
    expect((await h.wire("beads/a")).status).toBe(404);
    const a = resource(await h.post("createBead", JSON.parse(input), "a"));
    const equalRefusal = await h.wire(url, "POST", { ...headers, accept: "text/plain" }, input);
    expect(equalRefusal.status).toBe(406);
    expect(equalRefusal.text).toBe("");
    expect((await h.wire("beads/a")).value).toEqual(a);
    expect(resource(await h.post("createBead", JSON.parse(input), "a"))).toEqual(a);
    const conflict = await h.wire(
      url,
      "POST",
      { ...headers, accept: "text/plain" },
      JSON.stringify({ id: "beads/b", type: beadType }),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.value.code).toBe("idempotency-conflict");
    for (const u of [h.server.scope, h.descriptor, h.discovery.operations, url]) {
      const r = await fetch(u);
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("Bearer");
      await r.body?.cancel();
    }
    for (const method of ["GET", "HEAD", "POST", "PUT"])
      expect((await h.wire(`${h.discovery.operations}unknown`, method)).status).toBe(404);
  });

  it("enforces advertised body and sequence bounds without partial admission", async () => {
    const h = await start();
    expect(h.discovery.limits).toMatchObject({
      request: { bodyBytes: 65536 },
      sequence: { operations: 32 },
      validation: { diagnostics: 32, diagnosticBytes: 524288 },
    });
    expect(h.discovery.limits?.retention).toBeUndefined();
    expect(h.discovery.limits?.resource).toBeUndefined();
    const base = JSON.stringify({ id: "beads/exact", type: beadType });
    const padded = base + " ".repeat(65536 - Buffer.byteLength(base));
    resource(
      await h.wire(
        h.target("createBead"),
        "POST",
        { "content-type": "application/json", "idempotency-key": "exact" },
        padded,
      ),
    );
    const operations = Array.from({ length: 33 }, (_, i) => ({
      operation: "createBead",
      idempotencyKey: `many${i}`,
      id: `beads/m${i}`,
      type: beadType,
    }));
    const refused = await h.post("sequence", { operations });
    expect(refused.status).toBe(413);
    expect((await h.wire("beads/m0")).status).toBe(404);
    expect((await h.wire("beads/m32")).status).toBe(404);
    const accepted = await h.post("sequence", { operations: operations.slice(0, 32) });
    expect(accepted.status).toBe(200);
    expect(accepted.value.results).toHaveLength(32);
    expect(accepted.value.results.every((r: { outcome: string }) => r.outcome === "created")).toBe(
      true,
    );
    expect((await h.wire("beads/m31")).status).toBe(200);
  });

  it("serves inherited scalar, view, selector, Type inventory and immutable pagination reads from live state", async () => {
    const h = await start();
    const a = resource(
      await h.post(
        "createBead",
        { id: "beads/a", type: beadType, properties: { n: 1 }, metadata: { tag: "m" } },
        "a",
      ),
    );
    resource(await h.post("createBead", { id: "beads/b", type: beadType }, "b"));
    const c = resource(await h.post("createBead", { id: "beads/c", type: beadType }, "c"));
    const properties = await h.wire("beads/a?view=properties");
    expect(properties.value).toEqual({ n: 1 });
    const complete = await h.wire(a.id);
    expect(properties.headers.get("etag")).toBe(complete.headers.get("etag"));
    expect((await h.wire("beads/a?view=properties", "HEAD")).headers.get("etag")).toBe(
      complete.headers.get("etag"),
    );
    expect(
      (
        await h.wire("beads/a?view=properties", "GET", {
          "if-none-match": required(complete.headers.get("etag")),
        })
      ).status,
    ).toBe(304);
    expect((await h.wire(a.id)).value.metadata).toEqual(a.metadata);
    const page = await h.wire("beads/?limit=1");
    expect(page.value.items).toEqual([a]);
    expect(typeof page.value.next).toBe("string");
    await h.post("deleteBead", { bead: c.id, expectedRevision: c.revision }, "delete_c");
    resource(await h.post("createBead", { id: "beads/d", type: beadType }, "d"));
    const second = await h.wire(page.value.next),
      third = await h.wire(second.value.next);
    expect(third.value.items).toEqual([c]);
    const fresh = await h.wire("beads/");
    expect(fresh.value.items.map((x: { id: string }) => x.id)).toEqual([
      a.id,
      `${h.server.scope}beads/b`,
      `${h.server.scope}beads/d`,
    ]);
    const selected = await h.wire(
      `beads/?selector=${encodeURIComponent("$[?@.properties.n == 1]")}`,
    );
    expect(selected.value.items).toEqual([a]);
    const types = await h.wire("types/");
    expect(types.status).toBe(200);
    expect(types.value.items.map((x: { id: string }) => x.id).sort()).toEqual([beadType, linkType]);
    expect((await h.wire("beads/?limit=101")).status).toBe(413);
    expect(
      (await h.wire(`beads/?selector=${encodeURIComponent(`$${" ".repeat(4096)}`)}`)).status,
    ).toBe(413);
  });

  it("rejects malformed private compositions before provisioning and closes an owner after factory failure", async () => {
    for (const scopePath of [undefined, "acme/", "//evil/", "/acme/../", "/acme/?q=1"]) {
      const dir = directory();
      await expect(
        startPrivateRuntime(
          { directory: dir, port: 0, create: true, token },
          undefined,
          undefined,
          { ...canonicalDevelopmentComposition, scopePath } as DevelopmentHttpComposition,
        ),
      ).rejects.toThrow();
      expect(existsSync(path.join(dir, "reference.sqlite"))).toBe(false);
    }
    let captured: Parameters<DevelopmentHttpComposition["createReadRoute"]>[0] | undefined;
    const dir = directory();
    await expect(
      startPrivateRuntime({ directory: dir, port: 0, create: true, token }, undefined, undefined, {
        ...canonicalDevelopmentComposition,
        createReadRoute(authority) {
          captured = authority;
          throw Error("fixture construction failed");
        },
      }),
    ).rejects.toThrow("fixture construction failed");
    expect(Object.keys(required(captured)).sort()).toEqual([
      "discover",
      "limits",
      "perform",
      "resolveAlias",
      "scope",
    ]);
    await expect(required(captured).discover()).rejects.toThrow();
  });
});

function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("bounded observation timed out")), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}

it("reads a committed prefix during a real HTTP disconnect, drains and replays exact keys after reopen", async () => {
  let turns = 0,
    release: (() => void) | undefined;
  let signalParked!: () => void;
  const parked = new Promise<void>((resolve) => {
    signalParked = resolve;
  });
  const scheduler: LifecycleScheduler = {
    delay(ms, callback) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    turn(callback) {
      let cancelled = false;
      const timer = setImmediate(() => {
        if (++turns === 2) {
          release = () => {
            if (!cancelled) callback();
          };
          signalParked();
        } else if (!cancelled) callback();
      });
      return () => {
        cancelled = true;
        clearImmediate(timer);
      };
    },
  };
  const h = await start(scheduler);
  const input = {
    operations: [
      { operation: "createBead", idempotencyKey: "prefix", id: "beads/prefix", type: beadType },
      {
        operation: "updateBead",
        idempotencyKey: "miss",
        bead: "beads/missing",
        propertiesChange: [{ op: "add", path: "/x", value: 1 }],
      },
      { operation: "createBead", idempotencyKey: "tail", id: "beads/tail", type: beadType },
    ],
  };
  const request = httpRequest(h.target("sequence"), {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
  });
  const detached = new Promise<void>((resolve, reject) => {
    request.once("error", () => resolve());
    request.once("response", (r) => {
      r.resume();
      reject(Error("response arrived before disconnect"));
    });
  });
  request.setTimeout(5000, () => request.destroy(Error("observation timed out")));
  request.end(JSON.stringify(input));
  try {
    await bounded(parked);
    const prefix = await h.wire("beads/prefix");
    expect(prefix.status).toBe(200);
    expect((await h.wire("beads/tail")).status).toBe(404);
    request.destroy(Error("intentional client disconnect"));
    await bounded(detached);
    const closing = h.server.close();
    required(release)();
    release = undefined;
    await bounded(closing);
    const reopened = await startCanonicalDevelopmentFixture({
      ...h.options,
      create: false,
      port: Number(new URL(h.server.scope).port),
    });
    servers.push(reopened);
    const replay = await h.post("sequence", input);
    expect(replay.status).toBe(200);
    expect(replay.value.results[0].resource).toEqual(prefix.value);
    expect(replay.value.results[1].code).toBe("resource-not-found");
    expect(replay.value.results[2].outcome).toBe("created");
    expect((await h.wire("beads/tail")).value).toEqual(replay.value.results[2].resource);
    expect((await h.post("sequence", input)).value).toEqual(replay.value);
  } finally {
    request.destroy();
    release?.();
    await detached.catch(() => undefined);
  }
});

it("uses real raw receiving gates at scoped targets without capturing rejected keys", async () => {
  const h = await start();
  const originScope = new URL("/", h.server.scope).href;
  const target = new URL(h.target("createBead")).pathname;
  const input = JSON.stringify({ id: "beads/raw", type: beadType });
  const fields = [
    "Host",
    new URL(h.server.scope).host,
    "Authorization",
    `Bearer ${token}`,
    "Content-Type",
    "application/json",
    "Idempotency-Key",
    "raw",
  ];
  for (const [targetPath, headers, body] of [
    [target, [...fields, "Authorization", `Bearer ${token}`], input],
    [target, [...fields, "Idempotency-Key", "raw"], input],
    [target, fields.map((v) => (v === new URL(h.server.scope).host ? "foreign.test" : v)), input],
    ["/acme/%2e%2e/operations/create-bead", fields, input],
    [target, fields, Buffer.from([0xff])],
  ] as const) {
    const response = await rawPost(originScope, targetPath, [...headers], body);
    expect(response.status).toBe(400);
  }
  expect((await h.wire("beads/raw")).status).toBe(404);
  const created = resource(await h.post("createBead", JSON.parse(input), "raw"));
  expect((await h.wire(created.id)).value).toEqual(created);
});

it("emits bounded numeric diagnostics from current main's formatter and replays them unchanged", async () => {
  const h = await start();
  const properties = Array.from({ length: 33 }, (_, i) => `"p${i}":1e400`).join(",");
  const input = `{"id":"beads/numeric","type":"${beadType}","properties":{${properties}}}`;
  const response = await h.wire(
    h.target("createBead"),
    "POST",
    { "content-type": "application/json", "idempotency-key": "numeric" },
    input,
  );
  expect(response.status).toBe(422);
  expect(response.value.code).toBe("validation-failed");
  expect(response.value.diagnostics).toHaveLength(32);
  expect(response.value.diagnosticsTruncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(response.value.diagnostics))).toBeLessThanOrEqual(
    Number(required(required(h.discovery.limits).validation).diagnosticBytes),
  );
  expect((await h.wire("beads/numeric")).status).toBe(404);
  expect(
    (
      await h.wire(
        h.target("createBead"),
        "POST",
        { "content-type": "application/json", "idempotency-key": "numeric" },
        input,
      )
    ).value,
  ).toEqual(response.value);
  const corrected = { id: "beads/numeric", type: beadType, properties: { p0: 1 } };
  expect((await h.post("createBead", corrected, "numeric")).value.code).toBe(
    "idempotency-conflict",
  );
  const created = resource(await h.post("createBead", corrected, "numeric_fixed"));
  expect((await h.wire(created.id)).value).toEqual(created);
});

it("lets the SDK discover, mutate, alias-resolve and read without supplied operation URLs", async () => {
  const h = await start();
  const client = new BdpReadUpdateClient({
    scope: h.server.scope,
    transport: h.transport,
    settlementTimeoutMs: 5000,
  });
  try {
    expect(await client.operationDirectory()).toMatchObject({
      kind: "success",
      value: h.operations,
    });
    const created = await client.mutate(
      "createBead",
      JSON.stringify({ id: "beads/sdk", type: beadType, properties: { title: "from SDK" } }),
      { idempotencyKey: "sdk_create" },
    );
    if (created.kind !== "success" || !created.value.resource) throw Error("SDK create failed");
    const a = parseBeadRecord(created.value.resource);
    expect(await client.read({ kind: "resource", resource: "bead", id: a.id })).toMatchObject({
      kind: "success",
      value: a,
    });
    expect(
      await client.mutate(
        "putAlias",
        JSON.stringify({ alias: "alias/sdk-current", target: a.id }),
        {
          idempotencyKey: "sdk_alias",
        },
      ),
    ).toMatchObject({ kind: "success", value: { target: a.id } });
    expect(await client.resolveAlias(`${h.server.scope}alias/sdk-current`)).toMatchObject({
      kind: "success",
      value: { target: a.id },
    });
    const edge = resource(
      await h.post(
        "createLink",
        { id: "links/sdk-edge", type: linkType, source: a.id, target: a.id },
        "sdk_link",
      ),
    );
    expect((await h.wire("beads/sdk?view=links&direction=both")).value.items).toEqual([edge]);
    expect((await h.wire(`links/?source=${encodeURIComponent(a.id)}`)).value.items).toEqual([edge]);
    const inclusion = await h.wire("beads/sdk?include=links&direction=both");
    // Optional aggregate is not installed; incident-link view remains supported.
    expect(inclusion.status).toBe(400);
  } finally {
    await client.close();
  }
});

it("contains invalid private route results and keeps the installed facade non-advertising", async () => {
  const dir = directory();
  await expect(
    startPrivateRuntime({ directory: dir, port: 0, create: true, token }, undefined, undefined, {
      ...canonicalDevelopmentComposition,
      createReadRoute: (() => null) as unknown as DevelopmentHttpComposition["createReadRoute"],
    }),
  ).rejects.toThrow("invalid private Read route");
  // Public options cannot carry the private fourth-argument capability.
  const { startDevelopmentReferenceServer } = await import("@bdp/server/development");
  const ordinary = await startDevelopmentReferenceServer({
    directory: directory(),
    port: 0,
    create: true,
    token,
    ...{ composition: canonicalDevelopmentComposition },
  });
  servers.push(ordinary);
  const response = await fetch(ordinary.scope, { headers: auth });
  expect(response.headers.get("link")).toBeNull();
  expect(await response.json()).toMatchObject({ development: true, claimEligible: false });
  const descriptor = await fetch(new URL("bdp.json", ordinary.scope), { headers: auth });
  expect(descriptor.status).toBe(404);
  await descriptor.body?.cancel();
});
