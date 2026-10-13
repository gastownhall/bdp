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
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransaction } from "./transaction-batch.js";
import {
  TRANSACTION_EVENT_PAGE_BYTES,
  TRANSACTION_EVENT_GROUP_BYTES,
  TRANSACTION_EVENT_FIRST_PAGE_BYTES,
  TransactionEventParameterError,
  TransactionEventProjectionGap,
  renderTransactionEvent,
  transactionEventRequest,
} from "./transaction-events.js";
import { TransactionMinimumFailure } from "./transaction-consistency.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanups.splice(0).reverse()) fn();
});
const scope = "https://example.test/events/";
function types(s: string, owned = false) {
  return [
    parseTypeDescriptor({
      id: `${s}types/bead`,
      name: "Bead",
      describes: "bead",
      conformsTo: [],
      ...(owned ? { ownsOutgoing: { [`${s}types/link`]: { max: 32 } } } : {}),
    }),
    parseTypeDescriptor({
      id: `${s}types/link`,
      name: "Link",
      describes: "link",
      conformsTo: [],
      source: { conformsTo: [], external: "opaque" },
      target: { conformsTo: [], external: "opaque" },
    }),
  ];
}
function fixture(s = scope, owned = false, maximum = 2) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-finite-"));
  let now = 1000;
  const options = {
    clock: () => now,
    file: path.join(directory, "owner.sqlite"),
    scope: s,
    types: types(s, owned),
    create: true,
    receiptMaximumItems: maximum,
  };
  let owner = openTransactionStore(options);
  cleanups.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let key = 0;
  return {
    get owner() {
      return owner;
    },
    options,
    advance(ms: number) {
      now += ms;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
    },
    run(operations: unknown[]) {
      const admission = owner.admit(
        "p",
        `k${key++}`,
        prepareTransaction(s, JSON.stringify({ operations })),
      );
      if (admission.kind !== "owned") throw Error("admission");
      return owner.execute(admission.claim);
    },
  };
}
const bead = (id: string, s = scope) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type: `${s}types/bead`,
  properties: { n: 0 },
});
const link = (id = "l", source = "beads/a", target: unknown = "beads/b", s = scope) => ({
  operation: "createLink",
  id: `links/${id}`,
  type: `${s}types/link`,
  source,
  target,
  properties: { n: 0 },
});
const patch = {
  operation: "updateLink",
  link: "links/l",
  propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
};
const remove = { operation: "deleteLink", link: "links/l" };
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
ajv.addSchema(schema);
const validPage = ajv.compile({ $ref: `${schema.$id}#/$defs/eventPage` });
function collect(owner: ReturnType<typeof openTransactionStore>, source: string) {
  const pages = [];
  let after: string | undefined;
  do {
    const result = owner.readEvents(source, after);
    if (result.kind !== "page") throw Error(result.kind);
    expect(validPage(result.page), JSON.stringify(validPage.errors)).toBe(true);
    expect(Buffer.byteLength(stringifyJsonValue(result.page))).toBeLessThanOrEqual(
      TRANSACTION_EVENT_PAGE_BYTES,
    );
    pages.push(result.page);
    after =
      result.page.next === null
        ? undefined
        : (new URL(result.page.next).searchParams.get("after") ?? undefined);
  } while (after);
  return { pages, events: pages.flatMap((p) => p.events) };
}
it.each([false, true])(
  "projects Scope, Link and Bead facts through deletion/restart (owned=%s)",
  (owned) => {
    const f = fixture(scope, owned);
    f.run([bead("a"), bead("b"), link()]);
    f.run([patch, remove]);
    const global = collect(f.owner, `${scope}events/`),
      a = collect(f.owner, `${scope}beads/a?view=events`),
      l = collect(f.owner, `${scope}links/l?view=events`);
    expect(l.events.map((e) => e.type)).toEqual(["created", "updated", "deleted"]);
    expect(a.events.map((e) => [e.type, e.subject])).toEqual(
      owned
        ? [
            ["created", `${scope}beads/a`],
            ["linked", `${scope}links/l`],
            ["updated", `${scope}beads/a`],
            ["updated", `${scope}links/l`],
            ["updated", `${scope}beads/a`],
            ["unlinked", `${scope}links/l`],
            ["updated", `${scope}beads/a`],
          ]
        : [
            ["created", `${scope}beads/a`],
            ["linked", `${scope}links/l`],
            ["updated", `${scope}links/l`],
            ["unlinked", `${scope}links/l`],
          ],
    );
    expect(l.events[1]?.data).toMatchObject({ change: patch.propertiesChange });
    for (const event of a.events) {
      const original = global.events.find(
        (e) => e.transaction === event.transaction && e.ordinal === event.ordinal,
      );
      expect(original).toBeDefined();
      expect(event.data).toEqual(original?.data);
      expect(event.id).not.toBe(original?.id);
      expect(event.id).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    }
    f.reopen();
    expect(collect(f.owner, `${scope}beads/a?view=events`)).toEqual(a);
    expect(collect(f.owner, `${scope}links/l?view=events`)).toEqual(l);
  },
);
it.each([false, true])(
  "uses same-group endpoints for create/update/delete and self-Link incidences (owned=%s)",
  (owned) => {
    const f = fixture(scope, owned);
    f.run([bead("a")]);
    f.run([link("l", "beads/a", "beads/a"), patch, remove]);
    const events = collect(f.owner, `${scope}beads/a?view=events`).events;
    const incidence = events.filter((e) => e.type === "linked" || e.type === "unlinked");
    expect(incidence.map((e) => (e.data as { endpoint: string }).endpoint)).toEqual([
      "source",
      "target",
      "source",
      "target",
    ]);
    expect(
      events.filter((e) => e.type === "updated" && e.subject === `${scope}links/l`),
    ).toHaveLength(1);
    expect(f.owner.inspect().groups.at(-1)).toMatchObject({
      changes: expect.arrayContaining([
        {
          operation: "tombstone",
          resourceKind: "link",
          resource: expect.objectContaining({ id: `${scope}links/l` }),
        },
      ]),
    });
  },
);
it("preserves endpoint pins, omits external sources and does not mutate Beads for incidence", () => {
  const f = fixture();
  f.run([bead("a")]);
  const before = f.owner.inspect().resources[0];
  const pin = { uri: "https://external.invalid/resource", revision: "r-external" };
  expect(f.run([link("l", "beads/a", pin)]).status).toBe("completed");
  const events = collect(f.owner, `${scope}beads/a?view=events`).events;
  expect(events).toHaveLength(2);
  expect(events[1]?.data).toMatchObject({ target: pin, endpoint: "source" });
  expect(f.owner.inspect().resources[0]).toEqual(before);
  expect(f.owner.readEvents(`${scope}beads/missing?view=events`)).toEqual({ kind: "missing" });
});
it("pages within groups, continues exclusively after end and rejects unrelated/fabricated cursors", () => {
  const f = fixture();
  f.run([bead("a"), bead("b"), link()]);
  const source = `${scope}beads/a?view=events`,
    data = collect(f.owner, source),
    all = collect(f.owner, `${scope}events/`);
  const last = data.events.at(-1),
    first = all.events[0],
    second = all.events[1];
  if (!last || !first || !second) throw Error("expected seeded Events");
  expect(f.owner.readEvents(source, last.id)).toMatchObject({
    kind: "page",
    page: { events: [], next: null },
  });
  f.run([patch]);
  expect(collect(f.owner, source).events).toHaveLength(3);
  expect(f.owner.readEvents(source, last.id)).toMatchObject({
    kind: "page",
    page: { events: [expect.objectContaining({ type: "updated" })] },
  });
  expect(() => f.owner.readEvents(source, all.events[0]?.id)).toThrow(
    TransactionEventParameterError,
  );
  const absent = renderTransactionEvent(f.owner.readConfiguration(), source, "pos-1", {
    ...first,
    ordinal: 999,
  });
  expect(() => f.owner.readEvents(source, absent.id)).toThrow(TransactionEventParameterError);
  const neverMember = renderTransactionEvent(f.owner.readConfiguration(), source, "pos-1", second);
  expect(() => f.owner.readEvents(source, neverMember.id)).toThrow(TransactionEventParameterError);
  for (const token of ["genesis", "", "bad", "a".repeat(257)])
    expect(() => f.owner.readEvents(source, token)).toThrow(TransactionEventParameterError);
  const changedView = renderTransactionEvent(
    { ...f.owner.readConfiguration(), authorizationView: "different" },
    source,
    "pos-1",
    first,
  );
  expect(() => f.owner.readEvents(source, changedView.id)).toThrow(
    expect.objectContaining({ reason: "foreign-view" }),
  );
  const changedEpoch = renderTransactionEvent(
    { ...f.owner.readConfiguration(), scopeEpoch: "different" },
    source,
    "pos-1",
    first,
  );
  expect(() => f.owner.readEvents(source, changedEpoch.id)).toThrow(
    expect.objectContaining({ reason: "cursor-expired" }),
  );
});
it("keeps unknown sources nondisclosing before minimum and refuses older success/fenced owner", () => {
  const f = fixture();
  f.run([bead("a")]);
  const config = f.owner.readConfiguration();
  const minimum = {
    scopeEpoch: config.scopeEpoch,
    authorizationView: config.authorizationView,
    minimumPosition: "pos-2",
  };
  expect(f.owner.readEvents(`${scope}beads/unknown?view=events`, undefined, minimum)).toEqual({
    kind: "missing",
  });
  expect(() => f.owner.readEvents(`${scope}events/`, undefined, minimum)).toThrow(
    TransactionMinimumFailure,
  );
  const observed = f.owner.readEvents(`${scope}events/`);
  if (observed.kind !== "page") throw Error("page");
  expect(observed.context.scopePosition).toBe("pos-1");
  expect(Object.isFrozen(observed.page.events[0]?.data)).toBe(true);
  f.owner.close();
  expect(() => f.owner.readEvents(`${scope}events/`)).toThrow();
});
it("does not emit failed/no-op transactions and does not expire Events with receipt detail", () => {
  const f = fixture();
  const committed = f.run([bead("a"), bead("b"), link()]);
  expect(committed.status).toBe("completed");
  const before = collect(f.owner, `${scope}events/`);
  const noop = f.run([{ ...patch, propertiesChange: [{ op: "replace", path: "/n", value: 0 }] }]);
  expect(noop.status).toBe("completed");
  expect(noop.effectPosition).toBeUndefined();
  const failed = f.run([
    patch,
    {
      operation: "updateBead",
      bead: "beads/missing",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
  ]);
  expect(collect(f.owner, `${scope}events/`)).toEqual(before);
  expect(failed.status).toBe("failed");
  f.advance(86400001);
  expect(f.owner.maintain()).toEqual({ completedExpired: 2, failedForgotten: 1 });
  f.reopen();
  expect(f.owner.receipt("p", committed.id)?.detail).toBe("expired");
  expect(collect(f.owner, `${scope}events/`)).toEqual(before);
});
it("isolates unresolved metadata-only incident membership while Scope/Link sources remain available", () => {
  const f = fixture();
  f.run([bead("a"), bead("b"), link()]);
  const metadataChange = [{ op: "add", path: "/note", value: "own" }];
  expect(f.run([{ operation: "updateBead", bead: "beads/a", metadataChange }]).status).toBe(
    "completed",
  );
  expect(collect(f.owner, `${scope}beads/a?view=events`).events.at(-1)).toMatchObject({
    subject: `${scope}beads/a`,
    type: "updated",
    data: { metadataChange },
  });
  expect(f.run([{ ...patch, metadataChange }]).status).toBe("completed");
  expect(collect(f.owner, `${scope}beads/a?view=events`).events.at(-1)).toMatchObject({
    subject: `${scope}links/l`,
    type: "updated",
    data: { change: patch.propertiesChange, metadataChange },
  });
  f.run([
    {
      operation: "updateLink",
      link: "links/l",
      metadataChange: [{ op: "add", path: "/n", value: 1 }],
    },
  ]);
  expect(collect(f.owner, `${scope}links/l?view=events`).events.at(-1)?.data).toHaveProperty(
    "metadataChange",
  );
  expect(collect(f.owner, `${scope}events/`).events.at(-1)?.data).toHaveProperty("metadataChange");
  expect(() => collect(f.owner, `${scope}beads/a?view=events`)).toThrow(
    TransactionEventProjectionGap,
  );
});
it("bounds actual finite page bytes with long canonical sources and emits no partial Event", () => {
  const s = `https://example.test/${"s".repeat(60000)}/`,
    f = fixture(s, false, 32);
  f.run([bead("a", s)]);
  f.run([bead("b", s)]);
  for (let i = 0; i < 12; i++) f.run([link(`l${i}`, "beads/a", "beads/b", s)]);
  const result = collect(f.owner, `${s}events/`);
  expect(result.events).toHaveLength(38);
  expect(result.pages.length).toBeGreaterThan(1);
  expect(result.pages[0]?.events.length).toBeLessThan(32);
  expect(new Set(result.events.map((e) => e.id)).size).toBe(38);
});
it("keeps Event route/query validation private and closed", () => {
  expect(transactionEventRequest(new URL(`${scope}beads/a`), scope)).toBeUndefined();
  for (const target of [
    "events/?limit=1",
    "events/?after=genesis",
    "beads/a?view=events&view=events",
    "beads/a?view=events&after=",
    "types/a?view=events",
  ])
    expect(() => transactionEventRequest(new URL(target, scope), scope)).toThrow(
      TransactionEventParameterError,
    );
});
it("serves finite Event HTTP with current context, conditionals, HEAD and bounded minimum waits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-events-http-"));
  const emitted = (await import(
    new URL("../dist/transaction-runtime.js", import.meta.url).href
  )) as typeof import("./transaction-runtime.js");
  const runtime = await emitted.startTransactionRuntime(
    {
      directory,
      scope,
      create: true,
      port: 0,
      types: types(scope),
      credentials: [{ token: "a".repeat(32), principal: "p", canMutate: true }],
    },
    { minimumReads: { budgetMs: 80 } },
  );
  const get = (route: string, headers: Record<string, string> = {}, method = "GET") =>
    fetch(
      new URL(new URL(route, scope).pathname + new URL(route, scope).search, runtime.listenUrl),
      { method, headers: { authorization: `Bearer ${"a".repeat(32)}`, ...headers } },
    );
  const post = async (operations: unknown[], key: string) =>
    fetch(new URL(new URL(runtime.targets.batch).pathname, runtime.listenUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${"a".repeat(32)}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({ operations }),
    });
  try {
    await post([bead("a"), bead("b"), link()], "seed");
    const response = await get("events/"),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(validPage(body)).toBe(true);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("last-modified")).toBe(false);
    const epoch = response.headers.get("bdp-scope-epoch"),
      view = response.headers.get("bdp-authorization-view");
    if (!epoch || !view) throw new Error("missing Event context");
    const headers = {
      "bdp-scope-epoch": epoch,
      "bdp-authorization-view": view,
      "bdp-minimum-scope-position": "pos-2",
    };
    const waiting = get("events/", headers);
    await new Promise((r) => setTimeout(r, 15));
    await post([patch], "update");
    expect((await waiting).status).toBe(200);
    const timeout = await get("events/", {
      ...headers,
      "bdp-minimum-scope-position": "pos-99",
      "if-none-match": "*",
    });
    expect(timeout.status).toBe(503);
    expect(await timeout.json()).toMatchObject({ code: "catch-up-timeout" });
    const unknown = await get("beads/unknown?view=events", {
      ...headers,
      "bdp-minimum-scope-position": "pos-99",
    });
    expect(unknown.status).toBe(404);
    for (const [conditions, status] of [
      [{ "if-none-match": "*" }, 304],
      [{ "if-match": '"wrong"' }, 412],
      [{ "if-match": "*" }, 200],
    ] as const) {
      const r = await get("events/", conditions);
      expect(r.status).toBe(status);
      expect(r.headers.get("bdp-scope-position")).toBe("pos-2");
      if (status !== 200) expect(await r.text()).toBe("");
    }
    for (const method of ["GET", "HEAD"]) {
      const r = await get("events/", { accept: "text/event-stream" }, method);
      expect(r.status).toBe(406);
      expect(await r.text()).toBe("");
    }
    const head = await get("beads/a?view=events", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await get("events/", { origin: "https://other.invalid" })).status).toBe(403);
    expect((await get("events/", { authorization: "" })).status).toBe(401);
    expect((await get("events/", {}, "DELETE")).status).toBe(405);
    await post([remove, { operation: "deleteBead", bead: "beads/a" }], "delete");
    expect((await get("beads/a")).status).toBe(404);
    expect((await get("beads/a?view=events")).status).toBe(200);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("checks the admitted group byte length before selecting its body and proves first-page feasibility", () => {
  expect(TRANSACTION_EVENT_GROUP_BYTES).toBe(169345024);
  expect(TRANSACTION_EVENT_FIRST_PAGE_BYTES).toBe(1778688);
  expect(TRANSACTION_EVENT_FIRST_PAGE_BYTES).toBeLessThan(TRANSACTION_EVENT_PAGE_BYTES);
  const f = fixture();
  f.run([bead("a")]);
  const prepare = DatabaseSync.prototype.prepare;
  let bodySelected = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    const statement = prepare.call(this, sql);
    if (sql.includes("length(CAST(body AS BLOB)) AS bytes"))
      vi.spyOn(statement, "get").mockReturnValue({
        position: 1,
        bytes: TRANSACTION_EVENT_GROUP_BYTES + 1,
      });
    if (sql === "SELECT body FROM groups WHERE position=?")
      vi.spyOn(statement, "get").mockImplementation(() => {
        bodySelected = true;
        throw new Error("body copied before length refusal");
      });
    return statement;
  });
  expect(() => f.owner.readEvents(`${scope}events/`)).toThrow(
    "retained Event group exceeds admitted byte bound",
  );
  expect(bodySelected).toBe(false);
  vi.restoreAllMocks();
  expect(collect(f.owner, `${scope}events/`).events).toHaveLength(1);
});
