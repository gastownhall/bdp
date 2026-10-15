import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransaction } from "./transaction-batch.js";
const scope = "https://example.test/pages/",
  type = "https://example.test/bead";
const types = [parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] })];
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
const operations = (count = 5) =>
  Array.from({ length: count }, (_, n) => ({
    operation: "createBead",
    id: `beads/b${n}`,
    type,
    properties: { n },
  }));
function fixture(extra: Partial<Parameters<typeof openTransactionStore>[0]> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-page-owner-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000;
  const options = {
    file: path.join(directory, "owner.sqlite"),
    scope,
    types,
    create: true,
    receiptMaximumItems: 2,
    clock: () => now,
    ...extra,
  };
  let owner = openTransactionStore(options);
  cleanup.push(() => {
    try {
      owner.close();
    } catch {}
  });
  return {
    options,
    get owner() {
      return owner;
    },
    time(value: number) {
      now = value;
    },
    reopen() {
      owner.close();
      owner = openTransactionStore({ ...options, create: false });
      return owner;
    },
    raw(fn: (db: DatabaseSync) => void) {
      owner.close();
      const db = new DatabaseSync(options.file);
      try {
        fn(db);
      } finally {
        db.close();
      }
    },
    claim(ops: unknown[] = operations(), key = "key") {
      const claim = owner.admit(
        "p",
        key,
        prepareTransaction(scope, JSON.stringify({ operations: ops })),
      );
      if (claim.kind !== "owned") throw new Error("expected admission");
      return claim.claim;
    },
  };
}
function pageUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected next URL");
  return value;
}
it("records one atomic page chain, retains original postimages and all tail allocations through expiry", () => {
  const f = fixture(),
    first = f.owner.executeObserved(f.claim());
  expect(first.receipt.results).toHaveLength(2);
  const next = pageUrl(first.receipt.next),
    page = f.owner.readReceiptPage("p", next);
  expect(page).toMatchObject({ kind: "page", page: { receipt: first.receipt.id } });
  if (page.kind !== "page") throw new Error("expected page");
  expect(page.page.results).toHaveLength(2);
  const last = pageUrl(page.page.next);
  expect(f.owner.readReceiptPage("p", last)).toMatchObject({ kind: "page", page: { next: null } });
  expect(f.owner.inspect().groups).toHaveLength(1);
  f.reopen();
  expect(f.owner.readReceiptPage("p", next)).toEqual(page);
  const changed = f.owner.admit(
    "p",
    "change",
    prepareTransaction(
      scope,
      JSON.stringify({ operations: [{ operation: "deleteBead", bead: "beads/b2" }] }),
    ),
  );
  if (changed.kind !== "owned") throw new Error("owner");
  f.owner.execute(changed.claim);
  const after = f.owner.readReceiptPage("p", next);
  expect(after).toMatchObject({
    kind: "page",
    page: page.page,
    context: { scopePosition: "pos-2" },
  });
  f.time(86401001);
  const expired = f.owner.readReceipt("p", first.receipt.id);
  expect(expired.receipt).toMatchObject({ detail: "expired" });
  expect(expired.receipt?.allocated).toHaveLength(5);
  expect(f.owner.readReceiptPage("p", last).kind).toBe("expired");
  expect(f.owner.readReceiptPage("other", last).kind).toBe("missing");
  expect(f.owner.readReceiptPage("p", `${first.receipt.id}/pages/unknown`).kind).toBe("missing");
  expect(() =>
    f.owner.readReceiptPage("p", last, {
      scopeEpoch: first.context.scopeEpoch,
      authorizationView: "foreign",
      minimumPosition: "pos-2",
    }),
  ).toThrow("foreign-view");
});
it.each(["after-effects", "after-terminal"] as const)(
  "rolls pages and all effects back after %s failure",
  (stage) => {
    let armed = true;
    const f = fixture({
      fault(at) {
        if (armed && at === stage) throw new Error("injected terminal failure");
      },
    });
    expect(() => f.owner.executeObserved(f.claim())).toThrow("injected terminal failure");
    expect(f.owner.inspect().groups).toEqual([]);
    f.raw((db) => {
      expect(db.prepare("SELECT * FROM receipt_pages").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM receipt_page_ranges").all()).toEqual([]);
    });
    armed = false;
    f.reopen();
    expect(f.owner.executeObserved(f.claim()).receipt.next).toBeTypeOf("string");
  },
);
it("fences uncertain COMMIT and recovers the original committed pages", () => {
  const f = fixture(),
    claim = f.claim(),
    original = DatabaseSync.prototype.exec;
  let armed = true;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const result = original.call(this, sql);
    if (armed && sql === "COMMIT") {
      armed = false;
      throw new Error("uncertain commit");
    }
    return result;
  });
  expect(() => f.owner.executeObserved(claim)).toThrow();
  expect(() => f.owner.inspect()).toThrow();
  spy.mockRestore();
  f.reopen();
  const replay = f.owner.admitObserved(
    "p",
    "key",
    prepareTransaction(scope, JSON.stringify({ operations: operations() })),
  );
  if (replay.kind !== "existing") throw new Error("retained receipt");
  expect(f.owner.readReceiptPage("p", pageUrl(replay.receipt.next)).kind).toBe("page");
  expect(f.owner.inspect().groups).toHaveLength(1);
});
it.each(["missing", "overlap", "truncated", "foreign-parent"])(
  "fails service instead of recomputing a %s page chain",
  (corruption) => {
    const f = fixture(),
      first = f.owner.executeObserved(f.claim());
    f.raw((db) => {
      if (corruption === "missing") db.exec("DELETE FROM receipt_pages");
      else if (corruption === "foreign-parent") db.exec("UPDATE receipt_pages SET key='different'");
      else {
        if (corruption === "overlap")
          db.exec("UPDATE receipt_page_ranges SET start=start-1 WHERE start=4");
        else db.exec("DELETE FROM receipt_page_ranges WHERE start=4");
      }
    });
    f.reopen();
    expect(() => f.owner.readReceipt("p", first.receipt.id)).toThrow();
    expect(() => f.owner.readReceiptPage("p", pageUrl(first.receipt.next))).toThrow();
  },
);
it.each(["format", "bound"])(
  "refuses incompatible %s before pending recovery and expiry byte-identically",
  (change) => {
    const f = fixture();
    f.owner.execute(f.claim());
    f.claim(operations(1), "pending");
    f.time(86401001);
    f.raw((db) => {
      if (change === "format") {
        const config = JSON.parse(
          String(db.prepare("SELECT value FROM metadata WHERE name='configuration'").get()?.value),
        );
        config.format = "bdp-private-transaction-provenance-5";
        db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(
          JSON.stringify(config),
        );
      }
    });
    const before = readFileSync(f.options.file);
    expect(() =>
      openTransactionStore({
        ...f.options,
        create: false,
        ...(change === "bound" ? { receiptMaximumItems: 3 } : {}),
      }),
    ).toThrow("installation mismatch");
    expect(readFileSync(f.options.file)).toEqual(before);
    if (change === "bound") {
      f.reopen();
      expect(f.owner.recoveredPending).toBe(1);
      const replay = f.owner.admit(
        "p",
        "key",
        prepareTransaction(scope, JSON.stringify({ operations: operations() })),
      );
      expect(replay).toMatchObject({ kind: "existing", receipt: { detail: "expired" } });
    }
  },
);
it("keeps issued page identities after abrupt postcommit process loss", () => {
  const f = fixture();
  f.owner.close();
  const store = new URL("../dist/transaction-store.js", import.meta.url).href;
  const batch = new URL("../dist/transaction-batch.js", import.meta.url).href;
  const script = `import {writeSync} from 'node:fs';import {openTransactionStore} from ${JSON.stringify(store)};import {prepareTransaction} from ${JSON.stringify(batch)};const owner=openTransactionStore({...${JSON.stringify(f.options)},create:false,clock:()=>1000});const a=owner.admit('p','key',prepareTransaction(${JSON.stringify(scope)},${JSON.stringify(JSON.stringify({ operations: operations() }))}));const r=owner.executeObserved(a.claim);writeSync(1,JSON.stringify(r));process.exit(79);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 10000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(79);
  const first = JSON.parse(child.stdout);
  f.reopen();
  expect(f.owner.readReceipt("p", first.receipt.id)).toEqual(first);
  expect(f.owner.readReceiptPage("p", first.receipt.next).kind).toBe("page");
});

it("keeps intermediate postimages and deletion facts in recorded pages", () => {
  const f = fixture();
  const result = f.owner.executeObserved(
    f.claim([
      operations(1)[0],
      {
        operation: "updateBead",
        bead: "beads/b0",
        propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
      },
      {
        operation: "updateBead",
        bead: "beads/b0",
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
      },
      { operation: "deleteBead", bead: "beads/b0" },
    ]),
  );
  expect(result.receipt.results).toMatchObject([
    { resource: { properties: { n: 0 } } },
    { resource: { properties: { n: 1 } } },
  ]);
  expect(f.owner.readReceiptPage("p", pageUrl(result.receipt.next))).toMatchObject({
    kind: "page",
    page: {
      results: [{ outcome: "updated", resource: { properties: { n: 2 } } }, { outcome: "deleted" }],
    },
  });
  expect(f.owner.inspect().resources).toEqual([]);
});

it("refuses page parents outside the receipt namespace before plan lookup", () => {
  const f = fixture();
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  for (const url of [`${scope}other/x/pages/token`, `${scope}receipts/pages/token`]) {
    for (const controls of [undefined, "unsupported"] as const)
      expect(f.owner.readReceiptPage("p", url, controls)).toEqual({ kind: "missing" });
  }
  expect(prepare.mock.calls.some(([sql]) => sql.includes("FROM receipt_pages"))).toBe(false);
});

it("captures immutable current context for nondisclosable receipt pages before minimum checks", () => {
  const f = fixture(),
    first = f.owner.executeObserved(f.claim(operations(3))),
    next = pageUrl(first.receipt.next);
  const visible = f.owner.readReceiptPage("p", next);
  expect(visible).toMatchObject({ kind: "page", context: first.context });
  const misses = [
    ["other", next],
    ["p", `${first.receipt.id}/pages/unknown`],
    ["p", `${scope}receipts/unknown/pages/unknown`],
  ] as const;
  const ahead = {
    scopeEpoch: first.context.scopeEpoch,
    authorizationView: first.context.authorizationView,
    minimumPosition: "pos-99",
  };
  const retained = [];
  for (const [principal, url] of misses) {
    for (const minimum of [undefined, "unsupported", ahead] as const) {
      const result = f.owner.readReceiptPage(principal, url, minimum);
      expect(result).toStrictEqual({ kind: "missing", context: first.context });
      expect(Object.isFrozen(result)).toBe(true);
      if (result.kind !== "missing") throw new Error("expected missing page");
      expect(Object.isFrozen(result.context)).toBe(true);
      retained.push(result);
    }
  }
  expect(first.context.scopePosition).toBe("pos-1");
  const later = f.owner.executeObserved(
    f.claim([{ operation: "createBead", id: "beads/later", type, properties: { n: 3 } }], "later"),
  );
  expect(later.context).toStrictEqual({ ...first.context, scopePosition: "pos-2" });
  for (const [principal, url] of misses)
    expect(f.owner.readReceiptPage(principal, url)).toStrictEqual({
      kind: "missing",
      context: later.context,
    });
  for (const result of retained)
    expect(result).toStrictEqual({ kind: "missing", context: first.context });
  expect(() =>
    f.owner.readReceiptPage("p", next, {
      ...ahead,
      authorizationView: "foreign",
      minimumPosition: "pos-2",
    }),
  ).toThrow("foreign-view");
});
