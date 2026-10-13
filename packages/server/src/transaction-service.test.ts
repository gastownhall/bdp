import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTypeDescriptor, type AbsoluteHttpUrl } from "@bdp/protocol";
import { prepareTransaction, prepareTransactionSequence } from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import type { TransactionSubmission } from "./transaction-submission.js";

const scope = "https://example.test/service/",
  bead = "https://example.test/bead";
const types = [parseTypeDescriptor({ id: bead, name: "Bead", describes: "bead", conformsTo: [] })];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const create = (id = "a") => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: bead,
  properties: { title: id },
});
function batch(operations: unknown[] = [create()], key = "key"): TransactionSubmission {
  return {
    carrier: { kind: "batch" },
    body: JSON.stringify({ operations }),
    key,
    authorization: { kind: "authorized", principal: "p" },
    receiving: { acceptsJson: true, maximumOperations: 32 },
  };
}
function sequence(members = [create("a"), create("b")]) {
  return prepareTransactionSequence(
    scope,
    JSON.stringify({
      operations: members.map((member, i) => ({ ...member, idempotencyKey: `key_${i}` })),
    }),
  );
}
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-service-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let time = 1000;
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    create: true,
    types,
    clock: () => time,
    ...extra,
  };
  let owner = openTransactionStore(options);
  cleanup.push(() => owner.close());
  let token = 0;
  const read: TransactionServiceOptions["read"] = {
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
      clock: () => time,
      generateOpaqueToken: () => `cursor_${++token}`,
    },
  };
  return {
    get owner() {
      return owner;
    },
    options,
    read,
    setTime(value: number) {
      time = value;
    },
    open(patch: Partial<TransactionServiceOptions> = {}) {
      const service = createTransactionService(owner, { ownerLifetime: "service", read, ...patch });
      cleanup.push(() => service.close());
      return service;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
      return owner;
    },
  };
}
function owned(owner: ReturnType<typeof openTransactionStore>, request = batch()) {
  const admission = owner.admit("p", request.key, prepareTransaction(scope, request.body));
  if (admission.kind !== "owned") throw new Error("expected owner");
  return admission.claim;
}
function manualScheduler() {
  const callbacks: (() => void)[] = [];
  return {
    callbacks,
    turn(callback: () => void) {
      callbacks.push(callback);
      return () => {
        const i = callbacks.indexOf(callback);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    async tick() {
      const callback = callbacks.shift();
      if (!callback) throw new Error("missing scheduled turn");
      callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}
const access = { kind: "authenticated", principal: "p" } as const;
function requireReceipt(
  result: ReturnType<ReturnType<typeof createTransactionService>["receipt"]>,
) {
  if (result.kind !== "receipt") throw new Error("expected receipt");
  return result;
}

describe("private same-owner Transactional service", () => {
  it("requires explicit owner lifetime and a bound that fits retained inline receipts", () => {
    const f = fixture();
    expect(() =>
      createTransactionService(f.owner, { ownerLifetime: "caller" as "service", read: f.read }),
    ).toThrow("explicit service owner lifetime");
    expect(() =>
      createTransactionService(f.owner, {
        ownerLifetime: "service",
        read: {
          ...f.read,
          advertisedLimits: {
            ...f.read.advertisedLimits,
            page: { defaultItems: 2, maximumItems: 31 },
          },
        },
      }),
    ).toThrow("page.maximumItems");
    // Failed construction does not take ownership.
    expect(f.owner.inspect().resources).toEqual([]);
  });
  it("shares singleton, batch and sequence keys and serves actual canonical afterstate", async () => {
    const f = fixture(),
      service = f.open();
    const first = await service.submit(batch([create()], "key_0"));
    expect(first).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed", requiredPosition: "pos-1", next: null },
      context: { scopePosition: "pos-1" },
    });
    const { operation: _operation, ...body } = create();
    expect(
      await service.submit({
        ...batch([], "key_0"),
        carrier: { kind: "singleton", operation: "createBead" },
        body: JSON.stringify(body),
      }),
    ).toEqual(first);
    expect(await service.sequence("p", sequence([create()]))).toMatchObject({
      results: [{ outcome: "created", resource: { id: `${scope}beads/a` } }],
    });
    const read = await service
      .readFor({ kind: "anonymous" })
      .perform({ kind: "resource", resource: "bead", id: `${scope}beads/a` as AbsoluteHttpUrl });
    expect(read).toMatchObject({
      kind: "success",
      body: { id: `${scope}beads/a`, properties: { title: "a" } },
      observation: { sourceContext: { scopePosition: "pos-1" } },
    });
    expect(f.owner.inspect().groups).toHaveLength(1);
  });
  it("retains execution facts while observing a newer head, even after the postimage is deleted", async () => {
    const f = fixture(),
      service = f.open();
    const first = await service.submit(batch());
    if (first.kind !== "receipt") throw new Error("expected receipt");
    await service.submit(batch([{ operation: "deleteBead", bead: "beads/a" }], "delete"));
    const observed = requireReceipt(service.receipt(access, first.receipt.id));
    expect(observed.receipt).toEqual(first.receipt);
    expect(observed.context.scopePosition).toBe("pos-2");
    expect(observed.receipt.requiredPosition).toBe("pos-1");
    expect(observed.receipt.results).toMatchObject([{ resource: { properties: { title: "a" } } }]);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed.context)).toBe(true);
    expect(Object.isFrozen(observed.receipt.results)).toBe(true);
    expect(
      Object.isFrozen(
        (observed.receipt.results as { resource: { properties: object } }[])[0]?.resource
          .properties,
      ),
    ).toBe(true);
    expect(await service.submit(batch())).toEqual(observed);
  });
  it("authenticates before lookup and uniformly hides other principals, roots and unknown URLs", async () => {
    const f = fixture(),
      service = f.open();
    const first = await service.submit(batch());
    if (first.kind !== "receipt") throw new Error("expected receipt");
    expect(service.receipt({ kind: "unauthenticated" }, first.receipt.id)).toEqual({
      kind: "refused",
      status: 401,
      code: "unauthenticated",
    });
    const hidden = { kind: "refused", status: 404, code: "resource-not-found" };
    expect(
      service.receipt({ kind: "authenticated", principal: "other" }, first.receipt.id),
    ).toEqual(hidden);
    expect(service.receipt(access, `${scope}receipts/unknown`)).toEqual(hidden);
    expect(service.receipt(access, `${scope}receipts/`)).toEqual(hidden);
    expect(() =>
      service.receipt({ kind: "authenticated", principal: "" }, first.receipt.id),
    ).toThrow("invalid trusted principal");
    expect(service.receipt(access, first.receipt.id)).toMatchObject({ kind: "receipt" });
  });
  it("freezes receipt bytes and context before a later caller can commit", async () => {
    const f = fixture(),
      service = f.open();
    const first = await service.submit(batch());
    if (first.kind !== "receipt") throw new Error("expected receipt");
    const before = service.receipt(access, first.receipt.id);
    await service.submit(batch([create("b")], "second"));
    expect(before).toMatchObject({ context: { scopePosition: "pos-1" } });
    expect(service.receipt(access, first.receipt.id)).toMatchObject({
      context: { scopePosition: "pos-2" },
    });
  });
  it("retains completed identity, forgets expired failed detail and preserves current observation across reopen", async () => {
    const f = fixture(),
      service = f.open();
    const completed = await service.submit(batch());
    const failed = await service.submit(
      batch([{ operation: "deleteBead", bead: "beads/missing" }], "failed"),
    );
    if (completed.kind !== "receipt" || failed.kind !== "receipt")
      throw new Error("expected receipts");
    expect(failed.receipt.status).toBe("failed");
    f.setTime(86401001);
    const expired = requireReceipt(service.receipt(access, completed.receipt.id));
    expect(expired).toMatchObject({
      receipt: { status: "completed", detail: "expired", allocated: [{ id: `${scope}beads/a` }] },
      context: { scopePosition: "pos-1" },
    });
    expect(service.receipt(access, failed.receipt.id)).toMatchObject({ status: 404 });
    await service.close();
    f.reopen();
    const reopened = f.open();
    expect(reopened.receipt(access, completed.receipt.id)).toEqual(expired);
    expect(await reopened.submit(batch())).toEqual(expired);
    expect(f.owner.inspect().groups).toHaveLength(1);
  });
  it("serves pending duplicates without another execution and retracts abandoned pending on recovery", async () => {
    const f = fixture(),
      claim = owned(f.owner),
      service = f.open();
    expect(await service.submit(batch())).toMatchObject({
      receipt: { id: claim.receipt.id, status: "pending" },
      context: { scopePosition: "pos-0" },
    });
    expect(service.receipt(access, claim.receipt.id)).toMatchObject({
      receipt: { status: "pending" },
    });
    await service.close();
    f.reopen();
    const reopened = f.open();
    expect(reopened.receipt(access, claim.receipt.id)).toMatchObject({ status: 404 });
    const fresh = await reopened.submit(batch());
    expect(fresh).toMatchObject({
      receipt: { status: "completed" },
      context: { scopePosition: "pos-1" },
    });
    if (fresh.kind === "receipt") expect(fresh.receipt.id).not.toBe(claim.receipt.id);
  });
  it("drains detached admitted sequence deliveries before releasing the owner", async () => {
    const f = fixture(),
      scheduler = manualScheduler(),
      service = f.open({ scheduler });
    const result = service.sequence("p", sequence());
    let settled = false;
    const closing = service.close().then(() => {
      settled = true;
    });
    expect(service.close()).toBe(service.close());
    expect(() => service.submit(batch())).toThrow("closing");
    expect(() => service.receipt(access, "unknown")).toThrow("closing");
    await scheduler.tick();
    expect(settled).toBe(false);
    expect(f.owner.inspect().resources).toHaveLength(1);
    await scheduler.tick();
    await closing;
    await expect(result).resolves.toMatchObject({
      results: [{ outcome: "created" }, { outcome: "created" }],
    });
    await expect(service.closed).resolves.toBeUndefined();
    expect(() => f.owner.inspect()).toThrow("closed");
    f.reopen();
    expect(f.owner.inspect().resources).toHaveLength(2);
  });
  it("drains admitted singleton delivery and rejects calls on previously acquired Read facets", async () => {
    const f = fixture(),
      service = f.open(),
      facet = service.readFor({ kind: "anonymous" });
    const pending = service.submit(batch());
    const closing = service.close();
    expect(() =>
      facet.perform({
        kind: "resource",
        resource: "bead",
        id: `${scope}beads/a` as AbsoluteHttpUrl,
      }),
    ).toThrow("closing");
    await expect(pending).resolves.toMatchObject({ receipt: { status: "completed" } });
    await closing;
    f.reopen();
    expect(f.owner.inspect().resources).toHaveLength(1);
  });
  it("releases only its unexecuted sequence tail after scheduler failure and preserves a foreign pending key", async () => {
    const f = fixture(),
      foreign = owned(f.owner, batch([create("foreign")], "foreign"));
    const callbacks: (() => void)[] = [];
    const failure = new Error("scheduler failed");
    let turns = 0;
    const service = f.open({
      scheduler: {
        turn(callback) {
          if (++turns === 2) throw failure;
          callbacks.push(callback);
          return () => {};
        },
      },
    });
    const job = service.sequence("p", sequence());
    callbacks.shift()?.();
    await expect(job).rejects.toBe(failure);
    expect(f.owner.inspect().resources).toHaveLength(1);
    expect(f.owner.receipt("p", foreign.receipt.id)?.status).toBe("pending");
    const retry = await service.submit(batch([create("b")], "key_1"));
    expect(retry).toMatchObject({ receipt: { status: "completed" } });
    expect(f.owner.inspect().groups).toHaveLength(2);
  });
  it("refuses inline scheduling and retains both scheduler and cancellation failure causes", async () => {
    const f = fixture(),
      cancellation = new Error("cancel failed");
    const service = f.open({
      scheduler: {
        turn(callback) {
          callback();
          return () => {
            throw cancellation;
          };
        },
      },
    });
    const error = await service.sequence("p", sequence()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "scheduler invoked callback inline" }),
      cancellation,
    ]);
    expect(f.owner.inspect().resources).toEqual([]);
    expect(await service.submit(batch([create()], "key_0"))).toMatchObject({
      receipt: { status: "completed" },
    });
  });
  it("ignores repeated scheduler callbacks without running a member twice", async () => {
    const f = fixture(),
      scheduler = manualScheduler(),
      service = f.open({ scheduler });
    const job = service.sequence("p", sequence());
    const callback = scheduler.callbacks[0];
    await scheduler.tick();
    callback?.();
    await scheduler.tick();
    await job;
    expect(f.owner.inspect().groups).toHaveLength(2);
  });
  it("uses the original finite comparison budget while an earlier sequence dependency is unresolved", async () => {
    const f = fixture(),
      scheduler = manualScheduler();
    let time = 0,
      waits = 0;
    const service = f.open({
      scheduler,
      comparison: {
        budgetMs: 10,
        now: () => time,
        wait: async () => {
          waits++;
          time += 6;
        },
      },
    });
    const carrier = prepareTransactionSequence(
      scope,
      JSON.stringify({
        operations: [
          { ...create(), name: "a", idempotencyKey: "creator" },
          {
            operation: "updateBead",
            bead: "@a",
            propertiesChange: [{ op: "replace", path: "/title", value: "updated" }],
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    const job = service.sequence("p", carrier);
    const request = batch(
      [
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/title", value: "updated" }],
        },
      ],
      "dependent",
    );
    expect(await service.submit(request)).toEqual({
      kind: "refused",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    expect(waits).toBe(2);
    expect(f.owner.inspect().resources).toEqual([]);
    await scheduler.tick();
    await scheduler.tick();
    await job;
    expect(await service.submit(request)).toMatchObject({
      receipt: { status: "completed" },
      context: { scopePosition: "pos-2" },
    });
    expect(f.owner.inspect().groups).toHaveLength(2);
  });

  it.each(["after-admission", "after-effects", "delivered"] as const)(
    "recovers an abrupt service process exit at %s with original durable disposition",
    async (stage) => {
      const f = fixture();
      f.owner.close();
      const storeUrl = new URL("../dist/transaction-store.js", import.meta.url).href;
      const serviceUrl = new URL("../dist/transaction-service.js", import.meta.url).href;
      const script = `import {writeSync} from 'node:fs'; import {openTransactionStore} from ${JSON.stringify(storeUrl)}; import {createTransactionService} from ${JSON.stringify(serviceUrl)}; const owner=openTransactionStore({...${JSON.stringify(f.options)},create:false,clock:()=>1000,fault(stage){if(stage===${JSON.stringify(stage)})process.exit(79)}}); const read=${JSON.stringify(f.read)};read.pagination.clock=()=>1000;read.pagination.generateOpaqueToken=()=> 'cursor';const service=createTransactionService(owner,{ownerLifetime:'service',read}); const result=await service.submit(${JSON.stringify(batch())});writeSync(1,JSON.stringify(result));process.exit(79);`;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(79);
      f.reopen();
      const service = f.open();
      expect(f.owner.inspect().position).toBe(stage === "delivered" ? "1" : "0");
      const retry = await service.submit(batch());
      expect(retry).toMatchObject({
        receipt: { status: "completed" },
        context: { scopePosition: "pos-1" },
      });
      if (stage === "delivered") expect(retry).toEqual(JSON.parse(child.stdout));
      expect(f.owner.inspect().groups).toHaveLength(1);
    },
  );
  it("preserves original scheduling and failed owner cleanup causes on later service access", async () => {
    const f = fixture(),
      original = new Error("schedule failed"),
      cleanupError = new Error("cancellation BEGIN failed");
    const callbacks: (() => void)[] = [];
    let turns = 0,
      failBegin = false;
    const exec = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (failBegin && sql.startsWith("BEGIN")) {
        failBegin = false;
        throw cleanupError;
      }
      return exec.call(this, sql);
    });
    const service = f.open({
      scheduler: {
        turn(callback) {
          if (++turns === 2) {
            failBegin = true;
            throw original;
          }
          callbacks.push(callback);
          return () => {};
        },
      },
    });
    try {
      const job = service.sequence("p", sequence());
      callbacks.shift()?.();
      const failed = await job.catch((error: unknown) => error);
      const messages = (value: unknown, path = new Set<unknown>()): string[] => {
        if (!(value instanceof Error)) return [];
        expect(path.has(value)).toBe(false);
        const seen = new Set(path).add(value);
        return [
          value.message,
          ...messages(value.cause, seen),
          ...(value instanceof AggregateError
            ? value.errors.flatMap((child) => messages(child, seen))
            : []),
        ];
      };
      expect(messages(failed)).toContain(original.message);
      expect(messages(failed)).toContain(cleanupError.message);
      for (const action of [
        () => service.receipt(access, "unknown"),
        () => service.submit(batch()),
        () => service.sequence("p", sequence()),
        () => service.readFor({ kind: "anonymous" }),
      ]) {
        let error: unknown;
        try {
          action();
        } catch (caught) {
          error = caught;
        }
        expect(messages(error)).toContain(original.message);
        expect(messages(error)).toContain(cleanupError.message);
      }
    } finally {
      spy.mockRestore();
    }
    await service.close();
    f.reopen();
    const reopened = f.open();
    expect(f.owner.inspect().resources).toHaveLength(1);
    expect(await reopened.submit(batch([create("b")], "key_1"))).toMatchObject({
      receipt: { status: "completed" },
    });
    expect(f.owner.inspect().groups).toHaveLength(2);
  });
  it("fits the largest supported receipt in the declared bound without inventing a page", async () => {
    const f = fixture(),
      service = f.open();
    const result = await service.submit(
      batch(Array.from({ length: 32 }, (_, index) => create(`item_${index}`))),
    );
    expect(result).toMatchObject({ receipt: { status: "completed", next: null } });
    if (result.kind !== "receipt") throw new Error("expected receipt");
    expect(result.receipt.results).toHaveLength(32);
    expect(service.receipt(access, result.receipt.id)).toEqual(result);
  });

  it("does not use supplied revision attribution as a receipt access principal", async () => {
    const f = fixture(),
      service = f.open();
    const result = await service.submit(
      batch([
        { ...create(), revisionProvenance: { actor: { id: "other", basis: "writer-supplied" } } },
      ]),
    );
    if (result.kind !== "receipt") throw new Error("expected receipt");
    expect(
      service.receipt({ kind: "authenticated", principal: "other" }, result.receipt.id),
    ).toMatchObject({ kind: "refused", status: 404 });
    expect(service.receipt(access, result.receipt.id)).toEqual(result);
  });
  it("projects sequence retained member facts and current serving context in the owner entry", async () => {
    const f = fixture(),
      scheduler = manualScheduler(),
      service = f.open({ scheduler });
    const job = service.sequenceObserved("p", sequence());
    await scheduler.tick();
    await service.submit(
      batch(
        [
          {
            operation: "updateBead",
            bead: "beads/a",
            propertiesChange: [{ op: "replace", path: "/title", value: "changed" }],
          },
        ],
        "interleave",
      ),
    );
    const closing = service.close();
    await scheduler.tick();
    const result = await job;
    expect(result.context.scopePosition).toBe("pos-3");
    expect(result.body.results).toMatchObject([
      { resource: { properties: { title: "a" } } },
      { resource: { properties: { title: "b" } } },
    ]);
    expect(Object.isFrozen(result.body.results[0])).toBe(true);
    const row = result.body.results[0] as { resource: { properties: object } };
    expect(Object.isFrozen(row.resource.properties)).toBe(true);
    await closing;
    expect(() => service.sequenceObserved("p", sequence())).toThrow("closing");
  });

  it("does not return an observed sequence when the final owner observation fails", async () => {
    const f = fixture(),
      scheduler = manualScheduler();
    const failure = new Error("final context unavailable");
    let failRead = false;
    const prepare = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (failRead && sql === "SELECT value FROM metadata WHERE name=?") throw failure;
      return prepare.call(this, sql);
    });
    const service = f.open({ scheduler });
    const job = service.sequenceObserved("p", sequence([create()]));
    // Actual execution completes first. Its final same-owner observation then
    // encounters a read failure; no guessed context may escape.
    const callback = scheduler.callbacks.shift();
    callback?.();
    await Promise.resolve();
    failRead = true;
    await expect(job).rejects.toBe(failure);
    spy.mockRestore();
    expect(f.owner.inspect().groups).toHaveLength(1);
  });
});
