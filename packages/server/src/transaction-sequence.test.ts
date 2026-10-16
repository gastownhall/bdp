import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { isJsonSchemaDateTime, isJsonSchemaUri, parseTypeDescriptor } from "@bdp/protocol";
import {
  prepareTransaction,
  prepareTransactionSequence,
  prepareTransactionSequenceForReceiving,
  prepareTransactionSingleton,
} from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import {
  createTransactionSequenceStepper,
  runTransactionSequence,
} from "./transaction-sequence.js";

const scope = "https://example.test/sequence/",
  bead = "https://example.test/types/bead",
  link = "https://example.test/types/link";
const types = [
  parseTypeDescriptor({ id: bead, name: "Bead", describes: "bead", conformsTo: [] }),
  parseTypeDescriptor({
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [bead], external: "none" },
    target: { conformsTo: [bead], external: "opaque" },
  }),
];
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(bundle);
const responseSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/transactionalSequenceResponse` });
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-transaction-sequence-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    types,
    create: true,
    ...extra,
  };
  let store = openTransactionStore(options);
  cleanup.push(() => store.close());
  return {
    options,
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
function sequence(operations: unknown[]) {
  return prepareTransactionSequence(scope, JSON.stringify({ operations }));
}
function create(id: string, key: string, name?: string) {
  return {
    operation: "createBead",
    id: `beads/${id}`,
    type: bead,
    idempotencyKey: key,
    ...(name === undefined ? {} : { name }),
  };
}
function singleton(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
  return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
}
function own(
  store: ReturnType<typeof openTransactionStore>,
  key: string,
  request: ReturnType<typeof prepareTransaction>,
) {
  const a = store.admit("p", key, request);
  if (a.kind !== "owned") throw new Error("expected owner");
  return a.claim;
}
function commit(
  store: ReturnType<typeof openTransactionStore>,
  key: string,
  operation: Parameters<typeof singleton>[0],
  input: unknown,
) {
  return store.execute(own(store, key, singleton(operation, input)));
}
function valid(response: unknown) {
  expect(responseSchema(response), JSON.stringify(responseSchema.errors)).toBe(true);
}
function runSteps(stepper: ReturnType<typeof createTransactionSequenceStepper>) {
  for (;;) {
    const turn = stepper.step();
    if (turn.done) {
      valid(turn.response);
      return turn.response;
    }
  }
}

function depthMetadata() {
  let value: unknown = "leaf";
  for (let i = 0; i < 40; i++) value = { nested: value };
  return { nested: value };
}
function receivingSequence(operations: unknown[]) {
  return prepareTransactionSequenceForReceiving(scope, JSON.stringify({ operations }));
}
function withDepthFixture(
  options: Parameters<typeof fixture>[0],
  run: (f: ReturnType<typeof fixture>) => void,
) {
  const boundary = cleanup.length;
  const failures: unknown[] = [];
  try {
    run(fixture(options));
  } catch (error) {
    failures.push(error);
  } finally {
    for (const close of cleanup.splice(boundary).reverse()) {
      try {
        close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "sequence depth fixture and cleanup failed");
}

describe("private Transactional sequence slice", () => {
  it("runs all eight explicit operation kinds as separate commits with locator-only aliases", () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        create("a", "create-bead", "first"),
        {
          operation: "createLink",
          idempotencyKey: "create-link",
          id: "links/l",
          type: link,
          source: "beads/a",
          target: "beads/a",
        },
        {
          operation: "updateBead",
          idempotencyKey: "update-bead",
          bead: "beads/a",
          propertiesChange: [{ op: "add", path: "/n", value: 1 }],
        },
        {
          operation: "updateLink",
          idempotencyKey: "update-link",
          link: "links/l",
          metadataChange: [{ op: "add", path: "/n", value: 1 }],
        },
        {
          operation: "putAlias",
          idempotencyKey: "put-alias",
          alias: "alias/work",
          target: "beads/a",
        },
        { operation: "deleteAlias", idempotencyKey: "delete-alias", alias: "alias/work" },
        { operation: "deleteLink", idempotencyKey: "delete-link", link: "links/l" },
        { operation: "deleteBead", idempotencyKey: "delete-bead", bead: "beads/a" },
      ]),
    );
    const response = runSteps(stepper);
    expect(response?.results.map((r) => r.operationIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(response?.results.map((r) => r.outcome)).toEqual([
      "created",
      "created",
      "updated",
      "updated",
      "created",
      "deleted",
      "deleted",
      "deleted",
    ]);
    expect(response?.results[0]?.operationName).toBe("first");
    expect(response?.results[4]).toEqual({
      operationIndex: 4,
      outcome: "created",
      alias: `${scope}alias/work`,
      target: `${scope}beads/a`,
    });
    expect(f.store.inspect()).toMatchObject({ resources: [], position: "6" });
    expect(f.store.inspect().groups).toHaveLength(6);
    expect(
      new Set((f.store.inspect().groups as { transaction: string }[]).map((g) => g.transaction))
        .size,
    ).toBe(6);
  });
  it("reserves all unknown keys together, commits a prefix, continues past failure and permits interleaving", () => {
    const f = fixture(),
      stepper = createTransactionSequenceStepper(
        f.store,
        "p",
        sequence([
          create("a", "first"),
          { operation: "deleteBead", idempotencyKey: "bad", bead: "beads/missing" },
          create("b", "last"),
        ]),
      );
    expect(f.store.inspect().resources).toEqual([]);
    const pending = f.store.admit(
      "p",
      "last",
      singleton("createBead", { id: "beads/b", type: bead }),
    );
    expect(pending).toMatchObject({ kind: "existing", receipt: { status: "pending" } });
    expect(stepper.step().entry).toMatchObject({ operationIndex: 0, outcome: "created" });
    commit(f.store, "interleave", "updateBead", {
      bead: "beads/a",
      propertiesChange: [{ op: "add", path: "/interleaved", value: true }],
    });
    expect(stepper.step().entry).toMatchObject({
      operationIndex: 1,
      code: "resource-not-found",
      status: 404,
    });
    const final = stepper.step();
    valid(final.response);
    expect(final.entry).toMatchObject({ operationIndex: 2, outcome: "created" });
    expect(f.store.inspect().resources).toContainEqual(
      expect.objectContaining({ id: `${scope}beads/a`, properties: { interleaved: true } }),
    );
    expect(f.store.inspect().groups).toHaveLength(3);
  });
  it("joins overlapping presentations without running a completed member twice and projects current labels", () => {
    const f = fixture();
    const first = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([create("a", "shared", "original")]),
    );
    const later = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([create("a", "shared", "retry")]),
    );
    const original = first.step();
    const replay = later.step();
    valid(replay.response);
    expect(original.entry.operationName).toBe("original");
    expect(replay.entry.operationName).toBe("retry");
    expect(replay.entry.resource).toEqual(original.entry.resource);
    expect(f.store.inspect().groups).toHaveLength(1);
    const direct = f.store.admit(
      "p",
      "shared",
      singleton("createBead", { id: `${scope}beads/a`, type: bead }),
    );
    expect(direct).toMatchObject({
      kind: "existing",
      receipt: { status: "completed", results: [{ operationName: "original" }] },
    });
  });
  it("projects another owner's pending receipt before immutable mismatch and never retracts that owner", () => {
    const f = fixture(),
      request = singleton("createBead", { id: "beads/a", type: bead }),
      claim = own(f.store, "shared", request);
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([create("different", "shared"), create("tail", "tail")]),
    );
    expect(stepper.step().entry).toMatchObject({
      code: "idempotency-in-progress",
      status: 409,
      retry: "after-delay",
    });
    expect(stepper.abort()).toBe(1);
    expect(f.store.admit("p", "shared", request)).toEqual({
      kind: "existing",
      receipt: claim.receipt,
    });
    expect(f.store.execute(claim).status).toBe("completed");
    expect(
      f.store.admit("p", "tail", singleton("createBead", { id: "beads/tail", type: bead })).kind,
    ).toBe("owned");
  });
  it("projects mixed retained, conflicting, failed and unknown keys in declaration order", () => {
    const f = fixture();
    const original = commit(f.store, "retained", "createBead", { id: "beads/a", type: bead });
    commit(f.store, "conflict", "createBead", { id: "beads/b", type: bead });
    commit(f.store, "failed", "deleteBead", { bead: "beads/missing" });
    const response = runSteps(
      createTransactionSequenceStepper(
        f.store,
        "p",
        sequence([
          create("a", "retained", "current"),
          create("other", "conflict"),
          { operation: "deleteBead", idempotencyKey: "failed", bead: "beads/missing" },
          create("new", "unknown"),
        ]),
      ),
    );
    expect(response?.results.map((r) => r.outcome ?? r.code)).toEqual([
      "created",
      "idempotency-conflict",
      "resource-not-found",
      "created",
    ]);
    expect(response?.results[0]?.resource).toEqual(
      (original.results as { resource: unknown }[])[0]?.resource,
    );
    expect(f.store.inspect().resources).toHaveLength(3);
  });
  it("shares singleton and one-operation batch identity, preserving exact numbers and creation defaults", () => {
    const f = fixture();
    const batch = prepareTransaction(
      scope,
      `{"operations":[{"operation":"createBead","name":"old","type":"${bead}","properties":{"n":1.0}}]}`,
    );
    const receipt = f.store.execute(own(f.store, "same", batch));
    const seq = prepareTransactionSequence(
      scope,
      `{"operations":[{"idempotencyKey":"same","operation":"createBead","name":"now","type":"${bead}","properties":{"n":1e0},"metadata":{},"revisionProvenance":{}}]}`,
    );
    const response = runSteps(createTransactionSequenceStepper(f.store, "p", seq));
    expect(response?.results[0]?.resource).toEqual(
      (receipt.results as { resource: unknown }[])[0]?.resource,
    );
    expect(response?.results[0]?.operationName).toBe("now");
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("projects expired Resource allocations without receipt indices and omits alias allocations", () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const created = commit(f.store, "create", "createBead", { type: bead, id: "beads/a" });
    commit(f.store, "alias", "putAlias", { alias: "alias/a-name", target: "beads/a" });
    commit(f.store, "update", "updateBead", {
      bead: "beads/a",
      propertiesChange: [{ op: "add", path: "/n", value: 1 }],
    });
    now = Date.parse(String(created.expiresAt)) + 1;
    const response = runSteps(
      createTransactionSequenceStepper(
        f.reopen(),
        "p",
        sequence([
          create("a", "create", "retry"),
          {
            operation: "putAlias",
            idempotencyKey: "alias",
            alias: "alias/a-name",
            target: "beads/a",
          },
          {
            operation: "updateBead",
            idempotencyKey: "update",
            bead: "beads/a",
            propertiesChange: [{ op: "add", path: "/n", value: 1 }],
          },
        ]),
      ),
    );
    expect(response?.results.map((r) => r.code)).toEqual([
      "idempotency-expired",
      "idempotency-expired",
      "idempotency-expired",
    ]);
    expect(response?.results[0]?.allocated).toEqual({ id: `${scope}beads/a`, type: bead });
    expect(response?.results[1]).not.toHaveProperty("allocated");
    expect(response?.results[2]).not.toHaveProperty("allocated");
  });
  for (const stage of ["after-sequence-reservation", "after-sequence-admission"] as const)
    it(`leaves no partial bulk admission on ${stage} failure`, () => {
      let inject = true,
        reservations = 0;
      const f = fixture({
        fault(at) {
          if (
            inject &&
            at === stage &&
            (stage !== "after-sequence-reservation" || ++reservations === 2)
          )
            throw new Error("admission fault");
        },
      });
      expect(() =>
        createTransactionSequenceStepper(
          f.store,
          "p",
          sequence([create("a", "a"), create("b", "b"), create("c", "c")]),
        ),
      ).toThrow("admission fault");
      inject = false;
      expect(
        f.store.admit("p", "a", singleton("createBead", { id: "beads/a", type: bead })).kind,
      ).toBe("owned");
      expect(
        f.store.admit("p", "b", singleton("createBead", { id: "beads/b", type: bead })).kind,
      ).toBe("owned");
      expect(f.store.inspect().resources).toEqual([]);
    });
  it("preserves committed prefix and another owner while retracting this attempt's tail on an internal fault", () => {
    let calls = 0;
    const f = fixture({
      fault(at) {
        if (at === "after-effects" && ++calls === 2) throw new Error("member fault");
      },
    });
    const otherRequest = singleton("createBead", { id: "beads/other", type: bead }),
      other = own(f.store, "other", otherRequest);
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        create("a", "a"),
        create("b", "b"),
        create("tail", "tail"),
        create("other", "other"),
      ]),
    );
    stepper.step();
    expect(() => stepper.step()).toThrow("member fault");
    expect(f.store.inspect().resources).toHaveLength(1);
    expect(f.store.inspect().groups).toHaveLength(1);
    expect(f.store.admit("p", "other", otherRequest)).toEqual({
      kind: "existing",
      receipt: other.receipt,
    });
    for (const [id, key] of [
      ["b", "b"],
      ["tail", "tail"],
    ])
      expect(
        f.store.admit(
          "p",
          key as string,
          singleton("createBead", { id: `beads/${id}`, type: bead }),
        ).kind,
      ).toBe("owned");
    expect(() => stepper.step()).toThrow("cancelled");
  });
  it("continues async admitted work without awaiting or consuming its response", async () => {
    const f = fixture();
    const completion = runTransactionSequence(
      f.store,
      "p",
      sequence([create("a", "a"), create("b", "b")]),
    );
    expect(f.store.inspect().resources).toEqual([]);
    // Dropping response consumption is not an authority cancellation signal.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.store.inspect().resources).toHaveLength(2);
    valid(await completion);
  });
  it("rejects duplicate keys and invalid dependency edges before any key effects", () => {
    const f = fixture();
    const invalid = [
      [create("a", "same"), create("b", "same")],
      [
        create("a", "creator", "a"),
        { operation: "deleteBead", idempotencyKey: "dependent", bead: "@unknown" },
      ],
    ];
    for (const operations of invalid)
      expect(() => createTransactionSequenceStepper(f.store, "p", sequence(operations))).toThrow();
    expect(f.store.inspect().resources).toEqual([]);
    for (const key of ["same", "creator", "dependent"])
      expect(f.store.admit("p", key, singleton("createBead", { type: bead })).kind).toBe("owned");
  });
  it("recovers a crashed sequence prefix without resuming abandoned tail receipts", () => {
    const f = fixture();
    f.store.close();
    const storeUrl = new URL("../dist/transaction-store.js", import.meta.url).href,
      batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href,
      sequenceUrl = new URL("../dist/transaction-sequence.js", import.meta.url).href;
    const operations = [create("a", "a"), create("b", "b"), create("c", "c")];
    const script = `import {openTransactionStore} from ${JSON.stringify(storeUrl)}; import {prepareTransactionSequence} from ${JSON.stringify(batchUrl)}; import {createTransactionSequenceStepper} from ${JSON.stringify(sequenceUrl)}; const s=openTransactionStore({...${JSON.stringify(f.options)},create:false}); const a=createTransactionSequenceStepper(s,'p',prepareTransactionSequence(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify({ operations }))}));a.step();process.exit(79);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 15000,
      encoding: "utf8",
    });
    expect(child.status, child.stderr).toBe(79);
    const raw = new DatabaseSync(f.options.file, { readOnly: true });
    try {
      expect(
        raw.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
      ).toBe(2);
    } finally {
      raw.close();
    }
    expect(f.reopen().recoveredPending).toBe(2);
    expect(f.store.inspect().resources).toHaveLength(1);
    const response = runSteps(createTransactionSequenceStepper(f.store, "p", sequence(operations)));
    valid(response);
    expect(f.store.inspect().resources).toHaveLength(3);
    expect(f.store.inspect().groups).toHaveLength(3);
  });
  it("fences an aborted carrier after a replacement sequence owns its released tail", () => {
    const f = fixture(),
      input = sequence([create("a", "a"), create("b", "b")]);
    const original = createTransactionSequenceStepper(f.store, "p", input);
    original.step();
    expect(original.abort()).toBe(1);
    const replacement = createTransactionSequenceStepper(f.store, "p", input);
    expect(original.abort()).toBe(0);
    expect(() => original.step()).toThrow("cancelled");
    const response = runSteps(replacement);
    valid(response);
    expect(f.store.inspect().resources).toHaveLength(2);
    expect(f.store.inspect().groups).toHaveLength(2);
  });
  it("classifies foreign key state at its turn after failed detail is forgotten", () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const failed = commit(f.store, "delete", "deleteBead", { bead: "beads/a" });
    expect(failed.status).toBe("failed");
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        create("a", "create"),
        { operation: "deleteBead", idempotencyKey: "delete", bead: "beads/a" },
      ]),
    );
    stepper.step();
    now = Date.parse(String(failed.expiresAt)) + 1;
    const done = stepper.step();
    valid(done.response);
    expect(done.entry.outcome).toBe("deleted");
    expect(f.store.receipt("p", failed.id)).toBeUndefined();
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().groups).toHaveLength(2);
  });

  it("compares retained deep sequence members without executing them or replacing their receipts", () => {
    withDepthFixture({}, (f) => {
      const original = commit(f.store, "retained", "createBead", { id: "beads/a", type: bead });
      const before = f.store.inspect();
      const conflict = runSteps(
        createTransactionSequenceStepper(
          f.store,
          "p",
          receivingSequence([{ ...create("a", "retained", "present"), metadata: depthMetadata() }]),
        ),
      );
      expect(conflict).toStrictEqual({
        results: [
          {
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            code: "idempotency-conflict",
            status: 409,
            retry: "never",
            operationIndex: 0,
            operationName: "present",
          },
        ],
      });
      expect(f.store.receipt("p", original.id)).toStrictEqual(original);
      expect(f.store.inspect()).toStrictEqual(before);
      const replay = runSteps(
        createTransactionSequenceStepper(
          f.store,
          "p",
          receivingSequence([create("a", "retained", "retry")]),
        ),
      );
      expect(replay).toStrictEqual({
        results: [
          {
            ...(original.results as Record<string, unknown>[])[0],
            operationName: "retry",
          },
        ],
      });
      expect(f.store.inspect()).toStrictEqual(before);
      const pendingRequest = singleton("createBead", { id: "beads/pending", type: bead });
      const pending = own(f.store, "pending", pendingRequest);
      const inProgress = runSteps(
        createTransactionSequenceStepper(
          f.store,
          "p",
          receivingSequence([
            { ...create("pending", "pending", "pending-now"), metadata: depthMetadata() },
          ]),
        ),
      );
      expect(inProgress).toStrictEqual({
        results: [
          {
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            code: "idempotency-in-progress",
            status: 409,
            retry: "after-delay",
            operationIndex: 0,
            operationName: "pending-now",
          },
        ],
      });
      expect(f.store.admit("p", "pending", pendingRequest)).toStrictEqual({
        kind: "existing",
        receipt: pending.receipt,
      });
      expect(f.store.execute(pending).status).toBe("completed");
      expect(f.store.inspect().groups).toHaveLength(2);
    });
  }, 15000);
  it("admits fresh deep sequence members without changing atomic reservation behavior", () => {
    withDepthFixture({}, (f) => {
      const foreignRequest = singleton("createBead", { id: "beads/foreign", type: bead });
      const foreign = own(f.store, "foreign", foreignRequest);
      const request = receivingSequence([
        create("first", "first"),
        { ...create("deep", "deep"), metadata: depthMetadata() },
        create("tail", "tail"),
      ]);
      const created = runSteps(createTransactionSequenceStepper(f.store, "p", request));
      expect(created?.results.map((entry) => entry.outcome)).toStrictEqual([
        "created",
        "created",
        "created",
      ]);
      expect(f.store.admit("p", "foreign", foreignRequest)).toStrictEqual({
        kind: "existing",
        receipt: foreign.receipt,
      });
      const replay = runSteps(createTransactionSequenceStepper(f.store, "p", request));
      // This fixture is bounded to 41 metadata levels. JSON preserves every wire
      // field/value while ignoring decoded null-vs-Object prototypes on replay.
      expect(JSON.stringify(replay)).toBe(JSON.stringify(created));
      expect(f.store.execute(foreign).status).toBe("completed");
      expect(f.store.inspect().groups).toHaveLength(4);
    });
  }, 15000);
  it("executes fresh deep input after a retained failed member expires between sequence turns", () => {
    let now = 1000;
    withDepthFixture({ clock: () => now }, (f) => {
      commit(f.store, "seed", "createBead", { id: "beads/a", type: bead });
      const failed = commit(f.store, "failed", "createBead", { id: "beads/a", type: bead });
      expect(failed.status).toBe("failed");
      const stepper = createTransactionSequenceStepper(
        f.store,
        "p",
        receivingSequence([
          create("prefix", "prefix"),
          { ...create("deep", "failed"), metadata: depthMetadata() },
          create("tail", "tail"),
        ]),
      );
      expect(stepper.step().entry.outcome).toBe("created");
      now = Date.parse(String(failed.expiresAt)) + 1;
      expect(stepper.step().entry.outcome).toBe("created");
      expect(f.store.receipt("p", failed.id)).toBeUndefined();
      expect(stepper.step().entry.outcome).toBe("created");
      expect(f.store.inspect().resources.map((r) => (r as { id: string }).id)).toStrictEqual([
        `${scope}beads/a`,
        `${scope}beads/deep`,
        `${scope}beads/prefix`,
        `${scope}beads/tail`,
      ]);
      expect(f.store.inspect().groups).toHaveLength(4);
      expect(
        f.store.admit("p", "failed", singleton("createBead", { id: "beads/reused", type: bead }))
          .kind,
      ).toBe("conflict");
    });
  }, 15000);
});
