import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  isReadProblem,
  isJsonSchemaUri,
  isJsonSchemaDateTime,
  parseTypeDescriptor,
} from "@bdp/protocol";
import { Ajv2020 } from "ajv/dist/2020.js";
import { prepareTransaction, prepareTransactionSequence } from "./transaction-batch.js";
import { openTransactionStore, type TransactionStoreOptions } from "./transaction-store.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import {
  INITIAL_TRANSACTION_VIEW,
  projectTransactionReceipt,
} from "./transaction-authorization.js";
import { TRANSACTION_SNAPSHOT_LIMITS } from "./transaction-snapshot.js";
import { requestFromUrl } from "./read-request.js";

const scope = "https://example.test/authorization/";
const type = scope + "types/bead";
const types = [parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] })];
const receiptValidators = (() => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
  ajv.addSchema(schema);
  return {
    receipt: ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` }),
    page: ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceiptPage` }),
  };
})();
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "authorization fixture cleanup");
});
const create = (id: string) => ({
  operation: "createBead",
  id: "beads/" + id,
  type,
  properties: { n: 0 },
});
function fixture(extra: Partial<TransactionStoreOptions> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-authorization-"));
  let now = 1000;
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    types,
    create: true,
    clock: () => now,
    ...extra,
  };
  let owner: ReturnType<typeof openTransactionStore>;
  const rawConnections = new Set<DatabaseSync>();
  cleanup.push(() => {
    const failures: unknown[] = [];
    if (!owner) throw new Error("authorization startup failed; directory retained");
    try {
      owner.close();
    } catch (error) {
      failures.push(error);
    }
    for (const db of rawConnections) {
      try {
        db.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "authorization owner cleanup; directory retained");
    rmSync(directory, { recursive: true, force: true });
  });
  owner = openTransactionStore(options);
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
      return owner;
    },
    execute(operations: unknown[], key: string, principal = "p") {
      const admitted = owner.admit(
        principal,
        key,
        prepareTransaction(scope, JSON.stringify({ operations })),
      );
      if (admitted.kind !== "owned") throw new Error("fixture requires fresh owned admission");
      return owner.execute(admitted.claim);
    },
    raw<T>(run: (db: DatabaseSync) => T): T {
      owner.close();
      const db = new DatabaseSync(options.file);
      rawConnections.add(db);
      try {
        return run(db);
      } finally {
        db.close();
        rawConnections.delete(db);
      }
    },
  };
}
function context(owner: ReturnType<typeof openTransactionStore>) {
  const observed = owner.withRead((_reader, value) => value);
  if (observed.kind !== "read") throw new Error("expected owner observation");
  return observed.value;
}
function readOptions(): TransactionServiceOptions["read"] {
  let token = 0;
  return {
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
      clock: () => 1000,
      generateOpaqueToken: () => "cursor_" + ++token,
    },
  };
}
// Exact old ordered recipe from committed 67a2842 transaction-store.ts:284–297.
// Independent literal: no transformation of the new configuration under test.
const legacyConfiguration =
  '{"format":"bdp-private-transaction-snapshot-10","receiptMaximumItems":32,"snapshotLimits":{"lifetimeMs":300000,"resources":4096,"recordBytes":33554432,"liveHandles":8,"liveRecordBytes":67108864,"issuedHandles":65536,"dispositionBytes":1024,"snapshotPageItems":32,"pageBytes":4194304,"manifestBytes":10485760},"snapshotTokenPolicy":"hmac-sha256-ordinal-1","authorizationView":"development-all-visible","identityPolicy":"transaction-revision-provenance-4","contractIdentity":null,"runtimeLimits":{"maximumOperations":32,"inducedEvents":256,"matchedResources":32,"representationBytes":262144,"scopeSourceBytes":65536,"requestBodyBytes":65536,"propertiesBytes":65536,"diagnosticBytes":524288,"diagnosticCount":16},"scope":"https://example.test/authorization/","types":[["https://example.test/authorization/types/bead","{\\"id\\":\\"https://example.test/authorization/types/bead\\",\\"name\\":\\"Bead\\",\\"describes\\":\\"bead\\",\\"conformsTo\\":[]}"]]}';
function retained(db: DatabaseSync) {
  const tables = [
    "resources",
    "identities",
    "aliases",
    "receipts",
    "receipt_pages",
    "receipt_page_ranges",
    "creator_facts",
    "groups",
    "snapshots",
    "snapshot_pages",
    "snapshot_records",
  ];
  const existing = new Set(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map((r) => String(r.name)),
  );
  return Object.fromEntries(
    tables
      .filter((name) => existing.has(name))
      .map((name) => [name, db.prepare("SELECT * FROM " + name + " ORDER BY rowid").all()]),
  );
}

it("migrates exact legacy authorization facts and preserves a no-op policy across reopen", () => {
  const f = fixture();
  const receipt = f.execute([create("a")], "seed");
  const original = context(f.owner);
  f.owner.captureSnapshot();
  let current = "";
  const before = f.raw((db) => {
    current = String(
      db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value,
    );
    db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(legacyConfiguration);
    db.exec("DELETE FROM metadata WHERE name='authorizationPolicy'");
    return retained(db);
  });
  const rejected = (edit: (db: DatabaseSync) => void, message: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bdp-tx-authorization-rejected-"));
    const file = path.join(dir, "store.sqlite");
    let opened: ReturnType<typeof openTransactionStore> | undefined;
    let db: DatabaseSync | undefined;
    const failures: unknown[] = [];
    try {
      copyFileSync(f.options.file, file);
      db = new DatabaseSync(file);
      edit(db);
      db.close();
      db = undefined;
      expect(() => {
        opened = openTransactionStore({ ...f.options, file, create: false });
      }).toThrow(message);
    } catch (error) {
      failures.push(error);
    }
    const primaryFailureCount = failures.length;
    {
      try {
        opened?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        db?.close();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === primaryFailureCount) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, "rejected-open assertion or cleanup failed");
    }
  };
  rejected(
    (db) =>
      db
        .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
        .run(legacyConfiguration.replace("snapshot-10", "snapshot-9")),
    "installation mismatch",
  );
  rejected(
    (db) =>
      db
        .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
        .run(legacyConfiguration.replace('"receiptMaximumItems":32', '"receiptMaximumItems":31')),
    "installation mismatch",
  );
  f.reopen();
  expect(context(f.owner)).toEqual(original);
  expect(f.owner.receipt("p", receipt.id)).toEqual(receipt);
  const next = f.owner.replaceAuthorizationPolicy();
  expect(next.generation).toBe(1);
  expect(f.owner.replaceAuthorizationPolicy()).toBe(next);
  const after = f.raw((db) => {
    expect(
      String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
    ).toBe(current);
    expect(
      JSON.parse(
        String(
          db.prepare("SELECT value FROM metadata WHERE name='authorizationPolicy'").get()?.value,
        ),
      ),
    ).toEqual(next);
    return retained(db);
  });
  expect(after).toEqual(before);
  rejected(
    (db) => db.exec("DELETE FROM metadata WHERE name='authorizationPolicy'"),
    "authorization policy",
  );
  rejected(
    (db) =>
      db
        .prepare("UPDATE metadata SET value=? WHERE name='authorizationPolicy'")
        .run('{"revision":1}'),
    "authorization policy",
  );
  rejected(
    (db) =>
      db
        .prepare("UPDATE metadata SET value=? WHERE name='authorizationPolicy'")
        .run(JSON.stringify({ ...next, authorizationView: [next.authorizationView] })),
    "authorization policy",
  );
  f.reopen();
  expect(f.owner.authorizationSnapshot()).toEqual(next);
  expect(context(f.owner)).toEqual({ ...original, authorizationView: next.authorizationView });
  expect(f.owner.inspect().position).toBe("1");
});

it("preserves policy and delivery leases after confirmed policy rollback", () => {
  const failure = new Error("before policy commit");
  const f = fixture({
    fault: (phase) => {
      if (phase === "before-policy-commit") throw failure;
    },
  });
  const before = f.owner.authorizationSnapshot();
  const lease = f.owner.acquireAuthorizationLease(context(f.owner));
  try {
    expect(() => f.owner.replaceAuthorizationPolicy()).toThrow(failure);
    expect(f.owner.authorizationSnapshot()).toBe(before);
    expect(lease.signal.aborted).toBe(false);
    expect(f.execute([create("still-authorized")], "after-rollback").status).toBe("completed");
  } finally {
    lease.release();
  }
  f.reopen();
  expect(f.owner.authorizationSnapshot()).toEqual(before);
});

it("fences publication failure and recovers the committed empty policy", () => {
  let fail = true;
  const f = fixture({
    fault: (phase) => {
      if (phase === "after-policy-commit" && fail) throw new Error("after policy commit");
    },
  });
  const receipt = f.execute([create("a")], "seed");
  const before = context(f.owner);
  const lease = f.owner.acquireAuthorizationLease(before);
  expect(() => f.owner.replaceAuthorizationPolicy()).toThrow("owner fenced");
  expect(lease.signal.aborted).toBe(true);
  expect(() => f.owner.authorizationSnapshot()).toThrow("owner fenced");
  fail = false;
  f.reopen();
  const policy = f.owner.authorizationSnapshot();
  expect(policy).toMatchObject({ generation: 1, readPolicy: "empty", canMutate: false });
  expect(context(f.owner)).toEqual({ ...before, authorizationView: policy.authorizationView });
  expect(f.owner.receipt("p", receipt.id)).toEqual({
    ...Object.fromEntries(
      Object.entries(receipt).filter(
        ([key]) => !["results", "next", "allocated", "expiresAt"].includes(key),
      ),
    ),
    detail: "withheld",
  });
  lease.release();
});

it("separates Snapshot view fences from durable maintenance and actual expiry", () => {
  const f = fixture();
  f.execute(
    Array.from({ length: 32 }, (_, n) => create("b" + n)),
    "first",
  );
  f.execute([create("b32")], "second");
  const old = f.owner.captureSnapshot().manifest;
  const id = new URL(old.id).searchParams.get("snapshot");
  const page = old.beads.next && new URL(old.beads.next);
  if (!id || !page) throw new Error("real Snapshot continuation required");
  const token = page.searchParams.get("page");
  if (!token) throw new Error("actual Snapshot token required");
  f.owner.replaceAuthorizationPolicy();
  expect(f.owner.observeSnapshot({ kind: "manifest", id })).toMatchObject({
    kind: "problem",
    code: "foreign-view",
  });
  expect(f.owner.observeSnapshot({ kind: "page", id, stream: "bead", token })).toMatchObject({
    kind: "problem",
    code: "foreign-view",
  });
  expect(
    f.owner.observeSnapshot({ kind: "manifest", id: "00000000-0000-4000-8000-000000000000" }),
  ).toMatchObject({ kind: "problem", code: "resource-not-found" });
  expect(f.owner.observeSnapshot({ kind: "page", id, stream: "bead", token: "bad" })).toMatchObject(
    { kind: "problem", code: "resource-not-found" },
  );
  const empty = f.owner.captureSnapshot().manifest;
  expect(empty.beads.items).toEqual([]);
  expect(empty.links.items).toEqual([]);
  expect(empty.beads.next).toBeNull();
  const emptyId = new URL(empty.id).searchParams.get("snapshot");
  if (!emptyId) throw new Error("empty Snapshot identity required");
  f.setTime(1001 + TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs);
  f.owner.maintain();
  expect(f.owner.observeSnapshot({ kind: "manifest", id: emptyId })).toMatchObject({
    kind: "problem",
    code: "cursor-expired",
  });
  expect(f.owner.inspect().resources).toHaveLength(33);
});

it("projects receipt records and allocations without changing non-record execution facts", () => {
  const f = fixture({ receiptMaximumItems: 2 });
  const mixed = f.execute(
    [create("a"), { operation: "deleteBead", bead: "beads/a" }, create("b")],
    "mixed",
  );
  const failed = f.execute([{ operation: "deleteBead", bead: "beads/missing" }], "failed");
  expect(failed.status).toBe("failed");
  const full = mixed.results;
  if (!Array.isArray(full)) throw new Error("completed full receipt");
  const before = f.owner.readReceipt("p", mixed.id).receipt;
  if (!before || typeof before.next !== "string") throw new Error("real issued receipt page");
  const firstPage = f.owner.readReceiptPage("p", before.next);
  if (firstPage.kind !== "page") throw new Error("issued page unavailable");
  expect(full[2]).toMatchObject({
    operationIndex: 2,
    outcome: "created",
    resource: { id: scope + "beads/b", type },
  });
  expect(firstPage.page.results).toEqual([full[2]]);
  const old = context(f.owner);
  f.owner.replaceAuthorizationPolicy();
  const observed = f.owner.readReceipt("p", mixed.id);
  expect(
    receiptValidators.receipt(observed.receipt),
    JSON.stringify(receiptValidators.receipt.errors),
  ).toBe(true);
  expect(observed.receipt).toEqual({
    ...before,
    results: [{ operationIndex: 0, outcome: "withheld" }, full[1]],
  });
  expect(observed.context).toEqual({
    ...old,
    authorizationView: f.owner.authorizationSnapshot().authorizationView,
  });
  const afterPage = f.owner.readReceiptPage("p", before.next);
  if (afterPage.kind !== "page") throw new Error("projected issued page required");
  expect(
    receiptValidators.page(afterPage.page),
    JSON.stringify(receiptValidators.page.errors),
  ).toBe(true);
  expect(afterPage).toEqual({
    ...firstPage,
    page: {
      ...firstPage.page,
      results: [{ operationIndex: 2, outcome: "withheld" }],
    },
    context: observed.context,
  });
  expect(f.owner.readReceipt("p", failed.id).receipt).toEqual(failed);
  // Exercise real compact allocations after ordinary retention, not fabricated receipts.
  f.setTime(1001 + 86400000);
  const expired = f.owner.readReceipt("p", mixed.id).receipt;
  expect(expired).toEqual({
    ...Object.fromEntries(
      Object.entries(mixed).filter(
        ([key]) => !["results", "next", "allocated", "expiresAt"].includes(key),
      ),
    ),
    detail: "withheld",
  });
  // Pure projection boundaries add no owner, transaction, or HTTP work.
  const emptyAvailable = { ...mixed, results: [] };
  expect(projectTransactionReceipt(emptyAvailable, false)).toEqual(emptyAvailable);
  const emptyExpired = { ...mixed };
  emptyExpired.detail = "expired";
  emptyExpired.allocated = [];
  delete emptyExpired.results;
  delete emptyExpired.next;
  delete emptyExpired.expiresAt;
  expect(projectTransactionReceipt(emptyExpired, false)).toEqual(emptyExpired);
  expect(projectTransactionReceipt(failed, false)).toEqual(failed);
});

it("bounds administrative drain without cancelling admitted sequence work", async () => {
  const f = fixture();
  const callbacks: (() => void)[] = [];
  const scheduler = {
    turn(callback: () => void) {
      callbacks.push(callback);
      return () => {
        const index = callbacks.indexOf(callback);
        if (index >= 0) callbacks.splice(index, 1);
      };
    },
  };
  const service = createTransactionService(f.owner, {
    ownerLifetime: "service",
    read: readOptions(),
    scheduler,
  });
  cleanup.push(() => service.close());
  const sequence = prepareTransactionSequence(
    scope,
    JSON.stringify({
      operations: [create("a"), create("b")].map((op, i) => ({
        ...op,
        idempotencyKey: "member_" + i,
      })),
    }),
  );
  const pending = service.sequenceObserved("p", sequence);
  void pending.catch(() => {});
  const tick = async () => {
    const callback = callbacks.shift();
    if (!callback) throw new Error("scheduled sequence turn required");
    callback();
    await Promise.resolve();
    await Promise.resolve();
  };
  try {
    expect(() => f.owner.replaceAuthorizationPolicy()).toThrow(
      expect.objectContaining({ code: "temporarily-unavailable" }),
    );
    const cancelled = new AbortController();
    const first = service.replaceAuthorizationPolicy({ timeoutMs: 1000, signal: cancelled.signal });
    const observedFirst = first.then(
      () => {
        throw new Error("cancelled publication");
      },
      (error: unknown) => error,
    );
    expect(() =>
      f.owner.admit(
        "p",
        "paused",
        prepareTransaction(scope, JSON.stringify({ operations: [create("paused")] })),
      ),
    ).toThrow(expect.objectContaining({ code: "temporarily-unavailable" }));
    const reason = new Error("administrative cancellation");
    cancelled.abort(reason);
    expect(await observedFirst).toBe(reason);
    expect(f.owner.authorizationSnapshot().generation).toBe(0);
    // Scheduler deliberately delivers no turn during this finite administrative wait.
    await expect(service.replaceAuthorizationPolicy({ timeoutMs: 10 })).rejects.toThrow(
      "authorization drain deadline",
    );
    expect(f.owner.inspect().position).toBe("0");
    expect(f.owner.authorizationSnapshot().generation).toBe(0);
    await tick();
    expect(f.owner.inspect().position).toBe("1");
    const firstMember = sequence.members[0];
    if (!firstMember) throw new Error("first member required");
    const retained = f.owner.admit("p", "member_0", firstMember.request);
    if (retained.kind !== "existing") throw new Error("committed prefix receipt required");
    const publishing = service.replaceAuthorizationPolicy({ timeoutMs: 1000 });
    void publishing.catch(() => {});
    expect(f.owner.authorizationSnapshot().generation).toBe(0);
    await tick();
    const response = await pending;
    expect(response.body.results).toHaveLength(2);
    expect(response.context.authorizationView).toBe(INITIAL_TRANSACTION_VIEW);
    const policy = await publishing;
    expect(policy.generation).toBe(1);
    expect(f.owner.inspect().position).toBe("2");
    expect(f.owner.inspect().groups).toHaveLength(2);
    expect(f.owner.inspect().resources).toHaveLength(2);
    const projected = f.owner.readReceipt("p", retained.receipt.id);
    expect(projected.receipt).toEqual({
      ...Object.fromEntries(
        Object.entries(retained.receipt).filter(
          ([key]) => !["results", "next", "allocated", "expiresAt"].includes(key),
        ),
      ),
      detail: "withheld",
    });
    expect(projected.context.authorizationView).toBe(policy.authorizationView);
    expect(f.owner.readEvents(scope + "events/")).toMatchObject({
      kind: "page",
      page: { events: [], next: null },
    });
  } finally {
    // Deliver every outstanding ordinary turn even if an assertion failed.
    while (callbacks.length) await tick();
    await Promise.allSettled([pending]);
    await service.close();
  }
});

it("captures one Scope policy for distinct principals and renders empty historical advances", async () => {
  const f = fixture();
  const receipt = f.execute([create("a")], "seed", "alice");
  const service = createTransactionService(f.owner, {
    ownerLifetime: "service",
    read: readOptions(),
  });
  cleanup.push(() => service.close());
  const request = requestFromUrl(new URL(scope + "beads/a"), scope);
  if (isReadProblem(request)) throw new Error("valid Resource read required");
  const alice = service.readFor({ kind: "authenticated", principal: { id: "alice" } });
  const bob = service.readFor({ kind: "authenticated", principal: { id: "bob" } });
  const aliceRead = await alice.perform(request);
  const bobRead = await bob.perform(request);
  expect(aliceRead).toMatchObject({ kind: "success" });
  expect(bobRead).toMatchObject({ kind: "success" });
  if (aliceRead.kind !== "success" || bobRead.kind !== "success")
    throw new Error("both principals must read the seeded Resource");
  if (!Array.isArray(receipt.results) || !receipt.results[0]?.resource)
    throw new Error("seed receipt Resource required");
  expect(aliceRead.body).toEqual(receipt.results[0].resource);
  expect(bobRead.body).toEqual(receipt.results[0].resource);
  const readonly = {
    carrier: { kind: "batch" as const },
    body: JSON.stringify({ operations: [create("denied")] }),
    key: "readonly",
    authorization: { kind: "forbidden" as const },
    receiving: { acceptsJson: true, maximumOperations: 32 },
  };
  expect(await service.submit(readonly)).toMatchObject({ kind: "refused", status: 403 });
  const policy = await service.replaceAuthorizationPolicy({ timeoutMs: 1000 });
  for (const facet of [alice, bob]) {
    const result = await facet.perform(request);
    expect(result).toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found" },
      observation: { authorizationView: policy.authorizationView },
    });
  }
  expect(await service.submit(readonly)).toMatchObject({ kind: "refused", status: 403 });
  expect(() =>
    f.owner.admit(
      "alice",
      "seed",
      prepareTransaction(scope, JSON.stringify({ operations: [create("a")] })),
    ),
  ).toThrow(expect.objectContaining({ code: "forbidden" }));
  expect(f.owner.readReceipt("bob", receipt.id).receipt).toBeUndefined();
  expect(f.owner.readReceipt("alice", receipt.id).receipt?.detail).toBe("withheld");
  const page = f.owner.readChanges("genesis");
  if (page.kind !== "page") throw new Error("historical change page required");
  expect(page.page.groups).toEqual([
    {
      scopeEpoch: f.owner.scopeEpoch,
      authorizationView: policy.authorizationView,
      checkpoint: page.page.groups[0]?.checkpoint,
      position: "pos-1",
      previousPosition: "pos-0",
      projectionAdvance: true,
      changes: [],
      erasures: [],
      eventCount: 0,
      events: [],
    },
  ]);
  const checkpoint = page.page.groups[0]?.checkpoint;
  if (typeof checkpoint !== "string" || typeof receipt.transaction !== "string")
    throw new Error("actual checkpoint and seed transaction required");
  expect(checkpoint).not.toBe("genesis");
  expect(checkpoint).not.toContain(receipt.transaction);
  expect(JSON.stringify(page.page.groups)).not.toContain(receipt.transaction);
  expect(f.owner.inspect().resources).toHaveLength(1);
  await service.close();
});
