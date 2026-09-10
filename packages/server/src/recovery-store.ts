import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, statfsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Storage text is supplied by the admitted-value evaluator, never a second serializer. */
export interface StoredResource {
  /** Canonical namespace-relative Resource ID; the evaluator owns full wire validation. */
  readonly id: string;
  readonly kind: "bead" | "link";
  /** Exact admitted record text; endpoint indexes must match its normalized references. */
  readonly bodyJson: string;
  readonly source?: string;
  readonly target?: string;
}
export type KeyState =
  | { readonly kind: "unknown" }
  | { readonly kind: "claimed"; readonly attemptId: string }
  | {
      readonly kind: "retained";
      readonly semanticIdentityJson: string;
      readonly fingerprint: string;
      readonly resolutionsJson: string;
      readonly outcomeJson: string;
      readonly effect: "success" | "failure";
      readonly completedAt: number;
      readonly retainUntil: number;
    }
  | { readonly kind: "expired"; readonly fingerprint: string; readonly resolutionsJson: string };
export interface Admission {
  readonly attemptId: string;
  readonly principal: string;
  readonly keys: readonly string[];
  readonly states: readonly KeyState[];
}
export type MemberDecision =
  | {
      readonly kind: "retain";
      readonly semanticIdentityJson: string;
      readonly resolutionsJson: string;
      readonly outcomeJson: string;
      readonly effect: "success" | "failure";
      readonly completedAt: number;
      readonly retainUntil: number;
    }
  | { readonly kind: "release" };
export type MemberCompletion =
  | { readonly kind: "completed"; readonly outcomeJson: string }
  | { readonly kind: "released" }
  | { readonly kind: "existing"; readonly state: KeyState };
export interface StoreReader {
  resource(id: string): StoredResource | undefined;
  resources(): readonly StoredResource[];
  incidentLinks(id: string): readonly StoredResource[];
  outgoingLinks(source: string): readonly StoredResource[];
  alias(aliasPath: string): string | undefined;
  identityWasCommitted(id: string): boolean;
  installedType(id: string): string | undefined;
  policy(name: string): string | undefined;
  key(principal: string, key: string): KeyState;
}
export interface MemberTransaction extends StoreReader {
  putResource(resource: StoredResource): void;
  deleteResource(id: string): void;
  putAlias(aliasPath: string, beadId: string): void;
  deleteAlias(aliasPath: string): void;
  putPolicy(name: string, bodyJson: string): void;
  allocateRevision(): string;
  allocateResourceId(kind: "bead" | "link"): string;
}
export interface StoreSeed {
  readonly resources?: readonly StoredResource[];
  readonly types?: Readonly<Record<string, string>>;
  readonly policy?: Readonly<Record<string, string>>;
}
export interface RecoveryStoreOptions {
  readonly directory: string;
  readonly scope: string;
  readonly installationId: string;
  /** Independent configured expectation, not proof against a coherent full-store rollback. */
  readonly lineageId: string;
  /** Explicit new logical-Scope provisioning only, never restore/reseed at an old Scope URL. */
  readonly create?: StoreSeed;
  readonly minimumRetentionMs?: number;
}
export interface RecoveryStore {
  readonly runtime: Readonly<{
    node: string;
    executable: string;
    sqlite: string;
    journalMode: string;
    lockingMode: string;
    synchronous: number;
    recoveredClaims: number;
  }>;
  read<T>(reader: (store: StoreReader) => T): T;
  admit(
    principal: string,
    keys: readonly string[],
    validate?: (states: readonly KeyState[]) => void,
  ): Admission;
  executeMember(
    admission: Admission,
    key: string,
    evaluate: (transaction: MemberTransaction) => MemberDecision,
  ): MemberCompletion;
  abandonAttempt(admission: Admission): number;
  expire(now: number): void;
  close(): void;
}

const formatVersion = "1";
const dayMs = 86_400_000;
const schema = `
 CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
 CREATE TABLE resources(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('bead','link')), body TEXT NOT NULL CHECK(json_valid(body)), source TEXT, target TEXT, CHECK((kind='bead' AND source IS NULL AND target IS NULL) OR (kind='link' AND source IS NOT NULL AND target IS NOT NULL))) STRICT;
 CREATE INDEX links_source ON resources(source) WHERE kind='link';
 CREATE INDEX links_target ON resources(target) WHERE kind='link';
 CREATE TABLE identities(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('bead','link'))) STRICT;
 CREATE TABLE aliases(path TEXT PRIMARY KEY, bead_id TEXT NOT NULL) STRICT;
 CREATE TABLE installed_types(id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body))) STRICT;
 CREATE TABLE policy(name TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body))) STRICT;
 CREATE TABLE key_state(principal TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('claimed','retained','expired')), owner TEXT, identity TEXT, fingerprint TEXT, resolutions TEXT, outcome TEXT, effect TEXT, completed_at INTEGER, retain_until INTEGER, PRIMARY KEY(principal,key), CHECK(identity IS NULL OR json_valid(identity)), CHECK(resolutions IS NULL OR json_valid(resolutions)), CHECK(outcome IS NULL OR json_valid(outcome)),
 CHECK((state='claimed' AND owner IS NOT NULL AND identity IS NULL AND fingerprint IS NULL AND resolutions IS NULL AND outcome IS NULL AND effect IS NULL AND completed_at IS NULL AND retain_until IS NULL)
 OR (state='retained' AND owner IS NULL AND identity IS NOT NULL AND fingerprint IS NOT NULL AND resolutions IS NOT NULL AND outcome IS NOT NULL AND effect IS NOT NULL AND effect IN ('success','failure') AND completed_at IS NOT NULL AND retain_until >= completed_at)
 OR (state='expired' AND owner IS NULL AND identity IS NULL AND fingerprint IS NOT NULL AND resolutions IS NOT NULL AND outcome IS NULL AND effect='success' AND completed_at IS NULL AND retain_until IS NULL))) STRICT;
`;

function requireText(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} must be nonempty text`);
}
function requireJson(text: string): void {
  if (typeof text !== "string") throw new Error("storage JSON must be admitted text");
  JSON.parse(text); // Check syntax only; persist the original text and never re-encode numbers.
}
function requireTime(time: number): void {
  if (!Number.isSafeInteger(time) || time < 0)
    throw new Error("time must be nonnegative safe integer milliseconds");
}
function rejectAsync(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  ) {
    // A forbidden async callback must not leave an unhandled rejection after its facade expires.
    Promise.resolve(value).catch(() => {});
    throw new Error("store callbacks must be synchronous");
  }
}
function sqliteError(error: unknown): boolean {
  return error instanceof Error && "code" in error && String(error.code).startsWith("ERR_SQLITE");
}

/**
 * Local reference storage only. SQLite owns process exclusion and journal recovery;
 * the returned handle is ready only after a real exclusive startup write commits.
 * Restore without complete recovery continuity must use a different canonical Scope.
 * The caller must arrange a supported local filesystem; known network types refuse.
 */
export function openRecoveryStore(options: RecoveryStoreOptions): RecoveryStore {
  if (process.version !== "v24.16.0")
    throw new Error("durable reference storage requires Node v24.16.0");
  const scope = new URL(options.scope);
  if (
    !/^https?:$/.test(scope.protocol) ||
    scope.href !== options.scope ||
    !scope.pathname.endsWith("/") ||
    scope.search ||
    scope.hash ||
    scope.username ||
    scope.password
  )
    throw new Error("canonical Scope URL required");
  requireText(options.installationId, "installationId");
  requireText(options.lineageId, "lineageId");
  const retention = options.minimumRetentionMs ?? dayMs;
  requireTime(retention);
  if (retention < dayMs) throw new Error("retention must preserve at least PT24H");
  const directory = path.resolve(options.directory);
  if (options.create !== undefined) mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Darwin NFS/SMB and Linux NFS/CIFS/SMB2. Other filesystems require deployment qualification.
  if (
    [0x6969, 0xff534d42, 0xfe534d42, 0x517b, 0x6e6673, 0x736d6266].includes(
      statfsSync(directory).type,
    )
  )
    throw new Error("network filesystem is unsupported");
  const filename = path.join(directory, "reference.sqlite");
  if (options.create !== undefined) closeSync(openSync(filename, "wx", 0o600));
  else if (!existsSync(filename))
    throw new Error("existing recovery store is missing; refusing reseed");
  const db = new DatabaseSync(filename, {
    timeout: 0,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  let closed = false;
  let fenced = false;
  let active = false;
  const admissions = new WeakSet<Admission>();
  const run = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).run(...args);
  const get = (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).get(...args);
  const meta = (name: string): string => {
    const value = get("SELECT value FROM metadata WHERE name=?", name)?.value;
    if (typeof value !== "string") throw new Error(`missing store metadata: ${name}`);
    return value;
  };
  const available = () => {
    if (closed || fenced) throw new Error("recovery store is closed or fenced; reopen before use");
    if (active) throw new Error("nested store access is forbidden");
  };
  const transaction = <T>(callback: () => T): T => {
    available();
    active = true;
    let committing = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = callback();
      rejectAsync(result);
      committing = true;
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (committing || sqliteError(error)) fenced = true;
      if (db.isTransaction) {
        try {
          db.exec("ROLLBACK");
        } catch {
          fenced = true;
        }
      }
      throw error;
    } finally {
      active = false;
    }
  };
  const resourceFromRow = (row: Record<string, unknown>): StoredResource =>
    Object.freeze({
      id: String(row.id),
      kind: row.kind as "bead" | "link",
      bodyJson: String(row.body),
      ...(row.source === null ? {} : { source: String(row.source) }),
      ...(row.target === null ? {} : { target: String(row.target) }),
    });
  const keyState = (principal: string, key: string): KeyState => {
    const row = get("SELECT * FROM key_state WHERE principal=? AND key=?", principal, key);
    if (!row) return Object.freeze({ kind: "unknown" });
    if (row.state === "claimed")
      return Object.freeze({ kind: "claimed", attemptId: String(row.owner) });
    if (row.state === "expired")
      return Object.freeze({
        kind: "expired",
        fingerprint: String(row.fingerprint),
        resolutionsJson: String(row.resolutions),
      });
    return Object.freeze({
      kind: "retained",
      semanticIdentityJson: String(row.identity),
      fingerprint: String(row.fingerprint),
      resolutionsJson: String(row.resolutions),
      outcomeJson: String(row.outcome),
      effect: row.effect as "success" | "failure",
      completedAt: Number(row.completed_at),
      retainUntil: Number(row.retain_until),
    });
  };
  const reader = (check: () => void): StoreReader => ({
    resource(id) {
      check();
      const row = get("SELECT * FROM resources WHERE id=?", id);
      return row ? resourceFromRow(row) : undefined;
    },
    resources() {
      check();
      return Object.freeze(
        db.prepare("SELECT * FROM resources ORDER BY id").all().map(resourceFromRow),
      );
    },
    incidentLinks(id) {
      check();
      return Object.freeze(
        db
          .prepare(
            "SELECT * FROM resources WHERE kind='link' AND (source=? OR target=?) ORDER BY id",
          )
          .all(id, id)
          .map(resourceFromRow),
      );
    },
    outgoingLinks(source) {
      check();
      return Object.freeze(
        db
          .prepare("SELECT * FROM resources WHERE kind='link' AND source=? ORDER BY id")
          .all(source)
          .map(resourceFromRow),
      );
    },
    alias(aliasPath) {
      check();
      const value = get("SELECT bead_id FROM aliases WHERE path=?", aliasPath)?.bead_id;
      return typeof value === "string" ? value : undefined;
    },
    identityWasCommitted(id) {
      check();
      return get("SELECT id FROM identities WHERE id=?", id) !== undefined;
    },
    installedType(id) {
      check();
      const value = get("SELECT body FROM installed_types WHERE id=?", id)?.body;
      return typeof value === "string" ? value : undefined;
    },
    policy(name) {
      check();
      const value = get("SELECT body FROM policy WHERE name=?", name)?.body;
      return typeof value === "string" ? value : undefined;
    },
    key(principal, key) {
      check();
      return keyState(principal, key);
    },
  });
  const putResource = (resource: StoredResource): void => {
    requireText(resource.id, "resource id");
    const root = resource.kind === "bead" ? "beads/" : "links/";
    if (!resource.id.startsWith(root) || resource.id.length === root.length)
      throw new Error("normalized local Resource ID required");
    requireJson(resource.bodyJson);
    const previous = get("SELECT kind,source,target FROM resources WHERE id=?", resource.id);
    if (
      previous &&
      (previous.kind !== resource.kind ||
        previous.source !== (resource.source ?? null) ||
        previous.target !== (resource.target ?? null))
    )
      throw new Error("immutable Resource identity/endpoints changed");
    if (!previous && get("SELECT id FROM identities WHERE id=?", resource.id))
      throw new Error("committed Resource identity cannot be reused");
    // Evaluator supplies canonical namespace-relative Resource IDs and alias paths.
    if (
      resource.kind === "bead" &&
      get("SELECT path FROM aliases WHERE path=?", resource.id.replace(/^beads\//, ""))
    )
      throw new Error("Bead identity collides with a live alias");
    run(
      "INSERT INTO identities(id,kind) VALUES (?,?) ON CONFLICT(id) DO NOTHING",
      resource.id,
      resource.kind,
    );
    run(
      "INSERT INTO resources VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      resource.id,
      resource.kind,
      resource.bodyJson,
      resource.source ?? null,
      resource.target ?? null,
    );
  };
  let runtime: RecoveryStore["runtime"];
  try {
    const journal = get("PRAGMA journal_mode=DELETE")?.journal_mode;
    const locking = get("PRAGMA locking_mode=EXCLUSIVE")?.locking_mode;
    db.exec("PRAGMA synchronous=EXTRA");
    const synchronous = get("PRAGMA synchronous")?.synchronous;
    if (journal !== "delete" || locking !== "exclusive" || synchronous !== 3)
      throw new Error("required SQLite durability modes unavailable");
    db.exec("BEGIN EXCLUSIVE");
    if (options.create !== undefined) {
      db.exec(schema);
      for (const [name, value] of Object.entries({
        format: formatVersion,
        scope: options.scope,
        installation: options.installationId,
        lineage: options.lineageId,
        namespace: randomUUID(),
        nextRevision: "0",
        nextIdentity: "0",
      }))
        run("INSERT INTO metadata VALUES (?,?)", name, value);
      for (const resource of options.create.resources ?? []) putResource(resource);
      for (const [id, body] of Object.entries(options.create.types ?? {})) {
        requireJson(body);
        run("INSERT INTO installed_types VALUES (?,?)", id, body);
      }
      for (const [name, body] of Object.entries(options.create.policy ?? {})) {
        requireJson(body);
        run("INSERT INTO policy VALUES (?,?)", name, body);
      }
    }
    const expectedTables = [
      "aliases",
      "identities",
      "installed_types",
      "key_state",
      "metadata",
      "policy",
      "resources",
    ];
    const actualTables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name);
    if (
      expectedTables.length !== actualTables.length ||
      expectedTables.some((name, index) => name !== actualTables[index])
    )
      throw new Error("incomplete or incompatible recovery schema");
    if (
      meta("format") !== formatVersion ||
      meta("scope") !== options.scope ||
      meta("installation") !== options.installationId ||
      meta("lineage") !== options.lineageId
    )
      throw new Error("store format/Scope/installation/lineage mismatch");
    if (
      !/^\d+$/.test(meta("nextRevision")) ||
      !/^\d+$/.test(meta("nextIdentity")) ||
      !meta("namespace")
    )
      throw new Error("invalid allocation recovery state");
    if (
      get("PRAGMA quick_check")?.quick_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length !== 0
    )
      throw new Error("store integrity check failed");
    if (
      get(
        "SELECT r.id FROM resources r LEFT JOIN identities i ON i.id=r.id WHERE i.id IS NULL OR i.kind<>r.kind LIMIT 1",
      )
    )
      throw new Error("resource identity history incomplete");
    const recoveredClaims = Number(run("DELETE FROM key_state WHERE state='claimed'").changes);
    // A genuine startup write obtains and retains ownership even on an empty sweep.
    run("UPDATE metadata SET value=value WHERE name='format'");
    db.exec("COMMIT");
    runtime = Object.freeze({
      node: process.version,
      executable: process.execPath,
      sqlite: String(get("SELECT sqlite_version() AS version")?.version),
      journalMode: String(journal),
      lockingMode: String(locking),
      synchronous: Number(synchronous),
      recoveredClaims,
    });
  } catch (error) {
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
    } finally {
      db.close();
    }
    throw error;
  }

  const checkAdmission = (admission: Admission, key?: string) => {
    if (!admissions.has(admission)) throw new Error("admission is not owned by this store handle");
    requireText(admission.attemptId, "attemptId");
    requireText(admission.principal, "principal");
    if (key !== undefined && !admission.keys.includes(key))
      throw new Error("key was not in the admitted carrier");
  };
  return {
    runtime,
    read(callback) {
      available();
      active = true;
      let valid = true;
      try {
        const value = callback(
          reader(() => {
            if (!valid) throw new Error("expired read facade");
          }),
        );
        rejectAsync(value);
        return value;
      } finally {
        valid = false;
        active = false;
      }
    },
    admit(principal, keys, validate) {
      requireText(principal, "principal");
      if (keys.length === 0 || new Set(keys).size !== keys.length)
        throw new Error("carrier keys must be nonempty and unique");
      for (const key of keys) requireText(key, "idempotency key");
      return transaction(() => {
        const states = Object.freeze(keys.map((key) => keyState(principal, key)));
        if (validate) rejectAsync(validate(states));
        const attemptId = randomUUID();
        for (let index = 0; index < keys.length; index++)
          if (states[index]?.kind === "unknown")
            run(
              "INSERT INTO key_state(principal,key,state,owner) VALUES (?,?,'claimed',?)",
              principal,
              keys[index] as string,
              attemptId,
            );
        const admission = Object.freeze({
          attemptId,
          principal,
          keys: Object.freeze([...keys]),
          states,
        });
        admissions.add(admission);
        return admission;
      });
    },
    executeMember(admission, key, evaluate) {
      checkAdmission(admission, key);
      return transaction(() => {
        const current = keyState(admission.principal, key);
        if (current.kind === "unknown")
          run(
            "INSERT INTO key_state(principal,key,state,owner) VALUES (?,?,'claimed',?)",
            admission.principal,
            key,
            admission.attemptId,
          );
        else if (current.kind !== "claimed" || current.attemptId !== admission.attemptId)
          return { kind: "existing", state: current };
        db.exec("SAVEPOINT member_effects");
        let valid = true;
        const check = () => {
          if (!valid) throw new Error("expired member transaction facade");
        };
        const tx: MemberTransaction = {
          ...reader(check),
          putResource(resource) {
            check();
            putResource(resource);
          },
          deleteResource(id) {
            check();
            if (
              get(
                "SELECT id FROM resources WHERE kind='link' AND (source=? OR target=?) LIMIT 1",
                id,
                id,
              )
            )
              throw new Error("live incident Link prevents deletion");
            run("DELETE FROM resources WHERE id=?", id);
          },
          putAlias(aliasPath, beadId) {
            check();
            requireText(aliasPath, "alias path");
            if (get("SELECT id FROM identities WHERE kind='bead' AND id=?", `beads/${aliasPath}`))
              throw new Error("alias collides with committed Bead path");
            if (get("SELECT kind FROM resources WHERE id=?", beadId)?.kind !== "bead")
              throw new Error("alias target must be a live Bead");
            run(
              "INSERT INTO aliases VALUES (?,?) ON CONFLICT(path) DO UPDATE SET bead_id=excluded.bead_id",
              aliasPath,
              beadId,
            );
          },
          deleteAlias(aliasPath) {
            check();
            run("DELETE FROM aliases WHERE path=?", aliasPath);
          },
          putPolicy(name, bodyJson) {
            check();
            requireText(name, "policy name");
            requireJson(bodyJson);
            run(
              "INSERT INTO policy VALUES (?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body",
              name,
              bodyJson,
            );
          },
          allocateResourceId(kind) {
            check();
            if (kind !== "bead" && kind !== "link") throw new Error("invalid Resource kind");
            for (;;) {
              const next = BigInt(meta("nextIdentity")) + 1n;
              run("UPDATE metadata SET value=? WHERE name='nextIdentity'", next.toString());
              const suffix = createHash("sha256")
                .update(`${meta("namespace")}:identity:${next}`)
                .digest("hex");
              const id = `${kind === "bead" ? "beads" : "links"}/${suffix}`;
              if (get("SELECT id FROM identities WHERE id=?", id)) continue;
              if (kind === "bead" && get("SELECT path FROM aliases WHERE path=?", suffix)) continue;
              return id;
            }
          },
          allocateRevision() {
            check();
            const next = BigInt(meta("nextRevision")) + 1n;
            run("UPDATE metadata SET value=? WHERE name='nextRevision'", next.toString());
            return createHash("sha256")
              .update(`${meta("namespace")}:${next}`)
              .digest("hex");
          },
        };
        let decision: MemberDecision;
        try {
          decision = evaluate(tx);
          rejectAsync(decision);
        } finally {
          valid = false;
        }
        if (decision.kind === "release" || decision.effect === "failure")
          db.exec("ROLLBACK TO member_effects");
        db.exec("RELEASE member_effects");
        if (decision.kind === "release") {
          run(
            "DELETE FROM key_state WHERE principal=? AND key=? AND owner=? AND state='claimed'",
            admission.principal,
            key,
            admission.attemptId,
          );
          return { kind: "released" };
        }
        requireJson(decision.semanticIdentityJson);
        requireJson(decision.resolutionsJson);
        requireJson(decision.outcomeJson);
        requireTime(decision.completedAt);
        requireTime(decision.retainUntil);
        if (decision.retainUntil - decision.completedAt < retention)
          throw new Error("outcome retention is shorter than the promised minimum");
        const fingerprint = createHash("sha256")
          .update(decision.semanticIdentityJson)
          .digest("hex");
        const changed = run(
          "UPDATE key_state SET state='retained',owner=NULL,identity=?,fingerprint=?,resolutions=?,outcome=?,effect=?,completed_at=?,retain_until=? WHERE principal=? AND key=? AND state='claimed' AND owner=?",
          decision.semanticIdentityJson,
          fingerprint,
          decision.resolutionsJson,
          decision.outcomeJson,
          decision.effect,
          decision.completedAt,
          decision.retainUntil,
          admission.principal,
          key,
          admission.attemptId,
        ).changes;
        if (changed !== 1) throw new Error("member lost claim ownership");
        return { kind: "completed", outcomeJson: decision.outcomeJson };
      });
    },
    abandonAttempt(admission) {
      checkAdmission(admission);
      return transaction(() =>
        Number(
          run(
            "DELETE FROM key_state WHERE state='claimed' AND principal=? AND owner=?",
            admission.principal,
            admission.attemptId,
          ).changes,
        ),
      );
    },
    expire(now) {
      requireTime(now);
      transaction(() => {
        run(
          "DELETE FROM key_state WHERE state='retained' AND effect='failure' AND retain_until<=?",
          now,
        );
        run(
          "UPDATE key_state SET state='expired',identity=NULL,outcome=NULL,completed_at=NULL,retain_until=NULL WHERE state='retained' AND effect='success' AND retain_until<=?",
          now,
        );
      });
    },
    close() {
      if (active) throw new Error("cannot close inside a store callback");
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
