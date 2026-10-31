import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareAlias } from "./alias-contract.js";
import { prepareCreate, prepareDelete, prepareUpdate, type PrivateNavigation } from "./contract.js";
import { prepareLink } from "./link-contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

const controlled = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => controlled.ids.shift() ?? actual.randomUUID() };
});

const scope = "https://scope.invalid/alias-unit/";
const type = "https://types.invalid/T";
const navigation: PrivateNavigation = {
  scope,
  aliases: `${scope}names/`,
  description: "https://discover.invalid/about?a=one",
  beads: `${scope}inventory-nodes`,
  links: `${scope}inventory-edges`,
  events: "https://observe.invalid/facts?a=one",
  operations: "https://discover.invalid/commands?a=one",
  targets: {
    createBead: "https://invoke.invalid/new?n=1",
    updateBead: "https://invoke.invalid/edit?n=2",
    deleteBead: "https://invoke.invalid/drop?n=3",
    createLink: "https://invoke.invalid/new?n=4",
    updateLink: "https://invoke.invalid/edit?n=5",
    deleteLink: "https://invoke.invalid/drop?n=6",
    putAlias: "https://invoke.invalid/bind?n=7",
    deleteAlias: "https://invoke.invalid/unbind?n=8",
  },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  controlled.ids.length = 0;
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse())
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  if (errors.length) throw new AggregateError(errors, "private alias store cleanup failed");
});
function setup(onPhase?: PrivateStoreOptions["onPhase"], selectedNavigation = navigation) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-store-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "alias-unit",
    navigation: selectedNavigation,
    ...(onPhase ? { onPhase } : {}),
  };
  const store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  for (const id of ["a", "b"])
    expect(
      store.create("p", prepareCreate(scope, JSON.stringify({ id, type }), `seed-${id}`)).status,
    ).toBe(200);
  return { config, store };
}
const put = (alias: string, target: string, key: string) =>
  prepareAlias(scope, "putAlias", JSON.stringify({ alias, target }), key);
const remove = (alias: string, key: string) =>
  prepareAlias(scope, "deleteAlias", JSON.stringify({ alias }), key);
const update = (bead: string, key: string) =>
  prepareUpdate(scope, JSON.stringify({ bead, properties: { updated: true } }), key);
const code = (result: { readonly text: string }) => JSON.parse(result.text).code;

describe("private atomic alias decisions and original Reference witnesses", () => {
  it("protects actual navigation route bases in a Scope-wide alias namespace", () => {
    const selected = { ...navigation, aliases: scope, events: `${scope}stream?owner=one` };
    const { store } = setup(undefined, selected);
    expect(code(store.putAlias("p", put("stream", "a", "navigation-collision")))).toBe(
      "identity-taken",
    );
    expect(store.events("p", selected.events, "", { limit: 20 }).events).toHaveLength(2);
  });
  it.each(["bead", "link"] as const)(
    "allocator skips a live alias for %s without disturbing it",
    (kind) => {
      const { store } = setup(undefined, { ...navigation, aliases: scope });
      const id = "11111111-1111-4111-8111-111111111111";
      expect(store.putAlias("p", put(id, "a", "reserve-id")).status).toBe(200);
      controlled.ids.push(id); // Primitive allocation collision, not an injected outcome.
      const result =
        kind === "bead"
          ? store.create("p", prepareCreate(scope, JSON.stringify({ type }), "auto"))
          : store.createLink(
              "p",
              prepareLink(
                scope,
                "createLink",
                JSON.stringify({ type, source: "a", target: "b" }),
                "auto",
              ),
            );
      expect(result.status).toBe(200);
      expect(JSON.parse(result.text).resource.id).not.toBe(scope + id);
      expect(store.resolveAlias(scope + id)).toBe(`${scope}a`);
    },
  );
  it("returns closed created/updated/deleted results without versions, provenance or facts", () => {
    const { store } = setup();
    const before = store.read(`${scope}a`);
    const facts = store.events("p", navigation.events, "", { limit: 20 });
    const created = store.putAlias("p", put("names/latest", "a", "put-one"));
    expect(JSON.parse(created.text)).toEqual({
      outcome: "created",
      alias: `${scope}names/latest`,
      target: `${scope}a`,
    });
    expect(JSON.parse(store.putAlias("p", put("names/latest", "a", "same-target")).text)).toEqual({
      outcome: "updated",
      alias: `${scope}names/latest`,
      target: `${scope}a`,
    });
    expect(store.resolveAlias(`${scope}names/%6Catest`)).toBe(`${scope}a`);
    expect(store.putAlias("p", put("names/%6catest", "%61", "put-one"))).toEqual(created);
    expect(store.read(`${scope}names/latest`)).toBeUndefined();
    expect(JSON.parse(store.deleteAlias("p", remove("names/latest", "delete")).text)).toEqual({
      outcome: "deleted",
      alias: `${scope}names/latest`,
    });
    expect(store.resolveAlias(`${scope}names/latest`)).toBeNull();
    expect(store.read(`${scope}a`)).toBe(before);
    const after = store.events("p", navigation.events, "", { limit: 20 });
    expect(after.events).toEqual(facts.events);
    expect(after.coverage).toEqual(facts.coverage);
  });
  it("retains original put/delete responses across repoint, reuse and reopen", () => {
    const { config, store } = setup();
    const original = store.putAlias("p", put("names/latest", "a", "original"));
    expect(store.putAlias("p", put("names/latest", "b", "repoint")).status).toBe(200);
    expect(store.putAlias("p", put("names/latest", "a", "original"))).toEqual(original);
    expect(store.resolveAlias(`${scope}names/latest`)).toBe(`${scope}b`);
    const deleted = store.deleteAlias("p", remove("names/latest", "delete"));
    expect(store.putAlias("p", put("names/latest", "a", "reuse")).status).toBe(200);
    expect(store.deleteAlias("p", remove("names/latest", "delete"))).toEqual(deleted);
    expect(store.resolveAlias(`${scope}names/latest`)).toBe(`${scope}a`);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.putAlias("p", put("names/latest", "a", "original"))).toEqual(original);
    expect(reopened.deleteAlias("p", remove("names/latest", "delete"))).toEqual(deleted);
    expect(reopened.resolveAlias(`${scope}names/latest`)).toBe(`${scope}a`);
  });
  it.each(["bead", "link"] as const)(
    "checks complete URL collision and permanent %s tombstones before target liveness",
    (kind) => {
      const { store } = setup();
      const id = "names/taken";
      const created =
        kind === "bead"
          ? store.create(
              "p",
              prepareCreate(scope, JSON.stringify({ id, type }), "collision-create"),
            )
          : store.createLink(
              "p",
              prepareLink(
                scope,
                "createLink",
                JSON.stringify({ id, type, source: "a", target: "b" }),
                "collision-create",
              ),
            );
      expect(created.status).toBe(200);
      const deleted =
        kind === "bead"
          ? store.deleteBead(
              "p",
              prepareDelete(scope, JSON.stringify({ bead: id }), "collision-delete"),
            )
          : store.deleteLink(
              "p",
              prepareLink(scope, "deleteLink", JSON.stringify({ link: id }), "collision-delete"),
            );
      expect(deleted.status).toBe(200);
      expect(code(store.putAlias("p", put(id, "missing", "permanent")))).toBe("identity-taken");
      expect(code(store.deleteAlias("p", remove(id, "not-an-alias")))).toBe("resource-not-found");
    },
  );
  it.each(["bead", "link"] as const)(
    "refuses a live alias for %s creation and preserves that refusal after locator release",
    (kind) => {
      const { store } = setup();
      expect(store.putAlias("p", put("names/live", "a", "reserve")).status).toBe(200);
      const create = (key: string) =>
        kind === "bead"
          ? store.create("p", prepareCreate(scope, JSON.stringify({ id: "names/live", type }), key))
          : store.createLink(
              "p",
              prepareLink(
                scope,
                "createLink",
                JSON.stringify({ id: "names/live", type, source: "a", target: "b" }),
                key,
              ),
            );
      const refused = create("blocked");
      expect(JSON.parse(refused.text)).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "alias-path-taken",
        status: 409,
        retry: "after-state-change",
      });
      expect(store.deleteAlias("p", remove("names/live", "release")).status).toBe(200);
      expect(create("fresh").status).toBe(200);
      expect(create("blocked")).toEqual(refused);
    },
  );
  it("keeps equal final segments at distinct complete paths independent", () => {
    const { store } = setup();
    expect(
      store.createLink(
        "p",
        prepareLink(
          scope,
          "createLink",
          JSON.stringify({ id: "relations/foo", type, source: "a", target: "b" }),
          "edge",
        ),
      ).status,
    ).toBe(200);
    expect(store.putAlias("p", put("names/foo", "a", "alias")).status).toBe(200);
    expect(store.resolveAlias(`${scope}names/foo`)).toBe(`${scope}a`);
    expect(store.resolveAlias(`${scope}relations/foo`)).toBeUndefined();
  });
  it("admits only its namespace and canonical live Bead targets, without chains", () => {
    const { store } = setup();
    expect(code(store.putAlias("p", put("outside", "a", "outside")))).toBe("resource-not-found");
    expect(store.putAlias("p", put("names/first", "a", "first")).status).toBe(200);
    for (const [index, target] of ["names/first", "https://external.invalid/a", "edge"].entries()) {
      if (target === "edge")
        expect(
          store.createLink(
            "p",
            prepareLink(
              scope,
              "createLink",
              JSON.stringify({ id: "edge", type, source: "a", target: "b" }),
              "link",
            ),
          ).status,
        ).toBe(200);
      const refused = store.putAlias("p", put(`names/bad-${index}`, target, `bad-${index}`));
      expect(code(refused)).toBe("validation-failed");
      expect(JSON.parse(refused.text).diagnostics).toHaveLength(1);
    }
    const missing = store.putAlias("p", put("names/later", "later", "missing"));
    expect(code(missing)).toBe("resource-not-found");
    expect(
      store.create("p", prepareCreate(scope, JSON.stringify({ id: "later", type }), "later-create"))
        .status,
    ).toBe(200);
    expect(store.putAlias("p", put("names/later", "later", "missing"))).toEqual(missing);
  });
  it("shares keys across eight operations, with principal isolation and comparison first", () => {
    const { store } = setup();
    const original = store.putAlias("p", put("names/current", "a", "shared"));
    const competing = [
      () => store.create("p", prepareCreate(scope, JSON.stringify({ type }), "shared")),
      () => store.update("p", update("missing", "shared")),
      () =>
        store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "missing" }), "shared")),
      () =>
        store.createLink(
          "p",
          prepareLink(
            scope,
            "createLink",
            JSON.stringify({ type, source: "missing", target: "b" }),
            "shared",
          ),
        ),
      () =>
        store.updateLink(
          "p",
          prepareLink(
            scope,
            "updateLink",
            JSON.stringify({ link: "missing", properties: {} }),
            "shared",
          ),
        ),
      () =>
        store.deleteLink(
          "p",
          prepareLink(scope, "deleteLink", JSON.stringify({ link: "missing" }), "shared"),
        ),
      () => store.deleteAlias("p", remove("names/current", "shared")),
    ];
    for (const invoke of competing) expect(code(invoke())).toBe("idempotency-conflict");
    expect(store.putAlias("other", put("names/current", "b", "shared")).status).toBe(200);
    expect(store.putAlias("p", put("names/current", "a", "shared"))).toEqual(original);
    expect(store.resolveAlias(`${scope}names/current`)).toBe(`${scope}b`);
  });
  it("preserves original hits and resolves new comparison locators without recording them", () => {
    const { config, store } = setup();
    store.putAlias("p", put("names/original", "a", "first"));
    const original = store.update("p", update("names/original", "update"));
    expect(original.status).toBe(200);
    store.putAlias("p", put("names/original", "b", "repoint"));
    store.putAlias("p", put("names/new", "a", "new-locator"));
    expect(store.update("p", update("names/new", "update"))).toEqual(original);
    store.putAlias("p", put("names/new", "b", "repoint-new"));
    expect(code(store.update("p", update("names/new", "update")))).toBe("idempotency-conflict");
    expect(store.update("p", update("names/original", "update"))).toEqual(original);
    expect(store.update("p", update("names/%6Friginal", "update"))).toEqual(original);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.update("p", update("names/original", "update"))).toEqual(original);
    expect(reopened.update("p", update("names/%6Friginal", "update"))).toEqual(original);
    expect(code(reopened.update("p", update("names/new", "update")))).toBe("idempotency-conflict");
  });
  it("retains an original miss after later alias assignment", () => {
    const { store } = setup();
    const missing = store.update("p", update("names/future", "miss"));
    expect(code(missing)).toBe("resource-not-found");
    store.putAlias("p", put("names/future", "a", "assign"));
    expect(store.update("p", update("names/future", "miss"))).toEqual(missing);
    expect(store.update("p", update("names/future", "fresh")).status).toBe(200);
  });
  it("keeps locator resolution separate from target liveness and permits locator removal", () => {
    const { config, store } = setup();
    store.putAlias("p", put("names/dangling", "a", "assign"));
    const original = store.update("p", update("names/dangling", "original-update"));
    expect(original.status).toBe(200);
    expect(
      store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "a" }), "delete-target"))
        .status,
    ).toBe(200);
    expect(store.resolveAlias(`${scope}names/dangling`)).toBe(`${scope}a`);
    expect(store.read(`${scope}a`)).toBeUndefined();
    expect(code(store.update("p", update("names/dangling", "fresh-update")))).toBe(
      "resource-not-found",
    );
    expect(store.deleteAlias("p", remove("names/dangling", "remove-locator")).status).toBe(200);
    expect(store.resolveAlias(`${scope}names/dangling`)).toBeNull();
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.update("p", update("names/dangling", "original-update"))).toEqual(original);
    expect(reopened.resolveAlias(`${scope}names/dangling`)).toBeNull();
  });
  it("uses an original locator in a different endpoint slot while carrying whole pins", () => {
    const { store } = setup();
    store.putAlias("p", put("names/endpoint", "a", "assign"));
    const body = {
      id: "edge",
      type,
      source: { uri: "names/endpoint", revision: "source-pin" },
      target: { uri: "a", revision: "target-pin" },
    };
    const original = store.createLink(
      "p",
      prepareLink(scope, "createLink", JSON.stringify(body), "edge"),
    );
    expect(original.status).toBe(200);
    store.putAlias("p", put("names/endpoint", "b", "move"));
    const retry = {
      ...body,
      source: { uri: "a", revision: "source-pin" },
      target: { uri: "names/endpoint", revision: "target-pin" },
    };
    expect(
      store.createLink("p", prepareLink(scope, "createLink", JSON.stringify(retry), "edge")),
    ).toEqual(original);
    expect(JSON.parse(original.text).resource.source).toEqual({
      uri: `${scope}a`,
      revision: "source-pin",
    });
    expect(JSON.parse(original.text).resource.target).toEqual({
      uri: `${scope}a`,
      revision: "target-pin",
    });
  });
  it.each(["putAlias", "deleteAlias"] as const)(
    "rolls %s state and outcome back together before commit",
    (operation) => {
      let fail = false;
      const { config, store } = setup((phase) => {
        if (fail && phase === "alias-staged") throw new Error("alias interrupted");
      });
      if (operation === "deleteAlias")
        expect(store.putAlias("p", put("names/fault", "a", "seed-alias")).status).toBe(200);
      const invoke = (owner: typeof store) =>
        operation === "putAlias"
          ? owner.putAlias("p", put("names/fault", "a", "fault"))
          : owner.deleteAlias("p", remove("names/fault", "fault"));
      fail = true;
      expect(() => invoke(store)).toThrow("alias interrupted");
      expect(store.resolveAlias(`${scope}names/fault`)).toBe(
        operation === "putAlias" ? null : `${scope}a`,
      );
      fail = false;
      const original = invoke(store);
      expect(original.status).toBe(200);
      store.close();
      const reopened = openPrivateRetainedStore({ ...config, create: false });
      cleanups.push(() => reopened.close());
      expect(invoke(reopened)).toEqual(original);
    },
  );
  it.each(["binding", "witness", "decision-order", "missing-outcome", "old-format"] as const)(
    "refuses %s corruption or incompatible capture without reseed",
    (fault) => {
      const { config, store } = setup();
      store.putAlias("p", put("names/retained", "a", "put"));
      store.update("p", update("names/retained", "update"));
      store.close();
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
      try {
        // The persisted CHECK calls retained_json(body), so registration must be unary.
        db.function("retained_json", { deterministic: true }, (value) => {
          JSON.parse(String(value));
          return 1;
        });
        if (fault === "binding") db.prepare("UPDATE aliases SET target=?").run(`${scope}b`);
        else if (fault === "witness")
          db.prepare("UPDATE outcomes SET witnesses=? WHERE key='update'").run(
            JSON.stringify([{ locator: `${scope}names/retained`, target: `${scope}b` }]),
          );
        else if (fault === "decision-order") {
          db.prepare("UPDATE outcomes SET decision=100 WHERE key='seed-a'").run();
          db.prepare("UPDATE outcomes SET decision=1 WHERE key='seed-b'").run();
          db.prepare("UPDATE outcomes SET decision=2 WHERE key='seed-a'").run();
        } else if (fault === "missing-outcome")
          db.prepare("DELETE FROM outcomes WHERE key='put'").run();
        else {
          const capture = JSON.parse(
            String(db.prepare("SELECT value FROM metadata WHERE name='capture'").get()?.value),
          );
          capture.format = "bdp-private-retained-v01-4";
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
