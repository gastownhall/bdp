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
  it("keeps unsupported Selectors and excessive private depth distinct from protocol malformed", async () => {
    const f = fixture();
    expect(
      await submitTransaction(
        f.store,
        submission([{ operation: "deleteWhere", collection: "beads", selector: "$..*" }]),
      ),
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

describe("valid private set admission", () => {
  const set = { operation: "deleteWhere", collection: "beads", selector: "$[?@.id]" };
  it.each(["batch", "singleton"] as const)(
    "checks complete shape/key and principal before %s Selector gap",
    async (carrier) => {
      const f = fixture();
      const request = (key: string): TransactionSubmission => ({
        ...submission([], key),
        carrier:
          carrier === "batch" ? { kind: "batch" } : { kind: "singleton", operation: "deleteWhere" },
        body: JSON.stringify(
          carrier === "batch"
            ? { operations: [{ ...set, selector: "$..*" }, create()] }
            : { collection: "beads", selector: "$..*" },
        ),
      });
      for (const [authorization, code] of [
        [{ kind: "unauthenticated" }, "unauthenticated"],
        [{ kind: "forbidden" }, "forbidden"],
      ] as const) {
        const before = f.store.inspect();
        const key = `${carrier}_${code}`;
        expect(await submitTransaction(f.store, { ...request(key), authorization })).toMatchObject({
          kind: "refused",
          code,
        });
        expect(
          await submitTransaction(f.store, { ...request("bad key"), authorization }),
        ).toMatchObject({ kind: "refused", code: "malformed-request" });
        expect(f.store.inspect()).toEqual(before);
        expect(await submitTransaction(f.store, submission([create(key)], key))).toMatchObject({
          kind: "receipt",
          receipt: { status: "completed" },
        });
      }
      expect(await submitTransaction(f.store, request("supported_auth"))).toMatchObject({
        kind: "development-limit",
      });
      expect(
        await submitTransaction(f.store, submission([create("after_gap")], "supported_auth")),
      ).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
      expect(
        await submitTransaction(f.store, {
          ...submission([
            { ...set, selector: "$..*" },
            { ...set, cardinality: {} },
          ]),
          authorization: { kind: "unauthenticated" },
        }),
      ).toMatchObject({ code: "malformed-request" });
    },
  );
  it("separates cardinality syntax, numeric admission and guarded failure, preserving original pointers on replay/reopen", async () => {
    const f = fixture();
    for (const cardinality of [{}, { min: -1 }, { min: 1.5 }]) {
      expect(
        await submitTransaction(f.store, submission([{ ...set, cardinality }], "shape")),
      ).toMatchObject({ kind: "refused", status: 400 });
      expect(f.store.inspect()).toMatchObject({ resources: [], groups: [] });
    }
    expect(await submitTransaction(f.store, submission([create()], "shape"))).toMatchObject({
      receipt: { status: "completed" },
    });
    for (const [literal, code, status] of [
      ["9007199254740993", "validation-failed", 422],
      ["1e30", "cardinality-violated", 409],
    ] as const) {
      for (const singletonFirst of [true, false]) {
        const key = `${code}_${singletonFirst}`;
        const input = `{ "collection":"beads", "selector":"$[?@.id]", "cardinality":{"min":${literal}} }`;
        const singleton: TransactionSubmission = {
          ...submission([], key),
          carrier: { kind: "singleton", operation: "deleteWhere" },
          body: input,
        };
        const wrapped: TransactionSubmission = {
          ...submission([], key),
          body: `{"operations":[{"operation":"deleteWhere",${input.slice(input.indexOf('"collection"'))}]}`,
        };
        const first = await submitTransaction(f.store, singletonFirst ? singleton : wrapped);
        expect(first).toMatchObject({
          kind: "receipt",
          receipt: {
            status: "failed",
            problem: {
              code,
              status,
              operationIndex: 0,
              pointer: `${singletonFirst ? "" : "/operations/0"}/cardinality/min`,
            },
          },
        });
        f.reopen();
        expect(await submitTransaction(f.store, singletonFirst ? wrapped : singleton)).toEqual(
          first,
        );
      }
    }
    expect(
      await submitTransaction(
        f.store,
        submission([{ ...set, cardinality: { min: 5, max: 2 } }], "inverted"),
      ),
    ).toMatchObject({
      receipt: {
        problem: { code: "cardinality-violated", pointer: "/operations/0/cardinality/min" },
      },
    });
    const largeMax = {
      ...submission([], "large_max"),
      body: '{"operations":[{"operation":"deleteWhere","collection":"beads","selector":"$[?@.id]","cardinality":{"max":1e30}}]}',
    };
    const completed = await submitTransaction(f.store, largeMax);
    expect(completed).toMatchObject({ receipt: { status: "completed" } });
    expect(
      await submitTransaction(f.store, {
        ...largeMax,
        body: largeMax.body.replace("1e30", "1e+30"),
      }),
    ).toEqual(completed);
  });
  it("maps known numeric failure at the original outer index and rolls back staged work", async () => {
    const f = fixture();
    const request = submission([create("a"), create("b"), { ...set, cardinality: { min: 0 } }]);
    const result = await submitTransaction(f.store, {
      ...request,
      body: request.body.replace('"min":0', '"min":9007199254740993'),
    });
    expect(result).toMatchObject({
      receipt: {
        status: "failed",
        problem: {
          operationIndex: 2,
          pointer: "/operations/2/cardinality/min",
          diagnostics: [{ message: "unsupported number at request location /cardinality/min" }],
        },
      },
    });
    expect(f.store.inspect()).toMatchObject({ resources: [], groups: [] });
  });
  it("uses the same depth boundary for singleton and wrapped set content", async () => {
    const f = fixture();
    for (const [depth, kind] of [
      [27, "receipt"],
      [28, "development-limit"],
    ] as const) {
      let value: unknown = 0;
      for (let i = 0; i < depth; i++) value = { nested: value };
      const input = {
        collection: "beads",
        selector: "$[?@.id]",
        change: [{ op: "add", path: "/deep", value }],
      };
      for (const singleton of [true, false]) {
        const request: TransactionSubmission = {
          ...submission([], `depth_${depth}_${singleton}`),
          carrier: singleton ? { kind: "singleton", operation: "updateWhere" } : { kind: "batch" },
          body: JSON.stringify(
            singleton ? input : { operations: [{ operation: "updateWhere", ...input }] },
          ),
        };
        expect(await submitTransaction(f.store, request)).toMatchObject({ kind });
      }
    }
  });
});

it.each([true, false])(
  "keeps Property Change locations in the original carrier (singleton=%s)",
  async (singleton) => {
    const f = fixture();
    await submitTransaction(f.store, submission([{ ...create(), properties: { n: 0 } }], "seed"));
    for (const repeated of [false, true]) {
      const change = repeated
        ? [
            { op: "remove", path: "/n" },
            { op: "remove", path: "/n" },
          ]
        : [{ op: "remove", path: "/missing" }];
      const input = { collection: "beads", selector: "$[?@.id]", change };
      const request: TransactionSubmission = {
        ...submission([], `patch_${repeated}`),
        carrier: singleton ? { kind: "singleton", operation: "updateWhere" } : { kind: "batch" },
        body: JSON.stringify(
          singleton ? input : { operations: [{ operation: "updateWhere", ...input }] },
        ),
      };
      const before = f.store.inspect();
      const result = await submitTransaction(f.store, request);
      expect(result).toMatchObject({
        receipt: {
          status: "failed",
          problem: {
            code: "validation-failed",
            pointer: `${singleton ? "" : "/operations/0"}/change${repeated ? "" : "/0/path"}`,
            diagnostics: [{ instanceLocation: repeated ? "/n" : "/missing" }],
          },
        },
      });
      expect(f.store.inspect().resources).toEqual(before.resources);
      expect(f.store.inspect().groups).toEqual(before.groups);
    }
  },
);

it("counts every outer set before negotiation while retained sets bypass fresh operation capacity", async () => {
  const f = fixture();
  const operations = [
    { operation: "deleteWhere", collection: "beads", selector: "$[?@.id]" },
    { operation: "deleteWhere", collection: "links", selector: "$[?@.id]" },
  ];
  const request = submission(operations);
  expect(
    await submitTransaction(f.store, {
      ...request,
      receiving: { acceptsJson: false, maximumOperations: 1 },
    }),
  ).toMatchObject({ kind: "refused", code: "limit-exceeded", limit: "transaction.operations" });
  expect(
    await submitTransaction(f.store, {
      ...request,
      receiving: { acceptsJson: false, maximumOperations: 2 },
    }),
  ).toEqual({ kind: "not-acceptable" });
  const claim = own(f.store, request);
  expect(
    await submitTransaction(f.store, {
      ...request,
      receiving: { acceptsJson: true, maximumOperations: 1 },
    }),
  ).toMatchObject({ kind: "receipt", receipt: claim.receipt });
  const receipt = f.store.execute(claim);
  expect(receipt).toMatchObject({
    status: "completed",
    results: [
      { outcome: "matched", count: 0 },
      { outcome: "matched", count: 0 },
    ],
  });
  expect(
    await submitTransaction(f.store, {
      ...request,
      receiving: { acceptsJson: true, maximumOperations: 1 },
    }),
  ).toEqual({ kind: "receipt", receipt });
  expect(f.store.inspect().groups).toEqual([]);
});

it("charges actual singleton bytes rather than its synthetic batch wrapper", async () => {
  const f = fixture();
  const template = {
    collection: "beads",
    selector: "$[?@.id]",
    change: [{ op: "add", path: "/padding", value: "" }],
  };
  const overhead = Buffer.byteLength(JSON.stringify(template));
  const input = {
    ...template,
    change: [{ ...template.change[0], value: "x".repeat(65536 - overhead) }],
  };
  const text = JSON.stringify(input);
  expect(Buffer.byteLength(text)).toBe(65536);
  expect(
    await submitTransaction(f.store, {
      ...submission(),
      carrier: { kind: "singleton", operation: "updateWhere" },
      body: text,
    }),
  ).toMatchObject({
    kind: "receipt",
    receipt: { status: "completed", results: [{ outcome: "matched", count: 0 }] },
  });
  expect(
    await submitTransaction(
      f.store,
      submission([{ operation: "updateWhere", ...input }], "real_batch"),
    ),
  ).toMatchObject({ kind: "refused", status: 413, code: "request-too-large" });
});

it.each(["batch", "singleton"] as const)(
  "finishes %s synthetic syntax before depth, including deeply nested received input",
  async (kind) => {
    const f = fixture();
    const nested = `${"[".repeat(20000)}1e+30${"]".repeat(20000)}`;
    const input = `{"collection":"beads","selector":"$[?@.id]","change":[{"op":"add","path":"/deep","value":${nested}}]}`;
    const wrap = (text: string) =>
      kind === "singleton" ? text : `{"operations":[{"operation":"updateWhere",${text.slice(1)}]}`;
    const request: TransactionSubmission = {
      ...submission([], "deep_key"),
      carrier: kind === "singleton" ? { kind, operation: "updateWhere" } : { kind },
      body: wrap(input),
    };
    const before = f.store.inspect();
    expect(Buffer.byteLength(request.body)).toBeLessThan(65536);
    expect(await submitTransaction(f.store, request)).toMatchObject({ kind: "development-limit" });
    expect(await submitTransaction(f.store, { ...request, key: "bad key" })).toMatchObject({
      kind: "refused",
      status: 400,
    });
    for (const authorization of [{ kind: "unauthenticated" }, { kind: "forbidden" }] as const) {
      expect(await submitTransaction(f.store, { ...request, authorization })).toMatchObject({
        kind: "refused",
        status: authorization.kind === "unauthenticated" ? 401 : 403,
      });
    }
    const malformed = input.replace('"path":"/deep"', '"path":false');
    expect(await submitTransaction(f.store, { ...request, body: wrap(malformed) })).toMatchObject({
      kind: "refused",
      status: 400,
    });
    expect(f.store.inspect()).toEqual(before);
    expect(await submitTransaction(f.store, submission([create()], "deep_key"))).toMatchObject({
      kind: "receipt",
    });
  },
);

it.each(["operation", "name", "idempotencyKey", "extra"])(
  "keeps raw singleton %s fields closed without letting a body discriminator replace the route",
  async (field) => {
    const f = fixture();
    for (const operation of ["updateWhere", "deleteWhere"] as const) {
      const before = f.store.inspect();
      expect(
        await submitTransaction(f.store, {
          ...submission([], "closed"),
          carrier: { kind: "singleton", operation },
          body: JSON.stringify({
            collection: "beads",
            selector: "$[?@.id]",
            ...(operation === "updateWhere"
              ? { change: [{ op: "add", path: "/n", value: 1 }] }
              : {}),
            [field]: "deleteWhere",
          }),
        }),
      ).toMatchObject({ kind: "refused", status: 400 });
      expect(f.store.inspect()).toEqual(before);
    }
  },
);

it("propagates observed direct refusal context without changing admission precedence or key reuse", async () => {
  const f = fixture({ clock: () => 1000 });
  const original = submission();
  const first = await submitTransaction(f.store, original, {}, true);
  if (first.kind !== "receipt") throw new Error("missing seed receipt");
  await submitTransaction(f.store, submission([create("b")], "advance"));
  const context = {
    scopeEpoch: first.receipt.scopeEpoch,
    authorizationView: first.receipt.authorizationView,
    scopePosition: "pos-2",
  };
  const before = f.store.inspect();
  const conflict = await submitTransaction(
    f.store,
    { ...submission([create("other")]), receiving: { acceptsJson: false, maximumOperations: 1 } },
    {},
    true,
  );
  expect(conflict).toEqual({ kind: "refused", status: 409, code: "idempotency-conflict", context });
  const capacityRequest = submission([create("c"), create("d")], "fresh-capacity");
  expect(
    await submitTransaction(
      f.store,
      { ...capacityRequest, receiving: { acceptsJson: false, maximumOperations: 1 } },
      {},
      true,
    ),
  ).toEqual({
    kind: "refused",
    status: 413,
    code: "limit-exceeded",
    limit: "transaction.operations",
    context,
  });
  const fresh = submission([create("e")], "fresh-negotiation");
  for (const request of [fresh, original]) {
    const refusal = await submitTransaction(
      f.store,
      { ...request, receiving: { acceptsJson: false, maximumOperations: 1 } },
      {},
      true,
    );
    expect(refusal).toEqual({ kind: "not-acceptable", context });
    if (refusal.kind !== "not-acceptable") throw new Error("missing negotiation refusal");
    expect(Object.isFrozen(refusal.context)).toBe(true);
  }
  expect(f.store.inspect()).toEqual(before);
  expect(f.store.receipt("p", first.receipt.id)).toEqual(first.receipt);
  // Equal replay ignores fresh capacity, and neither fresh refusal bound its key.
  const large = submission([create("x"), create("y")], "large");
  const completed = await submitTransaction(f.store, large, {}, true);
  const replay = await submitTransaction(
    f.store,
    { ...large, receiving: { acceptsJson: true, maximumOperations: 1 } },
    {},
    true,
  );
  expect(replay).toEqual(completed);
  expect(await submitTransaction(f.store, capacityRequest, {}, true)).toMatchObject({
    kind: "receipt",
    receipt: { status: "completed" },
  });
  expect(await submitTransaction(f.store, fresh, {}, true)).toMatchObject({
    kind: "receipt",
    receipt: { status: "completed" },
  });
});

it("uses the final observed refusal entry after a dependency wait and an unrelated commit", async () => {
  const f = fixture({ clock: () => 1000 });
  const attempt = dependencies(f.store);
  let now = 0,
    waits = 0;
  const result = await submitTransaction(
    f.store,
    { ...dependent(), receiving: { acceptsJson: false, maximumOperations: 1 } },
    {
      budgetMs: 5,
      now: () => now,
      wait: async () => {
        waits++;
        now++;
        f.store.nextSequence(attempt);
        f.store.execute(own(f.store, submission([create("unrelated")], "unrelated")));
      },
    },
    true,
  );
  expect(waits).toBe(1);
  expect(result).toEqual({
    kind: "not-acceptable",
    context: {
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: f.store.readConfiguration().authorizationView,
      scopePosition: "pos-2",
    },
  });
  expect(f.store.nextSequence(attempt).result).toMatchObject({
    kind: "receipt",
    receipt: { status: "completed" },
  });
});

it("keeps observed provable dependency conflicts ahead of negotiation", async () => {
  const f = fixture({ clock: () => 1000 });
  const seed = f.store.execute(own(f.store, submission([create("seed")], "seed")));
  f.store.execute(own(f.store, submission([create("advance")], "advance")));
  const attempt = dependencies(f.store);
  const request = dependent();
  expect(
    await submitTransaction(
      f.store,
      {
        ...request,
        body: request.body.replace('"type":', '"metadata":{"extra":1},"type":'),
        receiving: { acceptsJson: false, maximumOperations: 1 },
      },
      {
        wait: async () => {
          throw new Error("provable conflict must not wait");
        },
      },
      true,
    ),
  ).toEqual({
    kind: "refused",
    status: 409,
    code: "idempotency-conflict",
    context: {
      scopeEpoch: seed.scopeEpoch,
      authorizationView: seed.authorizationView,
      scopePosition: "pos-2",
    },
  });
  f.store.cancelSequence(attempt);
});

describe("observed comparison deadline submission", () => {
  it("captures current comparison context only at the observed deadline", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    let now = 0,
      waits = 0;
    const observe = vi.fn(f.store.observeComparisonDeadline),
      admitObserved = vi.fn(f.store.admitObserved);
    const owner = { ...f.store, observeComparisonDeadline: observe, admitObserved };
    const before = f.store.observeComparisonDeadline(f.store.scopeEpoch);
    const result = await submitTransaction(
      owner,
      dependent(),
      {
        budgetMs: 2,
        now: () => now,
        wait: async () => {
          waits++;
          expect(observe).not.toHaveBeenCalled();
          expect(
            await submitTransaction(f.store, submission([create("b")], "independent")),
          ).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
          now = 2;
        },
      },
      true,
    );
    expect(result, "observed deadline shape and currency").toStrictEqual({
      kind: "comparison-refusal",
      reason: "deadline",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
      context: {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-1",
      },
    });
    expect(before).toMatchObject({ context: { scopePosition: "pos-0" } });
    expect(waits).toBe(1);
    expect(admitObserved).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledExactlyOnceWith(f.store.scopeEpoch);
    expect(f.store.cancelSequence(attempt)).toBe(2);
  });
  it("distinguishes defensive comparison epoch stop before deadline observation", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    let epoch = f.store.scopeEpoch,
      waits = 0;
    const observe = vi.fn(f.store.observeComparisonDeadline),
      admitObserved = vi.fn(f.store.admitObserved);
    const owner = {
      ...f.store,
      comparisonEpoch: () => epoch,
      observeComparisonDeadline: observe,
      admitObserved,
    };
    expect(
      await submitTransaction(
        owner,
        dependent(),
        {
          budgetMs: 2,
          now: () => 0,
          wait: async () => {
            waits++;
            epoch = "different-epoch";
          },
        },
        true,
      ),
    ).toStrictEqual({
      kind: "comparison-refusal",
      reason: "owner-stopped",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    expect(waits).toBe(1);
    expect(admitObserved).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
    expect(f.store.cancelSequence(attempt)).toBe(2);
  });
  it("keeps full-owner unobserved comparison exact and excludes a caller callback", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    let now = 0;
    const observe = vi.fn(f.store.observeComparisonDeadline),
      supplied = vi.fn(() => {
        throw new Error("caller observation forbidden");
      });
    // Structural extra field models untyped input; it must not become configuration.
    const comparison = {
      budgetMs: 2,
      now: () => now,
      wait: async () => {
        now = 2;
      },
      observeDeadline: supplied,
    };
    expect(
      await submitTransaction(
        { ...f.store, observeComparisonDeadline: observe },
        dependent(),
        comparison,
      ),
      "legacy comparison result exact",
    ).toStrictEqual({
      kind: "refused",
      status: 503,
      code: "temporarily-unavailable",
      retry: "after-delay",
    });
    expect(observe, "unobserved callback absent").not.toHaveBeenCalled();
    expect(supplied, "untyped callback excluded").not.toHaveBeenCalled();
    expect(f.store.cancelSequence(attempt)).toBe(2);
  });
});
