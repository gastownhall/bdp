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
import { createTransactionReadPlane, transactionReadContexts } from "./transaction-read.js";
import type { ReadObservation } from "./authority-read.js";
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
  function open() {
    const plane = createTransactionReadPlane(store, readOptions);
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
    // Each of the two owner entries reads both position and epoch metadata.
    expect(observations).toBe(4);
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
