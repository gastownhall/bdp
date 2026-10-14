import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTypeDescriptor,
  parseReadUpdateProblem,
  isJsonSchemaDateTime,
  isJsonSchemaUri,
} from "@bdp/protocol";
import {
  prepareTransaction,
  prepareTransactionSingleton,
  prepareTransactionSequence,
  normalizeTransaction,
  TRANSACTION_RUNTIME_LIMITS,
} from "./transaction-batch.js";
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
      normalizeTransaction(
        prepareTransaction(scope, JSON.stringify(explicit(`${scope}beads/explicit`))),
        () => undefined,
      ).identity,
    ).toBe(
      normalizeTransaction(prepareTransaction(scope, JSON.stringify(direct)), () => undefined)
        .identity,
    );
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
          revisionProvenance?: unknown;
        };
      }[];
    };
  }
  it("copies complete created-version provenance into Events and retained postimages", () => {
    const f = fixture({ clock: () => 1000 });
    const operations = [
      {
        operation: "createBead",
        type: bead,
        revisionProvenance: {
          actor: { id: "writer", basis: "writer-supplied" },
          agent: null,
          message: "created",
        },
      },
    ];
    const receipt = execute(f.store, operations, "provenance-create");
    const group = latestGroup(f.store);
    const provenance = group.changes[0]?.resource.revisionProvenance;
    expect(group.events[0]?.data.revisionProvenance).toEqual(provenance);
    expect(provenance).toEqual({
      actor: { id: "writer", basis: "writer-supplied" },
      committedAt: { state: "present", value: "1970-01-01T00:00:01.000Z" },
      agent: { state: "absent" },
      message: { state: "present", value: "created" },
    });
    expect(receipt.results).toMatchObject([{ resource: { revisionProvenance: provenance } }]);
    expect(
      f
        .reopen()
        .admit(
          "principal",
          "provenance-create",
          prepareTransaction(scope, JSON.stringify({ operations })),
        ),
    ).toEqual({ kind: "existing", receipt });
  });
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
        revisionProvenance: {
          actor: { id: "writer", basis: "writer-supplied" },
          agent: null,
          message: "changed",
        },
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
        revisionProvenance: { actor: { id: "writer", basis: "writer-supplied" } },
      },
    });
    expect(group.changes).toHaveLength(1);
    const provenance = group.changes[0]?.resource.revisionProvenance;
    expect(group.events[0]?.data.revisionProvenance).toEqual(provenance);
    expect(provenance).toMatchObject({
      actor: { id: "writer", basis: "writer-supplied" },
      committedAt: { state: "present" },
      agent: { state: "absent" },
      message: { state: "present", value: "changed" },
    });
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
        expect(normalizeTransaction(singleton, () => undefined).identity).toBe(
          normalizeTransaction(oneBatch, () => undefined).identity,
        );
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
                : { revisionProvenance: context === "empty" ? {} : context }),
            };
            return carrier === "singleton"
              ? prepareTransactionSingleton(scope, operation, JSON.stringify(body))
              : prepareTransaction(scope, JSON.stringify({ operations: [{ operation, ...body }] }));
          }
          const secondCarrier = firstCarrier === "singleton" ? "batch" : "singleton";
          const first = prepare(firstCarrier, firstContext);
          const retry = prepare(secondCarrier, firstContext === "omitted" ? "empty" : "omitted");
          expect(normalizeTransaction(first, () => undefined).identity).toBe(
            normalizeTransaction(retry, () => undefined).identity,
          );
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
  function witnessFixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
    const f = fixture(extra);
    execute(
      f.store,
      [
        { operation: "createBead", type: bead, id: "beads/a", properties: { n: 0 } },
        { operation: "createBead", type: bead, id: "beads/b", properties: { n: 0 } },
      ],
      "witness-seed",
    );
    return f;
  }
  function singleton(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
    return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
  }
  function owned(
    store: ReturnType<typeof openTransactionStore>,
    request: ReturnType<typeof prepareTransaction>,
    key: string,
  ) {
    const admission = store.admit("principal", key, request);
    if (admission.kind !== "owned") throw new Error("expected owned witness admission");
    return admission.claim;
  }
  function savedKey(f: ReturnType<typeof fixture>, key: string) {
    f.store.close();
    const raw = new DatabaseSync(f.options.file, { readOnly: true });
    try {
      const row = raw
        .prepare("SELECT * FROM receipts WHERE principal='principal' AND key=?")
        .get(key);
      if (!row) throw new Error("missing durable witness row");
      return row;
    } finally {
      raw.close();
      f.reopen();
    }
  }
  it("captures an admitted alias target for execution and pending/replayed singleton-batch comparison", () => {
    const f = witnessFixture();
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const input = {
      bead: "alias/work",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    };
    const request = singleton("updateBead", input);
    const claim = owned(f.store, request, "mutate");
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/b" }, "repoint");
    const retry = prepareTransaction(
      scope,
      JSON.stringify({
        operations: [{ operation: "updateBead", ...input, bead: `${scope}alias/work` }],
      }),
    );
    expect(f.store.admit("principal", "mutate", retry)).toEqual({
      kind: "existing",
      receipt: claim.receipt,
    });
    expect(
      f.store.admit("principal", "mutate", singleton("updateBead", { ...input, bead: "beads/a" })),
    ).toEqual({ kind: "existing", receipt: claim.receipt });
    expect(
      f.store.admit("principal", "mutate", singleton("updateBead", { ...input, bead: "beads/b" })),
    ).toEqual({ kind: "conflict" });
    const receipt = f.store.execute(claim);
    expect(receipt).toMatchObject({
      status: "completed",
      results: [{ resource: { id: `${scope}beads/a`, properties: { n: 1 } } }],
    });
    expect(latestGroup(f.store).changes.map((c) => c.resource.id)).toEqual([`${scope}beads/a`]);
    expect(f.store.inspect().resources).toContainEqual(
      expect.objectContaining({ id: `${scope}beads/b`, properties: { n: 0 } }),
    );
    aliasExecute(f.store, "deleteAlias", { alias: "alias/work" }, "delete");
    expect(f.reopen().admit("principal", "mutate", retry)).toEqual({ kind: "existing", receipt });
    expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
  });
  it("reuses original locator witnesses across endpoint slots while preserving pinned revision identity", () => {
    const f = witnessFixture();
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const a = (f.store.inspect().resources as { id: string; revision: string }[]).find(
      (r) => r.id === `${scope}beads/a`,
    );
    if (!a) throw new Error("missing target");
    const input = {
      type: link,
      source: { uri: "alias/work", revision: a.revision },
      target: { uri: "beads/a", revision: a.revision },
    };
    const request = prepareTransaction(
      scope,
      JSON.stringify({ operations: [{ operation: "createLink", name: "original", ...input }] }),
    );
    const claim = owned(f.store, request, "pins");
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/b" }, "repoint");
    const moved = singleton("createLink", {
      ...input,
      source: { uri: `${scope}beads/a`, revision: a.revision },
      target: { uri: `${scope}alias/work`, revision: a.revision },
    });
    expect(f.store.admit("principal", "pins", moved)).toEqual({
      kind: "existing",
      receipt: claim.receipt,
    });
    const receipt = f.store.execute(claim);
    expect(receipt).toMatchObject({
      status: "completed",
      results: [
        {
          operationName: "original",
          resource: {
            source: { uri: `${scope}beads/a`, revision: a.revision },
            target: { uri: `${scope}beads/a`, revision: a.revision },
          },
        },
      ],
    });
    expect(f.reopen().admit("principal", "pins", moved)).toEqual({ kind: "existing", receipt });
    expect(
      f.store.admit(
        "principal",
        "pins",
        singleton("createLink", { ...input, target: { uri: "beads/a", revision: "different" } }),
      ),
    ).toEqual({ kind: "conflict" });
    expect(groupSchema(f.store.inspect().groups.at(-1)), JSON.stringify(groupSchema.errors)).toBe(
      true,
    );
  });
  it("preserves a recorded miss after later assignment and distinguishes other misses and direct targets", () => {
    let now = 1000;
    const f = witnessFixture({ clock: () => now });
    const input = { type: link, source: "alias/missing", target: "beads/a" };
    const request = singleton("createLink", input);
    const claim = owned(f.store, request, "miss");
    aliasExecute(f.store, "putAlias", { alias: "alias/missing", target: "beads/a" }, "later-bind");
    const receipt = f.store.execute(claim);
    expect(receipt).toMatchObject({ status: "failed", problem: { code: "resource-not-found" } });
    const saved = savedKey(f, "miss");
    expect(JSON.parse(String(saved.witnesses)).operations[0].aliases).toEqual([
      { locator: `${scope}alias/missing`, target: null },
    ]);
    expect(
      f.store.admit(
        "principal",
        "miss",
        prepareTransaction(
          scope,
          JSON.stringify({
            operations: [{ operation: "createLink", ...input, source: `${scope}alias/missing` }],
          }),
        ),
      ),
    ).toEqual({ kind: "existing", receipt });
    for (const source of ["alias/other-missing", "beads/a"])
      expect(
        f.store.admit("principal", "miss", singleton("createLink", { ...input, source })),
      ).toEqual({ kind: "conflict" });
    expect(f.store.inspect().resources).toHaveLength(2);
    expect(savedKey(f, "miss")).toEqual(saved);
    now = Date.parse(String(receipt.expiresAt)) + 1;
    const fresh = owned(f.store, request, "miss");
    expect(fresh.receipt.id).not.toBe(receipt.id);
    expect(f.store.execute(fresh).status).toBe("completed");
    expect(f.store.receipt("principal", receipt.id)).toBeUndefined();
  });
  it("uses fresh retry locators transiently and preserves original witnesses through detail expiry and restart", () => {
    let now = 1000;
    const f = witnessFixture({ clock: () => now });
    aliasExecute(f.store, "putAlias", { alias: "alias/original", target: "beads/a" }, "original");
    const input = {
      bead: "alias/original",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    };
    const request = singleton("updateBead", input);
    const receipt = f.store.execute(owned(f.store, request, "retained"));
    const saved = savedKey(f, "retained");
    const retry = singleton("updateBead", { ...input, bead: "alias/new" });
    expect(f.store.admit("principal", "retained", retry)).toEqual({ kind: "conflict" });
    expect(savedKey(f, "retained")).toEqual(saved);
    aliasExecute(f.store, "putAlias", { alias: "alias/new", target: "beads/a" }, "new-locator");
    expect(f.store.admit("principal", "retained", retry)).toEqual({ kind: "existing", receipt });
    expect(savedKey(f, "retained")).toEqual(saved);
    aliasExecute(f.store, "putAlias", { alias: "alias/new", target: "beads/b" }, "new-repoint");
    expect(f.store.admit("principal", "retained", retry)).toEqual({ kind: "conflict" });
    aliasExecute(f.store, "deleteAlias", { alias: "alias/original" }, "old-delete");
    now = Date.parse(String(receipt.expiresAt)) + 1;
    f.store.maintain();
    const expired = savedKey(f, "retained");
    expect(expired.witnesses).toBe(saved.witnesses);
    expect(expired.identity).toBe(saved.identity);
    expect(JSON.parse(String(expired.receipt))).toMatchObject({
      id: receipt.id,
      detail: "expired",
      allocated: [],
    });
    expect(f.store.admit("principal", "retained", request)).toMatchObject({
      kind: "existing",
      receipt: { id: receipt.id, detail: "expired" },
    });
    expect(
      f.store.admit(
        "principal",
        "retained",
        singleton("updateBead", { ...input, bead: `${scope}beads/a` }),
      ),
    ).toMatchObject({ kind: "existing", receipt: { id: receipt.id, detail: "expired" } });
    expect(f.store.admit("principal", "retained", retry)).toEqual({ kind: "conflict" });
  });
  it("keeps each batch operation's original witnesses independent and preserves symbolic creator bindings", () => {
    const f = witnessFixture();
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const operations = [
      { operation: "createBead", name: "new", type: bead },
      { operation: "createLink", type: link, source: "@new", target: "alias/work" },
      { operation: "createLink", type: link, source: "@new", target: "beads/a" },
    ];
    const request = prepareTransaction(scope, JSON.stringify({ operations }));
    const receipt = f.store.execute(owned(f.store, request, "batch-witnesses"));
    expect(receipt.status).toBe("completed");
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/b" }, "repoint");
    const renamed = operations.map((op, index) =>
      index === 0 ? { ...op, name: "renamed" } : { ...op, source: "@renamed" },
    );
    expect(
      f.store.admit(
        "principal",
        "batch-witnesses",
        prepareTransaction(scope, JSON.stringify({ operations: renamed })),
      ),
    ).toEqual({ kind: "existing", receipt });
    const moved = renamed.map((op, index) =>
      index === 1
        ? { ...op, target: "beads/a" }
        : index === 2
          ? { ...op, target: "alias/work" }
          : op,
    );
    expect(
      f.store.admit(
        "principal",
        "batch-witnesses",
        prepareTransaction(scope, JSON.stringify({ operations: moved })),
      ),
    ).toEqual({ kind: "conflict" });
    const data = JSON.parse(String(savedKey(f, "batch-witnesses").witnesses));
    expect(data.operations.map((op: { aliases: unknown[] }) => op.aliases.length)).toEqual([
      0, 1, 0,
    ]);
  });
  it("rolls back earlier batch effects after an admitted missing alias later becomes bound", () => {
    const f = witnessFixture();
    const operations = [
      { operation: "createBead", name: "new", type: bead },
      { operation: "createLink", type: link, source: "@new", target: "alias/later" },
    ];
    const request = prepareTransaction(scope, JSON.stringify({ operations }));
    const claim = owned(f.store, request, "rollback-witness");
    aliasExecute(f.store, "putAlias", { alias: "alias/later", target: "beads/a" }, "bind");
    const before = f.store.inspect();
    const receipt = f.store.execute(claim);
    expect(receipt).toMatchObject({
      status: "failed",
      problem: { operationIndex: 1, code: "resource-not-found" },
    });
    expect(f.store.inspect()).toEqual(before);
    expect(f.reopen().admit("principal", "rollback-witness", request)).toEqual({
      kind: "existing",
      receipt,
    });
  });
  it("keeps alias mutation targets and Link subjects out of Resource alias resolution", () => {
    const f = witnessFixture();
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const put = aliasExecute(
      f.store,
      "putAlias",
      { alias: "alias/other", target: "alias/work" },
      "invalid-alias-target",
    );
    expect(put).toMatchObject({ status: "failed", problem: { code: "validation-failed" } });
    const linkRequest = singleton("deleteLink", { link: "alias/work" });
    const linkReceipt = f.store.execute(owned(f.store, linkRequest, "invalid-link-subject"));
    expect(linkReceipt).toMatchObject({
      status: "failed",
      problem: { code: "resource-not-found" },
    });
    expect(
      JSON.parse(String(savedKey(f, "invalid-alias-target").witnesses)).operations[0].aliases,
    ).toEqual([]);
    expect(
      JSON.parse(String(savedKey(f, "invalid-link-subject").witnesses)).operations[0].aliases,
    ).toEqual([]);
  });
  it("refuses the preceding alias format byte-identically before expired receipt maintenance or pending retraction", () => {
    let now = 1000;
    const f = witnessFixture({ clock: () => now });
    const pending = owned(f.store, singleton("deleteBead", { bead: "beads/a" }), "pending");
    f.store.close();
    const raw = new DatabaseSync(f.options.file);
    try {
      const config = JSON.parse(
        String(raw.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
      );
      config.format = "bdp-private-transaction-alias-2";
      config.identityPolicy = "transaction-context-default-1";
      raw
        .prepare("UPDATE metadata SET value=? WHERE name='configuration'")
        .run(JSON.stringify(config));
      raw.exec("ALTER TABLE receipts DROP COLUMN witnesses");
    } finally {
      raw.close();
    }
    now += 2 * 86400000;
    const before = readFileSync(f.options.file);
    expect(() => f.reopen()).toThrow("identity policy mismatch");
    expect(readFileSync(f.options.file)).toEqual(before);
    const verify = new DatabaseSync(f.options.file, { readOnly: true });
    try {
      expect(
        JSON.parse(
          String(verify.prepare("SELECT receipt FROM receipts WHERE key='pending'").get()?.receipt),
        ),
      ).toEqual(pending.receipt);
    } finally {
      verify.close();
    }
  });
  it("deletes through an admitted alias with canonical tombstones and keeps replay equal after target deletion", () => {
    const f = witnessFixture();
    execute(
      f.store,
      [
        {
          operation: "createLink",
          type: link,
          id: "links/self",
          source: "beads/a",
          target: "beads/a",
        },
      ],
      "self",
    );
    aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
    const deletion = (subject: string) =>
      prepareTransaction(
        scope,
        JSON.stringify({
          operations: [
            { operation: "deleteLink", link: "links/self" },
            { operation: "deleteBead", bead: subject },
          ],
        }),
      );
    const request = deletion("alias/work");
    const receipt = f.store.execute(owned(f.store, request, "delete-through-alias"));
    expect(receipt.status).toBe("completed");
    expect(latestGroup(f.store).changes.map((c) => c.resource.id)).toEqual([
      `${scope}links/self`,
      `${scope}beads/a`,
    ]);
    expect(f.store.aliasTarget("work")).toBe(`${scope}beads/a`);
    expect(f.reopen().admit("principal", "delete-through-alias", request)).toEqual({
      kind: "existing",
      receipt,
    });
    expect(f.store.admit("principal", "delete-through-alias", deletion("beads/a"))).toEqual({
      kind: "existing",
      receipt,
    });
    expect(groupSchema(f.store.inspect().groups.at(-1)), JSON.stringify(groupSchema.errors)).toBe(
      true,
    );
  });
  for (const stage of ["after-admission", "after-terminal", "committed"] as const)
    it(`recovers Resource alias witnesses after abrupt ${stage} without resuming stale admission`, () => {
      const f = witnessFixture();
      aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
      f.store.close();
      const moduleUrl = new URL("../dist/transaction-store.js", import.meta.url).href;
      const batchUrl = new URL("../dist/transaction-batch.js", import.meta.url).href;
      const input = {
        bead: "alias/work",
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      };
      const script = `import {writeSync} from 'node:fs'; import {openTransactionStore} from ${JSON.stringify(moduleUrl)}; import {prepareTransactionSingleton} from ${JSON.stringify(batchUrl)}; const s=openTransactionStore({...${JSON.stringify(f.options)}, create:false, fault(stage){if(stage===${JSON.stringify(stage)})process.exit(79)}}); const a=s.admit('principal','crashed-witness',prepareTransactionSingleton(${JSON.stringify(scope)},'updateBead',${JSON.stringify(JSON.stringify(input))}));if(a.kind!=='owned')process.exit(80);writeSync(1,JSON.stringify(s.execute(a.claim)));process.exit(79);`;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        timeout: 15000,
        encoding: "utf8",
      });
      expect(child.status, child.stderr).toBe(79);
      const raw = new DatabaseSync(f.options.file, { readOnly: true });
      try {
        const row = raw.prepare("SELECT witnesses FROM receipts WHERE key='crashed-witness'").get();
        expect(JSON.parse(String(row?.witnesses)).operations[0].aliases).toEqual([
          { locator: `${scope}alias/work`, target: `${scope}beads/a` },
        ]);
      } finally {
        raw.close();
      }
      const recovered = f.reopen();
      expect(recovered.recoveredPending).toBe(stage === "committed" ? 0 : 1);
      aliasExecute(
        recovered,
        "putAlias",
        { alias: "alias/work", target: "beads/b" },
        "repoint-after-crash",
      );
      const retry = recovered.admit("principal", "crashed-witness", singleton("updateBead", input));
      if (stage === "committed")
        expect(retry).toEqual({ kind: "existing", receipt: JSON.parse(child.stdout) });
      else {
        if (retry.kind !== "owned") throw new Error("expected fresh captured admission");
        expect(recovered.execute(retry.claim)).toMatchObject({
          status: "completed",
          results: [{ resource: { id: `${scope}beads/b` } }],
        });
      }
      const resources = recovered.inspect().resources as {
        id: string;
        properties: { n: number };
      }[];
      expect(resources.find((r) => r.id === `${scope}beads/a`)?.properties.n).toBe(
        stage === "committed" ? 1 : 0,
      );
      expect(resources.find((r) => r.id === `${scope}beads/b`)?.properties.n).toBe(
        stage === "committed" ? 0 : 1,
      );
      expect(recovered.inspect().groups).toHaveLength(2);
    });
  for (const corruption of ["duplicate", "foreign-scope", "wrong-target-root", "version"] as const)
    it(`refuses ${corruption} persisted witnesses as an owner fault without rewriting the original disposition`, () => {
      const f = witnessFixture();
      aliasExecute(f.store, "putAlias", { alias: "alias/work", target: "beads/a" }, "put");
      const request = singleton("createLink", {
        type: link,
        source: "alias/work",
        target: "beads/a",
      });
      const receipt = f.store.execute(owned(f.store, request, "corrupt"));
      f.store.close();
      const raw = new DatabaseSync(f.options.file);
      let corruptRow: Record<string, import("node:sqlite").SQLOutputValue> | undefined;
      try {
        const data = JSON.parse(
          String(
            raw.prepare("SELECT witnesses FROM receipts WHERE key='corrupt'").get()?.witnesses,
          ),
        );
        if (corruption === "duplicate")
          data.operations[0].aliases.push({ ...data.operations[0].aliases[0] });
        if (corruption === "foreign-scope") data.scope = "https://other.test/";
        if (corruption === "wrong-target-root")
          data.operations[0].aliases[0].target = `${scope}links/a`;
        if (corruption === "version") data.format = "future";
        raw
          .prepare("UPDATE receipts SET witnesses=? WHERE key='corrupt'")
          .run(JSON.stringify(data));
        corruptRow = raw.prepare("SELECT * FROM receipts WHERE key='corrupt'").get();
      } finally {
        raw.close();
      }
      f.reopen();
      expect(() => f.store.admit("principal", "corrupt", request)).toThrow();
      expect(f.store.receipt("principal", receipt.id)).toEqual(receipt);
      expect(savedKey(f, "corrupt")).toEqual(corruptRow);
    });
});

describe("private transaction storage failure fencing", () => {
  function failures(error: unknown): string[] {
    if (!(error instanceof Error)) return [];
    return [
      error.message,
      ...failures(error.cause),
      ...(error instanceof AggregateError ? error.errors.flatMap(failures) : []),
    ];
  }
  function caught(action: () => unknown): unknown {
    try {
      action();
    } catch (error) {
      return error;
    }
    throw new Error("expected injected failure");
  }
  function assertFenced(store: ReturnType<typeof openTransactionStore>, claim: TransactionClaim) {
    const readCallback = vi.fn();
    const refusal = store.withRead(readCallback);
    expect(refusal).toMatchObject({ kind: "entry-refused", reason: "not-accepting" });
    if (refusal.kind === "entry-refused")
      expect(failures(refusal.cause)).toContain(
        "transaction storage failure; owner fenced; reopen before use",
      );
    expect(readCallback).not.toHaveBeenCalled();
    for (const action of [
      () => store.readConfiguration(),
      () => store.inspect(),
      () => store.aliasTarget("x"),
      () => store.receipt("principal", claim.receipt.id),
      () => store.readReceipt("principal", claim.receipt.id),
      () => store.maintain(),
      () => admit(store, batch, "fresh"),
      () => store.execute(claim),
      () => store.retract(claim),
    ])
      expect(action).toThrow("owner fenced");
  }
  it.each(["before", "after"] as const)(
    "fences an injected %s-COMMIT failure and recovers the actual durable outcome",
    (phase) => {
      const f = fixture(),
        claim = admit(f.store);
      const actual = DatabaseSync.prototype.exec;
      let armed = true;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (armed && sql === "COMMIT") {
          armed = false;
          if (phase === "after") actual.call(this, sql);
          throw new Error("injected uncertain commit");
        }
        actual.call(this, sql);
      });
      let error: unknown;
      try {
        error = caught(() => f.store.execute(claim));
        expect(failures(error)).toContain("injected uncertain commit");
        expect(spy.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(
          phase === "before" ? 1 : 0,
        );
      } finally {
        spy.mockRestore();
      }
      assertFenced(f.store, claim);
      const reopened = f.reopen(),
        state = reopened.inspect();
      expect(state.resources).toHaveLength(phase === "after" ? 2 : 0);
      expect(state.groups).toHaveLength(phase === "after" ? 1 : 0);
      expect(reopened.recoveredPending).toBe(phase === "before" ? 1 : 0);
      if (phase === "after") {
        const replay = reopened.admit(
          "principal",
          "key",
          prepareTransaction(scope, JSON.stringify(batch)),
        );
        expect(replay).toMatchObject({
          kind: "existing",
          receipt: { id: claim.receipt.id, status: "completed" },
        });
        expect(reopened.receipt("principal", claim.receipt.id)).toEqual(
          "receipt" in replay ? replay.receipt : undefined,
        );
      } else {
        expect(reopened.receipt("principal", claim.receipt.id)).toBeUndefined();
        expect(reopened.execute(admit(reopened)).status).toBe("completed");
      }
    },
  );
  it("preserves the execution and rollback causes, blocks tentative reads, and recovers on reopen", () => {
    let armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "after-effects") throw new Error("injected execution failure");
        },
      }),
      claim = admit(f.store);
    const actual = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql === "ROLLBACK") throw new Error("injected rollback failure");
      actual.call(this, sql);
    });
    armed = true;
    try {
      const error = caught(() => f.store.execute(claim));
      expect(failures(error)).toContain("injected execution failure");
      expect(failures(error)).toContain("injected rollback failure");
      // No compensating BEGIN against a connection with unknown transaction state.
      expect(spy.mock.calls.filter(([sql]) => sql === "BEGIN IMMEDIATE")).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    assertFenced(f.store, claim);
    armed = false;
    const reopened = f.reopen();
    expect(reopened.recoveredPending).toBe(1);
    expect(reopened.inspect().resources).toEqual([]);
    expect(reopened.inspect().groups).toEqual([]);
    expect(reopened.execute(admit(reopened)).status).toBe("completed");
  });
  it.each(["after-admission", "after-effects"] as const)(
    "preserves %s failure when compensating retraction also fails",
    (stageToFail) => {
      let armed = false,
        failBegin = false;
      const f = fixture({
        fault(stage) {
          if (armed && stage === stageToFail) {
            failBegin = true;
            throw new Error("injected original failure");
          }
        },
      });
      const claim = stageToFail === "after-effects" ? admit(f.store) : undefined;
      const actual = DatabaseSync.prototype.exec;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (failBegin && sql === "BEGIN IMMEDIATE")
          throw Object.assign(new Error("injected cleanup failure"), { code: "ERR_SQLITE_ERROR" });
        actual.call(this, sql);
      });
      armed = true;
      try {
        const error = caught(() => (claim ? f.store.execute(claim) : admit(f.store)));
        expect(failures(error)).toContain("injected original failure");
        expect(failures(error)).toContain("injected cleanup failure");
      } finally {
        spy.mockRestore();
      }
      const later = failures(caught(() => f.store.inspect()));
      expect(later).toContain("injected original failure");
      expect(later).toContain("injected cleanup failure");
      expect(() => f.store.inspect()).toThrow("owner fenced");
      armed = false;
      const reopened = f.reopen();
      expect(reopened.recoveredPending).toBe(1);
      expect(reopened.inspect().resources).toEqual([]);
      expect(reopened.execute(admit(reopened)).status).toBe("completed");
    },
  );
  it("fences an engine-ended transaction without replacing its original error", () => {
    const actual = DatabaseSync.prototype.exec;
    let connection: DatabaseSync | undefined,
      armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "after-effects") {
            if (!connection) throw new Error("missing injected connection");
            actual.call(connection, "ROLLBACK");
            throw Object.assign(new Error("injected engine rollback"), {
              code: "ERR_SQLITE_ERROR",
              errcode: 13,
            });
          }
        },
      }),
      claim = admit(f.store);
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      connection = this;
      actual.call(this, sql);
    });
    armed = true;
    try {
      expect(failures(caught(() => f.store.execute(claim)))).toContain("injected engine rollback");
      expect(spy.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    assertFenced(f.store, claim);
    armed = false;
    const reopened = f.reopen();
    expect(reopened.recoveredPending).toBe(1);
    expect(reopened.inspect().resources).toEqual([]);
    expect(reopened.execute(admit(reopened)).status).toBe("completed");
  });
  it("preserves sequence admission and cleanup causes and fences every carrier entry", () => {
    vi.useFakeTimers();
    let armed = false,
      failBegin = false;
    const f = fixture({
      fault(stage) {
        if (armed && stage === "after-sequence-admission") {
          failBegin = true;
          throw new Error("injected sequence admission failure");
        }
      },
    });
    const sequence = prepareTransactionSequence(
      scope,
      JSON.stringify({
        operations: [{ operation: "createBead", type: bead, idempotencyKey: "sequence-a" }],
      }),
    );
    const existingSequence = f.store.admitSequence("other-principal", sequence);
    const claim = admit(f.store);
    const actual = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (failBegin && sql === "BEGIN IMMEDIATE")
        throw new Error("injected sequence cleanup failure");
      actual.call(this, sql);
    });
    armed = true;
    try {
      const errors = failures(caught(() => f.store.admitSequence("principal", sequence)));
      expect(errors).toContain("injected sequence admission failure");
      expect(errors).toContain("injected sequence cleanup failure");
    } finally {
      spy.mockRestore();
    }
    const later = failures(caught(() => f.store.inspect()));
    expect(later).toContain("injected sequence admission failure");
    expect(later).toContain("injected sequence cleanup failure");
    assertFenced(f.store, claim);
    for (const action of [
      () => f.store.admitSequence("third-principal", sequence),
      () => f.store.nextSequence(existingSequence),
      () => f.store.cancelSequence(existingSequence),
    ])
      expect(action).toThrow("owner fenced");
    expect(vi.getTimerCount()).toBe(0);
    armed = false;
    const reopened = f.reopen();
    expect(reopened.recoveredPending).toBe(3);
    expect(reopened.inspect().resources).toEqual([]);
    const retry = reopened.admitSequence("principal", sequence);
    expect(reopened.nextSequence(retry).result).toMatchObject({
      kind: "receipt",
      receipt: { status: "completed" },
    });
  });
  it.each(["before", "after"] as const)(
    "fences uncertain %s-COMMIT admission without compensating it",
    (phase) => {
      const f = fixture();
      const actual = DatabaseSync.prototype.exec;
      let armed = true;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (armed && sql === "COMMIT") {
          armed = false;
          if (phase === "after") actual.call(this, sql);
          throw new Error("injected admission commit failure");
        }
        actual.call(this, sql);
      });
      try {
        expect(failures(caught(() => admit(f.store)))).toContain(
          "injected admission commit failure",
        );
        expect(spy.mock.calls.filter(([sql]) => sql === "BEGIN IMMEDIATE")).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
      expect(() => f.store.inspect()).toThrow("owner fenced");
      const reopened = f.reopen();
      expect(reopened.recoveredPending).toBe(phase === "after" ? 1 : 0);
      expect(reopened.inspect().resources).toEqual([]);
      expect(reopened.execute(admit(reopened)).status).toBe("completed");
    },
  );
  it("allows retry after an actual SQLite constraint with a proven clean rollback", () => {
    const actual = DatabaseSync.prototype.exec;
    let connection: DatabaseSync | undefined,
      armed = false;
    const f = fixture({
        fault(stage) {
          if (armed && stage === "after-effects") {
            if (!connection) throw new Error("missing injected connection");
            connection.prepare("INSERT INTO identities SELECT id FROM identities LIMIT 1").run();
          }
        },
      }),
      claim = admit(f.store);
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      connection = this;
      actual.call(this, sql);
    });
    armed = true;
    try {
      expect(caught(() => f.store.execute(claim))).toMatchObject({
        code: "ERR_SQLITE_ERROR",
        errcode: 1555,
      });
    } finally {
      spy.mockRestore();
    }
    expect(f.store.inspect().resources).toEqual([]);
    expect(f.store.receipt("principal", claim.receipt.id)).toBeUndefined();
    armed = false;
    const receipt = f.store.execute(admit(f.store));
    expect(receipt.status).toBe("completed");
    expect(f.store.inspect().groups).toHaveLength(1);
  });
  it.each([false, true])(
    "preserves sequence turn cause, prefix and tail recovery with cancellation failure=%s",
    (failCancellation) => {
      let failTurn = false,
        cleanupBegins = 0;
      const f = fixture({
        fault(stage) {
          if (failTurn && stage === "after-effects")
            throw new Error("original sequence turn failure");
        },
      });
      const sequence = prepareTransactionSequence(
        scope,
        JSON.stringify({
          operations: ["a", "b", "c"].map((id) => ({
            operation: "createBead",
            idempotencyKey: `sequence-${id}`,
            id: `beads/${id}`,
            type: bead,
          })),
        }),
      );
      const attempt = f.store.admitSequence("principal", sequence);
      const prefix = f.store.nextSequence(attempt);
      expect(prefix.result).toMatchObject({ kind: "receipt", receipt: { status: "completed" } });
      const actual = DatabaseSync.prototype.exec;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        // First BEGIN after the turn fault retracts that member successfully;
        // the next belongs to whole-tail cancellation in nextSequence's catch.
        if (sql === "BEGIN IMMEDIATE" && failTurn && ++cleanupBegins === 3 && failCancellation)
          throw new Error("sequence cancellation storage failure");
        actual.call(this, sql);
      });
      function acyclicMessages(error: unknown, path = new Set<Error>()): string[] {
        if (!(error instanceof Error)) return [];
        expect(path.has(error), "error cause traversal must remain acyclic").toBe(false);
        const next = new Set(path).add(error);
        return [
          error.message,
          ...acyclicMessages(error.cause, next),
          ...(error instanceof AggregateError
            ? error.errors.flatMap((e) => acyclicMessages(e, next))
            : []),
        ];
      }
      failTurn = true;
      try {
        const immediate = acyclicMessages(caught(() => f.store.nextSequence(attempt)));
        expect(immediate).toContain("original sequence turn failure");
        if (failCancellation) expect(immediate).toContain("sequence cancellation storage failure");
        expect(cleanupBegins).toBe(3);
      } finally {
        spy.mockRestore();
      }
      failTurn = false;
      if (failCancellation) {
        for (const access of [
          () => f.store.inspect(),
          () => f.store.maintain(),
          () => f.store.admitSequence("principal", sequence),
        ]) {
          const later = acyclicMessages(caught(access));
          expect(later).toContain("original sequence turn failure");
          expect(later).toContain("sequence cancellation storage failure");
        }
      } else {
        expect(f.store.inspect().resources).toHaveLength(1);
        expect(f.store.inspect().groups).toHaveLength(1);
        expect(f.store.cancelSequence(attempt)).toBe(0);
      }
      const recovered = f.reopen();
      expect(recovered.recoveredPending).toBe(failCancellation ? 1 : 0);
      expect(recovered.inspect().resources).toHaveLength(1);
      expect(recovered.inspect().groups).toHaveLength(1);
      const retry = recovered.admitSequence("principal", sequence);
      expect(recovered.nextSequence(retry).result).toEqual(prefix.result);
      expect(recovered.nextSequence(retry).result).toMatchObject({
        kind: "receipt",
        receipt: { status: "completed" },
      });
      expect(recovered.nextSequence(retry)).toMatchObject({
        done: true,
        result: { kind: "receipt", receipt: { status: "completed" } },
      });
      expect(recovered.inspect().resources).toHaveLength(3);
      expect(recovered.inspect().groups).toHaveLength(3);
    },
  );
});

describe("Transactional numeric diagnostic documents", () => {
  for (const document of ["properties", "metadata"] as const) {
    it.each(["createBead", "createLink", "updateBead", "updateLink"] as const)(
      `${document} failure in %s rolls back the prefix, skips the tail and replays after restart`,
      (operation) => {
        const f = fixture();
        f.store.execute(
          admit(
            f.store,
            {
              operations: [
                { operation: "createBead", id: "beads/a", type: bead, properties: { n: 0 } },
                {
                  operation: "createLink",
                  id: "links/old",
                  type: link,
                  source: "beads/a",
                  target: "beads/a",
                },
              ],
            },
            "seed",
          ),
        );
        const before = f.store.inspect();
        const creating = operation.startsWith("create");
        const isLink = operation.endsWith("Link");
        const input = creating
          ? {
              operation,
              id: isLink ? "links/new" : "beads/new",
              type: isLink ? link : bead,
              ...(isLink ? { source: "beads/a", target: "beads/a" } : {}),
              [document]: { nested: { bad: "BAD" } },
            }
          : {
              operation,
              [isLink ? "link" : "bead"]: isLink ? "links/old" : "beads/a",
              [`${document}Change`]: [{ op: "add", path: "/items/-", value: "BAD" }],
            };
        const text = JSON.stringify({
          operations: [
            {
              operation: "updateBead",
              bead: "beads/a",
              propertiesChange: [{ op: "add", path: "/prefix", value: true }],
            },
            { ...input, ...(creating ? { name: "bad" } : {}) },
            { operation: "createBead", id: "beads/tail", type: bead },
          ],
        }).replace('"BAD"', "1e999");
        const prepared = prepareTransaction(scope, text);
        const admitted = f.store.admit("principal", "bad", prepared);
        if (admitted.kind !== "owned") throw Error("expected ownership");
        const receipt = f.store.execute(admitted.claim);
        expect(receipt.status).toBe("failed");
        const diagnostic =
          document === "metadata"
            ? {
                message: creating
                  ? "metadata: unsupported number"
                  : "metadata: unsupported number at request location /metadataChange/0/value",
                document: "metadata",
                ...(creating ? { instanceLocation: "/nested/bad" } : {}),
              }
            : {
                message: creating
                  ? "unsupported number"
                  : "unsupported number at request location /propertiesChange/0/value",
                ...(creating ? { instanceLocation: "/nested/bad" } : {}),
              };
        expect(receipt.problem).toMatchObject({
          code: "validation-failed",
          operationIndex: 1,
          ...(creating ? { operationName: "bad" } : {}),
          diagnostics: [diagnostic],
        });
        expect(parseReadUpdateProblem(receipt.problem).diagnostics).toEqual([diagnostic]);
        expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
        expect(f.store.inspect()).toEqual(before);
        f.reopen();
        expect(f.store.admit("principal", "bad", prepareTransaction(scope, text))).toEqual({
          kind: "existing",
          receipt,
        });
        expect(
          f.store.admit(
            "principal",
            "bad",
            prepareTransaction(scope, text.replace("1e999", "2e999")),
          ),
        ).toEqual({ kind: "conflict" });
        expect(f.store.inspect()).toEqual(before);
      },
    );
  }
  it("includes the metadata discriminator in the qualified byte bound before truncation", () => {
    const f = fixture();
    const bound = TRANSACTION_RUNTIME_LIMITS.diagnosticBytes;
    const base = { message: "metadata: unsupported number", document: "metadata" };
    // The shared parent occurs once on input and sixteen times in diagnostics.
    const suffixes = Array.from({ length: 16 }, (_, i) => `n${i}`);
    const entries = (parent: string) =>
      suffixes.map((suffix) => ({ ...base, instanceLocation: `/${parent}/${suffix}` }));
    const remainder = (bound - Buffer.byteLength(JSON.stringify(entries("")))) % 16;
    suffixes[0] = `n0${"x".repeat(remainder)}`;
    const overhead = Buffer.byteLength(JSON.stringify(entries("")));
    const key = "x".repeat((bound - overhead) / 16);
    const textFor = (parent: string) =>
      JSON.stringify({
        operations: [
          {
            operation: "createBead",
            type: bead,
            metadata: {
              [parent]: Object.fromEntries([...suffixes, "extra"].map((suffix) => [suffix, "BAD"])),
            },
          },
        ],
      }).replaceAll('"BAD"', "1e999");
    for (const [id, parent, count] of [
      ["exact", key, 16],
      ["over", `${key}x`, 15],
    ] as const) {
      const text = textFor(parent);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
        TRANSACTION_RUNTIME_LIMITS.requestBodyBytes,
      );
      const prepared = prepareTransaction(scope, text);
      const admitted = f.store.admit("principal", id, prepared);
      if (admitted.kind !== "owned") throw Error("expected ownership");
      const receipt = f.store.execute(admitted.claim);
      const problem = parseReadUpdateProblem(receipt.problem);
      expect(problem.diagnostics).toEqual(entries(parent).slice(0, count));
      const bytes = Buffer.byteLength(JSON.stringify(problem.diagnostics));
      if (count === 16) expect(bytes).toBe(bound);
      else expect(bytes).toBeLessThan(bound);
      expect(problem.diagnosticsTruncated).toBe(true);
      expect(f.store.inspect()).toEqual({
        resources: [],
        groups: [],
        identities: [],
        position: "0",
      });
      f.reopen();
      expect(f.store.admit("principal", id, prepared)).toEqual({ kind: "existing", receipt });
    }
  });
  it("retains sixteen complete metadata diagnostics and marks the seventeenth omitted", () => {
    const f = fixture();
    const metadata = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`n${i}`, "BAD"]));
    const text = JSON.stringify({
      operations: [{ operation: "createBead", type: bead, metadata }],
    }).replaceAll('"BAD"', "1e999");
    const admitted = f.store.admit("principal", "count", prepareTransaction(scope, text));
    if (admitted.kind !== "owned") throw Error("expected ownership");
    const receipt = f.store.execute(admitted.claim);
    expect(parseReadUpdateProblem(receipt.problem).diagnostics).toEqual(
      Array.from({ length: 16 }, (_, i) => ({
        message: "metadata: unsupported number",
        document: "metadata",
        instanceLocation: `/n${i}`,
      })),
    );
    expect(parseReadUpdateProblem(receipt.problem).diagnosticsTruncated).toBe(true);
    expect(f.store.inspect()).toEqual({ resources: [], groups: [], identities: [], position: "0" });
  });
});

it("counts unapplied update request locations in diagnostic message byte bounds", () => {
  const f = fixture();
  f.store.execute(
    admit(
      f.store,
      { operations: [{ operation: "createBead", id: "beads/a", type: bead }] },
      "seed",
    ),
  );
  const before = f.store.inspect();
  const bound = TRANSACTION_RUNTIME_LIMITS.diagnosticBytes;
  const suffixes = Array.from({ length: 16 }, (_, i) => `n${i}`);
  const entry = (parent: string, suffix: string) => ({
    message: `unsupported number at request location /propertiesChange/0/value/${parent}/${suffix}`,
  });
  const entries = (parent: string) => suffixes.map((suffix) => entry(parent, suffix));
  const remainder = (bound - Buffer.byteLength(JSON.stringify(entries("")))) % 16;
  suffixes[0] = `n0${"x".repeat(remainder)}`;
  const overhead = Buffer.byteLength(JSON.stringify(entries("")));
  const parent = "x".repeat((bound - overhead) / 16);
  for (const [key, name, count] of [
    ["exact-update", parent, 16],
    ["over-update", `${parent}x`, 15],
  ] as const) {
    const text = JSON.stringify({
      operations: [
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [
            {
              op: "add",
              path: "/items/-",
              value: {
                [name]: Object.fromEntries([...suffixes, "extra"].map((suffix) => [suffix, "BAD"])),
              },
            },
          ],
        },
      ],
    }).replaceAll('"BAD"', "1e999");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
      TRANSACTION_RUNTIME_LIMITS.requestBodyBytes,
    );
    const prepared = prepareTransaction(scope, text);
    const admitted = f.store.admit("principal", key, prepared);
    if (admitted.kind !== "owned") throw Error("expected ownership");
    const receipt = f.store.execute(admitted.claim);
    const problem = parseReadUpdateProblem(receipt.problem);
    expect(problem.diagnostics).toEqual(entries(name).slice(0, count));
    expect(problem.diagnosticsTruncated).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(problem.diagnostics));
    if (count === 16) expect(bytes).toBe(bound);
    else expect(bytes).toBeLessThan(bound);
    expect(f.store.inspect()).toEqual(before);
    f.reopen();
    expect(f.store.admit("principal", key, prepared)).toEqual({ kind: "existing", receipt });
  }
});

describe("maximum request numeric diagnostic feasibility", () => {
  for (const carrier of ["batch", "singleton"] as const) {
    for (const document of ["properties", "metadata"] as const) {
      it.each(["createBead", "createLink", "updateBead", "updateLink"] as const)(
        `${carrier} ${document} %s retains the first escaped diagnostic at the request cap`,
        (operation) => {
          const f = fixture();
          f.store.execute(
            admit(
              f.store,
              {
                operations: [
                  { operation: "createBead", id: "beads/a", type: bead },
                  {
                    operation: "createLink",
                    id: "links/old",
                    type: link,
                    source: "beads/a",
                    target: "beads/a",
                  },
                ],
              },
              "seed",
            ),
          );
          const before = f.store.inspect();
          const creating = operation.startsWith("create");
          const isLink = operation.endsWith("Link");
          const textFor = (key: string) => {
            const value = { [key]: "BAD" };
            const input = creating
              ? {
                  id: isLink ? "links/new" : "beads/new",
                  type: isLink ? link : bead,
                  ...(isLink ? { source: "beads/a", target: "beads/a" } : {}),
                  [document]: value,
                }
              : {
                  [isLink ? "link" : "bead"]: isLink ? "links/old" : "beads/a",
                  [`${document}Change`]: [{ op: "add", path: "/items/-", value }],
                };
            return JSON.stringify(
              carrier === "singleton"
                ? input
                : {
                    operations: [
                      {
                        operation: "updateBead",
                        bead: "beads/a",
                        propertiesChange: [{ op: "add", path: "/prefix", value: true }],
                      },
                      { operation, ...input },
                      { operation: "createBead", id: "beads/tail", type: bead },
                    ],
                  },
            ).replace('"BAD"', "1e999");
          };
          const key = "/".repeat(65536 - Buffer.byteLength(textFor("")));
          const text = textFor(key);
          expect(Buffer.byteLength(text)).toBe(65536);
          const prepared =
            carrier === "singleton"
              ? prepareTransactionSingleton(scope, operation, text)
              : prepareTransaction(scope, text);
          const admitted = f.store.admit("principal", "large-number", prepared);
          if (admitted.kind !== "owned") throw Error("expected ownership");
          const receipt = f.store.execute(admitted.claim);
          expect(receipt.status).toBe("failed");
          const pointer = key.replaceAll("/", "~1");
          const diagnostic = {
            message: `${document === "metadata" ? "metadata: " : ""}unsupported number${creating ? "" : ` at request location /${document}Change/0/value/${pointer}`}`,
            ...(document === "metadata" ? { document: "metadata" } : {}),
            ...(creating ? { instanceLocation: `/${pointer}` } : {}),
          };
          const problem = parseReadUpdateProblem(receipt.problem);
          expect(problem.code).toBe("validation-failed");
          expect(problem.diagnostics).toEqual([diagnostic]);
          expect(problem.diagnosticsTruncated).toBeUndefined();
          const bytes = Buffer.byteLength(JSON.stringify(problem.diagnostics));
          expect(bytes).toBeGreaterThan(65536);
          expect(bytes).toBeLessThanOrEqual(512 * 1024);
          expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
          expect(f.store.inspect()).toEqual(before);
          f.reopen();
          expect(f.store.admit("principal", "large-number", prepared)).toEqual({
            kind: "existing",
            receipt,
          });
          expect(f.store.inspect()).toEqual(before);
        },
      );
    }
  }
});

describe("private transaction reader lifetime", () => {
  it.each(["return", "throw", "async", "thenable"])(
    "expires every method after callback %s and leaves owner usable",
    async (mode) => {
      const f = fixture();
      f.store.execute(admit(f.store));
      let escaped: import("./authority-read.js").AuthorityReadReader | undefined;
      const invoke = () =>
        f.store.withRead((reader) => {
          escaped = reader;
          expect(Object.keys(reader).sort()).toEqual([
            "alias",
            "incidentLinks",
            "policy",
            "resource",
            "resources",
          ]);
          expect(reader.resources()).toHaveLength(2);
          expect(reader.policy("any")).toBeUndefined();
          if (mode === "throw") throw new Error("read callback failure");
          if (mode === "async") return Promise.resolve().then(() => reader.resources());
          if (mode === "thenable")
            return {
              // biome-ignore lint/suspicious/noThenProperty: exercise forbidden thenable callbacks.
              then(resolve: (value: unknown) => void) {
                resolve(reader.resources());
              },
            };
          return 42;
        });
      if (mode === "return") expect(invoke()).toEqual({ kind: "read", value: 42 });
      else
        expect(invoke).toThrow(mode === "throw" ? "read callback failure" : "must be synchronous");
      if (!escaped) throw new Error("reader not captured");
      const expired = escaped;
      for (const action of [
        () => expired.resource("beads/a"),
        () => expired.resources(),
        () => expired.incidentLinks("beads/a"),
        () => expired.alias("a"),
        () => expired.policy("any"),
      ])
        expect(action).toThrow("expired transaction reader");
      await Promise.resolve();
      expect(f.store.withRead((reader) => reader.resources().length)).toEqual({
        kind: "read",
        value: 2,
      });
    },
  );

  it("freezes row snapshots and refuses reentry, mutation and close without losing the owner", () => {
    const f = fixture(),
      claim = admit(f.store);
    f.store.execute(claim);
    f.store.withRead((reader) => {
      const rows = reader.resources(),
        beadRow = rows.find((r) => r.kind === "bead");
      if (!beadRow) throw new Error("missing fixture Bead");
      expect(Object.isFrozen(reader)).toBe(true);
      expect(Object.isFrozen(rows)).toBe(true);
      for (const row of rows) expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(reader.resource(beadRow.id))).toBe(true);
      const links = reader.incidentLinks(beadRow.id);
      expect(links).toHaveLength(1);
      expect(Object.isFrozen(links)).toBe(true);
      expect(Object.isFrozen(links[0])).toBe(true);
      expect(() => Object.assign(beadRow, { bodyJson: "{}" })).toThrow();
      const callback = vi.fn();
      expect(f.store.withRead(callback)).toMatchObject({
        kind: "entry-refused",
        reason: "reentrant",
      });
      expect(callback).not.toHaveBeenCalled();
      for (const action of [
        () => admit(f.store, batch, "nested"),
        () => f.store.readConfiguration(),
        () => f.store.close(),
      ])
        expect(action).toThrow("reentrant");
    });
    expect(
      f.store.admit("principal", "key", prepareTransaction(scope, JSON.stringify(batch))),
    ).toMatchObject({ kind: "existing", receipt: { status: "completed" } });
    f.store.close();
    const callback = vi.fn();
    expect(f.store.withRead(callback)).toMatchObject({
      kind: "entry-refused",
      reason: "not-accepting",
    });
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("private atomic receipt observation", () => {
  it("captures retention, receipt bytes and current context in one guarded SQLite entry", () => {
    const f = fixture({ clock: () => 1000 });
    const receipt = f.store.execute(admit(f.store));
    const prepare = DatabaseSync.prototype.prepare;
    const observed: boolean[] = [];
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (
        sql === "SELECT * FROM receipts WHERE principal=?" ||
        sql === "SELECT value FROM metadata WHERE name=?"
      ) {
        observed.push(this.isTransaction);
        expect(() => f.store.inspect()).toThrow("reentrant");
      }
      return prepare.call(this, sql);
    });
    try {
      expect(f.store.readReceipt("principal", receipt.id)).toEqual({
        receipt,
        context: {
          scopeEpoch: receipt.scopeEpoch,
          authorizationView: receipt.authorizationView,
          scopePosition: "pos-1",
        },
      });
      // Receipt and current position come from this entry; epoch is installation-constant.
      expect(observed).toEqual([true, true]);
    } finally {
      spy.mockRestore();
    }
    expect(f.store.inspect().groups).toHaveLength(1);
  });

  it("cannot observe tentative effects or use a closed owner", () => {
    let store: ReturnType<typeof openTransactionStore> | undefined;
    const attempted = vi.fn();
    const f = fixture({
      fault(stage) {
        if (stage === "after-effects") {
          attempted();
          expect(() => store?.readReceipt("principal", "unknown")).toThrow("reentrant");
        }
      },
    });
    store = f.store;
    const receipt = f.store.execute(admit(f.store));
    expect(attempted).toHaveBeenCalledOnce();
    expect(f.store.readReceipt("principal", receipt.id).receipt).toEqual(receipt);
    f.store.close();
    expect(() => f.store.readReceipt("principal", receipt.id)).toThrow("closed");
  });
});

it("guards receipt serving positions and prior-epoch nondisclosure using persisted facts", () => {
  const f = fixture({ clock: () => 1000 });
  const receipt = f.store.executeObserved(admit(f.store));
  expect(receipt.context.scopePosition).toBe("pos-1");
  expect(Object.isFrozen(receipt.receipt.results)).toBe(true);
  f.store.close();
  const raw = new DatabaseSync(f.options.file);
  raw
    .prepare("UPDATE receipts SET receipt=? WHERE principal=? AND key=?")
    .run(
      JSON.stringify({ ...receipt.receipt, requiredPosition: "pos-2" }),
      "principal",
      receipt.receipt.idempotencyKey,
    );
  raw.close();
  const reopened = openTransactionStore({ ...f.options, create: false });
  try {
    expect(() => reopened.readReceipt("principal", receipt.receipt.id)).toThrow("position exceeds");
  } finally {
    reopened.close();
  }
  const edit = new DatabaseSync(f.options.file);
  edit
    .prepare("UPDATE receipts SET receipt=? WHERE principal=? AND key=?")
    .run(
      JSON.stringify({ ...receipt.receipt, scopeEpoch: "another-epoch" }),
      "principal",
      receipt.receipt.idempotencyKey,
    );
  edit.close();
  const prior = openTransactionStore({ ...f.options, create: false });
  try {
    expect(prior.readReceipt("principal", receipt.receipt.id).receipt).toBeUndefined();
  } finally {
    prior.close();
  }
});

it("captures exact replay and execute observations inside their owner transactions", () => {
  const f = fixture({ clock: () => 1000 });
  const claim = admit(f.store);
  const prepare = DatabaseSync.prototype.prepare;
  let observations = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql === "SELECT value FROM metadata WHERE name=?") {
      expect(this.isTransaction).toBe(true);
      observations++;
    }
    return prepare.call(this, sql);
  });
  try {
    const executed = f.store.executeObserved(claim);
    const replay = f.store.admitObserved(
      "principal",
      claim.receipt.idempotencyKey,
      prepareTransaction(scope, JSON.stringify(batch)),
    );
    expect(replay).toEqual({ kind: "existing", ...executed });
    expect(observations).toBeGreaterThanOrEqual(3);
  } finally {
    spy.mockRestore();
  }
});

it("captures selected observed refusals inside the owner transaction without changing unobserved admissions", () => {
  const f = fixture({ clock: () => 1000 });
  const createOne = (id: string) => ({
    operations: [{ operation: "createBead", id: `beads/${id}`, type: bead }],
  });
  const original = createOne("a");
  const pendingInput = createOne("pending");
  const pendingClaim = admit(f.store, pendingInput, "pending-direct");
  const retained = f.store.execute(admit(f.store, original, "retained"));
  f.store.execute(admit(f.store, createOne("b"), "advance"));
  const expected = {
    scopeEpoch: retained.scopeEpoch,
    authorizationView: retained.authorizationView,
    scopePosition: "pos-2",
  };
  const pending = f.store.admitSequence(
    "principal",
    prepareTransactionSequence(
      scope,
      JSON.stringify({
        operations: [
          { operation: "createBead", type: bead, name: "creator", idempotencyKey: "creator" },
          {
            operation: "createLink",
            type: link,
            source: "@creator",
            target: "@creator",
            idempotencyKey: "dependent",
          },
        ],
      }),
    ),
  );
  const prepared = (value: unknown) => prepareTransaction(scope, JSON.stringify(value));
  const cases = [
    {
      key: "retained",
      input: createOne("changed"),
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "conflict",
    },
    {
      key: "dependent",
      input: {
        operations: [{ operation: "createLink", type: link, source: "beads/a", target: "beads/b" }],
      },
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "conflict",
    },
    {
      key: "capacity",
      input: { operations: [...createOne("c").operations, ...createOne("d").operations] },
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "operation-limit",
    },
    {
      key: "fresh-no-json",
      input: createOne("e"),
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "not-acceptable",
    },
    {
      key: "retained",
      input: original,
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "not-acceptable",
    },
    {
      key: "pending-direct",
      input: pendingInput,
      controls: { acceptsJson: false, maximumOperations: 1 },
      kind: "not-acceptable",
    },
  ];
  const before = f.store.inspect();
  const prepare = DatabaseSync.prototype.prepare;
  let positionReads = 0;
  const contexts: unknown[] = [];
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const statement = prepare.call(this, sql);
    if (sql === "SELECT value FROM metadata WHERE name=?") {
      const owner = this;
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args) => {
        // SQLite get also accepts positional bindings; the spy type selects its named overload.
        const firstBinding: unknown = args[0];
        if (firstBinding === "position") {
          expect(
            owner.isTransaction,
            "refusal position read must remain inside owner transaction",
          ).toBe(true);
          positionReads++;
        }
        return get(...args);
      });
    }
    return statement;
  });
  try {
    for (const entry of cases) {
      const result = f.store.admitObserved(
        "principal",
        entry.key,
        prepared(entry.input),
        entry.controls,
      );
      expect(result).toEqual({ kind: entry.kind, context: expected });
      if (!("context" in result)) throw new Error("missing observed refusal context");
      expect(Object.isFrozen(result.context)).toBe(true);
      contexts.push(result.context);
    }
    expect(positionReads).toBe(cases.length);
    for (const entry of cases)
      expect(
        f.store.admit("principal", entry.key, prepared(entry.input), entry.controls),
      ).toStrictEqual({
        kind: entry.kind,
      });
    expect(positionReads, "unobserved refusal adds no position observation").toBe(cases.length);
    const owned = f.store.admitObserved("principal", "probe-owned", prepared(createOne("owned")));
    expect(owned.kind).toBe("owned");
    expect(positionReads, "owned admission adds no position observation").toBe(cases.length);
    if (owned.kind !== "owned") throw new Error("missing owned claim");
    f.store.retract(owned.claim);
  } finally {
    spy.mockRestore();
    vi.restoreAllMocks();
  }
  expect(f.store.inspect()).toEqual(before);
  expect(f.store.receipt("principal", retained.id)).toEqual(retained);
  f.store.cancelSequence(pending);
  f.store.retract(pendingClaim);
  f.store.execute(admit(f.store, createOne("later"), "later"));
  expect(contexts).toEqual(cases.map(() => expected));
  for (const [key, input] of [
    ["capacity", createOne("c")],
    ["fresh-no-json", createOne("e")],
  ] as const) {
    const retry = f.store.admit("principal", key, prepared(input));
    expect(retry.kind).toBe("owned");
    if (retry.kind !== "owned") throw new Error("refused key was captured");
    f.store.retract(retry.claim);
  }
});

describe("private comparison deadline observation", () => {
  it("captures comparison deadline context in one metadata-only atomic entry", () => {
    const f = fixture();
    const prepare = DatabaseSync.prototype.prepare,
      exec = DatabaseSync.prototype.exec;
    const statements: string[] = [],
      transactions: string[] = [];
    const prepared = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql,
      ...rest
    ) {
      statements.push(sql);
      return prepare.call(this, sql, ...rest);
    });
    const executed = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql,
    ) {
      transactions.push(sql);
      return exec.call(this, sql);
    });
    let observed: ReturnType<typeof f.store.observeComparisonDeadline>;
    try {
      observed = f.store.observeComparisonDeadline(f.store.scopeEpoch);
      expect(transactions, "one deadline transaction").toEqual(["BEGIN IMMEDIATE", "COMMIT"]);
      expect(statements, "metadata-only deadline observation").toEqual([
        "SELECT value FROM metadata WHERE name=?",
        "SELECT value FROM metadata WHERE name=?",
      ]);
    } finally {
      prepared.mockRestore();
      executed.mockRestore();
    }
    expect(observed).toStrictEqual({
      kind: "observed",
      context: {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-0",
      },
    });
    expect(Object.isFrozen(observed)).toBe(true);
    if (observed.kind !== "observed") throw new Error("expected deadline observation");
    expect(Object.isFrozen(observed.context)).toBe(true);
    f.store.execute(admit(f.store));
    expect(f.store.observeComparisonDeadline(f.store.scopeEpoch)).toMatchObject({
      context: { scopePosition: "pos-1" },
    });
    expect(observed.context.scopePosition, "prior deadline context immutable").toBe("pos-0");
  });
  it("rejects a defensive final comparison epoch mismatch without a tuple", () => {
    const f = fixture();
    expect(
      f.store.observeComparisonDeadline("different-epoch"),
      "final deadline epoch check",
    ).toStrictEqual({ kind: "owner-stopped" });
    expect(f.store.inspect().resources).toEqual([]);
  });
  it("returns a stopped comparison observation for a normally closed owner", () => {
    const f = fixture();
    f.store.close();
    expect(f.store.observeComparisonDeadline(f.store.scopeEpoch)).toStrictEqual({
      kind: "owner-stopped",
    });
  });
  it("rejects reentrant comparison observation without entering an atomic read", () => {
    const f = fixture();
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      const result = f.store.withRead(() => {
        expect(() => f.store.observeComparisonDeadline(f.store.scopeEpoch)).toThrow(
          "closed or reentrant",
        );
      });
      expect(result.kind).toBe("read");
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }
  });
  it("preserves a fenced owner's comparison observation failure", () => {
    const f = fixture(),
      original = new Error("deadline commit uncertainty");
    const exec = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql,
    ) {
      const value = exec.call(this, sql);
      if (sql === "COMMIT") throw original;
      return value;
    });
    let failure: unknown;
    try {
      try {
        f.store.observeComparisonDeadline(f.store.scopeEpoch);
      } catch (error) {
        failure = error;
      }
    } finally {
      spy.mockRestore();
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBe(original);
    expect(() => f.store.observeComparisonDeadline(f.store.scopeEpoch)).toThrow(failure as Error);
  });
  it("propagates comparison metadata failure and releases the atomic owner", () => {
    const f = fixture(),
      original = new Error("deadline metadata read failure");
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(() => {
      throw original;
    });
    try {
      expect(() => f.store.observeComparisonDeadline(f.store.scopeEpoch)).toThrow(original);
    } finally {
      prepare.mockRestore();
    }
    expect(f.store.observeComparisonDeadline(f.store.scopeEpoch)).toMatchObject({
      kind: "observed",
      context: { scopePosition: "pos-0" },
    });
  });
});
