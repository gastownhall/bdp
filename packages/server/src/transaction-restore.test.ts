import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { prepareTransaction } from "./transaction-batch.js";
import { openTransactionStore, type TransactionStoreOptions } from "./transaction-store.js";

const scope = "https://restore.test/s/";
const type = `${scope}types/task`;
const types = [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })];
const clean: (() => void)[] = [];
afterEach(() => {
  for (const fn of clean.splice(0).reverse()) fn();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-native-restore-"));
  const file = path.join(directory, "store.sqlite"),
    backup = path.join(directory, "backup.sqlite");
  const options = { file, scope, types, create: true, clock: () => 1000 };
  let owner = openTransactionStore(options),
    key = 0;
  clean.push(() => {
    try {
      owner.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return {
    directory,
    file,
    backup,
    options,
    get owner() {
      return owner;
    },
    run(operations: unknown[], selectedKey = `key-${key++}`) {
      const request = prepareTransaction(scope, JSON.stringify({ operations }));
      const admitted = owner.admit("principal", selectedKey, request);
      if (admitted.kind !== "owned") throw new Error("new claim required");
      const receipt = owner.execute(admitted.claim);
      expect(receipt.status).toBe("completed");
      return {
        receipt,
        request,
        resource: (
          receipt.results as { resource: { id: string; revision: string; properties: unknown } }[]
        )[0]?.resource,
      };
    },
    create(id = "a") {
      return this.run([
        {
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { value: "original" },
          metadata: {},
        },
      ]);
    },
    update(value: string) {
      return this.run([
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/value", value }],
        },
      ]);
    },
    checkpoint() {
      return owner.captureChangesStart();
    },
    save() {
      owner.close();
      copyFileSync(file, backup);
      owner = openTransactionStore({ ...options, create: false });
    },
    reopen(restore = false, fault?: TransactionStoreOptions["fault"]) {
      owner.close();
      owner = openTransactionStore({
        ...options,
        create: false,
        ...(restore ? { nativeRestore: backup } : {}),
        ...(fault ? { fault } : {}),
      });
    },
    raw(fileToRead = file) {
      owner.close();
      const db = new DatabaseSync(fileToRead);
      try {
        return db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all()
          .map((row) => ({
            table: row.name,
            rows: db.prepare(`SELECT * FROM \"${String(row.name)}\"`).all(),
          }));
      } finally {
        db.close();
      }
    },
    editBackup(sql: string, ...values: string[]) {
      const db = new DatabaseSync(backup);
      try {
        db.prepare(sql).run(...values);
      } finally {
        db.close();
      }
    },
  };
}
function snapshotId(url: string) {
  return new URL(url).searchParams.get("snapshot")!;
}
function seed(f: ReturnType<typeof fixture>) {
  const original = f.create();
  const older = f.owner.captureSnapshot().manifest;
  f.update("backup-state");
  f.save();
  const retained = f.owner.inspect().resources;
  f.update("current-state");
  const allocatedLater = f.create("allocated-later");
  f.run([{ operation: "deleteBead", bead: "beads/allocated-later" }]);
  f.owner.eraseHistoricalVersions([
    { subject: original.resource!.id, revision: original.resource!.revision },
  ]);
  return { original, older, retained, allocatedLater };
}
it("restores native graph while retaining current permanent identities/ledger/original addresses and fencing old capabilities", () => {
  const f = fixture(),
    before = seed(f);
  const oldContext = f.owner.readConfiguration();
  const oldCheckpoint = f.checkpoint();
  const oldReceipt = before.original.receipt;
  const currentSnapshot = f.owner.captureSnapshot().manifest;
  const ledger = f.owner.erasureLedger();
  const identities = f.owner.inspect().identities;
  f.reopen(true);
  const current = f.owner.readConfiguration();
  expect(current.scopeEpoch).not.toBe(oldContext.scopeEpoch);
  expect(current.authorizationView).toBe(oldContext.authorizationView);
  expect(f.owner.inspect().resources).toEqual(before.retained);
  expect(f.owner.inspect().identities).toEqual(identities);
  expect(f.owner.erasureLedger()).toEqual(ledger);
  expect(
    f.owner.readRetainedVersion(before.original.resource!.id, before.original.resource!.revision)
      .kind,
  ).toBe("erased");
  expect(
    f.owner.readRetainedVersion(
      before.allocatedLater.resource!.id,
      before.allocatedLater.resource!.revision,
    ).kind,
  ).toBe("retained");
  const groups = f.owner.inspect().groups as {
    position: string;
    changes: unknown[];
    events: unknown[];
    erasures: unknown[];
    scopeEpoch: string;
  }[];
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({
    position: "pos-1",
    changes: [],
    events: [],
    erasures: ledger,
    scopeEpoch: current.scopeEpoch,
  });
  expect(f.owner.captureSnapshot().manifest.erasures).toEqual(ledger);
  expect(() => f.owner.readChanges(oldCheckpoint)).toThrow("cursor-expired");
  expect(() => f.owner.readSnapshot(snapshotId(currentSnapshot.id))).toThrow("cursor-expired");
  expect(() => f.owner.readSnapshot(snapshotId(before.older.id))).toThrow("cursor-expired");
  expect(f.owner.receipt("principal", oldReceipt.id)).toBeUndefined();
  const oldKey = f.owner.admit("principal", oldReceipt.idempotencyKey, before.original.request);
  expect(oldKey.kind).toBe("owned");
  // A new namespace does not permit reusing an already permanent Bead identity.
  if (oldKey.kind !== "owned") throw new Error("fresh key required");
  expect(f.owner.execute(oldKey.claim)).toMatchObject({ status: "failed" });
  f.update("after-restore");
  expect(f.owner.inspect().position).toBe("2");
  const epoch = current.scopeEpoch;
  f.reopen();
  expect(f.owner.readConfiguration().scopeEpoch).toBe(epoch);
  expect(() => f.owner.readSnapshot(snapshotId(currentSnapshot.id))).toThrow("cursor-expired");
});
it("does not restore backup permissions over the current empty grant", () => {
  const f = fixture();
  seed(f);
  f.owner.replaceAuthorizationPolicy();
  const grant = f.owner.readConfiguration().authorization;
  f.reopen(true);
  expect(f.owner.readConfiguration().authorization).toEqual(grant);
  expect(f.owner.erasureLedger()).toEqual([]);
  expect(f.owner.captureSnapshot().manifest.erasures).toEqual([]);
  const page = f.owner.readChanges("genesis");
  expect(page.kind).toBe("page");
  if (page.kind !== "page") throw new Error("page required");
  expect(JSON.stringify(page.page)).not.toContain("beads/a");
});
for (const corrupt of ["capture", "address", "erased-live", "unknown-identity"] as const)
  it(`atomically refuses ${corrupt} backup without changing the destination`, () => {
    const f = fixture();
    if (corrupt === "erased-live") {
      const first = f.create();
      f.save();
      f.update("later");
      f.owner.eraseHistoricalVersions([
        { subject: first.resource!.id, revision: first.resource!.revision },
      ]);
    } else seed(f);
    if (corrupt === "capture")
      f.editBackup("UPDATE metadata SET value=? WHERE name='contractCapture'", "corrupt");
    if (corrupt === "unknown-identity")
      f.editBackup("INSERT INTO identities VALUES(?)", "beads/unknown");
    if (corrupt === "address")
      f.editBackup(
        "UPDATE retained_versions SET body=json_set(body,'$.properties.value','tampered') WHERE revision=(SELECT json_extract(body,'$.revision') FROM resources WHERE id='beads/a')",
      );
    const before = f.raw();
    expect(() => f.reopen(true)).toThrow(/capture|address|erased LIVE|identity/);
    expect(f.raw()).toEqual(before);
  });
it("requires an existing distinct offline anchor, not new provisioning or an active owner", () => {
  const f = fixture();
  f.create();
  f.save();
  expect(() => openTransactionStore({ ...f.options, nativeRestore: f.backup })).toThrow(
    "existing permanent anchor",
  );
  expect(() =>
    openTransactionStore({ ...f.options, create: false, nativeRestore: f.backup }),
  ).toThrow();
  f.owner.close();
  expect(() =>
    openTransactionStore({ ...f.options, create: false, nativeRestore: f.file }),
  ).toThrow("distinct native file");
});
for (const stage of ["before-restore-commit", "after-restore-commit"] as const)
  it(`recovers an abrupt native restore at ${stage}`, () => {
    const f = fixture();
    const seeded = seed(f);
    const oldEpoch = f.owner.readConfiguration().scopeEpoch;
    const before = f.owner.inspect();
    f.owner.close();
    const result = spawnSync(
      process.execPath,
      [
        new URL("../test-support/native-restore-crash.mjs", import.meta.url).pathname,
        f.file,
        f.backup,
        stage,
      ],
      { encoding: "utf8", timeout: 10000, maxBuffer: 65536 },
    );
    console.log(
      "NATIVE_RESTORE_CRASH " +
        JSON.stringify({
          stage,
          status: result.status,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
    );
    expect(result.status).toBe(79);
    f.reopen();
    if (stage === "before-restore-commit") {
      expect(f.owner.inspect()).toEqual(before);
      expect(f.owner.readConfiguration().scopeEpoch).toBe(oldEpoch);
    } else {
      expect(f.owner.inspect().resources).toEqual(seeded.retained);
      expect(f.owner.readConfiguration().scopeEpoch).not.toBe(oldEpoch);
      expect(f.owner.inspect().position).toBe("1");
    }
  });
