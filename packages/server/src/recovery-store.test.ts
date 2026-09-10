import { decodeJsonDocument } from "@bdp/protocol";
import { encodeSemanticValue } from "./semantic-identity.js";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statfsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isKnownNetworkFilesystem,
  openRecoveryStore,
  RecoveryStoreError,
  recoveryIdentityFingerprint,
  type StoredResource,
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
  it("rejects invalid Resource shapes before SQL and keeps the handle usable", () => {
    const store = open(directory(), true);
    // @ts-expect-error Link endpoints are required by the storage facade.
    const missing: StoredResource = { id: "links/x", kind: "link", bodyJson: "{}" };
    // @ts-expect-error Beads cannot carry Link endpoint indexes.
    const bead: StoredResource = { id: "beads/x", kind: "bead", bodyJson: "{}", source: "beads/y" };
    for (const resource of [missing, bead]) {
      const admission = store.admit("alice", [resource.id]);
      expect(() =>
        store.executeMember(admission, resource.id, (tx) => {
          tx.putResource(resource);
          return outcome();
        }),
      ).toThrow(expect.objectContaining({ reason: "invalid-input" }));
      expect(store.read((tx) => tx.resource(resource.id))).toBeUndefined();
      expect(store.abandonAttempt(admission)).toBe(1);
    }
    effect(store, "valid", (tx) =>
      tx.putResource({ id: "beads/valid", kind: "bead", bodyJson: "{}" }),
    );
    expect(store.read((tx) => tx.resource("beads/valid"))).toBeDefined();
  });
  it("rolls back an actual mid-callback SQLite constraint without fencing", () => {
    const store = open(directory(), true);
    const admission = store.admit("alice", ["key"]);
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql.startsWith("INSERT INTO policy")) {
        // Real SQLite CHECK failure, raised in the member callback after a graph write.
        this.exec("INSERT INTO resources VALUES ('links/invalid','link','{}',NULL,NULL)");
      }
      return original.call(this, sql);
    });
    let failure: unknown;
    try {
      store.executeMember(admission, "key", (tx) => {
        tx.putResource({ id: "beads/staged", kind: "bead", bodyJson: "{}" });
        tx.putPolicy("trigger", "{}");
        return outcome();
      });
    } catch (error) {
      failure = error;
    }
    spy.mockRestore();
    expect(failure).toBeInstanceOf(RecoveryStoreError);
    expect(failure).toMatchObject({
      reason: "constraint",
      cause: { code: "ERR_SQLITE_ERROR", errcode: 275 },
    });
    expect(store.read((tx) => tx.resource("beads/staged"))).toBeUndefined();
    expect(store.read((tx) => tx.identityWasCommitted("beads/staged"))).toBe(false);
    expect(store.read((tx) => tx.key("alice", "key"))).toMatchObject({ kind: "claimed" });
    expect(store.executeMember(admission, "key", () => outcome("failure"))).toMatchObject({
      kind: "completed",
    });
  });
  it.each(["sqlite-error", "rollback-error"])("keeps uncertain %s failures fenced", (mode) => {
    const store = open(directory(), true);
    const admission = store.admit("alice", ["key"]);
    const original = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (mode === "rollback-error" && sql === "ROLLBACK") throw new Error("rollback failed");
      return original.call(this, sql);
    });
    expect(() =>
      store.executeMember(admission, "key", () => {
        throw Object.assign(new Error("injected SQLite I/O"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 10,
        });
      }),
    ).toThrow(expect.objectContaining({ reason: "fenced" }));
    spy.mockRestore();
    expect(() => store.read(() => undefined)).toThrow(
      expect.objectContaining({ reason: "fenced" }),
    );
  });
  it("cleans only its own safely rolled-back failed creation", () => {
    const dir = directory();
    const filename = path.join(dir, "reference.sqlite");
    expect(() =>
      openRecoveryStore({
        ...options(dir),
        create: { resources: [{ id: "beads/invalid", kind: "bead", bodyJson: "not JSON" }] },
      }),
    ).toThrow();
    expect(existsSync(filename)).toBe(false);
    const store = open(dir, true);
    effect(store, "seed", (tx) => tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" }));
    store.close();
    const bytes = readFileSync(filename);
    expect(() => openRecoveryStore({ ...options(dir), create: {} })).toThrow();
    expect(readFileSync(filename)).toEqual(bytes);
    expect(open(dir).read((tx) => tx.resource("beads/a"))).toBeDefined();
  });
  it.each(["before", "after"])(
    "preserves failed creation after an uncertain %s-COMMIT error",
    (phase) => {
      const dir = directory();
      const original = DatabaseSync.prototype.exec;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql: string,
      ) {
        if (sql === "COMMIT") {
          if (phase === "after") original.call(this, sql);
          throw new Error("uncertain startup commit");
        }
        return original.call(this, sql);
      });
      expect(() => open(dir, true)).toThrow("uncertain startup commit");
      spy.mockRestore();
      expect(existsSync(path.join(dir, "reference.sqlite"))).toBe(true);
      if (phase === "after") expect(open(dir).runtime.recoveredClaims).toBe(0);
    },
  );
  it.each(["rollback", "close"])(
    "preserves a failed creation if %s cannot be confirmed",
    (phase) => {
      const dir = directory();
      const original = DatabaseSync.prototype[phase === "rollback" ? "exec" : "close"];
      const handles: DatabaseSync[] = [];
      const spy =
        phase === "rollback"
          ? vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
              this: DatabaseSync,
              sql: string,
            ) {
              if (sql === "ROLLBACK") throw new Error("rollback failed");
              return (original as DatabaseSync["exec"]).call(this, sql);
            })
          : vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (
              this: DatabaseSync,
            ) {
              handles.push(this);
              throw new Error("close failed");
            });
      try {
        expect(() =>
          openRecoveryStore({ ...options(dir), create: { policy: { bad: "invalid" } } }),
        ).toThrow();
      } finally {
        spy.mockRestore();
        for (const handle of handles) handle.close();
      }
      expect(existsSync(path.join(dir, "reference.sqlite"))).toBe(true);
    },
  );
  it("preserves nested alias suffixes and assignment-time target liveness", () => {
    const store = open(directory(), true);
    effect(store, "create", (tx) => {
      tx.putResource({ id: "beads/a", kind: "bead", bodyJson: "{}" });
      tx.putAlias("alias/latest", "beads/a");
    });
    expect(store.read((tx) => tx.alias("latest"))).toBeUndefined();
    expect(store.read((tx) => tx.alias("alias/latest"))).toBe("beads/a");
    expect(() =>
      effect(store, "collision", (tx) =>
        tx.putResource({ id: "beads/alias/latest", kind: "bead", bodyJson: "{}" }),
      ),
    ).toThrow(expect.objectContaining({ reason: "alias-path-live" }));
    effect(store, "delete", (tx) => tx.deleteResource("beads/a"));
    expect(store.read((tx) => tx.alias("alias/latest"))).toBe("beads/a");
    expect(() => effect(store, "new-alias", (tx) => tx.putAlias("other", "beads/a"))).toThrow(
      expect.objectContaining({ reason: "alias-target-not-live" }),
    );
    expect(() => effect(store, "old-path", (tx) => tx.putAlias("a", "beads/a"))).toThrow(
      expect.objectContaining({ reason: "alias-path-committed" }),
    );
  });
  it("guards literal scalar text and shares exact retained/expired fingerprints", () => {
    const dir = directory();
    const store = open(dir, true);
    for (const invalid of ['"\ud800"', '"\udc00"']) {
      expect(() =>
        effect(store, `unicode-${invalid.charCodeAt(1)}`, (tx) => tx.putPolicy("bad", invalid)),
      ).toThrow(expect.objectContaining({ reason: "invalid-input" }));
    }
    expect(() => store.admit("\ud800", ["key"])).toThrow(
      expect.objectContaining({ reason: "invalid-input" }),
    );
    const text = '{"n":1.0,"astral":"😀"}';
    const admission = store.admit("alice", ["fingerprint"]);
    store.executeMember(admission, "fingerprint", (tx) => {
      tx.putPolicy("exact", text);
      return outcome("success", { semanticIdentityJson: text });
    });
    const fingerprint = recoveryIdentityFingerprint(text);
    expect(fingerprint).toBe("ec50f901cb7f14b77c37e67ebd2d5021524a00e70089c335d779affc9b968ba8");
    expect(fingerprint).not.toBe(recoveryIdentityFingerprint('{"n":1,"astral":"😀"}'));
    expect(store.read((tx) => tx.key("alice", "fingerprint"))).toMatchObject({
      kind: "retained",
      fingerprint,
    });
    store.expire(100 + day);
    store.close();
    const reopened = open(dir);
    expect(reopened.read((tx) => tx.policy("exact"))).toBe(text);
    expect(reopened.read((tx) => tx.key("alice", "fingerprint"))).toMatchObject({
      kind: "expired",
      fingerprint,
    });
  });
  it.each([
    ["darwin", 2, true], // Registered NFS VFS type, queried through getvfsbyname.
    ["darwin", 26, false], // Observed local APFS; not a general qualification claim.
    ["darwin", 0x6969, false], // A Linux magic value is not a Darwin type number.
    ["linux", 0x6969, true],
    ["linux", 0xff534d42, true],
    ["linux", 0xfe534d42, true],
    ["linux", 0x517b, true],
    ["linux", 0xef53, false],
    ["linux", 2, false],
  ] as const)("classifies known network filesystems on %s type %s", (platform, type, expected) => {
    expect(isKnownNetworkFilesystem(platform, type)).toBe(expected);
  });

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
      filesystemType: statfsSync(dir).type,
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
  it("releases one owned member and preserves its independent tail through commit and reopen", () => {
    const dir = directory();
    const store = open(dir, true);
    const admission = store.admit("alice", ["dependent", "tail"]);
    expect(store.releaseOwnedClaim(admission, "dependent")).toBe(true);
    expect(store.releaseOwnedClaim(admission, "dependent")).toBe(false);
    expect(store.read((tx) => tx.key("alice", "dependent"))).toEqual({ kind: "unknown" });
    expect(store.read((tx) => tx.key("alice", "tail"))).toEqual({
      kind: "claimed",
      attemptId: admission.attemptId,
    });
    expect(store.executeMember(admission, "tail", () => outcome())).toMatchObject({
      kind: "completed",
    });
    expect(store.abandonAttempt(admission)).toBe(0);
    store.close();
    const reopened = open(dir);
    expect(reopened.runtime.recoveredClaims).toBe(0);
    expect(reopened.read((tx) => tx.key("alice", "dependent"))).toEqual({ kind: "unknown" });
    expect(reopened.read((tx) => tx.key("alice", "tail"))).toMatchObject({
      kind: "retained",
      outcomeJson: outcome().outcomeJson,
    });
  });

  it("leaves other owners, other principals, retained results and expired tombstones untouched", () => {
    const store = open(directory(), true);
    const owner = store.admit("alice", ["occupied", "retained", "expired"]);
    store.executeMember(owner, "retained", () =>
      outcome("failure", { retainUntil: 100 + 2 * day }),
    );
    store.executeMember(owner, "expired", () => outcome());
    store.expire(100 + day);
    const otherPrincipal = store.admit("bob", ["own"]);
    const presenting = store.admit("alice", ["occupied", "retained", "expired", "own"]);
    const before = store.read((tx) =>
      ["occupied", "retained", "expired"].map((key) => tx.key("alice", key)),
    );
    for (const key of ["occupied", "retained", "expired"]) {
      expect(store.releaseOwnedClaim(presenting, key)).toBe(false);
    }
    // Even the original owner cannot erase its now-terminal members.
    expect(store.releaseOwnedClaim(owner, "retained")).toBe(false);
    expect(store.releaseOwnedClaim(owner, "expired")).toBe(false);
    expect(
      store.read((tx) => ["occupied", "retained", "expired"].map((key) => tx.key("alice", key))),
    ).toEqual(before);
    expect(store.releaseOwnedClaim(presenting, "own")).toBe(true);
    expect(store.read((tx) => tx.key("bob", "own"))).toEqual({
      kind: "claimed",
      attemptId: otherPrincipal.attemptId,
    });
    const subsequent = store.admit("alice", ["own"]);
    expect(store.releaseOwnedClaim(presenting, "own")).toBe(false);
    expect(store.read((tx) => tx.key("alice", "own"))).toEqual({
      kind: "claimed",
      attemptId: subsequent.attemptId,
    });
    expect(store.abandonAttempt(presenting)).toBe(0);
    expect(store.abandonAttempt(owner)).toBe(1);
  });

  it("rejects forged, foreign and wrong-member release handles before SQL", () => {
    const store = open(directory(), true);
    const foreign = open(directory(), true);
    const admission = store.admit("alice", ["owned"]);
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    for (const candidate of [{ ...admission }, foreign.admit("alice", ["owned"])]) {
      prepare.mockClear();
      expect(() => store.releaseOwnedClaim(candidate, "owned")).toThrow(
        expect.objectContaining({ reason: "invalid-admission" }),
      );
      expect(prepare).not.toHaveBeenCalled();
    }
    expect(() => store.releaseOwnedClaim(admission, "outside")).toThrow(
      expect.objectContaining({ reason: "invalid-admission" }),
    );
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    expect(store.releaseOwnedClaim(admission, "owned")).toBe(true);
  });

  it("uses one conditional DELETE transaction with no SELECT or key-state comparison", () => {
    const store = open(directory(), true);
    const admission = store.admit("alice", ["dependent"]);
    const originalPrepare = DatabaseSync.prototype.prepare;
    const originalExec = DatabaseSync.prototype.exec;
    const statements: string[] = [];
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      statements.push(sql);
      if (/\bSELECT\b/i.test(sql)) throw new Error("release must not inspect key state");
      return originalPrepare.call(this, sql);
    });
    const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      statements.push(sql);
      return originalExec.call(this, sql);
    });
    expect(store.releaseOwnedClaim(admission, "dependent")).toBe(true);
    expect(statements).toEqual([
      "BEGIN IMMEDIATE",
      "DELETE FROM key_state WHERE principal=? AND key=? AND owner=? AND state='claimed'",
      "COMMIT",
    ]);
    prepare.mockRestore();
    exec.mockRestore();
    expect(store.read((tx) => tx.key("alice", "dependent"))).toEqual({ kind: "unknown" });
  });

  it("snapshots keys before validation can mutate the caller's array", () => {
    const store = open(directory(), true);
    const keys = ["first", "second"];
    const admission = store.admit("alice", keys, (states) => {
      expect(states).toEqual([{ kind: "unknown" }, { kind: "unknown" }]);
      keys[0] = "";
      keys.push("extra");
    });
    expect(admission.keys).toEqual(["first", "second"]);
    expect(admission.states).toHaveLength(admission.keys.length);
    expect(Object.isFrozen(admission.keys)).toBe(true);
    for (const key of ["first", "second"])
      expect(store.read((tx) => tx.key("alice", key))).toEqual({
        kind: "claimed",
        attemptId: admission.attemptId,
      });
    for (const key of ["", "extra"])
      expect(store.read((tx) => tx.key("alice", key))).toEqual({ kind: "unknown" });
    expect(() => store.executeMember(admission, "extra", () => outcome())).toThrow("not in");
    expect(() => store.admit("alice", [""])).toThrow("nonempty");
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
    ).toThrow(expect.objectContaining({ reason: "retention-too-short" }));
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
    ).toThrow(expect.objectContaining({ reason: "alias-path-live" }));
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
    ).toThrow(expect.objectContaining({ reason: "identity-reused" }));
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
      expect(() => openRecoveryStore({ ...options(dir), ...patch })).toThrow(
        expect.objectContaining({ reason: "store-mismatch" }),
      );
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
      ).toThrow(
        expect.objectContaining({
          reason: "fenced",
          cause: expect.objectContaining({ message: "injected I/O failure at commit" }),
        }),
      );
      spy.mockRestore();
      expect(() => store.admit("alice", ["retry"])).toThrow(
        expect.objectContaining({ reason: "fenced" }),
      );
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
import {writeSync} from "node:fs";
const [directory,mode]=process.argv.slice(1);
if(process.version!=="v24.16.0")throw new Error("wrong interpreter");
const store=openRecoveryStore({directory,scope:${JSON.stringify(scope)},installationId:"installed-v1",lineageId:"logical-store-v1"});
const send=value=>writeSync(1,JSON.stringify(value)+"\\n");
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

describe("native JSON syntax storage format", () => {
  it("preserves depth-12000 text in every JSON column through integrity checks and reopen", () => {
    const dir = directory();
    // Syntax and exact bytes only: generic storage does not re-admit numeric values.
    const nested = `${"[".repeat(12_000)}1.00000000000000000000000001${"]".repeat(12_000)}`;
    const text = ` {"nested":${nested}} `;
    const store = openRecoveryStore({
      ...options(dir),
      create: {
        resources: [{ id: "beads/seed", kind: "bead", bodyJson: text }],
        types: { "https://types.test/deep": text },
        policy: { seed: text },
      },
    });
    stores.push(store);
    const admission = store.admit("alice", ["deep"]);
    store.executeMember(admission, "deep", (tx) => {
      tx.putResource({ id: "beads/deep", kind: "bead", bodyJson: text });
      tx.putPolicy("deep", text);
      return outcome("success", {
        semanticIdentityJson: text,
        resolutionsJson: text,
        outcomeJson: text,
      });
    });
    store.close();
    const reopened = open(dir);
    expect(reopened.runtime.recoveredClaims).toBe(0);
    expect(reopened.read((tx) => tx.resource("beads/seed")?.bodyJson)).toBe(text);
    expect(reopened.read((tx) => tx.resource("beads/deep")?.bodyJson)).toBe(text);
    expect(reopened.read((tx) => tx.installedType("https://types.test/deep"))).toBe(text);
    expect(reopened.read((tx) => tx.policy("seed"))).toBe(text);
    expect(reopened.read((tx) => tx.policy("deep"))).toBe(text);
    expect(reopened.read((tx) => tx.key("alice", "deep"))).toMatchObject({
      kind: "retained",
      semanticIdentityJson: text,
      resolutionsJson: text,
      outcomeJson: text,
      fingerprint: recoveryIdentityFingerprint(text),
    });
    reopened.expire(100 + day);
    reopened.close();
    expect(open(dir).read((tx) => tx.key("alice", "deep"))).toEqual({
      kind: "expired",
      resolutionsJson: text,
      fingerprint: recoveryIdentityFingerprint(text),
    });
  });

  it("retains actual semantic codec output for 600 nested arrays without rewriting", () => {
    const dir = directory();
    const store = open(dir, true);
    const identity = encodeSemanticValue(
      decodeJsonDocument(`${"[".repeat(600)}0${"]".repeat(600)}`),
    );
    const admission = store.admit("alice", ["codec"]);
    store.executeMember(admission, "codec", () =>
      outcome("success", { semanticIdentityJson: identity }),
    );
    store.close();
    expect(open(dir).read((tx) => tx.key("alice", "codec"))).toMatchObject({
      kind: "retained",
      semanticIdentityJson: identity,
      fingerprint: recoveryIdentityFingerprint(identity),
    });
  });

  it.each([
    ["resources.body", "INSERT INTO resources VALUES ('beads/invalid','bead','{',NULL,NULL)"],
    ["installed_types.body", "INSERT INTO installed_types VALUES ('invalid','{')"],
    ["policy.body", "INSERT INTO policy VALUES ('invalid','{')"],
    ["key_state.identity", "UPDATE key_state SET identity='{' WHERE key='retained'"],
    ["key_state.resolutions", "UPDATE key_state SET resolutions='{' WHERE key='retained'"],
    ["key_state.outcome", "UPDATE key_state SET outcome='{' WHERE key='retained'"],
  ])("enforces the SQL syntax CHECK for %s and atomically rolls back", (_column, invalidSql) => {
    const dir = directory();
    const store = open(dir, true);
    effect(store, "retained");
    const before = store.read((tx) => tx.key("alice", "retained"));
    const admission = store.admit("alice", ["fault"]);
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      if (sql.startsWith("INSERT INTO policy")) this.exec(invalidSql);
      return original.call(this, sql);
    });
    try {
      expect(() =>
        store.executeMember(admission, "fault", (tx) => {
          tx.putResource({ id: "beads/staged", kind: "bead", bodyJson: "{}" });
          tx.putPolicy("trigger", "{}");
          return outcome();
        }),
      ).toThrow(expect.objectContaining({ reason: "constraint" }));
    } finally {
      spy.mockRestore();
    }
    expect(store.read((tx) => tx.resource("beads/staged"))).toBeUndefined();
    expect(store.read((tx) => tx.identityWasCommitted("beads/staged"))).toBe(false);
    expect(store.read((tx) => tx.key("alice", "retained"))).toEqual(before);
    expect(store.read((tx) => tx.key("alice", "fault"))).toMatchObject({ kind: "claimed" });
    expect(store.abandonAttempt(admission)).toBe(1);
    effect(store, "healthy");
    store.close();
    expect(open(dir).read((tx) => tx.key("alice", "retained"))).toEqual(before);
  });

  it("detects deliberately bypassed malformed text at reopen before claim recovery", () => {
    const dir = directory();
    const store = open(dir, true);
    effect(store, "seed", (tx) => tx.putPolicy("policy", "{}"));
    store.admit("alice", ["pending"]);
    store.close();
    const filename = path.join(dir, "reference.sqlite");
    const raw = new DatabaseSync(filename);
    // Deliberate corruption fixture; product connections never bypass CHECKs.
    raw.exec("PRAGMA ignore_check_constraints=ON");
    raw.exec("UPDATE policy SET body='{' WHERE name='policy'");
    raw.close();
    expect(() => open(dir)).toThrow(expect.objectContaining({ reason: "integrity" }));
    const after = new DatabaseSync(filename);
    try {
      expect(after.prepare("SELECT state FROM key_state WHERE key='pending'").get()?.state).toBe(
        "claimed",
      );
    } finally {
      after.close();
    }
  });

  it("refuses the legacy format before sweeping claims or changing retained records", () => {
    const dir = directory();
    const store = open(dir, true);
    effect(store, "retained");
    store.admit("alice", ["pending"]);
    store.close();
    const filename = path.join(dir, "reference.sqlite");
    const raw = new DatabaseSync(filename);
    // Reconstruct the actual format-1 CHECK declarations in this test-owned file.
    // Keep shallow valid rows: this is a legacy compatibility fixture, not corruption.
    raw.exec("UPDATE metadata SET value='1' WHERE name='format'");
    raw.enableDefensive(false); // Test-only legacy reconstruction; product keeps this enabled.
    raw.exec("PRAGMA writable_schema=ON");
    raw.exec(
      "UPDATE sqlite_schema SET sql=replace(sql,'bdp_json_syntax_v2','json_valid') WHERE type='table'",
    );
    raw.exec("PRAGMA writable_schema=OFF");
    raw.enableDefensive(true);
    const before = raw.prepare("SELECT * FROM key_state ORDER BY key").all();
    const schemaBefore = raw.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
    raw.close();
    expect(() => open(dir)).toThrow(expect.objectContaining({ reason: "store-mismatch" }));
    const after = new DatabaseSync(filename);
    try {
      expect(after.prepare("SELECT * FROM key_state ORDER BY key").all()).toEqual(before);
      expect(after.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(
        schemaBefore,
      );
      expect(after.prepare("SELECT value FROM metadata WHERE name='format'").get()?.value).toBe(
        "1",
      );
    } finally {
      after.close();
    }
    expect(() => openRecoveryStore({ ...options(dir), create: {} })).toThrow();
  });

  it("cleans up an uncommitted new file when syntax function registration fails", () => {
    const dir = directory();
    const spy = vi.spyOn(DatabaseSync.prototype, "function").mockImplementationOnce(() => {
      throw new Error("registration fault");
    });
    try {
      expect(() => open(dir, true)).toThrow("registration fault");
      expect(existsSync(path.join(dir, "reference.sqlite"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
    effect(open(dir, true), "healthy");
  });

  it.each([
    `${scope}?`,
    `${scope}#`,
    "not a URL",
    "https://example.test/scope/%61/",
    "https://example.test:443/scope/",
  ])("rejects noncanonical Scope %s as invalid-input before provisioning", (candidate) => {
    const dir = directory();
    expect(() => openRecoveryStore({ ...options(dir), scope: candidate, create: {} })).toThrow(
      expect.objectContaining({ reason: "invalid-input" }),
    );
    expect(existsSync(path.join(dir, "reference.sqlite"))).toBe(false);
  });
});
