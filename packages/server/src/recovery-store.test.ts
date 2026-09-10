import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openRecoveryStore,
  type MemberDecision,
  type MemberTransaction,
  type RecoveryStore,
  type StoreReader,
} from "./recovery-store.js";

const day = 86_400_000;
const scope = "https://example.test/scope/";
const roots: string[] = [];
const stores: RecoveryStore[] = [];
const children = new Set<ChildProcess>();
const options = (directory: string) => ({
  directory,
  scope,
  installationId: "installed-v1",
  lineageId: "logical-store-v1",
});
function directory(): string {
  const result = mkdtempSync(path.join(tmpdir(), "bdp-s6-"));
  roots.push(result);
  return result;
}
function open(dir: string, create = false): RecoveryStore {
  const store = openRecoveryStore({ ...options(dir), ...(create ? { create: {} } : {}) });
  stores.push(store);
  return store;
}
function outcome(
  effect: "success" | "failure" = "success",
  extra: Partial<Extract<MemberDecision, { kind: "retain" }>> = {},
): Extract<MemberDecision, { kind: "retain" }> {
  return {
    kind: "retain",
    semanticIdentityJson: '{"operation":"createBead","properties":{"number":1.0}}',
    resolutionsJson:
      '{"creator":{"id":"beads/a","kind":"bead"},"aliases":{"alias/latest":"beads/a"}}',
    outcomeJson: '{"result":{"id":"beads/a","revision":"r1","sourceRevision":"s1"}}',
    effect,
    completedAt: 100,
    retainUntil: 100 + day,
    ...extra,
  };
}
function effect(
  store: RecoveryStore,
  key = "key",
  callback: (tx: MemberTransaction) => void = () => {},
): void {
  const admission = store.admit("alice", [key]);
  store.executeMember(admission, key, (tx) => {
    callback(tx);
    return outcome();
  });
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
  }
  children.clear();
  for (const store of stores.splice(0)) store.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("durable reference ownership and transaction interface", () => {
  it("asserts pinned runtime, takes real exclusive ownership, and releases only on close", () => {
    expect(process.version).toBe("v24.16.0");
    const dir = directory();
    const first = open(dir, true);
    expect(first.runtime).toMatchObject({
      node: "v24.16.0",
      executable: process.execPath,
      journalMode: "delete",
      lockingMode: "exclusive",
      synchronous: 3,
      recoveredClaims: 0,
    });
    expect(first.runtime.sqlite).toMatch(/^\d+\.\d+/);
    console.info("S6 runtime", first.runtime);
    expect(() => openRecoveryStore(options(dir))).toThrow("locked");
    first.close();
    expect(open(dir).runtime.recoveredClaims).toBe(0);
  });
  it("claims all unknown keys atomically after carrier validation and isolates principal/owner", () => {
    const store = open(directory(), true);
    const first = store.admit("alice", ["occupied"]);
    expect(() =>
      store.admit("alice", ["new", "occupied"], (states) => {
        expect(states[1]).toMatchObject({ kind: "claimed", attemptId: first.attemptId });
        throw new Error("refused carrier");
      }),
    ).toThrow("refused carrier");
    expect(store.read((tx) => tx.key("alice", "new"))).toEqual({ kind: "unknown" });
    expect(() => store.admit("alice", ["new", "new"])).toThrow("unique");
    const second = store.admit("alice", ["new", "occupied"]);
    expect(store.abandonAttempt(second)).toBe(1);
    expect(store.read((tx) => tx.key("alice", "occupied"))).toMatchObject({
      attemptId: first.attemptId,
    });
    const other = store.admit("bob", ["occupied"]);
    expect(other.attemptId).not.toBe(first.attemptId);
    expect(
      store.executeMember(second, "occupied", () => {
        throw new Error("must not execute another owner");
      }),
    ).toMatchObject({ kind: "existing", state: { kind: "claimed" } });
  });
  it("commits Resources, source version, policy and disposition together, preserving exact JSON text", () => {
    const dir = directory();
    const store = open(dir, true);
    const admission = store.admit("alice", ["key"]);
    const completion = store.executeMember(admission, "key", (tx) => {
      tx.putResource({
        id: "beads/source",
        kind: "bead",
        bodyJson: '{"revision":"source-r2","properties":{"n":1.0}}',
      });
      tx.putResource({
        id: "links/edge",
        kind: "link",
        source: "beads/source",
        target: "urn:external",
        bodyJson: '{"revision":"link-r1"}',
      });
      tx.putPolicy("visibility", '{"allow":"alice"}');
      return outcome();
    });
    expect(completion).toEqual({ kind: "completed", outcomeJson: outcome().outcomeJson });
    store.close();
    const recovered = open(dir);
    expect(recovered.read((tx) => tx.resource("beads/source")?.bodyJson)).toBe(
      '{"revision":"source-r2","properties":{"n":1.0}}',
    );
    expect(recovered.read((tx) => tx.incidentLinks("beads/source"))).toHaveLength(1);
    expect(recovered.read((tx) => tx.policy("visibility"))).toBe('{"allow":"alice"}');
    expect(recovered.read((tx) => tx.key("alice", "key"))).toMatchObject({
      kind: "retained",
      semanticIdentityJson: outcome().semanticIdentityJson,
      outcomeJson: outcome().outcomeJson,
    });
    expect(
      recovered.executeMember(recovered.admit("alice", ["key"]), "key", () => {
        throw new Error("must not replay effects");
      }),
    ).toMatchObject({ kind: "existing", state: { kind: "retained" } });
  });
  it.each(["failure", "release", "throw"] as const)(
    "rolls back staged graph changes on %s",
    (mode) => {
      const store = open(directory(), true);
      const admission = store.admit("alice", ["key"]);
      const attempt = () =>
        store.executeMember(admission, "key", (tx) => {
          tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
          tx.allocateRevision();
          if (mode === "throw") throw new Error("evaluator fault");
          return mode === "release" ? { kind: "release" } : outcome("failure");
        });
      if (mode === "throw") expect(attempt).toThrow("evaluator fault");
      else attempt();
      expect(store.read((tx) => tx.resources())).toEqual([]);
      expect(store.read((tx) => tx.identityWasCommitted("beads/a"))).toBe(false);
      expect(store.read((tx) => tx.key("alice", "key"))).toMatchObject({
        kind: mode === "failure" ? "retained" : mode === "release" ? "unknown" : "claimed",
      });
      if (mode === "throw") expect(store.abandonAttempt(admission)).toBe(1);
    },
  );
  it("rejects async and escaped facades, rolls back, and keeps synchronous reads read-only", async () => {
    const store = open(directory(), true);
    const admission = store.admit("alice", ["key"]);
    let escaped: MemberTransaction | undefined;
    expect(() =>
      store.executeMember(admission, "key", (async (tx: MemberTransaction) => {
        escaped = tx;
        tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
        await Promise.resolve();
        return outcome();
      }) as unknown as (tx: MemberTransaction) => MemberDecision),
    ).toThrow("synchronous");
    await Promise.resolve();
    expect(() => escaped?.putPolicy("bad", "{}")).toThrow("expired");
    expect(store.read((tx) => tx.resources())).toEqual([]);
    let read: StoreReader | undefined;
    store.read((tx) => {
      read = tx;
      expect("putResource" in tx).toBe(false);
    });
    expect(() => read?.resources()).toThrow("expired");
    expect(() => store.read(() => store.admit("alice", ["nested"]))).toThrow("nested");
    expect(() => store.admit("alice", ["async"], (async () => {}) as () => void)).toThrow(
      "synchronous",
    );
    expect(store.read((tx) => tx.key("alice", "async"))).toEqual({ kind: "unknown" });
  });
  it("preserves successful/no-op tombstones and resolutions, forgets expired failures, and reclaims at turn", () => {
    const dir = directory();
    const store = open(dir, true);
    effect(store, "no-op");
    const failed = store.admit("alice", ["failed"]);
    store.executeMember(failed, "failed", () => outcome("failure"));
    const waiting = store.admit("alice", ["failed"]);
    store.expire(99 + day);
    expect(store.read((tx) => tx.key("alice", "no-op"))).toMatchObject({ kind: "retained" });
    store.expire(0);
    expect(store.read((tx) => tx.key("alice", "no-op"))).toMatchObject({ kind: "retained" });
    store.expire(100 + day);
    expect(store.read((tx) => tx.key("alice", "failed"))).toEqual({ kind: "unknown" });
    expect(store.executeMember(waiting, "failed", () => outcome())).toMatchObject({
      kind: "completed",
    });
    store.close();
    const next = open(dir);
    expect(next.read((tx) => tx.key("alice", "no-op"))).toMatchObject({
      kind: "expired",
      resolutionsJson: outcome().resolutionsJson,
    });
    expect(next.read((tx) => tx.key("alice", "no-op"))).not.toHaveProperty("outcomeJson");
    expect(next.read((tx) => tx.key("alice", "no-op"))).not.toHaveProperty("semanticIdentityJson");
    expect(() =>
      next.executeMember(next.admit("alice", ["short"]), "short", () =>
        outcome("success", { retainUntil: 200 }),
      ),
    ).toThrow("retention");
  });
  it("reserves deleted identities and alias paths without changing Link/alias coexistence", () => {
    const store = open(directory(), true);
    effect(store, "seed", (tx) => {
      tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
      tx.putAlias("latest", "beads/a");
      tx.putResource({
        id: "links/latest",
        kind: "link",
        source: "beads/a",
        target: "urn:x",
        bodyJson: "{}",
      });
    });
    const bad = store.admit("alice", ["bad"]);
    expect(() =>
      store.executeMember(bad, "bad", (tx) => {
        tx.putResource({ id: "beads/latest", kind: "bead", bodyJson: "{}" });
        return outcome();
      }),
    ).toThrow("live alias");
    effect(store, "delete", (tx) => {
      tx.deleteResource("links/latest");
      tx.deleteResource("beads/a");
    });
    expect(store.read((tx) => tx.alias("latest"))).toBe("beads/a"); // Deleting a Bead invents no alias cascade/refusal.
    expect(store.read((tx) => tx.identityWasCommitted("beads/a"))).toBe(true);
    expect(() =>
      store.executeMember(store.admit("alice", ["reuse"]), "reuse", (tx) => {
        tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
        return outcome();
      }),
    ).toThrow("cannot be reused");
  });
  it("allocates revisions without Number precision loss across reopen", () => {
    const dir = directory();
    let store = open(dir, true);
    store.close();
    const db = new DatabaseSync(path.join(dir, "reference.sqlite"));
    db.prepare("UPDATE metadata SET value=? WHERE name='nextRevision'").run("9007199254740992");
    db.close();
    store = open(dir);
    const revisions: string[] = [];
    effect(store, "one", (tx) => {
      revisions.push(tx.allocateRevision(), tx.allocateRevision());
    });
    store.close();
    store = open(dir);
    effect(store, "two", (tx) => {
      revisions.push(tx.allocateRevision());
    });
    expect(new Set(revisions).size).toBe(3);
    store.close();
    const inspect = new DatabaseSync(path.join(dir, "reference.sqlite"), { readOnly: true });
    expect(
      inspect.prepare("SELECT value FROM metadata WHERE name='nextRevision'").get()?.value,
    ).toBe("9007199254740995");
    inspect.close();
  });
  it("refuses missing/incomplete stores and incompatible Scope, installation or lineage without reseeding", () => {
    const dir = directory();
    expect(() => open(dir)).toThrow("missing");
    const store = open(dir, true);
    store.close();
    expect(() => openRecoveryStore({ ...options(dir), create: {} })).toThrow();
    for (const patch of [
      { scope: "https://example.test/other/" },
      { installationId: "different" },
      { lineageId: "different" },
    ])
      expect(() => openRecoveryStore({ ...options(dir), ...patch })).toThrow("mismatch");
    const broken = directory();
    writeFileSync(path.join(broken, "reference.sqlite"), "");
    expect(() => open(broken)).toThrow();
    expect(readFileSync(path.join(broken, "reference.sqlite")).length).toBe(0);
  });
  it.each(["before", "after"] as const)(
    "fences on an injected %s-COMMIT error and recovers the actual durable state",
    (phase) => {
      const dir = directory();
      const store = open(dir, true);
      const admission = store.admit("alice", ["key"]);
      const actual = DatabaseSync.prototype.exec;
      let armed = true;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (armed && sql === "COMMIT") {
          armed = false;
          if (phase === "after") actual.call(this, sql);
          throw Object.assign(new Error("injected I/O failure at commit"), {
            code: "ERR_SQLITE_ERROR",
          });
        }
        actual.call(this, sql);
      });
      expect(() =>
        store.executeMember(admission, "key", (tx) => {
          tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
          return outcome();
        }),
      ).toThrow("injected I/O");
      spy.mockRestore();
      expect(() => store.admit("alice", ["retry"])).toThrow("fenced");
      store.close();
      const recovered = open(dir);
      expect(recovered.read((tx) => tx.resource("beads/a")) === undefined).toBe(phase === "before");
      expect(recovered.read((tx) => tx.key("alice", "key"))).toMatchObject({
        kind: phase === "before" ? "unknown" : "retained",
      });
    },
  );
});

const moduleUrl = new URL("./recovery-store.ts", import.meta.url).href;
const childProgram = `
import {openRecoveryStore} from ${JSON.stringify(moduleUrl)};
import {DatabaseSync} from "node:sqlite";
const [directory,mode]=process.argv.slice(1);
if(process.version!=="v24.16.0")throw new Error("wrong interpreter");
const store=openRecoveryStore({directory,scope:${JSON.stringify(scope)},installationId:"installed-v1",lineageId:"logical-store-v1"});
const send=value=>process.stdout.write(JSON.stringify(value)+"\\n");
const stop=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
send({ready:store.runtime});
if(mode==="owner")stop();
const admission=store.admit("alice",["first","tail"]);
if(mode==="claims"){send({barrier:"claims"});stop();}
if(mode==="staged"){
 const original=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){
  if(sql==="COMMIT"){
   send({barrier:"staged",stagedKeyState:this.prepare("SELECT state FROM key_state WHERE key='first'").get().state,stagedResources:this.prepare("SELECT count(*) AS n FROM resources").get().n});stop();
  }
  return original.call(this,sql);
 };
}
store.executeMember(admission,"first",tx=>{
 const revision=tx.allocateRevision();
 tx.putResource({id:"beads/a",kind:"bead",bodyJson:JSON.stringify({revision})});
 const decision={kind:"retain",effect:"success",semanticIdentityJson:'{"operation":"createBead"}',resolutionsJson:'{"creator":"beads/a"}',outcomeJson:JSON.stringify({id:"beads/a",revision}),completedAt:100,retainUntil:86400100};
 return decision;
});
send({barrier:"committed",state:store.read(tx=>tx.key("alice","first"))});stop();
`;
async function startChild(
  dir: string,
  mode: string,
): Promise<{
  child: ChildProcess;
  messages: Record<string, unknown>[];
  wait: (field: string) => Promise<Record<string, unknown>>;
}> {
  expect(process.version).toBe("v24.16.0");
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childProgram, dir, mode],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  const messages: Record<string, unknown>[] = [];
  let buffer = "",
    stderr = "";
  child.stdout?.on("data", (data) => {
    buffer += String(data);
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      messages.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  child.stderr?.on("data", (data) => {
    stderr += String(data);
  });
  const wait = async (field: string) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const value = messages.find((message) => field in message);
      if (value) return value;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`child exited: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`child barrier ${field} timed out: ${stderr}`);
  };
  await wait("ready");
  return { child, messages, wait };
}
async function kill(child: ChildProcess): Promise<void> {
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  children.delete(child);
}

describe("allocation and recovery integrity", () => {
  it("guards admission identity and mints local IDs without reusing committed IDs or alias paths", () => {
    const dir = directory();
    const store = open(dir, true);
    const admission = store.admit("alice", ["seed"]);
    expect(() => store.executeMember({ ...admission }, "seed", () => outcome())).toThrow(
      "not owned",
    );
    let allocated = "";
    store.executeMember(admission, "seed", (tx) => {
      allocated = tx.allocateResourceId("bead");
      expect(allocated).toMatch(/^beads\/[a-f0-9]{64}$/);
      expect(tx.identityWasCommitted(allocated)).toBe(false);
      tx.putResource({ id: allocated, kind: "bead", bodyJson: "{}" });
      expect(tx.identityWasCommitted(allocated)).toBe(true);
      tx.putResource({
        id: tx.allocateResourceId("link"),
        kind: "link",
        source: allocated,
        target: "urn:x",
        bodyJson: "{}",
      });
      expect(tx.outgoingLinks(allocated)).toHaveLength(1);
      return outcome();
    });
    store.close();
    const raw = new DatabaseSync(path.join(dir, "reference.sqlite"));
    raw.prepare("UPDATE metadata SET value='0' WHERE name='nextIdentity'").run();
    raw.close();
    const again = open(dir);
    effect(again, "second", (tx) => {
      expect(tx.allocateResourceId("bead")).not.toBe(allocated);
    });
  });
  it("refuses incomplete table state before readiness", () => {
    const dir = directory();
    open(dir, true).close();
    const raw = new DatabaseSync(path.join(dir, "reference.sqlite"));
    raw.exec("DROP TABLE installed_types");
    raw.close();
    expect(() => open(dir)).toThrow("incomplete");
  });
  it("keeps the stored retention promise when later configuration lowers the default", () => {
    const dir = directory();
    const first = openRecoveryStore({ ...options(dir), create: {}, minimumRetentionMs: 2 * day });
    stores.push(first);
    first.executeMember(first.admit("alice", ["long"]), "long", () =>
      outcome("success", { retainUntil: 100 + 2 * day }),
    );
    first.close();
    const next = open(dir);
    next.expire(100 + day);
    expect(next.read((tx) => tx.key("alice", "long"))).toMatchObject({ kind: "retained" });
    next.expire(100 + 2 * day);
    expect(next.read((tx) => tx.key("alice", "long"))).toMatchObject({ kind: "expired" });
  });
});

describe("actual Node24 child-process crashes", () => {
  it.each(["claims", "staged", "committed"])(
    "recovers %s barrier without resuming the tail",
    async (mode) => {
      const dir = directory();
      open(dir, true).close();
      const { child, wait } = await startChild(dir, mode);
      const barrier = await wait("barrier");
      expect(barrier.barrier).toBe(mode);
      if (mode === "staged")
        expect(barrier).toMatchObject({ stagedKeyState: "retained", stagedResources: 1 });
      await kill(child);
      const store = open(dir);
      expect(store.runtime.recoveredClaims).toBe(mode === "committed" ? 1 : 2);
      expect(store.read((tx) => tx.key("alice", "tail"))).toEqual({ kind: "unknown" });
      expect(store.read((tx) => tx.resource("beads/tail"))).toBeUndefined();
      const before = store.read((tx) => tx.resource("beads/a"));
      expect(before !== undefined).toBe(mode === "committed");
      if (mode === "committed")
        expect(store.read((tx) => tx.key("alice", "first"))).toEqual(barrier.state);
      const retry = store.admit("alice", ["first", "tail"]);
      let executions = 0;
      const result = store.executeMember(retry, "first", (tx) => {
        executions++;
        tx.putResource({ id: "beads/a", kind: "bead", bodyJson: '{"revision":"explicit-retry"}' });
        return outcome();
      });
      expect(executions).toBe(mode === "committed" ? 0 : 1);
      expect(result.kind).toBe(mode === "committed" ? "existing" : "completed");
      store.executeMember(retry, "tail", (tx) => {
        tx.putResource({ id: "beads/tail", kind: "bead", bodyJson: "{}" });
        return outcome();
      });
      expect(store.read((tx) => tx.resources())).toHaveLength(2);
    },
  );
  it("refuses a second process owner and acquires after SIGKILL without PID heuristics", async () => {
    const dir = directory();
    open(dir, true).close();
    const { child, wait } = await startChild(dir, "owner");
    const ready = await wait("ready");
    expect(ready.ready).toMatchObject({
      node: "v24.16.0",
      executable: process.execPath,
      lockingMode: "exclusive",
    });
    expect(() => openRecoveryStore(options(dir))).toThrow("locked");
    await kill(child);
    expect(open(dir).runtime.recoveredClaims).toBe(0);
  });
});
