/** Actual loopback Snapshot observations; private fixed-view transport, no admission claim. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import type { TransactionChangefeedPage } from "./transaction-changefeed.js";
import { afterEach, expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaUri, isJsonSchemaDateTime, parseTypeDescriptor } from "@bdp/protocol";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import {
  transactionRuntimeDigest,
  captureTransactionRuntimeConfiguration,
} from "./transaction-runtime-configuration.js";
import type { TransactionRuntimeOptions } from "./transaction-runtime.js";
import type {
  TransactionSnapshotManifest,
  TransactionSnapshotPage,
} from "./transaction-snapshot.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const scope = "https://snapshot.test/acme/",
  bead = `${scope}types/bead`,
  link = `${scope}types/link`;
const token = "a".repeat(32),
  reader = "b".repeat(32);
const types = [
  {
    id: bead,
    name: "Bead",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing: { [link]: { max: 32 } },
  },
  {
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  },
].map((value) => parseTypeDescriptor(value));
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(schema);
const manifestSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/snapshotManifest` });
const pageSchemas = {
  bead: ajv.compile({ $ref: `${schema.$id}#/$defs/beadCollection` }),
  link: ajv.compile({ $ref: `${schema.$id}#/$defs/linkCollection` }),
};
const problemSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/transactionalProblem` });
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: bead,
  properties: { title: `café 🦉 ${id}` },
});
function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("required observation missing");
  return value;
}
async function fixture(seamless = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-http-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000,
    key = 0;
  const options: TransactionRuntimeOptions = {
    directory,
    create: true,
    port: 0,
    scope,
    authorityMode: "listener",
    credentials: [
      { token, principal: "writer", canMutate: true },
      { token: reader, principal: "different", canMutate: false },
    ],
    ...(seamless
      ? {
          artifacts: {
            descriptors: types.map((type) => ({
              retrievalUri: type.id,
              utf8: JSON.stringify(type),
            })),
            schemas: [],
            limits: { ...CONTRACT_ARTIFACT_CEILINGS },
          },
        }
      : { types }),
  };
  const seams = seamless ? {} : { clock: () => now, maintenanceIntervalMs: 2147483647 };
  let runtime = await startTransactionRuntime(options, seams);
  cleanups.push(() => runtime.close());
  const file = path.join(directory, "transaction.sqlite");
  async function get(url = `${scope}snapshot`, init: RequestInit = {}) {
    const canonical = new URL(url),
      dial = new URL(canonical.pathname + canonical.search, runtime.listenUrl);
    return fetch(dial, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...Object.fromEntries(new Headers(init.headers)),
      },
      redirect: "manual",
    });
  }
  async function offline<T>(run: (db: DatabaseSync) => T): Promise<T> {
    await runtime.close();
    const db = new DatabaseSync(file);
    try {
      return run(db);
    } finally {
      db.close();
      runtime = await startTransactionRuntime({ ...options, create: false }, seams);
    }
  }
  return {
    get runtime() {
      return runtime;
    },
    options,
    get,
    offline,
    setTime(time: number) {
      now = time;
    },
    async reopen() {
      await runtime.close();
      runtime = await startTransactionRuntime({ ...options, create: false }, seams);
    },
    async state() {
      return offline((db) => ({
        snapshots: db.prepare("SELECT * FROM snapshots ORDER BY id").all(),
        records: db.prepare("SELECT * FROM snapshot_records ORDER BY snapshot,kind,ordinal").all(),
        pages: db.prepare("SELECT * FROM snapshot_pages ORDER BY snapshot,kind,ordinal").all(),
        position: db.prepare("SELECT value FROM metadata WHERE name='position'").get(),
        receipts: db.prepare("SELECT * FROM receipts ORDER BY key").all(),
        groups: db.prepare("SELECT * FROM groups ORDER BY position").all(),
      }));
    },
    async write(operations: unknown[]) {
      const response = await get(runtime.targets.batch, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `write_${key++}` },
        body: JSON.stringify({ operations }),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as { status: string };
      expect(result.status).toBe("completed");
      return result;
    },
    async capture() {
      const response = await get();
      expect(response.status).toBe(200);
      const value = (await response.json()) as TransactionSnapshotManifest;
      expect(manifestSchema(value), JSON.stringify(manifestSchema.errors)).toBe(true);
      return value;
    },
  };
}
function context(response: Response) {
  return Object.fromEntries(
    ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"].map((key) => [
      key,
      response.headers.get(key),
    ]),
  );
}
async function checkedProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const value = (await response.json()) as { code: string };
  expect(problemSchema(value), JSON.stringify(problemSchema.errors)).toBe(true);
  expect(value.code).toBe(code);
  expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
  return value;
}
async function collect(
  f: Awaited<ReturnType<typeof fixture>>,
  first: TransactionSnapshotPage,
  kind: "bead" | "link",
) {
  let page = first;
  const rows = [...page.items],
    urls: string[] = [];
  while (page.next) {
    urls.push(page.next);
    const response = await f.get(page.next);
    expect(response.status).toBe(200);
    page = (await response.json()) as TransactionSnapshotPage;
    expect(pageSchemas[kind](page), JSON.stringify(pageSchemas[kind].errors)).toBe(true);
    rows.push(...page.items);
  }
  return { rows, urls };
}

it("captures real complete owned streams, retains literal bodies across mutations/reopen, and resumes exclusive changefeed", async () => {
  const f = await fixture();
  const empty = await f.capture();
  expect(empty.checkpoint).toBe("genesis");
  expect(empty.beads).toEqual({ items: [], next: null });
  expect(empty.links).toEqual({ items: [], next: null });
  const names = Array.from({ length: 34 }, (_, n) => `b${String(n).padStart(2, "0")}`);
  await f.write(names.slice(0, 32).map(create));
  await f.write(names.slice(32).map(create));
  const edges = Array.from({ length: 34 }, (_, n) => ({
    operation: "createLink",
    id: `links/e${String(n).padStart(2, "0")}`,
    type: link,
    source: `beads/${names[n]}`,
    target: "beads/b00",
    properties: { n },
  }));
  await f.write(edges.slice(0, 32));
  await f.write(edges.slice(32));
  const snapshot = await f.capture();
  expect(snapshot.scopePosition).toBe("pos-4");
  expect(snapshot.checkpoint).not.toBe("genesis");
  const beads = await collect(f, snapshot.beads, "bead"),
    links = await collect(f, snapshot.links, "link");
  expect(beads.rows.map((r) => r.id)).toEqual(names.map((n) => `${scope}beads/${n}`));
  expect(links.rows.map((r) => r.id)).toEqual(edges.map((r) => `${scope}${r.id}`));
  for (const [i, row] of beads.rows.entries())
    expect("ownedLinks" in row && row.ownedLinks?.[link]).toEqual([links.rows[i]]);
  const literals = new Map<string, string>();
  for (const url of [snapshot.id, ...beads.urls, ...links.urls])
    literals.set(url, await (await f.get(url)).text());
  await f.write([
    {
      operation: "updateBead",
      bead: "beads/b00",
      propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
    },
  ]);
  await f.reopen();
  for (const [url, text] of literals) {
    const response = await f.get(url, { headers: { authorization: `Bearer ${reader}` } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(text);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-5");
  }
  const feedUrl = new URL("changes/", scope);
  feedUrl.searchParams.set("after", snapshot.checkpoint);
  const feed = await f.get(feedUrl.href);
  expect(feed.status).toBe(200);
  const changes = (await feed.json()) as TransactionChangefeedPage;
  expect(changes.after).toBe(snapshot.checkpoint);
  expect(changes.groups).toHaveLength(1);
  expect(changes.groups[0]?.position).toBe("pos-5");
  expect(changes.groups[0]?.previousPosition).toBe("pos-4");
  const replica = new Map([...beads.rows, ...links.rows].map((row) => [row.id, row]));
  for (const change of present(changes.groups[0]).changes) {
    if (change.operation === "tombstone") replica.delete(change.resource.id);
    else {
      expect("properties" in change.resource).toBe(true);
      replica.set(change.resource.id, change.resource as (typeof beads.rows)[number]);
    }
  }
  expect(changes.groups[0]?.changes).toHaveLength(1);
  for (const [url, row] of replica) {
    const current = await f.get(url);
    expect(current.status).toBe(200);
    // Ordinary Bead navigation may contain a links affordance, which is not a captured field.
    const wire = (await current.json()) as Record<string, unknown>;
    delete wire.links;
    expect(wire).toEqual(row);
  }
  expect(replica.get(`${scope}beads/b00`)?.properties).toEqual({ title: "after" });
});

it("creation conditionals, negotiation, HEAD and transport refusals never issue an identity or consume live capacity", async () => {
  const f = await fixture();
  await f.write([create("a")]);
  const prior = [];
  for (let i = 0; i < 7; i++) prior.push(await f.capture());
  const before = await f.state();
  for (const [status, init] of [
    [304, { headers: { "if-none-match": "*" } }],
    [412, { headers: { "if-match": '"missing"' } }],
    [406, { headers: { accept: "text/plain" } }],
    [200, { method: "HEAD" }],
    [401, { headers: { authorization: "" } }],
    [405, { method: "POST" }],
    [403, { headers: { origin: "https://other.test" } }],
  ] as [number, RequestInit][]) {
    const response = await f.get(undefined, init);
    expect(response.status).toBe(status);
    if ([200, 304, 406, 412].includes(status)) {
      expect(await response.text()).toBe("");
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("bdp-scope-position")).toBe("pos-1");
      if (status === 304 || init.method === "HEAD")
        expect(response.headers.get("content-length")).toBeNull();
      if (status === 406) expect(response.headers.get("vary")).toBe("Accept");
    } else await response.arrayBuffer();
  }
  expect(await f.state()).toEqual(before);
  const eighth = await f.get(undefined, {
    headers: { "if-match": "*", "if-none-match": '"nonmatching"' },
  });
  expect(eighth.status).toBe(200);
  await eighth.arrayBuffer();
  const refused = await f.get();
  await checkedProblem(refused, 503, "temporarily-unavailable");
  expect(refused.headers.get("retry-after")).toBe("300");
  expect((await f.state()).snapshots).toHaveLength(8);
  for (const old of prior) {
    const response = await f.get(old.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(old);
  }
  const head = await f.get(undefined, { method: "HEAD" });
  expect(head.status).toBe(503);
  expect(await head.text()).toBe("");
});

it("retained HEAD uses UTF-8 bytes, conditional decisions carry current context, and expiry precedes shortcuts", async () => {
  const f = await fixture();
  await f.write(Array.from({ length: 32 }, (_, n) => create(`b${n}`)));
  await f.write([create("tail")]);
  const snapshot = await f.capture();
  expect(snapshot.beads.next).not.toBeNull();
  const other = await f.capture();
  const wrongKind = new URL(present(snapshot.beads.next));
  wrongKind.searchParams.set("stream", "links");
  await checkedProblem(await f.get(wrongKind.href), 404, "resource-not-found");
  const borrowed = new URL(present(snapshot.beads.next));
  borrowed.searchParams.set("snapshot", present(new URL(other.id).searchParams.get("snapshot")));
  await checkedProblem(await f.get(borrowed.href), 404, "resource-not-found");
  for (const url of [snapshot.id, present(snapshot.beads.next)]) {
    const get = await f.get(url),
      text = await get.text();
    expect(Buffer.byteLength(text)).toBeGreaterThan(text.length);
    const head = await f.get(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(text)));
    expect(context(head)).toEqual(context(get));
    for (const [header, value, status] of [
      ["if-none-match", "*", 304],
      ["if-match", '"other"', 412],
    ] as const) {
      const conditional = await f.get(url, { headers: { [header]: value } });
      expect(conditional.status).toBe(status);
      expect(context(conditional)).toEqual(context(get));
      expect(await conditional.text()).toBe("");
      if (status === 304) expect(conditional.headers.get("content-length")).toBeNull();
    }
  }
  f.setTime(1300000);
  expect((await f.get(snapshot.id)).status).toBe(200);
  f.setTime(1300001);
  for (const url of [snapshot.id, present(snapshot.beads.next)]) {
    await checkedProblem(
      await f.get(url, { headers: { "if-none-match": "*" } }),
      410,
      "cursor-expired",
    );
    const head = await f.get(url, { method: "HEAD" });
    expect(head.status).toBe(410);
    expect(await head.text()).toBe("");
  }
  const wrong = new URL(present(snapshot.beads.next));
  wrong.searchParams.set("page", `sp_1_${"a".repeat(43)}`);
  await checkedProblem(await f.get(wrong.href), 404, "resource-not-found");
  wrong.searchParams.set("stream", "links");
  await checkedProblem(await f.get(wrong.href), 404, "resource-not-found");
  await f.reopen();
  await checkedProblem(await f.get(present(snapshot.beads.next)), 410, "cursor-expired");
  const state = await f.state();
  expect(state.snapshots).toHaveLength(2);
  expect(state.records).toHaveLength(0);
  expect(state.pages).toHaveLength(0);
});

it("closed query syntax, unsupported controls and foreign creation context fail before capture or conditional success", async () => {
  const f = await fixture(),
    before = await f.state();
  for (const query of [
    "?view=events",
    "?snapshot=x&snapshot=y",
    "?snapshot=x&page=x",
    "?snapshot=x&stream=wrong&page=x",
    "?unknown=x",
    "?snapshot=",
  ])
    await checkedProblem(await f.get(`${scope}snapshot${query}`), 400, "invalid-parameter");
  for (const headers of [
    { "bdp-scope-epoch": "epoch" },
    { "bdp-authorization-view": "view" },
    { "bdp-minimum-scope-position": "pos-0" },
    {
      "bdp-scope-epoch": "epoch",
      "bdp-authorization-view": "view",
      "bdp-minimum-scope-position": "pos-0",
    },
  ])
    for (const url of [
      `${scope}snapshot`,
      `${scope}snapshot?snapshot=unknown`,
      `${scope}snapshot?snapshot=unknown&stream=beads&page=unknown`,
    ])
      for (const method of ["GET", "HEAD"]) {
        const response = await f.get(url, {
          method,
          headers: { ...headers, "if-none-match": "*" },
        });
        if (url === `${scope}snapshot` && Object.keys(headers).length === 3) {
          expect(response.status).toBe(410);
          expect(response.headers.get("bdp-scope-position")).toBe("pos-0");
          expect(response.headers.get("x-bdp-development-limit")).toBeNull();
          if (method === "HEAD") expect(await response.text()).toBe("");
          else await checkedProblem(response, 410, "cursor-expired");
        } else if (Object.keys(headers).length < 3) {
          expect(response.status).toBe(400);
          expect(response.headers.get("x-bdp-development-limit")).toBeNull();
          expect(response.headers.get("bdp-scope-position")).toBeNull();
          if (method === "HEAD") expect(await response.text()).toBe("");
          else await checkedProblem(response, 400, "malformed-request");
        } else {
          expect(response.status).toBe(500);
          expect(await response.text()).toBe("");
          expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
          expect(response.headers.get("bdp-scope-position")).toBeNull();
        }
      }
  expect(await f.state()).toEqual(before);
  await checkedProblem(await f.get(`${scope}snapshot?snapshot=unknown`), 404, "resource-not-found");
});

it.each(["missing-record", "bad-record", "missing-page"])(
  "promised unexpired %s is bodyless500 even with a conditional shortcut",
  async (fault) => {
    const f = await fixture();
    await f.write([create("a")]);
    const snapshot = await f.capture();
    await f.offline((db) => {
      db.exec(
        fault === "missing-record"
          ? "DELETE FROM snapshot_records"
          : fault === "missing-page"
            ? "DELETE FROM snapshot_pages"
            : "UPDATE snapshot_records SET body='{}'",
      );
    });
    for (const method of ["GET", "HEAD"]) {
      const response = await f.get(snapshot.id, { method, headers: { "if-none-match": "*" } });
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("");
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
    }
  },
);

it("actual HTTP413 from valid offline capacity preparation preserves prior live captures and graph state", async () => {
  const f = await fixture();
  const prior = await f.capture();
  const started = performance.now();
  await f.offline((db) => {
    db.exec("BEGIN");
    const put = db.prepare("INSERT INTO resources VALUES(?,?,'bead',NULL,NULL)");
    for (let n = 0; n < 4097; n++) {
      const local = `beads/b${String(n).padStart(4, "0")}`;
      put.run(
        local,
        JSON.stringify({
          id: scope + local,
          type: bead,
          revision: `fixture_${n}`,
          properties: {},
          metadata: {},
          ownedLinks: { [link]: [] },
        }),
      );
    }
    db.exec("COMMIT");
  });
  const before = await f.state();
  const response = await f.get();
  await checkedProblem(response, 413, "limit-exceeded");
  expect(response.headers.get("retry-after")).toBeNull();
  const head = await f.get(undefined, { method: "HEAD" });
  expect(head.status).toBe(413);
  expect(await head.text()).toBe("");
  expect(await f.state()).toEqual(before);
  const retained = await f.get(prior.id);
  expect(retained.status).toBe(200);
  expect(await retained.json()).toEqual(prior);
  console.info(
    JSON.stringify({
      witness: "offline4097-realHTTP413",
      elapsedMs: Math.round(performance.now() - started),
      mutationAdmission: false,
    }),
  );
});

it("seamless compiled actual metadata survives Snapshot serving/restart, while clocked metadata stays absent", async () => {
  const f = await fixture(true),
    identity = f.runtime.configurationMetadata;
  expect(identity).toBeDefined();
  expect(identity?.claimEligible).toBe(false);
  const settings = captureTransactionRuntimeConfiguration(f.options).settings;
  expect(settings.scopeSnapshot.limits.snapshotPageItems).toBe(32);
  if (!identity) throw new Error("expected private configuration metadata");
  const inputs = {
    revision: "transaction-runtime-1",
    scope,
    artifactIdentity: identity.artifactIdentity,
    settings,
    authorityMode: identity.authorityMode,
    policyIdentity: identity.policyIdentity,
    authenticationIdentity: identity.authenticationIdentity,
    profile: "transactional",
    history: false,
  };
  expect(identity.runtimeConfigurationIdentity).toBe(transactionRuntimeDigest(inputs));
  // Digest sensitivity is a detached unit counterfactual, not a served setting override.
  expect(identity.runtimeConfigurationIdentity).not.toBe(
    transactionRuntimeDigest({
      ...inputs,
      settings: {
        ...settings,
        scopeSnapshot: {
          ...settings.scopeSnapshot,
          limits: {
            ...settings.scopeSnapshot.limits,
            lifetimeMs: settings.scopeSnapshot.limits.lifetimeMs + 1,
          },
        },
      },
    }),
  );
  const snapshot = await f.capture();
  await f.reopen();
  expect(f.runtime.configurationMetadata).toEqual(identity);
  expect(await (await f.get(snapshot.id)).json()).toEqual(snapshot);
  const clocked = await fixture();
  expect(clocked.runtime.configurationMetadata).toBeUndefined();
});

it("tracks finite HTTP work through close and leaves no listener accepting afterwards", async () => {
  const f = await fixture();
  const response = await f.get();
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  const requests = Array.from({ length: 3 }, () => f.get());
  await Promise.all(
    requests.map(async (request) => {
      const result = await request;
      expect(result.status).toBe(200);
      await result.arrayBuffer();
    }),
  );
  await f.runtime.close();
  await expect(f.get()).rejects.toThrow();
  // This proves actual shutdown/drain. Request.signal is synthetic in this
  // runtime: no claim that socket disconnect aborts synchronous capture.
});

it("raw unsupported methods and Host refusal preserve the no-allocation boundary", async () => {
  const f = await fixture(),
    before = await f.state();
  function raw(method: string, host?: string) {
    return new Promise<{ status: number; allow: string | undefined; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          new URL("acme/snapshot", f.runtime.listenUrl),
          { method, headers: { authorization: `Bearer ${token}`, ...(host ? { host } : {}) } },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: present(response.statusCode),
                allow: response.headers.allow,
                body: Buffer.concat(chunks).toString(),
              }),
            );
            response.on("error", reject);
          },
        );
        req.setTimeout(3000, () => req.destroy(new Error("raw Snapshot deadline")));
        req.on("error", reject);
        req.end();
      },
    );
  }
  expect(await raw("TRACE")).toEqual({ status: 405, allow: "GET, HEAD", body: "" });
  expect((await raw("GET", "wrong.test")).status).toBe(400);
  expect(await f.state()).toEqual(before);
});

it("current graph-integrity failure is observed by HEAD/preconditions before any issuance", async () => {
  const f = await fixture();
  await f.write([
    create("a"),
    create("b"),
    { operation: "createLink", id: "links/e", type: link, source: "beads/a", target: "beads/b" },
  ]);
  await f.offline((db) => {
    db.exec("DELETE FROM resources WHERE id='links/e'");
  });
  const before = await f.state();
  for (const init of [{ method: "HEAD" }, { headers: { "if-none-match": "*" } }, {}]) {
    const response = await f.get(undefined, init);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  }
  expect(await f.state()).toEqual(before);
});

it("uses one authority body pass for successful GET and preserves full nonallocating decisions", async () => {
  let bodyReads = 0;
  const restores: (() => void)[] = [];
  const original = DatabaseSync.prototype.prepare;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const statement = original.call(this, sql);
    if (sql === "SELECT * FROM resources WHERE id=? AND kind=?") {
      const get = statement.get.bind(statement);
      const observed = vi.spyOn(statement, "get").mockImplementation((...args) => {
        bodyReads++;
        return get(...args);
      });
      restores.push(() => observed.mockRestore());
    }
    return statement;
  });
  try {
    const f = await fixture();
    await f.write([create("a")]);
    bodyReads = 0;
    const created = await f.capture();
    expect(bodyReads).toBe(1); // Old unconditional preflight + capture performs two.
    for (const [status, init] of [
      [200, { method: "HEAD" }],
      [304, { headers: { "if-none-match": "*" } }],
      [412, { headers: { "if-match": '"missing"' } }],
      [406, { headers: { accept: "text/plain" } }],
    ] as [number, RequestInit][]) {
      bodyReads = 0;
      const response = await f.get(undefined, init);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      expect(bodyReads).toBe(1);
    }
    expect((await f.state()).snapshots).toHaveLength(1);
    expect(await (await f.get(created.id)).json()).toEqual(created);
  } finally {
    for (const restore of restores.reverse()) restore();
    spy.mockRestore();
  }
});

it("allows read-only principals to create and use a safe Snapshot", async () => {
  const f = await fixture();
  await f.write([create("reader")]);
  const response = await f.get(undefined, { headers: { authorization: `Bearer ${reader}` } });
  expect(response.status).toBe(200);
  const manifest = (await response.json()) as TransactionSnapshotManifest;
  expect(manifestSchema(manifest), JSON.stringify(manifestSchema.errors)).toBe(true);
  const retained = await f.get(manifest.id, { headers: { authorization: `Bearer ${reader}` } });
  expect(retained.status).toBe(200);
  expect(await retained.json()).toEqual(manifest);
});

it("measures repeated nonallocating full passes on a disclosed offline 4000-record fixture", async () => {
  const f = await fixture();
  await f.offline((db) => {
    db.exec("BEGIN");
    const insert = db.prepare("INSERT INTO resources VALUES(?,?,'bead',NULL,NULL)");
    for (let n = 0; n < 4000; n++) {
      const id = `beads/b${String(n).padStart(4, "0")}`;
      insert.run(
        id,
        JSON.stringify({
          id: `${scope}${id}`,
          type: bead,
          revision: "offline-valid",
          properties: { padding: "x".repeat(1024) },
          metadata: {},
          ownedLinks: { [link]: [] },
        }),
      );
    }
    db.exec("COMMIT");
  });
  const before = await f.state();
  const observations: { status: number; elapsedMs: number }[] = [];
  for (let repeat = 0; repeat < 2; repeat++)
    for (const [status, init] of [
      [200, { method: "HEAD" }],
      [304, { headers: { "if-none-match": "*" } }],
      [412, { headers: { "if-match": '"missing"' } }],
      [406, { headers: { accept: "text/plain" } }],
    ] as [number, RequestInit][]) {
      const start = performance.now();
      const response = await f.get(undefined, init);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      observations.push({ status, elapsedMs: Math.round(performance.now() - start) });
    }
  expect(await f.state()).toEqual(before);
  console.info(
    JSON.stringify({
      witness: "repeated-nonallocating-snapshot",
      node: process.version,
      records: 4000,
      paddingBytesPerRecord: 1024,
      mutationAdmission: false,
      ceilingOwned: false,
      observations,
    }),
  );
});
