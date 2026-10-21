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
import { readStoredResource } from "./resource-evaluator.js";

const scope = "https://live-tombstone.test/s/",
  type = `${scope}types/task`,
  link = `${scope}types/link`;
const types = [
  parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] }),
  parseTypeDescriptor({
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "opaque" },
  }),
];
const clean: (() => void)[] = [];
afterEach(() => {
  for (const fn of clean.splice(0).reverse()) fn();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-live-tombstone-")),
    file = path.join(directory, "owner.sqlite");
  const options = { file, scope, types, create: true, clock: () => 1000, ...extra };
  let owner = openTransactionStore(options),
    n = 0;
  clean.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    file,
    get owner() {
      return owner;
    },
    request(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
      return prepareTransactionSingleton(scope, operation, JSON.stringify(input));
    },
    run(operation: Parameters<typeof prepareTransactionSingleton>[1], input: unknown) {
      const request = this.request(operation, input),
        admission = owner.admit("p", `key-${n++}`, request);
      if (admission.kind !== "owned") throw new Error("expected new mutation owner");
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
        properties: { secret: "tombstone-property" },
        metadata: { secret: "tombstone-metadata" },
        revisionProvenance: {
          actor: { id: "tombstone-actor", basis: "writer-supplied" },
          agent: null,
          message: "tombstone-provenance",
        },
      });
    },
    current(id = "a") {
      return owner.withRead((reader) => {
        const value = reader.resource(`beads/${id}`);
        return value ? readStoredResource(value, scope) : undefined;
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
    crash(subject: string, revision: string, stage: string) {
      owner.close();
      const result = spawnSync(
        process.execPath,
        [
          new URL("../test-support/live-tombstone-crash.mjs", import.meta.url).pathname,
          file,
          subject,
          revision,
          stage,
        ],
        { timeout: 10000, maxBuffer: 65536, encoding: "utf8" },
      );
      console.log(
        "LIVE_TOMBSTONE_CRASH_EVIDENCE " +
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

it("atomically purges a live Bead and commits only its exact tombstone and identity-only deleted Event", () => {
  const f = fixture(),
    created = f.create(),
    original = created.resource;
  const snapshot = f.owner.captureSnapshot().manifest,
    start = f.owner.captureChangesStart();
  const oldEvents = f.owner.readEvents(`${scope}events/`);
  if (oldEvents.kind !== "page") throw new Error("expected original Events");
  const cursor = oldEvents.page.events[0]!.id;
  const observation = f.owner.withRead((_reader, context) => context);
  if (observation.kind !== "read") throw new Error("expected current context");
  const lease = f.owner.acquireChangePublication(observation.value, start);
  const result = f.owner.tombstoneLiveBeadVersion(original.id, original.revision);
  expect(result.context).toMatchObject({
    scopeEpoch: observation.value.scopeEpoch,
    scopePosition: "pos-2",
  });
  expect(result.group).toMatchObject({
    position: "pos-2",
    previousPosition: "pos-1",
    projectionAdvance: false,
    eventCount: 1,
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
  expect(result.group.changes).toEqual([
    {
      operation: "tombstone",
      resourceKind: "bead",
      resource: { id: original.id, type: original.type, revision: original.revision },
    },
  ]);
  expect(result.group.events).toHaveLength(1);
  expect(result.group.events[0]).toMatchObject({
    type: "deleted",
    ordinal: 0,
    transaction: result.group.transaction,
    subject: original.id,
    data: { revision: original.revision },
  });
  expect(Object.keys(result.group.events[0]!.data as object)).toEqual(["revision"]);
  expect(f.current()).toMatchObject({ kind: "read", value: undefined });
  expect(f.owner.readRetainedVersion(original.id, original.revision)).toMatchObject({
    kind: "erased",
    lineage: { id: original.id, type: original.type, revision: original.revision },
  });
  expect(f.owner.receipt("p", created.receipt.id)).toMatchObject({
    results: [{ outcome: "erased" }],
  });
  expect(() => f.owner.readSnapshot(new URL(snapshot.id).searchParams.get("snapshot")!)).toThrow(
    "cursor-expired",
  );
  expect(() => f.owner.readChanges(start)).toThrow("cursor-expired");
  const caughtUp = f.owner.readChanges(start, undefined, undefined, lease);
  if (caughtUp.kind !== "page") throw new Error("expected caught-up stream group");
  expect(caughtUp.page.groups[0]).toMatchObject({
    changes: result.group.changes,
    erasures: result.group.erasures,
    eventCount: 1,
  });
  expect(lease.publish(caughtUp.page.groups[0]!.checkpoint, () => true)).toBe(true);
  lease.release();
  const events = f.owner.readEvents(`${scope}events/`, cursor);
  if (events.kind !== "page") throw new Error("expected old exclusive cursor validity");
  expect(events.page.events.map((event) => [event.type, event.ordinal, event.data])).toEqual([
    ["deleted", 0, { revision: original.revision }],
  ]);
  expect(f.owner.captureSnapshot().manifest).toMatchObject({
    erasures: result.group.erasures,
    beads: { items: [] },
  });
  const raw = f.raw();
  for (const secret of [
    "tombstone-property",
    "tombstone-metadata",
    "tombstone-provenance",
    "tombstone-actor",
  ])
    expect(raw).not.toContain(secret);
  expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe("existing");
  expect(
    JSON.parse(raw).find((table: { table: string }) => table.table === "receipts").rows,
  ).toHaveLength(1);
  const reuse = f.owner.admit(
    "p",
    "reuse",
    f.request("createBead", { id: "beads/a", type, properties: {} }),
  );
  if (reuse.kind !== "owned") throw new Error("expected a new failed request");
  // The reused identity must never become a new Resource in this epoch.
  expect(f.owner.execute(reuse.claim).status).toBe("failed");
  expect(f.current()).toMatchObject({ kind: "read", value: undefined });
});

it.each(["incoming", "outgoing", "self", "external"] as const)(
  "refuses a Bead with an actual %s live incident Link without partial writes",
  (direction) => {
    const f = fixture(),
      a = f.create("a").resource;
    f.create("b");
    f.run("createLink", {
      id: "links/l",
      type: link,
      source: direction === "incoming" ? "beads/b" : "beads/a",
      target:
        direction === "self"
          ? "beads/a"
          : direction === "incoming"
            ? "beads/a"
            : direction === "external"
              ? { uri: "urn:external:bead", revision: "remote-revision" }
              : "beads/b",
      properties: {},
      metadata: {},
    });
    const before = f.raw();
    let error: unknown;
    try {
      f.owner.tombstoneLiveBeadVersion(a.id, a.revision);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      message: "live tombstone validation refused",
      cause: { code: "incident-links-exist", operationIndex: 0 },
    });
    expect(f.raw()).toBe(before);
  },
);

it.each(["stale", "foreign", "Link"] as const)(
  "refuses %s live-tombstone targets without writes",
  (kind) => {
    const f = fixture(),
      a = f.create("a").resource;
    f.create("b");
    const linked = f.run("createLink", {
      id: "links/l",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: {},
      metadata: {},
    }).resource;
    const before = f.raw();
    expect(() =>
      f.owner.tombstoneLiveBeadVersion(
        kind === "foreign" ? "https://foreign.test/beads/a" : kind === "Link" ? linked.id : a.id,
        kind === "stale" ? "stale" : kind === "Link" ? linked.revision : a.revision,
      ),
    ).toThrow();
    expect(f.raw()).toBe(before);
  },
);

it("refuses owned Bead cascades explicitly before writes", () => {
  const f = fixture({
    types: [
      parseTypeDescriptor({
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [link]: { max: 4 } },
      }),
      types[1]!,
    ],
  });
  f.create("a");
  f.create("b");
  f.run("createLink", {
    id: "links/l",
    type: link,
    source: "beads/a",
    target: "beads/b",
    properties: {},
    metadata: {},
  });
  const current = f.current();
  if (current.kind !== "read" || !current.value) throw new Error("expected owned source");
  const before = f.raw();
  expect(() =>
    f.owner.tombstoneLiveBeadVersion(current.value!.id, current.value!.revision),
  ).toThrow("nonempty owned sets is unsupported");
  expect(f.raw()).toBe(before);
});

it("rolls back the deletion and purge when the new before-commit fault fires", () => {
  let armed = false;
  const f = fixture({
    fault(stage) {
      if (armed && stage === "before-erasure-commit") throw new Error("new tombstone rollback");
    },
  });
  const original = f.create().resource;
  f.owner.captureSnapshot();
  const before = f.raw();
  armed = true;
  expect(() => f.owner.tombstoneLiveBeadVersion(original.id, original.revision)).toThrow(
    "new tombstone rollback",
  );
  expect(f.raw()).toBe(before);
});

it.each(["before-erasure-commit", "after-erasure-commit"] as const)(
  "recovers an abrupt tombstone %s without a half-applied deletion",
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
    expect(f.current()).toMatchObject({ kind: "read", value: committed ? undefined : original });
    expect(f.owner.readRetainedVersion(original.id, original.revision).kind).toBe(
      committed ? "erased" : "retained",
    );
    if (committed) {
      expect(f.raw()).not.toContain("tombstone-property");
      expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe(
        "existing",
      );
    }
  },
);

it("tombstones a corrected successor while retaining both erasure obligations and no corrected-version copies", () => {
  const f = fixture(),
    original = f.create().resource;
  const corrected = f.owner.correctLiveBeadVersion(
    original.id,
    original.revision,
    f.request("updateBead", {
      bead: original.id,
      propertiesChange: [
        { op: "replace", path: "", value: { secret: "corrected-then-tombstoned" } },
      ],
    }),
  );
  const successor = corrected.group.changes[0]!.resource;
  const before = f.owner.readEvents(`${scope}events/`);
  if (before.kind !== "page") throw new Error("expected corrected Event cursor");
  const cursor = before.page.events.at(-1)!.id;
  const result = f.owner.tombstoneLiveBeadVersion(successor.id, successor.revision);
  expect(result.context.scopePosition).toBe("pos-3");
  expect(f.owner.erasureLedger().map((record) => [record.subject, record.revision])).toEqual([
    [original.id, original.revision],
    [successor.id, successor.revision],
  ]);
  expect(f.owner.captureSnapshot().manifest.erasures).toHaveLength(2);
  const after = f.owner.readEvents(`${scope}events/`, cursor);
  if (after.kind !== "page") throw new Error("expected old corrected cursor remains valid");
  expect(after.page.events.map((event) => [event.type, event.data])).toEqual([
    ["deleted", { revision: successor.revision }],
  ]);
  expect(f.current()).toMatchObject({ kind: "read", value: undefined });
  expect(f.raw()).not.toContain("corrected-then-tombstoned");
});
