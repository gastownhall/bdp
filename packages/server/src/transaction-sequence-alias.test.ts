import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { compareAndAdmitTransaction } from "./transaction-comparison.js";
import {
  dependencyTemplate,
  compareDependencyTemplate,
  parseDependencyTemplate,
} from "./transaction-dependencies.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import {
  prepareTransaction,
  prepareTransactionSequence,
  prepareTransactionSingleton,
} from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { createTransactionSequenceStepper } from "./transaction-sequence.js";

const scope = "https://example.test/alias-sequence/";
const bead = `${scope}types/bead`,
  link = `${scope}types/link`;
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
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-turn-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = { file: path.join(directory, "store.sqlite"), scope, types, create: true };
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
function request(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
  return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
}
function commit(
  store: ReturnType<typeof openTransactionStore>,
  key: string,
  operation: Parameters<typeof request>[0],
  input: unknown,
) {
  const admitted = store.admit("p", key, request(operation, input));
  if (admitted.kind !== "owned") throw new Error(`expected owned: ${admitted.kind}`);
  const receipt = store.execute(admitted.claim);
  expect(receipt.status).toBe("completed");
  return receipt;
}
function seed(f: ReturnType<typeof fixture>) {
  for (const id of ["a", "b"])
    commit(f.store, `seed-${id}`, "createBead", {
      id: `beads/${id}`,
      type: bead,
      properties: { value: 0 },
    });
  commit(f.store, "seed-alias", "putAlias", { alias: "alias/work", target: "beads/a" });
}
const sequence = (operations: unknown[]) =>
  prepareTransactionSequence(scope, JSON.stringify({ operations }));
const update = (idempotencyKey: string, value: number) => ({
  operation: "updateBead",
  idempotencyKey,
  bead: "alias/work",
  propertiesChange: [{ op: "replace", path: "/value", value }],
});
const edge = (source: unknown, target: unknown) => ({ type: link, source, target });

it("captures alias-only operands at the eligible turn, not whole admission", () => {
  const f = fixture();
  seed(f);
  const stepper = createTransactionSequenceStepper(f.store, "p", sequence([update("u", 1)]));
  commit(f.store, "repoint", "putAlias", { alias: "alias/work", target: "beads/b" });
  const turn = stepper.step();
  expect(turn.entry).toMatchObject({
    outcome: "updated",
    resource: { id: `${scope}beads/b`, properties: { value: 1 } },
  });
  expect(f.store.inspect().resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `${scope}beads/a`, properties: { value: 0 } }),
    ]),
  );
});
it.each([false, true])(
  "waits for original locators across candidate slots (swapped=%s)",
  (swap) => {
    const f = fixture();
    seed(f);
    const stepper = createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createLink", idempotencyKey: "edge", ...edge("alias/work", "alias/work") },
      ]),
    );
    const candidate = request(
      "createLink",
      swap ? edge("beads/b", `${scope}alias/work`) : edge("alias/work", "beads/b"),
    );
    expect(f.store.admit("p", "edge", candidate).kind).toBe("comparison-pending");
    expect(f.store.admit("p", "edge", request("createLink", edge("beads/a", "beads/b"))).kind).toBe(
      "conflict",
    );
    commit(f.store, "repoint", "putAlias", { alias: "alias/work", target: "beads/b" });
    const turn = stepper.step();
    expect(turn.entry).toMatchObject({
      outcome: "created",
      resource: { source: `${scope}beads/b`, target: `${scope}beads/b` },
    });
    const retry = f.store.admit("p", "edge", candidate);
    expect(retry.kind).toBe("existing");
    f.reopen();
    expect(f.store.admit("p", "edge", candidate)).toEqual(retry);
  },
);
it("keeps alias-only reservations pending through maintenance and foreign sequence projection", () => {
  const f = fixture();
  seed(f);
  const prepared = sequence([update("u", 1)]);
  const owner = createTransactionSequenceStepper(f.store, "p", prepared);
  f.store.maintain();
  expect(
    f.store.admit(
      "p",
      "u",
      request("updateBead", {
        bead: "alias/work",
        propertiesChange: [{ op: "replace", path: "/value", value: 1 }],
      }),
    ).kind,
  ).toBe("comparison-pending");
  expect(
    createTransactionSequenceStepper(f.store, "p", sequence([update("u", 99)])).step().entry,
  ).toMatchObject({ code: "idempotency-in-progress" });
  expect(owner.step().entry).toMatchObject({ outcome: "updated" });
});
function steps(stepper: ReturnType<typeof createTransactionSequenceStepper>) {
  const results = [];
  for (;;) {
    const turn = stepper.step();
    results.push(turn.entry);
    if (turn.done) return results;
  }
}
it("deletes the turn-time alias target and retains its original witness after deletion", () => {
  const f = fixture();
  seed(f);
  const owner = createTransactionSequenceStepper(
    f.store,
    "p",
    sequence([{ operation: "deleteBead", idempotencyKey: "delete", bead: "alias/work" }]),
  );
  commit(f.store, "repoint", "putAlias", { alias: "alias/work", target: "beads/b" });
  expect(owner.step().entry).toMatchObject({
    outcome: "deleted",
    deleted: { resourceKind: "bead", resource: { id: `${scope}beads/b`, type: bead } },
  });
  expect(f.store.inspect().resources.map((resource) => (resource as { id: string }).id)).toEqual([
    `${scope}beads/a`,
  ]);
  const replay = f.store.admit("p", "delete", request("deleteBead", { bead: "alias/work" }));
  expect(replay.kind).toBe("existing");
  expect(f.store.admit("p", "delete", request("deleteBead", { bead: "beads/b" }))).toEqual(replay);
  f.reopen();
  expect(f.store.admit("p", "delete", request("deleteBead", { bead: "alias/work" }))).toEqual(
    replay,
  );
});
it("observes preceding alias writes and mixed allocated creator/pinned alias operands", () => {
  const f = fixture();
  const results = steps(
    createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "made", idempotencyKey: "creator" },
        { operation: "putAlias", alias: "alias/work", target: "@made", idempotencyKey: "put" },
        {
          operation: "createLink",
          type: link,
          name: "edge",
          source: "@made",
          target: { uri: "alias/work", revision: "opaque-pin" },
          idempotencyKey: "edge",
        },
        { operation: "deleteLink", link: "@edge", idempotencyKey: "drop-edge" },
      ]),
    ),
  );
  const created = (results[0]!.resource as { id: string }).id;
  expect(results[2]).toMatchObject({
    outcome: "created",
    operationIndex: 2,
    operationName: "edge",
    resource: { source: created, target: { uri: created, revision: "opaque-pin" } },
  });
  expect(results[3]).toMatchObject({ outcome: "deleted", operationIndex: 3 });
  expect(f.store.inspect().groups).toHaveLength(3);
});
it("retains a recorded miss after assignment while a fresh key executes and the tail commits", () => {
  const f = fixture();
  seed(f);
  const results = steps(
    createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "deleteAlias", alias: "alias/work", idempotencyKey: "remove" },
        update("miss", 1),
        { ...update("tail", 2), bead: "beads/b" },
      ]),
    ),
  );
  expect(results[1]).toMatchObject({ code: "resource-not-found", operationIndex: 1 });
  expect(results[2]).toMatchObject({ outcome: "updated", resource: { properties: { value: 2 } } });
  const input = {
    bead: "alias/work",
    propertiesChange: [{ op: "replace", path: "/value", value: 1 }],
  };
  const failure = f.store.admit("p", "miss", request("updateBead", input));
  expect(failure.kind).toBe("existing");
  commit(f.store, "assign", "putAlias", { alias: "alias/work", target: "beads/b" });
  expect(f.store.admit("p", "miss", request("updateBead", input))).toEqual(failure);
  expect(
    f.store.admit("p", "miss", request("updateBead", { ...input, bead: "alias/other-missing" }))
      .kind,
  ).toBe("conflict");
  commit(f.store, "fresh", "updateBead", input);
  f.reopen();
  expect(f.store.admit("p", "miss", request("updateBead", input))).toEqual(failure);
  const batch = prepareTransaction(
    scope,
    JSON.stringify({ operations: [{ operation: "updateBead", ...input }] }),
  );
  expect(f.store.admit("p", "miss", batch)).toEqual(failure);
});
it("never replaces original success witnesses with new retry-locator lookups", () => {
  const f = fixture();
  seed(f);
  const original = steps(
    createTransactionSequenceStepper(f.store, "p", sequence([update("u", 1)])),
  )[0]!;
  const input = {
    bead: "alias/work",
    propertiesChange: [{ op: "replace", path: "/value", value: 1 }],
  };
  const retained = f.store.admit("p", "u", request("updateBead", input));
  commit(f.store, "new-locator", "putAlias", { alias: "alias/fresh", target: "beads/a" });
  expect(f.store.admit("p", "u", request("updateBead", { ...input, bead: "alias/fresh" }))).toEqual(
    retained,
  );
  commit(f.store, "new-repoint", "putAlias", { alias: "alias/fresh", target: "beads/b" });
  expect(
    f.store.admit("p", "u", request("updateBead", { ...input, bead: "alias/fresh" })).kind,
  ).toBe("conflict");
  commit(f.store, "old-repoint", "putAlias", { alias: "alias/work", target: "beads/b" });
  commit(f.store, "delete", "deleteAlias", { alias: "alias/work" });
  expect(f.store.admit("p", "u", request("updateBead", input))).toEqual(retained);
  expect(f.store.admit("p", "u", request("updateBead", { ...input, bead: "beads/a" }))).toEqual(
    retained,
  );
  expect(original).toMatchObject({ resource: { id: `${scope}beads/a`, properties: { value: 1 } } });
  f.reopen();
  expect(f.store.admit("p", "u", request("updateBead", input))).toEqual(retained);
  expect(f.store.inspect().resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `${scope}beads/b`, properties: { value: 0 } }),
    ]),
  );
});
it("keeps wrong-kind aliases and put-to-alias as member failures rather than expanding slots", () => {
  const f = fixture();
  seed(f);
  const result = steps(
    createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "deleteLink", link: "alias/work", idempotencyKey: "wrong-kind" },
        {
          operation: "putAlias",
          alias: "alias/chain",
          target: "alias/work",
          idempotencyKey: "chain",
        },
        update("tail", 3),
      ]),
    ),
  );
  expect(result[0]).toMatchObject({ code: "resource-not-found" });
  expect(result[1]).toMatchObject({ code: "validation-failed" });
  expect(result[2]).toMatchObject({ outcome: "updated", resource: { properties: { value: 3 } } });
});
it.each(["singleton", "batch"])(
  "direct %s waits without blocking owner then joins the exact receipt",
  async (carrier) => {
    const f = fixture();
    seed(f);
    const prepared = sequence([
      { operation: "createLink", idempotencyKey: "edge", ...edge("alias/work", "alias/work") },
    ]);
    const owner = createTransactionSequenceStepper(f.store, "p", prepared);
    const input = edge("alias/work", "beads/b");
    const candidate =
      carrier === "singleton"
        ? request("createLink", input)
        : prepareTransaction(
            scope,
            JSON.stringify({ operations: [{ operation: "createLink", ...input }] }),
          );
    let waits = 0;
    const compared = await compareAndAdmitTransaction(f.store, "p", "edge", candidate, {
      wait: async () => {
        waits++;
        commit(f.store, "repoint", "putAlias", { alias: "alias/work", target: "beads/b" });
        expect(owner.step().entry).toMatchObject({
          outcome: "created",
          resource: { source: `${scope}beads/b`, target: `${scope}beads/b` },
        });
      },
    });
    expect(waits).toBe(1);
    expect(compared.kind).toBe("existing");
    expect(f.store.admit("p", "edge", candidate)).toEqual(compared);
    expect(f.store.inspect().groups).toHaveLength(3);
  },
);
it("uses one bounded comparison deadline and leaves the owner's reservation intact", async () => {
  const f = fixture();
  seed(f);
  const owner = createTransactionSequenceStepper(f.store, "p", sequence([update("u", 1)]));
  let now = 0,
    waits = 0;
  expect(
    await compareAndAdmitTransaction(
      f.store,
      "p",
      "u",
      request("updateBead", {
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/value", value: 1 }],
      }),
      {
        budgetMs: 2,
        now: () => now,
        wait: async () => {
          waits++;
          now++;
        },
      },
    ),
  ).toEqual({ kind: "temporarily-unavailable" });
  expect(waits).toBe(2);
  expect(owner.step().entry).toMatchObject({ outcome: "updated" });
});
it("symbolizes original locators across both slots without a live lookup and preserves pins", () => {
  const member = sequence([
    {
      operation: "createLink",
      idempotencyKey: "edge",
      ...edge({ uri: "alias/x", revision: "opaque" }, "alias/y"),
    },
  ]).members[0]!;
  const template = dependencyTemplate("attempt", member);
  const resolve = () => {
    throw new Error("original locator must be symbolic");
  };
  const compare = (source: unknown, target: unknown) =>
    compareDependencyTemplate(
      template,
      request("createLink", edge(source, target)),
      resolve,
      () => undefined,
    );
  expect(compare({ uri: `${scope}alias/y`, revision: "opaque" }, "alias/x")).toBe("pending");
  expect(compare({ uri: "alias/x", revision: "different" }, "alias/y")).toBe("conflict");
  expect(compare({ uri: "alias/x", revision: "opaque" }, "links/not-a-bead")).toBe("conflict");
  const repeated = dependencyTemplate(
    "attempt",
    sequence([{ operation: "createLink", idempotencyKey: "edge", ...edge("alias/x", "alias/x") }])
      .members[0]!,
  );
  expect(
    compareDependencyTemplate(
      repeated,
      request("createLink", edge("beads/a", "beads/b")),
      resolve,
      () => undefined,
    ),
  ).toBe("conflict");
  expect(
    compareDependencyTemplate(
      repeated,
      request("createLink", edge("alias/x", "alias/x")),
      resolve,
      () => undefined,
    ),
  ).toBe("pending");
  expect(() =>
    parseDependencyTemplate(JSON.stringify({ ...template, form: "unknown" }), scope),
  ).toThrow("pending alias template");
});
it("rejects fixed input conflicts while alias identity is unresolved", () => {
  const f = fixture();
  seed(f);
  const owner = createTransactionSequenceStepper(f.store, "p", sequence([update("u", 1)]));
  expect(
    f.store.admit(
      "p",
      "u",
      request("updateBead", {
        bead: "alias/work",
        propertiesChange: [{ op: "replace", path: "/value", value: 2 }],
      }),
    ),
  ).toEqual({ kind: "conflict" });
  expect(owner.step().entry).toMatchObject({
    outcome: "updated",
    resource: { properties: { value: 1 } },
  });
});
it("validates the closed pending-only alias template before comparison", () => {
  const template = dependencyTemplate("attempt", sequence([update("u", 1)]).members[0]!);
  expect(parseDependencyTemplate(JSON.stringify(template), scope)).toEqual(template);
  for (const change of [
    { extra: true },
    { aliases: [{ field: "link", locator: `${scope}alias/work` }] },
    { aliases: [{ field: "bead", locator: "https://elsewhere.test/alias/work" }] },
    {
      aliases: [
        { field: "bead", locator: `${scope}alias/work` },
        { field: "bead", locator: `${scope}alias/work` },
      ],
    },
    { referenceIdentities: {} },
    { dependencies: [{ field: "bead", creator: 0, operationSlot: 0, resourceKind: "bead" }] },
  ])
    expect(() =>
      parseDependencyTemplate(JSON.stringify({ ...template, ...change }), scope),
    ).toThrow("pending alias template");
});
it("new candidate locators are comparison facts, not original-symbol witnesses", () => {
  const template = dependencyTemplate(
    "attempt",
    sequence([{ operation: "createLink", idempotencyKey: "edge", ...edge("alias/x", "alias/x") }])
      .members[0]!,
  );
  const calls: string[] = [];
  const compare = (target: string | undefined) =>
    compareDependencyTemplate(
      template,
      request("createLink", edge("alias/fresh", "beads/b")),
      (locator) => {
        calls.push(locator);
        return target;
      },
      () => undefined,
    );
  expect(compare(`${scope}beads/a`)).toBe("conflict");
  expect(compare(`${scope}beads/b`)).toBe("pending");
  expect(compare(undefined)).toBe("conflict");
  expect(calls).toEqual([`${scope}alias/fresh`, `${scope}alias/fresh`, `${scope}alias/fresh`]);
});
it("retracts only this attempt's mixed dependency on a transient creator", () => {
  const f = fixture();
  seed(f);
  const creator = request("createBead", { type: bead });
  const foreign = f.store.admit("p", "creator", creator);
  expect(foreign.kind).toBe("owned");
  const result = steps(
    createTransactionSequenceStepper(
      f.store,
      "p",
      sequence([
        { operation: "createBead", type: bead, name: "made", idempotencyKey: "creator" },
        {
          operation: "createLink",
          type: link,
          source: "@made",
          target: "alias/work",
          idempotencyKey: "dependent",
        },
      ]),
    ),
  );
  expect(result.map((entry) => entry.code)).toEqual([
    "idempotency-in-progress",
    "idempotency-in-progress",
  ]);
  expect(
    f.store.admit("p", "dependent", request("createLink", edge("beads/a", "alias/work"))).kind,
  ).toBe("owned");
  if (foreign.kind !== "owned") throw new Error("foreign creator");
  expect(f.store.execute(foreign.claim).status).toBe("completed");
});
it.each(["after-prefix", "after-resolution"])(
  "recovers actual emitted crash %s without resuming abandoned aliases",
  (stage) => {
    const f = fixture();
    seed(f);
    f.store.close();
    const operations = [
      { operation: "putAlias", alias: "alias/work", target: "beads/b", idempotencyKey: "repoint" },
      update("u", 1),
    ];
    const modules = Object.fromEntries(
      ["transaction-store", "transaction-batch", "transaction-sequence"].map((name) => [
        name,
        new URL(`../dist/${name}.js`, import.meta.url).href,
      ]),
    );
    const script = `import {openTransactionStore} from ${JSON.stringify(modules["transaction-store"])};
import {prepareTransactionSequence} from ${JSON.stringify(modules["transaction-batch"])};
import {createTransactionSequenceStepper} from ${JSON.stringify(modules["transaction-sequence"])};
const store=openTransactionStore({...${JSON.stringify(f.options)},create:false, fault(point){if(${JSON.stringify(stage)}==='after-resolution'&&point==='after-dependency-resolution')process.exit(79)}});
const stepper=createTransactionSequenceStepper(store,'p',prepareTransactionSequence(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify({ operations }))}));
stepper.step();if(${JSON.stringify(stage)}==='after-resolution')stepper.step();process.exit(79);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(79);
    const db = new DatabaseSync(f.options.file, { readOnly: true });
    try {
      const pending = db
        .prepare("SELECT owner,dependency,identity,witnesses FROM receipts WHERE key='u'")
        .get()!;
      expect(pending.owner).not.toBeNull();
      // The fault fires inside the fenced normalization transaction. A crash
      // rolls that transaction back, retaining the original pending template.
      expect(pending.identity).toBe("");
      expect(pending.witnesses).toBe("");
      expect(parseDependencyTemplate(String(pending.dependency), scope)).toMatchObject({
        form: "transaction-deferred-alias-1",
      });
    } finally {
      db.close();
    }
    expect(f.reopen().recoveredPending).toBe(1);
    expect(f.store.inspect().resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `${scope}beads/b`, properties: { value: 0 } }),
      ]),
    );
    const response = steps(createTransactionSequenceStepper(f.store, "p", sequence(operations)));
    expect(response[1]).toMatchObject({
      outcome: "updated",
      resource: { id: `${scope}beads/b`, properties: { value: 1 } },
    });
    const size = readFileSync(f.options.file).length;
    expect(size).toBeGreaterThan(0);
    expect(() => openTransactionStore({ ...f.options, create: false })).toThrow();
  },
);
