import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCreate, prepareUpdate, prepareDelete, type PrivateNavigation } from "./contract.js";
import { prepareLink } from "./link-contract.js";
import { prepareBatch } from "./atomic-batch.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

const scope = "https://scope.invalid/acme/";
const navigation: PrivateNavigation = {
  scope,
  description: "https://navigation.invalid/description?tenant=a",
  beads: `${scope}inventory-b`,
  links: `${scope}inventory-l`,
  aliases: `${scope}aliases`,
  events: "https://events.invalid/feed?tenant=a",
  operations: "https://navigation.invalid/commands?tenant=a",
  targets: {
    createBead: "https://commands.invalid/new?tenant=a",
    updateBead: `${scope}u-b`,
    deleteBead: `${scope}d-b`,
    createLink: `${scope}c-l`,
    updateLink: `${scope}u-l`,
    deleteLink: `${scope}d-l`,
    putAlias: `${scope}p-a`,
    deleteAlias: `${scope}d-a`,
  },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "private store cleanup failed");
});

const updateInput = (edit: Record<string, unknown>, key = "u") =>
  prepareUpdate(scope, JSON.stringify({ bead: "projects/a", ...edit }), key);
const deleteInput = (edit: Record<string, unknown> = {}, key = "d") =>
  prepareDelete(scope, JSON.stringify({ bead: "projects/a", ...edit }), key);
describe("private retained SQLite updates", () => {
  it("preserves historical create/update outcomes despite later state and restart", () => {
    const { config, store } = setup();
    const creation = input("c", "projects/a");
    const first = store.create("p", creation);
    const before = JSON.parse(first.text).resource;
    const edit = updateInput({
      properties: { next: null },
      type: { uri: "https://types.invalid/T", revision: "t2" },
      metadataChange: [{ op: "add", path: "/tag", value: "one" }],
      expectedRevision: before.revision,
      revisionProvenance: { message: "update one" },
    });
    const second = store.update("p", edit);
    expect(second.status).toBe(200);
    const postimage = JSON.parse(second.text).resource;
    expect(postimage.properties).toEqual({ next: null });
    expect(postimage.metadata).toEqual({ tag: "one" });
    expect(postimage.type.revision).toBe("t2");
    expect(postimage.revision).not.toBe(before.revision);
    expect(postimage.revisionProvenance.message).toEqual({ state: "present", value: "update one" });
    expect(store.update("p", updateInput({ metadata: { later: true } }, "later")).status).toBe(200);
    expect(JSON.parse(store.read(before.id) ?? "null")).not.toEqual(postimage);
    expect(store.create("p", creation)).toEqual(first);
    expect(store.update("p", edit)).toEqual(second);
    const facts = store.events("p", navigation.events, "", { limit: 20 }).events;
    expect(facts).toHaveLength(3);
    expect(facts[1]).toMatchObject({
      previousRevision: before.revision,
      revision: postimage.revision,
      effect: { operation: "updateBead", bead: before.id, resource: postimage },
    });
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.create("p", creation)).toEqual(first);
    expect(reopened.update("p", edit)).toEqual(second);
    expect(reopened.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(3);
  });
  it("checks guards for no-ops and preserves the entire original envelope without new facts", () => {
    const { config, store } = setup();
    const first = store.create(
      "p",
      prepareCreate(
        scope,
        JSON.stringify({
          id: "projects/a",
          type: "https://types.invalid/T",
          revisionProvenance: { message: "original" },
        }),
        "c",
      ),
    );
    const before = JSON.parse(first.text).resource;
    const noop = updateInput({
      propertiesChange: [],
      metadata: {},
      expectedRevision: before.revision,
      revisionProvenance: { message: "must not replace original" },
    });
    const result = store.update("p", noop);
    expect(JSON.parse(result.text)).toEqual({
      outcome: "updated",
      changed: false,
      resource: before,
    });
    const mismatch = store.update(
      "p",
      updateInput({ propertiesChange: [], expectedRevision: "wrong" }, "mismatch"),
    );
    expect(JSON.parse(mismatch.text)).toMatchObject({
      code: "revision-mismatch",
      retry: "after-state-change",
    });
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.update("p", noop)).toEqual(result);
    expect(reopened.update("p", updateInput({ properties: { later: true } }, "later")).status).toBe(
      200,
    );
    expect(reopened.update("p", noop)).toEqual(result);
    expect(
      reopened.update(
        "p",
        updateInput({ propertiesChange: [], expectedRevision: "wrong" }, "mismatch"),
      ),
    ).toEqual(mismatch);
  });
  it("applies ordered array/object/root patches with escaped and prototype-named data keys", () => {
    const { store } = setup();
    store.create(
      "p",
      prepareCreate(
        scope,
        JSON.stringify({
          id: "projects/a",
          type: "https://types.invalid/T",
          properties: { list: [1, 2], nullable: null, "a/b": { "~name": "old" } },
          metadata: { old: true },
        }),
        "c",
      ),
    );
    const result = store.update(
      "p",
      updateInput({
        metadata: {},
        propertiesChange: [
          { op: "add", path: "/list/1", value: 3 },
          { op: "replace", path: "/list/0", value: 0 },
          { op: "remove", path: "/nullable" },
          { op: "replace", path: "/a~1b/~0name", value: null },
          { op: "add", path: "/__proto__", value: { polluted: true } },
          { op: "replace", path: "/__proto__/polluted", value: false },
        ],
      }),
    );
    const resource = JSON.parse(result.text).resource;
    expect(resource.properties.list).toEqual([0, 3, 2]);
    expect(resource.properties).not.toHaveProperty("nullable");
    expect(resource.properties["a/b"]).toEqual({ "~name": null });
    expect(Object.hasOwn(resource.properties, "__proto__")).toBe(true);
    expect(resource.properties.__proto__).toEqual({ polluted: false });
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(resource.metadata).toEqual({});
    const root = store.update(
      "p",
      updateInput(
        { propertiesChange: [{ op: "replace", path: "", value: { literal: null } }] },
        "root",
      ),
    );
    expect(JSON.parse(root.text).resource.properties).toEqual({ literal: null });
  });
  it("retains patch failure and rolls back both object planes even if later state admits it", () => {
    const { store } = setup();
    const first = store.create("p", input("c", "projects/a"));
    const edit = updateInput({
      properties: { replaced: true },
      metadataChange: [{ op: "remove", path: "/missing" }],
    });
    const failed = store.update("p", edit);
    expect(failed.status).toBe(422);
    expect(JSON.parse(failed.text)).toMatchObject({
      code: "validation-failed",
      diagnostics: [{ document: "metadata", instanceLocation: "/missing" }],
    });
    expect(JSON.parse(store.read(`${scope}projects/a`) ?? "null")).toEqual(
      JSON.parse(first.text).resource,
    );
    expect(store.update("p", updateInput({ metadata: { missing: true } }, "repair")).status).toBe(
      200,
    );
    expect(store.update("p", edit)).toEqual(failed);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(2);
    const nonobject = store.update(
      "p",
      updateInput({ metadataChange: [{ op: "replace", path: "", value: [] }] }, "nonobject"),
    );
    expect(nonobject.status).toBe(422);
    expect(JSON.parse(nonobject.text).diagnostics[0]).toMatchObject({
      document: "metadata",
      instanceLocation: "",
    });
  });
  it("compares one key namespace before liveness or guards across operation kinds", () => {
    const { store } = setup();
    const edit = updateInput({ properties: { after: true } }, "missing");
    const missing = store.update("p", edit);
    expect(missing.status).toBe(404);
    expect(store.create("p", input("create", "projects/a")).status).toBe(200);
    expect(store.update("p", edit)).toEqual(missing);
    expect(JSON.parse(store.update("p", updateInput({ properties: {} }, "create")).text).code).toBe(
      "idempotency-conflict",
    );
    expect(JSON.parse(store.create("p", input("missing", "other")).text).code).toBe(
      "idempotency-conflict",
    );
    expect(store.update("other-principal", edit).status).toBe(200);
    expect(
      store.update(
        "p",
        updateInput({ bead: "https://external.invalid/a", properties: {} }, "external"),
      ).status,
    ).toBe(404);
  });
  it("retains post-admission patch and postimage size refusals without Resource effects", () => {
    const { store } = setup();
    const first = store.create("p", input("c", "projects/a"));
    const tooMany = updateInput({
      propertiesChange: Array.from({ length: 101 }, () => ({ op: "add", path: "/x", value: null })),
    });
    const limit = store.update("p", tooMany);
    expect(limit.status).toBe(413);
    expect(store.update("p", tooMany)).toEqual(limit);
    const tooLarge = updateInput({ properties: { large: "x".repeat(262144) } }, "large");
    const size = store.update("p", tooLarge);
    expect(size.status).toBe(413);
    expect(store.update("p", tooLarge)).toEqual(size);
    expect(JSON.parse(store.read(`${scope}projects/a`) ?? "null")).toEqual(
      JSON.parse(first.text).resource,
    );
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
  });
  it("rolls back a staged update without losing the earlier decision", () => {
    let fail = false;
    const { store } = setup({
      onPhase: (phase) => {
        if (fail && phase === "resource-staged") throw new Error("update interrupted");
      },
    });
    const first = store.create("p", input("c", "projects/a"));
    const edit = updateInput({ properties: { changed: true } });
    fail = true;
    expect(() => store.update("p", edit)).toThrow("update interrupted");
    expect(JSON.parse(store.read(`${scope}projects/a`) ?? "null")).toEqual(
      JSON.parse(first.text).resource,
    );
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    fail = false;
    expect(store.update("p", edit).status).toBe(200);
  });
  it("bounds combined patch count and pointer size/depth after key admission", () => {
    const { store } = setup();
    store.create("p", input("c", "projects/a"));
    const operation = { op: "add", path: "/x", value: null };
    const exact = store.update(
      "p",
      updateInput({ propertiesChange: Array.from({ length: 100 }, () => operation) }, "exact"),
    );
    expect(JSON.parse(exact.text).changed).toBe(false);
    const edits = [
      {
        propertiesChange: Array.from({ length: 60 }, () => operation),
        metadataChange: Array.from({ length: 41 }, () => operation),
      },
      { propertiesChange: [{ ...operation, path: `/${"x".repeat(2048)}` }] },
      {
        metadataChange: [
          { ...operation, path: `/${Array.from({ length: 65 }, () => "x").join("/")}` },
        ],
      },
    ];
    for (const [index, edit] of edits.entries()) {
      const prepared = updateInput(edit, `bounded-${index}`);
      const result = store.update("p", prepared);
      expect(result.status).toBe(413);
      expect(store.update("p", prepared)).toEqual(result);
    }
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
  });
  it("retains fact-size refusal across restart while preserving the previous Resource", () => {
    const configuredNavigation = {
      ...navigation,
      events: `https://events.invalid/${"s".repeat(50000)}`,
    };
    const { config, store } = setup({ navigation: configuredNavigation });
    const first = store.create("p", input("c", "projects/a"));
    const edit = updateInput({ properties: { large: "x".repeat(251000) } }, "fact-size");
    const result = store.update("p", edit);
    expect(result.status).toBe(413);
    expect(store.update("p", edit)).toEqual(result);
    expect(JSON.parse(store.read(`${scope}projects/a`) ?? "null")).toEqual(
      JSON.parse(first.text).resource,
    );
    expect(store.events("p", configuredNavigation.events, "", { limit: 20 }).events).toHaveLength(
      1,
    );
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.update("p", edit)).toEqual(result);
    expect(reopened.update("p", updateInput({ properties: {} }, "small")).status).toBe(200);
    expect(reopened.update("p", edit)).toEqual(result);
  });
  it.each(["format", "current", "transition-outcome", "noop-outcome"])(
    "refuses inconsistent recovery state without reseeding: %s",
    (fault) => {
      const { config, store } = setup();
      store.create("p", input("c", "projects/a"));
      store.update("p", updateInput({ properties: { later: true } }));
      store.update("p", updateInput({ propertiesChange: [] }, "noop"));
      store.close();
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
      try {
        db.function("retained_json", { deterministic: true }, (value) => {
          JSON.parse(String(value));
          return 1;
        });
        if (fault === "format") {
          const row = db.prepare("SELECT value FROM metadata WHERE name='capture'").get();
          const capture = JSON.parse(String(row?.value));
          capture.format = "bdp-private-retained-v01-1";
          db.prepare("UPDATE metadata SET value=? WHERE name='capture'").run(
            JSON.stringify(capture),
          );
        } else if (fault === "current") {
          db.prepare("UPDATE resources SET body=?").run(JSON.stringify({ changed: "corrupted" }));
        } else {
          db.prepare("DELETE FROM outcomes WHERE key=?").run(
            fault === "noop-outcome" ? "noop" : "u",
          );
        }
      } finally {
        db.close();
      }
      expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    },
  );
});

describe("retained Event cursor and diagnostic boundaries", () => {
  it("keeps the owner usable after ordinary cursor refusals", () => {
    let time = 10_000;
    const { store } = setup({ clock: () => time });
    store.create("p", input("one", "one"));
    const page = store.events("p", navigation.events, "", { limit: 20 });
    expect(() =>
      store.events("other", navigation.events, "", { after: page.cursor, limit: 20 }),
    ).toThrow("foreign-view");
    expect(() =>
      store.events("p", `${navigation.events}&different=1`, "", { after: page.cursor, limit: 20 }),
    ).toThrow("foreign-view");
    time += 300_000;
    expect(() =>
      store.events("p", navigation.events, "", { after: page.cursor, limit: 20 }),
    ).toThrow("cursor-expired");
    expect(store.create("p", input("two", "two")).status).toBe(200);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(2);
  });
  it("still fences the owner after a commit failure", () => {
    const { store } = setup();
    const execute = DatabaseSync.prototype.exec;
    let fail = true;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql === "COMMIT" && fail) {
        fail = false;
        throw Object.assign(new Error("commit outcome uncertain"), { code: "ERR_SQLITE_ERROR" });
      }
      return execute.call(this, sql);
    });
    expect(() => store.create("p", input("one", "one"))).toThrow("commit outcome uncertain");
    expect(() => store.read(`${scope}one`)).toThrow("store closed, fenced or nested");
  });
  it("preserves cursor expiry across reopen and expires exactly at the promised boundary", () => {
    let time = 10_000;
    const { config, store } = setup({ clock: () => time });
    store.create("p", input("one", "one"));
    store.create("p", input("two", "two"));
    const first = store.events("p", navigation.events, "", { limit: 1 });
    const next = new URL(first.next as string).searchParams.get("after") as string;
    store.close();
    time += 299_999;
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(
      reopened.events("p", navigation.events, "", { after: next, limit: 1 }).events,
    ).toHaveLength(1);
    time += 1;
    expect(() => reopened.events("p", navigation.events, "", { after: next, limit: 1 })).toThrow(
      "cursor-expired",
    );
  });
  it("binds source, subject and page size and resumes after an empty traversal across reopen", () => {
    const { config, store } = setup();
    store.create("p", input("one", "one"));
    const empty = store.events("p", navigation.events, "", { from: "now", limit: 1 });
    expect(empty.events).toHaveLength(0);
    expect(empty.next).toBeNull();
    expect(() =>
      store.events("p", `${navigation.events}&other=1`, "", { after: empty.cursor, limit: 1 }),
    ).toThrow("foreign-view");
    expect(() =>
      store.events("p", `${scope}one?view=events`, `${scope}one`, {
        after: empty.cursor,
        limit: 1,
      }),
    ).toThrow("foreign-view");
    expect(() =>
      store.events("p", navigation.events, "", { after: empty.cursor, limit: 2 }),
    ).toThrow("foreign-view");
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(
      reopened.events("p", navigation.events, "", { after: empty.cursor, limit: 1 }).events,
    ).toHaveLength(0);
    reopened.create("p", input("two", "two"));
    const later = reopened.events("p", navigation.events, "", { after: empty.cursor, limit: 1 });
    expect(later.events).toHaveLength(1);
    expect(later.events[0].effect.id).toBe(`${scope}two`);
  });
  it("retains complete numeric refusal across reopen without allocating the supplied identity", () => {
    const { config, store } = setup();
    const members = Array.from({ length: 9 }, (_, index) => `"p${index}":9007199254740993`).join(
      ",",
    );
    const body = `{"id":"numbers","type":"https://types.invalid/T","properties":{${members}}}`;
    const first = store.create("p", prepareCreate(scope, body, "numeric"));
    expect(first.status).toBe(422);
    expect(JSON.parse(first.text).diagnosticsTruncated).toBe(true);
    expect(store.read(`${scope}numbers`)).toBeUndefined();
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(0);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.create("p", prepareCreate(scope, body, "numeric"))).toEqual(first);
    expect(JSON.parse(reopened.create("p", input("numeric", "numbers")).text).code).toBe(
      "idempotency-conflict",
    );
    expect(reopened.create("p", input("fresh", "numbers")).status).toBe(200);
    expect(reopened.create("p", prepareCreate(scope, body, "numeric"))).toEqual(first);
  });
});

describe("private retained Bead deletion", () => {
  it("retains identity and all original outcomes after deletion and restart", () => {
    const { config, store } = setup();
    const creation = input("c", "projects/a");
    const created = store.create("p", creation);
    const edit = updateInput({
      type: { uri: "https://types.invalid/T", revision: "final-pin" },
      properties: { final: true },
    });
    const updated = store.update("p", edit);
    const before = JSON.parse(updated.text).resource;
    const noopInput = updateInput({ propertiesChange: [] }, "noop");
    const noop = store.update("p", noopInput);
    const deletion = deleteInput({ expectedRevision: before.revision });
    const result = store.deleteBead("p", deletion);
    const deleted = {
      resourceKind: "bead",
      resource: { id: before.id, type: before.type, revision: before.revision },
    };
    expect(JSON.parse(result.text)).toEqual({ outcome: "deleted", changed: true, deleted });
    expect(store.read(before.id)).toBeUndefined();
    const page = store.events("p", `${before.id}?view=events`, before.id, { limit: 20 });
    expect(page.events).toHaveLength(3);
    expect(page.events[2]).toMatchObject({
      revision: before.revision,
      effect: { operation: "deleteBead", bead: before.id, deleted },
    });
    expect(page.events[2]).not.toHaveProperty("previousRevision");
    expect(page.events[2].effect).not.toHaveProperty("resource");
    expect(store.deleteBead("p", deletion)).toEqual(result);
    expect(store.create("p", creation)).toEqual(created);
    expect(store.update("p", edit)).toEqual(updated);
    expect(store.update("p", noopInput)).toEqual(noop);
    expect(JSON.parse(store.create("p", input("reuse", "projects/a")).text).code).toBe(
      "identity-taken",
    );
    expect(store.update("p", updateInput({ properties: {} }, "fresh-update")).status).toBe(404);
    expect(store.deleteBead("p", deleteInput({}, "fresh-delete")).status).toBe(404);
    expect(JSON.parse(store.deleteBead("p", deleteInput({}, "d")).text).code).toBe(
      "idempotency-conflict",
    );
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.deleteBead("p", deletion)).toEqual(result);
    expect(reopened.create("p", creation)).toEqual(created);
    expect(reopened.update("p", edit)).toEqual(updated);
    expect(reopened.update("p", noopInput)).toEqual(noop);
    expect(reopened.read(before.id)).toBeUndefined();
    expect(reopened.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(3);
    expect(JSON.parse(reopened.create("p", input("reopen-reuse", "projects/a")).text).code).toBe(
      "identity-taken",
    );
  });
  it("retains guard and missing-target refusals before later liveness changes", () => {
    const { store } = setup();
    const absent = store.deleteBead("p", deleteInput({}, "absent"));
    expect(absent.status).toBe(404);
    const created = store.create("p", input("c", "projects/a"));
    const before = JSON.parse(created.text).resource;
    expect(store.deleteBead("p", deleteInput({}, "absent"))).toEqual(absent);
    const guard = deleteInput({ expectedRevision: "wrong" }, "guard");
    const mismatch = store.deleteBead("p", guard);
    expect(JSON.parse(mismatch.text).code).toBe("revision-mismatch");
    expect(store.read(before.id)).toBeDefined();
    expect(store.deleteBead("p", deleteInput({ expectedRevision: before.revision })).status).toBe(
      200,
    );
    expect(store.deleteBead("p", guard)).toEqual(mismatch);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(2);
  });
  it("rolls back staged deletion and leaves the key available for one later decision", () => {
    let fail = false;
    const { store } = setup({
      onPhase: (phase) => {
        if (fail && phase === "resource-staged") throw new Error("delete interrupted");
      },
    });
    const created = store.create("p", input("c", "projects/a"));
    const before = JSON.parse(created.text).resource;
    fail = true;
    expect(() => store.deleteBead("p", deleteInput())).toThrow("delete interrupted");
    expect(JSON.parse(store.read(before.id) ?? "null")).toEqual(before);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    fail = false;
    expect(store.deleteBead("p", deleteInput()).status).toBe(200);
  });
  it.each(["restored-current", "delete-revision", "old-format"])(
    "refuses inconsistent deleted-state recovery: %s",
    (fault) => {
      const { config, store } = setup();
      const created = JSON.parse(store.create("p", input("c", "projects/a")).text).resource;
      store.deleteBead("p", deleteInput());
      store.close();
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
      try {
        db.function("retained_json", { deterministic: true }, (value) => {
          JSON.parse(String(value));
          return 1;
        });
        if (fault === "restored-current") {
          db.prepare("INSERT INTO resources VALUES (?,?)").run(created.id, JSON.stringify(created));
        } else if (fault === "delete-revision") {
          const row = db.prepare("SELECT body FROM events WHERE position=2").get();
          const fact = JSON.parse(String(row?.body));
          fact.revision = "invented-deleted-version";
          db.prepare("UPDATE events SET body=? WHERE position=2").run(JSON.stringify(fact));
        } else {
          const row = db.prepare("SELECT value FROM metadata WHERE name='capture'").get();
          const capture = JSON.parse(String(row?.value));
          capture.format = "bdp-private-retained-v01-2";
          db.prepare("UPDATE metadata SET value=? WHERE name='capture'").run(
            JSON.stringify(capture),
          );
        }
      } finally {
        db.close();
      }
      expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    },
  );
});
function setup(overrides: Partial<PrivateStoreOptions> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-store-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = { directory, create: true, instance: "slice01", navigation, ...overrides };
  const store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  return { config, store };
}
const input = (key = "k", id?: string) =>
  prepareCreate(
    scope,
    JSON.stringify({
      type: { uri: "https://types.invalid/T", revision: "t1" },
      ...(id ? { id } : {}),
      properties: { x: null },
    }),
    key,
  );
describe("private retained SQLite owner", () => {
  it("commits allocation, complete fact and original result, then replays across reopen", () => {
    const { config, store } = setup();
    const first = store.create("p", input());
    const result = JSON.parse(first.text);
    expect(first.status).toBe(200);
    expect(
      new URL(result.resource.id).pathname.slice(new URL(scope).pathname.length),
    ).not.toContain("/");
    expect(JSON.parse(store.read(result.resource.id) ?? "null")).toEqual(result.resource);
    const page = store.events("p", navigation.events, "", { limit: 20 });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      representation: "postimage",
      effect: { operation: "createBead", resource: result.resource },
    });
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.create("p", input())).toEqual(first);
    expect(reopened.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
  });
  it("rolls back a staged Resource when the decision fails before fact/outcome commit", () => {
    let fail = true;
    const { store } = setup({
      onPhase: (phase) => {
        if (phase === "resource-staged" && fail) throw new Error("before commit");
      },
    });
    expect(() => store.create("p", input("k", "projects/a"))).toThrow("before commit");
    expect(store.read(`${scope}projects/a`)).toBeUndefined();
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toEqual([]);
    fail = false;
    expect(store.create("p", input("k", "projects/a")).status).toBe(200);
  });
  it("returns saved outcome without consulting current-resource read storage", () => {
    const { store } = setup();
    const first = store.create("p", input());
    const original = DatabaseSync.prototype.prepare;
    const guard = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (/SELECT body FROM resources/i.test(sql)) throw new Error("current Resource unavailable");
      return original.call(this, sql);
    });
    expect(store.create("p", input())).toEqual(first);
    guard.mockRestore();
  });
  it("compares known keys before live-identity checks and keeps principal namespaces distinct", () => {
    const { store } = setup();
    const first = store.create("p", input("k", "projects/a"));
    expect(store.create("p", input("k", "projects/a"))).toEqual(first);
    expect(JSON.parse(store.create("p", input("k", "projects/b")).text).code).toBe(
      "idempotency-conflict",
    );
    expect(JSON.parse(store.create("other", input("k", "projects/a")).text).code).toBe(
      "identity-taken",
    );
    expect(store.create("other", input("k2", "projects/b")).status).toBe(200);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(2);
  });
  it.each(["result", "fact"] as const)(
    "retains the terminal %s size refusal with zero committed allocations",
    (bound) => {
      const configuredNavigation =
        bound === "fact"
          ? { ...navigation, events: `${navigation.events}&padding=${"x".repeat(60000)}` }
          : navigation;
      const { config, store } = setup({ navigation: configuredNavigation });
      const body = JSON.stringify({
        id: "size-refusal",
        type: "https://types.invalid/T",
        properties: { padding: "x".repeat(bound === "result" ? 262144 : 245000) },
      });
      const prepared = prepareCreate(scope, body, "too-large");
      const first = store.create("p", prepared);
      expect(first.status).toBe(413);
      expect(JSON.parse(first.text)).toMatchObject({ code: "limit-exceeded", retry: "never" });
      expect(store.create("p", prepareCreate(scope, body, "too-large"))).toEqual(first);
      const changed = prepareCreate(
        scope,
        JSON.stringify({ id: "size-refusal", type: "https://types.invalid/T", properties: {} }),
        "too-large",
      );
      expect(JSON.parse(store.create("p", changed).text).code).toBe("idempotency-conflict");
      expect(store.read(`${scope}size-refusal`)).toBeUndefined();
      expect(store.events("p", configuredNavigation.events, "", { limit: 20 }).events).toHaveLength(
        0,
      );
      store.close();
      const reopened = openPrivateRetainedStore({ ...config, create: false });
      cleanups.push(() => reopened.close());
      expect(reopened.create("p", prepareCreate(scope, body, "too-large"))).toEqual(first);
      // Reusing this supplied ID under a new key proves the refusal reserved no identity.
      const valid = reopened.create(
        "p",
        prepareCreate(
          scope,
          JSON.stringify({ id: "size-refusal", type: "https://types.invalid/T", properties: {} }),
          "fresh-key",
        ),
      );
      expect(valid.status).toBe(200);
      const page = reopened.events("p", configuredNavigation.events, "", { limit: 20 });
      expect(page.events).toHaveLength(1);
      expect(page.events[0]).toMatchObject({ effect: { id: `${scope}size-refusal` } });
    },
  );
  it("fixes a traversal upper bound, protects source/principal context and resumes later", () => {
    const { store } = setup();
    store.create("p", input("a"));
    store.create("p", input("b"));
    const first = store.events("p", navigation.events, "", { limit: 1 });
    store.create("p", input("c"));
    expect(first.next).not.toBeNull();
    const next = new URL(first.next as string);
    const second = store.events("p", navigation.events, "", {
      after: next.searchParams.get("after") as string,
      limit: 1,
    });
    expect(second.coverage.through).toBe(first.coverage.through);
    expect(second.next).toBeNull();
    expect(
      store.events("p", navigation.events, "", { after: second.cursor, limit: 1 }).events,
    ).toHaveLength(1);
    expect(() =>
      store.events("other", navigation.events, "", { after: second.cursor, limit: 1 }),
    ).toThrow("foreign-view");
  });
  it("refuses concurrent owners, mismatched captures, missing and legacy stores", () => {
    const { config, store } = setup();
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    store.close();
    expect(() =>
      openPrivateRetainedStore({ ...config, create: false, instance: "different" }),
    ).toThrow("mismatch");
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-legacy-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    expect(() => openPrivateRetainedStore({ ...config, directory, create: false })).toThrow(
      "missing",
    );
    writeFileSync(path.join(directory, "reference.sqlite"), "historical evidence");
    expect(() => openPrivateRetainedStore({ ...config, directory })).toThrow("empty directory");
  });
});

const batchNavigation: PrivateNavigation = { ...navigation, batch: {
  operation: `${scope}atomic`, operations: ["createBead", "updateBead", "deleteBead", "createLink", "updateLink", "deleteLink"],
  maximumOperations: 100, maximumResultBytes: 262144,
} };
const batchInput = (operations: unknown[], key = "batch") => prepareBatch(scope, JSON.stringify({ capabilityVersion: "1", operations }), key);
describe("private atomic-batch1 final SQLite decisions", () => {
  it("publishes unique final states and baseline guards with one key, transaction and immutable replay", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const original = JSON.parse(store.create("p", input("seed", "existing")).text).resource;
    const operations = [
      { operation: "createBead", name: "Fresh", id: "z-endpoint", type: { uri: "https://types.invalid/T", revision: "exact/@ +" }, properties: { literal: "@Fresh" } },
      { operation: "updateBead", bead: "existing", expectedRevision: original.revision, properties: { n: 1 } },
      { operation: "updateBead", bead: "existing", expectedRevision: original.revision, properties: { n: 2 } },
      { operation: "createLink", id: "a-link", type: "https://types.invalid/L", source: "@Fresh", target: "existing" },
    ];
    const request = batchInput(operations);
    const response = store.batch("p", request);
    expect(response.status).toBe(200);
    const result = JSON.parse(response.text);
    expect(result.results.map((row: { operationIndex: number }) => row.operationIndex)).toEqual([0, 1, 2, 3]);
    expect(result.resources.map((row: { id: string }) => row.id)).toEqual([`${scope}a-link`, `${scope}existing`, `${scope}z-endpoint`]);
    expect(result.resources[1].resource.properties).toEqual({ n: 2 });
    expect(result.resources[2].resource.type).toEqual({ uri: "https://types.invalid/T", revision: "exact/@ +" });
    expect(result.results[0].operationName).toBe("Fresh");
    expect(result.results[0]).not.toHaveProperty("resource");
    const events = store.events("p", navigation.events, "", { limit: 20 }).events;
    expect(events).toHaveLength(4);
    expect(new Set(events.slice(1).map((fact) => fact.transaction))).toEqual(new Set([result.transaction]));
    expect(events.filter((fact) => fact.effect.operation === "updateBead")).toHaveLength(1);
    store.update("p", prepareUpdate(scope, '{"bead":"existing","properties":{"later":true}}', "later"));
    expect(store.batch("p", request)).toEqual(response);
    const renamed = operations.map((operation, index) => index === 0 ? { ...operation, name: "Renamed" } : index === 3 ? { ...operation, source: "@Renamed" } : operation);
    const projected = JSON.parse(store.batch("p", batchInput(renamed)).text);
    expect(projected).toEqual({ ...result, results: result.results.map((row: object, index: number) => index === 0 ? { ...row, operationName: "Renamed" } : row) });
    expect(JSON.parse(store.create("p", input("batch", "different")).text).code).toBe("idempotency-conflict");
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", request)).toEqual(response);
    expect(reopened.batch("p", batchInput(renamed)).text).toBe(JSON.stringify(projected));
  });
  it("retains net no-op envelopes and allocation-only identities without intermediate versions or facts", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const original = JSON.parse(store.create("p", input("seed", "existing")).text).resource;
    const noop = batchInput([
      { operation: "updateBead", bead: "existing", properties: { temporary: true }, revisionProvenance: { message: "temporary" } },
      { operation: "updateBead", bead: "existing", properties: original.properties, revisionProvenance: { message: "not recorded on no-op" } },
    ], "noop-batch");
    const unchanged = store.batch("p", noop); const result = JSON.parse(unchanged.text);
    expect(result.changed).toBe(false); expect(result).not.toHaveProperty("transaction");
    expect(result.resources).toEqual([{ id: original.id, resourceKind: "bead", outcome: "unchanged", changed: false, resource: original }]);
    const allocated = batchInput([
      { operation: "createBead", name: "Gone", id: "gone", type: "https://types.invalid/T" },
      { operation: "deleteBead", bead: "@Gone" },
    ], "allocation");
    const response = store.batch("p", allocated); const consumed = JSON.parse(response.text);
    expect(consumed.changed).toBe(true); expect(consumed.transaction).toEqual(expect.any(String));
    expect(consumed.resources).toEqual([{ id: `${scope}gone`, resourceKind: "bead", outcome: "allocated", changed: true }]);
    expect(store.read(`${scope}gone`)).toBeUndefined();
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    store.close(); const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", allocated)).toEqual(response); expect(reopened.batch("p", noop)).toEqual(unchanged);
    expect(JSON.parse(reopened.create("p", input("reuse", "gone")).text).code).toBe("identity-taken");
    expect(reopened.update("p", prepareUpdate(scope, '{"bead":"existing","properties":{"later":true}}', "later")).status).toBe(200);
    expect(reopened.batch("p", noop)).toEqual(unchanged);
  });
  it("retains late validation failure with no allocation or partial update and preserves singleton key conflicts", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const original = store.create("p", input("seed", "existing"));
    const failed = batchInput([
      { operation: "updateBead", bead: "existing", properties: { shouldNotPersist: true } },
      { operation: "createBead", id: "not-allocated", type: "https://types.invalid/T" },
      { operation: "updateBead", bead: "existing", metadataChange: [{ op: "remove", path: "/missing" }] },
    ]);
    const response = store.batch("p", failed); expect(response.status).toBe(422);
    expect(JSON.parse(store.read(`${scope}existing`) ?? "null")).toEqual(JSON.parse(original.text).resource);
    expect(store.read(`${scope}not-allocated`)).toBeUndefined();
    expect(store.create("p", input("fresh", "not-allocated")).status).toBe(200);
    expect(JSON.parse(store.batch("p", batchInput([{ operation: "deleteBead", bead: "existing" }], "seed")).text).code).toBe("idempotency-conflict");
    expect(store.batch("p", failed)).toEqual(response);
    store.close(); const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", failed)).toEqual(response);
  });
  it("rolls back all final rows and key state when a late publication callback throws", () => {
    let writes = 0; let fail = true;
    const { store } = setup({ navigation: batchNavigation, onPhase: (phase) => { if (phase === "resource-staged" && ++writes === 2 && fail) throw new Error("late batch fault"); } });
    const request = batchInput(["one", "two"].map((id) => ({ operation: "createBead", id, type: "https://types.invalid/T" })));
    expect(() => store.batch("p", request)).toThrow("late batch fault");
    expect(store.read(`${scope}one`)).toBeUndefined(); expect(store.read(`${scope}two`)).toBeUndefined();
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toEqual([]);
    fail = false; expect(store.batch("p", request).status).toBe(200);
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(2);
  });
  it("checks new-target guards, literal committed endpoint pins, output budgets and provenance before publication", () => {
    const { store } = setup({ navigation: { ...batchNavigation, batch: { ...batchNavigation.batch!, maximumResultBytes: 1024 } } });
    const guarded = store.batch("p", batchInput([
      { operation: "createBead", name: "A", id: "a", type: "https://types.invalid/T" },
      { operation: "updateBead", bead: "@A", expectedRevision: "unpublished", properties: {} },
    ], "guard"));
    expect(JSON.parse(guarded.text).code).toBe("revision-mismatch"); expect(store.read(`${scope}a`)).toBeUndefined();
    const pin = store.batch("p", batchInput([
      { operation: "createBead", name: "A", id: "a", type: "https://types.invalid/T" },
      { operation: "createLink", id: "l", type: "https://types.invalid/L", source: { uri: "@A", revision: "future" }, target: "https://foreign.invalid/b" },
    ], "pin")); expect(pin.status).toBe(422); expect(store.read(`${scope}l`)).toBeUndefined();
    const request = batchInput([{ operation: "createBead", id: "large", type: "https://types.invalid/T", properties: { padding: "x".repeat(2000) } }], "large");
    const tooLarge = store.batch("p", request); expect(tooLarge.status).toBe(413); expect(store.batch("p", request)).toEqual(tooLarge);
    expect(store.read(`${scope}large`)).toBeUndefined(); expect(store.create("p", input("fresh", "large")).status).toBe(200);
    const conflict = store.batch("p", batchInput([
      { operation: "updateBead", bead: "large", properties: { a: true }, revisionProvenance: { message: "one" } },
      { operation: "updateBead", bead: "large", properties: { a: false }, revisionProvenance: { message: "two" } },
    ], "provenance")); expect(conflict.status).toBe(422);
    expect(JSON.parse(conflict.text).diagnostics[0].message).toContain("conflicting explicit provenance");
  });
  it.each(["transaction", "membership", "mapping", "allocation", "baseline", "old-format", "identity-cell"])("refuses grouped recovery corruption without reseeding: %s", (fault) => {
    const { config, store } = setup({ navigation: batchNavigation });
    const request = batchInput([
      { operation: "createBead", name: "A", id: "z", type: "https://types.invalid/T" },
      { operation: "createLink", id: "a", type: "https://types.invalid/L", source: "@A", target: "https://foreign.invalid/b" },
      { operation: "createBead", name: "Gone", id: "gone", type: "https://types.invalid/T" },
      { operation: "deleteBead", bead: "@Gone" },
    ]);
    const original = store.batch("p", request); expect(original.status).toBe(200); store.close();
    if (fault === "identity-cell") {
      const untouched = openPrivateRetainedStore({ ...config, create: false });
      try { expect(untouched.batch("p", request)).toEqual(original); } finally { untouched.close(); }
    }
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      db.function("retained_json", { deterministic: true }, () => 1);
      if (fault === "transaction") { const row = db.prepare("SELECT body FROM events WHERE position=1").get(); const fact = JSON.parse(String(row?.body)); fact.transaction = "other"; db.prepare("UPDATE events SET body=? WHERE position=1").run(JSON.stringify(fact)); }
      else if (fault === "membership") db.exec("DELETE FROM batch_events WHERE position=1");
      else if (fault === "identity-cell") {
        const row = db.prepare("SELECT identity FROM outcomes WHERE operation='atomicBatch'").get();
        const outer = JSON.parse(String(row?.identity)) as unknown[];
        const field = (node: unknown, name: string): unknown[] => {
          const values = (node as unknown[])[1] as unknown[][];
          const pair = values.find((value) => value[0] === name); if (!pair) throw Error("missing identity field"); return pair;
        };
        const input = field(outer[1], "input")[1] as unknown[];
        const member = (input[1] as unknown[])[0];
        const cell = field(member, "identity")[1] as unknown[];
        const ordinary = JSON.parse(String(cell[1])) as unknown[];
        field(ordinary[1], "input")[1] = ["object", []];
        cell[1] = JSON.stringify(ordinary);
        // Exactly the reported identity cell changes. Journal, facts, result,
        // mappings and all other database rows remain the untouched positive.
        db.prepare("UPDATE outcomes SET identity=? WHERE operation='atomicBatch'").run(JSON.stringify(outer));
      }
      else if (fault === "old-format") { const row = db.prepare("SELECT value FROM metadata WHERE name='capture'").get(); const capture = JSON.parse(String(row?.value)); capture.format = "bdp-private-retained-v01-5"; db.prepare("UPDATE metadata SET value=? WHERE name='capture'").run(JSON.stringify(capture)); }
      else { const row = db.prepare("SELECT body FROM batch_decisions").get(); const journal = JSON.parse(String(row?.body)); if (fault === "mapping") journal.result.results.pop(); else if (fault === "allocation") journal.allocations.pop(); else journal.before[0].state = { kind: "bead", resource: { forged: true } }; db.prepare("UPDATE batch_decisions SET body=?").run(JSON.stringify(journal)); }
    } finally { db.close(); }
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
  });
});

describe("batch explicit endpoint intent versus retained literal continuity", () => {
  it("admits an actual retained historical endpoint version rather than requiring the current token", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const left = JSON.parse(store.create("p", input("left", "pin-left")).text).resource;
    const right = JSON.parse(store.create("p", input("right", "pin-right")).text).resource;
    expect(store.update("p", prepareUpdate(scope, JSON.stringify({ bead: "pin-left", properties: { newer: true } }), "new-left")).status).toBe(200);
    const pinned = { uri: left.id, revision: left.revision };
    const created = store.createLink("p", prepareLink(scope, "createLink", JSON.stringify({ id: "historical-link", type: "https://types.invalid/L", source: pinned, target: right.id }), "link"));
    expect(created.status).toBe(200);
    const request = batchInput([{ operation: "updateLink", link: "historical-link", source: pinned, properties: { historical: true } }], "historical-pin");
    const response = store.batch("p", request); expect(response.status).toBe(200);
    const row = JSON.parse(response.text).resources[0];
    expect(row.resource.source).toEqual(pinned); expect(row.resource.properties).toEqual({ historical: true });
    store.close(); const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", request)).toEqual(response);
  });
  it("preserves an omitted singleton-admitted literal pin while refusing a fresh explicit unsupported pin", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const left = JSON.parse(store.create("p", input("left", "literal-left")).text).resource;
    const right = JSON.parse(store.create("p", input("right", "literal-right")).text).resource;
    const literal = { uri: left.id, revision: "singleton-unvalidated-literal" };
    // Preserve the older singleton admission limitation as an actual constructor
    // precondition; this is not proof that the literal identifies a retained version.
    const created = store.createLink("p", prepareLink(scope, "createLink", JSON.stringify({ id: "literal-link", type: "https://types.invalid/L", source: literal, target: right.id }), "literal-link"));
    expect(created.status).toBe(200); expect(JSON.parse(created.text).resource.source).toEqual(literal);
    const request = batchInput([{ operation: "updateLink", link: "literal-link", properties: { changed: true } }], "omitted-pin");
    const response = store.batch("p", request); expect(response.status).toBe(200);
    const current = JSON.parse(response.text).resources[0].resource;
    expect(current.source).toEqual(literal); expect(current.target).toBe(right.id); expect(current.properties).toEqual({ changed: true });
    const explicit = store.batch("p", batchInput([{ operation: "updateLink", link: "literal-link", source: literal, properties: { mustNotPersist: true } }], "explicit-pin"));
    expect(explicit.status).toBe(422); expect(JSON.parse(store.read(current.id) ?? "null")).toEqual(current);
    store.close(); const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", request)).toEqual(response);
    expect(JSON.parse(reopened.read(current.id) ?? "null")).toEqual(current);
  });
});


describe("batch recovery missing-alias disposition correspondence", () => {
  it("rejects only a successful createLink identity cell corrupted to a private missing source", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const source = JSON.parse(store.create("p", input("source", "source")).text).resource;
    const request = batchInput([{ operation: "createLink", id: "direct-link", type: "https://types.invalid/L", source: source.id, target: "https://foreign.invalid/target" }], "direct-link");
    const original = store.batch("p", request); expect(original.status).toBe(200);
    expect(JSON.parse(original.text).resources[0].resource.source).toBe(source.id);
    store.close();
    const untouched = openPrivateRetainedStore({ ...config, create: false });
    try { expect(untouched.batch("p", request)).toEqual(original); } finally { untouched.close(); }
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      db.function("retained_json", { deterministic: true }, () => 1);
      const row = db.prepare("SELECT identity FROM outcomes WHERE operation='atomicBatch'").get();
      const outer = JSON.parse(String(row?.identity)) as unknown[];
      const field = (node: unknown, name: string): unknown[] => {
        const pair = ((node as unknown[])[1] as unknown[][]).find((value) => value[0] === name);
        if (!pair) throw Error("missing identity field"); return pair;
      };
      const input = field(outer[1], "input")[1] as unknown[];
      const member = (input[1] as unknown[])[0];
      const cell = field(member, "identity")[1] as unknown[];
      const ordinary = JSON.parse(String(cell[1])) as unknown[];
      field(field(ordinary[1], "input")[1], "source")[1] = ["array", [["unbound"], ["string", `${scope}aliases/missing`]]];
      cell[1] = JSON.stringify(ordinary);
      // Only the nested source identity cell changes. The successful mappings,
      // journal, witnesses, facts and result remain the untouched positive.
      db.prepare("UPDATE outcomes SET identity=? WHERE operation='atomicBatch'").run(JSON.stringify(outer));
    } finally { db.close(); }
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
  });
  it("recovers and replays a genuine failed missing-alias decision without allocating its Link", () => {
    const { config, store } = setup({ navigation: batchNavigation });
    const target = JSON.parse(store.create("p", input("target", "target")).text).resource;
    const request = batchInput([{ operation: "createLink", id: "missing-link", type: "https://types.invalid/L", source: `${scope}aliases/missing`, target: target.id }], "missing-link");
    const failed = store.batch("p", request); expect(failed.status).toBe(404);
    expect(JSON.parse(failed.text).code).toBe("resource-not-found");
    expect(store.read(`${scope}missing-link`)).toBeUndefined();
    expect(store.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    expect(store.batch("p", request)).toEqual(failed);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false }); cleanups.push(() => reopened.close());
    expect(reopened.batch("p", request)).toEqual(failed);
    expect(reopened.read(`${scope}missing-link`)).toBeUndefined();
    expect(reopened.events("p", navigation.events, "", { limit: 20 }).events).toHaveLength(1);
    const fresh = reopened.createLink("p", prepareLink(scope, "createLink", JSON.stringify({ id: "missing-link", type: "https://types.invalid/L", source: target.id, target: "https://foreign.invalid/target" }), "fresh-link"));
    expect(fresh.status).toBe(200);
    expect(reopened.batch("p", request)).toEqual(failed);
  });
});
