import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseTypeDescriptor, isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
import * as batch from "./transaction-batch.js";
import * as evaluator from "./resource-evaluator.js";
import { openTransactionStore } from "./transaction-store.js";
const scope = "https://example.test/set/",
  type = `${scope}types/bead`,
  link = `${scope}types/link`;
const types = [
  parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] }),
  parseTypeDescriptor({
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [type], external: "none" },
    target: { conformsTo: [type], external: "none" },
  }),
];
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const groupSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/changeGroup` });
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-set-core-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    types,
    create: true,
    receiptMaximumItems: 2,
    ...extra,
  };
  let owner = openTransactionStore(options);
  cleanup.push(() => {
    try {
      owner.close();
    } catch {}
  });
  return {
    options,
    get owner() {
      return owner;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    admit(operations: unknown[], key = "key", singleton = false) {
      return owner.admit(
        "p",
        key,
        batch.prepareTransactionSetCore(scope, JSON.stringify({ operations }), singleton),
      );
    },
    run(operations: unknown[], key = "key") {
      const admitted = this.admit(operations, key);
      if (admitted.kind !== "owned") throw new Error("expected own admission");
      const receipt = owner.execute(admitted.claim);
      expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
      return receipt;
    },
  };
}
const create = (id: string, n = 0) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n },
  metadata: { note: "keep" },
});
const update = (selector = "$[?@.properties.n == 0]", value = 1) => ({
  operation: "updateWhere",
  collection: "beads",
  selector,
  change: [{ op: "replace", path: "/n", value }],
});
const remove = (collection = "beads", selector = "$[?@.properties.n == 1]") => ({
  operation: "deleteWhere",
  collection,
  selector,
});
function body(value: unknown) {
  return value as {
    results: {
      operationIndex: number;
      outcome: string;
      count?: number;
      resource: {
        id: string;
        type: string;
        revision: string;
        properties: { n: number };
        source: string;
      };
    }[];
    problem: { operationIndex?: number };
    page: unknown;
    events: { subject: string; ordinal: number; type: string; data: { endpoint: string } }[];
    changes: { resource: { properties: { n: number } } }[];
  };
}
it("selects staged canonical Resources once, retains indices and expands in canonical order", () => {
  const f = fixture();
  const receipt = f.run([create("z"), create("a"), update(), update("$[?@.properties.n == 1]", 2)]);
  const results = body(receipt).results;
  expect(
    results.slice(2).map((r) => [r.operationIndex, r.outcome, r.count ?? r.resource.id]),
  ).toEqual([
    [2, "matched", 2],
    [2, "updated", `${scope}beads/a`],
    [2, "updated", `${scope}beads/z`],
    [3, "matched", 2],
    [3, "updated", `${scope}beads/a`],
    [3, "updated", `${scope}beads/z`],
  ]);
  expect(results[3]?.resource).toMatchObject({ properties: { n: 1 }, metadata: { note: "keep" } });
  expect(results[6]?.resource.properties.n).toBe(2);
  const group = body(f.owner.inspect().groups[0]);
  expect(groupSchema(group), JSON.stringify(groupSchema.errors)).toBe(true);
  expect(group.events.map((e) => e.subject)).toEqual(
    ["z", "a", "a", "z", "a", "z"].map((id) => `${scope}beads/${id}`),
  );
  expect(group.events.map((e) => e.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(group.changes.map((c) => c.resource.properties.n)).toEqual([2, 2]);
});
it("keeps original Resource label positions across sets, without interpreting selector literals", () => {
  const f = fixture();
  const receipt = f.run([
    { ...create("a"), name: "a" },
    update('$[?@.id == "@a"]'),
    { operation: "createLink", type: link, source: "@a", target: "@a" },
    update(`$[?@.id == "${scope}beads/a"]`),
  ]);
  expect(body(receipt).results[1]).toEqual({ operationIndex: 1, outcome: "matched", count: 0 });
  expect(body(receipt).results[2]?.resource.source).toBe(`${scope}beads/a`);
  expect(body(receipt).results[3]).toEqual({ operationIndex: 3, outcome: "matched", count: 1 });
});
it("zero matches and all-noop sets retain revisions/provenance without groups", () => {
  const f = fixture();
  const original = f.run(
    [
      {
        ...create("a"),
        revisionProvenance: { actor: { id: "original", basis: "writer-supplied" } },
      },
    ],
    "seed",
  );
  const receipt = f.run([
    { ...update(), selector: '$[?@.id == "beads/a"]' },
    {
      ...update(undefined, 0),
      revisionProvenance: { actor: { id: "new", basis: "writer-supplied" } },
    },
  ]);
  expect(receipt.effectPosition).toBeUndefined();
  expect(f.owner.inspect().groups).toHaveLength(1);
  expect(body(receipt).results[0]).toMatchObject({ outcome: "matched", count: 0 });
  expect(body(receipt).results[2]?.resource).toEqual(body(original).results[0]?.resource);
});
it("fans out supplied provenance on changed versions and preserves metadata", () => {
  const f = fixture();
  f.run([create("a"), create("b")], "seed");
  const receipt = f.run([
    { ...update(), revisionProvenance: { actor: { id: "writer", basis: "writer-supplied" } } },
  ]);
  for (const result of body(receipt).results.slice(1))
    expect(result.resource).toMatchObject({
      revisionProvenance: { actor: { id: "writer", basis: "writer-supplied" } },
      metadata: { note: "keep" },
    });
});
it("cardinality is inclusive, rolls back the whole batch and retains original failed disposition", () => {
  const f = fixture();
  const receipt = f.run([create("a"), { ...update(), cardinality: { min: 2, max: 3 } }]);
  expect(receipt).toMatchObject({
    status: "failed",
    problem: {
      code: "cardinality-violated",
      status: 409,
      retry: "after-state-change",
      operationIndex: 1,
    },
  });
  expect(f.owner.inspect()).toMatchObject({ resources: [], identities: [], groups: [] });
  expect(f.admit([create("a"), { ...update(), cardinality: { min: 2, max: 3 } }])).toMatchObject({
    kind: "existing",
    receipt,
  });
  const success = f.run([create("a"), { ...update(), cardinality: { min: 1, max: 1 } }], "new");
  expect(success.status).toBe("completed");
});
it("late selected patch failure rolls back earlier selected mutations and batch creation", () => {
  const f = fixture();
  f.run([{ ...create("a", 0), properties: { n: 0, x: 1 } }, create("z", 1)], "seed");
  const before = f.owner.inspect();
  const receipt = f.run([
    { ...create("new", 0), properties: { n: 0, x: 1 } },
    {
      ...update(`$[?@.type == "${type}"]`),
      change: [
        { op: "remove", path: "/x" },
        { op: "replace", path: "/n", value: 9 },
      ],
    },
  ]);
  expect(receipt).toMatchObject({ status: "failed", problem: { operationIndex: 1 } });
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(f.owner.inspect().identities).toEqual(before.identities);
  expect(f.owner.inspect().groups).toEqual(before.groups);
});
it("Link sets preserve singleton endpoint/self-Link facts and deletion incidence", () => {
  const f = fixture();
  f.run(
    [
      create("a"),
      { operation: "createLink", id: "links/z", type: link, source: "beads/a", target: "beads/a" },
    ],
    "seed",
  );
  const failed = f.run(
    [{ operation: "deleteBead", bead: "beads/a" }, remove("links", `$[?@.type == "${link}"]`)],
    "bad",
  );
  expect(failed).toMatchObject({ status: "failed", problem: { code: "incident-links-exist" } });
  const receipt = f.run([
    remove("links", `$[?@.type == "${link}"]`),
    { operation: "deleteBead", bead: "beads/a" },
  ]);
  expect(body(receipt).results.map((r) => r.outcome)).toEqual(["matched", "deleted", "deleted"]);
  const events = body(f.owner.inspect().groups[1]).events;
  expect(events.map((e) => e.type)).toEqual(["deleted", "unlinked", "unlinked", "deleted"]);
  expect(events.slice(0, 3).map((e) => e.subject)).toEqual(Array(3).fill(`${scope}links/z`));
  expect(events.slice(1, 3).map((e) => e.data.endpoint)).toEqual(["source", "target"]);
  expect(f.owner.inspect().resources).toEqual([]);
});
it("shares singleton/batch semantic identity, retains lossless numeric equality and original set selection", () => {
  const f = fixture();
  f.run([create("a")], "seed");
  const request = JSON.stringify({ operations: [{ ...update(), cardinality: { max: 10 } }] });
  const prepared = batch.prepareTransactionSetCore(scope, request, true);
  const admitted = f.owner.admit("p", "set", prepared);
  if (admitted.kind !== "owned") throw new Error("owner");
  expect(
    f.owner.admit(
      "p",
      "set",
      batch.prepareTransactionSetCore(scope, request.replace('"max":10', '"max":1e1')),
    ),
  ).toMatchObject({ kind: "existing", receipt: { status: "pending" } });
  const receipt = f.owner.execute(admitted.claim);
  f.run([create("b")], "later");
  f.reopen();
  expect(f.owner.admit("p", "set", batch.prepareTransactionSetCore(scope, request))).toMatchObject({
    kind: "existing",
    receipt,
  });
  expect(
    f.owner.admit(
      "p",
      "set",
      batch.prepareTransactionSetCore(scope, request.replace("== 0", "== 1")),
    ).kind,
  ).toBe("conflict");
});
it("retains actual cardinality and patch literals without an invented safe-integer bound", () => {
  const valid = JSON.stringify({ operations: [{ ...update(), cardinality: { max: 1 } }] });
  expect(() =>
    batch.prepareTransactionSetCore(scope, valid.replace('"max":1', '"max":1e100')),
  ).not.toThrow();
  for (const value of ["-1e-999", "1e-999", "1.1"])
    expect(() =>
      batch.prepareTransactionSetCore(scope, valid.replace('"max":1', `"max":${value}`)),
    ).toThrow("cardinality");
  const f = fixture();
  f.run([create("a")], "seed");
  const text = JSON.stringify({ operations: [update()] }).replace(
    '"value":1',
    '"value":0.10000000000000001',
  );
  const admitted = f.owner.admit("p", "numeric", batch.prepareTransactionSetCore(scope, text));
  if (admitted.kind !== "owned") throw new Error("owner");
  expect(f.owner.execute(admitted.claim)).toMatchObject({
    status: "failed",
    problem: {
      code: "validation-failed",
      diagnostics: [{ message: "unsupported number at request location /change/0/value" }],
    },
  });
});
it("retains original set facts through durable pages and same-version restart", () => {
  const f = fixture();
  f.run([create("c"), create("b"), create("a")], "seed");
  const admitted = f.admit([update()]);
  if (admitted.kind !== "owned") throw new Error("owner");
  const observed = f.owner.executeObserved(admitted.claim);
  expect(observed.receipt.results).toHaveLength(2);
  const next = observed.receipt.next;
  if (typeof next !== "string") throw new Error("page");
  const page = f.owner.readReceiptPage("p", next);
  expect(page).toMatchObject({
    kind: "page",
    page: {
      results: [
        { resource: { id: `${scope}beads/b`, properties: { n: 1 } } },
        { resource: { id: `${scope}beads/c`, properties: { n: 1 } } },
      ],
      next: null,
    },
  });
  f.run([remove()], "delete");
  f.reopen();
  const replay = f.owner.readReceiptPage("p", next);
  expect(body(replay).page).toEqual(body(page).page);
  expect(f.owner.inspect().resources).toEqual([]);
});
it("expires the staged enumeration capability after its owner turn and freezes rows", () => {
  const original = evaluator.evaluateResourceMutation;
  let captured: batch.TransactionMutationContext | undefined;
  vi.spyOn(evaluator, "evaluateResourceMutation").mockImplementation((tx, mutation, options) => {
    captured = tx as batch.TransactionMutationContext;
    const rows = captured.resources("bead");
    expect(Object.isFrozen(rows)).toBe(true);
    for (const row of rows) expect(Object.isFrozen(row)).toBe(true);
    return original(tx, mutation, options);
  });
  const f = fixture();
  f.run([create("a"), update()]);
  expect(captured).toBeDefined();
  expect(() => captured?.resources("bead")).toThrow("expired Resource transaction");
});
it("enforces one total Event cap across ordinary and set facts, with atomic retained failure", () => {
  const original = batch.evaluateTransaction;
  vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
    original(normalized, tx, { ...options, maximumInducedEvents: 2 }, ...rest),
  );
  const f = fixture();
  expect(f.run([create("a"), update()], "boundary").status).toBe("completed");
  const before = f.owner.inspect();
  const operations = [create("b"), update(`$[?@.type == "${type}"]`, 2)];
  const receipt = f.run(operations, "over");
  expect(receipt).toMatchObject({
    status: "failed",
    problem: { code: "limit-exceeded", limit: "transaction.inducedEvents", status: 413 },
  });
  expect(body(receipt).problem.operationIndex).toBeUndefined();
  expect(f.owner.inspect().resources).toEqual(before.resources);
  expect(f.owner.inspect().groups).toEqual(before.groups);
  expect(f.admit(operations, "over")).toMatchObject({ kind: "existing", receipt });
});
it("keeps unresolved negative Selector inputs a development gap and served preparation closed", () => {
  const text = JSON.stringify({ operations: [update()] });
  expect(() => batch.prepareTransaction(scope, text)).toThrow(
    batch.TransactionDevelopmentLimitError,
  );
  expect(() =>
    batch.prepareTransactionSetCore(scope, JSON.stringify({ operations: [update("$..*")] })),
  ).toThrow(batch.TransactionDevelopmentLimitError);
  expect(() =>
    batch.prepareTransactionSequence(
      scope,
      JSON.stringify({ operations: [{ ...update(), idempotencyKey: "set" }] }),
    ),
  ).toThrow();
});
it.each(["after-effects", "after-terminal"] as const)(
  "retracts transient set %s failures with no graph or page prefix",
  (stage) => {
    let armed = false;
    const f = fixture({
      fault(at) {
        if (armed && at === stage) throw new Error("set fault");
      },
    });
    f.run([create("a"), create("b"), create("c")], "seed");
    const before = f.owner.inspect();
    const claim = f.admit([update()]);
    if (claim.kind !== "owned") throw new Error("owner");
    armed = true;
    expect(() => f.owner.executeObserved(claim.claim)).toThrow("set fault");
    expect(f.owner.inspect().resources).toEqual(before.resources);
    expect(f.owner.inspect().groups).toEqual(before.groups);
    expect(f.owner.receipt("p", claim.claim.receipt.id)).toBeUndefined();
    armed = false;
    f.reopen();
    expect(f.run([update()]).status).toBe("completed");
  },
);
it("recovers a committed set and its original page chain after uncertain COMMIT", () => {
  const f = fixture();
  f.run([create("a"), create("b"), create("c")], "seed");
  const claimed = f.admit([update()]);
  if (claimed.kind !== "owned") throw new Error("owner");
  const original = DatabaseSync.prototype.exec;
  let armed = true;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const result = original.call(this, sql);
    if (armed && sql === "COMMIT") {
      armed = false;
      throw new Error("uncertain set commit");
    }
    return result;
  });
  expect(() => f.owner.executeObserved(claimed.claim)).toThrow();
  expect(() => f.owner.inspect()).toThrow();
  spy.mockRestore();
  f.reopen();
  const replay = f.admit([update()]);
  if (replay.kind !== "existing") throw new Error("retained result");
  expect(replay.receipt.id).toBe(claimed.claim.receipt.id);
  const observed = f.owner.readReceipt("p", replay.receipt.id);
  if (!observed.receipt || typeof observed.receipt.next !== "string")
    throw new Error("observed page");
  expect(f.owner.readReceiptPage("p", observed.receipt.next).kind).toBe("page");
  expect(f.owner.inspect().groups).toHaveLength(2);
});
it("retains ordinary writes followed by set reversal as ordered facts with final original values", () => {
  const f = fixture();
  f.run([create("a")], "seed");
  const receipt = f.run([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
    update("$[?@.properties.n == 1]", 0),
  ]);
  expect(body(receipt).results[0]?.resource.properties.n).toBe(1);
  expect(body(receipt).results[2]?.resource.properties.n).toBe(0);
  const group = body(f.owner.inspect().groups[1]);
  expect(group.events).toHaveLength(2);
  expect(group.changes).toHaveLength(1);
  expect(group.changes[0]?.resource.properties.n).toBe(0);
});
it("keeps allocation binding indices when sets precede a named Resource creator", () => {
  const f = fixture();
  const ops = [
    update(),
    { operation: "createBead", type, name: "first" },
    { operation: "createLink", type: link, source: "@first", target: "@first" },
  ];
  const claim = f.admit(ops);
  if (claim.kind !== "owned") throw new Error("owner");
  const receipt = f.owner.execute(claim.claim),
    results = body(receipt).results;
  expect(results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 0 });
  expect(results[2]?.resource.source).toBe(results[1]?.resource.id);
  const renamed = JSON.parse(JSON.stringify(ops).replaceAll("first", "second"));
  expect(f.admit(renamed)).toMatchObject({ kind: "existing", receipt });
});
it("set Link updates share ordinary no-op and fact behavior without endpoint-linking facts", () => {
  const f = fixture();
  f.run(
    [
      create("a"),
      {
        operation: "createLink",
        id: "links/a",
        type: link,
        source: "beads/a",
        target: "beads/a",
        properties: { n: 0 },
        metadata: { note: "link" },
      },
    ],
    "seed",
  );
  const op = { ...update(), collection: "links" };
  const receipt = f.run([op]);
  expect(body(receipt).results).toMatchObject([
    { outcome: "matched", count: 1 },
    { resource: { id: `${scope}links/a`, properties: { n: 1 }, metadata: { note: "link" } } },
  ]);
  expect(body(f.owner.inspect().groups[1]).events.map((e) => e.type)).toEqual(["updated"]);
  const noOp = f.run([{ ...op, selector: "$[?@.properties.n == 1]" }], "noop");
  expect(noOp.effectPosition).toBeUndefined();
  expect(body(noOp).results[1]?.resource).toEqual(body(receipt).results[1]?.resource);
  expect(f.owner.inspect().groups).toHaveLength(2);
});
it("counts all outer set members before new-key admission without a filtered Resource count", () => {
  const f = fixture();
  const prepared = batch.prepareTransactionSetCore(
    scope,
    JSON.stringify({ operations: [create("a"), update(), update()] }),
  );
  expect(prepared.carrier.operations).toHaveLength(3);
  expect(
    f.owner.admit("p", "outer", prepared, { acceptsJson: true, maximumOperations: 2 }),
  ).toEqual({ kind: "operation-limit" });
  expect(f.owner.inspect()).toMatchObject({ resources: [], groups: [] });
  f.owner.close();
  const stored = new DatabaseSync(f.options.file, { readOnly: true });
  try {
    expect(stored.prepare("SELECT * FROM receipts").all()).toEqual([]);
  } finally {
    stored.close();
  }
  f.reopen();
  const corrected = f.admit([create("a")], "outer");
  if (corrected.kind !== "owned") throw new Error("refusal captured key");
  f.owner.execute(corrected.claim);
  const large = batch.prepareTransactionSetCore(
    scope,
    JSON.stringify({ operations: Array.from({ length: 33 }, () => update()) }),
  );
  expect(f.owner.admit("p", "large", large, { acceptsJson: true, maximumOperations: 32 })).toEqual({
    kind: "operation-limit",
  });
  expect(f.admit([update()], "large").kind).toBe("owned");
});
it.each(["updateWhere", "deleteWhere"] as const)(
  "checks %s cardinality, collection and provenance shapes against the normative bundle",
  (operation) => {
    const schema = ajv.compile({ $ref: `${bundle.$id}#/$defs/${operation}Operation` });
    for (const cardinality of [
      undefined,
      { min: 0 },
      { max: 100 },
      { min: 2, max: 1 },
      {},
      { min: -1 },
      { max: 0.5 },
      { max: false },
      { extra: 1 },
    ]) {
      for (const collection of ["beads", "links"])
        for (const revisionProvenance of [
          undefined,
          {},
          { message: "cleanup" },
          { message: null },
          { agent: null },
          { actor: { id: "writer", basis: "writer-supplied" } },
          { actor: null, agent: null, message: null },
          null,
          [],
          { message: 1 },
          { actor: { id: "writer", basis: "invented" } },
          { extra: true },
        ]) {
          const member = {
            ...(operation === "updateWhere" ? update() : remove()),
            collection,
            ...(cardinality === undefined ? {} : { cardinality }),
            ...(revisionProvenance === undefined ? {} : { revisionProvenance }),
          };
          let accepted = true;
          try {
            batch.prepareTransactionSetCore(scope, JSON.stringify({ operations: [member] }));
          } catch {
            accepted = false;
          }
          expect(accepted, JSON.stringify(member)).toBe(schema(member));
        }
    }
  },
);
it("preserves outer witness/alias indices and result pages with a set before alias-referenced mutation", () => {
  const f = fixture();
  f.run([create("a"), create("b")], "seed");
  function alias(target: string, key: string) {
    const admitted = f.owner.admit(
      "p",
      key,
      batch.prepareTransactionSingleton(
        scope,
        "putAlias",
        JSON.stringify({ alias: "alias/current", target }),
      ),
    );
    if (admitted.kind !== "owned") throw new Error("alias owner");
    f.owner.execute(admitted.claim);
  }
  alias("beads/a", "alias-first");
  const ops = [
    update(`$[?@.id == "${scope}beads/b"]`),
    {
      operation: "updateBead",
      bead: "alias/current",
      propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
    },
  ];
  const admitted = f.admit(ops);
  if (admitted.kind !== "owned") throw new Error("owner");
  alias("beads/b", "alias-moved");
  const observed = f.owner.executeObserved(admitted.claim);
  expect(observed.receipt.results).toMatchObject([
    { operationIndex: 0, outcome: "matched", count: 1 },
    { operationIndex: 0, resource: { id: `${scope}beads/b` } },
  ]);
  if (typeof observed.receipt.next !== "string") throw new Error("page");
  expect(f.owner.readReceiptPage("p", observed.receipt.next)).toMatchObject({
    kind: "page",
    page: {
      results: [{ operationIndex: 1, resource: { id: `${scope}beads/a`, properties: { n: 2 } } }],
    },
  });
  f.reopen();
  expect(f.admit(ops)).toMatchObject({ kind: "existing", receipt: { id: observed.receipt.id } });
  const direct = [ops[0], { ...ops[1], bead: "beads/a" }];
  expect(f.admit(direct)).toMatchObject({ kind: "existing", receipt: { id: observed.receipt.id } });
});

it.each([
  ["updateWhere", "beads"],
  ["updateWhere", "links"],
  ["deleteWhere", "beads"],
  ["deleteWhere", "links"],
] as const)(
  "executes %s %s with valid provenance without minting a deleted version",
  (operation, collection) => {
    const f = fixture();
    const seeded = f.run(
      [
        {
          ...create("a"),
          revisionProvenance: { actor: { id: "original", basis: "writer-supplied" } },
        },
        ...(collection === "links"
          ? [
              {
                operation: "createLink",
                id: "links/a",
                type: link,
                source: "beads/a",
                target: "beads/a",
                properties: { n: 0 },
                metadata: { note: "keep" },
              },
            ]
          : []),
      ],
      "seed",
    );
    const prior = body(seeded).results.at(-1)?.resource;
    if (!prior) throw new Error("missing seeded Resource");
    const before = f.owner.inspect();
    const receipt = f.run([
      {
        ...(operation === "updateWhere" ? update() : remove(collection, "$[?@.properties.n == 0]")),
        collection,
        revisionProvenance: {
          actor: { id: "set-writer", basis: "writer-supplied" },
          message: "cleanup",
        },
      },
    ]);
    expect(receipt.status).toBe("completed");
    expect(body(receipt).results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 1 });
    if (operation === "updateWhere") {
      expect(body(receipt).results[1]?.resource).toMatchObject({
        id: prior.id,
        properties: { n: 1 },
        metadata: { note: "keep" },
        revisionProvenance: {
          actor: { id: "set-writer", basis: "writer-supplied" },
          message: { state: "present", value: "cleanup" },
        },
      });
      expect(body(receipt).results[1]?.resource).not.toEqual(prior);
    } else {
      expect(body(receipt).results[1]).toEqual({
        operationIndex: 0,
        outcome: "deleted",
        deleted: {
          resourceKind: collection === "beads" ? "bead" : "link",
          resource: {
            id: prior.id,
            type: prior.type,
            revision: prior.revision,
          },
        },
      });
      expect(f.owner.inspect().groups.at(-1)).toMatchObject({
        changes: [
          {
            operation: "tombstone",
            resource: {
              id: prior.id,
              revision: prior.revision,
            },
          },
        ],
      });
      if (collection === "links")
        expect(f.owner.inspect().resources).toEqual(
          before.resources.filter((r) => (r as { id: string }).id !== prior.id),
        );
      else expect(f.owner.inspect().resources).toEqual([]);
    }
  },
);

it("bounds total matched Resources across no-op sets and retains atomic failure after reopen", () => {
  const f = fixture();
  f.run([create("a"), create("b")], "seed");
  const original = batch.evaluateTransaction;
  vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
    original(normalized, tx, { ...options, maximumMatchedResources: 2 }, ...rest),
  );
  const before = f.owner.inspect();
  const boundary = f.run([update(undefined, 0)], "boundary");
  expect(boundary.status).toBe("completed");
  expect(boundary.effectPosition).toBeUndefined();
  expect(body(boundary).results).toHaveLength(3);
  expect(f.owner.inspect()).toEqual(before);
  const operations = [create("rollback", 5), update(undefined, 0), update(undefined, 0)];
  const failed = f.run(operations, "over");
  expect(failed).toMatchObject({
    status: "failed",
    problem: {
      status: 413,
      code: "limit-exceeded",
      retry: "never",
      limit: "transaction.matchedResources",
    },
  });
  expect(body(failed).problem.operationIndex).toBeUndefined();
  expect(failed.results).toBeUndefined();
  expect(f.owner.inspect()).toEqual(before);
  expect(f.admit(operations, "over")).toMatchObject({ kind: "existing", receipt: failed });
  f.reopen();
  expect(f.admit(operations, "over")).toMatchObject({ kind: "existing", receipt: failed });
  expect(f.owner.inspect()).toEqual(before);
});

it("checks cardinality before charging the matched Resource budget", () => {
  const f = fixture();
  f.run([create("a"), create("b"), create("c")], "seed");
  const original = batch.evaluateTransaction;
  vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
    original(normalized, tx, { ...options, maximumMatchedResources: 2 }, ...rest),
  );
  const before = f.owner.inspect();
  const guarded = [create("rollback", 5), { ...update(), cardinality: { max: 1 } }];
  const failed = f.run(guarded, "guarded");
  expect(failed).toMatchObject({
    status: "failed",
    problem: {
      status: 409,
      code: "cardinality-violated",
      retry: "after-state-change",
      operationIndex: 1,
    },
  });
  expect(failed.results).toBeUndefined();
  expect(f.owner.inspect()).toEqual(before);
  f.reopen();
  expect(f.admit(guarded, "guarded")).toMatchObject({ kind: "existing", receipt: failed });
  expect(f.owner.inspect()).toEqual(before);
  const unguarded = f.run([{ ...update(), cardinality: { max: 3 } }], "capacity");
  expect(unguarded).toMatchObject({
    status: "failed",
    problem: {
      status: 413,
      code: "limit-exceeded",
      retry: "never",
      limit: "transaction.matchedResources",
    },
  });
  expect(body(unguarded).problem.operationIndex).toBeUndefined();
  expect(f.owner.inspect()).toEqual(before);
  f.run([remove("beads", '$[?@.id != "https://example.test/set/beads/a"]')], "shrink");
  expect(f.run(guarded, "guarded-fresh").status).toBe("completed");
  expect(f.admit(guarded, "guarded")).toMatchObject({ kind: "existing", receipt: failed });
});

it("accepts 4096 real no-op matches at the private default and durably refuses overflow", () => {
  const f = fixture();
  for (let group = 0; group < 4; group++)
    expect(
      f.run(
        Array.from({ length: 32 }, (_, i) => create(`n${group * 32 + i}`)),
        `seed-${group}`,
      ).status,
    ).toBe("completed");
  const operations = Array.from({ length: 32 }, () => update(undefined, 0));
  const before = f.owner.inspect();
  const accepted = f.run(operations, "boundary");
  expect(accepted.status).toBe("completed");
  expect(accepted.effectPosition).toBeUndefined();
  expect(body(accepted).results).toHaveLength(4096 + 32);
  expect(body(accepted).results.filter((r) => r.outcome === "matched")).toEqual(
    Array.from({ length: 32 }, (_, operationIndex) => ({
      operationIndex,
      outcome: "matched",
      count: 128,
    })),
  );
  expect(f.owner.inspect()).toEqual(before);
  f.run([create("extra")], "extra");
  const expanded = f.owner.inspect();
  const failed = f.run(operations, "overflow");
  expect(failed).toMatchObject({
    status: "failed",
    problem: {
      status: 413,
      code: "limit-exceeded",
      retry: "never",
      limit: "transaction.matchedResources",
    },
  });
  expect(body(failed).problem.operationIndex).toBeUndefined();
  expect(failed.results).toBeUndefined();
  expect(f.owner.inspect()).toEqual(expanded);
  f.reopen();
  expect(f.admit(operations, "boundary")).toMatchObject({ kind: "existing", receipt: accepted });
  expect(f.admit(operations, "overflow")).toMatchObject({ kind: "existing", receipt: failed });
  expect(f.owner.inspect()).toEqual(expanded);
});

it.each(["updateWhere", "deleteWhere"] as const)(
  "projects %s Link matches through local endpoint visibility before cardinality",
  (operation) => {
    const f = fixture();
    f.run(
      [
        create("a"),
        create("hidden"),
        {
          operation: "createLink",
          id: "links/visible",
          type: link,
          source: "beads/a",
          target: "beads/a",
          properties: { n: 0 },
        },
        {
          operation: "createLink",
          id: "links/hidden-endpoint",
          type: link,
          source: "beads/a",
          target: "beads/hidden",
          properties: { n: 0 },
        },
      ],
      "seed",
    );
    const before = f.owner.inspect();
    const original = batch.evaluateTransaction;
    // Exercise the actual owner/evaluator under a narrower per-turn policy. The
    // fixed public/private owner installation remains all-visible and unchanged.
    vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
      original(
        normalized,
        tx,
        {
          ...options,
          maximumMatchedResources: 1,
          policy: { ...options.policy, canRead: (record) => record.id !== `${scope}beads/hidden` },
        },
        ...rest,
      ),
    );
    const receipt = f.run([
      {
        ...(operation === "updateWhere" ? update() : remove("links", "$[?@.properties.n == 0]")),
        collection: "links",
        cardinality: { min: 1, max: 1 },
      },
    ]);
    expect(receipt.status).toBe("completed");
    expect(body(receipt).results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 1 });
    expect(body(receipt).results).toHaveLength(2);
    const after = f.owner.inspect();
    const hidden = (value: unknown) => (value as { id: string }).id !== `${scope}links/visible`;
    expect(after.resources.filter(hidden)).toEqual(before.resources.filter(hidden));
    expect(body(after.groups.at(-1)).events.map((event) => event.subject)).toEqual(
      Array(operation === "updateWhere" ? 1 : 3).fill(`${scope}links/visible`),
    );
  },
);

it.each([0, -1, 1.5, 4097, Number.POSITIVE_INFINITY])(
  "refuses an invalid or raised matched Resource bound %s",
  (maximumMatchedResources) => {
    const f = fixture();
    const original = batch.evaluateTransaction;
    vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
      original(normalized, tx, { ...options, maximumMatchedResources }, ...rest),
    );
    expect(() => f.run([update()])).toThrow("invalid evaluator matched Resource bound");
    expect(f.owner.inspect()).toMatchObject({ resources: [], groups: [], identities: [] });
  },
);

it.each(["type", "status", "retry"] as const)(
  "does not retain a malformed private evaluator failure missing %s",
  (field) => {
    const f = fixture();
    const original = evaluator.evaluateResourceMutation;
    vi.spyOn(evaluator, "evaluateResourceMutation").mockImplementation((...args) => {
      const result = original(...args);
      if (result.effect !== "failure") throw new Error("expected genuine missing Resource failure");
      return { ...result, outcome: { ...result.outcome, [field]: undefined } } as typeof result;
    });
    const operations = [
      {
        operation: "updateBead",
        bead: "beads/missing",
        propertiesChange: [{ op: "add", path: "/n", value: 0 }],
      },
    ];
    expect(() => f.run(operations)).toThrow(
      "evaluator failure lacks required receipt Problem fields",
    );
    expect(f.owner.inspect()).toMatchObject({ resources: [], groups: [], identities: [] });
    vi.restoreAllMocks();
    f.reopen();
    expect(f.run(operations)).toMatchObject({
      status: "failed",
      problem: {
        type: "https://github.com/gastownhall/bdp/problems/not-found",
        status: 404,
        code: "resource-not-found",
        retry: "after-state-change",
        operationIndex: 0,
      },
    });
  },
);

it("requires operation indices except for enumerated whole-transaction limits at the type boundary", () => {
  type Failure = Extract<batch.BatchEvaluation, { ok: false }>["problem"];
  type MissingIndex = { type: string; status: 422; code: "validation-failed"; retry: "never" };
  type SelectorLimit = {
    type: string;
    status: 413;
    code: "limit-exceeded";
    retry: "never";
    limit: "selector.bytes";
  };
  type WholeLimit = Omit<SelectorLimit, "limit"> & { limit: "transaction.matchedResources" };
  type Valid = {
    type: string;
    status: 409;
    code: "revision-mismatch";
    retry: "after-state-change";
    operationIndex: number;
  };
  expectTypeOf<Valid extends Failure ? true : false>().toEqualTypeOf<true>();
  expectTypeOf<Omit<Valid, "type"> extends Failure ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<Omit<Valid, "status"> extends Failure ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<Omit<Valid, "retry"> extends Failure ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<
    Omit<Valid, "retry"> & { retry: "typo" } extends Failure ? true : false
  >().toEqualTypeOf<false>();
  expectTypeOf<
    Omit<Valid, "status"> & { status: string } extends Failure ? true : false
  >().toEqualTypeOf<false>();
  expectTypeOf<MissingIndex extends Failure ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<SelectorLimit extends Failure ? true : false>().toEqualTypeOf<false>();
  expectTypeOf<WholeLimit extends Failure ? true : false>().toEqualTypeOf<true>();
});
