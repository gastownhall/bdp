import {
  TRANSACTION_REQUEST_FINGERPRINT,
  storedTransactionFingerprint,
} from "./transaction-request-identity.js";
import {
  INITIAL_TRANSACTION_VIEW,
  initialTransactionAuthorization,
  emptyTransactionAuthorization,
  parseTransactionAuthorization,
  projectTransactionReceipt,
  projectTransactionEntry,
  TransactionAuthorizationFailure,
  type TransactionAuthorizationSnapshot,
  type TransactionAuthorizationLease,
} from "./transaction-authorization.js";
import { transactionSelectorCapacity, type TransactionSelectorLimit } from "./transaction-set.js";
import {
  TRANSACTION_SNAPSHOT_LIMITS,
  TRANSACTION_SNAPSHOT_TOKEN_POLICY,
  transactionSnapshotSchema,
  transactionSnapshotStorage,
  TransactionSnapshotFailure,
  type TransactionSnapshotRequest,
} from "./transaction-snapshot.js";
import {
  checkpointPosition,
  transactionCheckpoint,
  TransactionChangefeedParameterError,
  projectTransactionChangeGroup,
  freezeChangefeedPage,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";
import {
  TRANSACTION_EVENT_PAGE_BYTES,
  TRANSACTION_EVENT_STREAM,
  TRANSACTION_EVENT_GROUP_BYTES,
  TransactionEventParameterError,
  TransactionEventProjectionGap,
  transactionEventRequest,
  parseTransactionEventCursor,
  checkTransactionEventCursor,
  projectTransactionEventGroup,
  eventContinuation,
  freezeEventPage,
  type TransactionEventPage,
  type TransactionEventSource,
} from "./transaction-events.js";
import {
  TransactionMinimumFailure,
  checkCurrentReadMinimum,
  checkTransactionMinimum,
  TransactionMinimumUnsupported,
  snapshotCurrentReadMinimum,
  snapshotTransactionMinimum,
  type TransactionMinimum,
} from "./transaction-consistency.js";
/** Independent private Transactional owner. Never open this format as a RU store. */
import { randomUUID } from "node:crypto";
import { applyNativeTransactionRestore } from "./transaction-restore.js";
import {
  transactionErasureSchema,
  retainErasureVersions,
  transactionErasureLedger,
  planHistoricalErasure,
  eraseReceiptEntry,
  erasedContentEvent,
  erasureSourceTag,
  type HistoricalErasureSubject,
} from "./transaction-erasure.js";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { parseCanonicalScope, parseTypeDescriptor, type TypeDescriptor } from "@bdp/protocol";
import { assertDevelopmentContracts, type DevelopmentContracts } from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import type { AuthorityReadReader, OwnerReadEntryResult, ReadPrincipal } from "./authority-read.js";
import { readStoredResource, type EvaluatorStoredResource } from "./resource-evaluator.js";
import { liveOwnedLinkEvents } from "./transaction-live-owned-link.js";
import { validateLiveBeadCorrection, liveCorrectionEvent } from "./transaction-live-correction.js";
import {
  validateLiveLinkCorrection,
  prepareLiveLinkTombstone,
} from "./transaction-live-link-erasure.js";
import { prepareLiveBeadTombstone } from "./transaction-live-tombstone.js";
import {
  TransactionDevelopmentLimitError,
  TRANSACTION_RUNTIME_LIMITS,
  TRANSACTION_MAXIMUM_OPERATIONS,
  assertPreparedTransaction,
  assertPreparedTransactionSequence,
  normalizeTransaction,
  transactionRequestFingerprint,
  commitTransactionWitnesses,
  evaluateTransaction,
  transactionStorageText as json,
  type PreparedTransaction,
  type PreparedTransactionSequence,
  type NormalizedTransaction,
  type TransactionMutationContext,
  type TransactionEvent,
} from "./transaction-batch.js";

import {
  dependencyTemplate,
  parseDependencyTemplate,
  compareDependencyTemplate,
  resolveDependencies,
  type CreatorFact,
  type DependencyTemplate,
  type ReferenceBindings,
} from "./transaction-dependencies.js";

/** Freeze the complete parsed receipt graph without recursive depth limits. */
function freezeReceiptValue(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (node !== null && typeof node === "object") {
      for (const child of Object.values(node)) pending.push(child);
      Object.freeze(node);
    }
  }
}

// eventPacket structurally reads one group; changing the captured bound must
// fail closed until that algorithm and its count evidence are deliberately revised.
if (TRANSACTION_EVENT_STREAM.maximumGroupsPerObservation !== 1)
  throw new Error("owner scan implements exactly one group per entry");

/** Actual fixed-view owner observation; not a receipt effect checkpoint. */
export type TransactionReadContext = {
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly scopePosition: string;
};
/** Expected erasure publication cancellation, distinct from an owner failure. */
export class TransactionErasureFence extends Error {}
export interface TransactionChangePublication {
  readonly signal: AbortSignal;
  publish(checkpoint: string, write: () => boolean): boolean;
  release(): void;
}

/** Source-private immutable read continuation, authenticated by its owner. */
declare const eventScanBrand: unique symbol;
export interface TransactionEventScan {
  readonly [eventScanBrand]: true;
}
export interface TransactionEventPacket {
  readonly kind: "packet";
  readonly context: TransactionReadContext;
  readonly events: readonly TransactionEvent[];
  readonly scan: TransactionEventScan;
  readonly caughtUp: boolean;
}
interface EventScanState {
  readonly source: TransactionEventSource;
  readonly context: TransactionReadContext;
  readonly at: number;
  readonly ordinal: number;
  readonly head: number;
}

interface ReceiptCore {
  readonly id: string;
  readonly status: "pending" | "completed" | "failed";
  readonly idempotencyKey: string;
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly transaction: string;
}
export type TransactionReceipt = ReceiptCore & Readonly<Record<string, unknown>>;
export interface TransactionReceiptObservation {
  readonly receipt: TransactionReceipt;
  readonly context: TransactionReadContext;
}
export interface TransactionClaim {
  readonly receipt: TransactionReceipt;
}
export type TransactionAdmission =
  | { readonly kind: "owned"; readonly claim: TransactionClaim }
  | {
      readonly kind: "existing";
      readonly receipt: TransactionReceipt;
      readonly context?: TransactionReadContext;
    }
  | { readonly kind: "conflict"; readonly context?: TransactionReadContext }
  | { readonly kind: "comparison-pending" };
/** Values supplied by the private receiving boundary, never callbacks in SQLite. */
export interface TransactionReceivingControls {
  readonly acceptsJson: boolean;
  readonly maximumOperations: number;
}
export type TransactionReceivingAdmission =
  | TransactionAdmission
  | { readonly kind: "not-acceptable"; readonly context?: TransactionReadContext }
  | { readonly kind: "operation-limit"; readonly context?: TransactionReadContext }
  | {
      readonly kind: "selector-limit";
      readonly limit: TransactionSelectorLimit;
      readonly pointer: string;
      readonly context?: TransactionReadContext;
    };
export function snapshotTransactionReceivingControls(
  controls: TransactionReceivingControls,
): TransactionReceivingControls {
  const acceptsJson = controls.acceptsJson,
    maximumOperations = controls.maximumOperations;
  if (
    typeof acceptsJson !== "boolean" ||
    !Number.isSafeInteger(maximumOperations) ||
    maximumOperations < 1 ||
    maximumOperations > TRANSACTION_MAXIMUM_OPERATIONS
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
  /** Source-private OFFLINE native restore; existing current destination required. */
  readonly nativeRestore?: string;
  readonly types: readonly TypeDescriptor[];
  readonly contracts?: DevelopmentContracts;
  readonly clock?: () => number;
  readonly receiptMaximumItems?: number;
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
      | "after-dependency-resolution"
      | "after-snapshot-copy"
      | "after-snapshot-commit"
      | "before-policy-commit"
      | "after-policy-commit"
      | "before-erasure-commit"
      | "after-erasure-commit"
      | "before-restore-commit"
      | "after-restore-commit",
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
const requestFingerprintPolicy = TRANSACTION_REQUEST_FINGERPRINT;
const day = 86400000;
export const TRANSACTION_RECEIPT_DETAIL_MS = day;
const format = "bdp-private-transaction-snapshot-12";
// Identity equality changed without changing the value codec. Retained keys
// require both the current identity policy and the alias-aware store format.
const identityPolicy = "transaction-revision-provenance-4";
const schema = `
CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE resources(id TEXT PRIMARY KEY, body TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, target TEXT) STRICT;
CREATE TABLE identities(id TEXT PRIMARY KEY) STRICT;
CREATE TABLE aliases(path TEXT PRIMARY KEY, target TEXT NOT NULL) STRICT;
CREATE TABLE receipts(principal TEXT NOT NULL, key TEXT NOT NULL, identity TEXT NOT NULL, witnesses TEXT NOT NULL, owner TEXT, receipt TEXT NOT NULL, dependency TEXT, PRIMARY KEY(principal,key)) STRICT;
CREATE TABLE receipt_pages(receipt TEXT PRIMARY KEY, principal TEXT NOT NULL, key TEXT NOT NULL, entries INTEGER NOT NULL, maximum INTEGER NOT NULL) STRICT;
CREATE TABLE receipt_page_ranges(token TEXT PRIMARY KEY, receipt TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, UNIQUE(receipt,start)) STRICT;
CREATE TABLE creator_facts(attempt TEXT NOT NULL, member INTEGER NOT NULL, fact TEXT, PRIMARY KEY(attempt,member)) STRICT;
CREATE TABLE groups(position INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;
${transactionSnapshotSchema}
`;
/** Shared private page bound, validated before provisioning or recovery. */
export function transactionReceiptMaximum(value: number = TRANSACTION_MAXIMUM_OPERATIONS): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError("positive receipt page maximum required");
  return value;
}
export interface TransactionReceiptPage {
  readonly receipt: string;
  readonly results: readonly unknown[];
  readonly next: string | null;
}
interface ReceiptPagePlan {
  readonly entries: number;
  readonly maximum: number;
  readonly pages: readonly {
    readonly token: string;
    readonly start: number;
    readonly end: number;
  }[];
}
/** Owns a single SQLite connection under persistent EXCLUSIVE locking. Admission
 * is durable separately; graph/positions/group/terminal receipt are one commit.
 * Startup retracts abandoned pending receipts instead of running requests itself.
 * Private Scope policy; this is not an authentication boundary. */
export function openTransactionStore(options: TransactionStoreOptions) {
  if (options.nativeRestore !== undefined && options.create)
    throw new Error("native restore requires an existing permanent anchor");
  const scope = parseCanonicalScope(options.scope);
  const view = INITIAL_TRANSACTION_VIEW;
  let authorization: TransactionAuthorizationSnapshot = initialTransactionAuthorization();
  const leases = new Set<AbortController>();
  const readAuthorizations = new WeakMap<AuthorityReadReader, TransactionAuthorizationSnapshot>();
  const activeSequences = new Set<TransactionSequenceAdmission>();
  let mutationPause: object | undefined;
  const revokeLeases = () => {
    for (const lease of leases) lease.abort(new Error("authorization lease ended"));
    leases.clear();
    for (const state of changePublications.values())
      state.controller.abort(new Error("owner lease ended"));
    changePublications.clear();
  };
  if (Buffer.byteLength(json(`${scope}events/`)) > TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes)
    throw new TypeError("transaction Scope exceeds private materialization bound");
  if (!path.isAbsolute(options.file))
    throw new TypeError("absolute transaction store file required");
  const compiled = options.contracts;
  if (compiled !== undefined) assertDevelopmentContracts(compiled);
  const descriptors = options.types.map((d) => parseTypeDescriptor(d));
  if (compiled && descriptors.some((d) => !d.id.startsWith(`${scope}types/`)))
    throw new TypeError("compiled transaction Types must be Scope-local");
  if (new Set(descriptors.map((d) => d.id)).size !== descriptors.length)
    throw new TypeError("duplicate Type");
  for (const d of descriptors) {
    if (d.propertiesSchema !== undefined && !compiled)
      throw new TypeError("transaction store requires compiled schemas");
  }
  const installed = new Map(descriptors.map((d) => [d.id, json(d)]));
  if (
    compiled &&
    (descriptors.length !== compiled.descriptors.length ||
      descriptors.some((d) => compiled.types[d.id] !== installed.get(d.id)))
  )
    throw new TypeError("compiled transaction descriptor mismatch");
  // Separate from configurationIdentity: no Read entry handles artifact payloads.
  // URI JSON escaping + base64 data + bounded entry metadata, with finite headroom.
  const captureMaximumBytes =
    8 * CONTRACT_ARTIFACT_CEILINGS.totalBytes +
    1024 * CONTRACT_ARTIFACT_CEILINGS.submittedArtifacts +
    4096;
  const capture = compiled ? json(compiled.capture) : "null";
  if (Buffer.byteLength(capture) > captureMaximumBytes)
    throw new TypeError("transaction contract capture exceeds private bound");
  const receiptMaximumItems = transactionReceiptMaximum(options.receiptMaximumItems);
  const configuration = json({
    format,
    receiptMaximumItems,
    snapshotLimits: TRANSACTION_SNAPSHOT_LIMITS,
    snapshotTokenPolicy: TRANSACTION_SNAPSHOT_TOKEN_POLICY,
    initialAuthorizationView: view,
    policyStorageRevision: 1,
    identityPolicy,
    contractIdentity: compiled?.identity ?? null,
    runtimeLimits: TRANSACTION_RUNTIME_LIMITS,
    scope,
    types: [...installed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  });
  // Preserve the exact format-10 property ordering, not a permissive JSON comparison.
  const legacyObject = JSON.parse(configuration) as Record<string, unknown>;
  const legacyEntries = Object.entries(legacyObject).flatMap(([key, value]) =>
    key === "policyStorageRevision"
      ? []
      : [
          [
            key === "initialAuthorizationView" ? "authorizationView" : key,
            key === "format" ? "bdp-private-transaction-snapshot-10" : value,
          ],
        ],
  );
  const legacyBytes = json(Object.fromEntries(legacyEntries));
  const format11Bytes = json({
    ...JSON.parse(configuration),
    format: "bdp-private-transaction-snapshot-11",
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
  // SQLite must be allowed to recover a hot rollback journal before reading
  // configuration. The locked installation check below still precedes every
  // BDP pending retraction, creator cleanup and retention sweep.
  const db = new DatabaseSync(options.file);
  let closed = false,
    busy = false;
  let maintenanceTimer: ReturnType<typeof setInterval> | undefined;
  let maintenanceFailure: { readonly cause: unknown } | undefined;
  let ownerFailure: Error | undefined;
  const eventScans = new WeakMap<TransactionEventScan, EventScanState>();
  const erasureObservers = new Set<() => void>();
  const changePublications = new Map<
    TransactionChangePublication,
    {
      context: TransactionReadContext;
      after: number;
      controller: AbortController;
    }
  >();
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
  const retiredClaims = new WeakSet<TransactionClaim>();
  const retiredSequences = new WeakSet<TransactionSequenceAdmission>();
  function retireClaim(claim: TransactionClaim) {
    claims.delete(claim);
    retiredClaims.add(claim);
  }
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
    revokeLeases();
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
  /** Keyset scan: one retained body at a time, with stable row IDs even when
   * the current row is rewritten. Never copy the whole Scope history into RAM. */
  function* erasureRows(table: "groups" | "receipts") {
    const first = db.prepare(`SELECT rowid AS storageRowid,* FROM ${table} ORDER BY rowid LIMIT 1`);
    const next = db.prepare(
      `SELECT rowid AS storageRowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 1`,
    );
    let row = first.get();
    while (row) {
      const id = Number(row.storageRowid);
      yield row;
      row = next.get(id);
    }
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
      if (
        result.outcome !== "created" &&
        !(
          result.outcome === "erased" &&
          db
            .prepare("SELECT 1 FROM erased_creation_facts WHERE receipt=? AND operation=?")
            .get(receipt.id, Number(result.operationIndex))
        )
      )
        continue;
      // Alias creation allocates a locator, not a Resource identity. Its receipt
      // still expires, but its compact allocation list is empty (T49).
      if (typeof result.alias === "string" && typeof result.target === "string") {
        if (result.resource !== undefined || result.operationIndex !== 0)
          throw new Error("invalid retained alias creation result");
        continue;
      }
      const resource = (result.resource ?? result.erased) as
        | { id?: unknown; type?: unknown }
        | undefined;
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
  const snapshots = transactionSnapshotStorage(
    db,
    scope,
    descriptors,
    () => authorization.readPolicy === "all-visible",
    (view) => (view === INITIAL_TRANSACTION_VIEW ? transactionErasureLedger(db) : []),
  );
  function sweep(now: number) {
    snapshots.expire(now, readContext());
    const counts = { completedExpired: 0, failedForgotten: 0 };
    // SQLite JSON functions reject valid deep receipt text. Filter using the
    // same JS decoder as expiry; compact receipts remain bound and unchanged.
    for (const stored of db
      .prepare("SELECT * FROM receipts WHERE owner IS NULL")
      .all() as unknown as Row[]) {
      if (parseReceipt(stored.receipt).detail !== "available") continue;
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
  // Assigned in the synchronous provisioning transaction before any context use.
  let epoch!: string;
  let legacyRequestStorage = false;
  try {
    db.exec(
      "PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; PRAGMA busy_timeout=0",
    );
    recoveredPending = atomic(() => {
      if (options.create) {
        db.exec(schema);
        const put = db.prepare("INSERT INTO metadata VALUES(?,?)");
        put.run("configuration", configuration);
        put.run("contractCapture", capture);
        put.run("epoch", randomUUID());
        put.run("position", "0");
        put.run("authorizationPolicy", json(authorization));
      } else {
        const storedConfiguration = metadata("configuration");
        if (JSON.parse(storedConfiguration).identityPolicy !== identityPolicy)
          throw new Error(
            "transaction identity policy mismatch; explicit new-store provisioning required",
          );
        if (
          storedConfiguration !== configuration &&
          storedConfiguration !== legacyBytes &&
          storedConfiguration !== format11Bytes
        )
          throw new Error("transaction installation mismatch");
        legacyRequestStorage = storedConfiguration !== configuration;
        // Exact bytes validate retained capture, including constant witnesses, even
        // if the stored claimed identity was left unchanged by corruption.
        const captureLength = db
          .prepare(
            "SELECT length(CAST(value AS BLOB)) AS bytes FROM metadata WHERE name='contractCapture'",
          )
          .get();
        if (
          !captureLength ||
          Number(captureLength.bytes) > captureMaximumBytes ||
          metadata("contractCapture") !== capture
        )
          throw new Error("transaction contract capture mismatch");
        if (storedConfiguration === legacyBytes) {
          if (db.prepare("SELECT 1 FROM metadata WHERE name='authorizationPolicy'").get())
            throw new Error("unexpected legacy authorization policy");
          db.prepare("INSERT INTO metadata VALUES('authorizationPolicy',?)").run(
            json(authorization),
          );
          db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(configuration);
        }
        const policyLength = db
          .prepare(
            "SELECT length(CAST(value AS BLOB)) AS bytes FROM metadata WHERE name='authorizationPolicy'",
          )
          .get();
        if (!policyLength || Number(policyLength.bytes) > 4096)
          throw new Error("invalid stored authorization policy");
        authorization = parseTransactionAuthorization(metadata("authorizationPolicy"));
      }
      db.exec(
        "CREATE TABLE IF NOT EXISTS snapshot_epoch_fences(epoch TEXT PRIMARY KEY, head INTEGER NOT NULL) STRICT",
      );
      // Immutable for this exclusive owner; establish it before the first sweep.
      epoch = metadata("epoch");
      const retracted = Number(
        db.prepare("DELETE FROM receipts WHERE owner IS NOT NULL").run().changes,
      );
      db.exec("DELETE FROM creator_facts");
      // Additive, versioned migration after exact installation/capture admission.
      // Commit normalized Reference leaves, then the exact typed normalization;
      // never the raw carrier or an alias re-resolved at retry time.
      db.exec(transactionErasureSchema);
      const policy = db
        .prepare("SELECT value FROM metadata WHERE name='requestFingerprintPolicy'")
        .get();
      if (policy && policy.value !== requestFingerprintPolicy)
        throw new Error("unknown request fingerprint policy");
      if (!policy) {
        if (!options.create && !legacyRequestStorage)
          throw new Error("missing request fingerprint policy");
        for (const row of erasureRows("receipts"))
          db.prepare("UPDATE receipts SET identity=?,witnesses=? WHERE principal=? AND key=?").run(
            storedTransactionFingerprint(String(row.identity)),
            commitTransactionWitnesses(String(row.witnesses), scope),
            String(row.principal),
            String(row.key),
          );
        db.prepare("INSERT INTO metadata VALUES('requestFingerprintPolicy',?)").run(
          requestFingerprintPolicy,
        );
      }
      db.prepare("UPDATE metadata SET value=? WHERE name='configuration'").run(configuration);
      for (const row of erasureRows("receipts")) {
        if (!new RegExp(`^${requestFingerprintPolicy}:[a-f0-9]{64}$`).test(String(row.identity)))
          throw new Error("invalid retained request fingerprint");
        if (commitTransactionWitnesses(String(row.witnesses), scope) !== row.witnesses)
          throw new Error("uncommitted retained alias witnesses");
      }
      // Backfill only concrete Resource postimages, not arbitrary property data.
      for (const row of erasureRows("groups")) {
        const group = JSON.parse(String(row.body));
        for (const change of group.changes)
          if (change.operation === "upsert") retainErasureVersions(db, change.resource);
      }
      for (const row of erasureRows("receipts")) {
        const receipt = JSON.parse(String(row.receipt));
        for (const result of receipt.results ?? [])
          if (result.resource) retainErasureVersions(db, result.resource);
      }
      if (options.nativeRestore !== undefined) {
        if (legacyRequestStorage) throw new Error("native restore requires current native format");
        snapshots.retireEpoch(readContext());
        const restored = applyNativeTransactionRestore(
          db,
          options.file,
          options.nativeRestore,
          scope,
          configuration,
          capture,
        );
        epoch = restored.epoch;
        options.fault?.("before-restore-commit");
      }
      sweep(instant());
      return retracted;
    });
  } catch (error) {
    db.close();
    if (options.create) unlinkSync(options.file);
    throw error;
  }
  if (options.nativeRestore !== undefined) {
    try {
      options.fault?.("after-restore-commit");
    } catch (error) {
      db.close();
      throw error;
    }
  }
  // Immutable installation facts are the same ones used by mutation evaluation.
  // Current authorization is captured separately inside each serialized entry.
  const readConfiguration = Object.freeze({
    scopeEpoch: epoch,
    authorizationView: view,
    receiptMaximumItems,
    scopeSnapshot: Object.freeze({
      limits: TRANSACTION_SNAPSHOT_LIMITS,
      tokenPolicy: TRANSACTION_SNAPSHOT_TOKEN_POLICY,
    }),
    installedTypes: Object.freeze(descriptors),
    scopeConfiguration: Object.freeze({
      policyIdentity: view,
      configurationIdentity: configuration,
      maximumEndpointMultiplicity: Object.freeze([]),
    }),
  });
  function readContext(): TransactionReadContext {
    const position = metadata("position");
    if (!/^(0|[1-9][0-9]*)$/.test(position) || !Number.isSafeInteger(Number(position)))
      throw new Error("invalid transaction read position");
    return Object.freeze({
      scopeEpoch: epoch,
      authorizationView: authorization.authorizationView,
      scopePosition: `pos-${position}`,
    });
  }
  function erasureFloor(context: TransactionReadContext): number {
    if (context.authorizationView !== INITIAL_TRANSACTION_VIEW) return 0;
    return Number(
      db.prepare("SELECT coalesce(max(position),0) AS floor FROM erasure_ledger").get()!.floor,
    );
  }
  /** Erased Event IDs remain valid exclusive positions, without retaining the
   * erased fact or its endpoint References. Only one-way source tags survive. */
  function withheldCursor(position: number, ordinal: number, source: string): boolean {
    return (
      authorization.readPolicy === "all-visible" &&
      Boolean(
        db
          .prepare("SELECT 1 FROM erased_event_cursors WHERE position=? AND ordinal=? AND source=?")
          .get(position, ordinal, erasureSourceTag(source)),
      )
    );
  }
  /** Prepare once per owner observation, not once per scanned group. The
   * reader remains inside its synchronous entry; no SQLite capability escapes. */
  /** Called only after the complete purge and ledger commit, in the same
   * synchronous owner turn as publication eligibility. Never wait for a drain. */
  function fenceErasurePublications(position: number) {
    for (const state of changePublications.values())
      if (
        state.context.authorizationView === INITIAL_TRANSACTION_VIEW &&
        state.after < position - 1
      )
        state.controller.abort(new TransactionErasureFence("pre-erasure stream is behind"));
  }
  function eraseHistoricalVersions(requested: readonly HistoricalErasureSubject[]) {
    return eraseVersions(requested);
  }
  function correctLiveBeadVersion(subject: string, revision: string, request: PreparedTransaction) {
    return eraseVersions([{ subject, revision }], {
      kind: "correction",
      resourceKind: "bead",
      request,
    });
  }
  function tombstoneLiveBeadVersion(subject: string, revision: string) {
    return eraseVersions([{ subject, revision }], { kind: "tombstone", resourceKind: "bead" });
  }
  function correctLiveLinkVersion(subject: string, revision: string, request: PreparedTransaction) {
    return eraseVersions([{ subject, revision }], {
      kind: "correction",
      resourceKind: "link",
      request,
    });
  }
  function tombstoneLiveLinkVersion(subject: string, revision: string) {
    return eraseVersions([{ subject, revision }], { kind: "tombstone", resourceKind: "link" });
  }
  function eraseVersions(
    requested: readonly HistoricalErasureSubject[],
    live?:
      | {
          readonly kind: "correction";
          readonly resourceKind: "bead" | "link";
          readonly request: PreparedTransaction;
        }
      | { readonly kind: "tombstone"; readonly resourceKind: "bead" | "link" },
  ) {
    return enter(() => {
      if (
        activeSequences.size ||
        db
          .prepare(
            "SELECT 1 FROM receipts WHERE owner IS NOT NULL OR dependency IS NOT NULL LIMIT 1",
          )
          .get()
      )
        throw new Error("historical erasure requires drained mutation ownership");
      const result = atomic(() => {
        const previousPosition = Number(metadata("position"));
        if (!Number.isSafeInteger(previousPosition) || previousPosition >= Number.MAX_SAFE_INTEGER)
          throw new Error("Scope position exhausted");
        const position = previousPosition + 1,
          transaction = randomUUID();
        let correctedChanges: readonly import("./transaction-batch.js").TransactionStateChange[] =
          [];
        let correctedEvents: TransactionEvent[] = [];
        if (live !== undefined) {
          const target = requested[0];
          if (
            requested.length !== 1 ||
            !target ||
            typeof target.subject !== "string" ||
            !target.subject.startsWith(
              `${scope}${live.resourceKind === "link" ? "links" : "beads"}/`,
            ) ||
            typeof target.revision !== "string" ||
            !target.revision
          )
            throw new TypeError(
              `one exact current ${live.resourceKind === "link" ? "Link" : "Bead"} version required`,
            );
          const stored = resource(target.subject.slice(scope.length));
          if (!stored || stored.kind !== live.resourceKind)
            throw new Error(
              `current ${live.resourceKind === "link" ? "Link" : "Bead"} correction unavailable`,
            );
          const before = readStoredResource(stored, scope);
          if (before.id !== target.subject || before.revision !== target.revision)
            throw new Error(
              `current ${live.resourceKind === "link" ? "Link" : "Bead"} revision differs`,
            );
          let owningSource: ReturnType<typeof readStoredResource> | undefined;
          if (live.resourceKind === "link") {
            if (stored.kind !== "link" || !("source" in before))
              throw new Error("current Link required");
            const sourceUri = typeof before.source === "string" ? before.source : before.source.uri;
            if (sourceUri.startsWith(scope)) {
              const sourceRow = resource(sourceUri.slice(scope.length));
              if (!sourceRow || sourceRow.kind !== "bead")
                throw new Error("Link source unavailable");
              const source = readStoredResource(sourceRow, scope);
              if ("source" in source) throw new Error("Link source must be a Bead");
              const descriptor = descriptors.find((item) => item.id === source.type);
              const ownership =
                descriptor?.describes === "bead" ? descriptor.ownsOutgoing : undefined;
              if (
                ownership &&
                (Object.hasOwn(ownership, before.type) || Object.hasOwn(ownership, "*"))
              )
                owningSource = source;
            }
          }
          const normalized =
            live.resourceKind === "link"
              ? live.kind === "correction"
                ? validateLiveLinkCorrection(live.request, scope, before)
                : prepareLiveLinkTombstone(scope, before)
              : live.kind === "correction"
                ? validateLiveBeadCorrection(live.request, scope, before)
                : prepareLiveBeadTombstone(scope, before);
          const evaluated = evaluateOwnedTransaction(
            normalized,
            transaction,
            `pos-${position}`,
            instant(),
          );
          if (!evaluated.ok)
            throw new Error(
              live.kind === "correction"
                ? "live correction validation refused"
                : "live tombstone validation refused",
              { cause: evaluated.problem },
            );
          const change = evaluated.changes[0],
            event = evaluated.events[0];
          if (owningSource) {
            correctedEvents = liveOwnedLinkEvents(
              scope,
              before,
              owningSource,
              evaluated.changes,
              evaluated.events,
              live.kind,
            );
            correctedChanges = evaluated.changes;
            for (const item of correctedChanges)
              if (item.operation === "upsert") retainErasureVersions(db, item.resource);
          } else if (live.kind === "tombstone") {
            if (
              evaluated.changes.length !== 1 ||
              !change ||
              change.operation !== "tombstone" ||
              change.resourceKind !== live.resourceKind ||
              change.resource.id !== before.id ||
              change.resource.type !== before.type ||
              change.resource.revision !== before.revision ||
              (live.resourceKind === "bead" && evaluated.events.length !== 1) ||
              !event ||
              event.type !== "deleted" ||
              event.subject !== before.id ||
              Object.keys(event.data as object).join(",") !== "revision" ||
              (event.data as { revision: string }).revision !== before.revision
            )
              throw new Error(
                `live tombstone requires the exact ${live.resourceKind === "link" ? "Link" : "Bead"} lineage and ordinary deleted fact`,
              );
            if (
              live.resourceKind === "link" &&
              evaluated.events
                .slice(1)
                .some((item) => item.type !== "unlinked" || item.subject !== before.id)
            )
              throw new Error("unexpected unowned Link deletion fact");
            correctedChanges = evaluated.changes;
            correctedEvents = [...evaluated.events];
          } else {
            if (
              evaluated.changes.length !== 1 ||
              !change ||
              change.operation !== "upsert" ||
              change.resourceKind !== live.resourceKind ||
              !("properties" in change.resource) ||
              change.resource.id !== target.subject ||
              evaluated.events.length !== 1 ||
              !event ||
              event.type !== "updated" ||
              event.subject !== target.subject
            )
              throw new Error(
                live.resourceKind === "link"
                  ? "live Link correction requires changed properties or metadata; deletion requires an explicit tombstone"
                  : "live correction requires a changed Bead; unchanged state needs unsupported tombstone",
              );
            if (
              live.resourceKind === "link" &&
              (!("source" in before) ||
                !("source" in change.resource) ||
                !isDeepStrictEqual(before.source, change.resource.source) ||
                !isDeepStrictEqual(before.target, change.resource.target) ||
                before.type !== change.resource.type)
            )
              throw new Error("live Link correction changed immutable Link identity/endpoints");
            if (
              live.resourceKind === "bead" &&
              ("source" in before ||
                "source" in change.resource ||
                !isDeepStrictEqual(before.ownedLinks, change.resource.ownedLinks))
            )
              throw new Error("direct Bead correction must preserve its complete owned Link set");
            correctedChanges = evaluated.changes;
            correctedEvents = [liveCorrectionEvent(before, change.resource, event)];
            retainErasureVersions(db, change.resource);
          }
        }
        const plan = planHistoricalErasure(db, scope, requested);
        const selected = new Set(
          plan.map(({ record }) => JSON.stringify([record.subject, record.revision])),
        );
        const erased = (id: unknown, revision: unknown) =>
          selected.has(JSON.stringify([id, revision]));
        const records = plan.map(({ record }) => record);
        const endpointsGone = new Set<string>();
        const checkedEndpoints = new Set<string>();
        for (const { body, record } of plan) {
          if (body.source === undefined || checkedEndpoints.has(record.subject)) continue;
          checkedEndpoints.add(record.subject);
          let retained = false;
          // A selected plan has at most4096 versions. Stop at the first other
          // version rather than materializing the subject's complete history.
          for (const row of db
            .prepare("SELECT subject,revision FROM retained_versions WHERE subject=?")
            .iterate(record.subject)) {
            if (!selected.has(JSON.stringify([row.subject, row.revision]))) {
              retained = true;
              break;
            }
          }
          if (!retained) endpointsGone.add(record.subject);
        }
        const originalEventCount = correctedEvents.length;
        correctedEvents = correctedEvents.filter((event) => {
          if (!erasedContentEvent(event, selected, endpointsGone)) return true;
          // The new administrative group can itself contain withheld ordinary
          // facts. Preserve their ordinal gaps with the same content-free
          // commitments used for older groups, never renumber surviving facts.
          db.prepare("INSERT OR IGNORE INTO erased_event_cursors VALUES(?,?,?)").run(
            position,
            event.ordinal,
            erasureSourceTag(`${scope}events/`),
          );
          return false;
        });
        const group = {
          scopeEpoch: epoch,
          authorizationView: INITIAL_TRANSACTION_VIEW,
          checkpoint: `pos-${position}`,
          position: `pos-${position}`,
          previousPosition: `pos-${position - 1}`,
          projectionAdvance: false,
          transaction,
          changes: correctedChanges,
          erasures: records,
          eventCount: correctedEvents.length,
          events: correctedEvents,
          ...(correctedEvents.length < originalEventCount
            ? { erasurePruned: true, originalEventCount }
            : {}),
        };
        const groupText = json(group);
        if (Buffer.byteLength(groupText) > TRANSACTION_EVENT_GROUP_BYTES)
          throw new RangeError("administrative erasure group exceeds owner byte bound");
        for (const { body, record } of plan) {
          db.prepare("INSERT INTO erased_version_lineage VALUES(?,?,?)").run(
            record.subject,
            record.revision,
            String(body.type),
          );
          db.prepare("INSERT INTO erasure_ledger VALUES(?,?,?,?)").run(
            record.subject,
            record.revision,
            position,
            json(record),
          );
          db.prepare("DELETE FROM retained_versions WHERE subject=? AND revision=?").run(
            record.subject,
            record.revision,
          );
        }
        for (const row of erasureRows("groups")) {
          const group = JSON.parse(String(row.body)) as {
            changes: {
              operation: string;
              resource: { id: string; revision: string; source?: unknown; target?: unknown };
            }[];
            events: TransactionEvent[];
            eventCount: number;
            erasurePruned?: boolean;
            originalEventCount?: number;
          };
          const removed = group.events.filter((event) =>
            erasedContentEvent(event, selected, endpointsGone),
          );
          // Record only immutable position/ordinal/source commitments. Endpoints
          // themselves do not survive even in the exclusive-cursor index.
          for (const event of removed) {
            const sources = new Set([`${scope}events/`]);
            const data = event.data as Record<string, unknown>;
            if (["created", "updated", "deleted"].includes(event.type))
              sources.add(`${event.subject}?view=events`);
            const uri = (value: unknown) =>
              typeof value === "string"
                ? value
                : value && typeof value === "object" && "uri" in value
                  ? String(value.uri)
                  : undefined;
            if (event.type === "linked" || event.type === "unlinked") {
              const endpoint = uri(data[String(data.endpoint)]);
              if (endpoint?.startsWith(scope)) sources.add(`${endpoint}?view=events`);
            } else if (event.type === "updated") {
              const resource = group.changes.find(
                (change) => change.resource.id === event.subject,
              )?.resource;
              if (resource?.source !== undefined)
                for (const endpoint of [resource.source, resource.target]) {
                  const id = uri(endpoint);
                  if (id?.startsWith(scope)) sources.add(`${id}?view=events`);
                }
            }
            for (const url of sources) {
              const subject =
                url === `${scope}events/` ? undefined : url.slice(0, -"?view=events".length);
              const source: TransactionEventSource =
                subject === undefined
                  ? { kind: "scope", url }
                  : { kind: subject.startsWith(`${scope}beads/`) ? "bead" : "link", subject, url };
              try {
                // Preserve the actual existing projector's membership, including
                // its explicitly unsupported incident-metadata subset. No erasure
                // path silently broadens G2's separately implemented membership.
                const projected = projectTransactionEventGroup(
                  group,
                  {
                    scopeEpoch: epoch,
                    authorizationView: INITIAL_TRANSACTION_VIEW,
                    scopePosition: `pos-${row.position}`,
                  },
                  source,
                  scope,
                  Number(row.position),
                );
                if (projected.some((item) => item.ordinal === event.ordinal))
                  db.prepare("INSERT OR IGNORE INTO erased_event_cursors VALUES(?,?,?)").run(
                    Number(row.position),
                    event.ordinal,
                    erasureSourceTag(url),
                  );
              } catch (error) {
                if (!(error instanceof TransactionEventProjectionGap)) throw error;
              }
            }
          }
          group.originalEventCount ??= group.eventCount;
          group.events = group.events.filter((event) => !removed.includes(event));
          group.eventCount = group.events.length;
          group.changes = group.changes.filter(
            (change) =>
              change.operation !== "upsert" ||
              !erased(change.resource.id, change.resource.revision),
          );
          group.erasurePruned = true;
          db.prepare("UPDATE groups SET body=? WHERE position=?").run(
            json(group),
            Number(row.position),
          );
        }
        for (const row of erasureRows("receipts")) {
          const receipt = JSON.parse(String(row.receipt)) as TransactionReceipt;
          if (!Array.isArray(receipt.results)) continue;
          const results = receipt.results.map((entry: Record<string, unknown>) => {
            const next = eraseReceiptEntry(entry, selected);
            if (next !== entry && entry.outcome === "created")
              db.prepare("INSERT OR IGNORE INTO erased_creation_facts VALUES(?,?)").run(
                receipt.id,
                Number(entry.operationIndex),
              );
            return next;
          });
          db.prepare("UPDATE receipts SET receipt=? WHERE principal=? AND key=?").run(
            json({ ...receipt, results }),
            String(row.principal),
            String(row.key),
          );
        }
        const context = readContext();
        snapshots.invalidateBefore(position, context);
        db.prepare("INSERT INTO groups VALUES(?,?)").run(position, groupText);
        db.prepare("UPDATE metadata SET value=? WHERE name='position'").run(String(position));
        options.fault?.("before-erasure-commit");
        freezeReceiptValue(group);
        return Object.freeze({
          group,
          context: readContext(),
          digestAnomalies: Object.freeze(
            plan.flatMap(({ record, digestAnomaly }) =>
              digestAnomaly === undefined
                ? []
                : [
                    Object.freeze({
                      subject: record.subject,
                      revision: record.revision,
                      message: digestAnomaly,
                    }),
                  ],
            ),
          ),
        });
      });
      try {
        fenceErasurePublications(Number(result.context.scopePosition.slice(4)));
        // Synchronously discard owner-composed ordinary Read caches before
        // any post-erasure state can be delivered, including a late fault.
        const failures: unknown[] = [];
        for (const observer of [...erasureObservers]) {
          try {
            observer();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length) throw new AggregateError(failures, "erasure cache purge failed");
        options.fault?.("after-erasure-commit");
      } catch (error) {
        throw fence(error);
      }
      return result;
    });
  }
  function retainedGroupReader() {
    const rowAt = db.prepare(
      "SELECT position,length(CAST(body AS BLOB)) AS bytes FROM groups WHERE position>=? AND position<=? ORDER BY position LIMIT 1",
    );
    const bodyAt = db.prepare("SELECT body FROM groups WHERE position=?");
    return (at: number, head: number): { position: number; value: unknown } | undefined => {
      const row = rowAt.get(at, head);
      if (!row) return undefined;
      const position = Number(row.position),
        bytes = Number(row.bytes);
      if (!Number.isSafeInteger(position) || position < at)
        throw new Error("invalid Event group position");
      if (!Number.isSafeInteger(bytes) || bytes < 2 || bytes > TRANSACTION_EVENT_GROUP_BYTES)
        throw new Error("retained Event group exceeds admitted byte bound");
      const body = bodyAt.get(position)?.body;
      if (typeof body !== "string") throw new Error("invalid retained Event group body");
      const value = JSON.parse(body) as {
        erasurePruned?: boolean;
        originalEventCount?: number;
        events?: TransactionEvent[];
      };
      if (value.erasurePruned) {
        if (
          !Number.isSafeInteger(value.originalEventCount) ||
          value.originalEventCount! < 0 ||
          value.originalEventCount! > TRANSACTION_RUNTIME_LIMITS.inducedEvents ||
          !Array.isArray(value.events)
        )
          throw new Error("invalid erasure Event framing");
        const ordinals = new Set(value.events.map((event) => event.ordinal));
        if (
          ordinals.size !== value.events.length ||
          [...ordinals].some((ordinal) => ordinal < 0 || ordinal >= value.originalEventCount!)
        )
          throw new Error("invalid retained Event ordinal");
        for (let ordinal = 0; ordinal < value.originalEventCount!; ordinal++)
          if (
            !ordinals.has(ordinal) &&
            !db
              .prepare(
                "SELECT 1 FROM erased_event_cursors WHERE position=? AND ordinal=? AND source=?",
              )
              .get(position, ordinal, erasureSourceTag(`${scope}events/`))
          )
            throw new Error("unproven erasure Event gap");
      }
      return { position, value };
    };
  }
  function eventSourceKnown(source: TransactionEventSource): boolean {
    return (
      !source.subject ||
      (authorization.readPolicy === "all-visible" &&
        Boolean(
          db
            .prepare("SELECT id FROM identities WHERE id=?")
            .get(source.subject.slice(scope.length)),
        ))
    );
  }
  function eventSource(sourceUrl: string): TransactionEventSource {
    const request = transactionEventRequest(new URL(sourceUrl), scope);
    if (!request || request.after !== undefined || request.source.url !== sourceUrl)
      throw new TransactionEventParameterError();
    return request.source;
  }
  function eventCandidateBytes(
    envelopeBytes: number,
    source: string,
    event: TransactionEvent,
    priorBytes: number,
    count: number,
  ) {
    const eventBytes = priorBytes + (count === 0 ? 0 : 1) + Buffer.byteLength(json(event));
    return {
      eventBytes,
      pageBytes:
        envelopeBytes + eventBytes + Buffer.byteLength(json(eventContinuation(source, event.id))),
    };
  }
  function eventProjection(
    row: { position: number; value: unknown },
    context: TransactionReadContext,
    source: TransactionEventSource,
    cursor?: { position: number; ordinal: number; id: string },
  ) {
    const projected = projectTransactionEventGroup(
      row.value,
      context,
      source,
      scope,
      row.position,
      authorization.readPolicy === "all-visible",
    );
    if (
      cursor &&
      (row.position !== cursor.position ||
        (!projected.some((event) => event.ordinal === cursor.ordinal && event.id === cursor.id) &&
          !withheldCursor(cursor.position, cursor.ordinal, source.url)))
    )
      throw new TransactionEventParameterError(undefined, context);
    return projected;
  }
  /** Called only inside enter. One group, no iterator or group body in its token. */
  function eventPacket(
    state: EventScanState,
    context: TransactionReadContext,
    cursor?: { position: number; ordinal: number; id: string },
  ): TransactionEventPacket {
    const head = Number(context.scopePosition.slice(4));
    let at = state.at,
      ordinal = state.ordinal;
    const events: TransactionEvent[] = [];
    if (at > head && cursor) throw new TransactionEventParameterError(undefined, context);
    if (at <= head) {
      const row = retainedGroupReader()(at, head);
      if (!row || row.position !== at) {
        if (cursor) throw new TransactionEventParameterError(undefined, context);
        throw new Error("missing retained Event group");
      }
      const projected = eventProjection(row, context, state.source, cursor);
      const envelopeBytes =
        Buffer.byteLength(json({ source: state.source.url, events: [], next: null })) - 4;
      let eventBytes = 0,
        complete = true;
      for (const event of projected) {
        if (event.ordinal <= state.ordinal) continue;
        const candidate = eventCandidateBytes(
          envelopeBytes,
          state.source.url,
          event,
          eventBytes,
          events.length,
        );
        if (
          events.length + 1 > receiptMaximumItems ||
          candidate.pageBytes > TRANSACTION_EVENT_STREAM.packetBytes
        ) {
          if (events.length === 0)
            throw new Error("finite Event page cannot hold first retained Event");
          complete = false;
          break;
        }
        events.push(event);
        eventBytes = candidate.eventBytes;
        ordinal = event.ordinal;
      }
      if (complete) {
        at++;
        ordinal = -1;
      }
    }
    const scan = Object.freeze({}) as TransactionEventScan;
    eventScans.set(scan, Object.freeze({ source: state.source, context, at, ordinal, head }));
    return Object.freeze({
      kind: "packet",
      context,
      scan,
      caughtUp: at > head,
      events: freezeEventPage({ source: state.source.url, events, next: null }).events,
    });
  }
  function createPagePlan(principal: string, key: string, receipt: TransactionReceipt): void {
    const entries = receipt.results as readonly unknown[];
    db.prepare("INSERT INTO receipt_pages VALUES(?,?,?,?,?)").run(
      receipt.id,
      principal,
      key,
      entries.length,
      receiptMaximumItems,
    );
    for (let start = receiptMaximumItems; start < entries.length; start += receiptMaximumItems)
      db.prepare("INSERT INTO receipt_page_ranges VALUES(?,?,?,?)").run(
        randomUUID(),
        receipt.id,
        start,
        Math.min(start + receiptMaximumItems, entries.length),
      );
  }
  function pagePlan(receipt: TransactionReceipt): ReceiptPagePlan {
    const saved = db.prepare("SELECT * FROM receipt_pages WHERE receipt=?").get(receipt.id);
    if (!saved) throw new Error("receipt page plan missing");
    const parent = row(String(saved.principal), String(saved.key));
    if (
      !parent ||
      String(saved.key) !== receipt.idempotencyKey ||
      parseReceipt(parent.receipt).id !== receipt.id
    )
      throw new Error("receipt page plan parent mismatch");
    const plan: ReceiptPagePlan = {
      entries: Number(saved.entries),
      maximum: Number(saved.maximum),
      pages: db
        .prepare("SELECT token,start,end FROM receipt_page_ranges WHERE receipt=? ORDER BY start")
        .all(receipt.id)
        .map((value) => ({
          token: String(value.token),
          start: Number(value.start),
          end: Number(value.end),
        })),
    };
    if (
      !Number.isSafeInteger(plan.entries) ||
      plan.entries < 1 ||
      plan.maximum !== receiptMaximumItems ||
      !Array.isArray(plan.pages) ||
      (receipt.detail === "available" &&
        (!Array.isArray(receipt.results) || receipt.results.length !== plan.entries))
    )
      throw new Error("invalid receipt page plan");
    let start = receiptMaximumItems;
    const tokens = new Set<string>();
    for (const page of plan.pages) {
      if (
        !page ||
        typeof page.token !== "string" ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(page.token) ||
        tokens.has(page.token) ||
        page.start !== start ||
        start >= plan.entries ||
        page.end !== Math.min(start + receiptMaximumItems, plan.entries)
      )
        throw new Error("invalid receipt page chain");
      tokens.add(page.token);
      start = page.end;
    }
    if (start !== Math.max(receiptMaximumItems, plan.entries))
      throw new Error("incomplete receipt page chain");
    return plan;
  }
  function pageUrl(receipt: string, token: string): string {
    return `${receipt}/pages/${token}`;
  }
  function receiptPrefix(receipt: TransactionReceipt): TransactionReceipt {
    if (receipt.status !== "completed" || receipt.detail !== "available") return receipt;
    const plan = pagePlan(receipt);
    return {
      ...receipt,
      results: (receipt.results as readonly unknown[]).slice(0, plan.maximum),
      next: plan.pages[0] ? pageUrl(receipt.id, plan.pages[0].token) : null,
    };
  }
  // Current projection and position are captured before this
  // authoritative transaction releases. No second clock/retention observation.
  function observeReceipt(
    receipt: TransactionReceipt,
    context = readContext(),
  ): TransactionReceiptObservation {
    if (receipt.scopeEpoch !== context.scopeEpoch)
      throw new Error("receipt epoch differs from serving owner", {
        cause: { id: receipt.id, key: receipt.idempotencyKey },
      });
    for (const field of ["requiredPosition", "effectPosition"] as const) {
      const value = receipt[field];
      if (value === undefined && (field === "effectPosition" || receipt.status === "pending"))
        continue;
      if (
        typeof value !== "string" ||
        !/^pos-(0|[1-9][0-9]*)$/.test(value) ||
        !Number.isSafeInteger(Number(value.slice(4))) ||
        Number(value.slice(4)) > Number(context.scopePosition.slice(4))
      )
        throw new Error("receipt position exceeds serving owner", {
          cause: { id: receipt.id, key: receipt.idempotencyKey, field },
        });
    }
    const prefix = receiptPrefix(receipt); // Validate retained page plan even when every entry is withheld.
    const projection = projectTransactionReceipt(
      receipt,
      authorization.readPolicy === "all-visible",
    );
    const projected =
      projection.detail === "available" && Array.isArray(projection.results)
        ? {
            ...projection,
            results: projection.results.slice(0, receiptMaximumItems),
            next: prefix.next,
          }
        : projection;
    freezeReceiptValue(projected);
    return Object.freeze({ receipt: projected, context });
  }
  // Called only inside the guarded owner's transaction. Principal binding is
  // distinct from current-view projection of retained execution facts.
  function disclosedReceipt(principal: string, id: string): Row | undefined {
    for (const stored of db
      .prepare("SELECT * FROM receipts WHERE principal=?")
      .all(principal) as unknown as Row[]) {
      const value = parseReceipt(stored.receipt);
      if (value.id === id) return value.scopeEpoch === epoch ? stored : undefined;
    }
    return undefined;
  }
  function retainedReceipt(principal: string, id: string): TransactionReceipt | undefined {
    const stored = disclosedReceipt(principal, id);
    const remaining = stored && expireRow(stored, instant()).row;
    return remaining ? parseReceipt(remaining.receipt) : undefined;
  }
  type ReceiptRead = {
    readonly receipt: TransactionReceipt | undefined;
    readonly context: TransactionReadContext;
  };
  function readReceipt(principal: string, id: string, minimum?: TransactionMinimum): ReceiptRead;
  function readReceipt(
    principal: string,
    id: string,
    minimum: "unsupported",
  ): ReceiptRead | { readonly kind: "unsupported" };
  function readReceipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum | "unsupported",
  ): ReceiptRead | { readonly kind: "unsupported" } {
    if (typeof principal !== "string" || !principal || !principal.isWellFormed())
      throw new TypeError("invalid trusted principal");
    if (typeof id !== "string") throw new TypeError("receipt URL required");
    const condition =
      minimum === undefined || minimum === "unsupported"
        ? minimum
        : snapshotCurrentReadMinimum(minimum);
    return enter(() =>
      atomic(() => {
        const stored = disclosedReceipt(principal, id);
        if (stored && condition === "unsupported")
          return Object.freeze({ kind: "unsupported" as const });
        const context = readContext();
        if (!stored) return Object.freeze({ receipt: undefined, context });
        if (condition !== undefined && condition !== "unsupported")
          checkCurrentReadMinimum(condition, context, true);
        const remaining = expireRow(stored, instant()).row;
        if (!remaining) return Object.freeze({ receipt: undefined, context });
        return observeReceipt(parseReceipt(remaining.receipt), context);
      }),
    );
  }
  function withRead<T>(
    callback: (reader: AuthorityReadReader, context: TransactionReadContext) => T,
  ): OwnerReadEntryResult<T> {
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
      readAuthorizations.set(reader, authorization);
      try {
        const value = callback(reader, readContext());
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
        readAuthorizations.delete(reader);
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
      const template = parseDependencyTemplate(prior.dependency, scope);
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
      return prior.identity !== transactionRequestFingerprint(normalized)
        ? { kind: "conflict" }
        : { kind: "existing", receipt: parseReceipt(prior.receipt) };
    }
    // Prior-key equality/conflict wins above. Only an unknown key pays fresh
    // admission controls, and no refusal ever inserts a receipt or owner.
    if (controls && batch.carrier.operations.length > controls.maximumOperations)
      return { kind: "operation-limit" };
    if (controls) {
      for (const [index, op] of batch.carrier.operations.entries()) {
        if (op.operation !== "updateWhere" && op.operation !== "deleteWhere") continue;
        const limit = transactionSelectorCapacity(op);
        if (limit)
          return {
            kind: "selector-limit",
            limit,
            pointer:
              batch.carrier.kind === "singleton" ? "/selector" : `/operations/${index}/selector`,
          };
      }
    }
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
      normalized ? transactionRequestFingerprint(normalized) : "",
      normalized ? commitTransactionWitnesses(normalized.witnessesJson, scope) : "",
      owner,
      json(receipt),
      template ? json(template) : null,
    );
    claims.set(claim, { principal, key, owner, normalized });
    return { kind: "owned", claim };
  }
  function evaluateOwnedTransaction(
    normalized: NormalizedTransaction,
    transaction: string,
    position: string,
    now: number,
  ) {
    let active = true;
    function scoped<T>(fn: () => T): T {
      if (!active) throw new Error("expired Resource transaction");
      return fn();
    }
    const tx: TransactionMutationContext = {
      resources: (kind) =>
        scoped(() =>
          Object.freeze(
            db
              .prepare("SELECT id FROM resources WHERE kind=?")
              .all(kind)
              .map((row) => Object.freeze(requiredResource(String(row.id)))),
          ),
        ),
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
        scoped(() => db.prepare("SELECT id FROM identities WHERE id=?").get(id) !== undefined),
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
    return (() => {
      try {
        return evaluateTransaction(
          normalized,
          tx,
          {
            scope,
            contracts: compiled?.registry ?? {
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
            limits: TRANSACTION_RUNTIME_LIMITS,
          },
          transaction,
          position,
          now,
        );
      } finally {
        active = false;
      }
    })();
  }
  function executeClaim(claim: TransactionClaim): TransactionReceipt;
  function executeClaim(claim: TransactionClaim, observed: true): TransactionReceiptObservation;
  function executeClaim(
    claim: TransactionClaim,
    observed = false,
  ): TransactionReceipt | TransactionReceiptObservation {
    return enter(() => {
      const owned = claims.get(claim);
      if (!owned)
        throw new Error(
          retiredClaims.has(claim) ? "transaction execution fenced" : "foreign transaction claim",
        );
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
          db.exec("SAVEPOINT effects");
          const result = evaluateOwnedTransaction(normalized, core.transaction, position, now);
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
            for (const change of result.changes)
              if (change.operation === "upsert") retainErasureVersions(db, change.resource);
            for (const entry of result.results)
              if (entry && typeof entry === "object" && "resource" in entry)
                retainErasureVersions(db, entry.resource);
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
          if (receipt.status === "completed") createPagePlan(owned.principal, owned.key, receipt);
          options.fault?.("after-terminal");
          return observed ? observeReceipt(receipt) : receipt;
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
        retireClaim(claim);
      }
    });
  }
  function cancelSequence(attempt: TransactionSequenceAdmission): number {
    const state = sequenceAdmissions.get(attempt);
    if (!state) {
      if (retiredSequences.has(attempt)) return 0;
      throw new TypeError("foreign transaction sequence admission");
    }
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
    activeSequences.delete(attempt);
    sequenceAdmissions.delete(attempt);
    retiredSequences.add(attempt);
    for (const claim of state.owned.values()) retireClaim(claim);
    return released;
  }
  maintenanceTimer = setInterval(() => {
    try {
      maintain();
    } catch (cause) {
      // Background failure is sticky and observable on the next owner entry;
      // stop the timer and release the database instead of silently continuing.
      revokeLeases();
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
    controls: TransactionReceivingControls | undefined,
    observed: true,
  ): TransactionReceivingAdmission;
  function admit(
    principal: string,
    key: string,
    batch: PreparedTransaction,
    controls?: TransactionReceivingControls,
    observed = false,
  ): TransactionReceivingAdmission {
    const receiving = snapshotTransactionReceivingControls(
      controls ?? { acceptsJson: true, maximumOperations: TRANSACTION_MAXIMUM_OPERATIONS },
    );
    return enter(() => {
      assertPreparedTransaction(batch, scope);
      checkPrincipalKey(principal, key);
      if (mutationPause)
        throw new TransactionAuthorizationFailure("temporarily-unavailable", readContext());
      if (!authorization.canMutate)
        throw new TransactionAuthorizationFailure("forbidden", readContext());
      const admission = atomic(() => {
        const result = admitKey(principal, key, batch, false, undefined, undefined, receiving);
        if (result.kind === "operation-limit" && controls === undefined)
          throw new TransactionDevelopmentLimitError("development transaction operation limit");
        if (result.kind === "selector-limit" && controls === undefined)
          throw new TransactionDevelopmentLimitError("development transaction Selector limit");
        if (result.kind === "existing") {
          if (!receiving.acceptsJson)
            return {
              kind: "not-acceptable" as const,
              ...(observed ? { context: readContext() } : {}),
            };
          if (observed) return { kind: "existing" as const, ...observeReceipt(result.receipt) };
        }
        if (
          observed &&
          (result.kind === "conflict" ||
            result.kind === "operation-limit" ||
            result.kind === "selector-limit" ||
            result.kind === "not-acceptable")
        )
          return { ...result, context: readContext() };
        return result;
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
            retireClaim(admission.claim);
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
    /** Expected failures are paired inside the same entry, after any atomic
     * rollback. Unexpected integrity/SQLite/uncertain-commit errors propagate. */
    observeSnapshot(request: TransactionSnapshotRequest, supplied?: TransactionMinimum) {
      let minimum: TransactionMinimum | undefined;
      let observedRequest = request;
      let unrecognizedMinimum = false;
      if (supplied !== undefined) {
        let captured: { minimum: TransactionMinimum } | { error: TypeError };
        try {
          captured = { minimum: snapshotTransactionMinimum(supplied) };
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          captured = { error };
        }
        if ("error" in captured) {
          try {
            minimum = snapshotCurrentReadMinimum(supplied);
          } catch {
            throw captured.error;
          }
          const kind = request.kind;
          if (kind !== "create" && kind !== "preflight") throw captured.error;
          observedRequest = Object.freeze({ kind });
          unrecognizedMinimum = true;
        } else minimum = captured.minimum;
      }
      return enter(() => {
        const context = readContext(),
          now = instant();
        if (
          minimum &&
          observedRequest.kind !== "create" &&
          observedRequest.kind !== "preflight" &&
          (minimum.scopeEpoch !== context.scopeEpoch ||
            minimum.authorizationView !== context.authorizationView)
        )
          throw new TransactionMinimumUnsupported("retained-snapshot-context");
        if (
          minimum &&
          (observedRequest.kind === "create" || observedRequest.kind === "preflight")
        ) {
          if (unrecognizedMinimum) checkCurrentReadMinimum(minimum, context, true);
          else checkTransactionMinimum(minimum, context);
        }
        try {
          atomic(() => snapshots.expire(now, context));
          if (observedRequest.kind === "preflight") {
            atomic(() => snapshots.preflight(now, context));
            return Object.freeze({ kind: "eligible" as const, context });
          }
          if (observedRequest.kind === "create") {
            const manifest = atomic(() => {
              const value = snapshots.capture(now, context);
              options.fault?.("after-snapshot-copy");
              return value;
            });
            options.fault?.("after-snapshot-commit");
            return Object.freeze({ kind: "manifest" as const, body: manifest, context });
          }
          if (observedRequest.kind === "manifest")
            return Object.freeze({
              kind: "manifest" as const,
              body: snapshots.manifest(observedRequest.id, now, context, minimum),
              context,
            });
          return Object.freeze({
            kind: "page" as const,
            body: snapshots.page(
              observedRequest.id,
              observedRequest.stream,
              observedRequest.token,
              now,
              context,
              minimum,
            ),
            context,
          });
        } catch (error) {
          if (!(error instanceof TransactionSnapshotFailure)) throw error;
          return Object.freeze({
            kind: "problem" as const,
            code: error.code,
            ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
            context,
          });
        }
      });
    },
    /** Owner-only compatibility entry. HTTP uses the paired observation above. */
    captureSnapshot() {
      return enter(() => {
        const context = readContext(),
          now = instant();
        atomic(() => snapshots.expire(now, context));
        const captured = atomic(() => {
          const manifest = snapshots.capture(now, context);
          options.fault?.("after-snapshot-copy");
          return Object.freeze({ manifest, context });
        });
        // Failure to deliver an already committed identity never compensates by
        // deleting its durable promise or freeing permanent issuance capacity.
        options.fault?.("after-snapshot-commit");
        return captured;
      });
    },
    readSnapshot(id: string) {
      return enter(() => {
        const now = instant(),
          context = readContext();
        atomic(() => snapshots.expire(now, context));
        return Object.freeze({ manifest: snapshots.manifest(id, now, context), context });
      });
    },
    readSnapshotPage(id: string, kind: "bead" | "link", token: string) {
      return enter(() => {
        const now = instant(),
          context = readContext();
        atomic(() => snapshots.expire(now, context));
        return Object.freeze({ page: snapshots.page(id, kind, token, now, context), context });
      });
    },
    /** Fixed-view finite Event observation. Group rows are consumed one at a time;
     * no reader/SQLite iterator or mutable capability escapes this owner entry. */
    readEvents(
      sourceUrl: string,
      after?: string,
      supplied?: TransactionMinimum | "unsupported",
      admission?: "current-event",
    ):
      | {
          readonly kind: "page";
          readonly page: TransactionEventPage;
          readonly context: TransactionReadContext;
        }
      | { readonly kind: "missing"; readonly context: TransactionReadContext }
      | { readonly kind: "unsupported" } {
      if (typeof sourceUrl !== "string" || (after !== undefined && typeof after !== "string"))
        throw new TypeError("Event source and cursor must be strings");
      const source = eventSource(sourceUrl);
      const initialMinimumSource =
        (after === undefined || admission === "current-event") &&
        (source.kind === "scope" || source.kind === "bead" || source.kind === "link");
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : initialMinimumSource
            ? snapshotCurrentReadMinimum(supplied)
            : snapshotTransactionMinimum(supplied);
      return enter(() => {
        // Unknown/hidden sources are nondisclosing before initial Event minimum
        // checks. A retained identity remains a source after Resource deletion.
        if (!eventSourceKnown(source))
          return Object.freeze({ kind: "missing" as const, context: readContext() });
        if (minimum === "unsupported") return Object.freeze({ kind: "unsupported" as const });
        const context = readContext(),
          head = Number(context.scopePosition.slice(4));
        // Eligible current Event minima precede retained group reads. Direct after
        // calls without current-event intent retain their strict minimum check.
        if (minimum !== undefined) {
          if (initialMinimumSource) checkCurrentReadMinimum(minimum, context, true);
          else checkTransactionMinimum(minimum, context);
        }
        const start = after === undefined ? undefined : parseTransactionEventCursor(after, context);
        if (start) checkTransactionEventCursor(start, context, source.url);
        let cursorMatched = start === undefined;
        const events: import("./transaction-batch.js").TransactionEvent[] = [];
        // Keep brackets/envelope once and replace the literal null with each
        // candidate continuation string. Each Event is serialized exactly once.
        const envelopeBytes =
          Buffer.byteLength(json({ source: source.url, events: [], next: null })) - 4;
        let eventBytes = 0;
        let next: string | null = null;
        const retainedGroupAtOrAfter = retainedGroupReader();
        let at = start?.position ?? 1;
        for (;;) {
          const row = retainedGroupAtOrAfter(at, head);
          if (!row) {
            if (cursorMatched && at <= head) throw new Error("missing retained Event group");
            break;
          }
          const p = row.position;
          if (cursorMatched && p !== at) throw new Error("missing retained Event group");
          const projected = eventProjection(
            row,
            context,
            source,
            !cursorMatched && start && after !== undefined ? { ...start, id: after } : undefined,
          );
          cursorMatched = true;
          for (const event of projected) {
            if (start && p === start.position && event.ordinal <= start.ordinal) continue;
            // Reserve the exact continuation even if this Event is currently last.
            const { eventBytes: candidateBytes, pageBytes: bytes } = eventCandidateBytes(
              envelopeBytes,
              source.url,
              event,
              eventBytes,
              events.length,
            );
            if (events.length + 1 > receiptMaximumItems || bytes > TRANSACTION_EVENT_PAGE_BYTES) {
              const last = events.at(-1);
              if (!last) throw new Error("finite Event page cannot hold first retained Event");
              next = eventContinuation(source.url, last.id);
              break;
            }
            events.push(event);
            eventBytes = candidateBytes;
          }
          if (next !== null) break;
          at = p + 1;
        }
        if (!cursorMatched) throw new TransactionEventParameterError(undefined, context);
        return Object.freeze({
          kind: "page" as const,
          context,
          page: freezeEventPage({ source: source.url, events, next }),
        });
      });
    },
    /** Initial source/minimum/cursor observation, never a wire or durable cursor. */
    beginEventScan(
      sourceUrl: string,
      after?: string,
      supplied?: TransactionMinimum | "unsupported",
      invalidReconnect = false,
      admission?: "initial-scope-sse" | "current-event",
    ):
      | TransactionEventPacket
      | { readonly kind: "missing"; readonly context: TransactionReadContext }
      | { readonly kind: "unsupported" } {
      if (
        typeof sourceUrl !== "string" ||
        (after !== undefined && typeof after !== "string") ||
        typeof invalidReconnect !== "boolean"
      )
        throw new TypeError("invalid Event scan controls");
      const source = eventSource(sourceUrl);
      const initialScopeSseMinimum =
        admission === "initial-scope-sse" &&
        source.kind === "scope" &&
        source.url === new URL("events/", scope).href &&
        after === undefined &&
        !invalidReconnect;
      const currentEventMinimum =
        admission === "current-event" &&
        (source.kind === "scope" || source.kind === "bead" || source.kind === "link");
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : initialScopeSseMinimum || currentEventMinimum
            ? snapshotCurrentReadMinimum(supplied)
            : snapshotTransactionMinimum(supplied);
      return enter(() => {
        if (!eventSourceKnown(source))
          return Object.freeze({ kind: "missing" as const, context: readContext() });
        if (minimum === "unsupported") return Object.freeze({ kind: "unsupported" as const });
        const context = readContext();
        if (minimum !== undefined) {
          if (initialScopeSseMinimum || currentEventMinimum)
            checkCurrentReadMinimum(minimum, context, true);
          else checkTransactionMinimum(minimum, context);
        }
        if (invalidReconnect) throw new TransactionEventParameterError(undefined, context);
        const cursor =
          after === undefined ? undefined : parseTransactionEventCursor(after, context);
        if (cursor) checkTransactionEventCursor(cursor, context, source.url);
        return eventPacket(
          {
            source,
            context,
            head: Number(context.scopePosition.slice(4)),
            at: cursor?.position ?? 1,
            ordinal: cursor?.ordinal ?? -1,
          },
          context,
          cursor && after !== undefined ? { ...cursor, id: after } : undefined,
        );
      });
    },
    advanceEventScan(scan: TransactionEventScan): TransactionEventPacket {
      return enter(() => {
        const state = eventScans.get(scan);
        if (!state) throw new TypeError("foreign or fabricated Event scan");
        if (!eventSourceKnown(state.source)) throw new Error("retained Event source identity lost");
        const context = readContext();
        if (
          context.scopeEpoch !== state.context.scopeEpoch ||
          context.authorizationView !== state.context.authorizationView ||
          Number(context.scopePosition.slice(4)) < state.head
        )
          throw new Error("Event scan context changed or head regressed");
        return eventPacket(state, context);
      });
    },
    /** Request intent anchor only; the eventual page captures its own current context. */
    captureChangesStart(): string {
      return enter(() => {
        const context = readContext();
        return transactionCheckpoint(scope, context, Number(context.scopePosition.slice(4)));
      });
    },
    readChanges(
      after: string,
      supplied?: TransactionMinimum | "unsupported",
      admission?: "finite-start-now" | "current-changefeed",
      publication?: TransactionChangePublication,
    ):
      | {
          readonly kind: "page";
          readonly page: TransactionChangefeedPage;
          readonly context: TransactionReadContext;
        }
      | { readonly kind: "unsupported" } {
      if (typeof after !== "string") throw new TypeError("changefeed checkpoint must be a string");
      // Captured start anchors and explicit cursors share the same text shape.
      // Only the private caller supplies current-read admission provenance.
      const finiteStartNow = admission === "finite-start-now";
      const currentChangefeed = admission === "current-changefeed";
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : finiteStartNow || currentChangefeed
            ? snapshotCurrentReadMinimum(supplied)
            : snapshotTransactionMinimum(supplied);
      return enter(() => {
        if (minimum === "unsupported") return Object.freeze({ kind: "unsupported" as const });
        const context = readContext(),
          head = Number(context.scopePosition.slice(4)),
          start = checkpointPosition(scope, context, after);
        const stream = publication && changePublications.get(publication);
        const admitted =
          stream &&
          !stream.controller.signal.aborted &&
          stream.after === start &&
          stream.context.authorizationView === context.authorizationView &&
          stream.context.scopeEpoch === context.scopeEpoch;
        if (start < erasureFloor(context) && !admitted)
          throw new TransactionMinimumFailure("cursor-expired", context);
        if (start > head) throw new TransactionChangefeedParameterError(undefined, context);
        // Under this no-pruning owner every positive position through head was
        // committed. Its absent row is corruption, not a never-issued cursor.
        if (start > 0 && !db.prepare("SELECT position FROM groups WHERE position=?").get(start))
          throw new Error("missing retained change group");
        if (minimum !== undefined) {
          if (finiteStartNow || currentChangefeed) checkCurrentReadMinimum(minimum, context, true);
          else checkTransactionMinimum(minimum, context);
        }
        const row = retainedGroupReader()(start + 1, head);
        if ((!row && start < head) || (row && row.position !== start + 1))
          throw new Error("missing retained change group");
        const group = row
          ? projectTransactionChangeGroup(
              row.value,
              scope,
              context,
              row.position,
              authorization.readPolicy === "all-visible",
            )
          : undefined;
        let next: string | null = null;
        if (group && row && row.position < head) {
          if (!db.prepare("SELECT position FROM groups WHERE position=?").get(row.position + 1))
            throw new Error("missing retained change group");
          const url = new URL("changes/", scope);
          url.searchParams.set("after", group.checkpoint);
          next = url.href;
        }
        return Object.freeze({
          kind: "page" as const,
          context,
          page: freezeChangefeedPage({
            scope,
            scopeEpoch: context.scopeEpoch,
            authorizationView: context.authorizationView,
            after,
            observedHeadPosition: context.scopePosition,
            groups: group ? [group] : [],
            next,
          }),
        });
      });
    },
    readConfiguration: () =>
      enter(() =>
        Object.freeze({
          ...readConfiguration,
          authorizationView: authorization.authorizationView,
          authorization,
          scopeConfiguration: Object.freeze({
            ...readConfiguration.scopeConfiguration,
            policyIdentity: authorization.authorizationView,
          }),
        }),
      ),
    eraseHistoricalVersions,
    correctLiveBeadVersion,
    tombstoneLiveBeadVersion,
    correctLiveLinkVersion,
    tombstoneLiveLinkVersion,
    observeErasures(observer: () => void): () => void {
      return enter(() => {
        if (typeof observer !== "function") throw new TypeError("erasure observer required");
        erasureObservers.add(observer);
        return () => {
          erasureObservers.delete(observer);
        };
      });
    },
    /** Private retained-version observation, not a new History/HTTP operation. */
    readRetainedVersion(subject: string, revision: string) {
      if (typeof subject !== "string" || typeof revision !== "string")
        throw new TypeError("version identity required");
      return enter(() => {
        const context = readContext();
        if (authorization.readPolicy !== "all-visible")
          return Object.freeze({ kind: "missing" as const, context });
        const erased = db
          .prepare("SELECT type FROM erased_version_lineage WHERE subject=? AND revision=?")
          .get(subject, revision);
        if (erased)
          return Object.freeze({
            kind: "erased" as const,
            lineage: Object.freeze({ id: subject, type: String(erased.type), revision }),
            context,
          });
        const retained = db
          .prepare("SELECT body FROM retained_versions WHERE subject=? AND revision=?")
          .get(subject, revision);
        if (!retained) return Object.freeze({ kind: "missing" as const, context });
        const resource = JSON.parse(String(retained.body)) as unknown;
        freezeReceiptValue(resource);
        return Object.freeze({ kind: "retained" as const, resource, context });
      });
    },
    erasureLedgerInEntry() {
      if (!busy) throw new Error("erasure ledger requires an owner entry");
      return transactionErasureLedger(db);
    },
    erasureLedger() {
      return enter(() => {
        const records =
          authorization.readPolicy === "all-visible" ? transactionErasureLedger(db) : [];
        freezeReceiptValue(records);
        return records;
      });
    },
    assertPublication(context: TransactionReadContext) {
      return enter(() => {
        if (
          context.scopeEpoch !== epoch ||
          context.authorizationView !== authorization.authorizationView ||
          // Epoch/view equality above admits this view for the current ledger
          // query. No unrelated head observation is needed for this floor.
          Number(context.scopePosition.slice(4)) < erasureFloor(context)
        )
          throw new TransactionErasureFence("response predates erasure publication");
      });
    },
    acquireChangePublication(
      context: TransactionReadContext,
      after: string,
    ): TransactionChangePublication {
      return enter(() => {
        const current = readContext(),
          start = checkpointPosition(scope, current, after);
        if (
          context.scopeEpoch !== current.scopeEpoch ||
          context.authorizationView !== current.authorizationView ||
          start < erasureFloor(current)
        )
          throw new TransactionErasureFence("stream admission predates erasure");
        const controller = new AbortController();
        const lease: TransactionChangePublication = Object.freeze({
          signal: controller.signal,
          publish(checkpoint: string, write: () => boolean): boolean {
            return enter(() => {
              const state = changePublications.get(lease);
              if (!state || controller.signal.aborted)
                throw new TransactionErasureFence("stream publication ended");
              const next = checkpointPosition(scope, readContext(), checkpoint);
              if (next !== state.after + 1 || next > Number(metadata("position")))
                throw new Error("noncontiguous stream publication");
              const accepted = write();
              state.after = next; // write(false) still hands the WHOLE frame to Node.
              return accepted;
            });
          },
          release() {
            changePublications.delete(lease);
          },
        });
        changePublications.set(lease, { context, after: start, controller });
        return lease;
      });
    },
    captureReadAuthorization(reader: AuthorityReadReader, principal: ReadPrincipal) {
      // The reader is a capability for this exact live serialized entry.
      const snapshot = readAuthorizations.get(reader);
      if (!snapshot || !principal || typeof principal !== "object")
        throw new Error("authorization capture outside owner entry");
      return snapshot;
    },
    authorizationSnapshot: () => enter(() => authorization),
    acquireAuthorizationLease(expected: TransactionReadContext): TransactionAuthorizationLease {
      return enter(() => {
        if (
          expected.scopeEpoch !== epoch ||
          expected.authorizationView !== authorization.authorizationView
        )
          throw new TransactionAuthorizationFailure("foreign-view", readContext());
        const controller = new AbortController();
        leases.add(controller);
        return Object.freeze({
          signal: controller.signal,
          release: () => {
            leases.delete(controller);
          },
        });
      });
    },
    pauseMutationAdmission() {
      return enter(() => {
        if (mutationPause)
          throw new TransactionAuthorizationFailure("temporarily-unavailable", readContext());
        const token = Object.freeze({});
        mutationPause = token;
        return () => {
          if (mutationPause === token) mutationPause = undefined;
        };
      });
    },
    replaceAuthorizationPolicy() {
      return enter(() => {
        if (
          activeSequences.size ||
          db.prepare("SELECT 1 FROM receipts WHERE owner IS NOT NULL LIMIT 1").get()
        )
          throw new TransactionAuthorizationFailure("temporarily-unavailable", readContext());
        if (authorization.generation === 1) return authorization;
        const next = emptyTransactionAuthorization();
        atomic(() => {
          db.prepare("UPDATE metadata SET value=? WHERE name='authorizationPolicy'").run(
            json(next),
          );
          options.fault?.("before-policy-commit");
        });
        try {
          options.fault?.("after-policy-commit");
          authorization = next;
          revokeLeases();
        } catch (error) {
          throw fence(error);
        }
        return authorization;
      });
    },
    comparisonEpoch: () => {
      if (closed && !ownerFailure && !maintenanceFailure) return undefined;
      return enter(() => metadata("epoch"));
    },
    /** Private deadline observation: one owner entry and one atomic metadata read. */
    observeComparisonDeadline(
      expectedEpoch: string,
    ):
      | { readonly kind: "observed"; readonly context: TransactionReadContext }
      | { readonly kind: "owner-stopped" } {
      if (closed && !ownerFailure && !maintenanceFailure)
        return Object.freeze({ kind: "owner-stopped" });
      return enter(() =>
        atomic(() => {
          if (metadata("epoch") !== expectedEpoch)
            return Object.freeze({ kind: "owner-stopped" as const });
          return Object.freeze({ kind: "observed" as const, context: readContext() });
        }),
      );
    },
    maintain,
    admit,
    admitObserved(
      principal: string,
      key: string,
      batch: PreparedTransaction,
      controls?: TransactionReceivingControls,
    ) {
      return admit(principal, key, batch, controls, true);
    },
    admitSequence(
      principal: string,
      sequence: PreparedTransactionSequence,
    ): TransactionSequenceAdmission {
      return enter(() => {
        assertPreparedTransactionSequence(sequence, scope);
        if (mutationPause)
          throw new TransactionAuthorizationFailure("temporarily-unavailable", readContext());
        if (!authorization.canMutate)
          throw new TransactionAuthorizationFailure("forbidden", readContext());
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
              const template = member.deferred ? dependencyTemplate(id, member) : undefined;
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
            for (const claim of owned.values()) retireClaim(claim);
          }
        }
        activeSequences.add(attempt);
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
      if (!state)
        throw new TypeError(
          retiredSequences.has(attempt)
            ? "transaction sequence cancelled, reentrant or complete"
            : "foreign transaction sequence admission",
        );
      if (state.cancelled || state.busy || state.next >= state.sequence.members.length)
        throw new Error("transaction sequence cancelled, reentrant or complete");
      state.busy = true;
      try {
        const index = state.next,
          member = state.sequence.members[index];
        if (!member) throw new Error("lost sequence member");
        let claim = state.owned.get(index);
        const template = member.deferred ? dependencyTemplate(state.id, member) : undefined;
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
                if (claim) retireClaim(claim);
              }),
            );
          result = { kind: "transient" };
        } else {
          if (claim)
            enter(() => {
              const owner = ownedClaim(claim);
              const current = row(owner.principal, owner.key);
              if (current?.owner !== owner.owner) throw new Error("dependent resolution fenced");
              if (current.dependency === null) {
                if (template || !owner.normalized)
                  throw new Error("sequence deferral state differs");
                return;
              }
              const persisted = parseDependencyTemplate(current.dependency, scope);
              atomic(() => {
                if (!template || !isDeepStrictEqual(persisted, template))
                  throw new Error("sequence deferral template differs");
                const normalized = normalizeTransaction(
                  member.request,
                  resolveAlias,
                  undefined,
                  references,
                );
                const changed = db
                  .prepare(
                    "UPDATE receipts SET identity=?,witnesses=?,dependency=NULL WHERE principal=? AND key=? AND owner=?",
                  )
                  .run(
                    transactionRequestFingerprint(normalized),
                    commitTransactionWitnesses(normalized.witnessesJson, scope),
                    owner.principal,
                    owner.key,
                    owner.owner,
                  );
                if (changed.changes !== 1) throw new Error("dependent resolution fenced");
                owner.normalized = normalized;
                options.fault?.("after-dependency-resolution");
              });
            });
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
        if (done) {
          activeSequences.delete(attempt);
          sequenceAdmissions.delete(attempt);
          retiredSequences.add(attempt);
        }
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
    executeObserved: (claim: TransactionClaim) => executeClaim(claim, true),
    retract(claim: TransactionClaim): boolean {
      return enter(() => {
        const owned = claims.get(claim);
        if (!owned) return false;
        const removed = atomic(
          () =>
            Number(
              db
                .prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?")
                .run(owned.principal, owned.key, owned.owner).changes,
            ) === 1,
        );
        if (removed) retireClaim(claim);
        return removed;
      });
    },
    receipt(principal: string, id: string): TransactionReceipt | undefined {
      return enter(() =>
        atomic(() => {
          const value = retainedReceipt(principal, id);
          return (
            value && projectTransactionReceipt(value, authorization.readPolicy === "all-visible")
          );
        }),
      );
    },
    /** Trusted authenticated principal, never actor/provenance. Lookup, retention
     * cleanup, fixed current projection and source context share one owner entry.
     * No serving authorization callbacks run inside this observation. */
    readReceiptPage(
      principal: string,
      id: string,
      minimum?: TransactionMinimum | "unsupported",
    ):
      | {
          readonly kind: "page";
          readonly page: TransactionReceiptPage;
          readonly context: TransactionReadContext;
        }
      | { readonly kind: "expired"; readonly context: TransactionReadContext }
      | { readonly kind: "missing"; readonly context?: TransactionReadContext }
      | { readonly kind: "unsupported" } {
      if (
        typeof principal !== "string" ||
        !principal ||
        !principal.isWellFormed() ||
        typeof id !== "string"
      )
        throw new TypeError("trusted principal and page URL required");
      const condition =
        minimum === undefined || minimum === "unsupported"
          ? minimum
          : snapshotCurrentReadMinimum(minimum);
      return enter(() =>
        atomic(() => {
          const marker = id.lastIndexOf("/pages/");
          if (marker < 0) return { kind: "missing" as const };
          const parentId = id.slice(0, marker),
            token = id.slice(marker + 7);
          if (!parentId.startsWith(`${scope}receipts/`)) return { kind: "missing" as const };
          const saved = db
            .prepare("SELECT * FROM receipt_pages WHERE receipt=? AND principal=?")
            .get(parentId, principal);
          if (!saved) {
            // A visible completed parent must have its durable plan, even after expiry.
            // Nonexistent pages must not trigger retention on failed parents.
            const parent = disclosedReceipt(principal, parentId);
            if (parent && parseReceipt(parent.receipt).status === "completed")
              throw new Error("receipt page plan missing");
            return Object.freeze({ kind: "missing" as const, context: readContext() });
          }
          const stored = row(principal, String(saved.key));
          if (!stored) throw new Error("receipt page parent missing");
          const original = parseReceipt(stored.receipt);
          if (original.id !== parentId) throw new Error("receipt page parent mismatch");
          if (original.scopeEpoch !== epoch)
            return Object.freeze({ kind: "missing" as const, context: readContext() });
          const plan = pagePlan(original),
            index = plan.pages.findIndex((page) => page.token === token);
          if (index < 0) return Object.freeze({ kind: "missing" as const, context: readContext() });
          if (condition === "unsupported") return { kind: "unsupported" as const };
          const context = readContext();
          // Identity/nondisclosure precedes minimum; expiry is checked only afterwards.
          if (condition) checkCurrentReadMinimum(condition, context, true);
          const remaining = expireRow(stored, instant()).row;
          if (!remaining) throw new Error("completed page parent was forgotten");
          const receipt = parseReceipt(remaining.receipt);
          if (receipt.detail === "expired") return { kind: "expired" as const, context };
          observeReceipt(receipt, context); // same projection/integrity policy, no second clock
          const boundary = plan.pages[index];
          if (!boundary) throw new Error("receipt page boundary missing");
          const results = (receipt.results as readonly unknown[])
            .slice(boundary.start, boundary.end)
            .map((entry) =>
              projectTransactionEntry(entry, authorization.readPolicy === "all-visible"),
            );
          // Freeze the selected page entries before they escape the owner entry.
          const next = plan.pages[index + 1];
          const page = {
            receipt: parentId,
            results,
            next: next ? pageUrl(parentId, next.token) : null,
          };
          freezeReceiptValue(page);
          return Object.freeze({ kind: "page" as const, page, context });
        }),
      );
    },
    readReceipt,
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
      revokeLeases();
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  });
}
