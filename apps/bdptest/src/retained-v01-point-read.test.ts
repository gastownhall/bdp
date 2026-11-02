/** Independent HTTP oracles for the current full/properties read increment.
 * Test-only loopback routing preserves advertised Host/path/query; no TLS claim.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RetainedClient, createRetainedFetchTransport } from "@bdp/client";
import { startPrivateRetainedFixture } from "../../../packages/server/src/retained-v01/http.js";

const media = "application/vnd.bdp.v0.1+json";
const scope = "https://point-records.invalid/tenant/";
const navigation = {
  scope,
  description: "https://point-nav.invalid/contract?edition=%2B%2f",
  beads: "https://point-list.invalid/nodes",
  links: "https://point-list.invalid/edges",
  aliases: `${scope}names/`,
  events: "https://point-events.invalid/facts",
  operations: "https://point-nav.invalid/verbs?edition=%2B%2f",
  targets: {
    createBead: "https://point-write.invalid/a",
    updateBead: "https://point-write.invalid/b",
    deleteBead: "https://point-write.invalid/c",
    createLink: "https://point-write.invalid/d",
    updateLink: "https://point-write.invalid/e",
    deleteLink: "https://point-write.invalid/f",
    putAlias: "https://point-write.invalid/g",
    deleteAlias: "https://point-write.invalid/h",
  },
};
const token = "a".repeat(32);
const owner =
  '<https://point-nav.invalid/contract?edition=%2B%2f>; rel="service-desc"; type="application/vnd.bdp.v0.1+json"';
const properties = {
  id: "literal-id",
  type: null,
  items: [],
  next: "literal-next",
  source: { literal: true },
};
type Reply = { status: number; headers: IncomingHttpHeaders; text: string };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of cleanups.splice(0).reverse())
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, "point-read fixture cleanup failed");
});
function wire(
  listen: string,
  target: string,
  method = "GET",
  body?: string | Uint8Array,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Reply> {
  const route = new URL(listen),
    url = new URL(target);
  const bytes =
    body === undefined ? undefined : typeof body === "string" ? Buffer.from(body) : body;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: route.hostname,
        port: route.port,
        method,
        path: url.pathname + url.search,
        agent: false,
        ...(signal === undefined ? {} : { signal }),
        headers: {
          host: url.host,
          accept: media,
          authorization: `Bearer ${token}`,
          ...(bytes === undefined
            ? {}
            : { "content-type": media, "content-length": bytes.byteLength }),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > 65536) res.destroy(new Error("bounded point-read response exceeded"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("point-read HTTP timeout")));
    req.end(bytes);
  });
}
async function provision() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-point-read-"));
  // Unknown/failed startup is preserved. Removal requires a confirmed close.
  const fixture = await startPrivateRetainedFixture({
    directory,
    create: true,
    instance: "point-read-01",
    navigation,
    credentials: [{ token, principal: "p" }],
  });
  cleanups.push(async () => {
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
    expect(existsSync(directory)).toBe(false);
  });
  const created = await wire(
    fixture.listenUrl,
    navigation.targets.createBead,
    "POST",
    JSON.stringify({
      id: "note",
      type: { uri: "https://types.invalid/note", revision: "type + /@=" },
      properties,
      metadata: { authored: true },
    }),
    { "idempotency-key": "seed-note" },
  );
  expect(created.status).toBe(200);
  return { fixture, resource: JSON.parse(created.text).resource };
}
describe("private retained current point read delivery", () => {
  it("returns a complete current native record with actual kind and owning discovery", async () => {
    const { fixture, resource } = await provision();
    const result = await wire(fixture.listenUrl, `${scope}note`);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual(resource);
    expect(result.headers["content-type"]).toBe("application/vnd.bdp.v0.1+json");
    expect(result.headers["bdp-resource-kind"]).toBe("bead");
    expect(result.headers.link).toBe(owner);
  });
  it("returns actual authored properties without wrapping or record extraction on the client", async () => {
    const { fixture } = await provision();
    const result = await wire(fixture.listenUrl, `${scope}note?view=properties`);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual(properties);
    expect(result.headers["bdp-resource-kind"]).toBe("bead");
    expect(result.headers.link).toBe(owner);
    expect(result.headers["bdp-collection-kind"]).toBeUndefined();
  });
  it.each(["", "?view=properties"])(
    "HEAD preserves GET metadata for point selection %s",
    async (query) => {
      const { fixture } = await provision();
      const url = `${scope}note${query}`;
      const get = await wire(fixture.listenUrl, url),
        head = await wire(fixture.listenUrl, url, "HEAD");
      expect(head.status).toBe(get.status);
      expect(head.text).toBe("");
      for (const key of ["content-type", "content-length", "bdp-resource-kind", "link", "etag"])
        expect(head.headers[key]).toBe(get.headers[key]);
    },
  );
  it.each(["", "?view=properties"])(
    "304 keeps kind and owning Scope for selection %s",
    async (query) => {
      const { fixture } = await provision();
      const url = `${scope}note${query}`;
      const get = await wire(fixture.listenUrl, url);
      const result = await wire(fixture.listenUrl, url, "GET", undefined, {
        "if-none-match": String(get.headers.etag),
      });
      expect(result.status).toBe(304);
      expect(result.text).toBe("");
      expect(result.headers.etag).toBe(get.headers.etag);
      expect(result.headers["bdp-resource-kind"]).toBe("bead");
      expect(result.headers.link).toBe(owner);
      expect(result.headers["content-type"]).toBe(media);
    },
  );
  it("refuses a failed native If-Match without creating a Problem representation", async () => {
    const { fixture } = await provision();
    const result = await wire(fixture.listenUrl, `${scope}note?view=properties`, "GET", undefined, {
      "if-match": '"unrelated-native-validator"',
    });
    expect(result.status).toBe(412);
    expect(result.text).toBe("");
    expect(result.headers["content-type"]).toBeUndefined();
  });
  it.each(["?view=properties&view=properties", "?view=properties&unknown=1", "?view=unknown"])(
    "refuses invalid native query %s",
    async (query) => {
      const { fixture } = await provision();
      const result = await wire(fixture.listenUrl, `${scope}note${query}`);
      expect(result.status).toBe(400);
      expect(JSON.parse(result.text).code).toBe("invalid-parameter");
    },
  );
  it.each(["?revision=exact%2Btoken", "?include=links"])(
    "keeps unimplemented selection %s explicit",
    async (query) => {
      const { fixture } = await provision();
      const result = await wire(fixture.listenUrl, `${scope}note${query}`);
      expect(result.status).toBe(501);
      expect(result.text).toBe("");
    },
  );
  it("keeps missing GET and HEAD native without successful kind metadata", async () => {
    const { fixture } = await provision();
    const get = await wire(fixture.listenUrl, `${scope}missing?view=properties`),
      head = await wire(fixture.listenUrl, `${scope}missing?view=properties`, "HEAD");
    expect(get.status).toBe(404);
    expect(JSON.parse(get.text).code).toBe("resource-not-found");
    expect(head.status).toBe(404);
    expect(head.text).toBe("");
    expect(get.headers["bdp-resource-kind"]).toBeUndefined();
    expect(head.headers["bdp-resource-kind"]).toBeUndefined();
  });
  it("authenticates before returning point kind or owning discovery metadata", async () => {
    const { fixture } = await provision();
    const result = await wire(fixture.listenUrl, `${scope}note?view=properties`, "GET", undefined, {
      authorization: "Bearer wrong",
    });
    expect(result.status).toBe(401);
    expect(JSON.parse(result.text).code).toBe("unauthenticated");
    expect(result.headers["bdp-resource-kind"]).toBeUndefined();
    expect(result.headers.link).toBeUndefined();
  });
  it("rejects generic JSON read negotiation with native bodyless 406", async () => {
    const { fixture } = await provision();
    const result = await wire(fixture.listenUrl, `${scope}note?view=properties`, "GET", undefined, {
      accept: "application/json",
    });
    expect(result.status).toBe(406);
    expect(result.text).toBe("");
  });
  it("declares Link kind for a rootless Link properties view with literal source data", async () => {
    const { fixture } = await provision();
    const created = await wire(
      fixture.listenUrl,
      navigation.targets.createLink,
      "POST",
      JSON.stringify({
        id: "also-note",
        type: "https://types.invalid/relation",
        source: "note",
        target: "https://outside.invalid/bead",
        properties,
      }),
      { "idempotency-key": "seed-edge" },
    );
    expect(created.status).toBe(200);
    const result = await wire(fixture.listenUrl, `${scope}also-note?view=properties`);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual(properties);
    expect(result.headers["bdp-resource-kind"]).toBe("link");
    expect(result.headers.link).toBe(owner);
  });
  it("connects the actual generic client through HTTP to SQLite for preparation, submission and reads", async () => {
    const { fixture } = await provision();
    const observed: { url: string; method: string }[] = [];
    const selected = new RetainedClient({
      maximumDocumentBytes: 65536,
      maximumRequestBodyBytes: 65536,
      operationTimeoutMs: 3000,
      transport: createRetainedFetchTransport({
        limits: {
          requestBodyBytes: 65536,
          responseBodyBytes: 65536,
          responseTimeoutMs: 1000,
          cleanupTimeoutMs: 20,
        },
        allowTarget: (url) =>
          ["point-records.invalid", "point-nav.invalid", "point-write.invalid"].includes(
            new URL(url).host,
          ),
        credentialForTarget: () => token,
        fetchImplementation: async (input, init) => {
          const url = String(input),
            method = init?.method ?? "GET";
          observed.push({ url, method });
          const headers = Object.fromEntries(new Headers(init?.headers));
          const body = init?.body instanceof Uint8Array ? init.body : undefined;
          const received = await wire(
            fixture.listenUrl,
            url,
            method,
            body,
            headers,
            init?.signal ?? undefined,
          );
          const value = new Response(
            method === "HEAD" || [204, 304].includes(received.status) ? null : received.text,
            {
              status: received.status,
              headers: Object.fromEntries(
                Object.entries(received.headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
            },
          );
          Object.defineProperty(value, "url", { value: url });
          return value;
        },
      }),
    });
    const bound = await selected.bindWrite(scope);
    expect(bound.kind).toBe("success");
    if (bound.kind !== "success") throw Error("missing Write binding");
    const prepared = bound.value.prepare(
      "createBead",
      '{"id":"from-client","type":"https://types.invalid/note","properties":{"n":1.00}}',
      "client-created",
    );
    const created = await selected.submit(prepared);
    expect(created).toMatchObject({
      kind: "success",
      value: { outcome: "created", changed: true },
    });
    const read = await selected.read({
      reference: `${scope}from-client`,
      view: "properties",
      expectedKind: "bead",
    });
    expect(read).toMatchObject({
      kind: "success",
      value: { scope, resourceKind: "bead", body: { n: 1 } },
    });
    expect(observed).toEqual([
      { url: scope, method: "GET" },
      { url: navigation.description, method: "GET" },
      { url: navigation.operations, method: "GET" },
      { url: navigation.targets.createBead, method: "POST" },
      { url: `${scope}from-client?view=properties`, method: "GET" },
      { url: navigation.description, method: "GET" },
    ]);
  });
});
