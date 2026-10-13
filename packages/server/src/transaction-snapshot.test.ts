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
import { prepareTransactionSetCore } from "./transaction-batch.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS as limits,
  TransactionSnapshotFailure,
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
it("a genuine abrupt exit during capture recovers its hot journal without issuing the tentative handle", async () => {
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
  problem(() => f.owner.captureSnapshot(), "limit-exceeded");
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
  expect(Object.keys(manifest.exports).sort()).toEqual([".", "./development"]);
  for (const file of ["index.ts", "development.ts"])
    expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toContain(
      "transaction-snapshot",
    );
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
