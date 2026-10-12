import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { isJsonSchemaDateTime, isJsonSchemaUri, parseTypeDescriptor } from "@bdp/protocol";
import {
  prepareTransaction,
  prepareTransactionSequence,
  prepareTransactionSingleton,
} from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { createTransactionSequenceStepper } from "./transaction-sequence.js";

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

import { compareAndAdmitTransaction } from "./transaction-comparison.js";

describe("durable Transactional sequence dependencies", () => {
  function dependentSequence(
    creator = { operation: "createBead", type: bead, name: "a", idempotencyKey: "creator" },
  ) {
    return sequence([
      creator,
      {
        operation: "createLink",
        type: link,
        source: "@a",
        target: "@a",
        name: "edge",
        idempotencyKey: "dependent",
      },
    ]);
  }
  it("binds allocated creators, aliases and transitive Link references through separate commits", () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "a", idempotencyKey: "a" },
        {
          operation: "createLink",
          type: link,
          source: "@a",
          target: "@a",
          name: "edge",
          idempotencyKey: "edge",
        },
        { operation: "putAlias", alias: "alias/a", target: "@a", idempotencyKey: "alias" },
        { operation: "deleteLink", link: "@edge", idempotencyKey: "delete-edge" },
        { operation: "deleteBead", bead: "@a", idempotencyKey: "delete-bead" },
      ]),
    );
    const first = stepper.step().entry;
    const second = stepper.step().entry;
    expect(second).toMatchObject({
      outcome: "created",
      resource: {
        source: (first.resource as { id: string }).id,
        target: (first.resource as { id: string }).id,
      },
    });
    const response = runSteps(stepper);
    expect(response?.results.map((r) => r.outcome)).toEqual([
      "created",
      "created",
      "created",
      "deleted",
      "deleted",
    ]);
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().groups).toHaveLength(4);
  });
  it("waits without a DB lock then joins the canonical direct/batch identity", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    const first = stepper.step().entry;
    const id = (first.resource as { id: string }).id;
    const request = singleton("createLink", { type: link, source: id, target: id });
    expect(f.store.admit("p", "dependent", request)).toMatchObject({
      kind: "existing",
      receipt: { status: "pending" },
    });
    const waiting = compareAndAdmitTransaction(f.store, "p", "dependent", request);
    const second = stepper.step().entry;
    const result = await waiting;
    expect(result.kind).toBe("existing");
    if (result.kind === "existing") {
      expect(result.receipt.status).toBe("pending");
      const storedResults = f.store.receipt("p", result.receipt.id)?.results as unknown[];
      expect(storedResults[0]).toMatchObject({
        resource: second.resource,
      });
    }
    expect(f.store.inspect().resources).toHaveLength(2);
    expect(
      f.store.admit(
        "p",
        "dependent",
        prepareTransaction(
          scope,
          JSON.stringify({
            operations: [{ operation: "createLink", type: link, source: id, target: id }],
          }),
        ),
      ).kind,
    ).toBe("existing");
  });
  it("proves static mismatch immediately, retains no timeout outcome and keeps the owner", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    const mismatch = singleton("createLink", {
      type: link,
      source: "beads/a",
      target: "beads/a",
      properties: { different: true },
    });
    expect(await compareAndAdmitTransaction(f.store, "p", "dependent", mismatch)).toEqual({
      kind: "conflict",
    });
    let now = 0;
    const possible = singleton("createLink", { type: link, source: "beads/a", target: "beads/a" });
    expect(
      await compareAndAdmitTransaction(f.store, "p", "dependent", possible, {
        budgetMs: 3,
        now: () => now,
        wait: async () => {
          now++;
          f.store.inspect();
        },
      }),
    ).toEqual({ kind: "temporarily-unavailable" });
    expect(runSteps(stepper)?.results[1]?.outcome).toBe("created");
  });
  it("pins failed-creator facts through forgetting/key reuse and preserves unbound retry equality", () => {
    let now = 0;
    const f = fixture({ clock: () => now });
    const bad = {
      operation: "createBead",
      type: "https://example.test/types/missing",
      name: "a",
      idempotencyKey: "creator",
    };
    const first = createTransactionSequenceStepper(f.store, "p", dependentSequence(bad));
    expect(first.step().entry.code).toBe("type-not-installed");
    now = 86400001;
    f.store.maintain();
    commit(f.store, "creator", "createBead", { type: bead, id: "beads/new" });
    expect(first.step().entry.code).toBe("binding-unavailable");
    const sameFailure = createTransactionSequenceStepper(
      f.store,
      "p",
      dependentSequence({ ...bad, idempotencyKey: "another-bad" }),
    );
    expect(runSteps(sameFailure)?.results[1]?.code).toBe("binding-unavailable");
    const success = createTransactionSequenceStepper(
      f.store,
      "p",
      dependentSequence({
        operation: "createBead",
        type: bead,
        name: "a",
        idempotencyKey: "new-good",
      }),
    );
    expect(runSteps(success)?.results[1]?.code).toBe("idempotency-conflict");
  });
  it("foreign pending creators skip dependent key comparison and preserve foreign outcomes", () => {
    const f = fixture();
    const owner = own(f.store, "creator", singleton("createBead", { type: bead }));
    const prior = commit(f.store, "dependent", "createBead", { type: bead });
    const stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    expect(stepper.step().entry.code).toBe("idempotency-in-progress");
    expect(stepper.step().entry.code).toBe("idempotency-in-progress");
    expect(f.store.receipt("p", prior.id)).toEqual(prior);
    expect(f.store.execute(owner).status).toBe("completed");
  });
  it("releases its own transient dependent reservation, then accepts a fresh request", () => {
    const f = fixture();
    const owner = own(f.store, "creator", singleton("createBead", { type: bead }));
    const stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    expect(runSteps(stepper)?.results.map((r) => r.code)).toEqual([
      "idempotency-in-progress",
      "idempotency-in-progress",
    ]);
    expect(f.store.admit("p", "dependent", singleton("createBead", { type: bead })).kind).toBe(
      "owned",
    );
    f.store.retract(owner);
  });
  it("competes freshly after retraction with the same comparison deadline", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    let now = 0;
    const request = singleton("createLink", { type: link, source: "beads/a", target: "beads/a" });
    const result = await compareAndAdmitTransaction(f.store, "p", "dependent", request, {
      budgetMs: 3,
      now: () => now,
      wait: async () => {
        now++;
        stepper.abort();
      },
    });
    expect(result.kind).toBe("owned");
    if (result.kind === "owned") expect(f.store.execute(result.claim).status).toBe("failed");
  });
  it("retained/expired creator identities bind renamed labels without re-execution", () => {
    let now = 0;
    const f = fixture({ clock: () => now });
    const original = dependentSequence();
    const initial = runSteps(createTransactionSequenceStepper(f.store, "p", original));
    now = 86400001;
    const replay = runSteps(
      createTransactionSequenceStepper(
        f.store,
        "p",
        sequence([
          { operation: "createBead", type: bead, name: "renamed", idempotencyKey: "creator" },
          {
            operation: "createLink",
            type: link,
            source: "@renamed",
            target: "@renamed",
            idempotencyKey: "dependent",
          },
        ]),
      ),
    );
    expect(replay?.results.map((r) => r.code)).toEqual([
      "idempotency-expired",
      "idempotency-expired",
    ]);
    const initialResource = initial?.results[1]?.resource as { id: string };
    expect(replay?.results[1]?.allocated).toMatchObject({
      id: initialResource.id,
    });
    expect(f.store.inspect().groups).toHaveLength(2);
  });

  it("updates both kinds through dependencies and reads interleaved state/guards", () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "a", idempotencyKey: "a" },
        {
          operation: "updateBead",
          bead: "@a",
          propertiesChange: [{ op: "add", path: "/n", value: 1 }],
          idempotencyKey: "up",
        },
        {
          operation: "createLink",
          type: link,
          source: "@a",
          target: "@a",
          name: "edge",
          idempotencyKey: "edge",
        },
        {
          operation: "updateLink",
          link: "@edge",
          metadataChange: [{ op: "add", path: "/n", value: 2 }],
          idempotencyKey: "up-edge",
        },
      ]),
    );
    const first = stepper.step().entry.resource as { id: string; revision: string };
    commit(f.store, "interleave", "updateBead", {
      bead: first.id,
      propertiesChange: [{ op: "add", path: "/outside", value: true }],
    });
    expect(stepper.step().entry.resource).toMatchObject({ properties: { outside: true, n: 1 } });
    stepper.step();
    expect(stepper.step().entry.resource).toMatchObject({ metadata: { n: 2 } });
    const guard = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "a", idempotencyKey: "a" },
        {
          operation: "updateBead",
          bead: "@a",
          expectedRevision: first.revision,
          propertiesChange: [{ op: "add", path: "/n", value: 2 }],
          idempotencyKey: "guard",
        },
        { operation: "createBead", type: bead, idempotencyKey: "independent" },
      ]),
    );
    const response = runSteps(guard);
    expect(response?.results[1]?.code).toBe("revision-mismatch");
    expect(response?.results[2]?.outcome).toBe("created");
  });
  it("keeps supplied-ID failure unbound and late not-found failure preserves the prefix", () => {
    const f = fixture();
    commit(f.store, "occupied", "createBead", { type: bead, id: "beads/occupied" });
    const failed = sequence([
      {
        operation: "createBead",
        type: bead,
        id: "beads/occupied",
        name: "a",
        idempotencyKey: "creator",
      },
      { operation: "deleteBead", bead: "@a", idempotencyKey: "dependent" },
    ]);
    expect(runSteps(createTransactionSequenceStepper(f.store, "p", failed))?.results[1]?.code).toBe(
      "binding-unavailable",
    );
    expect(f.store.inspect().resources).toHaveLength(1);
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      dependentSequence({ operation: "createBead", type: bead, name: "a", idempotencyKey: "good" }),
    );
    const first = stepper.step().entry.resource as { id: string };
    commit(f.store, "delete", "deleteBead", { bead: first.id });
    // The prior dependent's unbound identity cannot be rebound by this creator.
    expect(stepper.step().entry.code).toBe("idempotency-conflict");
    const late = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "a", idempotencyKey: "good" },
        { operation: "deleteBead", bead: "@a", idempotencyKey: "late" },
      ]),
    );
    expect(runSteps(late)?.results[1]?.code).toBe("resource-not-found");
    expect(f.store.inspect().groups).toHaveLength(3);
  });
  it("overlapping presentations project pending creators/dependents without splitting keys", () => {
    const f = fixture(),
      input = dependentSequence();
    const first = createTransactionSequenceStepper(f.store, "p", input);
    const second = createTransactionSequenceStepper(f.store, "p", input);
    expect(second.step().entry.code).toBe("idempotency-in-progress");
    first.step();
    first.step();
    expect(second.step().entry.code).toBe("idempotency-in-progress");
    expect(f.store.inspect().resources).toHaveLength(2);
    expect(
      runSteps(createTransactionSequenceStepper(f.store, "p", input))?.results[1]?.outcome,
    ).toBe("created");
  });
  it("checks pins, repeated-creator equalities and supplied identities before direct waiting", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, id: "beads/a", name: "a", idempotencyKey: "a" },
        {
          operation: "createLink",
          type: link,
          source: { uri: "@a", revision: "r" },
          target: "@a",
          idempotencyKey: "edge",
        },
      ]),
    );
    for (const input of [
      { source: { uri: "beads/a", revision: "wrong" }, target: "beads/a" },
      { source: { uri: "beads/b", revision: "r" }, target: "beads/b" },
      { source: { uri: "beads/a", revision: "r" }, target: "beads/b" },
    ])
      expect(
        await compareAndAdmitTransaction(
          f.store,
          "p",
          "edge",
          singleton("createLink", { type: link, ...input }),
        ),
      ).toEqual({ kind: "conflict" });
    stepper.abort();
    const allocated = createTransactionSequenceStepper(f.store, "p", dependentSequence());
    expect(
      await compareAndAdmitTransaction(
        f.store,
        "p",
        "dependent",
        singleton("createLink", { type: link, source: "beads/a", target: "beads/b" }),
      ),
    ).toEqual({ kind: "conflict" });
    allocated.abort();
  });
  it("shares exact numeric/default/context identity after binding and retains original labels", () => {
    const f = fixture();
    const input = prepareTransactionSequence(
      scope,
      `{"operations":[{"operation":"createBead","type":"${bead}","name":"a","idempotencyKey":"a"},{"operation":"createLink","type":"${link}","source":"@a","target":"@a","properties":{"n":1.00},"revisionProvenance":{},"idempotencyKey":"edge"}]}`,
    );
    const response = runSteps(createTransactionSequenceStepper(f.store, "p", input));
    const firstResource = response?.results[0]?.resource as { id: string };
    const id = firstResource.id;
    const equal = prepareTransactionSingleton(
      scope,
      "createLink",
      `{"type":"${link}","source":"${id}","target":"${id}","metadata":{},"properties":{"n":1e0}}`,
    );
    expect(f.store.admit("p", "edge", equal).kind).toBe("existing");
  });
  it.each([
    "after-sequence-reservation",
    "after-sequence-admission",
    "after-effects",
    "after-terminal",
  ] as const)("rolls back dependency admission/creator facts on %s fault", (stage) => {
    let enabled = true;
    const f = fixture({
      fault: (point) => {
        if (enabled && point === stage) throw new Error("fault");
      },
    });
    expect(() =>
      runSteps(createTransactionSequenceStepper(f.store, "p", dependentSequence())),
    ).toThrow("fault");
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().groups).toEqual([]);
    enabled = false;
    expect(
      runSteps(createTransactionSequenceStepper(f.store, "p", dependentSequence()))?.results[1]
        ?.outcome,
    ).toBe("created");
  });
  it("retracts unresolved reservations/facts after abrupt exit and retries the prefix without resuming", () => {
    const f = fixture();
    f.store.close();
    const storeUrl = new URL("../dist/transaction-store.js", import.meta.url).href,
      batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href,
      sequenceUrl = new URL("../dist/transaction-sequence.js", import.meta.url).href;
    const operations = [
      { operation: "createBead", type: bead, name: "a", idempotencyKey: "creator" },
      {
        operation: "createLink",
        type: link,
        source: "@a",
        target: "@a",
        idempotencyKey: "dependent",
      },
    ];
    const script = `import {openTransactionStore} from ${JSON.stringify(storeUrl)};import {prepareTransactionSequence} from ${JSON.stringify(batchUrl)};import {createTransactionSequenceStepper} from ${JSON.stringify(sequenceUrl)};const s=openTransactionStore({...${JSON.stringify(f.options)},create:false});const a=createTransactionSequenceStepper(s,'p',prepareTransactionSequence(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify({ operations }))}));a.step();process.exit(79);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 15000,
      encoding: "utf8",
    });
    expect(child.status, child.stderr).toBe(79);
    const raw = new DatabaseSync(f.options.file, { readOnly: true });
    try {
      expect(
        raw.prepare("SELECT count(*) AS n FROM receipts WHERE dependency IS NOT NULL").get()?.n,
      ).toBe(1);
      expect(
        raw.prepare("SELECT count(*) AS n FROM creator_facts WHERE fact IS NOT NULL").get()?.n,
      ).toBe(1);
    } finally {
      raw.close();
    }
    expect(f.reopen().recoveredPending).toBe(1);
    expect(f.store.inspect().resources).toHaveLength(1);
    expect(
      runSteps(createTransactionSequenceStepper(f.store, "p", sequence(operations)))?.results[1]
        ?.outcome,
    ).toBe("created");
    expect(f.store.inspect().groups).toHaveLength(2);
  });
  it("refuses the preceding private format byte-identically before pending recovery", () => {
    const f = fixture();
    createTransactionSequenceStepper(f.store, "p", dependentSequence());
    f.store.close();
    const raw = new DatabaseSync(f.options.file);
    try {
      const config = JSON.parse(
        String(raw.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
      );
      config.format = "bdp-private-transaction-alias-witnesses-3";
      config.identityPolicy = "transaction-context-and-alias-witnesses-2";
      raw
        .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
        .run(JSON.stringify(config));
    } finally {
      raw.close();
    }
    const before = readFileSync(f.options.file);
    expect(() => f.reopen()).toThrow("identity policy mismatch");
    expect(readFileSync(f.options.file)).toEqual(before);
  });
  it.each(["format", "identityPolicy"] as const)(
    "refuses pre-provenance %s before touching creator facts, receipts or graph",
    (field) => {
      let now = 1000;
      const f = fixture({ clock: () => now });
      const attempt = createTransactionSequenceStepper(f.store, "p", dependentSequence());
      attempt.step();
      const completed = commit(f.store, "completed", "createBead", { type: bead });
      f.store.close();
      const raw = new DatabaseSync(f.options.file);
      const tables = ["resources", "groups", "receipts", "creator_facts"];
      let rows: unknown[];
      try {
        const config = JSON.parse(
          String(raw.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
        );
        config[field] =
          field === "format"
            ? "bdp-private-transaction-dependencies-4"
            : "transaction-dependencies-3";
        raw
          .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
          .run(JSON.stringify(config));
        rows = tables.map((table) => raw.prepare(`SELECT * FROM ${table}`).all());
        expect(raw.prepare("SELECT count(*) AS n FROM creator_facts").get()?.n).toBe(2);
        expect(
          raw.prepare("SELECT count(*) AS n FROM receipts WHERE owner IS NOT NULL").get()?.n,
        ).toBe(1);
      } finally {
        raw.close();
      }
      now = Date.parse(String(completed.expiresAt)) + 1;
      const before = readFileSync(f.options.file);
      expect(() => f.reopen()).toThrow(
        field === "format" ? "installation mismatch" : "identity policy mismatch",
      );
      expect(readFileSync(f.options.file)).toEqual(before);
      const after = new DatabaseSync(f.options.file, { readOnly: true });
      try {
        expect(tables.map((table) => after.prepare(`SELECT * FROM ${table}`).all())).toEqual(rows);
      } finally {
        after.close();
      }
    },
  );

  it("does not reset direct comparison deadline under ownership churn or epoch change", async () => {
    const f = fixture();
    let stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence()),
      now = 0;
    const request = singleton("createLink", { type: link, source: "beads/a", target: "beads/a" });
    expect(
      await compareAndAdmitTransaction(f.store, "p", "dependent", request, {
        budgetMs: 3,
        now: () => now,
        wait: async () => {
          now++;
          stepper.abort();
          stepper = createTransactionSequenceStepper(f.store, "p", dependentSequence());
        },
      }),
    ).toEqual({ kind: "temporarily-unavailable" });
    let epoch = f.store.scopeEpoch;
    expect(
      await compareAndAdmitTransaction(
        { ...f.store, comparisonEpoch: () => epoch },
        "p",
        "dependent",
        request,
        {
          budgetMs: 3,
          now: () => 0,
          wait: async () => {
            epoch = "next";
          },
        },
      ),
    ).toEqual({ kind: "temporarily-unavailable" });
    expect(runSteps(stepper)?.results[1]?.outcome).toBe("created");
  });

  it("waits until creator commitment proves equality, then returns the same pending receipt", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, id: "beads/a", name: "a", idempotencyKey: "a" },
        { operation: "deleteBead", bead: "@a", idempotencyKey: "dependent" },
      ]),
    );
    let waits = 0;
    const request = singleton("deleteBead", { bead: "beads/a" });
    const response = await compareAndAdmitTransaction(f.store, "p", "dependent", request, {
      wait: async () => {
        waits++;
        stepper.step();
      },
    });
    expect(waits).toBe(1);
    expect(response).toMatchObject({ kind: "existing", receipt: { status: "pending" } });
    expect(stepper.step().entry.outcome).toBe("deleted");
    if (response.kind === "existing")
      expect(f.store.receipt("p", response.receipt.id)?.status).toBe("completed");
  });
  it("uses partial durable creator facts for immediate comparison without waiting for the other creator", async () => {
    const f = fixture();
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "a", idempotencyKey: "a" },
        { operation: "createBead", type: bead, name: "b", idempotencyKey: "b" },
        {
          operation: "createLink",
          type: link,
          source: "@a",
          target: "@b",
          idempotencyKey: "dependent",
        },
      ]),
    );
    stepper.step();
    expect(
      await compareAndAdmitTransaction(
        f.store,
        "p",
        "dependent",
        singleton("createLink", { type: link, source: "beads/wrong", target: "beads/unknown" }),
      ),
    ).toEqual({ kind: "conflict" });
    expect(runSteps(stepper)?.results[2]?.outcome).toBe("created");
  });
  it("fences resolution failure, preserves committed creator and allocates a fresh dependent owner", () => {
    let enabled = true;
    const f = fixture({
      fault: (point) => {
        if (enabled && point === "after-dependency-resolution") throw new Error("resolution fault");
      },
    });
    const input = dependentSequence();
    const first = createTransactionSequenceStepper(f.store, "p", input);
    first.step();
    expect(() => first.step()).toThrow("resolution fault");
    expect(f.store.inspect().resources).toHaveLength(1);
    expect(f.store.inspect().groups).toHaveLength(1);
    enabled = false;
    const replacement = createTransactionSequenceStepper(f.store, "p", input);
    expect(() => first.step()).toThrow("cancelled");
    expect(runSteps(replacement)?.results[1]?.outcome).toBe("created");
    expect(f.store.inspect().groups).toHaveLength(2);
  });
});
