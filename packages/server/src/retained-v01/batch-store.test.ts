/** Acceptance for explicit batch-enabled stores and unchanged ordinary format5. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { referenceNavigation } from "../reference.js";
import { prepareAlias } from "./alias-contract.js";
import { prepareBatch } from "./batch-contract.js";
import { prepareCreate, prepareUpdate } from "./contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

const scope = "https://batch.invalid/store/",
  type = "https://types.invalid/Node";
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse())
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length) throw new AggregateError(failures, "batch store cleanup");
});
function setup(onPhase?: PrivateStoreOptions["onPhase"], atomicBatch = true) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-batch-store-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "batch-unit",
    navigation: referenceNavigation(scope),
    atomicBatch,
    ...(onPhase ? { onPhase } : {}),
  };
  const store = openPrivateRetainedStore(config);
  cleanups.push(() => store.close());
  return { store, config };
}
function batch(operations: unknown[], key = "batch-key") {
  return prepareBatch(scope, JSON.stringify({ capabilityVersion: "1", operations }), key);
}
const code = (value: { text: string }) => JSON.parse(value.text).code;
function snapshot(directory: string) {
  const db = new DatabaseSync(path.join(directory, "retained-reference.sqlite"));
  try {
    const tables = db
      .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all();
    return {
      tables,
      records: tables.map((table) => ({
        name: table.name,
        rows: db.prepare(`SELECT * FROM ${String(table.name)} ORDER BY rowid`).all(),
      })),
    };
  } finally {
    db.close();
  }
}
describe("explicit format compatibility without migration", () => {
  it("keeps format5 schema/capture/records unchanged through nonbatch reopen and support refusal", () => {
    const { store, config } = setup(undefined, false);
    store.close();
    const original = snapshot(config.directory);
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    expect(reopened.atomicBatchEnabled).toBe(false);
    expect(
      code(reopened.batch("p", batch([{ operation: "createBead", id: "unsupported", type }]))),
    ).toBe("capability-not-supported");
    reopened.close();
    expect(snapshot(config.directory)).toEqual(original);
    expect(() => openPrivateRetainedStore({ ...config, create: false, atomicBatch: true })).toThrow(
      "mismatch",
    );
    expect(snapshot(config.directory)).toEqual(original);
    const ordinary = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => ordinary.close());
    expect(
      ordinary.create(
        "p",
        prepareCreate(scope, JSON.stringify({ id: "ordinary", type }), "batch-key"),
      ).status,
    ).toBe(200);
  });
  it("requires explicit true mode for format6 and refuses unknown formats without conversion", () => {
    const { store, config } = setup();
    expect(store.atomicBatchEnabled).toBe(true);
    store.close();
    const original = snapshot(config.directory);
    expect(() =>
      openPrivateRetainedStore({ ...config, create: false, atomicBatch: false }),
    ).toThrow("mismatch");
    expect(snapshot(config.directory)).toEqual(original);
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      const value = JSON.parse(
        String(db.prepare("SELECT value FROM metadata WHERE name='capture'").get()!.value),
      );
      value.format = "unrecognized-future-format";
      db.prepare("UPDATE metadata SET value=? WHERE name='capture'").run(JSON.stringify(value));
    } finally {
      db.close();
    }
    const unknown = snapshot(config.directory);
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow("mismatch");
    expect(snapshot(config.directory)).toEqual(unknown);
  });
});
describe("atomic batch durable whole outcomes and final publication", () => {
  it("reopens a URI-sorted Link-before-Bead group and reprojects renamed labels without new allocation", () => {
    const { store, config } = setup();
    const request = (name: string) =>
      batch([
        { operation: "createBead", id: "z-bead", type, name },
        {
          operation: "createLink",
          id: "a-link",
          type,
          source: { uri: `@${name}`, revision: "literal-pin" },
          target: "urn:source:opaque",
        },
      ]);
    const first = store.batch("p", request("original"));
    expect(first.status).toBe(200);
    const saved = JSON.parse(first.text);
    expect(saved.resources.map((row: { id: string }) => row.id)).toEqual([
      scope + "a-link",
      scope + "z-bead",
    ]);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const replay = JSON.parse(reopened.batch("p", request("renamed")).text);
    expect(replay).toEqual({
      ...saved,
      results: saved.results.map((entry: Record<string, unknown>, i: number) =>
        i === 0 ? { ...entry, operationName: "renamed" } : entry,
      ),
    });
    expect(JSON.parse(reopened.read(scope + "a-link")!)).toEqual(saved.resources[0].resource);
    expect(reopened.events("p", config.navigation.events, "", { limit: 20 }).events).toHaveLength(
      2,
    );
  });
  it("retains a successful no-op across later state and reopen, independent of current bodies", () => {
    const { store, config } = setup();
    const created = JSON.parse(
      store.create("p", prepareCreate(scope, JSON.stringify({ id: "existing", type }), "seed"))
        .text,
    ).resource;
    const input = batch([
      {
        operation: "updateBead",
        bead: "existing",
        properties: { temporary: true },
        expectedRevision: created.revision,
      },
      {
        operation: "updateBead",
        bead: "existing",
        properties: {},
        expectedRevision: created.revision,
      },
    ]);
    const first = store.batch("p", input);
    expect(JSON.parse(first.text).changed).toBe(false);
    expect(
      store.update(
        "p",
        prepareUpdate(
          scope,
          JSON.stringify({ bead: "existing", properties: { later: true } }),
          "later",
        ),
      ).status,
    ).toBe(200);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const original = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (/SELECT.*(?:r\.body|body FROM resources)/i.test(sql))
        throw new Error("no current body access on replay");
      return original.call(this, sql);
    });
    expect(reopened.batch("p", input)).toEqual(first);
  });
  it("rolls a fault after staged publication back before any allocation/key decision", () => {
    let interrupted = true;
    const { store } = setup((phase) => {
      if (interrupted && phase === "resource-staged") throw new Error("batch write interrupted");
    });
    const input = batch([
      { operation: "createBead", id: "one", type },
      { operation: "createBead", id: "two", type },
    ]);
    expect(() => store.batch("p", input)).toThrow("batch write interrupted");
    expect(store.read(scope + "one")).toBeUndefined();
    expect(store.read(scope + "two")).toBeUndefined();
    interrupted = false;
    expect(store.batch("p", input).status).toBe(200);
    expect(
      code(store.create("p", prepareCreate(scope, JSON.stringify({ type }), "batch-key"))),
    ).toBe("idempotency-conflict");
  });
  it("commits allocation-only identity consumption and permanent failure without a partial prefix", () => {
    const { store, config } = setup();
    const allocation = store.batch(
      "p",
      batch([
        { operation: "createBead", id: "consumed", type, name: "n" },
        { operation: "deleteBead", bead: "@n" },
      ]),
    );
    expect(JSON.parse(allocation.text).resources[0]).toEqual({
      id: scope + "consumed",
      resourceKind: "bead",
      outcome: "allocated",
      changed: true,
    });
    const failure = batch(
      [
        { operation: "createBead", id: "free", type },
        { operation: "deleteBead", bead: "missing" },
      ],
      "failed",
    );
    const refused = store.batch("p", failure);
    expect(refused.status).toBe(404);
    expect(store.read(scope + "free")).toBeUndefined();
    expect(
      store.create("p", prepareCreate(scope, JSON.stringify({ id: "free", type }), "reuse-free"))
        .status,
    ).toBe(200);
    expect(
      store.create(
        "p",
        prepareCreate(scope, JSON.stringify({ id: "missing", type }), "later-missing"),
      ).status,
    ).toBe(200);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.batch("p", failure)).toEqual(refused);
    expect(
      code(
        reopened.create(
          "p",
          prepareCreate(scope, JSON.stringify({ id: "consumed", type }), "reuse-consumed"),
        ),
      ),
    ).toBe("identity-taken");
  });
  it.each(["bead-subject", "link-endpoint"])(
    "retains failed pre-creation alias %s comparisons across later direct slots and reopen",
    (mode) => {
      const { store, config } = setup();
      const first =
        mode === "bead-subject"
          ? { operation: "updateBead", bead: "aliases/new", properties: {} }
          : {
              operation: "createLink",
              id: "must-not-allocate",
              type,
              source: "aliases/new",
              target: "urn:external:target",
            };
      const later =
        mode === "bead-subject"
          ? { operation: "updateBead", bead: "aliases/new", properties: { staged: true } }
          : {
              operation: "createLink",
              id: "later-link",
              type,
              source: "aliases/new",
              target: "urn:external:target",
            };
      const input = batch([first, { operation: "createBead", id: "aliases/new", type }, later]);
      const failure = store.batch("p", input);
      expect(failure.status).toBe(404);
      expect(code(failure)).toBe("resource-not-found");
      expect(store.read(scope + "aliases/new")).toBeUndefined();
      expect(store.read(scope + "must-not-allocate")).toBeUndefined();
      expect(store.batch("p", input)).toEqual(failure);
      // A later committed identity cannot reinterpret either the recorded miss or
      // the same request's later explicit-creation comparison slots.
      expect(
        store.create(
          "p",
          prepareCreate(scope, JSON.stringify({ id: "aliases/new", type }), "later"),
        ).status,
      ).toBe(200);
      store.close();
      const reopened = openPrivateRetainedStore({ ...config, create: false });
      cleanups.push(() => reopened.close());
      expect(reopened.batch("p", input)).toEqual(failure);
      expect(JSON.parse(reopened.read(scope + "aliases/new")!).properties).toEqual({});
      expect(reopened.read(scope + "must-not-allocate")).toBeUndefined();
      expect(reopened.read(scope + "later-link")).toBeUndefined();
      const changed = batch([
        first,
        { operation: "createBead", id: "aliases/new", type },
        { ...later, properties: { changed: true } },
      ]);
      expect(code(reopened.batch("p", changed))).toBe("idempotency-conflict");
    },
  );
  it("uses preceding explicit canonical creation IDs inside the alias namespace", () => {
    const { store } = setup();
    const outcome = store.batch(
      "p",
      batch([
        { operation: "createBead", id: "aliases/new-node", type },
        { operation: "updateBead", bead: "aliases/new-node", properties: { staged: true } },
      ]),
    );
    expect(outcome.status).toBe(200);
    expect(JSON.parse(outcome.text).resources[0].resource.properties).toEqual({ staged: true });
  });
  it("retains original alias witnesses through a mixed singleton/batch/alias history", () => {
    const { store, config } = setup();
    for (const id of ["a", "b"])
      expect(
        store.create("p", prepareCreate(scope, JSON.stringify({ id, type }), "seed-" + id)).status,
      ).toBe(200);
    expect(
      store.putAlias(
        "p",
        prepareAlias(
          scope,
          "putAlias",
          JSON.stringify({ alias: "aliases/latest", target: "a" }),
          "name-a",
        ),
      ).status,
    ).toBe(200);
    const input = batch([
      { operation: "updateBead", bead: "aliases/latest", properties: { captured: true } },
    ]);
    const first = store.batch("p", input);
    expect(first.status).toBe(200);
    expect(
      store.putAlias(
        "p",
        prepareAlias(
          scope,
          "putAlias",
          JSON.stringify({ alias: "aliases/latest", target: "b" }),
          "name-b",
        ),
      ).status,
    ).toBe(200);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.batch("p", input)).toEqual(first);
    expect(JSON.parse(reopened.read(scope + "b")!).properties).toEqual({});
  });
  it("uses no fact positions for no-op decisions or allocation-only consumption", () => {
    const { store, config } = setup();
    const created = JSON.parse(
      store.create("p", prepareCreate(scope, JSON.stringify({ id: "live", type }), "seed")).text,
    ).resource;
    const noop = store.batch(
      "p",
      batch(
        [
          {
            operation: "updateBead",
            bead: "live",
            properties: {},
            expectedRevision: created.revision,
          },
        ],
        "noop",
      ),
    );
    expect(JSON.parse(noop.text).changed).toBe(false);
    const allocated = store.batch(
      "p",
      batch(
        [
          { operation: "createBead", id: "consumed", type, name: "n" },
          { operation: "deleteBead", bead: "@n" },
        ],
        "allocated",
      ),
    );
    expect(JSON.parse(allocated.text).changed).toBe(true);
    store.close();
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      expect(
        db.prepare("SELECT decision,event_position FROM outcomes ORDER BY decision").all(),
      ).toEqual([
        { decision: 1, event_position: 1 },
        { decision: 2, event_position: null },
        { decision: 3, event_position: null },
      ]);
      expect(db.prepare("SELECT count(*) AS n FROM events").get()!.n).toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM decision_facts").get()!.n).toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM identities").get()!.n).toBe(2);
      expect(db.prepare("SELECT count(*) AS n FROM resources").get()!.n).toBe(1);
    } finally {
      db.close();
    }
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(
      reopened.batch(
        "p",
        batch(
          [
            { operation: "createBead", id: "consumed", type, name: "n" },
            { operation: "deleteBead", bead: "@n" },
          ],
          "allocated",
        ),
      ),
    ).toEqual(allocated);
  });
  it("replays the full result at maximumOperations byte-identically after reopen", () => {
    const { store, config } = setup();
    const input = batch(
      Array.from({ length: 32 }, (_, i) => ({ operation: "createBead", id: `bound-${i}`, type })),
      "at-bound",
    );
    const first = store.batch("p", input);
    expect(first.status).toBe(200);
    expect(JSON.parse(first.text).resources).toHaveLength(32);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    expect(reopened.batch("p", input)).toEqual(first);
  });
  it("refuses an orphan allocation left by a supposedly rolled-back decision", () => {
    const { store, config } = setup((phase) => {
      if (phase === "resource-staged") throw new Error("rollback control");
    });
    const input = batch([{ operation: "createBead", id: "rolled-back", type }]);
    expect(() => store.batch("p", input)).toThrow("rollback control");
    store.close();
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      db.prepare("INSERT INTO identities VALUES (?,?)").run(scope + "rolled-back", "bead");
    } finally {
      db.close();
    }
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
  });
  it("refuses in-set swaps of explicit create mappings despite intact final rows and facts", () => {
    const { store, config } = setup();
    const input = batch([
      { operation: "createBead", id: "first", type, name: "a" },
      { operation: "createBead", id: "second", type, name: "b" },
    ]);
    expect(store.batch("p", input).status).toBe(200);
    store.close();
    const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
    try {
      db.function("retained_json", { deterministic: true }, (_value) => 1);
      const result = JSON.parse(
        String(db.prepare("SELECT body FROM outcomes WHERE operation='batch'").get()!.body),
      );
      [result.results[0].id, result.results[1].id] = [result.results[1].id, result.results[0].id];
      db.prepare("UPDATE outcomes SET body=? WHERE operation='batch'").run(JSON.stringify(result));
    } finally {
      db.close();
    }
    expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
  });
  it.each(["handles", "direct", "aliases"])(
    "binds recovered %s subjects to their original creator or comparison",
    (mode) => {
      const { store, config } = setup();
      let operations: unknown[];
      let indexes: [number, number] = [0, 1];
      if (mode === "handles") {
        operations = [
          { operation: "createBead", type, name: "a" },
          { operation: "createBead", type, name: "b" },
          { operation: "updateBead", bead: "@a", metadata: {} },
          { operation: "updateBead", bead: "@b", metadata: {} },
        ];
        indexes = [2, 3];
      } else {
        for (const id of ["first", "second"]) {
          expect(
            store.create("p", prepareCreate(scope, JSON.stringify({ id, type }), "seed-" + id))
              .status,
          ).toBe(200);
          if (mode === "aliases")
            expect(
              store.putAlias(
                "p",
                prepareAlias(
                  scope,
                  "putAlias",
                  JSON.stringify({ alias: "aliases/" + id, target: id }),
                  "alias-" + id,
                ),
              ).status,
            ).toBe(200);
        }
        operations = ["first", "second"].map((id) => ({
          operation: "updateBead",
          bead: (mode === "aliases" ? "aliases/" : "") + id,
          metadata: {},
        }));
      }
      const input = batch(operations);
      const first = store.batch("p", input);
      expect(first.status).toBe(200);
      store.close();
      const valid = openPrivateRetainedStore({ ...config, create: false });
      try {
        expect(valid.batch("p", input)).toEqual(first);
      } finally {
        valid.close();
      }
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
      try {
        db.function("retained_json", { deterministic: true }, (_value) => 1);
        const result = JSON.parse(
          String(db.prepare("SELECT body FROM outcomes WHERE operation='batch'").get()!.body),
        );
        const [a, b] = indexes;
        [result.results[a].id, result.results[b].id] = [result.results[b].id, result.results[a].id];
        db.prepare("UPDATE outcomes SET body=? WHERE operation='batch'").run(
          JSON.stringify(result),
        );
      } finally {
        db.close();
      }
      expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    },
  );
  it("keeps generated IDs stable across reopen and alpha-renamed creation handles", () => {
    const { store, config } = setup();
    const request = (name: string) =>
      batch([
        { operation: "createBead", type, name },
        { operation: "updateBead", bead: "@" + name, properties: { final: true } },
      ]);
    const first = store.batch("p", request("original"));
    expect(first.status).toBe(200);
    store.close();
    const reopened = openPrivateRetainedStore({ ...config, create: false });
    cleanups.push(() => reopened.close());
    const saved = JSON.parse(first.text);
    const replay = JSON.parse(reopened.batch("p", request("renamed")).text);
    expect(replay).toEqual({
      ...saved,
      results: saved.results.map((entry: Record<string, unknown>, index: number) =>
        index === 0 ? { ...entry, operationName: "renamed" } : entry,
      ),
    });
  });
  it.each(["facts", "allocation-only"])(
    "refuses reused transaction correlation across %s decisions",
    (mode) => {
      const { store, config } = setup();
      for (const id of ["first", "second"]) {
        const operations: unknown[] = [{ operation: "createBead", id, type, name: "new" }];
        if (mode === "allocation-only") operations.push({ operation: "deleteBead", bead: "@new" });
        expect(store.batch("p", batch(operations, id)).status).toBe(200);
      }
      store.close();
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"));
      try {
        db.function("retained_json", { deterministic: true }, (_value) => 1);
        const outcomes = db.prepare("SELECT decision,body FROM outcomes ORDER BY decision").all();
        const transaction = JSON.parse(String(outcomes[0]!.body)).transaction;
        const result = JSON.parse(String(outcomes[1]!.body));
        result.transaction = transaction;
        db.prepare("UPDATE outcomes SET body=? WHERE decision=?").run(
          JSON.stringify(result),
          Number(outcomes[1]!.decision),
        );
        for (const event of db
          .prepare(
            "SELECT position,body FROM events WHERE position IN (SELECT position FROM decision_facts WHERE decision=?)",
          )
          .all(Number(outcomes[1]!.decision))) {
          const fact = JSON.parse(String(event.body));
          fact.transaction = transaction;
          db.prepare("UPDATE events SET body=? WHERE position=?").run(
            JSON.stringify(fact),
            Number(event.position),
          );
        }
      } finally {
        db.close();
      }
      expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    },
  );
  it.each(["membership", "allocation", "mapping"])(
    "refuses corrupted %s closure on reopen",
    (fault) => {
      const { store, config } = setup();
      store.batch(
        "p",
        batch([
          { operation: "createBead", id: "one", type },
          { operation: "createBead", id: "allocated", type, name: "n" },
          { operation: "deleteBead", bead: "@n" },
        ]),
      );
      store.close();
      const db = new DatabaseSync(path.join(config.directory, "retained-reference.sqlite"), {
        enableForeignKeyConstraints: false,
      });
      try {
        db.function("retained_json", { deterministic: true }, (_value) => 1);
        if (fault === "membership") db.exec("DELETE FROM decision_facts");
        else if (fault === "allocation")
          db.prepare("DELETE FROM identities WHERE id=?").run(scope + "allocated");
        else {
          const result = JSON.parse(
            String(db.prepare("SELECT body FROM outcomes WHERE operation='batch'").get()!.body),
          );
          result.results[0].id = scope + "foreign-mapping";
          db.prepare("UPDATE outcomes SET body=? WHERE operation='batch'").run(
            JSON.stringify(result),
          );
        }
      } finally {
        db.close();
      }
      expect(() => openPrivateRetainedStore({ ...config, create: false })).toThrow();
    },
  );
});
