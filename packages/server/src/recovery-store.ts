import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, statfsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { parseCanonicalScope } from "@bdp/protocol";

/** Storage text is supplied by the admitted-value evaluator, never a second serializer. */
export type StoredResource = {
  /** Canonical namespace-relative Resource ID; the evaluator owns full wire validation. */
  readonly id: string;
  /** Exact admitted record text; endpoint indexes must match its normalized references. */
  readonly bodyJson: string;
} & (
  | { readonly kind: "bead"; readonly source?: never; readonly target?: never }
  | { readonly kind: "link"; readonly source: string; readonly target: string }
);

/** Storage conditions, never a mapping to normative member Problem codes.
 * Evaluators perform normative prechecks and retain the appropriate member outcome.
 */
export type RecoveryStoreErrorReason =
  | "invalid-input"
  | "identity-reused"
  | "alias-path-live"
  | "alias-path-committed"
  | "incident-links"
  | "alias-target-not-live"
  | "resource-immutable"
  | "closed"
  | "fenced"
  | "nested-access"
  | "expired-facade"
  | "retention-too-short"
  | "lost-claim"
  | "invalid-admission"
  | "async-callback"
  | "store-mismatch"
  | "modes-unavailable"
  | "integrity"
  | "unsupported-runtime"
  | "unsupported-filesystem"
  | "store-missing"
  | "constraint";
export class RecoveryStoreError extends Error {
  readonly reason: RecoveryStoreErrorReason;
  constructor(reason: RecoveryStoreErrorReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
    this.name = "RecoveryStoreError";
  }
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
  /** Suffix beneath alias/; "alias/latest" denotes alias/alias/latest. */
  alias(aliasPathBeneathRoot: string): string | undefined;
  identityWasCommitted(id: string): boolean;
  installedType(id: string): string | undefined;
  policy(name: string): string | undefined;
  key(principal: string, key: string): KeyState;
}
export interface MemberTransaction extends StoreReader {
  putResource(resource: StoredResource): void;
  deleteResource(id: string): void;
  /** Target must be live when assigned; later deletion does not cascade aliases. */
  putAlias(aliasPathBeneathRoot: string, beadId: string): void;
  deleteAlias(aliasPathBeneathRoot: string): void;
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
    filesystemType: number;
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
  /** Release just this member's owned claim without reading/comparing key state.
   * A transient creator dependency uses this before any idempotency classification.
   * False means no owned claim was removed; it discloses no other key disposition.
   */
  releaseOwnedClaim(admission: Admission, key: string): boolean;
  /** S5 must retain every live Admission and call this in finally on attempt termination.
   * Lost caller references are not recoverable through an unbranded mass-release API.
   * Startup clears abandoned claims; this method clears only this owned live attempt.
   */
  abandonAttempt(admission: Admission): number;
  expire(now: number): void;
  close(): void;
}

const formatVersion = "2";
const dayMs = 86_400_000;
const schema = `
 CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
 CREATE TABLE resources(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('bead','link')), body TEXT NOT NULL CHECK(bdp_json_syntax_v2(body)), source TEXT, target TEXT, CHECK((kind='bead' AND source IS NULL AND target IS NULL) OR (kind='link' AND source IS NOT NULL AND target IS NOT NULL))) STRICT;
 CREATE INDEX links_source ON resources(source) WHERE kind='link';
 CREATE INDEX links_target ON resources(target) WHERE kind='link';
 CREATE TABLE identities(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('bead','link'))) STRICT;
 CREATE TABLE aliases(path TEXT PRIMARY KEY, bead_id TEXT NOT NULL) STRICT;
 CREATE TABLE installed_types(id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(bdp_json_syntax_v2(body))) STRICT;
 CREATE TABLE policy(name TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(bdp_json_syntax_v2(body))) STRICT;
 CREATE TABLE key_state(principal TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('claimed','retained','expired')), owner TEXT, identity TEXT, fingerprint TEXT, resolutions TEXT, outcome TEXT, effect TEXT, completed_at INTEGER, retain_until INTEGER, PRIMARY KEY(principal,key), CHECK(identity IS NULL OR bdp_json_syntax_v2(identity)), CHECK(resolutions IS NULL OR bdp_json_syntax_v2(resolutions)), CHECK(outcome IS NULL OR bdp_json_syntax_v2(outcome)),
 CHECK((state='claimed' AND owner IS NOT NULL AND identity IS NULL AND fingerprint IS NULL AND resolutions IS NULL AND outcome IS NULL AND effect IS NULL AND completed_at IS NULL AND retain_until IS NULL)
 OR (state='retained' AND owner IS NULL AND identity IS NOT NULL AND fingerprint IS NOT NULL AND resolutions IS NOT NULL AND outcome IS NOT NULL AND effect IS NOT NULL AND effect IN ('success','failure') AND completed_at IS NOT NULL AND retain_until >= completed_at)
 OR (state='expired' AND owner IS NULL AND identity IS NULL AND fingerprint IS NOT NULL AND resolutions IS NOT NULL AND outcome IS NULL AND effect='success' AND completed_at IS NULL AND retain_until IS NULL))) STRICT;
`;

function requireText(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || !value.isWellFormed())
    throw new RecoveryStoreError("invalid-input", `${name} must be nonempty text`);
}
function requireJson(text: string): void {
  if (typeof text !== "string" || !text.isWellFormed())
    throw new RecoveryStoreError("invalid-input", "storage JSON must be admitted text");
  // Literal non-scalar UTF-16 cannot round-trip through SQLite TEXT. S1 additionally
  // rejects escaped semantic surrogates; storage does not replace that admission phase.
  JSON.parse(text); // Check syntax only; persist the original text and never re-encode numbers.
}
function requireTime(time: number): void {
  if (!Number.isSafeInteger(time) || time < 0)
    throw new RecoveryStoreError(
      "invalid-input",
      "time must be nonnegative safe integer milliseconds",
    );
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
    throw new RecoveryStoreError("async-callback", "store callbacks must be synchronous");
  }
}
/** Same exact admitted identity text is used both at retention and expired-key comparison. */
export function recoveryIdentityFingerprint(semanticIdentityJson: string): string {
  requireJson(semanticIdentityJson);
  return createHash("sha256").update(semanticIdentityJson).digest("hex");
}
function sqliteConstraint(error: unknown): boolean {
  // Node 24 reports ERR_SQLITE_ERROR plus SQLite's numeric extended result code.
  return (
    sqliteError(error) &&
    "errcode" in error &&
    typeof error.errcode === "number" &&
    Number.isInteger(error.errcode) &&
    (error.errcode & 0xff) === 19
  );
}
function sqliteError(error: unknown): error is Error & { code: unknown } {
  return error instanceof Error && "code" in error && String(error.code).startsWith("ERR_SQLITE");
}

/** Darwin f_type uses VFS type numbers (getvfsbyname); Linux uses magic values.
 * Darwin NFS=2 is verified against libSystem's registered nfs type. Other
 * filesystems still require deployment qualification: false is not approval.
 */
export function isKnownNetworkFilesystem(platform: NodeJS.Platform, type: number): boolean {
  if (platform === "darwin") return type === 2;
  return platform === "linux" && [0x6969, 0xff534d42, 0xfe534d42, 0x517b].includes(type);
}

/**
 * Local reference storage only. SQLite owns process exclusion and journal recovery;
 * the returned handle is ready only after a real exclusive startup write commits.
 * Restore without complete recovery continuity must use a different canonical Scope.
 * The caller must arrange a supported local filesystem; known network types refuse.
 * Format 2 is application-owned: writes and SQLite integrity checks require the
 * exact bdp_json_syntax_v2 function registered below. A stock SQLite connection
 * can inspect rows but cannot run those checks or replay a logical SQL dump.
 * Any logical restore must preserve the complete recovery/identity state and
 * register the format's function before checks or writes. This module supplies
 * no logical import/export API; opening a partial restore does not certify it.
 */
export function openRecoveryStore(options: RecoveryStoreOptions): RecoveryStore {
  if (process.version !== "v24.16.0")
    throw new RecoveryStoreError(
      "unsupported-runtime",
      "durable reference storage requires Node v24.16.0",
    );
  try {
    parseCanonicalScope(options.scope);
  } catch (cause) {
    throw new RecoveryStoreError("invalid-input", "canonical Scope URL required", { cause });
  }
  requireText(options.installationId, "installationId");
  requireText(options.lineageId, "lineageId");
  const retention = options.minimumRetentionMs ?? dayMs;
  requireTime(retention);
  if (retention < dayMs)
    throw new RecoveryStoreError("retention-too-short", "retention must preserve at least PT24H");
  const seed = options.create;
  const directory = path.resolve(options.directory);
  const filename = path.join(directory, "reference.sqlite");
  if (seed === undefined && !existsSync(filename))
    throw new RecoveryStoreError(
      "store-missing",
      "existing recovery store is missing; refusing reseed",
    );
  if (seed !== undefined) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filesystemType = statfsSync(directory).type;
  if (isKnownNetworkFilesystem(process.platform, filesystemType))
    throw new RecoveryStoreError("unsupported-filesystem", "network filesystem is unsupported");
  let createdFile = false;
  if (seed !== undefined) {
    closeSync(openSync(filename, "wx", 0o600));
    createdFile = true;
  }
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
    if (typeof value !== "string")
      throw new RecoveryStoreError("integrity", `missing store metadata: ${name}`);
    return value;
  };
  const available = () => {
    if (closed)
      throw new RecoveryStoreError("closed", "recovery store is closed; reopen before use");
    if (fenced)
      throw new RecoveryStoreError("fenced", "recovery store is fenced; reopen before use");
    if (active) throw new RecoveryStoreError("nested-access", "nested store access is forbidden");
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
      let cleanRollback = false;
      if (db.isTransaction) {
        try {
          db.exec("ROLLBACK");
          cleanRollback = !db.isTransaction;
        } catch {
          fenced = true;
        }
      }
      const ordinaryConstraint = !committing && cleanRollback && sqliteConstraint(error);
      if (committing || (sqliteError(error) && !ordinaryConstraint)) fenced = true;
      if (fenced)
        throw new RecoveryStoreError(
          "fenced",
          "recovery store fenced after transaction failure; reopen before use",
          { cause: error },
        );
      if (ordinaryConstraint)
        throw new RecoveryStoreError("constraint", "storage constraint rejected the member", {
          cause: error,
        });
      throw error;
    } finally {
      active = false;
    }
  };
  const resourceFromRow = (row: Record<string, unknown>): StoredResource => {
    const common = { id: String(row.id), bodyJson: String(row.body) };
    return row.kind === "bead"
      ? Object.freeze({ ...common, kind: "bead" })
      : Object.freeze({
          ...common,
          kind: "link",
          source: String(row.source),
          target: String(row.target),
        });
  };
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
    alias(aliasPathBeneathRoot) {
      check();
      const value = get("SELECT bead_id FROM aliases WHERE path=?", aliasPathBeneathRoot)?.bead_id;
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
    if (resource.kind !== "bead" && resource.kind !== "link")
      throw new RecoveryStoreError("invalid-input", "invalid Resource kind");
    if (resource.kind === "link") {
      requireText(resource.source, "Link source");
      requireText(resource.target, "Link target");
    } else if (resource.source !== undefined || resource.target !== undefined) {
      throw new RecoveryStoreError("invalid-input", "Bead must not carry Link endpoints");
    }
    requireText(resource.id, "resource id");
    const root = resource.kind === "bead" ? "beads/" : "links/";
    if (!resource.id.startsWith(root) || resource.id.length === root.length)
      throw new RecoveryStoreError("invalid-input", "normalized local Resource ID required");
    requireJson(resource.bodyJson);
    const previous = get("SELECT kind,source,target FROM resources WHERE id=?", resource.id);
    if (
      previous &&
      (previous.kind !== resource.kind ||
        previous.source !== (resource.source ?? null) ||
        previous.target !== (resource.target ?? null))
    )
      throw new RecoveryStoreError(
        "resource-immutable",
        "immutable Resource identity/endpoints changed",
      );
    if (!previous && get("SELECT id FROM identities WHERE id=?", resource.id))
      throw new RecoveryStoreError(
        "identity-reused",
        "committed Resource identity cannot be reused",
      );
    // Evaluator supplies canonical namespace-relative Resource IDs and alias paths.
    if (
      resource.kind === "bead" &&
      get("SELECT path FROM aliases WHERE path=?", resource.id.replace(/^beads\//, ""))
    )
      throw new RecoveryStoreError("alias-path-live", "Bead identity collides with a live alias");
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
  let startupCommitAttempted = false;
  try {
    // SQLite's built-in JSON parser rejects otherwise admitted deeply nested text.
    // A named format-2 CHECK uses the same native syntax guard as the facade;
    // register it before schema creation or integrity checks on every connection.
    db.function("bdp_json_syntax_v2", { deterministic: true }, (text) => {
      if (typeof text !== "string") return 0;
      try {
        requireJson(text);
        return 1;
      } catch (error) {
        if (
          error instanceof SyntaxError ||
          (error instanceof RecoveryStoreError && error.reason === "invalid-input")
        )
          return 0;
        throw error;
      }
    });
    const journal = get("PRAGMA journal_mode=DELETE")?.journal_mode;
    const locking = get("PRAGMA locking_mode=EXCLUSIVE")?.locking_mode;
    db.exec("PRAGMA synchronous=EXTRA");
    const synchronous = get("PRAGMA synchronous")?.synchronous;
    if (journal !== "delete" || locking !== "exclusive" || synchronous !== 3)
      throw new RecoveryStoreError(
        "modes-unavailable",
        "required SQLite durability modes unavailable",
      );
    db.exec("BEGIN EXCLUSIVE");
    if (seed !== undefined) {
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
      for (const resource of seed.resources ?? []) putResource(resource);
      for (const [id, body] of Object.entries(seed.types ?? {})) {
        requireText(id, "Type id");
        requireJson(body);
        run("INSERT INTO installed_types VALUES (?,?)", id, body);
      }
      for (const [name, body] of Object.entries(seed.policy ?? {})) {
        requireText(name, "policy name");
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
      throw new RecoveryStoreError("store-mismatch", "incomplete or incompatible recovery schema");
    if (
      meta("format") !== formatVersion ||
      meta("scope") !== options.scope ||
      meta("installation") !== options.installationId ||
      meta("lineage") !== options.lineageId
    )
      throw new RecoveryStoreError(
        "store-mismatch",
        "store format/Scope/installation/lineage mismatch",
      );
    if (
      !/^\d+$/.test(meta("nextRevision")) ||
      !/^\d+$/.test(meta("nextIdentity")) ||
      !meta("namespace")
    )
      throw new RecoveryStoreError("integrity", "invalid allocation recovery state");
    if (
      get("PRAGMA quick_check")?.quick_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length !== 0
    )
      throw new RecoveryStoreError("integrity", "store integrity check failed");
    if (
      get(
        "SELECT r.id FROM resources r LEFT JOIN identities i ON i.id=r.id WHERE i.id IS NULL OR i.kind<>r.kind LIMIT 1",
      )
    )
      throw new RecoveryStoreError("integrity", "resource identity history incomplete");
    const recoveredClaims = Number(run("DELETE FROM key_state WHERE state='claimed'").changes);
    // A genuine startup write obtains and retains ownership even on an empty sweep.
    run("UPDATE metadata SET value=value WHERE name='format'");
    startupCommitAttempted = true;
    db.exec("COMMIT");
    runtime = Object.freeze({
      node: process.version,
      executable: process.execPath,
      sqlite: String(get("SELECT sqlite_version() AS version")?.version),
      journalMode: String(journal),
      lockingMode: String(locking),
      synchronous: Number(synchronous),
      recoveredClaims,
      filesystemType,
    });
  } catch (error) {
    let rolledBack = false;
    let safelyClosed = false;
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
      rolledBack = !db.isTransaction;
    } finally {
      db.close();
      safelyClosed = true;
      // Only this invocation's exclusively created, uncommitted database is disposable.
      // A failed/uncertain commit, failed rollback/close, or leftover journal is preserved.
      if (
        createdFile &&
        !startupCommitAttempted &&
        rolledBack &&
        safelyClosed &&
        !existsSync(`${filename}-journal`)
      )
        unlinkSync(filename);
    }
    throw error;
  }

  const checkAdmission = (admission: Admission, key?: string) => {
    if (!admissions.has(admission))
      throw new RecoveryStoreError(
        "invalid-admission",
        "admission is not owned by this store handle",
      );
    requireText(admission.attemptId, "attemptId");
    requireText(admission.principal, "principal");
    if (key !== undefined && !admission.keys.includes(key))
      throw new RecoveryStoreError("invalid-admission", "key was not in the admitted carrier");
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
            if (!valid) throw new RecoveryStoreError("expired-facade", "expired read facade");
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
      const carrierKeys = Object.freeze([...keys]);
      requireText(principal, "principal");
      if (carrierKeys.length === 0 || new Set(carrierKeys).size !== carrierKeys.length)
        throw new RecoveryStoreError("invalid-input", "carrier keys must be nonempty and unique");
      for (const key of carrierKeys) requireText(key, "idempotency key");
      return transaction(() => {
        const states = Object.freeze(carrierKeys.map((key) => keyState(principal, key)));
        if (validate) rejectAsync(validate(states));
        const attemptId = randomUUID();
        for (let index = 0; index < carrierKeys.length; index++)
          if (states[index]?.kind === "unknown")
            run(
              "INSERT INTO key_state(principal,key,state,owner) VALUES (?,?,'claimed',?)",
              principal,
              carrierKeys[index] as string,
              attemptId,
            );
        const admission = Object.freeze({
          attemptId,
          principal,
          keys: carrierKeys,
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
          if (!valid)
            throw new RecoveryStoreError("expired-facade", "expired member transaction facade");
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
              throw new RecoveryStoreError(
                "incident-links",
                "live incident Link prevents deletion",
              );
            run("DELETE FROM resources WHERE id=?", id);
          },
          putAlias(aliasPathBeneathRoot, beadId) {
            check();
            requireText(aliasPathBeneathRoot, "alias path");
            if (
              get(
                "SELECT id FROM identities WHERE kind='bead' AND id=?",
                `beads/${aliasPathBeneathRoot}`,
              )
            )
              throw new RecoveryStoreError(
                "alias-path-committed",
                "alias collides with committed Bead path",
              );
            if (get("SELECT kind FROM resources WHERE id=?", beadId)?.kind !== "bead")
              throw new RecoveryStoreError(
                "alias-target-not-live",
                "alias target must be a live Bead",
              );
            run(
              "INSERT INTO aliases VALUES (?,?) ON CONFLICT(path) DO UPDATE SET bead_id=excluded.bead_id",
              aliasPathBeneathRoot,
              beadId,
            );
          },
          deleteAlias(aliasPathBeneathRoot) {
            check();
            run("DELETE FROM aliases WHERE path=?", aliasPathBeneathRoot);
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
            if (kind !== "bead" && kind !== "link")
              throw new RecoveryStoreError("invalid-input", "invalid Resource kind");
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
          throw new RecoveryStoreError(
            "retention-too-short",
            "outcome retention is shorter than the promised minimum",
          );
        const fingerprint = recoveryIdentityFingerprint(decision.semanticIdentityJson);
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
        if (changed !== 1)
          throw new RecoveryStoreError("lost-claim", "member lost claim ownership");
        return { kind: "completed", outcomeJson: decision.outcomeJson };
      });
    },
    releaseOwnedClaim(admission, key) {
      checkAdmission(admission, key);
      return transaction(
        () =>
          Number(
            run(
              "DELETE FROM key_state WHERE principal=? AND key=? AND owner=? AND state='claimed'",
              admission.principal,
              key,
              admission.attemptId,
            ).changes,
          ) === 1,
      );
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
      if (active)
        throw new RecoveryStoreError("nested-access", "cannot close inside a store callback");
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
