import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import {
  prepareTransaction,
  normalizeTransaction,
  prepareTransactionSingleton,
} from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import { erasureCanonicalJson } from "./transaction-erasure.js";
import { pumpTransactionChanges } from "./transaction-sse.js";

const scope = "https://erasure.test/s/",
  type = `${scope}types/task`;
const types = [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })];
const clean: (() => void)[] = [];
afterEach(() => {
  for (const fn of clean.splice(0).reverse()) fn();
});
function fixture(
  fault?: Parameters<typeof openTransactionStore>[0]["fault"],
  selectedTypes = types,
  clock = Date.now,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-erasure-")),
    file = path.join(directory, "store.sqlite");
  let owner = openTransactionStore({
    file,
    scope,
    types: selectedTypes,
    create: true,
    clock,
    ...(fault ? { fault } : {}),
  });
  clean.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let number = 0;
  return {
    file,
    get owner() {
      return owner;
    },
    execute(operations: unknown[], key = `k${number++}`) {
      const request = prepareTransaction(scope, JSON.stringify({ operations }));
      const admission = owner.admit("p", key, request);
      if (admission.kind !== "owned") throw new Error("expected fresh owner");
      const receipt = owner.execute(admission.claim);
      expect(receipt.status).toBe("completed");
      return { receipt, request };
    },
    singleton(
      operation: Parameters<typeof prepareTransactionSingleton>[1],
      input: unknown,
      key = `single${number++}`,
    ) {
      const request = prepareTransactionSingleton(scope, operation, JSON.stringify(input));
      const admission = owner.admit("p", key, request);
      if (admission.kind !== "owned") throw new Error("expected fresh singleton");
      const receipt = owner.execute(admission.claim);
      expect(receipt.status).toBe("completed");
      return { receipt, request };
    },
    create(id = "a", secret = "private-original") {
      return this.execute([
        { operation: "createBead", id: `beads/${id}`, type, properties: { secret }, metadata: {} },
      ]);
    },
    update(id = "a") {
      return this.execute([
        {
          operation: "updateBead",
          bead: `beads/${id}`,
          propertiesChange: [{ op: "replace", path: "/secret", value: "replacement" }],
        },
      ]);
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({
        file,
        scope,
        types: selectedTypes,
        create: false,
        clock,
        ...(fault ? { fault } : {}),
      });
    },
    crashErase(
      subject: string,
      revision: string,
      stage: "before-erasure-commit" | "after-erasure-commit",
    ) {
      owner.close();
      const result = spawnSync(
        process.execPath,
        [
          new URL("../test-support/historical-erasure-crash.mjs", import.meta.url).pathname,
          file,
          subject,
          revision,
          stage,
        ],
        { timeout: 10000, maxBuffer: 65536, encoding: "utf8" },
      );
      console.log(
        "ERASURE_CRASH_EVIDENCE " +
          JSON.stringify({
            stage,
            exitCode: result.status,
            signal: result.signal,
            error: result.error?.message ?? null,
            stdoutBase64: Buffer.from(result.stdout ?? "").toString("base64"),
            stderrBase64: Buffer.from(result.stderr ?? "").toString("base64"),
          }),
      );
      owner = openTransactionStore({
        file,
        scope,
        types: selectedTypes,
        create: false,
        clock,
        ...(fault ? { fault } : {}),
      });
      return result;
    },
    editClosed(edit: (db: DatabaseSync) => void) {
      owner.close();
      const db = new DatabaseSync(file);
      try {
        edit(db);
      } finally {
        db.close();
      }
      owner = openTransactionStore({
        file,
        scope,
        types: selectedTypes,
        create: false,
        clock,
        ...(fault ? { fault } : {}),
      });
    },
    inspectRaw() {
      owner.close();
      const db = new DatabaseSync(file);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const rows = tables.map((row) => ({
        table: row.name,
        rows: db.prepare(`SELECT * FROM "${row.name}"`).all(),
      }));
      db.close();
      owner = openTransactionStore({
        file,
        scope,
        types: selectedTypes,
        create: false,
        clock,
        ...(fault ? { fault } : {}),
      });
      return JSON.stringify(rows);
    },
  };
}
function postimage(receipt: ReturnType<ReturnType<typeof fixture>["create"]>["receipt"]) {
  return (
    receipt.results as {
      resource: {
        id: string;
        type: string;
        revision: string;
        properties: unknown;
        metadata: unknown;
      };
    }[]
  )[0]!.resource;
}
function context(f: ReturnType<typeof fixture>) {
  const observation = f.owner.withRead((_reader, context) => context);
  if (observation.kind !== "read") throw new Error("owner read refused");
  return observation.value;
}
function oldVersion(f: ReturnType<typeof fixture>) {
  const created = f.create(),
    original = postimage(created.receipt);
  const snapshot = f.owner.captureSnapshot().manifest;
  const events = f.owner.readEvents(`${scope}events/`);
  if (events.kind !== "page") throw new Error("expected Event page");
  const cursor = events.page.events[0]!.id;
  f.update();
  return { ...created, original, snapshot, cursor };
}
it("purges whole historical copies atomically, preserves digest/epoch/replay identity and expires old Snapshot/checkpoint", () => {
  const f = fixture(),
    prior = oldVersion(f),
    epoch = context(f).scopeEpoch;
  const erased = f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  expect(erased.context).toMatchObject({ scopeEpoch: epoch, scopePosition: "pos-3" });
  expect(erased.group).toMatchObject({
    changes: [],
    events: [],
    eventCount: 0,
    projectionAdvance: false,
  });
  expect(erased.group.transaction).toMatch(/^[a-f0-9-]{36}$/);
  expect(erased.group.erasures).toEqual([
    {
      subject: prior.original.id,
      revision: prior.original.revision,
      digest: {
        scheme: "sha-256-jcs",
        value: createHash("sha256").update(erasureCanonicalJson(prior.original)).digest("hex"),
      },
    },
  ]);
  expect(() => f.owner.readChanges("genesis")).toThrow("cursor-expired");
  const page = f.owner.readChanges(f.owner.captureChangesStart());
  expect(page.kind).toBe("page");
  expect(() =>
    f.owner.readSnapshot(new URL(prior.snapshot.id).searchParams.get("snapshot")!),
  ).toThrow("cursor-expired");
  expect(f.owner.captureSnapshot().manifest.erasures).toEqual(erased.group.erasures);
  expect(f.owner.receipt("p", prior.receipt.id)).toMatchObject({
    results: [
      {
        outcome: "erased",
        erased: {
          id: prior.original.id,
          type: prior.original.type,
          revision: prior.original.revision,
        },
      },
    ],
  });
  expect(f.owner.admit("p", prior.receipt.idempotencyKey, prior.request).kind).toBe("existing");
  expect(f.inspectRaw()).not.toContain("private-original");
  f.reopen();
  expect(f.owner.erasureLedger()).toEqual(erased.group.erasures);
  expect(f.owner.admit("p", prior.receipt.idempotencyKey, prior.request).kind).toBe("existing");
  expect(
    f.owner.admit(
      "p",
      prior.receipt.idempotencyKey,
      prepareTransaction(
        scope,
        JSON.stringify({
          operations: [
            {
              operation: "createBead",
              id: "beads/a",
              type,
              properties: { secret: "different" },
              metadata: {},
            },
          ],
        }),
      ),
    ).kind,
  ).toBe("conflict");
  const after = f.owner.readEvents(`${scope}events/`, prior.cursor);
  expect(after.kind).toBe("page");
  if (after.kind === "page") expect(after.page.events.map((event) => event.type)).toEqual([]);
});
it("refuses live versions before any position, receipt, Snapshot or ledger writes", () => {
  const f = fixture(),
    created = f.create(),
    original = postimage(created.receipt);
  const before = f.inspectRaw();
  expect(() =>
    f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]),
  ).toThrow("live-version");
  expect(f.inspectRaw()).toBe(before);
});
it("rollback before erasure commit restores content, promises, position and empty ledger", () => {
  let armed = false;
  const f = fixture((stage) => {
    if (armed && stage === "before-erasure-commit") throw new Error("injected rollback");
  });
  const prior = oldVersion(f),
    before = f.inspectRaw();
  armed = true;
  expect(() =>
    f.owner.eraseHistoricalVersions([
      { subject: prior.original.id, revision: prior.original.revision },
    ]),
  ).toThrow("injected rollback");
  expect(f.inspectRaw()).toBe(before);
  expect(f.owner.erasureLedger()).toEqual([]);
  expect(
    f.owner.readSnapshot(new URL(prior.snapshot.id).searchParams.get("snapshot")!).manifest,
  ).toEqual(prior.snapshot);
});
it("fences lagging stream publication while caught-up admission crosses P, with finite/reconnect still expired", () => {
  const f = fixture(),
    prior = oldVersion(f),
    observed = context(f);
  const lagging = f.owner.acquireChangePublication(observed, "genesis");
  const checkpoint = f.owner.captureChangesStart();
  const caught = f.owner.acquireChangePublication(observed, checkpoint);
  const result = f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  expect(lagging.signal.aborted).toBe(true);
  expect(() =>
    lagging.publish("genesis", () => {
      throw new Error("must not write");
    }),
  ).toThrow("publication ended");
  expect(caught.signal.aborted).toBe(false);
  expect(() => f.owner.readChanges(checkpoint)).toThrow("cursor-expired");
  const after = f.owner.readChanges(checkpoint, undefined, undefined, caught);
  expect(after.kind).toBe("page");
  if (after.kind === "page") {
    expect(after.page.groups).toHaveLength(1);
    expect(after.page.groups[0]?.erasures).toEqual(result.group.erasures);
    let writes = 0;
    caught.publish(after.page.groups[0]!.checkpoint, () => {
      writes++;
      return false;
    });
    expect(writes).toBe(1);
  }
  expect(() => f.owner.assertPublication(observed)).toThrow("predates erasure");
  lagging.release();
  caught.release();
});
it("JCS sorts numeric keys by UTF-16, preserves ES binary64 formatting and nested arrays", () => {
  expect(erasureCanonicalJson({ "2": -0, "10": 1e30, a: [true, null, "🦉"] })).toBe(
    '{"10":1e+30,"2":0,"a":[true,null,"🦉"]}',
  );
});
it("migrates a legacy exact normalized identity once, retaining cross-carrier replay and conflict", () => {
  const f = fixture(),
    created = f.create();
  const original = normalizeTransaction(created.request, () => undefined).identity;
  f.editClosed((db) => {
    const configuration = JSON.parse(
      String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()!.value),
    );
    configuration.format = "bdp-private-transaction-snapshot-11";
    db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
      JSON.stringify(configuration),
    );
    db.prepare("DELETE FROM metadata WHERE name='requestFingerprintPolicy'").run();
    db.prepare("UPDATE receipts SET identity=?").run(original);
  });
  expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe("existing");
  f.editClosed((db) => {
    const value = db.prepare("SELECT identity FROM receipts").get()!.identity;
    const tree = JSON.parse(original);
    const input = tree[1][1][0][1].find(([key]: [string]) => key === "input")[1];
    const id = input[1].find(([key]: [string]) => key === "id");
    id[1] = [
      "reference-sha256",
      createHash("sha256")
        .update("transaction-reference-leaf-sha256-1\0")
        .update(JSON.stringify(["ru-semantic-value-1", id[1]]))
        .digest("hex"),
    ];
    const policy = "transaction-reference-leaves-sha256-1";
    expect(value).toBe(
      `${policy}:${createHash("sha256")
        .update(JSON.stringify([policy, tree]))
        .digest("hex")}`,
    );
  });
  expect(f.owner.admit("p", created.receipt.idempotencyKey, created.request).kind).toBe("existing");
});
it("keeps an empty replacement view nondisclosing without expiring its Snapshot or checkpoints", () => {
  const f = fixture(),
    prior = oldVersion(f);
  f.owner.replaceAuthorizationPolicy();
  const empty = f.owner.captureSnapshot().manifest,
    before = f.owner.captureChangesStart();
  f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  expect(f.owner.erasureLedger()).toEqual([]);
  expect(f.owner.readRetainedVersion(prior.original.id, prior.original.revision).kind).toBe(
    "missing",
  );
  expect(f.owner.readSnapshot(new URL(empty.id).searchParams.get("snapshot")!).manifest).toEqual(
    empty,
  );
  const changes = f.owner.readChanges(before);
  expect(changes.kind).toBe("page");
  if (changes.kind === "page")
    expect(changes.page.groups[0]).toMatchObject({
      projectionAdvance: true,
      changes: [],
      events: [],
      erasures: [],
    });
  expect(f.owner.receipt("p", prior.receipt.id)).toMatchObject({ detail: "withheld" });
});
it("erases all historical inline owned-Link copies together, retaining graph facts while another Link version carries endpoints", () => {
  const link = `${scope}types/link`;
  const ownedTypes = [
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
  ];
  const f = fixture(undefined, ownedTypes);
  f.create("a", "safe-a");
  f.create("b", "safe-b");
  const created = f.execute([
    {
      operation: "createLink",
      id: "links/l",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { secret: "old-link-private" },
      metadata: {},
    },
  ]);
  const original = postimage(created.receipt);
  f.execute([
    {
      operation: "updateLink",
      link: "links/l",
      propertiesChange: [{ op: "replace", path: "/secret", value: "new-link" }],
    },
  ]);
  const result = f.owner.eraseHistoricalVersions([
    { subject: original.id, revision: original.revision },
  ]);
  expect(result.group.erasures).toHaveLength(2); // Link and source version that inlined it.
  expect(f.owner.readRetainedVersion(original.id, original.revision)).toMatchObject({
    kind: "erased",
    lineage: { id: original.id, type: link, revision: original.revision },
  });
  const events = f.owner.readEvents(`${scope}events/`);
  expect(events.kind).toBe("page");
  if (events.kind === "page") {
    expect(events.page.events.filter((event) => event.type === "linked")).toHaveLength(2);
    expect(
      events.page.events.some((event) => event.subject === original.id && event.type === "created"),
    ).toBe(false);
  }
  expect(f.inspectRaw()).not.toContain("old-link-private");
});
it("withholds endpoint graph facts only after every Link version is erased and preserves its deleted fact and old cursor", () => {
  const link = `${scope}types/link`,
    linkTypes = [
      ...types,
      parseTypeDescriptor({
        id: link,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ];
  const f = fixture(undefined, linkTypes);
  f.create("a", "safe-a");
  f.create("b", "safe-b");
  const created = f.execute([
    {
      operation: "createLink",
      id: "links/l",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { secret: "gone-link" },
      metadata: {},
    },
  ]);
  const original = postimage(created.receipt),
    before = f.owner.readEvents(`${scope}beads/b?view=events`);
  if (before.kind !== "page") throw new Error("expected endpoint Events");
  const cursor = before.page.events.find((event) => event.type === "linked")!.id;
  f.execute([{ operation: "deleteLink", link: "links/l" }]);
  f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
  const events = f.owner.readEvents(`${scope}events/`);
  if (events.kind !== "page") throw new Error("expected Scope Events");
  expect(
    events.page.events.filter((event) => event.subject === original.id).map((event) => event.type),
  ).toEqual(["deleted"]);
  expect(() => f.owner.readEvents(`${scope}beads/b?view=events`, cursor)).not.toThrow();
  expect(f.inspectRaw()).not.toContain("gone-link");
});
it.each(["before-erasure-commit", "after-erasure-commit"] as const)(
  "recovers an abrupt %s crash without a partial purge or ledger",
  (stage) => {
    const f = fixture(),
      prior = oldVersion(f);
    const child = f.crashErase(prior.original.id, prior.original.revision, stage);
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(79);
    expect(JSON.parse(child.stdout)).toEqual({ stage, abruptExit: 79 });
    if (stage === "before-erasure-commit") {
      expect(f.owner.erasureLedger()).toEqual([]);
      expect(f.owner.readRetainedVersion(prior.original.id, prior.original.revision).kind).toBe(
        "retained",
      );
      expect(f.owner.inspect().position).toBe("2");
    } else {
      expect(f.owner.erasureLedger()).toHaveLength(1);
      expect(f.owner.readRetainedVersion(prior.original.id, prior.original.revision).kind).toBe(
        "erased",
      );
      expect(f.owner.inspect().position).toBe("3");
      expect(f.inspectRaw()).not.toContain("private-original");
      expect(f.owner.admit("p", prior.receipt.idempotencyKey, prior.request).kind).toBe("existing");
    }
  },
);
it("expires erased creation detail into the original allocation without forgetting its erasure obligation", () => {
  let now = 1000;
  const f = fixture(undefined, types, () => now),
    prior = oldVersion(f);
  f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  now += 86400001;
  f.owner.maintain();
  expect(f.owner.receipt("p", prior.receipt.id)).toMatchObject({
    detail: "expired",
    allocated: [{ operationIndex: 0, id: prior.original.id, type: prior.original.type }],
  });
  expect(f.owner.erasureLedger()).toHaveLength(1);
  expect(f.inspectRaw()).not.toContain("private-original");
});
it("invalidates an issued Snapshot continuation before old copied bytes can be served", () => {
  const f = fixture();
  for (let index = 0; index < 33; index++)
    f.create(`a${String(index).padStart(2, "0")}`, `original-${index}`);
  const snapshot = f.owner.captureSnapshot().manifest;
  const original = snapshot.beads.items[0]!;
  const next = new URL(snapshot.beads.next!);
  expect(
    f.owner.readSnapshotPage(
      next.searchParams.get("snapshot")!,
      "bead",
      next.searchParams.get("page")!,
    ).page.items,
  ).toHaveLength(1);
  f.update("a00");
  f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
  expect(() =>
    f.owner.readSnapshotPage(
      next.searchParams.get("snapshot")!,
      "bead",
      next.searchParams.get("page")!,
    ),
  ).toThrow("cursor-expired");
  expect(f.inspectRaw()).not.toContain('original-0"');
});
it("preserves alias-pinned cross-carrier equality after repoint/erasure while commitments disclose no old endpoint association", () => {
  const linkType = `${scope}types/link`,
    linkTypes = [
      ...types,
      parseTypeDescriptor({
        id: linkType,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ];
  const f = fixture(undefined, linkTypes);
  f.create("a", "safe-a");
  f.create("b", "safe-b");
  f.create("c", "safe-c");
  f.singleton("putAlias", { alias: "alias/work", target: "beads/a" });
  const input = {
    id: "links/l",
    type: linkType,
    source: "alias/work",
    target: "beads/b",
    properties: { marker: "old-link-private" },
  };
  const created = f.singleton("createLink", input, "link"),
    original = postimage(created.receipt);
  f.singleton("putAlias", { alias: "alias/work", target: "beads/c" });
  const direct = prepareTransaction(
    scope,
    JSON.stringify({
      operations: [{ operation: "createLink", ...input, source: `${scope}beads/a` }],
    }),
  );
  expect(f.owner.admit("p", "link", direct).kind).toBe("existing");
  expect(f.owner.admit("p", "link", created.request).kind).toBe("existing");
  const conflict = prepareTransactionSingleton(
    scope,
    "createLink",
    JSON.stringify({ ...input, source: "beads/c" }),
  );
  expect(f.owner.admit("p", "link", conflict).kind).toBe("conflict");
  const committedA = createHash("sha256")
    .update("transaction-reference-leaf-sha256-1\0")
    .update(JSON.stringify(["ru-semantic-value-1", ["string", `${scope}beads/a`]]))
    .digest("hex");
  const fakeMarker = prepareTransactionSingleton(
    scope,
    "createLink",
    JSON.stringify({ ...input, source: `beads/committed-${committedA}` }),
  );
  expect(f.owner.admit("p", "link", fakeMarker).kind).toBe("conflict");
  f.execute([{ operation: "deleteLink", link: "links/l" }]);
  f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
  expect(f.owner.admit("p", "link", created.request).kind).toBe("existing");
  expect(f.owner.admit("p", "link", direct).kind).toBe("existing");
  f.editClosed((db) => {
    const row = db.prepare("SELECT * FROM receipts WHERE key='link'").get()!;
    const retained = JSON.stringify(row);
    expect(retained).not.toContain("old-link-private");
    expect(retained).not.toContain(`${scope}beads/a`);
    expect(retained).not.toContain(`${scope}beads/b`);
    expect(retained).not.toContain("alias/work");
    expect(JSON.parse(String(row.witnesses)).format).toBe("transaction-alias-witnesses-sha256-1");
    expect(JSON.parse(String(row.receipt)).results[0].outcome).toBe("erased");
  });
  expect(f.owner.admit("p", "link", direct).kind).toBe("existing");
});
it("closes a lagging backpressured publication without draining queued pre-erasure frames", async () => {
  const f = fixture(),
    prior = oldVersion(f),
    observed = context(f);
  const lease = f.owner.acquireChangePublication(observed, "genesis");
  const first = f.owner.readChanges("genesis");
  if (first.kind !== "page") throw new Error("expected first group");
  const accepted = Promise.withResolvers<void>(),
    frames: string[] = [];
  class Sink extends EventEmitter {
    readonly destroyed = false;
    write(frame: string): boolean {
      frames.push(frame);
      accepted.resolve();
      return false;
    }
  }
  const pumping = pumpTransactionChanges(
    new Sink(),
    first.page,
    async (after) => {
      const next = f.owner.readChanges(after, undefined, undefined, lease);
      if (next.kind !== "page") throw new Error("expected group");
      return next.page;
    },
    lease.signal,
    { pollMilliseconds: 5, heartbeatMilliseconds: 1000 },
    (group, write) => lease.publish(group.checkpoint, write),
  );
  const failed = expect(pumping).rejects.toThrow("pre-erasure stream is behind");
  await accepted.promise;
  f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  await failed;
  expect(lease.signal.aborted).toBe(true);
  expect(frames).toHaveLength(1); // Already handed off before P; never the queued pos-2 frame.
  expect(frames[0]).toContain('"position":"pos-1"');
  lease.release();
});
it("purges despite a non-JCS retained value, returning its digest anomaly only out of band", () => {
  const f = fixture(),
    prior = oldVersion(f);
  f.editClosed((db) =>
    db
      .prepare("UPDATE retained_versions SET body=? WHERE subject=? AND revision=?")
      .run(
        JSON.stringify(prior.original).replace('"private-original"', "1e400"),
        prior.original.id,
        prior.original.revision,
      ),
  );
  const result = f.owner.eraseHistoricalVersions([
    { subject: prior.original.id, revision: prior.original.revision },
  ]);
  expect(result.digestAnomalies).toEqual([
    {
      subject: prior.original.id,
      revision: prior.original.revision,
      message: "non-JSON retained version",
    },
  ]);
  expect(result.group).not.toHaveProperty("digestAnomalies");
  expect(result.group.events).toEqual([]);
  expect(f.owner.readRetainedVersion(prior.original.id, prior.original.revision).kind).toBe(
    "erased",
  );
  expect(f.inspectRaw()).not.toContain("private-original");
});
it("does not add a native stringify depth cutoff to normalized fingerprint admission", () => {
  const f = fixture();
  const document = (leaf: string) =>
    `{"operations":[{"operation":"createBead","id":"beads/deep","type":${JSON.stringify(type)},"properties":{"nested":${"[".repeat(6000)}${JSON.stringify(leaf)}${"]".repeat(6000)}}}]}`;
  const request = prepareTransaction(scope, document("leaf"));
  const admitted = f.owner.admit("p", "deep", request);
  expect(admitted.kind).toBe("owned");
  expect(f.owner.admit("p", "deep", prepareTransaction(scope, document("leaf"))).kind).toBe(
    "existing",
  );
  expect(f.owner.admit("p", "deep", prepareTransaction(scope, document("other"))).kind).toBe(
    "conflict",
  );
  if (admitted.kind === "owned") {
    expect(f.owner.retract(admitted.claim)).toBe(true);
    expect(f.owner.retract(admitted.claim)).toBe(false);
  }
});
it("cancels an idle stream that falls behind two consecutive erasure publications", async () => {
  const f = fixture(),
    first = oldVersion(f),
    second = f.create("b");
  f.update("b");
  const originalB = postimage(second.receipt),
    checkpoint = f.owner.captureChangesStart();
  const lease = f.owner.acquireChangePublication(context(f), checkpoint);
  const empty = f.owner.readChanges(checkpoint);
  if (empty.kind !== "page") throw new Error("expected caught-up page");
  const frames: string[] = [];
  class Sink extends EventEmitter {
    readonly destroyed = false;
    write(frame: string) {
      frames.push(frame);
      return true;
    }
  }
  const pumping = pumpTransactionChanges(
    new Sink(),
    empty.page,
    async (after) => {
      const next = f.owner.readChanges(after, undefined, undefined, lease);
      if (next.kind !== "page") throw new Error("expected next page");
      return next.page;
    },
    lease.signal,
    { pollMilliseconds: 100, heartbeatMilliseconds: 1000 },
    (group, write) => lease.publish(group.checkpoint, write),
  );
  const failure = expect(pumping).rejects.toMatchObject({ name: "AbortError" });
  f.owner.eraseHistoricalVersions([
    { subject: first.original.id, revision: first.original.revision },
  ]);
  expect(lease.signal.aborted).toBe(false);
  f.owner.eraseHistoricalVersions([{ subject: originalB.id, revision: originalB.revision }]);
  expect(lease.signal.aborted).toBe(true);
  await failure;
  expect(frames).toEqual([]);
  lease.release();
});
it.each(["properties", "metadata"] as const)(
  "withholds successor %s remove/replace Events carrying erased predecessor content without deleting the successor",
  (field) => {
    const f = fixture(),
      secret = `old-${field}-secret`;
    const created = f.execute([
      {
        operation: "createBead",
        id: "beads/a",
        type,
        properties: {},
        metadata: {},
        [field]: { [secret]: true, safe: "before" },
      },
    ]);
    const original = postimage(created.receipt);
    const updated = f.execute([
      {
        operation: "updateBead",
        bead: "beads/a",
        [`${field}Change`]: [
          { op: "remove", path: `/${secret}` },
          { op: "replace", path: "/safe", value: "healthy" },
        ],
      },
    ]);
    const successor = postimage(updated.receipt),
      priorEvents = f.owner.readEvents(`${scope}events/`);
    if (priorEvents.kind !== "page") throw new Error("expected original Event page");
    expect(JSON.stringify(priorEvents.page.events)).toContain(secret);
    const oldCursor = priorEvents.page.events.find((event) => event.type === "updated")!.id;
    f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
    expect(f.owner.readRetainedVersion(successor.id, successor.revision)).toMatchObject({
      kind: "retained",
      resource: successor,
    });
    expect(f.owner.receipt("p", updated.receipt.id)).toMatchObject({
      results: [{ resource: successor }],
    });
    const after = f.owner.readEvents(`${scope}events/`, oldCursor);
    if (after.kind !== "page") throw new Error("expected exclusive old cursor");
    expect(after.page.events).toEqual([]);
    const fresh = f.owner.readEvents(`${scope}events/`);
    if (fresh.kind !== "page") throw new Error("expected fresh Event page");
    expect(fresh.page.events).toEqual([]);
    expect(f.inspectRaw()).not.toContain(secret);
    f.editClosed((db) => {
      const groups = db
        .prepare("SELECT body FROM groups ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(String(row.body)));
      expect(groups.map((group) => group.eventCount)).toEqual([0, 0, 0]);
      expect(groups.map((group) => group.originalEventCount)).toEqual([1, 1, undefined]);
    });
  },
);
it("keeps complete root replacements and their original ordinal after an earlier Event is erased", () => {
  const f = fixture(),
    created = f.create(),
    original = postimage(created.receipt);
  const updated = f.execute([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "", value: { secret: "healthy" } }],
      metadataChange: [{ op: "replace", path: "", value: { safe: true } }],
    },
  ]);
  const before = f.owner.readEvents(`${scope}events/`);
  if (before.kind !== "page") throw new Error("expected original Event page");
  const createdCursor = before.page.events[0]!.id,
    originalUpdate = before.page.events[1]!;
  f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
  const after = f.owner.readEvents(`${scope}events/`, createdCursor);
  if (after.kind !== "page") throw new Error("expected exclusive old cursor");
  expect(after.page.events).toEqual([originalUpdate]);
  expect(f.owner.receipt("p", updated.receipt.id)).toMatchObject({
    results: [{ resource: postimage(updated.receipt) }],
  });
  expect(f.inspectRaw()).not.toContain("private-original");
});
it.each(["properties", "metadata"] as const)(
  "purges predecessor-dependent owned-Link %s Events but retains healthy Link and source versions",
  (field) => {
    const link = `${scope}types/link`,
      secret = `old-owned-${field}-secret`;
    const ownedTypes = [
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
    ];
    const f = fixture(undefined, ownedTypes);
    f.create("a", "safe-a");
    f.create("b", "safe-b");
    const created = f.execute([
      {
        operation: "createLink",
        id: "links/l",
        type: link,
        source: "beads/a",
        target: "beads/b",
        properties: {},
        metadata: {},
        [field]: { [secret]: true, safe: "before" },
      },
    ]);
    const original = postimage(created.receipt);
    const updated = f.execute([
      {
        operation: "updateLink",
        link: "links/l",
        [`${field}Change`]: [
          { op: "remove", path: `/${secret}` },
          { op: "replace", path: "/safe", value: "healthy-link" },
        ],
      },
    ]);
    const successor = postimage(updated.receipt),
      before = f.owner.readEvents(`${scope}events/`);
    if (before.kind !== "page") throw new Error("expected Event page");
    const nested = before.page.events.find(
      (event) => event.type === "updated" && event.subject === `${scope}beads/a`,
    )!;
    expect(JSON.stringify(nested)).toContain(secret);
    const result = f.owner.eraseHistoricalVersions([
      { subject: original.id, revision: original.revision },
    ]);
    expect(result.group.erasures).toHaveLength(2);
    expect(f.owner.readRetainedVersion(successor.id, successor.revision)).toMatchObject({
      kind: "retained",
      resource: successor,
    });
    const after = f.owner.readEvents(`${scope}events/`, nested.id);
    if (after.kind !== "page") throw new Error("expected exclusive old cursor");
    expect(after.page.events).toEqual([]);
    const fresh = f.owner.readEvents(`${scope}events/`);
    if (fresh.kind !== "page") throw new Error("expected Event page");
    expect(fresh.page.events.filter((event) => event.type === "linked")).toHaveLength(2);
    expect(fresh.page.events.filter((event) => event.type === "updated")).toEqual([]);
    expect(f.inspectRaw()).not.toContain(secret);
  },
);
it("preserves identity-only owned deletion Events and ordinal gaps after all old inline content is erased", () => {
  const link = `${scope}types/link`;
  const ownedTypes = [
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
  ];
  const f = fixture(undefined, ownedTypes);
  f.create("a", "safe-a");
  f.create("b", "safe-b");
  const created = f.execute([
    {
      operation: "createLink",
      id: "links/l",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { secret: "owned-deleted-secret" },
      metadata: {},
    },
  ]);
  const original = postimage(created.receipt);
  f.execute([{ operation: "deleteLink", link: "links/l" }]);
  const before = f.owner.readEvents(`${scope}events/`);
  if (before.kind !== "page") throw new Error("expected Event page");
  const nested = before.page.events.find(
    (event) =>
      event.type === "updated" &&
      (event.data as { ownedLink?: { operation: string } }).ownedLink?.operation === "deleted",
  )!;
  const deleted = before.page.events.find((event) => event.type === "deleted")!;
  f.owner.eraseHistoricalVersions([{ subject: original.id, revision: original.revision }]);
  const after = f.owner.readEvents(`${scope}events/`);
  if (after.kind !== "page") throw new Error("expected Event page");
  expect(after.page.events).toContainEqual(nested);
  expect(after.page.events).toContainEqual(deleted);
  expect(
    after.page.events.filter((event) => event.type === "linked" || event.type === "unlinked"),
  ).toEqual([]);
  const exclusive = f.owner.readEvents(`${scope}events/`, nested.id);
  if (exclusive.kind !== "page") throw new Error("expected exclusive old cursor");
  expect(exclusive.page.events).not.toContainEqual(nested);
  expect(f.inspectRaw()).not.toContain("owned-deleted-secret");
});
it("migrates legacy plaintext alias witnesses without re-resolving the repointed alias", () => {
  const f = fixture();
  f.create("a", "safe-a");
  f.create("b", "safe-b");
  f.singleton("putAlias", { alias: "alias/work", target: "beads/a" });
  const changed = f.singleton(
    "updateBead",
    {
      bead: "alias/work",
      propertiesChange: [{ op: "replace", path: "/secret", value: "healthy" }],
    },
    "legacy-alias",
  );
  const legacy = normalizeTransaction(changed.request, () => `${scope}beads/a`);
  f.singleton("putAlias", { alias: "alias/work", target: "beads/b" });
  f.editClosed((db) => {
    const configuration = JSON.parse(
      String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()!.value),
    );
    configuration.format = "bdp-private-transaction-snapshot-11";
    db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
      JSON.stringify(configuration),
    );
    db.prepare("DELETE FROM metadata WHERE name='requestFingerprintPolicy'").run();
    // Reconstruct every old row's genuine normalized storage, not a mixture
    // of new commitments and old plaintext under a legacy format marker.
    const requests = [
      [
        "k0",
        prepareTransaction(
          scope,
          JSON.stringify({
            operations: [
              {
                operation: "createBead",
                id: "beads/a",
                type,
                properties: { secret: "safe-a" },
                metadata: {},
              },
            ],
          }),
        ),
      ],
      [
        "k1",
        prepareTransaction(
          scope,
          JSON.stringify({
            operations: [
              {
                operation: "createBead",
                id: "beads/b",
                type,
                properties: { secret: "safe-b" },
                metadata: {},
              },
            ],
          }),
        ),
      ],
      [
        "single2",
        prepareTransactionSingleton(
          scope,
          "putAlias",
          JSON.stringify({ alias: "alias/work", target: "beads/a" }),
        ),
      ],
      ["legacy-alias", changed.request],
      [
        "single3",
        prepareTransactionSingleton(
          scope,
          "putAlias",
          JSON.stringify({ alias: "alias/work", target: "beads/b" }),
        ),
      ],
    ] as const;
    for (const [key, request] of requests) {
      const normalized =
        key === "legacy-alias" ? legacy : normalizeTransaction(request, () => undefined);
      expect(
        db
          .prepare("UPDATE receipts SET identity=?,witnesses=? WHERE key=?")
          .run(normalized.identity, normalized.witnessesJson, key).changes,
      ).toBe(1);
    }
  });
  expect(f.owner.admit("p", "legacy-alias", changed.request).kind).toBe("existing");
  expect(
    f.owner.admit(
      "p",
      "legacy-alias",
      prepareTransaction(
        scope,
        JSON.stringify({
          operations: [
            {
              operation: "updateBead",
              bead: "beads/a",
              propertiesChange: [{ op: "replace", path: "/secret", value: "healthy" }],
            },
          ],
        }),
      ),
    ).kind,
  ).toBe("existing");
  expect(
    f.owner.admit(
      "p",
      "legacy-alias",
      prepareTransactionSingleton(
        scope,
        "updateBead",
        JSON.stringify({
          bead: "beads/b",
          propertiesChange: [{ op: "replace", path: "/secret", value: "healthy" }],
        }),
      ),
    ).kind,
  ).toBe("conflict");
  f.editClosed((db) => {
    const row = db
      .prepare("SELECT identity,witnesses FROM receipts WHERE key='legacy-alias'")
      .get()!;
    expect(JSON.parse(String(row.witnesses)).format).toBe("transaction-alias-witnesses-sha256-1");
    expect(JSON.stringify(row)).not.toContain("alias/work");
    expect(JSON.stringify(row)).not.toContain(`${scope}beads/a`);
  });
});
