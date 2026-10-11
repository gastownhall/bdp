import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseTypeDescriptor, isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { prepareTransaction } from "./transaction-batch.js";
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
      { operations: [{ operation: "deleteBead", bead: "beads/a" }] },
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
});
