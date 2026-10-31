import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { stringifyJsonValue, isJsonSchemaUri, isJsonSchemaDateTime } from "@bdp/protocol";
import { Ajv2020 } from "ajv/dist/2020.js";
import { compileDevelopmentContracts, type DevelopmentContracts } from "./development-contracts.js";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  ingestContractArtifacts,
} from "./installed-contract-artifact.js";
import { SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import { EVALUATOR_CEILINGS } from "./installed-schema-evaluator.js";
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransaction, prepareTransactionSetCore } from "./transaction-batch.js";
const emitted = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const scope = "https://example.test/installed/",
  base = `${scope}types/base`,
  type = `${scope}types/child`;
const schema = "https://offline.invalid/object",
  number = "https://offline.invalid/number";
const artifact = (retrievalUri: string, value: unknown) => ({
  retrievalUri,
  utf8Bytes: Buffer.from(JSON.stringify(value)),
});
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing fixture value");
  return value;
}
function bundle() {
  return {
    descriptors: [
      artifact(base, {
        id: base,
        name: "Base",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
      artifact(type, { id: type, name: "Child", describes: "bead", conformsTo: [base] }),
    ],
    schemas: [
      artifact(schema, {
        $id: schema,
        type: "object",
        required: ["n"],
        properties: { n: { $ref: number } },
      }),
      artifact(number, { $id: number, type: "integer", minimum: 0 }),
    ],
    limits: { ...CONTRACT_ARTIFACT_CEILINGS } as {
      -readonly [K in keyof typeof CONTRACT_ARTIFACT_CEILINGS]: number;
    },
  };
}
function plain(input = bundle()) {
  const entries = (values: typeof input.descriptors) =>
    values.map((a) => ({ retrievalUri: a.retrievalUri, utf8: a.utf8Bytes.toString() }));
  return {
    descriptors: entries(input.descriptors),
    schemas: entries(input.schemas),
    limits: input.limits,
  };
}
function reconstruct(capture: DevelopmentContracts["capture"]) {
  const entries = (kind: "descriptor" | "schema") =>
    capture.artifacts
      .filter((a) => a.kind === kind)
      .map((a) => ({
        retrievalUri: a.retrievalUri,
        utf8Bytes: Buffer.from(a.bytesBase64, "base64"),
      }));
  return compileDevelopmentContracts({
    descriptors: entries("descriptor"),
    schemas: entries("schema"),
    limits: capture.artifactLimits,
  });
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const wireSchema = JSON.parse(
  readFileSync(new URL("../../../specs/profiles/core/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(wireSchema);
const receiptSchema = ajv.compile({ $ref: `${wireSchema.$id}#/$defs/mutationReceipt` });
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-tx-contracts-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const create = (id: string, n = 1) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n },
  metadata: { n: "not schema checked" },
});
function fixture(input = bundle()) {
  const contracts = compileDevelopmentContracts(input);
  let now = 1000;
  const options = {
    file: path.join(directory(), "owner.sqlite"),
    scope,
    create: true,
    types: contracts.descriptors,
    contracts,
    clock: () => now,
    maintenanceIntervalMs: 60000,
    receiptMaximumItems: 1,
  };
  let owner = openTransactionStore(options);
  cleanup.push(() => owner.close());
  return {
    options,
    get owner() {
      return owner;
    },
    time(n: number) {
      now = n;
    },
    reopen(contracts = options.contracts) {
      owner.close();
      owner = openTransactionStore({ ...options, create: false, contracts });
    },
    raw<T>(fn: (db: DatabaseSync) => T) {
      owner.close();
      const db = new DatabaseSync(options.file);
      try {
        return fn(db);
      } finally {
        db.close();
      }
    },
    run(operations: unknown[], key: string, sets = false) {
      const prepared = (sets ? prepareTransactionSetCore : prepareTransaction)(
        scope,
        JSON.stringify({ operations }),
      );
      const admission = owner.admit("p", key, prepared);
      if (admission.kind !== "owned") throw Error("expected owned");
      const receipt = owner.executeObserved(admission.claim).receipt;
      expect(receiptSchema(receipt), JSON.stringify(receiptSchema.errors)).toBe(true);
      return receipt;
    },
  };
}
it("exposes detached frozen exact capture without changing compiler identity and reconstructs offline", () => {
  const input = bundle(),
    captured = ingestContractArtifacts(input),
    compiled = compileDevelopmentContracts(input);
  const identity = `development-schema5-${createHash("sha256")
    .update(
      stringifyJsonValue({
        artifacts: captured.sha256,
        artifactLimits: captured.receipt.limits,
        graphLimits: SCHEMA_GRAPH_CEILINGS,
        evaluatorLimits: EVALUATOR_CEILINGS,
      }),
    )
    .digest("hex")}`;
  expect(compiled.identity).toBe(identity);
  const saved = JSON.parse(JSON.stringify(compiled.capture));
  for (const artifact of [...input.descriptors, ...input.schemas]) artifact.utf8Bytes.fill(0);
  input.limits.totalBytes = 1;
  input.descriptors.length = 0;
  expect(compiled.capture).toEqual(saved);
  for (const value of [
    compiled.capture,
    compiled.capture.artifacts,
    ...compiled.capture.artifacts,
    compiled.capture.artifactLimits,
    compiled.capture.graphLimits,
    compiled.capture.evaluatorLimits,
  ])
    expect(Object.isFrozen(value)).toBe(true);
  expect(reconstruct(saved).identity).toBe(identity);
  expect(reconstruct(saved).types).toEqual(compiled.types);
});
it("uses inherited schema for writes, atomic late failures and staged sets, retaining replay after graph changes", () => {
  const f = fixture();
  const first = f.run([create("a")], "first");
  expect(first.status).toBe("completed");
  const bad = [create("tentative"), create("invalid", -1)];
  const failed = f.run(bad, "bad");
  expect(failed).toMatchObject({
    status: "failed",
    problem: { code: "validation-failed", operationIndex: 1, diagnostics: expect.any(Array) },
  });
  expect(f.owner.inspect().resources).toHaveLength(1);
  expect(f.owner.inspect().groups).toHaveLength(1);
  const setOperations = [
    {
      operation: "updateWhere",
      collection: "beads",
      selector: "$[?@.properties.n >= 0]",
      change: [{ op: "replace", path: "/n", value: -1 }],
    },
  ];
  const set = f.run(setOperations, "set", true);
  expect(set).toMatchObject({
    status: "failed",
    problem: { code: "validation-failed", operationIndex: 0 },
  });
  expect(f.owner.inspect().groups).toHaveLength(1);
  f.run([create("later")], "later");
  const retry = f.owner.admit(
    "p",
    "bad",
    prepareTransaction(scope, JSON.stringify({ operations: bad })),
  );
  expect(retry).toEqual({ kind: "existing", receipt: failed });
  const setRetry = f.owner.admit(
    "p",
    "set",
    prepareTransactionSetCore(scope, JSON.stringify({ operations: setOperations })),
  );
  expect(setRetry).toEqual({ kind: "existing", receipt: set });
  const updated = f.run(
    [
      {
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
      },
    ],
    "update",
  );
  expect(updated.status).toBe("completed");
  // The earlier rejected batch must not reserve a never-committed identity.
  expect(f.run([create("tentative")], "recreate-tentative").status).toBe("completed");
  f.raw((db) => {
    expect(db.prepare("SELECT * FROM resources WHERE id LIKE '%invalid'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM receipt_pages WHERE key IN ('bad','set')").all()).toEqual([]);
  });
});
it("retains capture through deletion, receipt expiry and startup cleanup and reads the same installation", () => {
  const f = fixture();
  f.run([create("a")], "create");
  f.run([{ operation: "deleteBead", bead: "beads/a" }], "delete");
  f.run([create("bad", -1)], "failed");
  const expected = stringifyJsonValue(f.options.contracts.capture);
  f.time(86401001);
  f.owner.maintain();
  const saved = f.raw((db) =>
    String(db.prepare("SELECT value FROM metadata WHERE name='contractCapture'").get()?.value),
  );
  expect(saved).toBe(expected);
  const reconstructed = reconstruct(JSON.parse(saved));
  f.reopen(reconstructed);
  expect(f.owner.readConfiguration().installedTypes).toEqual(reconstructed.descriptors);
  expect(f.owner.readConfiguration().scopeConfiguration.configurationIdentity.length).toBeLessThan(
    4096,
  );
  expect(f.owner.inspect().resources).toEqual([]);
  expect(
    f.raw((db) =>
      String(db.prepare("SELECT value FROM metadata WHERE name='contractCapture'").get()?.value),
    ),
  ).toBe(expected);
});
it.each(["capture", "missing-capture", "compiler-witness", "limits"])(
  "refuses tampered %s before maintenance or pending retraction",
  (kind) => {
    const f = fixture();
    f.run([create("a")], "first");
    f.owner.admit(
      "p",
      "pending",
      prepareTransaction(scope, JSON.stringify({ operations: [create("pending")] })),
    );
    f.raw((db) => {
      const name = kind === "limits" ? "configuration" : "contractCapture";
      if (kind === "missing-capture") {
        db.prepare("DELETE FROM metadata WHERE name=?").run(name);
        return;
      }
      const value = JSON.parse(
        String(db.prepare("SELECT value FROM metadata WHERE name=?").get(name)?.value),
      );
      if (kind === "capture") value.artifacts[0].bytesBase64 = "AAAA";
      if (kind === "compiler-witness") value.graphLimits.nodes = 123;
      if (kind === "limits") value.runtimeLimits.diagnosticCount = 1;
      db.prepare("UPDATE metadata SET value=? WHERE name=?").run(stringifyJsonValue(value), name);
    });
    const bytes = readFileSync(f.options.file);
    f.time(86401001);
    expect(() => f.reopen()).toThrow(/mismatch/);
    expect(readFileSync(f.options.file)).toEqual(bytes);
    f.raw((db) =>
      expect(db.prepare("SELECT * FROM receipts WHERE owner IS NOT NULL").all()).toHaveLength(1),
    );
  },
);
it("refuses changed artifact identity, artifact limits and schema-free fallback on a compiled installation", () => {
  const f = fixture();
  f.owner.close();
  const bytes = readFileSync(f.options.file);
  const changed = bundle();
  changed.schemas[1] = artifact(number, { $id: number, type: "integer", minimum: 2 });
  const lower = bundle();
  lower.limits.totalBytes--;
  for (const contracts of [
    compileDevelopmentContracts(changed),
    compileDevelopmentContracts(lower),
    undefined,
  ]) {
    const { contracts: _previous, ...options } = f.options;
    expect(() =>
      openTransactionStore({ ...options, create: false, ...(contracts ? { contracts } : {}) }),
    ).toThrow();
    expect(readFileSync(f.options.file)).toEqual(bytes);
  }
});
it("refuses forged, cross-module, mismatched and nonlocal authorities before provisioning", async () => {
  const compiled = compileDevelopmentContracts(bundle()),
    file = path.join(directory(), "absent.sqlite");
  const options = { file, scope, create: true, types: compiled.descriptors, contracts: compiled };
  expect(() => openTransactionStore({ ...options, contracts: { ...compiled } })).toThrow(
    "compiled administrative contract required",
  );
  const dist = (await import(
    new URL("../dist/development-contracts.js", import.meta.url).href
  )) as typeof import("./development-contracts.js");
  expect(() =>
    openTransactionStore({ ...options, contracts: dist.compileDevelopmentContracts(bundle()) }),
  ).toThrow("compiled administrative contract required");
  expect(() =>
    openTransactionStore({ ...options, types: compiled.descriptors.slice(0, 1) }),
  ).toThrow("descriptor mismatch");
  expect(() => openTransactionStore({ ...options, scope: "https://elsewhere.invalid/" })).toThrow(
    "Scope-local",
  );
  const missing = bundle();
  missing.schemas.pop();
  expect(() => compileDevelopmentContracts(missing)).toThrow();
  expect(existsSync(file)).toBe(false);
});
it("installs a complete compiled owning descriptor bundle in its own store", () => {
  const owned = compileDevelopmentContracts({
    descriptors: [
      artifact(base, {
        id: base,
        name: "Owned",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [`${scope}types/edge`]: { max: 1 } },
      }),
      artifact(`${scope}types/edge`, {
        id: `${scope}types/edge`,
        name: "Edge",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [base], external: "none" },
        target: { conformsTo: [base], external: "opaque" },
      }),
    ],
    schemas: [],
    limits: CONTRACT_ARTIFACT_CEILINGS,
  });
  const owner = openTransactionStore({
    file: path.join(directory(), "owned.sqlite"),
    scope,
    create: true,
    contracts: owned,
    types: owned.descriptors,
  });
  owner.close();
});
it("compiles plain runtime artifacts in emitted module and serves same-owner Types, writes, sequence and restart", async () => {
  const artifacts = plain();
  // Installation order must not become the canonical inventory order.
  artifacts.descriptors.reverse();
  const options = {
    scope,
    directory: directory(),
    create: true,
    port: 0,
    artifacts,
    credentials: [{ token: "a".repeat(32), principal: "p", canMutate: true }],
  };
  let runtime = await emitted.startTransactionRuntime(options);
  cleanup.push(() => runtime.close());
  const request = async (target: string, operation?: unknown, key?: string) => {
    const response = await fetch(new URL(new URL(target, scope).pathname, runtime.listenUrl), {
      method: operation ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${"a".repeat(32)}`,
        ...(operation ? { "content-type": "application/json" } : {}),
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
      ...(operation ? { body: JSON.stringify(operation) } : {}),
    });
    return { status: response.status, value: await response.json() };
  };
  async function discoveryBoundary() {
    for (const relative of ["", "bdp.json", "operations/"])
      for (const method of ["GET", "HEAD"]) {
        const target = new URL(new URL(relative, scope).pathname, runtime.listenUrl);
        const response = await fetch(target, {
          method,
          headers: { authorization: `Bearer ${"a".repeat(32)}` },
        });
        expect(response.status).toBe(500);
        expect(response.headers.get("x-bdp-development-limit")).toBe("transactional-discovery");
        expect(response.headers.has("link")).toBe(false);
        expect(await response.text()).toBe("");
      }
  }
  await discoveryBoundary();
  const installedDescriptors = options.artifacts.descriptors
    .map(({ utf8 }) => JSON.parse(utf8))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  expect(options.artifacts.descriptors.map(({ utf8 }) => JSON.parse(utf8).id)).toEqual([
    type,
    base,
  ]);
  expect(installedDescriptors.map(({ id }) => id)).toEqual([base, type]);
  const inventory = {
    status: 200,
    value: {
      items: installedDescriptors.map(({ id, name, describes }) => ({ id, name, describes })),
      next: null,
    },
  };
  expect(await request(base)).toEqual({ status: 200, value: installedDescriptors[0] });
  const typeUrl = new URL(new URL(base).pathname, runtime.listenUrl);
  const typeGet = await fetch(typeUrl, { headers: { authorization: `Bearer ${"a".repeat(32)}` } });
  const typeBytes = await typeGet.text();
  const typeHead = await fetch(typeUrl, {
    method: "HEAD",
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
  });
  expect(typeHead.status).toBe(typeGet.status);
  expect(typeHead.status).toBe(200);
  expect(typeHead.headers.get("content-length")).toBe(typeGet.headers.get("content-length"));
  expect(Number(typeHead.headers.get("content-length"))).toBe(Buffer.byteLength(typeBytes));
  expect(await typeHead.text()).toBe("");
  expect(JSON.parse(typeBytes)).toEqual(installedDescriptors[0]);
  expect(await request("types/")).toEqual(inventory);
  for (const descriptor of installedDescriptors)
    expect(await request(descriptor.id)).toEqual({ status: 200, value: descriptor });
  const unknown = await request(
    "operations/create-bead",
    { id: "beads/unknown", type: `${scope}types/missing`, properties: { n: 1 } },
    "unknown",
  );
  expect(unknown.value).toMatchObject({
    status: "failed",
    problem: { code: "type-not-installed" },
  });
  const first = await request(
    "operations/create-bead",
    { id: "beads/a", type, properties: { n: 1 } },
    "first",
  );
  expect(first.status).toBe(200);
  expect(await request("beads/a")).toMatchObject({
    status: 200,
    value: { type, properties: { n: 1 } },
  });
  const failure = await request(
    "operations/batch",
    { operations: [create("rollback"), create("bad", -1)] },
    "failure",
  );
  expect(failure.value).toMatchObject({ status: "failed", problem: { code: "validation-failed" } });
  const sequence = await request("operations/sequence", {
    operations: [
      { ...create("prefix"), idempotencyKey: "prefix" },
      { ...create("bad-seq", -1), idempotencyKey: "bad-seq" },
      { ...create("tail"), idempotencyKey: "tail" },
    ],
  });
  expect(sequence.status).toBe(200);
  expect((await request("beads/prefix")).status).toBe(200);
  expect((await request("beads/bad-seq")).status).toBe(404);
  expect((await request("beads/tail")).status).toBe(200);
  await runtime.close();
  runtime = await emitted.startTransactionRuntime({ ...options, create: false });
  await discoveryBoundary();
  expect(await request("types/")).toEqual(inventory);
  expect(
    await request("operations/create-bead", { id: "beads/a", type, properties: { n: 1 } }, "first"),
  ).toEqual(first);
  expect(
    await request(
      "operations/batch",
      { operations: [create("rollback"), create("bad", -1)] },
      "failure",
    ),
  ).toEqual(failure);
  expect(await request(base)).toEqual({ status: 200, value: installedDescriptors[0] });
});
it("bounds runtime artifact input and requires explicit Scope before provisioning", async () => {
  const contracts = compileDevelopmentContracts(bundle());
  const options = {
    directory: directory(),
    create: true,
    port: 0,
    types: contracts.descriptors,
    credentials: [{ token: "a".repeat(32), principal: "p", canMutate: true }],
    artifacts: plain(),
  };
  await expect(emitted.startTransactionRuntime(options)).rejects.toThrow("explicit stable Scope");
  const oversized = plain();
  present(oversized.schemas[0]).utf8 = "x".repeat(CONTRACT_ARTIFACT_CEILINGS.artifactBytes + 1);
  await expect(
    emitted.startTransactionRuntime({ ...options, scope, artifacts: oversized }),
  ).rejects.toThrow("byte bound");
  const malformed = plain();
  Object.defineProperty(malformed.schemas[0], "utf8", {
    get() {
      throw Error("getter ran");
    },
  });
  await expect(
    emitted.startTransactionRuntime({ ...options, scope, artifacts: malformed }),
  ).rejects.toThrow("administrative data fields");
  const tooMany = plain();
  tooMany.schemas = Array.from({ length: CONTRACT_ARTIFACT_CEILINGS.submittedArtifacts + 1 }, () =>
    present(tooMany.schemas[0]),
  );
  await expect(
    emitted.startTransactionRuntime({ ...options, scope, artifacts: tooMany }),
  ).rejects.toThrow("bounded administrative array");
  const aggregate = plain();
  aggregate.schemas = Array.from({ length: 17 }, (_, i) => ({
    retrievalUri: `https://offline.invalid/${i}`,
    utf8: " ".repeat(CONTRACT_ARTIFACT_CEILINGS.artifactBytes),
  }));
  await expect(
    emitted.startTransactionRuntime({ ...options, scope, artifacts: aggregate }),
  ).rejects.toThrow("byte bound");
  expect(existsSync(path.join(options.directory, "transaction.sqlite"))).toBe(false);
});

it("rolls back earlier selected postimages when a later effective contract fails", () => {
  const input = bundle(),
    narrow = `${scope}types/narrow`,
    narrowSchema = "https://offline.invalid/narrow";
  input.descriptors.push(
    artifact(narrow, {
      id: narrow,
      name: "Narrow",
      describes: "bead",
      conformsTo: [base],
      propertiesSchema: narrowSchema,
    }),
  );
  input.schemas.push(artifact(narrowSchema, { type: "object", properties: { n: { maximum: 1 } } }));
  const f = fixture(input);
  f.run([create("a"), { ...create("b"), type: narrow }], "seed");
  const before = f.owner.inspect();
  const failed = f.run(
    [
      {
        operation: "updateWhere",
        collection: "beads",
        selector: "$[?@.properties.n == 1]",
        change: [{ op: "replace", path: "/n", value: 2 }],
      },
    ],
    "late-set",
    true,
  );
  expect(failed).toMatchObject({
    status: "failed",
    problem: { code: "validation-failed", operationIndex: 0 },
  });
  expect(f.owner.inspect()).toEqual(before);
});
