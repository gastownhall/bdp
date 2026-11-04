/** Independent wire oracle for the explicit canonical Core/Write composition. */
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startReferenceService } from "../../../packages/server/src/reference.js";
import { RetainedClient, createRetainedFetchTransport } from "@bdp/client";
const scope = "https://canonical.invalid/work/";
const token = "C".repeat(32);
const media = "application/vnd.bdp.v0.1+json";
const disposals: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of disposals.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-canonical-ref-"));
  disposals.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "canonical-wire",
    scope,
    credentials: [
      { token, principal: "p" },
      { token: "D".repeat(32), principal: "other" },
    ],
  };
  let server = await startReferenceService(config);
  disposals.push(() => server.close());
  async function wire(
    target: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const address = new URL(server.listenUrl),
      url = new URL(target);
    const text = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      text: string;
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: address.hostname,
          port: address.port,
          method,
          path: url.pathname + url.search,
          headers: {
            host: url.host,
            authorization: "Bearer " + token,
            accept: media,
            ...(text === undefined
              ? {}
              : { "content-type": media, "content-length": String(Buffer.byteLength(text)) }),
            ...extra,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  }
  const post = (operation: keyof typeof server.navigation.targets, body: unknown, key: string) =>
    wire(server.navigation.targets[operation], "POST", body, { "idempotency-key": key });
  async function node(id: string) {
    const result = await post(
      "createBead",
      { id, type: "https://types.invalid/ordinary", properties: { id } },
      "create-" + id.replace(/[^A-Za-z0-9_-]/g, "_"),
    );
    expect(result.status).toBe(200);
    return JSON.parse(result.text).resource;
  }
  return {
    wire,
    post,
    node,
    get server() {
      return server;
    },
    async reopen() {
      await server.close();
      server = await startReferenceService({ ...config, create: false });
    },
  };
}
describe("canonical reference Core and ordinary Write", () => {
  it("serves discovered inventories, kind/owner metadata, stable resizable snapshots and HEAD", async () => {
    const f = await fixture();
    const landing = await f.wire(scope);
    expect(landing.status).toBe(204);
    expect(landing.headers.link).toContain(scope + "bdp");
    const discovery = JSON.parse((await f.wire(scope + "bdp")).text);
    expect(discovery).toMatchObject({
      profile: "write",
      scope,
    });
    expect(discovery).not.toHaveProperty("beads");
    expect(discovery).not.toHaveProperty("links");
    expect(discovery).not.toHaveProperty("events");
    expect(discovery).not.toHaveProperty("types");
    for (const id of ["z", "a", "m", "n"]) await f.node(id);
    const first = await f.wire(scope + "bdp/beads?limit=1");
    expect(first.status, first.text).toBe(200);
    expect(first.headers["bdp-collection-kind"]).toBe("bead");
    expect(first.headers["bdp-resource-kind"]).toBeUndefined();
    expect(first.headers["x-bdp-private-fixture"]).toBeUndefined();
    const page = JSON.parse(first.text);
    expect(page.items.map((x: { id: string }) => x.id)).toEqual([scope + "a"]);
    await f.node("later");
    const next = new URL(page.next);
    next.searchParams.set("limit", "2");
    const second = await f.wire(next.href);
    expect(JSON.parse(second.text).items.map((x: { id: string }) => x.id)).toEqual([
      scope + "m",
      scope + "n",
    ]);
    expect((await f.wire(next.href)).text).toBe(second.text);
    const head = await f.wire(next.href, "HEAD");
    expect(head.text).toBe("");
    expect(head.headers.etag).toBe(second.headers.etag);
    const notModified = await f.wire(next.href, "GET", undefined, {
      "if-none-match": String(second.headers.etag),
    });
    expect(notModified.status).toBe(304);
    expect(notModified.text).toBe("");
    expect(
      (await f.wire(next.href, "GET", undefined, { authorization: "Bearer " + "D".repeat(32) }))
        .status,
    ).toBe(409);
    expect(
      (await f.wire(next.href + "&type=" + encodeURIComponent("https://types.invalid/ordinary")))
        .status,
    ).toBe(400);
    await f.reopen();
    expect((await f.wire(next.href)).status).toBe(410);
  });
  it("keeps ordinary Type Beads, exact endpoint pins, incident direction and aliases native", async () => {
    const f = await fixture();
    const a = await f.node("a");
    await f.node("b");
    const definition = await f.post(
      "createBead",
      {
        id: "type-definition",
        type: "https://types.invalid/metatype",
        properties: { propertiesSchema: { type: "object" } },
      },
      "definition",
    );
    expect(definition.status).toBe(200);
    const edge = await f.post(
      "createLink",
      {
        id: "edge",
        type: { uri: "https://types.invalid/edge", revision: "exact-type" },
        source: { uri: "a", revision: a.revision },
        target: "b",
      },
      "edge",
    );
    expect(edge.status).toBe(200);
    const read = await f.wire(scope + "edge");
    expect(read.headers["bdp-resource-kind"]).toBe("link");
    expect(JSON.parse(read.text).source).toEqual({ uri: scope + "a", revision: a.revision });
    const outgoing = await f.wire(scope + "a?view=links&direction=outbound&source=a");
    expect(outgoing.status, outgoing.text).toBe(200);
    expect(outgoing.headers["bdp-resource-kind"]).toBe("bead");
    expect(outgoing.headers["bdp-collection-kind"]).toBe("link");
    expect(JSON.parse(outgoing.text).items).toHaveLength(1);
    expect(JSON.parse((await f.wire(scope + "a?view=links&direction=inbound")).text)).toEqual({
      items: [],
      next: null,
    });
    const put = await f.post("putAlias", { alias: "aliases/one", target: "a" }, "alias");
    expect(put.status).toBe(200);
    const alias = await f.wire(scope + "aliases/one", "HEAD");
    expect(alias.status).toBe(307);
    expect(alias.headers.location).toBe(scope + "a");
    expect(alias.text).toBe("");
    expect(alias.headers["bdp-resource-kind"]).toBeUndefined();
    expect((await f.wire(scope + "aliases/one?view=properties")).status).toBe(404);
    expect((await f.wire(scope + "edge?view=links")).status).toBe(400);
    expect((await f.wire(scope + "absent?view=links")).status).toBe(404);
    await f.reopen();
    expect(
      (
        await f.post(
          "createLink",
          {
            id: "edge",
            type: { uri: "https://types.invalid/edge", revision: "exact-type" },
            source: { uri: "a", revision: a.revision },
            target: "b",
          },
          "edge",
        )
      ).text,
    ).toBe(edge.text);
    expect((await f.wire(scope + "aliases/one")).status).toBe(307);
    expect((await f.post("deleteAlias", { alias: "aliases/one" }, "unname")).status).toBe(200);
  });
  it("reserves the control namespace and refuses unsupported meanings without success", async () => {
    const f = await fixture();
    await f.node("a");
    for (const id of ["bdp", "bdp/custom", "bdp/beads"])
      expect(
        (
          await f.post(
            "createBead",
            { id, type: "https://types.invalid/T" },
            "reserved-" + id.replaceAll("/", "_"),
          )
        ).status,
      ).toBe(409);
    for (const query of [
      "view=events",
      "view=versions",
      "include=links",
      "revision=old",
      "view=future",
      "fields=%7B%7D",
    ])
      expect((await f.wire(scope + "a?" + query)).status).toBe(400);
    for (const query of [
      "view=links",
      "view=properties",
      "include=links",
      "conformsTo=" + encodeURIComponent("https://types.invalid/T"),
      "unknown=1",
      "limit=1&limit=2",
    ])
      expect((await f.wire(scope + "bdp/beads?" + query)).status).toBe(400);
    expect(
      (await f.wire(scope + "bdp/beads", "GET", undefined, { authorization: "Bearer invalid" }))
        .status,
    ).toBe(401);
  });
  it("delivers real wire inventories through the retained SDK without hidden overfetch", async () => {
    const f = await fixture();
    await f.node("a");
    await f.node("b");
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      const headers = Object.fromEntries(new Headers(init?.headers));
      const result = await f.wire(url, init?.method ?? "GET", undefined, headers);
      const response = new Response(
        [204, 304].includes(result.status) || init?.method === "HEAD" ? null : result.text,
        { status: result.status, headers: result.headers as Record<string, string> },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    };
    const sdk = new RetainedClient({
      transport: createRetainedFetchTransport({
        fetchImplementation: fetcher,
        allowTarget: (url) => url.startsWith(scope),
        credentialForTarget: () => token,
        limits: {
          requestBodyBytes: 65536,
          responseBodyBytes: 65536,
          responseTimeoutMs: 1000,
          cleanupTimeoutMs: 100,
        },
      }),
      maximumDocumentBytes: 65536,
      maximumRequestBodyBytes: 65536,
      operationTimeoutMs: 3000,
    });
    const first = await sdk.list({ scope, kind: "bead", limit: 1 });
    expect(first.kind).toBe("success");
    if (first.kind !== "success" || !first.value.page) throw new Error("missing page");
    expect(first.value.page.items.map((x) => x.id)).toEqual([scope + "a"]);
    expect(calls.filter((url) => url.includes("cursor="))).toHaveLength(0);
    const next = await sdk.readPage({ url: first.value.page.next!, scope, collectionKind: "bead" });
    expect(next.kind === "success" && next.value.page?.items.map((x) => x.id)).toEqual([
      scope + "b",
    ]);
  });
});

it("bounds a large SQLite scan before materialization and preserves readable committed state", async () => {
  const f = await fixture();
  const blob = "x".repeat(60000);
  for (let n = 0; n < 570; n++) {
    const reply = await f.post(
      "createBead",
      { id: "large-" + n, type: "https://types.invalid/T", properties: { blob } },
      "large-" + n,
    );
    expect(reply.status).toBe(200);
    if (n === 199) {
      // Each complete observation is about12MiB. Three undiscarded snapshots
      // would exceed the unchanged32MiB bound; these bodyless reads deliver no cursor.
      for (let attempt = 0; attempt < 4; attempt++) {
        expect((await f.wire(scope + "bdp/beads?limit=1", "HEAD")).status).toBe(200);
        expect(
          (await f.wire(scope + "bdp/beads?limit=1", "GET", undefined, { "if-none-match": "*" }))
            .status,
        ).toBe(304);
      }
    }
  }
  const refused = await f.wire(scope + "bdp/beads?limit=1");
  expect(refused.status).toBe(413);
  expect(JSON.parse(refused.text)).toMatchObject({ code: "limit-exceeded", retry: "never" });
  const point = await f.wire(scope + "large-569");
  expect(point.status).toBe(200);
  expect(JSON.parse(point.text).properties.blob).toBe(blob);
}, 30000);

it("serves a long canonical identity that ordinary Write already admitted", async () => {
  const f = await fixture();
  const id = "a".repeat(18000);
  const created = await f.post(
    "createBead",
    { id, type: "https://types.invalid/ordinary", properties: { value: true } },
    "long-identity",
  );
  expect(created.status).toBe(200);
  const full = await f.wire(scope + id);
  expect(full.status).toBe(200);
  expect(JSON.parse(full.text).id).toBe(scope + id);
  const head = await f.wire(scope + id + "?view=properties", "HEAD");
  expect(head.status).toBe(200);
  expect(head.text).toBe("");
});

it("refuses a first page whose encoded native next would exceed its advertised target bound", async () => {
  const f = await fixture();
  await f.node("a");
  await f.node("b");
  const local = "!".repeat(60000),
    external = "urn:large:" + "!".repeat(60000),
    type = "https://types.invalid/" + "!".repeat(60000);
  expect(
    (await f.post("createBead", { id: local, type: "https://types.invalid/T" }, "long-local"))
      .status,
  ).toBe(200);
  for (const id of ["one", "two"]) {
    expect(
      (
        await f.post(
          "createLink",
          { id, type: "https://types.invalid/T", source: "a", target: "b" },
          "base-" + id,
        )
      ).status,
    ).toBe(200);
    for (const [field, value] of [
      ["source", scope + local],
      ["target", external],
      ["type", type],
    ] as const)
      expect(
        (await f.post("updateLink", { link: id, [field]: value }, "update-" + id + "-" + field))
          .status,
      ).toBe(200);
  }
  const first =
    scope +
    "bdp/links?type=" +
    type +
    "&source=" +
    scope +
    local +
    "&target=" +
    external +
    "&endpoint=" +
    external +
    "&limit=1";
  expect(Buffer.byteLength(new URL(first).pathname + new URL(first).search)).toBeLessThan(
    512 * 1024,
  );
  const reply = await f.wire(first);
  expect(reply.status).toBe(413);
  expect(JSON.parse(reply.text)).toMatchObject({ code: "limit-exceeded", retry: "never" });
  expect(reply.headers["bdp-collection-kind"]).toBeUndefined();
  expect((await f.wire(scope + "one")).status).toBe(200);
}, 30000);
