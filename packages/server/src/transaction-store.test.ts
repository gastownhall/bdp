import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTypeDescriptor, isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { prepareTransaction, prepareTransactionSingleton } from "./transaction-batch.js";
import { openTransactionStore, type TransactionClaim } from "./transaction-store.js";

const scope = "https://example.test/transaction/";
const bead = "https://example.test/types/bead",
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
const batch = {
  operations: [
    {
      operation: "createBead",
      name: "a",
      properties: { n: 1 },
      metadata: { author: "x" },
      type: bead,
    },
    { operation: "createLink", type: link, source: "@a", target: "@a" },
  ],
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(bundle);
const receiptSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/mutationReceipt` });
const groupSchema = ajv.compile({ $ref: `${bundle.$id}#/$defs/changeGroup` });
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  vi.useRealTimers();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-transaction-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "transaction.sqlite"),
    scope,
    types,
    create: true,
    ...extra,
  };
  let store = openTransactionStore(options);
  cleanup.push(() => {
    try {
      store.close();
    } catch {}
  });
  return {
    get store() {
      return store;
    },
    options,
    reopen() {
      store.close();
      store = openTransactionStore({ ...options, create: false });
      return store;
    },
  };
}
function admit(
  store: ReturnType<typeof openTransactionStore>,
  body: unknown = batch,
  key = "key",
): TransactionClaim {
  const result = store.admit("principal", key, prepareTransaction(scope, JSON.stringify(body)));
  if (result.kind !== "owned") throw new Error("expected new admission");
  return result.claim;
}
describe("private atomic transaction owner", () => {
  it("commits allocated Bead and local-reference self-Link, one receipt and ordered group together", () => {
    const f = fixture(),
      claim = admit(f.store);
    expect(f.store.inspect().resources).toEqual([]);
    expect(receiptSchema(claim.receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    const receipt = f.store.execute(claim),
      state = f.store.inspect();
    expect(receipt.status).toBe("completed");
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(state.resources).toHaveLength(2);
    expect(state.identities).toHaveLength(2);
    expect(state.groups).toHaveLength(1);
    expect(groupSchema(state.groups[0]), JSON.stringify(groupSchema.errors)).toBe(true);
    const group = state.groups[0] as {
      events: {
        type: string;
        ordinal: number;
        source: string;
        subject: string;
        subjectType: string;
        data: Record<string, unknown>;
      }[];
      changes: { resource: { id: string; revision: string; source?: string; target?: string } }[];
    };
    expect(group.events.map((e) => [e.ordinal, e.type])).toEqual([
      [0, "created"],
      [1, "created"],
      [2, "linked"],
      [3, "linked"],
    ]);
    const beadId = group.changes[0]?.resource.id,
      linkId = group.changes[1]?.resource.id;
    expect(group.events.map((e) => [e.source, e.subject, e.subjectType])).toEqual([
      [`${scope}events/`, beadId, bead],
      [`${scope}events/`, linkId, link],
      [`${scope}events/`, linkId, link],
      [`${scope}events/`, linkId, link],
    ]);
    // Both incidences preserve the Bead's creation revision; neither versions it.
    expect(group.events[0]?.data.revision).toBe(group.changes[0]?.resource.revision);
    expect(state.resources.find((r) => (r as { id: string }).id === beadId)).toMatchObject({
      revision: group.events[0]?.data.revision,
    });
    expect(group.events[2]?.data).toEqual({
      endpoint: "source",
      link: { id: linkId, type: link },
      source: beadId,
      target: beadId,
    });
    expect(group.events[3]?.data).toEqual({
      endpoint: "target",
      link: { id: linkId, type: link },
      source: beadId,
      target: beadId,
    });
    expect(group.events[2]?.data.endpoint).toBe("source");
    expect(group.events[3]?.data.endpoint).toBe("target");
    expect(group.changes[1]?.resource.source).toBe(group.changes[0]?.resource.id);
    expect(group.changes[1]?.resource.target).toBe(group.changes[0]?.resource.id);
    expect(f.store.receipt("other", receipt.id)).toBeUndefined();
    expect(
      f.reopen().admit("principal", "key", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "existing", receipt });
    expect(f.store.inspect()).toEqual(state);
  });
  it("emits no endpoint fact for an opaque external target and keeps the pin in the Link facts", () => {
    const f = fixture();
    const external = { uri: "urn:external:bead", revision: "remote-revision" };
    f.store.execute(
      admit(f.store, {
        operations: [
          batch.operations[0],
          { operation: "createLink", type: link, source: "@a", target: external },
        ],
      }),
    );
    const group = f.store.inspect().groups[0] as {
      events: {
        type: string;
        source: string;
        subject: string;
        subjectType: string;
        data: Record<string, unknown>;
      }[];
      changes: { resource: { id: string } }[];
    };
    expect(group.events.map((e) => e.type)).toEqual(["created", "created", "linked"]);
    expect(group.events[1]?.data.target).toEqual(external);
    expect(group.events[2]).toMatchObject({
      source: `${scope}events/`,
      subject: group.changes[1]?.resource.id,
      subjectType: link,
      data: { endpoint: "source", target: external },
    });
    expect(group.events.every((e) => e.source === `${scope}events/`)).toBe(true);
  });
  it("rolls back earlier Resource and identity allocation on final operation failure, retaining only failed receipt", () => {
    const f = fixture();
    const invalid = {
      operations: [
        batch.operations[0],
        { operation: "createLink", type: link, source: "@a", target: "beads/missing" },
      ],
    };
    const receipt = f.store.execute(admit(f.store, invalid));
    expect(receipt.status).toBe("failed");
    expect(receipt.problem).toMatchObject({ operationIndex: 1, code: "resource-not-found" });
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(f.store.inspect()).toEqual({ resources: [], groups: [], identities: [], position: "0" });
    expect(
      f.reopen().admit("principal", "key", prepareTransaction(scope, JSON.stringify(invalid))),
    ).toEqual({ kind: "existing", receipt });
    expect(
      f.store.admit("principal", "key", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "conflict" });
  });
  it("joins equal pending requests, fences a retracted execution and allocates fresh admission", () => {
    const f = fixture(),
      claim = admit(f.store);
    expect(
      f.store.admit("principal", "key", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "existing", receipt: claim.receipt });
    expect(f.store.retract(claim)).toBe(true);
    const next = admit(f.store);
    expect(next.receipt.id).not.toBe(claim.receipt.id);
    expect(() => f.store.execute(claim)).toThrow("fenced");
    expect(f.store.receipt("principal", claim.receipt.id)).toBeUndefined();
    expect(f.store.execute(next).status).toBe("completed");
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("excludes names, object order and equivalent numeric/local spellings from identity but includes metadata and operation order", () => {
    const f = fixture(),
      first = f.store.execute(admit(f.store));
    const renamed = {
      operations: [
        {
          type: bead,
          name: "renamed",
          operation: "createBead",
          metadata: { author: "x" },
          properties: { n: 1 },
        },
        {
          operation: "createLink",
          type: link,
          properties: {},
          metadata: {},
          source: "@renamed",
          target: "@renamed",
        },
      ],
    };
    expect(
      f.store.admit(
        "principal",
        "key",
        prepareTransaction(scope, JSON.stringify(renamed).replace('"n":1', '"n":1.0')),
      ),
    ).toEqual({ kind: "existing", receipt: first });
    const changed = structuredClone(renamed);
    const changedFirst = changed.operations[0];
    if (!changedFirst) throw new Error("missing first operation");
    changedFirst.metadata = { author: "y" };
    expect(
      f.store.admit("principal", "key", prepareTransaction(scope, JSON.stringify(changed))),
    ).toEqual({ kind: "conflict" });
    const explicit = (id: string) => ({
      operations: [
        { operation: "createBead", name: "x", type: bead, id },
        { operation: "createLink", type: link, source: "@x", target: `${scope}beads/explicit` },
      ],
    });
    const direct = explicit("beads/explicit");
    const directSecond = direct.operations[1];
    if (!directSecond) throw new Error("missing second operation");
    directSecond.source = "beads/explicit";
    expect(
      prepareTransaction(scope, JSON.stringify(explicit(`${scope}beads/explicit`))).identity,
    ).toBe(prepareTransaction(scope, JSON.stringify(direct)).identity);
  });
  it("refuses unsupported/malformed batches before admission and preserves principal separation", () => {
    const f = fixture();
    for (const body of [
      { operations: [] },
      { operations: [{ operation: "putAlias", alias: "alias/a", target: "beads/a" }] },
      { operations: [{ ...batch.operations[0], idempotencyKey: "bad" }] },
      {
        operations: [
          { operation: "createLink", type: link, source: "@later", target: "beads/a" },
          batch.operations[0],
        ],
      },
    ])
      expect(() => prepareTransaction(scope, JSON.stringify(body))).toThrow();
    expect(f.store.inspect().groups).toEqual([]);
    f.store.execute(admit(f.store));
    expect(
      f.store.admit("other", "key", prepareTransaction(scope, JSON.stringify(batch))).kind,
    ).toBe("owned");
  });
  it("refuses another live owner, mismatched installation and implicit reseeding", () => {
    const f = fixture();
    expect(() => openTransactionStore({ ...f.options, create: false })).toThrow();
    expect(() => openTransactionStore(f.options)).toThrow();
    expect(() =>
      openTransactionStore({ ...f.options, file: `${f.options.file}.missing`, create: false }),
    ).toThrow();
  });
  it("retracts a live transient abort without poisoning the key or a replacement owner", () => {
    let fail = true;
    const f = fixture({
      fault(stage) {
        if (stage === "after-terminal" && fail) throw new Error("injected transient fault");
      },
    });
    const first = admit(f.store);
    expect(() => f.store.execute(first)).toThrow("injected transient fault");
    expect(f.store.receipt("principal", first.receipt.id)).toBeUndefined();
    expect(f.store.inspect().groups).toEqual([]);
    fail = false;
    const next = admit(f.store);
    expect(next.receipt.id).not.toBe(first.receipt.id);
    expect(f.store.execute(next).status).toBe("completed");
  });
  it("retains lossless numeric failure identity and does not mistake a different refused number for it", () => {
    const f = fixture();
    const text = JSON.stringify(batch).replace('"n":1', '"n":1e999');
    const prepared = prepareTransaction(scope, text),
      admitted = f.store.admit("principal", "numeric", prepared);
    if (admitted.kind !== "owned") throw new Error("expected owner");
    const receipt = f.store.execute(admitted.claim);
    expect(receipt.status).toBe("failed");
    expect(receipt.problem).toMatchObject({ code: "validation-failed", operationIndex: 0 });
    expect(f.store.admit("principal", "numeric", prepareTransaction(scope, text))).toEqual({
      kind: "existing",
      receipt,
    });
    expect(
      f.store.admit(
        "principal",
        "numeric",
        prepareTransaction(scope, text.replace("1e999", "2e999")),
      ),
    ).toEqual({ kind: "conflict" });
    expect(f.store.inspect().position).toBe("0");
  });
  it("preserves a committed disposition after abrupt exit and continues one ordered Scope prefix", () => {
    const f = fixture();
    f.store.close();
    const moduleUrl = new URL("../dist/transaction-store.js", import.meta.url).href;
    const batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href;
    const script = `import { writeSync } from 'node:fs'; import { openTransactionStore } from ${JSON.stringify(moduleUrl)}; import { prepareTransaction } from ${JSON.stringify(batchUrl)}; const s=openTransactionStore({...${JSON.stringify(f.options)},create:false}); const a=s.admit('principal','committed',prepareTransaction(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify(batch))}));if(a.kind!=='owned')process.exit(80);writeSync(1,JSON.stringify(s.execute(a.claim)));process.exit(79);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 15000,
      encoding: "utf8",
    });
    expect(child.status, child.stderr).toBe(79);
    const original = JSON.parse(child.stdout);
    const recovered = openTransactionStore({ ...f.options, create: false });
    cleanup.push(() => recovered.close());
    expect(recovered.recoveredPending).toBe(0);
    expect(
      recovered.admit("principal", "committed", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "existing", receipt: original });
    recovered.execute(admit(recovered, batch, "next"));
    const groups = recovered.inspect().groups as { previousPosition: string; position: string }[];
    expect(groups.map((g) => [g.previousPosition, g.position])).toEqual([
      ["pos-0", "pos-1"],
      ["pos-1", "pos-2"],
    ]);
    expect(recovered.inspect().resources).toHaveLength(4);
  });
  function execute(
    store: ReturnType<typeof openTransactionStore>,
    operations: unknown[],
    key: string,
  ) {
    const receipt = store.execute(admit(store, { operations }, key));
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    for (const group of store.inspect().groups)
      expect(groupSchema(group), JSON.stringify(groupSchema.errors)).toBe(true);
    return receipt;
  }
  function seed(store: ReturnType<typeof openTransactionStore>) {
    execute(store, batch.operations, "seed");
    const state = store.inspect().resources as {
      id: string;
      type: string;
      revision: string;
      properties: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }[];
    const beadRecord = state.find((r) => r.type === bead),
      linkRecord = state.find((r) => r.type === link);
    if (!beadRecord || !linkRecord) throw new Error("missing seed records");
    return { beadRecord, linkRecord };
  }
  function latestGroup(store: ReturnType<typeof openTransactionStore>) {
    return store.inspect().groups.at(-1) as {
      events: {
        ordinal: number;
        type: string;
        source: string;
        subject: string;
        subjectType: string;
        data: Record<string, unknown>;
      }[];
      changes: {
        operation: string;
        resourceKind: string;
        resource: {
          id: string;
          revision: string;
          properties?: Record<string, unknown>;
          metadata?: Record<string, unknown>;
        };
      }[];
    };
  }
  it("keeps intermediate update and reversal Events/results but only the final postimage", () => {
    const f = fixture(),
      { beadRecord } = seed(f.store);
    const up = [{ op: "replace", path: "/n", value: 2 }],
      down = [{ op: "replace", path: "/n", value: 1 }];
    const receipt = execute(
      f.store,
      [
        {
          operation: "updateBead",
          bead: beadRecord.id,
          expectedRevision: beadRecord.revision,
          propertiesChange: up,
        },
        { operation: "updateBead", bead: beadRecord.id, propertiesChange: down },
      ],
      "reversal",
    );
    const results = receipt.results as {
      resource: { revision: string; properties: Record<string, unknown> };
    }[];
    expect(results.map((r) => r.resource.properties.n)).toEqual([2, 1]);
    expect(results[0]?.resource.revision).not.toBe(results[1]?.resource.revision);
    const group = latestGroup(f.store);
    expect(group.events.map((e) => [e.ordinal, e.type, e.subject])).toEqual([
      [0, "updated", beadRecord.id],
      [1, "updated", beadRecord.id],
    ]);
    expect(group.events[0]?.data).toEqual({
      previousRevision: beadRecord.revision,
      revision: results[0]?.resource.revision,
      change: up,
    });
    expect(group.events[1]?.data).toEqual({
      previousRevision: results[0]?.resource.revision,
      revision: results[1]?.resource.revision,
      change: down,
    });
    expect(group.changes).toHaveLength(1);
    expect(group.changes[0]?.resource).toMatchObject({
      id: beadRecord.id,
      revision: results[1]?.resource.revision,
      properties: { n: 1 },
    });
    expect(group.changes[0]?.resource.revision).not.toBe(beadRecord.revision);
  });
  it("completes all-no-op guarded updates without a group, new revision or effectPosition, and replays after restart", () => {
    const f = fixture(),
      { beadRecord, linkRecord } = seed(f.store),
      initial = f.store.inspect();
    const operations = [
      {
        operation: "updateBead",
        bead: beadRecord.id,
        expectedRevision: beadRecord.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      },
      {
        operation: "updateLink",
        link: linkRecord.id,
        metadataChange: [{ op: "replace", path: "", value: {} }],
      },
    ];
    const receipt = execute(f.store, operations, "noop");
    expect(receipt.status).toBe("completed");
    expect(receipt.requiredPosition).toBe("pos-1");
    expect(receipt).not.toHaveProperty("effectPosition");
    expect(
      (receipt.results as { resource: { revision: string } }[]).map((r) => r.resource.revision),
    ).toEqual([beadRecord.revision, linkRecord.revision]);
    expect(f.store.inspect()).toEqual(initial);
    expect(
      f
        .reopen()
        .admit("principal", "noop", prepareTransaction(scope, JSON.stringify({ operations }))),
    ).toEqual({ kind: "existing", receipt });
    expect(f.store.inspect()).toEqual(initial);
  });
  it("serializes two admitted guarded updates into one transition and one retained revision failure", () => {
    const f = fixture(),
      { beadRecord } = seed(f.store);
    const operations = [
      {
        operation: "updateBead",
        bead: beadRecord.id,
        expectedRevision: beadRecord.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
      },
    ];
    const first = admit(f.store, { operations }, "first"),
      second = admit(f.store, { operations }, "second");
    expect(f.store.execute(first).status).toBe("completed");
    const receipt = f.store.execute(second);
    expect(receipt).toMatchObject({
      status: "failed",
      requiredPosition: "pos-2",
      problem: { code: "revision-mismatch", operationIndex: 0 },
    });
    expect(f.store.inspect().groups).toHaveLength(2);
    expect(
      f
        .reopen()
        .admit("principal", "second", prepareTransaction(scope, JSON.stringify({ operations }))),
    ).toEqual({ kind: "existing", receipt });
    const changedGuard = { operations: [{ ...operations[0], expectedRevision: "different" }] };
    expect(
      f.store.admit("principal", "second", prepareTransaction(scope, JSON.stringify(changedGuard))),
    ).toEqual({ kind: "conflict" });
  });
  it("updates Link properties and metadata atomically with one Link-subject Event and no endpoint revision", () => {
    const f = fixture(),
      { beadRecord, linkRecord } = seed(f.store);
    const propertiesChange = [{ op: "add", path: "/weight", value: 3 }],
      metadataChange = [{ op: "add", path: "/note", value: "x" }];
    const operations = [
      {
        operation: "updateLink",
        link: linkRecord.id,
        expectedRevision: linkRecord.revision,
        propertiesChange,
        metadataChange,
        attribution: { principal: "writer", basis: "writer-supplied" },
      },
    ];
    const receipt = execute(f.store, operations, "link-update"),
      group = latestGroup(f.store);
    expect(group.events).toHaveLength(1);
    expect(group.events[0]).toMatchObject({
      type: "updated",
      source: `${scope}events/`,
      subject: linkRecord.id,
      subjectType: link,
      data: {
        previousRevision: linkRecord.revision,
        change: propertiesChange,
        metadataChange,
        attribution: { principal: "writer", basis: "writer-supplied" },
      },
    });
    expect(group.changes).toHaveLength(1);
    expect(group.changes[0]?.resource).toMatchObject({
      properties: { weight: 3 },
      metadata: { note: "x" },
    });
    expect(
      f.store.inspect().resources.find((r) => (r as { id: string }).id === beadRecord.id),
    ).toEqual(beadRecord);
    const equivalent = JSON.stringify({ operations }).replace('"value":3', '"value":3.0');
    expect(
      f.store.admit("principal", "link-update", prepareTransaction(scope, equivalent)),
    ).toEqual({ kind: "existing", receipt });
  });
  it("deletes a self-Link before its Bead with ordered unlink facts and final tombstones", () => {
    const f = fixture(),
      { beadRecord, linkRecord } = seed(f.store);
    execute(
      f.store,
      [
        { operation: "deleteLink", link: linkRecord.id, expectedRevision: linkRecord.revision },
        { operation: "deleteBead", bead: beadRecord.id, expectedRevision: beadRecord.revision },
      ],
      "delete",
    );
    const group = latestGroup(f.store);
    expect(group.events.map((e) => [e.ordinal, e.type, e.subject, e.subjectType])).toEqual([
      [0, "deleted", linkRecord.id, link],
      [1, "unlinked", linkRecord.id, link],
      [2, "unlinked", linkRecord.id, link],
      [3, "deleted", beadRecord.id, bead],
    ]);
    expect(group.events[1]?.data).toEqual({
      endpoint: "source",
      link: { id: linkRecord.id, type: link },
      source: beadRecord.id,
      target: beadRecord.id,
    });
    expect(group.events[2]?.data.endpoint).toBe("target");
    expect(group.changes).toEqual([
      {
        operation: "tombstone",
        resourceKind: "link",
        resource: { id: linkRecord.id, type: link, revision: linkRecord.revision },
      },
      {
        operation: "tombstone",
        resourceKind: "bead",
        resource: { id: beadRecord.id, type: bead, revision: beadRecord.revision },
      },
    ]);
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().identities).toHaveLength(2);
    const reuse = execute(
      f.store,
      [{ operation: "createBead", type: bead, id: beadRecord.id }],
      "reuse",
    );
    expect(reuse.problem).toMatchObject({ code: "identity-taken" });
  });
  it("rolls back earlier update and Link deletion when the final guarded Bead deletion fails", () => {
    const f = fixture(),
      { beadRecord, linkRecord } = seed(f.store),
      initial = f.store.inspect();
    const receipt = execute(
      f.store,
      [
        {
          operation: "updateBead",
          bead: beadRecord.id,
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        },
        { operation: "deleteLink", link: linkRecord.id },
        { operation: "deleteBead", bead: beadRecord.id, expectedRevision: beadRecord.revision },
      ],
      "late-failure",
    );
    expect(receipt).toMatchObject({
      status: "failed",
      problem: { operationIndex: 2, code: "revision-mismatch" },
    });
    expect(receipt).not.toHaveProperty("results");
    expect(f.store.inspect()).toEqual(initial);
    expect(f.reopen().inspect()).toEqual(initial);
  });
  it("applies label-bound create/update/delete in order and normalizes to one final tombstone", () => {
    const f = fixture();
    const receipt = execute(
      f.store,
      [
        { operation: "createBead", name: "new", type: bead, properties: { n: 1 } },
        {
          operation: "updateBead",
          bead: "@new",
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        },
        { operation: "deleteBead", bead: "@new" },
      ],
      "lifetime",
    );
    const group = latestGroup(f.store),
      results = receipt.results as { resource?: { revision: string } }[];
    expect(group.events.map((e) => e.type)).toEqual(["created", "updated", "deleted"]);
    expect(group.events[2]?.data.revision).toBe(results[1]?.resource?.revision);
    expect(group.changes).toHaveLength(1);
    expect(group.changes[0]?.operation).toBe("tombstone");
    expect(group.changes[0]?.resource.revision).toBe(results[1]?.resource?.revision);
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.inspect().identities).toHaveLength(1);
  });
  it("expires completed detail only after its promised instant, retaining original allocations after deletion and replay", () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const original = execute(f.store, batch.operations, "retained");
    const entries = original.results as {
      operationIndex: number;
      operationName?: string;
      resource: { id: string; type: string };
    }[];
    const a = entries[0]?.resource,
      b = entries[1]?.resource;
    if (!a || !b) throw new Error("missing allocations");
    execute(
      f.store,
      [
        { operation: "deleteLink", link: b.id },
        { operation: "deleteBead", bead: a.id },
      ],
      "delete-retained",
    );
    const state = f.store.inspect();
    now = Date.parse(String(original.expiresAt));
    expect(f.store.maintain()).toEqual({ completedExpired: 0, failedForgotten: 0 });
    expect(f.store.receipt("principal", original.id)).toEqual(original);
    now++;
    expect(f.store.maintain()).toEqual({ completedExpired: 2, failedForgotten: 0 });
    const expired = f.store.receipt("principal", original.id);
    expect(expired).toEqual({
      id: original.id,
      status: "completed",
      detail: "expired",
      idempotencyKey: "retained",
      scopeEpoch: original.scopeEpoch,
      authorizationView: original.authorizationView,
      transaction: original.transaction,
      requiredPosition: original.requiredPosition,
      effectPosition: original.effectPosition,
      allocated: [
        { operationIndex: 0, operationName: "a", id: a.id, type: a.type },
        { operationIndex: 1, id: b.id, type: b.type },
      ],
    });
    expect(receiptSchema(expired), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(f.store.inspect()).toEqual(state);
    expect(f.store.receipt("other", original.id)).toBeUndefined();
    expect(
      f.reopen().admit("principal", "retained", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "existing", receipt: expired });
    const renamed = JSON.stringify(batch)
      .replaceAll('"a"', '"renamed"')
      .replaceAll('"@a"', '"@renamed"');
    expect(f.store.admit("principal", "retained", prepareTransaction(scope, renamed))).toEqual({
      kind: "existing",
      receipt: expired,
    });
    expect(
      f.store.admit(
        "principal",
        "retained",
        prepareTransaction(scope, JSON.stringify(batch).replace('"n":1', '"n":2')),
      ),
    ).toEqual({ kind: "conflict" });
  });
  it("compacts no-op receipts on restart with no effect position and no allocations", () => {
    let now = 2000;
    const f = fixture({ clock: () => now }),
      { beadRecord } = seed(f.store);
    const operations = [
      {
        operation: "updateBead",
        bead: beadRecord.id,
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      },
    ];
    const receipt = execute(f.store, operations, "noop-expiry"),
      state = f.store.inspect();
    now = Date.parse(String(receipt.expiresAt)) + 1;
    const replay = f
      .reopen()
      .admit("principal", "noop-expiry", prepareTransaction(scope, JSON.stringify({ operations })));
    expect(replay).toMatchObject({
      kind: "existing",
      receipt: {
        id: receipt.id,
        status: "completed",
        detail: "expired",
        requiredPosition: "pos-1",
        allocated: [],
      },
    });
    if (replay.kind !== "existing") throw new Error("missing retained no-op");
    expect(replay.receipt).not.toHaveProperty("effectPosition");
    expect(replay.receipt).not.toHaveProperty("expiresAt");
    expect(receiptSchema(replay.receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    expect(f.store.inspect()).toEqual(state);
  });
  it("forgets failed receipts whole after expiry and admits the same key as new against changed state", () => {
    let now = 3000;
    const f = fixture({ clock: () => now });
    const operations = [
      batch.operations[0],
      { operation: "createLink", type: link, source: "@a", target: "beads/later" },
    ];
    const failed = execute(f.store, operations, "failed-key");
    expect(failed.status).toBe("failed");
    execute(f.store, [{ operation: "createBead", type: bead, id: "beads/later" }], "make-target");
    now = Date.parse(String(failed.expiresAt));
    expect(
      f.store.admit(
        "principal",
        "failed-key",
        prepareTransaction(scope, JSON.stringify({ operations })),
      ),
    ).toEqual({ kind: "existing", receipt: failed });
    now++;
    // Admission itself maintains this key; no restart/manual sweep is necessary.
    const newClaim = admit(f.store, { operations }, "failed-key");
    expect(newClaim.receipt.id).not.toBe(failed.id);
    expect(newClaim.receipt.transaction).not.toBe(failed.transaction);
    expect(f.store.receipt("principal", failed.id)).toBeUndefined();
    expect(f.store.execute(newClaim).status).toBe("completed");
    expect(f.store.inspect().resources).toHaveLength(3);
    expect(f.store.inspect().groups).toHaveLength(2);
  });
  it("does not expire a live pending claim, and preserves pending join/retraction/fencing past the receipt interval", () => {
    let now = 4000;
    const f = fixture({ clock: () => now }),
      first = admit(f.store);
    now += 2 * 86400000;
    expect(f.store.maintain()).toEqual({ completedExpired: 0, failedForgotten: 0 });
    expect(
      f.store.admit("principal", "key", prepareTransaction(scope, JSON.stringify(batch))),
    ).toEqual({ kind: "existing", receipt: first.receipt });
    expect(f.store.retract(first)).toBe(true);
    const next = admit(f.store);
    expect(() => f.store.execute(first)).toThrow("fenced");
    expect(f.store.execute(next).status).toBe("completed");
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("bases retention on terminal time rather than admission or evaluation start", () => {
    let now = 5000;
    const f = fixture({
      clock: () => now,
      fault(stage) {
        if (stage === "after-effects") now += 10000;
      },
    });
    const pending = admit(f.store);
    now += 20000;
    const receipt = f.store.execute(pending);
    expect(Date.parse(String(receipt.expiresAt))).toBe(now + 86400000);
    now = 5000 + 86400000 + 1;
    expect(f.store.maintain()).toEqual({ completedExpired: 0, failedForgotten: 0 });
    expect(f.store.receipt("principal", receipt.id)?.detail).toBe("available");
  });
  it("maintains terminal receipts in a live idle owner and cancels its timer on close", () => {
    vi.useFakeTimers();
    let now = 6000;
    const f = fixture({ clock: () => now, maintenanceIntervalMs: 25 });
    const receipt = execute(f.store, batch.operations, "timer");
    now = Date.parse(String(receipt.expiresAt)) + 1;
    vi.advanceTimersByTime(25);
    expect(f.store.maintain()).toEqual({ completedExpired: 0, failedForgotten: 0 });
    expect(f.store.receipt("principal", receipt.id)?.detail).toBe("expired");
    expect(vi.getTimerCount()).toBe(1);
    f.store.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rolls back a failed maintenance sweep, fences background work and preserves restart recovery", () => {
    vi.useFakeTimers();
    let now = 7000,
      inject = false;
    const f = fixture({
      clock: () => now,
      maintenanceIntervalMs: 25,
      fault(stage) {
        if (inject && stage === "before-maintenance-commit") throw new Error("maintenance fault");
      },
    });
    const completed = execute(f.store, batch.operations, "completed"),
      failed = execute(f.store, [{ operation: "deleteBead", bead: "beads/missing" }], "failed");
    const pending = admit(f.store, batch, "pending"),
      initial = f.store.inspect();
    now = Date.parse(String(completed.expiresAt)) + 1;
    inject = true;
    vi.advanceTimersByTime(25);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => f.store.execute(pending)).toThrow("owner fenced");
    const raw = new DatabaseSync(f.options.file);
    try {
      const receipts = raw
        .prepare("SELECT receipt FROM receipts WHERE owner IS NULL")
        .all()
        .map((r) => JSON.parse(String(r.receipt)));
      expect(receipts).toHaveLength(2);
      expect(receipts.every((r) => r.detail === "available")).toBe(true);
    } finally {
      raw.close();
    }
    inject = false;
    const reopened = f.reopen();
    expect(reopened.recoveredPending).toBe(1);
    expect(reopened.receipt("principal", completed.id)?.detail).toBe("expired");
    expect(reopened.receipt("principal", failed.id)).toBeUndefined();
    expect(reopened.receipt("principal", pending.receipt.id)).toBeUndefined();
    expect(reopened.inspect()).toEqual(initial);
  });
  for (const operation of [
    "createBead",
    "createLink",
    "updateBead",
    "updateLink",
    "deleteBead",
    "deleteLink",
  ] as const) {
    for (const firstCarrier of ["singleton", "batch"] as const) {
      it(`${operation} shares one receipt/key with an equivalent ${firstCarrier}-first request across carriers`, () => {
        const f = fixture(),
          { beadRecord, linkRecord } = seed(f.store);
        if (operation === "deleteBead")
          execute(
            f.store,
            [{ operation: "deleteLink", link: linkRecord.id }],
            "unlink-before-delete",
          );
        const relative = (id: string) => id.slice(scope.length);
        const bodies: Record<typeof operation, Record<string, unknown>> = {
          createBead: { type: bead, id: "beads/new", properties: { n: 1 } },
          createLink: {
            type: link,
            id: "links/new",
            source: relative(beadRecord.id),
            target: relative(beadRecord.id),
          },
          updateBead: {
            bead: relative(beadRecord.id),
            expectedRevision: beadRecord.revision,
            propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
          },
          updateLink: {
            link: relative(linkRecord.id),
            expectedRevision: linkRecord.revision,
            metadataChange: [{ op: "add", path: "/note", value: "x" }],
          },
          deleteBead: { bead: relative(beadRecord.id), expectedRevision: beadRecord.revision },
          deleteLink: { link: relative(linkRecord.id), expectedRevision: linkRecord.revision },
        };
        const input = bodies[operation],
          canonical = { ...input };
        for (const field of ["id", "source", "target", "bead", "link"]) {
          const value = canonical[field];
          if (typeof value === "string" && /^(beads|links)\//.test(value))
            canonical[field] = `${scope}${value}`;
        }
        if (operation.startsWith("create")) canonical.metadata = {};
        const singleton = prepareTransactionSingleton(scope, operation, JSON.stringify(input));
        const oneBatch = prepareTransaction(
          scope,
          JSON.stringify({
            operations: [
              {
                operation,
                ...(operation.startsWith("create") ? { name: "named" } : {}),
                ...canonical,
              },
            ],
          }),
        );
        expect(singleton.identity).toBe(oneBatch.identity);
        const first = firstCarrier === "singleton" ? singleton : oneBatch,
          retry = firstCarrier === "singleton" ? oneBatch : singleton;
        const admission = f.store.admit("principal", "cross", first);
        if (admission.kind !== "owned") throw new Error("expected owner");
        expect(f.store.admit("principal", "cross", retry)).toEqual({
          kind: "existing",
          receipt: admission.claim.receipt,
        });
        const receipt = f.store.execute(admission.claim),
          state = f.store.inspect();
        expect(receipt.status).toBe("completed");
        expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
        expect(receipt.results).toHaveLength(1);
        const result = (receipt.results as { operationIndex: number; operationName?: string }[])[0];
        expect(result?.operationIndex).toBe(0);
        expect(result?.operationName).toBe(
          firstCarrier === "batch" && operation.startsWith("create") ? "named" : undefined,
        );
        expect(f.store.admit("principal", "cross", retry)).toEqual({ kind: "existing", receipt });
        expect(f.reopen().admit("principal", "cross", retry)).toEqual({
          kind: "existing",
          receipt,
        });
        expect(f.store.inspect()).toEqual(state);
        for (const group of state.groups)
          expect(groupSchema(group), JSON.stringify(groupSchema.errors)).toBe(true);
      });
    }
  }
  it("keeps carrier-independent conflicts, refused numbers and permanent failures", () => {
    const f = fixture();
    const input = JSON.stringify({ type: bead, properties: { n: 1 } }).replace(
      '"n":1',
      '"n":1e999',
    );
    const singleton = prepareTransactionSingleton(scope, "createBead", input);
    const pending = f.store.admit("principal", "failure", singleton);
    if (pending.kind !== "owned") throw new Error("expected owner");
    const receipt = f.store.execute(pending.claim);
    expect(receipt).toMatchObject({
      status: "failed",
      problem: { code: "validation-failed", operationIndex: 0 },
    });
    const same = prepareTransaction(
      scope,
      `{"operations":[{"operation":"createBead","name":"new",${input.slice(1)}]}`,
    );
    expect(f.store.admit("principal", "failure", same)).toEqual({ kind: "existing", receipt });
    const changed = prepareTransaction(
      scope,
      `{"operations":[{"operation":"createBead",${input.slice(1).replace("1e999", "2e999")}]}`,
    );
    expect(f.store.admit("principal", "failure", changed)).toEqual({ kind: "conflict" });
    expect(f.store.inspect().resources).toEqual([]);
  });
  for (const operation of ["createBead", "updateBead"] as const)
    for (const firstCarrier of ["singleton", "batch"] as const)
      for (const firstContext of ["omitted", "empty"] as const)
        it(`${operation} joins ${firstCarrier}-first ${firstContext} context with its equivalent default`, () => {
          const f = fixture();
          const input =
            operation === "createBead"
              ? { type: bead }
              : {
                  bead: seed(f.store).beadRecord.id,
                  propertiesChange: [{ op: "add", path: "/changed", value: true }],
                };
          function prepare(
            carrier: "singleton" | "batch",
            context: "omitted" | "empty" | { agent: null } | { message: null },
          ) {
            const body = {
              ...input,
              ...(context === "omitted"
                ? {}
                : { changeContext: context === "empty" ? {} : context }),
            };
            return carrier === "singleton"
              ? prepareTransactionSingleton(scope, operation, JSON.stringify(body))
              : prepareTransaction(scope, JSON.stringify({ operations: [{ operation, ...body }] }));
          }
          const secondCarrier = firstCarrier === "singleton" ? "batch" : "singleton";
          const first = prepare(firstCarrier, firstContext);
          const retry = prepare(secondCarrier, firstContext === "omitted" ? "empty" : "omitted");
          expect(first.identity).toBe(retry.identity);
          const admitted = f.store.admit("principal", "context-default", first);
          if (admitted.kind !== "owned") throw new Error("expected owner");
          expect(f.store.admit("principal", "context-default", retry)).toEqual({
            kind: "existing",
            receipt: admitted.claim.receipt,
          });
          for (const context of [{ agent: null }, { message: null }] as const)
            expect(
              f.store.admit("principal", "context-default", prepare(secondCarrier, context)),
            ).toEqual({ kind: "conflict" });
          const completed = f.store.execute(admitted.claim);
          expect(completed.status).toBe("completed");
          const state = f.store.inspect();
          expect(f.store.admit("principal", "context-default", retry)).toEqual({
            kind: "existing",
            receipt: completed,
          });
          expect(f.reopen().admit("principal", "context-default", retry)).toEqual({
            kind: "existing",
            receipt: completed,
          });
          expect(f.store.inspect()).toEqual(state);
          for (const context of [{ agent: null }, { message: null }] as const)
            expect(
              f.store.admit("principal", "context-default", prepare(secondCarrier, context)),
            ).toEqual({ kind: "conflict" });
        });
  for (const policy of [undefined, "unknown-policy"])
    it(`refuses ${policy ?? "unversioned"} identity policy without altering retained outcomes or pending ownership`, () => {
      let now = 1000;
      const f = fixture({ clock: () => now });
      const completed = execute(f.store, batch.operations, "completed");
      const pending = admit(f.store, batch, "pending");
      f.store.close();
      const raw = new DatabaseSync(f.options.file);
      let pendingRow: Record<string, import("node:sqlite").SQLOutputValue> | undefined;
      try {
        const row = raw.prepare("SELECT value FROM metadata WHERE name='configuration'").get();
        const configuration = JSON.parse(String(row?.value));
        if (policy === undefined) delete configuration.identityPolicy;
        else configuration.identityPolicy = policy;
        raw
          .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
          .run(JSON.stringify(configuration));
        pendingRow = raw.prepare("SELECT * FROM receipts WHERE key='pending'").get();
      } finally {
        raw.close();
      }
      now = Date.parse(String(completed.expiresAt)) + 1;
      const before = readFileSync(f.options.file);
      expect(() => openTransactionStore({ ...f.options, create: false })).toThrow(
        "transaction identity policy mismatch; explicit new-store provisioning required",
      );
      expect(readFileSync(f.options.file)).toEqual(before);
      const inspected = new DatabaseSync(f.options.file, { readOnly: true });
      try {
        expect(inspected.prepare("SELECT * FROM receipts WHERE key='pending'").get()).toEqual(
          pendingRow,
        );
        expect(JSON.parse(String(pendingRow?.receipt)).id).toBe(pending.receipt.id);
        const row = inspected.prepare("SELECT receipt FROM receipts WHERE key='completed'").get();
        expect(JSON.parse(String(row?.receipt))).toEqual(completed);
      } finally {
        inspected.close();
      }
    });
  it("retracts a singleton attempt then admits its equivalent batch without inheriting ownership", () => {
    const f = fixture();
    const singleton = prepareTransactionSingleton(
      scope,
      "createBead",
      JSON.stringify({ type: bead }),
    );
    const first = f.store.admit("principal", "retract", singleton);
    if (first.kind !== "owned") throw new Error("expected owner");
    expect(f.store.retract(first.claim)).toBe(true);
    const equivalent = prepareTransaction(
      scope,
      JSON.stringify({ operations: [{ operation: "createBead", type: bead, name: "created" }] }),
    );
    const next = f.store.admit("principal", "retract", equivalent);
    if (next.kind !== "owned") throw new Error("expected replacement owner");
    expect(next.claim.receipt.id).not.toBe(first.claim.receipt.id);
    expect(() => f.store.execute(first.claim)).toThrow("fenced");
    const receipt = f.store.execute(next.claim);
    expect(f.store.admit("principal", "retract", singleton)).toEqual({ kind: "existing", receipt });
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("preserves expired singleton allocation through batch retry and makes expired failed keys fresh across carriers", () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    const singleton = prepareTransactionSingleton(
      scope,
      "createBead",
      JSON.stringify({ type: bead }),
    );
    const admitted = f.store.admit("principal", "expires", singleton);
    if (admitted.kind !== "owned") throw new Error("expected owner");
    const original = f.store.execute(admitted.claim);
    const failedInput = { operation: "deleteBead", bead: "beads/missing" };
    const failed = execute(f.store, [failedInput], "failed-cross");
    now = Date.parse(String(original.expiresAt)) + 1;
    const equivalent = prepareTransaction(
      scope,
      JSON.stringify({ operations: [{ operation: "createBead", name: "retry-name", type: bead }] }),
    );
    const replay = f.reopen().admit("principal", "expires", equivalent);
    expect(replay).toMatchObject({
      kind: "existing",
      receipt: { id: original.id, detail: "expired", allocated: [{ operationIndex: 0 }] },
    });
    if (replay.kind !== "existing") throw new Error("expected retained allocation");
    expect((replay.receipt.allocated as unknown[])[0]).not.toHaveProperty("operationName");
    expect(f.store.admit("principal", "expires", singleton)).toEqual(replay);
    expect(f.store.inspect().groups).toHaveLength(1);
    const fresh = f.store.admit(
      "principal",
      "failed-cross",
      prepareTransactionSingleton(scope, "deleteBead", JSON.stringify({ bead: "beads/missing" })),
    );
    expect(fresh.kind).toBe("owned");
    if (fresh.kind !== "owned") throw new Error("expected fresh failed key");
    expect(fresh.claim.receipt.id).not.toBe(failed.id);
    expect(f.store.receipt("principal", failed.id)).toBeUndefined();
  });
  it("rejects singleton batch-only syntax and local labels before owner admission", () => {
    const f = fixture();
    for (const input of [
      { type: bead, operation: "createBead" },
      { type: bead, name: "x" },
      { type: bead, idempotencyKey: "body-key" },
      { type: bead, id: "@x" },
    ])
      expect(() =>
        prepareTransactionSingleton(scope, "createBead", JSON.stringify(input)),
      ).toThrow();
    expect(() =>
      prepareTransactionSingleton(
        scope,
        "createLink",
        JSON.stringify({ type: link, source: "@x", target: "beads/a" }),
      ),
    ).toThrow();
    expect(() =>
      prepareTransactionSingleton(
        scope,
        "setBead" as never,
        JSON.stringify({ alias: "alias/a", target: "beads/a" }),
      ),
    ).toThrow("unsupported");
    expect(f.store.inspect().groups).toEqual([]);
  });
  for (const stage of ["after-admission", "after-effects", "after-terminal"] as const)
    it(`recovers abrupt process exit ${stage} without partial graph, receipt or group`, () => {
      const f = fixture();
      f.store.close();
      const moduleUrl = new URL("../dist/transaction-store.js", import.meta.url).href;
      const batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href;
      const script = `import { openTransactionStore } from ${JSON.stringify(moduleUrl)}; import { prepareTransaction } from ${JSON.stringify(batchUrl)}; const s=openTransactionStore({...${JSON.stringify(f.options)},create:false,fault(stage){if(stage===${JSON.stringify(stage)})process.exit(79)}}); const a=s.admit('principal','crash',prepareTransaction(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify(batch))}));if(a.kind==='owned')s.execute(a.claim);process.exit(80);`;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        timeout: 15000,
        encoding: "utf8",
      });
      expect(child.status, child.stderr).toBe(79);
      const recovered = openTransactionStore({ ...f.options, create: false });
      cleanup.push(() => recovered.close());
      expect(recovered.recoveredPending).toBe(1);
      expect(recovered.inspect()).toEqual({
        resources: [],
        groups: [],
        identities: [],
        position: "0",
      });
      const claim = admit(recovered, batch, "crash");
      expect(recovered.execute(claim).status).toBe("completed");
      expect(recovered.inspect().groups).toHaveLength(1);
    });
  function aliasRequest(operation: "putAlias" | "deleteAlias", input: unknown) {
    return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
  }
  function aliasExecute(
    store: ReturnType<typeof openTransactionStore>,
    operation: "putAlias" | "deleteAlias",
    input: unknown,
    key: string,
  ) {
    const admitted = store.admit("principal", key, aliasRequest(operation, input));
    if (admitted.kind !== "owned") throw new Error("expected alias ownership");
    const receipt = store.execute(admitted.claim);
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
    return receipt;
  }
  it("commits locator-only alias results without Resource revisions, Events, groups or positions", () => {
    const f = fixture();
    execute(
      f.store,
      [
        { operation: "createBead", type: bead, id: "beads/a" },
        { operation: "createBead", type: bead, id: "beads/b" },
      ],
      "seed-alias",
    );
    const before = f.store.inspect();
    for (const [key, operation, input, outcome] of [
      ["put", "putAlias", { alias: "alias/work", target: "beads/a" }, "created"],
      ["same", "putAlias", { alias: "alias/work", target: "beads/a" }, "updated"],
      ["repoint", "putAlias", { alias: "alias/work", target: "beads/b" }, "updated"],
      ["delete", "deleteAlias", { alias: "alias/work" }, "deleted"],
    ] as const) {
      const receipt = aliasExecute(f.store, operation, input, key);
      expect(receipt).toMatchObject({ status: "completed", requiredPosition: "pos-1", next: null });
      expect(receipt).not.toHaveProperty("effectPosition");
      expect(receipt.results).toEqual([
        {
          operationIndex: 0,
          outcome,
          alias: `${scope}alias/work`,
          ...("target" in input ? { target: `${scope}${input.target}` } : {}),
        },
      ]);
      expect(f.store.aliasTarget("work")).toBe(
        "target" in input ? `${scope}${input.target}` : undefined,
      );
      expect(f.store.inspect()).toEqual(before);
    }
  });
  it("retains alias dispositions after repoint/delete/recreate and shares the Resource key namespace", () => {
    const f = fixture();
    execute(
      f.store,
      [
        { operation: "createBead", type: bead, id: "beads/a" },
        { operation: "createBead", type: bead, id: "beads/b" },
      ],
      "seed-alias",
    );
    const original = aliasExecute(
      f.store,
      "putAlias",
      { alias: "alias/work", target: "beads/a" },
      "put",
    );
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/b" }, "repoint");
    const canonical = aliasRequest("putAlias", {
      alias: `${scope}alias/work`,
      target: `${scope}beads/a`,
    });
    expect(f.store.admit("principal", "put", canonical)).toEqual({
      kind: "existing",
      receipt: original,
    });
    expect(f.store.aliasTarget("work")).toBe(`${scope}beads/b`);
    expect(
      f.store.admit(
        "principal",
        "put",
        aliasRequest("putAlias", { alias: "alias/work", target: "beads/b" }),
      ),
    ).toEqual({ kind: "conflict" });
    expect(
      f.store.admit(
        "principal",
        "put",
        prepareTransactionSingleton(scope, "createBead", JSON.stringify({ type: bead })),
      ),
    ).toEqual({ kind: "conflict" });
    const deleted = aliasExecute(f.store, "deleteAlias", { alias: "alias/work" }, "delete");
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "recreate");
    expect(
      f.reopen().admit("principal", "delete", aliasRequest("deleteAlias", { alias: "alias/work" })),
    ).toEqual({ kind: "existing", receipt: deleted });
    expect(f.store.admit("principal", "put", canonical)).toEqual({
      kind: "existing",
      receipt: original,
    });
    expect(f.store.aliasTarget("work")).toBe(`${scope}beads/a`);
    expect(f.store.receipt("other", original.id)).toBeUndefined();
  });
  it("joins alias pending work, retracts its owner and fences stale execution", () => {
    const f = fixture();
    execute(f.store, [{ operation: "createBead", type: bead, id: "beads/a" }], "seed-alias");
    const request = aliasRequest("putAlias", { alias: "alias/work", target: "beads/a" });
    const first = f.store.admit("principal", "alias", request);
    if (first.kind !== "owned") throw new Error("expected owner");
    expect(f.store.admit("principal", "alias", request)).toEqual({
      kind: "existing",
      receipt: first.claim.receipt,
    });
    expect(f.store.aliasTarget("work")).toBeUndefined();
    expect(f.store.retract(first.claim)).toBe(true);
    const next = f.store.admit("principal", "alias", request);
    if (next.kind !== "owned") throw new Error("expected replacement owner");
    expect(() => f.store.execute(first.claim)).toThrow("fenced");
    expect(f.store.execute(next.claim).status).toBe("completed");
    expect(f.store.aliasTarget("work")).toBe(`${scope}beads/a`);
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it("compacts alias creations/deletions with no allocations and never reexecutes their expired keys", () => {
    let now = 1000;
    const f = fixture({ clock: () => now });
    execute(f.store, [{ operation: "createBead", type: bead, id: "beads/a" }], "seed-alias");
    const created = aliasExecute(
      f.store,
      "putAlias",
      { alias: "alias/work", target: "beads/a" },
      "put",
    );
    const deleted = aliasExecute(f.store, "deleteAlias", { alias: "alias/work" }, "delete");
    const failed = aliasExecute(f.store, "deleteAlias", { alias: "alias/missing" }, "failed");
    now = Date.parse(String(created.expiresAt));
    f.store.maintain();
    expect(f.store.receipt("principal", created.id)).toEqual(created);
    now++;
    f.store.maintain();
    for (const receipt of [created, deleted]) {
      const compact = f.store.receipt("principal", receipt.id);
      expect(compact).toMatchObject({
        id: receipt.id,
        status: "completed",
        detail: "expired",
        requiredPosition: "pos-1",
        allocated: [],
      });
      expect(compact).not.toHaveProperty("effectPosition");
      expect(compact).not.toHaveProperty("results");
      expect(receiptSchema(compact), JSON.stringify(receiptSchema.errors)).toBe(true);
    }
    expect(f.store.receipt("principal", failed.id)).toBeUndefined();
    const replay = f
      .reopen()
      .admit(
        "principal",
        "put",
        aliasRequest("putAlias", { alias: "alias/work", target: "beads/a" }),
      );
    expect(replay).toMatchObject({
      kind: "existing",
      receipt: { id: created.id, detail: "expired", allocated: [] },
    });
    expect(f.store.aliasTarget("work")).toBeUndefined();
    expect(
      f.store.admit("principal", "failed", aliasRequest("deleteAlias", { alias: "alias/missing" }))
        .kind,
    ).toBe("owned");
  });
  it("enforces Bead/alias uniqueness across deletion and allows Link identities with the same suffix", () => {
    const f = fixture();
    execute(
      f.store,
      [
        { operation: "createBead", type: bead, id: "beads/a" },
        { operation: "createBead", type: bead, id: "beads/reserved" },
        { operation: "deleteBead", bead: "beads/reserved" },
      ],
      "seed-alias",
    );
    for (const suffix of ["a", "reserved"]) {
      const receipt = aliasExecute(
        f.store,
        "putAlias",
        { alias: `alias/${suffix}`, target: "links/invalid" },
        `blocked-${suffix}`,
      );
      expect(receipt).toMatchObject({
        status: "failed",
        problem: { code: "identity-taken", operationIndex: 0 },
      });
    }
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const blocked = execute(
      f.store,
      [{ operation: "createBead", id: "beads/work", type: bead }],
      "blocked-bead",
    );
    expect(blocked).toMatchObject({ status: "failed", problem: { code: "alias-path-taken" } });
    expect(
      execute(
        f.store,
        [
          {
            operation: "createLink",
            id: "links/work",
            type: link,
            source: "beads/a",
            target: "beads/a",
          },
        ],
        "link",
      ).status,
    ).toBe("completed");
    aliasExecute(f.store, "deleteAlias", { alias: "alias/work" }, "delete");
    expect(
      execute(f.store, [{ operation: "createBead", id: "beads/work", type: bead }], "released-bead")
        .status,
    ).toBe("completed");
  });
  it("retains alias target failures without effects and still refuses aliases in atomic batches", () => {
    const f = fixture();
    for (const target of [
      "alias/other",
      "links/other",
      "https://external.test/beads/x",
      "beads/missing",
    ]) {
      const input = { alias: "alias/work", target };
      const key = `bad-${["alias/other", "links/other", "https://external.test/beads/x", "beads/missing"].indexOf(target)}`;
      const receipt = aliasExecute(f.store, "putAlias", input, key);
      expect(receipt).toMatchObject({
        status: "failed",
        requiredPosition: "pos-0",
        problem: {
          code: target === "beads/missing" ? "resource-not-found" : "validation-failed",
          operationIndex: 0,
        },
      });
      expect(f.store.admit("principal", key, aliasRequest("putAlias", input))).toEqual({
        kind: "existing",
        receipt,
      });
      expect(f.store.aliasTarget("work")).toBeUndefined();
    }
    for (const operation of ["putAlias", "deleteAlias"])
      expect(() =>
        prepareTransaction(
          scope,
          JSON.stringify({
            operations: [
              {
                operation,
                alias: "alias/work",
                ...(operation === "putAlias" ? { target: "beads/a" } : {}),
              },
            ],
          }),
        ),
      ).toThrow("unsupported");
    expect(f.store.inspect()).toEqual({ resources: [], groups: [], identities: [], position: "0" });
  });
  for (const stage of ["after-effects", "after-terminal"] as const)
    it(`rolls back alias effects and retracts receipt on live ${stage} fault`, () => {
      let inject = false;
      const f = fixture({
        fault(at) {
          if (inject && at === stage) throw new Error("alias fault");
        },
      });
      execute(f.store, [{ operation: "createBead", id: "beads/a", type: bead }], "seed-alias");
      const request = aliasRequest("putAlias", { alias: "alias/work", target: "beads/a" });
      const admitted = f.store.admit("principal", "alias", request);
      if (admitted.kind !== "owned") throw new Error("expected alias ownership");
      inject = true;
      expect(() => f.store.execute(admitted.claim)).toThrow("alias fault");
      expect(f.store.aliasTarget("work")).toBeUndefined();
      expect(f.store.receipt("principal", admitted.claim.receipt.id)).toBeUndefined();
      inject = false;
      expect(
        aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "alias")
          .status,
      ).toBe("completed");
      expect(f.store.inspect().groups).toHaveLength(1);
    });
  for (const stage of ["after-admission", "after-effects", "after-terminal", "committed"] as const)
    it(`recovers alias process exit ${stage} with atomic locator/receipt disposition`, () => {
      const f = fixture();
      execute(f.store, [{ operation: "createBead", id: "beads/a", type: bead }], "seed-alias");
      const state = f.store.inspect();
      f.store.close();
      const moduleUrl = new URL("../dist/transaction-store.js", import.meta.url).href;
      const batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href;
      const input = { alias: "alias/work", target: "beads/a" };
      const script = `import {writeSync} from 'node:fs'; import {openTransactionStore} from ${JSON.stringify(moduleUrl)}; import {prepareTransactionSingleton} from ${JSON.stringify(batchUrl)}; const s=openTransactionStore({...${JSON.stringify(f.options)}, create:false, fault(stage){if(stage===${JSON.stringify(stage)})process.exit(79)}}); const a=s.admit('principal','alias',prepareTransactionSingleton(${JSON.stringify(scope)},'putAlias',${JSON.stringify(JSON.stringify(input))}));if(a.kind!=='owned')process.exit(80);writeSync(1,JSON.stringify(s.execute(a.claim)));process.exit(79);`;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        timeout: 15000,
        encoding: "utf8",
      });
      expect(child.status, child.stderr).toBe(79);
      const recovered = f.reopen();
      expect(recovered.inspect()).toEqual(state);
      expect(recovered.recoveredPending).toBe(stage === "committed" ? 0 : 1);
      expect(recovered.aliasTarget("work")).toBe(
        stage === "committed" ? `${scope}beads/a` : undefined,
      );
      const retry = recovered.admit("principal", "alias", aliasRequest("putAlias", input));
      if (stage === "committed")
        expect(retry).toEqual({ kind: "existing", receipt: JSON.parse(child.stdout) });
      else {
        if (retry.kind !== "owned") throw new Error("expected fresh alias admission");
        expect(recovered.execute(retry.claim).status).toBe("completed");
      }
      expect(recovered.aliasTarget("work")).toBe(`${scope}beads/a`);
      expect(recovered.inspect()).toEqual(state);
    });
  it("refuses the earlier private Resource-only format before pending recovery or receipt maintenance", () => {
    const f = fixture();
    const pending = admit(f.store);
    f.store.close();
    const raw = new DatabaseSync(f.options.file);
    try {
      const config = JSON.parse(
        String(raw.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
      );
      config.format = "bdp-private-transaction-create-1";
      raw
        .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
        .run(JSON.stringify(config));
      raw.exec("DROP TABLE aliases");
    } finally {
      raw.close();
    }
    expect(() => f.reopen()).toThrow("installation mismatch");
    const inspect = new DatabaseSync(f.options.file);
    try {
      expect(
        JSON.parse(
          String(inspect.prepare("SELECT receipt FROM receipts WHERE key='key'").get()?.receipt),
        ),
      ).toEqual(pending.receipt);
    } finally {
      inspect.close();
    }
  });
  it("refuses unresolved Resource alias operands before admission while preserving ordinary data strings", () => {
    const f = fixture();
    for (const operand of [
      "alias/work",
      `${scope}alias/work`,
      { uri: "alias/work", revision: "r1" },
    ]) {
      for (const [operation, input] of [
        ["createLink", { type: link, source: operand, target: "beads/a" }],
        ["createLink", { type: link, source: "beads/a", target: operand }],
        ["updateBead", { bead: operand, propertiesChange: [{ op: "add", path: "/x", value: 1 }] }],
        ["deleteBead", { bead: operand }],
      ] as const) {
        if (typeof operand !== "string" && operation !== "createLink") continue;
        expect(() => prepareTransactionSingleton(scope, operation, JSON.stringify(input))).toThrow(
          "durable witnesses",
        );
        expect(() =>
          prepareTransaction(scope, JSON.stringify({ operations: [{ operation, ...input }] })),
        ).toThrow("durable witnesses");
      }
    }
    const receipt = execute(
      f.store,
      [{ operation: "createBead", type: bead, properties: { uri: "alias/work" } }],
      "data",
    );
    expect(receipt.status).toBe("completed");
    expect(f.store.inspect().resources).toHaveLength(1);
  });
  it("keeps alias locator state when its target is deleted without treating aliases as Resource incidences", () => {
    const f = fixture();
    execute(f.store, [{ operation: "createBead", id: "beads/a", type: bead }], "seed-alias");
    const original = aliasExecute(
      f.store,
      "putAlias",
      { alias: "alias/work", target: "beads/a" },
      "put",
    );
    expect(
      execute(f.store, [{ operation: "deleteBead", bead: "beads/a" }], "delete-target").status,
    ).toBe("completed");
    expect(f.store.aliasTarget("work")).toBe(`${scope}beads/a`);
    const state = f.store.inspect();
    const failed = aliasExecute(f.store, "deleteAlias", { alias: "alias/work" }, "delete-alias");
    expect(failed).toMatchObject({ status: "failed", problem: { code: "resource-not-found" } });
    expect(f.store.inspect()).toEqual(state);
    expect(
      f.store.admit(
        "principal",
        "put",
        aliasRequest("putAlias", { alias: "alias/work", target: "beads/a" }),
      ),
    ).toEqual({ kind: "existing", receipt: original });
  });
});
