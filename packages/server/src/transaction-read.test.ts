import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTypeDescriptor,
  isReadProblem,
  type AbsoluteHttpUrl,
  type ReadRequest,
} from "@bdp/protocol";
import { prepareTransaction, prepareTransactionSingleton } from "./transaction-batch.js";
import { openTransactionStore } from "./transaction-store.js";
import {
  createTransactionReadPlane,
  transactionReadContexts,
  TransactionMinimumVisibilityGap,
} from "./transaction-read.js";
import { createTransactionService } from "./transaction-service.js";
import { createTransactionHttpHandler } from "./transaction-http.js";
import {
  AuthorityReadError,
  type AuthorityReadDeliveryOptions,
  type ReadObservation,
} from "./authority-read.js";
import { requestFromUrl } from "./read-request.js";

const scope = "https://example.test/transaction/";
const bead = "https://example.test/types/bead",
  link = "https://example.test/types/link";
const types = [
  { id: bead, name: "Bead", describes: "bead", conformsTo: [] },
  {
    id: link,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [bead], external: "none" },
    target: { conformsTo: [bead], external: "opaque" },
  },
].map((t) => parseTypeDescriptor(t));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-transaction-read-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    create: true,
    types,
    ...extra,
  };
  let store = openTransactionStore(options);
  cleanup.push(() => store.close());
  let tokens = 0;
  const readOptions = {
    selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
    advertisedLimits: {
      page: { defaultItems: 2, maximumItems: 10 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 1000,
    },
    pagination: {
      scope,
      defaultPageItems: 2,
      maxPageItems: 10,
      cursorTtlMs: 1000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 20,
      retainedSnapshotByteCapacity: 100_000,
      retainedSnapshotNodeCapacity: 10_000,
      maxOpaqueTokenLength: 64,
      tokenGenerationAttempts: 3,
      idleCleanup: "on-demand" as const,
      clock: () => 1000,
      generateOpaqueToken: () => `cursor_${++tokens}`,
    },
  };
  function open(patch: Partial<typeof readOptions> = {}) {
    const plane = createTransactionReadPlane(store, { ...readOptions, ...patch });
    cleanup.push(() => plane.close());
    return { plane, facet: plane.readFor({ kind: "anonymous" }) };
  }
  let keys = 0;
  function write(operations: unknown[]) {
    const admitted = store.admit(
      "principal",
      `key_${++keys}`,
      prepareTransaction(scope, JSON.stringify({ operations })),
    );
    if (admitted.kind !== "owned") throw new Error("expected new admission");
    return store.execute(admitted.claim);
  }
  function alias(operation: "putAlias" | "deleteAlias", body: unknown) {
    const admitted = store.admit(
      "principal",
      `key_${++keys}`,
      prepareTransactionSingleton(scope, operation, JSON.stringify(body)),
    );
    if (admitted.kind !== "owned") throw new Error("expected new admission");
    return store.execute(admitted.claim);
  }
  return {
    get store() {
      return store;
    },
    options,
    readOptions,
    open,
    write,
    alias,
    reopen() {
      store.close();
      store = openTransactionStore({ ...options, create: false });
      return store;
    },
  };
}
const url = (value: string) => `${scope}${value}` as AbsoluteHttpUrl;
const resource = (id: string, kind: "bead" | "link" = "bead"): ReadRequest => ({
  kind: "resource",
  resource: kind,
  id: url(id),
});
function body(result: unknown): Record<string, unknown> {
  expect(result).toMatchObject({ kind: "success" });
  return (result as { body: Record<string, unknown> }).body;
}
function contexts(result: unknown) {
  if (typeof result !== "object" || result === null || !("observation" in result))
    throw new Error("expected observation");
  return transactionReadContexts(result.observation as ReadObservation);
}
function items(result: unknown): Record<string, unknown>[] {
  return body(result).items as Record<string, unknown>[];
}
const seed = [
  { operation: "createBead", id: "beads/a", type: bead, properties: { n: 1 } },
  { operation: "createBead", id: "beads/b", type: bead, properties: { n: 2 } },
  { operation: "createLink", id: "links/self", type: link, source: "beads/a", target: "beads/a" },
];

describe("private same-owner Transactional Read", () => {
  it("uses actual installed configuration and immutable descriptors, without RU key or serving-position claims", async () => {
    const f = fixture(),
      { facet } = f.open();
    const configuration = f.store.readConfiguration();
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.installedTypes)).toBe(true);
    expect(Object.isFrozen(configuration.installedTypes[1]?.conformsTo)).toBe(true);
    expect(() =>
      Object.assign(configuration.installedTypes[0] ?? {}, { name: "Forged" }),
    ).toThrow();
    const discovery = await facet.perform({
      kind: "scope-discovery",
      scope: scope as AbsoluteHttpUrl,
    });
    expect(discovery).toMatchObject({
      kind: "discovery",
      data: { maximumEndpointMultiplicity: [] },
      observation: {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        configurationIdentity: configuration.scopeConfiguration.configurationIdentity,
      },
    });
    expect(discovery).not.toHaveProperty("observation.scopePosition");
    const inventory = items(
      await facet.perform({ kind: "collection", collection: "types", limit: 10 }),
    );
    expect(inventory.map((t) => t.id)).toEqual([bead, link]);
    expect(
      body(
        await facet.perform({ kind: "resource", resource: "type", id: link as AbsoluteHttpUrl }),
      ),
    ).toEqual(types[1]);
    expect(
      f.write([{ operation: "createBead", type: "https://example.test/foreign" }]).status,
    ).toBe("failed");
    expect(items(await facet.perform({ kind: "collection", collection: "beads" }))).toEqual([]);
  });

  it("reads only complete commits, canonical bodies, revisions, incident Links, selectors and properties", async () => {
    const f = fixture(),
      { facet } = f.open();
    expect(items(await facet.perform({ kind: "collection", collection: "beads" }))).toEqual([]);
    const receipt = f.write(seed);
    expect(receipt.status).toBe("completed");
    const a = await facet.perform(resource("beads/a"));
    expect(body(a)).toMatchObject({ id: url("beads/a"), type: bead, properties: { n: 1 } });
    expect(a).toHaveProperty("observation.resourceRevision", body(a).revision);
    expect(
      body(await facet.perform({ kind: "properties", resource: "bead", id: url("beads/a") })),
    ).toEqual({ n: 1 });
    const edge = body(await facet.perform(resource("links/self", "link")));
    expect(edge).toMatchObject({ source: url("beads/a"), target: url("beads/a") });
    expect(items(await facet.perform({ kind: "bead-links", bead: url("beads/a") }))).toEqual([
      edge,
    ]);
    expect(
      items(
        await facet.perform({
          kind: "collection",
          collection: "beads",
          type: bead as AbsoluteHttpUrl,
          selector: "$[?@.properties.n == 2]",
        }),
      ).map((r) => r.id),
    ).toEqual([url("beads/b")]);
    expect(
      f.write([
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/n", value: 9 }],
        },
        { operation: "deleteBead", bead: "beads/missing" },
      ]).status,
    ).toBe("failed");
    expect(body(await facet.perform(resource("beads/a")))).toEqual(body(a));
    expect(
      f.write([
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/n", value: 3 }],
        },
      ]).status,
    ).toBe("completed");
    const changed = await facet.perform(resource("beads/a"));
    expect(body(changed).revision).not.toEqual(body(a).revision);
    expect(changed).toHaveProperty("observation.resourceRevision", body(changed).revision);
    expect(body(changed).properties).toEqual({ n: 3 });
  });

  it("resolves live aliases through the owner across repoint, reopen, dangling target and deletion", async () => {
    const f = fixture();
    f.write(seed);
    const { facet, plane } = f.open();
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
      "completed",
    );
    expect(await facet.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "target",
      target: url("beads/a"),
    });
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/b" }).status).toBe(
      "completed",
    );
    expect(await facet.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "target",
      target: url("beads/b"),
    });
    await plane.close();
    const epoch = f.store.scopeEpoch;
    f.reopen();
    const reopened = f.open().facet;
    expect(f.store.scopeEpoch).toBe(epoch);
    expect(await reopened.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "target",
      target: url("beads/b"),
    });
    expect(f.alias("deleteAlias", { alias: "alias/work" }).status).toBe("completed");
    expect(await reopened.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found" },
    });
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/b" }).status).toBe(
      "completed",
    );
    expect(f.write([{ operation: "deleteBead", bead: "beads/b" }]).status).toBe("completed");
    expect(await reopened.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found" },
    });
  });

  it("retains pagination rows and revisions across commits and explicitly expires cursors after close/reopen", async () => {
    const f = fixture();
    f.write(seed);
    const { facet, plane } = f.open();
    const first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 1 }));
    const oldB = body(await facet.perform(resource("beads/b")));
    const next = requestFromUrl(new URL(first.next as string), scope as AbsoluteHttpUrl);
    if (isReadProblem(next)) throw new Error("invalid continuation");
    f.write([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: 99 }],
      },
      { operation: "createBead", id: "beads/c", type: bead },
    ]);
    expect(items(await facet.perform(next))).toEqual([oldB]);
    expect(body(await facet.perform(resource("beads/b"))).properties).toEqual({ n: 99 });
    expect(items(await facet.perform(next))).toEqual([oldB]);
    await plane.close();
    await expect(facet.perform(next)).rejects.toThrow("closed");
    // Closing a Read plane never closes the owner.
    expect(
      f.write([
        {
          operation: "updateBead",
          bead: "beads/a",
          propertiesChange: [{ op: "replace", path: "/n", value: 77 }],
        },
      ]).status,
    ).toBe("completed");
    f.reopen();
    expect(await f.open().facet.perform(next)).toMatchObject({
      kind: "problem",
      problem: { code: "cursor-expired" },
    });
  });

  it("refuses reentrant reads from a mutation callback before tentative effects can escape", async () => {
    let read: (() => Promise<unknown>) | undefined, attempted: Promise<unknown> | undefined;
    const f = fixture({
      fault(stage) {
        if (stage === "after-effects") attempted = read?.();
      },
    });
    const { facet } = f.open();
    read = () => facet.perform({ kind: "collection", collection: "beads" });
    expect(f.write(seed).status).toBe("completed");
    await expect(attempted).rejects.toThrow("already active");
    expect(items(await read())).toHaveLength(2);
  });

  it.each(["before", "after"] as const)(
    "refuses reads after injected %s-COMMIT uncertainty, preserving its cause and recovery",
    async (phase) => {
      const f = fixture(),
        { facet, plane } = f.open();
      const admitted = f.store.admit(
        "principal",
        "uncertain",
        prepareTransaction(scope, JSON.stringify({ operations: seed })),
      );
      if (admitted.kind !== "owned") throw new Error("expected owner");
      const actual = DatabaseSync.prototype.exec;
      let armed = true;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (armed && sql === "COMMIT") {
          armed = false;
          if (phase === "after") actual.call(this, sql);
          throw new Error("read test commit uncertainty");
        }
        actual.call(this, sql);
      });
      expect(() => f.store.execute(admitted.claim)).toThrow("owner fenced");
      spy.mockRestore();
      let failure: unknown;
      try {
        await facet.perform(resource("beads/a"));
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        cause: { cause: { message: "read test commit uncertainty" } },
      });
      await plane.close();
      f.reopen();
      expect(
        items(await f.open().facet.perform({ kind: "collection", collection: "beads" })),
      ).toHaveLength(phase === "after" ? 2 : 0);
    },
  );
});

describe("Transactional same-entry source context", () => {
  it("captures zero/committed positions with rows before asynchronous delivery or a later unrelated commit", async () => {
    const f = fixture(),
      { facet } = f.open();
    const empty = facet.perform({ kind: "collection", collection: "beads" });
    f.write(seed);
    const initial = await empty;
    expect(items(initial)).toEqual([]);
    expect(contexts(initial)).toMatchObject({
      current: { scopePosition: "pos-0" },
      snapshot: { scopePosition: "pos-0" },
    });
    const original = facet.perform(resource("beads/a"));
    f.write([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: 8 }],
      },
    ]);
    const beforeDelivery = await original;
    const current = await facet.perform(resource("beads/a"));
    expect(body(current)).toEqual(body(beforeDelivery));
    expect(contexts(beforeDelivery).current.scopePosition).toBe("pos-1");
    expect(contexts(current).current.scopePosition).toBe("pos-2");
    expect(contexts(current)).not.toHaveProperty("snapshot");
    expect(Object.isFrozen(contexts(current).current)).toBe(true);
    expect(contexts(current).current.scopeEpoch).toBe(f.store.scopeEpoch);
    expect(contexts(current).current.authorizationView).toBe("development-all-visible");
  });

  it("pairs original page rows/revisions/context with a new serving observation on each continuation", async () => {
    const f = fixture();
    f.write(seed);
    const { facet, plane } = f.open();
    const first = await facet.perform({ kind: "collection", collection: "beads", limit: 1 });
    const originalB = body(await facet.perform(resource("beads/b")));
    const request = requestFromUrl(new URL(body(first).next as string), scope as AbsoluteHttpUrl);
    if (isReadProblem(request)) throw new Error("invalid continuation");
    expect(contexts(first).snapshot).toEqual(contexts(first).current);
    expect(Object.keys(body(first)).sort()).toEqual(["items", "next"]);
    f.write([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: 9 }],
      },
    ]);
    const second = await facet.perform(request);
    expect(items(second)).toEqual([originalB]);
    expect(contexts(second).snapshot).toEqual(contexts(first).snapshot);
    expect(contexts(second).current.scopePosition).toBe("pos-2");
    f.write([{ operation: "deleteBead", bead: "beads/b" }]);
    const replay = await facet.perform(request);
    expect(body(replay)).toEqual(body(second));
    expect(contexts(replay).snapshot?.scopePosition).toBe("pos-1");
    expect(contexts(replay).current.scopePosition).toBe("pos-3");
    await plane.close();
    f.reopen();
    const unavailable = await f.open().facet.perform(request);
    expect(unavailable).toMatchObject({ kind: "problem", problem: { code: "cursor-expired" } });
    expect(contexts(unavailable)).toMatchObject({ current: { scopePosition: "pos-3" } });
    expect(contexts(unavailable)).not.toHaveProperty("snapshot");
  });

  it("does not advance observed position for pending admission, no-op, alias change or failed batch", async () => {
    const f = fixture();
    f.write(seed);
    const { facet } = f.open();
    const pending = f.store.admit(
      "principal",
      "pending",
      prepareTransaction(
        scope,
        JSON.stringify({ operations: [{ operation: "createBead", type: bead }] }),
      ),
    );
    expect(pending.kind).toBe("owned");
    expect(
      f.write([
        {
          operation: "updateBead",
          bead: "beads/b",
          propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
        },
      ]).status,
    ).toBe("completed");
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
      "completed",
    );
    expect(
      f.write([
        { operation: "createBead", id: "beads/tentative", type: bead },
        { operation: "deleteBead", bead: "beads/missing" },
      ]).status,
    ).toBe("failed");
    expect(contexts(await facet.resolveAlias(url("alias/work"))).current.scopePosition).toBe(
      "pos-1",
    );
    const missing = await facet.perform(resource("beads/tentative"));
    expect(missing).toMatchObject({ kind: "problem", problem: { code: "resource-not-found" } });
    expect(contexts(missing).current.scopePosition).toBe("pos-1");
    expect(
      contexts(await facet.perform({ kind: "scope-discovery", scope: scope as AbsoluteHttpUrl }))
        .current.scopePosition,
    ).toBe("pos-1");
    if (pending.kind !== "owned") throw new Error("missing claim");
    f.store.retract(pending.claim);
  });

  it("captures immutable owner context under the same reentrancy guard as the row facade", () => {
    const f = fixture();
    f.write(seed);
    const captured = f.store.withRead((reader, context) => {
      expect(reader.resources()).toHaveLength(3);
      expect(context.scopePosition).toBe("pos-1");
      expect(Object.isFrozen(context)).toBe(true);
      expect(() => f.write([{ operation: "deleteBead", bead: "beads/b" }])).toThrow("reentrant");
      expect(reader.resources()).toHaveLength(3);
      return context;
    });
    expect(captured).toMatchObject({ kind: "read", value: { scopePosition: "pos-1" } });
    f.write([{ operation: "deleteBead", bead: "beads/b" }]);
    expect(captured).toMatchObject({ kind: "read", value: { scopePosition: "pos-1" } });
    expect(f.store.withRead((_reader, context) => context.scopePosition)).toEqual({
      kind: "read",
      value: "pos-2",
    });
  });

  it.each([
    "absent",
    "extra",
    "foreign-epoch",
    "foreign-view",
    "invalid-position",
    "unsafe-position",
    "future-snapshot",
  ])("refuses %s context at the Transactional interpretation boundary", (fault) => {
    const context = { scopeEpoch: "epoch", authorizationView: "view", scopePosition: "pos-2" };
    const observation: ReadObservation = {
      scopeEpoch: "epoch",
      authorizationView: "view",
      policyIdentity: "policy",
      configurationIdentity: "config",
      sourceContext: context,
    };
    if (fault === "absent") delete (observation as { sourceContext?: unknown }).sourceContext;
    if (fault === "extra") Object.assign(context, { unknown: "value" });
    if (fault === "foreign-epoch") context.scopeEpoch = "other";
    if (fault === "foreign-view") context.authorizationView = "other";
    if (fault === "invalid-position") context.scopePosition = "pos-02";
    if (fault === "unsafe-position") context.scopePosition = "pos-9007199254740992";
    if (fault === "future-snapshot")
      Object.assign(observation, { snapshotSourceContext: { ...context, scopePosition: "pos-3" } });
    expect(() => transactionReadContexts(observation)).toThrow("Read");
  });
});

it("refuses accessor/proxy context at the TX boundary without executing it", () => {
  const getter = vi.fn(() => "pos-1");
  const source = { scopeEpoch: "epoch", authorizationView: "view" };
  Object.defineProperty(source, "scopePosition", { enumerable: true, get: getter });
  const observation = {
    scopeEpoch: "epoch",
    authorizationView: "view",
    policyIdentity: "p",
    configurationIdentity: "c",
    sourceContext: source,
  };
  expect(() => transactionReadContexts(observation)).toThrow("context fields");
  expect(getter).not.toHaveBeenCalled();
  const trap = vi.fn();
  const proxy = new Proxy({}, { ownKeys: trap });
  expect(() => transactionReadContexts({ ...observation, sourceContext: proxy })).toThrow(
    "context",
  );
  expect(trap).not.toHaveBeenCalled();
});

it("checks visible point rows and their minimum in the same entry and leaves the owner reusable", async () => {
  const f = fixture();
  f.write([{ operation: "createBead", id: "beads/a", type: bead }]);
  const { plane } = f.open(),
    config = f.store.readConfiguration();
  const minimum = {
    scopeEpoch: config.scopeEpoch,
    authorizationView: config.authorizationView,
    minimumPosition: "pos-1",
  };
  const original = DatabaseSync.prototype.prepare;
  let resources = 0,
    observations = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql === "SELECT value FROM metadata WHERE name=?") {
      observations++;
      expect(() => f.store.inspect()).toThrow("reentrant");
    }
    if (sql === "SELECT * FROM resources WHERE id=?") {
      resources++;
      expect(() => f.store.inspect()).toThrow("reentrant");
    }
    return original.call(this, sql);
  });
  try {
    const result = await plane
      .minimumFor({ kind: "anonymous" }, minimum)
      .perform(resource("beads/a"));
    expect(contexts(result).current.scopePosition).toBe("pos-1");
    expect(resources).toBeGreaterThan(0);
    resources = 0;
    await expect(
      plane
        .minimumFor({ kind: "anonymous" }, { ...minimum, minimumPosition: "pos-2" })
        .perform(resource("beads/a")),
    ).rejects.toMatchObject({ reason: "behind", context: { scopePosition: "pos-1" } });
    expect(resources).toBeGreaterThan(0);
    // Each owner entry reads current position; epoch was captured at installation open.
    expect(observations).toBe(2);
  } finally {
    spy.mockRestore();
  }
  f.write([{ operation: "createBead", id: "beads/b", type: bead }]);
  expect(
    contexts(
      await plane
        .minimumFor({ kind: "anonymous" }, { ...minimum, minimumPosition: "pos-2" })
        .perform(resource("beads/a")),
    ).current.scopePosition,
  ).toBe("pos-2");
});

describe("initial collection minimums", () => {
  it("bounds unrecognized initial collection minima without retaining state or holding the owner", async () => {
    const f = fixture();
    const seeded = f.write([
      ...seed,
      {
        operation: "createLink",
        id: "links/out",
        type: link,
        source: "beads/a",
        target: "beads/b",
      },
    ]);
    expect(seeded.status).toBe("completed");
    let entries = 0,
      allocations = 0,
      tick = 0,
      ownerChecks = 0;
    const waits: number[] = [];
    let abortDuringWait: AbortController | undefined;
    const owner: typeof f.store = {
      ...f.store,
      withRead: (callback) => {
        entries++;
        return f.store.withRead(callback);
      },
    };
    const service = createTransactionService(owner, {
      ownerLifetime: "service",
      read: {
        ...f.readOptions,
        advertisedLimits: {
          ...f.readOptions.advertisedLimits,
          page: { defaultItems: 2, maximumItems: 32 },
        },
        pagination: {
          ...f.readOptions.pagination,
          maxPageItems: 32,
          generateOpaqueToken: () => `unknown_minimum_${++allocations}`,
        },
      },
      minimumReads: {
        budgetMs: 7,
        now: () => tick,
        wait: async (ms) => {
          waits.push(ms);
          tick += ms;
          // Bypass the attempt counter: an actual raw owner entry must work between attempts.
          expect(f.store.withRead((_reader, context) => context.scopePosition)).toEqual({
            kind: "read",
            value: "pos-1",
          });
          ownerChecks++;
          abortDuringWait?.abort();
        },
      },
    });
    const principal = { kind: "authenticated" as const, principal: { id: "principal" } };
    const minimum = {
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition: "opaque",
    };
    try {
      const initialEntries = entries;
      for (const collection of ["beads", "links"] as const) {
        for (const token of ["opaque", "pos-01", "pos-9007199254740992"]) {
          const beforeEntries = entries,
            beforeWaits = waits.length,
            beforeTick = tick,
            beforeOwnerChecks = ownerChecks;
          await expect(
            service
              .readAtMinimum(principal, { ...minimum, minimumPosition: token })
              .perform({ kind: "collection", collection, limit: 1 }),
          ).rejects.toMatchObject({
            reason: "catch-up-timeout",
            context: {
              scopeEpoch: minimum.scopeEpoch,
              authorizationView: minimum.authorizationView,
              scopePosition: "pos-1",
            },
          });
          expect(entries - beforeEntries).toBe(3);
          expect(waits.slice(beforeWaits)).toEqual([5, 2]);
          expect(tick - beforeTick).toBe(7);
          expect(ownerChecks - beforeOwnerChecks).toBe(2);
          expect(allocations).toBe(0);
        }
      }
      expect(entries - initialEntries).toBe(18);
      expect(waits).toHaveLength(12);
      const request = { kind: "collection", collection: "beads", limit: 1 } as const;
      const preabort = new AbortController();
      preabort.abort();
      const beforeAbortEntries = entries,
        beforeAbortWaits = waits.length;
      await expect(
        service.readAtMinimum(principal, minimum).perform(request, { signal: preabort.signal }),
      ).rejects.toThrow("abort");
      expect(entries).toBe(beforeAbortEntries);
      expect(waits).toHaveLength(beforeAbortWaits);
      abortDuringWait = new AbortController();
      await expect(
        service
          .readAtMinimum(principal, minimum)
          .perform(request, { signal: abortDuringWait.signal }),
      ).rejects.toThrow("abort");
      expect(entries - beforeAbortEntries).toBe(1);
      expect(waits.slice(beforeAbortWaits)).toEqual([5]);
      expect(ownerChecks).toBe(13);
      expect(allocations).toBe(0);
    } finally {
      await service.close();
    }
  });

  it("preserves behind-minimum control refusals without allocating retained state", async () => {
    const f = fixture();
    f.write(seed);
    let allocations = 0;
    const { plane } = f.open({
      pagination: {
        ...f.readOptions.pagination,
        generateOpaqueToken: () => `refusal_${++allocations}`,
      },
    });
    const facet = plane.minimumFor(
      { kind: "anonymous" },
      {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        minimumPosition: "pos-2",
      },
    );
    for (const [controls, code] of [
      [{ limit: 11 }, "limit-exceeded"],
      [{ selector: "$[?" }, "invalid-parameter"],
      [{ selector: "$[?@.properties.n == '" + "x".repeat(4100) + "']" }, "limit-exceeded"],
    ] as const) {
      await expect(
        facet.perform({ kind: "collection", collection: "beads", ...controls }),
      ).resolves.toMatchObject({ kind: "problem", problem: { code } });
      expect(allocations).toBe(0);
    }
  });

  it.each(["beads", "links"] as const)(
    "checks a minimum even for an empty %s collection",
    async (collection) => {
      const f = fixture(),
        { plane } = f.open();
      const minimum = {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        minimumPosition: "pos-0",
      };
      const request = { kind: "collection", collection } as const;
      const response = await plane.minimumFor({ kind: "anonymous" }, minimum).perform(request);
      expect(body(response)).toEqual({ items: [], next: null });
      expect(contexts(response).current.scopePosition).toBe("pos-0");
      await expect(
        plane
          .minimumFor(
            { kind: "anonymous" },
            {
              ...minimum,
              minimumPosition: "pos-1",
            },
          )
          .perform(request),
      ).rejects.toMatchObject({ reason: "behind" });
    },
  );

  it("applies accepted endpoint filters and minima independently", async () => {
    const f = fixture();
    f.write(seed);
    const { plane } = f.open();
    const minimum = {
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition: "pos-1",
    };
    for (const [source, ids] of [
      ["beads/a", [url("links/self")]],
      ["beads/b", []],
    ] as const) {
      const request = {
        kind: "collection",
        collection: "links",
        source: url(source),
        limit: 1,
      } as const;
      const response = await plane.minimumFor({ kind: "anonymous" }, minimum).perform(request);
      expect(items(response).map((r) => r.id)).toEqual(ids);
      expect(contexts(response).current.scopePosition).toBe("pos-1");
      await expect(
        plane
          .minimumFor(
            { kind: "anonymous" },
            {
              ...minimum,
              minimumPosition: "pos-2",
            },
          )
          .perform(request),
      ).rejects.toMatchObject({ reason: "behind" });
    }
  });

  it("does not retain failed attempts and preserves successful page rows versus current context", async () => {
    const f = fixture();
    f.write([
      ...seed,
      { operation: "createBead", id: "beads/c", type: bead, properties: { n: 3 } },
    ]);
    let allocations = 0;
    const { plane, facet } = f.open({
      pagination: {
        ...f.readOptions.pagination,
        retainedStateCapacity: 3,
        maxRetainedCursorPositionsPerSnapshot: 2,
        generateOpaqueToken: () => `minimum_${++allocations}`,
      },
    });
    const minimum = {
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition: "pos-2",
    };
    const request = { kind: "collection", collection: "beads", limit: 1 } as const;
    for (let i = 0; i < 4; i++)
      await expect(
        plane.minimumFor({ kind: "anonymous" }, minimum).perform(request),
      ).rejects.toMatchObject({ reason: "behind" });
    expect(allocations).toBe(0);
    f.write([
      {
        operation: "updateBead",
        bead: "beads/c",
        propertiesChange: [{ op: "replace", path: "/n", value: 4 }],
      },
    ]);
    const first = await plane.minimumFor({ kind: "anonymous" }, minimum).perform(request);
    expect(items(first).map((r) => r.properties)).toEqual([{ n: 1 }]);
    expect(contexts(first).current.scopePosition).toBe("pos-2");
    expect(allocations).toBeGreaterThan(0);
    const next = body(first).next;
    expect(typeof next).toBe("string");
    f.write([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: 8 }],
      },
    ]);
    const parsed = requestFromUrl(new URL(String(next)), scope);
    if (isReadProblem(parsed)) throw new Error("invalid returned next");
    const second = await facet.perform(parsed);
    expect(items(second).map((r) => r.properties)).toEqual([{ n: 2 }]);
    expect(contexts(second)).toMatchObject({
      snapshot: { scopePosition: "pos-2" },
      current: { scopePosition: "pos-3" },
    });
    expect(items(second)[0]?.revision).toBeTruthy();
  });

  it.each(["beads/", "beads/a"])(
    "rejects a pre-aborted server Request for %s before any owner SQL",
    async (suffix) => {
      const f = fixture();
      f.write(seed);
      const service = createTransactionService(f.store, {
        ownerLifetime: "service",
        read: {
          ...f.readOptions,
          advertisedLimits: {
            ...f.readOptions.advertisedLimits,
            page: { defaultItems: 2, maximumItems: 32 },
          },
          pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
        },
      });
      cleanup.push(() => service.close());
      const handler = createTransactionHttpHandler(service, scope);
      const controller = new AbortController();
      controller.abort(new Error("pre-aborted actual Request"));
      const request = new Request(url(suffix), {
        signal: controller.signal,
        headers: {
          "bdp-scope-epoch": f.store.scopeEpoch,
          "bdp-authorization-view": "development-all-visible",
          "bdp-minimum-scope-position": "pos-2",
        },
      });
      const spy = vi.spyOn(DatabaseSync.prototype, "prepare");
      await expect(
        handler.handle(request, { kind: "authenticated", principal: "principal", canMutate: true }),
      ).rejects.toThrow("abort");
      expect(spy).not.toHaveBeenCalled();
    },
  );
});

it("binds the private HTTP directory to the service owner's exact non-root Scope", async () => {
  const f = fixture();
  const service = createTransactionService(f.store, {
    ownerLifetime: "service",
    read: {
      ...f.readOptions,
      advertisedLimits: {
        ...f.readOptions.advertisedLimits,
        page: { defaultItems: 2, maximumItems: 32 },
      },
      pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
    },
  });
  cleanup.push(() => service.close());
  expect(service.scope).toBe(scope);
  expect(() => createTransactionHttpHandler(service, "https://foreign.test/other/")).toThrow(
    "HTTP Scope differs from transaction owner",
  );
  const handler = createTransactionHttpHandler(service, scope);
  const observed = await service.discoveryObserved();
  expect(handler.targets).toEqual(
    Object.fromEntries(
      Object.entries({
        createBead: "create-bead",
        updateBead: "update-bead",
        deleteBead: "delete-bead",
        createLink: "create-link",
        updateLink: "update-link",
        deleteLink: "delete-link",
        putAlias: "put-alias",
        deleteAlias: "delete-alias",
        sequence: "sequence",
        updateWhere: "update-where",
        deleteWhere: "delete-where",
        batch: "batch",
      }).map(([name, suffix]) => [name, `${scope}operations/${suffix}`]),
    ),
  );
  for (const [name, suffix] of Object.entries(observed.directory))
    expect(handler.targets[name as keyof typeof handler.targets]).toBe(
      new URL(suffix, observed.discovery.operations).href,
    );
  expect(new URL(observed.discovery.snapshot).pathname).toBe(new URL("snapshot", scope).pathname);
  const snapshotResponse = await handler.handle(new Request(observed.discovery.snapshot), {
    kind: "authenticated",
    principal: "principal",
    canMutate: true,
  });
  expect(snapshotResponse.status).toBe(200);
  expect(snapshotResponse.body).toMatchObject({
    scope,
    scopeEpoch: observed.context.scopeEpoch,
    authorizationView: observed.context.authorizationView,
    scopePosition: "pos-0",
    checkpoint: "genesis",
    beads: { items: [], next: null },
    links: { items: [], next: null },
  });
  expect(snapshotResponse.headers.get("bdp-scope-position")).toBe("pos-0");
});

describe("compatible missing Resource minimum", () => {
  it("returns same-entry observed404 across absent/deleted kinds, views and satisfied bounds", async () => {
    const f = fixture();
    f.write(seed);
    f.write([
      { operation: "deleteLink", link: "links/self" },
      { operation: "deleteBead", bead: "beads/a" },
    ]);
    let entries = 0;
    const owner: typeof f.store = {
      ...f.store,
      withRead: (callback) => {
        entries++;
        return f.store.withRead(callback);
      },
    };
    const plane = createTransactionReadPlane(owner, f.readOptions);
    cleanup.push(() => plane.close());
    const config = f.store.readConfiguration();
    const expected = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      scopePosition: "pos-2",
    };
    const original = DatabaseSync.prototype.prepare;
    let lookups = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql === "SELECT * FROM resources WHERE id=?") {
        lookups++;
        expect(() => f.store.inspect()).toThrow("reentrant");
      }
      return original.call(this, sql);
    });
    try {
      for (const [kind, deleted] of [
        ["bead", "beads/a"],
        ["link", "links/self"],
      ] as const)
        for (const id of [deleted, `${kind}s/never`])
          for (const view of ["resource", "properties"] as const)
            for (const minimumPosition of ["pos-1", "pos-2"]) {
              const before = entries;
              const result = await plane
                .minimumFor(
                  { kind: "anonymous" },
                  {
                    scopeEpoch: expected.scopeEpoch,
                    authorizationView: expected.authorizationView,
                    minimumPosition,
                  },
                )
                .perform({ kind: view, resource: kind, id: url(id) });
              expect(result).toMatchObject({
                kind: "problem",
                phase: "observed",
                problem: { code: "resource-not-found", status: 404 },
              });
              expect(contexts(result).current).toEqual(expected);
              expect(entries - before).toBe(1);
            }
      expect(lookups).toBeGreaterThanOrEqual(16);
    } finally {
      spy.mockRestore();
    }
    f.write([{ operation: "createBead", id: "beads/after", type: bead }]);
    expect(
      contexts(await plane.readFor({ kind: "anonymous" }).perform(resource("beads/after"))).current
        .scopePosition,
    ).toBe("pos-3");
  });
  it("returns observed missing Resources before behind and foreign minimum collisions", async () => {
    const f = fixture();
    f.write(seed);
    const { plane } = f.open(),
      config = f.store.readConfiguration();
    const minimum = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      minimumPosition: "pos-1",
    };
    for (const kind of ["bead", "link"] as const)
      for (const patch of [
        { minimumPosition: "pos-2" },
        { scopeEpoch: "foreign" },
        { authorizationView: "foreign" },
      ])
        await expect(
          plane
            .minimumFor({ kind: "anonymous" }, { ...minimum, ...patch })
            .perform(resource(`${kind}s/never`, kind)),
        ).resolves.toMatchObject({
          kind: "problem",
          phase: "observed",
          problem: { code: "resource-not-found", status: 404 },
        });
  });
  it("propagates invalid string context and provider errors rather than masking integrity", async () => {
    const f = fixture();
    f.write(seed);
    const config = f.store.readConfiguration();
    let fault: "context" | "provider" | undefined = "context";
    const sentinel = new Error("fixture provider failure");
    const owner: typeof f.store = {
      ...f.store,
      withRead: (callback) =>
        f.store.withRead((reader, context) => {
          expect(() => f.store.inspect()).toThrow("reentrant");
          if (fault === "provider") throw sentinel;
          return callback(
            reader,
            fault === "context" ? { ...context, scopePosition: "pos-02" } : context,
          );
        }),
    };
    const plane = createTransactionReadPlane(owner, f.readOptions);
    cleanup.push(() => plane.close());
    const facet = plane.minimumFor(
      { kind: "anonymous" },
      {
        scopeEpoch: config.scopeEpoch,
        authorizationView: config.authorizationView,
        minimumPosition: "pos-1",
      },
    );
    await expect(facet.perform(resource("beads/missing"))).rejects.toThrow(
      "invalid Transactional Read context",
    );
    fault = "provider";
    await expect(facet.perform(resource("beads/missing"))).rejects.toBe(sentinel);
    fault = undefined;
    expect(await facet.perform(resource("beads/missing"))).toMatchObject({
      kind: "problem",
      problem: { status: 404 },
    });
    f.write([{ operation: "createBead", id: "beads/after", type: bead }]);
    expect(contexts(await facet.perform(resource("beads/after"))).current.scopePosition).toBe(
      "pos-2",
    );
  });
  it("ignores ordinary sourceCondition while preserving signals and minimumFor enforcement", async () => {
    const f = fixture();
    f.write(seed);
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
      "completed",
    );
    const { plane, facet } = f.open(),
      config = f.store.readConfiguration();
    const sourceCondition = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      minimumPosition: "pos-99",
    };
    expect(await facet.perform(resource("beads/a"), { sourceCondition })).toMatchObject({
      kind: "success",
    });
    expect(await facet.resolveAlias(url("alias/work"), { sourceCondition })).toMatchObject({
      kind: "target",
      target: url("beads/a"),
    });
    await expect(
      plane.minimumFor({ kind: "anonymous" }, sourceCondition).perform(resource("beads/a")),
    ).rejects.toMatchObject({ reason: "behind" });
    await expect(
      plane.minimumFor({ kind: "anonymous" }, sourceCondition).resolveAlias(url("alias/work")),
    ).rejects.toMatchObject({ reason: "behind" });
    await expect(
      plane
        .minimumFor({ kind: "anonymous" }, sourceCondition)
        .perform({ kind: "resource", resource: "type", id: link as AbsoluteHttpUrl }),
    ).rejects.toThrow("outside supported subset");
    const signal = AbortSignal.abort(new Error("ordinary cancelled"));
    await expect(facet.perform(resource("beads/a"), { signal, sourceCondition })).rejects.toThrow(
      "abort",
    );
    await expect(
      facet.resolveAlias(url("alias/work"), { signal, sourceCondition }),
    ).rejects.toThrow("abort");
  });

  it.each(["perform", "resolveAlias"] as const)(
    "preserves ordinary %s delivery validation without invoking caller accessors or proxies",
    async (method) => {
      const f = fixture();
      f.write(seed);
      expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
        "completed",
      );
      const { plane, facet } = f.open();
      const call = (options: unknown) =>
        method === "perform"
          ? facet.perform(resource("beads/a"), options as AuthorityReadDeliveryOptions)
          : facet.resolveAlias(url("alias/work"), options as AuthorityReadDeliveryOptions);
      const invoked = vi.fn(() => {
        throw new Error("caller code must not execute");
      });
      const proxy = new Proxy({}, { get: invoked, ownKeys: invoked, getPrototypeOf: invoked });
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      for (const [options, message] of [
        [null, "plain data object"],
        [0, "plain data object"],
        [[], "plain data object"],
        [Object.create({}), "plain prototype"],
        [proxy, "plain data object"],
        [revoked.proxy, "plain data object"],
        [{ unknown: 1 }, "unknown Read delivery option"],
        [Object.defineProperty({}, "unknown", { value: 1 }), "unknown Read delivery option"],
        [{ [Symbol("hidden")]: 1 }, "symbol fields"],
        [
          {
            get signal() {
              return invoked();
            },
          },
          "accessors",
        ],
        [
          {
            get sourceCondition() {
              return invoked();
            },
          },
          "accessors",
        ],
        ...[null, 0, false, "", {}, proxy].map(
          (signal) => [{ signal }, "Read signal must be an AbortSignal"] as const,
        ),
      ] as const) {
        let delivery: Promise<unknown> | undefined;
        expect(() => {
          delivery = call(options);
        }).not.toThrow();
        expect(delivery).toBeInstanceOf(Promise);
        await expect(delivery).rejects.toBeInstanceOf(AuthorityReadError);
        await expect(delivery).rejects.toMatchObject({
          reason: "invalid-input",
          message: expect.stringContaining(message),
        });
      }
      expect(invoked).not.toHaveBeenCalled();
      // Null prototypes and own undefined signals remain valid. Opaque ignored
      // condition data is not inspected (even a revoked proxy is harmless data).
      const valid = Object.create(null);
      Object.defineProperties(valid, {
        signal: { value: undefined },
        sourceCondition: { value: revoked.proxy },
      });
      await expect(call(valid)).resolves.toMatchObject({
        kind: method === "perform" ? "success" : "target",
      });
      await expect(call(undefined)).resolves.toMatchObject({
        kind: method === "perform" ? "success" : "target",
      });
      await plane.close();
      // The existing authority reports closed before inspecting delivery data.
      // The narrowing helper must not replace this with invalid-input.
      let closedDelivery: Promise<unknown> | undefined;
      expect(() => {
        closedDelivery = call(proxy);
      }).not.toThrow();
      await expect(closedDelivery).rejects.toThrow("closed");
      expect(invoked).not.toHaveBeenCalled();
    },
  );
});

describe("current Type and incident-Link minimums", () => {
  const descriptor = parseTypeDescriptor({
    id: url("types/task"),
    name: "Task",
    describes: "bead",
    conformsTo: [],
  });
  const principal = { kind: "anonymous" } as const;
  const requests: ReadRequest[] = [
    { kind: "resource", resource: "type", id: descriptor.id },
    { kind: "collection", collection: "types", limit: 3 },
    { kind: "bead-links", bead: url("beads/a") },
  ];
  const extraLinks = [
    {
      operation: "createLink",
      id: "links/out",
      type: link,
      source: "beads/a",
      target: "beads/b",
      properties: { n: 3 },
      metadata: { tag: "out" },
    },
    {
      operation: "createLink",
      id: "links/in",
      type: link,
      source: "beads/b",
      target: "beads/a",
      properties: { n: 4 },
      metadata: { tag: "in" },
    },
  ];
  function prepared() {
    const f = fixture({ types: [...types, descriptor] });
    f.write([...seed, ...extraLinks]);
    const minimum = (minimumPosition = "pos-1") => ({
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition,
    });
    return { ...f, minimum };
  }
  function serviceFor(f: ReturnType<typeof prepared>, minimumReads = {}) {
    const service = createTransactionService(f.store, {
      ownerLifetime: "service",
      minimumReads,
      read: {
        ...f.readOptions,
        advertisedLimits: {
          ...f.readOptions.advertisedLimits,
          page: { defaultItems: 2, maximumItems: 32 },
        },
        pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
      },
    });
    cleanup.push(() => service.close());
    return service;
  }
  function assertLinks(rows: Record<string, unknown>[], names: string[]) {
    expect(rows.map((r) => r.id)).toEqual(names.map((n) => url(`links/${n}`)));
    for (const row of rows) {
      const name = String(row.id).split("/").at(-1)!;
      expect(row).toEqual({
        id: url(`links/${name}`),
        type: link,
        source: url(name === "in" ? "beads/b" : "beads/a"),
        target: url(name === "out" ? "beads/b" : "beads/a"),
        properties: name === "self" ? {} : { n: name === "out" ? 3 : 4 },
        metadata: name === "self" ? {} : { tag: name },
        revision: expect.any(String),
      });
    }
  }
  it.each([
    "omitted",
    "undefined",
    "null",
    "number",
    "false",
    "empty",
    "method",
    "accessor",
    "inherited",
    "proxy",
    "revoked",
  ] as const)(
    "rejects malformed Type ID %s through a Promise without invoking caller data",
    async (kind) => {
      const f = prepared(),
        { plane, facet } = f.open();
      const minimum = plane.minimumFor(principal, f.minimum());
      const invoked = vi.fn(() => {
        throw new Error("Type ID caller code must not execute");
      });
      const base = { kind: "resource", resource: "type" };
      const revoked = Proxy.revocable({ ...base, id: descriptor.id }, {});
      revoked.revoke();
      const malformed = {
        omitted: base,
        undefined: { ...base, id: undefined },
        null: { ...base, id: null },
        number: { ...base, id: 0 },
        false: { ...base, id: false },
        empty: { ...base, id: "" },
        method: { ...base, id: { startsWith: invoked } },
        accessor: Object.defineProperty({ ...base }, "id", { get: invoked }),
        inherited: Object.assign(
          Object.create(Object.defineProperty({}, "id", { get: invoked })),
          base,
        ),
        proxy: new Proxy(
          { ...base, id: descriptor.id },
          {
            get: invoked,
            getOwnPropertyDescriptor: invoked,
            getPrototypeOf: invoked,
          },
        ),
        revoked: revoked.proxy,
      };
      let delivery: Promise<unknown> | undefined;
      expect(() => {
        delivery = minimum.perform(malformed[kind] as ReadRequest);
      }).not.toThrow();
      expect(delivery).toBeInstanceOf(Promise);
      const requestShapeMessage =
        kind === "accessor"
          ? "Read request cannot have accessors"
          : kind === "inherited"
            ? "Read request must have a plain prototype"
            : kind === "proxy" || kind === "revoked"
              ? "Read request must be a plain data object"
              : undefined;
      if (requestShapeMessage !== undefined) {
        await expect(delivery).rejects.toBeInstanceOf(AuthorityReadError);
        await expect(delivery).rejects.toMatchObject({
          reason: "invalid-input",
          message: requestShapeMessage,
        });
      } else await expect(delivery).rejects.toThrow("outside supported subset");
      expect(invoked).not.toHaveBeenCalled();
      expect(body(await minimum.perform(requests[0]!))).toEqual(descriptor);
      const external = { kind: "resource", resource: "type", id: link } as ReadRequest;
      expect(body(await facet.perform(external))).toEqual(types[1]);
      await expect(minimum.perform(external)).rejects.toThrow("outside supported subset");
      // The subset gate checks only locality. Canonical Type syntax remains a Read rule.
      expect(
        await minimum.perform({ kind: "resource", resource: "type", id: url("beads/a") }),
      ).toMatchObject({ kind: "problem", problem: { status: 400, code: "invalid-parameter" } });
    },
  );

  it("projects immutable current Types and exact incident directions including self-Link deduplication", async () => {
    const f = prepared(),
      { plane, facet } = f.open();
    const read = plane.minimumFor(principal, f.minimum());
    const type = await read.perform(requests[0]!);
    expect(body(type)).toEqual(descriptor);
    const inventory = await read.perform(requests[1]!);
    expect(body(inventory)).toEqual({
      items: [types[0], types[1], descriptor]
        .map((t) => ({ id: t!.id, name: t!.name, describes: t!.describes }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      next: null,
    });
    for (const [direction, names] of [
      [undefined, ["in", "out", "self"]],
      ["both", ["in", "out", "self"]],
      ["inbound", ["in", "self"]],
      ["outbound", ["out", "self"]],
    ] as const) {
      const response = await read.perform({
        kind: "bead-links",
        bead: url("beads/a"),
        limit: 10,
        ...(direction === undefined ? {} : { direction }),
      });
      assertLinks(items(response), [...names]);
      expect(body(response).next).toBeNull();
      expect(contexts(response).current.scopePosition).toBe("pos-1");
    }
    f.write([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: 8 }],
      },
    ]);
    for (const [request, previous] of [
      [requests[0]!, type],
      [requests[1]!, inventory],
    ] as const) {
      for (const position of ["pos-1", "pos-2"]) {
        const response = await plane.minimumFor(principal, f.minimum(position)).perform(request);
        expect(body(response)).toEqual(body(previous));
        expect(contexts(response).current).toEqual({
          ...contexts(previous).current,
          scopePosition: "pos-2",
        });
      }
      await expect(
        plane.minimumFor(principal, f.minimum("pos-3")).perform(request),
      ).rejects.toMatchObject({ reason: "behind" });
    }
    expect(
      body(
        await facet.perform({ kind: "resource", resource: "type", id: link as AbsoluteHttpUrl }),
      ),
    ).toEqual(types[1]);
    await expect(
      read.perform({ kind: "resource", resource: "type", id: link as AbsoluteHttpUrl }),
    ).rejects.toThrow("outside supported subset");
    expect(await read.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "problem",
      problem: { status: 404 },
    });
    for (const collection of ["beads", "links", "types"] as const) {
      const first = await facet.perform({ kind: "collection", collection, limit: 1 });
      const next = body(first).next;
      expect(typeof next).toBe("string");
      const parsed = requestFromUrl(new URL(String(next)), scope);
      if (isReadProblem(parsed)) throw new Error("invalid actual continuation");
      await expect(read.perform(parsed)).rejects.toThrow("outside supported subset");
    }
    // These corruption controls exercise the same independent record oracle.
    const rows = items(await read.perform({ kind: "bead-links", bead: url("beads/a"), limit: 10 }));
    expect(() =>
      assertLinks(
        rows.map((r, i) => (i ? r : { ...r, target: url("beads/b") })),
        ["in", "out", "self"],
      ),
    ).toThrow();
    expect(() =>
      assertLinks(
        rows.map((r, i) => {
          if (i) return r;
          const { metadata, ...rest } = r;
          return rest;
        }),
        ["in", "out", "self"],
      ),
    ).toThrow();
    expect(() => expect({ ...body(type), name: "Forged" }).toEqual(descriptor)).toThrow();
    expect(() =>
      expect({
        ...body(inventory),
        items: [{ id: descriptor.id, name: "Task", describes: "link" }],
      }).toEqual(body(inventory)),
    ).toThrow();
  });

  it.each(["types", "incident"])(
    "keeps %s limits, allocation and retained continuation boundaries distinct",
    async (kind) => {
      const f = prepared();
      let allocations = 0;
      const { plane, facet } = f.open({
        pagination: {
          ...f.readOptions.pagination,
          generateOpaqueToken: () => `type_incident_${++allocations}`,
        },
      });
      const request: ReadRequest =
        kind === "types"
          ? { kind: "collection", collection: "types", limit: 1 }
          : { kind: "bead-links", bead: url("beads/a"), limit: 1 };
      const pending = plane.minimumFor(principal, f.minimum("pos-2"));
      expect(await pending.perform({ ...request, limit: 33 })).toMatchObject({
        kind: "problem",
        problem: { status: 413, code: "limit-exceeded" },
      });
      expect(allocations).toBe(0);
      for (let i = 0; i < 2; i++)
        await expect(pending.perform(request)).rejects.toMatchObject({ reason: "behind" });
      expect(allocations).toBe(0);
      f.write([{ operation: "createBead", id: "beads/c", type: bead, properties: { n: 3 } }]);
      const first = await pending.perform(request);
      expect(allocations).toBeGreaterThan(0);
      expect(contexts(first).current.scopePosition).toBe("pos-2");
      const next = body(first).next;
      expect(typeof next).toBe("string");
      f.write([{ operation: "deleteLink", link: "links/out" }]);
      const parsed = requestFromUrl(new URL(String(next)), scope);
      if (isReadProblem(parsed)) throw new Error("invalid actual next");
      const second = await facet.perform(parsed);
      expect(contexts(second)).toMatchObject({
        snapshot: { scopePosition: "pos-2" },
        current: { scopePosition: "pos-3" },
      });
      if (kind === "incident") assertLinks(items(second), ["out"]);
      else expect(items(second)).toEqual([{ id: types[0]!.id, name: "Bead", describes: "bead" }]);
      await expect(pending.perform(parsed)).rejects.toThrow("outside supported subset");
    },
  );

  it.each([0, 1, 2])(
    "waits and cancels current surface %i without retaining an owner entry",
    async (index) => {
      const f = prepared(),
        entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      let tick = 0,
        waits = 0,
        expire = false;
      const service = serviceFor(f, {
        budgetMs: 2,
        now: () => tick,
        wait: async () => {
          waits++;
          if (expire) tick += 2;
          entered.resolve();
          await release.promise;
        },
      });
      cleanup.push(() => release.resolve());
      const request = requests[index]!;
      const pending = service.readAtMinimum(principal, f.minimum("pos-2")).perform(request);
      await entered.promise;
      try {
        f.write([{ operation: "createBead", id: "beads/c", type: bead, properties: { n: 3 } }]);
      } finally {
        release.resolve();
      }
      expect(contexts(await pending).current.scopePosition).toBe("pos-2");
      expect(waits).toBe(1);
      for (const [field, reason] of [
        ["scopeEpoch", "cursor-expired"],
        ["authorizationView", "foreign-view"],
      ] as const) {
        await expect(
          service.readAtMinimum(principal, { ...f.minimum(), [field]: "foreign" }).perform(request),
        ).rejects.toMatchObject({ reason });
        expect(
          contexts(await service.readAtMinimum(principal, f.minimum()).perform(request)).current
            .scopePosition,
        ).toBe("pos-2");
      }
      expire = true;
      await expect(
        service.readAtMinimum(principal, f.minimum("pos-3")).perform(request),
      ).rejects.toMatchObject({ reason: "catch-up-timeout", context: { scopePosition: "pos-2" } });
      expect(
        contexts(await service.readAtMinimum(principal, f.minimum()).perform(request)).current
          .scopePosition,
      ).toBe("pos-2");
      await service.close();
      expect(() => f.store.inspect()).toThrow("closed");
    },
  );

  it.each([0, 1, 2])(
    "pre-aborts, drains and releases a waiting current surface %i",
    async (index) => {
      const f = prepared(),
        entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      const service = serviceFor(f, {
        budgetMs: 2,
        now: () => 0,
        wait: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      cleanup.push(() => release.resolve());
      const handler = createTransactionHttpHandler(service, scope),
        controller = new AbortController();
      controller.abort();
      const suffix = ["types/task", "types/", "beads/a?view=links"][index]!;
      const spy = vi.spyOn(DatabaseSync.prototype, "prepare");
      await expect(
        handler.handle(
          new Request(url(suffix), {
            signal: controller.signal,
            headers: {
              "bdp-scope-epoch": f.store.scopeEpoch,
              "bdp-authorization-view": "development-all-visible",
              "bdp-minimum-scope-position": "pos-2",
            },
          }),
          { kind: "authenticated", principal: "principal", canMutate: true },
        ),
      ).rejects.toThrow("abort");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      const abort = new AbortController();
      const pending = service
        .readAtMinimum(principal, f.minimum("pos-2"))
        .perform(requests[index]!, { signal: abort.signal });
      const rejected = expect(pending).rejects.toThrow("abort");
      await entered.promise;
      let closed = false;
      const closing = service.close().then(() => {
        closed = true;
      });
      try {
        expect(closed).toBe(false);
        expect(() => service.readAtMinimum(principal, f.minimum())).toThrow("closing");
        abort.abort();
      } finally {
        release.resolve();
      }
      await rejected;
      await closing;
      expect(() => f.store.inspect()).toThrow("closed");
    },
  );

  it("keeps compatible missing Types and absent/deleted incident anchors separate from collisions", async () => {
    const f = prepared(),
      { plane } = f.open();
    f.write([{ operation: "createBead", id: "beads/gone", type: bead, properties: {} }]);
    f.write([{ operation: "deleteBead", bead: "beads/gone" }]);
    for (const request of [
      { kind: "resource", resource: "type", id: url("types/absent") },
      { kind: "bead-links", bead: url("beads/absent") },
      { kind: "bead-links", bead: url("beads/gone") },
    ] as const) {
      const result = await plane.minimumFor(principal, f.minimum("pos-3")).perform(request);
      expect(result).toMatchObject({
        kind: "problem",
        problem: { status: 404, code: "resource-not-found" },
      });
      expect(contexts(result).current.scopePosition).toBe("pos-3");
      for (const patch of [
        { minimumPosition: "pos-4" },
        { scopeEpoch: "foreign" },
        { authorizationView: "foreign" },
      ])
        if (request.kind === "resource") {
          await expect(
            plane.minimumFor(principal, { ...f.minimum(), ...patch }).perform(request),
          ).rejects.toBeInstanceOf(TransactionMinimumVisibilityGap);
        } else {
          const missing = await plane
            .minimumFor(principal, { ...f.minimum(), ...patch })
            .perform(request);
          expect(missing).toMatchObject({
            kind: "problem",
            problem: { status: 404, code: "resource-not-found" },
          });
          expect(contexts(missing).current.scopePosition).toBe("pos-3");
        }
    }
    f.write([{ operation: "createBead", id: "beads/empty", type: bead, properties: {} }]);
    expect(
      body(
        await plane
          .minimumFor(principal, f.minimum("pos-4"))
          .perform({ kind: "bead-links", bead: url("beads/empty") }),
      ),
    ).toEqual({ items: [], next: null });
    await expect(
      plane
        .minimumFor(principal, f.minimum("pos-5"))
        .perform({ kind: "bead-links", bead: url("beads/empty") }),
    ).rejects.toMatchObject({ reason: "behind" });
  });
});

describe("current alias minimum subset", () => {
  const principal = { kind: "anonymous" as const };
  function prepared() {
    const f = fixture();
    expect(
      f.write(
        ["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type: bead,
          properties: { title: id },
        })),
      ).status,
    ).toBe("completed");
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
      "completed",
    );
    const minimum = (minimumPosition = "pos-1") => ({
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition,
    });
    return { ...f, minimum };
  }
  function serviceFor(f: ReturnType<typeof prepared>, minimumReads = {}) {
    const service = createTransactionService(f.store, {
      ownerLifetime: "service",
      minimumReads,
      read: {
        ...f.readOptions,
        advertisedLimits: {
          ...f.readOptions.advertisedLimits,
          page: { defaultItems: 2, maximumItems: 32 },
        },
        pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
      },
    });
    cleanup.push(() => service.close());
    return service;
  }
  it.each(["direct", "service"] as const)(
    "preserves %s minimum alias receiving validation, cancellation and lifecycle precedence",
    async (mode) => {
      const f = prepared();
      let entries = 0;
      let nestedCall: (() => void) | undefined;
      const observed: ReturnType<typeof prepared> = {
        ...f,
        store: {
          ...f.store,
          withRead: (callback) => {
            entries++;
            const invoke = nestedCall;
            nestedCall = undefined;
            invoke?.();
            return f.store.withRead(callback);
          },
        },
      };
      const plane = createTransactionReadPlane(observed.store, f.readOptions);
      cleanup.push(() => plane.close());
      let tick = 0;
      const service =
        mode === "service"
          ? serviceFor(observed, { budgetMs: 2, now: () => tick++, wait: async () => {} })
          : undefined;
      const facet = service
        ? service.readAtMinimum(principal, f.minimum())
        : plane.minimumFor(principal, f.minimum());
      const call = (options: unknown) =>
        facet.resolveAlias(url("alias/work"), options as AuthorityReadDeliveryOptions);
      const invoked = vi.fn(() => {
        throw new Error("caller code must not execute");
      });
      const proxy = new Proxy(
        {},
        {
          get: invoked,
          ownKeys: invoked,
          getPrototypeOf: invoked,
          getOwnPropertyDescriptor: invoked,
        },
      );
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const invalid = [
        null,
        0,
        false,
        "",
        [],
        Object.create({}),
        proxy,
        revoked.proxy,
        { unknown: 1 },
        Object.defineProperty({}, "unknown", { value: 1 }),
        { [Symbol("hidden")]: 1 },
        {
          get signal() {
            return invoked();
          },
        },
        Object.defineProperty({}, "sourceCondition", { get: invoked }),
        ...[
          null,
          0,
          false,
          "",
          {},
          proxy,
          revoked.proxy,
          {
            get aborted() {
              return invoked();
            },
          },
        ].map((signal) => ({ signal })),
      ];
      for (const options of invalid) {
        let delivery: Promise<unknown> | undefined;
        expect(() => {
          delivery = call(options);
        }).not.toThrow();
        expect(delivery).toBeInstanceOf(Promise);
        await expect(delivery).rejects.toMatchObject({ reason: "invalid-input" });
      }
      expect(invoked).not.toHaveBeenCalled();
      expect(entries).toBe(0); // Every invalid fallback rejected; none performed an ordinary read.
      const aborted = Object.create(null);
      Object.defineProperties(aborted, {
        signal: { value: AbortSignal.abort() },
        sourceCondition: { value: revoked.proxy },
      });
      await expect(call(aborted)).rejects.toThrow("abort");
      expect(entries).toBe(0);
      const valid = Object.create(null);
      Object.defineProperties(valid, {
        signal: { value: new AbortController().signal },
        sourceCondition: { value: revoked.proxy },
      });
      await expect(call(valid)).resolves.toMatchObject({ kind: "target", target: url("beads/a") });
      expect(entries).toBe(1);
      // Caller conditions are opaque overridden data, not an alternative minimum.
      const future = service
        ? service.readAtMinimum(principal, f.minimum("pos-2"))
        : plane.minimumFor(principal, f.minimum("pos-2"));
      await expect(
        future.resolveAlias(url("alias/work"), {
          sourceCondition: f.minimum("pos-0"),
        }),
      ).rejects.toMatchObject({ reason: mode === "service" ? "catch-up-timeout" : "behind" });
      let nested: Promise<unknown> | undefined;
      nestedCall = () => {
        nested = call(proxy);
      };
      await expect(call(undefined)).resolves.toMatchObject({ kind: "target" });
      expect(nested).toBeInstanceOf(Promise);
      await expect(nested).rejects.toMatchObject({ reason: "reentrant" });
      expect(invoked).not.toHaveBeenCalled();
      if (service) {
        await service.close();
        expect(() => call(proxy)).toThrow("closing or closed"); // Existing service admission is synchronous.
      } else {
        await plane.close();
        let closed: Promise<unknown> | undefined;
        expect(() => {
          closed = call(proxy);
        }).not.toThrow();
        await expect(closed).rejects.toMatchObject({ code: "server-closed" });
      }
      expect(invoked).not.toHaveBeenCalled();
    },
  );
  it("conditions alias mapping and context in one entry without revising either target", async () => {
    const f = prepared(),
      { plane, facet } = f.open();
    const before = await Promise.all(
      ["a", "b"].map(async (id) => body(await facet.perform(resource(`beads/${id}`)))),
    );
    for (const position of ["pos-0", "pos-1"]) {
      const result = await plane
        .minimumFor(principal, f.minimum(position))
        .resolveAlias(url("alias/work"));
      expect(result).toMatchObject({ kind: "target", target: url("beads/a") });
      expect(contexts(result).current).toEqual({
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        scopePosition: "pos-1",
      });
    }
    await expect(
      plane.minimumFor(principal, f.minimum("pos-2")).resolveAlias(url("alias/work")),
    ).rejects.toMatchObject({ reason: "behind" });
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/b" })).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
    });
    const after = await plane.minimumFor(principal, f.minimum()).resolveAlias(url("alias/work"));
    expect(after).toMatchObject({ kind: "target", target: url("beads/b") });
    expect(contexts(after).current.scopePosition).toBe("pos-1");
    for (const [i, id] of ["a", "b"].entries())
      expect(body(await facet.perform(resource(`beads/${id}`)))).toEqual(before[i]);
  });
  it("rechecks a repointed alias after waiting for a real Resource effect", async () => {
    const f = prepared();
    let waits = 0;
    const service = serviceFor(f, {
      budgetMs: 10,
      now: () => 0,
      wait: async () => {
        if (++waits === 1) {
          expect(f.alias("putAlias", { alias: "alias/work", target: "beads/b" })).toMatchObject({
            status: "completed",
            requiredPosition: "pos-1",
          });
        } else {
          expect(waits).toBe(2);
          expect(
            f.write([
              {
                operation: "updateBead",
                bead: "beads/b",
                propertiesChange: [{ op: "replace", path: "/title", value: "updated" }],
              },
            ]),
          ).toMatchObject({ status: "completed", effectPosition: "pos-2" });
        }
      },
    });
    const result = await service
      .readAtMinimum(principal, f.minimum("pos-2"))
      .resolveAlias(url("alias/work"));
    expect(result).toMatchObject({ kind: "target", target: url("beads/b") });
    expect(contexts(result).current.scopePosition).toBe("pos-2");
    expect(waits).toBe(2); // Alias-only progress did not satisfy the future Resource bound.
  });
  it("keeps live alias context failures and compatible absent/deleted/dangling observations distinct", async () => {
    const f = prepared();
    let tick = 0;
    const service = serviceFor(f, { budgetMs: 2, now: () => tick++, wait: async () => {} });
    for (const [field, reason] of [
      ["scopeEpoch", "cursor-expired"],
      ["authorizationView", "foreign-view"],
    ] as const)
      await expect(
        service
          .readAtMinimum(principal, { ...f.minimum(), [field]: "foreign" })
          .resolveAlias(url("alias/work")),
      ).rejects.toMatchObject({ reason, context: { scopePosition: "pos-1" } });
    await expect(
      service.readAtMinimum(principal, f.minimum("pos-2")).resolveAlias(url("alias/work")),
    ).rejects.toMatchObject({ reason: "catch-up-timeout", context: { scopePosition: "pos-1" } });
    const checkMissing = async (suffix: string, position: string) => {
      const result = await service
        .readAtMinimum(principal, f.minimum(position))
        .resolveAlias(url(suffix));
      expect(result).toMatchObject({
        kind: "problem",
        problem: { status: 404, code: "resource-not-found" },
      });
      expect(contexts(result).current.scopePosition).toBe(position);
      await expect(
        service.readAtMinimum(principal, f.minimum("pos-99")).resolveAlias(url(suffix)),
      ).resolves.toMatchObject({
        kind: "problem",
        problem: { status: 404, code: "resource-not-found" },
      });
      await expect(
        service
          .readAtMinimum(principal, { ...f.minimum(position), authorizationView: "foreign" })
          .resolveAlias(url(suffix)),
      ).resolves.toMatchObject({
        kind: "problem",
        problem: { status: 404, code: "resource-not-found" },
      });
    };
    await checkMissing("alias/never", "pos-1");
    expect(f.alias("deleteAlias", { alias: "alias/work" }).status).toBe("completed");
    await checkMissing("alias/work", "pos-1");
    expect(f.alias("putAlias", { alias: "alias/work", target: "beads/a" }).status).toBe(
      "completed",
    );
    expect(f.write([{ operation: "deleteBead", bead: "beads/a" }]).status).toBe("completed");
    await checkMissing("alias/work", "pos-2"); // Delete the target; do not try deleting a dangling alias.
    expect(await service.readFor(principal).perform(resource("beads/b"))).toMatchObject({
      kind: "success",
    });
  });
  it("forwards ordinary and minimum Request aborts before SQL and drains an admitted alias wait", async () => {
    const f = prepared(),
      entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let entries = 0;
    const observed: ReturnType<typeof prepared> = {
      ...f,
      store: {
        ...f.store,
        withRead: (callback) => {
          entries++;
          return f.store.withRead(callback);
        },
      },
    };
    const service = serviceFor(observed, {
      budgetMs: 2,
      now: () => 0,
      wait: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    cleanup.push(() => release.resolve());
    const handler = createTransactionHttpHandler(service, scope),
      signal = AbortSignal.abort();
    entries = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare");
    for (const headers of [
      {},
      {
        "bdp-scope-epoch": f.store.scopeEpoch,
        "bdp-authorization-view": "development-all-visible",
        "bdp-minimum-scope-position": "pos-2",
      },
    ])
      await expect(
        handler.handle(new Request(url("alias/work"), { headers, signal }), {
          kind: "authenticated",
          principal: "reader",
          canMutate: false,
        }),
      ).rejects.toThrow("abort");
    expect(spy).not.toHaveBeenCalled();
    expect(entries).toBe(0);
    spy.mockRestore();
    const controller = new AbortController();
    const pending = service
      .readAtMinimum(principal, f.minimum("pos-2"))
      .resolveAlias(url("alias/work"), { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("abort");
    await entered.promise;
    expect(entries).toBe(1);
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });
    try {
      expect(closed).toBe(false);
      expect(() => service.readAtMinimum(principal, f.minimum())).toThrow("closing");
      controller.abort();
    } finally {
      release.resolve();
    }
    await rejected;
    await closing;
    expect(closed).toBe(true);
    expect(() => f.store.inspect()).toThrow("closed");
  });
  it("does not relabel alias provider or malformed context failures as missing", async () => {
    const f = prepared(),
      sentinel = new Error("alias provider failed");
    let fault: "context" | "provider" | "target" | undefined = "context";
    type Reader = Parameters<typeof f.store.captureReadAuthorization>[0];
    const originalReaders = new WeakMap<Reader, Reader>();
    const owner: typeof f.store = {
      ...f.store,
      captureReadAuthorization: (reader, principal) =>
        f.store.captureReadAuthorization(originalReaders.get(reader) ?? reader, principal),
      withRead: (callback) =>
        f.store.withRead((reader, captured) => {
          if (fault === "provider") throw sentinel;
          const exposed =
            fault === "target" ? { ...reader, alias: () => "links/not-a-bead" } : reader;
          originalReaders.set(exposed, reader);
          try {
            return callback(
              exposed,
              fault === "context" ? { ...captured, scopePosition: "pos-02" } : captured,
            );
          } finally {
            originalReaders.delete(exposed);
          }
        }),
    };
    const plane = createTransactionReadPlane(owner, f.readOptions);
    cleanup.push(() => plane.close());
    const read = plane.minimumFor(principal, f.minimum());
    await expect(read.resolveAlias(url("alias/work"))).rejects.toThrow(
      "invalid Transactional Read context",
    );
    fault = "provider";
    await expect(read.resolveAlias(url("alias/work"))).rejects.toBe(sentinel);
    fault = "target";
    await expect(read.resolveAlias(url("alias/work"))).rejects.toThrow(
      "invalid stored alias target",
    );
    fault = undefined;
    expect(await read.resolveAlias(url("alias/work"))).toMatchObject({
      kind: "target",
      target: url("beads/a"),
    });
  });
});

describe("current minimum perform receiving", () => {
  it("preserves a direct non-enumerable pre-aborted signal before owner entry", async () => {
    const f = fixture();
    expect(f.write(seed).status).toBe("completed");
    let entries = 0;
    const plane = createTransactionReadPlane(
      {
        ...f.store,
        withRead: (callback) => {
          entries++;
          return f.store.withRead(callback);
        },
      },
      f.readOptions,
    );
    cleanup.push(() => plane.close());
    const facet = plane.minimumFor(
      { kind: "anonymous" },
      {
        scopeEpoch: f.store.scopeEpoch,
        authorizationView: "development-all-visible",
        minimumPosition: "pos-1",
      },
    );
    const options = Object.defineProperty({}, "signal", { value: AbortSignal.abort() });
    const delivery = facet.perform(resource("beads/a"), options);
    expect(delivery).toBeInstanceOf(Promise);
    await expect(delivery).rejects.toMatchObject({ code: "operation-aborted" });
    expect(entries).toBe(0);
  });

  const principal = { kind: "anonymous" as const };
  function prepared() {
    const f = fixture();
    expect(f.write(seed).status).toBe("completed");
    const minimum = (minimumPosition = "pos-1") => ({
      scopeEpoch: f.store.scopeEpoch,
      authorizationView: "development-all-visible",
      minimumPosition,
    });
    return { ...f, minimum };
  }
  function serviceFor(f: ReturnType<typeof prepared>, minimumReads = {}) {
    const service = createTransactionService(f.store, {
      ownerLifetime: "service",
      minimumReads,
      read: {
        ...f.readOptions,
        advertisedLimits: {
          ...f.readOptions.advertisedLimits,
          page: { defaultItems: 2, maximumItems: 32 },
        },
        pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
      },
    });
    cleanup.push(() => service.close());
    return service;
  }
  it.each(["direct", "service"] as const)(
    "preserves %s minimum perform receiving validation, cancellation and lifecycle precedence",
    async (mode) => {
      const f = prepared();
      let entries = 0;
      let nestedCall: (() => void) | undefined;
      const observed: ReturnType<typeof prepared> = {
        ...f,
        store: {
          ...f.store,
          withRead: (callback) => {
            entries++;
            const invoke = nestedCall;
            nestedCall = undefined;
            invoke?.();
            return f.store.withRead(callback);
          },
        },
      };
      const plane = createTransactionReadPlane(observed.store, f.readOptions);
      cleanup.push(() => plane.close());
      let tick = 0;
      const service =
        mode === "service"
          ? serviceFor(observed, { budgetMs: 2, now: () => tick++, wait: async () => {} })
          : undefined;
      const facet = service
        ? service.readAtMinimum(principal, f.minimum())
        : plane.minimumFor(principal, f.minimum());
      const call = (options: unknown) =>
        facet.perform(resource("beads/a"), options as AuthorityReadDeliveryOptions);
      const invoked = vi.fn(() => {
        throw new Error("caller code must not execute");
      });
      const proxy = new Proxy(
        {},
        {
          get: invoked,
          ownKeys: invoked,
          getPrototypeOf: invoked,
          getOwnPropertyDescriptor: invoked,
        },
      );
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const invalid = [
        null,
        0,
        false,
        "",
        [],
        Object.create({}),
        proxy,
        revoked.proxy,
        { unknown: 1 },
        Object.defineProperty({}, "unknown", { value: 1 }),
        Object.defineProperty({}, "signal", { value: 1 }),
        Object.defineProperty({}, "signal", { get: invoked }),
        { [Symbol("hidden")]: 1 },
        {
          get signal() {
            return invoked();
          },
        },
        Object.defineProperty({}, "sourceCondition", { get: invoked }),
        ...[
          null,
          0,
          false,
          "",
          {},
          proxy,
          revoked.proxy,
          {
            get aborted() {
              return invoked();
            },
          },
        ].map((signal) => ({ signal })),
      ];
      for (const options of invalid) {
        let delivery: Promise<unknown> | undefined;
        expect(() => {
          delivery = call(options);
        }).not.toThrow();
        expect(delivery).toBeInstanceOf(Promise);
        await expect(delivery).rejects.toMatchObject({ reason: "invalid-input" });
      }
      expect(invoked).not.toHaveBeenCalled();
      expect(entries).toBe(0); // Every invalid fallback rejected; none performed an ordinary read.
      const aborted = Object.create(null);
      Object.defineProperties(aborted, {
        signal: { value: AbortSignal.abort() },
        sourceCondition: { value: revoked.proxy },
      });
      await expect(call(aborted)).rejects.toThrow("abort");
      expect(entries).toBe(0);
      const valid = Object.create(null);
      Object.defineProperties(valid, {
        signal: { value: new AbortController().signal },
        sourceCondition: { value: revoked.proxy },
      });
      await expect(call(valid)).resolves.toMatchObject({
        kind: "success",
        body: { id: url("beads/a") },
      });
      expect(entries).toBe(1);
      // Caller conditions are opaque overridden data, not an alternative minimum.
      const future = service
        ? service.readAtMinimum(principal, f.minimum("pos-2"))
        : plane.minimumFor(principal, f.minimum("pos-2"));
      await expect(
        future.perform(resource("beads/a"), {
          sourceCondition: f.minimum("pos-0"),
        }),
      ).rejects.toMatchObject({ reason: mode === "service" ? "catch-up-timeout" : "behind" });
      let nested: Promise<unknown> | undefined;
      nestedCall = () => {
        nested = call(proxy);
      };
      await expect(call(undefined)).resolves.toMatchObject({ kind: "success" });
      expect(nested).toBeInstanceOf(Promise);
      await expect(nested).rejects.toMatchObject({ reason: "reentrant" });
      expect(invoked).not.toHaveBeenCalled();
      if (service) {
        await service.close();
        expect(() => call(proxy)).toThrow("closing or closed"); // Existing service admission is synchronous.
      } else {
        await plane.close();
        let closed: Promise<unknown> | undefined;
        expect(() => {
          closed = call(proxy);
        }).not.toThrow();
        await expect(closed).rejects.toMatchObject({ code: "server-closed" });
      }
      expect(invoked).not.toHaveBeenCalled();
    },
  );
});

it("uses actual current policy for missing-first and unproved Resource attempts", async () => {
  const f = fixture();
  f.write([
    { operation: "createBead", id: "beads/a", type: bead, properties: { title: "a" } },
    { operation: "createLink", id: "links/self", type: link, source: "beads/a", target: "beads/a" },
  ]);
  f.alias("putAlias", { alias: "alias/work", target: "beads/a" });
  let entries = 0,
    waits = 0,
    tick = 0,
    transition = false;
  const owner: typeof f.store = {
    ...f.store,
    withRead: (callback) => {
      entries++;
      return f.store.withRead(callback);
    },
  };
  const service = createTransactionService(owner, {
    ownerLifetime: "service",
    read: {
      ...f.readOptions,
      advertisedLimits: {
        ...f.readOptions.advertisedLimits,
        page: { defaultItems: 2, maximumItems: 32 },
      },
      pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
    },
    minimumReads: {
      budgetMs: 7,
      now: () => tick,
      wait: async (ms) => {
        waits++;
        tick += ms;
        if (transition) {
          transition = false;
          await service.replaceAuthorizationPolicy({ timeoutMs: 1000 });
        }
      },
    },
  });
  cleanup.push(() => service.close());
  const principal = { kind: "authenticated" as const, principal: { id: "principal" } };
  const minimum = {
    scopeEpoch: f.store.scopeEpoch,
    authorizationView: "development-all-visible",
    minimumPosition: "opaque",
  };
  // A genuine signal can have an own getter. Its receiving callback must
  // not redirect the request after the private minimum route was captured.
  const originalBody = body(await service.readFor(principal).perform(resource("beads/a")));
  const mutableRequest: Record<string, unknown> = { ...resource("beads/a") };
  const mutatingSignal = new AbortController().signal;
  let signalReads = 0;
  Object.defineProperty(mutatingSignal, "aborted", {
    get() {
      signalReads++;
      delete mutableRequest.resource;
      delete mutableRequest.id;
      mutableRequest.kind = "collection";
      mutableRequest.collection = "types";
      return false;
    },
  });
  const capturedResult = await service
    .readAtMinimum(principal, { ...minimum, minimumPosition: "pos-1" })
    .perform(mutableRequest as unknown as ReadRequest, { signal: mutatingSignal });
  expect(signalReads).toBeGreaterThan(0);
  expect(mutableRequest.kind).toBe("collection");
  expect(body(capturedResult)).toEqual(originalBody);
  let requestGetterCalls = 0;
  const invalidRequest = Object.defineProperty({ ...resource("beads/a") }, "id", {
    get() {
      requestGetterCalls++;
      return url("beads/a");
    },
  });
  await expect(
    service.readAtMinimum(principal, minimum).perform(invalidRequest),
  ).rejects.toMatchObject({ reason: "invalid-input" });
  expect(requestGetterCalls).toBe(0);
  for (const token of ["opaque", "pos-01", "pos-9007199254740992"]) {
    const start = entries;
    await expect(
      service
        .readAtMinimum(principal, { ...minimum, minimumPosition: token })
        .perform(resource("beads/a")),
    ).rejects.toMatchObject({ reason: "catch-up-timeout", context: { scopePosition: "pos-1" } });
    expect(entries - start).toBe(3);
  }
  const beforeMissing = waits;
  for (const request of [
    resource("beads/missing"),
    { kind: "properties", resource: "link", id: url("links/missing") },
    { kind: "bead-links", bead: url("beads/missing") },
  ] as const) {
    const before = entries;
    const result = await service
      .readAtMinimum(principal, { ...minimum, scopeEpoch: "foreign" })
      .perform(request);
    expect(result).toMatchObject({
      kind: "problem",
      phase: "observed",
      problem: { status: 404, code: "resource-not-found" },
    });
    expect(contexts(result).current).toEqual({
      scopeEpoch: minimum.scopeEpoch,
      authorizationView: minimum.authorizationView,
      scopePosition: "pos-1",
    });
    expect(entries - before).toBe(1);
  }
  expect(waits).toBe(beforeMissing);
  transition = true;
  const hidden = await service.readAtMinimum(principal, minimum).perform(resource("beads/a"));
  expect(hidden).toMatchObject({
    kind: "problem",
    problem: { status: 404, code: "resource-not-found" },
  });
  const current = contexts(hidden).current;
  expect(current.authorizationView).not.toBe(minimum.authorizationView);
  const missing = await service
    .readAtMinimum(principal, { ...minimum, authorizationView: current.authorizationView })
    .perform(resource("beads/missing"));
  expect((missing as { problem: unknown }).problem).toEqual(
    (hidden as { problem: unknown }).problem,
  );
  expect(contexts(missing).current).toEqual(current);
  for (const request of [
    resource("links/self", "link"),
    { kind: "properties", resource: "bead", id: url("beads/a") },
    { kind: "bead-links", bead: url("beads/a") },
  ] as const) {
    const start = entries,
      priorWaits = waits;
    const result = await service.readAtMinimum(principal, minimum).perform(request);
    expect(result).toMatchObject({
      kind: "problem",
      problem: { status: 404, code: "resource-not-found" },
    });
    expect(contexts(result).current).toEqual(current);
    expect(entries - start).toBe(1);
    expect(waits).toBe(priorWaits);
  }
  const start = entries,
    priorWaits = waits;
  const alias = await service.readAtMinimum(principal, minimum).resolveAlias(url("alias/work"));
  expect(alias).toMatchObject({
    kind: "problem",
    problem: { status: 404, code: "resource-not-found" },
  });
  expect(contexts(alias).current).toEqual(current);
  expect(entries - start).toBe(1);
  expect(waits).toBe(priorWaits);
});
it("drains an admitted unknown minimum to timeout and rejects new reads while closing", async () => {
  const f = fixture();
  f.write([{ operation: "createBead", id: "beads/a", type: bead }]);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let tick = 0;
  const service = createTransactionService(f.store, {
    ownerLifetime: "service",
    read: {
      ...f.readOptions,
      advertisedLimits: {
        ...f.readOptions.advertisedLimits,
        page: { defaultItems: 2, maximumItems: 32 },
      },
      pagination: { ...f.readOptions.pagination, maxPageItems: 32 },
    },
    minimumReads: {
      budgetMs: 2,
      now: () => tick,
      wait: async (ms) => {
        entered.resolve();
        await release.promise;
        tick += ms;
      },
    },
  });
  cleanup.push(() => service.close());
  cleanup.push(() => release.resolve());
  const principal = { kind: "anonymous" as const };
  const minimum = {
    scopeEpoch: f.store.scopeEpoch,
    authorizationView: "development-all-visible",
    minimumPosition: "opaque",
  };
  const pending = service.readAtMinimum(principal, minimum).perform(resource("beads/a"));
  const rejected = expect(pending).rejects.toMatchObject({ reason: "catch-up-timeout" });
  await entered.promise;
  const closing = service.close();
  expect(() => service.readAtMinimum(principal, minimum)).toThrow("closing");
  release.resolve();
  await rejected;
  await closing;
});
