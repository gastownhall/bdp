import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransaction, prepareTransactionSequence } from "./transaction-batch.js";
import { submitTransaction, type TransactionSubmission } from "./transaction-submission.js";
const scope = "https://example.test/submission/",
  bead = "https://example.test/bead",
  link = "https://example.test/link";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-submission-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    create: true,
    types: [
      parseTypeDescriptor({ id: bead, name: "Bead", describes: "bead", conformsTo: [] }),
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [bead], external: "none" },
        target: { conformsTo: [bead], external: "none" },
      }),
    ],
    ...extra,
  };
  let store = openTransactionStore(options);
  cleanup.push(() => store.close());
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openTransactionStore({ ...options, create: false });
      return store;
    },
  };
}
const create = (id = "a") => ({ operation: "createBead", id: `beads/${id}`, type: bead });
function submission(operations: unknown[] = [create()], key = "key"): TransactionSubmission {
  return {
    carrier: { kind: "batch" },
    body: JSON.stringify({ operations }),
    key,
    authorization: { kind: "authorized", principal: "p" },
    receiving: { acceptsJson: true, maximumOperations: 32 },
  };
}
function own(store: ReturnType<typeof openTransactionStore>, request = submission()) {
  const result = store.admit("p", request.key, prepareTransaction(scope, request.body));
  if (result.kind !== "owned") throw new Error("expected owned");
  return result.claim;
}
function dependencies(store: ReturnType<typeof openTransactionStore>) {
  return store.admitSequence(
    "p",
    prepareTransactionSequence(
      scope,
      JSON.stringify({
        operations: [
          { ...create(), name: "a", idempotencyKey: "creator" },
          {
            operation: "createLink",
            type: link,
            source: "@a",
            target: "@a",
            idempotencyKey: "dependent",
          },
        ],
      }),
    ),
  );
}
const dependent = () =>
  submission(
    [{ operation: "createLink", type: link, source: "beads/a", target: "beads/a" }],
    "dependent",
  );

describe("private direct Transactional receiving order", () => {
  it("checks byte bounds, syntax, key and authentication before key access", async () => {
    const f = fixture();
    let accessed = 0;
    const boundary = {
      ...f.store,
      admit: ((...args: Parameters<typeof f.store.admit>) => {
        accessed++;
        return f.store.admit(...args);
      }) as typeof f.store.admit,
    };
    for (const [patch, code] of [
      [
        { body: "x".repeat(65537), authorization: { kind: "unauthenticated" } },
        "request-too-large",
      ],
      [{ body: "{", authorization: { kind: "unauthenticated" } }, "malformed-request"],
      [
        { body: '{"operations":[{"operation":"createBead","type":"x","type":"y"}]}' },
        "malformed-request",
      ],
      [
        {
          body: JSON.stringify({
            operations: [
              { operation: "createLink", type: link, source: "@future", target: "@future" },
              { ...create(), name: "future" },
            ],
          }),
        },
        "malformed-request",
      ],
      [{ key: "bad key", authorization: { kind: "forbidden" } }, "malformed-request"],
      [{ authorization: { kind: "unauthenticated" } }, "unauthenticated"],
      [{ authorization: { kind: "forbidden" } }, "forbidden"],
    ] as const) {
      expect(await submitTransaction(boundary, { ...submission(), ...patch })).toMatchObject({
        kind: "refused",
        code,
      });
    }
    expect(accessed).toBe(0);
    expect(f.store.inspect().resources).toEqual([]);
    const claim = own(f.store);
    expect(claim.receipt.status).toBe("pending");
    f.store.retract(claim);
  });
  it("keeps unsupported sets and excessive private depth distinct from protocol malformed", async () => {
    const f = fixture();
    expect(
      await submitTransaction(f.store, submission([{ operation: "updateWhere" }])),
    ).toMatchObject({ kind: "development-limit" });
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(
      await submitTransaction(f.store, submission([{ ...create(), properties: { deep } }])),
    ).toMatchObject({ kind: "development-limit" });
    expect(f.store.inspect().resources).toEqual([]);
    f.store.retract(own(f.store));
  });
  it("compares conflict before negotiation and negotiates exact pending/terminal replay without changing it", async () => {
    const f = fixture(),
      request = submission(),
      claim = own(f.store, request);
    const noJson = { ...request, receiving: { acceptsJson: false, maximumOperations: 1 } };
    expect(
      await submitTransaction(f.store, { ...noJson, body: submission([create("other")]).body }),
    ).toMatchObject({ code: "idempotency-conflict" });
    expect(await submitTransaction(f.store, noJson)).toEqual({ kind: "not-acceptable" });
    expect(f.store.receipt("p", claim.receipt.id)).toEqual(claim.receipt);
    const completed = f.store.execute(claim);
    expect(await submitTransaction(f.store, noJson)).toEqual({ kind: "not-acceptable" });
    expect(f.store.receipt("p", claim.receipt.id)).toEqual(completed);
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("checks fresh capacity before negotiation and never captures a refused key", async () => {
    let admitted = 0;
    const f = fixture({
      fault(stage) {
        if (stage === "after-admission") admitted++;
      },
    });
    const request = submission([create(), create("b")]);
    expect(
      await submitTransaction(f.store, {
        ...request,
        receiving: { acceptsJson: false, maximumOperations: 1 },
      }),
    ).toEqual({
      kind: "refused",
      status: 413,
      code: "limit-exceeded",
      limit: "transaction.operations",
    });
    expect(
      await submitTransaction(f.store, {
        ...request,
        receiving: { acceptsJson: false, maximumOperations: 2 },
      }),
    ).toEqual({ kind: "not-acceptable" });
    expect(admitted).toBe(0);
    expect(f.store.inspect().resources).toEqual([]);
    const result = await submitTransaction(f.store, request);
    expect(result).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
    expect(admitted).toBe(1);
    expect(f.store.inspect().resources).toHaveLength(2);
    expect(
      await submitTransaction(f.store, {
        ...request,
        receiving: { acceptsJson: true, maximumOperations: 1 },
      }),
    ).toEqual(result);
    expect(admitted).toBe(1);
  });
  it("separates a valid >32 operation carrier from the private default admission bound", async () => {
    const f = fixture(),
      request = submission(Array.from({ length: 33 }, (_, i) => create(`a${i}`)));
    const prepared = prepareTransaction(scope, request.body);
    expect(prepared.carrier.operations).toHaveLength(33);
    expect(() => f.store.admit("p", "trusted", prepared)).toThrow(
      "development transaction operation limit",
    );
    expect(await submitTransaction(f.store, request)).toMatchObject({
      code: "limit-exceeded",
      limit: "transaction.operations",
    });
    await expect(
      submitTransaction(f.store, {
        ...request,
        receiving: { acceptsJson: true, maximumOperations: 33 },
      }),
    ).rejects.toThrow("receiving controls");
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().groups).toEqual([]);
  });
  it("preserves failed and expired duplicate dispositions and does not renew detail", async () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const failedRequest = submission(
      [{ operation: "deleteBead", bead: "beads/missing" }],
      "failed",
    );
    const failed = await submitTransaction(f.store, failedRequest);
    expect(failed).toMatchObject({ kind: "receipt", receipt: { status: "failed" } });
    expect(
      await submitTransaction(f.store, {
        ...failedRequest,
        receiving: { acceptsJson: false, maximumOperations: 1 },
      }),
    ).toEqual({ kind: "not-acceptable" });
    expect(await submitTransaction(f.store, failedRequest)).toEqual(failed);
    const request = submission(),
      completed = await submitTransaction(f.store, request);
    if (completed.kind !== "receipt") throw new Error("expected receipt");
    now = Date.parse(String(completed.receipt.expiresAt)) + 1;
    const expired = f.store.receipt("p", completed.receipt.id);
    expect(expired?.detail).toBe("expired");
    expect(
      await submitTransaction(f.store, {
        ...request,
        receiving: { acceptsJson: false, maximumOperations: 1 },
      }),
    ).toEqual({ kind: "not-acceptable" });
    expect(f.store.receipt("p", completed.receipt.id)).toEqual(expired);
    expect(await submitTransaction(f.reopen(), request)).toEqual({
      kind: "receipt",
      receipt: expired,
    });
  });
  it("shares singleton/batch exact numeric, default and context identity through restart", async () => {
    const f = fixture();
    const singleton: TransactionSubmission = {
      ...submission(),
      carrier: { kind: "singleton", operation: "createBead" },
      body: `{"id":"beads/a","type":"${bead}","properties":{"n":1e0},"revisionProvenance":{}}`,
    };
    const original = await submitTransaction(f.store, singleton);
    const equivalent = {
      ...submission(),
      body: `{"operations":[{"operation":"createBead","id":"${scope}beads/a","type":"${bead}","properties":{"n":1.00},"metadata":{}}]}`,
    };
    expect(await submitTransaction(f.store, equivalent)).toEqual(original);
    expect(await submitTransaction(f.reopen(), equivalent)).toEqual(original);
    expect(
      await submitTransaction(f.store, {
        ...equivalent,
        body: equivalent.body.replace("1.00", "2"),
        receiving: { acceptsJson: false, maximumOperations: 1 },
      }),
    ).toMatchObject({ code: "idempotency-conflict" });
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("joins overlapping calls through one pending receipt without second execution", async () => {
    const f = fixture(),
      request = submission();
    const [a, b] = await Promise.all([
      submitTransaction(f.store, request),
      submitTransaction(f.store, request),
    ]);
    expect(a.kind).toBe("receipt");
    expect(b.kind).toBe("receipt");
    if (a.kind !== "receipt" || b.kind !== "receipt") throw new Error("expected receipt");
    expect(a.receipt.id).toBe(b.receipt.id);
    expect(f.store.inspect().groups).toHaveLength(1);
    expect(await submitTransaction(f.store, request)).toMatchObject({
      receipt: { id: a.receipt.id, status: "completed" },
    });
  });
  it("keeps unresolved comparison ahead of negotiation, then snapshots immutable controls", async () => {
    const f = fixture(),
      attempt = dependencies(f.store),
      controls = { acceptsJson: false, maximumOperations: 1 };
    let now = 0,
      waits = 0;
    const result = await submitTransaction(
      f.store,
      { ...dependent(), receiving: controls },
      {
        budgetMs: 5,
        now: () => now,
        wait: async () => {
          waits++;
          now++;
          controls.acceptsJson = true;
          controls.maximumOperations = 100;
          f.store.nextSequence(attempt);
        },
      },
    );
    expect(result).toEqual({ kind: "not-acceptable" });
    expect(waits).toBe(1);
    expect(f.store.inspect().resources).toHaveLength(1);
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed" },
    });
  });
  it("returns a provable unresolved conflict immediately and times out possible equality without disclosing a receipt", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    const mismatch = dependent();
    expect(
      await submitTransaction(
        f.store,
        {
          ...mismatch,
          body: mismatch.body.replace('"type":', '"metadata":{"extra":1},"type":'),
          receiving: { acceptsJson: false, maximumOperations: 1 },
        },
        {
          wait: async () => {
            throw new Error("must not wait");
          },
        },
      ),
    ).toMatchObject({ code: "idempotency-conflict" });
    let now = 0;
    expect(
      await submitTransaction(
        f.store,
        { ...dependent(), receiving: { acceptsJson: false, maximumOperations: 1 } },
        {
          budgetMs: 2,
          now: () => now,
          wait: async () => {
            now++;
          },
        },
      ),
    ).toEqual({
      kind: "refused",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      receipt: { status: "completed" },
    });
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      receipt: { status: "completed" },
    });
  });
  it("rechecks fresh negotiation after unresolved retraction without capturing a replacement key", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    let now = 0;
    expect(
      await submitTransaction(
        f.store,
        { ...dependent(), receiving: { acceptsJson: false, maximumOperations: 1 } },
        {
          budgetMs: 5,
          now: () => now,
          wait: async () => {
            now++;
            f.store.cancelSequence(attempt);
          },
        },
      ),
    ).toEqual({ kind: "not-acceptable" });
    expect(f.store.inspect().resources).toEqual([]);
    const claim = own(f.store, dependent());
    expect(claim.receipt.status).toBe("pending");
    f.store.retract(claim);
  });
  it("rejects invalid controls before waiting or consulting state", async () => {
    const f = fixture();
    await expect(
      submitTransaction(f.store, {
        ...submission(),
        receiving: { acceptsJson: true, maximumOperations: 0 },
      }),
    ).rejects.toThrow("receiving controls");
    f.store.retract(own(f.store));
  });
  it("retains original alias witnesses across repointing and canonical retry", async () => {
    const f = fixture();
    await submitTransaction(f.store, submission([create(), create("b")], "seed"));
    const put = (target: string, key: string): TransactionSubmission => ({
      ...submission([], key),
      carrier: { kind: "singleton", operation: "putAlias" },
      body: JSON.stringify({ alias: "alias/current", target }),
    });
    await submitTransaction(f.store, put("beads/a", "put"));
    const update = submission(
      [
        {
          operation: "updateBead",
          bead: "alias/current",
          propertiesChange: [{ op: "add", path: "/n", value: 1 }],
        },
      ],
      "update",
    );
    const original = await submitTransaction(f.store, update);
    expect(original).toMatchObject({ receipt: { status: "completed" } });
    await submitTransaction(f.store, put("beads/b", "repoint"));
    expect(await submitTransaction(f.store, update)).toEqual(original);
    expect(
      await submitTransaction(f.store, {
        ...update,
        body: update.body.replace("alias/current", "beads/a"),
      }),
    ).toEqual(original);
    expect(
      await submitTransaction(f.store, {
        ...update,
        body: update.body.replace("alias/current", "beads/b"),
        receiving: { acceptsJson: false, maximumOperations: 1 },
      }),
    ).toMatchObject({ code: "idempotency-conflict" });
    expect(f.store.aliasTarget("current")).toBe(`${scope}beads/b`);
    expect(f.store.inspect().groups).toHaveLength(2);
  });
  it("keeps a single comparison deadline across repeated owner replacement and stops at epoch change", async () => {
    const f = fixture();
    let attempt = dependencies(f.store),
      now = 0;
    expect(
      await submitTransaction(f.store, dependent(), {
        budgetMs: 3,
        now: () => now,
        wait: async () => {
          now++;
          f.store.cancelSequence(attempt);
          attempt = dependencies(f.store);
        },
      }),
    ).toMatchObject({ code: "temporarily-unavailable", status: 503 });
    expect(now).toBe(3);
    expect(f.store.inspect().resources).toEqual([]);
    let epoch = f.store.scopeEpoch;
    const observed = { ...f.store, comparisonEpoch: () => epoch };
    expect(
      await submitTransaction(observed, dependent(), {
        budgetMs: 3,
        now: () => 0,
        wait: async () => {
          epoch = "different-epoch";
        },
      }),
    ).toMatchObject({ code: "temporarily-unavailable", status: 503 });
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      receipt: { status: "completed" },
    });
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      receipt: { status: "completed" },
    });
  });
  it("does not hide original and cleanup causes or retain a new disposition after injected admission failure", async () => {
    let armed = true;
    const f = fixture({
      fault(stage) {
        if (armed && stage === "after-admission") throw new Error("original admission fault");
      },
    });
    await expect(submitTransaction(f.store, submission())).rejects.toThrow(
      "original admission fault",
    );
    armed = false;
    expect(f.store.inspect().resources).toEqual([]);
    expect(await submitTransaction(f.store, submission())).toMatchObject({
      receipt: { status: "completed" },
    });
    let cleanupFailure = false;
    const broken = fixture({
      fault(stage) {
        if (stage === "after-effects") {
          cleanupFailure = true;
          throw new Error("original execution fault");
        }
      },
    });
    const actual = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (cleanupFailure && sql === "BEGIN IMMEDIATE") throw new Error("cleanup storage fault");
      actual.call(this, sql);
    });
    function messages(error: unknown, path = new Set<Error>()): string[] {
      if (!(error instanceof Error)) return [];
      expect(path.has(error)).toBe(false);
      const next = new Set(path).add(error);
      return [
        error.message,
        ...messages(error.cause, next),
        ...(error instanceof AggregateError ? error.errors.flatMap((e) => messages(e, next)) : []),
      ];
    }
    try {
      const failure = await submitTransaction(broken.store, submission()).catch((error) => error);
      expect(messages(failure)).toContain("original execution fault");
      expect(messages(failure)).toContain("cleanup storage fault");
      const later = await submitTransaction(broken.store, submission()).catch((error) => error);
      expect(messages(later)).toContain("original execution fault");
      expect(messages(later)).toContain("cleanup storage fault");
    } finally {
      spy.mockRestore();
    }
    expect(broken.reopen().recoveredPending).toBe(1);
    expect(broken.store.inspect().resources).toEqual([]);
  });
});
