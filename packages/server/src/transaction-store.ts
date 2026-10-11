/** Independent private Transactional owner. Never open this format as a RU store. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseCanonicalScope, parseTypeDescriptor, type TypeDescriptor } from "@bdp/protocol";
import type { AuthorityReadReader, OwnerReadEntryResult } from "./authority-read.js";
import type { EvaluatorStoredResource } from "./resource-evaluator.js";
import {
  TransactionDevelopmentLimitError,
  assertPreparedTransaction,
  assertPreparedTransactionSequence,
  normalizeTransaction,
  evaluateTransaction,
  transactionStorageText as json,
  type PreparedTransaction,
  type PreparedTransactionSequence,
  type NormalizedTransaction,
  type TransactionMutationContext,
} from "./transaction-batch.js";

import {
  dependencyTemplate,
  compareDependencyTemplate,
  resolveDependencies,
  type CreatorFact,
  type DependencyTemplate,
  type ReferenceBindings,
} from "./transaction-dependencies.js";

interface ReceiptCore {
  readonly id: string;
  readonly status: "pending" | "completed" | "failed";
  readonly idempotencyKey: string;
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly transaction: string;
}
export type TransactionReceipt = ReceiptCore & Readonly<Record<string, unknown>>;
export interface TransactionClaim {
  readonly receipt: TransactionReceipt;
}
export type TransactionAdmission =
  | { readonly kind: "owned"; readonly claim: TransactionClaim }
  | { readonly kind: "existing"; readonly receipt: TransactionReceipt }
  | { readonly kind: "conflict" }
  | { readonly kind: "comparison-pending" };
/** Values supplied by the private receiving boundary, never callbacks in SQLite. */
export interface TransactionReceivingControls {
  readonly acceptsJson: boolean;
  readonly maximumOperations: number;
}
export type TransactionReceivingAdmission =
  | TransactionAdmission
  | { readonly kind: "not-acceptable" }
  | { readonly kind: "operation-limit" };
export function snapshotTransactionReceivingControls(
  controls: TransactionReceivingControls,
): TransactionReceivingControls {
  const acceptsJson = controls.acceptsJson,
    maximumOperations = controls.maximumOperations;
  if (
    typeof acceptsJson !== "boolean" ||
    !Number.isSafeInteger(maximumOperations) ||
    maximumOperations < 1 ||
    maximumOperations > 32
  )
    throw new TypeError("valid private receiving controls required");
  return Object.freeze({ acceptsJson, maximumOperations });
}
export interface TransactionSequenceAdmission {
  readonly memberCount: number;
}
export type TransactionSequenceTurn = {
  readonly index: number;
  readonly done: boolean;
  readonly result:
    | { readonly kind: "receipt"; readonly receipt: TransactionReceipt }
    | { readonly kind: "conflict" }
    | { readonly kind: "transient" };
};
export interface TransactionStoreOptions {
  /** New format, absolute file path in an existing disposable directory. */
  readonly file: string;
  readonly scope: string;
  readonly create: boolean;
  readonly types: readonly TypeDescriptor[];
  readonly clock?: () => number;
  /** Private maintenance cadence; not a discovery or receipt retention duration. */
  readonly maintenanceIntervalMs?: number;
  /** Test-only fault injection; not exported from the package surface. */
  readonly fault?: (
    stage:
      | "after-admission"
      | "after-effects"
      | "after-terminal"
      | "before-maintenance-commit"
      | "after-sequence-reservation"
      | "after-sequence-admission"
      | "after-dependency-resolution",
  ) => void;
}
interface Row {
  principal: string;
  key: string;
  identity: string;
  witnesses: string;
  owner: string | null;
  receipt: string;
  dependency: string | null;
}
const day = 86400000;
const format = "bdp-private-transaction-dependencies-4";
// Identity equality changed without changing the value codec. Retained keys
// require both the current identity policy and the alias-aware store format.
const identityPolicy = "transaction-dependencies-3";
const schema = `
CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE resources(id TEXT PRIMARY KEY, body TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, target TEXT) STRICT;
CREATE TABLE identities(id TEXT PRIMARY KEY) STRICT;
CREATE TABLE aliases(path TEXT PRIMARY KEY, target TEXT NOT NULL) STRICT;
CREATE TABLE receipts(principal TEXT NOT NULL, key TEXT NOT NULL, identity TEXT NOT NULL, witnesses TEXT NOT NULL, owner TEXT, receipt TEXT NOT NULL, dependency TEXT, PRIMARY KEY(principal,key)) STRICT;
CREATE TABLE creator_facts(attempt TEXT NOT NULL, member INTEGER NOT NULL, fact TEXT, PRIMARY KEY(attempt,member)) STRICT;
CREATE TABLE groups(position INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;
`;
/** Owns a single SQLite connection under persistent EXCLUSIVE locking. Admission
 * is durable separately; graph/positions/group/terminal receipt are one commit.
 * Startup retracts abandoned pending receipts instead of running requests itself.
 * Fixed all-visible private policy only; this is not an authentication boundary. */
export function openTransactionStore(options: TransactionStoreOptions) {
  const scope = parseCanonicalScope(options.scope);
  if (!path.isAbsolute(options.file))
    throw new TypeError("absolute transaction store file required");
  const descriptors = options.types.map((d) => parseTypeDescriptor(d));
  if (new Set(descriptors.map((d) => d.id)).size !== descriptors.length)
    throw new TypeError("duplicate Type");
  for (const d of descriptors) {
    if (
      d.propertiesSchema !== undefined ||
      (d.describes === "bead" && d.ownsOutgoing !== undefined)
    )
      throw new TypeError("first transaction slice supports schema-free unowned Types only");
  }
  const installed = new Map(descriptors.map((d) => [d.id, json(d)]));
  const configuration = json({
    format,
    identityPolicy,
    scope,
    types: [...installed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  });
  const clock = options.clock ?? Date.now;
  const maintenanceInterval = options.maintenanceIntervalMs ?? 1000;
  if (
    !Number.isSafeInteger(maintenanceInterval) ||
    maintenanceInterval < 1 ||
    maintenanceInterval > 2147483647
  )
    throw new TypeError("invalid maintenance interval");
  const instant = (): number => {
    const time = clock();
    if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000 - day)
      throw new TypeError("invalid authority clock");
    return time;
  };
  if (options.create) closeSync(openSync(options.file, "wx", 0o600));
  else if (!existsSync(options.file))
    throw new Error("transaction store missing; explicit provisioning required");
  const db = new DatabaseSync(options.file);
  let closed = false,
    busy = false;
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  let maintenanceFailure: { readonly cause: unknown } | undefined;
  let ownerFailure: Error | undefined;
  const claims = new WeakMap<
    TransactionClaim,
    {
      principal: string;
      key: string;
      owner: string;
      normalized: NormalizedTransaction | undefined;
      creator?: { attempt: string; member: number; operation: string };
    }
  >();
  const sequenceAdmissions = new WeakMap<
    TransactionSequenceAdmission,
    {
      principal: string;
      id: string;
      sequence: PreparedTransactionSequence;
      owned: Map<number, TransactionClaim>;
      next: number;
      cancelled: boolean;
      busy: boolean;
    }
  >();
  function ownedClaim(claim: TransactionClaim | undefined) {
    const value = claim && claims.get(claim);
    if (!value) throw new Error("lost transaction owner");
    return value;
  }
  function enter<T>(run: () => T): T {
    if (ownerFailure) throw ownerFailure;
    if (maintenanceFailure)
      throw new Error("transaction maintenance failed; owner fenced", maintenanceFailure);
    if (closed || busy) throw new Error("transaction store closed or reentrant");
    busy = true;
    try {
      return run();
    } finally {
      busy = false;
    }
  }
  function fence(cause: unknown): Error {
    clearInterval(maintenanceTimer);
    // Cleanup can add the original application error to an earlier storage
    // failure. Replace the wrapper; mutating its cause would create a cycle.
    ownerFailure = new Error("transaction storage failure; owner fenced; reopen before use", {
      cause,
    });
    return ownerFailure;
  }
  function atomic<T>(run: () => T): T {
    if (ownerFailure) throw ownerFailure;
    let committing = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      const value = run();
      committing = true;
      db.exec("COMMIT");
      return value;
    } catch (error) {
      let cleanRollback = false;
      let cause: unknown = error;
      try {
        if (db.isTransaction) {
          db.exec("ROLLBACK");
          cleanRollback = !db.isTransaction;
        }
      } catch (rollback) {
        cause = new AggregateError([error, rollback], "transaction and rollback failed");
      }
      const sqlite =
        error instanceof Error && "code" in error && String(error.code).startsWith("ERR_SQLITE");
      const constraint =
        sqlite &&
        "errcode" in error &&
        typeof error.errcode === "number" &&
        Number.isInteger(error.errcode) &&
        (error.errcode & 0xff) === 19;
      // Even a COMMIT that throws after taking effect has an uncertain outcome.
      // Reopen determines its durable state; compensation must not guess at it.
      if (committing || !cleanRollback || (sqlite && !constraint)) throw fence(cause);
      throw error;
    }
  }
  function cleanupThenThrow(error: unknown, cleanup: () => void): never {
    if (ownerFailure) throw error;
    try {
      cleanup();
    } catch (failure) {
      const combined = new AggregateError([error, failure], "transaction and cleanup failed");
      fence(combined);
      throw combined;
    }
    throw error;
  }
  function metadata(name: string): string {
    const row = db.prepare("SELECT value FROM metadata WHERE name=?").get(name);
    if (typeof row?.value !== "string") throw new Error("missing transaction metadata");
    return row.value;
  }
  function row(principal: string, key: string): Row | undefined {
    return db.prepare("SELECT * FROM receipts WHERE principal=? AND key=?").get(principal, key) as
      | Row
      | undefined;
  }
  function parseReceipt(value: string): TransactionReceipt {
    return JSON.parse(value) as TransactionReceipt;
  }
  /** Only terminal detail expires. A pending receipt is governed by ownership
   * and recovery, not the detail-retention clock. Exact key identity stays bound
   * for completed transactions, including committed no-op transactions. */
  function expireRow(
    stored: Row,
    now: number,
  ): { readonly row?: Row; readonly change?: "completedExpired" | "failedForgotten" } {
    if (stored.owner !== null) return { row: stored };
    const receipt = parseReceipt(stored.receipt);
    if (receipt.detail === "expired") return { row: stored };
    const expires = typeof receipt.expiresAt === "string" ? Date.parse(receipt.expiresAt) : NaN;
    if (
      receipt.detail !== "available" ||
      !Number.isSafeInteger(expires) ||
      (receipt.status !== "completed" && receipt.status !== "failed")
    )
      throw new Error("invalid terminal receipt retention state");
    // expiresAt promises availability through its instant; disposal happens after.
    if (now <= expires) return { row: stored };
    if (receipt.status === "failed") {
      db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner IS NULL").run(
        stored.principal,
        stored.key,
      );
      return { change: "failedForgotten" };
    }
    if (!Array.isArray(receipt.results) || receipt.next !== null)
      throw new Error("unsupported retained receipt results");
    const allocated: unknown[] = [];
    for (const result of receipt.results as Record<string, unknown>[]) {
      if (result.outcome !== "created") continue;
      // Alias creation allocates a locator, not a Resource identity. Its receipt
      // still expires, but its compact allocation list is empty (T49).
      if (typeof result.alias === "string" && typeof result.target === "string") {
        if (result.resource !== undefined || result.operationIndex !== 0)
          throw new Error("invalid retained alias creation result");
        continue;
      }
      const resource = result.resource as { id?: unknown; type?: unknown } | undefined;
      if (
        !resource ||
        typeof resource.id !== "string" ||
        typeof resource.type !== "string" ||
        !Number.isSafeInteger(result.operationIndex)
      )
        throw new Error("invalid retained creation result");
      allocated.push({
        operationIndex: result.operationIndex,
        ...(result.operationName === undefined ? {} : { operationName: result.operationName }),
        id: resource.id,
        type: resource.type,
      });
    }
    // Preserve the original disposition, namespace, positions and creation facts;
    // do not recompute from the current graph or a retried request's labels.
    const compact: TransactionReceipt = {
      id: receipt.id,
      status: "completed",
      detail: "expired",
      idempotencyKey: receipt.idempotencyKey,
      scopeEpoch: receipt.scopeEpoch,
      authorizationView: receipt.authorizationView,
      transaction: receipt.transaction,
      requiredPosition: receipt.requiredPosition,
      ...(receipt.effectPosition === undefined ? {} : { effectPosition: receipt.effectPosition }),
      allocated,
    };
    const receiptText = json(compact);
    db.prepare("UPDATE receipts SET receipt=? WHERE principal=? AND key=? AND owner IS NULL").run(
      receiptText,
      stored.principal,
      stored.key,
    );
    return { row: { ...stored, receipt: receiptText }, change: "completedExpired" };
  }
  function sweep(now: number) {
    const counts = { completedExpired: 0, failedForgotten: 0 };
    // This private composition has no population/workload qualification. Keep
    // only rows whose detail can expire in the scan; compact receipts stay bound.
    for (const stored of db
      .prepare(
        "SELECT * FROM receipts WHERE owner IS NULL AND json_extract(receipt,'$.detail')='available'",
      )
      .all() as unknown as Row[]) {
      const result = expireRow(stored, now);
      if (result.change) counts[result.change]++;
    }
    options.fault?.("before-maintenance-commit");
    return counts;
  }
  function maintain() {
    return enter(() => atomic(() => sweep(instant())));
  }
  let recoveredPending: number;
  try {
    db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; PRAGMA busy_timeout=0",
    );
    recoveredPending = atomic(() => {
      if (options.create) {
        db.exec(schema);
        const put = db.prepare("INSERT INTO metadata VALUES(?,?)");
        put.run("configuration", configuration);
        put.run("epoch", randomUUID());
        put.run("position", "0");
      } else {
        const storedConfiguration = metadata("configuration");
        if (JSON.parse(storedConfiguration).identityPolicy !== identityPolicy)
          throw new Error(
            "transaction identity policy mismatch; explicit new-store provisioning required",
          );
        if (storedConfiguration !== configuration)
          throw new Error("transaction installation mismatch");
      }
      const retracted = Number(
        db.prepare("DELETE FROM receipts WHERE owner IS NOT NULL").run().changes,
      );
      db.exec("DELETE FROM creator_facts");
      sweep(instant());
      return retracted;
    });
  } catch (error) {
    db.close();
    if (options.create) unlinkSync(options.file);
    throw error;
  }
  const epoch = metadata("epoch"),
    view = "development-all-visible";
  // Immutable installation facts are the same ones used by mutation evaluation.
  // No named policy registry exists in this fixed all-visible development owner.
  const readConfiguration = Object.freeze({
    scopeEpoch: epoch,
    authorizationView: view,
    installedTypes: Object.freeze(descriptors),
    scopeConfiguration: Object.freeze({
      policyIdentity: view,
      configurationIdentity: configuration,
      maximumEndpointMultiplicity: Object.freeze([]),
    }),
  });
  function withRead<T>(callback: (reader: AuthorityReadReader) => T): OwnerReadEntryResult<T> {
    if (busy)
      return {
        kind: "entry-refused",
        reason: "reentrant",
        cause: new Error("transaction store reentrant read"),
      };
    if (ownerFailure || maintenanceFailure || closed)
      return {
        kind: "entry-refused",
        reason: "not-accepting",
        cause:
          ownerFailure ?? new Error("transaction store not accepting reads", maintenanceFailure),
      };
    return enter(() => {
      let active = true;
      const check = () => {
        if (!active) throw new Error("expired transaction reader");
      };
      const immutableResource = (id: string) => {
        const row = resource(id);
        return row === undefined ? undefined : Object.freeze(row);
      };
      const reader: AuthorityReadReader = Object.freeze({
        resource(id: string) {
          check();
          return immutableResource(id);
        },
        resources() {
          check();
          return Object.freeze(
            db
              .prepare("SELECT id FROM resources ORDER BY id")
              .all()
              .map((row) => Object.freeze(requiredResource(String(row.id)))),
          );
        },
        incidentLinks(id: string) {
          check();
          return Object.freeze(
            db
              .prepare(
                "SELECT id FROM resources WHERE kind='link' AND (source=? OR target=?) ORDER BY id",
              )
              .all(id, id)
              .map((row) => Object.freeze(requiredResource(String(row.id)))),
          );
        },
        alias(path: string) {
          check();
          return alias(path);
        },
        policy(_name: string) {
          check();
          return undefined;
        },
      });
      try {
        const value = callback(reader);
        if (
          value !== null &&
          (typeof value === "object" || typeof value === "function") &&
          "then" in value &&
          typeof value.then === "function"
        ) {
          // Observe forbidden asynchronous work; it cannot retain a live reader.
          void Promise.resolve(value).catch(() => {});
          throw new Error("transaction read callbacks must be synchronous");
        }
        return Object.freeze({ kind: "read", value });
      } finally {
        active = false;
      }
    });
  }
  function resource(id: string): EvaluatorStoredResource | undefined {
    const found = db.prepare("SELECT * FROM resources WHERE id=?").get(id);
    if (!found) return undefined;
    return found.kind === "bead"
      ? { id: String(found.id), kind: "bead", bodyJson: String(found.body) }
      : {
          id: String(found.id),
          kind: "link",
          bodyJson: String(found.body),
          source: String(found.source),
          target: String(found.target),
        };
  }
  function alias(path: string): string | undefined {
    const found = db.prepare("SELECT target FROM aliases WHERE path=?").get(path);
    return found ? String(found.target) : undefined;
  }
  function requiredResource(id: string): EvaluatorStoredResource {
    const found = resource(id);
    if (!found) throw new Error("indexed Resource missing");
    return found;
  }
  function checkPrincipalKey(principal: string, key: string): void {
    if (
      typeof principal !== "string" ||
      principal.length === 0 ||
      !principal.isWellFormed() ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(key)
    )
      throw new TypeError("principal/key required");
  }
  function resolveAlias(locator: string): string | undefined {
    const target = alias(locator.slice(scope.length + 6));
    return target === undefined ? undefined : `${scope}${target}`;
  }
  function creatorFact(operation: string, receipt?: TransactionReceipt): CreatorFact {
    if (!receipt || receipt.status === "failed") return { kind: "unbound" };
    if (receipt.status === "pending") return { kind: "transient" };
    const entry =
      receipt.detail === "expired"
        ? (receipt.allocated as { id: string; type: string }[])[0]
        : (receipt.results as { resource: { id: string } }[])[0]?.resource;
    if (!entry || typeof entry.id !== "string") throw new Error("creator lost allocation");
    return {
      kind: "bound",
      id: entry.id,
      resourceKind: operation === "createBead" ? "bead" : "link",
    };
  }
  function writeFact(attempt: string, member: number, fact: CreatorFact): void {
    const changed = db
      .prepare("UPDATE creator_facts SET fact=? WHERE attempt=? AND member=? AND fact IS NULL")
      .run(json(fact), attempt, member);
    if (changed.changes !== 1) throw new Error("creator fact absent or already resolved");
  }
  function fact(attempt: string, member: number): CreatorFact {
    const stored = db
      .prepare("SELECT fact FROM creator_facts WHERE attempt=? AND member=?")
      .get(attempt, member);
    if (typeof stored?.fact !== "string") throw new Error("creator turn not resolved");
    return JSON.parse(stored.fact) as CreatorFact;
  }
  /** Caller holds the one SQLite transaction. Sequence turns project foreign
   * pending ownership before comparison, unlike direct singleton/batch routes. */
  function admitKey(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    pendingWins?: boolean,
    references?: ReferenceBindings,
    template?: DependencyTemplate,
  ): TransactionAdmission;
  function admitKey(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    pendingWins: boolean,
    references: ReferenceBindings | undefined,
    template: DependencyTemplate | undefined,
    controls: TransactionReceivingControls | undefined,
  ): TransactionReceivingAdmission;
  function admitKey(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    pendingWins = false,
    references?: ReferenceBindings,
    template?: DependencyTemplate,
    controls?: TransactionReceivingControls,
  ): TransactionReceivingAdmission {
    const stored = row(principal, key);
    const prior = stored ? expireRow(stored, instant()).row : undefined;
    if (pendingWins && prior?.owner !== null && prior !== undefined)
      return { kind: "existing", receipt: parseReceipt(prior.receipt) };
    if (prior?.dependency) {
      const template = JSON.parse(prior.dependency) as DependencyTemplate;
      const comparison = compareDependencyTemplate(template, batch, resolveAlias, (index) => {
        const stored = db
          .prepare("SELECT fact FROM creator_facts WHERE attempt=? AND member=?")
          .get(template.attempt, index);
        if (!stored) throw new Error("unresolved receipt lost creator fact");
        return typeof stored.fact === "string"
          ? (JSON.parse(stored.fact) as CreatorFact)
          : undefined;
      });
      return comparison === "conflict"
        ? { kind: "conflict" }
        : comparison === "equal"
          ? { kind: "existing", receipt: parseReceipt(prior.receipt) }
          : { kind: "comparison-pending" };
    }
    const normalized = template
      ? undefined
      : normalizeTransaction(batch, resolveAlias, prior?.witnesses, references);
    if (prior) {
      if (!normalized) throw new Error("existing key cannot acquire a new unresolved template");
      return prior.identity !== normalized.identity
        ? { kind: "conflict" }
        : { kind: "existing", receipt: parseReceipt(prior.receipt) };
    }
    // Prior-key equality/conflict wins above. Only an unknown key pays fresh
    // admission controls, and no refusal ever inserts a receipt or owner.
    if (controls && batch.carrier.operations.length > controls.maximumOperations)
      return { kind: "operation-limit" };
    if (controls && !controls.acceptsJson) return { kind: "not-acceptable" };
    const receipt: TransactionReceipt = {
      id: `${scope}receipts/${randomUUID()}`,
      status: "pending",
      idempotencyKey: key,
      scopeEpoch: epoch,
      authorizationView: view,
      transaction: randomUUID(),
    };
    const owner = randomUUID(),
      claim = Object.freeze({ receipt });
    db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)").run(
      principal,
      key,
      normalized?.identity ?? "",
      normalized?.witnessesJson ?? "",
      owner,
      json(receipt),
      template ? json(template) : null,
    );
    claims.set(claim, { principal, key, owner, normalized });
    return { kind: "owned", claim };
  }
  function executeClaim(claim: TransactionClaim): TransactionReceipt {
    return enter(() => {
      const owned = claims.get(claim);
      if (!owned) throw new Error("foreign transaction claim");
      try {
        return atomic(() => {
          const current = row(owned.principal, owned.key);
          if (current?.owner !== owned.owner) throw new Error("transaction execution fenced");
          const normalized = owned.normalized;
          if (!normalized || current.dependency) throw new Error("unresolved execution");
          const core = parseReceipt(current.receipt);
          const previous = Number(metadata("position"));
          if (
            !Number.isSafeInteger(previous) ||
            previous < 0 ||
            previous === Number.MAX_SAFE_INTEGER
          )
            throw new Error("position allocation unsafe");
          const position = `pos-${previous + 1}`,
            now = instant();
          let active = true;
          function scoped<T>(fn: () => T): T {
            if (!active) throw new Error("expired Resource transaction");
            return fn();
          }
          const tx: TransactionMutationContext = {
            resource: (id) => scoped(() => resource(id)),
            incidentLinks: (id) =>
              scoped(() =>
                db
                  .prepare("SELECT id FROM resources WHERE kind='link' AND (source=? OR target=?)")
                  .all(id, id)
                  .map((r) => requiredResource(String(r.id))),
              ),
            outgoingLinks: (id) =>
              scoped(() =>
                db
                  .prepare("SELECT id FROM resources WHERE kind='link' AND source=?")
                  .all(id)
                  .map((r) => requiredResource(String(r.id))),
              ),
            identityWasCommitted: (id) =>
              scoped(
                () => db.prepare("SELECT id FROM identities WHERE id=?").get(id) !== undefined,
              ),
            alias: (path) => scoped(() => alias(path)),
            putAlias: (path, target) =>
              scoped(() => {
                db.prepare(
                  "INSERT INTO aliases VALUES(?,?) ON CONFLICT(path) DO UPDATE SET target=excluded.target",
                ).run(path, target);
              }),
            deleteAlias: (path) =>
              scoped(() => {
                db.prepare("DELETE FROM aliases WHERE path=?").run(path);
              }),
            installedType: (id) => scoped(() => installed.get(id)),
            allocateResourceId: (kind) =>
              scoped(() => {
                for (let attempt = 0; attempt < 32; attempt++) {
                  const suffix = randomUUID(),
                    id = `${kind === "bead" ? "beads" : "links"}/${suffix}`;
                  if (
                    !db.prepare("SELECT id FROM identities WHERE id=?").get(id) &&
                    (kind !== "bead" || alias(suffix) === undefined)
                  )
                    return id;
                }
                throw new Error("Resource identity allocation exhausted");
              }),
            allocateRevision: () => scoped(() => randomUUID()),
            putResource: (r) =>
              scoped(() => {
                db.prepare("INSERT OR IGNORE INTO identities VALUES(?)").run(r.id);
                db.prepare(
                  "INSERT INTO resources VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                ).run(r.id, r.bodyJson, r.kind, r.source ?? null, r.target ?? null);
              }),
            deleteResource: (id) =>
              scoped(() => {
                // Retain its identity for the epoch; deletion never permits reuse.
                db.prepare("DELETE FROM resources WHERE id=?").run(id);
              }),
          };
          db.exec("SAVEPOINT effects");
          const result = (() => {
            try {
              return evaluateTransaction(
                normalized,
                tx,
                {
                  scope,
                  contracts: {
                    get(id, bytes) {
                      const descriptor = descriptors.find((d) => d.id === id);
                      return descriptor && installed.get(id) === bytes ? { descriptor } : undefined;
                    },
                  },
                  aliasPolicy: { canRead: () => true, canWriteBead: () => true },
                  policy: { canRead: () => true, canCreate: () => true, canWrite: () => true },
                  maximumEndpointMultiplicity: [],
                  observeCommitTime: instant,
                  recordChangeContext: false,
                  limits: {
                    propertiesBytes: 65536,
                    representationBytes: 262144,
                    diagnosticCount: 16,
                    diagnosticBytes: 65536,
                  },
                },
                core.transaction,
                position,
                now,
              );
            } finally {
              active = false;
            }
          })();
          options.fault?.("after-effects");
          // The minimum starts when evaluation has become terminal, not at
          // admission or before Resource callbacks have consumed execution time.
          const expiresAt = new Date(instant() + day).toISOString();
          let receipt: TransactionReceipt;
          if (!result.ok) {
            db.exec("ROLLBACK TO effects; RELEASE effects");
            receipt = {
              ...core,
              status: "failed",
              detail: "available",
              requiredPosition: `pos-${previous}`,
              problem: result.problem,
              expiresAt,
            };
          } else {
            db.exec("RELEASE effects");
            const group = {
              scopeEpoch: epoch,
              authorizationView: view,
              checkpoint: position,
              position,
              previousPosition: `pos-${previous}`,
              projectionAdvance: false,
              transaction: core.transaction,
              changes: result.changes,
              erasures: [],
              eventCount: result.events.length,
              events: result.events,
            };
            const effective = result.events.length > 0;
            if (effective) {
              db.prepare("INSERT INTO groups VALUES(?,?)").run(previous + 1, json(group));
              db.prepare("UPDATE metadata SET value=? WHERE name='position'").run(
                String(previous + 1),
              );
            }
            receipt = {
              ...core,
              status: "completed",
              detail: "available",
              requiredPosition: effective ? position : `pos-${previous}`,
              ...(effective ? { effectPosition: position } : {}),
              results: result.results,
              next: null,
              expiresAt,
            };
          }
          const changed = db
            .prepare(
              "UPDATE receipts SET receipt=?,owner=NULL WHERE principal=? AND key=? AND owner=?",
            )
            .run(json(receipt), owned.principal, owned.key, owned.owner);
          if (changed.changes !== 1) throw new Error("terminal ownership lost");
          if (owned.creator)
            writeFact(
              owned.creator.attempt,
              owned.creator.member,
              creatorFact(owned.creator.operation, receipt),
            );
          options.fault?.("after-terminal");
          return receipt;
        });
      } catch (error) {
        // A live internal/transient abort retracts only this execution's pending
        // reservation. An abrupt process death is handled by startup instead.
        cleanupThenThrow(error, () => {
          atomic(() => {
            db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
              owned.principal,
              owned.key,
              owned.owner,
            );
          });
        });
      } finally {
        claims.delete(claim);
      }
    });
  }
  function cancelSequence(attempt: TransactionSequenceAdmission): number {
    const state = sequenceAdmissions.get(attempt);
    if (!state) throw new TypeError("foreign transaction sequence admission");
    if (state.busy) throw new Error("transaction sequence reentrant cancellation");
    if (state.cancelled || state.next === state.sequence.members.length) return 0;
    const released = enter(() =>
      atomic(() => {
        let count = 0;
        for (const claim of state.owned.values()) {
          const owner = claims.get(claim);
          if (!owner) continue;
          count += Number(
            db
              .prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?")
              .run(owner.principal, owner.key, owner.owner).changes,
          );
        }
        db.prepare("DELETE FROM creator_facts WHERE attempt=?").run(state.id);
        return count;
      }),
    );
    state.cancelled = true;
    for (const claim of state.owned.values()) claims.delete(claim);
    return released;
  }
  maintenanceTimer = setInterval(() => {
    try {
      maintain();
    } catch (cause) {
      // Background failure is sticky and observable on the next owner entry;
      // stop the timer and release the database instead of silently continuing.
      maintenanceFailure = { cause };
      clearInterval(maintenanceTimer);
      try {
        db.close();
      } catch (closeFailure) {
        maintenanceFailure = {
          cause: new AggregateError([cause, closeFailure], "maintenance and close failed"),
        };
      } finally {
        closed = true;
      }
    }
  }, maintenanceInterval);
  maintenanceTimer.unref();
  function admit(principal: string, key: string, batch: PreparedTransaction): TransactionAdmission;
  function admit(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    controls: TransactionReceivingControls,
  ): TransactionReceivingAdmission;
  function admit(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    controls?: TransactionReceivingControls,
  ): TransactionReceivingAdmission {
    const receiving = snapshotTransactionReceivingControls(
      controls ?? { acceptsJson: true, maximumOperations: 32 },
    );
    return enter(() => {
      assertPreparedTransaction(batch, scope);
      checkPrincipalKey(principal, key);
      const admission = atomic(() => {
        const result = admitKey(principal, key, batch, false, undefined, undefined, receiving);
        if (result.kind === "operation-limit" && controls === undefined)
          throw new TransactionDevelopmentLimitError("development transaction operation limit");
        return result.kind === "existing" && !receiving.acceptsJson
          ? { kind: "not-acceptable" as const }
          : result;
      });
      if (admission.kind === "owned") {
        try {
          options.fault?.("after-admission");
        } catch (error) {
          const owned = claims.get(admission.claim);
          if (!owned) throw new Error("lost admitted claim", { cause: error });
          try {
            cleanupThenThrow(error, () => {
              atomic(() => {
                db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
                  owned.principal,
                  owned.key,
                  owned.owner,
                );
              });
            });
          } finally {
            claims.delete(admission.claim);
          }
        }
      }
      return admission;
    });
  }
  return Object.freeze({
    scope,
    scopeEpoch: epoch,
    recoveredPending,
    withRead,
    readConfiguration: () => enter(() => readConfiguration),
    comparisonEpoch: () => (closed ? undefined : enter(() => metadata("epoch"))),
    maintain,
    admit,
    admitSequence(
      principal: string,
      sequence: PreparedTransactionSequence,
    ): TransactionSequenceAdmission {
      return enter(() => {
        assertPreparedTransactionSequence(sequence, scope);
        for (const member of sequence.members) checkPrincipalKey(principal, member.key);
        const owned = new Map<number, TransactionClaim>();
        const id = randomUUID();
        const attempt = Object.freeze({ memberCount: sequence.members.length });
        try {
          atomic(() => {
            for (const [index, member] of sequence.members.entries()) {
              if (member.operation === "createBead" || member.operation === "createLink")
                db.prepare("INSERT INTO creator_facts VALUES(?,?,NULL)").run(id, index);
              // Existing keys are classified only at the eligible member turn.
              const existing = row(principal, member.key);
              if (existing && expireRow(existing, instant()).row) continue;
              const template = member.dependencies.length
                ? dependencyTemplate(id, member)
                : undefined;
              const admitted = admitKey(
                principal,
                member.key,
                member.request,
                true,
                undefined,
                template,
              );
              if (admitted.kind === "owned") {
                owned.set(index, admitted.claim);
                const claim = ownedClaim(admitted.claim);
                if (member.operation === "createBead" || member.operation === "createLink")
                  claim.creator = { attempt: id, member: index, operation: member.operation };
                options.fault?.("after-sequence-reservation");
              }
            }
          });
          options.fault?.("after-sequence-admission");
        } catch (error) {
          // An admission callback can fail after the durable bulk step; cleanup
          // checks each exact owner and never retracts a competing reservation.
          try {
            cleanupThenThrow(error, () => {
              atomic(() => {
                for (const claim of owned.values()) {
                  const owner = claims.get(claim);
                  if (owner)
                    db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
                      owner.principal,
                      owner.key,
                      owner.owner,
                    );
                }
                db.prepare("DELETE FROM creator_facts WHERE attempt=?").run(id);
              });
            });
          } finally {
            for (const claim of owned.values()) claims.delete(claim);
          }
        }
        sequenceAdmissions.set(attempt, {
          principal,
          id,
          sequence,
          owned,
          next: 0,
          cancelled: false,
          busy: false,
        });
        return attempt;
      });
    },
    nextSequence(attempt: TransactionSequenceAdmission): TransactionSequenceTurn {
      const state = sequenceAdmissions.get(attempt);
      if (!state) throw new TypeError("foreign transaction sequence admission");
      if (state.cancelled || state.busy || state.next >= state.sequence.members.length)
        throw new Error("transaction sequence cancelled, reentrant or complete");
      state.busy = true;
      try {
        const index = state.next,
          member = state.sequence.members[index];
        if (!member) throw new Error("lost sequence member");
        let claim = state.owned.get(index);
        const template = member.dependencies.length
          ? dependencyTemplate(state.id, member)
          : undefined;
        const references = template
          ? enter(() => resolveDependencies(template, (index) => fact(state.id, index)))
          : new Map();
        let result: TransactionSequenceTurn["result"] | undefined;
        let wroteCreator = false;
        if (references === undefined) {
          // Dependency precedence: never classify the dependent key here.
          if (claim)
            enter(() =>
              atomic(() => {
                const owner = ownedClaim(claim);
                db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
                  owner.principal,
                  owner.key,
                  owner.owner,
                );
                if (claim) claims.delete(claim);
              }),
            );
          result = { kind: "transient" };
        } else {
          if (claim && template)
            enter(() =>
              atomic(() => {
                const owner = ownedClaim(claim);
                const current = row(owner.principal, owner.key);
                if (current?.owner !== owner.owner) throw new Error("dependent resolution fenced");
                const normalized = normalizeTransaction(
                  member.request,
                  resolveAlias,
                  undefined,
                  references,
                );
                db.prepare(
                  "UPDATE receipts SET identity=?,witnesses=?,dependency=NULL WHERE principal=? AND key=? AND owner=?",
                ).run(
                  normalized.identity,
                  normalized.witnessesJson,
                  owner.principal,
                  owner.key,
                  owner.owner,
                );
                owner.normalized = normalized;
                options.fault?.("after-dependency-resolution");
              }),
            );
          if (!claim) {
            const admission = enter(() =>
              atomic(() => admitKey(state.principal, member.key, member.request, true, references)),
            );
            if (admission.kind === "owned") {
              claim = admission.claim;
              state.owned.set(index, claim);
              if (member.operation === "createBead" || member.operation === "createLink")
                ownedClaim(claim).creator = {
                  attempt: state.id,
                  member: index,
                  operation: member.operation,
                };
            } else {
              if (admission.kind === "comparison-pending")
                throw new Error("sequence compared unresolved foreign owner");
              result =
                admission.kind === "conflict"
                  ? admission
                  : { kind: "receipt", receipt: admission.receipt };
            }
          }
          if (claim) {
            result = { kind: "receipt", receipt: executeClaim(claim) };
            wroteCreator = member.operation === "createBead" || member.operation === "createLink";
          }
        }
        const completed = result;
        if (!completed) throw new Error("sequence turn lost its disposition");
        if (
          !wroteCreator &&
          (member.operation === "createBead" || member.operation === "createLink")
        )
          enter(() =>
            atomic(() =>
              writeFact(
                state.id,
                index,
                completed.kind === "transient"
                  ? { kind: "transient" }
                  : creatorFact(
                      member.operation,
                      completed.kind === "receipt" ? completed.receipt : undefined,
                    ),
              ),
            ),
          );
        state.next++;
        const done = state.next === state.sequence.members.length;
        if (done)
          enter(() =>
            atomic(() => db.prepare("DELETE FROM creator_facts WHERE attempt=?").run(state.id)),
          );
        return { index, done, result: completed };
      } catch (error) {
        state.busy = false;
        cleanupThenThrow(error, () => {
          cancelSequence(attempt);
        });
      } finally {
        state.busy = false;
      }
    },
    cancelSequence,
    execute: executeClaim,
    retract(claim: TransactionClaim): boolean {
      return enter(() => {
        const owned = claims.get(claim);
        if (!owned) return false;
        return atomic(
          () =>
            Number(
              db
                .prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?")
                .run(owned.principal, owned.key, owned.owner).changes,
            ) === 1,
        );
      });
    },
    receipt(principal: string, id: string): TransactionReceipt | undefined {
      return enter(() =>
        atomic(() => {
          for (const stored of db
            .prepare("SELECT * FROM receipts WHERE principal=?")
            .all(principal) as unknown as Row[]) {
            const value = parseReceipt(stored.receipt);
            if (value.id !== id) continue;
            const remaining = expireRow(stored, instant()).row;
            return remaining ? parseReceipt(remaining.receipt) : undefined;
          }
          return undefined;
        }),
      );
    },
    /** Private diagnostic of authority locator state, not a replica projection. */
    aliasTarget(path: string): string | undefined {
      return enter(() => {
        const target = alias(path);
        return target === undefined ? undefined : `${scope}${target}`;
      });
    },
    inspect() {
      return enter(() => ({
        resources: db
          .prepare("SELECT body FROM resources ORDER BY id")
          .all()
          .map((r) => JSON.parse(String(r.body)) as unknown),
        groups: db
          .prepare("SELECT body FROM groups ORDER BY position")
          .all()
          .map((r) => JSON.parse(String(r.body)) as unknown),
        identities: db
          .prepare("SELECT id FROM identities ORDER BY id")
          .all()
          .map((r) => String(r.id)),
        position: metadata("position"),
      }));
    },
    close() {
      if (busy) throw new Error("transaction store reentrant close");
      clearInterval(maintenanceTimer);
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  });
}
