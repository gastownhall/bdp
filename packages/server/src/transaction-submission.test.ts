import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import {
  prepareTransaction,
  prepareTransactionSingleton,
  normalizeTransaction,
  prepareTransactionSequence,
  prepareTransactionForReceiving,
} from "./transaction-batch.js";
import * as setCore from "./transaction-set.js";
import { submitTransaction, type TransactionSubmission } from "./transaction-submission.js";
import { compileDevelopmentContracts } from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { dependencyTemplate } from "./transaction-dependencies.js";
import { createTransactionSequenceStepper } from "./transaction-sequence.js";
const scope = "https://example.test/submission/",
  bead = "https://example.test/bead",
  link = "https://example.test/link";
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
  it("keeps invalid Selector grammar distinct from valid deep input", async () => {
    const f = fixture();
    expect(
      await submitTransaction(
        f.store,
        submission([{ operation: "deleteWhere", collection: "beads", selector: "$..*" }]),
      ),
    ).toMatchObject({
      kind: "refused",
      status: 400,
      code: "malformed-request",
      pointer: "/operations/0/selector",
    });
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(
      await submitTransaction(f.store, submission([{ ...create(), properties: { deep } }])),
    ).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
    expect(f.store.inspect().resources).toHaveLength(1);
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
    "checks complete %s Selector grammar before principal while preserving key reuse",
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
        expect(
          await submitTransaction(f.store, {
            ...request(key),
            body: request(key).body.replace("$..*", selectorBodyBytes(4097)),
            authorization,
          }),
        ).toMatchObject({ kind: "refused", code });
        expect(
          await submitTransaction(f.store, { ...request("bad key"), authorization }),
        ).toMatchObject({
          kind: "refused",
          code: "malformed-request",
          pointer: carrier === "batch" ? "/operations/0/selector" : "/selector",
        });
        expect(f.store.inspect()).toEqual(before);
        expect(await submitTransaction(f.store, submission([create(key)], key))).toMatchObject({
          kind: "receipt",
          receipt: { status: "completed" },
        });
      }
      expect(await submitTransaction(f.store, request("supported_auth"))).toMatchObject({
        kind: "refused",
        status: 400,
        code: "malformed-request",
        pointer: carrier === "batch" ? "/operations/0/selector" : "/selector",
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
  it("accepts byte-bounded singleton and wrapped set content across the former depth boundary", async () => {
    const f = fixture();
    for (const depth of [27, 28]) {
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
        expect(await submitTransaction(f.store, request)).toMatchObject({
          kind: "receipt",
          receipt: { status: "completed", results: [{ outcome: "matched", count: 0 }] },
        });
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
  "finishes %s synthetic syntax before admission, including deeply nested received input",
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
    expect(await submitTransaction(f.store, request)).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed" },
    });
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
    expect(f.store.inspect().resources).toEqual(before.resources);
    expect(f.store.inspect().groups).toEqual(before.groups);
    expect(f.store.inspect().position).toBe(before.position);
    expect(f.store.inspect().identities).toEqual(before.identities);
    expect(await submitTransaction(f.store, submission([create()], "deep_key"))).toMatchObject({
      kind: "refused",
      status: 409,
      code: "idempotency-conflict",
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
  it.each([false, true])(
    "propagates closed maintenance faults before admission (observed=%s)",
    async (observed) => {
      const original = new Error("submission background maintenance fault");
      let inject = false;
      let faultCalls = 0;
      let f: ReturnType<typeof fixture> | undefined;
      const failures: unknown[] = [];
      vi.useFakeTimers();
      try {
        // No reservations: the failed epoch observation must precede admission.
        f = fixture({
          maintenanceIntervalMs: 25,
          fault(stage) {
            if (inject && stage === "before-maintenance-commit") {
              faultCalls++;
              throw original;
            }
          },
        });
        const store = f.store;
        const admit = vi.fn(f.store.admit),
          admitObserved = vi.fn(f.store.admitObserved),
          observe = vi.fn(f.store.observeComparisonDeadline),
          wait = vi.fn(async () => {});
        // The real owner is frozen; delegates preserve its closure-backed faults.
        const owner = {
          ...f.store,
          admit: ((...args: Parameters<typeof store.admit>) =>
            admit(...args)) as typeof store.admit,
          admitObserved,
          observeComparisonDeadline: observe,
        };
        expect(vi.getTimerCount()).toBe(1);
        inject = true;
        vi.advanceTimersByTime(25);
        inject = false;
        expect(faultCalls).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
        await expect(
          submitTransaction(owner, submission(), { wait }, observed),
          "maintenance fault rejects before admission",
        ).rejects.toMatchObject({
          message: "transaction maintenance failed; owner fenced",
          cause: original,
        });
        expect(admit).not.toHaveBeenCalled();
        expect(admitObserved).not.toHaveBeenCalled();
        expect(observe).not.toHaveBeenCalled();
        expect(wait).not.toHaveBeenCalled();
      } catch (error) {
        failures.push(error);
      } finally {
        inject = false;
        try {
          f?.store.close();
        } catch (error) {
          failures.push(error);
        } finally {
          vi.useRealTimers();
        }
      }
      if (failures.length)
        throw new AggregateError(failures, "maintenance submission assertion or cleanup failed");
    },
  );
  it.each([false, true])(
    "preserves normal closed submission shape (observed=%s)",
    async (observed) => {
      const f = fixture();
      f.store.close();
      const admit = vi.fn(f.store.admit),
        admitObserved = vi.fn(f.store.admitObserved),
        observe = vi.fn(f.store.observeComparisonDeadline),
        wait = vi.fn(async () => {});
      const owner = {
        ...f.store,
        admit: ((...args: Parameters<typeof f.store.admit>) =>
          admit(...args)) as typeof f.store.admit,
        admitObserved,
        observeComparisonDeadline: observe,
      };
      expect(await submitTransaction(owner, submission(), { wait }, observed)).toStrictEqual(
        observed
          ? {
              kind: "comparison-refusal",
              reason: "owner-stopped",
              status: 503,
              code: "temporarily-unavailable",
              retry: "after-delay",
            }
          : {
              kind: "refused",
              status: 503,
              code: "temporarily-unavailable",
              retry: "after-delay",
            },
      );
      expect(admit).not.toHaveBeenCalled();
      expect(admitObserved).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
      expect(wait).not.toHaveBeenCalled();
    },
  );
  it("distinguishes a stopped final observation at the reached comparison deadline", async () => {
    const f = fixture(),
      attempt = dependencies(f.store);
    let now = 0,
      waits = 0;
    // Defensive composition only: no supported live epoch rotation is introduced.
    const observe = vi.fn(() => ({ kind: "owner-stopped" as const })),
      admitObserved = vi.fn(f.store.admitObserved);
    try {
      expect(
        await submitTransaction(
          { ...f.store, observeComparisonDeadline: observe, admitObserved },
          dependent(),
          {
            budgetMs: 2,
            now: () => now,
            wait: async () => {
              waits++;
              expect(observe).not.toHaveBeenCalled();
              now = 2;
            },
          },
          true,
        ),
        "final stopped comparison refusal has no context",
      ).toStrictEqual({
        kind: "comparison-refusal",
        reason: "owner-stopped",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
      });
      expect(waits).toBe(1);
      expect(admitObserved).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledExactlyOnceWith(f.store.scopeEpoch);
    } finally {
      expect(f.store.cancelSequence(attempt)).toBe(2);
    }
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

const selectorBodyBytes = (n: number) => `$[?@.missing${" ".repeat(n - 13)}]`;
const selectorBodyDepth = (groups: number) =>
  `$[?${"(".repeat(groups)}@.missing${")".repeat(groups)}]`;
const selectorBodyNodes = (groups: number) => {
  let value = "@.missing";
  for (let level = 0; level < 6; level++) value = `(${value}||${value})`;
  return `$[?${"(".repeat(groups)}${value}${")".repeat(groups)}]`;
};
const deletion = (selector = "$[?@.missing]") => ({
  operation: "deleteWhere",
  collection: "beads",
  selector,
});
it("refuses invalid Selector grammar before every key state without owner admission", async () => {
  const f = fixture();
  const completed = await submitTransaction(f.store, submission([create()], "completed"));
  const pending = own(f.store, submission([create("pending")], "pending"));
  const before = f.store.inspect();
  const store = f.store;
  const admit = vi.fn((...args: Parameters<typeof store.admit>) => store.admit(...args));
  const boundary = {
    ...store,
    admit: ((...args: Parameters<typeof store.admit>) => admit(...args)) as typeof store.admit,
  };
  for (const operation of ["updateWhere", "deleteWhere"] as const)
    for (const carrier of ["singleton", "batch"] as const)
      for (const key of ["fresh", "pending", "completed"]) {
        const input = {
          collection: "beads",
          selector: "$..*",
          ...(operation === "updateWhere" ? { change: [{ op: "add", path: "/n", value: 1 }] } : {}),
        };
        const request: TransactionSubmission = {
          ...submission([], key),
          carrier: carrier === "batch" ? { kind: "batch" } : { kind: "singleton", operation },
          body: JSON.stringify(
            carrier === "batch"
              ? { operations: [create("prefix"), { operation, ...input }] }
              : input,
          ),
        };
        expect(await submitTransaction(boundary, request)).toEqual({
          kind: "refused",
          status: 400,
          code: "malformed-request",
          pointer: carrier === "batch" ? "/operations/1/selector" : "/selector",
        });
      }
  for (const authorization of [{ kind: "unauthenticated" }, { kind: "forbidden" }] as const)
    expect(
      await submitTransaction(boundary, {
        ...submission([deletion("$..*")], "bad key"),
        authorization,
      }),
    ).toEqual({
      kind: "refused",
      status: 400,
      code: "malformed-request",
      pointer: "/operations/0/selector",
    });
  expect(
    await submitTransaction(
      boundary,
      submission([deletion(selectorBodyBytes(4097)), deletion("$..*")]),
    ),
  ).toMatchObject({ status: 400, pointer: "/operations/1/selector" });
  expect(
    await submitTransaction(
      boundary,
      submission([deletion(selectorBodyBytes(4097)), { ...deletion(), cardinality: {} }]),
    ),
  ).toEqual({ kind: "refused", status: 400, code: "malformed-request" });
  expect(admit).not.toHaveBeenCalled();
  expect(f.store.inspect()).toEqual(before);
  if (completed.kind !== "receipt") throw Error("expected completed seed");
  expect(f.store.receipt("p", completed.receipt.id)).toEqual(completed.receipt);
  expect(f.store.receipt("p", pending.receipt.id)).toEqual(pending.receipt);
  f.store.retract(pending);
});
it("applies fixed Selector capacity only to fresh valid carriers before execution and negotiation", async () => {
  let admissions = 0;
  const f = fixture({
    fault(stage) {
      if (stage === "after-admission") admissions++;
    },
  });
  const before = f.store.inspect();
  const trusted = f.store.withRead((_reader, context) => context);
  if (trusted.kind !== "read") throw Error("expected owner observation");
  let accepted = 0;
  for (const [selector, limit] of [
    [selectorBodyBytes(4097), "selector.bytes"],
    [selectorBodyDepth(31), "selector.depth"],
    [selectorBodyNodes(3), "selector.nodes"],
  ] as const) {
    const request = submission([deletion(selector)], limit.replace(".", "_"));
    const refused = await submitTransaction(f.store, request, {}, true);
    expect(refused).toEqual({
      kind: "refused",
      status: 413,
      code: "limit-exceeded",
      limit,
      pointer: "/operations/0/selector",
      context: trusted.value,
    });
    expect(admissions).toBe(accepted);
    expect(f.store.inspect()).toEqual(before);
    expect(
      await submitTransaction(f.store, { ...request, body: submission([deletion()]).body }),
    ).toMatchObject({
      kind: "receipt",
      receipt: {
        status: "completed",
        requiredPosition: "pos-0",
        results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
        next: null,
      },
    });
    accepted++;
  }
  expect(
    await submitTransaction(f.store, {
      ...submission([deletion(selectorBodyBytes(4097)), deletion()], "outer"),
      receiving: { acceptsJson: false, maximumOperations: 1 },
    }),
  ).toEqual({
    kind: "refused",
    status: 413,
    code: "limit-exceeded",
    limit: "transaction.operations",
  });
  expect(
    await submitTransaction(
      f.store,
      submission(
        [{ operation: "deleteBead", bead: "beads/missing" }, deletion(selectorBodyNodes(3))],
        "later",
      ),
    ),
  ).toMatchObject({ status: 413, limit: "selector.nodes", pointer: "/operations/1/selector" });
  for (const [authorization, status] of [
    [{ kind: "unauthenticated" }, 401],
    [{ kind: "forbidden" }, 403],
  ] as const)
    expect(
      await submitTransaction(f.store, {
        ...submission([deletion(selectorBodyBytes(4097))]),
        authorization,
      }),
    ).toMatchObject({ kind: "refused", status });
  expect(
    await submitTransaction(f.store, submission([deletion(selectorBodyBytes(4097))], "bad key")),
  ).toMatchObject({ status: 400 });
  expect(
    await submitTransaction(f.store, {
      ...submission([deletion(selectorBodyBytes(4097))], "accept"),
      receiving: { acceptsJson: false, maximumOperations: 32 },
    }),
  ).toMatchObject({ status: 413, limit: "selector.bytes" });
  expect(
    await submitTransaction(f.store, {
      ...submission([deletion()], "accept"),
      receiving: { acceptsJson: false, maximumOperations: 32 },
    }),
  ).toEqual({ kind: "not-acceptable" });
  expect(await submitTransaction(f.store, submission([deletion()], "accept"))).toMatchObject({
    kind: "receipt",
    receipt: {
      status: "completed",
      requiredPosition: "pos-0",
      results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
      next: null,
    },
  });
  accepted++;
  expect(
    await submitTransaction(f.store, submission([deletion(selectorBodyDepth(10000))], "deep")),
  ).toMatchObject({ status: 413, limit: "selector.bytes" });
  for (const key of ["outer", "later", "deep", "key"]) {
    expect(await submitTransaction(f.store, submission([deletion()], key))).toMatchObject({
      kind: "receipt",
      receipt: {
        status: "completed",
        requiredPosition: "pos-0",
        results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
        next: null,
      },
    });
    accepted++;
  }
  expect(admissions).toBe(accepted);
  expect(f.store.inspect()).toEqual(before);
});
it("preserves genuine pending completed and failed receipts before Selector capacity", async () => {
  const f = fixture();
  const request = submission([deletion()], "pending");
  const claim = own(f.store, request);
  const failedRequest = submission([{ operation: "deleteBead", bead: "beads/missing" }], "failed");
  const failed = await submitTransaction(f.store, failedRequest);
  expect(failed).toMatchObject({ kind: "receipt", receipt: { status: "failed" } });
  const capacity = vi.spyOn(setCore, "transactionSelectorCapacity");
  const before = f.store.inspect();
  expect(await submitTransaction(f.store, request)).toEqual({
    kind: "receipt",
    receipt: claim.receipt,
  });
  expect(
    await submitTransaction(f.store, submission([deletion(selectorBodyBytes(4097))], "pending")),
  ).toEqual({ kind: "refused", status: 409, code: "idempotency-conflict" });
  const completed = f.store.execute(claim);
  expect(await submitTransaction(f.store, request)).toEqual({
    kind: "receipt",
    receipt: completed,
  });
  expect(await submitTransaction(f.store, failedRequest)).toEqual(failed);
  expect(
    await submitTransaction(f.store, submission([deletion(selectorBodyBytes(4097))], "failed")),
  ).toMatchObject({ status: 409 });
  expect(
    await submitTransaction(f.store, {
      ...request,
      receiving: { acceptsJson: false, maximumOperations: 32 },
    }),
  ).toEqual({ kind: "not-acceptable" });
  expect(capacity).not.toHaveBeenCalled();
  expect(f.store.inspect()).toEqual(before);
  expect(await submitTransaction(f.store, submission([deletion()], "fresh"))).toMatchObject({
    kind: "receipt",
    receipt: {
      status: "completed",
      requiredPosition: "pos-0",
      results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
      next: null,
    },
  });
  expect(capacity).toHaveBeenCalledTimes(1);
  expect(f.store.inspect()).toEqual(before);
});

it("compares retained direct keys before negotiation and admits valid fresh deep input", async () => {
  const f = fixture();
  let nested: unknown = "leaf";
  for (let i = 0; i < 40; i++) nested = { nested };
  const request = (
    kind: "batch" | "singleton",
    id: string,
    key: string,
    deep = false,
  ): TransactionSubmission => {
    const input = { id: `beads/${id}`, type: bead, ...(deep ? { metadata: { nested } } : {}) };
    return {
      ...submission([], key),
      carrier: kind === "batch" ? { kind } : { kind, operation: "createBead" },
      body: JSON.stringify(
        kind === "batch" ? { operations: [{ operation: "createBead", ...input }] } : input,
      ),
    };
  };
  const context = () => ({
    scopeEpoch: f.store.scopeEpoch,
    authorizationView: f.store.readConfiguration().authorizationView,
    scopePosition: `pos-${f.store.inspect().position}`,
  });
  let calls = 0;
  const submit = (input: TransactionSubmission) => {
    calls++;
    return submitTransaction(f.store, input, {}, true);
  };
  let batchReceipt: ReturnType<typeof f.store.receipt>;
  for (const [kind, originalId, freshId] of [
    ["batch", "a", "b"],
    ["singleton", "c", "d"],
  ] as const) {
    const key = `depth_${kind}`;
    const original = request(kind, originalId, key);
    const result = await submit(original);
    expect(result.kind).toBe("receipt");
    if (result.kind !== "receipt") throw new Error("expected genuine shallow receipt");
    expect(result.receipt.status).toBe("completed");
    expect(result.context).toEqual(context());
    if (kind === "batch") batchReceipt = result.receipt;
    const before = f.store.inspect();
    const conflicting = request(kind, originalId, key, true);
    expect(
      await submit({ ...conflicting, receiving: { acceptsJson: false, maximumOperations: 32 } }),
    ).toEqual({ kind: "refused", status: 409, code: "idempotency-conflict", context: context() });
    expect(f.store.inspect()).toEqual(before);
    expect(f.store.receipt("p", result.receipt.id)).toEqual(result.receipt);
    const replay = await submit(original);
    expect(replay).toEqual({ kind: "receipt", receipt: result.receipt, context: context() });
    expect(
      await submit({ ...original, receiving: { acceptsJson: false, maximumOperations: 32 } }),
    ).toEqual({ kind: "not-acceptable", context: context() });
    expect(f.store.inspect()).toEqual(before);
    expect(f.store.receipt("p", result.receipt.id)).toEqual(result.receipt);
    const freshKey = `depth_fresh_${kind}`;
    expect(
      await submit({
        ...request(kind, freshId, freshKey, true),
        receiving: { acceptsJson: false, maximumOperations: 32 },
      }),
    ).toEqual({ kind: "not-acceptable", context: context() });
    expect(f.store.inspect()).toEqual(before);
    const reused = await submit(request(kind, freshId, freshKey));
    expect(reused.kind).toBe("receipt");
    if (reused.kind !== "receipt") throw new Error("fresh refused key was not reusable");
    expect(reused.receipt.status).toBe("completed");
    expect(reused.context).toEqual(context());
    expect(f.store.inspect().resources).toHaveLength(kind === "batch" ? 2 : 4);
  }
  const legacy = request("batch", "legacy", "legacy", true);
  const prepared = prepareTransactionForReceiving(scope, legacy.carrier, legacy.body);
  const legacyAdmission = f.store.admit("p", legacy.key, prepared);
  expect(legacyAdmission.kind).toBe("owned");
  if (legacyAdmission.kind !== "owned") throw new Error("deep legacy claim missing");
  expect(f.store.execute(legacyAdmission.claim).status).toBe("completed");
  const beforeLegacy = f.store.inspect();
  const stressBody = `{"operations":[{"operation":"createBead","id":"beads/a","type":"https://example.test/bead","metadata":{"deep":${"[".repeat(20000)}1e+30${"]".repeat(20000)}}}]}`;
  expect(Buffer.byteLength(stressBody)).toBe(40119);
  expect(createHash("sha256").update(stressBody).digest("hex")).toBe(
    "ddd7741aa0824790181015ee940057c7c497437d2ae998b023b61742ed61fe66",
  );
  expect(Buffer.byteLength(stressBody)).toBeLessThan(65536);
  expect(await submit({ ...request("batch", "a", "depth_batch"), body: stressBody })).toEqual({
    kind: "refused",
    status: 409,
    code: "idempotency-conflict",
    context: context(),
  });
  expect(f.store.inspect()).toEqual(beforeLegacy);
  if (!batchReceipt) throw new Error("missing saved shallow receipt");
  expect(f.store.receipt("p", batchReceipt.id)).toEqual(batchReceipt);
  expect(calls).toBe(13);
});

it("compares deep metadata against genuine pending and dependent keys without changing saved outcomes", async () => {
  const f = fixture();
  const failures: unknown[] = [];
  let pending: ReturnType<typeof own> | undefined;
  let attempt: ReturnType<typeof dependencies> | undefined;
  let calls = 0;
  const submit = (input: TransactionSubmission) => {
    calls++;
    return submitTransaction(f.store, input, {
      wait: async () => {
        throw new Error("provable conflict or saved replay must not wait");
      },
    });
  };
  let nested: unknown = "leaf";
  for (let i = 0; i < 40; i++) nested = { nested };
  try {
    const original = submission([create("pending")], "pending_direct");
    pending = own(f.store, original);
    const pendingBefore = f.store.inspect();
    expect(
      await submit({
        ...submission([{ ...create("pending"), metadata: { nested } }], original.key),
        receiving: { acceptsJson: false, maximumOperations: 32 },
      }),
    ).toEqual({ kind: "refused", status: 409, code: "idempotency-conflict" });
    expect(f.store.inspect()).toEqual(pendingBefore);
    expect(f.store.receipt("p", pending.receipt.id)).toEqual(pending.receipt);
    expect(
      await submit({ ...original, receiving: { acceptsJson: false, maximumOperations: 32 } }),
    ).toEqual({ kind: "not-acceptable" });
    expect(f.store.receipt("p", pending.receipt.id)).toEqual(pending.receipt);
    const completed = f.store.execute(pending);
    pending = undefined;
    expect(await submit(original)).toEqual({ kind: "receipt", receipt: completed });
    attempt = dependencies(f.store);
    const dependentRequest = dependent();
    const unresolved = f.store.inspect();
    const first = f.store.receipt("p", completed.id);
    expect(
      await submit({
        ...dependentRequest,
        body: JSON.stringify({
          operations: [
            {
              operation: "createLink",
              type: link,
              source: "beads/a",
              target: "beads/a",
              metadata: { nested },
            },
          ],
        }),
        receiving: { acceptsJson: false, maximumOperations: 32 },
      }),
    ).toEqual({ kind: "refused", status: 409, code: "idempotency-conflict" });
    expect(f.store.inspect()).toEqual(unresolved);
    expect(f.store.receipt("p", completed.id)).toEqual(first);
    expect(f.store.nextSequence(attempt).result).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed" },
    });
    const dependentResult = f.store.nextSequence(attempt).result;
    expect(dependentResult).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
    if (dependentResult.kind !== "receipt") throw new Error("dependent outcome missing");
    expect(await submit(dependentRequest)).toEqual({
      kind: "receipt",
      receipt: dependentResult.receipt,
    });
    expect(calls).toBe(5);
  } catch (error) {
    failures.push(error);
  } finally {
    for (const finish of [
      () => {
        if (attempt) f.store.cancelSequence(attempt);
      },
      () => {
        if (pending) f.store.retract(pending);
      },
    ]) {
      try {
        finish();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "depth-key pending ownership or cleanup failed");
});

function assertDeepSubmissionValue(actual: unknown, expected: unknown) {
  const stack: [unknown, unknown][] = [[actual, expected]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (a === b) continue;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
      throw new Error("deep submission primitive mismatch");
    if (Array.isArray(a) !== Array.isArray(b)) {
      expect(Array.isArray(a)).toBe(Array.isArray(b));
      throw new Error("deep submission array-kind mismatch");
    }
    const keys = Object.keys(a).sort();
    const expectedKeys = Object.keys(b).sort();
    if (keys.length !== expectedKeys.length || keys.some((key, i) => key !== expectedKeys[i])) {
      expect(keys).toEqual(expectedKeys);
      throw new Error("deep submission keys mismatch");
    }
    for (const key of keys)
      stack.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
  }
}
it("preserves independent deep submission oracle equality and rejection", () => {
  const nested = (leaf: string) => `${"[".repeat(12000)}${leaf}${"]".repeat(12000)}`;
  const left: unknown = JSON.parse(nested("0"));
  const right: unknown = JSON.parse(nested("0"));
  expect(() => assertDeepSubmissionValue(left, right)).not.toThrow();
  const differing: unknown = JSON.parse(nested("1"));
  expect(() => assertDeepSubmissionValue(left, differing)).toThrow(
    "deep submission primitive mismatch",
  );
  expect(() => assertDeepSubmissionValue([], {})).toThrow();
  expect(() => assertDeepSubmissionValue({ a: 1 }, { b: 1 })).toThrow();
  expect(() => assertDeepSubmissionValue({ a: 1 }, { a: 1, b: 2 })).toThrow();
  expect(() => assertDeepSubmissionValue({ a: 1, b: 2 }, { a: 1 })).toThrow();
  expect(() => assertDeepSubmissionValue(null, {})).toThrow();
  expect(() => assertDeepSubmissionValue({ a: 1, b: 2 }, { b: 2, a: 1 })).not.toThrow();
  expect(() => assertDeepSubmissionValue(-0, 0)).not.toThrow();
  expect(() =>
    assertDeepSubmissionValue(Object.assign(Object.create(null), { a: 1 }), JSON.parse('{"a":1}')),
  ).not.toThrow();
  expect(() => assertDeepSubmissionValue([1, 2], [2, 1])).toThrow();
});
function assertDeepReceiptFrozen(value: unknown) {
  const pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (node !== null && typeof node === "object") {
      if (!Object.isFrozen(node)) throw new Error("mutable nested receipt value");
      for (const child of Object.values(node)) pending.push(child);
    }
  }
}
it("executes deep values through set and dependent sequence with durable receipt recovery", () => {
  const bead = `${scope}types/deep`,
    link = `${scope}types/deep-link`;
  const started = performance.now(),
    directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-deep-"));
  const errors: unknown[] = [];
  let store: ReturnType<typeof openTransactionStore> | undefined;
  let now = 1000000;
  try {
    const schemaUri = `${scope}deep-schema`;
    const artifact = (retrievalUri: string, value: unknown) => ({
      retrievalUri,
      utf8Bytes: Buffer.from(JSON.stringify(value)),
    });
    const contracts = compileDevelopmentContracts({
      limits: CONTRACT_ARTIFACT_CEILINGS,
      descriptors: [
        artifact(bead, {
          id: bead,
          name: "Deep",
          describes: "bead",
          conformsTo: [],
          propertiesSchema: schemaUri,
        }),
        artifact(link, {
          id: link,
          name: "Link",
          describes: "link",
          conformsTo: [],
          source: { conformsTo: [bead], external: "none" },
          target: { conformsTo: [bead], external: "none" },
        }),
      ],
      schemas: [
        artifact(schemaUri, {
          $id: schemaUri,
          type: "object",
          properties: { deep: { type: "array" } },
        }),
      ],
    });
    const options = {
      file: path.join(directory, "store.sqlite"),
      scope,
      create: true,
      types: contracts.descriptors,
      contracts,
      clock: () => now,
      receiptMaximumItems: 2,
    };
    store = openTransactionStore(options);
    const deep = "[".repeat(12000) + "1" + "]".repeat(12000);
    const measured: { label: string; bodyBytes: number; identityBytes: number }[] = [];
    const execute = (key: string, body: string, singleton = false) => {
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(65536);
      const prepared = singleton
        ? prepareTransactionSingleton(scope, "createBead", body)
        : prepareTransaction(scope, body);
      measured.push({
        label: key,
        bodyBytes: Buffer.byteLength(body),
        identityBytes: Buffer.byteLength(normalizeTransaction(prepared, () => undefined).identity),
      });
      const admitted = store!.admit("p", key, prepared);
      if (admitted.kind === "existing") return admitted.receipt;
      if (admitted.kind !== "owned") throw new Error("deep submission admission");
      return store!.execute(admitted.claim);
    };
    const single = execute(
      "single",
      `{"id":"beads/s","type":"${bead}","properties":{"deep":${deep}}}`,
      true,
    );
    expect(single.status).toBe("completed");
    const singleRead = store.readReceipt("p", single.id);
    assertDeepSubmissionValue(singleRead.receipt, single);
    assertDeepReceiptFrozen(singleRead.receipt);
    const seedBody = `{"operations":[{"operation":"createBead","id":"beads/a","type":"${bead}"},{"operation":"createBead","id":"beads/b","type":"${bead}"},{"operation":"createBead","id":"beads/c","type":"${bead}","properties":{"deep":${deep}},"metadata":{"n":0}}]}`;
    const seed = execute("seed", seedBody);
    expect(seed.status).toBe("completed");
    const seedResults = seed.results as { resource: Record<string, unknown> }[];
    const original = seedResults[2]!.resource;
    assertDeepSubmissionValue(
      original,
      JSON.parse(
        `{"id":"${scope}beads/c","type":"${bead}","revision":${JSON.stringify(original.revision)},"properties":{"deep":${deep}},"metadata":{"n":0}}`,
      ),
    );
    expect(seed.id).toMatch(new RegExp(`^${scope}receipts/[0-9a-f-]{36}$`));
    expect(seed.transaction).toMatch(/^[0-9a-f-]{36}$/);
    expect(seed.expiresAt).toBe(new Date(now + 86400000).toISOString());
    const expectedSeedResults = seedResults.map((r, operationIndex) => {
      expect(typeof r.resource.revision).toBe("string");
      const id = ["a", "b", "c"][operationIndex]!;
      return {
        operationIndex,
        outcome: "created",
        resource:
          operationIndex === 2
            ? JSON.parse(
                `{"id":"${scope}beads/c","type":"${bead}","revision":${JSON.stringify(r.resource.revision)},"properties":{"deep":${deep}},"metadata":{"n":0}}`,
              )
            : {
                id: `${scope}beads/${id}`,
                type: bead,
                revision: r.resource.revision,
                properties: {},
                metadata: {},
              },
      };
    });
    assertDeepSubmissionValue(seed, {
      id: seed.id,
      status: "completed",
      detail: "available",
      idempotencyKey: "seed",
      scopeEpoch: store.scopeEpoch,
      authorizationView: store.authorizationSnapshot().authorizationView,
      transaction: seed.transaction,
      requiredPosition: "pos-2",
      effectPosition: "pos-2",
      results: expectedSeedResults,
      next: null,
      expiresAt: new Date(now + 86400000).toISOString(),
    });
    const root = store.readReceipt("p", seed.id);
    if (!root.receipt || typeof root.receipt.next !== "string")
      throw new Error("issued deep receipt page required");
    assertDeepReceiptFrozen(root.receipt);
    const pageUrl = root.receipt.next;
    const page = store.readReceiptPage("p", pageUrl);
    if (page.kind !== "page") throw new Error("deep receipt page missing");
    assertDeepSubmissionValue(page.page.results, seedResults.slice(2));
    assertDeepReceiptFrozen(page.page);
    const patched = execute(
      "patch",
      `{"operations":[{"operation":"updateBead","bead":"beads/c","propertiesChange":[{"op":"add","path":"/copy","value":${deep}},{"op":"add","path":"/deep/-","value":2}]}]}`,
    );
    expect(patched.status).toBe("completed");
    const patchedResource = (patched.results as { resource: Record<string, unknown> }[])[0]!
      .resource;
    const changedDeep = "[" + "[".repeat(11999) + "1" + "]".repeat(11999) + ",2]";
    const expectedProperties = `{"deep":${changedDeep},"copy":${deep}}`;
    assertDeepSubmissionValue(
      patchedResource,
      JSON.parse(
        `{"id":"${scope}beads/c","type":"${bead}","revision":${JSON.stringify(patchedResource.revision)},"properties":${expectedProperties},"metadata":{"n":0}}`,
      ),
    );
    const beforeNoop = store.inspect();
    const noop = execute(
      "noop",
      `{"operations":[{"operation":"updateBead","bead":"beads/c","propertiesChange":[{"op":"replace","path":"","value":{"copy":${deep},"deep":${changedDeep}}}],"metadataChange":[{"op":"replace","path":"/n","value":-0.0}]}]}`,
    );
    expect(noop.status).toBe("completed");
    assertDeepSubmissionValue(
      (noop.results as { resource: unknown }[])[0]!.resource,
      patchedResource,
    );
    expect(store.inspect().position).toBe(beforeNoop.position);
    assertDeepSubmissionValue(store.inspect().groups, beforeNoop.groups);
    const afterNoop = store.inspect();
    assertDeepSubmissionValue(afterNoop.resources, beforeNoop.resources);
    for (const [index, resource] of afterNoop.resources.entries()) {
      const before = beforeNoop.resources[index] as { properties: object };
      expect(Object.keys((resource as { properties: object }).properties)).toEqual(
        Object.keys(before.properties),
      );
    }
    const selected = execute(
      "set",
      '{"operations":[{"operation":"updateWhere","collection":"beads","selector":"$[?@.id]","change":[{"op":"add","path":"/selected","value":true}]}]}',
    );
    expect(selected.status).toBe("completed");
    expect((selected.results as { count: number }[])[0]!.count).toBe(4);
    const sequenceBody = `{"operations":[{"operation":"createBead","name":"made","idempotencyKey":"made","type":"${bead}","properties":{"deep":${deep}}},{"operation":"createLink","idempotencyKey":"linked","type":"${link}","source":"@made","target":"@made","properties":{"deep":${deep}}}]}`;
    expect(Buffer.byteLength(sequenceBody)).toBeLessThanOrEqual(65536);
    const preparedSequence = prepareTransactionSequence(scope, sequenceBody);
    for (const member of preparedSequence.members)
      measured.push({
        label: member.key,
        bodyBytes: Buffer.byteLength(sequenceBody),
        identityBytes: Buffer.byteLength(
          member.deferred
            ? dependencyTemplate("measurement-only", member).identity
            : normalizeTransaction(member.request, () => undefined).identity,
        ),
      });
    const stepper = createTransactionSequenceStepper(store, "p", preparedSequence);
    const first = stepper.step();
    const createdId = String((first.entry.resource as { id: string }).id);
    const deferredMember = preparedSequence.members[1]!;
    measured.push({
      label: "linked-resolved",
      bodyBytes: Buffer.byteLength(sequenceBody),
      identityBytes: Buffer.byteLength(
        normalizeTransaction(
          deferredMember.request,
          () => undefined,
          undefined,
          new Map(deferredMember.dependencies.map((d) => [d.field, createdId])),
        ).identity,
      ),
    });
    const second = stepper.step();
    expect(first.entry.outcome).toBe("created");
    expect(second.entry.outcome).toBe("created");
    expect(second.done).toBe(true);
    const made = first.entry.resource as Record<string, unknown>,
      linked = second.entry.resource as Record<string, unknown>;
    expect(linked.source).toBe(made.id);
    expect(linked.target).toBe(made.id);
    assertDeepSubmissionValue(made.properties, JSON.parse(`{"deep":${deep}}`));
    assertDeepSubmissionValue(linked.properties, JSON.parse(`{"deep":${deep}}`));
    const beforeFailure = store.inspect();
    const failedBody =
      '{"operations":[{"operation":"updateBead","bead":"beads/c","propertiesChange":[{"op":"add","path":"/rollback","value":true}]},{"operation":"updateBead","bead":"beads/c","metadataChange":[{"op":"remove","path":"/absent"}]}]}';
    const failed = execute("failed", failedBody);
    expect(failed.status).toBe("failed");
    const failedRead = store.readReceipt("p", failed.id);
    expect(failedRead.receipt?.status).toBe("failed");
    assertDeepReceiptFrozen(failedRead.receipt);
    expect((failed.problem as { status: number; operationIndex: number }).status).toBe(422);
    expect((failed.problem as { operationIndex: number }).operationIndex).toBe(1);
    assertDeepSubmissionValue(store.inspect().resources, beforeFailure.resources);
    assertDeepSubmissionValue(store.inspect().groups, beforeFailure.groups);
    expect(store.inspect().position).toBe(beforeFailure.position);
    assertDeepSubmissionValue(execute("failed", failedBody), failed);
    assertDeepSubmissionValue(execute("seed", seedBody), seed);
    expect(store.maintain()).toEqual({ completedExpired: 0, failedForgotten: 0 });
    assertDeepSubmissionValue(store.receipt("p", seed.id), seed);
    const durable = store.inspect();
    store.close();
    store = undefined;
    store = openTransactionStore({ ...options, create: false });
    assertDeepSubmissionValue(store.inspect(), durable);
    assertDeepSubmissionValue(store.receipt("p", seed.id), seed);
    const reopenedPage = store.readReceiptPage("p", pageUrl);
    if (reopenedPage.kind !== "page") throw new Error("reopened deep receipt page missing");
    assertDeepSubmissionValue(reopenedPage.page, page.page);
    assertDeepReceiptFrozen(reopenedPage.page);
    now = Math.max(Date.parse(String(seed.expiresAt)), Date.parse(String(failed.expiresAt))) + 1;
    const expired = store.maintain();
    expect(expired.completedExpired).toBeGreaterThan(0);
    expect(expired.failedForgotten).toBe(1);
    const compact = store.receipt("p", seed.id);
    expect(compact?.detail).toBe("expired");
    const expiredRead = store.readReceipt("p", seed.id);
    expect(expiredRead.receipt?.detail).toBe("expired");
    assertDeepReceiptFrozen(expiredRead.receipt);
    expect(store.readReceiptPage("p", pageUrl)).toMatchObject({ kind: "expired" });
    expect(compact?.allocated).toEqual(
      seedResults.map((r, operationIndex) => ({
        operationIndex,
        id: r.resource.id,
        type: r.resource.type,
      })),
    );
    expect(store.receipt("p", failed.id)).toBeUndefined();
    expect(store.admit("p", "seed", prepareTransaction(scope, seedBody)).kind).toBe("existing");
    expect(
      execute(
        "failed",
        JSON.stringify({
          operations: [{ operation: "createBead", id: "beads/after-expiry", type: bead }],
        }),
      ).status,
    ).toBe("completed");
    expect(measured.every((entry) => entry.identityBytes > 0)).toBe(true);
    console.log(JSON.stringify({ witness: "fresh-depth-source-identities", measured }));
    expect(performance.now() - started).toBeLessThan(20000);
  } catch (error) {
    errors.push(error);
  }
  const cleaning = performance.now();
  try {
    store?.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (performance.now() - cleaning >= 5000) errors.push(new Error("deep source cleanup deadline"));
  if (errors.length) throw new AggregateError(errors, "deep source witness failed");
}, 30000);
