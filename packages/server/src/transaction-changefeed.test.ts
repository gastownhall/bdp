import assert from "node:assert/strict";
import { constants } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  isJsonSchemaUri,
  isJsonSchemaDateTime,
  parseTypeDescriptor,
  stringifyJsonValue,
} from "@bdp/protocol";
import type { ResourceRecord } from "./resource-evaluator.js";
import { openTransactionStore, type TransactionReadContext } from "./transaction-store.js";
import { prepareTransactionSetCore, prepareTransactionSingleton } from "./transaction-batch.js";
import { createTransactionService } from "./transaction-service.js";
import { TransactionMinimumFailure } from "./transaction-consistency.js";
import {
  TRANSACTION_CHANGEFEED_BYTES,
  transactionCheckpoint,
  checkpointPosition,
  transactionChangefeedRequest,
  projectTransactionChangeGroup,
  TransactionChangefeedParameterError,
  type TransactionChangeGroup,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";
import type { TransactionRuntimeTestSeams } from "./transaction-runtime.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const scope = "https://example.test/feed/",
  beadType = `${scope}types/bead`,
  linkType = `${scope}types/link`;
const types = [
  {
    id: beadType,
    name: "Owner",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing: { [linkType]: { max: 4 } },
  },
  {
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  },
].map((value) => parseTypeDescriptor(value));
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: beadType,
  properties: { n: 0 },
});
const edge = (id: string, source = "a", target = "b") => ({
  operation: "createLink",
  id: `links/${id}`,
  type: linkType,
  source: `beads/${source}`,
  target: `beads/${target}`,
  properties: { n: 0 },
});
const update = (id: string, n: number) => ({
  operation: "updateLink",
  link: `links/${id}`,
  propertiesChange: [{ op: "replace", path: "/n", value: n }],
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-feed-"));
  const options = {
    file: path.join(directory, "store.sqlite"),
    scope,
    types,
    create: true,
    receiptMaximumItems: 2,
  };
  let owner = openTransactionStore(options),
    key = 0;
  cleanup.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get owner() {
      return owner;
    },
    options,
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    run(operations: unknown[]) {
      const admitted = owner.admit(
        "p",
        `key_${key++}`,
        prepareTransactionSetCore(scope, JSON.stringify({ operations })),
      );
      if (admitted.kind !== "owned") throw Error("admission");
      return owner.execute(admitted.claim);
    },
  };
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(schema);
const validPage = ajv.compile({ $ref: `${schema.$id}#/$defs/changefeedPage` });
const validProblem = ajv.compile({ $ref: `${schema.$id}#/$defs/transactionalProblem` });
function page(owner: ReturnType<typeof openTransactionStore>, after = "genesis") {
  const observed = owner.readChanges(after);
  if (observed.kind !== "page") throw Error(observed.kind);
  expect(validPage(observed.page), JSON.stringify(validPage.errors)).toBe(true);
  expect(observed.page.observedHeadPosition).toBe(observed.context.scopePosition);
  return observed.page;
}
function collect(owner: ReturnType<typeof openTransactionStore>) {
  const pages: TransactionChangefeedPage[] = [];
  let after = "genesis";
  for (;;) {
    const current = page(owner, after);
    pages.push(current);
    if (!current.next) break;
    const next = new URL(current.next);
    expect(next.origin + next.pathname).toBe(`${scope}changes/`);
    after = next.searchParams.get("after") ?? "";
  }
  return pages;
}
function authority(owner: ReturnType<typeof openTransactionStore>) {
  const observed = owner.withRead(
    (reader) =>
      new Map(
        reader.resources().map((row) => {
          const value = JSON.parse(row.bodyJson) as ResourceRecord;
          return [value.id, value];
        }),
      ),
  );
  if (observed.kind !== "read") throw Error("read");
  return observed.value;
}
/** Test replica oracle: stage complete changes; publish graph+cursor only together.
 * Positions are compared exclusively by equality, never parsed or ordered. */
function replica(context: TransactionReadContext) {
  let graph = new Map<string, ResourceRecord>(),
    checkpoint = "genesis",
    position = "pos-0";
  const applied = new Map<string, string>();
  return {
    state: () => ({ graph, checkpoint, position }),
    apply(group: TransactionChangeGroup, failBeforePublish = false) {
      assert.equal(group.scopeEpoch, context.scopeEpoch);
      assert.equal(group.authorizationView, context.authorizationView);
      const bytes = stringifyJsonValue(group),
        duplicate = applied.get(group.checkpoint);
      if (duplicate !== undefined) {
        assert.equal(bytes, duplicate);
        return;
      }
      assert.equal(group.previousPosition, position);
      const staged = new Map(graph);
      for (const change of group.changes) {
        if (change.operation === "upsert")
          staged.set(change.resource.id, structuredClone(change.resource) as ResourceRecord);
        else staged.delete(change.resource.id);
      }
      for (const resource of staged.values())
        for (const links of Object.values(
          "ownedLinks" in resource ? (resource.ownedLinks ?? {}) : {},
        )) {
          for (const link of links) {
            assert.equal(link.source, resource.id);
            assert.deepEqual(staged.get(link.id), link);
          }
        }
      for (const resource of staged.values())
        if ("source" in resource && resource.type === linkType) {
          const source = staged.get(
            typeof resource.source === "string" ? resource.source : resource.source.uri,
          );
          assert.ok(source && "ownedLinks" in source);
          assert.deepEqual(
            source.ownedLinks?.[linkType]?.find((link) => link.id === resource.id),
            resource,
          );
        }
      if (failBeforePublish) throw Error("replica publication failed");
      graph = staged;
      checkpoint = group.checkpoint;
      position = group.position;
      applied.set(checkpoint, bytes);
    },
  };
}
it("serves normalized whole groups and identical Scope facts for atomic replica reconstruction", () => {
  const f = fixture();
  f.run([create("a"), create("b")]);
  f.run([edge("l"), update("l", 1), update("l", 0)]);
  f.run([edge("temporary", "a", "a"), { operation: "deleteLink", link: "links/temporary" }]);
  const count = f.owner.inspect().groups.length;
  expect(f.run([update("l", 0)]).effectPosition).toBeUndefined();
  expect(f.run([create("rollback"), create("a")]).status).toBe("failed");
  const alias = f.owner.admit(
    "p",
    "alias",
    prepareTransactionSingleton(
      scope,
      "putAlias",
      JSON.stringify({ alias: "alias/work", target: "beads/a" }),
    ),
  );
  if (alias.kind !== "owned") throw Error("alias");
  expect(f.owner.execute(alias.claim).effectPosition).toBeUndefined();
  expect(f.owner.inspect().groups).toHaveLength(count);
  const pages = collect(f.owner),
    groups = pages.flatMap((value) => value.groups),
    view = f.owner.readConfiguration();
  const client = replica({
    scopeEpoch: view.scopeEpoch,
    authorizationView: view.authorizationView,
    scopePosition: "pos-0",
  });
  const facts = [];
  let after: string | undefined;
  do {
    const observed = f.owner.readEvents(`${scope}events/`, after);
    if (observed.kind !== "page") throw Error("events");
    facts.push(...observed.page.events);
    after = observed.page.next
      ? (new URL(observed.page.next).searchParams.get("after") ?? undefined)
      : undefined;
  } while (after);
  expect(groups.flatMap((group) => group.events)).toEqual(facts);
  expect(groups).toHaveLength(3);
  expect(groups[1]?.events).toHaveLength(8);
  expect(groups[1]?.changes).toHaveLength(2);
  expect(
    groups[2]?.changes.find((change) => change.resource.id.endsWith("/temporary"))?.operation,
  ).toBe("tombstone");
  for (const group of groups) client.apply(group);
  expect(client.state().graph).toEqual(authority(f.owner));
  expect(pages[0]?.observedHeadPosition).toBe(groups.at(-1)?.position);
  expect(pages[0]?.observedHeadPosition).not.toBe(groups[0]?.position);
  expect(Object.isFrozen(groups[0]?.changes[0]?.resource)).toBe(true);
  const saved = structuredClone(pages);
  f.reopen();
  expect(collect(f.owner)).toEqual(saved);
});
it("replica refuses partial publication, gaps, conflicts and owned upsert/tombstone disagreement", () => {
  const f = fixture();
  f.run([create("a"), create("b")]);
  f.run([edge("l")]);
  f.run([{ operation: "deleteLink", link: "links/l" }]);
  const groups = collect(f.owner).flatMap((value) => value.groups),
    config = f.owner.readConfiguration();
  const client = replica({ ...config, scopePosition: "pos-0" });
  const [seed, created, deleted] = groups;
  if (!seed || !created || !deleted) throw Error("groups");
  expect(() => client.apply(seed, true)).toThrow("publication failed");
  expect(client.state()).toEqual({ graph: new Map(), checkpoint: "genesis", position: "pos-0" });
  client.apply(seed);
  const before = client.state();
  for (const bad of [
    { ...created, previousPosition: "different" },
    { ...created, scopeEpoch: "foreign" },
    { ...created, authorizationView: "foreign" },
    { ...created, changes: created.changes.filter((change) => change.resourceKind !== "bead") },
    {
      ...created,
      changes: created.changes.map((change) =>
        change.resourceKind === "link"
          ? { ...change, resource: { ...change.resource, revision: "disagrees" } }
          : change,
      ),
    },
  ]) {
    expect(() => client.apply(bad)).toThrow();
    expect(client.state()).toEqual(before);
  }
  client.apply(created);
  const linked = client.state();
  const badDelete = {
    ...deleted,
    changes: deleted.changes.filter((change) => change.resourceKind !== "bead"),
  };
  expect(() => client.apply(badDelete)).toThrow();
  expect(client.state()).toEqual(linked);
  client.apply(created);
  expect(client.state()).toEqual(linked);
  expect(() => client.apply({ ...created, eventCount: created.eventCount + 1 })).toThrow();
  client.apply(deleted);
  expect(client.state().graph).toEqual(authority(f.owner));
});
it("keeps genesis checkpoint distinct from zero position and resumes after an empty caught-up page", () => {
  const f = fixture();
  expect(page(f.owner)).toMatchObject({
    after: "genesis",
    observedHeadPosition: "pos-0",
    groups: [],
    next: null,
  });
  expect(f.owner.captureChangesStart()).toBe("genesis");
  f.run([create("a")]);
  const group = page(f.owner).groups[0];
  if (!group) throw Error("group");
  expect(page(f.owner, group.checkpoint)).toMatchObject({
    after: group.checkpoint,
    observedHeadPosition: "pos-1",
    groups: [],
    next: null,
  });
  f.run([create("b")]);
  expect(page(f.owner, group.checkpoint).groups[0]?.previousPosition).toBe(group.position);
});
it("uses bounded context-fenced checkpoints, never Event IDs/raw positions/future rows", () => {
  const f = fixture();
  f.run([create("a")]);
  const context = { ...f.owner.readConfiguration(), scopePosition: "pos-1" };
  const token = transactionCheckpoint(scope, context, Number.MAX_SAFE_INTEGER);
  expect(token.length).toBeLessThanOrEqual(256);
  expect(checkpointPosition(scope, context, token)).toBe(Number.MAX_SAFE_INTEGER);
  for (const bad of ["", "pos-1", "ev_invalid", token, `${token}=`, token.toUpperCase()])
    expect(() => f.owner.readChanges(bad)).toThrow(TransactionChangefeedParameterError);
  expect(() =>
    f.owner.readChanges(transactionCheckpoint(scope, { ...context, scopeEpoch: "old" }, 1)),
  ).toThrowError(expect.objectContaining({ reason: "cursor-expired" }));
  expect(() =>
    f.owner.readChanges(
      transactionCheckpoint(scope, { ...context, authorizationView: "other" }, 1),
    ),
  ).toThrowError(expect.objectContaining({ reason: "foreign-view" }));
  expect(() =>
    f.owner.readChanges(transactionCheckpoint("https://other.test/", context, 1)),
  ).toThrow(TransactionMinimumFailure);
});
it.each([
  "",
  "?after=genesis&start=now",
  "?start=then",
  "?after=",
  "?after=genesis&after=genesis",
  "?start=now&limit=1",
])("rejects invalid feed intent %s with the local parameter convention", (query) => {
  expect(() => transactionChangefeedRequest(new URL(`${scope}changes/${query}`), scope)).toThrow(
    TransactionChangefeedParameterError,
  );
});
it("fails closed on corrupt stored framing without renumbering or changing graph state", () => {
  const f = fixture();
  f.run([create("a")]);
  const raw = f.owner.inspect().groups[0] as TransactionChangeGroup,
    context = { ...f.owner.readConfiguration(), scopePosition: "pos-1" };
  for (const change of [
    { previousPosition: "wrong" },
    { projectionAdvance: true },
    { events: [], changes: [], eventCount: 0 },
    { events: raw.events.map((event) => ({ ...event, ordinal: event.ordinal + 1 })) },
    { eventCount: 100 },
  ])
    expect(() => projectTransactionChangeGroup({ ...raw, ...change }, scope, context, 1)).toThrow();
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  db.prepare("UPDATE groups SET body=? WHERE position=1").run(
    JSON.stringify({ ...raw, previousPosition: "wrong" }),
  );
  db.close();
  f.reopen();
  expect(() => f.owner.readChanges("genesis")).toThrow("framing");
  expect(authority(f.owner).size).toBe(1);
});
it("does not classify a missing previously committed cursor row as never issued or skip its gap", () => {
  const f = fixture();
  f.run([create("a")]);
  f.run([create("b")]);
  const checkpoint = f.owner.captureChangesStart();
  f.run([create("c")]);
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  db.prepare("DELETE FROM groups WHERE position=2").run();
  db.close();
  f.reopen();
  expect(() => f.owner.readChanges(checkpoint)).toThrow("missing retained change group");
  expect(() => f.owner.readChanges("genesis")).toThrow("missing retained change group");
});
it("serves all256 boundary Events as one group despite a two-item receipt page setting", () => {
  const f = fixture();
  for (let start = 0; start < 64; start += 32)
    f.run(Array.from({ length: 32 }, (_, i) => create(`a${start + i}`)));
  for (let start = 0; start < 64; start += 32)
    f.run(
      Array.from({ length: 32 }, (_, i) => edge(`l${start + i}`, `a${start + i}`, `a${start + i}`)),
    );
  const checkpoint = f.owner.captureChangesStart();
  expect(
    f.run([{ operation: "deleteWhere", collection: "links", selector: "$[?@.properties.n == 0]" }])
      .status,
  ).toBe("completed");
  const result = page(f.owner, checkpoint);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]?.events).toHaveLength(256);
  expect(result.next).toBeNull();
  expect(TRANSACTION_CHANGEFEED_BYTES).toBe(270482968);
  expect(TRANSACTION_CHANGEFEED_BYTES).toBeLessThan(constants.MAX_STRING_LENGTH);
  expect(Buffer.byteLength(stringifyJsonValue(result))).toBeLessThan(TRANSACTION_CHANGEFEED_BYTES);
});
it("captures feed body and serving context inside one fenced owner entry", () => {
  const f = fixture();
  f.run([create("a")]);
  const original = DatabaseSync.prototype.prepare;
  let attempted = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (!attempted && sql.includes("length(CAST(body AS BLOB))")) {
      attempted = true;
      expect(() => f.run([create("cannot-interleave")])).toThrow("reentrant");
    }
    return original.call(this, sql);
  });
  const observed = f.owner.readChanges("genesis");
  expect(attempted).toBe(true);
  expect(observed).toMatchObject({
    context: { scopePosition: "pos-1" },
    page: { observedHeadPosition: "pos-1" },
  });
  expect(authority(f.owner).size).toBe(1);
});
it("serves representative large postimages whole without importing the Event page byte cap", () => {
  const f = fixture();
  f.run([create("a")]);
  for (let index = 0; index < 4; index++)
    f.run([
      {
        operation: "updateBead",
        bead: "beads/a",
        metadataChange: [{ op: "add", path: `/chunk${index}`, value: "x".repeat(50000) }],
      },
    ]);
  const anchor = f.owner.captureChangesStart();
  f.run([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
  ]);
  const result = page(f.owner, anchor),
    value = result.groups[0]?.changes[0]?.resource;
  expect(Buffer.byteLength(stringifyJsonValue(value))).toBeGreaterThan(200000);
  expect(result.groups).toHaveLength(1);
  expect(result.next).toBeNull();
  expect(value).toEqual(authority(f.owner).get(`${scope}beads/a`));
});
it("refuses feed reads after uncertain commit fencing and recovers the committed group on reopen", () => {
  const f = fixture(),
    original = DatabaseSync.prototype.exec;
  let commits = 0;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    const result = original.call(this, sql);
    if (sql === "COMMIT" && ++commits === 2) throw Error("uncertain terminal commit");
    return result;
  });
  expect(() => f.run([create("a")])).toThrow();
  expect(() => f.owner.readChanges("genesis")).toThrow();
  expect(() => f.owner.captureChangesStart()).toThrow();
  vi.restoreAllMocks();
  f.reopen();
  expect(page(f.owner).groups[0]?.changes[0]?.resource.id).toBe(`${scope}beads/a`);
  f.owner.close();
  expect(() => f.owner.readChanges("genesis")).toThrow();
});
it("bounds rendered Scope/next overhead with a long installed Scope and no long cursor", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-feed-long-")),
    longScope = `https://example.test/${"s".repeat(40000)}/`;
  const owner = openTransactionStore({
    file: path.join(directory, "store.sqlite"),
    scope: longScope,
    create: true,
    types,
  });
  cleanup.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const id of ["a", "b"]) {
    const admitted = owner.admit(
      "p",
      id,
      prepareTransactionSetCore(longScope, JSON.stringify({ operations: [create(id)] })),
    );
    if (admitted.kind !== "owned") throw Error("admission");
    owner.execute(admitted.claim);
  }
  const result = page(owner),
    group = result.groups[0];
  expect(group?.events[0]?.source).toBe(`${longScope}events/`);
  expect(group?.events[0]?.id.length).toBeLessThanOrEqual(256);
  expect(group?.checkpoint.length).toBeLessThanOrEqual(256);
  expect(result.next?.startsWith(`${longScope}changes/?after=`)).toBe(true);
  expect(Buffer.byteLength(stringifyJsonValue(result))).toBeLessThan(TRANSACTION_CHANGEFEED_BYTES);
});
function service(
  f: ReturnType<typeof fixture>,
  minimumReads: NonNullable<Parameters<typeof createTransactionService>[1]["minimumReads"]>,
) {
  let token = 0;
  const instance = createTransactionService(f.owner, {
    ownerLifetime: "service",
    minimumReads,
    read: {
      selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
      advertisedLimits: {
        page: { defaultItems: 2, maximumItems: 2 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 1000,
      },
      pagination: {
        scope,
        defaultPageItems: 2,
        maxPageItems: 2,
        cursorTtlMs: 1000,
        retainedStateCapacity: 100,
        maxRetainedCursorPositionsPerSnapshot: 20,
        retainedSnapshotByteCapacity: 100000,
        retainedSnapshotNodeCapacity: 10000,
        maxOpaqueTokenLength: 64,
        tokenGenerationAttempts: 3,
        idleCleanup: "on-demand",
        clock: () => 1000,
        generateOpaqueToken: () => `cursor_${++token}`,
      },
    },
  });
  cleanup.push(() => instance.close());
  return instance;
}
it("keeps start=now's original admission anchor through a minimum wait and drains on close", async () => {
  const f = fixture();
  f.run([create("a")]);
  const initial = f.owner.captureChangesStart();
  let tick = 0;
  const instance = service(f, {
    budgetMs: 20,
    now: () => tick,
    wait: async (ms) => {
      tick += ms;
      f.run([create("b")]);
    },
  });
  const config = f.owner.readConfiguration();
  const pending = instance.changes(
    { start: "now" },
    {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      minimumPosition: "pos-2",
    },
  );
  const closing = instance.close();
  const observed = await pending;
  if (observed.kind !== "page") throw Error("page");
  expect(observed.page.after).toBe(initial);
  expect(observed.page.groups).toHaveLength(1);
  expect(observed.page.groups[0]?.changes[0]?.resource.id).toBe(`${scope}beads/b`);
  expect(observed.context.scopePosition).toBe("pos-2");
  await closing;
  expect(() => instance.changes({ after: "genesis" })).toThrow("closed");
});
async function httpFixture(seams: TransactionRuntimeTestSeams = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-feed-http-")),
    token = "a".repeat(32);
  let runtime = await startTransactionRuntime(
    {
      scope,
      directory,
      create: true,
      port: 0,
      types,
      credentials: [{ token, principal: "p", canMutate: true }],
    },
    seams,
  );
  cleanup.push(async () => {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    request(target: string, init: RequestInit = {}) {
      const canonical = new URL(target, scope);
      return fetch(new URL(canonical.pathname + canonical.search, runtime.listenUrl), {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      });
    },
    async reopen() {
      await runtime.close();
      runtime = await startTransactionRuntime(
        {
          scope,
          directory,
          create: false,
          port: 0,
          types,
          credentials: [{ token, principal: "p", canMutate: true }],
        },
        seams,
      );
    },
  };
}
it("serves actual HTTP finite GET/HEAD, absolute navigation, native conditions and restart", async () => {
  const f = await httpFixture();
  for (const id of ["a", "b"])
    expect(
      (
        await f.request("operations/batch", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": id },
          body: JSON.stringify({ operations: [create(id)] }),
        })
      ).status,
    ).toBe(200);
  const first = await f.request("changes/?after=genesis"),
    firstPage = (await first.json()) as TransactionChangefeedPage;
  expect(first.status).toBe(200);
  expect(validPage(firstPage), JSON.stringify(validPage.errors)).toBe(true);
  expect(first.headers.get("bdp-scope-position")).toBe(firstPage.observedHeadPosition);
  expect(firstPage.groups).toHaveLength(1);
  expect(firstPage.next).toMatch(/^https:\/\/example.test\/feed\/changes\//);
  if (!firstPage.next) throw Error("next");
  const second = await f.request(firstPage.next),
    secondPage = (await second.json()) as TransactionChangefeedPage;
  expect(secondPage.groups[0]?.previousPosition).toBe(firstPage.groups[0]?.position);
  expect(secondPage.next).toBeNull();
  const head = await f.request("changes/?after=genesis", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(first.headers.get("content-length"));
  expect(await head.text()).toBe("");
  for (const [headers, status] of [
    [{ "if-none-match": "*" }, 304],
    [{ "if-match": '"missing"' }, 412],
  ] as const) {
    const response = await f.request("changes/?after=genesis", { headers });
    expect(response.status).toBe(status);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-2");
    expect(await response.text()).toBe("");
  }
  expect(
    (
      await f.request("changes/?after=genesis", {
        headers: { "last-event-id": "a foreign or malformed header" },
      })
    ).status,
  ).toBe(200);
  const missing = await f.request("changes/", {
    headers: { "last-event-id": firstPage.groups[0]?.checkpoint },
  });
  expect(missing.status).toBe(400);
  expect(((await missing.json()) as { code: string }).code).toBe("invalid-parameter");
  const now = await f.request("changes/?start=now", { headers: { "last-event-id": "genesis" } });
  expect(await now.json()).toMatchObject({ after: secondPage.groups[0]?.checkpoint, groups: [] });
  const sse = await f.request("changes/?after=genesis", {
    headers: { accept: "text/event-stream" },
  });
  expect(sse.status).toBe(406);
  expect(await sse.text()).toBe("");
  const forbiddenMethod = await f.request("changes/?after=genesis", {
    method: "POST",
    headers: { authorization: "" },
  });
  expect(forbiddenMethod.status).toBe(405);
  expect(forbiddenMethod.headers.get("allow")).toBe("GET, HEAD");
  expect(await forbiddenMethod.text()).toBe("");
  const unauth = await f.request("changes/?after=genesis", { headers: { authorization: "" } });
  expect(unauth.status).toBe(401);
  expect(unauth.headers.get("bdp-scope-position")).toBeNull();
  expect((await f.request("bdp.json")).status).toBe(500);
  await f.reopen();
  expect(await (await f.request("changes/?after=genesis")).json()).toEqual(firstPage);
});
it("decides actual HTTP minimum refusal before conditional shortcuts with final context", async () => {
  let tick = 0;
  const f = await httpFixture({
    minimumReads: {
      budgetMs: 10,
      now: () => tick,
      wait: async (ms) => {
        tick += ms;
      },
    },
  });
  const initial = await f.request("changes/?after=genesis"),
    config = (await initial.json()) as TransactionChangefeedPage;
  const headers = {
    "bdp-scope-epoch": config.scopeEpoch,
    "bdp-authorization-view": config.authorizationView,
    "bdp-minimum-scope-position": "pos-1",
    "if-none-match": "*",
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await f.request("changes/?after=genesis", { method, headers });
    expect(response.status).toBe(503);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-0");
    if (method === "GET") {
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("catch-up-timeout");
      expect(validProblem(body), JSON.stringify(validProblem.errors)).toBe(true);
    } else expect(await response.text()).toBe("");
  }
  for (const [field, code, status] of [
    ["bdp-scope-epoch", "cursor-expired", 410],
    ["bdp-authorization-view", "foreign-view", 409],
  ] as const) {
    const response = await f.request("changes/?after=genesis", {
      headers: { ...headers, [field]: "foreign" },
    });
    expect(response.status).toBe(status);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe(code);
    expect(validProblem(body), JSON.stringify(validProblem.errors)).toBe(true);
    expect(response.headers.get("bdp-scope-position")).toBe("pos-0");
  }
  const unsupported = await f.request("changes/?after=genesis", {
    headers: { "bdp-minimum-scope-position": "pos-0" },
  });
  expect(unsupported.status).toBe(500);
  expect(unsupported.headers.get("x-bdp-development-limit")).toBe("minimum-position");
  const satisfied = await f.request("changes/?after=genesis", {
    headers: { ...headers, "bdp-minimum-scope-position": "genesis" },
  });
  expect(satisfied.status).toBe(304);
  expect(satisfied.headers.get("bdp-scope-position")).toBe("pos-0");
});
