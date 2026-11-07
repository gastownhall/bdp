/** Donna's Write delete rulings of 2026-11-06 and 2026-11-07, as the reference store applies them. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { referenceNavigation } from "../reference.js";
import { prepareAlias } from "./alias-contract.js";
import { prepareCreate } from "./contract.js";
import { prepareLink } from "./link-contract.js";
import { openPrivateRetainedStore } from "./store.js";

const scope = "https://scope.invalid/ruled/";
const type = "https://types.invalid/T";
const cleanups: (() => void)[] = [];
afterEach(() => {
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
