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
import { createTransactionReadPlane } from "./transaction-read.js";
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
