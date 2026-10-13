import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { admitJsonNumbers, decodeJsonDocument, stringifyJsonValue } from "@bdp/protocol";
import * as batch from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://example.test/materialization/";
const type = `${scope}types/bead`;
const types = [{ id: type, name: "Bead", describes: "bead" as const, conformsTo: [] }];
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-materialization-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000;
  const options = { file: path.join(directory, "owner.sqlite"), scope, types, clock: () => now };
  const owner = openTransactionStore({ ...options, create: true });
  cleanup.push(() => owner.close());
  const prepared = batch.prepareTransaction(
    scope,
    JSON.stringify({ operations: [{ operation: "createBead", type, properties: { n: 0 } }] }),
  );
  return {
    owner,
    options,
    prepared,
    advance: () => {
      now += 2 * 86_400_000;
    },
  };
}

it("passes the same frozen, configuration-bound tuple to every transaction evaluation", () => {
  const f = fixture();
  const execute = vi.spyOn(batch, "evaluateTransaction");
  const admitted = f.owner.admit("p", "key", f.prepared);
  if (admitted.kind !== "owned") throw new Error("expected admission");
  expect(f.owner.execute(admitted.claim).status).toBe("completed");
  expect(execute.mock.calls[0]?.[2].limits).toBe(batch.TRANSACTION_RUNTIME_LIMITS);
  expect(Object.isFrozen(batch.TRANSACTION_RUNTIME_LIMITS)).toBe(true);
  const configuration = JSON.parse(
    f.owner.readConfiguration().scopeConfiguration.configurationIdentity,
  );
  expect(configuration.runtimeLimits).toEqual(batch.TRANSACTION_RUNTIME_LIMITS);
  expect(configuration.runtimeLimits).toMatchObject({
    matchedResources: 32,
    inducedEvents: 256,
    maximumOperations: 32,
    representationBytes: 262144,
    requestBodyBytes: 65536,
    propertiesBytes: 65536,
    scopeSourceBytes: 65536,
  });
});

for (const field of [
  "propertiesBytes",
  "representationBytes",
  "diagnosticBytes",
  "diagnosticCount",
] as const) {
  it.each([
    undefined,
    0,
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    batch.TRANSACTION_RUNTIME_LIMITS[field] + 1,
  ])(`refuses missing/invalid/raised TX ${field} bound %s before effects`, (value) => {
    const f = fixture();
    const evaluate = batch.evaluateTransaction;
    vi.spyOn(batch, "evaluateTransaction").mockImplementation((normalized, tx, options, ...rest) =>
      evaluate(
        normalized,
        tx,
        {
          ...options,
          limits: { ...options.limits, [field]: value },
        } as batch.TransactionEvaluationOptions,
        ...rest,
      ),
    );
    const admitted = f.owner.admit("p", "key", f.prepared);
    if (admitted.kind !== "owned") throw new Error("expected admission");
    expect(() => f.owner.execute(admitted.claim)).toThrow(
      `invalid transaction evaluator ${field} bound`,
    );
    vi.restoreAllMocks();
    // Integrity refusal releases the claim; it is not an invented retained count error.
    const retry = f.owner.admit("p", "key", f.prepared);
    if (retry.kind !== "owned") throw new Error("expected fresh retry");
    expect(f.owner.execute(retry.claim).status).toBe("completed");
  });
}

it("requires all four proof-relevant evaluator bounds in the TX options type", () => {
  type Limits = batch.TransactionEvaluationOptions["limits"];
  // @ts-expect-error complete-Resource cap is required, unlike generic RU options
  const missingRepresentation: Limits = { propertiesBytes: 65536 };
  // @ts-expect-error properties cap is required too
  const missingProperties: Limits = { representationBytes: 262144 };
  void missingRepresentation;
  void missingProperties;
  // @ts-expect-error failed-receipt byte/count ceilings are required too
  const missingDiagnostics: Limits = { propertiesBytes: 65536, representationBytes: 262144 };
  void missingDiagnostics;
});

it.each(["legacy", "changed"])("refuses %s tuple before pending recovery or expiry", (variant) => {
  const f = fixture();
  const completedClaim = f.owner.admit("p", "completed", f.prepared);
  if (completedClaim.kind !== "owned") throw new Error("expected admission");
  const completed = f.owner.execute(completedClaim.claim);
  const pending = f.owner.admit("p", "pending", f.prepared);
  expect(pending.kind).toBe("owned");
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  const raw = String(
    db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value,
  );
  const configuration = JSON.parse(raw);
  if (variant === "legacy") {
    // Exact predecessor runtimeLimits had only these four fields; its count and
    // representation constants were not part of persisted installation identity.
    const { requestBodyBytes, propertiesBytes, diagnosticBytes, diagnosticCount } =
      configuration.runtimeLimits;
    configuration.runtimeLimits = {
      requestBodyBytes,
      propertiesBytes,
      diagnosticBytes,
      diagnosticCount,
    };
  } else configuration.runtimeLimits.inducedEvents = 128;
  db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
    JSON.stringify(configuration),
  );
  const beforeRows = db.prepare("SELECT * FROM receipts ORDER BY key").all();
  db.close();
  f.advance();
  const beforeFile = readFileSync(f.options.file);
  expect(() => openTransactionStore({ ...f.options, create: false })).toThrow(
    "transaction installation mismatch",
  );
  expect(readFileSync(f.options.file)).toEqual(beforeFile);
  const check = new DatabaseSync(f.options.file);
  expect(check.prepare("SELECT * FROM receipts ORDER BY key").all()).toEqual(beforeRows);
  // Restore only the actual original config, then ordinary startup may recover.
  check.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(raw);
  check.close();
  const reopened = openTransactionStore({ ...f.options, create: false });
  cleanup.push(() => reopened.close());
  expect(reopened.recoveredPending).toBe(1);
  const retry = reopened.admit("p", "completed", f.prepared);
  expect(retry).toMatchObject({
    kind: "existing",
    receipt: { id: completed.id, detail: "expired" },
  });
});

it("accepts the exact encoded Scope bound and refuses overflow before provisioning", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-materialization-scope-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const base = "https://example.test/";
  const size = batch.TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes;
  const exact = `${base}${"a".repeat(size - Buffer.byteLength(JSON.stringify(`${base}/events/`)))}/`;
  expect(Buffer.byteLength(JSON.stringify(`${exact}events/`))).toBe(size);
  const file = path.join(directory, "exact.sqlite");
  const owner = openTransactionStore({ file, scope: exact, types, create: true });
  owner.close();
  const reopened = openTransactionStore({ file, scope: exact, types, create: false });
  reopened.close();
  const overflow = path.join(directory, "overflow.sqlite");
  expect(() =>
    openTransactionStore({ file: overflow, scope: `${exact.slice(0, -1)}a/`, types, create: true }),
  ).toThrow("Scope exceeds private materialization bound");
  expect(existsSync(overflow)).toBe(false);
});

it("enforces the actual representation tuple on both direct records and owned source postimages", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-materialization-record-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const link = `${scope}types/link`;
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    types: [
      {
        id: type,
        name: "Owner",
        describes: "bead" as const,
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 1 } },
      },
      {
        id: link,
        name: "Link",
        describes: "link" as const,
        conformsTo: [],
        source: { conformsTo: [type], external: "none" as const },
        target: { conformsTo: [type], external: "none" as const },
      },
    ],
  };
  const owner = openTransactionStore({ ...options, create: true });
  cleanup.push(() => owner.close());
  const point = (id = "beads/a") => {
    const read = owner.withRead((reader) => reader.resource(id)?.bodyJson);
    if (read.kind !== "read") throw new Error("read refused");
    return read.value;
  };
  const run = (operation: unknown, key: string) => {
    const text = JSON.stringify({ operations: [operation] });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
    const prepared = batch.prepareTransaction(scope, text);
    const admitted = owner.admit("p", key, prepared);
    if (admitted.kind !== "owned") throw new Error("admission refused");
    return { receipt: owner.execute(admitted.claim), prepared };
  };
  expect(
    run(
      {
        operation: "createBead",
        id: "beads/a",
        type,
        properties: { n: 0, payload: "p".repeat(60000) },
      },
      "seed",
    ).receipt.status,
  ).toBe("completed");
  const patch = (name: string, value: string) => ({
    operation: "updateBead",
    bead: "beads/a",
    metadataChange: [{ op: "add", path: `/${name}`, value }],
  });
  for (let i = 0; i < 3; i++)
    expect(run(patch(`chunk${i}`, "m".repeat(60000)), `chunk${i}`).receipt.status).toBe(
      "completed",
    );
  const previous = JSON.parse(point() as string);
  const rest =
    262144 -
    Buffer.byteLength(
      JSON.stringify({ ...previous, metadata: { ...previous.metadata, last: "" } }),
    );
  expect(rest).toBeGreaterThan(0);
  expect(run(patch("last", "x".repeat(rest)), "last").receipt.status).toBe("completed");
  const before = point();
  expect(Buffer.byteLength(before as string)).toBe(262144);
  for (const [key, operation] of [
    ["direct-overflow", patch("last", "x".repeat(rest + 1))],
    [
      "owned-source-overflow",
      {
        operation: "createLink",
        id: "links/l",
        type: link,
        source: "beads/a",
        target: "beads/a",
        properties: {},
      },
    ],
  ] as const) {
    const result = run(operation, key);
    expect(result.receipt).toMatchObject({
      status: "failed",
      problem: { status: 413, code: "limit-exceeded" },
    });
    expect(point()).toBe(before);
    expect(point("links/l")).toBeUndefined();
    expect(owner.admit("p", key, result.prepared)).toEqual({
      kind: "existing",
      receipt: result.receipt,
    });
  }
});

it.each([
  ["1e20", "100000000000000000000"],
  ["-9e20", "-900000000000000000000"],
  ["9e9", "9000000000"],
  ["-0.0000010000000000000002", "-0.0000010000000000000002"],
])(
  "bounds admitted numeric patch normalization for extremal token %s",
  (token, expectedLiteral) => {
    // Both patches share one carrier Q budget. The stored Event must contain
    // normalized semantic values, not the shorter lexical number spelling.
    const raw = `[{"op":"add","path":"/temporary","value":[${Array(32).fill(token).join(",")}]},{"op":"remove","path":"/temporary"}]`;
    const admittedValue = (text: string) => {
      const result = admitJsonNumbers(decodeJsonDocument(text), {
        diagnostics: 16,
        diagnosticBytes: 524288,
        diagnostic: () => ({ message: "unsupported number" }),
      });
      if (!result.ok) throw Error("numeric admission failed");
      return result.value;
    };
    const normalized = stringifyJsonValue(admittedValue(raw));
    expect(Buffer.byteLength(normalized)).toBeLessThanOrEqual(7 * Buffer.byteLength(raw));
    const literal = stringifyJsonValue(admittedValue(token));
    expect(Buffer.byteLength(literal)).toBeLessThanOrEqual(7 * Buffer.byteLength(token));
    expect(literal).toBe(expectedLiteral);
    const f = fixture();
    const create = batch.prepareTransaction(
      scope,
      JSON.stringify({
        operations: [{ operation: "createBead", id: "beads/a", type, properties: { n: 0 } }],
      }),
    );
    const seed = f.owner.admit("p", "seed", create);
    if (seed.kind !== "owned") throw Error("seed admission");
    f.owner.execute(seed.claim);
    const prepared = batch.prepareTransaction(
      scope,
      `{"operations":[{"operation":"updateBead","bead":"beads/a","propertiesChange":${raw.slice(0, -1)},{"op":"replace","path":"/n","value":1}]}]}`,
    );
    const admitted = f.owner.admit("p", "numeric", prepared);
    if (admitted.kind !== "owned") throw Error("numeric admission");
    expect(f.owner.execute(admitted.claim).status).toBe("completed");
    const group = f.owner.inspect().groups.at(-1) as { events: { data: { change: unknown } }[] };
    const change = group.events[0]?.data.change as unknown[];
    expect(change.slice(0, 2)).toEqual(admittedValue(raw));
    expect(stringifyJsonValue(change.slice(0, 2))).toBe(normalized);
  },
);
