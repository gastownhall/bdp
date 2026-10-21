/** Offline native restore into an existing, exclusively held permanent anchor.
 * Source-private only: no public Snapshot, caller completeness flag or HTTP API.
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { assertCanonicalPathSegments, referenceUri } from "@bdp/protocol";
import { validateServerBead, validateServerLink } from "./read-request.js";
import { readStoredResource } from "./resource-evaluator.js";
import { INITIAL_TRANSACTION_VIEW } from "./transaction-authorization.js";
import { TRANSACTION_RUNTIME_LIMITS, transactionStorageText } from "./transaction-batch.js";
import { TRANSACTION_EVENT_GROUP_BYTES } from "./transaction-events.js";

function requireNative(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`native restore refused: ${message}`);
}

/** Runs inside the destination's existing BEGIN IMMEDIATE transaction. The
 * destination, never a supplied backup, is the latest permanent-state anchor.
 * Caller retires issued Snapshots before this operation in the SAME transaction.
 */
export function applyNativeTransactionRestore(
  db: DatabaseSync,
  destination: string,
  backup: string,
  scope: string,
  configuration: string,
  capture: string,
): { readonly epoch: string; readonly positions: number } {
  requireNative(db.isTransaction, "existing owner transaction required");
  requireNative(path.isAbsolute(backup), "absolute backup path required");
  const a = statSync(destination),
    b = statSync(backup);
  requireNative(
    b.isFile() && (a.dev !== b.dev || a.ino !== b.ino),
    "distinct native file required",
  );
  const source = new DatabaseSync(backup, { readOnly: true });
  let closed = false;
  try {
    source.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=0; BEGIN");
    requireNative(
      source.prepare("PRAGMA quick_check").get()?.quick_check === "ok",
      "SQLite integrity",
    );
    const meta = (name: string) =>
      source.prepare("SELECT value FROM metadata WHERE name=?").get(name)?.value;
    requireNative(meta("configuration") === configuration, "exact current installation required");
    requireNative(meta("contractCapture") === capture, "exact contract capture required");
    requireNative(
      meta("requestFingerprintPolicy") ===
        db.prepare("SELECT value FROM metadata WHERE name='requestFingerprintPolicy'").get()?.value,
      "fingerprint policy mismatch",
    );
    requireNative(
      typeof meta("epoch") === "string" && Number.isSafeInteger(Number(meta("position"))),
      "native history metadata",
    );

    // A backup from a different allocation lineage cannot become this Scope.
    // Every backup identity and retained address must already be accounted for
    // by the current destination: either original retained bytes or erasure.
    for (const row of source.prepare("SELECT id FROM identities").iterate())
      requireNative(
        db.prepare("SELECT 1 FROM identities WHERE id=?").get(String(row.id)) !== undefined,
        "unknown permanent identity",
      );
    const checkOriginal = (subject: string, revision: string, body: string, live: boolean) => {
      const erased = db
        .prepare("SELECT 1 FROM erasure_ledger WHERE subject=? AND revision=?")
        .get(subject, revision);
      requireNative(!live || !erased, "backup contains erased LIVE image");
      if (erased) return;
      const retained = db
        .prepare("SELECT body FROM retained_versions WHERE subject=? AND revision=?")
        .get(subject, revision);
      requireNative(
        retained &&
          typeof retained.body === "string" &&
          isDeepStrictEqual(JSON.parse(retained.body), JSON.parse(body)),
        "retained address conflict or missing original",
      );
    };
    for (const row of source
      .prepare("SELECT subject,revision,body FROM retained_versions")
      .iterate())
      checkOriginal(String(row.subject), String(row.revision), String(row.body), false);
    for (const row of source
      .prepare("SELECT subject,revision,record FROM erasure_ledger")
      .iterate()) {
      const current = db
        .prepare("SELECT record FROM erasure_ledger WHERE subject=? AND revision=?")
        .get(String(row.subject), String(row.revision));
      requireNative(
        current && current.record === row.record,
        "backup ledger is not contained in current anchor",
      );
    }
    // Bound each original before decoding it; use the existing native Resource
    // codec and endpoint indexes, not a projected/public Snapshot image.
    for (const row of source
      .prepare("SELECT id,kind,source,target,length(CAST(body AS BLOB)) AS bytes FROM resources")
      .iterate()) {
      requireNative(
        Number(row.bytes) <= TRANSACTION_RUNTIME_LIMITS.representationBytes,
        "Resource byte bound",
      );
      const stored = source.prepare("SELECT body FROM resources WHERE id=?").get(String(row.id))!;
      requireNative(row.kind === "bead" || row.kind === "link", "Resource kind");
      const record = readStoredResource(
        row.kind === "bead"
          ? {
              id: String(row.id),
              kind: "bead",
              bodyJson: String(stored.body),
            }
          : {
              id: String(row.id),
              kind: "link",
              bodyJson: String(stored.body),
              source: String(row.source),
              target: String(row.target),
            },
        scope,
      );
      if (row.kind === "bead") validateServerBead(record, scope);
      else {
        requireNative("source" in record && "target" in record, "Link endpoints");
        validateServerLink(record, scope);
        for (const endpoint of ["source", "target"] as const) {
          const uri = referenceUri(record[endpoint]);
          requireNative(
            row[endpoint] === (uri.startsWith(scope) ? uri.slice(scope.length) : uri),
            "Link endpoint index",
          );
        }
      }
      requireNative(
        db.prepare("SELECT 1 FROM identities WHERE id=?").get(String(row.id)),
        "LIVE image identity",
      );
      checkOriginal(record.id, record.revision, String(stored.body), true);
      // Match original native bytes, not readStoredResource's legacy metadata
      // projection. Inline owned versions are independent permanent addresses.
      const original = JSON.parse(String(stored.body)) as {
        ownedLinks?: Record<string, { id: string; revision: string }[]>;
      };
      if (original.ownedLinks)
        for (const links of Object.values(original.ownedLinks))
          for (const link of links)
            checkOriginal(link.id, link.revision, transactionStorageText(link), true);
    }
    for (const row of source.prepare("SELECT path,target FROM aliases").iterate()) {
      requireNative(typeof row.path === "string" && typeof row.target === "string", "alias fields");
      assertCanonicalPathSegments(`alias/${row.path}`, "native alias");
      assertCanonicalPathSegments(row.target, "native alias target");
      requireNative(
        row.target.startsWith("beads/") &&
          db.prepare("SELECT 1 FROM identities WHERE id=?").get(row.target),
        "alias target identity",
      );
    }

    db.exec("DELETE FROM resources; DELETE FROM aliases");
    const put = db.prepare("INSERT INTO resources VALUES(?,?,?,?,?)");
    for (const row of source.prepare("SELECT * FROM resources").iterate())
      put.run(
        String(row.id),
        String(row.body),
        String(row.kind),
        row.source === null ? null : String(row.source),
        row.target === null ? null : String(row.target),
      );
    const alias = db.prepare("INSERT INTO aliases VALUES(?,?)");
    for (const row of source.prepare("SELECT * FROM aliases").iterate())
      alias.run(String(row.path), String(row.target));
    // These are epoch-local capabilities/history, not permanent identities.
    db.exec(
      "DELETE FROM receipt_page_ranges; DELETE FROM receipt_pages; DELETE FROM receipts; DELETE FROM creator_facts; DELETE FROM groups; DELETE FROM erased_creation_facts; DELETE FROM erased_event_cursors",
    );
    const epoch = randomUUID();
    db.prepare("UPDATE metadata SET value=? WHERE name='epoch'").run(epoch);
    let position = 0;
    let records: unknown[] = [];
    let payloadBytes = 0;
    let transaction = randomUUID();
    const frame = (items: readonly unknown[]) => ({
      scopeEpoch: epoch,
      authorizationView: INITIAL_TRANSACTION_VIEW,
      checkpoint: `pos-${position + 1}`,
      position: `pos-${position + 1}`,
      previousPosition: `pos-${position}`,
      projectionAdvance: false,
      transaction,
      changes: [],
      erasures: items,
      eventCount: 0,
      events: [],
    });
    const flush = () => {
      if (!records.length) return;
      const body = transactionStorageText(frame(records));
      requireNative(
        Buffer.byteLength(body) <= TRANSACTION_EVENT_GROUP_BYTES,
        "ledger group byte bound",
      );
      position++;
      db.prepare("INSERT INTO groups VALUES(?,?)").run(position, body);
      for (const value of records) {
        const record = value as { subject: string; revision: string };
        db.prepare("UPDATE erasure_ledger SET position=? WHERE subject=? AND revision=?").run(
          position,
          record.subject,
          record.revision,
        );
      }
      records = [];
      payloadBytes = 0;
      transaction = randomUUID();
    };
    // Sorted stable permanent identities; greedily bounded whole groups, no
    // prior-epoch Event or receipt ever enters the new epoch's prefix.
    for (const row of db
      .prepare("SELECT record FROM erasure_ledger ORDER BY subject,revision")
      .iterate()) {
      const record: unknown = JSON.parse(String(row.record));
      const recordBytes = Buffer.byteLength(transactionStorageText(record));
      // Empty-array frame already includes both brackets. Only complete record
      // bytes and inter-record commas replace its empty payload; no repeated
      // serialization/copy of the growing permanent ledger prefix.
      const envelopeBytes = () => Buffer.byteLength(transactionStorageText(frame([])));
      if (
        envelopeBytes() + payloadBytes + (records.length ? 1 : 0) + recordBytes >
        TRANSACTION_EVENT_GROUP_BYTES
      )
        flush();
      requireNative(
        envelopeBytes() + recordBytes <= TRANSACTION_EVENT_GROUP_BYTES,
        "single ledger record exceeds group byte bound",
      );
      payloadBytes += (records.length ? 1 : 0) + recordBytes;
      records.push(record);
    }
    flush();
    db.prepare("UPDATE metadata SET value=? WHERE name='position'").run(String(position));
    source.close();
    closed = true;
    return Object.freeze({ epoch, positions: position });
  } catch (error) {
    try {
      if (!closed) source.close();
    } catch (close) {
      throw new AggregateError([error, close], "native restore and backup close failed");
    }
    throw error;
  }
}
