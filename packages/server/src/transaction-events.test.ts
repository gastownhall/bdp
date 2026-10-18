import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
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
import * as batch from "./transaction-batch.js";
import {
  TRANSACTION_EVENT_PAGE_BYTES,
  TRANSACTION_EVENT_STREAM,
  TRANSACTION_EVENT_GROUP_BYTES,
  TRANSACTION_EVENT_FIRST_PAGE_BYTES,
  TransactionEventParameterError,
  TransactionEventProjectionGap,
  renderTransactionEvent,
  transactionEventRequest,
  type TransactionEventPage,
} from "./transaction-events.js";
import {
  TransactionMinimumFailure,
  TransactionMinimumUnproved,
} from "./transaction-consistency.js";

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
const validPage = ajv.compile<TransactionEventPage>({ $ref: `${schema.$id}#/$defs/eventPage` });
const validMinimumProblem = ajv.compile({ $ref: `${schema.$id}#/$defs/transactionalProblem` });
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
  const config = f.owner.readConfiguration();
  expect(f.owner.readEvents(`${scope}beads/missing?view=events`)).toStrictEqual({
    kind: "missing",
    context: {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      scopePosition: "pos-2",
    },
  });
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
  expect(f.owner.readEvents(`${scope}beads/unknown?view=events`, undefined, minimum)).toStrictEqual(
    {
      kind: "missing",
      context: {
        scopeEpoch: config.scopeEpoch,
        authorizationView: config.authorizationView,
        scopePosition: "pos-1",
      },
    },
  );
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
    const seedResponse = await post(
      [{ ...bead("a"), properties: { n: 0, text: '"\\\n🦄' } }, bead("b"), link()],
      "seed",
    );
    const seedReceipt = await seedResponse.json();
    if (
      !seedReceipt ||
      typeof seedReceipt !== "object" ||
      !("id" in seedReceipt) ||
      typeof seedReceipt.id !== "string"
    )
      throw new Error("expected seed receipt identity");
    for (const route of [
      "alias/missing?view=events",
      `${seedReceipt.id}?view=events`,
      "receipts/missing?view=events",
    ]) {
      const refused = await get(route);
      expect.soft(refused.status, route).toBe(404);
      expect.soft(await refused.json(), route).toMatchObject({ code: "resource-not-found" });
    }
    const response = await get("events/"),
      body = await response.json();
    expect(response.status).toBe(200);
    if (!validPage(body)) throw new Error(JSON.stringify(validPage.errors));
    const firstEvent = body.events[0],
      secondEvent = body.events[1];
    if (!firstEvent || !secondEvent) throw new Error("expected seeded Event facts");
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
      const r = await get("events/", { accept: "text/plain" }, method);
      expect(r.status).toBe(406);
      expect(await r.text()).toBe("");
    }
    const correspondingGet = await get("beads/a?view=events");
    const correspondingText = await correspondingGet.text();
    const head = await get("beads/a?view=events", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(correspondingText)));
    expect(head.headers.get("content-length")).not.toBe(String(correspondingText.length));
    expect(head.headers.get("content-type")).toBe(correspondingGet.headers.get("content-type"));
    expect(await head.text()).toBe("");
    const neverMember = renderTransactionEvent(
      { scopeEpoch: epoch, authorizationView: view },
      `${scope}beads/a?view=events`,
      "pos-1",
      secondEvent,
    );
    for (const after of ["malformed", firstEvent.id, neverMember.id]) {
      const route = `beads/a?view=events&after=${encodeURIComponent(after)}`;
      const invalid = await get(route);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "invalid-parameter" });
      const invalidHead = await get(route, {}, "HEAD");
      expect(invalidHead.status).toBe(400);
      expect(await invalidHead.text()).toBe("");
    }
    // Existing canonical Resource-path validation refuses this alternate spelling.
    const noncanonical = await get("beads/%61?view=events");
    expect(noncanonical.status).toBe(400);
    expect(await noncanonical.json()).toMatchObject({ code: "invalid-parameter" });
    for (const route of [
      "alias/missing?view=events",
      "alias/%61?q=1",
      "alias/%61",
      "receipts?view=events",
      `${seedReceipt.id}?view=events`,
      `${seedReceipt.id}/pages/missing?view=events`,
    ]) {
      for (const method of ["GET", "HEAD"]) {
        for (const minimum of ["pos-99", "opaque-unknown"]) {
          const refused = await get(
            route,
            { ...headers, "bdp-minimum-scope-position": minimum },
            method,
          );
          expect(refused.status).toBe(404);
          if (method === "HEAD") expect(await refused.text()).toBe("");
        }
      }
    }
    expect((await get("events/", { origin: "https://other.invalid" })).status).toBe(403);
    expect((await get("events/", { authorization: "" })).status).toBe(401);
    expect((await get("events/", {}, "DELETE")).status).toBe(405);
    await post([remove, { operation: "deleteBead", bead: "beads/a" }], "delete");
    expect((await get("beads/a")).status).toBe(404);
    expect((await get("beads/a?view=events")).status).toBe(200);
    expect(
      (await post([bead("c"), bead("d"), link("metadata", "beads/c", "beads/d")], "metadata-seed"))
        .status,
    ).toBe(200);
    expect(
      (
        await post(
          [
            {
              operation: "updateLink",
              link: "links/metadata",
              metadataChange: [{ op: "add", path: "/note", value: "pending-ruling" }],
            },
          ],
          "metadata-update",
        )
      ).status,
    ).toBe(200);
    for (const method of ["GET", "HEAD"]) {
      const gap = await get("beads/c?view=events", {}, method);
      expect(gap.status).toBe(500);
      expect(gap.headers.get("x-bdp-development-limit")).toBe("incident-link-metadata");
      expect(gap.headers.get("x-bdp-development")).toBe("non-attesting");
      expect(await gap.text()).toBe("");
    }
    expect((await get("links/metadata?view=events")).status).toBe(200);
    expect((await get("events/")).status).toBe(200);
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

it("checks minimum position before any retained group scan or body materialization", () => {
  const f = fixture();
  f.run([bead("a")]);
  const current = f.owner.readEvents(`${scope}events/`);
  if (current.kind !== "page") throw new Error("expected page");
  const prepare = DatabaseSync.prototype.prepare;
  let groupReads = 0;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (/FROM groups/.test(sql)) groupReads++;
    return prepare.call(this, sql);
  });
  expect(() =>
    f.owner.readEvents(`${scope}events/`, undefined, {
      scopeEpoch: current.context.scopeEpoch,
      authorizationView: current.context.authorizationView,
      minimumPosition: "pos-2",
    }),
  ).toThrow(expect.objectContaining({ reason: "behind" }));
  expect(groupReads).toBe(0);
});

it("continues a Resource cursor across groups with zero contributions and observes the true end", () => {
  const f = fixture();
  f.run([bead("a"), bead("b")]);
  const source = `${scope}beads/a?view=events`;
  const first = collect(f.owner, source).events[0];
  if (!first) throw new Error("expected a created fact");
  for (let n = 1; n <= 12; n++) {
    expect(
      f.run([
        {
          operation: "updateBead",
          bead: "beads/b",
          propertiesChange: [{ op: "replace", path: "/n", value: n }],
        },
      ]).status,
    ).toBe("completed");
  }
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  expect(f.owner.readEvents(source, first.id)).toMatchObject({
    kind: "page",
    page: { source, events: [], next: null },
    context: { scopePosition: "pos-13" },
  });
  expect(prepare.mock.calls.filter(([sql]) => /FROM groups/.test(sql))).toHaveLength(2);
  prepare.mockRestore();
  f.run([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
  ]);
  expect(f.owner.readEvents(source, first.id)).toMatchObject({
    kind: "page",
    page: {
      events: [
        expect.objectContaining({ subject: `${scope}beads/a`, type: "updated", ordinal: 0 }),
      ],
      next: null,
    },
    context: { scopePosition: "pos-14" },
  });
});

it.each(["missing", "body-type", "context", "ordinal"] as const)(
  "refuses retained group %s corruption without changing the valid owner",
  (fault) => {
    const f = fixture();
    f.run([bead("a")]);
    const before = collect(f.owner, `${scope}events/`);
    const prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql,
    ) {
      const statement = prepare.call(this, sql);
      if (fault === "missing" && sql.includes("length(CAST(body AS BLOB)) AS bytes"))
        vi.spyOn(statement, "get").mockReturnValue(undefined);
      if (fault !== "missing" && sql === "SELECT body FROM groups WHERE position=?") {
        const get = statement.get.bind(statement);
        vi.spyOn(statement, "get").mockImplementation((...args) => {
          const row = get(...args);
          if (fault === "body-type") return { body: null };
          const group = JSON.parse(String(row?.body));
          if (fault === "context") group.scopeEpoch = "wrong";
          else group.events[0].ordinal = 999;
          return { body: JSON.stringify(group) };
        });
      }
      return statement;
    });
    expect(() => f.owner.readEvents(`${scope}events/`)).toThrow(
      fault === "missing"
        ? "missing retained Event group"
        : fault === "body-type"
          ? "invalid retained Event group body"
          : fault === "context"
            ? "retained Event group context mismatch"
            : "invalid retained Event framing",
    );
    vi.restoreAllMocks();
    expect(collect(f.owner, `${scope}events/`)).toEqual(before);
  },
);

it("refuses a retained positional hole after a matched cursor rather than skipping the group", () => {
  const f = fixture();
  for (const id of ["a", "b", "c"]) expect(f.run([bead(id)]).status).toBe("completed");
  const source = `${scope}events/`;
  const before = collect(f.owner, source);
  const cursor = before.events[0]?.id;
  if (!cursor) throw new Error("expected retained cursor");
  f.owner.close();
  const db = new DatabaseSync(f.options.file);
  const removed = db.prepare("SELECT body FROM groups WHERE position=2").get()?.body;
  if (typeof removed !== "string") throw new Error("expected middle group");
  db.prepare("DELETE FROM groups WHERE position=2").run();
  db.close();
  f.reopen();
  expect(() => f.owner.readEvents(source, cursor)).toThrow("missing retained Event group");
  f.owner.close();
  const repair = new DatabaseSync(f.options.file);
  repair.prepare("INSERT INTO groups(position,body) VALUES(2,?)").run(removed);
  repair.close();
  f.reopen();
  expect(collect(f.owner, source)).toEqual(before);
});

it("accounts exact UTF8 and escaped Event bytes once rather than repeatedly serializing a growing page", () => {
  const f = fixture(scope, false, 64);
  for (let n = 0; n < 20; n++) {
    expect(f.run([{ ...bead(`b${n}`), properties: { text: '\"\\\n🦄'.repeat(100) } }]).status).toBe(
      "completed",
    );
  }
  const serializer = vi.spyOn(batch, "transactionStorageText");
  const result = f.owner.readEvents(`${scope}events/`);
  if (result.kind !== "page") throw new Error("expected page");
  expect(result.page.events).toHaveLength(20);
  const fullPageSerializations = serializer.mock.calls.filter(
    ([value]) => value && typeof value === "object" && "events" in value,
  );
  expect(fullPageSerializations).toHaveLength(1);
  expect(fullPageSerializations[0]?.[0]).toMatchObject({ events: [], next: null });
  const eventSerializations = serializer.mock.calls.filter(
    ([value]) => value && typeof value === "object" && "ordinal" in value,
  );
  expect(eventSerializations).toHaveLength(20);
  expect(Buffer.byteLength(stringifyJsonValue(result.page))).toBeLessThan(
    TRANSACTION_EVENT_PAGE_BYTES,
  );
  expect(validPage(result.page)).toBe(true);
});

function packet(value: ReturnType<ReturnType<typeof openTransactionStore>["beginEventScan"]>) {
  if (value.kind !== "packet") throw new Error(`expected Event packet: ${value.kind}`);
  return value;
}
function scanEvents(
  owner: ReturnType<typeof openTransactionStore>,
  source: string,
  after?: string,
) {
  let current = packet(owner.beginEventScan(source, after));
  const packets = [current];
  for (let guard = 0; !current.caughtUp; guard++) {
    if (guard > 1000) throw new Error("unbounded Event test scan");
    current = owner.advanceEventScan(current.scan);
    packets.push(current);
  }
  return { packets, events: packets.flatMap((p) => p.events), last: current };
}
it("private one-group scans preserve self-Link ordinals, partial packets and immutable replay", () => {
  const f = fixture(scope, true, 1);
  f.run([bead("a")]);
  f.run([link("l", "beads/a", "beads/a"), patch, remove]);
  for (const source of [
    `${scope}events/`,
    `${scope}beads/a?view=events`,
    `${scope}links/l?view=events`,
  ]) {
    const finite = collect(f.owner, source).events;
    const scanned = scanEvents(f.owner, source);
    expect(scanned.events).toEqual(finite);
    expect(scanned.packets.every((p) => p.events.length <= 1)).toBe(true);
    expect(scanned.packets.every((p) => Object.isFrozen(p.scan))).toBe(true);
    expect(scanned.packets.every((p) => Object.keys(p.scan).length === 0)).toBe(true);
    const first = scanned.packets[0]!;
    expect(f.owner.advanceEventScan(first.scan)).toEqual(f.owner.advanceEventScan(first.scan));
    for (const [index, event] of finite.entries())
      expect(scanEvents(f.owner, source, event.id).events).toEqual(finite.slice(index + 1));
  }
});
it("idle scan advances do not construct group readers or reread unrelated historical bodies", () => {
  const f = fixture();
  f.run([bead("a"), bead("b")]);
  const source = `${scope}beads/a?view=events`,
    first = collect(f.owner, source).events[0]!;
  for (let n = 1; n <= 12; n++)
    f.run([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: n }],
      },
    ]);
  const prepare = DatabaseSync.prototype.prepare;
  let bodyGets = 0,
    groupPrepares = 0;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    const statement = prepare.call(this, sql);
    if (/FROM groups/.test(sql)) groupPrepares++;
    if (sql === "SELECT body FROM groups WHERE position=?") {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args) => {
        bodyGets++;
        return get(...args);
      });
    }
    return statement;
  });
  const step = TRANSACTION_EVENT_STREAM.maximumGroupsPerObservation;
  let observations = 1;
  let current = packet(f.owner.beginEventScan(source, first.id));
  expect(bodyGets).toBe(step); // Actual initial cursor membership in its group.
  while (!current.caughtUp) {
    const before = [bodyGets, groupPrepares];
    current = f.owner.advanceEventScan(current.scan);
    observations++;
    expect(bodyGets - before[0]!).toBe(Math.min(step, 13 - before[0]!));
    expect(groupPrepares - before[1]!).toBe(2);
    expect(current.events).toEqual([]);
  }
  expect(bodyGets).toBe(13);
  expect(observations).toBe(Math.ceil(13 / step));
  const counts = [bodyGets, groupPrepares];
  for (let n = 0; n < 5; n++) current = f.owner.advanceEventScan(current.scan);
  expect([bodyGets, groupPrepares]).toEqual(counts);
  f.run([
    {
      operation: "updateBead",
      bead: "beads/b",
      propertiesChange: [{ op: "replace", path: "/n", value: 99 }],
    },
  ]);
  const before = bodyGets;
  current = f.owner.advanceEventScan(current.scan);
  expect(bodyGets - before).toBe(1);
  expect(current.events).toEqual([]);
  f.run([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
  ]);
  current = f.owner.advanceEventScan(current.scan);
  expect(current.events.map((e) => e.type)).toEqual(["updated"]);
  expect(current.context.scopePosition).toBe("pos-15");
});
it("scan handles cannot be fabricated, moved between owners or reused across reopen/close", () => {
  const a = fixture(),
    b = fixture();
  const initial = packet(a.owner.beginEventScan(`${scope}events/`));
  expect(initial).toMatchObject({
    events: [],
    caughtUp: true,
    context: { scopePosition: "pos-0" },
  });
  expect(() => b.owner.advanceEventScan(initial.scan)).toThrow("foreign or fabricated");
  expect(() => a.owner.advanceEventScan({} as typeof initial.scan)).toThrow(
    "foreign or fabricated",
  );
  a.reopen();
  expect(() => a.owner.advanceEventScan(initial.scan)).toThrow("foreign or fabricated");
  const live = packet(a.owner.beginEventScan(`${scope}events/`));
  a.owner.close();
  expect(() => a.owner.advanceEventScan(live.scan)).toThrow("closed");
});
it("scan initial identity and minimum precede reconnect validity; contextual errors preserve the observed entry", () => {
  const f = fixture();
  f.run([bead("a")]);
  const current = packet(f.owner.beginEventScan(`${scope}events/`));
  const minimum = {
    scopeEpoch: current.context.scopeEpoch,
    authorizationView: current.context.authorizationView,
    minimumPosition: "pos-9",
  };
  expect(f.owner.beginEventScan(`${scope}beads/missing?view=events`, "bad", minimum, true)).toEqual(
    { kind: "missing", context: current.context },
  );
  expect(() => f.owner.beginEventScan(`${scope}beads/a?view=events`, "bad", minimum, true)).toThrow(
    expect.objectContaining({ reason: "behind", context: current.context }),
  );
  for (const after of ["", "genesis", current.events[0]!.id.replace(/pos-1_/, "pos-99_")]) {
    expect(() => f.owner.beginEventScan(`${scope}events/`, after)).toThrow(
      expect.objectContaining({ context: current.context }),
    );
  }
  expect(() => f.owner.readEvents(`${scope}beads/a?view=events`, current.events[0]!.id)).toThrow(
    expect.objectContaining({ context: current.context }),
  );
});
it("byte-bound scan packets preserve the exact finite reservation and within-group suffix", () => {
  const s = `https://example.test/${"s".repeat(60000)}/`;
  const f = fixture(s, false, 64);
  expect(f.run([bead("a", s)]).status).toBe("completed");
  const source = `${s}events/`,
    before = collect(f.owner, source).events.at(-1)!.id;
  expect(
    f.run(
      Array.from({ length: 32 }, (_, n) => ({
        operation: "updateBead",
        bead: "beads/a",
        propertiesChange: [{ op: "replace", path: "/n", value: n + 1 }],
      })),
    ),
  ).toMatchObject({ status: "completed" });
  const finite = f.owner.readEvents(source, before);
  if (finite.kind !== "page") throw new Error("expected finite page");
  // The first stream entry validates the original cursor, then yields at the
  // group boundary. The next one uses the same exact finite byte reservation.
  const initial = packet(f.owner.beginEventScan(source, before));
  expect(initial.events).toEqual([]);
  const bounded = f.owner.advanceEventScan(initial.scan);
  expect(bounded.events).toEqual(finite.page.events);
  expect(bounded.events.length).toBeGreaterThan(0);
  expect(bounded.events.length).toBeLessThan(32);
  expect(finite.page.next).toBe(new URL(`events/?after=${bounded.events.at(-1)!.id}`, s).href);
  expect(bounded.caughtUp).toBe(false);
  const all = scanEvents(f.owner, source, before).events;
  expect(all).toHaveLength(32);
  expect(new Set(all.map((e) => e.id)).size).toBe(32);
  expect(all.map((e) => e.ordinal)).toEqual(Array.from({ length: 32 }, (_, n) => n));
});

it("scan refuses a regressed captured head and a sticky fenced owner", () => {
  const f = fixture();
  f.run([bead("a")]);
  const scan = packet(f.owner.beginEventScan(`${scope}events/`)).scan;
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    const statement = prepare.call(this, sql);
    if (sql === "SELECT value FROM metadata WHERE name=?") {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, "get").mockImplementation((...args) =>
        (args[0] as unknown) === "position" ? { value: "0" } : get(...args),
      );
    }
    return statement;
  });
  expect(() => f.owner.advanceEventScan(scan)).toThrow("head regressed");
  vi.restoreAllMocks();
  const exec = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "COMMIT") throw new Error("injected uncertain commit");
    return exec.call(this, sql);
  });
  expect(() => f.run([bead("b")])).toThrow();
  expect(() => f.owner.advanceEventScan(scan)).toThrow("owner fenced");
  vi.restoreAllMocks();
});

it("refuses configuration whose group step differs from the structural owner implementation", async () => {
  vi.resetModules();
  vi.doMock("./transaction-events.js", async () => {
    const actual =
      await vi.importActual<typeof import("./transaction-events.js")>("./transaction-events.js");
    return {
      ...actual,
      TRANSACTION_EVENT_STREAM: Object.freeze({
        ...actual.TRANSACTION_EVENT_STREAM,
        maximumGroupsPerObservation: 2,
      }),
    };
  });
  try {
    await expect(import("./transaction-store.js")).rejects.toThrow(
      "owner scan implements exactly one group per entry",
    );
  } finally {
    vi.doUnmock("./transaction-events.js");
    vi.resetModules();
  }
});

it.each([
  { mode: "finite", kind: "Bead", id: "beads/missing" },
  { mode: "finite", kind: "Link", id: "links/missing" },
  { mode: "SSE", kind: "Bead", id: "beads/missing" },
  { mode: "SSE", kind: "Link", id: "links/missing" },
] as const)(
  "captures immutable current context for missing $mode $kind Event source",
  ({ mode, id }) => {
    const f = fixture();
    const config = f.owner.readConfiguration();
    const url = `${scope}${id}?view=events`;
    const expected = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      scopePosition: "pos-0",
    };
    const initial = mode === "finite" ? f.owner.readEvents(url) : f.owner.beginEventScan(url);
    expect(initial).toStrictEqual({ kind: "missing", context: expected });
    if (initial.kind !== "missing") throw new Error("expected missing Event source");
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.context)).toBe(true);
    expect(f.run([bead("known")]).status).toBe("completed");
    const current = { ...expected, scopePosition: "pos-1" };
    expect(mode === "finite" ? f.owner.readEvents(url) : f.owner.beginEventScan(url)).toStrictEqual(
      {
        kind: "missing",
        context: current,
      },
    );
    expect(initial.context).toStrictEqual(expected);
    expect(
      mode === "finite"
        ? f.owner.readEvents(url, undefined, "unsupported")
        : f.owner.beginEventScan(url, undefined, "unsupported"),
    ).toStrictEqual({ kind: "missing", context: current });
    const minimum = {
      scopeEpoch: config.scopeEpoch,
      authorizationView: config.authorizationView,
      minimumPosition: "pos-9",
    };
    expect(
      mode === "finite"
        ? f.owner.readEvents(url, "bad", minimum)
        : f.owner.beginEventScan(url, "bad", minimum, true),
    ).toStrictEqual({ kind: "missing", context: current });
  },
);

it("serves contextual missing Event responses for Bead and Link JSON and SSE GET and HEAD", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-events-http-"));
  const token = randomBytes(32).toString("base64url");
  const controller = new AbortController();
  const deadlineReason = new Error("Event context deadline");
  let deadlineExceeded = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(deadlineReason);
  }, 45000);
  const failures: unknown[] = [];
  let runtime:
    | Awaited<ReturnType<typeof import("./transaction-runtime.js").startTransactionRuntime>>
    | undefined;
  let attempts = 0;
  let closed = false;
  const observations: {
    method: string;
    url: string;
    accept: string;
    status: number;
    body: string;
    headers: Record<string, string | null>;
  }[] = [];
  const names = [
    "content-type",
    "content-length",
    "cache-control",
    "retry-after",
    "www-authenticate",
    "x-bdp-development",
    "x-bdp-development-limit",
    "bdp-scope-epoch",
    "bdp-authorization-view",
    "bdp-scope-position",
  ];
  try {
    const emitted = (await import(
      new URL("../dist/transaction-runtime.js", import.meta.url).href
    )) as typeof import("./transaction-runtime.js");
    runtime = await emitted.startTransactionRuntime({
      directory,
      scope,
      create: true,
      port: 0,
      types: types(scope),
      credentials: [{ token, principal: "p", canMutate: true }],
    });
    const active = runtime;
    expect(active.targets.batch).toBe(`${scope}operations/batch`);
    const exchange = async (
      target: string,
      method: "GET" | "HEAD" | "POST",
      accept: string,
      body?: string,
      authenticated = true,
    ) => {
      controller.signal.throwIfAborted();
      expect(++attempts, "Event context dispatch bound").toBeLessThanOrEqual(11);
      const canonical = new URL(target, scope);
      const wire = new URL(canonical.pathname + canonical.search, active.listenUrl);
      const requestAbort = new AbortController();
      const timer = setTimeout(
        () => requestAbort.abort(new Error("Event exchange deadline")),
        5000,
      );
      try {
        const response = await fetch(wire, {
          method,
          redirect: "error",
          signal: AbortSignal.any([controller.signal, requestAbort.signal]),
          headers: {
            accept,
            ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "idempotency-key": "missing-event-context-seed",
                }),
          },
          ...(body === undefined ? {} : { body }),
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          if (reader) {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              if (bytes + chunk.value.byteLength > 32768) {
                requestAbort.abort(new Error("Event response body limit"));
                throw new Error("Event response body exceeds32768bytes");
              }
              bytes += chunk.value.byteLength;
              chunks.push(chunk.value);
            }
          }
        } catch (error) {
          try {
            await reader?.cancel();
          } catch (cleanup) {
            throw new AggregateError([error, cleanup], "Event body read and cleanup failed");
          }
          throw error;
        } finally {
          reader?.releaseLock();
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
        const headers = Object.fromEntries(names.map((name) => [name, response.headers.get(name)]));
        const observation = {
          method,
          url: canonical.href,
          accept,
          status: response.status,
          body: text,
          headers,
        };
        observations.push(observation);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32768);
        expect(headers["x-bdp-development"]).toBe("non-attesting");
        return observation;
      } finally {
        clearTimeout(timer);
      }
    };
    const seed = await exchange(
      "operations/batch",
      "POST",
      "application/json",
      JSON.stringify({ operations: [bead("known")] }),
    );
    expect(seed.status).toBe(200);
    const receipt = JSON.parse(seed.body);
    const receiptValid = ajv.compile({ $ref: `${schema.$id}#/$defs/mutationReceipt` });
    expect(receiptValid(receipt), JSON.stringify(receiptValid.errors)).toBe(true);
    expect(receipt).toMatchObject({
      status: "completed",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
    });
    const known = await exchange("events/", "GET", "application/json");
    expect(known.status).toBe(200);
    const page = JSON.parse(known.body);
    expect(validPage(page), JSON.stringify(validPage.errors)).toBe(true);
    expect(page.source).toBe(`${scope}events/`);
    expect(page.next).toBe(null);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({ type: "created", subject: `${scope}beads/known` });
    const expected = [
      known.headers["bdp-scope-epoch"],
      known.headers["bdp-authorization-view"],
      "pos-1",
    ];
    expect(expected[0]).toBeTruthy();
    expect(expected[1]).toBeTruthy();
    expect(known.headers["bdp-scope-position"]).toBe("pos-1");
    const expectedProblem = {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    };
    let tupleChecks = 0;
    for (const [kind, collection] of [
      ["Bead", "beads"],
      ["Link", "links"],
    ] as const) {
      for (const [media, accept] of [
        ["JSON", "application/json"],
        ["SSE", "text/event-stream"],
      ] as const) {
        let getLength: string | null | undefined;
        for (const method of ["GET", "HEAD"] as const) {
          const response = await exchange(`${collection}/missing?view=events`, method, accept);
          const label = `missing-event-context:${kind}:${media}:${method}`;
          expect(response.status, label).toBe(404);
          expect(response.headers["content-type"]).toBe("application/problem+json");
          expect(response.headers["cache-control"]).toBe("private, no-store");
          expect(response.headers["retry-after"]).toBe(null);
          expect(response.headers["www-authenticate"]).toBe(null);
          expect(response.headers["x-bdp-development-limit"]).toBe(null);
          if (method === "GET") {
            expect(JSON.parse(response.body)).toStrictEqual(expectedProblem);
            getLength = response.headers["content-length"];
            expect(Number(getLength)).toBe(Buffer.byteLength(response.body));
          } else {
            expect(response.body).toBe("");
            expect(response.headers["content-length"]).toBe(getLength);
          }
          // Deliberately collect all eight context failures in the emitted control.
          // Final Vitest results, not this function's synchronous flow, determine success.
          tupleChecks++;
          expect
            .soft(
              [
                response.headers["bdp-scope-epoch"],
                response.headers["bdp-authorization-view"],
                response.headers["bdp-scope-position"],
              ],
              label,
            )
            .toStrictEqual(expected);
        }
      }
    }
    const anonymous = await exchange(
      "beads/missing?view=events",
      "GET",
      "text/event-stream",
      undefined,
      false,
    );
    expect(anonymous.status).toBe(401);
    expect(JSON.parse(anonymous.body)).toMatchObject({ code: "unauthenticated", status: 401 });
    expect(anonymous.headers["www-authenticate"]).toBe(
      'Bearer realm="bdp-transaction-development"',
    );
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(anonymous.headers[name]).toBe(null);
    expect(tupleChecks).toBe(8);
    expect(attempts).toBe(11);
    expect(observations).toHaveLength(11);
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
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(deadline);
    if (deadlineExceeded && !failures.includes(deadlineReason)) failures.push(deadlineReason);
    console.log(
      JSON.stringify({
        observation: "source-missing-event-context",
        verdict: "see-final-vitest-result",
        deadlineExceeded,
        attempts,
        completedResponses: observations.map(({ body, ...observation }) => ({
          ...observation,
          bodySha256: createHash("sha256").update(body).digest("hex"),
        })),
        closed,
        startupCompleted: runtime !== undefined,
        directory,
        directoryAbsent: !existsSync(directory),
        failureCount: failures.length,
        responseDigest: createHash("sha256").update(JSON.stringify(observations)).digest("hex"),
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Event context observation and cleanup failed");
}, 60000);

it("gates initial Scope Event unknown minima before retained scans", () => {
  const f = fixture();
  f.run([bead("a")]);
  let reads = 0;
  const read = (...args: Parameters<typeof f.owner.readEvents>) => {
    reads++;
    return f.owner.readEvents(...args);
  };
  const source = `${scope}events/`;
  const setup = read(source);
  if (setup.kind !== "page" || !setup.page.events[0]) throw new Error("expected seeded page");
  const after = setup.page.events[0].id;
  const minimum = {
    scopeEpoch: setup.context.scopeEpoch,
    authorizationView: setup.context.authorizationView,
    minimumPosition: "opaque",
  };
  const prepare = DatabaseSync.prototype.prepare;
  let groupReads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (/FROM groups/.test(sql)) groupReads++;
    return prepare.call(this, sql);
  });
  try {
    expect(() => read(source, undefined, minimum)).toThrow(TransactionMinimumUnproved);
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(() => read(source, undefined, { ...minimum, minimumPosition: "pos-2" })).toThrow(
      expect.objectContaining({ reason: "behind" }),
    );
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(
      read(source, undefined, { ...minimum, minimumPosition: setup.context.scopePosition }).kind,
    ).toBe("page");
    expect(groupReads).toBeGreaterThan(0);
    for (const foreign of [
      { scopeEpoch: "foreign-epoch" },
      { authorizationView: "foreign-view" },
    ]) {
      groupReads = 0;
      expect(() => read(source, undefined, { ...minimum, ...foreign })).toThrow(
        expect.objectContaining({
          reason: "scopeEpoch" in foreign ? "cursor-expired" : "foreign-view",
          context: setup.context,
        }),
      );
      expect(groupReads).toBe(0);
    }
    // The after-cursor tuple still fails capture before entry, not as owner-release evidence.
    groupReads = 0;
    expect(() => read(source, after, minimum)).toThrow(TypeError);
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(() => read(`${scope}beads/a?view=events`, undefined, minimum)).toThrow(
      TransactionMinimumUnproved,
    );
    expect(groupReads).toBe(0);
    expect(reads).toBe(8);
    console.log(
      JSON.stringify({ observation: "finite-event-minimum-owner", reads, seedMutations: 1 }),
    );
  } finally {
    spy.mockRestore();
  }
});

it("serves initial finite Scope Event opaque minima through bounded waiting", async () => {
  const emitted = (await import(
    new URL("../dist/transaction-runtime.js", import.meta.url).href
  )) as typeof import("./transaction-runtime.js");
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-minimum-http-"));
  let runtime: Awaited<ReturnType<typeof emitted.startTransactionRuntime>> | undefined;
  let calls = 0;
  const failures: unknown[] = [];
  try {
    runtime = await emitted.startTransactionRuntime(
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
    const active = runtime;
    const exchange = async (
      suffix: string,
      method: string,
      headers: Record<string, string> = {},
      requestBody?: string,
    ) => {
      expect(++calls).toBeLessThanOrEqual(32);
      const target = new URL(suffix, scope);
      return fetch(new URL(target.pathname + target.search, active.listenUrl), {
        method,
        headers: { authorization: `Bearer ${"a".repeat(32)}`, ...headers },
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
    };
    const seed = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "finite-event-minimum-seed" },
      JSON.stringify({ operations: [bead("a")] }),
    );
    expect(seed.status).toBe(200);
    await seed.text();
    const setup = await exchange("events/", "GET");
    expect(setup.status).toBe(200);
    const page: unknown = await setup.json();
    if (!validPage(page) || !page.events[0]) throw new Error("expected seeded Event page");
    const after = page.events[0].id;
    const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
    const context = Object.fromEntries(
      names.map((name) => {
        const value = setup.headers.get(name);
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    const opaque: Record<string, string> = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    const pair = async (
      suffix: string,
      headers: Record<string, string>,
      status: number,
      code?: string,
      observed = false,
    ) => {
      let getLength = 0;
      let getType: string | null = null;
      for (const method of ["GET", "HEAD"]) {
        const response = await exchange(suffix, method, headers);
        const text = await response.text();
        expect(response.status, `${method} ${suffix}`).toBe(status);
        for (const name of ["etag", "last-modified"])
          expect(response.headers.has(name)).toBe(false);
        if (status === 500) {
          // Explicit preserved private gap, not a normative Problem response.
          expect(text).toBe("");
          expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
        } else {
          expect(response.headers.has("x-bdp-development-limit")).toBe(false);
          if (method === "GET") {
            const value: unknown = JSON.parse(text);
            if (status === 200)
              expect(validPage(value), JSON.stringify(validPage.errors)).toBe(true);
            else {
              expect(validMinimumProblem(value), JSON.stringify(validMinimumProblem.errors)).toBe(
                true,
              );
              expect(value).toMatchObject({ status, code });
              if (status === 503)
                expect(value).toEqual({
                  type: "https://github.com/gastownhall/bdp/problems/unavailable",
                  status: 503,
                  code: "catch-up-timeout",
                  retry: "after-delay",
                });
            }
            getLength = Buffer.byteLength(text);
            getType = response.headers.get("content-type");
          } else {
            expect(text).toBe("");
            expect(response.headers.get("content-type")).toBe(getType);
            expect(response.headers.get("content-length")).toBe(String(getLength));
          }
        }
        for (const name of names)
          expect(response.headers.get(name), name).toBe(observed ? context[name]! : null);
        if (status === 503) {
          expect(response.headers.get("retry-after")).toBe("1");
          expect(response.headers.get("cache-control")).toBe("private, no-store");
        }
      }
    };
    const overlays: readonly Record<string, string>[] = [
      {},
      { "if-none-match": "*" },
      { "if-match": '"wrong"' },
    ];
    for (const overlay of overlays)
      await pair("events/", { ...opaque, ...overlay }, 503, "catch-up-timeout", true);
    await pair(
      "events/",
      { ...opaque, "bdp-minimum-scope-position": context["bdp-scope-position"]! },
      200,
      undefined,
      true,
    );
    await pair("events/", {}, 200, undefined, true);
    await pair(
      "events/",
      { ...opaque, "bdp-scope-epoch": "foreign-epoch" },
      410,
      "cursor-expired",
      true,
    );
    await pair(
      "events/",
      { ...opaque, "bdp-authorization-view": "foreign-view" },
      409,
      "foreign-view",
      true,
    );
    await pair(
      "events/",
      { ...opaque, accept: "text/event-stream" },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(`events/?after=${encodeURIComponent(after)}`, opaque, 503, "catch-up-timeout", true);
    await pair("beads/a?view=events", opaque, 503, "catch-up-timeout", true);
    await pair("events/", { ...opaque, "last-event-id": after }, 503, "catch-up-timeout", true);
    await pair("events/", { ...opaque, accept: "image/png" }, 503, "catch-up-timeout", true);
    await pair("events/", { "bdp-minimum-scope-position": "opaque" }, 400, "malformed-request");
    await pair("events/?unsupported=x", opaque, 400, "invalid-parameter");
    await pair("beads/missing?view=events", opaque, 404, "resource-not-found", true);
    expect(calls).toBe(32);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (runtime) await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    console.log(
      JSON.stringify({
        observation: "finite-event-minimum-http",
        calls,
        productChildren: 0,
        directoryAbsent: !existsSync(directory),
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "finite Event HTTP observation failed");
});

it("gates initial Bead Event unknown minima before retained scans", () => {
  const f = fixture();
  f.run([bead("a")]);
  let reads = 0;
  const read = (...args: Parameters<typeof f.owner.readEvents>) => {
    reads++;
    return f.owner.readEvents(...args);
  };
  const source = `${scope}beads/a?view=events`;
  const setup = read(source);
  if (setup.kind !== "page" || !setup.page.events[0]) throw new Error("expected seeded page");
  expect(setup.context.scopePosition).toBe("pos-1");
  const after = setup.page.events[0].id;
  const minimum = {
    scopeEpoch: setup.context.scopeEpoch,
    authorizationView: setup.context.authorizationView,
    minimumPosition: "opaque",
  };
  const prepare = DatabaseSync.prototype.prepare;
  let groupReads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (/FROM groups/.test(sql)) groupReads++;
    return prepare.call(this, sql);
  });
  try {
    expect(() => read(source, undefined, minimum)).toThrow(TransactionMinimumUnproved);
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(() => read(source, undefined, { ...minimum, minimumPosition: "pos-2" })).toThrow(
      expect.objectContaining({ reason: "behind" }),
    );
    expect(groupReads).toBe(0);
    groupReads = 0;
    const current = read(source, undefined, {
      ...minimum,
      minimumPosition: setup.context.scopePosition,
    });
    expect(current.kind).toBe("page");
    expect(groupReads).toBeGreaterThan(0);
    for (const foreign of [
      { scopeEpoch: "foreign-epoch" },
      { authorizationView: "foreign-view" },
    ]) {
      groupReads = 0;
      expect(() => read(source, undefined, { ...minimum, ...foreign })).toThrow(
        expect.objectContaining({
          reason: "scopeEpoch" in foreign ? "cursor-expired" : "foreign-view",
          context: setup.context,
        }),
      );
      expect(groupReads).toBe(0);
    }
    groupReads = 0;
    expect(() => read(source, after, minimum)).toThrow(TypeError);
    expect(groupReads).toBe(0);
    groupReads = 0;
    // The missing Link source returns current context before semantic minimum comparison.
    expect(read(`${scope}links/l?view=events`, undefined, minimum)).toEqual({
      kind: "missing",
      context: setup.context,
    });
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(read(`${scope}beads/unknown?view=events`, undefined, minimum)).toEqual({
      kind: "missing",
      context: setup.context,
    });
    expect(groupReads).toBe(0);
    f.run([{ operation: "deleteBead", bead: "beads/a" }]);
    groupReads = 0;
    const retained = read(source);
    if (retained.kind !== "page") throw new Error("expected retained Bead Event page");
    expect(validPage(retained.page), JSON.stringify(validPage.errors)).toBe(true);
    expect(retained.page.events.map((event) => event.type)).toEqual(["created", "deleted"]);
    expect(retained.page.next).toBe(null);
    expect(retained.context.scopePosition).toBe("pos-2");
    expect(groupReads).toBeGreaterThan(0);
    groupReads = 0;
    const retainedMinimum = {
      scopeEpoch: retained.context.scopeEpoch,
      authorizationView: retained.context.authorizationView,
      minimumPosition: "opaque",
    };
    let unproved: unknown;
    try {
      read(source, undefined, retainedMinimum);
    } catch (error) {
      unproved = error;
    }
    expect(unproved).toBeInstanceOf(TransactionMinimumUnproved);
    expect(unproved).toMatchObject({ context: retained.context });
    expect(groupReads).toBe(0);
    const policy = f.owner.replaceAuthorizationPolicy();
    expect(policy.readPolicy).toBe("empty");
    expect(policy.authorizationView).not.toBe(retained.context.authorizationView);
    groupReads = 0;
    // Hidden retained identity wins even over the previous view's opaque minimum.
    expect(read(source, undefined, retainedMinimum)).toEqual({
      kind: "missing",
      context: { ...retained.context, authorizationView: policy.authorizationView },
    });
    expect(groupReads).toBe(0);
    expect(reads).toBe(12);
    console.log(
      JSON.stringify({
        observation: "bead-event-minimum-owner",
        reads,
        seedMutations: 2,
        policyReplacements: 1,
        groupReadsAfterHidden: groupReads,
      }),
    );
  } finally {
    spy.mockRestore();
  }
});

it("serves initial finite Bead Event opaque minima with retained identity and route fences", async () => {
  const startedAt = Date.now();
  const emitted = (await import(
    new URL("../dist/transaction-runtime.js", import.meta.url).href
  )) as typeof import("./transaction-runtime.js");
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-bead-event-minimum-http-"));
  let runtime: Awaited<ReturnType<typeof emitted.startTransactionRuntime>> | undefined;
  let calls = 0;
  const responses: { method: string; suffix: string; status: number }[] = [];
  const failures: unknown[] = [];
  try {
    runtime = await emitted.startTransactionRuntime(
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
    const active = runtime;
    const exchange = async (
      suffix: string,
      method: string,
      headers: Record<string, string> = {},
      requestBody?: string,
    ) => {
      expect(++calls).toBeLessThanOrEqual(37);
      const target = new URL(suffix, scope);
      const response = await fetch(new URL(target.pathname + target.search, active.listenUrl), {
        method,
        headers: { authorization: `Bearer ${"a".repeat(32)}`, ...headers },
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
      responses.push({ method, suffix, status: response.status });
      return response;
    };
    const seed = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "bead-event-minimum-seed" },
      JSON.stringify({ operations: [bead("a"), bead("b"), bead("gone"), link()] }),
    );
    expect(seed.status).toBe(200);
    expect(await seed.json()).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
    const setup = await exchange("beads/a?view=events", "GET");
    expect(setup.status).toBe(200);
    const page: unknown = await setup.json();
    if (!validPage(page) || !page.events[0]) throw new Error("expected seeded Event page");
    expect(page.source).toBe(`${scope}beads/a?view=events`);
    const after = page.events[0].id;
    const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
    let context = Object.fromEntries(
      names.map((name) => {
        const value = setup.headers.get(name);
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    const opaque: Record<string, string> = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    const pair = async (
      suffix: string,
      headers: Record<string, string>,
      status: number,
      code?: string,
      observed = false,
    ) => {
      let getLength = 0;
      let getType: string | null = null;
      for (const method of ["GET", "HEAD"]) {
        const response = await exchange(suffix, method, headers);
        const text = await response.text();
        expect(response.status, `${method} ${suffix}`).toBe(status);
        for (const name of ["etag", "last-modified"])
          expect(response.headers.has(name)).toBe(false);
        if (status === 500) {
          // Explicit preserved private gap, not a normative Problem response.
          expect(text).toBe("");
          expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
        } else {
          expect(response.headers.has("x-bdp-development-limit")).toBe(false);
          if (method === "GET") {
            const value: unknown = JSON.parse(text);
            if (status === 200)
              expect(validPage(value), JSON.stringify(validPage.errors)).toBe(true);
            else {
              expect(validMinimumProblem(value), JSON.stringify(validMinimumProblem.errors)).toBe(
                true,
              );
              expect(value).toMatchObject({ status, code });
              if (status === 503)
                expect(value).toEqual({
                  type: "https://github.com/gastownhall/bdp/problems/unavailable",
                  status: 503,
                  code: "catch-up-timeout",
                  retry: "after-delay",
                });
            }
            getLength = Buffer.byteLength(text);
            getType = response.headers.get("content-type");
          } else {
            expect(text).toBe("");
            expect(response.headers.get("content-type")).toBe(getType);
            expect(response.headers.get("content-length")).toBe(String(getLength));
          }
        }
        for (const name of names)
          expect(response.headers.get(name), name).toBe(observed ? context[name]! : null);
        if (status === 503) {
          expect(response.headers.get("content-type")).toBe("application/problem+json");
          expect(response.headers.get("retry-after")).toBe("1");
          expect(response.headers.get("cache-control")).toBe("private, no-store");
        }
      }
    };
    const overlays: readonly Record<string, string>[] = [
      {},
      { "if-none-match": "*" },
      { "if-match": '"wrong"' },
    ];
    for (const overlay of overlays)
      await pair("beads/a?view=events", { ...opaque, ...overlay }, 503, "catch-up-timeout", true);
    await pair(
      "beads/a?view=events",
      { ...opaque, "bdp-minimum-scope-position": context["bdp-scope-position"]! },
      200,
      undefined,
      true,
    );
    await pair("beads/a?view=events", {}, 200, undefined, true);
    await pair(
      "beads/a?view=events",
      { ...opaque, "bdp-scope-epoch": "foreign-epoch" },
      410,
      "cursor-expired",
      true,
    );
    await pair(
      "beads/a?view=events",
      { ...opaque, "bdp-authorization-view": "foreign-view" },
      409,
      "foreign-view",
      true,
    );
    // Current Event minima also wait across stream, continuation and media selection.
    await pair("links/l?view=events", opaque, 503, "catch-up-timeout", true);
    await pair(
      "beads/a?view=events",
      { ...opaque, accept: "text/event-stream" },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      `beads/a?view=events&after=${encodeURIComponent(after)}`,
      opaque,
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "beads/a?view=events",
      { ...opaque, "last-event-id": after },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "beads/a?view=events",
      { ...opaque, accept: "image/png" },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "beads/a?view=events",
      { "bdp-minimum-scope-position": "opaque" },
      400,
      "malformed-request",
    );
    await pair("beads/a?view=events&unsupported=x", opaque, 400, "invalid-parameter");
    await pair("beads/missing?view=events", opaque, 404, "resource-not-found", true);
    const deletion = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "bead-event-minimum-delete" },
      JSON.stringify({ operations: [{ operation: "deleteBead", bead: "beads/gone" }] }),
    );
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      status: "completed",
      requiredPosition: "pos-2",
    });
    const missing = await exchange("beads/gone", "GET");
    expect(missing.status).toBe(404);
    const missingProblem: unknown = await missing.json();
    expect(validMinimumProblem(missingProblem), JSON.stringify(validMinimumProblem.errors)).toBe(
      true,
    );
    expect(missingProblem).toMatchObject({ code: "resource-not-found", status: 404 });
    const retained = await exchange("beads/gone?view=events", "GET");
    expect(retained.status).toBe(200);
    const retainedPage: unknown = await retained.json();
    if (!validPage(retainedPage)) throw new Error("expected retained Bead Event page");
    expect(retainedPage.source).toBe(`${scope}beads/gone?view=events`);
    expect(retainedPage.events.map((event) => event.type)).toEqual(["created", "deleted"]);
    context = Object.fromEntries(
      names.map((name) => {
        const value = retained.headers.get(name);
        if (!value) throw new Error(`missing retained ${name}`);
        return [name, value];
      }),
    );
    expect(context["bdp-scope-position"]).toBe("pos-2");
    await pair(
      "beads/gone?view=events",
      {
        "bdp-scope-epoch": context["bdp-scope-epoch"]!,
        "bdp-authorization-view": context["bdp-authorization-view"]!,
        "bdp-minimum-scope-position": "opaque",
      },
      503,
      "catch-up-timeout",
      true,
    );
    expect(responses.filter((response) => response.status === 503)).toHaveLength(18);
    expect(calls).toBe(37);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (runtime) await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    console.log(
      JSON.stringify({
        observation: "bead-event-minimum-http",
        calls,
        completedResponses: responses,
        elapsedMs: Date.now() - startedAt,
        productChildren: 0,
        directoryAbsent: !existsSync(directory),
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Bead Event HTTP observation failed");
});

it("gates initial Link Event unknown minima before retained scans", () => {
  const f = fixture();
  f.run([bead("a"), bead("b"), link()]);
  let reads = 0;
  const read = (...args: Parameters<typeof f.owner.readEvents>) => {
    reads++;
    return f.owner.readEvents(...args);
  };
  const source = `${scope}links/l?view=events`;
  const setup = read(source);
  if (setup.kind !== "page" || !setup.page.events[0]) throw new Error("expected seeded page");
  expect(setup.context.scopePosition).toBe("pos-1");
  expect(setup.page.source).toBe(source);
  expect(setup.page.events[0].subject).toBe(`${scope}links/l`);
  const after = setup.page.events[0].id;
  const minimum = {
    scopeEpoch: setup.context.scopeEpoch,
    authorizationView: setup.context.authorizationView,
    minimumPosition: "opaque",
  };
  const prepare = DatabaseSync.prototype.prepare;
  let groupReads = 0;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (/FROM groups/.test(sql)) groupReads++;
    return prepare.call(this, sql);
  });
  try {
    expect(() => read(source, undefined, minimum)).toThrow(TransactionMinimumUnproved);
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(() => read(source, undefined, { ...minimum, minimumPosition: "pos-2" })).toThrow(
      expect.objectContaining({ reason: "behind" }),
    );
    expect(groupReads).toBe(0);
    groupReads = 0;
    const current = read(source, undefined, {
      ...minimum,
      minimumPosition: setup.context.scopePosition,
    });
    expect(current.kind).toBe("page");
    expect(groupReads).toBeGreaterThan(0);
    for (const foreign of [
      { scopeEpoch: "foreign-epoch" },
      { authorizationView: "foreign-view" },
    ]) {
      groupReads = 0;
      expect(() => read(source, undefined, { ...minimum, ...foreign })).toThrow(
        expect.objectContaining({
          reason: "scopeEpoch" in foreign ? "cursor-expired" : "foreign-view",
          context: setup.context,
        }),
      );
      expect(groupReads).toBe(0);
    }
    groupReads = 0;
    expect(() => read(source, after, minimum)).toThrow(TypeError);
    expect(groupReads).toBe(0);
    groupReads = 0;
    expect(read(`${scope}links/unknown?view=events`, undefined, minimum)).toEqual({
      kind: "missing",
      context: setup.context,
    });
    expect(groupReads).toBe(0);
    f.run([{ operation: "deleteLink", link: "links/l" }]);
    groupReads = 0;
    const retained = read(source);
    if (retained.kind !== "page") throw new Error("expected retained Link Event page");
    expect(validPage(retained.page), JSON.stringify(validPage.errors)).toBe(true);
    expect(retained.page.events.map((event) => event.type)).toEqual(["created", "deleted"]);
    expect(retained.page.events.every((event) => event.subject === `${scope}links/l`)).toBe(true);
    expect(retained.page.next).toBe(null);
    expect(retained.context.scopePosition).toBe("pos-2");
    expect(groupReads).toBeGreaterThan(0);
    groupReads = 0;
    const retainedMinimum = {
      scopeEpoch: retained.context.scopeEpoch,
      authorizationView: retained.context.authorizationView,
      minimumPosition: "opaque",
    };
    let unproved: unknown;
    try {
      read(source, undefined, retainedMinimum);
    } catch (error) {
      unproved = error;
    }
    expect(unproved).toBeInstanceOf(TransactionMinimumUnproved);
    expect(unproved).toMatchObject({ context: retained.context });
    expect(groupReads).toBe(0);
    const policy = f.owner.replaceAuthorizationPolicy();
    expect(policy.readPolicy).toBe("empty");
    expect(policy.authorizationView).not.toBe(retained.context.authorizationView);
    groupReads = 0;
    // Hidden retained identity wins even over the previous view's opaque minimum.
    expect(read(source, undefined, retainedMinimum)).toEqual({
      kind: "missing",
      context: { ...retained.context, authorizationView: policy.authorizationView },
    });
    expect(groupReads).toBe(0);
    expect(reads).toBe(11);
    console.log(
      JSON.stringify({
        observation: "link-event-minimum-owner",
        reads,
        seedMutations: 2,
        policyReplacements: 1,
        groupReadsAfterHidden: groupReads,
      }),
    );
  } finally {
    spy.mockRestore();
  }
});

it("serves initial finite Link Event opaque minima with retained identity and route fences", async () => {
  const startedAt = Date.now();
  const emitted = (await import(
    new URL("../dist/transaction-runtime.js", import.meta.url).href
  )) as typeof import("./transaction-runtime.js");
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-link-event-minimum-http-"));
  let runtime: Awaited<ReturnType<typeof emitted.startTransactionRuntime>> | undefined;
  let calls = 0;
  const responses: { method: string; suffix: string; status: number }[] = [];
  const failures: unknown[] = [];
  try {
    runtime = await emitted.startTransactionRuntime(
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
    const active = runtime;
    const exchange = async (
      suffix: string,
      method: string,
      headers: Record<string, string> = {},
      requestBody?: string,
    ) => {
      expect(++calls).toBeLessThanOrEqual(35);
      const target = new URL(suffix, scope);
      const response = await fetch(new URL(target.pathname + target.search, active.listenUrl), {
        method,
        headers: { authorization: `Bearer ${"a".repeat(32)}`, ...headers },
        ...(requestBody === undefined ? {} : { body: requestBody }),
      });
      responses.push({ method, suffix, status: response.status });
      expect(response.headers.get("x-bdp-development")).toBe("non-attesting");
      return response;
    };
    const seed = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "link-event-minimum-seed" },
      JSON.stringify({ operations: [bead("a"), bead("b"), link(), link("gone")] }),
    );
    expect(seed.status).toBe(200);
    expect(await seed.json()).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
    const setup = await exchange("links/l?view=events", "GET");
    expect(setup.status).toBe(200);
    const page: unknown = await setup.json();
    if (!validPage(page) || !page.events[0]) throw new Error("expected seeded Event page");
    expect(page.source).toBe(`${scope}links/l?view=events`);
    const after = page.events[0].id;
    const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
    let context = Object.fromEntries(
      names.map((name) => {
        const value = setup.headers.get(name);
        if (!value) throw new Error(`missing ${name}`);
        return [name, value];
      }),
    );
    const opaque: Record<string, string> = {
      "bdp-scope-epoch": context["bdp-scope-epoch"]!,
      "bdp-authorization-view": context["bdp-authorization-view"]!,
      "bdp-minimum-scope-position": "opaque",
    };
    const pair = async (
      suffix: string,
      headers: Record<string, string>,
      status: number,
      code?: string,
      observed = false,
    ) => {
      let getLength = 0;
      let getType: string | null = null;
      for (const method of ["GET", "HEAD"]) {
        const response = await exchange(suffix, method, headers);
        const text = await response.text();
        expect(response.status, `${method} ${suffix}`).toBe(status);
        for (const name of ["etag", "last-modified"])
          expect(response.headers.has(name)).toBe(false);
        if (status === 500) {
          // Explicit preserved private gap, not a normative Problem response.
          expect(text).toBe("");
          expect(response.headers.get("x-bdp-development-limit")).toBe("minimum-position");
        } else {
          expect(response.headers.has("x-bdp-development-limit")).toBe(false);
          if (method === "GET") {
            const value: unknown = JSON.parse(text);
            if (status === 200)
              expect(validPage(value), JSON.stringify(validPage.errors)).toBe(true);
            else {
              expect(validMinimumProblem(value), JSON.stringify(validMinimumProblem.errors)).toBe(
                true,
              );
              expect(value).toMatchObject({ status, code });
              if (status === 503)
                expect(value).toEqual({
                  type: "https://github.com/gastownhall/bdp/problems/unavailable",
                  status: 503,
                  code: "catch-up-timeout",
                  retry: "after-delay",
                });
            }
            getLength = Buffer.byteLength(text);
            getType = response.headers.get("content-type");
          } else {
            expect(text).toBe("");
            expect(response.headers.get("content-type")).toBe(getType);
            expect(response.headers.get("content-length")).toBe(String(getLength));
          }
        }
        for (const name of names)
          expect(response.headers.get(name), name).toBe(observed ? context[name]! : null);
        if (status === 503) {
          expect(response.headers.get("content-type")).toBe("application/problem+json");
          expect(response.headers.get("retry-after")).toBe("1");
          expect(response.headers.get("cache-control")).toBe("private, no-store");
        }
      }
    };
    const overlays: readonly Record<string, string>[] = [
      {},
      { "if-none-match": "*" },
      { "if-match": '"wrong"' },
    ];
    for (const overlay of overlays)
      await pair("links/l?view=events", { ...opaque, ...overlay }, 503, "catch-up-timeout", true);
    await pair(
      "links/l?view=events",
      { ...opaque, "bdp-minimum-scope-position": context["bdp-scope-position"]! },
      200,
      undefined,
      true,
    );
    await pair("links/l?view=events", {}, 200, undefined, true);
    await pair(
      "links/l?view=events",
      { ...opaque, "bdp-scope-epoch": "foreign-epoch" },
      410,
      "cursor-expired",
      true,
    );
    await pair(
      "links/l?view=events",
      { ...opaque, "bdp-authorization-view": "foreign-view" },
      409,
      "foreign-view",
      true,
    );
    // Current Event minima precede stream, continuation, reconnect and media selection.
    await pair(
      "links/l?view=events",
      { ...opaque, accept: "text/event-stream" },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      `links/l?view=events&after=${encodeURIComponent(after)}`,
      opaque,
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "links/l?view=events",
      { ...opaque, "last-event-id": after },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "links/l?view=events",
      { ...opaque, accept: "image/png" },
      503,
      "catch-up-timeout",
      true,
    );
    await pair(
      "links/l?view=events",
      { "bdp-minimum-scope-position": "opaque" },
      400,
      "malformed-request",
    );
    await pair("links/l?view=events&unsupported=x", opaque, 400, "invalid-parameter");
    await pair("links/missing?view=events", opaque, 404, "resource-not-found", true);
    const deletion = await exchange(
      "operations/batch",
      "POST",
      { "content-type": "application/json", "idempotency-key": "link-event-minimum-delete" },
      JSON.stringify({ operations: [{ operation: "deleteLink", link: "links/gone" }] }),
    );
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      status: "completed",
      requiredPosition: "pos-2",
    });
    const missing = await exchange("links/gone", "GET");
    expect(missing.status).toBe(404);
    const missingProblem: unknown = await missing.json();
    expect(validMinimumProblem(missingProblem), JSON.stringify(validMinimumProblem.errors)).toBe(
      true,
    );
    expect(missingProblem).toMatchObject({ code: "resource-not-found", status: 404 });
    const retained = await exchange("links/gone?view=events", "GET");
    expect(retained.status).toBe(200);
    const retainedPage: unknown = await retained.json();
    if (!validPage(retainedPage)) throw new Error("expected retained Link Event page");
    expect(retainedPage.source).toBe(`${scope}links/gone?view=events`);
    expect(retainedPage.events.map((event) => event.type)).toEqual(["created", "deleted"]);
    expect(retainedPage.events.every((event) => event.subject === `${scope}links/gone`)).toBe(true);
    context = Object.fromEntries(
      names.map((name) => {
        const value = retained.headers.get(name);
        if (!value) throw new Error(`missing retained ${name}`);
        return [name, value];
      }),
    );
    expect(context["bdp-scope-position"]).toBe("pos-2");
    await pair(
      "links/gone?view=events",
      {
        "bdp-scope-epoch": context["bdp-scope-epoch"]!,
        "bdp-authorization-view": context["bdp-authorization-view"]!,
        "bdp-minimum-scope-position": "opaque",
      },
      503,
      "catch-up-timeout",
      true,
    );
    expect(responses.filter((response) => response.status === 503)).toHaveLength(16);
    expect(responses.filter((response) => response.status === 500)).toHaveLength(0);
    expect(calls).toBe(35);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (runtime) await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    console.log(
      JSON.stringify({
        observation: "link-event-minimum-http",
        calls,
        completedResponses: responses,
        elapsedMs: Date.now() - startedAt,
        productChildren: 0,
        directoryAbsent: !existsSync(directory),
        failureCount: failures.length,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Link Event HTTP observation failed");
});
