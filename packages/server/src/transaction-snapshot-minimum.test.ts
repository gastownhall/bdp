/** New settled matching-context S1 behavior, through actual owner and public HTTP. */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { prepareTransactionSetCore } from "./transaction-batch.js";
import {
  TransactionMinimumFailure,
  TransactionMinimumUnsupported,
} from "./transaction-consistency.js";
import { startTransactionRuntime } from "./transaction-runtime.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS,
  type TransactionSnapshotManifest,
  type TransactionSnapshotRequest,
} from "./transaction-snapshot.js";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://s1.example/acme/",
  type = `${scope}types/bead`;
const types = [parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] })];
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n: 1 },
});
function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("required S1 value missing");
  return value;
}
function requests(manifest: TransactionSnapshotManifest): TransactionSnapshotRequest[] {
  const id = requireValue(new URL(manifest.id).searchParams.get("snapshot"));
  const page = new URL(requireValue(manifest.beads.next));
  return [
    { kind: "manifest", id },
    { kind: "page", id, stream: "bead", token: requireValue(page.searchParams.get("page")) },
  ];
}
function ownerFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-s1-owner-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000,
    serial = 0;
  const file = path.join(directory, "store.sqlite");
  const options = {
    file,
    scope,
    types,
    create: true,
    clock: () => now,
    maintenanceIntervalMs: 2147483647,
  };
  let owner = openTransactionStore(options);
  cleanups.push(() => owner.close());
  const write = (operations: unknown[]) => {
    const admitted = owner.admit(
      "writer",
      `s1-${serial++}`,
      prepareTransactionSetCore(scope, JSON.stringify({ operations })),
    );
    if (admitted.kind !== "owned") throw new Error("S1 admission refused");
    expect(owner.execute(admitted.claim).status).toBe("completed");
  };
  for (let i = 0; i < 10; i++)
    write(
      i === 0
        ? Array.from({ length: 32 }, (_, j) => create(`initial-${j}`))
        : [create(`initial-${i + 31}`)],
    );
  const captured = owner.observeSnapshot({ kind: "create" });
  if (captured.kind !== "manifest") throw new Error("S1 capture missing");
  for (let i = 0; i < 5; i++) write([create(`later-${i}`)]);
  const minimum = (minimumPosition: string) => ({
    scopeEpoch: captured.context.scopeEpoch,
    authorizationView: captured.context.authorizationView,
    minimumPosition,
  });
  const state = () => {
    owner.close();
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return {
        snapshots: db.prepare("SELECT * FROM snapshots ORDER BY id").all(),
        records: db.prepare("SELECT * FROM snapshot_records ORDER BY snapshot,kind,ordinal").all(),
        pages: db.prepare("SELECT * FROM snapshot_pages ORDER BY snapshot,kind,ordinal").all(),
      };
    } finally {
      db.close();
      owner = openTransactionStore({ ...options, create: false });
    }
  };
  return {
    get owner() {
      return owner;
    },
    captured,
    minimum,
    state,
    setTime: (value: number) => {
      now = value;
    },
  };
}

it("S1 owner compares manifest and continuation to savedpos10, not livepos15, without changing retention", () => {
  const f = ownerFixture(),
    before = f.state();
  expect(f.captured.body.scopePosition).toBe("pos-10");
  expect(f.owner.withRead((_r, context) => context)).toMatchObject({
    kind: "read",
    value: { scopePosition: "pos-15" },
  });
  for (const request of requests(f.captured.body)) {
    for (const position of ["genesis", "pos-0", "pos-10"])
      expect(f.owner.observeSnapshot(request, f.minimum(position)).kind).toBe(request.kind);
    expect(f.owner.observeSnapshot(request, f.minimum("pos-15"))).toMatchObject({
      kind: "problem",
      code: "snapshot-position-too-old",
    });
  }
  expect(
    f.owner.observeSnapshot(
      requests(f.captured.body)[0] as TransactionSnapshotRequest,
      f.minimum("pos-10"),
    ),
  ).toMatchObject({ body: f.captured.body });
  expect(f.state()).toEqual(before);
});

it("S1 service makes one retained observation and no clock/wait call, with expiry before minimum", async () => {
  const f = ownerFixture();
  let clockCalls = 0,
    waits = 0,
    cursor = 0;
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
      clock: () => 1000000,
      generateOpaqueToken: () => `s1_${++cursor}`,
    },
  };
  let observations = 0;
  const observeSnapshot = f.owner.observeSnapshot;
  const service = createTransactionService(
    {
      ...f.owner,
      observeSnapshot(...args) {
        observations++;
        return observeSnapshot(...args);
      },
    },
    {
      ownerLifetime: "service",
      read,
      minimumReads: {
        budgetMs: 1,
        now: () => {
          clockCalls++;
          return 0;
        },
        wait: async () => {
          waits++;
          throw new Error("retained Snapshot must not wait");
        },
      },
    },
  );
  cleanups.push(() => service.close());
  for (const request of requests(f.captured.body)) {
    expect(await service.snapshot(request, f.minimum("pos-15"))).toMatchObject({
      kind: "problem",
      code: "snapshot-position-too-old",
    });
    expect(await service.snapshot(request, f.minimum("pos-10"))).toMatchObject({
      kind: request.kind,
    });
  }
  f.setTime(1000000 + TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs + 1);
  for (const request of requests(f.captured.body))
    expect(await service.snapshot(request, f.minimum("pos-15"))).toMatchObject({
      kind: "problem",
      code: "cursor-expired",
    });
  expect({ observations, clockCalls, waits }).toEqual({ observations: 6, clockCalls: 0, waits: 0 });
});

it("S1 preserves unknown identity404 under satisfied actual minima and fences foreign contexts", () => {
  const f = ownerFixture();
  for (const expired of [false, true]) {
    if (expired) f.setTime(1000000 + TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs + 1);
    for (const request of requests(f.captured.body)) {
      for (const changed of [{ scopeEpoch: "foreign" }, { authorizationView: "foreign" }]) {
        const observe = () =>
          f.owner.observeSnapshot(request, { ...f.minimum("pos-15"), ...changed });
        if (expired) expect(observe).toThrow(TransactionMinimumUnsupported);
        else {
          expect(observe).toThrow(TransactionMinimumFailure);
          expect(observe).toThrow("scopeEpoch" in changed ? "cursor-expired" : "foreign-view");
        }
      }
    }
    for (const request of [
      { kind: "manifest", id: "unknown" },
      {
        kind: "page",
        id: requireValue(new URL(f.captured.body.id).searchParams.get("snapshot")),
        stream: "bead",
        token: "unknown",
      },
    ] as const)
      expect(f.owner.observeSnapshot(request, f.minimum("pos-15"))).toMatchObject({
        kind: "problem",
        code: "resource-not-found",
        context: {
          scopeEpoch: f.captured.context.scopeEpoch,
          authorizationView: f.captured.context.authorizationView,
          scopePosition: "pos-15",
        },
      });
  }
});

it("S1 public HTTP GET/HEAD uses saved position immediately and preserves expiry before conditionals", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-s1-http-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000,
    waits = 0;
  const token = randomBytes(32).toString("base64url");
  const runtime = await startTransactionRuntime(
    {
      directory,
      create: true,
      port: 0,
      scope,
      authorityMode: "listener",
      types,
      credentials: [{ token, principal: "writer", canMutate: true }],
    },
    {
      clock: () => now,
      maintenanceIntervalMs: 2147483647,
      minimumReads: {
        wait: async () => {
          waits++;
          throw new Error("retained Snapshot must not wait");
        },
      },
    },
  );
  cleanups.push(() => runtime.close());
  const rows: { method: string; path: string; status: number }[] = [];
  const exchange = async (url: string, init: RequestInit = {}) => {
    const target = new URL(url),
      dial = new URL(target.pathname + target.search, runtime.listenUrl);
    const response = await fetch(dial, {
      ...init,
      signal: AbortSignal.timeout(3000),
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });
    rows.push({
      method: init.method ?? "GET",
      path: target.pathname + target.search,
      status: response.status,
    });
    return response;
  };
  for (let i = 0; i < 10; i++) {
    const response = await exchange(runtime.targets.batch, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `http-before-${i}` },
      body: JSON.stringify({
        operations:
          i === 0
            ? Array.from({ length: 32 }, (_, j) => create(`initial-${j}`))
            : [create(`initial-${i + 31}`)],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed" });
  }
  const captured = await exchange(`${scope}snapshot`);
  expect(captured.status).toBe(200);
  const manifest = (await captured.json()) as TransactionSnapshotManifest;
  expect(manifest.scopePosition).toBe("pos-10");
  for (let i = 0; i < 5; i++) {
    const response = await exchange(runtime.targets.batch, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `http-after-${i}` },
      body: JSON.stringify({ operations: [create(`later-${i}`)] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed" });
  }
  const tuple = (minimum: string) => ({
    "bdp-scope-epoch": manifest.scopeEpoch,
    "bdp-authorization-view": manifest.authorizationView,
    "bdp-minimum-scope-position": minimum,
  });
  for (const url of [manifest.id, requireValue(manifest.beads.next)]) {
    for (const method of ["GET", "HEAD"]) {
      const eligible = await exchange(url, { method, headers: tuple("pos-10") });
      expect(eligible.status).toBe(200);
      if (method === "HEAD") expect(await eligible.text()).toBe("");
      else {
        const value = await eligible.json();
        if (url === manifest.id) expect(value).toEqual(manifest);
      }
      const tooOld = await exchange(url, {
        method,
        headers: { ...tuple("pos-15"), "if-none-match": "*" },
      });
      expect(tooOld.status).toBe(409);
      expect(tooOld.headers.get("content-type")).toBe("application/problem+json");
      if (method === "GET")
        expect(await tooOld.json()).toMatchObject({
          type: "https://github.com/gastownhall/bdp/problems/conflict",
          code: "snapshot-position-too-old",
          status: 409,
          retry: "after-state-change",
        });
      else expect(await tooOld.text()).toBe("");
    }
  }
  const unchanged = await exchange(manifest.id);
  expect(await unchanged.json()).toEqual(manifest);
  now += TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs + 1;
  for (const url of [manifest.id, requireValue(manifest.beads.next)]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await exchange(url, {
        method,
        headers: { ...tuple("pos-15"), "if-none-match": "*" },
      });
      expect(response.status).toBe(410);
      if (method === "GET")
        expect(await response.json()).toMatchObject({ code: "cursor-expired", status: 410 });
      else expect(await response.text()).toBe("");
    }
  }
  expect(waits).toBe(0);
  console.log(
    JSON.stringify({
      observation: "S1-public-HTTP",
      savedPosition: manifest.scopePosition,
      expiry: manifest.expiresAt,
      rows,
      waits,
      profileQualified: false,
    }),
  );
}, 15000);

it("S1 public HTTP preserves unselected collisions and expired matching unorderable minimum410", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-s1-held-http-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000;
  const token = randomBytes(32).toString("base64url");
  const runtime = await startTransactionRuntime(
    {
      directory,
      create: true,
      port: 0,
      scope,
      authorityMode: "listener",
      types,
      credentials: [{ token, principal: "writer", canMutate: true }],
    },
    { clock: () => now, maintenanceIntervalMs: 2147483647 },
  );
  cleanups.push(() => runtime.close());
  const get = (url: string, method = "GET", headers: Record<string, string> = {}) => {
    const target = new URL(url),
      dial = new URL(target.pathname + target.search, runtime.listenUrl);
    return fetch(dial, {
      method,
      signal: AbortSignal.timeout(3000),
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
  };
  const capture = await get(`${scope}snapshot`);
  expect(capture.status).toBe(200);
  const manifest = (await capture.json()) as TransactionSnapshotManifest;
  now += TRANSACTION_SNAPSHOT_LIMITS.lifetimeMs + 1;
  const minimum = {
    "bdp-scope-epoch": manifest.scopeEpoch,
    "bdp-authorization-view": manifest.authorizationView,
    "bdp-minimum-scope-position": "pos-1",
  };
  const unissuedPage = new URL(manifest.id);
  unissuedPage.searchParams.set("stream", "beads");
  unissuedPage.searchParams.set("page", "unknown");
  for (const method of ["GET", "HEAD"]) {
    for (const [target, headers] of [
      [manifest.id, { ...minimum, "bdp-scope-epoch": "foreign" }],
      [manifest.id, { ...minimum, "bdp-authorization-view": "foreign" }],
      [`${scope}snapshot?snapshot=unknown`, minimum],
      [unissuedPage.href, minimum],
    ] as const) {
      const response = await get(target, method, headers);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
      expect(response.headers.get("bdp-scope-position")).toBeNull();
      expect(await response.text()).toBe("");
    }
    const expired = await get(manifest.id, method, {
      ...minimum,
      "bdp-minimum-scope-position": "opaque",
      "if-none-match": "*",
    });
    expect(expired.status).toBe(410);
    expect(expired.headers.get("bdp-scope-epoch")).toBe(manifest.scopeEpoch);
    expect(expired.headers.get("bdp-authorization-view")).toBe(manifest.authorizationView);
    expect(expired.headers.get("bdp-scope-position")).toBe(manifest.scopePosition);
    if (method === "GET")
      expect(await expired.json()).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/gone",
        code: "cursor-expired",
        status: 410,
        retry: "after-state-change",
      });
    else expect(await expired.text()).toBe("");
  }
}, 10000);
