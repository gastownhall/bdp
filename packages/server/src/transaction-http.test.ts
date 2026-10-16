import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri, parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import { createTransactionService } from "./transaction-service.js";
import { createTransactionHttpHandler } from "./transaction-http.js";
import type { TransactionRuntimeTestSeams } from "./transaction-runtime.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(schema);
const validateTransactionalProblem = ajv.compile({
  $ref: `${schema.$id}#/$defs/transactionalProblem`,
});
const validateSelectorReceipt = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
const validateSequence = ajv.compile({
  $ref: `${schema.$id}#/$defs/transactionalSequenceResponse`,
});
function checkedProblem(value: Record<string, unknown>) {
  expect(
    validateTransactionalProblem(value),
    JSON.stringify(validateTransactionalProblem.errors),
  ).toBe(true);
  return value;
}
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
  vi.restoreAllMocks();
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
    async retainedReceipts() {
      await runtime.close();
      const db = new DatabaseSync(path.join(directory, "transaction.sqlite"), { readOnly: true });
      try {
        return db
          .prepare("SELECT receipt FROM receipts ORDER BY key")
          .all()
          .map((row) => JSON.parse(String(row.receipt)));
      } finally {
        db.close();
      }
    },
    async retainedReceiptInventory() {
      await runtime.close();
      const db = new DatabaseSync(path.join(directory, "transaction.sqlite"), { readOnly: true });
      try {
        return db
          .prepare("SELECT principal,key,receipt FROM receipts ORDER BY key")
          .all()
          .map((row) => ({
            principal: row.principal,
            key: row.key,
            receipt: JSON.parse(String(row.receipt)),
          }));
      } finally {
        db.close();
      }
    },
    async receiptRows(key: string) {
      const port = Number(new URL(runtime.scope).port);
      await runtime.close();
      const db = new DatabaseSync(path.join(directory, "transaction.sqlite"), { readOnly: true });
      try {
        return db.prepare("SELECT principal,key FROM receipts WHERE key=?").all(key);
      } finally {
        db.close();
        runtime = await startTransactionRuntime(
          { ...options, port, create: false },
          { clock: () => time, ...seams },
        );
      }
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
  it("serves canonical routes without advertising missing discovery or directory", async () => {
    const f = await fixture();
    expect(f.runtime.targets).toEqual(
      Object.fromEntries(
        Object.entries({
          createBead: "create-bead",
          updateBead: "update-bead",
          deleteBead: "delete-bead",
          createLink: "create-link",
          updateLink: "update-link",
          deleteLink: "delete-link",
          putAlias: "put-alias",
          deleteAlias: "delete-alias",
          sequence: "sequence",
          updateWhere: "update-where",
          deleteWhere: "delete-where",
          batch: "batch",
        }).map(([name, suffix]) => [name, `${f.runtime.scope}operations/${suffix}`]),
      ),
    );
    for (const relative of ["", "bdp.json", "operations/"]) {
      const result = await f.get(new URL(relative, f.runtime.scope).href);
      expect(result.status).toBe(500);
      expect(result.headers.get("x-bdp-development-limit")).toBe("transactional-discovery");
      expect(result.headers.has("link")).toBe(false);
      expect(await result.text()).toBe("");
    }
    expect((await f.get(`${f.runtime.scope}operations/update-where`)).status).toBe(405);
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
      [`Bearer ${token}`, 410],
    ] as const) {
      const response = await f.get(id(receipt), { headers: { ...controls, authorization } });
      expect(response.status).toBe(status);
      expect(response.headers.has("bdp-scope-position")).toBe(status !== 401);
    }
    const missing = await f.get(`${f.runtime.scope}receipts/unknown`, { headers: controls });
    expect(missing.status).toBe(404);
    const own = await f.get(id(receipt), { headers: controls });
    expect(await body(own)).toMatchObject({ code: "cursor-expired" });
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
      expect(response.status).toBe(400);
      expect(checkedProblem(await body(response)).code).toBe("malformed-request");
      expect(response.headers.get("x-bdp-development-limit")).toBeNull();
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
  it("commits a prefix and independent tail around a retained alias member failure", async () => {
    const f = await fixture();
    const aliases = batch([
      { ...create(), idempotencyKey: "a" },
      { operation: "deleteBead", bead: "alias/latest", idempotencyKey: "delete" },
      { ...create("b"), idempotencyKey: "b" },
    ]);
    const response = await f.post(aliases, null, "sequence");
    expect(response.status).toBe(200);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(response.headers.has("x-bdp-development-limit")).toBe(false);
    const result = await body(response);
    expect(validateSequence(result), JSON.stringify(validateSequence.errors)).toBe(true);
    expect(result).toMatchObject({
      results: [
        { operationIndex: 0, outcome: "created", resource: { id: `${f.runtime.scope}beads/a` } },
        { operationIndex: 1, code: "resource-not-found", status: 404 },
        { operationIndex: 2, outcome: "created", resource: { id: `${f.runtime.scope}beads/b` } },
      ],
    });
    for (const name of ["a", "b"]) {
      const read = await f.get(`${f.runtime.scope}beads/${name}`);
      expect(read.status).toBe(200);
      expect(await body(read)).toMatchObject({ properties: { title: name } });
    }
    const put = await f.post(
      JSON.stringify({ alias: "alias/latest", target: "beads/b" }),
      "put",
      "putAlias",
    );
    expect(put.status).toBe(200);
    expect(put.headers.get("bdp-scope-position")).toBe("pos-2");
    const replay = await f.post(aliases, null, "sequence");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(await body(replay)).toEqual(result);
    expect((await f.get(`${f.runtime.scope}beads/b`)).status).toBe(200);
    await f.reopen();
    const recovered = await f.post(aliases, null, "sequence");
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(await body(recovered)).toEqual(result);
    const fresh = await f.post(
      JSON.stringify({ bead: "alias/latest" }),
      "fresh-delete",
      "deleteBead",
    );
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("bdp-scope-position")).toBe("pos-3");
    expect(await body(fresh)).toMatchObject({
      status: "completed",
      results: [{ outcome: "deleted", deleted: { resource: { id: `${f.runtime.scope}beads/b` } } }],
    });
    expect((await f.get(`${f.runtime.scope}beads/b`)).status).toBe(404);
  });
  it("resolves earlier alias writes and mixed allocated/pinned operands at HTTP member turns", async () => {
    const f = await fixture();
    const operations = [
      { operation: "createBead", type: bead, name: "made", idempotencyKey: "creator" },
      { operation: "putAlias", alias: "alias/work", target: "@made", idempotencyKey: "put" },
      {
        operation: "createLink",
        id: "links/edge",
        type: link,
        source: "@made",
        target: { uri: "alias/work", revision: "opaque-pin" },
        idempotencyKey: "edge",
      },
    ];
    const response = await f.post(batch(operations), null, "sequence");
    expect(response.status).toBe(200);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    const result = await body(response),
      entries = result.results as Record<string, unknown>[];
    expect(validateSequence(result), JSON.stringify(validateSequence.errors)).toBe(true);
    const created = id(entries[0]?.resource);
    expect(entries[1]).toEqual({
      operationIndex: 1,
      outcome: "created",
      alias: `${f.runtime.scope}alias/work`,
      target: created,
    });
    const assigned = await f.get(`${f.runtime.scope}alias/work`);
    expect(assigned.status).toBe(307);
    expect(assigned.headers.get("location")).toBe(created);
    expect(entries[2]).toMatchObject({
      outcome: "created",
      resource: {
        id: `${f.runtime.scope}links/edge`,
        source: created,
        target: { uri: created, revision: "opaque-pin" },
      },
    });
    const edge = await f.get(`${f.runtime.scope}links/edge`);
    expect(edge.status).toBe(200);
    expect(await body(edge)).toEqual(entries[2]?.resource);
    const other = await f.post(batch([create("other")]), "other");
    expect(other.status).toBe(200);
    expect(other.headers.get("bdp-scope-position")).toBe("pos-3");
    const repoint = await f.post(
      JSON.stringify({ alias: "alias/work", target: "beads/other" }),
      "repoint",
      "putAlias",
    );
    expect(repoint.status).toBe(200);
    expect(repoint.headers.get("bdp-scope-position")).toBe("pos-3");
    const before = await f.get(`${f.runtime.scope}alias/work`);
    expect(before.status).toBe(307);
    expect(before.headers.get("location")).toBe(`${f.runtime.scope}beads/other`);
    const liveReplay = await f.post(batch(operations), null, "sequence");
    expect(liveReplay.status).toBe(200);
    expect(liveReplay.headers.get("bdp-scope-position")).toBe("pos-3");
    expect(await body(liveReplay)).toEqual(result);
    const liveAlias = await f.get(`${f.runtime.scope}alias/work`);
    expect(liveAlias.status).toBe(307);
    expect(liveAlias.headers.get("location")).toBe(`${f.runtime.scope}beads/other`);
    const liveEdge = await f.get(`${f.runtime.scope}links/edge`);
    expect(liveEdge.status).toBe(200);
    expect(await body(liveEdge)).toEqual(entries[2]?.resource);
    await f.reopen();
    const replay = await f.post(batch(operations), null, "sequence");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("bdp-scope-position")).toBe("pos-3");
    expect(await body(replay)).toEqual(result);
    const after = await f.get(`${f.runtime.scope}alias/work`);
    expect(after.status).toBe(307);
    expect(after.headers.get("location")).toBe(`${f.runtime.scope}beads/other`);
  });
  it("rejects invalid set Selector grammar and preserves private depth refusal without key capture or partial effects", async () => {
    const f = await fixture();
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
    expect(set.status).toBe(400);
    expect(set.headers.has("x-bdp-development-limit")).toBe(false);
    expect((await f.post(batch([create()]), "set")).status).toBe(200);
    expect(checkedProblem(await body(set))).toMatchObject({
      status: 400,
      code: "malformed-request",
      pointer: "/operations/0/selector",
    });
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 40; depth++) nested = { nested };
    const depth = await f.post(batch([{ ...create("c"), properties: { nested } }]), "deep");
    expect(depth.status).toBe(500);
    expect(depth.headers.get("x-bdp-development-limit")).toBe(
      "unsupported-transaction-composition",
    );
    expect(await depth.text()).toBe("");
    expect((await f.get(`${f.runtime.scope}beads/c`)).status).toBe(404);
    expect((await f.post(batch([create("c")]), "deep")).status).toBe(200);
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

it("keeps a configured canonical identity across different loopback listener ports", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-canonical-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    scope: "https://canonical.test/acme/",
    port: 0,
    create: true,
    types,
    credentials: [{ token, principal: "p", canMutate: true }],
  };
  let runtime = await startTransactionRuntime(options);
  cleanup.push(() => runtime.close());
  const send = (target: string, init: RequestInit = {}) =>
    fetch(new URL(new URL(target).pathname, runtime.listenUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init.headers)),
      },
    });
  const mutation = () =>
    send(runtime.targets.batch, {
      method: "POST",
      headers: { "idempotency-key": "canonical" },
      body: batch(),
    });
  const first = await body(await mutation());
  expect(id(first)).toMatch(/^https:\/\/canonical\.test\/acme\/receipts\//);
  await runtime.close();
  runtime = await startTransactionRuntime({ ...options, create: false });
  expect(await body(await mutation())).toEqual(first);
  expect(await body(await send(id(first)))).toEqual(first);
  expect((await send(`${options.scope}beads/a`)).status).toBe(200);
});

it("maps a finite unresolved comparison to temporary refusal without disclosing or executing it", async () => {
  const callbacks: (() => void)[] = [];
  let tick = 0;
  const f = await fixture({
    scheduler: {
      turn(callback) {
        callbacks.push(callback);
        return () => {};
      },
    },
    comparison: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const sequence = f.post(
    batch([
      { ...create(), name: "a", idempotencyKey: "creator" },
      {
        operation: "createLink",
        type: link,
        source: "@a",
        target: "@a",
        idempotencyKey: "dependent",
      },
    ]),
    null,
    "sequence",
  );
  for (let attempt = 0; callbacks.length === 0 && attempt < 100; attempt++) await setImmediate();
  expect(callbacks).toHaveLength(1);
  const retry = await f.post(
    batch([{ operation: "createLink", type: link, source: "beads/a", target: "beads/a" }]),
    "dependent",
  );
  expect(retry.status).toBe(503);
  expect(retry.headers.get("retry-after")).toBe("1");
  expect(retry.headers.has("location")).toBe(false);
  expect(await body(retry)).toMatchObject({ code: "temporarily-unavailable" });
  expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
  callbacks.shift()?.();
  await setImmediate();
  callbacks.shift()?.();
  expect((await sequence).status).toBe(200);
  const replay = await f.post(
    batch([{ operation: "createLink", type: link, source: "beads/a", target: "beads/a" }]),
    "dependent",
  );
  expect(replay.status).toBe(200);
  expect(replay.headers.get("bdp-scope-position")).toBe("pos-2");
});

it("preserves maintenance faults as bodyless internal errors before direct admission", async () => {
  const sentinel = new Error("private maintenance clock failure");
  const seedKey = "maintenance-seed",
    freshKey = "maintenance-after-fault";
  const failures: unknown[] = [];
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  let seedReceipt: Record<string, unknown> | undefined;
  let inject = false,
    faultCalls = 0,
    requests = 0;
  let responseStatus: number | undefined;
  let intervalCancelled = false,
    closed = false,
    inventoryChecked = false;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    f = await fixture({
      maintenanceIntervalMs: 25,
      clock: () => {
        if (inject) {
          faultCalls++;
          throw sentinel;
        }
        // This override replaces the fixture's clock; f.setTime is not used.
        return 1000;
      },
    });
    expect(vi.getTimerCount()).toBe(1);
    requests++;
    const seed = await f.post(batch([create("maintenance-seed")]), seedKey);
    expect(seed.status, "selective interval/fetch compatibility").toBe(200);
    seedReceipt = await body(seed);
    const validateReceipt = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
    expect(validateReceipt(seedReceipt), JSON.stringify(validateReceipt.errors)).toBe(true);
    expect(seedReceipt).toMatchObject({
      status: "completed",
      detail: "available",
      idempotencyKey: seedKey,
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
      next: null,
    });
    expect(seedReceipt.results).toEqual([
      {
        operationIndex: 0,
        outcome: "created",
        resource: expect.objectContaining({
          id: `${f.runtime.scope}beads/maintenance-seed`,
          type: bead,
          properties: { title: "maintenance-seed" },
          metadata: {},
        }),
      },
    ]);
    inject = true;
    vi.advanceTimersByTime(25);
    inject = false;
    expect(faultCalls, "one actual maintenance clock failure").toBe(1);
    expect(vi.getTimerCount(), "failed maintenance cancels its interval").toBe(0);
    intervalCancelled = true;
    vi.useRealTimers();
    requests++;
    const response = await f.post(batch([create("maintenance-after-fault")]), freshKey);
    responseStatus = response.status;
    const text = await response.text();
    expect(responseStatus, "maintenance failure is internal500").toBe(500);
    expect(text).toBe("");
    expect(response.headers.get("content-length")).toBe("0");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
    expect(response.headers.get("vary")).toBe("Accept");
    for (const name of [
      "content-type",
      "retry-after",
      "location",
      "x-bdp-development-limit",
      "bdp-scope-epoch",
      "bdp-authorization-view",
      "bdp-scope-position",
    ])
      expect(response.headers.has(name), name).toBe(false);
    expect(text).not.toContain(sentinel.message);
    for (const value of response.headers.values()) expect(value).not.toContain(sentinel.message);
  } catch (error) {
    failures.push(error);
  } finally {
    inject = false;
    vi.useRealTimers();
    if (f) {
      try {
        await f.runtime.close();
        closed = true;
      } catch (error) {
        failures.push(error);
      }
      try {
        // Exactly one post-close readonly inventory, even for the old-guard control.
        const inventory = await f.retainedReceiptInventory();
        expect(seedReceipt, "actual seed receipt exists before inventory comparison").toBeDefined();
        expect(inventory, "fault creates no receipt or key binding").toEqual([
          { principal: "p", key: seedKey, receipt: seedReceipt },
        ]);
        inventoryChecked = true;
      } catch (error) {
        failures.push(error);
      }
    }
    console.info(
      JSON.stringify({
        kind: "comparison-maintenance-fault-cleanup",
        requests,
        responseStatus,
        faultCalls,
        intervalCancelled,
        closed,
        inventoryChecked,
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "maintenance HTTP assertion or cleanup failed");
});

it("keeps a live listener from serving through an owner fenced by injected commit uncertainty", async () => {
  const f = await fixture();
  const exec = DatabaseSync.prototype.exec;
  let inject = true;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    exec.call(this, sql);
    if (sql === "COMMIT" && inject) {
      inject = false;
      throw new Error("injected post-commit uncertainty");
    }
  });
  const failed = await f.post();
  expect(failed.status).toBe(500);
  expect(await failed.text()).toBe("");
  spy.mockRestore();
  const fenced = await f.get(`${f.runtime.scope}beads/`);
  expect(fenced.status).toBe(500);
  expect(await fenced.text()).toBe("");
  await f.reopen();
  expect((await f.post()).status).toBe(200);
});

function rawMethod(
  target: string,
  method: string,
  authenticated: boolean,
): Promise<{ status: number; headers: Headers; body: string }> {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const chunks: Buffer[] = [];
    socket.setTimeout(2000, () => socket.destroy(new Error("raw method response timeout")));
    socket.on("error", reject);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      const split = text.indexOf("\r\n\r\n");
      if (split < 0) {
        reject(new Error(`missing raw HTTP response: ${text}`));
        return;
      }
      const lines = text.slice(0, split).split("\r\n");
      const status = Number(lines.shift()?.split(" ")[1]);
      const headers = new Headers();
      for (const line of lines) {
        const colon = line.indexOf(":");
        headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      resolve({ status, headers, body: text.slice(split + 4) });
    });
    socket.on("connect", () =>
      socket.write(
        `${method} ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\nContent-Length: 0\r\n${authenticated ? `Authorization: Bearer ${token}\r\n` : ""}\r\n`,
      ),
    );
  });
}

it("routes unsupported raw methods by target before Fetch construction or receipt authentication", async () => {
  const f = await fixture();
  const receipt = await body(await f.post());
  for (const authenticated of [false, true]) {
    for (const method of ["PUT", "DELETE", "OPTIONS", "TRACE", "CONNECT"]) {
      for (const [target, allow] of [
        [f.runtime.targets.batch, "POST"],
        [f.runtime.targets.sequence, "POST"],
        [id(receipt), "GET, HEAD"],
        [`${f.runtime.scope}receipts/unknown`, "GET, HEAD"],
        [`${f.runtime.scope}receipts`, "GET, HEAD"],
        [`${f.runtime.scope}operations/`, "GET, HEAD"],
      ] as const) {
        const result = await rawMethod(target, method, authenticated);
        expect(result.status, `${method} ${target} authenticated=${authenticated}`).toBe(405);
        expect(result.headers.get("allow")).toBe(allow);
        expect(result.headers.has("www-authenticate")).toBe(false);
        expect(result.headers.has("bdp-scope-position")).toBe(false);
        expect(result.body).toBe("");
      }
    }
    for (const target of [id(receipt), `${f.runtime.scope}receipts/unknown`]) {
      const result = await rawMethod(target, "POST", authenticated);
      expect(result.status).toBe(405);
      expect(result.headers.get("allow")).toBe("GET, HEAD");
      expect(result.body).toBe("");
    }
  }
  for (const method of ["GET", "HEAD"]) {
    for (const target of [id(receipt), `${f.runtime.scope}receipts/unknown`]) {
      const result = await rawMethod(target, method, false);
      expect(result.status).toBe(401);
      expect(result.headers.has("allow")).toBe(false);
      expect(result.headers.has("bdp-scope-position")).toBe(false);
      if (method === "HEAD") expect(result.body).toBe("");
    }
  }
  expect(await body(await f.post())).toEqual(receipt);
});

// Independent fixture oracles for the copied read-control command observations.
const commandReceiptSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
function commandResource(value: unknown, expected: Record<string, unknown>) {
  const resource = record(value);
  expect(resource.revision).toEqual(expect.any(String));
  expect(String(resource.revision).length).toBeGreaterThan(0);
  expect(resource).toEqual({ ...expected, metadata: {}, revision: resource.revision });
  return resource;
}
async function commandResponse(response: Response, sequence = false, status = "completed") {
  expect(
    response.status,
    `copied command accepted before effects: ${JSON.stringify({
      status: response.status,
      developmentLimit: response.headers.get("x-bdp-development-limit"),
      contentLength: response.headers.get("content-length"),
    })}`,
  ).toBe(200);
  expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
  expect(response.headers.has("x-bdp-development-limit")).toBe(false);
  for (const value of Object.values(context(response))) {
    expect(value).toEqual(expect.any(String));
    expect(value?.length).toBeGreaterThan(0);
  }
  const value = await body(response);
  const validate = sequence ? validateSequence : commandReceiptSchema;
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  if (!sequence) {
    expect(value.status).toBe(status);
    expect(value.detail).toBe("available");
    expect(value.scopeEpoch).toBe(response.headers.get("bdp-scope-epoch"));
    expect(value.authorizationView).toBe(response.headers.get("bdp-authorization-view"));
    if (status === "completed") expect(value.next).toBeNull();
  }
  return value;
}
function commandEntries(value: Record<string, unknown>) {
  expect(Array.isArray(value.results)).toBe(true);
  return (value.results as unknown[]).map(record);
}
const copiedMalformedMinimum = {
  "bdp-minimum-scope-position": "not a position!",
  "bdp-scope-epoch": "",
  "bdp-authorization-view": "view-one, view-two",
};

it("ignores partial and malformed copied read controls on each mutation carrier", async () => {
  const f = await fixture();
  let requests = 0;
  for (const [index, field] of [
    "bdp-minimum-scope-position",
    "bdp-scope-epoch",
    "bdp-authorization-view",
  ].entries()) {
    for (const [carrier, fieldValue] of [
      ["batch", ""],
      ["createBead", "not a token!"],
      ["sequence", "token-one, token-two"],
    ] as const) {
      const key = `${carrier}_${index}`;
      const { operation, ...singleton } = create(key);
      const text =
        carrier === "createBead"
          ? JSON.stringify(singleton)
          : batch([
              {
                operation,
                ...singleton,
                ...(carrier === "sequence" ? { idempotencyKey: key } : {}),
              },
            ]);
      requests++;
      const response = await f.post(text, carrier === "sequence" ? null : key, carrier, {
        [field]: fieldValue,
      });
      const value = await commandResponse(response, carrier === "sequence");
      const entries = commandEntries(value);
      expect(entries).toHaveLength(1);
      const resource = commandResource(entries[0]!.resource, {
        id: `${f.runtime.scope}beads/${key}`,
        type: bead,
        properties: { title: key },
      });
      expect(entries).toEqual([{ operationIndex: 0, outcome: "created", resource }]);
      requests++;
      const read = await f.get(`${f.runtime.scope}beads/${key}`);
      expect(read.status).toBe(200);
      expect(await body(read)).toEqual(resource);
      expect(context(read)).toEqual(context(response));
      requests++;
      const retry = await f.post(text, carrier === "sequence" ? null : key, carrier, {
        "bdp-minimum-scope-position": "pos-999",
        "bdp-scope-epoch": "foreign-epoch",
        "bdp-authorization-view": "foreign-view",
      });
      expect(await commandResponse(retry, carrier === "sequence")).toEqual(value);
      expect(context(retry)).toEqual(context(response));
    }
  }
  expect(requests).toBe(27);
});

it("ignores complete copied tuples on every Transactional mutation target", async () => {
  const wait = vi.fn(async () => {});
  const f = await fixture({ minimumReads: { budgetMs: 2, wait } });
  const expectedTargets = {
    createBead: "create-bead",
    updateBead: "update-bead",
    deleteBead: "delete-bead",
    createLink: "create-link",
    updateLink: "update-link",
    deleteLink: "delete-link",
    putAlias: "put-alias",
    deleteAlias: "delete-alias",
    updateWhere: "update-where",
    deleteWhere: "delete-where",
    batch: "batch",
    sequence: "sequence",
  };
  expect(f.runtime.targets).toEqual(
    Object.fromEntries(
      Object.entries(expectedTargets).map(([name, suffix]) => [
        name,
        `${f.runtime.scope}operations/${suffix}`,
      ]),
    ),
  );
  const seed = await f.post(
    batch([
      create("a"),
      create("b"),
      {
        operation: "createLink",
        id: "links/victim",
        type: link,
        source: "beads/a",
        target: "beads/b",
      },
    ]),
    "all-seed",
    "batch",
    copiedMalformedMinimum,
  );
  const seeded = commandEntries(await commandResponse(seed));
  expect(seeded).toHaveLength(3);
  for (const [index, name] of ["a", "b"].entries()) {
    const resource = commandResource(seeded[index]!.resource, {
      id: `${f.runtime.scope}beads/${name}`,
      type: bead,
      properties: { title: name },
    });
    expect(seeded[index]).toEqual({ operationIndex: index, outcome: "created", resource });
  }
  const victim = commandResource(seeded[2]!.resource, {
    id: `${f.runtime.scope}links/victim`,
    type: link,
    properties: {},
    source: `${f.runtime.scope}beads/a`,
    target: `${f.runtime.scope}beads/b`,
  });
  expect(seeded[2]).toEqual({ operationIndex: 2, outcome: "created", resource: victim });
  let count = 1;
  const seen: string[] = [];
  const finalBeads = new Map<string, Record<string, unknown>>();
  async function post(target: keyof typeof f.runtime.targets, input: unknown) {
    seen.push(target);
    count++;
    const headers =
      seen.length % 2
        ? minimumHeaders(seed, "pos-999")
        : {
            "bdp-minimum-scope-position": "pos-999",
            "bdp-scope-epoch": "foreign-epoch",
            "bdp-authorization-view": "foreign-view",
          };
    const response = await f.post(
      JSON.stringify(input),
      target === "sequence" ? null : `all-${target}`,
      target,
      headers,
    );
    return commandEntries(await commandResponse(response, target === "sequence"));
  }
  function beadResult(
    entries: Record<string, unknown>[],
    name: string,
    title: string,
    outcome: string,
  ) {
    expect(entries).toHaveLength(1);
    const resource = commandResource(entries[0]!.resource, {
      id: `${f.runtime.scope}beads/${name}`,
      type: bead,
      properties: { title },
    });
    expect(entries).toEqual([{ operationIndex: 0, outcome, resource }]);
    finalBeads.set(name, resource);
    return resource;
  }
  beadResult(
    await post("createBead", { id: "beads/c", type: bead, properties: { title: "c" } }),
    "c",
    "c",
    "created",
  );
  beadResult(
    await post("updateBead", {
      bead: "beads/c",
      propertiesChange: [{ op: "replace", path: "/title", value: "c2" }],
    }),
    "c",
    "c2",
    "updated",
  );
  const createdLink = await post("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: "beads/b",
    properties: { title: "l" },
  });
  const firstLink = commandResource(createdLink[0]!.resource, {
    id: `${f.runtime.scope}links/l`,
    type: link,
    source: `${f.runtime.scope}beads/a`,
    target: `${f.runtime.scope}beads/b`,
    properties: { title: "l" },
  });
  expect(createdLink).toEqual([{ operationIndex: 0, outcome: "created", resource: firstLink }]);
  const updatedLink = await post("updateLink", {
    link: "links/l",
    propertiesChange: [{ op: "replace", path: "/title", value: "l2" }],
  });
  const lastLink = commandResource(updatedLink[0]!.resource, {
    id: `${f.runtime.scope}links/l`,
    type: link,
    source: `${f.runtime.scope}beads/a`,
    target: `${f.runtime.scope}beads/b`,
    properties: { title: "l2" },
  });
  expect(lastLink.revision).not.toBe(firstLink.revision);
  expect(updatedLink).toEqual([{ operationIndex: 0, outcome: "updated", resource: lastLink }]);
  expect(await post("putAlias", { alias: "alias/work", target: "beads/c" })).toEqual([
    {
      operationIndex: 0,
      outcome: "created",
      alias: `${f.runtime.scope}alias/work`,
      target: `${f.runtime.scope}beads/c`,
    },
  ]);
  const selected = await post("updateWhere", {
    collection: "beads",
    selector: "$[?@.id]",
    change: [{ op: "add", path: "/marked", value: true }],
  });
  expect(selected).toHaveLength(4);
  expect(selected[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 3 });
  for (const [index, name] of ["a", "b", "c"].entries()) {
    const resource = commandResource(selected[index + 1]!.resource, {
      id: `${f.runtime.scope}beads/${name}`,
      type: bead,
      properties: { title: name === "c" ? "c2" : name, marked: true },
    });
    expect(selected[index + 1]).toEqual({ operationIndex: 0, outcome: "updated", resource });
    finalBeads.set(name, resource);
  }
  expect(await post("deleteAlias", { alias: "alias/work" })).toEqual([
    { operationIndex: 0, outcome: "deleted", alias: `${f.runtime.scope}alias/work` },
  ]);
  function deleted(resource: Record<string, unknown>, resourceKind: string) {
    return {
      operationIndex: 0,
      outcome: "deleted",
      deleted: {
        resourceKind,
        resource: { id: resource.id, type: resource.type, revision: resource.revision },
      },
    };
  }
  expect(await post("deleteLink", { link: "links/l" })).toEqual([deleted(lastLink, "link")]);
  const d = beadResult(await post("batch", { operations: [create("d")] }), "d", "d", "created");
  beadResult(
    await post("sequence", {
      operations: [{ ...create("e"), idempotencyKey: "all-sequence" }],
    }),
    "e",
    "e",
    "created",
  );
  expect(await post("deleteBead", { bead: "beads/d" })).toEqual([deleted(d, "bead")]);
  finalBeads.delete("d");
  expect(await post("deleteWhere", { collection: "links", selector: "$[?@.id]" })).toEqual([
    { operationIndex: 0, outcome: "matched", count: 1 },
    deleted(victim, "link"),
  ]);
  expect(seen.sort()).toEqual(Object.keys(expectedTargets).sort());
  for (const [collection, items] of [
    ["beads", ["a", "b", "c", "e"].map((name) => finalBeads.get(name))],
    ["links", []],
  ] as const) {
    count++;
    const response = await f.get(`${f.runtime.scope}${collection}/?limit=32`);
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ items, next: null });
  }
  count++;
  const alias = await f.get(`${f.runtime.scope}alias/work`);
  expect(alias.status).toBe(404);
  expect(alias.headers.has("location")).toBe(false);
  expect(checkedProblem(await body(alias)).code).toBe("resource-not-found");
  expect(wait).not.toHaveBeenCalled();
  expect(count).toBe(16);
});

it("copied read controls preserve key revision and negotiation admission", async () => {
  const f = await fixture();
  const headers = copiedMalformedMinimum;
  let count = 0;
  async function post(
    input: unknown,
    key: string | null,
    target: keyof typeof f.runtime.targets = "batch",
    extra: Record<string, string> = {},
  ) {
    count++;
    return f.post(JSON.stringify(input), key, target, { ...headers, ...extra });
  }
  async function read(name: string) {
    count++;
    const response = await f.get(`${f.runtime.scope}beads/${name}`);
    expect(response.status).toBe(200);
    return body(response);
  }
  const seedResponse = await post({ operations: [create()] }, "guard-seed");
  const seed = commandEntries(await commandResponse(seedResponse));
  expect(seed).toHaveLength(1);
  const original = commandResource(seed[0]!.resource, {
    id: `${f.runtime.scope}beads/a`,
    type: bead,
    properties: { title: "a" },
  });
  expect(seed).toEqual([{ operationIndex: 0, outcome: "created", resource: original }]);
  const fresh = { id: "beads/key-corrected", type: bead, properties: { title: "key-corrected" } };
  const invalid = await post(fresh, "bad key", "createBead");
  expect(invalid.status).toBe(400);
  expect(checkedProblem(await body(invalid))).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/request",
    status: 400,
    code: "malformed-request",
    retry: "never",
  });
  const corrected = commandEntries(
    await commandResponse(await post(fresh, "good-key", "createBead")),
  );
  expect(corrected).toHaveLength(1);
  const correctedResource = commandResource(corrected[0]!.resource, {
    id: `${f.runtime.scope}beads/key-corrected`,
    type: bead,
    properties: { title: "key-corrected" },
  });
  expect(corrected).toEqual([
    { operationIndex: 0, outcome: "created", resource: correctedResource },
  ]);
  const stale = {
    bead: "beads/a",
    expectedRevision: "wrong",
    propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
  };
  const failed = await commandResponse(
    await post(stale, "guard-failed", "updateBead"),
    false,
    "failed",
  );
  expect(failed.problem).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    status: 409,
    code: "revision-mismatch",
    retry: "after-state-change",
    operationIndex: 0,
  });
  expect(await read("a")).toEqual(original);
  expect(
    await commandResponse(await post(stale, "guard-failed", "updateBead"), false, "failed"),
  ).toEqual(failed);
  const updated = commandEntries(
    await commandResponse(
      await post({ ...stale, expectedRevision: original.revision }, "guard-valid", "updateBead"),
    ),
  );
  expect(updated).toHaveLength(1);
  const changed = commandResource(updated[0]!.resource, {
    id: `${f.runtime.scope}beads/a`,
    type: bead,
    properties: { title: "changed" },
  });
  expect(changed.revision).not.toBe(original.revision);
  expect(updated).toEqual([{ operationIndex: 0, outcome: "updated", resource: changed }]);
  expect(await read("a")).toEqual(changed);
  const negotiated = { id: "beads/negotiated", type: bead, properties: { title: "negotiated" } };
  const refused = await post(negotiated, "negotiate", "createBead", { accept: "text/plain" });
  expect(refused.status).toBe(406);
  expect(await refused.text()).toBe("");
  expect(refused.headers.has("content-type")).toBe(false);
  const admitted = commandEntries(
    await commandResponse(await post(negotiated, "negotiate", "createBead")),
  );
  expect(admitted).toHaveLength(1);
  const made = commandResource(admitted[0]!.resource, {
    id: `${f.runtime.scope}beads/negotiated`,
    type: bead,
    properties: { title: "negotiated" },
  });
  expect(admitted).toEqual([{ operationIndex: 0, outcome: "created", resource: made }]);
  expect(await read("negotiated")).toEqual(made);
  const sequence = {
    operations: [{ ...create("sequence-corrected"), idempotencyKey: "sequence-member" }],
  };
  const headerKey = await post(sequence, "forbidden-header", "sequence");
  expect(headerKey.status).toBe(400);
  expect(checkedProblem(await body(headerKey))).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/request",
    status: 400,
    code: "malformed-request",
    retry: "never",
  });
  const accepted = commandEntries(
    await commandResponse(await post(sequence, null, "sequence"), true),
  );
  expect(accepted).toHaveLength(1);
  const tail = commandResource(accepted[0]!.resource, {
    id: `${f.runtime.scope}beads/sequence-corrected`,
    type: bead,
    properties: { title: "sequence-corrected" },
  });
  expect(accepted).toEqual([{ operationIndex: 0, outcome: "created", resource: tail }]);
  expect(count).toBe(13);
});

it("keeps receipt minimum enforcement after commands ignore copied controls", async () => {
  let tick = 0;
  const f = await fixture({
    minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const created = await f.post(batch(), "receipt-minimum", "batch", copiedMalformedMinimum);
  const receipt = await commandResponse(created);
  const rows = commandEntries(receipt);
  expect(rows).toHaveLength(1);
  const resource = commandResource(rows[0]!.resource, {
    id: `${f.runtime.scope}beads/a`,
    type: bead,
    properties: { title: "a" },
  });
  expect(rows).toEqual([{ operationIndex: 0, outcome: "created", resource }]);
  const actual = context(created);
  for (const [headers, status, code, family] of [
    [minimumHeaders(created, "pos-99"), 503, "catch-up-timeout", "unavailable"],
    [
      { ...minimumHeaders(created), "bdp-authorization-view": "foreign" },
      409,
      "foreign-view",
      "conflict",
    ],
    [{ ...minimumHeaders(created), "bdp-scope-epoch": "foreign" }, 410, "cursor-expired", "gone"],
  ] as const) {
    const response = await f.get(id(receipt), { headers });
    const observed = await body(response);
    expect(
      response.status,
      `receipt minimum remains enforced: ${JSON.stringify({
        status: response.status,
        context: context(response),
        body: observed,
      })}`,
    ).toBe(status);
    expect(context(response)).toEqual(actual);
    expect(checkedProblem(observed)).toEqual({
      type: `https://github.com/gastownhall/bdp/problems/${family}`,
      status,
      code,
      retry: status === 503 ? "after-delay" : "after-state-change",
    });
    if (status === 503) expect(response.headers.get("retry-after")).toBe("1");
  }
  const compatible = await f.get(id(receipt), { headers: minimumHeaders(created) });
  expect(compatible.status).toBe(200);
  expect(context(compatible)).toEqual(actual);
  expect(await body(compatible)).toEqual(receipt);
  const head = await f.get(id(receipt), {
    method: "HEAD",
    headers: minimumHeaders(created, "pos-99"),
  });
  expect(head.status).toBe(503);
  expect(head.headers.get("retry-after")).toBe("1");
  expect(context(head)).toEqual(actual);
  expect(await head.text()).toBe("");
});

it("does not invent a Read method table for unrouted or noncanonical operation URLs", async () => {
  const f = await fixture();
  for (const target of [
    "unknown",
    "%62atch",
    "batch?x=1",
    "update-where?x=1",
    "delete-where?x=1",
  ]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await f.get(`${f.runtime.scope}operations/${target}`, {
        method,
        ...(method === "POST"
          ? {
              body: batch(),
              headers: { "content-type": "application/json", "idempotency-key": "unrouted" },
            }
          : {}),
      });
      expect(response.status).toBe(404);
      expect(response.headers.has("allow")).toBe(false);
      expect(await body(response)).toMatchObject({ code: "resource-not-found" });
    }
  }
  expect((await f.post(batch(), "unrouted")).status).toBe(200);
});

it("labels sequence depth gaps honestly and keeps sequence capacity distinct from direct transaction capacity", async () => {
  const f = await fixture({ maximumOperations: 1 });
  let nested: unknown = "leaf";
  for (let depth = 0; depth < 40; depth++) nested = { nested };
  const refused = await f.post(
    batch([{ ...create(), properties: { nested }, idempotencyKey: "deep_sequence" }]),
    null,
    "sequence",
  );
  expect(refused.status).toBe(500);
  expect(refused.headers.get("x-bdp-development-limit")).toBe(
    "unsupported-transaction-composition",
  );
  expect(await refused.text()).toBe("");
  expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
  const sequence = await f.post(
    batch([
      { ...create("a"), idempotencyKey: "deep_sequence" },
      { ...create("b"), idempotencyKey: "second" },
    ]),
    null,
    "sequence",
  );
  expect(sequence.status).toBe(200);
  expect(sequence.headers.get("bdp-scope-position")).toBe("pos-2");
  const direct = await f.post(batch([create("c"), create("d")]), "direct");
  expect(direct.status).toBe(413);
  expect(await body(direct)).toMatchObject({ limit: "transaction.operations" });
});

function minimumHeaders(
  response: Response,
  position = response.headers.get("bdp-scope-position") ?? "pos-0",
) {
  return {
    "bdp-scope-epoch": response.headers.get("bdp-scope-epoch") ?? "missing",
    "bdp-authorization-view": response.headers.get("bdp-authorization-view") ?? "missing",
    "bdp-minimum-scope-position": position,
  };
}

it("honors complete minimum tuples on point/properties/receipt GET and HEAD before conditions", async () => {
  const f = await fixture();
  const created = await f.post(),
    receipt = await body(created);
  await f.post(
    batch([
      create("b"),
      { operation: "createLink", id: "links/l", type: link, source: "beads/a", target: "beads/b" },
    ]),
    "second",
  );
  const headers = minimumHeaders(created);
  for (const target of [
    `${f.runtime.scope}beads/a`,
    `${f.runtime.scope}beads/a?view=properties`,
    `${f.runtime.scope}links/l`,
    `${f.runtime.scope}links/l?view=properties`,
    id(receipt),
  ]) {
    for (const method of ["GET", "HEAD"]) {
      for (const [condition, status] of [
        [{}, 200],
        [{ "if-none-match": "*" }, 304],
        [{ "if-match": '"wrong"' }, 412],
      ] as const) {
        const result = await f.get(target, { method, headers: { ...headers, ...condition } });
        expect(result.status).toBe(status);
        expect(result.headers.get("bdp-scope-position")).toBe("pos-2");
        expect(result.headers.get("bdp-scope-epoch")).toBe(headers["bdp-scope-epoch"]);
        if (status !== 200 || method === "HEAD") expect(await result.text()).toBe("");
      }
    }
  }
  expect(await body(await f.get(id(receipt), { headers }))).toEqual(receipt);
});

it("waits outside the owner until a real concurrent HTTP commit satisfies a point minimum", async () => {
  let fixtureValue: Awaited<ReturnType<typeof fixture>> | undefined,
    waits = 0;
  const f = await fixture({
    minimumReads: {
      budgetMs: 1000,
      wait: async () => {
        waits++;
        if (!fixtureValue) throw new Error("fixture missing");
        expect(
          (await fixtureValue.post(batch([create(`b_${waits}`)]), `advance_${waits}`)).status,
        ).toBe(200);
      },
    },
  });
  fixtureValue = f;
  const created = await f.post(),
    receipt = await body(created);
  const result = await f.get(`${f.runtime.scope}beads/a`, {
    headers: minimumHeaders(created, "pos-2"),
  });
  expect(result.status).toBe(200);
  expect(result.headers.get("bdp-scope-position")).toBe("pos-2");
  expect(waits).toBe(1);
  expect(await body(result)).toMatchObject({
    id: `${f.runtime.scope}beads/a`,
    properties: { title: "a" },
  });
  const receiptRead = await f.get(id(receipt), { headers: minimumHeaders(created, "pos-3") });
  expect(receiptRead.status).toBe(200);
  expect(receiptRead.headers.get("bdp-scope-position")).toBe("pos-3");
  expect(await body(receiptRead)).toEqual(receipt);
  expect(waits).toBe(2);
});

it("uses actual epoch/view decisions and an exhausted wait before conditional or timeout responses", async () => {
  let tick = 0;
  const f = await fixture({
    minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const created = await f.post(),
    receipt = await body(created),
    headers = minimumHeaders(created, "pos-99");
  for (const target of [`${f.runtime.scope}beads/a`, id(receipt)]) {
    const timeout = await f.get(target, { headers: { ...headers, "if-none-match": "*" } });
    expect(timeout.status).toBe(503);
    expect(timeout.headers.get("retry-after")).toBe("1");
    expect(timeout.headers.get("bdp-scope-position")).toBe("pos-1");
    expect(checkedProblem(await body(timeout))).toMatchObject({
      code: "catch-up-timeout",
      status: 503,
      retry: "after-delay",
    });
    for (const [field, code, status] of [
      ["bdp-scope-epoch", "cursor-expired", 410],
      ["bdp-authorization-view", "foreign-view", 409],
    ] as const) {
      const refused = await f.get(target, {
        headers: { ...headers, [field]: "foreign", "if-none-match": "*" },
      });
      expect(refused.status).toBe(status);
      expect(checkedProblem(await body(refused))).toMatchObject({ code });
      expect(refused.headers.get("bdp-scope-position")).toBe("pos-1");
    }
  }
  const hidden = await f.get(id(receipt), {
    headers: { ...headers, authorization: `Bearer ${otherToken}`, "bdp-scope-epoch": "foreign" },
  });
  expect(hidden.status).toBe(404);
  expect(hidden.headers.get("bdp-scope-position")).toBe("pos-1");
  for (const suffix of [
    "links/?cursor=missing",
    "",
    "bdp.json",
    "operations/",
    "beads/?cursor=missing",
  ]) {
    const target = `${f.runtime.scope}${suffix}`;
    const unsupported = await f.get(target, { headers });
    expect(unsupported.status).toBe(500);
    expect(unsupported.headers.get("x-bdp-development-limit")).toBe("minimum-position-route");
  }
  expect(
    (
      await f.get(`${f.runtime.scope}beads/a`, {
        headers: { ...headers, "bdp-minimum-scope-position": "opaque-unknown" },
      })
    ).status,
  ).toBe(500);
});

it("preserves authentication on commands carrying copied read controls without reserving keys", async () => {
  const f = await fixture();
  for (const carrier of ["batch", "createBead", "sequence"] as const) {
    for (const [authorization, status] of [
      ["", 401],
      [`Bearer ${readToken}`, 403],
    ] as const) {
      const key = `${carrier}_${status}`;
      const { operation, ...singleton } = create(key);
      const text =
        carrier === "createBead"
          ? JSON.stringify(singleton)
          : batch([
              {
                operation,
                ...singleton,
                ...(carrier === "sequence" ? { idempotencyKey: key } : {}),
              },
            ]);
      const response = await f.post(text, carrier === "sequence" ? null : key, carrier, {
        authorization,
        "bdp-minimum-scope-position": "pos-999",
      });
      expect(response.status).toBe(status);
      expect(response.headers.has("www-authenticate")).toBe(status === 401);
      expect(response.headers.has("x-bdp-development-limit")).toBe(false);
      expect((await f.get(`${f.runtime.scope}beads/${key}`)).status).toBe(404);
      expect(await f.receiptRows(key)).toEqual([]);
      expect((await f.post(batch([create(`${key}_replacement`)]), key)).status).toBe(200);
    }
  }
});

it("serves compatible missing Resource404 with context and preserves incompatible gaps without waiting", async () => {
  const wait = vi.fn(async () => {});
  const f = await fixture({ minimumReads: { budgetMs: 2, wait } });
  const created = await f.post(
    batch([
      create("a"),
      create("b"),
      { operation: "createLink", id: "links/l", type: link, source: "beads/a", target: "beads/b" },
    ]),
  );
  expect(created.status).toBe(200);
  const removed = await f.post(
    batch([
      { operation: "deleteLink", link: "links/l" },
      { operation: "deleteBead", bead: "beads/a" },
    ]),
    "removed",
  );
  expect(removed.status).toBe(200);
  expect(removed.headers.get("bdp-scope-position")).toBe("pos-2");
  for (const id of ["beads/missing", "links/missing", "beads/a", "links/l"])
    for (const view of ["", "?view=properties"])
      for (const method of ["GET", "HEAD"])
        for (const earlier of [true, false]) {
          const response = await f.get(`${f.runtime.scope}${id}${view}`, {
            method,
            headers: {
              ...minimumHeaders(earlier ? created : removed),
              ...(earlier ? { "if-none-match": "*" } : { "if-match": '"mismatch"' }),
            },
          });
          expect(response.status).toBe(404);
          expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
          for (const name of ["bdp-scope-epoch", "bdp-authorization-view"])
            expect(response.headers.get(name)).toBe(removed.headers.get(name));
          expect(response.headers.get("cache-control")).toBe("private, no-store");
          expect(response.headers.has("etag")).toBe(false);
          expect(response.headers.get("content-type")).toBe("application/problem+json");
          if (method === "HEAD") {
            expect(await response.text()).toBe("");
            expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
          } else
            expect(checkedProblem(await body(response))).toMatchObject({
              code: "resource-not-found",
              status: 404,
            });
        }
  for (const method of ["GET", "HEAD"]) {
    const response = await f.get(`${f.runtime.scope}beads/missing`, {
      method,
      headers: minimumHeaders(removed),
    });
    expect(response.status).toBe(404);
    for (const name of ["bdp-scope-position", "bdp-scope-epoch", "bdp-authorization-view"])
      expect(response.headers.get(name)).toBe(removed.headers.get(name));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    if (method === "HEAD") {
      expect(await response.text()).toBe("");
      expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    } else
      expect(checkedProblem(await body(response))).toMatchObject({
        code: "resource-not-found",
        status: 404,
      });
  }
  for (const suffix of [
    "beads/missing",
    "links/missing",
    "beads/missing?view=properties",
    "links/missing?view=properties",
  ])
    for (const method of ["GET", "HEAD"])
      for (const extra of [
        { "bdp-scope-epoch": "foreign" },
        { "bdp-authorization-view": "foreign" },
        { "bdp-minimum-scope-position": "pos-99" },
      ]) {
        const response = await f.get(`${f.runtime.scope}${suffix}`, {
          method,
          headers: { ...minimumHeaders(removed), ...extra },
        });
        expect(response.status).toBe(500);
        expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position-visibility");
        for (const name of ["bdp-scope-position", "bdp-scope-epoch", "bdp-authorization-view"])
          expect(response.headers.has(name)).toBe(false);
        expect(await response.text()).toBe("");
      }
  expect(wait).not.toHaveBeenCalled();
  const malformed = await f.get(`${f.runtime.scope}beads/missing`, {
    headers: minimumHeaders(removed, "unissued"),
  });
  expect(malformed.status).toBe(500);
  expect(malformed.headers.get("x-bdp-development-limit")).toBe("minimum-position");
  const anonymous = await f.get(`${f.runtime.scope}beads/missing`, {
    headers: { ...minimumHeaders(removed), authorization: "" },
  });
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.has("bdp-scope-position")).toBe(false);
});

it("uses the final actual attempt context for GET and HEAD timeouts after real progress", async () => {
  let tick = 0,
    writes = 0;
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({
    minimumReads: {
      budgetMs: 2,
      now: () => tick++,
      wait: async () => {
        writes++;
        expect(
          (await f.post(batch([create(`progress_${writes}`)]), `progress_${writes}`)).status,
        ).toBe(200);
      },
    },
  });
  const created = await f.post(),
    receipt = await body(created);
  for (const target of [`${f.runtime.scope}beads/a`, id(receipt)]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await f.get(target, { method, headers: minimumHeaders(created, "pos-99") });
      expect(response.status).toBe(503);
      expect(response.headers.get("bdp-scope-position")).toBe(`pos-${writes + 1}`);
      expect(response.headers.get("retry-after")).toBe("1");
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(checkedProblem(await body(response)).code).toBe("catch-up-timeout");
    }
  }
  expect(writes).toBe(4);
});

it("preserves concrete query syntax failures and accepts the reserved genesis minimum", async () => {
  const f = await fixture(),
    created = await f.post();
  const headers = minimumHeaders(created, "genesis");
  expect((await f.get(`${f.runtime.scope}beads/a`, { headers })).status).toBe(200);
  for (const suffix of [
    "beads/a?unknown=1",
    "beads/a?view=bogus",
    "beads/a?view=properties&unknown=2",
  ]) {
    const response = await f.get(`${f.runtime.scope}${suffix}`, { headers });
    expect(response.status).toBe(400);
    expect(checkedProblem(await body(response)).code).toBe("invalid-parameter");
  }
});

it.each([1, 2, 5])(
  "serves immutable receipt pages at the exact configured maximum %s",
  async (maximum) => {
    const f = await fixture({ receiptMaximumItems: maximum });
    const input = batch(Array.from({ length: 5 }, (_, index) => create(`page_${index}`)));
    const response = await f.post(input),
      receipt = await body(response);
    const validateReceipt = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
    const validatePage = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceiptPage` });
    expect(validateReceipt(receipt), JSON.stringify(validateReceipt.errors)).toBe(true);
    expect(receipt.results).toHaveLength(maximum);
    const collected = [...(receipt.results as unknown[])],
      pages: { url: string; body: Record<string, unknown> }[] = [];
    let next = receipt.next;
    while (typeof next === "string") {
      const pageResponse = await f.get(next),
        page = await body(pageResponse);
      expect(pageResponse.status).toBe(200);
      expect(validatePage(page), JSON.stringify(validatePage.errors)).toBe(true);
      expect(page.receipt).toBe(receipt.id);
      expect((page.results as unknown[]).length).toBeLessThanOrEqual(maximum);
      pages.push({ url: next, body: page });
      collected.push(...(page.results as unknown[]));
      next = page.next;
    }
    expect(next).toBeNull();
    expect(collected).toHaveLength(5);
    expect(collected.map((entry) => record(entry).operationIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(await body(await f.post(input))).toEqual(receipt);
    await f.reopen();
    expect(await body(await f.get(id(receipt)))).toEqual(receipt);
    for (const page of pages) expect(await body(await f.get(page.url))).toEqual(page.body);
    expect((await f.post(batch([create("later")]), "later")).status).toBe(200);
    for (const page of pages) {
      for (const method of ["GET", "HEAD"]) {
        for (const [conditions, status] of [
          [{}, 200],
          [{ "if-none-match": "*" }, 304],
          [{ "if-match": '"different"' }, 412],
        ] as const) {
          const selected = await f.get(page.url, {
            method,
            headers: { ...minimumHeaders(response, "pos-2"), ...conditions },
          });
          expect(selected.status).toBe(status);
          expect(selected.headers.get("bdp-scope-position")).toBe("pos-2");
          expect(selected.headers.has("etag")).toBe(false);
          expect(selected.headers.has("last-modified")).toBe(false);
          expect(selected.headers.get("cache-control")).toBe("private, no-store");
          if (method === "HEAD" || status !== 200) expect(await selected.text()).toBe("");
          else expect(await body(selected)).toEqual(page.body);
        }
      }
    }
  },
);
it("orders page nondisclosure, minimum waits, expiry and representation using actual owner state", async () => {
  let tick = 0;
  const f = await fixture({
    receiptMaximumItems: 2,
    minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const created = await f.post(batch([create("a"), create("b"), create("c")])),
    receipt = await body(created);
  const next = String(receipt.next),
    headers = minimumHeaders(created, "pos-99");
  f.setTime(86401001);
  for (const principal of [token, otherToken]) {
    const unsupported = await f.get(next, {
      headers: { authorization: `Bearer ${principal}`, "bdp-minimum-scope-position": "pos-99" },
    });
    expect(unsupported.status).toBe(400);
    expect(checkedProblem(await body(unsupported)).code).toBe("malformed-request");
    expect(unsupported.headers.get("x-bdp-development-limit")).toBeNull();
    for (const header of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(unsupported.headers.has(header)).toBe(false);
  }
  expect((await f.get(`${id(receipt)}/pages`)).status).toBe(404);
  for (const method of ["GET", "HEAD"]) {
    for (const [auth, status] of [
      ["", 401],
      [`Bearer ${otherToken}`, 404],
    ] as const) {
      const denied = await f.get(next, {
        method,
        headers: { ...headers, authorization: auth, "bdp-scope-epoch": "foreign" },
      });
      expect(denied.status).toBe(status);
      expect(denied.headers.has("bdp-scope-position")).toBe(status === 404);
    }
    const unknown = await f.get(`${id(receipt)}/pages/unknown`, { method, headers });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("bdp-scope-position")).toBe("pos-1");
    const timeout = await f.get(next, { method, headers });
    expect(timeout.status).toBe(503);
    expect(timeout.headers.get("retry-after")).toBe("1");
    expect(timeout.headers.get("bdp-scope-position")).toBe("pos-1");
    if (method === "GET") expect(checkedProblem(await body(timeout)).code).toBe("catch-up-timeout");
    const foreign = await f.get(next, {
      method,
      headers: { ...headers, "bdp-authorization-view": "foreign" },
    });
    expect(foreign.status).toBe(409);
    const expired = await f.get(next, {
      method,
      headers: { ...minimumHeaders(created), "if-none-match": "*" },
    });
    expect(expired.status).toBe(410);
    expect(expired.headers.get("bdp-scope-position")).toBe("pos-1");
    if (method === "GET") expect(checkedProblem(await body(expired)).code).toBe("cursor-expired");
  }
  expect(await body(await f.get(id(receipt)))).toMatchObject({
    detail: "expired",
    allocated: expect.any(Array),
  });
  const wrongMethod = await f.get(next, { method: "DELETE", headers: { authorization: "" } });
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("allow")).toBe("GET, HEAD");
  expect(await wrongMethod.text()).toBe("");
});

it("keeps singleton, alias, no-op, failed and sequence outcomes valid with a page maximum of one", async () => {
  const f = await fixture({ receiptMaximumItems: 1 });
  const created = await body(await f.post());
  expect(created.next).toBeNull();
  const alias = await body(
    await f.post(JSON.stringify({ alias: "alias/latest", target: "beads/a" }), "alias", "putAlias"),
  );
  expect(alias).toMatchObject({ next: null, results: [{ outcome: "created" }] });
  const noop = await body(
    await f.post(
      batch([
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/title", value: "a" }],
        },
      ]),
      "noop",
    ),
  );
  expect(noop).toMatchObject({
    next: null,
    results: [{ outcome: "updated" }],
    requiredPosition: "pos-1",
  });
  expect(noop.effectPosition).toBeUndefined();
  const failed = await body(
    await f.post(batch([{ operation: "deleteBead", bead: "beads/missing" }]), "failed"),
  );
  expect(failed.status).toBe("failed");
  expect(failed.next).toBeUndefined();
  expect(failed.results).toBeUndefined();
  const sequence = await body(
    await f.post(batch([{ ...create(), idempotencyKey: "key" }]), null, "sequence"),
  );
  expect(sequence).toMatchObject({ results: [{ outcome: "created" }] });
});
it("checks a stored failed receipt minimum before read-triggered retention disposal over HTTP", async () => {
  let tick = 0,
    f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({
    minimumReads: {
      budgetMs: 2,
      now: () => tick++,
      wait: async () => {
        f.setTime(86401001);
      },
    },
  });
  const created = await f.post(batch([{ operation: "deleteBead", bead: "beads/missing" }]));
  const failed = await body(created);
  const result = await f.get(id(failed), { headers: minimumHeaders(created, "pos-99") });
  expect(result.status).toBe(503);
  expect(checkedProblem(await body(result)).code).toBe("catch-up-timeout");
  expect(result.headers.get("bdp-scope-position")).toBe("pos-0");
  expect((await f.get(id(failed))).status).toBe(404);
});

it("refuses unsupported root controls after nondisclosure but before read-triggered retention", async () => {
  const f = await fixture({ maintenanceIntervalMs: 60000 });
  const completed = await body(await f.post());
  const failed = await body(
    await f.post(batch([{ operation: "deleteBead", bead: "beads/missing" }]), "failed"),
  );
  f.setTime(86401001);
  // Cross the ordinary one-second sweep interval using real timers/sockets.
  // This test isolates read-triggered retention from independent maintenance.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  for (const receipt of [completed, failed]) {
    for (const method of ["GET", "HEAD"]) {
      for (const [credential, status] of [
        [token, 500],
        [otherToken, 404],
      ] as const) {
        const response = await f.get(id(receipt), {
          method,
          headers: {
            authorization: `Bearer ${credential}`,
            "bdp-minimum-scope-position": "unknown",
            "bdp-scope-epoch": String(receipt.scopeEpoch),
            "bdp-authorization-view": String(receipt.authorizationView),
          },
        });
        expect(response.status).toBe(status);
        if (status === 500)
          expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
        for (const header of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers.has(header)).toBe(status === 404);
        if (status === 500 || method === "HEAD") expect(await response.text()).toBe("");
      }
    }
  }
  // Inspect after closing, without reopening (startup maintenance may legitimately expire them).
  expect(await f.retainedReceipts()).toEqual([failed, completed]);
});

it("keeps failed parent rows unchanged for nonexistent page reads with any controls", async () => {
  const f = await fixture({ maintenanceIntervalMs: 60000 });
  const created = await f.post(batch([{ operation: "deleteBead", bead: "beads/missing" }]));
  const failed = await body(created);
  f.setTime(86401001);
  for (const method of ["GET", "HEAD"]) {
    for (const credential of [token, otherToken]) {
      for (const controls of [
        {},
        minimumHeaders(created, "unknown"),
        minimumHeaders(created, "pos-99"),
        { ...minimumHeaders(created), "bdp-authorization-view": "foreign" },
      ]) {
        const response = await f.get(`${id(failed)}/pages/never-issued`, {
          method,
          headers: { ...controls, authorization: `Bearer ${credential}` },
        });
        expect(response.status).toBe(404);
        for (const header of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers.get(header)).toBe(created.headers.get(header));
        if (method === "GET")
          expect(checkedProblem(await body(response)).code).toBe("resource-not-found");
        else expect(await response.text()).toBe("");
      }
    }
  }
  expect(await f.retainedReceipts()).toEqual([failed]);
});

it("serves both set targets with method/auth/shape precedence and no unsupported-key capture", async () => {
  const f = await fixture();
  for (const target of ["updateWhere", "deleteWhere"] as const) {
    for (const method of ["GET", "HEAD", "DELETE"]) {
      const wrong = await f.get(f.runtime.targets[target], {
        method,
        headers: { authorization: "" },
      });
      expect(wrong.status).toBe(405);
      expect(wrong.headers.get("allow")).toBe("POST");
      expect(await wrong.text()).toBe("");
    }
    const input = {
      collection: "beads",
      selector: "$..*",
      ...(target === "updateWhere" ? { change: [{ op: "add", path: "/x", value: 1 }] } : {}),
    };
    for (const carrier of [target, "batch"] as const) {
      const text = JSON.stringify(
        carrier === "batch"
          ? { operations: [{ operation: target, ...input }, create("late")] }
          : input,
      );
      for (const [authorization, status] of [
        ["", 401],
        [`Bearer ${readToken}`, 403],
      ] as const) {
        const key = `${target}_${carrier}_${status}`;
        const response = await f.post(text.replace("$..*", selectorHttpBytes(4097)), key, carrier, {
          authorization,
        });
        expect(response.status).toBe(status);
        expect(response.headers.has("x-bdp-development-limit")).toBe(false);
        expect(await f.receiptRows(key)).toEqual([]);
        expect((await f.get(`${f.runtime.scope}beads/late`)).status).toBe(404);
        expect((await f.post(batch([create(key)]), key)).status).toBe(200);
      }
      const gapKey = `${target}_${carrier}_gap`;
      const gap = await f.post(text, gapKey, carrier, {
        authorization: target === "updateWhere" ? "" : `Bearer ${readToken}`,
      });
      expect(gap.status).toBe(400);
      expect(gap.headers.has("x-bdp-development-limit")).toBe(false);
      expect(checkedProblem(await body(gap))).toMatchObject({
        status: 400,
        code: "malformed-request",
        pointer: carrier === "batch" ? "/operations/0/selector" : "/selector",
      });
      expect(await f.receiptRows(gapKey)).toEqual([]);
    }
    const malformed = await f.post(
      JSON.stringify({ ...input, operation: target }),
      `${target}_malformed`,
      target,
      { authorization: "" },
    );
    expect(malformed.status).toBe(400);
    expect(await f.receiptRows(`${target}_malformed`)).toEqual([]);
  }
  const lateMalformed = await f.post(
    batch([
      { operation: "deleteWhere", collection: "beads", selector: "$..*" },
      {
        operation: "updateWhere",
        collection: "beads",
        selector: "$[?@.id]",
        change: [],
        cardinality: {},
      },
    ]),
    "later_bad",
    "batch",
    { authorization: "" },
  );
  expect(lateMalformed.status).toBe(400);
  expect(await f.receiptRows("later_bad")).toEqual([]);
});

it("shares set singleton/batch receipts and preserves original numeric pointers on actual wire", async () => {
  const f = await fixture();
  await f.post();
  const input = {
    collection: "beads",
    selector: "$[?@.id]",
    change: [{ op: "add", path: "/n", value: 1 }],
  };
  const first = await body(await f.post(JSON.stringify(input), "set", "updateWhere"));
  expect(first).toMatchObject({
    status: "completed",
    results: [
      { outcome: "matched", count: 1 },
      { outcome: "updated", resource: { properties: { title: "a", n: 1 } } },
    ],
  });
  await f.post(batch([create("later")]), "later");
  expect(await body(await f.post(batch([{ operation: "updateWhere", ...input }]), "set"))).toEqual(
    first,
  );
  expect((await body(await f.get(`${f.runtime.scope}beads/later`))).properties).toEqual({
    title: "later",
  });
  const raw = '{"collection":"beads","selector":"$[?@.id]","cardinality":{"min":9007199254740993}}';
  const failed = await f.post(raw, "numeric", "deleteWhere");
  expect(failed.status).toBe(200);
  const receipt = await body(failed);
  expect(receipt).toMatchObject({
    status: "failed",
    problem: {
      status: 422,
      code: "validation-failed",
      operationIndex: 0,
      pointer: "/cardinality/min",
    },
  });
  expect(
    await body(
      await f.post(`{"operations":[{"operation":"deleteWhere",${raw.slice(1)}]}`, "numeric"),
    ),
  ).toEqual(receipt);
  const conflict = await f.post(
    raw.replace("9007199254740993", "9007199254740994"),
    "numeric",
    "deleteWhere",
    { accept: "text/plain" },
  );
  expect(conflict.status).toBe(409);
  expect((await f.post(raw, "numeric", "deleteWhere", { accept: "text/plain" })).status).toBe(406);
});

it("evaluates each served set against staged state and rolls back a late failed patch", async () => {
  const f = await fixture();
  const update = (selector: string, value: number) => ({
    operation: "updateWhere",
    collection: "beads",
    selector,
    change: [{ op: "add", path: "/n", value }],
  });
  const result = await body(
    await f.post(
      batch([
        create("a"),
        update('$[?@.properties.title == "a"]', 1),
        update("$[?@.properties.n == 1]", 2),
      ]),
    ),
  );
  expect(result).toMatchObject({
    status: "completed",
    results: [
      { outcome: "created" },
      { outcome: "matched", count: 1 },
      { outcome: "updated", resource: { properties: { n: 1 } } },
      { outcome: "matched", count: 1 },
      { outcome: "updated", resource: { properties: { n: 2 } } },
    ],
  });
  const before = await body(await f.get(`${f.runtime.scope}beads/a`));
  const failed = await body(
    await f.post(
      batch([
        create("tentative"),
        update("$[?@.id]", 3),
        {
          operation: "updateWhere",
          collection: "beads",
          selector: "$[?@.id]",
          change: [{ op: "remove", path: "/missing" }],
        },
      ]),
      "rollback",
    ),
  );
  expect(failed).toMatchObject({
    status: "failed",
    problem: {
      code: "validation-failed",
      operationIndex: 2,
      pointer: "/operations/2/change/0/path",
    },
  });
  expect(await body(await f.get(`${f.runtime.scope}beads/a`))).toEqual(before);
  expect((await f.get(`${f.runtime.scope}beads/tentative`)).status).toBe(404);
});

it("does not implicitly match pinned endpoints and atomically rolls back the incomplete cascade", async () => {
  const f = await fixture();
  await f.post(batch([create("a"), create("b")]));
  const a = await body(await f.get(`${f.runtime.scope}beads/a`));
  const linkInput = { operation: "createLink", type: link, target: "beads/b" };
  const seeded = await f.post(
    batch([
      { ...linkInput, id: "links/bare", source: "beads/a" },
      { ...linkInput, id: "links/pinned", source: { uri: "beads/a", revision: a.revision } },
    ]),
    "links",
  );
  const beforeContext = context(seeded);
  expect(await body(seeded)).toMatchObject({ status: "completed" });
  const bare = await body(await f.get(`${f.runtime.scope}links/bare`));
  const pinned = await body(await f.get(`${f.runtime.scope}links/pinned`));
  // Exact stored-value semantics select only the bare endpoint, not its pinned peer.
  const selector = `$[?@.source == "${f.runtime.scope}beads/a"]`;
  const failed = await f.post(
    batch([
      { operation: "deleteWhere", collection: "links", selector, cardinality: { min: 1, max: 1 } },
      { operation: "deleteBead", bead: "beads/a", expectedRevision: a.revision },
    ]),
    "cascade",
  );
  expect(context(failed)).toEqual(beforeContext);
  expect(await body(failed)).toMatchObject({
    status: "failed",
    problem: { code: "incident-links-exist", operationIndex: 1 },
  });
  expect(await body(await f.get(`${f.runtime.scope}links/bare`))).toEqual(bare);
  expect(await body(await f.get(`${f.runtime.scope}links/pinned`))).toEqual(pinned);
  expect(await body(await f.get(`${f.runtime.scope}beads/a`))).toEqual(a);
});

it("finishes an admitted set after actual client disconnect and replays it after reopen", async () => {
  let armed = false,
    request: ReturnType<typeof httpRequest> | undefined;
  const f = await fixture();
  await f.post();
  const exec = DatabaseSync.prototype.exec;
  let cancelledPending = false;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    exec.call(this, sql);
    if (armed && sql === "COMMIT") {
      const row = this.prepare("SELECT receipt FROM receipts WHERE key=?").get("disconnected_set");
      if (row && JSON.parse(String(row.receipt)).status === "pending") {
        armed = false;
        cancelledPending = true;
        request?.destroy();
      }
    }
  });
  const input = {
    collection: "beads",
    selector: "$[?@.id]",
    change: [{ op: "add", path: "/n", value: 1 }],
  };
  armed = true;
  request = httpRequest(f.runtime.targets.updateWhere, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "disconnected_set",
    },
  });
  request.on("error", () => {}); // Expected ECONNRESET from our actual client-side cancellation.
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("set disconnect did not close")), 5000);
    request!.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  request.end(JSON.stringify(input));
  await closed;
  expect(cancelledPending).toBe(true);
  armed = false;
  await f.reopen();
  const replay = await body(
    await f.post(batch([{ operation: "updateWhere", ...input }]), "disconnected_set"),
  );
  expect(replay).toMatchObject({
    status: "completed",
    effectPosition: "pos-2",
    results: [
      { outcome: "matched", count: 1 },
      { outcome: "updated", resource: { properties: { title: "a", n: 1 } } },
    ],
  });
  expect(
    await body(await f.post(JSON.stringify(input), "disconnected_set", "updateWhere")),
  ).toEqual(replay);
  expect((await body(await f.get(`${f.runtime.scope}beads/a`))).properties).toEqual({
    title: "a",
    n: 1,
  });
});

it.each(["root", "member", "member-key", "set-patch", "later-member"] as const)(
  "finishes known %s shape checks before a private depth gap on actual HTTP",
  async (defect) => {
    const f = await fixture();
    let value: unknown = 0;
    for (let i = 0; i < 40; i++) value = { nested: value };
    const deep = { ...create("deep"), properties: { value } };
    const set = {
      operation: "updateWhere",
      collection: "beads",
      selector: "$[?@.id]",
      change: [{ op: "add", path: "/deep", value }],
    };
    const malformed =
      defect === "root"
        ? { operations: [deep], extra: 1 }
        : defect === "member"
          ? { operations: [{ ...deep, extra: 1 }] }
          : defect === "member-key"
            ? { operations: [{ ...deep, idempotencyKey: "member" }] }
            : defect === "set-patch"
              ? { operations: [{ ...set, change: [...set.change, { op: "bad", path: "/x" }] }] }
              : { operations: [set, { ...create("late"), extra: 1 }] };
    for (const authorization of [`Bearer ${token}`, ""]) {
      const response = await f.post(JSON.stringify(malformed), "depth_shape", "batch", {
        authorization,
      });
      expect(response.status).toBe(400);
      expect(checkedProblem(await body(response)).code).toBe("malformed-request");
      expect(response.headers.has("x-bdp-development-limit")).toBe(false);
      expect(await f.receiptRows("depth_shape")).toEqual([]);
      expect((await f.get(`${f.runtime.scope}beads/deep`)).status).toBe(404);
    }
    expect((await f.post(batch([create()]), "depth_shape")).status).toBe(200);
  },
);

it.each(["updateWhere", "deleteWhere"] as const)(
  "rejects %s sequence members before any member key or receipt is captured",
  async (operation) => {
    const f = await fixture();
    const response = await f.post(
      batch([
        { ...create("before"), idempotencyKey: "before" },
        {
          operation,
          collection: "beads",
          selector: "$[?@.id]",
          ...(operation === "updateWhere" ? { change: [{ op: "add", path: "/n", value: 1 }] } : {}),
          idempotencyKey: "set_member",
        },
      ]),
      null,
      "sequence",
    );
    expect(response.status).toBe(400);
    expect(checkedProblem(await body(response)).code).toBe("malformed-request");
    expect(await f.receiptRows("before")).toEqual([]);
    expect(await f.receiptRows("set_member")).toEqual([]);
    expect((await f.get(`${f.runtime.scope}beads/before`)).status).toBe(404);
    expect((await f.post(batch([create("before")]), "before")).status).toBe(200);
  },
);

it("preserves actual singleton bytes and wrapper-equivalent depth without accepting a body operation override", async () => {
  const f = await fixture();
  const invalid = await f.post(
    JSON.stringify({ operation: "deleteWhere", collection: "beads", selector: "$[?@.id]" }),
    "override",
    "updateWhere",
  );
  expect(invalid.status).toBe(400);
  expect(await f.receiptRows("override")).toEqual([]);
  for (const [depth, status] of [
    [27, 200],
    [28, 500],
  ] as const) {
    let value: unknown = 0;
    for (let i = 0; i < depth; i++) value = { nested: value };
    const input = {
      collection: "beads",
      selector: "$[?@.id]",
      change: [{ op: "add", path: "/deep", value }],
    };
    for (const target of ["updateWhere", "batch"] as const) {
      const key = `parity_${depth}_${target}`;
      const response = await f.post(
        target === "batch"
          ? batch([{ operation: "updateWhere", ...input }])
          : JSON.stringify(input),
        key,
        target,
      );
      expect(response.status).toBe(status);
      if (status === 500) {
        expect(response.headers.get("x-bdp-development-limit")).toBe(
          "unsupported-transaction-composition",
        );
        expect(await response.text()).toBe("");
        expect(await f.receiptRows(key)).toEqual([]);
      } else
        expect(await body(response)).toMatchObject({
          status: "completed",
          results: [{ outcome: "matched", count: 0 }],
        });
    }
  }
  const template = {
    collection: "beads",
    selector: "$[?@.id]",
    change: [{ op: "add", path: "/padding", value: "" }],
  };
  const input = {
    ...template,
    change: [
      {
        ...template.change[0],
        value: "x".repeat(65536 - Buffer.byteLength(JSON.stringify(template))),
      },
    ],
  };
  const text = JSON.stringify(input);
  expect(Buffer.byteLength(text)).toBe(65536);
  const accepted = await f.post(text, "full_body", "updateWhere");
  expect(accepted.status).toBe(200);
  expect(await body(accepted)).toMatchObject({
    status: "completed",
    results: [{ outcome: "matched", count: 0 }],
  });
  for (const [bodyText, target] of [
    [text + " ", "updateWhere"],
    [batch([{ operation: "updateWhere", ...input }]), "batch"],
  ] as const) {
    const refused = await f.post(bodyText, "oversize", target);
    expect(refused.status).toBe(413);
    expect(checkedProblem(await body(refused)).code).toBe("request-too-large");
    expect(await f.receiptRows("oversize")).toEqual([]);
  }
});

it.each(["beads", "links"])(
  "deterministically re-enters after a behind %s collection attempt and exposes the intervening commit",
  async (collection) => {
    let current: Awaited<ReturnType<typeof fixture>> | undefined;
    let waits = 0;
    const f = await fixture({
      minimumReads: {
        budgetMs: 1000,
        wait: async () => {
          waits++;
          if (!current) throw new Error("missing fixture");
          const operation =
            collection === "beads"
              ? {
                  operation: "updateBead",
                  bead: "beads/a",
                  propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
                }
              : {
                  operation: "updateLink",
                  link: "links/l",
                  propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
                };
          expect(
            (await current.post(batch([operation]), `advance_${collection}_${waits}`)).status,
          ).toBe(200);
        },
      },
    });
    current = f;
    const seed = await f.post(
      batch([
        create(),
        {
          operation: "createLink",
          id: "links/l",
          type: link,
          source: "beads/a",
          target: "beads/a",
          properties: { title: "before" },
        },
      ]),
    );
    const response = await f.get(`${f.runtime.scope}${collection}/`, {
      headers: minimumHeaders(seed, "pos-2"),
    });
    expect(waits).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(response.headers.has("etag")).toBe(false);
    const rows = (await body(response)).items as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: `${f.runtime.scope}${collection}/${collection === "beads" ? "a" : "l"}`,
      properties: { title: "after" },
    });
    expect(typeof rows[0]?.revision).toBe("string");
  },
);

it("preserves materialized collection control Problems before a behind minimum without waiting", async () => {
  const wait = vi.fn(async () => {});
  const f = await fixture({ minimumReads: { budgetMs: 2, wait } });
  const seed = await f.post();
  const headers = minimumHeaders(seed, "pos-2");
  for (const [query, status, code] of [
    ["limit=33", 413, "limit-exceeded"],
    ["selector=" + encodeURIComponent("$[?"), 400, "invalid-parameter"],
    [
      "selector=" + encodeURIComponent("$[?@.title == '" + "x".repeat(4100) + "']"),
      413,
      "limit-exceeded",
    ],
    ["limit=0", 400, "invalid-parameter"],
    ["limit=1&limit=2", 400, "invalid-parameter"],
  ] as const) {
    const response = await f.get(`${f.runtime.scope}beads/?${query}`, { headers });
    expect(response.status).toBe(status);
    expect(checkedProblem(await body(response))).toMatchObject({ status, code, retry: "never" });
  }
  expect(wait).not.toHaveBeenCalled();
  const result = await f.get(`${f.runtime.scope}beads/?limit=1`, {
    headers: minimumHeaders(seed, "pos-1"),
  });
  expect(result.status).toBe(200);
});

it.each([
  ["beads/", "GET"],
  ["beads/a", "GET"],
  ["snapshot", "GET"],
  ["snapshot", "HEAD"],
])("stops %s %s retries after synchronized actual Node disconnect", async (suffix, method) => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    aborted = Promise.withResolvers<void>();
  let waits = 0,
    tick = 0;
  const abort = AbortController.prototype.abort;
  vi.spyOn(AbortController.prototype, "abort").mockImplementation(function (
    this: AbortController,
    reason?: unknown,
  ) {
    abort.call(this, reason);
    if (reason instanceof Error && reason.message === "client disconnected") aborted.resolve();
  });
  const f = await fixture({
    minimumReads: {
      budgetMs: 10,
      now: () => tick++,
      wait: async () => {
        waits++;
        entered.resolve();
        await release.promise;
      },
    },
  });
  const seed = await f.post();
  const req = httpRequest(`${f.runtime.scope}${suffix}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...minimumHeaders(seed, "pos-2") },
  });
  req.on("error", () => {});
  const timer = setTimeout(() => {
    entered.reject(new Error("behind attempt unavailable"));
    aborted.reject(new Error("Node abort unavailable"));
    release.resolve();
  }, 3000);
  try {
    req.end();
    await entered.promise;
    req.destroy();
    await aborted.promise; // Node listener has called the real server AbortController.
    release.resolve();
    await f.runtime.close();
    expect(waits).toBe(1);
  } finally {
    clearTimeout(timer);
    req.destroy();
    release.resolve();
  }
});

it("serves complete fresh Snapshot minima with exact timeout, foreign and conditional context", async () => {
  let tick = 0;
  const f = await fixture({
    minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const seed = await f.post();
  const url = `${f.runtime.scope}snapshot`;
  const expected = {
    "bdp-scope-epoch": seed.headers.get("bdp-scope-epoch"),
    "bdp-authorization-view": seed.headers.get("bdp-authorization-view"),
    "bdp-scope-position": "pos-1",
  };
  for (const [method, conditions, eligible] of [
    ["GET", {}, 200],
    ["HEAD", {}, 200],
    ["GET", { "if-none-match": "*" }, 304],
    ["GET", { "if-match": '"absent"' }, 412],
    ["GET", { accept: "text/plain" }, 406],
  ] as const) {
    for (const minimum of ["pos-1", "pos-2"]) {
      const result = await f.get(url, {
        method,
        headers: { ...minimumHeaders(seed, minimum), ...conditions },
      });
      expect(result.status).toBe(minimum === "pos-1" ? eligible : 503);
      if (minimum === "pos-2") expect(result.headers.get("retry-after")).toBe("1");
      for (const [header, value] of Object.entries(expected))
        expect(result.headers.get(header)).toBe(value);
      if (method === "HEAD" || (minimum === "pos-1" && eligible !== 200))
        expect(await result.text()).toBe("");
      else if (minimum === "pos-2")
        expect(checkedProblem(await body(result))).toMatchObject({
          code: "catch-up-timeout",
          type: "https://github.com/gastownhall/bdp/problems/unavailable",
          status: 503,
          retry: "after-delay",
        });
      else
        expect(await body(result)).toMatchObject({
          scopePosition: "pos-1",
          beads: { items: [{ properties: { title: "a" } }] },
        });
    }
  }
  for (const [header, status, code, family] of [
    ["bdp-scope-epoch", 410, "cursor-expired", "gone"],
    ["bdp-authorization-view", 409, "foreign-view", "conflict"],
  ] as const) {
    for (const method of ["GET", "HEAD"]) {
      const result = await f.get(url, {
        method,
        headers: { ...minimumHeaders(seed), [header]: "foreign" },
      });
      expect(result.status).toBe(status);
      for (const [name, value] of Object.entries(expected))
        expect(result.headers.get(name)).toBe(value);
      if (method === "HEAD") expect(await result.text()).toBe("");
      else
        expect(checkedProblem(await body(result))).toMatchObject({
          code,
          type: `https://github.com/gastownhall/bdp/problems/${family}`,
          status,
        });
    }
  }
  const valid = await f.get(url, { headers: minimumHeaders(seed) });
  expect(valid.status).toBe(200);
  const manifest = await body(valid);
  const retained = await f.get(id(manifest), { headers: minimumHeaders(seed) });
  expect(retained.status).toBe(500);
  expect(retained.headers.get("x-bdp-development-limit")).toBe("minimum-position");
  expect(await body(await f.get(id(manifest)))).toEqual(manifest);
});

it("serves canonical current Type and incident minimums with truthful context and parser boundaries", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-type-incident-http-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const scope = "https://canonical.test/acme/";
  const descriptor = parseTypeDescriptor({
    id: `${scope}types/task`,
    name: "Task",
    describes: "bead",
    conformsTo: [],
  });
  let tick = 0;
  const runtime = await startTransactionRuntime(
    {
      directory,
      scope,
      port: 0,
      create: true,
      types: [...types, descriptor],
      credentials: [{ token, principal: "p", canMutate: true }],
    },
    { minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} } },
  );
  cleanup.push(() => runtime.close());
  const send = (suffix: string, headers: Record<string, string>, method = "GET") => {
    const canonical = new URL(suffix, scope);
    return fetch(new URL(canonical.pathname + canonical.search, runtime.listenUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, host: new URL(scope).host, ...headers },
    });
  };
  const seeded = await fetch(new URL(new URL(runtime.targets.batch).pathname, runtime.listenUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      host: new URL(scope).host,
      "content-type": "application/json",
      "idempotency-key": "type_incident_seed",
    },
    body: batch([
      create(),
      create("b"),
      {
        operation: "createLink",
        id: "links/l",
        type: link,
        source: "beads/a",
        target: "beads/b",
        properties: { n: 1 },
        metadata: { tag: "actual" },
      },
    ]),
  });
  expect(seeded.status).toBe(200);
  const seedReceipt = await body(seeded);
  expect(seedReceipt).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
  const headers = {
    "bdp-scope-epoch": seeded.headers.get("bdp-scope-epoch")!,
    "bdp-authorization-view": seeded.headers.get("bdp-authorization-view")!,
    "bdp-minimum-scope-position": "pos-1",
  };
  const assertContext = (response: Response) => {
    expect(response.headers.get("bdp-scope-epoch")).toBe(headers["bdp-scope-epoch"]);
    expect(response.headers.get("bdp-authorization-view")).toBe(headers["bdp-authorization-view"]);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-1");
    expect(response.headers.has("etag")).toBe(false);
  };
  for (const suffix of ["types/task", "types/?limit=3", "beads/a?view=links"]) {
    const response = await send(suffix, headers);
    expect(response.status).toBe(200);
    assertContext(response);
    const value = await body(response);
    if (suffix === "types/task") expect(value).toEqual(descriptor);
    else if (suffix.startsWith("types/"))
      expect(value).toEqual({
        items: [...types, descriptor]
          .map((t) => ({ id: t.id, name: t.name, describes: t.describes }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
        next: null,
      });
    else
      expect(value).toEqual({
        items: [
          {
            id: `${scope}links/l`,
            type: link,
            source: `${scope}beads/a`,
            target: `${scope}beads/b`,
            properties: { n: 1 },
            metadata: { tag: "actual" },
            revision: expect.any(String),
          },
        ],
        next: null,
      });
    for (const method of ["GET", "HEAD"]) {
      const head = await send(suffix, headers, method);
      expect(head.status).toBe(200);
      assertContext(head);
      if (method === "HEAD") expect(await head.text()).toBe("");
      for (const [conditional, status] of [
        [{ "if-none-match": "*" }, 304],
        [{ "if-match": '"mismatch"' }, 412],
      ] as const) {
        const response = await send(suffix, { ...headers, ...conditional }, method);
        expect(response.status).toBe(status);
        assertContext(response);
        if (method === "HEAD" || status === 304) expect(await response.text()).toBe("");
        const timeout = await send(
          suffix,
          { ...headers, ...conditional, "bdp-minimum-scope-position": "pos-2" },
          method,
        );
        expect(timeout.status).toBe(503);
        assertContext(timeout);
        expect(timeout.headers.get("retry-after")).toBe("1");
        if (method === "HEAD") expect(await timeout.text()).toBe("");
        else
          expect(checkedProblem(await body(timeout))).toMatchObject({
            code: "catch-up-timeout",
            retry: "after-delay",
          });
      }
      for (const [field, code, status] of [
        ["bdp-scope-epoch", "cursor-expired", 410],
        ["bdp-authorization-view", "foreign-view", 409],
      ] as const) {
        const refused = await send(suffix, { ...headers, [field]: "foreign" }, method);
        expect(refused.status).toBe(status);
        assertContext(refused);
        if (method === "HEAD") expect(await refused.text()).toBe("");
        else expect(checkedProblem(await body(refused))).toMatchObject({ code });
      }
    }
    expect((await send(suffix, { ...headers, accept: "image/png" })).status).toBe(406);
    const unauthorized = await send(suffix, { ...headers, authorization: "" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.has("bdp-scope-position")).toBe(false);
  }
  for (const suffix of ["types/?limit=33", "beads/a?view=links&limit=33"]) {
    const refused = await send(suffix, { ...headers, "bdp-minimum-scope-position": "pos-2" });
    expect(refused.status).toBe(413);
    expect(await body(refused)).toMatchObject({ code: "limit-exceeded" });
  }
  for (const suffix of [
    "types/task?view=properties",
    "types/?limit=nope",
    "beads/a?view=links&limit=nope",
    "types/?selector=x",
    "beads/a?view=links&selector=x",
    "types/?limit=1&limit=2",
  ]) {
    const refused = await send(suffix, headers);
    expect(refused.status).toBe(400);
    expect(await body(refused)).toMatchObject({ code: "invalid-parameter" });
  }
  for (const suffix of ["types/absent", "beads/missing?view=links"]) {
    const missing = await send(suffix, headers);
    expect(missing.status).toBe(404);
    assertContext(missing);
    expect(await body(missing)).toMatchObject({ code: "resource-not-found" });
    for (const patch of [
      { "bdp-minimum-scope-position": "pos-2" },
      { "bdp-scope-epoch": "foreign" },
      { "bdp-authorization-view": "foreign" },
    ]) {
      const refused = await send(suffix, { ...headers, ...patch });
      expect(refused.status).toBe(500);
      expect(refused.headers.get("x-bdp-development-limit")).toBe("minimum-position-visibility");
      expect(refused.headers.has("bdp-scope-position")).toBe(false);
    }
  }
});

it("serves conditioned live aliases and preserves bodyless redirects, refusal context and receiving boundaries", async () => {
  let tick = 0;
  const f = await fixture({
    minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
  });
  const created = await f.post(batch([create("a"), create("b")]), "alias-min-seed");
  expect(created.status).toBe(200);
  const headers = minimumHeaders(created, "pos-1"),
    target = `${f.runtime.scope}alias/work`;
  const put = await f.post(
    JSON.stringify({ alias: "alias/work", target: "beads/a" }),
    "alias-min-put",
    "putAlias",
  );
  expect(put.status).toBe(200);
  expect(await body(put)).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
  for (const method of ["GET", "HEAD"] as const) {
    for (const extra of [
      {},
      { "if-none-match": "*", "if-match": '"different"', accept: "text/plain" },
    ]) {
      const response = await f.get(target, {
        method,
        headers: { ...headers, ...extra, authorization: `Bearer ${readToken}` },
      });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${f.runtime.scope}beads/a`);
      expect(response.headers.get("content-length")).toBe("0");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("etag")).toBe(false);
      expect(await response.text()).toBe("");
      expect(context(response)).toEqual(context(created));
    }
  }
  for (const [patch, status, code] of [
    [{ "bdp-minimum-scope-position": "pos-2" }, 503, "catch-up-timeout"],
    [{ "bdp-authorization-view": "foreign" }, 409, "foreign-view"],
    [{ "bdp-scope-epoch": "foreign" }, 410, "cursor-expired"],
  ] as const) {
    let getLength: string | null = null;
    for (const method of ["GET", "HEAD"] as const) {
      const response = await f.get(target, {
        method,
        headers: { ...headers, ...patch, "if-none-match": "*" },
      });
      expect(response.status).toBe(status);
      expect(response.headers.has("location")).toBe(false);
      expect(context(response)).toEqual(context(created));
      if (status === 503) expect(response.headers.get("retry-after")).toBe("1");
      if (method === "GET") {
        expect(checkedProblem(await body(response))).toMatchObject({
          status,
          code,
          retry: status === 503 ? "after-delay" : "after-state-change",
        });
        getLength = response.headers.get("content-length");
      } else {
        expect(await response.text()).toBe("");
        expect(response.headers.get("content-length")).toBe(getLength);
      }
    }
  }
  const missing = await f.get(`${f.runtime.scope}alias/missing`, { headers });
  expect(missing.status).toBe(404);
  expect(context(missing)).toEqual(context(created));
  expect(checkedProblem(await body(missing))).toMatchObject({ code: "resource-not-found" });
  for (const [suffix, supplied, status, marker] of [
    [
      "alias/missing",
      { ...headers, "bdp-minimum-scope-position": "pos-2" },
      500,
      "minimum-position-visibility",
    ],
    ["alias/work?invalid=1", { ...headers, "bdp-minimum-scope-position": "pos-2" }, 404, null],
    ["alias/work", { "bdp-minimum-scope-position": "pos-1" }, 400, null],
    [
      "alias/work",
      { ...headers, "bdp-minimum-scope-position": "unknown" },
      500,
      "minimum-position",
    ],
  ] as const) {
    const response = await f.get(`${f.runtime.scope}${suffix}`, { headers: supplied });
    expect(response.status).toBe(status);
    expect(response.headers.get("x-bdp-development-limit")).toBe(marker);
    if (status === 400)
      expect(checkedProblem(await body(response))).toMatchObject({
        code: "malformed-request",
        status: 400,
        retry: "never",
      });
    expect(response.headers.has("location")).toBe(false);
    for (const name of Object.keys(context(created)))
      expect(response.headers.has(name)).toBe(false);
  }
  const anonymous = await fetch(target, { headers, redirect: "manual" });
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.has("location")).toBe(false);
  for (const name of Object.keys(context(created))) expect(anonymous.headers.has(name)).toBe(false);
  const method = await f.get(target, { method: "DELETE", headers });
  expect(method.status).toBe(405);
  expect(method.headers.get("allow")).toBe("GET, HEAD");
});

it("carries current owner context on direct conflict, operation-limit and both negotiation refusals", async () => {
  const f = await fixture();
  const singleton = JSON.stringify({ id: "beads/a", type: bead, properties: { title: "a" } });
  const seedResponse = await f.post(singleton, "retained", "createBead");
  expect(seedResponse.status).toBe(200);
  const seed = await body(seedResponse);
  expect(seed.effectPosition).toBe("pos-1");
  const advanced = await f.post(batch([create("b")]), "advance");
  expect(advanced.status).toBe(200);
  expect((await body(advanced)).effectPosition).toBe("pos-2");
  const expected = {
    "bdp-scope-epoch": seed.scopeEpoch,
    "bdp-authorization-view": seed.authorizationView,
    "bdp-scope-position": "pos-2",
  };
  function current(response: Response) {
    for (const [name, value] of Object.entries(expected)) {
      expect(response.headers.has(name), `direct refusal context presence: ${name}`).toBe(true);
      expect(response.headers.get(name), `direct refusal current context: ${name}`).toBe(value);
    }
    expect(response.headers.get("vary")).toBe("Accept");
  }
  for (const response of [
    await f.post(JSON.stringify({ id: "beads/x", type: bead }), "retained", "createBead"),
    await f.post(batch([create("x")]), "retained", "batch", { accept: "text/plain" }),
  ]) {
    expect(response.status).toBe(409);
    current(response);
    expect(checkedProblem(await body(response))).toMatchObject({
      code: "idempotency-conflict",
      status: 409,
      retry: "never",
    });
  }
  const fresh = JSON.stringify({ id: "beads/c", type: bead, properties: { title: "c" } });
  for (const response of [
    await f.post(singleton, "retained", "createBead", { accept: "text/plain" }),
    await f.post(fresh, "fresh-negotiation", "createBead", { accept: "text/plain" }),
  ]) {
    expect(response.status).toBe(406);
    current(response);
    expect(await response.text()).toBe("");
    expect(response.headers.has("content-type")).toBe(false);
  }
  const capacity = await f.post(
    batch(Array.from({ length: 33 }, (_, i) => create(`oversized-${i}`))),
    "fresh-capacity",
    "batch",
    { accept: "text/plain" },
  );
  expect(capacity.status).toBe(413);
  current(capacity);
  expect(checkedProblem(await body(capacity))).toMatchObject({
    code: "limit-exceeded",
    status: 413,
    limit: "transaction.operations",
  });
  const retained = await f.get(id(seed));
  expect(retained.status).toBe(200);
  expect(retained.headers.get("bdp-scope-position")).toBe("pos-2");
  expect(await body(retained)).toEqual(seed);
  const collection = await body(await f.get(`${f.runtime.scope}beads/?limit=32`));
  expect((collection.items as Record<string, unknown>[]).map((r) => [r.id, r.properties])).toEqual([
    [`${f.runtime.scope}beads/a`, { title: "a" }],
    [`${f.runtime.scope}beads/b`, { title: "b" }],
  ]);
  expect(collection.next).toBeNull();
  const events = await body(await f.get(`${f.runtime.scope}events/`));
  expect(events.events).toHaveLength(2);
  expect(events.next).toBeNull();
  expect((await body(await f.post(fresh, "fresh-negotiation", "createBead"))).effectPosition).toBe(
    "pos-3",
  );
  expect((await body(await f.post(batch([create("d")]), "fresh-capacity"))).effectPosition).toBe(
    "pos-4",
  );
});

// These are exclusions from this bounded context repair, not a general error-family law.
it("preserves absent context on excluded direct receiving and authorization refusals", async () => {
  const f = await fixture();
  for (const [text, headers, status, code] of [
    [batch(), { authorization: "" }, 401, "unauthenticated"],
    [batch(), { authorization: `Bearer ${readToken}` }, 403, "forbidden"],
    ["{", {}, 400, "malformed-request"],
    ["x".repeat(65537), {}, 413, "request-too-large"],
    [batch(), { "content-type": "text/plain" }, 415, "unsupported-media-type"],
  ] as const) {
    const response = await f.post(text, "excluded", "batch", headers);
    expect(response.status).toBe(status);
    expect(checkedProblem(await body(response))).toMatchObject({ status, code });
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(response.headers.has(name), `excluded direct refusal ${code} context: ${name}`).toBe(
        false,
      );
  }
  expect((await f.get(`${f.runtime.scope}beads/a`)).status).toBe(404);
  expect((await f.post(batch(), "excluded")).status).toBe(200);
});

it("serves current comparison deadline context without timeout effects or receipt disclosure", async () => {
  const callbacks: (() => void)[] = [];
  let now = 0,
    waits = 0,
    deliveries = 0,
    release = false;
  let dispatched = 0,
    completed = 0;
  let independent: Record<string, unknown> | undefined;
  const f = await fixture({
    scheduler: {
      turn(callback) {
        const deliver = () => {
          deliveries++;
          callback();
        };
        if (release) queueMicrotask(deliver);
        else callbacks.push(deliver);
        return () => {};
      },
    },
    comparison: {
      budgetMs: 2,
      now: () => now,
      wait: async () => {
        waits++;
        expect(waits, "one comparison wait").toBe(1);
        // This independent real commit must run while comparison holds no DB entry.
        const response = await send(() => f.post(batch([create("b")]), "independent"));
        expect(response.status).toBe(200);
        independent = await body(response);
        expect(independent).toMatchObject({ status: "completed", effectPosition: "pos-1" });
        now = 2;
      },
    },
  });
  async function send(start: () => Promise<Response>) {
    dispatched++;
    const response = await start();
    completed++;
    return response;
  }
  const eventUrl = `${f.runtime.scope}events/`;
  const before = await send(() => f.get(eventUrl));
  expect(before.status).toBe(200);
  expect(await body(before)).toEqual({ source: eventUrl, events: [], next: null });
  expect(before.headers.get("bdp-scope-position")).toBe("pos-0");
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view"])
    expect(before.headers.get(name)).toEqual(expect.any(String));
  const sequence = send(() =>
    f.post(
      batch([
        { ...create(), name: "a", idempotencyKey: "creator" },
        {
          operation: "createLink",
          type: link,
          source: "@a",
          target: "@a",
          idempotencyKey: "dependent",
        },
      ]),
      null,
      "sequence",
    ),
  );
  void sequence.catch(() => {});
  const candidate = batch([
    { operation: "createLink", type: link, source: "beads/a", target: "beads/a" },
  ]);
  const failures: unknown[] = [];
  let original: Record<string, unknown> | undefined;
  function resource(receipt: Record<string, unknown>, index = 0) {
    return record(record((receipt.results as unknown[])[index]).resource);
  }
  function beadContent(value: Record<string, unknown>, name: string) {
    expect(value).toMatchObject({
      id: `${f.runtime.scope}beads/${name}`,
      type: bead,
      properties: { title: name },
      metadata: {},
    });
    expect(value.properties).toEqual({ title: name });
    expect(value.metadata).toEqual({});
    expect(value.revision).toEqual(expect.any(String));
    expect(value).not.toHaveProperty("source");
    expect(value).not.toHaveProperty("target");
    expect(value).not.toHaveProperty("ownedLinks");
  }
  async function collection(kind: "beads" | "links", expected: unknown[]) {
    const response = await send(() => f.get(`${f.runtime.scope}${kind}/?limit=32`));
    expect(response.status).toBe(200);
    const page = await body(response);
    expect(page.items, `complete ${kind} afterstate`).toEqual(expected);
    expect(page.next).toBeNull();
  }
  function createdData(value: Record<string, unknown>) {
    return {
      revision: value.revision,
      properties: value.properties,
      metadata: value.metadata,
      ...(value.revisionProvenance === undefined
        ? {}
        : { revisionProvenance: value.revisionProvenance }),
      ...(value.source === undefined ? {} : { source: value.source, target: value.target }),
    };
  }
  async function events(expected: unknown[]) {
    const response = await send(() => f.get(eventUrl));
    expect(response.status).toBe(200);
    const page = await body(response);
    expect(page.source).toBe(eventUrl);
    expect(page.next, "complete bounded Event page").toBeNull();
    const values = (page.events as unknown[]).map(record);
    expect(
      values.map((event) => [event.type, event.subject, event.subjectType, event.data]),
      "exact Event facts",
    ).toEqual(expected);
    expect(new Set(values.map((event) => event.id)).size).toBe(values.length);
    for (const event of values) expect(event.source).toBe(eventUrl);
  }
  try {
    for (let attempt = 0; callbacks.length === 0 && attempt < 100; attempt++) await setImmediate();
    expect(callbacks).toHaveLength(1);
    const response = await send(() => f.post(candidate, "dependent"));
    expect(response.status, "healthy deadline response").toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(checkedProblem(await body(response))).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/unavailable",
      code: "temporarily-unavailable",
      status: 503,
      retry: "after-delay",
    });
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(response.headers.has(name), `deadline context presence ${name}`).toBe(true);
    expect(response.headers.get("bdp-scope-epoch")).toBe(before.headers.get("bdp-scope-epoch"));
    expect(response.headers.get("bdp-authorization-view")).toBe(
      before.headers.get("bdp-authorization-view"),
    );
    expect(response.headers.get("bdp-scope-position"), "deadline current position").toBe("pos-1");
    expect(response.headers.get("bdp-scope-position")).not.toBe(
      before.headers.get("bdp-scope-position"),
    );
    expect(waits).toBe(1);
    expect(deliveries, "original owner remains held").toBe(0);
    if (!independent) throw new Error("independent receipt missing");
    const b = resource(independent);
    beadContent(b, "b");
    await collection("beads", [b]);
    await collection("links", []);
    await events([["created", b.id, bead, createdData(b)]]);
    expect((await send(() => f.get(`${f.runtime.scope}beads/a`))).status).toBe(404);
  } catch (error) {
    failures.push(error);
  } finally {
    release = true;
    for (const callback of callbacks.splice(0)) callback();
    try {
      const response = await sequence;
      expect(response.status).toBe(200);
      original = await body(response);
      expect(validateSequence(original), JSON.stringify(validateSequence.errors)).toBe(true);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "comparison proof and owner drain");
  if (!original || !independent) throw new Error("missing original observations");
  expect(deliveries).toBe(2);
  const replayResponse = await send(() => f.post(candidate, "dependent"));
  expect(replayResponse.status).toBe(200);
  expect(replayResponse.headers.get("bdp-scope-position")).toBe("pos-3");
  const replay = await body(replayResponse);
  const validateReceipt = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
  expect(validateReceipt(replay), JSON.stringify(validateReceipt.errors)).toBe(true);
  expect(replay).toMatchObject({ status: "completed", effectPosition: "pos-3", next: null });
  const entries = (original.results as unknown[]).map(record);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ operationIndex: 0, operationName: "a", outcome: "created" });
  expect(entries[1]).toMatchObject({ operationIndex: 1, outcome: "created" });
  const a = record(entries[0]!.resource),
    edge = record(entries[1]!.resource),
    b = resource(independent);
  beadContent(a, "a");
  expect(edge).toMatchObject({
    type: link,
    source: a.id,
    target: a.id,
    properties: {},
    metadata: {},
  });
  expect(edge.properties).toEqual({});
  expect(edge.metadata).toEqual({});
  expect(typeof edge.id).toBe("string");
  expect(String(edge.id).startsWith(`${f.runtime.scope}links/`)).toBe(true);
  expect(resource(replay), "retained original dependent result").toEqual(edge);
  await collection("beads", [a, b]);
  await collection("links", [edge]);
  await events([
    ["created", b.id, bead, createdData(b)],
    ["created", a.id, bead, createdData(a)],
    ["created", edge.id, link, createdData(edge)],
    [
      "linked",
      edge.id,
      link,
      { endpoint: "source", link: { id: edge.id, type: link }, source: a.id, target: a.id },
    ],
    [
      "linked",
      edge.id,
      link,
      { endpoint: "target", link: { id: edge.id, type: link }, source: a.id, target: a.id },
    ],
  ]);
  const inventory = await f.retainedReceiptInventory();
  expect(
    inventory.map((row) => [row.principal, row.key]),
    "no timeout receipt or key",
  ).toEqual([
    ["p", "creator"],
    ["p", "dependent"],
    ["p", "independent"],
  ]);
  expect(inventory[1]!.receipt, "full retained receipt replay").toEqual(replay);
  expect(dispatched, "bounded comparison HTTP dispatches").toBe(12);
  expect(completed, "bounded comparison HTTP completions").toBe(12);
});

it.each([413, 406])(
  "observes sequence refusal context with %s first and retains only genuine seed receipts",
  async (first) => {
    const f = await fixture();
    const seeds: Record<string, unknown>[] = [];
    for (const name of ["a", "b"])
      seeds.push(await body(await f.post(batch([create(name)]), `seed-${name}`)));
    const rejectedKeys: string[] = [];
    async function refusal(status: number, phase: string, position: string) {
      const count = status === 413 ? 33 : 1;
      const operations = Array.from({ length: count }, (_, i) => ({
        ...create(`rejected-${phase}-${status}-${i}`),
        idempotencyKey: `reject-${phase}-${status}-${i}`,
      }));
      rejectedKeys.push(...operations.map((op) => op.idempotencyKey));
      const text = JSON.stringify({ operations });
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
      const response = await f.post(text, null, "sequence", { accept: "text/plain" });
      expect(response.status).toBe(status);
      if (status === 413)
        expect(checkedProblem(await body(response))).toMatchObject({
          code: "limit-exceeded",
          status: 413,
          limit: "sequence.operations",
        });
      else {
        expect(await response.text()).toBe("");
        expect(response.headers.has("content-type")).toBe(false);
      }
      for (const [name, value] of Object.entries({
        "bdp-scope-epoch": seeds[0]!.scopeEpoch,
        "bdp-authorization-view": seeds[0]!.authorizationView,
        "bdp-scope-position": position,
      })) {
        expect(
          response.headers.has(name),
          `sequence refusal context presence: ${status} ${name}`,
        ).toBe(true);
        expect(
          response.headers.get(name),
          `sequence refusal current context: ${status} ${name}`,
        ).toBe(value);
      }
      expect(response.headers.get("vary")).toBe("Accept");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    async function state(names: string[], position: string) {
      const response = await f.get(`${f.runtime.scope}beads/?limit=32`);
      expect(response.status).toBe(200);
      expect(response.headers.get("bdp-scope-position")).toBe(position);
      const collection = await body(response);
      expect(collection.next).toBeNull();
      expect(collection.items).toEqual(
        seeds.map((receipt) => (receipt.results as { resource: unknown }[])[0]!.resource),
      );
      expect(
        (collection.items as Record<string, unknown>[]).map((item) => [
          item.id,
          item.properties,
          item.metadata,
        ]),
      ).toEqual(names.map((name) => [`${f.runtime.scope}beads/${name}`, { title: name }, {}]));
      const events = await body(await f.get(`${f.runtime.scope}events/`));
      expect(events.next).toBeNull();
      expect((events.events as Record<string, unknown>[]).map((event) => event.subject)).toEqual(
        names.map((name) => `${f.runtime.scope}beads/${name}`),
      );
    }
    for (const status of [first, first === 413 ? 406 : 413])
      await refusal(status, "initial", "pos-2");
    await state(["a", "b"], "pos-2");
    const root = await f.get(id(seeds[0]));
    expect(root.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(await body(root)).toEqual(seeds[0]);
    seeds.push(await body(await f.post(batch([create("c")]), "seed-c")));
    for (const status of [first, first === 413 ? 406 : 413])
      await refusal(status, "later", "pos-3");
    await state(["a", "b", "c"], "pos-3");
    // This closes the runtime; all live observations precede the final storage oracle.
    const inventory = await f.retainedReceiptInventory();
    expect(inventory).toEqual(
      seeds.map((receipt, i) => ({ principal: "p", key: `seed-${["a", "b", "c"][i]}`, receipt })),
    );
    expect(inventory.filter((row) => rejectedKeys.includes(String(row.key)))).toEqual([]);
  },
);

it("reuses refused sequence member keys for different identities without extra receipt rows", async () => {
  const f = await fixture();
  const many = Array.from({ length: 33 }, (_, i) => ({
    ...create(`old-${i}`),
    idempotencyKey: `over-${i}`,
  }));
  const capacity = await f.post(JSON.stringify({ operations: many }), null, "sequence", {
    accept: "text/plain",
  });
  expect(checkedProblem(await body(capacity))).toMatchObject({
    code: "limit-exceeded",
    limit: "sequence.operations",
    status: 413,
  });
  expect(
    (
      await f.post(
        JSON.stringify({
          operations: [{ ...create("old-negotiation"), idempotencyKey: "negotiation" }],
        }),
        null,
        "sequence",
        { accept: "text/plain" },
      )
    ).status,
  ).toBe(406);
  const c = await body(await f.post(batch([create("new-c")]), "negotiation"));
  const d = await body(await f.post(batch([create("new-d")]), "over-0"));
  expect(c).toMatchObject({ status: "completed", effectPosition: "pos-1" });
  expect(d).toMatchObject({ status: "completed", effectPosition: "pos-2" });
  const collection = await body(await f.get(`${f.runtime.scope}beads/?limit=32`));
  expect(collection.next).toBeNull();
  expect(
    (collection.items as Record<string, unknown>[]).map((item) => [item.id, item.properties]),
  ).toEqual([
    [`${f.runtime.scope}beads/new-c`, { title: "new-c" }],
    [`${f.runtime.scope}beads/new-d`, { title: "new-d" }],
  ]);
  const events = await body(await f.get(`${f.runtime.scope}events/`));
  expect(events.events).toHaveLength(2);
  expect(events.next).toBeNull();
  expect(await f.retainedReceiptInventory()).toEqual([
    { principal: "p", key: "negotiation", receipt: c },
    { principal: "p", key: "over-0", receipt: d },
  ]);
});

function selectorHttpBytes(n: number) {
  return `$[?@.missing${" ".repeat(n - 13)}]`;
}
function selectorHttpDepth(groups: number) {
  return `$[?${"(".repeat(groups)}@.missing${")".repeat(groups)}]`;
}
function selectorHttpNodes(groups: number) {
  let expression = "@.missing";
  for (let level = 0; level < 6; level++) expression = `(${expression}||${expression})`;
  return `$[?${"(".repeat(groups)}${expression}${")".repeat(groups)}]`;
}
const selectorHttpInput = (operation: "updateWhere" | "deleteWhere", selector: string) => ({
  collection: "beads",
  selector,
  ...(operation === "updateWhere" ? { change: [{ op: "add", path: "/x", value: 1 }] } : {}),
});
async function selectorHttpProblem(
  response: Response,
  status: 400 | 413,
  pointer: string,
  limit?: string,
) {
  expect(
    response.status,
    JSON.stringify({
      oracle: "Selector receiving status",
      status: response.status,
      developmentLimit: response.headers.get("x-bdp-development-limit"),
      contentLength: response.headers.get("content-length"),
    }),
  ).toBe(status);
  expect(response.headers.has("x-bdp-development-limit")).toBe(false);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("location")).toBe(false);
  expect(response.headers.has("retry-after")).toBe(false);
  expect(checkedProblem(await body(response))).toEqual({
    type: `https://github.com/gastownhall/bdp/problems/${status === 400 ? "request" : "size"}`,
    status,
    code: status === 400 ? "malformed-request" : "limit-exceeded",
    retry: "never",
    pointer,
    ...(limit ? { limit } : {}),
  });
  if (status === 400) expect(Object.values(context(response))).toEqual([null, null, null]);
  else
    for (const value of Object.values(context(response))) expect(value).toEqual(expect.any(String));
}
it("serves exact fixed Selector boundaries and leaves refused keys unused", async () => {
  const f = await fixture();
  const keys: string[] = [];
  let observation: ReturnType<typeof context> | undefined;
  for (const operation of ["deleteWhere", "updateWhere"] as const)
    for (const carrier of [operation, "batch"] as const)
      for (const [field, over, exact] of [
        ["bytes", selectorHttpBytes(4097), selectorHttpBytes(4096)],
        ["depth", selectorHttpDepth(31), selectorHttpDepth(30)],
        ["nodes", selectorHttpNodes(3), selectorHttpNodes(2)],
      ] as const) {
        const key = `${operation}_${carrier}_${field}`;
        const text = (selector: string) =>
          JSON.stringify(
            carrier === "batch"
              ? { operations: [{ operation, ...selectorHttpInput(operation, selector) }] }
              : selectorHttpInput(operation, selector),
          );
        const refusal = await f.post(text(over), key, carrier);
        await selectorHttpProblem(
          refusal,
          413,
          carrier === "batch" ? "/operations/0/selector" : "/selector",
          `selector.${field}`,
        );
        observation ??= context(refusal);
        expect(context(refusal)).toEqual(observation);
        expect(observation["bdp-scope-position"]).toBe("pos-0");
        for (const [selector, admittedKey] of [
          ["$[?@.missing]", key],
          [exact, `${key}_exact`],
        ]) {
          const response = await f.post(text(selector!), admittedKey!, carrier);
          expect(response.status).toBe(200);
          expect(context(response)).toEqual(observation);
          const receipt = await body(response);
          expect(
            validateSelectorReceipt(receipt),
            JSON.stringify(validateSelectorReceipt.errors),
          ).toBe(true);
          expect(receipt).toMatchObject({
            idempotencyKey: admittedKey,
            status: "completed",
            detail: "available",
            requiredPosition: "pos-0",
            results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
            next: null,
          });
          expect(receipt).not.toHaveProperty("effectPosition");
          expect(receipt.results).toEqual([{ operationIndex: 0, outcome: "matched", count: 0 }]);
          keys.push(admittedKey!);
        }
      }
  const retained = await f.retainedReceiptInventory();
  expect(retained.map((row) => row.key)).toEqual(keys.sort());
  expect(retained).toHaveLength(24);
  for (const row of retained)
    expect(row.receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-0",
      results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
    });
});
it("serves Selector syntax and prior-key precedence over capacity", async () => {
  const f = await fixture();
  const singleton = (selector: string) =>
    JSON.stringify(selectorHttpInput("deleteWhere", selector));
  const set = (selector: string) => ({
    operation: "deleteWhere",
    ...selectorHttpInput("deleteWhere", selector),
  });
  await selectorHttpProblem(
    await f.post(singleton("$..*"), "syntax", "deleteWhere"),
    400,
    "/selector",
  );
  const seedResponse = await f.post(batch([create()]), "seed");
  expect(seedResponse.status).toBe(200);
  const seed = await body(seedResponse),
    expectedContext = context(seedResponse);
  expect(validateSelectorReceipt(seed), JSON.stringify(validateSelectorReceipt.errors)).toBe(true);
  expect(seed).toMatchObject({
    status: "completed",
    requiredPosition: "pos-1",
    effectPosition: "pos-1",
  });
  await selectorHttpProblem(
    await f.post(singleton("$..*"), "seed", "deleteWhere"),
    400,
    "/selector",
  );
  const conflict = await f.post(singleton(selectorHttpBytes(4097)), "seed", "deleteWhere");
  expect(conflict.status).toBe(409);
  expect(checkedProblem(await body(conflict))).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code: "idempotency-conflict",
    status: 409,
    retry: "never",
  });
  expect(context(conflict)).toEqual(expectedContext);
  const replay = await f.post(batch([create()]), "seed");
  expect(replay.status).toBe(200);
  expect(await body(replay)).toEqual(seed);
  expect(context(replay)).toEqual(expectedContext);
  const unacceptableReplay = await f.post(batch([create()]), "seed", "batch", {
    accept: "text/plain",
  });
  expect(unacceptableReplay.status).toBe(406);
  expect(await unacceptableReplay.text()).toBe("");
  expect(context(unacceptableReplay)).toEqual(expectedContext);
  await selectorHttpProblem(
    await f.post(singleton(`${selectorHttpDepth(31)} true`), "syntax_depth", "deleteWhere"),
    400,
    "/selector",
  );
  await selectorHttpProblem(
    await f.post(batch([set(`${selectorHttpNodes(3)} true`)]), "syntax_nodes"),
    400,
    "/operations/0/selector",
  );
  await selectorHttpProblem(
    await f.post(batch([set(`${selectorHttpBytes(4097)} true`)]), "syntax_bytes"),
    400,
    "/operations/0/selector",
  );
  const anonymous = await f.post(singleton(selectorHttpBytes(4097)), "anonymous", "deleteWhere", {
    authorization: "",
  });
  expect(anonymous.status).toBe(401);
  expect(checkedProblem(await body(anonymous)).code).toBe("unauthenticated");
  const forbidden = await f.post(singleton(selectorHttpBytes(4097)), "forbidden", "deleteWhere", {
    authorization: `Bearer ${readToken}`,
  });
  expect(forbidden.status).toBe(403);
  expect(checkedProblem(await body(forbidden)).code).toBe("forbidden");
  const over = await f.post(singleton(selectorHttpBytes(4097)), "accept", "deleteWhere", {
    accept: "text/plain",
  });
  await selectorHttpProblem(over, 413, "/selector", "selector.bytes");
  expect(context(over)).toEqual(expectedContext);
  const noMedia = await f.post(singleton("$[?@.missing]"), "accept", "deleteWhere", {
    accept: "text/plain",
  });
  expect(noMedia.status).toBe(406);
  expect(await noMedia.text()).toBe("");
  expect(context(noMedia)).toEqual(expectedContext);
  const reuse = await f.post(singleton("$[?@.missing]"), "accept", "deleteWhere");
  expect(reuse.status).toBe(200);
  expect(await body(reuse)).toMatchObject({
    status: "completed",
    requiredPosition: "pos-1",
    results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
  });
  expect(context(reuse)).toEqual(expectedContext);
  const later = await f.post(
    batch([{ operation: "deleteBead", bead: "beads/missing" }, set(selectorHttpNodes(3))]),
    "later",
  );
  await selectorHttpProblem(later, 413, "/operations/1/selector", "selector.nodes");
  expect(context(later)).toEqual(expectedContext);
  const laterReuse = await f.post(singleton("$[?@.missing]"), "later", "deleteWhere");
  expect(laterReuse.status).toBe(200);
  expect(await body(laterReuse)).toMatchObject({
    status: "completed",
    requiredPosition: "pos-1",
    results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
  });
  expect(context(laterReuse)).toEqual(expectedContext);
  const inventory = await f.retainedReceiptInventory();
  expect(inventory.map((row) => row.key)).toEqual(["accept", "later", "seed"]);
  expect(inventory.find((row) => row.key === "seed")?.receipt).toEqual(seed);
});

it("serves current missing receipt root and page context without changing nondisclosure or HEAD", async () => {
  const cleanupBoundary = cleanup.length;
  const failures: unknown[] = [];
  const controller = new AbortController();
  const deadlineReason = new Error("receipt context cohort deadline");
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  let attempted = 0,
    tupleChecks = 0;
  const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
  const retainedNames = [
    ...names,
    "content-type",
    "content-length",
    "cache-control",
    "x-bdp-development",
    "x-bdp-development-limit",
    "www-authenticate",
    "retry-after",
    "etag",
    "last-modified",
  ];
  const observations: {
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    headers: Record<string, string | null>;
  }[] = [];
  let registeredCleanup = 0,
    completedCleanup = 0;
  try {
    const f = await fixture({ receiptMaximumItems: 2 });
    const exchange = async (
      url: string,
      method: "GET" | "HEAD" | "POST",
      credential: string | undefined,
      requestBody?: string,
      key?: string,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempted, "receipt context dispatch bound").toBeLessThanOrEqual(13);
      const requestAbort = new AbortController();
      const timer = setTimeout(
        () => requestAbort.abort(new Error("receipt exchange deadline")),
        5000,
      );
      try {
        const response = await fetch(url, {
          method,
          redirect: "error",
          signal: AbortSignal.any([controller.signal, requestAbort.signal]),
          headers: {
            accept: "application/json",
            ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
            ...(requestBody === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "idempotency-key": key ?? "receipt-context-seed",
                }),
          },
          ...(requestBody === undefined ? {} : { body: requestBody }),
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          if (reader)
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              if (bytes + chunk.value.byteLength > 32768) {
                requestAbort.abort(new Error("receipt response body limit"));
                throw new Error("receipt response exceeds32768bytes");
              }
              bytes += chunk.value.byteLength;
              chunks.push(chunk.value);
            }
        } catch (error) {
          try {
            await reader?.cancel();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "receipt body read and cleanup failed");
          }
          throw error;
        } finally {
          reader?.releaseLock();
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
        const headers = Object.fromEntries(
          retainedNames.map((name) => [name, response.headers.get(name)]),
        );
        observations.push({ method, url, status: response.status, bodyOctets: bytes, headers });
        expect(headers["x-bdp-development"]).toBe("non-attesting");
        return { status: response.status, headers, text, bytes };
      } finally {
        clearTimeout(timer);
      }
    };
    const seed = await exchange(
      f.runtime.targets.batch,
      "POST",
      token,
      batch([create("a"), create("b"), create("c")]),
    );
    expect(seed.status).toBe(200);
    const receipt = record(JSON.parse(seed.text));
    expect(validateSelectorReceipt(receipt), JSON.stringify(validateSelectorReceipt.errors)).toBe(
      true,
    );
    expect(receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    expect(receipt.results).toHaveLength(2);
    if (typeof receipt.next !== "string") throw new Error("expected issued next page");
    const root = id(receipt),
      pageUrl = receipt.next;
    const page = await exchange(pageUrl, "GET", token);
    expect(page.status).toBe(200);
    const pageValue = JSON.parse(page.text);
    const validPage = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceiptPage` });
    expect(validPage(pageValue), JSON.stringify(validPage.errors)).toBe(true);
    expect(pageValue).toMatchObject({ receipt: root, next: null });
    expect(pageValue.results).toHaveLength(1);
    const firstContext = names.map((name) => seed.headers[name]);
    expect(firstContext[0]).toBeTruthy();
    expect(firstContext[1]).toBeTruthy();
    expect(firstContext[2]).toBe("pos-1");
    expect(names.map((name) => page.headers[name])).toStrictEqual(firstContext);
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    const missing = async (
      url: string,
      method: "GET" | "HEAD",
      credential: string,
      expected: (string | null | undefined)[],
      label: string,
      getLength?: string | null,
    ) => {
      const response = await exchange(url, method, credential);
      expect(response.status, label).toBe(404);
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      for (const name of [
        "etag",
        "last-modified",
        "retry-after",
        "www-authenticate",
        "x-bdp-development-limit",
      ])
        expect(response.headers[name]).toBeNull();
      if (method === "GET") {
        const value = record(JSON.parse(response.text));
        expect(checkedProblem(value)).toStrictEqual(problem);
        expect(Number(response.headers["content-length"])).toBe(response.bytes);
      } else {
        expect(response.text).toBe("");
        expect(response.bytes).toBe(0);
        expect(response.headers["content-length"]).toBe(getLength);
      }
      tupleChecks++;
      expect
        .soft(
          names.map((name) => response.headers[name]),
          label,
        )
        .toStrictEqual(expected);
      return response.headers["content-length"];
    };
    const unknownRoot = `${root.slice(0, root.lastIndexOf("/") + 1)}unknown`;
    for (const [url, credential, label] of [
      [unknownRoot, token, "unknown-root"],
      [root, otherToken, "foreign-root"],
      [pageUrl, otherToken, "foreign-page"],
    ] as const) {
      const length = await missing(
        url,
        "GET",
        credential,
        firstContext,
        `${label} GET at first head`,
      );
      await missing(url, "HEAD", credential, firstContext, `${label} HEAD at first head`, length);
    }
    const later = await exchange(
      f.runtime.targets.createBead,
      "POST",
      token,
      JSON.stringify({ id: "beads/later", type: bead, properties: { title: "later" } }),
      "receipt-context-advance",
    );
    expect(later.status).toBe(200);
    const laterReceipt = JSON.parse(later.text);
    expect(
      validateSelectorReceipt(laterReceipt),
      JSON.stringify(validateSelectorReceipt.errors),
    ).toBe(true);
    expect(laterReceipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-2",
      effectPosition: "pos-2",
    });
    const laterContext = names.map((name) => later.headers[name]);
    expect(laterContext).toStrictEqual([firstContext[0], firstContext[1], "pos-2"]);
    await missing(root, "GET", otherToken, laterContext, "foreign-root GET at later head");
    await missing(pageUrl, "GET", otherToken, laterContext, "foreign-page GET at later head");
    for (const [url, method] of [
      [root, "GET"],
      [pageUrl, "HEAD"],
    ] as const) {
      const response = await exchange(url, method, undefined);
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe(
        'Bearer realm="bdp-transaction-development"',
      );
      for (const name of names) expect(response.headers[name]).toBeNull();
      if (method === "GET")
        expect(checkedProblem(record(JSON.parse(response.text)))).toMatchObject({
          code: "unauthenticated",
          status: 401,
        });
      else {
        expect(response.text).toBe("");
        expect(response.bytes).toBe(0);
      }
    }
    expect(attempted).toBe(13);
    expect(observations).toHaveLength(13);
    expect(tupleChecks).toBe(8);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    const callbacks = cleanup.splice(cleanupBoundary).reverse();
    registeredCleanup = callbacks.length;
    for (const close of callbacks) {
      try {
        await close();
        completedCleanup++;
      } catch (error) {
        failures.push(error);
      }
    }
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    console.log(
      JSON.stringify({
        observation: "source-receipt-missing-context",
        attempted,
        responses: observations,
        tupleChecks,
        registeredCleanup,
        completedCleanup,
        deadlineExceeded,
        primaryOrCleanupFailureCount: failures.length,
        retention:
          "status, selected safe headers and body lengths; full Problem/receipt/page values asserted in memory",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "receipt context observation and cleanup failed");
}, 60000);

it("serves retained direct key conflicts before private depth and preserves fresh refusal", async () => {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("depth-key work deadline")), 25000);
  const cleanupStart = cleanup.length;
  const failures: unknown[] = [];
  const observations: Record<string, unknown>[] = [];
  const receipts: Record<string, unknown>[] = [];
  const resources: Record<string, unknown>[] = [];
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  let attempts = 0;
  let cleanupCompleted = false;
  let expectedContext: Record<string, string> | undefined;
  const validCollection = ajv.compile({ $ref: `${schema.$id}#/$defs/currentBeadCollection` });
  const validBead = ajv.compile({ $ref: `${schema.$id}#/$defs/currentBeadRecord` });
  type Observed = { status: number; headers: Headers; text: string };
  const checkedContext = (response: Observed, position: string) => {
    if (!expectedContext) throw new Error("depth-key seed context missing");
    expect(
      Object.fromEntries([
        ...Object.entries(expectedContext).map(([name]) => [name, response.headers.get(name)]),
        ["bdp-scope-position", response.headers.get("bdp-scope-position")],
      ]),
    ).toEqual({ ...expectedContext, "bdp-scope-position": position });
  };
  async function exchange(
    label: string,
    url: string,
    text?: string,
    key?: string,
    accept = "application/json",
  ): Promise<Observed> {
    if (!f) throw new Error("depth-key listener missing");
    controller.signal.throwIfAborted();
    expect(++attempts, "depth-key source request bound").toBeLessThanOrEqual(13);
    const method = text === undefined ? "GET" : "POST";
    const routes = [
      ["POST", f.runtime.targets.batch],
      ["POST", f.runtime.targets.createBead],
      ["GET", `${f.runtime.scope}beads/depth-b-a`],
      ["GET", `${f.runtime.scope}beads/depth-s-a`],
      ["GET", `${f.runtime.scope}beads/?limit=32`],
    ];
    expect(
      routes.some(([m, target]) => m === method && target === url),
      "depth-key route binding",
    ).toBe(true);
    const headers = {
      authorization: `Bearer ${token}`,
      accept,
      ...(text === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": key ?? "" }),
    };
    expect(Buffer.byteLength(text ?? "")).toBeLessThanOrEqual(65536);
    expect(
      Object.entries(headers).reduce(
        (sum, [name, value]) => sum + Buffer.byteLength(name + value) + 4,
        0,
      ),
    ).toBeLessThanOrEqual(16384);
    const request = new AbortController();
    const timer = setTimeout(() => request.abort(new Error("depth-key request deadline")), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyComplete = false;
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(text === undefined ? {} : { body: text }),
        redirect: "error",
        signal: AbortSignal.any([controller.signal, request.signal]),
      });
      expect(
        [...response.headers].reduce(
          (sum, [name, value]) => sum + Buffer.byteLength(name + value) + 4,
          0,
        ),
      ).toBeLessThanOrEqual(65536);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 131072) throw new Error("depth-key response body ceiling");
          chunks.push(chunk.value);
        }
      }
      bodyComplete = true;
      const result = {
        status: response.status,
        headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8"),
      };
      observations.push({
        label,
        method,
        url,
        accept,
        status: result.status,
        requestBodyBytes: Buffer.byteLength(text ?? ""),
        requestBodySha256: createHash("sha256")
          .update(text ?? "")
          .digest("hex"),
        responseBodyBytes: bytes,
        responseBodySha256: createHash("sha256").update(result.text).digest("hex"),
        headers: Object.fromEntries(
          [
            "bdp-scope-epoch",
            "bdp-authorization-view",
            "bdp-scope-position",
            "x-bdp-development",
            "x-bdp-development-limit",
            "content-type",
            "content-length",
          ].map((name) => [name, result.headers.get(name)]),
        ),
      });
      expect(result.headers.get("x-bdp-development")).toBe("non-attesting");
      return result;
    } finally {
      clearTimeout(timer);
      request.abort();
      if (reader) {
        try {
          if (!bodyComplete) await reader.cancel();
        } catch (error) {
          failures.push(error);
        } finally {
          try {
            reader.releaseLock();
          } catch (error) {
            failures.push(error);
          }
        }
      }
    }
  }
  function completed(response: Observed, name: string, key: string, position: string) {
    expect(response.status).toBe(200);
    const value = record(JSON.parse(response.text));
    expect(validateSelectorReceipt(value), JSON.stringify(validateSelectorReceipt.errors)).toBe(
      true,
    );
    expect(value).toMatchObject({
      idempotencyKey: key,
      status: "completed",
      detail: "available",
      requiredPosition: position,
      effectPosition: position,
      next: null,
    });
    const results = value.results;
    expect(Array.isArray(results)).toBe(true);
    if (!Array.isArray(results)) throw new Error("depth-key results missing");
    expect(results).toHaveLength(1);
    const result = record(results[0]);
    const resource = record(result.resource);
    expect(result).toEqual({ operationIndex: 0, outcome: "created", resource });
    expect(typeof resource.revision).toBe("string");
    expect(resource.revision).not.toBe("");
    expect(resource).toEqual({
      id: `${f?.runtime.scope}beads/${name}`,
      type: bead,
      properties: { title: name },
      metadata: {},
      revision: resource.revision,
    });
    if (!expectedContext) {
      expect(typeof value.scopeEpoch).toBe("string");
      expect(typeof value.authorizationView).toBe("string");
      expectedContext = {
        "bdp-scope-epoch": String(value.scopeEpoch),
        "bdp-authorization-view": String(value.authorizationView),
      };
    }
    checkedContext(response, position);
    receipts.push(value);
    resources.push(resource);
    return value;
  }
  try {
    f = await fixture();
    controller.signal.throwIfAborted();
    let nested: unknown = "leaf";
    for (let i = 0; i < 40; i++) nested = { nested };
    for (const [kind, stem, position] of [
      ["batch", "depth-b", 1],
      ["singleton", "depth-s", 3],
    ] as const) {
      const target = kind === "batch" ? f.runtime.targets.batch : f.runtime.targets.createBead;
      const a = `${stem}-a`,
        b = `${stem}-b`;
      const key = `${stem}-retained`,
        fresh = `${stem}-fresh`;
      const input = (name: string, deep = false) => {
        const value = {
          id: `beads/${name}`,
          type: bead,
          properties: { title: name },
          metadata: deep ? { nested } : {},
        };
        return JSON.stringify(
          kind === "batch" ? { operations: [{ operation: "createBead", ...value }] } : value,
        );
      };
      const seed = completed(
        await exchange(`${kind}-seed`, target, input(a), key),
        a,
        key,
        `pos-${position}`,
      );
      const conflict = await exchange(
        `${kind}-deep-conflict`,
        target,
        input(a, true),
        key,
        "text/plain",
      );
      expect(conflict.status, `depth-key:${kind}:conflict-before-depth`).toBe(409);
      expect(checkedProblem(record(JSON.parse(conflict.text)))).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      });
      checkedContext(conflict, `pos-${position}`);
      const replay = await exchange(`${kind}-equal-replay`, target, input(a), key);
      expect(replay.status).toBe(200);
      expect(JSON.parse(replay.text)).toEqual(seed);
      checkedContext(replay, `pos-${position}`);
      const refused = await exchange(
        `${kind}-fresh-depth`,
        target,
        input(b, true),
        fresh,
        "text/plain",
      );
      expect(refused.status).toBe(500);
      expect(refused.text).toBe("");
      expect(refused.headers.get("x-bdp-development-limit")).toBe(
        "unsupported-transaction-composition",
      );
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(refused.headers.get(name)).toBeNull();
      completed(
        await exchange(`${kind}-fresh-reuse`, target, input(b), fresh),
        b,
        fresh,
        `pos-${position + 1}`,
      );
      const point = await exchange(`${kind}-point-unchanged`, `${f.runtime.scope}beads/${a}`);
      expect(point.status).toBe(200);
      const pointBody: unknown = JSON.parse(point.text);
      expect(validBead(pointBody), JSON.stringify(validBead.errors)).toBe(true);
      expect(pointBody).toEqual(record((seed.results as unknown[])[0]).resource);
      checkedContext(point, `pos-${position + 1}`);
    }
    const collection = await exchange(
      "final-complete-collection",
      `${f.runtime.scope}beads/?limit=32`,
    );
    expect(collection.status).toBe(200);
    const collectionBody: unknown = JSON.parse(collection.text);
    expect(validCollection(collectionBody), JSON.stringify(validCollection.errors)).toBe(true);
    expect(collectionBody).toEqual({ items: resources, next: null });
    checkedContext(collection, "pos-4");
    expect(attempts).toBe(13);
    expect(receipts).toHaveLength(4);
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    try {
      console.log(
        "depth-key-source-observation " +
          JSON.stringify({
            attempts,
            responses: observations,
            primaryFailureCount: failures.length,
          }),
      );
    } catch (error) {
      failures.push(error);
    }
    const actions = cleanup.splice(cleanupStart).reverse();
    const end = performance.now() + 5000;
    let cleanupActionsCompleted = 0;
    for (const action of actions) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = end - performance.now();
        if (remaining <= 0) {
          failures.push(new Error("depth-key cleanup deadline"));
          break;
        }
        await Promise.race([
          Promise.resolve().then(action),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("depth-key cleanup deadline")), remaining);
          }),
        ]);
        cleanupActionsCompleted++;
      } catch (error) {
        failures.push(error);
        break;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    cleanupCompleted = cleanupActionsCompleted === actions.length;
    try {
      console.log(
        "depth-key-source-cleanup " +
          JSON.stringify({
            cleanupActions: actions.length,
            cleanupActionsCompleted,
            cleanupCompleted,
            primaryOrCleanupFailureCount: failures.length,
          }),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "depth-key HTTP assertions or cleanup failed");
}, 30000);

it("rejects malformed minimum tuples across read routes without entering the actual owner", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-"));
  const failures: unknown[] = [];
  let owner: ReturnType<typeof openTransactionStore> | undefined;
  let service: ReturnType<typeof createTransactionService> | undefined;
  const entries: string[] = [];
  try {
    const scope = "https://example.test/minimum/";
    owner = openTransactionStore({
      file: path.join(directory, "owner.sqlite"),
      scope,
      create: true,
      types,
    });
    // Copy the frozen owner's method descriptors into a mutable delegating facade.
    // Every call still reaches the actual owner; setup observations are counted separately.
    const facade = { ...owner };
    for (const [name, value] of Object.entries(facade)) {
      if (typeof value === "function")
        Object.defineProperty(facade, name, {
          value: (...args: unknown[]) => {
            entries.push(name);
            return Reflect.apply(value, owner, args);
          },
        });
    }
    let opaque = 0;
    service = createTransactionService(facade, {
      ownerLifetime: "service",
      read: {
        selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
        advertisedLimits: {
          page: { defaultItems: 2, maximumItems: 32 },
          selector: { bytes: 4096, depth: 32, nodes: 256 },
          cursorTtlMilliseconds: 1000,
        },
        pagination: {
          scope,
          defaultPageItems: 2,
          maxPageItems: 32,
          cursorTtlMs: 1000,
          retainedStateCapacity: 100,
          maxRetainedCursorPositionsPerSnapshot: 20,
          retainedSnapshotByteCapacity: 100000,
          retainedSnapshotNodeCapacity: 10000,
          maxOpaqueTokenLength: 64,
          tokenGenerationAttempts: 3,
          idleCleanup: "on-demand",
          clock: Date.now,
          generateOpaqueToken: () => `minimum_${++opaque}`,
        },
      },
    });
    const handler = createTransactionHttpHandler(service, scope);
    const setupEntries = [...entries];
    entries.length = 0;
    let calls = 0,
      directGetBytes = 0;
    const authorization = { kind: "authenticated", principal: "p", canMutate: true } as const;
    for (const suffix of [
      "",
      "bdp.json",
      "operations/",
      "beads/",
      "beads/missing",
      "links/missing",
      "alias/missing",
      "snapshot",
      "changes/",
      "beads/missing?view=events",
      "links/missing?view=events",
      "events/",
      "receipts/",
      "receipts/unknown",
      "receipts/unknown/pages/unknown",
    ])
      for (const method of ["GET", "HEAD"]) {
        const response = await handler.handle(
          new Request(new URL(suffix, scope), {
            method,
            headers: {
              "bdp-minimum-scope-position": "genesis",
              accept: "text/event-stream",
              "if-none-match": "*",
              "if-match": '"unmatched"',
            },
          }),
          authorization,
        );
        calls++;
        expect(response.kind, suffix).toBe("finite");
        expect(response.status, `${method} ${suffix}`).toBe(400);
        if (method === "GET") {
          expect(checkedProblem(record(response.body))).toMatchObject({
            code: "malformed-request",
            status: 400,
            retry: "never",
          });
          directGetBytes = Buffer.byteLength(JSON.stringify(response.body));
          expect(directGetBytes).toBeGreaterThan(0);
          // GET length is emitted later by the Node delivery boundary.
          expect(response.headers.get("content-length")).toBeNull();
        } else {
          expect(response.body).toBeUndefined();
          expect(Number(response.headers.get("content-length"))).toBe(directGetBytes);
        }
        for (const name of [
          "bdp-scope-epoch",
          "bdp-authorization-view",
          "bdp-scope-position",
          "etag",
          "location",
          "link",
          "x-bdp-development-limit",
        ])
          expect(response.headers.has(name), name).toBe(false);
      }
    for (const [method, authenticated, minimum, status] of [
      ["GET", false, true, 401],
      ["POST", true, true, 405],
    ] as const) {
      const response = await handler.handle(
        new Request(`${scope}receipts/`, {
          method,
          headers: minimum ? { "bdp-minimum-scope-position": "genesis" } : {},
        }),
        authenticated ? authorization : { kind: "unauthenticated" },
      );
      calls++;
      expect(response.status).toBe(status);
      if (status === 405) expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
    expect(entries, "malformed receiving must precede every owner read").toStrictEqual([]);
    const malformedEntries = [...entries];
    const absent = await handler.handle(new Request(`${scope}receipts/`), authorization);
    calls++;
    expect(absent.status).toBe(404);
    expect(entries, "ordinary absent-minimum receipt root still observes the owner").toStrictEqual([
      "readReceipt",
    ]);
    expect(calls).toBe(33);
    console.log(
      JSON.stringify({
        observation: "minimum-receiving-no-owner",
        calls,
        setupEntries,
        malformedEntries,
        absentMinimumEntries: entries,
        owners: 1,
        httpRequests: 0,
      }),
    );
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (service) await service.close();
      else owner?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "minimum receiving owner and cleanup");
});

// This local transport retains true duplicate field occurrences. It never follows
// redirects and bounds bytes while consuming, including an unexpected SSE reply.
async function minimumReceivingWire(
  scope: string,
  method: "GET" | "HEAD",
  suffix: string,
  fields: string[],
  signal: AbortSignal,
) {
  const url = new URL(suffix, scope);
  return await new Promise<{ status: number; headers: Headers; text: string; bytes: number }>(
    (resolve, reject) => {
      const request = httpRequest(
        url,
        {
          method,
          agent: false,
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          headers: [
            "Host",
            url.host,
            "Connection",
            "close",
            "Authorization",
            `Bearer ${token}`,
            "Accept",
            "application/json",
            ...fields,
          ],
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 32768) {
              const error = new Error("minimum receiving response byte bound");
              response.destroy(error);
              request.destroy(error);
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("aborted", () => reject(new Error("minimum receiving response aborted")));
          response.once("end", () => {
            const headers = new Headers();
            for (let i = 0; i < response.rawHeaders.length; i += 2)
              headers.append(response.rawHeaders[i]!, response.rawHeaders[i + 1]!);
            resolve({
              status: response.statusCode ?? 0,
              headers,
              text: Buffer.concat(chunks).toString("utf8"),
              bytes,
            });
          });
        },
      );
      request.once("error", reject);
      request.end();
    },
  );
}

async function minimumReceivingFixture(
  action: (scope: string, signal: AbortSignal) => Promise<void>,
) {
  const boundary = cleanup.length;
  const failures: unknown[] = [];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("minimum receiving cohort deadline")),
    15000,
  );
  try {
    const f = await fixture();
    await action(f.runtime.scope, controller.signal);
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    clearTimeout(timer);
    for (const close of cleanup.splice(boundary).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "minimum receiving HTTP and cleanup");
}

it("rejects raw repeated minimum fields and keeps receiving HEAD and SSE refusals finite", async () => {
  await minimumReceivingFixture(async (scope, signal) => {
    const tuple = [
      "BDP-Minimum-Scope-Position",
      "genesis",
      "BDP-Scope-Epoch",
      "epoch",
      "BDP-Authorization-View",
      "view",
    ];
    const observations: unknown[] = [];
    let getLength: string | null = null;
    for (let index = 0; index < 6; index++) {
      const method = index === 4 ? "HEAD" : "GET";
      const fields =
        index < 3
          ? [...tuple, tuple[index * 2]!.toLowerCase(), tuple[index * 2 + 1]!]
          : index === 3
            ? [...tuple.slice(0, 1), "genesis,genesis", ...tuple.slice(2)]
            : [
                "BDP-Minimum-Scope-Position",
                "genesis",
                ...(index === 5 ? ["Accept", "text/event-stream"] : []),
              ];
      const response = await minimumReceivingWire(scope, method, "beads/", fields, signal);
      observations.push({
        method,
        status: response.status,
        bytes: response.bytes,
        contentType: response.headers.get("content-type"),
        marker: response.headers.get("x-bdp-development-limit"),
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      if (method === "GET") {
        expect(checkedProblem(record(JSON.parse(response.text)))).toMatchObject({
          code: "malformed-request",
          status: 400,
          retry: "never",
        });
        expect(Number(response.headers.get("content-length"))).toBe(response.bytes);
        getLength = response.headers.get("content-length");
      } else {
        expect(response.text).toBe("");
        expect(response.bytes).toBe(0);
        expect(response.headers.get("content-length")).toBe(getLength);
      }
      for (const name of [
        "bdp-scope-epoch",
        "bdp-authorization-view",
        "bdp-scope-position",
        "etag",
        "location",
        "link",
        "x-bdp-development-limit",
      ])
        expect(response.headers.has(name)).toBe(false);
    }
    expect(observations).toHaveLength(6);
    console.log(
      JSON.stringify({
        observation: "minimum-receiving-raw",
        requests: 6,
        responses: observations,
      }),
    );
  });
}, 20000);

it("enforces the minimum-receiving-malformed-request boundary over the emitted listener", async () => {
  await minimumReceivingFixture(async (scope, signal) => {
    const response = await minimumReceivingWire(
      scope,
      "GET",
      "beads/",
      ["BDP-Minimum-Scope-Position", "genesis"],
      signal,
    );
    const observed = {
      observation: "minimum-receiving-control",
      requests: 1,
      status: response.status,
      marker: response.headers.get("x-bdp-development-limit"),
      body: response.text,
    };
    console.log(JSON.stringify(observed));
    expect(response.status, `minimum-receiving-malformed-request ${JSON.stringify(observed)}`).toBe(
      400,
    );
    expect(checkedProblem(record(JSON.parse(response.text)))).toMatchObject({
      code: "malformed-request",
      status: 400,
      retry: "never",
    });
  });
}, 20000);
