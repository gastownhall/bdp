import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransactionSingleton } from "./transaction-batch.js";
import { erasureCanonicalJson } from "./transaction-erasure.js";
import { compileDevelopmentContracts } from "./development-contracts.js";
import { readStoredResource } from "./resource-evaluator.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";

const scope = "https://live-correction.test/s/",
  type = `${scope}types/task`;
const types = [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })];
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-correction-")),
    file = path.join(directory, "owner.sqlite");
  const options = { file, scope, types, create: true, clock: () => 1000, ...extra };
  let owner = openTransactionStore(options),
    number = 0;
  cleanup.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    file,
    options,
    get owner() {
      return owner;
    },
    request(
      input: unknown,
      operation: Parameters<typeof prepareTransactionSingleton>[1] = "updateBead",
    ) {
      return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
    },
    run(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
      const request = this.request(input, operation),
        admission = owner.admit("p", `key-${number++}`, request);
      if (admission.kind !== "owned") throw new Error("expected new owner");
      const receipt = owner.execute(admission.claim);
      expect(receipt.status).toBe("completed");
      return {
        receipt,
        request,
        resource: (
          receipt.results as {
            resource: {
              id: string;
              type: string;
              revision: string;
              properties: unknown;
              metadata: unknown;
            };
          }[]
        )[0]!.resource,
      };
    },
    create(id = "a") {
      return this.run("createBead", {
        id: `beads/${id}`,
        type,
        properties: { secret: "live-private" },
        metadata: { secret: "live-metadata" },
      });
    },
    raw() {
      owner.close();
      const db = new DatabaseSync(file);
      try {
        return JSON.stringify(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
            .map((row) => ({
              table: row.name,
              rows: db.prepare(`SELECT * FROM "${row.name}"`).all(),
            })),
        );
      } finally {
        db.close();
        owner = openTransactionStore({ ...options, create: false });
      }
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    crash(
      subject: string,
      revision: string,
      stage: "before-erasure-commit" | "after-erasure-commit",
    ) {
      owner.close();
      const result = spawnSync(
        process.execPath,
        [
          new URL("../test-support/live-correction-crash.mjs", import.meta.url).pathname,
          file,
          subject,
          revision,
          stage,
        ],
        { timeout: 10000, maxBuffer: 65536, encoding: "utf8" },
      );
      console.log(
        "LIVE_CORRECTION_CRASH_EVIDENCE " +
          JSON.stringify({
            stage,
            exitCode: result.status,
            signal: result.signal,
            error: result.error?.message ?? null,
            stdoutBase64: Buffer.from(result.stdout ?? "").toString("base64"),
            stderrBase64: Buffer.from(result.stderr ?? "").toString("base64"),
          }),
      );
      owner = openTransactionStore({ ...options, create: false });
      return result;
    },
  };
}

it.each(["properties", "metadata", "both"] as const)(
  "atomically corrects %s with an erasure record, fresh upsert and content-free Event",
  (field) => {
    const f = fixture(),
      created = f.create(),
      original = created.resource;
    const oldSnapshot = f.owner.captureSnapshot().manifest;
    const oldEvents = f.owner.readEvents(`${scope}events/`);
    if (oldEvents.kind !== "page") throw new Error("expected original Events");
    const oldCursor = oldEvents.page.events[0]!.id;
    const observed = f.owner.withRead((_reader, context) => context);
    if (observed.kind !== "read") throw new Error("expected owner context");
    const checkpoint = f.owner.captureChangesStart(),
      lease = f.owner.acquireChangePublication(observed.value, checkpoint);
    const properties = field === "metadata" ? original.properties : { corrected: true };
    const metadata = field === "properties" ? original.metadata : { corrected: true };
    const request = f.request({
      bead: "beads/a",
      ...(field === "metadata"
        ? {}
        : { propertiesChange: [{ op: "replace", path: "", value: properties }] }),
      ...(field === "properties"
        ? {}
        : { metadataChange: [{ op: "replace", path: "", value: metadata }] }),
    });
    const result = f.owner.correctLiveBeadVersion(original.id, original.revision, request);
    expect(result.context).toMatchObject({
      scopeEpoch: observed.value.scopeEpoch,
      scopePosition: "pos-2",
    });
    expect(result.group.transaction).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.group.erasures).toEqual([
      {
        subject: original.id,
        revision: original.revision,
        digest: {
          scheme: "sha-256-jcs",
          value: createHash("sha256").update(erasureCanonicalJson(original)).digest("hex"),
        },
      },
    ]);
    expect(result.group.changes).toHaveLength(1);
    expect(result.group.events).toHaveLength(1);
    const successor = result.group.changes[0]!.resource;
    expect(successor).toMatchObject({ id: original.id, type: original.type, properties, metadata });
    expect(successor.revision).not.toBe(original.revision);
    expect(result.group.events[0]).toMatchObject({
      ordinal: 0,
      type: "updated",
      transaction: result.group.transaction,
      data: {
        previousRevision: original.revision,
        revision: successor.revision,
        ...(field === "metadata"
          ? {}
          : { change: [{ op: "replace", path: "", value: properties }] }),
        ...(field === "properties"
          ? {}
          : { metadataChange: [{ op: "replace", path: "", value: metadata }] }),
      },
    });
    expect(Object.keys(result.group.events[0]!.data as object).sort()).toEqual(
      [
        ...(field === "metadata" ? [] : ["change"]),
        ...(field === "properties" ? [] : ["metadataChange"]),
        "previousRevision",
        "revision",
      ].sort(),
    );
    expect(f.owner.readRetainedVersion(original.id, original.revision)).toMatchObject({
      kind: "erased",
    });
    expect(f.owner.readRetainedVersion(successor.id, successor.revision)).toMatchObject({
      kind: "retained",
      resource: successor,
    });
    expect(f.owner.receipt("p", created.receipt.id)).toMatchObject({
      results: [{ outcome: "erased" }],
    });
    expect(() => f.owner.readChanges(checkpoint)).toThrow("cursor-expired");
    expect(() =>
      f.owner.readSnapshot(new URL(oldSnapshot.id).searchParams.get("snapshot")!),
    ).toThrow("cursor-expired");
    const live = f.owner.readChanges(checkpoint, undefined, undefined, lease);
    if (live.kind !== "page") throw new Error("expected caught-up publication");
    expect(live.page.groups).toHaveLength(1);
    expect(live.page.groups[0]).toMatchObject({
      changes: result.group.changes,
      erasures: result.group.erasures,
      events: result.group.events.map((event) => ({ ...event, id: expect.stringMatching(/^ev_/) })),
    });
    expect(lease.publish(live.page.groups[0]!.checkpoint, () => true)).toBe(true);
    lease.release();
    const events = f.owner.readEvents(`${scope}events/`, oldCursor);
    if (events.kind !== "page") throw new Error("expected exclusive old cursor");
    expect(events.page.events).toHaveLength(1);
    expect(events.page.events[0]!.data).toEqual(result.group.events[0]!.data);
    expect(f.owner.captureSnapshot().manifest.erasures).toEqual(result.group.erasures);
    const raw = f.raw();
    if (field !== "metadata") expect(raw).not.toContain("live-private");
    if (field !== "properties") expect(raw).not.toContain("live-metadata");
    expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe(
      "existing",
    );
    const tables = JSON.parse(raw) as { table: string; rows: unknown[] }[];
    expect(tables.find((table) => table.table === "receipts")!.rows).toHaveLength(1);
  },
);

it("does not emit an object delta for a supplied unchanged object when the other object changes", () => {
  const f = fixture(),
    original = f.create().resource;
  const result = f.owner.correctLiveBeadVersion(
    original.id,
    original.revision,
    f.request({
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "", value: original.properties }],
      metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
    }),
  );
  expect(result.group.events[0]!.data).not.toHaveProperty("change");
  expect(result.group.events[0]!.data).toHaveProperty("metadataChange");
});

it.each([
  "unchanged",
  "ordinary-patch",
  "wrong-revision",
  "wrong-target",
  "wrong-operation",
  "alias",
] as const)("refuses unsupported %s correction without any partial writes", (kind) => {
  const f = fixture(),
    original = f.create().resource;
  f.owner.captureSnapshot();
  const before = f.raw();
  const request =
    kind === "wrong-operation"
      ? f.request({ bead: "beads/a" }, "deleteBead")
      : f.request({
          bead:
            kind === "wrong-target"
              ? "beads/missing"
              : kind === "alias"
                ? "alias/missing"
                : "beads/a",
          propertiesChange: [
            {
              op: "replace",
              path: kind === "ordinary-patch" ? "/secret" : "",
              value: kind === "unchanged" ? original.properties : { corrected: true },
            },
          ],
        });
  expect(() =>
    f.owner.correctLiveBeadVersion(
      original.id,
      kind === "wrong-revision" ? "stale" : original.revision,
      request,
    ),
  ).toThrow();
  expect(f.raw()).toBe(before);
  expect(f.owner.erasureLedger()).toEqual([]);
});

it("refuses a schema-invalid corrected successor with its real validator cause and no partial writes", () => {
  const schema = "https://correction.test/schema";
  const artifact = (retrievalUri: string, value: unknown) => ({
    retrievalUri,
    utf8Bytes: Buffer.from(JSON.stringify(value)),
  });
  const contracts = compileDevelopmentContracts({
    descriptors: [
      artifact(type, {
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema: schema,
      }),
    ],
    schemas: [
      artifact(schema, {
        $id: schema,
        type: "object",
        required: ["secret"],
        properties: { secret: { type: "string" } },
      }),
    ],
    limits: { ...CONTRACT_ARTIFACT_CEILINGS },
  });
  const f = fixture({ types: contracts.descriptors, contracts }),
    original = f.create().resource,
    before = f.raw();
  let error: unknown;
  try {
    f.owner.correctLiveBeadVersion(
      original.id,
      original.revision,
      f.request({
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "", value: { secret: 7 } }],
      }),
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    message: "live correction validation refused",
    cause: { code: "validation-failed", operationIndex: 0 },
  });
  expect(f.raw()).toBe(before);
});

it.each(["Link"] as const)("refuses live %s correction before any writes", (kind) => {
  const link = `${scope}types/link`;
  const f = fixture({
    types: [
      parseTypeDescriptor({
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 4 } },
      }),
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ],
  });
  f.create("a");
  f.create("b");
  const created = f.run("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: "beads/b",
    properties: {},
    metadata: {},
  });
  const observation = f.owner.withRead((reader) =>
    readStoredResource(reader.resource("beads/a")!, scope),
  );
  if (observation.kind !== "read") throw new Error("expected owned source");
  const original = kind === "Link" ? created.resource : observation.value;
  const before = f.raw();
  expect(() =>
    f.owner.correctLiveBeadVersion(
      original.id,
      original.revision,
      f.request({
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
      }),
    ),
  ).toThrow();
  expect(f.raw()).toBe(before);
});

it("rolls back a correction, ledger, receipt scrub and Snapshot invalidation on a before-commit fault", () => {
  let armed = false;
  const f = fixture({
    fault(stage) {
      if (armed && stage === "before-erasure-commit")
        throw new Error("new correction rollback fault");
    },
  });
  const original = f.create().resource;
  f.owner.captureSnapshot();
  const before = f.raw();
  armed = true;
  expect(() =>
    f.owner.correctLiveBeadVersion(
      original.id,
      original.revision,
      f.request({
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
      }),
    ),
  ).toThrow("new correction rollback fault");
  expect(f.raw()).toBe(before);
  expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe("retained");
});

it.each(["before-erasure-commit", "after-erasure-commit"] as const)(
  "recovers an abrupt correction %s with atomic successor and erasure state",
  (stage) => {
    const f = fixture(),
      created = f.create(),
      original = created.resource;
    const child = f.crash(original.id, original.revision, stage);
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(79);
    expect(JSON.parse(child.stdout)).toEqual({ stage, abruptExit: 79 });
    const committed = stage === "after-erasure-commit";
    expect(f.owner.inspect().position).toBe(committed ? "2" : "1");
    expect(f.owner.erasureLedger()).toHaveLength(committed ? 1 : 0);
    expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe(
      committed ? "erased" : "retained",
    );
    const observed = f.owner.withRead((reader) =>
      readStoredResource(reader.resource("beads/a")!, scope),
    );
    if (observed.kind !== "read") throw new Error("expected recovered current resource");
    expect(observed.value.properties).toEqual(
      committed ? { corrected: true } : original.properties,
    );
    expect(f.owner.receipt("p", created.receipt.id)).toMatchObject({
      results: [committed ? { outcome: "erased" } : { resource: original }],
    });
    if (committed) {
      expect(f.raw()).not.toContain("live-private");
      expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe(
        "existing",
      );
    }
  },
);

it("refuses correction during pending mutation ownership without consuming that original claim", () => {
  const f = fixture(),
    original = f.create().resource;
  const admission = f.owner.admit(
    "p",
    "pending",
    f.request({
      bead: original.id,
      metadataChange: [{ op: "replace", path: "", value: { ordinary: true } }],
    }),
  );
  if (admission.kind !== "owned") throw new Error("expected pending ownership");
  expect(() =>
    f.owner.correctLiveBeadVersion(
      original.id,
      original.revision,
      f.request({
        bead: original.id,
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
      }),
    ),
  ).toThrow("drained mutation ownership");
  expect(f.owner.erasureLedger()).toEqual([]);
  expect(f.owner.inspect().position).toBe("1");
  expect(f.owner.execute(admission.claim)).toMatchObject({
    status: "completed",
    effectPosition: "pos-2",
  });
});

it("fences after a post-commit correction fault and reopens with the complete durable purge", () => {
  let armed = false;
  const f = fixture({
    fault(stage) {
      if (armed && stage === "after-erasure-commit")
        throw new Error("new correction committed fault");
    },
  });
  const original = f.create().resource;
  armed = true;
  expect(() =>
    f.owner.correctLiveBeadVersion(
      original.id,
      original.revision,
      f.request({
        bead: original.id,
        propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
      }),
    ),
  ).toThrow();
  expect(f.owner.withRead(() => true)).toMatchObject({
    kind: "entry-refused",
    reason: "not-accepting",
  });
  f.reopen();
  expect(f.owner.inspect().position).toBe("2");
  expect(f.owner.erasureLedger()).toHaveLength(1);
  expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe("erased");
  expect(f.raw()).not.toContain("live-private");
});

it.each(["current", "stale"] as const)(
  "preserves an ordinary %s expectedRevision guard in administrative correction",
  (guard) => {
    const f = fixture(),
      original = f.create().resource,
      before = f.raw();
    const request = f.request({
      bead: original.id,
      expectedRevision: guard === "current" ? original.revision : "stale",
      propertiesChange: [{ op: "replace", path: "", value: { corrected: true } }],
    });
    if (guard === "current") {
      expect(
        f.owner.correctLiveBeadVersion(original.id, original.revision, request).group.changes,
      ).toHaveLength(1);
      expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe("erased");
    } else {
      let error: unknown;
      try {
        f.owner.correctLiveBeadVersion(original.id, original.revision, request);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        message: "live correction validation refused",
        cause: { code: "revision-mismatch", operationIndex: 0 },
      });
      expect(f.raw()).toBe(before);
    }
  },
);
