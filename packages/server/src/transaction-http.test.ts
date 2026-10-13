import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import type { TransactionRuntimeTestSeams } from "./transaction-runtime.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const token = "a".repeat(32),
  otherToken = "b".repeat(32),
  readToken = "c".repeat(32);
const bead = "https://example.test/bead",
  link = "https://example.test/link";
const types = [
  { id: bead, name: "Bead", describes: "bead", conformsTo: [] },
  {
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [bead], external: "opaque" },
    target: { conformsTo: [bead], external: "opaque" },
  },
].map((value) => parseTypeDescriptor(value));
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected record");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  const result = record(value).id;
  if (typeof result !== "string") throw new Error("expected id");
  return result;
}
async function body(response: Response) {
  return record(await response.json());
}
const create = (name = "a") => ({
  operation: "createBead",
  id: `beads/${name}`,
  type: bead,
  properties: { title: name },
});
const batch = (operations: unknown[] = [create()]) => JSON.stringify({ operations });
async function fixture(seams: TransactionRuntimeTestSeams = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let time = 1000;
  const options = {
    directory,
    port: 0,
    create: true,
    types,
    credentials: [
      { token, principal: "p", canMutate: true },
      { token: otherToken, principal: "other", canMutate: true },
      { token: readToken, principal: "reader", canMutate: false },
    ],
  };
  let runtime = await startTransactionRuntime(options, { clock: () => time, ...seams });
  cleanup.push(() => runtime.close());
  return {
    get runtime() {
      return runtime;
    },
    setTime(value: number) {
      time = value;
    },
    async get(url: string, init: RequestInit = {}) {
      const headers = new Headers({
        authorization: `Bearer ${token}`,
        ...Object.fromEntries(new Headers(init.headers)),
      });
      return fetch(url, { ...init, headers, redirect: "manual" });
    },
    async post(
      text = batch(),
      key: string | null = "key",
      target: keyof typeof runtime.targets = "batch",
      headers: Record<string, string> = {},
    ) {
      return fetch(runtime.targets[target], {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(key === null ? {} : { "idempotency-key": key }),
          ...headers,
        },
        body: text,
      });
    },
    async reopen(next: TransactionRuntimeTestSeams = seams) {
      const port = Number(new URL(runtime.scope).port);
      await runtime.close();
      runtime = await startTransactionRuntime(
        { ...options, port, create: false },
        { clock: () => time, ...next },
      );
    },
  };
}
function context(response: Response) {
  return Object.fromEntries(
    ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"].map((name) => [
      name,
      response.headers.get(name),
    ]),
  );
}

describe("source-private actual Transactional HTTP", () => {
  it("serves canonical routes without advertising missing discovery, directory or set support", async () => {
    const f = await fixture();
    expect(Object.keys(f.runtime.targets)).toHaveLength(10);
    for (const relative of ["", "bdp.json", "operations/"]) {
      const result = await f.get(new URL(relative, f.runtime.scope).href);
      expect(result.status).toBe(503);
      expect(result.headers.get("x-bdp-development-limit")).toBe("transactional-discovery");
      expect(result.headers.has("link")).toBe(false);
      expect(await body(result)).not.toHaveProperty("profile");
    }
    expect((await f.get(`${f.runtime.scope}operations/update-where`)).status).toBe(404);
    const result = await f.post();
    expect(result.status).toBe(200);
    expect(result.headers.get("x-bdp-development")).toBe("non-attesting");
    expect(context(result)).toMatchObject({ "bdp-scope-position": "pos-1" });
    const receipt = await body(result);
    expect(receipt).toMatchObject({
      status: "completed",
      next: null,
      requiredPosition: "pos-1",
      results: [{ outcome: "created", resource: { id: `${f.runtime.scope}beads/a` } }],
    });
    const read = await f.get(`${f.runtime.scope}beads/a`);
    expect(read.status).toBe(200);
    expect(await body(read)).toMatchObject({
      id: `${f.runtime.scope}beads/a`,
      properties: { title: "a" },
    });
    expect(context(read)).toEqual(context(result));
    expect(await body(await f.get(id(receipt)))).toEqual(receipt);
  });
  it("orders body bounds, media and carrier/key syntax before authentication", async () => {
    const f = await fixture();
    for (const [text, key, headers, status, code] of [
      [
        "x".repeat(65537),
        "key",
        { authorization: "", "content-type": "text/plain" },
        413,
        "request-too-large",
      ],
      [
        "{",
        "key",
        { authorization: "", "content-type": "text/plain" },
        415,
        "unsupported-media-type",
      ],
      ["{", "key", { authorization: "" }, 400, "malformed-request"],
      [batch(), "bad key", { authorization: "" }, 400, "malformed-request"],
      [batch(), null, { authorization: "" }, 400, "malformed-request"],
      [batch(), "key", { authorization: "" }, 401, "unauthenticated"],
      [batch(), "key", { authorization: `Bearer ${readToken}` }, 403, "forbidden"],
    ] as const) {
      const response = await f.post(text, key, "batch", headers);
      expect(response.status).toBe(status);
      expect(await body(response)).toMatchObject({ code });
    }
    expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
    expect((await f.post()).status).toBe(200);
  });
  it("preserves conflict-before-negotiation and replay-before-capacity without binding refused keys", async () => {
    const f = await fixture();
    const first = await body(await f.post(batch([create("a"), create("b")])));
    await f.reopen({ maximumOperations: 1 });
    expect(await body(await f.post(batch([create("a"), create("b")])))).toEqual(first);
    const conflict = await f.post(batch([create("x")]), "key", "batch", { accept: "text/plain" });
    expect(conflict.status).toBe(409);
    expect(await body(conflict)).toMatchObject({ code: "idempotency-conflict" });
    const refused = await f.post(batch([create("x"), create("y")]), "fresh", "batch", {
      accept: "text/plain",
    });
    expect(refused.status).toBe(413);
    expect(await body(refused)).toMatchObject({
      code: "limit-exceeded",
      limit: "transaction.operations",
    });
    const negotiate = await f.post(batch([create("x")]), "fresh", "batch", {
      accept: "text/plain",
    });
    expect(negotiate.status).toBe(406);
    expect(await negotiate.text()).toBe("");
    expect((await f.post(batch([create("x")]), "fresh")).status).toBe(200);
  });
  it("keeps POST conditions out of mutation guards and serves failed receipts with200", async () => {
    const f = await fixture();
    const response = await f.post(batch(), "key", "batch", {
      "if-match": '"nonexistent"',
      "if-none-match": "*",
    });
    expect(response.status).toBe(200);
    expect(response.headers.has("etag")).toBe(false);
    const failure = await f.post(
      batch([{ operation: "deleteBead", bead: "beads/missing" }]),
      "bad",
    );
    expect(failure.status).toBe(200);
    expect(await body(failure)).toMatchObject({
      status: "failed",
      problem: { code: "resource-not-found" },
    });
  });
  it("serves receipt current context, HEAD and conditions without using execution facts as validators", async () => {
    const f = await fixture(),
      receipt = await body(await f.post());
    await f.post(batch([create("b")]), "b");
    const result = await f.get(id(receipt));
    expect(result.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(result.headers.has("etag")).toBe(false);
    expect(result.headers.has("last-modified")).toBe(false);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await body(result)).toEqual(receipt);
    for (const [headers, status] of [
      [{ "if-none-match": "*" }, 304],
      [{ "if-match": '"x"' }, 412],
      [{ "if-match": "*" }, 200],
    ] as const) {
      const head = await f.get(id(receipt), { method: "HEAD", headers });
      expect(head.status).toBe(status);
      expect(await head.text()).toBe("");
      expect(head.headers.get("bdp-scope-position")).toBe("pos-2");
      expect(head.headers.get("cache-control")).toBe("private, no-store");
    }
  });
  it("authenticates and hides receipts before minimum-control refusal or conditional shortcuts", async () => {
    const f = await fixture(),
      receipt = await body(await f.post());
    const controls = {
      "bdp-minimum-scope-position": "pos-999",
      "bdp-scope-epoch": "old",
      "bdp-authorization-view": "other",
      "if-none-match": "*",
    };
    for (const [authorization, status] of [
      ["", 401],
      [`Bearer ${otherToken}`, 404],
      [`Bearer ${token}`, 503],
    ] as const) {
      const response = await f.get(id(receipt), { headers: { ...controls, authorization } });
      expect(response.status).toBe(status);
      expect(response.headers.has("bdp-scope-position")).toBe(false);
    }
    const missing = await f.get(`${f.runtime.scope}receipts/unknown`, { headers: controls });
    expect(missing.status).toBe(404);
    const own = await f.get(id(receipt), { headers: controls });
    expect(own.headers.get("x-bdp-development-limit")).toBe("minimum-position");
    expect(
      (
        await f.get(id(receipt), {
          method: "HEAD",
          headers: { authorization: `Bearer ${otherToken}`, "if-none-match": "*" },
        })
      ).status,
    ).toBe(404);
  });
  it("fails minimum controls closed before ordinary Read and expired cursor conditional decisions", async () => {
    const f = await fixture();
    await f.post(batch([create("a"), create("b"), create("c")]));
    const page = await body(await f.get(`${f.runtime.scope}beads/`));
    expect(typeof page.next).toBe("string");
    f.setTime(3000);
    const headers = { "bdp-minimum-scope-position": "pos-1", "if-none-match": "*" };
    for (const url of [
      `${f.runtime.scope}beads/a`,
      `${f.runtime.scope}beads/`,
      String(page.next),
    ]) {
      const response = await f.get(url, { headers });
      expect(response.status).toBe(503);
      expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
    }
    expect((await f.get(String(page.next), { headers: { "if-none-match": "*" } })).status).toBe(
      410,
    );
  });
  it("enforces method and root rules without a receipt listing", async () => {
    const f = await fixture(),
      receipt = await body(await f.post());
    for (const method of ["GET", "HEAD", "PUT", "OPTIONS"]) {
      const response = await f.get(f.runtime.targets.batch, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(await response.text()).toBe("");
    }
    for (const url of [id(receipt), `${f.runtime.scope}receipts/`]) {
      const response = await f.get(url, { method: "POST" });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(await response.text()).toBe("");
    }
    expect((await f.get(`${f.runtime.scope}receipts/`)).status).toBe(404);
  });
  it("keeps transport principal distinct from actor and rejects writes by read-only credentials", async () => {
    const f = await fixture();
    const receipt = await body(
      await f.post(
        batch([
          { ...create(), revisionProvenance: { actor: { id: "other", basis: "writer-supplied" } } },
        ]),
      ),
    );
    expect(
      (await f.get(id(receipt), { headers: { authorization: `Bearer ${otherToken}` } })).status,
    ).toBe(404);
    expect(
      (
        await f.get(`${f.runtime.scope}beads/a`, {
          headers: { authorization: `Bearer ${readToken}` },
        })
      ).status,
    ).toBe(200);
    const forbidden = await f.post(batch([create("b")]), "b", "batch", {
      authorization: `Bearer ${readToken}`,
    });
    expect(forbidden.status).toBe(403);
  });
  it("runs ordered member transactions and canonical dependencies and replays singleton keys", async () => {
    const f = await fixture();
    const text = batch([
      { ...create("a"), name: "a", idempotencyKey: "creator" },
      { operation: "deleteBead", bead: "beads/missing", idempotencyKey: "failure" },
      { operation: "createLink", type: link, source: "@a", target: "@a", idempotencyKey: "link" },
    ]);
    const response = await f.post(text, null, "sequence");
    expect(response.status).toBe(200);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(await body(response)).toMatchObject({
      results: [{ outcome: "created" }, { code: "resource-not-found" }, { outcome: "created" }],
    });
    const { operation: _operation, ...request } = create("a");
    const retry = await f.post(JSON.stringify(request), "creator", "createBead");
    expect(await body(retry)).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
    expect(retry.headers.get("bdp-scope-position")).toBe("pos-2");
  });
  it("rejects sequence carrier syntax/keys/negotiation before claiming any member", async () => {
    const f = await fixture();
    const text = batch([{ ...create(), idempotencyKey: "member" }]);
    expect((await f.post(text, "carrier-key", "sequence")).status).toBe(400);
    expect((await f.post("{", null, "sequence", { authorization: "" })).status).toBe(400);
    const reject = await f.post(text, null, "sequence", { accept: "text/plain" });
    expect(reject.status).toBe(406);
    expect(await reject.text()).toBe("");
    expect(
      (
        await f.post(
          batch([
            { ...create(), idempotencyKey: "member" },
            { ...create("b"), idempotencyKey: "member" },
          ]),
          undefined,
          "sequence",
        )
      ).status,
    ).toBe(400);
    expect((await f.post(batch([create("changed")]), "member")).status).toBe(200);
    expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
  });
  it("refuses unsupported Resource-alias sequences and set batches without malformed claims or partial effects", async () => {
    const f = await fixture();
    const aliases = batch([
      { ...create(), idempotencyKey: "a" },
      { operation: "deleteBead", bead: "alias/latest", idempotencyKey: "delete" },
    ]);
    const response = await f.post(aliases, null, "sequence");
    expect(response.status).toBe(503);
    expect(response.headers.get("x-bdp-development-limit")).toBe("sequence-resource-alias");
    expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
    const set = await f.post(
      batch([
        {
          operation: "deleteWhere",
          collection: "beads",
          selector: "$[*]",
          cardinality: { min: 0, max: 1 },
        },
      ]),
      "set",
    );
    expect(set.status).toBe(503);
    expect(set.headers.get("x-bdp-development-limit")).toBe("unsupported-transaction-composition");
    expect((await f.post(batch([create()]), "set")).status).toBe(200);
  });
  it("preserves retained receipt identities across actual listener close/reopen and detail expiry", async () => {
    const f = await fixture(),
      first = await body(await f.post());
    await f.reopen();
    expect(await body(await f.post())).toEqual(first);
    f.setTime(86401001);
    const compact = await body(await f.get(id(first)));
    expect(compact).toMatchObject({
      status: "completed",
      detail: "expired",
      allocated: [{ id: `${f.runtime.scope}beads/a` }],
    });
    await f.reopen();
    expect(await body(await f.post())).toEqual(compact);
  });
  it("finishes accepted sequence work after actual client disconnect and while closing the listener", async () => {
    const callbacks: (() => void)[] = [];
    const f = await fixture({
      scheduler: {
        turn(callback) {
          callbacks.push(callback);
          return () => {};
        },
      },
    });
    const text = batch([
      { ...create("a"), idempotencyKey: "a" },
      { ...create("b"), idempotencyKey: "b" },
    ]);
    const request = httpRequest(f.runtime.targets.sequence, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    request.on("error", () => {});
    request.end(text);
    for (let attempt = 0; callbacks.length === 0 && attempt < 100; attempt++) await setImmediate();
    expect(callbacks).toHaveLength(1);
    request.destroy();
    const closing = f.runtime.close();
    callbacks.shift()?.();
    await setImmediate();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.();
    await closing;
    await f.reopen({});
    expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(200);
    expect((await f.get(`${f.runtime.scope}beads/b`)).status).toBe(200);
    const recovered = await f.post(text, null, "sequence");
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("bdp-scope-position")).toBe("pos-2");
  });
  it("joins a live member receipt with202 then200 without a second execution", async () => {
    const callbacks: (() => void)[] = [];
    const f = await fixture({
      scheduler: {
        turn(callback) {
          callbacks.push(callback);
          return () => {};
        },
      },
    });
    const work = f.post(batch([{ ...create(), idempotencyKey: "member" }]), null, "sequence");
    for (let attempt = 0; callbacks.length === 0 && attempt < 100; attempt++) await setImmediate();
    expect(callbacks).toHaveLength(1);
    const pending = await f.post(batch(), "member");
    expect(pending.status).toBe(202);
    const receipt = await body(pending);
    expect(receipt).toMatchObject({ status: "pending" });
    expect(pending.headers.get("location")).toBe(id(receipt));
    expect(pending.headers.get("retry-after")).toBe("1");
    expect(pending.headers.get("bdp-scope-position")).toBe("pos-0");
    const read = await f.get(id(receipt));
    expect(read.status).toBe(200);
    expect(await body(read)).toEqual(receipt);
    const refused = await f.post(batch(), "member", "batch", { accept: "text/plain" });
    expect(refused.status).toBe(406);
    expect(await refused.text()).toBe("");
    callbacks.shift()?.();
    await work;
    const finished = await f.post(batch(), "member");
    expect(finished.status).toBe(200);
    expect(await body(finished)).toMatchObject({
      id: id(receipt),
      status: "completed",
      requiredPosition: "pos-1",
    });
    expect(finished.headers.get("bdp-scope-position")).toBe("pos-1");
  });

  it("serves actual alias redirects and canonical property validators with current context", async () => {
    const f = await fixture();
    await f.post();
    expect(
      (
        await f.post(
          JSON.stringify({ alias: "alias/latest", target: "beads/a" }),
          "alias",
          "putAlias",
        )
      ).status,
    ).toBe(200);
    const alias = await f.get(`${f.runtime.scope}alias/latest`);
    expect(alias.status).toBe(307);
    expect(alias.headers.get("location")).toBe(`${f.runtime.scope}beads/a`);
    expect(alias.headers.get("bdp-scope-position")).toBe("pos-1");
    const properties = await f.get(`${f.runtime.scope}beads/a?view=properties`);
    expect(properties.status).toBe(200);
    const etag = properties.headers.get("etag");
    expect(etag).toBeTruthy();
    const conditional = await f.get(`${f.runtime.scope}beads/a?view=properties`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("bdp-scope-position")).toBe("pos-1");
  });

  it("rejects duplicate keys and invalid UTF8 over the real transport without capturing a key", async () => {
    const f = await fixture();
    const duplicate = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          f.runtime.targets.batch,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "idempotency-key": ["dupe", "dupe"],
            },
          },
          (response) => {
            let bytes = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              bytes += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode, body: bytes }));
          },
        );
        request.on("error", reject);
        request.end(batch());
      },
    );
    expect(duplicate.status).toBe(400);
    expect(JSON.parse(duplicate.body)).toMatchObject({ code: "malformed-request" });
    for (const [type, expected] of [
      ["application/json", 400],
      ["text/plain", 415],
    ] as const) {
      const response = await fetch(f.runtime.targets.batch, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": type,
          "idempotency-key": "dupe",
        },
        body: new Uint8Array([0xff]),
      });
      expect(response.status).toBe(expected);
    }
    expect((await f.post(batch(), "dupe")).status).toBe(200);
  });
});
