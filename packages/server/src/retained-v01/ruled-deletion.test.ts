/** Donna's Write delete rulings of 2026-11-06 and 2026-11-07, as the reference store applies them. */
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HISTORICAL_UPDATE_MEDIA } from "@bdp/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { referenceNavigation, startReferenceService } from "../reference.js";
import { prepareAlias } from "./alias-contract.js";
import { prepareBatch } from "./batch-contract.js";
import {
  prepareCreate,
  prepareDelete,
  prepareHistoricalUpdate,
  RETAINED_MEDIA,
} from "./contract.js";
import { prepareLink } from "./link-contract.js";
import { openPrivateRetainedStore } from "./store.js";

const controlled = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => controlled.ids.shift() ?? actual.randomUUID() };
});

const scope = "https://scope.invalid/ruled/";
const type = "https://types.invalid/T";
const cleanups: (() => void)[] = [];
afterEach(() => {
  controlled.ids.length = 0;
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup(mode: { readonly atomicBatch?: boolean; readonly historicalUpdate?: boolean } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-ruled-deletion-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "ruled",
    navigation: referenceNavigation(scope),
    referenceCore: true as const,
    ...mode,
  };
  let store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  return {
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = openPrivateRetainedStore({ ...config, create: false });
      return store;
    },
  };
}
type Store = ReturnType<typeof openPrivateRetainedStore>;
let keys = 0;
const key = () => `key-${++keys}`;
const createBead = (store: Store, id: string, extra: object = {}) =>
  store.create("p", prepareCreate(scope, JSON.stringify({ id, type, ...extra }), key()));
const createLink = (store: Store, id: string, source: unknown, target: unknown) =>
  store.createLink(
    "p",
    prepareLink(scope, "createLink", JSON.stringify({ id, type, source, target }), key()),
  );
const putAlias = (store: Store, alias: string, target: string) =>
  store.putAlias("p", prepareAlias(scope, "putAlias", JSON.stringify({ alias, target }), key()));
const deleteBead = (store: Store, bead: string, extra: object = {}) =>
  store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead, ...extra }), key()));
const deleteLink = (store: Store, link: string) =>
  store.deleteLink("p", prepareLink(scope, "deleteLink", JSON.stringify({ link }), key()));
const batch = (operations: readonly object[]) =>
  prepareBatch(scope, JSON.stringify({ capabilityVersion: "1", operations }), key());
const body = (result: { readonly text: string }) => JSON.parse(result.text);

describe("identity-taken's one retry value", () => {
  it("is after-state-change for a live, other-kind and alias collision", () => {
    const { store } = setup();
    expect(createBead(store, "a").status).toBe(200);
    expect(createBead(store, "b").status).toBe(200);
    expect(createLink(store, "edge", "a", "b").status).toBe(200);
    expect(createBead(store, "aliases/occupied").status).toBe(200);
    const refusals = [
      createBead(store, "a"),
      createBead(store, "edge"),
      createLink(store, "a", "a", "b"),
      putAlias(store, "aliases/occupied", "b"),
    ];
    for (const refusal of refusals) {
      expect(refusal.status).toBe(409);
      expect(body(refusal)).toMatchObject({
        code: "identity-taken",
        retry: "after-state-change",
      });
    }
  });
});

describe("createBead with a supplied id on a deleted Bead", () => {
  it("adds a revision under that identity, inheriting nothing, and survives reopen", () => {
    const fixture = setup();
    const first = body(createBead(fixture.store, "a", { properties: { old: true } })).resource;
    expect(deleteBead(fixture.store, "a").status).toBe(200);
    const again = createBead(fixture.store, "a", { properties: { fresh: true } });
    expect(again.status).toBe(200);
    expect(body(again)).toMatchObject({
      outcome: "created",
      changed: true,
      resource: { id: first.id, properties: { fresh: true }, metadata: {} },
    });
    expect(body(again).resource.revision).not.toBe(first.revision);
    expect(JSON.parse(fixture.store.read(first.id) as string).properties).toEqual({ fresh: true });
    expect(deleteBead(fixture.store, "a").status).toBe(200);
    const third = body(createBead(fixture.store, "a")).resource;
    expect(third.properties).toEqual({});
    const reopened = fixture.reopen();
    expect(JSON.parse(reopened.read(first.id) as string).revision).toBe(third.revision);
    expect(body(createBead(reopened, "a")).code).toBe("identity-taken");
  });

  it("does not change the rule for a live id, the other kind or a deleted Link", () => {
    const fixture = setup();
    createBead(fixture.store, "a");
    createBead(fixture.store, "b");
    expect(createLink(fixture.store, "edge", "a", "b").status).toBe(200);
    expect(deleteLink(fixture.store, "edge").status).toBe(200);
    expect(deleteBead(fixture.store, "b").status).toBe(200);
    const taken = [
      createBead(fixture.store, "a"),
      createBead(fixture.store, "edge"),
      createLink(fixture.store, "edge", "a", "a"),
      createLink(fixture.store, "b", "a", "a"),
    ];
    for (const refusal of taken) expect(body(refusal).code).toBe("identity-taken");
    expect(body(putAlias(fixture.store, "aliases/x", "b")).code).toBe("resource-not-found");
    expect(fixture.reopen().read(`${scope}edge`)).toBeUndefined();
  });

  it("keeps a generated id off every deleted id", () => {
    const fixture = setup();
    const id = `${scope}${"0".repeat(8)}-0000-4000-8000-000000000000`;
    controlled.ids.push(id.slice(scope.length));
    expect(
      body(fixture.store.create("p", prepareCreate(scope, `{"type":"${type}"}`, key()))).resource
        .id,
    ).toBe(id);
    expect(deleteBead(fixture.store, id).status).toBe(200);
    controlled.ids.push(id.slice(scope.length));
    const next = body(fixture.store.create("p", prepareCreate(scope, `{"type":"${type}"}`, key())));
    expect(next.outcome).toBe("created");
    expect(next.resource.id).not.toBe(id);
    expect(fixture.store.read(id)).toBeUndefined();
  });

  it("names the identity in an atomic batch, refusing one the batch consumed or deleted", () => {
    const fixture = setup({ atomicBatch: true });
    createBead(fixture.store, "gone");
    createBead(fixture.store, "live");
    expect(deleteBead(fixture.store, "gone").status).toBe(200);
    const recreated = fixture.store.batch(
      "p",
      batch([{ operation: "createBead", id: "gone", type, properties: { again: true } }]),
    );
    expect(recreated.status).toBe(200);
    expect(body(recreated).resources[0]).toMatchObject({
      outcome: "created",
      resource: { properties: { again: true } },
    });
    const sameBatch = fixture.store.batch(
      "p",
      batch([
        { operation: "deleteBead", bead: "live" },
        { operation: "createBead", id: "live", type },
      ]),
    );
    expect(body(sameBatch).code).toBe("identity-taken");
    expect(
      fixture.store.batch(
        "p",
        batch([
          { operation: "createBead", id: "consumed", type, name: "n" },
          { operation: "deleteBead", bead: "@n" },
        ]),
      ).status,
    ).toBe(200);
    expect(body(createBead(fixture.store, "consumed")).code).toBe("identity-taken");
    expect(deleteBead(fixture.store, "gone").status).toBe(200);
    const roundTrip = fixture.store.batch(
      "p",
      batch([
        { operation: "createBead", id: "gone", type, name: "again" },
        { operation: "deleteBead", bead: "@again" },
      ]),
    );
    expect(body(roundTrip).resources[0].outcome).toBe("allocated");
    const reopened = fixture.reopen();
    expect(body(createBead(reopened, "gone")).code).toBe("identity-taken");
    expect(body(createBead(reopened, "consumed")).code).toBe("identity-taken");
  });
});

describe("deleteBead admits revisionProvenance", () => {
  const revisionProvenance = { actor: { id: "writer", basis: "writer-supplied" }, message: "why" };
  it("accepts it where nothing is recorded, as part of retry identity", () => {
    const { store } = setup();
    createBead(store, "a");
    const input = prepareDelete(scope, JSON.stringify({ bead: "a", revisionProvenance }), "d");
    const deleted = store.deleteBead("p", input);
    expect(deleted.status).toBe(200);
    expect(body(deleted)).not.toHaveProperty("revisionProvenance");
    expect(store.deleteBead("p", input)).toEqual(deleted);
    expect(
      body(store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "a" }), "d"))).code,
    ).toBe("idempotency-conflict");
    expect(() =>
      prepareDelete(scope, JSON.stringify({ bead: "a", revisionProvenance: { actor: 1 } }), "e"),
    ).toThrow();
  });
  it("records it on the historical terminal version, across reopen", () => {
    const fixture = setup({ historicalUpdate: true });
    const first = body(createBead(fixture.store, "a")).resource;
    expect(deleteBead(fixture.store, "a", { revisionProvenance }).status).toBe(200);
    const check = (store: Store) =>
      expect(store.readHistoricalVersion(first.id)).toMatchObject({
        terminal: {
          previousRevision: first.revision,
          revisionProvenance: {
            actor: revisionProvenance.actor,
            committedAt: { state: "present" },
            message: { state: "present", value: "why" },
            agent: { state: "undetermined" },
          },
        },
      });
    check(fixture.store);
    check(fixture.reopen());
  });
  it("is admitted on a batch member", () => {
    const { store } = setup({ atomicBatch: true });
    createBead(store, "a");
    const deleted = store.batch(
      "p",
      batch([{ operation: "deleteBead", bead: "a", revisionProvenance }]),
    );
    expect(deleted.status).toBe(200);
    expect(body(deleted).resources[0].outcome).toBe("deleted");
  });
});

describe("deleting a Bead removes its aliases", () => {
  it("lists them ascending, releases the locators and restores none on a re-create", () => {
    const fixture = setup();
    createBead(fixture.store, "a");
    createBead(fixture.store, "b");
    for (const alias of ["aliases/z", "aliases/m"]) putAlias(fixture.store, alias, "a");
    putAlias(fixture.store, "aliases/other", "b");
    const removed = deleteBead(fixture.store, "aliases/m");
    expect(body(removed).removedAliases).toEqual([`${scope}aliases/m`, `${scope}aliases/z`]);
    expect(fixture.store.resolveAlias(`${scope}aliases/z`)).toBeNull();
    expect(fixture.store.resolveAlias(`${scope}aliases/other`)).toBe(`${scope}b`);
    expect(body(deleteBead(fixture.store, "b")).removedAliases).toEqual([`${scope}aliases/other`]);
    expect(createBead(fixture.store, "a").status).toBe(200);
    expect(fixture.store.resolveAlias(`${scope}aliases/m`)).toBeNull();
    expect(body(putAlias(fixture.store, "aliases/m", "a")).outcome).toBe("created");
    expect(fixture.reopen().resolveAlias(`${scope}aliases/m`)).toBe(`${scope}a`);
  });
  it("reports an empty list on a Bead and none on a Link", () => {
    const { store } = setup();
    createBead(store, "a");
    createBead(store, "b");
    createLink(store, "edge", "a", "b");
    expect(body(deleteLink(store, "edge"))).not.toHaveProperty("removedAliases");
    expect(body(deleteBead(store, "a")).removedAliases).toEqual([]);
  });
  it("removes them in one atomic batch decision and replays the list", () => {
    const fixture = setup({ atomicBatch: true });
    createBead(fixture.store, "a");
    putAlias(fixture.store, "aliases/n", "a");
    const input = batch([{ operation: "deleteBead", bead: "a" }]);
    const deleted = fixture.store.batch("p", input);
    expect(body(deleted).removedAliases).toEqual([`${scope}aliases/n`]);
    expect(fixture.store.resolveAlias(`${scope}aliases/n`)).toBeNull();
    expect(fixture.store.batch("p", input)).toEqual(deleted);
    const reopened = fixture.reopen();
    expect(reopened.batch("p", input)).toEqual(deleted);
    expect(
      body(reopened.batch("p", batch([{ operation: "createBead", id: "c", type }]))),
    ).not.toHaveProperty("removedAliases");
  });
  it("rolls an alias removal back with the deletion", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-ruled-fault-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    let armed = false;
    const store = openPrivateRetainedStore({
      directory,
      create: true,
      instance: "ruled",
      navigation: referenceNavigation(scope),
      referenceCore: true,
      onPhase: (phase) => {
        if (armed && phase === "resource-staged") throw new Error("injected");
      },
    });
    cleanups.push(() => store.close());
    createBead(store, "a");
    putAlias(store, "aliases/n", "a");
    armed = true;
    expect(() => deleteBead(store, "a")).toThrow("injected");
    armed = false;
    expect(store.resolveAlias(`${scope}aliases/n`)).toBe(`${scope}a`);
    expect(store.read(`${scope}a`)).toBeDefined();
  });
  it("refuses a recovered deletion whose list differs from the alias chain", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-ruled-damage-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const config = {
      directory,
      create: true,
      instance: "ruled",
      navigation: referenceNavigation(scope),
      referenceCore: true as const,
    };
    const store = openPrivateRetainedStore(config);
    createBead(store, "a");
    putAlias(store, "aliases/n", "a");
    deleteBead(store, "a");
    store.close();
    const db = new DatabaseSync(path.join(directory, "retained-reference.sqlite"));
    db.function("retained_json", { deterministic: true }, (_value) => 1);
    db.prepare(
      "UPDATE outcomes SET body=json_set(body,'$.removedAliases',json('[]')) WHERE operation='deleteBead'",
    ).run();
    db.close();
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow(
      "inconsistent retained alias removal",
    );
  });
});

describe("a Link pinned to a deleted Bead", () => {
  const pinned = (store: Store, id: string) => ({
    uri: `${scope}${id}`,
    revision: JSON.parse(store.read(`${scope}${id}`) as string).revision,
  });
  it("survives with no new revision while a live in-Scope endpoint remains, across reopen", () => {
    const fixture = setup();
    createBead(fixture.store, "a");
    createBead(fixture.store, "b");
    const link = body(createLink(fixture.store, "edge", pinned(fixture.store, "a"), "b")).resource;
    expect(deleteBead(fixture.store, "a").status).toBe(200);
    expect(JSON.parse(fixture.store.read(`${scope}edge`) as string)).toEqual(link);
    const reopened = fixture.reopen();
    expect(JSON.parse(reopened.read(`${scope}edge`) as string)).toEqual(link);
    expect(body(deleteBead(reopened, "b")).code).toBe("incident-links-exist");
  });
  it("counts a pinned live endpoint as live, until it is the last one", () => {
    const { store } = setup();
    createBead(store, "a");
    createBead(store, "b");
    createLink(store, "edge", pinned(store, "a"), pinned(store, "b"));
    expect(deleteBead(store, "a").status).toBe(200);
    expect(body(deleteBead(store, "b")).code).toBe("incident-links-exist");
    expect(deleteLink(store, "edge").status).toBe(200);
    expect(deleteBead(store, "b").status).toBe(200);
  });
  it.each([
    ["an external other endpoint", "https://elsewhere.invalid/x"],
    ["a self-Link", "self"],
  ])("is treated as unpinned with %s", (_name, other) => {
    const { store } = setup();
    createBead(store, "a");
    const pin = pinned(store, "a");
    expect(createLink(store, "edge", pin, other === "self" ? pin : other).status).toBe(200);
    expect(body(deleteBead(store, "a")).code).toBe("incident-links-exist");
  });
  it("still blocks on an unpinned endpoint", () => {
    const { store } = setup();
    createBead(store, "a");
    createBead(store, "b");
    createLink(store, "edge", "a", pinned(store, "b"));
    expect(body(deleteBead(store, "a")).code).toBe("incident-links-exist");
  });
  it("stays updatable, without resolving the kept endpoint, but cannot lose its live one", () => {
    const fixture = setup();
    createBead(fixture.store, "a");
    createBead(fixture.store, "b");
    createBead(fixture.store, "c");
    const pin = pinned(fixture.store, "a");
    createLink(fixture.store, "edge", pin, "b");
    deleteBead(fixture.store, "a");
    const edit = (fields: object) =>
      fixture.store.updateLink(
        "p",
        prepareLink(scope, "updateLink", JSON.stringify({ link: "edge", ...fields }), key()),
      );
    const updated = edit({ properties: { n: 1 } });
    expect(updated.status).toBe(200);
    expect(body(updated).resource.source).toEqual(pin);
    expect(edit({ source: pin }).status).toBe(404);
    expect(edit({ target: "c" }).status).toBe(200);
    expect(body(edit({ target: "https://elsewhere.invalid/x" })).code).toBe("validation-failed");
    const reopened = fixture.reopen();
    expect(JSON.parse(reopened.read(`${scope}edge`) as string).target).toBe(`${scope}c`);
  });
  it("refuses a new Link naming a deleted Bead, pinned or not", () => {
    const { store } = setup();
    createBead(store, "a");
    createBead(store, "b");
    const pin = pinned(store, "a");
    deleteBead(store, "a");
    expect(createLink(store, "edge", pin, "b").status).toBe(404);
    expect(createLink(store, "edge", "a", "b").status).toBe(404);
  });
  it("applies inside an atomic batch and across its recovery", () => {
    const fixture = setup({ atomicBatch: true });
    for (const id of ["a", "b"]) createBead(fixture.store, id);
    createLink(fixture.store, "edge", pinned(fixture.store, "a"), pinned(fixture.store, "b"));
    const blocked = fixture.store.batch(
      "p",
      batch([
        { operation: "deleteBead", bead: "a" },
        { operation: "deleteBead", bead: "b" },
      ]),
    );
    expect(body(blocked).code).toBe("incident-links-exist");
    expect(fixture.store.read(`${scope}a`)).toBeDefined();
    const survives = fixture.store.batch(
      "p",
      batch([
        { operation: "deleteBead", bead: "a" },
        { operation: "updateLink", link: "edge", properties: { kept: true } },
      ]),
    );
    expect(survives.status).toBe(200);
    expect(JSON.parse(fixture.reopen().read(`${scope}edge`) as string).properties).toEqual({
      kept: true,
    });
  });
});

describe("delete-modes1 stays unimplemented", () => {
  it.each([
    [{ bead: "a", dryRun: true }],
    [{ bead: "a", blockedBy: "any" }],
    [{ bead: "a", cascade: { through: [{ type, match: "exact" }] } }],
    [{ beads: ["a"] }],
  ])("a base closed receiver rejects %j", (input) => {
    expect(() => prepareDelete(scope, JSON.stringify(input), key())).toThrow("malformed-request");
  });
});

describe("retained-after-deletion reads belong to historical-update1", () => {
  it("are refused on a store that does not implement it", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-ruled-read-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const service = await startReferenceService({
      directory,
      create: true,
      instance: "ruled-read",
      scope,
      specRevision: "0".repeat(40),
      credentials: [],
      authentication: "disabled",
    });
    cleanups.push(() => void service.close());
    const send = (target: string, headers: Record<string, string> = {}, text?: string) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
        const url = new URL(target, service.listenUrl);
        const request = httpRequest(
          {
            host: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: text === undefined ? "GET" : "POST",
            headers: { host: new URL(scope).host, ...headers },
          },
          (response) => {
            let received = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              received += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode ?? 0, text: received }));
          },
        );
        request.on("error", reject);
        request.end(text);
      });
    const post = (target: string, payload: object) =>
      send(
        new URL(target).pathname + new URL(target).search,
        { "content-type": RETAINED_MEDIA, "idempotency-key": key() },
        JSON.stringify(payload),
      );
    const targets = service.navigation.targets;
    expect((await post(targets.createBead, { id: "a", type })).status).toBe(200);
    expect((await post(targets.deleteBead, { bead: "a" })).status).toBe(200);
    const historical = await send("/ruled/a?view=terminal", {
      accept: HISTORICAL_UPDATE_MEDIA,
    });
    expect(historical.status).toBe(422);
    expect(JSON.parse(historical.text)).toMatchObject({ code: "capability-not-supported" });
    expect((await send("/ruled/a")).status).toBe(404);
    expect((await send("/ruled/a?revision=r1")).status).toBe(400);
  });
  it("are served by a store that does, and a re-create ends the terminal view", () => {
    const fixture = setup({ historicalUpdate: true });
    const first = body(createBead(fixture.store, "a", { properties: { old: true } })).resource;
    deleteBead(fixture.store, "a");
    const terminal = fixture.store.readHistoricalVersion(first.id)?.terminal;
    expect(terminal).toMatchObject({ state: "deleted", previousRevision: first.revision });
    const again = body(createBead(fixture.store, "a")).resource;
    const reopened = fixture.reopen();
    expect(reopened.readHistoricalVersion(first.id)).toEqual({ resource: again });
    expect(reopened.readHistoricalVersion(first.id, first.revision)).toMatchObject({
      resource: { properties: { old: true } },
    });
    expect(
      reopened.readHistoricalVersion(first.id, (terminal as { revision: string }).revision),
    ).toEqual({ terminal });
  });
  it("leave no alias behind on a fromRevision recovery", () => {
    const fixture = setup({ historicalUpdate: true });
    const first = body(createBead(fixture.store, "a")).resource;
    putAlias(fixture.store, "aliases/n", "a");
    expect(body(deleteBead(fixture.store, "a")).removedAliases).toEqual([`${scope}aliases/n`]);
    const recovered = fixture.store.update(
      "p",
      prepareHistoricalUpdate(
        scope,
        JSON.stringify({ bead: "a", fromRevision: first.revision }),
        key(),
      ),
    );
    expect(recovered.status).toBe(200);
    expect(fixture.reopen().resolveAlias(`${scope}aliases/n`)).toBeNull();
  });
});
