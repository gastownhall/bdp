import * as discoveryAssembly from "./transaction-discovery.js";
import { TransactionEventParameterError } from "./transaction-events.js";
import {
  TransactionMinimumFailure,
  TransactionMinimumUnproved,
  type TransactionMinimum,
} from "./transaction-consistency.js";
import { ScopeServerOperationAbortedError, requestFromUrl } from "./read-request.js";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReadProblem,
  parseTypeDescriptor,
  ProtocolArtifactValidationError,
  type AbsoluteHttpUrl,
} from "@bdp/protocol";
import { prepareTransaction, prepareTransactionSequence } from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import { createTransactionHttpHandler } from "./transaction-http.js";
import type { TransactionSnapshotRequest } from "./transaction-snapshot.js";
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
  result:
    | ReturnType<ReturnType<typeof createTransactionService>["receipt"]>
    | Awaited<ReturnType<ReturnType<typeof createTransactionService>["submit"]>>,
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
    ).toThrow("receipt page maximum");
    expect(() =>
      createTransactionService(f.owner, {
        ownerLifetime: "service",
        read: { ...f.read, pagination: { ...f.read.pagination, maxPageItems: 31 } },
      }),
    ).toThrow("receipt page maximum");
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
    const hidden = {
      kind: "refused",
      status: 404,
      code: "resource-not-found",
      context: first.context,
    };
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
    const before = f.owner.withRead((_reader, context) => context);
    if (before.kind !== "read") throw new Error("trusted initial context unavailable");
    expect(before.value.scopePosition).toBe("pos-0");
    const job = service.sequence("p", carrier);
    const settled = job.then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
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
    const failures: unknown[] = [];
    let drained = false,
      closed = false,
      cleanupTurns = 0;
    try {
      expect(
        await service.submit(request),
        "observed service comparison deadline shape",
      ).toStrictEqual({
        kind: "comparison-refusal",
        reason: "deadline",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
        context: {
          scopeEpoch: before.value.scopeEpoch,
          authorizationView: before.value.authorizationView,
          scopePosition: "pos-0",
        },
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
    } catch (error) {
      failures.push(error);
    } finally {
      // At most the two admitted members remain. Release them even if an
      // assertion failed before the first turn, then drain before closing.
      for (let index = 0; index < carrier.members.length; index++) {
        if (scheduler.callbacks.length === 0) break;
        try {
          await scheduler.tick();
          cleanupTurns++;
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        const outcome = await settled;
        drained = true;
        if (outcome.error !== undefined) failures.push(outcome.error);
      } catch (error) {
        failures.push(error);
      }
      try {
        await service.close();
        closed = true;
      } catch (error) {
        failures.push(error);
      }
      console.info(
        JSON.stringify({
          kind: "comparison-service-deadline-cleanup",
          drained,
          closed,
          cleanupTurns,
          pendingCallbacks: scheduler.callbacks.length,
        }),
      );
    }
    if (failures.length)
      throw new AggregateError(failures, "comparison service assertion or cleanup failed");
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

  it("freezes complete deep sequence observations across fresh execution and retained replay", async () => {
    const f = fixture(),
      service = f.open();
    const depth = 12000;
    const deepText = "[".repeat(depth) + "1" + "]".repeat(depth);
    const carrier = prepareTransactionSequence(
      scope,
      '{"operations":[{"operation":"createBead","id":"beads/deep","type":"' +
        bead +
        '","idempotencyKey":"deep-observed","properties":{"deep":' +
        deepText +
        "}}]}",
    );
    // Independent full JSON comparison; never hand deep values to a recursive matcher.
    // Traverse even identical/already-frozen objects so every child is checked.
    function checkJson(actual: unknown, expected: unknown, frozen = false): number {
      const pending: [unknown, unknown][] = [[actual, expected]];
      let objects = 0;
      while (pending.length) {
        const pair = pending.pop();
        if (!pair) throw new Error("deep observation worklist invariant");
        const [left, right] = pair;
        if (right === null || typeof right !== "object") {
          expect(left === right, "complete JSON leaf equality").toBe(true);
          continue;
        }
        if (left === null || typeof left !== "object")
          throw new Error("deep observation object shape differs");
        expect(Array.isArray(left)).toBe(Array.isArray(right));
        if (frozen) expect(Object.isFrozen(left), "every observed container frozen").toBe(true);
        const l = left as Record<string, unknown>,
          r = right as Record<string, unknown>;
        expect(Object.keys(l).sort()).toStrictEqual(Object.keys(r).sort());
        if (Array.isArray(left) && Array.isArray(right)) expect(left.length).toBe(right.length);
        for (const key of Object.keys(r)) pending.push([l[key], r[key]]);
        objects++;
      }
      return objects;
    }
    const created = await service.sequenceObserved("p", carrier);
    expect(created.context.scopePosition).toBe("pos-1");
    expect(created.body.results).toHaveLength(1);
    const entry = created.body.results[0] as Record<string, unknown>;
    const resource = entry.resource as Record<string, unknown>;
    expect(typeof resource.revision).toBe("string");
    expect(resource.revision).not.toBe("");
    const expectedResource = {
      id: `${scope}beads/deep`,
      type: bead,
      revision: resource.revision,
      properties: { deep: JSON.parse(deepText) as unknown },
      metadata: {},
    };
    expect(
      checkJson(
        created,
        {
          body: {
            results: [{ outcome: "created", resource: expectedResource, operationIndex: 0 }],
          },
          context: created.context,
        },
        true,
      ),
    ).toBeGreaterThan(depth);
    const before = f.owner.inspect();
    expect(before.position).toBe("1");
    expect(before.resources).toHaveLength(1);
    expect(before.groups).toHaveLength(1);
    checkJson(before.resources, [expectedResource]);
    const events = await service.events(`${scope}beads/deep?view=events`);
    if (events.kind !== "page") throw new Error("expected deep Resource Event page");
    expect(events.page.events).toHaveLength(1);
    const replay = await service.sequenceObserved("p", carrier);
    expect(checkJson(replay, created, true)).toBeGreaterThan(depth);
    checkJson(f.owner.inspect(), before);
    checkJson(await service.events(`${scope}beads/deep?view=events`), events);
  }, 20000);

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

describe("same-entry direct receipt delivery", () => {
  it.each([false, true])(
    "does not re-expire a first terminal delivery after a clock jump (failed=%s)",
    async (failed) => {
      let time = 1000;
      const f = fixture({
        clock: () => time,
        fault(point) {
          if (point === "after-terminal") time = 86401001;
        },
      });
      const service = f.open();
      const result = await service.submit(
        batch(failed ? [{ operation: "deleteBead", bead: "beads/missing" }] : [create()]),
      );
      expect(result.kind).toBe("receipt");
      if (result.kind !== "receipt") throw new Error("missing receipt");
      expect(result.receipt.status).toBe(failed ? "failed" : "completed");
      expect(result.receipt.detail).toBe("available");
      expect(result.context.scopePosition).toBe(failed ? "pos-0" : "pos-1");
      expect(Object.isFrozen(result.receipt)).toBe(true);
      if (failed) expect(result.receipt.problem).toBeDefined();
      else expect(Object.isFrozen(result.receipt.results)).toBe(true);
      const later = service.receipt({ kind: "authenticated", principal: "p" }, result.receipt.id);
      if (failed) expect(later).toMatchObject({ kind: "refused", status: 404 });
      else expect(later).toMatchObject({ kind: "receipt", receipt: { detail: "expired" } });
    },
  );

  it("fresh and retained replay deliveries never use receipt-ID scans", async () => {
    const f = fixture(),
      service = f.open();
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql === "SELECT * FROM receipts WHERE principal=?")
        throw new Error("forbidden delivery scan");
      return original.call(this, sql);
    });
    const first = await service.submit(batch());
    const replay = await service.submit(batch());
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ kind: "receipt", context: { scopePosition: "pos-1" } });
    expect(f.owner.inspect().groups).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("private minimum-read owner/lifecycle", () => {
  const point = {
    kind: "resource",
    resource: "bead",
    id: `${scope}beads/a` as AbsoluteHttpUrl,
  } as const;
  it("isolates concurrent immutable controls and never holds SQLite during a wait", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let waits = 0;
    const service = f.open({
      minimumReads: {
        budgetMs: 1000,
        wait: async () => {
          waits++;
          entered.resolve();
          await release.promise;
        },
      },
    });
    const first = requireReceipt(await service.submit(batch()));
    const supplied = {
      scopeEpoch: first.context.scopeEpoch,
      authorizationView: first.context.authorizationView,
      minimumPosition: "pos-2",
    };
    const waiting = service.readAtMinimum({ kind: "anonymous" }, supplied).perform(point);
    await entered.promise;
    supplied.minimumPosition = "pos-999";
    const immediate = await service
      .readAtMinimum({ kind: "anonymous" }, { ...supplied, minimumPosition: "pos-1" })
      .perform(point);
    expect(immediate.kind).toBe("success");
    const advanced = await service.submit(batch([create("b")], "advance"));
    expect(advanced).toMatchObject({ kind: "receipt", context: { scopePosition: "pos-2" } });
    release.resolve();
    const result = await waiting;
    expect(result).toMatchObject({
      kind: "success",
      observation: { sourceContext: { scopePosition: "pos-2" } },
    });
    expect(waits).toBe(1);
  });
  it.each([
    ["false", false, "pos-1"],
    ["true", true, "pos-1"],
    ["opaque false", false, "unknown"],
    ["opaque true", true, "unknown"],
  ] as const)(
    "checks minimum before read-triggered expiry but honors independently forgotten receipts (%s)",
    async (_label, forget, minimumPosition) => {
      const f = fixture();
      let waits = 0,
        tick = 0;
      const service = f.open({
        minimumReads: {
          budgetMs: 2,
          now: () => tick++,
          wait: async () => {
            waits++;
            f.setTime(86401001);
            if (forget) f.owner.maintain();
          },
        },
      });
      const failed = requireReceipt(
        await service.submit(batch([{ operation: "deleteBead", bead: "beads/missing" }])),
      );
      const minimum = {
        scopeEpoch: failed.context.scopeEpoch,
        authorizationView: failed.context.authorizationView,
        minimumPosition,
      };
      expect(
        await service.receiptAtMinimum(
          { kind: "authenticated", principal: "other" },
          failed.receipt.id,
          { ...minimum, scopeEpoch: "foreign" },
        ),
      ).toMatchObject({ status: 404 });
      expect(waits).toBe(0);
      const result = service.receiptAtMinimum(access, failed.receipt.id, minimum);
      if (forget) expect(await result).toMatchObject({ status: 404 });
      else await expect(result).rejects.toMatchObject({ reason: "catch-up-timeout" });
      expect(waits).toBe(1);
    },
  );
  it("drains a bounded pending read on close and respects an aborted reader", async () => {
    const f = fixture();
    let tick = 0;
    const service = f.open({
      minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
    });
    const first = requireReceipt(await service.submit(batch()));
    const minimum = {
      scopeEpoch: first.context.scopeEpoch,
      authorizationView: first.context.authorizationView,
      minimumPosition: "pos-9",
    };
    const facet = service.readAtMinimum({ kind: "anonymous" }, minimum);
    const aborted = new AbortController();
    aborted.abort();
    await expect(facet.perform(point, { signal: aborted.signal })).rejects.toThrow();
    const pending = facet.perform(point);
    const closing = service.close();
    await expect(pending).rejects.toMatchObject({ reason: "catch-up-timeout" });
    await closing;
    expect(() => facet.perform(point)).toThrow("closed");
  });
});

it("drains concurrent receipt-page waits on close while admitted commits can satisfy them", async () => {
  const f = fixture({ receiptMaximumItems: 2 });
  const parked = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let waits = 0,
    tick = 0;
  const service = f.open({
    read: {
      ...f.read,
      advertisedLimits: { ...f.read.advertisedLimits, page: { defaultItems: 2, maximumItems: 2 } },
      pagination: { ...f.read.pagination, maxPageItems: 2 },
    },
    minimumReads: {
      budgetMs: 100,
      now: () => tick++,
      wait: async () => {
        if (++waits === 2) parked.resolve();
        await release.promise;
      },
    },
  });
  const first = requireReceipt(
    await service.submit(batch([create("a"), create("b"), create("c")])),
  );
  if (typeof first.receipt.next !== "string") throw new Error("page required");
  const minimum = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "pos-2",
  };
  const pages = [
    service.receiptPage({ kind: "authenticated", principal: "p" }, first.receipt.next, minimum),
    service.receiptPage({ kind: "authenticated", principal: "p" }, first.receipt.next, minimum),
  ];
  try {
    await parked.promise;
    await service.submit(batch([create("later")], "later"));
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    for (const page of await Promise.all(pages))
      expect(page).toMatchObject({
        kind: "page",
        context: { scopePosition: "pos-2" },
        page: { receipt: first.receipt.id, results: [{ resource: { id: `${scope}beads/c` } }] },
      });
    await closing;
    expect(() =>
      service.receiptPage({ kind: "authenticated", principal: "p" }, String(first.receipt.next)),
    ).toThrow("closed");
  } finally {
    release.resolve();
    await Promise.allSettled(pages);
  }
});

it("cancels finite Event waits through the facet and drains uncancelled waits before owner close", async () => {
  const f = fixture();
  const service = f.open({ minimumReads: { budgetMs: 30 } });
  const first = await service.events(`${scope}events/`);
  if (first.kind !== "page") throw new Error("expected finite page");
  const minimum = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "pos-1",
  };
  const controller = new AbortController();
  const cancelled = service.events(`${scope}events/`, undefined, minimum, controller.signal);
  const cancellation = expect(cancelled).rejects.toMatchObject({
    name: "ScopeServerOperationAbortedError",
  });
  controller.abort();
  await cancellation;
  const pending = service.events(`${scope}events/`, undefined, minimum);
  const timedOut = expect(pending).rejects.toMatchObject({ reason: "catch-up-timeout" });
  const closing = service.close();
  expect(() => service.events(`${scope}events/`)).toThrow("closing or closed");
  await timedOut;
  await closing;
  expect(() => f.owner.readEvents(`${scope}events/`)).toThrow();
});

it("drains admitted finite Snapshot observation and refuses new work while closing", async () => {
  const f = fixture(),
    service = f.open();
  const pending = service.snapshot({ kind: "create" });
  const closing = service.close();
  expect(() => service.snapshot({ kind: "preflight" })).toThrow("closing or closed");
  expect(await pending).toMatchObject({
    kind: "manifest",
    body: { scope, scopePosition: "pos-0" },
    context: { scopePosition: "pos-0" },
  });
  await closing;
  await expect(service.closed).resolves.toBeUndefined();
  expect(() => f.owner.inspect()).toThrow("closed");
});

it("cancels separate streams on shutdown, drains admitted finite work and refuses stale registration", async () => {
  const f = fixture();
  const scheduler = manualScheduler();
  const service = f.open({ scheduler });
  const before = new AbortController();
  before.abort(new Error("pre-aborted"));
  let started = false;
  await expect(
    service.stream(async () => {
      started = true;
    }, before.signal),
  ).rejects.toThrow("pre-aborted");
  expect(started).toBe(false);
  const controller = new AbortController();
  const streaming = service.stream(
    (signal) =>
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    controller.signal,
  );
  expect(() => service.stream(async () => {}, new AbortController().signal)).toThrow("capacity");
  const admitted = service.sequence("p", sequence());
  const closed = service.close();
  await streaming;
  await scheduler.tick();
  await scheduler.tick();
  await admitted;
  await closed;
  expect(() => service.stream(async () => {}, new AbortController().signal)).toThrow("closing");
  const reopened = f.reopen();
  expect(reopened.inspect().groups).toHaveLength(2);
});

describe("fresh Snapshot minimum service", () => {
  it.each(["create", "preflight"] as const)(
    "freezes %s controls and retries after a real independent commit",
    async (kind) => {
      const f = fixture(),
        entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      const service = f.open({
        minimumReads: {
          wait: async () => {
            entered.resolve();
            await release.promise;
          },
        },
      });
      const initial = await service.snapshot({ kind: "preflight" });
      const tuple = {
        scopeEpoch: initial.context.scopeEpoch,
        authorizationView: initial.context.authorizationView,
        minimumPosition: "pos-1",
      };
      const request: TransactionSnapshotRequest = { kind };
      const pending = service.snapshot(request, tuple);
      try {
        await entered.promise;
        Object.assign(request, { kind: "manifest", id: "not-a-handle" });
        tuple.minimumPosition = "pos-999";
        requireReceipt(await service.submit(batch([create("after-wait")])));
        let closed = false;
        const closing = service.close().then(() => {
          closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release.resolve();
        const result = await pending;
        expect(result.context).toEqual({ ...initial.context, scopePosition: "pos-1" });
        expect(result.kind).toBe(kind === "create" ? "manifest" : "eligible");
        if (result.kind === "manifest") {
          expect(result.body.scopePosition).toBe("pos-1");
          expect(result.body.checkpoint).not.toBe("genesis");
          expect(result.body.beads.items).toHaveLength(1);
          expect(result.body.beads.items[0]).toMatchObject({
            id: `${scope}beads/after-wait`,
            properties: { title: "after-wait" },
          });
        }
        await closing;
      } finally {
        release.resolve();
        await Promise.allSettled([pending]);
      }
    },
  );
  it.each(["create", "preflight"] as const)(
    "keeps %s timeout and pre-abort distinct from owner work",
    async (kind) => {
      const f = fixture();
      let tick = 0;
      const wait = vi.fn(async () => {});
      const observeSnapshot = vi.fn(f.owner.observeSnapshot);
      const service = createTransactionService(
        { ...f.owner, observeSnapshot },
        {
          ownerLifetime: "service",
          read: f.read,
          minimumReads: { budgetMs: 2, now: () => tick++, wait },
        },
      );
      cleanup.push(() => service.close());
      const initial = await service.snapshot({ kind: "preflight" });
      observeSnapshot.mockClear();
      const tuple = {
        scopeEpoch: initial.context.scopeEpoch,
        authorizationView: initial.context.authorizationView,
        minimumPosition: "pos-1",
      };
      await expect(service.snapshot({ kind }, tuple, AbortSignal.abort())).rejects.toMatchObject({
        name: "ScopeServerOperationAbortedError",
      });
      expect(wait).not.toHaveBeenCalled();
      expect(observeSnapshot).not.toHaveBeenCalled();
      await expect(service.snapshot({ kind }, tuple)).rejects.toMatchObject({
        reason: "catch-up-timeout",
        context: initial.context,
      });
      expect(wait).toHaveBeenCalled();
      expect(() => service.snapshot({ kind: "manifest", id: "unknown" }, tuple)).toThrow(
        "requires fresh creation",
      );
      expect(
        await service.snapshot({ kind: "create" }, { ...tuple, minimumPosition: "genesis" }),
      ).toMatchObject({
        kind: "manifest",
        context: initial.context,
        body: { scopePosition: "pos-0", checkpoint: "genesis" },
      });
    },
  );
  it("uses one service call for each fresh HTTP branch, with terminal preflight", async () => {
    const f = fixture();
    let tick = 0;
    const service = f.open({
      minimumReads: { budgetMs: 2, now: () => tick++, wait: async () => {} },
    });
    const initial = await service.snapshot({ kind: "preflight" });
    const snapshot = vi.fn(service.snapshot);
    const http = createTransactionHttpHandler({ ...service, snapshot }, scope);
    for (const [method, headers, status, kind] of [
      ["GET", {}, 200, "create"],
      ["HEAD", {}, 200, "preflight"],
      ["GET", { "if-none-match": "*" }, 304, "preflight"],
      ["GET", { "if-match": '"absent"' }, 412, "preflight"],
      ["GET", { accept: "text/plain" }, 406, "preflight"],
    ] as const) {
      for (const minimumPosition of ["genesis", "pos-1", "unknown"]) {
        snapshot.mockClear();
        const response = await http.handle(
          new Request(`${scope}snapshot`, {
            method,
            headers: {
              ...headers,
              "bdp-scope-epoch": initial.context.scopeEpoch,
              "bdp-authorization-view": initial.context.authorizationView,
              "bdp-minimum-scope-position": minimumPosition,
            },
          }),
          { kind: "authenticated", principal: "p", canMutate: true },
        );
        expect(response.status).toBe(minimumPosition === "genesis" ? status : 503);
        expect(response.headers.get("bdp-scope-position")).toBe("pos-0");
        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(snapshot.mock.calls[0]?.[0]).toEqual({ kind });
      }
    }
  });
});

describe("internal discovery owner observation", () => {
  it("copies exactly one owner entry and parses only after releasing it", async () => {
    const f = fixture();
    let entries = 0;
    const owner = {
      ...f.owner,
      withRead: ((callback: Parameters<typeof f.owner.withRead>[0]) => {
        entries++;
        return f.owner.withRead(callback);
      }) as typeof f.owner.withRead,
    };
    const service = createTransactionService(owner, { ownerLifetime: "service", read: f.read });
    cleanup.push(() => service.close());
    const original = discoveryAssembly.assembleTransactionDiscovery;
    let parsed = 0;
    vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery").mockImplementation((...args) => {
      // Real owner API throws on reentry; this is not a substitute store.
      expect(f.owner.readConfiguration().receiptMaximumItems).toBe(32);
      parsed++;
      return original(...args);
    });
    entries = 0;
    const observed = await service.discoveryObserved();
    expect(entries).toBe(1);
    expect(parsed).toBe(1);
    expect(observed.context).toEqual({
      scopeEpoch: f.owner.scopeEpoch,
      authorizationView: "development-all-visible",
      scopePosition: "pos-0",
    });
    expect(observed.discovery).toMatchObject({
      scope,
      scopeEpoch: f.owner.scopeEpoch,
      authorizationView: "development-all-visible",
      headPosition: "pos-0",
      minimumReplayPosition: "pos-0",
    });
    expect(Object.isFrozen(observed.context)).toBe(true);
    expect(Object.keys(observed).sort()).toEqual(["context", "directory", "discovery"]);
    await service.close();
    expect(() => service.discoveryObserved()).toThrow("closed");
  });
  it("keeps entry refusal distinct from structural validation failure", async () => {
    const f = fixture(),
      service = f.open();
    let pending: Promise<unknown> | undefined;
    f.owner.withRead(() => {
      pending = service.discoveryObserved();
      return 0;
    });
    await expect(pending).rejects.toThrow("transaction discovery observation refused");
    const original = discoveryAssembly.assembleTransactionDiscovery;
    vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery").mockImplementation(
      (scope, context, limits) => original(scope, { ...context, scopeEpoch: "bad space" }, limits),
    );
    await expect(service.discoveryObserved()).rejects.toBeInstanceOf(
      ProtocolArtifactValidationError,
    );
    f.owner.close();
    await expect(service.discoveryObserved()).rejects.toThrow(
      "transaction discovery observation refused",
    );
  });
  it("captures nested limits once and enforces the captured values after caller mutation", async () => {
    const f = fixture(),
      service = f.open();
    const before = (await service.discoveryObserved()).discovery;
    Object.assign(f.read.advertisedLimits.page, { defaultItems: 1, maximumItems: 1 });
    Object.assign(f.read.advertisedLimits.selector, { bytes: 1, depth: 1, nodes: 1 });
    Object.assign(f.read.advertisedLimits, { cursorTtlMilliseconds: 999999 });
    Object.assign(f.read.selectorLimits, { bytes: 1, depth: 1, nodes: 1 });
    Object.assign(f.read.pagination, { defaultPageItems: 1, maxPageItems: 1, cursorTtlMs: 999999 });
    Object.assign(f.read, {
      advertisedLimits: {
        page: { defaultItems: 7, maximumItems: 7 },
        selector: { bytes: 7, depth: 7, nodes: 7 },
        cursorTtlMilliseconds: 7,
      },
    });
    const first = requireReceipt(
      await service.submit(batch([create("a"), create("b"), create("c")])),
    );
    expect(first.receipt.results).toHaveLength(3);
    const observed = await service.discoveryObserved();
    expect(observed.discovery.limits).toEqual(before.limits);
    const facet = service.readFor({ kind: "anonymous" });
    const page = await facet.perform({ kind: "collection", collection: "beads" });
    expect(page).toMatchObject({
      kind: "success",
      body: { items: [expect.any(Object), expect.any(Object)], next: expect.any(String) },
    });
    const max = await facet.perform({ kind: "collection", collection: "beads", limit: 33 });
    expect(max).toMatchObject({ kind: "problem", problem: { code: "limit-exceeded" } });
    if (page.kind !== "success" || !("next" in page.body) || typeof page.body.next !== "string")
      throw new Error("expected continuation");
    f.setTime(2000);
    const continued = requestFromUrl(new URL(page.body.next), scope);
    if (isReadProblem(continued)) throw new Error("expected continuation request");
    expect(await facet.perform(continued)).toMatchObject({
      kind: "problem",
      problem: { code: "cursor-expired" },
    });
    const selected = requestFromUrl(
      new URL(`${scope}beads/?selector=${encodeURIComponent("$[?@.properties.title == 'a']")}`),
      scope,
    );
    if (isReadProblem(selected)) throw new Error("expected selector request");
    expect(await facet.perform(selected)).toMatchObject({ kind: "success" });
  });
  it("keeps the replay position floor and complete genesis groups through receipt expiry and reopen", async () => {
    const f = fixture(),
      service = f.open();
    const first = requireReceipt(await service.submit(batch([create("a")], "first")));
    await service.submit(batch([create("b")], "second"));
    const observed = await service.discoveryObserved();
    expect(observed.discovery.headPosition).toBe("pos-2");
    expect(observed.discovery.minimumReplayPosition).toBe("pos-0");
    expect(first.receipt.id.startsWith(observed.discovery.receipts)).toBe(true);
    const receiptResponse = await createTransactionHttpHandler(service, scope).handle(
      new Request(first.receipt.id),
      { ...access, canMutate: true },
    );
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.body).toEqual(first.receipt);
    expect(receiptResponse.headers.get("bdp-scope-position")).toBe("pos-2");
    async function replay(actual: typeof service) {
      const pages: unknown[] = [];
      let after = "genesis";
      for (let count = 0; count < 3; count++) {
        const result = await actual.changes({ after });
        if (result.kind !== "page") throw new Error("expected actual changefeed page");
        pages.push(result);
        if (result.page.next === null) return pages;
        after = new URL(result.page.next).searchParams.get("after") ?? "";
      }
      throw new Error("unexpected changefeed page count");
    }
    const original = await replay(service);
    expect(original).toMatchObject([
      { kind: "page", page: { groups: [{ position: "pos-1", previousPosition: "pos-0" }] } },
      { kind: "page", page: { groups: [{ position: "pos-2", previousPosition: "pos-1" }] } },
    ]);
    await service.close();
    // The owner retains through expiresAt; maintenance disposes strictly after it.
    f.setTime(1001 + 24 * 60 * 60 * 1000);
    f.reopen();
    const reopened = f.open();
    const compact = requireReceipt(reopened.receipt(access, first.receipt.id));
    expect(compact.receipt).toMatchObject({
      status: "completed",
      detail: "expired",
      id: first.receipt.id,
      requiredPosition: "pos-1",
    });
    expect(compact.receipt).not.toHaveProperty("results");
    expect(await reopened.discoveryObserved()).toEqual(observed);
    expect(await replay(reopened)).toEqual(original);
  });
});

describe("captured pagination callback receivers", () => {
  it("reads each callback once but keeps state on the original pagination receiver", async () => {
    const f = fixture();
    const reads = { clock: 0, token: 0 };
    const pagination = {
      ...f.read.pagination,
      ticks: 1000,
      issued: 0,
      get clock() {
        reads.clock++;
        return function (this: { ticks: number }) {
          expect(this).toBe(pagination);
          return this.ticks++;
        };
      },
      get generateOpaqueToken() {
        reads.token++;
        return function (this: { issued: number }) {
          expect(this).toBe(pagination);
          return `stateful_${++this.issued}`;
        };
      },
    };
    const service = f.open({ read: { ...f.read, pagination } });
    expect(reads).toEqual({ clock: 1, token: 1 });
    const first = requireReceipt(
      await service.submit(batch([create("a"), create("b"), create("c")])),
    );
    const facet = service.readFor({ kind: "anonymous" });
    const page = await facet.perform({ kind: "collection", collection: "beads" });
    expect(page).toMatchObject({
      kind: "success",
      body: { items: [expect.any(Object), expect.any(Object)], next: expect.any(String) },
    });
    expect(pagination.ticks).toBeGreaterThan(1000);
    expect(pagination.issued).toBeGreaterThan(0);
    if (page.kind !== "success" || !("next" in page.body) || typeof page.body.next !== "string")
      throw new Error("expected continuation");
    const next = requestFromUrl(new URL(page.body.next), scope);
    if (isReadProblem(next)) throw new Error("expected continuation request");
    const last = await facet.perform(next);
    expect(last).toMatchObject({
      kind: "success",
      body: { items: [expect.any(Object)], next: null },
    });
    if (last.kind !== "success" || !("items" in last.body) || !("items" in page.body))
      throw new Error("expected collection pages");
    expect([...(page.body.items as unknown[]), ...(last.body.items as unknown[])]).toEqual(
      (first.receipt.results as { resource: unknown }[]).map((member) => member.resource),
    );
    expect(reads).toEqual({ clock: 1, token: 1 });
    expect((await service.discoveryObserved()).discovery.limits).toEqual({
      page: { defaultItems: 2, maximumItems: 32 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      validation: { diagnostics: 16, diagnosticBytes: 524288 },
    });
  });
  it.each(["clock", "generateOpaqueToken"] as const)(
    "preserves validation for an invalid %s without rereading its getter",
    (field) => {
      const f = fixture();
      let reads = 0;
      const pagination = { ...f.read.pagination };
      Object.defineProperty(pagination, field, {
        enumerable: true,
        get() {
          reads++;
          return null;
        },
      });
      expect(() => f.open({ read: { ...f.read, pagination } })).toThrow(
        "pagination callbacks required",
      );
      expect(reads).toBe(1);
    },
  );
});

describe("internal discovery minimum observation", () => {
  function tracked(minimumReads: NonNullable<TransactionServiceOptions["minimumReads"]> = {}) {
    const f = fixture();
    let entries = 0;
    const owner = {
      ...f.owner,
      withRead: ((callback: Parameters<typeof f.owner.withRead>[0]) => {
        entries++;
        return f.owner.withRead(callback);
      }) as typeof f.owner.withRead,
    };
    const service = createTransactionService(owner, {
      ownerLifetime: "service",
      read: f.read,
      minimumReads,
    });
    cleanup.push(() => service.close());
    entries = 0;
    const minimum = (minimumPosition = "pos-0"): TransactionMinimum => ({
      scopeEpoch: f.owner.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition,
    });
    return { ...f, service, minimum, entries: () => entries };
  }

  it("preserves synchronous no-minimum timing and ignores its signal and wait policy", async () => {
    const now = vi.fn(() => {
      throw new Error("minimum clock must be unused");
    });
    const f = tracked({ now });
    const controller = new AbortController();
    controller.abort();
    const pending = f.service.discoveryObserved(undefined, controller.signal);
    expect(f.entries()).toBe(1);
    expect((await pending).context.scopePosition).toBe("pos-0");
    expect(now).not.toHaveBeenCalled();
    let nested: Promise<unknown> | undefined;
    f.owner.withRead(() => {
      nested = f.service.discoveryObserved();
    });
    await expect(nested).rejects.toThrow("transaction discovery observation refused");
  });

  it.each(["pos-1", "pos-0", "genesis"])(
    "returns an immutable same-entry eligible prefix for %s after release",
    async (position) => {
      const wait = vi.fn(async () => {}),
        f = tracked({ wait, now: () => 0 });
      await f.service.submit(batch());
      const original = discoveryAssembly.assembleTransactionDiscovery;
      const assemble = vi
        .spyOn(discoveryAssembly, "assembleTransactionDiscovery")
        .mockImplementation((...args) => {
          expect(f.owner.readConfiguration().receiptMaximumItems).toBe(32);
          return original(...args);
        });
      const observed = await f.service.discoveryObserved(f.minimum(position));
      expect(f.entries()).toBe(1);
      expect(assemble).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
      expect(observed.context).toEqual({
        scopeEpoch: f.owner.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-1",
      });
      expect(observed.discovery).toMatchObject({
        scopeEpoch: observed.context.scopeEpoch,
        authorizationView: observed.context.authorizationView,
        headPosition: "pos-1",
        minimumReplayPosition: "pos-0",
      });
      for (const value of [
        observed,
        observed.context,
        observed.discovery,
        observed.discovery.limits,
        observed.discovery.limits?.selector,
        observed.directory,
      ])
        expect(Object.isFrozen(value)).toBe(true);
    },
  );

  it("captures immutable minimum controls and releases the owner during controlled catch-up", async () => {
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const wait = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    let tick = 0;
    const f = tracked({ budgetMs: 100, now: () => tick++, wait });
    cleanup.push(() => release.resolve());
    await f.service.submit(batch());
    const supplied = { ...f.minimum("pos-2") };
    const assemble = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    const pending = f.service.discoveryObserved(supplied);
    await entered.promise;
    try {
      Object.assign(supplied, {
        scopeEpoch: "foreign",
        authorizationView: "foreign",
        minimumPosition: "pos-999",
      });
      const immediate = await f.service.discoveryObserved(f.minimum("pos-1"));
      expect(immediate.context.scopePosition).toBe("pos-1");
      expect(
        requireReceipt(await f.service.submit(batch([create("b")], "advance"))).context
          .scopePosition,
      ).toBe("pos-2");
    } finally {
      release.resolve();
    }
    const observed = await pending;
    expect(observed.context).toEqual({
      scopeEpoch: f.owner.scopeEpoch,
      authorizationView: "development-all-visible",
      scopePosition: "pos-2",
    });
    expect(observed.discovery.headPosition).toBe("pos-2");
    // The independent satisfied read assembles pos-1; the waiting read assembles
    // only its successful pos-2 context, never its failed first attempt.
    expect(assemble).toHaveBeenCalledTimes(2);
    expect(assemble.mock.calls.map((call) => call[1].scopePosition)).toEqual(["pos-1", "pos-2"]);
    expect(assemble.mock.calls[1]?.[1]).toBe(observed.context);
    expect(Object.isFrozen(observed.context)).toBe(true);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(f.entries()).toBe(3); // two pending attempts plus independent satisfied observation
  });

  it.each([
    ["scopeEpoch", "cursor-expired"],
    ["authorizationView", "foreign-view"],
  ] as const)("releases the owner after an in-entry %s refusal", async (field, reason) => {
    const wait = vi.fn(async () => {}),
      f = tracked({ wait, now: () => 0 });
    const assemble = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    const error = await f.service
      .discoveryObserved({ ...f.minimum(), [field]: "foreign" })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TransactionMinimumFailure);
    expect(error).toMatchObject({
      reason,
      context: {
        scopeEpoch: f.owner.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-0",
      },
    });
    expect(f.entries()).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
    expect((await f.service.discoveryObserved()).context.scopePosition).toBe("pos-0");
    expect(f.entries()).toBe(2);
  });

  it("times out after two controlled attempts without assembly and leaves the owner reusable", async () => {
    let tick = 0;
    const wait = vi.fn(async () => {}),
      f = tracked({ budgetMs: 2, now: () => tick++, wait });
    const before = f.owner.inspect();
    const assemble = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    const error = await f.service
      .discoveryObserved(f.minimum("pos-1"))
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TransactionMinimumFailure);
    expect(error).toMatchObject({
      reason: "catch-up-timeout",
      context: { scopePosition: "pos-0" },
    });
    expect(f.entries()).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(assemble).not.toHaveBeenCalled();
    expect(f.owner.inspect()).toEqual(before);
    expect((await f.service.discoveryObserved()).context.scopePosition).toBe("pos-0");
  });

  it("rejects pre-abort before entry and pending abort before retry", async () => {
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const wait = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    let tick = 0;
    const f = tracked({ budgetMs: 100, now: () => tick++, wait });
    cleanup.push(() => release.resolve());
    const assemble = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    const before = new AbortController();
    before.abort();
    await expect(f.service.discoveryObserved(f.minimum(), before.signal)).rejects.toBeInstanceOf(
      ScopeServerOperationAbortedError,
    );
    expect(f.entries()).toBe(0);
    expect(wait).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = f.service.discoveryObserved(f.minimum("pos-1"), controller.signal);
    await entered.promise;
    controller.abort();
    release.resolve();
    await expect(pending).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
    expect(f.entries()).toBe(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(assemble).not.toHaveBeenCalled();
    expect((await f.service.discoveryObserved()).context.scopePosition).toBe("pos-0");
  });

  it("drains an admitted discovery wait before closing the owner", async () => {
    let tick = 0;
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const f = tracked({
      budgetMs: 2,
      now: () => tick,
      wait: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    cleanup.push(() => release.resolve());
    const pending = f.service.discoveryObserved(f.minimum("pos-1"));
    const rejected = expect(pending).rejects.toMatchObject({ reason: "catch-up-timeout" });
    await entered.promise;
    let closed = false;
    const closing = f.service.close().then(() => {
      closed = true;
    });
    expect(f.service.close()).toBe(f.service.close());
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(() => f.service.discoveryObserved(f.minimum())).toThrow("closing or closed");
      expect(closed).toBe(false);
      expect(f.owner.inspect().position).toBe("0");
    } finally {
      tick = 2;
      release.resolve();
    }
    await rejected;
    await closing;
    await f.service.closed;
    expect(() => f.owner.inspect()).toThrow("closed");
  });

  it("keeps malformed input, entry refusal, provider and parser failures distinct", async () => {
    const wait = vi.fn(async () => {});
    const f = tracked({ now: () => 0, wait });
    const assemble = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    expect(() =>
      f.service.discoveryObserved({ ...f.minimum(), minimumPosition: "pos-02" }),
    ).toThrow("unsupported minimum tuple");
    expect(f.entries()).toBe(0);
    let nested: Promise<unknown> | undefined;
    f.owner.withRead(() => {
      nested = f.service.discoveryObserved(f.minimum());
    });
    await expect(nested).rejects.toThrow("transaction discovery observation refused");
    expect(f.entries()).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
    assemble.mockRestore();
    const original = discoveryAssembly.assembleTransactionDiscovery;
    const parser = vi
      .spyOn(discoveryAssembly, "assembleTransactionDiscovery")
      .mockImplementation((scope, context, limits) => {
        expect(f.owner.readConfiguration().receiptMaximumItems).toBe(32);
        return original(scope, { ...context, scopeEpoch: "bad space" }, limits);
      });
    await expect(f.service.discoveryObserved(f.minimum())).rejects.toBeInstanceOf(
      ProtocolArtifactValidationError,
    );
    expect(parser).toHaveBeenCalledTimes(1);
    parser.mockRestore();
    expect((await f.service.discoveryObserved()).context.scopePosition).toBe("pos-0");
    const cause = new Error("delegated owner failure");
    const refusalAssembly = vi.spyOn(discoveryAssembly, "assembleTransactionDiscovery");
    let attempts = 0;
    let mode: "normal" | "throw" | "refuse" = "normal";
    const service = createTransactionService(
      {
        ...f.owner,
        withRead: ((callback: Parameters<typeof f.owner.withRead>[0]) => {
          attempts++;
          if (mode === "throw") throw cause;
          if (mode === "refuse") return { kind: "entry-refused", reason: "not-accepting", cause };
          return f.owner.withRead(callback);
        }) as typeof f.owner.withRead,
      },
      { ownerLifetime: "service", read: f.read, minimumReads: { wait, now: () => 0 } },
    );
    cleanup.push(() => service.close());
    attempts = 0;
    mode = "throw";
    await expect(service.discoveryObserved(f.minimum())).rejects.toBe(cause);
    expect(attempts).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(refusalAssembly).not.toHaveBeenCalled();
    mode = "refuse";
    await expect(service.discoveryObserved(f.minimum())).rejects.toMatchObject({
      message: "transaction discovery observation refused",
      cause,
    });
    expect(attempts).toBe(2);
    expect(wait).not.toHaveBeenCalled();
    expect(refusalAssembly).not.toHaveBeenCalled();
    mode = "normal";
    expect((await service.discoveryObserved(f.minimum())).context.scopePosition).toBe("pos-0");
    refusalAssembly.mockClear();
    const beforeClosed = attempts;
    f.owner.close();
    await expect(service.discoveryObserved(f.minimum())).rejects.toThrow(
      "transaction discovery observation refused",
    );
    expect(attempts - beforeClosed).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(refusalAssembly).not.toHaveBeenCalled();
  });
});

describe("current minimum perform receiving capture", () => {
  it("retains the captured signal inside the second owner read after a genuine behind wait", async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = new AbortController();
    let entries = 0;
    let tick = 0;
    const wait = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    const service = createTransactionService(
      {
        ...f.owner,
        withRead: (callback) => {
          entries++;
          return f.owner.withRead((reader, context) => {
            if (entries === 2) expect(original.signal.aborted).toBe(false);
            const result = callback(reader, context);
            // Abort after real owner work, while still inside the second read.
            // The wait-loop precheck has already passed; authority post-work
            // sampling must receive the same captured signal to reject delivery.
            if (entries === 2) original.abort();
            return result;
          });
        },
      },
      {
        ownerLifetime: "service",
        read: f.read,
        minimumReads: { budgetMs: 100, now: () => tick++, wait },
      },
    );
    cleanup.push(() => service.close());
    cleanup.push(() => release.resolve());
    const seeded = requireReceipt(await service.submit(batch()));
    expect(seeded.context.scopePosition).toBe("pos-1");
    const facet = service.readAtMinimum(
      { kind: "anonymous" },
      {
        scopeEpoch: seeded.context.scopeEpoch,
        authorizationView: seeded.context.authorizationView,
        minimumPosition: "pos-2",
      },
    );
    const pending = facet.perform(
      { kind: "resource", resource: "bead", id: `${scope}beads/a` as AbsoluteHttpUrl },
      { signal: original.signal },
    );
    const outcome = pending.then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
    await entered.promise;
    expect(entries).toBe(1);
    expect(original.signal.aborted).toBe(false);
    expect(wait).toHaveBeenCalledTimes(1);
    try {
      const advanced = requireReceipt(await service.submit(batch([create("b")], "advance")));
      expect(advanced.context.scopePosition).toBe("pos-2");
      expect(original.signal.aborted).toBe(false);
    } finally {
      release.resolve();
    }
    const observed = await outcome;
    expect(observed.error).toBeInstanceOf(ScopeServerOperationAbortedError);
    expect(observed.result).toBeUndefined();
    expect(original.signal.aborted).toBe(true);
    expect(entries).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("rejects a service delivery signal getter without invoking it or entering the owner", async () => {
    const f = fixture();
    let entries = 0;
    const service = createTransactionService(
      {
        ...f.owner,
        withRead: (callback) => {
          entries++;
          return f.owner.withRead(callback);
        },
      },
      { ownerLifetime: "service", read: f.read },
    );
    cleanup.push(() => service.close());
    const facet = service.readAtMinimum(
      { kind: "anonymous" },
      {
        scopeEpoch: f.owner.scopeEpoch,
        authorizationView: "development-all-visible",
        minimumPosition: "pos-0",
      },
    );
    const getter = vi.fn(() => {
      throw new Error("delivery getter executed");
    });
    const delivery = facet.perform(
      { kind: "resource", resource: "bead", id: `${scope}beads/a` as AbsoluteHttpUrl },
      Object.defineProperty({}, "signal", { get: getter }),
    );
    expect(delivery).toBeInstanceOf(Promise);
    await expect(delivery).rejects.toMatchObject({ reason: "invalid-input" });
    expect(getter).not.toHaveBeenCalled();
    expect(entries).toBe(0);
  });

  it.each([false, true])(
    "keeps captured delivery options across a held wait (abort original: %s)",
    async (abortOriginal) => {
      const f = fixture();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let entries = 0;
      let tick = 0;
      const wait = vi.fn(async () => {
        entered.resolve();
        await release.promise;
      });
      const service = createTransactionService(
        {
          ...f.owner,
          withRead: (callback) => {
            entries++;
            return f.owner.withRead(callback);
          },
        },
        {
          ownerLifetime: "service",
          read: f.read,
          minimumReads: { budgetMs: 100, now: () => tick++, wait },
        },
      );
      cleanup.push(() => service.close());
      cleanup.push(() => release.resolve());
      const seeded = requireReceipt(await service.submit(batch()));
      expect(seeded.context.scopePosition).toBe("pos-1");
      const minimum = {
        scopeEpoch: seeded.context.scopeEpoch,
        authorizationView: seeded.context.authorizationView,
        minimumPosition: "pos-2",
      };
      const original = new AbortController();
      const options = { signal: original.signal, sourceCondition: { ...minimum } };
      const request = {
        kind: "resource" as const,
        resource: "bead" as const,
        id: `${scope}beads/a` as AbsoluteHttpUrl,
      };
      entries = 0;
      const facet = service.readAtMinimum({ kind: "anonymous" }, minimum);
      const pending = facet.perform(request, options);
      const aborted = abortOriginal
        ? expect(pending).rejects.toBeInstanceOf(ScopeServerOperationAbortedError)
        : undefined;
      await entered.promise;
      expect(entries).toBe(1);
      expect(wait).toHaveBeenCalledTimes(1);
      options.signal = AbortSignal.abort();
      options.sourceCondition.minimumPosition = "pos-99";
      let closing: Promise<void> | undefined;
      let closed = false;
      try {
        if (abortOriginal) {
          original.abort();
          closing = service.close().then(() => {
            closed = true;
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(closed).toBe(false);
          expect(() => facet.perform(request)).toThrow("closing or closed");
        } else {
          // The wait-loop signal alone was already captured by the old code.
          // Only successful retry with the original active signal distinguishes
          // immutable per-attempt options from rereading the pre-aborted replacement.
          const advanced = requireReceipt(await service.submit(batch([create("b")], "advance")));
          expect(advanced.context.scopePosition).toBe("pos-2");
        }
      } finally {
        release.resolve();
      }
      if (abortOriginal) {
        await aborted;
        await closing;
        expect(closed).toBe(true);
        expect(entries).toBe(1);
        expect(() => f.owner.inspect()).toThrow("closed");
      } else {
        const result = await pending;
        expect(result).toMatchObject({
          kind: "success",
          body: { id: `${scope}beads/a`, type: bead, properties: { title: "a" } },
          observation: { sourceContext: { ...seeded.context, scopePosition: "pos-2" } },
        });
        expect(entries).toBe(2);
      }
      expect(wait).toHaveBeenCalledTimes(1);
    },
  );
});

describe("nonexecuting sequence refusal observation", () => {
  it("uses one synchronous owner entry and freezes each current refusal tuple without admission", async () => {
    const f = fixture();
    let capturedContext: unknown;
    const enter = vi.fn((callback: Parameters<typeof f.owner.withRead>[0]) =>
      f.owner.withRead((reader, context) => {
        capturedContext = context;
        return callback(reader, context);
      }),
    );
    const admitSequence = vi.fn(f.owner.admitSequence);
    const nextSequence = vi.fn(f.owner.nextSequence);
    const admit = vi.fn(f.owner.admit);
    const admitObserved = vi.fn(f.owner.admitObserved);
    const execute = vi.fn(f.owner.execute);
    const executeObserved = vi.fn(f.owner.executeObserved);
    const owner = {
      ...f.owner,
      withRead: enter as typeof f.owner.withRead,
      admitSequence,
      nextSequence,
      // Vitest models the last overload; the spy still delegates all arguments.
      admit: admit as unknown as typeof f.owner.admit,
      admitObserved: admitObserved as typeof f.owner.admitObserved,
      execute: execute as unknown as typeof f.owner.execute,
      executeObserved,
    };
    const service = createTransactionService(owner, { ownerLifetime: "service", read: f.read });
    cleanup.push(() => service.close());
    await service.submit(batch([create("a")], "seed-a"));
    await service.submit(batch([create("b")], "seed-b"));
    enter.mockClear();
    admit.mockClear();
    admitObserved.mockClear();
    execute.mockClear();
    executeObserved.mockClear();
    const before = f.owner.inspect();
    const pending = service.sequenceRefusalObserved();
    // Entry is already complete before delivery: the owner is not held over await.
    expect(enter).toHaveBeenCalledTimes(1);
    expect(f.owner.inspect()).toEqual(before);
    const first = await pending;
    expect(first.context).toBe(capturedContext);
    expect(first).toEqual({
      context: {
        scopeEpoch: f.owner.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-2",
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.context)).toBe(true);
    expect(admitSequence).not.toHaveBeenCalled();
    expect(nextSequence).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(admitObserved).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(executeObserved).not.toHaveBeenCalled();
    expect(first.context).toEqual((await service.discoveryObserved()).context);
    await service.submit(batch([create("c")], "advance"));
    enter.mockClear();
    const next = await service.sequenceRefusalObserved();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(next.context.scopePosition).toBe("pos-3");
    expect(first.context.scopePosition).toBe("pos-2");
    await service.close();
    expect(() => service.sequenceRefusalObserved()).toThrow("closing or closed");
  });

  it.each([33, 1])(
    "preserves reentrant and failed-owner causes and sanitizes unexpected refusal observation faults with %i members",
    async (count) => {
      const f = fixture(),
        service = f.open();
      let nested: Promise<unknown> | undefined;
      f.owner.withRead(() => {
        nested = service.sequenceRefusalObserved();
        return 0;
      });
      await expect(nested).rejects.toMatchObject({
        message: "transaction sequence refusal observation refused",
        cause: expect.any(Error),
      });
      f.owner.close();
      await expect(service.sequenceRefusalObserved()).rejects.toMatchObject({
        message: "transaction sequence refusal observation refused",
        cause: expect.any(Error),
      });
      const handler = createTransactionHttpHandler(service, scope);
      const response = await handler.handle(
        new Request(`${scope}operations/sequence`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/plain" },
        }),
        { kind: "authenticated", principal: "p", canMutate: true },
        {
          text: JSON.stringify({
            operations: Array.from({ length: count }, (_, i) => ({
              ...create(`refused-${i}`),
              idempotencyKey: `refused-${i}`,
            })),
          }),
        },
      );
      expect(response.status).toBe(500);
      expect(response.body).toBeUndefined();
      expect(response.headers.get("content-length")).toBe("0");
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      expect(response.headers.has("content-type")).toBe(false);
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers.has(name)).toBe(false);
    },
  );

  it("keeps early sequence refusals unobserved and observes deep negotiation refusal", async () => {
    const f = fixture(),
      service = f.open();
    const observed = vi.fn(service.sequenceRefusalObserved);
    const execute = vi.fn(service.sequenceObserved);
    const handler = createTransactionHttpHandler(
      { ...service, sequenceRefusalObserved: observed, sequenceObserved: execute },
      scope,
    );
    const valid = JSON.stringify({ operations: [{ ...create(), idempotencyKey: "unused" }] });
    let nested: unknown = "leaf";
    for (let i = 0; i < 40; i++) nested = { nested };
    const deep = JSON.stringify({
      operations: [{ ...create(), properties: { nested }, idempotencyKey: "deep" }],
    });
    const authorized = { kind: "authenticated", principal: "p", canMutate: true } as const;
    for (const [text, headers, auth, status, code] of [
      [valid, { "idempotency-key": "carrier" }, authorized, 400, "malformed-request"],
      ["{", {}, authorized, 400, "malformed-request"],
      [valid, {}, { kind: "unauthenticated" }, 401, "unauthenticated"],
      [valid, {}, { ...authorized, canMutate: false }, 403, "forbidden"],
      [valid, { "content-type": "text/plain" }, authorized, 415, "unsupported-media-type"],
      [deep, { accept: "text/plain" }, authorized, 406, "not-acceptable"],
    ] as const) {
      const response = await handler.handle(
        new Request(`${scope}operations/sequence`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
        }),
        auth,
        { text },
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      if (status === 406) {
        expect(response.headers.has("x-bdp-development-limit")).toBe(false);
        expect(response.body).toBeUndefined();
        expect(response.headers.get("content-length")).toBe("0");
        expect(response.headers.has("content-type")).toBe(false);
        expect(response.headers.get("bdp-scope-epoch")).toBe(f.owner.scopeEpoch);
        expect(response.headers.get("bdp-authorization-view")).toBe("development-all-visible");
        expect(response.headers.get("bdp-scope-position")).toBe("pos-0");
        expect(observed).toHaveBeenCalledTimes(1);
      } else {
        expect(response.body).toMatchObject({ code, status });
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(
            response.headers.has(name),
            `excluded sequence refusal ${code} context: ${name}`,
          ).toBe(false);
        expect(observed).not.toHaveBeenCalled();
      }
      expect(execute).not.toHaveBeenCalled();
    }
    expect(f.owner.inspect().position).toBe("0");
  });
});

describe("nonexecuting local schema observation", () => {
  it("uses one synchronous owner entry and freezes each current schema tuple without admission", async () => {
    const f = fixture();
    let capturedContext: unknown;
    const enter = vi.fn((callback: Parameters<typeof f.owner.withRead>[0]) =>
      f.owner.withRead((reader, context) => {
        capturedContext = context;
        return callback(reader, context);
      }),
    );
    const admitSequence = vi.fn(f.owner.admitSequence);
    const nextSequence = vi.fn(f.owner.nextSequence);
    const admit = vi.fn(f.owner.admit);
    const admitObserved = vi.fn(f.owner.admitObserved);
    const execute = vi.fn(f.owner.execute);
    const executeObserved = vi.fn(f.owner.executeObserved);
    const owner = {
      ...f.owner,
      withRead: enter as typeof f.owner.withRead,
      admitSequence,
      nextSequence,
      // Vitest models the last overload; the spy still delegates all arguments.
      admit: admit as unknown as typeof f.owner.admit,
      admitObserved: admitObserved as typeof f.owner.admitObserved,
      execute: execute as unknown as typeof f.owner.execute,
      executeObserved,
    };
    const service = createTransactionService(owner, { ownerLifetime: "service", read: f.read });
    cleanup.push(() => service.close());
    await service.submit(batch([create("a")], "seed-a"));
    await service.submit(batch([create("b")], "seed-b"));
    enter.mockClear();
    admit.mockClear();
    admitObserved.mockClear();
    execute.mockClear();
    executeObserved.mockClear();
    const before = f.owner.inspect();
    const pending = service.schemaObserved();
    // Entry is already complete before delivery: the owner is not held over await.
    expect(enter).toHaveBeenCalledTimes(1);
    expect(f.owner.inspect()).toEqual(before);
    const first = await pending;
    expect(first.context).toBe(capturedContext);
    expect(first).toEqual({
      context: {
        scopeEpoch: f.owner.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-2",
      },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.context)).toBe(true);
    expect(admitSequence).not.toHaveBeenCalled();
    expect(nextSequence).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(admitObserved).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(executeObserved).not.toHaveBeenCalled();
    expect(first.context).toEqual((await service.discoveryObserved()).context);
    await service.submit(batch([create("c")], "advance"));
    enter.mockClear();
    const next = await service.schemaObserved();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(next.context.scopePosition).toBe("pos-3");
    expect(first.context.scopePosition).toBe("pos-2");
    await service.close();
    expect(() => service.schemaObserved()).toThrow("closing or closed");
  });
});

it("preserves schema observation reentrancy, owner-fault causes and synchronous close refusal", async () => {
  const f = fixture(),
    service = f.open();
  let nested: Promise<unknown> | undefined;
  f.owner.withRead(() => {
    nested = service.schemaObserved();
    return 0;
  });
  await expect(nested).rejects.toMatchObject({
    message: "transaction schema observation refused",
    cause: expect.any(Error),
  });
  f.owner.close();
  await expect(service.schemaObserved()).rejects.toMatchObject({
    message: "transaction schema observation refused",
    cause: expect.any(Error),
  });
  await service.close();
  expect(() => service.schemaObserved()).toThrow("closing or closed");
});

it("preserves current receipt absence context across ordinary and minimum service entrypoints", async () => {
  const f = fixture({ receiptMaximumItems: 2 });
  const owner = f.owner;
  type RootResult = ReturnType<typeof owner.readReceipt>;
  type OrdinaryRootResult = Exclude<RootResult, { readonly kind: "unsupported" }>;
  let roots = 0,
    pages = 0,
    waits = 0,
    tick = 0;
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum,
  ): OrdinaryRootResult;
  function countedReceipt(principal: string, id: string, minimum: "unsupported"): RootResult;
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum | "unsupported",
  ): RootResult {
    roots++;
    return minimum === "unsupported"
      ? owner.readReceipt(principal, id, minimum)
      : owner.readReceipt(principal, id, minimum);
  }
  const service = createTransactionService(
    {
      ...owner,
      readReceipt: countedReceipt,
      readReceiptPage(...args: Parameters<typeof owner.readReceiptPage>) {
        pages++;
        return owner.readReceiptPage(...args);
      },
    },
    {
      ownerLifetime: "service",
      read: {
        ...f.read,
        advertisedLimits: {
          ...f.read.advertisedLimits,
          page: { defaultItems: 2, maximumItems: 2 },
        },
        pagination: { ...f.read.pagination, maxPageItems: 2 },
      },
      minimumReads: {
        budgetMs: 2,
        now: () => tick++,
        wait: async () => {
          waits++;
        },
      },
    },
  );
  cleanup.push(() => service.close());
  const first = requireReceipt(
    await service.submit(batch([create("a"), create("b"), create("c")])),
  );
  expect(first.context.scopePosition).toBe("pos-1");
  if (typeof first.receipt.next !== "string") throw new Error("expected issued page");
  const foreign = { kind: "authenticated", principal: "other" } as const;
  const ahead = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "pos-99",
  };
  const retained = [];
  for (const minimum of [undefined, "unsupported", ahead] as const) {
    const before = { roots, pages, waits };
    const root =
      minimum === undefined
        ? service.receipt(foreign, first.receipt.id)
        : await service.receiptAtMinimum(foreign, first.receipt.id, minimum);
    expect(root).toStrictEqual({
      kind: "refused",
      status: 404,
      code: "resource-not-found",
      context: first.context,
    });
    expect(Object.isFrozen(root)).toBe(true);
    expect(roots).toBe(before.roots + 1);
    expect(pages).toBe(before.pages);
    expect(waits).toBe(before.waits);
    const page = await service.receiptPage(foreign, first.receipt.next, minimum);
    expect(page).toStrictEqual({
      kind: "refused",
      code: "resource-not-found",
      context: first.context,
    });
    expect(Object.isFrozen(page)).toBe(true);
    expect(pages).toBe(before.pages + 1);
    expect(roots).toBe(before.roots + 1);
    expect(waits).toBe(before.waits);
    retained.push(root, page);
  }
  const beforeAnonymous = { roots, pages };
  const anonymous = { kind: "unauthenticated" } as const;
  expect(service.receipt(anonymous, first.receipt.id)).toStrictEqual({
    kind: "refused",
    status: 401,
    code: "unauthenticated",
  });
  expect(await service.receiptAtMinimum(anonymous, first.receipt.id, ahead)).toStrictEqual({
    kind: "refused",
    status: 401,
    code: "unauthenticated",
  });
  expect(await service.receiptPage(anonymous, first.receipt.next, ahead)).toStrictEqual({
    kind: "refused",
    code: "unauthenticated",
  });
  expect({ roots, pages }).toStrictEqual(beforeAnonymous);
  const later = requireReceipt(await service.submit(batch([create("later")], "later")));
  expect(later.context).toStrictEqual({ ...first.context, scopePosition: "pos-2" });
  const beforeLater = { roots, pages };
  expect(service.receipt(foreign, first.receipt.id)).toStrictEqual({
    kind: "refused",
    status: 404,
    code: "resource-not-found",
    context: later.context,
  });
  expect(await service.receiptPage(foreign, first.receipt.next)).toStrictEqual({
    kind: "refused",
    code: "resource-not-found",
    context: later.context,
  });
  expect({ roots, pages }).toStrictEqual({
    roots: beforeLater.roots + 1,
    pages: beforeLater.pages + 1,
  });
  for (const result of retained) {
    if (result.kind !== "refused" || result.code !== "resource-not-found")
      throw new Error("expected hidden receipt");
    expect(result.context).toStrictEqual(first.context);
    expect(Object.isFrozen(result.context)).toBe(true);
  }
  expect(waits).toBe(0);
});

it("rejects an old selected Event packet before stream registration and accepts a current lease", async () => {
  const boundary = cleanup.length,
    failures: unknown[] = [];
  const caller = new AbortController();
  let observed: Promise<unknown> | undefined;
  let ownerReady = false;
  let callbacks = 0,
    writes = 0,
    pulls = 0;
  try {
    const f = fixture();
    ownerReady = true;
    const service = f.open();
    const receipt = f.owner.execute(owned(f.owner, batch([create("a"), create("b")])));
    expect(receipt.status).toBe("completed");
    const selected = f.owner.beginEventScan(`${scope}events/`);
    if (selected.kind !== "packet") throw Error("actual selected packet required");
    expect(selected.events).toHaveLength(2);
    const policy = await service.replaceAuthorizationPolicy({ timeoutMs: 1000 });
    expect(policy.generation).toBe(1);
    // Handler selection occurred before publication; actual service acquisition occurs after.
    const stale = Promise.resolve().then(() =>
      service.stream(
        async () => {
          callbacks++;
          writes += selected.events.length;
          pulls++;
          f.owner.advanceEventScan(selected.scan);
        },
        caller.signal,
        selected.context,
      ),
    );
    const staleResult = await stale.then(
      () => ({ accepted: true }),
      (error: unknown) => error,
    );
    expect(staleResult).toMatchObject({ code: "foreign-view" });
    expect([callbacks, writes, pulls]).toEqual([0, 0, 0]);
    const current = f.owner.beginEventScan(`${scope}events/`);
    if (current.kind !== "packet") throw Error("actual current packet required");
    expect(current.context).toEqual({
      ...selected.context,
      authorizationView: policy.authorizationView,
    });
    expect(current.events).toEqual([]);
    const registered = Promise.withResolvers<void>();
    const fresh = service.stream(
      async (signal) => {
        callbacks++;
        registered.resolve();
        await new Promise<never>((_resolve, reject) => {
          const aborted = () => {
            signal.removeEventListener("abort", aborted);
            reject(signal.reason);
          };
          signal.addEventListener("abort", aborted, { once: true });
          if (signal.aborted) aborted();
          // No nextpull or wire callback: this case isolates registration.
        });
      },
      caller.signal,
      current.context,
    );
    observed = fresh.then(
      () => ({ completed: true }),
      (error: unknown) => error,
    );
    await registered.promise;
    expect([callbacks, writes, pulls]).toEqual([1, 0, 0]);
    const reason = Error("current lease test complete");
    caller.abort(reason);
    expect(await observed).toBe(reason);
  } catch (error) {
    failures.push(error);
  } finally {
    caller.abort(Error("stale lease fixture cleanup"));
    if (observed) {
      try {
        await observed;
      } catch (error) {
        failures.push(error);
      }
    }
    const added = cleanup.splice(boundary),
      removeDirectory = added.shift();
    let stopped = ownerReady;
    for (const close of added.reverse()) {
      try {
        await close();
      } catch (error) {
        stopped = false;
        failures.push(error);
      }
    }
    if (stopped && removeDirectory) {
      try {
        await removeDirectory();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "stale Event lease witness cleanup");
}, 5000);

function finiteEventMinimumFixture(
  waitCount: number,
  eventTypes: Parameters<typeof openTransactionStore>[0]["types"] = types,
) {
  const f = fixture({ types: eventTypes });
  let tick = 0,
    reads = 0,
    serviceCalls = 0,
    waits = 0,
    probes = 0,
    groupReads = 0;
  const attemptTimes: number[] = [];
  const gates = Array.from({ length: waitCount }, () => ({
    entered: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
  }));
  const owner = {
    ...f.owner,
    readEvents: (...args: Parameters<typeof f.owner.readEvents>) => {
      reads++;
      attemptTimes.push(tick);
      return f.owner.readEvents(...args);
    },
  };
  const service = createTransactionService(owner, {
    ownerLifetime: "service",
    read: f.read,
    minimumReads: {
      budgetMs: 10,
      now: () => tick,
      wait: async (milliseconds) => {
        const gate = gates[waits++];
        if (!gate) throw new Error("unexpected finite Event wait");
        expect(milliseconds).toBe(5);
        expect(f.owner.withRead(() => true)).toEqual({ kind: "read", value: true });
        probes++;
        gate.entered.resolve();
        await gate.release.promise;
        tick += milliseconds;
      },
    },
  });
  cleanup.push(() => service.close());
  const pending: Promise<unknown>[] = [];
  let restoreScans: (() => void) | undefined;
  return {
    realOwner: f.owner,
    service,
    events(...args: Parameters<typeof service.events>) {
      serviceCalls++;
      return service.events(...args);
    },
    observe<T>(promise: Promise<T>) {
      const observed = promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      pending.push(observed);
      return observed;
    },
    async entered(index: number, observed: Promise<unknown>) {
      const gate = gates[index];
      if (!gate) throw new Error("missing finite Event gate");
      await Promise.race([
        gate.entered.promise,
        observed.then(() => {
          throw new Error("finite Event request settled before expected wait");
        }),
      ]);
    },
    release(index: number) {
      const gate = gates[index];
      if (!gate) throw new Error("missing finite Event gate");
      gate.release.resolve();
    },
    watchScans() {
      const prepare = DatabaseSync.prototype.prepare;
      const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
        this: DatabaseSync,
        sql,
      ) {
        if (/FROM groups/.test(sql)) groupReads++;
        return prepare.call(this, sql);
      });
      restoreScans = () => spy.mockRestore();
    },
    counts: () => ({ reads, serviceCalls, waits, probes, groupReads, attemptTimes }),
    async finish() {
      for (const gate of gates) gate.release.resolve();
      try {
        await Promise.allSettled(pending);
        await service.close();
      } finally {
        restoreScans?.();
      }
    },
  };
}

it("captures an initial Scope Event opaque tuple across one bounded wait", async () => {
  const f = finiteEventMinimumFixture(2);
  try {
    const setup = await f.events(`${scope}events/`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const observed = f.observe(f.events(`${scope}events/`, undefined, minimum));
    await f.entered(0, observed);
    expect(f.counts().reads).toBe(2);
    minimum.minimumPosition = setup.context.scopePosition;
    f.release(0);
    await f.entered(1, observed);
    expect(f.counts().reads).toBe(3);
    f.release(1);
    expect(await observed).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(f.counts()).toEqual({
      reads: 4,
      serviceCalls: 2,
      waits: 2,
      probes: 2,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10],
    });
    console.log(JSON.stringify({ observation: "finite-event-minimum-capture", ...f.counts() }));
  } finally {
    await f.finish();
  }
});

it("cancels and drains initial Scope Event opaque waits", async () => {
  const f = finiteEventMinimumFixture(3);
  try {
    const setup = await f.events(`${scope}events/`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const controller = new AbortController();
    const cancelled = f.observe(f.events(`${scope}events/`, undefined, minimum, controller.signal));
    await f.entered(0, cancelled);
    controller.abort();
    // Abort is observed only after our deferred wait is released.
    f.release(0);
    expect(await cancelled).toEqual({ error: expect.any(ScopeServerOperationAbortedError) });
    expect(f.counts().reads).toBe(2);
    const drained = f.observe(f.events(`${scope}events/`, undefined, minimum));
    await f.entered(1, drained);
    let closed = false;
    const closing = f.service.close().then(() => {
      closed = true;
    });
    const observedClosing = f.observe(closing);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(f.counts().reads).toBe(3);
    expect(() => f.events(`${scope}events/`)).toThrow("transaction service is closing or closed");
    expect(f.counts().reads).toBe(3);
    f.release(1);
    await f.entered(2, drained);
    expect(closed).toBe(false);
    f.release(2);
    expect(await drained).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(await observedClosing).toEqual({ value: undefined });
    expect(closed).toBe(true);
    expect(f.counts()).toEqual({
      reads: 5,
      serviceCalls: 4,
      waits: 3,
      probes: 3,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10, 15],
    });
    expect(() => f.realOwner.readEvents(`${scope}events/`)).toThrow(
      "transaction store closed or reentrant",
    );
    console.log(
      JSON.stringify({
        observation: "finite-event-minimum-cancel-drain",
        ...f.counts(),
        postCloseDirectRefusals: 1,
      }),
    );
  } finally {
    await f.finish();
  }
});

it.each([
  "already-aborted",
  "invalid-policy",
  "throwing-clock",
  "nonfinite-clock",
  "malformed-after-valid-preflight",
] as const)(
  "preserves initial Scope Event preflight before malformed capture: %s",
  async (label) => {
    const f = fixture();
    let reads = 0;
    const clockError = new Error("finite Event initial clock sentinel");
    const now = vi.fn(() => {
      if (label === "throwing-clock") throw clockError;
      return label === "nonfinite-clock" ? Number.NaN : 0;
    });
    const wait = vi.fn(async () => {});
    const service = createTransactionService(
      {
        ...f.owner,
        readEvents: (...args: Parameters<typeof f.owner.readEvents>) => {
          reads++;
          return f.owner.readEvents(...args);
        },
      },
      {
        ownerLifetime: "service",
        read: f.read,
        minimumReads: { budgetMs: label === "invalid-policy" ? 0 : 10, now, wait },
      },
    );
    cleanup.push(() => service.close());
    const pending = service.events(
      `${scope}events/`,
      undefined,
      {
        scopeEpoch: "bad space",
        authorizationView: "development-all-visible",
        minimumPosition: "opaque",
      },
      label === "already-aborted" ? AbortSignal.abort() : undefined,
    );
    expect(pending).toBeInstanceOf(Promise);
    const error = await pending.then(
      () => undefined,
      (cause: unknown) => cause,
    );
    if (label === "already-aborted") expect(error).toBeInstanceOf(ScopeServerOperationAbortedError);
    else if (label === "throwing-clock") expect(error).toBe(clockError);
    else {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({
        message:
          label === "invalid-policy"
            ? "finite minimum-read wait policy required"
            : label === "nonfinite-clock"
              ? "invalid minimum-read clock"
              : "unsupported minimum tuple",
      });
    }
    expect(now).toHaveBeenCalledTimes(label === "invalid-policy" ? 0 : 1);
    expect(reads).toBe(0);
    expect(wait).not.toHaveBeenCalled();
    console.log(
      JSON.stringify({
        observation: "finite-event-minimum-preflight",
        label,
        serviceCalls: 1,
        clockCalls: now.mock.calls.length,
        ownerReads: reads,
        waits: wait.mock.calls.length,
      }),
    );
  },
);

it("captures an initial Bead Event opaque tuple across one bounded wait", async () => {
  const f = finiteEventMinimumFixture(2);
  try {
    expect(await f.service.submit(batch())).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed", requiredPosition: "pos-1" },
    });
    const setup = await f.events(`${scope}beads/a?view=events`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const observed = f.observe(f.events(`${scope}beads/a?view=events`, undefined, minimum));
    await f.entered(0, observed);
    expect(f.counts().reads).toBe(2);
    minimum.minimumPosition = setup.context.scopePosition;
    f.release(0);
    await f.entered(1, observed);
    expect(f.counts().reads).toBe(3);
    f.release(1);
    expect(await observed).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(f.counts()).toEqual({
      reads: 4,
      serviceCalls: 2,
      waits: 2,
      probes: 2,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10],
    });
    console.log(
      JSON.stringify({
        observation: "bead-event-minimum-capture",
        ...f.counts(),
        seedMutations: 1,
      }),
    );
  } finally {
    await f.finish();
  }
});

it("cancels and drains initial Bead Event opaque waits", async () => {
  const f = finiteEventMinimumFixture(3);
  try {
    expect(await f.service.submit(batch())).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed", requiredPosition: "pos-1" },
    });
    const setup = await f.events(`${scope}beads/a?view=events`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const controller = new AbortController();
    const cancelled = f.observe(
      f.events(`${scope}beads/a?view=events`, undefined, minimum, controller.signal),
    );
    await f.entered(0, cancelled);
    controller.abort();
    // Abort is observed only after our deferred wait is released.
    f.release(0);
    expect(await cancelled).toEqual({ error: expect.any(ScopeServerOperationAbortedError) });
    expect(f.counts().reads).toBe(2);
    const drained = f.observe(f.events(`${scope}beads/a?view=events`, undefined, minimum));
    await f.entered(1, drained);
    let closed = false;
    const closing = f.service.close().then(() => {
      closed = true;
    });
    const observedClosing = f.observe(closing);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(f.counts().reads).toBe(3);
    expect(() => f.events(`${scope}beads/a?view=events`)).toThrow(
      "transaction service is closing or closed",
    );
    expect(f.counts().reads).toBe(3);
    f.release(1);
    await f.entered(2, drained);
    expect(closed).toBe(false);
    f.release(2);
    expect(await drained).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(await observedClosing).toEqual({ value: undefined });
    expect(closed).toBe(true);
    expect(f.counts()).toEqual({
      reads: 5,
      serviceCalls: 4,
      waits: 3,
      probes: 3,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10, 15],
    });
    expect(() => f.realOwner.readEvents(`${scope}beads/a?view=events`)).toThrow(
      "transaction store closed or reentrant",
    );
    console.log(
      JSON.stringify({
        observation: "bead-event-minimum-cancel-drain",
        ...f.counts(),
        postCloseDirectRefusals: 1,
        seedMutations: 1,
      }),
    );
  } finally {
    await f.finish();
  }
});

it.each([
  "already-aborted",
  "invalid-policy",
  "throwing-clock",
  "nonfinite-clock",
  "malformed-after-valid-preflight",
  "noncanonical-query",
  "relative-source",
] as const)("preserves initial Bead Event classification and preflight: %s", async (label) => {
  const f = fixture();
  let reads = 0;
  const clockError = new Error("finite Event initial clock sentinel");
  const now = vi.fn(() => {
    if (label === "throwing-clock") throw clockError;
    return label === "nonfinite-clock" ? Number.NaN : 0;
  });
  const wait = vi.fn(async () => {});
  const service = createTransactionService(
    {
      ...f.owner,
      readEvents: (...args: Parameters<typeof f.owner.readEvents>) => {
        reads++;
        return f.owner.readEvents(...args);
      },
    },
    {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: { budgetMs: label === "invalid-policy" ? 0 : 10, now, wait },
    },
  );
  cleanup.push(() => service.close());
  const source =
    label === "noncanonical-query"
      ? `${scope}beads/a?view=events&extra=x`
      : label === "relative-source"
        ? "beads/a?view=events"
        : `${scope}beads/a?view=events`;
  const pending = service.events(
    source,
    undefined,
    {
      scopeEpoch: "bad space",
      authorizationView: "development-all-visible",
      minimumPosition: "opaque",
    },
    label === "already-aborted" ? AbortSignal.abort() : undefined,
  );
  expect(pending).toBeInstanceOf(Promise);
  const error = await pending.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (label === "already-aborted") expect(error).toBeInstanceOf(ScopeServerOperationAbortedError);
  else if (label === "throwing-clock") expect(error).toBe(clockError);
  else if (label === "noncanonical-query")
    expect(error).toBeInstanceOf(TransactionEventParameterError);
  else if (label === "relative-source") {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ code: "ERR_INVALID_URL" });
  } else {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      message:
        label === "invalid-policy"
          ? "finite minimum-read wait policy required"
          : label === "nonfinite-clock"
            ? "invalid minimum-read clock"
            : "unsupported minimum tuple",
    });
  }
  expect(now).toHaveBeenCalledTimes(label === "invalid-policy" ? 0 : 1);
  expect(reads).toBe(label === "noncanonical-query" || label === "relative-source" ? 1 : 0);
  expect(wait).not.toHaveBeenCalled();
  console.log(
    JSON.stringify({
      observation: "bead-event-minimum-preflight",
      label,
      serviceCalls: 1,
      clockCalls: now.mock.calls.length,
      ownerReads: reads,
      waits: wait.mock.calls.length,
    }),
  );
});

const linkEventTypes = [
  ...types,
  parseTypeDescriptor({
    id: "https://example.test/link",
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "opaque" },
    target: { conformsTo: [], external: "opaque" },
  }),
];

it("captures an initial Link Event opaque tuple across one bounded wait", async () => {
  const f = finiteEventMinimumFixture(2, linkEventTypes);
  try {
    expect(
      await f.service.submit(
        batch([
          create("a"),
          create("b"),
          {
            operation: "createLink",
            id: "links/l",
            type: "https://example.test/link",
            source: "beads/a",
            target: "beads/b",
            properties: {},
          },
        ]),
      ),
    ).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed", requiredPosition: "pos-1" },
    });
    const setup = await f.events(`${scope}links/l?view=events`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const observed = f.observe(f.events(`${scope}links/l?view=events`, undefined, minimum));
    await f.entered(0, observed);
    expect(f.counts().reads).toBe(2);
    minimum.minimumPosition = setup.context.scopePosition;
    f.release(0);
    await f.entered(1, observed);
    expect(f.counts().reads).toBe(3);
    f.release(1);
    expect(await observed).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(f.counts()).toEqual({
      reads: 4,
      serviceCalls: 2,
      waits: 2,
      probes: 2,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10],
    });
    console.log(
      JSON.stringify({
        observation: "link-event-minimum-capture",
        ...f.counts(),
        seedMutations: 1,
      }),
    );
  } finally {
    await f.finish();
  }
});

it("cancels and drains initial Link Event opaque waits", async () => {
  const f = finiteEventMinimumFixture(3, linkEventTypes);
  try {
    expect(
      await f.service.submit(
        batch([
          create("a"),
          create("b"),
          {
            operation: "createLink",
            id: "links/l",
            type: "https://example.test/link",
            source: "beads/a",
            target: "beads/b",
            properties: {},
          },
        ]),
      ),
    ).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed", requiredPosition: "pos-1" },
    });
    const setup = await f.events(`${scope}links/l?view=events`);
    if (setup.kind !== "page") throw new Error("expected initial Event page");
    const minimum = {
      scopeEpoch: setup.context.scopeEpoch,
      authorizationView: setup.context.authorizationView,
      minimumPosition: "opaque",
    };
    f.watchScans();
    const controller = new AbortController();
    const cancelled = f.observe(
      f.events(`${scope}links/l?view=events`, undefined, minimum, controller.signal),
    );
    await f.entered(0, cancelled);
    controller.abort();
    // Abort is observed only after our deferred wait is released.
    f.release(0);
    expect(await cancelled).toEqual({ error: expect.any(ScopeServerOperationAbortedError) });
    expect(f.counts().reads).toBe(2);
    const drained = f.observe(f.events(`${scope}links/l?view=events`, undefined, minimum));
    await f.entered(1, drained);
    let closed = false;
    const closing = f.service.close().then(() => {
      closed = true;
    });
    const observedClosing = f.observe(closing);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(f.counts().reads).toBe(3);
    expect(() => f.events(`${scope}links/l?view=events`)).toThrow(
      "transaction service is closing or closed",
    );
    expect(f.counts().reads).toBe(3);
    f.release(1);
    await f.entered(2, drained);
    expect(closed).toBe(false);
    f.release(2);
    expect(await drained).toEqual({
      error: expect.objectContaining({ reason: "catch-up-timeout", context: setup.context }),
    });
    expect(await observedClosing).toEqual({ value: undefined });
    expect(closed).toBe(true);
    expect(f.counts()).toEqual({
      reads: 5,
      serviceCalls: 4,
      waits: 3,
      probes: 3,
      groupReads: 0,
      attemptTimes: [0, 0, 5, 10, 15],
    });
    expect(() => f.realOwner.readEvents(`${scope}links/l?view=events`)).toThrow(
      "transaction store closed or reentrant",
    );
    console.log(
      JSON.stringify({
        observation: "link-event-minimum-cancel-drain",
        ...f.counts(),
        postCloseDirectRefusals: 1,
        seedMutations: 1,
      }),
    );
  } finally {
    await f.finish();
  }
});

it.each([
  "already-aborted",
  "malformed-after-valid-preflight",
  "noncanonical-query",
  "relative-source",
] as const)("preserves initial Link Event classification and preflight: %s", async (label) => {
  const f = fixture();
  let reads = 0;
  const now = vi.fn(() => 0);
  const wait = vi.fn(async () => {});
  const service = createTransactionService(
    {
      ...f.owner,
      readEvents: (...args: Parameters<typeof f.owner.readEvents>) => {
        reads++;
        return f.owner.readEvents(...args);
      },
    },
    {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: { budgetMs: 10, now, wait },
    },
  );
  cleanup.push(() => service.close());
  const source =
    label === "noncanonical-query"
      ? `${scope}links/l?view=events&extra=x`
      : label === "relative-source"
        ? "links/l?view=events"
        : `${scope}links/l?view=events`;
  const pending = service.events(
    source,
    undefined,
    {
      scopeEpoch: "bad space",
      authorizationView: "development-all-visible",
      minimumPosition: "opaque",
    },
    label === "already-aborted" ? AbortSignal.abort() : undefined,
  );
  expect(pending).toBeInstanceOf(Promise);
  const error = await pending.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (label === "already-aborted") expect(error).toBeInstanceOf(ScopeServerOperationAbortedError);
  else if (label === "noncanonical-query")
    expect(error).toBeInstanceOf(TransactionEventParameterError);
  else if (label === "relative-source") {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ code: "ERR_INVALID_URL" });
  } else {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ message: "unsupported minimum tuple" });
  }
  expect(now).toHaveBeenCalledTimes(1);
  expect(reads).toBe(label === "noncanonical-query" || label === "relative-source" ? 1 : 0);
  expect(wait).not.toHaveBeenCalled();
  console.log(
    JSON.stringify({
      observation: "link-event-minimum-preflight",
      label,
      serviceCalls: 1,
      clockCalls: now.mock.calls.length,
      ownerReads: reads,
      waits: wait.mock.calls.length,
    }),
  );
});

function freshSnapshotOpaqueFixture(
  minimumReads: NonNullable<TransactionServiceOptions["minimumReads"]>,
) {
  const f = fixture();
  const observeSnapshot = vi.fn(f.owner.observeSnapshot);
  const service = createTransactionService(
    { ...f.owner, observeSnapshot },
    { ownerLifetime: "service", read: f.read, minimumReads },
  );
  cleanup.push(() => service.close());
  return { owner: f.owner, service, snapshot: vi.fn(service.snapshot), observeSnapshot };
}

it.each(["create", "preflight"] as const)(
  "captures fresh Snapshot %s opaque controls across independent commits",
  async (kind) => {
    let now = 0;
    let waits = 0;
    let probes = 0;
    let transactions = 0;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = freshSnapshotOpaqueFixture({
      budgetMs: 2,
      now: () => now,
      wait: async () => {
        waits++;
        expect(f.owner.withRead(() => true)).toMatchObject({ kind: "read" });
        probes++;
        if (waits === 1) {
          entered.resolve();
          await release.promise;
          now = 1;
        } else if (waits === 2) now = 2;
        else throw new Error("unexpected Snapshot wait");
      },
    });
    const initial = await f.snapshot({ kind: "preflight" });
    const minimum = {
      scopeEpoch: initial.context.scopeEpoch,
      authorizationView: initial.context.authorizationView,
      minimumPosition: "opaque",
    };
    const request: TransactionSnapshotRequest = { kind };
    const pending = f.snapshot(request, minimum);
    const outcome = pending.then(
      () => {
        throw new Error("opaque Snapshot unexpectedly became eligible");
      },
      (error: unknown) => error,
    );
    try {
      await Promise.race([
        entered.promise,
        outcome.then(() => {
          throw new Error("Snapshot completed before its first wait");
        }),
      ]);
      Object.assign(request, { kind: "manifest", id: "unused" });
      Object.assign(minimum, {
        scopeEpoch: "changed",
        authorizationView: "changed",
        minimumPosition: "genesis",
      });
      requireReceipt(await f.service.submit(batch([create("after-wait")])));
      transactions++;
      release.resolve();
      const error = await outcome;
      expect(error).toBeInstanceOf(TransactionMinimumFailure);
      expect(error).toMatchObject({
        reason: "catch-up-timeout",
        context: { ...initial.context, scopePosition: "pos-1" },
      });
      expect(f.snapshot).toHaveBeenCalledTimes(2);
      expect(f.observeSnapshot).toHaveBeenCalledTimes(4);
      expect(waits).toBe(2);
      expect(probes).toBe(2);
      expect(transactions).toBe(1);
      console.log(
        JSON.stringify({
          observation: "fresh-snapshot-opaque-capture",
          kind,
          serviceSnapshotCalls: f.snapshot.mock.calls.length,
          ownerSnapshotCalls: f.observeSnapshot.mock.calls.length,
          waits,
          probes,
          transactions,
          finalPosition: (error as TransactionMinimumFailure).context.scopePosition,
        }),
      );
    } finally {
      release.resolve();
      await Promise.allSettled([outcome]);
      await f.service.close();
    }
  },
);

it.each(["create", "preflight"] as const)(
  "cancels and drains fresh Snapshot %s opaque waits",
  async (kind) => {
    let now = 0;
    let waits = 0;
    let probes = 0;
    const entered = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
    const release = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
    const f = freshSnapshotOpaqueFixture({
      budgetMs: 2,
      now: () => now,
      wait: async () => {
        const index = waits++;
        if (index >= 3) throw new Error("unexpected Snapshot wait");
        expect(f.owner.withRead(() => true)).toMatchObject({ kind: "read" });
        probes++;
        entered[index]!.resolve();
        await release[index]!.promise;
        if (index > 0) now = index;
      },
    });
    const initial = await f.snapshot({ kind: "preflight" });
    const minimum = {
      scopeEpoch: initial.context.scopeEpoch,
      authorizationView: initial.context.authorizationView,
      minimumPosition: "opaque",
    };
    const controller = new AbortController();
    const cancelled = f.snapshot({ kind }, minimum, controller.signal).then(
      () => {
        throw new Error("cancelled Snapshot unexpectedly became eligible");
      },
      (error: unknown) => error,
    );
    let drained: Promise<unknown> | undefined;
    let closing: Promise<void> | undefined;
    try {
      await Promise.race([
        entered[0]!.promise,
        cancelled.then(() => {
          throw new Error("Snapshot completed before its cancellation wait");
        }),
      ]);
      controller.abort();
      release[0]!.resolve();
      expect(await cancelled).toBeInstanceOf(ScopeServerOperationAbortedError);
      now = 0;
      drained = f.snapshot({ kind }, minimum).then(
        () => {
          throw new Error("opaque Snapshot unexpectedly became eligible");
        },
        (error: unknown) => error,
      );
      await Promise.race([
        entered[1]!.promise,
        drained.then(() => {
          throw new Error("Snapshot completed before its drain wait");
        }),
      ]);
      let closed = false;
      closing = f.service.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(() => f.snapshot({ kind }, minimum)).toThrow("closing or closed");
      release[1]!.resolve();
      await Promise.race([
        entered[2]!.promise,
        drained.then(() => {
          throw new Error("Snapshot completed before its final wait");
        }),
      ]);
      expect(closed).toBe(false);
      release[2]!.resolve();
      const error = await drained;
      expect(error).toBeInstanceOf(TransactionMinimumFailure);
      expect(error).toMatchObject({ reason: "catch-up-timeout", context: initial.context });
      await closing;
      expect(closed).toBe(true);
      expect(f.snapshot).toHaveBeenCalledTimes(4);
      expect(f.observeSnapshot).toHaveBeenCalledTimes(5);
      expect(waits).toBe(3);
      expect(probes).toBe(3);
      let postCloseOwnerRefusals = 0;
      expect(() => {
        postCloseOwnerRefusals++;
        f.owner.observeSnapshot({ kind }, minimum);
      }).toThrow("closed");
      expect(f.observeSnapshot).toHaveBeenCalledTimes(5);
      console.log(
        JSON.stringify({
          observation: "fresh-snapshot-opaque-lifecycle",
          kind,
          serviceSnapshotCalls: f.snapshot.mock.calls.length,
          delegatedOwnerCalls: f.observeSnapshot.mock.calls.length,
          waits,
          probes,
          postCloseOwnerRefusals,
        }),
      );
    } finally {
      for (const gate of release) gate.resolve();
      await Promise.allSettled([cancelled, ...(drained ? [drained] : [])]);
      await (closing ?? f.service.close());
    }
  },
);

it.each([
  "malformed-aborted",
  "malformed-invalid-kind",
  "retained-unknown",
  "retained-known",
  "closed-malformed",
  "closed-unknown-fresh",
  "unknown-preaborted",
] as const)("preserves fresh Snapshot capture and refusal order: %s", async (label) => {
  let clockCalls = 0;
  let waits = 0;
  const f = freshSnapshotOpaqueFixture({
    budgetMs: 2,
    now: () => {
      clockCalls++;
      return 0;
    },
    wait: async () => {
      waits++;
      throw new Error("unexpected Snapshot wait");
    },
  });
  const initial = await f.snapshot({ kind: "preflight" });
  expect(f.observeSnapshot).toHaveBeenCalledTimes(1);
  const setupOwnerCalls = f.observeSnapshot.mock.calls.length;
  f.observeSnapshot.mockClear();
  const malformed = label.startsWith("malformed") || label === "closed-malformed";
  const retained = label.startsWith("retained") || label === "malformed-invalid-kind";
  const minimum = {
    scopeEpoch: initial.context.scopeEpoch,
    authorizationView: initial.context.authorizationView,
    minimumPosition: malformed ? "not a token" : label === "retained-known" ? "genesis" : "opaque",
  };
  const request: TransactionSnapshotRequest = retained
    ? { kind: "manifest", id: "unused" }
    : { kind: "create" };
  if (label.startsWith("closed")) await f.service.close();
  if (label === "unknown-preaborted") {
    await expect(f.snapshot(request, minimum, AbortSignal.abort())).rejects.toBeInstanceOf(
      ScopeServerOperationAbortedError,
    );
  } else if (label === "closed-unknown-fresh") {
    expect(() => f.snapshot(request, minimum)).toThrow("closing or closed");
  } else {
    let error: unknown;
    try {
      const unexpected = f.snapshot(
        request,
        minimum,
        label === "malformed-aborted" ? AbortSignal.abort() : undefined,
      );
      void unexpected.catch(() => {});
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(
      label === "retained-known"
        ? "minimum Snapshot observation requires fresh creation or preflight"
        : "unsupported minimum tuple",
    );
  }
  expect(f.snapshot).toHaveBeenCalledTimes(2);
  expect(f.observeSnapshot).not.toHaveBeenCalled();
  expect(waits).toBe(0);
  expect(clockCalls).toBe(label === "unknown-preaborted" ? 1 : 0);
  console.log(
    JSON.stringify({
      observation: "fresh-snapshot-opaque-order",
      label,
      serviceSnapshotCalls: f.snapshot.mock.calls.length,
      setupOwnerCalls,
      checkedOwnerCalls: f.observeSnapshot.mock.calls.length,
      clockCalls,
      waits,
    }),
  );
});

it("captures opaque receipt root minima through real owner retries", async () => {
  const f = fixture();
  const owner = f.owner;
  type RootResult = ReturnType<typeof owner.readReceipt>;
  type OrdinaryRootResult = Exclude<RootResult, { readonly kind: "unsupported" }>;
  const observations: {
    kind: "unproved" | "unsupported" | "receipt" | "missing";
    context: OrdinaryRootResult["context"] | null;
  }[] = [];
  let roots = 0,
    waits = 0,
    tick = 0,
    submits = 0;
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum,
  ): OrdinaryRootResult;
  function countedReceipt(principal: string, id: string, minimum: "unsupported"): RootResult;
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum | "unsupported",
  ): RootResult {
    roots++;
    try {
      const observed =
        minimum === "unsupported"
          ? owner.readReceipt(principal, id, minimum)
          : owner.readReceipt(principal, id, minimum);
      observations.push(
        "kind" in observed
          ? { kind: "unsupported", context: null }
          : { kind: observed.receipt ? "receipt" : "missing", context: observed.context },
      );
      return observed;
    } catch (error) {
      if (error instanceof TransactionMinimumUnproved)
        observations.push({ kind: "unproved", context: error.context });
      throw error;
    }
  }
  let supplied: { scopeEpoch: string; authorizationView: string; minimumPosition: string };
  const service = createTransactionService(
    { ...owner, readReceipt: countedReceipt },
    {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: {
        budgetMs: 3,
        now: () => tick++,
        wait: async () => {
          waits++;
          if (waits === 1) {
            supplied.minimumPosition = "pos-2";
            submits++;
            const later = requireReceipt(await service.submit(batch([create("later")], "later")));
            expect(later.context.scopePosition).toBe("pos-2");
          }
        },
      },
    },
  );
  cleanup.push(() => service.close());
  submits++;
  const first = requireReceipt(await service.submit(batch()));
  supplied = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "unknown",
  };
  const current = { ...first.context, scopePosition: "pos-2" };
  await expect(service.receiptAtMinimum(access, first.receipt.id, supplied)).rejects.toMatchObject({
    reason: "catch-up-timeout",
    context: current,
  });
  expect(supplied.minimumPosition).toBe("pos-2");
  expect(observations).toStrictEqual([
    { kind: "unproved", context: first.context },
    { kind: "unproved", context: current },
    { kind: "unproved", context: current },
  ]);
  await expect(
    service.receiptAtMinimum(access, first.receipt.id, {
      ...supplied,
      minimumPosition: "pos-01",
    }),
  ).rejects.toMatchObject({ reason: "catch-up-timeout", context: current });
  expect(await service.receiptAtMinimum(access, first.receipt.id, supplied)).toMatchObject({
    kind: "receipt",
    receipt: first.receipt,
    context: current,
  });
  expect(await service.receiptAtMinimum(access, first.receipt.id, "unsupported")).toStrictEqual({
    kind: "unsupported",
  });
  for (const [principal, id] of [
    ["other", first.receipt.id],
    ["p", `${scope}receipts/missing`],
  ] as const) {
    expect(
      await service.receiptAtMinimum({ kind: "authenticated", principal }, id, {
        ...supplied,
        minimumPosition: "unknown",
      }),
    ).toStrictEqual({ kind: "refused", status: 404, code: "resource-not-found", context: current });
  }
  const before = { roots, waits, tick };
  expect(
    await service.receiptAtMinimum({ kind: "unauthenticated" }, first.receipt.id, supplied),
  ).toStrictEqual({ kind: "refused", status: 401, code: "unauthenticated" });
  const malformed = service.receiptAtMinimum(access, first.receipt.id, {
    ...supplied,
    minimumPosition: "bad,tuple",
  });
  await expect(malformed).rejects.toThrow("unsupported minimum tuple");
  expect({ roots, waits, tick }).toStrictEqual(before);
  expect({ roots, waits, tick, submits }).toStrictEqual({
    roots: 10,
    waits: 4,
    tick: 11,
    submits: 2,
  });
  expect(observations.map((value) => value.kind)).toStrictEqual([
    "unproved",
    "unproved",
    "unproved",
    "unproved",
    "unproved",
    "unproved",
    "receipt",
    "unsupported",
    "missing",
    "missing",
  ]);
  expect(observations.slice(3, 6).map((value) => value.context)).toStrictEqual([
    current,
    current,
    current,
  ]);
  await service.close();
  console.log(
    JSON.stringify({
      observation: "receipt-root-minimum-capture",
      roots,
      waits,
      clockCalls: tick,
      submits,
      ownerObservations: observations,
    }),
  );
});

it("drains an opaque receipt root wait before closing its owner", async () => {
  const f = fixture();
  const owner = f.owner;
  type RootResult = ReturnType<typeof owner.readReceipt>;
  type OrdinaryRootResult = Exclude<RootResult, { readonly kind: "unsupported" }>;
  let roots = 0,
    waits = 0,
    tick = 0,
    closed = false,
    postCloseProbes = 0;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum,
  ): OrdinaryRootResult;
  function countedReceipt(principal: string, id: string, minimum: "unsupported"): RootResult;
  function countedReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum | "unsupported",
  ): RootResult {
    roots++;
    return minimum === "unsupported"
      ? owner.readReceipt(principal, id, minimum)
      : owner.readReceipt(principal, id, minimum);
  }
  const service = createTransactionService(
    { ...owner, readReceipt: countedReceipt },
    {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: {
        budgetMs: 2,
        now: () => tick++,
        wait: async () => {
          waits++;
          entered.resolve();
          await release.promise;
        },
      },
    },
  );
  cleanup.push(() => service.close());
  const pending: Promise<unknown>[] = [];
  try {
    const first = requireReceipt(await service.submit(batch()));
    const minimum = {
      scopeEpoch: first.context.scopeEpoch,
      authorizationView: first.context.authorizationView,
      minimumPosition: "unknown",
    };
    const read = service.receiptAtMinimum(access, first.receipt.id, minimum);
    // Observe rejection immediately, while retaining it for the exact assertion below.
    pending.push(read);
    void read.catch(() => {});
    await Promise.race([
      entered.promise,
      read.then(() => {
        throw new Error("opaque receipt returned before its controlled wait");
      }),
    ]);
    const closing = service.close();
    pending.push(closing);
    void closing.then(
      () => {
        closed = true;
      },
      () => {},
    );
    await Promise.resolve();
    expect(closed).toBe(false);
    const before = { roots, tick };
    expect(() => service.receiptAtMinimum(access, first.receipt.id, minimum)).toThrow(
      "closing or closed",
    );
    expect({ roots, tick }).toStrictEqual(before);
    release.resolve();
    await expect(read).rejects.toMatchObject({
      reason: "catch-up-timeout",
      context: first.context,
    });
    await closing;
    expect(closed).toBe(true);
    postCloseProbes++;
    expect(() => f.owner.readReceipt("p", first.receipt.id)).toThrow(
      "transaction store closed or reentrant",
    );
    expect({ roots, waits, tick, postCloseProbes }).toStrictEqual({
      roots: 2,
      waits: 1,
      tick: 3,
      postCloseProbes: 1,
    });
    console.log(
      JSON.stringify({
        observation: "receipt-root-minimum-drain",
        roots,
        waits,
        clockCalls: tick,
        postCloseProbes,
        closed,
      }),
    );
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await service.close();
  }
});
