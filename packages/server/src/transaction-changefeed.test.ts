import { replica as createReplica } from "../test-support/transaction-replica.js";
import { constants } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import {
  TransactionMinimumFailure,
  TransactionMinimumUnproved,
  TransactionMinimumUnsupported,
} from "./transaction-consistency.js";
import { ScopeServerOperationAbortedError } from "./read-request.js";
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
const replica = (context: TransactionReadContext) => createReplica(context, linkType);
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
  if (
    !seed ||
    !created ||
    !deleted ||
    seed.projectionAdvance ||
    created.projectionAdvance ||
    deleted.projectionAdvance
  )
    throw Error("visible groups");
  expect(() => client.apply(seed, true)).toThrow("publication failed");
  expect(client.state()).toEqual({ graph: new Map(), checkpoint: "genesis", position: "pos-0" });
  client.apply(page(f.owner, client.state().checkpoint).groups[0]!);
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
  function refusal(after: string): TransactionChangefeedParameterError {
    try {
      f.owner.readChanges(after);
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionChangefeedParameterError);
      if (!(error instanceof TransactionChangefeedParameterError)) throw error;
      return error;
    }
    throw new Error("expected changefeed parameter refusal");
  }
  let retained: TransactionReadContext | undefined;
  for (const bad of ["", "pos-1", "ev_invalid", token, `${token}=`, token.toUpperCase()]) {
    const error = refusal(bad);
    expect(error.context).toStrictEqual({
      scopeEpoch: context.scopeEpoch,
      authorizationView: context.authorizationView,
      scopePosition: "pos-1",
    });
    expect(Object.isFrozen(error.context)).toBe(true);
    if (bad === token) retained = error.context;
  }
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
  f.run([create("b")]);
  expect(refusal(token).context).toStrictEqual({
    scopeEpoch: context.scopeEpoch,
    authorizationView: context.authorizationView,
    scopePosition: "pos-2",
  });
  expect(retained).toStrictEqual({
    scopeEpoch: context.scopeEpoch,
    authorizationView: context.authorizationView,
    scopePosition: "pos-1",
  });
});
it.each([
  "",
  "?after=genesis&start=now",
  "?start=then",
  "?after=",
  "?after=genesis&after=genesis",
  "?start=now&limit=1",
])("rejects invalid feed intent %s with the local parameter convention", (query) => {
  let failure: unknown;
  try {
    transactionChangefeedRequest(new URL(`${scope}changes/${query}`), scope);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(TransactionChangefeedParameterError);
  if (!(failure instanceof TransactionChangefeedParameterError)) throw failure;
  expect(failure.context).toBeUndefined();
});
it("fails closed on corrupt stored framing without renumbering or changing graph state", () => {
  const f = fixture();
  f.run([create("a")]);
  const raw = f.owner.inspect().groups[0] as TransactionChangeGroup,
    context = { ...f.owner.readConfiguration(), scopePosition: "pos-1" };
  for (const change of [
    { position: "pos-99" },
    { checkpoint: "cg_x" },
    { scopeEpoch: "foreign" },
    { authorizationView: "foreign" },
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
it("serves128 Events from32 selected owned Links as one group despite a two-item receipt page setting", () => {
  const f = fixture();
  f.run(Array.from({ length: 32 }, (_, i) => create(`a${i}`)));
  f.run(Array.from({ length: 32 }, (_, i) => edge(`l${i}`, `a${i}`, `a${i}`)));
  const checkpoint = f.owner.captureChangesStart();
  expect(
    f.run([{ operation: "deleteWhere", collection: "links", selector: "$[?@.properties.n == 0]" }])
      .status,
  ).toBe("completed");
  const result = page(f.owner, checkpoint);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]?.events).toHaveLength(128);
  expect(result.next).toBeNull();
  expect(TRANSACTION_CHANGEFEED_BYTES).toBe(186334744);
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
    method: "HEAD",
    headers: { accept: "text/event-stream" },
  });
  expect(sse.status).toBe(200);
  expect(sse.headers.get("content-type")).toBe("text/event-stream");
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
  expect(unsupported.status).toBe(400);
  expect(await unsupported.json()).toMatchObject({
    code: "malformed-request",
    status: 400,
    retry: "never",
  });
  expect(unsupported.headers.get("x-bdp-development-limit")).toBeNull();
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(unsupported.headers.has(name)).toBe(false);
  const satisfied = await f.request("changes/?after=genesis", {
    headers: { ...headers, "bdp-minimum-scope-position": "genesis" },
  });
  expect(satisfied.status).toBe(304);
  expect(satisfied.headers.get("bdp-scope-position")).toBe("pos-0");
});

it("preserves current context on owner-observed changefeed parameter refusals over HTTP", async () => {
  const controller = new AbortController();
  const deadlineReason = new Error("changefeed context cohort deadline");
  let deadlineExceeded = false;
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  const contextFailures: string[] = [];
  const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
  const records: {
    ordinal: number;
    method: string;
    url: string;
    accept: string;
    reconnect: string | null;
    status: number;
    bodyOctets: number;
    context: (string | null)[];
    contentType: string | null;
    contentLength: string | null;
  }[] = [];
  let directory: string | undefined;
  let runtime: Awaited<ReturnType<typeof startTransactionRuntime>> | undefined;
  let closed = false;
  let attempted = 0;
  const token = "c".repeat(32);
  const problem = {
    type: "https://github.com/gastownhall/bdp/problems/request",
    code: "invalid-parameter",
    retry: "never",
    status: 400,
  };
  const problemLength = String(Buffer.byteLength(JSON.stringify(problem)));
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-feed-http-"));
    runtime = await startTransactionRuntime({
      scope,
      directory,
      create: true,
      port: 0,
      types,
      credentials: [{ token, principal: "p", canMutate: true }],
    });
    const listenUrl = runtime.listenUrl;
    async function exchange(
      target: string,
      method: "GET" | "HEAD" | "POST" = "GET",
      accept = "application/json",
      extra: Record<string, string> = {},
      body?: string,
    ) {
      controller.signal.throwIfAborted();
      expect(++attempted, "changefeed context dispatch bound").toBeLessThanOrEqual(12);
      const url = new URL(target, scope);
      expect(url.origin).toBe(new URL(scope).origin);
      expect(Buffer.byteLength(url.href)).toBeLessThanOrEqual(8192);
      const headers = new Headers({ authorization: `Bearer ${token}`, accept, ...extra });
      expect(
        [...headers].reduce((n, [k, v]) => n + Buffer.byteLength(k + v) + 4, 0),
      ).toBeLessThanOrEqual(16384);
      expect(Buffer.byteLength(body ?? "")).toBeLessThanOrEqual(65536);
      const requestController = new AbortController();
      const requestTimer = setTimeout(
        () => requestController.abort(new Error("changefeed exchange deadline")),
        5000,
      );
      try {
        const response = await fetch(new URL(url.pathname + url.search, listenUrl), {
          method,
          headers,
          redirect: "error",
          signal: AbortSignal.any([controller.signal, requestController.signal]),
          ...(body === undefined ? {} : { body }),
        });
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const reader = response.body?.getReader();
        if (reader) {
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 32768) throw new Error("changefeed response body bound");
              chunks.push(chunk.value);
            }
          } catch (error) {
            requestController.abort(error);
            try {
              await reader.cancel(error);
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], "changefeed reader cleanup failed");
            }
            throw error;
          } finally {
            reader.releaseLock();
          }
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        records.push({
          ordinal: attempted,
          method,
          url: url.href,
          accept,
          reconnect: headers.get("last-event-id"),
          status: response.status,
          bodyOctets: bytes,
          context: names.map((name) => response.headers.get(name)),
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
        });
        return { status: response.status, headers: response.headers, text, bytes };
      } finally {
        clearTimeout(requestTimer);
      }
    }
    const receiptValidator = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
    async function seed(id: string, position: string) {
      const body = JSON.stringify({ operations: [create(id)] });
      expect(Buffer.byteLength(body)).toBe(125);
      const response = await exchange(
        "operations/batch",
        "POST",
        "application/json",
        {
          "content-type": "application/json",
          "idempotency-key": `changefeed-context-${id}`,
        },
        body,
      );
      expect(response.status).toBe(200);
      const receipt = JSON.parse(response.text);
      expect(receiptValidator(receipt), JSON.stringify(receiptValidator.errors)).toBe(true);
      expect(receipt).toMatchObject({
        status: "completed",
        idempotencyKey: `changefeed-context-${id}`,
        requiredPosition: position,
        effectPosition: position,
      });
    }
    await seed("a", "pos-1");
    const initial = await exchange("changes/?after=genesis");
    expect(initial.status).toBe(200);
    const page = JSON.parse(initial.text) as TransactionChangefeedPage;
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page.scope).toBe(scope);
    expect(page.after).toBe("genesis");
    expect(page.observedHeadPosition).toBe("pos-1");
    expect(page.next).toBeNull();
    expect(page.groups).toHaveLength(1);
    const group = page.groups[0];
    if (!group) throw new Error("missing initial change group");
    expect(group.position).toBe("pos-1");
    expect(group.previousPosition).toBe("pos-0");
    expect(group.changes).toHaveLength(1);
    expect(group.changes[0]).toMatchObject({
      operation: "upsert",
      resourceKind: "bead",
      resource: { id: `${scope}beads/a`, type: beadType, properties: { n: 0 } },
    });
    expect(group.events).toHaveLength(1);
    expect(group.events[0]).toMatchObject({ type: "created", subject: `${scope}beads/a` });
    const expected = [page.scopeEpoch, page.authorizationView, "pos-1"];
    expect(expected[0]).toBeTruthy();
    expect(expected[1]).toBeTruthy();
    expect(names.map((name) => initial.headers.get(name))).toStrictEqual(expected);
    const match = /^(cg_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{43}_)1$/.exec(group.checkpoint);
    if (!match) throw new Error("unexpected issued checkpoint encoding");
    // Deliberately invalid private input; not an issued/durable replay checkpoint.
    const future = `changes/?after=${match[1]}3`;
    async function contextual(
      method: "GET" | "HEAD",
      accept: string,
      target: string,
      extra: Record<string, string> = {},
      tuple = expected,
    ) {
      const response = await exchange(target, method, accept, extra);
      const label = `changefeed-context:${attempted}`;
      // A200 here requires transport/media/server diagnosis; it is not a context failure.
      expect(response.status, `${label}:prerequisite:${JSON.stringify(records.at(-1))}`).toBe(400);
      expect(response.headers.get("x-bdp-development-limit")).toBeNull();
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("retry-after")).toBeNull();
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(response.headers.get("content-length")).toBe(problemLength);
      if (method === "GET") {
        const actual = JSON.parse(response.text);
        expect(validProblem(actual), JSON.stringify(validProblem.errors)).toBe(true);
        expect(actual).toStrictEqual(problem);
        expect(String(response.bytes)).toBe(problemLength);
      } else {
        expect(response.text).toBe("");
        expect(response.bytes).toBe(0);
      }
      const actualContext = names.map((name) => response.headers.get(name));
      if (JSON.stringify(actualContext) !== JSON.stringify(tuple)) contextFailures.push(label);
      expect.soft(actualContext, label).toStrictEqual(tuple);
    }
    for (const accept of ["application/json", "text/event-stream"])
      for (const method of ["GET", "HEAD"] as const) await contextual(method, accept, future);
    for (const method of ["GET", "HEAD"] as const)
      await contextual(method, "text/event-stream", "changes/?after=genesis", {
        "last-event-id": "malformed",
      });
    const anonymous = await exchange(future, "GET", "application/json", { authorization: "" });
    expect(anonymous.status).toBe(401);
    const unauthenticated = JSON.parse(anonymous.text);
    expect(validProblem(unauthenticated), JSON.stringify(validProblem.errors)).toBe(true);
    expect(unauthenticated).toStrictEqual({
      type: "https://github.com/gastownhall/bdp/problems/authentication",
      code: "unauthenticated",
      retry: "after-state-change",
      status: 401,
    });
    expect(names.map((name) => anonymous.headers.get(name))).toStrictEqual([null, null, null]);
    const malformed = await exchange("changes/?after=genesis&start=now");
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.text)).toStrictEqual(problem);
    expect(names.map((name) => malformed.headers.get(name))).toStrictEqual([null, null, null]);
    await seed("b", "pos-2");
    await contextual("GET", "application/json", future, { "if-none-match": "*" }, [
      page.scopeEpoch,
      page.authorizationView,
      "pos-2",
    ]);
    expect(attempted).toBe(12);
    expect(records).toHaveLength(12);
    expect(records.map((r) => r.ordinal)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    try {
      if (runtime) {
        await runtime.close();
        closed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(timer);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    console.log(
      JSON.stringify({
        observation: "private-source-changefeed-parameter-context",
        outcome: failures.length || contextFailures.length ? "failed" : "passed",
        attempted,
        completedResponses: records,
        exchanges: records.length,
        contextFailures,
        hardFailureCount: failures.length,
        deadlineExceeded,
        startupCompleted: runtime !== undefined,
        closed,
        directory: directory ?? null,
        directoryAbsent: directory === undefined || !existsSync(directory),
        claimEligible: false,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "changefeed context observation and cleanup failed");
}, 60000);

it.each(["unknown", "pos-01"])(
  "waits for fresh finite changefeed opaque minimum without recapturing admission: %s",
  async (opaque) => {
    const f = fixture();
    const owner = f.owner;
    const failures: unknown[] = [];
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let tick = 0,
      waits = 0,
      clocks = 0,
      closes = 0,
      commits = 0,
      outcomeChecked = false;
    const anchors: string[] = [];
    const reads: {
      after: string;
      minimum: unknown;
      minimumFrozen: boolean | null;
      admission: string | null;
      outcome: string;
      context: TransactionReadContext | null;
    }[] = [];
    const delegatedOwner = {
      ...owner,
      captureChangesStart() {
        const after = owner.captureChangesStart();
        anchors.push(after);
        return after;
      },
      readChanges(...args: Parameters<typeof owner.readChanges>) {
        const record = {
          after: args[0],
          minimum:
            args[1] !== undefined && args[1] !== "unsupported" ? { ...args[1] } : (args[1] ?? null),
          minimumFrozen:
            args[1] !== undefined && args[1] !== "unsupported" ? Object.isFrozen(args[1]) : null,
          admission: args[2] ?? null,
          outcome: "pending",
          context: null as TransactionReadContext | null,
        };
        reads.push(record);
        try {
          const result = owner.readChanges(...args);
          record.outcome = result.kind;
          if (result.kind === "page") record.context = result.context;
          return result;
        } catch (error) {
          record.outcome = error instanceof Error ? error.name : "non-Error";
          if (error instanceof TransactionMinimumUnproved) {
            record.outcome = "unproved";
            record.context = error.context;
          }
          throw error;
        }
      },
      close() {
        closes++;
        return owner.close();
      },
    };
    let instance: ReturnType<typeof service> | undefined;
    let observed:
      | Promise<
          | { ok: true; value: Awaited<ReturnType<ReturnType<typeof service>["changes"]>> }
          | { ok: false; error: unknown }
        >
      | undefined;
    let positiveAfter: string | null = null;
    try {
      expect(f.run([create("a")]).status).toBe("completed");
      commits++;
      const config = owner.readConfiguration();
      const minimum = {
        scopeEpoch: config.scopeEpoch,
        authorizationView: config.authorizationView,
        minimumPosition: opaque,
      };
      const expectedMinimum = { ...minimum };
      const anchor = delegatedOwner.captureChangesStart();
      expect(() => delegatedOwner.readChanges(anchor, minimum, "finite-start-now")).toThrow(
        TransactionMinimumUnproved,
      );
      const firstContext = reads[0]?.context;
      expect(firstContext).toStrictEqual({
        scopeEpoch: config.scopeEpoch,
        authorizationView: config.authorizationView,
        scopePosition: "pos-1",
      });
      expect(Object.isFrozen(firstContext)).toBe(true);
      instance = service(
        { ...f, owner: delegatedOwner },
        {
          budgetMs: 2,
          now: () => {
            clocks++;
            return tick;
          },
          wait: async (ms) => {
            waits++;
            expect(ms).toBe(2);
            entered.resolve();
            await release.promise;
          },
        },
      );
      const intent: { start: "now"; after?: string } = { start: "now" };
      const operation = instance.changes(intent, minimum, controller.signal, "finite-start-now");
      observed = operation.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(
        await Promise.race([
          entered.promise.then(() => "entered"),
          observed.then(() => "settled-before-wait"),
        ]),
      ).toBe("entered");
      intent.after = "genesis";
      minimum.scopeEpoch = "foreign";
      minimum.authorizationView = "other";
      minimum.minimumPosition = "genesis";
      expect(f.run([create("b")]).status).toBe("completed");
      commits++;
      tick = 2;
      release.resolve();
      const outcome = await observed;
      if (outcome.ok) throw new Error("opaque minimum unexpectedly became eligible");
      expect(outcome.error).toBeInstanceOf(TransactionMinimumFailure);
      if (!(outcome.error instanceof TransactionMinimumFailure)) throw outcome.error;
      expect(outcome.error.reason).toBe("catch-up-timeout");
      expect(outcome.error.context).toStrictEqual({ ...firstContext, scopePosition: "pos-2" });
      outcomeChecked = true;
      expect(anchors).toEqual([anchor, anchor]);
      expect(reads.slice(1).map((read) => read.after)).toEqual([anchor, anchor]);
      expect(reads.slice(1).map((read) => read.minimum)).toEqual([
        expectedMinimum,
        expectedMinimum,
      ]);
      expect(reads[1]?.minimumFrozen).toBe(true);
      expect(reads[2]?.minimumFrozen).toBe(true);
      expect(reads[1]?.context?.scopePosition).toBe("pos-1");
      expect(reads[2]?.context?.scopePosition).toBe("pos-2");
      expect(firstContext?.scopePosition).toBe("pos-1");
      const positive = await instance.changes(
        { after: anchor },
        { ...expectedMinimum, minimumPosition: "pos-2" },
      );
      if (positive.kind !== "page") throw new Error("missing known eligible page");
      expect(validPage(positive.page), JSON.stringify(validPage.errors)).toBe(true);
      positiveAfter = positive.page.after;
      expect(positive.page.after).toBe(anchor);
      expect(positive.page.groups).toHaveLength(1);
      expect(positive.page.groups[0]?.changes[0]?.resource.id).toBe(`${scope}beads/b`);
      expect(positive.context.scopePosition).toBe("pos-2");
      expect(reads).toHaveLength(4);
      expect(waits).toBe(1);
      expect(clocks).toBe(4);
      expect(commits).toBe(2);
    } catch (error) {
      failures.push(error);
    } finally {
      controller.abort();
      release.resolve();
      if (observed) {
        const outcome = await observed;
        if (!outcomeChecked && !outcome.ok && !failures.includes(outcome.error))
          failures.push(outcome.error);
      }
      try {
        if (instance) {
          await instance.close();
          expect(closes).toBe(1);
        }
      } catch (error) {
        failures.push(error);
      }
      console.log(
        JSON.stringify({
          observation: "changefeed-opaque-capture",
          row: opaque,
          outcome: failures.length ? "failed" : "passed",
          commits,
          captures: anchors.length,
          anchors,
          reads,
          waits,
          clocks,
          closes,
          positiveAfter,
          failureCount: failures.length,
        }),
      );
    }
    if (failures.length) throw new AggregateError(failures, "opaque changefeed capture failed");
  },
);

it("aborts fresh finite changefeed opaque waiting before close drains", async () => {
  const f = fixture();
  const owner = f.owner;
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const failures: unknown[] = [];
  let captures = 0,
    reads = 0,
    waits = 0,
    clocks = 0,
    closes = 0,
    postCloseProbes = 0,
    closed = false,
    outcomeChecked = false;
  const order: string[] = [];
  const delegatedOwner = {
    ...owner,
    captureChangesStart() {
      captures++;
      return owner.captureChangesStart();
    },
    readChanges(...args: Parameters<typeof owner.readChanges>) {
      reads++;
      return owner.readChanges(...args);
    },
    close() {
      closes++;
      order.push("owner-close");
      return owner.close();
    },
  };
  let instance: ReturnType<typeof service> | undefined;
  let observed: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  let closing: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  try {
    expect(f.run([create("a")]).status).toBe("completed");
    const config = owner.readConfiguration();
    const minimum = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      minimumPosition: "unknown",
    };
    instance = service(
      { ...f, owner: delegatedOwner },
      {
        budgetMs: 2,
        now: () => {
          clocks++;
          return 0;
        },
        wait: async () => {
          waits++;
          order.push("wait-entered");
          entered.resolve();
          await release.promise;
          order.push("wait-released");
        },
      },
    );
    observed = instance
      .changes({ start: "now" }, minimum, controller.signal, "finite-start-now")
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    expect(
      await Promise.race([
        entered.promise.then(() => "entered"),
        observed.then(() => "settled-before-wait"),
      ]),
    ).toBe("entered");
    closing = instance.close().then(
      () => {
        closed = true;
        order.push("close-resolved");
        return { ok: true as const };
      },
      (error: unknown) => ({ ok: false as const, error }),
    );
    // This synchronous flag alone is not proof that close deferred.
    expect(closed).toBe(false);
    controller.abort();
    order.push("abort");
    release.resolve();
    const outcome = await observed;
    if (outcome.ok) throw new Error("aborted opaque operation unexpectedly succeeded");
    expect(outcome.error).toBeInstanceOf(ScopeServerOperationAbortedError);
    outcomeChecked = true;
    const closeOutcome = await closing;
    if (!closeOutcome.ok) throw closeOutcome.error;
    expect(closed).toBe(true);
    expect(order).toEqual([
      "wait-entered",
      "abort",
      "wait-released",
      "owner-close",
      "close-resolved",
    ]);
    expect(() =>
      instance?.changes({ start: "now" }, minimum, undefined, "finite-start-now"),
    ).toThrow("closed");
    postCloseProbes++;
    expect(() => owner.readChanges("genesis")).toThrow("closed");
    expect({ captures, reads, waits, clocks, closes, postCloseProbes }).toEqual({
      captures: 1,
      reads: 1,
      waits: 1,
      clocks: 2,
      closes: 1,
      postCloseProbes: 1,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    release.resolve();
    if (observed) {
      const outcome = await observed;
      if (!outcomeChecked && !outcome.ok && !failures.includes(outcome.error))
        failures.push(outcome.error);
    }
    if (closing) {
      const outcome = await closing;
      if (!outcome.ok && !failures.includes(outcome.error)) failures.push(outcome.error);
    } else {
      try {
        if (instance) await instance.close();
      } catch (error) {
        failures.push(error);
      }
    }
    console.log(
      JSON.stringify({
        observation: "changefeed-opaque-abort",
        outcome: failures.length ? "failed" : "passed",
        captures,
        reads,
        waits,
        clocks,
        closes,
        postCloseProbes,
        order,
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "opaque changefeed abort failed");
});

it.each(["already-aborted", "invalid-policy", "throwing-clock", "nonfinite-clock"] as const)(
  "preserves fresh finite changefeed admission before wait preflight: %s",
  async (label) => {
    const f = fixture();
    const owner = f.owner;
    const controller = new AbortController();
    const failures: unknown[] = [];
    const clockError = new Error("controlled changefeed clock failure");
    let captures = 0,
      reads = 0,
      waits = 0,
      clocks = 0;
    const delegatedOwner = {
      ...owner,
      captureChangesStart() {
        captures++;
        return owner.captureChangesStart();
      },
      readChanges(...args: Parameters<typeof owner.readChanges>) {
        reads++;
        return owner.readChanges(...args);
      },
    };
    expect(f.run([create("a")]).status).toBe("completed");
    const config = owner.readConfiguration();
    const instance = service(
      { ...f, owner: delegatedOwner },
      {
        budgetMs: label === "invalid-policy" ? 0 : 2,
        now: () => {
          clocks++;
          if (label === "throwing-clock") throw clockError;
          return label === "nonfinite-clock" ? Number.NaN : 0;
        },
        wait: async () => {
          waits++;
          throw new Error("unexpected preflight wait");
        },
      },
    );
    if (label === "already-aborted") controller.abort();
    let errorName: string | null = null;
    try {
      const outcome = await instance
        .changes(
          { start: "now" },
          {
            scopeEpoch: config.scopeEpoch,
            authorizationView: config.authorizationView,
            minimumPosition: "unknown",
          },
          controller.signal,
          "finite-start-now",
        )
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      if (outcome.ok) throw new Error("preflight unexpectedly succeeded");
      errorName = outcome.error instanceof Error ? outcome.error.name : "non-Error";
      if (label === "already-aborted")
        expect(outcome.error).toBeInstanceOf(ScopeServerOperationAbortedError);
      else if (label === "throwing-clock") expect(outcome.error).toBe(clockError);
      else {
        expect(outcome.error).toBeInstanceOf(TypeError);
        expect((outcome.error as TypeError).message).toBe(
          label === "invalid-policy"
            ? "finite minimum-read wait policy required"
            : "invalid minimum-read clock",
        );
      }
      expect({ captures, reads, waits, clocks }).toEqual({
        captures: 1,
        reads: 0,
        waits: 0,
        clocks: label === "invalid-policy" ? 0 : 1,
      });
    } catch (error) {
      failures.push(error);
    } finally {
      controller.abort();
      try {
        await instance.close();
      } catch (error) {
        failures.push(error);
      }
      console.log(
        JSON.stringify({
          observation: "changefeed-opaque-preflight",
          row: label,
          outcome: failures.length ? "failed" : "passed",
          captures,
          reads,
          waits,
          clocks,
          errorName,
          failureCount: failures.length,
        }),
      );
    }
    if (failures.length) throw new AggregateError(failures, "changefeed preflight failed");
  },
);

it("keeps direct and excluded changefeed minimum paths strict", async () => {
  const f = fixture();
  const owner = f.owner;
  const failures: unknown[] = [];
  let captures = 0,
    reads = 0,
    waits = 0,
    clocks = 0;
  const outcomes: string[] = [];
  const delegatedOwner = {
    ...owner,
    captureChangesStart() {
      captures++;
      return owner.captureChangesStart();
    },
    readChanges(...args: Parameters<typeof owner.readChanges>) {
      reads++;
      return owner.readChanges(...args);
    },
  };
  expect(f.run([create("a")]).status).toBe("completed");
  const config = owner.readConfiguration();
  const minimum = {
    scopeEpoch: config.scopeEpoch,
    authorizationView: config.authorizationView,
    minimumPosition: "unknown",
  };
  const malformed = { ...minimum, minimumPosition: "contains a space" };
  const instance = service(
    { ...f, owner: delegatedOwner },
    {
      budgetMs: 2,
      now: () => {
        clocks++;
        return 0;
      },
      wait: async () => {
        waits++;
        throw new Error("unexpected strict-boundary wait");
      },
    },
  );
  try {
    expect(() => delegatedOwner.readChanges("genesis", minimum)).toThrow(TypeError);
    outcomes.push("default-owner-TypeError");
    expect(() => instance.changes({ start: "now" }, minimum)).toThrow(TypeError);
    outcomes.push("default-service-TypeError");
    expect(() =>
      instance.changes({ after: "genesis" }, minimum, undefined, "finite-start-now"),
    ).toThrow(TypeError);
    outcomes.push("after-TypeError");
    expect(() =>
      instance.changes({ start: "now" }, malformed, undefined, "finite-start-now"),
    ).toThrow(TypeError);
    outcomes.push("malformed-TypeError");
    expect({ captures, reads, waits, clocks }).toEqual({
      captures: 0,
      reads: 1,
      waits: 0,
      clocks: 0,
    });
    expect(
      await instance.changes({ start: "now" }, "unsupported", undefined, "finite-start-now"),
    ).toEqual({ kind: "unsupported" });
    outcomes.push("unsupported-sentinel");
    await expect(
      instance.changes(
        { start: "now" },
        { ...minimum, scopeEpoch: "foreign" },
        undefined,
        "finite-start-now",
      ),
    ).rejects.toBeInstanceOf(TransactionMinimumUnsupported);
    outcomes.push("foreign-unsupported");
    await instance.close();
    expect(() =>
      instance.changes({ start: "now" }, minimum, undefined, "finite-start-now"),
    ).toThrow("closed");
    outcomes.push("valid-closed");
    expect(() =>
      instance.changes({ start: "now" }, malformed, undefined, "finite-start-now"),
    ).toThrow("unsupported minimum tuple");
    outcomes.push("malformed-before-closed");
    expect(() => delegatedOwner.readChanges("genesis")).toThrow("closed");
    outcomes.push("owner-closed");
    expect({ captures, reads, waits, clocks }).toEqual({
      captures: 2,
      reads: 4,
      waits: 0,
      clocks: 2,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await instance.close();
    } catch (error) {
      failures.push(error);
    }
    console.log(
      JSON.stringify({
        observation: "changefeed-opaque-boundaries",
        outcome: failures.length ? "failed" : "passed",
        captures,
        reads,
        waits,
        clocks,
        outcomes,
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "changefeed boundaries failed");
});

it("serves finite start-now opaque minima before HTTP shortcuts", async () => {
  const controller = new AbortController();
  const failures: unknown[] = [];
  let deadlineExceeded = false,
    cleanupDeadlineExceeded = false,
    closed = false,
    attempted = 0,
    tick = 0;
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    const error = new Error("opaque changefeed HTTP work deadline");
    failures.push(error);
    controller.abort(error);
  }, 45000);
  let directory: string | undefined;
  let runtime: Awaited<ReturnType<typeof startTransactionRuntime>> | undefined;
  const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
  const safeHeaders = [
    ...names,
    "content-type",
    "content-length",
    "cache-control",
    "retry-after",
    "etag",
    "x-bdp-development-limit",
  ];
  const records: {
    ordinal: number;
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    bodySha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const token = "d".repeat(32);
  try {
    directory = mkdtempSync(path.join(tmpdir(), "bdp-feed-opaque-http-"));
    runtime = await startTransactionRuntime(
      {
        scope,
        directory,
        create: true,
        port: 0,
        types,
        credentials: [{ token, principal: "p", canMutate: true }],
      },
      {
        minimumReads: {
          budgetMs: 2,
          now: () => tick,
          wait: async (ms) => {
            tick += ms;
          },
        },
      },
    );
    const listenUrl = runtime.listenUrl;
    async function exchange(
      target: string,
      method: "GET" | "HEAD" | "POST" = "GET",
      extra: Record<string, string> = {},
      body?: string,
    ) {
      controller.signal.throwIfAborted();
      if (attempted >= 10) throw new Error("opaque changefeed dispatch bound");
      const url = new URL(target, scope);
      expect(url.origin).toBe(new URL(scope).origin);
      expect(Buffer.byteLength(url.href)).toBeLessThanOrEqual(8192);
      const headers = new Headers({
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...extra,
      });
      expect(
        [...headers].reduce((n, [k, v]) => n + Buffer.byteLength(k + v) + 4, 0),
      ).toBeLessThanOrEqual(16384);
      expect(Buffer.byteLength(body ?? "")).toBeLessThanOrEqual(65536);
      const requestController = new AbortController();
      const requestTimer = setTimeout(
        () => requestController.abort(new Error("opaque changefeed exchange deadline")),
        5000,
      );
      attempted++;
      try {
        const response = await fetch(new URL(url.pathname + url.search, listenUrl), {
          method,
          headers,
          redirect: "error",
          signal: AbortSignal.any([controller.signal, requestController.signal]),
          ...(body === undefined ? {} : { body }),
        });
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const reader = response.body?.getReader();
        if (reader) {
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 32768) throw new Error("opaque changefeed response body bound");
              chunks.push(chunk.value);
            }
          } catch (error) {
            requestController.abort(error);
            try {
              await reader.cancel(error);
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], "opaque changefeed reader cleanup");
            }
            throw error;
          } finally {
            reader.releaseLock();
          }
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        records.push({
          ordinal: attempted,
          method,
          url: url.href,
          status: response.status,
          bodyOctets: bytes,
          bodySha256: createHash("sha256").update(text).digest("hex"),
          headers: Object.fromEntries(
            safeHeaders.map((name) => [name, response.headers.get(name)]),
          ),
        });
        return { status: response.status, headers: response.headers, text, bytes };
      } finally {
        clearTimeout(requestTimer);
      }
    }
    const seed = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "opaque-feed-a" },
      JSON.stringify({ operations: [create("a")] }),
    );
    expect(seed.status).toBe(200);
    const receipt = JSON.parse(seed.text);
    const receiptValidator = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
    expect(receiptValidator(receipt), JSON.stringify(receiptValidator.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const current = [receipt.scopeEpoch, receipt.authorizationView, receipt.requiredPosition];
    expect(current.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
    const minimum = {
      "bdp-scope-epoch": receipt.scopeEpoch as string,
      "bdp-authorization-view": receipt.authorizationView as string,
      "bdp-minimum-scope-position": receipt.requiredPosition as string,
    };
    const target = "changes/?start=now";
    const eligibleHeaders = { ...minimum, "last-event-id": "malformed reconnect ignored" };
    const get = await exchange(target, "GET", eligibleHeaders);
    expect(get.status).toBe(200);
    const page = JSON.parse(get.text) as TransactionChangefeedPage;
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page).toMatchObject({
      scope,
      scopeEpoch: receipt.scopeEpoch,
      authorizationView: receipt.authorizationView,
      observedHeadPosition: "pos-1",
      groups: [],
      next: null,
    });
    expect(page.after).not.toBe("genesis");
    expect(
      checkpointPosition(
        scope,
        {
          scopeEpoch: page.scopeEpoch,
          authorizationView: page.authorizationView,
          scopePosition: "pos-1",
        },
        page.after,
      ),
    ).toBe(1);
    expect(names.map((name) => get.headers.get(name))).toEqual(current);
    const head = await exchange(target, "HEAD", eligibleHeaders);
    expect(head.status).toBe(200);
    expect(head.bytes).toBe(0);
    expect(head.text).toBe("");
    expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
    expect(get.headers.get("content-length")).toBe(String(get.bytes));
    expect(names.map((name) => head.headers.get(name))).toEqual(current);
    for (const position of ["unknown", "pos-01"]) {
      const headers = {
        ...minimum,
        "bdp-minimum-scope-position": position,
        "last-event-id": "malformed reconnect ignored",
        ...(position === "unknown"
          ? { "if-none-match": "*" }
          : { accept: "text/plain", "if-match": '"missing"' }),
      };
      const refusal = await exchange(target, "GET", headers);
      expect(refusal.status).toBe(503);
      const problem = JSON.parse(refusal.text);
      expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
      expect(problem).toMatchObject({
        code: "catch-up-timeout",
        status: 503,
        retry: "after-delay",
      });
      const refusalHead = await exchange(target, "HEAD", headers);
      expect(refusalHead.status).toBe(503);
      expect(refusalHead.text).toBe("");
      expect(refusalHead.bytes).toBe(0);
      for (const response of [refusal, refusalHead]) {
        expect(names.map((name) => response.headers.get(name))).toEqual(current);
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("retry-after")).toBe("1");
        expect(response.headers.get("etag")).toBeNull();
        expect(response.headers.get("x-bdp-development-limit")).toBeNull();
      }
      expect(refusal.headers.get("content-length")).toBe(String(refusal.bytes));
      expect(refusalHead.headers.get("content-length")).toBe(refusal.headers.get("content-length"));
    }
    const unknown = { ...minimum, "bdp-minimum-scope-position": "unknown" };
    const after = await exchange("changes/?after=genesis", "GET", unknown);
    expect(after.status).toBe(500);
    expect(after.headers.get("x-bdp-development-limit")).toBe("minimum-position");
    const sse = await exchange(target, "GET", {
      ...unknown,
      accept: "text/event-stream",
      "last-event-id": "genesis",
    });
    expect(sse.status).toBe(500);
    expect(sse.headers.get("x-bdp-development-limit")).toBe("minimum-position");
    expect(sse.headers.get("content-type")).not.toBe("text/event-stream");
    const malformed = await exchange(target, "GET", {
      "bdp-minimum-scope-position": "unknown",
      accept: "text/plain",
      "if-none-match": "*",
    });
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.text)).toMatchObject({ code: "malformed-request", status: 400 });
    expect(names.map((name) => malformed.headers.get(name))).toEqual([null, null, null]);
    expect(malformed.headers.get("x-bdp-development-limit")).toBeNull();
    expect(attempted).toBe(10);
    expect(records.map((record) => record.status)).toEqual([
      200, 200, 200, 503, 503, 503, 503, 500, 500, 400,
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(timer);
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaning = (async () => {
      if (runtime) {
        await runtime.close();
        closed = true;
      }
    })();
    void cleaning.catch((error: unknown) => {
      if (!failures.includes(error)) failures.push(error);
    });
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupDeadlineExceeded = true;
            reject(new Error("opaque changefeed HTTP cleanup deadline"));
          }, 10000);
        }),
      ]);
      if (closed && !cleanupDeadlineExceeded && directory)
        rmSync(directory, { recursive: true, force: false });
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    } finally {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
    console.log(
      JSON.stringify({
        observation: "changefeed-opaque-http",
        outcome: failures.length ? "failed" : "passed",
        attempted,
        exchanges: records.length,
        records,
        deadlineExceeded,
        cleanupDeadlineExceeded,
        closed,
        directory: directory ?? null,
        directoryAbsent: directory !== undefined && !existsSync(directory),
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "opaque changefeed HTTP failed");
}, 60000);
