/** Independent private Transactional owner. Never open this format as a RU store. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseCanonicalScope, parseTypeDescriptor, type TypeDescriptor } from "@bdp/protocol";
import type { EvaluatorStoredResource } from "./resource-evaluator.js";
import {
  assertPreparedTransaction,
  evaluateTransaction,
  transactionStorageText as json,
  type PreparedTransaction,
  type TransactionMutationContext,
} from "./transaction-batch.js";

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
  | { readonly kind: "conflict" };
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
    stage: "after-admission" | "after-effects" | "after-terminal" | "before-maintenance-commit",
  ) => void;
}
interface Row {
  principal: string;
  key: string;
  identity: string;
  owner: string | null;
  receipt: string;
}
const day = 86400000;
const format = "bdp-private-transaction-alias-2";
const schema = `
CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE resources(id TEXT PRIMARY KEY, body TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, target TEXT) STRICT;
CREATE TABLE identities(id TEXT PRIMARY KEY) STRICT;
CREATE TABLE aliases(path TEXT PRIMARY KEY, target TEXT NOT NULL) STRICT;
CREATE TABLE receipts(principal TEXT NOT NULL, key TEXT NOT NULL, identity TEXT NOT NULL, owner TEXT, receipt TEXT NOT NULL, PRIMARY KEY(principal,key)) STRICT;
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
  const claims = new WeakMap<
    TransactionClaim,
    { principal: string; key: string; owner: string; batch: PreparedTransaction }
  >();
  function enter<T>(run: () => T): T {
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
  function atomic<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = run();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
      } else if (metadata("configuration") !== configuration)
        throw new Error("transaction installation mismatch");
      const retracted = Number(
        db.prepare("DELETE FROM receipts WHERE owner IS NOT NULL").run().changes,
      );
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
  return Object.freeze({
    scope,
    scopeEpoch: epoch,
    recoveredPending,
    maintain,
    admit(principal: string, key: string, batch: PreparedTransaction): TransactionAdmission {
      return enter(() => {
        assertPreparedTransaction(batch, scope);
        if (
          typeof principal !== "string" ||
          principal.length === 0 ||
          !principal.isWellFormed() ||
          !/^[A-Za-z0-9_-]{1,256}$/.test(key)
        )
          throw new TypeError("principal/key required");
        const admission = atomic((): TransactionAdmission => {
          const stored = row(principal, key);
          const prior = stored ? expireRow(stored, instant()).row : undefined;
          if (prior)
            return prior.identity !== batch.identity
              ? { kind: "conflict" }
              : { kind: "existing", receipt: parseReceipt(prior.receipt) };
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
          db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?)").run(
            principal,
            key,
            batch.identity,
            owner,
            json(receipt),
          );
          claims.set(claim, { principal, key, owner, batch });
          return { kind: "owned", claim };
        });
        if (admission.kind === "owned") {
          try {
            options.fault?.("after-admission");
          } catch (error) {
            const owned = claims.get(admission.claim);
            if (!owned) throw new Error("lost admitted claim", { cause: error });
            atomic(() => {
              db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
                owned.principal,
                owned.key,
                owned.owner,
              );
            });
            claims.delete(admission.claim);
            throw error;
          }
        }
        return admission;
      });
    },
    execute(claim: TransactionClaim): TransactionReceipt {
      return enter(() => {
        const owned = claims.get(claim);
        if (!owned) throw new Error("foreign transaction claim");
        try {
          return atomic(() => {
            const current = row(owned.principal, owned.key);
            if (current?.owner !== owned.owner) throw new Error("transaction execution fenced");
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
                    .prepare(
                      "SELECT id FROM resources WHERE kind='link' AND (source=? OR target=?)",
                    )
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
              putAlias: (path, target) => scoped(() => {
                db.prepare("INSERT INTO aliases VALUES(?,?) ON CONFLICT(path) DO UPDATE SET target=excluded.target").run(path, target);
              }),
              deleteAlias: (path) => scoped(() => {
                db.prepare("DELETE FROM aliases WHERE path=?").run(path);
              }),
              installedType: (id) => scoped(() => installed.get(id)),
              allocateResourceId: (kind) =>
                scoped(() => {
                  for (let attempt = 0; attempt < 32; attempt++) {
                    const suffix = randomUUID(), id = `${kind === "bead" ? "beads" : "links"}/${suffix}`;
                    if (!db.prepare("SELECT id FROM identities WHERE id=?").get(id) &&
                        (kind !== "bead" || alias(suffix) === undefined)) return id;
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
                  owned.batch,
                  tx,
                  {
                    scope,
                    contracts: {
                      get(id, bytes) {
                        const descriptor = descriptors.find((d) => d.id === id);
                        return descriptor && installed.get(id) === bytes
                          ? { descriptor }
                          : undefined;
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
            options.fault?.("after-terminal");
            return receipt;
          });
        } catch (error) {
          // A live internal/transient abort retracts only this execution's pending
          // reservation. An abrupt process death is handled by startup instead.
          atomic(() => {
            db.prepare("DELETE FROM receipts WHERE principal=? AND key=? AND owner=?").run(
              owned.principal,
              owned.key,
              owned.owner,
            );
          });
          throw error;
        } finally {
          claims.delete(claim);
        }
      });
    },
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
