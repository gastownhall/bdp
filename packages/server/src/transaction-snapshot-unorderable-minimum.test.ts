/** NEW settled known/unexpired matching-context retained minimum domain. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { prepareTransactionSetCore } from "./transaction-batch.js";
import { TransactionMinimumUnproved } from "./transaction-consistency.js";
import { ScopeServerOperationAbortedError } from "./read-request.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS,
  type TransactionSnapshotRequest,
} from "./transaction-snapshot.js";
import { openTransactionStore } from "./transaction-store.js";
const scope = "https://retained-minimum.example/acme/",
  type = scope + "types/bead";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const close of cleanups.splice(0).reverse())
    try {
      await close();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors, "retained minimum cleanup");
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-unorderable-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000,
    serial = 0;
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    create: true,
    types: [parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] })],
    clock: () => now,
    maintenanceIntervalMs: 2147483647,
  };
  let owner = openTransactionStore(options);
  cleanups.push(() => owner.close());
  const create = (id: string) => ({
    operation: "createBead",
    id: "beads/" + id,
    type,
    properties: { n: 1 },
  });
  const write = (operations: unknown[]) => {
    const a = owner.admit(
      "writer",
      "unorderable-" + serial++,
      prepareTransactionSetCore(scope, JSON.stringify({ operations })),
    );
    if (a.kind !== "owned") throw Error("new unit admission refused");
    expect(owner.execute(a.claim).status).toBe("completed");
  };
  write(Array.from({ length: 32 }, (_, i) => create(String(i).padStart(2, "0"))));
  write([create("32")]);
  const captured = owner.observeSnapshot({ kind: "create" });
  if (captured.kind !== "manifest" || !captured.body.beads.next)
    throw Error("real captured continuation required");
  const id = new URL(captured.body.id).searchParams.get("snapshot")!;
  const token = new URL(captured.body.beads.next).searchParams.get("page")!;
  const requests: Record<"manifest" | "page", TransactionSnapshotRequest> = {
    manifest: { kind: "manifest", id },
    page: { kind: "page", id, stream: "bead", token },
  };
  let cursor = 0;
  const read: TransactionServiceOptions["read"] = {
    selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
    advertisedLimits: {
      page: { defaultItems: 2, maximumItems: 32 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 1000,
    },
    pagination: {
      scope,
      defaultPageItems: 2,
      maxPageItems: 32,
      cursorTtlMs: 1000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 20,
      retainedSnapshotByteCapacity: 100000,
      retainedSnapshotNodeCapacity: 10000,
      maxOpaqueTokenLength: 64,
      tokenGenerationAttempts: 3,
      idleCleanup: "on-demand",
      clock: () => now,
      generateOpaqueToken: () => "retained_" + ++cursor,
    },
  };
  return {
    get owner() {
      return owner;
    },
    captured,
    requests,
    read,
    minimum: (minimumPosition = "opaque") => ({
      scopeEpoch: captured.context.scopeEpoch,
      authorizationView: captured.context.authorizationView,
      minimumPosition,
    }),
    later: () => write([create("later")]),
    expire: () => {
      now = 1000000 + TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs + 1;
    },
    state: () => {
      owner.close();
      const db = new DatabaseSync(options.file, { readOnly: true });
      try {
        return {
          snapshots: db.prepare("SELECT * FROM snapshots ORDER BY id").all(),
          records: db
            .prepare("SELECT * FROM snapshot_records ORDER BY snapshot,kind,ordinal")
            .all(),
          pages: db.prepare("SELECT * FROM snapshot_pages ORDER BY snapshot,kind,ordinal").all(),
        };
      } finally {
        db.close();
        owner = openTransactionStore({ ...options, create: false });
      }
    },
  };
}
it.each(["manifest", "page"] as const)(
  "NEW retained unorderable owner %s preserves saved identity and expiry",
  (kind) => {
    const f = fixture(),
      before = f.state();
    for (const token of ["opaque", "pos-01", "xxxx1", "pos-9007199254740992"])
      expect(() => f.owner.observeSnapshot(f.requests[kind], f.minimum(token))).toThrow(
        TransactionMinimumUnproved,
      );
    expect(f.state()).toEqual(before);
    f.later();
    expect(f.owner.observeSnapshot(f.requests[kind], f.minimum("pos-3"))).toMatchObject({
      kind: "problem",
      code: "snapshot-position-too-old",
    });
    f.expire();
    expect(f.owner.observeSnapshot(f.requests[kind], f.minimum())).toMatchObject({
      kind: "problem",
      code: "cursor-expired",
    });
  },
);
it.each(["manifest", "page"] as const)(
  "NEW retained unorderable service %s uses original deadline and current final context",
  async (kind) => {
    const f = fixture(),
      before = f.state(),
      minimum = f.minimum();
    let time = 0,
      waits = 0;
    const service = createTransactionService(f.owner, {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: {
        now: () => time,
        wait: async (ms) => {
          expect(ms).toBe(5);
          waits++;
          f.later();
          Object.assign(minimum, {
            scopeEpoch: "foreign",
            authorizationView: "foreign",
            minimumPosition: "genesis",
          });
          time = 1000;
        },
      },
    });
    cleanups.push(() => service.close());
    expect(await service.snapshot(f.requests[kind], minimum)).toEqual({
      kind: "problem",
      code: "temporarily-unavailable",
      context: {
        scopeEpoch: f.captured.context.scopeEpoch,
        authorizationView: f.captured.context.authorizationView,
        scopePosition: "pos-3",
      },
    });
    expect(waits).toBe(1);
    await service.close();
    expect(f.state()).toEqual(before);
  },
);
it.each(["manifest", "page"] as const)(
  "NEW retained unorderable service %s preserves native cancellation",
  async (kind) => {
    const f = fixture(),
      controller = new AbortController();
    let waits = 0;
    const service = createTransactionService(f.owner, {
      ownerLifetime: "service",
      read: f.read,
      minimumReads: {
        wait: async () => {
          waits++;
          controller.abort();
        },
      },
    });
    cleanups.push(() => service.close());
    await expect(
      service.snapshot(f.requests[kind], f.minimum(), controller.signal),
    ).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
    expect(waits).toBe(1);
  },
);
