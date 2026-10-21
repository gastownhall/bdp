/** Local administrative historical-version erasure. No BDP operation or HTTP route. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { stringifyJsonValue } from "@bdp/protocol";
import type { TransactionEvent } from "./transaction-batch.js";

export interface TransactionErasureRecord {
  readonly subject: string;
  readonly revision: string;
  readonly digest: { readonly scheme: "sha-256-jcs"; readonly value: string };
}
export interface HistoricalErasureSubject {
  readonly subject: string;
  readonly revision: string;
}
export const transactionErasureSchema = `
CREATE TABLE IF NOT EXISTS retained_versions(subject TEXT NOT NULL, revision TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(subject,revision)) STRICT;
CREATE TABLE IF NOT EXISTS erased_version_lineage(subject TEXT NOT NULL, revision TEXT NOT NULL, type TEXT NOT NULL, PRIMARY KEY(subject,revision)) STRICT;
CREATE TABLE IF NOT EXISTS erasure_ledger(subject TEXT NOT NULL, revision TEXT NOT NULL, position INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY(subject,revision)) STRICT;
CREATE TABLE IF NOT EXISTS erased_creation_facts(receipt TEXT NOT NULL, operation INTEGER NOT NULL, PRIMARY KEY(receipt,operation)) STRICT;
CREATE TABLE IF NOT EXISTS erased_event_cursors(position INTEGER NOT NULL, ordinal INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY(position,ordinal,source)) STRICT;
`;

/** Iterative JCS over already-admitted binary64 JSON; numeric member names must
 * be emitted directly, because JSON.stringify(object) reorders integer keys. */
export function erasureCanonicalJson(value: unknown): string {
  return serializeErasureRecord(value, false);
}
function serializeErasureRecord(value: unknown, bestEffort: boolean): string {
  const output: string[] = [];
  const pending: ({ value: unknown } | { text: string })[] = [{ value }];
  while (pending.length) {
    const task = pending.pop()!;
    if ("text" in task) {
      output.push(task.text);
      continue;
    }
    const node = task.value;
    if (
      node === null ||
      typeof node === "boolean" ||
      typeof node === "string" ||
      (typeof node === "number" && (Number.isFinite(node) || bestEffort))
    ) {
      if (typeof node === "string" && !node.isWellFormed() && !bestEffort)
        throw new TypeError("non-scalar retained string");
      output.push(JSON.stringify(node));
    } else if (Array.isArray(node)) {
      output.push("[");
      pending.push({ text: "]" });
      for (let i = node.length - 1; i >= 0; i--) {
        pending.push({ value: node[i] });
        if (i) pending.push({ text: "," });
      }
    } else if (node && typeof node === "object") {
      const entries = Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      output.push("{");
      pending.push({ text: "}" });
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, entry] = entries[i]!;
        if (!key.isWellFormed() && !bestEffort)
          throw new TypeError("non-scalar retained member name");
        pending.push({ value: entry }, { text: `${JSON.stringify(key)}:` });
        if (i) pending.push({ text: "," });
      }
    } else throw new TypeError("non-JSON retained version");
  }
  return output.join("");
}
export const erasureSourceTag = (source: string): string =>
  createHash("sha256").update(source).digest("hex");

/** Called within the owner's SQLite transaction. Every original postimage,
 * including intermediate receipt versions and inline owned Links, is retained. */
export function retainErasureVersions(db: DatabaseSync, value: unknown): void {
  const pending = [value];
  const insert = db.prepare("INSERT OR IGNORE INTO retained_versions VALUES(?,?,?)");
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    if (
      typeof record.id === "string" &&
      typeof record.type === "string" &&
      typeof record.revision === "string" &&
      record.properties !== undefined
    ) {
      // The links aggregate is navigation, not the version's Resource record.
      const { links: _links, ...original } = record;
      const erased = db
        .prepare("SELECT 1 FROM erasure_ledger WHERE subject=? AND revision=?")
        .get(record.id, record.revision);
      if (erased) throw new Error("erased version cannot be retained again");
      insert.run(record.id, record.revision, stringifyJsonValue(original));
    }
    if (record.ownedLinks && typeof record.ownedLinks === "object")
      for (const links of Object.values(record.ownedLinks))
        if (Array.isArray(links)) pending.push(...links);
  }
}

export function transactionErasureLedger(db: DatabaseSync): readonly TransactionErasureRecord[] {
  return db
    .prepare("SELECT record FROM erasure_ledger ORDER BY position,subject,revision")
    .all()
    .map((row) => JSON.parse(String(row.record)) as TransactionErasureRecord);
}

/** Plan the entire cascade before the first write. A live member rejects the
 * complete administrative act; this API never manufactures a successor. */
export function planHistoricalErasure(
  db: DatabaseSync,
  scope: string,
  requested: readonly HistoricalErasureSubject[],
): readonly {
  readonly body: Record<string, unknown>;
  readonly record: TransactionErasureRecord;
  readonly digestAnomaly?: string;
}[] {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 4096)
    throw new TypeError("one to 4096 historical versions required");
  const selected = new Map<string, Record<string, unknown>>();
  const key = (subject: string, revision: string) => JSON.stringify([subject, revision]);
  for (const item of requested) {
    if (
      !item ||
      typeof item.subject !== "string" ||
      !item.subject.startsWith(scope) ||
      typeof item.revision !== "string" ||
      !item.revision
    )
      throw new TypeError("canonical historical subject and revision required");
    const row = db
      .prepare("SELECT body FROM retained_versions WHERE subject=? AND revision=?")
      .get(item.subject, item.revision);
    if (!row) throw new Error("historical version not retained or already erased");
    selected.set(key(item.subject, item.revision), JSON.parse(String(row.body)));
  }
  // An inline version is a complete copy, so its owning version joins the same
  // erasure act. Iterate until closure (including nested owned copies).
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of db.prepare("SELECT body FROM retained_versions").iterate()) {
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      if (selected.has(key(String(body.id), String(body.revision)))) continue;
      const contains = Object.values((body.ownedLinks ?? {}) as Record<string, unknown>).some(
        (links) =>
          Array.isArray(links) &&
          links.some(
            (link) =>
              link &&
              typeof link === "object" &&
              selected.has(key(String(link.id), String(link.revision))),
          ),
      );
      if (contains) {
        selected.set(key(String(body.id), String(body.revision)), body);
        changed = true;
        if (selected.size > 4096)
          throw new Error("historical erasure cascade exceeds administrative bound");
      }
    }
  }
  if (selected.size > 4096)
    throw new Error("historical erasure cascade exceeds administrative bound");
  for (const body of selected.values()) {
    if (typeof body.id !== "string" || !body.id.startsWith(scope))
      throw new TypeError("canonical same-scope cascade subject required");
    const row = db
      .prepare("SELECT body FROM resources WHERE id=?")
      .get(body.id.slice(scope.length));
    if (row && (JSON.parse(String(row.body)) as Record<string, unknown>).revision === body.revision)
      throw new Error("live-version erasure requires an atomic successor or tombstone");
  }
  return [...selected.values()].map((body) => {
    let canonical: string, digestAnomaly: string | undefined;
    try {
      canonical = erasureCanonicalJson(body);
    } catch (error) {
      // Content outside the admitted Resource contract still gets purged. The
      // caller receives an out-of-band anomaly after the commit, never a BDP Event.
      canonical = serializeErasureRecord(body, true);
      digestAnomaly = error instanceof Error ? error.message : "canonicalization failed";
    }
    return {
      body,
      record: {
        subject: String(body.id),
        revision: String(body.revision),
        digest: {
          scheme: "sha-256-jcs" as const,
          value: createHash("sha256").update(canonical).digest("hex"),
        },
      },
      ...(digestAnomaly === undefined ? {} : { digestAnomaly }),
    };
  });
}

export function eraseReceiptEntry(value: unknown, selected: ReadonlySet<string>): unknown {
  if (!value || typeof value !== "object") return value;
  const entry = value as Record<string, unknown>;
  const resource = entry.resource as Record<string, unknown> | undefined;
  if (!resource || !selected.has(JSON.stringify([resource.id, resource.revision]))) return value;
  return {
    operationIndex: entry.operationIndex,
    ...(entry.operationName === undefined ? {} : { operationName: entry.operationName }),
    outcome: "erased",
    erased: { id: resource.id, type: resource.type, revision: resource.revision },
    ...(entry.source === undefined
      ? {}
      : { source: entry.source, sourceRevision: entry.sourceRevision }),
  };
}

/** Immutable facts are withheld whole, never rewritten into safer-looking
 * deltas. An ordinary successor patch can disclose its erased predecessor via
 * test values, remove/replace paths or prior values even when its own version
 * remains healthy. Exact full root replacement and owned deletion lineage are
 * the content-free forms already defined by the erasure contract. */
export function erasedContentEvent(
  event: TransactionEvent,
  selected: ReadonlySet<string>,
  endpointsGone: ReadonlySet<string>,
): boolean {
  const erased = (id: unknown, revision: unknown) => selected.has(JSON.stringify([id, revision]));
  if (event.type === "deleted") return false;
  if (event.type === "linked" || event.type === "unlinked") return endpointsGone.has(event.subject);
  const data = event.data as Record<string, unknown>;
  const owned = data.ownedLink as
    | { operation?: string; link?: Record<string, unknown> }
    | undefined;
  if (erased(event.subject, data.revision)) return true;
  if (
    (owned?.operation === "created" || owned?.operation === "updated") &&
    owned.link &&
    erased(owned.link.id, owned.link.revision)
  )
    return true;
  if (event.type !== "updated") return false;
  const ordinaryDelta = (value: unknown): boolean => {
    if (value === undefined) return false;
    if (!Array.isArray(value) || value.length !== 1) return true;
    const operation = value[0] as Record<string, unknown> | null;
    return (
      !operation ||
      Object.keys(operation).sort().join(",") !== "op,path,value" ||
      operation.op !== "replace" ||
      operation.path !== "" ||
      !operation.value ||
      typeof operation.value !== "object" ||
      Array.isArray(operation.value)
    );
  };
  if (
    erased(event.subject, data.previousRevision) &&
    (ordinaryDelta(data.change) || ordinaryDelta(data.metadataChange))
  )
    return true;
  return (
    owned?.operation === "updated" &&
    owned.link !== undefined &&
    erased(owned.link.id, owned.link.previousRevision) &&
    (ordinaryDelta(owned.link.change) || ordinaryDelta(owned.link.metadataChange))
  );
}
