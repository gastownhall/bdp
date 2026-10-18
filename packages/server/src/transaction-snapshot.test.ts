import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  parseTypeDescriptor,
  isJsonSchemaUri,
  isJsonSchemaDateTime,
  compareCanonicalIds,
  stringifyJsonValue,
} from "@bdp/protocol";
import { openTransactionStore, type TransactionStoreOptions } from "./transaction-store.js";
import { TransactionMinimumUnproved } from "./transaction-consistency.js";
import { prepareTransactionSetCore } from "./transaction-batch.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS as limits,
  TransactionSnapshotFailure,
  transactionSnapshotUrl,
  transactionSnapshotStorage,
  type TransactionSnapshotManifest,
  type TransactionSnapshotPage,
} from "./transaction-snapshot.js";
const scope = "https://example.test/snapshot/",
  beadType = `${scope}types/bead`,
  linkType = `${scope}types/link`;
const types = [
  {
    id: beadType,
    name: "Owner",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing: { [linkType]: { max: 32 } },
  },
  {
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  },
].map((value) => parseTypeDescriptor(value));
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: beadType,
  properties: { n: 0, precise: 0.30000000000000004 },
});
const edge = (id: string, source = "a", target = "b") => ({
  operation: "createLink",
  id: `links/${id}`,
  type: linkType,
  source: `beads/${source}`,
  target: `beads/${target}`,
  properties: { n: 0 },
});
function fixture(fault?: TransactionStoreOptions["fault"]) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-"));
  let now = 1000000;
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    types,
    create: true,
    clock: () => now,
    ...(fault ? { fault } : {}),
  };
  let owner = openTransactionStore(options),
    key = 0;
  cleanup.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    options,
    get owner() {
      return owner;
    },
    setTime(value: number) {
      now = value;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    offline(run: (db: DatabaseSync) => void) {
      owner.close();
      const db = new DatabaseSync(options.file);
      try {
        run(db);
      } finally {
        db.close();
      }
      owner = openTransactionStore({ ...options, create: false });
    },
    run(operations: unknown[]) {
      const admitted = owner.admit(
        "p",
        `key_${key++}`,
        prepareTransactionSetCore(scope, JSON.stringify({ operations })),
      );
      if (admitted.kind !== "owned") throw Error("admission");
      const receipt = owner.execute(admitted.claim);
      expect(receipt.status).toBe("completed");
      return receipt;
    },
  };
}
const handle = (manifest: TransactionSnapshotManifest) =>
  new URL(manifest.id).searchParams.get("snapshot")!;
function collect(
  f: ReturnType<typeof fixture>,
  manifest: TransactionSnapshotManifest,
  kind: "bead" | "link",
) {
  let page: TransactionSnapshotPage = kind === "bead" ? manifest.beads : manifest.links;
  const records = [...page.items];
  while (page.next) {
    const url = new URL(page.next);
    expect(url.origin + url.pathname).toBe(`${scope}snapshot`);
    expect(url.searchParams.get("snapshot")).toBe(handle(manifest));
    expect(url.searchParams.get("stream")).toBe(`${kind}s`);
    page = f.owner.readSnapshotPage(handle(manifest), kind, url.searchParams.get("page")!).page;
    records.push(...page.items);
  }
  return records;
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(schema);
const manifestSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/snapshotManifest` });
const problemSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/transactionalProblem` });
function problem(run: () => unknown, code: string) {
  try {
    run();
    throw Error("expected Snapshot failure");
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionSnapshotFailure);
    const body = (error as TransactionSnapshotFailure).problem;
    expect(body.code).toBe(code);
    expect(problemSchema(body), JSON.stringify(problemSchema.errors)).toBe(true);
    return body;
  }
}
it("captures a schema-valid frozen empty genesis without changing graph, receipts or position", () => {
  const f = fixture();
  const before = f.owner.captureChangesStart();
  const value = f.owner.captureSnapshot();
  expect(manifestSchema(value.manifest), JSON.stringify(manifestSchema.errors)).toBe(true);
  expect(value.manifest).toMatchObject({
    scope,
    checkpoint: "genesis",
    scopePosition: "pos-0",
    beads: { items: [], next: null },
    links: { items: [], next: null },
    erasures: [],
  });
  expect(Object.isFrozen(value.manifest.beads.items)).toBe(true);
  expect(f.owner.captureChangesStart()).toBe(before);
  f.offline((db) => {
    for (const table of ["resources", "identities", "aliases", "receipts", "groups"])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(1);
  });
});
it("captures complete canonical streams larger than a page and transaction, survives mutation and reopen, then rendezvous with feed", () => {
  const f = fixture();
  f.run([
    create("a"),
    create("b"),
    ...Array.from({ length: 30 }, (_, n) => create(`z${n.toString().padStart(2, "0")}`)),
  ]);
  f.run(Array.from({ length: 5 }, (_, n) => create(`c${n}`)));
  f.run(Array.from({ length: 20 }, (_, n) => edge(`a${n}`, "a")));
  f.run(Array.from({ length: 15 }, (_, n) => edge(`b${n}`, "b", "a")));
  const { manifest } = f.owner.captureSnapshot(),
    id = handle(manifest);
  expect(manifestSchema(manifest), JSON.stringify(manifestSchema.errors)).toBe(true);
  const beads = collect(f, manifest, "bead"),
    links = collect(f, manifest, "link");
  expect(beads.map((r) => r.id)).toEqual(
    [
      "a",
      "b",
      ...Array.from({ length: 30 }, (_, n) => `z${n.toString().padStart(2, "0")}`),
      ...Array.from({ length: 5 }, (_, n) => `c${n}`),
    ]
      .map((s) => `${scope}beads/${s}`)
      .sort(compareCanonicalIds),
  );
  expect(links.map((r) => r.id)).toEqual(
    [
      ...Array.from({ length: 20 }, (_, n) => `a${n}`),
      ...Array.from({ length: 15 }, (_, n) => `b${n}`),
    ]
      .map((s) => `${scope}links/${s}`)
      .sort(compareCanonicalIds),
  );
  for (const bead of beads) {
    expect(bead.properties.precise).toBe(0.30000000000000004);
    expect(bead).not.toHaveProperty("links");
    for (const inline of Object.values("ownedLinks" in bead ? (bead.ownedLinks ?? {}) : {}).flat())
      expect(inline).toEqual(links.find((link) => link.id === inline.id));
  }
  f.run([
    {
      operation: "updateLink",
      link: "links/a0",
      propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
    },
    { operation: "deleteBead", bead: "beads/c0" },
  ]);
  f.reopen();
  expect(f.owner.readSnapshot(id).manifest).toEqual(manifest);
  expect(collect(f, manifest, "bead")).toEqual(beads);
  expect(collect(f, manifest, "link")).toEqual(links);
  expect(f.owner.readSnapshot(id).context.scopePosition).not.toBe(manifest.scopePosition);
  // Replica begins from independently checked complete streams; apply each group
  // to staging, validate owned/first-class agreement, only then publish cursor.
  const replica = new Map([...beads, ...links].map((r) => [r.id, r]));
  const observed = f.owner.readChanges(manifest.checkpoint);
  if (observed.kind !== "page") throw Error("feed unsupported");
  expect(observed.page.groups).toHaveLength(1);
  const group = observed.page.groups[0]!;
  const staged = new Map(replica);
  for (const change of group.changes) {
    if (change.operation === "tombstone") staged.delete(change.resource.id);
    else staged.set(change.resource.id, change.resource as (typeof beads)[number]);
  }
  for (const record of staged.values())
    for (const inline of Object.values(
      "ownedLinks" in record ? (record.ownedLinks ?? {}) : {},
    ).flat())
      expect(inline).toEqual(staged.get(inline.id));
  const authority = f.owner.inspect().resources as typeof beads;
  expect([...staged].sort()).toEqual([...new Map(authority.map((r) => [r.id, r]))].sort());
  const broken = new Map(staged);
  broken.delete(`${scope}links/a1`);
  expect(() => {
    for (const record of broken.values())
      for (const inline of Object.values(
        "ownedLinks" in record ? (record.ownedLinks ?? {}) : {},
      ).flat())
        if (!isDeepStrictEqual(inline, broken.get(inline.id))) throw Error("owned contradiction");
  }).toThrow("owned contradiction");
  expect(replica.get(`${scope}links/a0`)?.properties.n).toBe(0);
});
it("expiry is fixed, inclusive at the promised instant, reclaims in entry and permanently distinguishes issued from unknown", () => {
  const f = fixture(),
    first = f.owner.captureSnapshot().manifest;
  for (let n = 1; n < 8; n++) f.owner.captureSnapshot();
  expect(problem(() => f.owner.captureSnapshot(), "temporarily-unavailable")).toMatchObject({
    status: 503,
    retry: "after-delay",
    retryAfter: 300,
  });
  f.setTime(1300000);
  expect(f.owner.readSnapshot(handle(first)).manifest).toEqual(first);
  problem(() => f.owner.captureSnapshot(), "temporarily-unavailable");
  f.setTime(1300001);
  const next = f.owner.captureSnapshot();
  expect(next.manifest.expiresAt).toBe(new Date(1600001).toISOString());
  const expired = problem(() => f.owner.readSnapshot(handle(first)), "cursor-expired");
  expect(expired).toMatchObject({ status: 410, retry: "after-state-change" });
  expect(expired).not.toHaveProperty("retryAfter");
  const unknown = problem(() => f.owner.readSnapshot(randomUUID()), "resource-not-found");
  expect(unknown).toMatchObject({ status: 404, retry: "after-state-change" });
  expect(unknown).not.toHaveProperty("retryAfter");
  f.reopen();
  problem(() => f.owner.readSnapshot(handle(first)), "cursor-expired");
  f.setTime(1000000);
  problem(() => f.owner.readSnapshot(handle(first)), "cursor-expired");
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(9);
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_pages").get()?.n).toBe(2);
  });
});
it.each(["after-snapshot-copy", "after-snapshot-commit"] as const)(
  "%s preserves the appropriate durable disposition without graph effects",
  (stage) => {
    let fail = true;
    const f = fixture((at) => {
      if (fail && at === stage) throw Error("delivery fault");
    });
    f.run([create("a")]);
    expect(() => f.owner.captureSnapshot()).toThrow("delivery fault");
    fail = false;
    f.reopen();
    f.offline((db) => {
      expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(
        stage === "after-snapshot-copy" ? 0 : 1,
      );
      expect(db.prepare("SELECT count(*) AS n FROM resources").get()?.n).toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM groups").get()?.n).toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM receipts").get()?.n).toBe(1);
    });
    expect(f.owner.captureSnapshot().manifest.beads.items).toHaveLength(1);
  },
);
it.each([
  "missing-record",
  "changed-record",
  "oversized-record",
  "missing-range",
  "wrong-kind",
  "wrong-context",
  "wrong-anchor",
  "wrong-expiry",
])("refuses retained corruption: %s rather than rebuilding current graph", (variant) => {
  const f = fixture();
  f.run([create("a"), create("b"), edge("e")]);
  const saved = f.owner.captureSnapshot().manifest,
    id = handle(saved);
  f.offline((db) => {
    if (variant === "missing-record")
      db.prepare("DELETE FROM snapshot_records WHERE snapshot=? AND kind='link'").run(id);
    if (variant === "changed-record")
      db.prepare(
        "UPDATE snapshot_records SET body=replace(body,'0.30000000000000004','0.30000000000000005') WHERE snapshot=? AND kind='bead'",
      ).run(id);
    if (variant === "oversized-record")
      db.prepare("UPDATE snapshot_records SET body=? WHERE snapshot=? AND kind='link'").run(
        "x".repeat(262145),
        id,
      );
    if (variant === "missing-range")
      db.prepare("DELETE FROM snapshot_pages WHERE snapshot=? AND kind='link'").run(id);
    if (variant === "wrong-kind")
      db.prepare("UPDATE snapshot_records SET kind='other' WHERE snapshot=? AND kind='link'").run(
        id,
      );
    if (variant === "wrong-context")
      db.prepare(
        "UPDATE snapshots SET disposition=json_set(disposition,'$.view','other') WHERE id=?",
      ).run(id);
    if (variant === "wrong-anchor")
      db.prepare(
        "UPDATE snapshots SET disposition=json_set(disposition,'$.position',999) WHERE id=?",
      ).run(id);
    if (variant === "wrong-expiry")
      db.prepare(
        "UPDATE snapshots SET disposition=json_set(disposition,'$.expires',1400000) WHERE id=?",
      ).run(id);
    // Reseal semantic corruptions so these controls reach the context, anchor
    // and fixed-lifetime checks rather than only the byte commitment.
    if (["wrong-context", "wrong-anchor", "wrong-expiry"].includes(variant)) {
      const { binding: _binding, ...unsigned } = JSON.parse(
        String(db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(id)?.disposition),
      );
      db.prepare("UPDATE snapshots SET disposition=? WHERE id=?").run(
        stringifyJsonValue({
          ...unsigned,
          binding: createHash("sha256")
            .update(stringifyJsonValue([id, unsigned]))
            .digest("hex"),
        }),
        id,
      );
    }
  });
  expect(() => f.owner.readSnapshot(id)).toThrow(/Snapshot integrity/);
});
it("page token is bound through its Snapshot and stream and cannot be borrowed", () => {
  const f = fixture();
  f.run(Array.from({ length: 32 }, (_, n) => create(`b${n}`)));
  f.run([create("more")]);
  const first = f.owner.captureSnapshot().manifest,
    second = f.owner.captureSnapshot().manifest;
  const token = new URL(first.beads.next!).searchParams.get("page")!;
  expect(f.owner.readSnapshotPage(handle(first), "bead", token).page.items).toHaveLength(1);
  problem(() => f.owner.readSnapshotPage(handle(second), "bead", token), "resource-not-found");
  problem(() => f.owner.readSnapshotPage(handle(first), "link", token), "resource-not-found");
});
it("refuses missing owned or endpoint data before issuing a capture", () => {
  const f = fixture();
  f.run([create("a"), create("b"), edge("e")]);
  f.offline((db) => {
    db.prepare("DELETE FROM resources WHERE id='links/e'").run();
  });
  expect(() => f.owner.captureSnapshot()).toThrow("owned inventory mismatch");
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(0);
  });
});
it("refuses prior format before maintenance and preserves actual file bytes; changed current configuration is also refused", () => {
  const f = fixture();
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  const config = JSON.parse(
    String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
  );
  config.format = "bdp-private-transaction-contracts-8";
  delete config.snapshotLimits;
  delete config.snapshotTokenPolicy;
  delete config.authorizationView;
  db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
    stringifyJsonValue(config),
  );
  db.exec("DROP TABLE snapshots; DROP TABLE snapshot_records; DROP TABLE snapshot_pages");
  db.close();
  const before = readFileSync(f.options.file);
  expect(() =>
    openTransactionStore({
      ...f.options,
      create: false,
      fault() {
        throw Error("maintenance should not run");
      },
    }),
  ).toThrow("installation mismatch");
  expect(readFileSync(f.options.file)).toEqual(before);
  const second = fixture();
  second.owner.close();
  const changed = new DatabaseSync(second.options.file);
  changed
    .prepare(
      "UPDATE metadata SET value=json_set(value,'$.snapshotLimits.snapshotPageItems',31) WHERE name='configuration'",
    )
    .run();
  changed.close();
  const beforeChanged = readFileSync(second.options.file);
  expect(() => openTransactionStore({ ...second.options, create: false })).toThrow(
    "installation mismatch",
  );
  expect(readFileSync(second.options.file)).toEqual(beforeChanged);
});
it("checks total authority count and byte bounds before loading malformed bodies", () => {
  const f = fixture();
  f.offline((db) => {
    db.exec("BEGIN");
    const insert = db.prepare("INSERT INTO resources VALUES(?,?,'bead',NULL,NULL)");
    for (let n = 0; n < 4097; n++) insert.run(`beads/${n}`, "bad");
    db.exec("COMMIT");
  });
  problem(() => f.owner.captureSnapshot(), "limit-exceeded");
  f.offline((db) => {
    db.exec("DELETE FROM resources");
    db.prepare("INSERT INTO resources VALUES('beads/a',?,'bead',NULL,NULL)").run(
      "x".repeat(limits.recordBytes + 1),
    );
  });
  problem(() => f.owner.captureSnapshot(), "limit-exceeded");
});
it.each(["before", "after"] as const)(
  "fences uncertain %s-COMMIT, then recovery determines whether a capture was issued",
  (phase) => {
    const f = fixture();
    f.run([create("a")]);
    const actual = DatabaseSync.prototype.exec;
    let armed = true,
      commits = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (armed && sql === "COMMIT" && ++commits === 2) {
        armed = false;
        if (phase === "after") actual.call(this, sql);
        throw Error("uncertain snapshot commit");
      }
      actual.call(this, sql);
    });
    expect(() => f.owner.captureSnapshot()).toThrow("owner fenced");
    spy.mockRestore();
    expect(() => f.owner.captureChangesStart()).toThrow("owner fenced");
    expect(() => f.owner.captureSnapshot()).toThrow("owner fenced");
    f.reopen();
    f.offline((db) => {
      expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(
        phase === "after" ? 1 : 0,
      );
    });
    expect(f.owner.captureChangesStart()).not.toBe("genesis");
  },
);
it("failed Snapshot rollback fences tentative pages until reopen", () => {
  let armed = false;
  const f = fixture((stage) => {
    if (armed && stage === "after-snapshot-copy") throw Error("copy failure");
  });
  const actual = DatabaseSync.prototype.exec;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (armed && sql === "ROLLBACK") throw Error("rollback failure");
    actual.call(this, sql);
  });
  armed = true;
  expect(() => f.owner.captureSnapshot()).toThrow("owner fenced");
  spy.mockRestore();
  armed = false;
  expect(() => f.owner.captureChangesStart()).toThrow("owner fenced");
  f.reopen();
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(0);
  });
});
it("an abrupt exit during capture leaves no issued tentative handle after reopen", async () => {
  const { spawnSync } = await import("node:child_process");
  const f = fixture();
  f.run([create("a")]);
  f.owner.close();
  const module = new URL("../dist/transaction-store.js", import.meta.url).href;
  const script = `import {openTransactionStore} from ${JSON.stringify(module)}; const owner=openTransactionStore({...${JSON.stringify(f.options)},create:false,clock:()=>1000000,fault(stage){if(stage==='after-snapshot-copy')process.exit(79)}});owner.captureSnapshot();process.exit(80)`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 15000,
    encoding: "utf8",
  });
  expect(child.status, child.stderr).toBe(79);
  f.reopen();
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_records").get()?.n).toBe(0);
  });
  expect(f.owner.captureSnapshot().manifest.beads.items).toHaveLength(1);
});
// These offline fixtures exercise actual owner capacities, not protocol mutation
// admission. Every accepted row is a complete schema-valid record at the bound.
function seedRecords(f: ReturnType<typeof fixture>, count: number, recordSize?: number) {
  f.offline((db) => {
    db.exec("BEGIN");
    db.exec("DELETE FROM resources");
    const insert = db.prepare("INSERT INTO resources VALUES(?,?,'bead',NULL,NULL)");
    for (let n = 0; n < count; n++) {
      const id = `beads/${n.toString().padStart(4, "0")}`;
      const record = {
        id: `${scope}${id}`,
        type: beadType,
        revision: `fixture_${n}`,
        properties: { padding: "" },
        metadata: {},
        ownedLinks: { [linkType]: [] },
      };
      if (recordSize !== undefined)
        record.properties.padding = "x".repeat(
          recordSize - Buffer.byteLength(stringifyJsonValue(record)),
        );
      const body = stringifyJsonValue(record);
      if (recordSize !== undefined) expect(Buffer.byteLength(body)).toBe(recordSize);
      insert.run(id, body);
    }
    db.exec("COMMIT");
  });
}
it("accepts the 4096-resource boundary and canonical identity order, refuses one more", () => {
  const f = fixture();
  seedRecords(f, 4096);
  const capture = f.owner.captureSnapshot().manifest;
  const all = collect(f, capture, "bead");
  expect(all).toHaveLength(4096);
  expect(all.map((record) => record.id)).toEqual(
    Array.from({ length: 4096 }, (_, n) => `${scope}beads/${n.toString().padStart(4, "0")}`),
  );
  seedRecords(f, 4097);
  problem(() => f.owner.captureSnapshot(), "limit-exceeded");
}, 15000);
it("actual complete R-sized records bind 32MiB capture, 4MiB pages and 64MiB aggregate before handle count", () => {
  const f = fixture();
  seedRecords(f, 128, 262144);
  const first = f.owner.captureSnapshot().manifest;
  expect(first.beads.items).toHaveLength(15);
  expect(Buffer.byteLength(stringifyJsonValue(first.beads))).toBeLessThanOrEqual(limits.pageBytes);
  const firstToken = new URL(first.beads.next!).searchParams.get("page")!;
  expect(f.owner.readSnapshotPage(handle(first), "bead", firstToken).page.items).toHaveLength(15);
  const second = f.owner.captureSnapshot().manifest;
  expect(second.beads.items).toEqual(first.beads.items);
  problem(() => f.owner.captureSnapshot(), "temporarily-unavailable");
  // Still only two handles: the aggregate byte ceiling is independently active.
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(2);
  });
  seedRecords(f, 129, 262144);
  problem(() => f.owner.captureSnapshot(), "limit-exceeded");
  f.setTime(1300001);
  seedRecords(f, 1, 262144);
  expect(f.owner.captureSnapshot().manifest.beads.items).toHaveLength(1);
}, 30000);
it("permanent 65536 issued-identity bound refuses new issuance even after all detail expired", () => {
  const f = fixture();
  const sample = f.owner.captureSnapshot().manifest;
  f.offline((db) => {
    const disposition = String(
      db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(handle(sample))?.disposition,
    );
    db.exec("BEGIN");
    const insert = db.prepare("INSERT INTO snapshots VALUES(?,?)");
    for (let n = 1; n < limits.issuedHandles; n++) {
      const id = randomUUID();
      const { binding: _binding, ...unsigned } = JSON.parse(disposition);
      insert.run(
        id,
        stringifyJsonValue({
          ...unsigned,
          binding: createHash("sha256")
            .update(stringifyJsonValue([id, unsigned]))
            .digest("hex"),
        }),
      );
    }
    db.exec("COMMIT");
  });
  f.setTime(1300001);
  const prepared: string[] = [];
  const originalPrepare = DatabaseSync.prototype.prepare;
  const prepareSpy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    prepared.push(sql);
    return originalPrepare.call(this, sql);
  });
  try {
    problem(() => f.owner.captureSnapshot(), "limit-exceeded");
    const expirySql = prepared.filter((sql) => !sql.includes(" FROM metadata "));
    expect(new Set(expirySql).size).toBe(expirySql.length);
    // The loop really expired the entire fixture, including its page records;
    // each newly used mutation statement was compiled exactly once.
    for (const sql of [
      "UPDATE snapshots SET disposition=? WHERE id=?",
      "DELETE FROM snapshot_records WHERE snapshot=?",
      "DELETE FROM snapshot_pages WHERE snapshot=?",
    ])
      expect(prepared.filter((query) => query === sql)).toHaveLength(1);
  } finally {
    prepareSpy.mockRestore();
  }
  // Expiry work was paid once. Repeated permanent-cap refusal must not parse
  // the entire retained issuance history to discover that it is full.
  const parse = vi.spyOn(JSON, "parse");
  try {
    problem(() => f.owner.captureSnapshot(), "limit-exceeded");
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(65536);
  });
}, 15000);
it("independent expected inventory rejects coherent omissions and early termination even when individual wire records remain valid", () => {
  const f = fixture();
  f.run(Array.from({ length: 32 }, (_, n) => create(`b${n}`)));
  f.run([create("more")]);
  const manifest = f.owner.captureSnapshot().manifest;
  const expected = Array.from({ length: 32 }, (_, n) => `${scope}beads/b${n}`)
    .concat(`${scope}beads/more`)
    .sort(compareCanonicalIds);
  const verify = (candidate: TransactionSnapshotManifest) =>
    expect(collect(f, candidate, "bead").map((row) => row.id)).toEqual(expected);
  verify(manifest);
  const omitted = {
    ...manifest,
    beads: { ...manifest.beads, items: manifest.beads.items.slice(1) },
  };
  expect(manifestSchema(omitted)).toBe(true);
  expect(() => verify(omitted)).toThrow();
  const premature = { ...manifest, beads: { ...manifest.beads, next: null } };
  expect(manifestSchema(premature)).toBe(true);
  expect(() => verify(premature)).toThrow();
});
it("new private Snapshot entry points do not escape package public exports", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(Object.keys(manifest.exports).sort()).toEqual([
    ".",
    "./development",
    "./reference-configuration",
  ]);
  for (const file of ["index.ts", "development.ts", "reference-deployment.ts"])
    for (const privateModule of ["transaction-snapshot", "json-value-equality"])
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toContain(privateModule);
});
it("retains bounded recognition of issued page tokens after expiry/reopen, while unknown or borrowed continuations stay 404", () => {
  const f = fixture();
  f.run(Array.from({ length: 32 }, (_, n) => create(`b${n}`)));
  f.run([create("more")]);
  const first = f.owner.captureSnapshot().manifest,
    second = f.owner.captureSnapshot().manifest;
  const firstId = handle(first),
    secondId = handle(second);
  const token = new URL(first.beads.next!).searchParams.get("page")!;
  const otherToken = new URL(second.beads.next!).searchParams.get("page")!;
  const unknown = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  for (const run of [
    () => f.owner.readSnapshotPage(firstId, "bead", unknown),
    () => f.owner.readSnapshotPage(firstId, "link", token),
    () => f.owner.readSnapshotPage(secondId, "bead", token),
    () => f.owner.readSnapshotPage(firstId, "bead", otherToken),
  ])
    problem(run, "resource-not-found");
  f.setTime(1300001);
  for (const reopen of [false, true]) {
    if (reopen) f.reopen();
    problem(() => f.owner.readSnapshotPage(firstId, "bead", token), "cursor-expired");
    problem(() => f.owner.readSnapshotPage(secondId, "bead", otherToken), "cursor-expired");
    problem(() => f.owner.readSnapshotPage(firstId, "bead", unknown), "resource-not-found");
    problem(() => f.owner.readSnapshotPage(firstId, "link", token), "resource-not-found");
    problem(() => f.owner.readSnapshotPage(secondId, "bead", token), "resource-not-found");
  }
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_pages").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_records").get()?.n).toBe(0);
    for (const row of db.prepare("SELECT id,disposition FROM snapshots").all())
      expect(
        Buffer.byteLength(String(row.id)) + Buffer.byteLength(String(row.disposition)),
      ).toBeLessThanOrEqual(1024);
    db.prepare("UPDATE snapshots SET disposition=json_set(disposition,'$.seed',?) WHERE id=?").run(
      "0".repeat(64),
      firstId,
    );
  });
  expect(() => f.owner.readSnapshotPage(firstId, "bead", token)).toThrow("disposition commitment");
});
it.each([9, 99])(
  "packs below the byte cap when successor token grows at page %i",
  (transition) => {
    const f = fixture();
    const placeholderId = "00000000-0000-0000-0000-000000000000";
    const framing = (ordinal: number) =>
      Buffer.byteLength(
        stringifyJsonValue({
          items: [],
          next: transactionSnapshotUrl(
            scope,
            placeholderId,
            "bead",
            `sp_${ordinal}_${"a".repeat(43)}`,
          ),
        }),
      );
    expect(framing(transition + 1)).toBe(framing(transition) + 1);
    const prefixCount = transition * limits.snapshotPageItems;
    const finalLargeBytes = limits.pageBytes - framing(transition) - 15 - 15 * 262144;
    expect(finalLargeBytes).toBeGreaterThan(0);
    expect(finalLargeBytes).toBeLessThanOrEqual(262144);
    // Sixteen complete records would fit exactly with the current-page token,
    // but the actually emitted successor URL makes that page one byte too large.
    expect(framing(transition + 1) + 15 * 262144 + finalLargeBytes + 15).toBe(limits.pageBytes + 1);
    const count = prefixCount + 17;
    f.offline((db) => {
      db.exec("BEGIN");
      const insert = db.prepare("INSERT INTO resources VALUES(?,?,'bead',NULL,NULL)");
      for (let n = 0; n < count; n++) {
        const id = `beads/${n.toString().padStart(4, "0")}`;
        const record = {
          id: `${scope}${id}`,
          type: beadType,
          revision: "fixture",
          properties: { padding: "" },
          metadata: {},
          ownedLinks: { [linkType]: [] },
        };
        const targetSize =
          n < prefixCount || n === prefixCount + 16
            ? undefined
            : n === prefixCount + 15
              ? finalLargeBytes
              : 262144;
        if (targetSize !== undefined)
          record.properties.padding = "x".repeat(
            targetSize - Buffer.byteLength(stringifyJsonValue(record)),
          );
        const body = stringifyJsonValue(record);
        if (targetSize !== undefined) expect(Buffer.byteLength(body)).toBe(targetSize);
        insert.run(id, body);
      }
      db.exec("COMMIT");
    });
    const beforePreflight = f.owner.inspect();
    expect(f.owner.observeSnapshot({ kind: "preflight" }).kind).toBe("eligible");
    expect(f.owner.inspect()).toEqual(beforePreflight);
    f.offline((db) => {
      for (const table of ["snapshots", "snapshot_records", "snapshot_pages"])
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    });
    const manifest = f.owner.captureSnapshot().manifest;
    const expected = Array.from(
      { length: count },
      (_, n) => `${scope}beads/${n.toString().padStart(4, "0")}`,
    );
    for (const reopen of [false, true]) {
      if (reopen) f.reopen();
      expect(f.owner.readSnapshot(handle(manifest)).manifest).toEqual(manifest);
      let page = manifest.beads,
        ordinal = 0;
      const observed: string[] = [];
      while (true) {
        expect(Buffer.byteLength(stringifyJsonValue(page))).toBeLessThanOrEqual(limits.pageBytes);
        expect(page.items.length).toBeLessThanOrEqual(limits.snapshotPageItems);
        if (ordinal === transition) {
          expect(page.items).toHaveLength(15);
          expect(new URL(page.next!).searchParams.get("page")).toMatch(
            new RegExp(`^sp_${transition + 1}_`),
          );
        }
        observed.push(...page.items.map((record) => record.id));
        if (page.next === null) break;
        const next = new URL(page.next);
        page = f.owner.readSnapshotPage(
          handle(manifest),
          "bead",
          next.searchParams.get("page")!,
        ).page;
        ordinal++;
      }
      expect(ordinal).toBe(transition + 1);
      expect(observed).toEqual(expected);
    }
  },
  15000,
);

it("shares one validated authority-record pass across owned topology and reuses hot SQL", () => {
  const f = fixture();
  f.run([create("a"), create("b"), edge("e")]);
  const parsed = new Map<string, number>();
  const parse = JSON.parse;
  const parseSpy = vi.spyOn(JSON, "parse").mockImplementation((input, reviver) => {
    const value = parse(input, reviver);
    if (value && typeof value === "object" && "revision" in value && typeof value.id === "string")
      parsed.set(value.id, (parsed.get(value.id) ?? 0) + 1);
    return value;
  });
  const sql: string[] = [];
  const prepare = DatabaseSync.prototype.prepare;
  const sqlSpy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    query: string,
  ) {
    sql.push(query);
    return prepare.call(this, query);
  });
  try {
    const manifest = f.owner.captureSnapshot().manifest;
    const first = manifest.beads.items[0];
    expect(first && "ownedLinks" in first && first.ownedLinks?.[linkType]).toEqual(
      manifest.links.items,
    );
    // One authority decode plus the mandatory retained first-page readback.
    // Topology verification must not decode the same Link a third/fourth time.
    expect(parsed).toEqual(
      new Map([
        [`${scope}beads/a`, 2],
        [`${scope}beads/b`, 2],
        [`${scope}links/e`, 2],
      ]),
    );
    // The surrounding owner metadata helper is outside the Snapshot cache.
    const snapshotSql = sql.filter((query) => !query.includes(" FROM metadata "));
    expect(new Set(snapshotSql).size).toBe(snapshotSql.length);
    expect(sql.some((query) => query.includes("kind='link' AND source=?"))).toBe(false);
  } finally {
    sqlSpy.mockRestore();
    parseSpy.mockRestore();
  }
});

it("orders canonical percent-encoded BMP and supplementary identities with matching owned streams", () => {
  const f = fixture();
  const spellings = ["\u{1F600}", "\uFFFD", "\u{10000}"].map(encodeURIComponent);
  // Canonical HTTP IDs are ASCII URL spellings, not raw UTF-16 identifiers.
  // In particular U+FFFD's %EF sorts before U+10000's %F0 here, unlike decoded JS text.
  const expected = ["%EF%BF%BD", "%F0%90%80%80", "%F0%9F%98%80"];
  f.run(spellings.map((name) => create(name)));
  f.run(spellings.map((name) => edge(name, spellings[0], spellings[1])));
  const manifest = f.owner.captureSnapshot().manifest;
  expect(manifest.beads.items.map((row) => row.id)).toEqual(
    expected.map((id) => `${scope}beads/${id}`),
  );
  expect(manifest.links.items.map((row) => row.id)).toEqual(
    expected.map((id) => `${scope}links/${id}`),
  );
  const owner = manifest.beads.items.find((row) => row.id === `${scope}beads/${spellings[0]}`);
  expect(owner && "ownedLinks" in owner && owner.ownedLinks?.[linkType]).toEqual(
    manifest.links.items,
  );
  expect(manifestSchema(manifest), JSON.stringify(manifestSchema.errors)).toBe(true);
  f.reopen();
  expect(f.owner.readSnapshot(handle(manifest)).manifest).toEqual(manifest);
});

it.each(["different-view", "prior-format-9"])(
  "persists the actual view and refuses %s before retracting a pending claim",
  (fault) => {
    const f = fixture();
    const admission = f.owner.admit(
      "p",
      "pending-view",
      prepareTransactionSetCore(scope, JSON.stringify({ operations: [create("a")] })),
    );
    expect(admission.kind).toBe("owned");
    f.owner.close();
    const db = new DatabaseSync(f.options.file);
    const original = String(
      db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value,
    );
    const config = JSON.parse(original);
    expect(config.initialAuthorizationView).toBe("development-all-visible");
    expect(config.policyStorageRevision).toBe(1);
    const incompatible: Record<string, unknown> = {
      ...config,
      initialAuthorizationView: "different-view",
    };
    if (fault === "prior-format-9") {
      incompatible.format = "bdp-private-transaction-snapshot-9";
      delete incompatible.initialAuthorizationView;
      delete incompatible.policyStorageRevision;
    }
    db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
      JSON.stringify(incompatible),
    );
    db.close();
    const before = readFileSync(f.options.file);
    expect(() => openTransactionStore({ ...f.options, create: false })).toThrow(
      "installation mismatch",
    );
    expect(readFileSync(f.options.file)).toEqual(before);
    const restore = new DatabaseSync(f.options.file);
    expect(
      restore.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
    ).toBe(1);
    restore.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(original);
    restore.close();
    f.reopen();
    expect(f.owner.recoveredPending).toBe(1);
  },
);

it("startup sweep validates the same canonical position as reads and rolls back pending recovery on refusal", () => {
  const f = fixture();
  expect(
    f.owner.admit(
      "p",
      "pending-position",
      prepareTransactionSetCore(scope, JSON.stringify({ operations: [create("a")] })),
    ).kind,
  ).toBe("owned");
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  db.prepare("UPDATE metadata SET value='01' WHERE name='position'").run();
  db.close();
  const before = readFileSync(f.options.file);
  expect(() => openTransactionStore({ ...f.options, create: false })).toThrow(
    "invalid transaction read position",
  );
  expect(readFileSync(f.options.file)).toEqual(before);
  const restore = new DatabaseSync(f.options.file);
  expect(
    restore.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
  ).toBe(1);
  restore.prepare("UPDATE metadata SET value='0' WHERE name='position'").run();
  restore.close();
  f.reopen();
  expect(f.owner.recoveredPending).toBe(1);
});

it("decodes only the bounded live subset when compact expired history grows", () => {
  const f = fixture();
  const sample = f.owner.captureSnapshot().manifest;
  f.offline((db) => {
    const { binding: _binding, ...original } = JSON.parse(
      String(
        db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(handle(sample))?.disposition,
      ),
    );
    const unsigned = { ...original, expired: true };
    db.exec("BEGIN");
    const insert = db.prepare("INSERT INTO snapshots VALUES(?,?)");
    for (let n = 0; n < 1000; n++) {
      const id = randomUUID();
      insert.run(
        id,
        stringifyJsonValue({
          ...unsigned,
          binding: createHash("sha256")
            .update(stringifyJsonValue([id, unsigned]))
            .digest("hex"),
        }),
      );
    }
    db.exec("COMMIT");
  });
  const parse = vi.spyOn(JSON, "parse");
  try {
    f.owner.captureSnapshot();
    // One live retained disposition and the newly retained manifest. None of
    // the thousand detail-free expired rows is decoded into a JS object.
    expect(parse).toHaveBeenCalledTimes(2);
  } finally {
    parse.mockRestore();
  }
});

it.each(["forged-expired", "missing-expired", "nonboolean-expired", "malformed-json"])(
  "refuses %s classification before pending recovery and preserves the file",
  (fault) => {
    const f = fixture();
    f.run([create("a")]);
    const sample = f.owner.captureSnapshot().manifest;
    expect(
      f.owner.admit(
        "p",
        "pending-corruption",
        prepareTransactionSetCore(scope, JSON.stringify({ operations: [create("b")] })),
      ).kind,
    ).toBe("owned");
    f.owner.close();
    const db = new DatabaseSync(f.options.file);
    const original = String(
      db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(handle(sample))?.disposition,
    );
    const d = JSON.parse(original);
    if (fault === "forged-expired") d.expired = true;
    if (fault === "missing-expired") delete d.expired;
    if (fault === "nonboolean-expired") d.expired = 0;
    db.prepare("UPDATE snapshots SET disposition=? WHERE id=?").run(
      fault === "malformed-json" ? "{" : stringifyJsonValue(d),
      handle(sample),
    );
    db.close();
    const before = readFileSync(f.options.file);
    expect(() => openTransactionStore({ ...f.options, create: false })).toThrow();
    expect(readFileSync(f.options.file)).toEqual(before);
    const restore = new DatabaseSync(f.options.file);
    expect(
      restore.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
    ).toBe(1);
    restore.prepare("UPDATE snapshots SET disposition=? WHERE id=?").run(original, handle(sample));
    restore.close();
    f.reopen();
    expect(f.owner.recoveredPending).toBe(1);
    expect(f.owner.readSnapshot(handle(sample)).manifest).toEqual(sample);
  },
);

it("validates a cold expired commitment on lookup without decoding all cold history during capture", () => {
  const f = fixture();
  const sample = f.owner.captureSnapshot().manifest;
  f.setTime(1300001);
  problem(() => f.owner.readSnapshot(handle(sample)), "cursor-expired");
  f.offline((db) => {
    const d = JSON.parse(
      String(
        db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(handle(sample))?.disposition,
      ),
    );
    db.prepare("UPDATE snapshots SET disposition=? WHERE id=?").run(
      stringifyJsonValue({ ...d, binding: "0".repeat(64) }),
      handle(sample),
    );
  });
  // Cold hash corruption is detected on lookup, not eagerly on unrelated capture.
  expect(f.owner.captureSnapshot().manifest.beads.items).toEqual([]);
  expect(() => f.owner.readSnapshot(handle(sample))).toThrow("disposition commitment");
});

it.each(["records", "pages"])(
  "rejects orphaned %s during startup recovery with rollback and no file mutation",
  (detail) => {
    const f = fixture();
    f.run([create("a")]);
    const sample = f.owner.captureSnapshot().manifest;
    expect(
      f.owner.admit(
        "p",
        "orphan-pending",
        prepareTransactionSetCore(scope, JSON.stringify({ operations: [create("b")] })),
      ).kind,
    ).toBe("owned");
    f.owner.close();
    const db = new DatabaseSync(f.options.file);
    db.prepare("DELETE FROM snapshots WHERE id=?").run(handle(sample));
    db.exec(detail === "records" ? "DELETE FROM snapshot_pages" : "DELETE FROM snapshot_records");
    db.close();
    const before = readFileSync(f.options.file);
    expect(() => openTransactionStore({ ...f.options, create: false })).toThrow(
      "orphaned or expired detail",
    );
    expect(readFileSync(f.options.file)).toEqual(before);
    const inspect = new DatabaseSync(f.options.file);
    try {
      expect(
        inspect.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
      ).toBe(1);
      expect(inspect.prepare(`SELECT count(*) AS n FROM snapshot_${detail}`).get()?.n).toBe(
        detail === "records" ? 1 : 2,
      );
    } finally {
      inspect.close();
    }
  },
);

it("asserts the internal expiry-before-capture precondition instead of ignoring retained expired detail", () => {
  const f = fixture();
  const sample = f.owner.captureSnapshot().manifest;
  const context = {
    scopeEpoch: sample.scopeEpoch,
    authorizationView: sample.authorizationView,
    scopePosition: sample.scopePosition,
  };
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  try {
    // Deliberately bypass the owner only to test its internal helper precondition.
    // Public owner capture runs expiry first with the identical captured instant.
    const support = transactionSnapshotStorage(db, scope, types);
    db.exec("BEGIN");
    expect(() => support.capture(1300001, context)).toThrow(
      "capture requires completed expiry at its instant",
    );
    expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_pages").get()?.n).toBe(2);
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
  f.reopen();
  f.setTime(1300001);
  expect(f.owner.captureSnapshot().manifest.beads.items).toEqual([]);
  problem(() => f.owner.readSnapshot(handle(sample)), "cursor-expired");
});

it("continues to refuse impossible excess live handles as integrity corruption", () => {
  const f = fixture();
  const sample = f.owner.captureSnapshot().manifest;
  f.offline((db) => {
    const { binding: _binding, ...unsigned } = JSON.parse(
      String(
        db.prepare("SELECT disposition FROM snapshots WHERE id=?").get(handle(sample))?.disposition,
      ),
    );
    const insert = db.prepare("INSERT INTO snapshots VALUES(?,?)");
    for (let n = 0; n < limits.liveHandles; n++) {
      const id = randomUUID();
      insert.run(
        id,
        stringifyJsonValue({
          ...unsigned,
          binding: createHash("sha256")
            .update(stringifyJsonValue([id, unsigned]))
            .digest("hex"),
        }),
      );
    }
  });
  expect(() => f.owner.captureSnapshot()).toThrow("live issuance ledger exceeds bound");
});

it("pairs expected preflight and retained failures inside the same entry after atomic rollback", () => {
  const f = fixture();
  f.run([create("a")]);
  for (let n = 0; n < limits.liveHandles; n++) f.owner.captureSnapshot();
  const actual = DatabaseSync.prototype.exec;
  let rollback = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql === "ROLLBACK") {
      rollback++;
      expect(() => f.owner.inspect()).toThrow("reentrant");
    }
    return actual.call(this, sql);
  });
  try {
    expect(f.owner.observeSnapshot({ kind: "preflight" })).toMatchObject({
      kind: "problem",
      code: "temporarily-unavailable",
      retryAfter: 300,
      context: { scopePosition: "pos-1" },
    });
    expect(rollback).toBe(1);
    expect(f.owner.observeSnapshot({ kind: "manifest", id: "unknown" })).toMatchObject({
      kind: "problem",
      code: "resource-not-found",
      context: { scopePosition: "pos-1" },
    });
    expect(
      f.owner.observeSnapshot({ kind: "page", id: "unknown", stream: "bead", token: "unknown" }),
    ).toMatchObject({
      kind: "problem",
      code: "resource-not-found",
      context: { scopePosition: "pos-1" },
    });
  } finally {
    spy.mockRestore();
  }
});

it.each(["after-snapshot-copy", "after-snapshot-commit"] as const)(
  "paired observation preserves unexpected %s failure and its committed disposition",
  (stage) => {
    let armed = true;
    const f = fixture((point) => {
      if (armed && point === stage) {
        armed = false;
        throw new Error("delivery fault");
      }
    });
    expect(() => f.owner.observeSnapshot({ kind: "create" })).toThrow("delivery fault");
    f.offline((db) => {
      expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(
        stage === "after-snapshot-commit" ? 1 : 0,
      );
    });
  },
);

it("checks each fresh Snapshot minimum before any handle, record, page or expiry work", () => {
  const f = fixture();
  f.run([create("a")]);
  const context = f.owner.observeSnapshot({ kind: "preflight" }).context;
  const minimum = { ...context, minimumPosition: "pos-2" };
  const tuple = {
    scopeEpoch: minimum.scopeEpoch,
    authorizationView: minimum.authorizationView,
    minimumPosition: minimum.minimumPosition,
  };
  for (const kind of ["create", "preflight"] as const) {
    for (let attempt = 0; attempt < 12; attempt++)
      expect(() => f.owner.observeSnapshot({ kind }, tuple)).toThrow("behind");
    expect(() => f.owner.observeSnapshot({ kind }, { ...tuple, scopeEpoch: "foreign" })).toThrow(
      "cursor-expired",
    );
    expect(() =>
      f.owner.observeSnapshot({ kind }, { ...tuple, authorizationView: "foreign" }),
    ).toThrow("foreign-view");
    let unknown: unknown;
    try {
      f.owner.observeSnapshot({ kind }, { ...tuple, minimumPosition: "unknown" });
    } catch (error) {
      unknown = error;
    }
    expect(unknown).toBeInstanceOf(TransactionMinimumUnproved);
    expect(unknown).toMatchObject({ context });
  }
  f.offline((db) => {
    for (const table of ["snapshots", "snapshot_records", "snapshot_pages"])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  });
  const captured = f.owner.observeSnapshot(
    { kind: "create" },
    { ...tuple, minimumPosition: "pos-1" },
  );
  expect(captured).toMatchObject({ kind: "manifest", context });
  if (captured.kind !== "manifest") throw new Error("expected manifest");
  expect(captured.body.beads.items.map((row) => row.id)).toEqual([`${scope}beads/a`]);
  for (const request of [
    { kind: "manifest", id: handle(captured.body) },
    { kind: "page", id: handle(captured.body), stream: "bead", token: "unknown" },
  ] as const)
    expect(() => f.owner.observeSnapshot(request, tuple)).toThrow("requires fresh creation");
  expect(f.owner.observeSnapshot({ kind: "manifest", id: handle(captured.body) })).toMatchObject({
    kind: "manifest",
    body: captured.body,
    context,
  });
});

it("does not expire retained Snapshot details on an ineligible fresh attempt", () => {
  const f = fixture();
  f.run([create("a")]);
  const first = f.owner.observeSnapshot({ kind: "create" });
  if (first.kind !== "manifest") throw new Error("expected manifest");
  f.setTime(1000000 + limits.lifetimeMs + 1);
  const minimum = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "pos-2",
  };
  for (const kind of ["create", "preflight"] as const)
    expect(() => f.owner.observeSnapshot({ kind }, minimum)).toThrow("behind");
  f.offline((db) => {
    expect(db.prepare("SELECT count(*) AS n FROM snapshot_records").get()?.n).toBe(1);
    expect(
      JSON.parse(String(db.prepare("SELECT disposition FROM snapshots").get()?.disposition))
        .expired,
    ).toBe(false);
  });
});

// Compare the complete admitted JSON graph without recursive matcher diagnostics.
function assertDeepSnapshotValue(actual: unknown, expected: unknown) {
  const pending: [unknown, unknown][] = [[actual, expected]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
      throw new Error("deep Snapshot primitive mismatch");
    expect(Array.isArray(a)).toBe(Array.isArray(b));
    const ak = Object.keys(a),
      bk = Object.keys(b);
    expect(ak.sort()).toEqual(bk.sort());
    for (const key of ak)
      pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
  }
}
async function deepSnapshotWitness(emitted: boolean, corrupt: boolean) {
  const started = performance.now();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-deep-"));
  const errors: unknown[] = [];
  let owner: ReturnType<typeof openTransactionStore> | undefined;
  try {
    const open = emitted
      ? (
          (await import(
            new URL("../dist/transaction-store.js", import.meta.url).href
          )) as typeof import("./transaction-store.js")
        ).openTransactionStore
      : openTransactionStore;
    const prepare = emitted
      ? (
          (await import(
            new URL("../dist/transaction-batch.js", import.meta.url).href
          )) as typeof import("./transaction-batch.js")
        ).prepareTransactionSetCore
      : prepareTransactionSetCore;
    const options = {
      file: path.join(directory, "store.sqlite"),
      scope,
      types,
      create: true,
      clock: () => 1000000,
    };
    owner = open(options);
    const deep = "[".repeat(12000) + "1" + "]".repeat(12000);
    const body = `{"operations":[${JSON.stringify(create("a"))},${JSON.stringify(create("b"))},{"operation":"createLink","id":"links/deep","type":"${linkType}","source":"beads/a","target":"beads/b","properties":{"deep":${deep}}}]}`;
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(65536);
    const admitted = owner.admit("p", "deep-snapshot", prepare(scope, body));
    if (admitted.kind !== "owned") throw new Error("deep Snapshot admission");
    const receipt = owner.execute(admitted.claim);
    expect(receipt.status).toBe("completed");
    const entries = receipt.results as { resource: Record<string, unknown> }[];
    const link = entries[2]!.resource;
    const expectedLink = JSON.parse(
      `{"id":"${scope}links/deep","type":"${linkType}","revision":${JSON.stringify(link.revision)},"source":"${scope}beads/a","target":"${scope}beads/b","properties":{"deep":${deep}},"metadata":{}}`,
    );
    assertDeepSnapshotValue(link, expectedLink);
    if (corrupt) {
      owner.close();
      owner = undefined;
      const db = new DatabaseSync(options.file);
      try {
        const row = db.prepare("SELECT body FROM resources WHERE id=?").get("beads/a");
        const value = JSON.parse(String(row?.body));
        const inline = value.ownedLinks[linkType][0];
        let cursor = inline.properties.deep;
        for (let n = 1; n < 12000; n++) cursor = cursor[0];
        cursor[0] = 2;
        db.prepare("UPDATE resources SET body=? WHERE id=?").run(
          stringifyJsonValue(value),
          "beads/a",
        );
        expect(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n).toBe(0);
      } finally {
        db.close();
      }
      owner = open({ ...options, create: false });
      expect(() => owner!.captureSnapshot()).toThrow("owned Link differs from first-class record");
      assertDeepSnapshotValue(owner.receipt("p", receipt.id), receipt);
      const storedLink = owner
        .inspect()
        .resources.find((r) => (r as { id: string }).id === `${scope}links/deep`);
      assertDeepSnapshotValue(storedLink, expectedLink);
      owner.close();
      owner = undefined;
      const inspect = new DatabaseSync(options.file);
      try {
        for (const table of ["snapshots", "snapshot_records", "snapshot_pages"])
          expect(inspect.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
      } finally {
        inspect.close();
      }
    } else {
      let captured: ReturnType<typeof owner.captureSnapshot>;
      try {
        captured = owner.captureSnapshot();
      } catch (cause) {
        throw new Error("fresh-depth:snapshot-capture", { cause });
      }
      const manifest = captured.manifest;
      expect(manifestSchema(manifest)).toBe(true);
      expect(manifest.beads.items.length).toBe(2);
      expect(manifest.links.items.length).toBe(1);
      expect(manifest.beads.next).toBeNull();
      expect(manifest.links.next).toBeNull();
      assertDeepSnapshotValue(manifest.links.items[0], expectedLink);
      const first = manifest.beads.items[0]!;
      if (!("ownedLinks" in first)) throw new Error("deep Snapshot owned plane missing");
      assertDeepSnapshotValue(first.ownedLinks?.[linkType], [expectedLink]);
      owner.close();
      owner = undefined;
      owner = open({ ...options, create: false });
      assertDeepSnapshotValue(owner.readSnapshot(handle(manifest)).manifest, manifest);
      assertDeepSnapshotValue(owner.receipt("p", receipt.id), receipt);
    }
    expect(performance.now() - started).toBeLessThan(20000);
  } catch (error) {
    errors.push(error);
  }
  const cleaning = performance.now();
  try {
    owner?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (performance.now() - cleaning >= 5000)
    errors.push(new Error("deep Snapshot cleanup deadline"));
  if (errors.length) throw new AggregateError(errors, "deep Snapshot witness failed");
}
it("captures and reopens deep owned Links without losing JSON value equality", async () => {
  await deepSnapshotWitness(true, false);
}, 30000);
it("rejects deep owned-Link divergence before Snapshot issuance", async () => {
  await deepSnapshotWitness(false, true);
}, 30000);

it("gates fresh Snapshot opaque minima before allocation and expiry", () => {
  const f = fixture();
  f.run([create("a")]);
  let snapshotCalls = 0;
  const observe = (...args: Parameters<typeof f.owner.observeSnapshot>) => {
    snapshotCalls++;
    return f.owner.observeSnapshot(...args);
  };
  const first = observe({ kind: "create" });
  if (first.kind !== "manifest") throw new Error("expected manifest");
  const inventory = (db: DatabaseSync) => ({
    snapshots: Number(db.prepare("SELECT count(*) AS n FROM snapshots").get()?.n),
    records: Number(db.prepare("SELECT count(*) AS n FROM snapshot_records").get()?.n),
    pages: Number(db.prepare("SELECT count(*) AS n FROM snapshot_pages").get()?.n),
    disposition: String(db.prepare("SELECT disposition FROM snapshots").get()?.disposition),
  });
  let baseline: ReturnType<typeof inventory> | undefined;
  let after: ReturnType<typeof inventory> | undefined;
  let offlineInspections = 0;
  f.offline((db) => {
    offlineInspections++;
    baseline = inventory(db);
    expect(baseline).toMatchObject({ snapshots: 1, records: 1, pages: 2 });
    expect(JSON.parse(baseline.disposition).expired).toBe(false);
  });
  f.setTime(1000000 + limits.lifetimeMs + 1);
  const minimum = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "opaque",
  };
  const unproved = (kind: "create" | "preflight", minimumPosition = "opaque") => {
    let failure: unknown;
    try {
      observe({ kind }, { ...minimum, minimumPosition });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TransactionMinimumUnproved);
    expect(failure).toMatchObject({ context: first.context });
  };
  for (const kind of ["create", "preflight"] as const) {
    unproved(kind);
    expect(() => observe({ kind }, { ...minimum, scopeEpoch: "foreign" })).toThrow(
      expect.objectContaining({ reason: "cursor-expired", context: first.context }),
    );
    expect(() => observe({ kind }, { ...minimum, authorizationView: "foreign" })).toThrow(
      expect.objectContaining({ reason: "foreign-view", context: first.context }),
    );
    expect(() => observe({ kind }, { ...minimum, minimumPosition: "pos-2" })).toThrow("behind");
  }
  unproved("create", "pos-01");
  let preEntryExcludedCalls = 0;
  for (const request of [
    { kind: "manifest", id: handle(first.body) },
    { kind: "page", id: handle(first.body), stream: "bead", token: "unused" },
  ] as const) {
    preEntryExcludedCalls++;
    expect(() => observe(request, minimum)).toThrow("unsupported minimum tuple");
    preEntryExcludedCalls++;
    expect(() => observe(request, { ...minimum, minimumPosition: "pos-1" })).toThrow(
      "requires fresh creation",
    );
  }
  // No await: normal background maintenance must not race the advanced clock.
  f.offline((db) => {
    offlineInspections++;
    after = inventory(db);
    expect(after).toEqual(baseline);
    expect(JSON.parse(after.disposition).expired).toBe(false);
  });
  // The final helper reopen may maintain the store after this measured comparison.
  expect(snapshotCalls).toBe(14);
  expect(preEntryExcludedCalls).toBe(4);
  expect(offlineInspections).toBe(2);
  console.log(
    JSON.stringify({
      observation: "fresh-snapshot-opaque-owner",
      snapshotCalls,
      preEntryExcludedCalls,
      offlineInspections,
      baseline,
      after,
    }),
  );
});
