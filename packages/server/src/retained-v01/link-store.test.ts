import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCreate, prepareDelete, prepareUpdate, type PrivateNavigation } from "./contract.js";
import { prepareLink, type LinkOperation } from "./link-contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

const scope = "https://records.invalid/tenant/";
const navigation: PrivateNavigation = {
  scope,
  description: "https://nav.invalid/description?t=one",
  beads: "https://inventory.invalid/nodes?t=one",
  links: "https://inventory.invalid/edges?t=one",
  aliases: `${scope}names`,
  events: "https://facts.invalid/stream?t=one",
  operations: "https://nav.invalid/commands?t=one",
  targets: {
    createBead: "https://commands.invalid/new-node?t=one",
    updateBead: "https://commands.invalid/edit-node?t=one",
    deleteBead: "https://commands.invalid/remove-node?t=one",
    createLink: "https://commands.invalid/new-edge?t=one",
    updateLink: "https://commands.invalid/edit-edge?t=one",
    deleteLink: "https://commands.invalid/remove-edge?t=one",
    putAlias: "https://commands.invalid/name?t=one",
    deleteAlias: "https://commands.invalid/unname?t=one",
  },
};
type Store = ReturnType<typeof openPrivateRetainedStore>;
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Link store cleanup failed");
});
function setup(overrides: Partial<PrivateStoreOptions> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-links-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = { directory, create: true, instance: "links", navigation, ...overrides };
  const store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  for (const id of ["left", "right", "next"]) {
    expect(
      store.create(
        "p",
        prepareCreate(
          scope,
          JSON.stringify({ id, type: "https://types.invalid/Node" }),
          `node-${id}`,
        ),
      ).status,
    ).toBe(200);
  }
  return { config, store };
}
const link = (operation: LinkOperation, value: Record<string, unknown>, key: string) =>
  prepareLink(scope, operation, JSON.stringify(value), key);
const create = (id = "edge", extra: Record<string, unknown> = {}, key = "create-edge") =>
  link(
    "createLink",
    {
      id,
      type: { uri: "https://types.invalid/Relation", revision: "T/+1" },
      source: { uri: "left", revision: "old-source-pin" },
      target: { uri: "right", revision: "opaque-target-pin" },
      ...extra,
    },
    key,
  );
const record = (store: Store, id: string) => JSON.parse(store.read(scope + id) ?? "null");
const facts = (store: Store, id?: string) =>
  store.events("p", id ? `${scope}${id}?view=events` : navigation.events, id ? scope + id : "", {
    limit: 100,
  }).events;

describe("private Core-only Link decisions", () => {
  it("carries pins, permits equal tuples and self-Links, and does not version endpoints", () => {
    const { store } = setup();
    const left = record(store, "left");
    const right = record(store, "right");
    const first = store.createLink("p", create());
    expect(first.status).toBe(200);
    const resource = JSON.parse(first.text).resource;
    expect(resource.source).toEqual({ uri: scope + "left", revision: "old-source-pin" });
    expect(resource.target).toEqual({ uri: scope + "right", revision: "opaque-target-pin" });
    expect(store.readRecord(resource.id)?.kind).toBe("link");
    expect(store.createLink("p", create("other", {}, "same-tuple")).status).toBe(200);
    expect(
      store.createLink("p", create("self", { source: "left", target: "left" }, "self")).status,
    ).toBe(200);
    expect(record(store, "left")).toEqual(left);
    expect(record(store, "right")).toEqual(right);
    expect(facts(store, "left")).toHaveLength(4);
    expect(facts(store, "self")).toHaveLength(1);
    expect(JSON.parse(first.text)).not.toHaveProperty("ownerRevisions");
  });
  it("preserves omitted pins, treats a pin-only correction as a change, and retains no-op envelopes", () => {
    const { store } = setup();
    const created = JSON.parse(store.createLink("p", create()).text).resource;
    const pinOnly = store.updateLink(
      "p",
      link(
        "updateLink",
        { link: "edge", type: { uri: "https://types.invalid/Relation", revision: "T/+2" } },
        "type-pin",
      ),
    );
    const retyped = JSON.parse(pinOnly.text);
    expect(retyped.changed).toBe(true);
    expect(retyped.resource.revision).not.toBe(created.revision);
    expect(retyped.resource.properties).toEqual(created.properties);
    expect(retyped.resource.source).toEqual(created.source);
    expect(retyped.resource.target).toEqual(created.target);
    const changedBead = store.update(
      "p",
      prepareUpdate(
        scope,
        JSON.stringify({ bead: "left", properties: { newer: true } }),
        "node-update",
      ),
    );
    expect(changedBead.status).toBe(200);
    const property = store.updateLink(
      "p",
      link("updateLink", { link: "edge", properties: { x: 1 } }, "property"),
    );
    expect(JSON.parse(property.text).resource.source).toEqual(created.source);
    const floating = store.updateLink(
      "p",
      link(
        "updateLink",
        { link: "edge", source: "left", revisionProvenance: { message: "remove source pin" } },
        "floating",
      ),
    );
    const current = JSON.parse(floating.text).resource;
    expect(current.source).toBe(scope + "left");
    expect(current.target).toEqual(created.target);
    expect(current.revision).not.toBe(created.revision);
    const noop = store.updateLink(
      "p",
      link(
        "updateLink",
        {
          link: "edge",
          source: "left",
          propertiesChange: [],
          expectedRevision: current.revision,
          revisionProvenance: { message: "must not replace provenance" },
        },
        "noop",
      ),
    );
    expect(JSON.parse(noop.text)).toEqual({
      outcome: "updated",
      changed: false,
      resource: current,
    });
    expect(facts(store, "edge")).toHaveLength(4);
  });
  it("publishes endpoint moves once to departing and arriving Bead Event projections", () => {
    const { store } = setup();
    const created = store.createLink("p", create());
    const before = JSON.parse(created.text).resource;
    const next = record(store, "next");
    const external = "https://Foreign.Invalid/resource?x=%2f#edition";
    const updated = store.updateLink(
      "p",
      link("updateLink", { link: "edge", source: "next", target: external }, "move"),
    );
    const after = JSON.parse(updated.text).resource;
    expect(after.id).toBe(before.id);
    expect(after.target).toBe(external);
    const event = facts(store, "edge").at(-1);
    expect(event).toMatchObject({
      previousRevision: before.revision,
      revision: after.revision,
      effect: { operation: "updateLink", link: before.id, resource: after },
    });
    for (const endpoint of ["left", "right", "next"])
      expect(facts(store, endpoint).filter((entry) => entry.id === event.id)).toHaveLength(1);
    expect(record(store, "next")).toEqual(next);
    expect(
      store.deleteBead("p", prepareDelete(scope, '{"bead":"left"}', "left-delete")).status,
    ).toBe(200);
    expect(store.createLink("p", create())).toEqual(created);
    expect(
      store.updateLink(
        "p",
        link("updateLink", { link: "edge", source: "next", target: external }, "move"),
      ),
    ).toEqual(updated);
  });
  it("checks endpoint and subject kind, rejects two external endpoints and rolls back all supplied edits", () => {
    const { store } = setup();
    store.createLink("p", create());
    const before = record(store, "edge");
    const wrong = store.updateLink(
      "p",
      link(
        "updateLink",
        { link: "edge", properties: { mustNotCommit: true }, source: "edge" },
        "wrong-kind",
      ),
    );
    expect(wrong.status).toBe(422);
    expect(JSON.parse(wrong.text).diagnostics).toHaveLength(1);
    expect(store.createLink("p", create("missing", { target: "absent" }, "missing")).status).toBe(
      404,
    );
    expect(
      store.createLink(
        "p",
        create(
          "external",
          { source: "https://one.invalid/a", target: "https://two.invalid/b" },
          "external",
        ),
      ).status,
    ).toBe(422);
    expect(
      store.update("p", prepareUpdate(scope, '{"bead":"edge","properties":{}}', "bead-wrong-kind"))
        .status,
    ).toBe(404);
    expect(
      store.updateLink("p", link("updateLink", { link: "left", properties: {} }, "link-wrong-kind"))
        .status,
    ).toBe(404);
    expect(record(store, "edge")).toEqual(before);
    expect(facts(store, "edge")).toHaveLength(1);
  });
  it("keeps terminal incident refusal after the graph clears and never reuses a Link identity", () => {
    const { store } = setup();
    store.createLink("p", create());
    const attempt = prepareDelete(scope, '{"bead":"left"}', "blocked");
    const blocked = store.deleteBead("p", attempt);
    expect(JSON.parse(blocked.text).code).toBe("incident-links-exist");
    expect(store.deleteLink("p", link("deleteLink", { link: "edge" }, "delete-edge")).status).toBe(
      200,
    );
    expect(store.deleteBead("p", attempt)).toEqual(blocked);
    expect(
      store.deleteBead("p", prepareDelete(scope, '{"bead":"left"}', "fresh-delete")).status,
    ).toBe(200);
    expect(
      JSON.parse(
        store.create(
          "p",
          prepareCreate(scope, '{"id":"edge","type":"https://types.invalid/Node"}', "reuse"),
        ).text,
      ).code,
    ).toBe("identity-taken");
  });
  it("recovers all original Link results after deletion without a current-Resource lookup", () => {
    const { config, store } = setup();
    const creation = create();
    const first = store.createLink("p", creation);
    const edit = link("updateLink", { link: "edge", metadata: { changed: true } }, "edit");
    const second = store.updateLink("p", edit);
    const deletion = link(
      "deleteLink",
      { link: "edge", revisionProvenance: { message: "unowned delete" } },
      "delete",
    );
    const third = store.deleteLink("p", deletion);
    const final = JSON.parse(second.text).resource;
    expect(JSON.parse(third.text)).toEqual({
      outcome: "deleted",
      changed: true,
      deleted: {
        resourceKind: "link",
        resource: { id: final.id, type: final.type, revision: final.revision },
      },
    });
    const deletionFact = facts(store, "edge").at(-1);
    expect(deletionFact.effect.deleted.source).toEqual(final.source);
    expect(deletionFact.effect.deleted.target).toEqual(final.target);
    expect(deletionFact).not.toHaveProperty("previousRevision");
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const prepare = DatabaseSync.prototype.prepare;
    const guard = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (/\b(?:FROM|JOIN)\s+resources\b/i.test(sql))
        throw new Error("current Resource unavailable");
      return prepare.call(this, sql);
    });
    expect(reopened.createLink("p", creation)).toEqual(first);
    expect(reopened.updateLink("p", edit)).toEqual(second);
    expect(reopened.deleteLink("p", deletion)).toEqual(third);
    guard.mockRestore();
    expect(facts(reopened, "edge")).toHaveLength(3);
  });
  it("rolls back staged Link state, fact and incidence on a fault", () => {
    let fail = false;
    const { store } = setup({
      onPhase: (phase) => {
        if (fail && phase === "resource-staged") throw new Error("staged Link fault");
      },
    });
    fail = true;
    expect(() => store.createLink("p", create())).toThrow("staged Link fault");
    expect(record(store, "edge")).toBeNull();
    expect(facts(store, "left")).toHaveLength(1);
    fail = false;
    store.createLink("p", create());
    const before = record(store, "edge");
    const edit = link("updateLink", { link: "edge", source: "next" }, "move");
    fail = true;
    expect(() => store.updateLink("p", edit)).toThrow("staged Link fault");
    expect(record(store, "edge")).toEqual(before);
    expect(facts(store, "next")).toHaveLength(1);
    expect(() => store.deleteLink("p", link("deleteLink", { link: "edge" }, "delete"))).toThrow(
      "staged Link fault",
    );
    expect(record(store, "edge")).toEqual(before);
    fail = false;
    expect(store.updateLink("p", edit).status).toBe(200);
  });
  it("uses the shared operation key namespace and retains a stale guard after deletion", () => {
    const { store } = setup();
    expect(JSON.parse(store.createLink("p", create("edge", {}, "node-left")).text).code).toBe(
      "idempotency-conflict",
    );
    store.createLink("p", create());
    const stale = link(
      "updateLink",
      { link: "edge", source: "next", expectedRevision: "stale" },
      "stale",
    );
    const mismatch = store.updateLink("p", stale);
    expect(JSON.parse(mismatch.text).code).toBe("revision-mismatch");
    store.deleteLink("p", link("deleteLink", { link: "edge" }, "delete"));
    expect(store.updateLink("p", stale)).toEqual(mismatch);
    expect(
      JSON.parse(store.deleteLink("p", link("deleteLink", { link: "edge" }, "create-edge")).text)
        .code,
    ).toBe("idempotency-conflict");
  });
  it("allocates rootless Link identity and retains size refusal without allocation", () => {
    const { store } = setup();
    const allocated = store.createLink(
      "p",
      link(
        "createLink",
        { type: "https://types.invalid/R", source: "left", target: "right" },
        "allocated",
      ),
    );
    const id = JSON.parse(allocated.text).resource.id as string;
    expect(id.startsWith(scope)).toBe(true);
    expect(id.slice(scope.length)).not.toContain("/");
    expect(store.readRecord(id)?.kind).toBe("link");
    const huge = create("large", { properties: { content: "x".repeat(262144) } }, "large");
    const refused = store.createLink("p", huge);
    expect(refused.status).toBe(413);
    expect(store.createLink("p", huge)).toEqual(refused);
    expect(record(store, "large")).toBeNull();
    expect(store.createLink("p", create("large", {}, "small")).status).toBe(200);
    expect(store.createLink("p", huge)).toEqual(refused);
  });
  it.each(["incidence", "kind", "format"])("refuses damaged Link recovery state: %s", (fault) => {
    const { config, store } = setup();
    store.createLink("p", create());
    store.close();
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      db.function("retained_json", { deterministic: true }, (value) => {
        JSON.parse(String(value));
        return 1;
      });
      if (fault === "incidence") db.prepare("DELETE FROM incidence").run();
      else if (fault === "kind")
        db.prepare("UPDATE identities SET kind='bead' WHERE id=?").run(scope + "edge");
      else {
        const capture = JSON.parse(
          String(db.prepare("SELECT value FROM metadata WHERE name='capture'").get()?.value),
        );
        capture.format = "bdp-private-retained-v01-3";
        db.prepare("UPDATE metadata SET value=? WHERE name='capture'").run(JSON.stringify(capture));
      }
    } finally {
      db.close();
    }
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
  });
});
