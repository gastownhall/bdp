import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeJsonDocument } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { referenceNavigation } from "../reference.js";
import {
  prepareCreate,
  prepareDelete,
  prepareHistoricalUpdate,
  prepareUpdate,
} from "./contract.js";
import { openPrivateRetainedStore } from "./store.js";
const scope = "https://history.example/work/";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup(
  historicalUpdate = true,
  onPhase?: (phase: "resource-staged" | "alias-staged" | "committed") => void,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-historical-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "history",
    navigation: referenceNavigation(scope),
    referenceCore: true as const,
    historicalUpdate,
    ...(onPhase === undefined ? {} : { onPhase }),
  };
  let store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  return {
    directory,
    config,
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
function create(store: ReturnType<typeof openPrivateRetainedStore>, id = "a", key = "create") {
  return JSON.parse(
    store.create(
      "p",
      prepareCreate(
        scope,
        JSON.stringify({
          id,
          type: `${scope}TypeA`,
          properties: { title: "first" },
          metadata: { tag: "first" },
        }),
        key,
      ),
    ).text,
  ).resource;
}
function sourced(id: string, source: string, guard?: string, key = "source") {
  return prepareHistoricalUpdate(
    scope,
    JSON.stringify({
      bead: id,
      fromRevision: source,
      ...(guard === undefined ? {} : { expectedRevision: guard }),
    }),
    key,
  );
}
it("undeletes the same identity from exact live content with independent genuine terminal guard and last-current Type", () => {
  const fixture = setup();
  let store = fixture.store;
  const first = create(store);
  const current = JSON.parse(
    store.update(
      "p",
      prepareUpdate(
        scope,
        JSON.stringify({
          bead: "a",
          type: `${scope}TypeB`,
          properties: { title: "last" },
          metadata: { tag: "last" },
        }),
        "edit",
      ),
    ).text,
  ).resource;
  const deletion = JSON.parse(
    store.deleteBead(
      "p",
      prepareDelete(
        scope,
        JSON.stringify({ bead: "a", expectedRevision: current.revision }),
        "delete",
      ),
    ).text,
  );
  expect(deletion.deleted.resource.revision).toBe(current.revision);
  expect(store.readRecord(first.id)).toBeUndefined();
  const terminal = store.readHistoricalVersion(first.id)?.terminal as Record<string, unknown>;
  expect(terminal).toMatchObject({
    id: first.id,
    state: "deleted",
    previousRevision: current.revision,
  });
  expect(terminal.revision).not.toBe(current.revision);
  expect(store.update("p", sourced("a", first.revision, current.revision, "stale")).status).toBe(
    409,
  );
  expect(
    store.update("p", sourced("a", terminal.revision as string, undefined, "nonlive")).status,
  ).toBe(422);
  const invocation = sourced("a", first.revision, terminal.revision as string, "recover");
  const reply = store.update("p", invocation);
  const recovered = JSON.parse(reply.text);
  expect(reply.status).toBe(200);
  expect(recovered).toMatchObject({
    result: {
      outcome: "updated",
      changed: true,
      resource: {
        id: first.id,
        type: `${scope}TypeB`,
        properties: first.properties,
        metadata: first.metadata,
      },
    },
    historicalUpdate: { fromRevision: first.revision, previousRevision: terminal.revision },
  });
  expect(recovered.result.resource.revision).not.toBe(first.revision);
  expect(recovered.result.resource.revision).not.toBe(current.revision);
  expect(store.readRecord(first.id)).toBeDefined();
  const noop = JSON.parse(
    store.update("p", sourced("a", first.revision, recovered.result.resource.revision, "noop"))
      .text,
  );
  expect(noop).toEqual({ ...recovered, result: { ...recovered.result, changed: false } });
  store = fixture.reopen();
  expect(store.update("p", invocation)).toEqual(reply);
  expect(store.readHistoricalVersion(first.id)?.historicalUpdate).toEqual(
    recovered.historicalUpdate,
  );
  store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "a" }), "delete2"));
  const terminal2 = store.readHistoricalVersion(first.id)?.terminal as Record<string, unknown>;
  expect(terminal2.revision).not.toBe(terminal.revision);
  const recovery2 = store.update(
    "p",
    sourced("a", current.revision, terminal2.revision as string, "recover2"),
  );
  expect(recovery2.status).toBe(200);
  store = fixture.reopen();
  const stored = store.readRecord(first.id);
  if (stored === undefined) throw Error("missing committed recovered Resource");
  expect(JSON.parse(stored.body).properties).toEqual(current.properties);
  expect(store.update("p", invocation)).toEqual(reply);
});
it("refuses unknown subjects, foreign-subject source tokens and unsupported feature without upsert", () => {
  const { store } = setup();
  const first = create(store);
  expect(store.update("p", sourced("missing", first.revision)).status).toBe(404);
  const other = create(store, "b", "createb");
  const unknown = store.update("p", sourced("a", other.revision, undefined, "foreign"));
  expect(unknown.status).toBe(404);
  expect(JSON.parse(unknown.text).code).toBe("revision-unknown");
  expect(store.readRecord(`${scope}missing`)).toBeUndefined();
  const ordinary = setup(false).store;
  create(ordinary);
  const refusal = ordinary.update("p", sourced("a", first.revision));
  expect(refusal.status).toBe(422);
  expect(JSON.parse(refusal.text).code).toBe("capability-not-supported");
});

it.each(["missing-version", "terminal-predecessor", "changed-source-context"])(
  "refuses corrupted durable historical evidence: %s",
  (corruption) => {
    const f = setup();
    const store = f.store;
    const first = create(store);
    const last = JSON.parse(
      store.update(
        "p",
        prepareUpdate(scope, JSON.stringify({ bead: "a", properties: { title: "last" } }), "edit"),
      ).text,
    ).resource;
    store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "a" }), "delete"));
    const terminal = store.readHistoricalVersion(first.id)?.terminal as Record<string, unknown>;
    store.update("p", sourced("a", first.revision, terminal.revision as string, "recover"));
    store.close();
    const db = new DatabaseSync(path.join(f.directory, "retained-reference.sqlite"));
    db.function("retained_json", { deterministic: true }, (value) => {
      if (typeof value !== "string") return 0;
      try {
        decodeJsonDocument(value);
        return 1;
      } catch {
        return 0;
      }
    });
    if (corruption === "missing-version")
      db.prepare("DELETE FROM historical_versions WHERE revision=?").run(first.revision);
    else if (corruption === "terminal-predecessor") {
      const body = { terminal: { ...terminal, previousRevision: first.revision } };
      db.prepare("UPDATE historical_versions SET body=? WHERE revision=?").run(
        JSON.stringify(body),
        terminal.revision as string,
      );
    } else {
      const row = db.prepare("SELECT body FROM historical_versions WHERE position=4").get();
      const version = JSON.parse(String(row?.body));
      version.historicalUpdate.fromRevision = last.revision;
      db.prepare("UPDATE historical_versions SET body=? WHERE position=4").run(
        JSON.stringify(version),
      );
      const outcome = db.prepare("SELECT body FROM outcomes WHERE event_position=4").get();
      const result = JSON.parse(String(outcome?.body));
      result.historicalUpdate.fromRevision = last.revision;
      db.prepare("UPDATE outcomes SET body=? WHERE event_position=4").run(JSON.stringify(result));
    }
    db.close();
    expect(() => openPrivateRetainedStore({ ...f.config, create: false })).toThrow();
  },
);
it("fences format selection and refuses unsupported batch composition before provisioning", () => {
  const f = setup();
  f.store.close();
  expect(() =>
    openPrivateRetainedStore({ ...f.config, create: false, historicalUpdate: false }),
  ).toThrow(/mismatch/);
  expect(() => openPrivateRetainedStore({ ...f.config, create: false, atomicBatch: true })).toThrow(
    /composition/,
  );
});

it.each(["resource-staged", "committed"] as const)(
  "settles sourced recovery atomically around %s failure",
  (phase) => {
    let enabled = false;
    const f = setup(true, (observed) => {
      if (enabled && observed === phase) {
        enabled = false;
        throw Error("injected phase failure");
      }
    });
    const first = create(f.store);
    f.store.deleteBead("p", prepareDelete(scope, JSON.stringify({ bead: "a" }), "delete"));
    const terminal = f.store.readHistoricalVersion(first.id)?.terminal as Record<string, unknown>;
    const invocation = sourced("a", first.revision, terminal.revision as string, "recover");
    enabled = true;
    expect(() => f.store.update("p", invocation)).toThrow("injected phase failure");
    if (phase === "resource-staged") expect(f.store.readRecord(first.id)).toBeUndefined();
    const store = f.reopen();
    const result = store.update("p", invocation);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toMatchObject({
      result: { outcome: "updated", changed: true, resource: { id: first.id } },
      historicalUpdate: { fromRevision: first.revision, previousRevision: terminal.revision },
    });
    expect(store.update("p", invocation)).toEqual(result);
  },
);
