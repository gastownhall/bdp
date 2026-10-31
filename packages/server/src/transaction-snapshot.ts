import { jsonValueEqual } from "./json-value-equality.js";
import { INITIAL_TRANSACTION_VIEW } from "./transaction-authorization.js";
/** Source-private durable Snapshot owner support. No HTTP route or admission claim. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  BDP_PROBLEM_FAMILY_PREFIX,
  compareCanonicalIds,
  parseCanonicalScope,
  referenceUri,
  stringifyJsonValue,
  type BeadRecord,
  type LinkRecord,
  type TypeDescriptor,
} from "@bdp/protocol";
import { readStoredResource, type ResourceRecord } from "./resource-evaluator.js";
import { validateServerBead, validateServerLink, validateServerEndpoint } from "./read-request.js";
import { transactionCheckpoint } from "./transaction-changefeed.js";
import { TRANSACTION_RUNTIME_LIMITS } from "./transaction-batch.js";
import type { TransactionReadContext } from "./transaction-store.js";

export const TRANSACTION_SNAPSHOT_LIMITS = Object.freeze({
  lifetimeMs: 5 * 60 * 1000,
  resources: 4096,
  recordBytes: 32 * 1024 * 1024,
  liveHandles: 8,
  liveRecordBytes: 64 * 1024 * 1024,
  issuedHandles: 65536,
  dispositionBytes: 1024,
  snapshotPageItems: 32,
  pageBytes: 4 * 1024 * 1024,
  manifestBytes: 10 * 1024 * 1024,
});
export const TRANSACTION_SNAPSHOT_TOKEN_POLICY = "hmac-sha256-ordinal-1";
export const transactionSnapshotSchema = `
CREATE TABLE snapshots(id TEXT PRIMARY KEY, disposition TEXT NOT NULL) STRICT;
CREATE TABLE snapshot_records(snapshot TEXT NOT NULL, kind TEXT NOT NULL, ordinal INTEGER NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(snapshot,kind,ordinal), UNIQUE(snapshot,id)) STRICT;
CREATE TABLE snapshot_pages(snapshot TEXT NOT NULL, kind TEXT NOT NULL, ordinal INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, start INTEGER NOT NULL, end INTEGER NOT NULL, bytes INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(snapshot,kind,ordinal)) STRICT;
`;
type Kind = "bead" | "link";
interface Disposition {
  readonly epoch: string;
  readonly view: string;
  readonly position: number;
  readonly created: number;
  readonly expires: number;
  readonly expired: boolean;
  readonly counts: readonly [number, number];
  readonly bytes: number;
  readonly plan: string;
  readonly seed: string;
  readonly pageCounts: readonly [number, number];
  readonly binding: string;
}
interface PageRange {
  kind: Kind;
  ordinal: number;
  token: string;
  start: number;
  end: number;
  bytes: number;
  digest: string;
}
export interface TransactionSnapshotPage {
  readonly items: readonly ResourceRecord[];
  readonly next: string | null;
}
export interface TransactionSnapshotManifest {
  readonly id: string;
  readonly scope: string;
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly scopePosition: string;
  readonly checkpoint: string;
  readonly expiresAt: string;
  readonly erasures: readonly never[];
  readonly beads: TransactionSnapshotPage;
  readonly links: TransactionSnapshotPage;
}
export type TransactionSnapshotRequest =
  | { readonly kind: "preflight" }
  | { readonly kind: "create" }
  | { readonly kind: "manifest"; readonly id: string }
  | { readonly kind: "page"; readonly id: string; readonly stream: Kind; readonly token: string };
export class TransactionSnapshotFailure extends Error {
  readonly problem: Readonly<Record<string, unknown>>;
  constructor(
    readonly code:
      | "resource-not-found"
      | "cursor-expired"
      | "foreign-view"
      | "limit-exceeded"
      | "temporarily-unavailable",
    readonly retryAfter?: number,
  ) {
    super(`Snapshot ${code}`);
    const [family, status, retry] = {
      "resource-not-found": ["not-found", 404, "after-state-change"],
      "cursor-expired": ["gone", 410, "after-state-change"],
      "foreign-view": ["conflict", 409, "after-state-change"],
      "limit-exceeded": ["size", 413, "never"],
      "temporarily-unavailable": ["unavailable", 503, "after-delay"],
    }[code];
    this.problem = Object.freeze({
      type: `${BDP_PROBLEM_FAMILY_PREFIX}${family}`,
      title: code,
      status,
      code,
      retry,
      ...(code === "temporarily-unavailable" ? { retryAfter } : {}),
    });
  }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const text = stringifyJsonValue;
const bytes = (value: string) => Buffer.byteLength(value);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function pageToken(seed: string, id: string, kind: Kind, ordinal: number): string {
  const tag = createHmac("sha256", Buffer.from(seed, "hex"))
    .update(text([TRANSACTION_SNAPSHOT_TOKEN_POLICY, id, kind, ordinal]))
    .digest("base64url");
  return `sp_${ordinal}_${tag}`;
}
function sealDisposition(id: string, input: Omit<Disposition, "binding">): Disposition {
  return { ...input, binding: hash(text([id, input])) };
}
function integrity(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Snapshot integrity: ${message}`);
}
function freeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (node && typeof node === "object" && !Object.isFrozen(node)) {
      pending.push(...Object.values(node));
      Object.freeze(node);
    }
  }
  return value;
}
export function transactionSnapshotUrl(
  scope: string,
  id: string,
  kind?: Kind,
  token?: string,
): string {
  const url = new URL("snapshot", scope);
  url.searchParams.set("snapshot", id);
  if (kind !== undefined && token !== undefined) {
    url.searchParams.set("stream", `${kind}s`);
    url.searchParams.set("page", token);
  }
  return url.href;
}
/** All methods run inside the existing synchronous owner entry/atomic boundary.
 * No timer, connection, callback or authority capability escapes this module. */
export function transactionSnapshotStorage(
  db: DatabaseSync,
  canonicalScope: string,
  types: readonly TypeDescriptor[],
  visible: () => boolean = () => true,
) {
  const scope = parseCanonicalScope(canonicalScope),
    limits = TRANSACTION_SNAPSHOT_LIMITS;
  const descriptors = new Map(types.map((type) => [type.id, type]));
  // Lazy because this support is constructed before first provisioning creates
  // its tables. Only this module's finite literal SQL set enters the cache.
  const statements = new Map<string, StatementSync>();
  function statement(sql: string): StatementSync {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      statements.set(sql, prepared);
    }
    return prepared;
  }
  function disposition(id: string, context: TransactionReadContext): Disposition | undefined {
    const row = statement(
      "SELECT length(CAST(disposition AS BLOB)) AS bytes FROM snapshots WHERE id=?",
    ).get(id);
    if (!row) return undefined;
    integrity(
      Number(row.bytes) + Buffer.byteLength(id) <= limits.dispositionBytes,
      "oversized disposition",
    );
    const stored = statement("SELECT disposition FROM snapshots WHERE id=?").get(id)?.disposition;
    integrity(typeof stored === "string", "missing disposition");
    const d = JSON.parse(stored) as Disposition;
    integrity(
      d &&
        Object.keys(d).sort().join(",") ===
          "binding,bytes,counts,created,epoch,expired,expires,pageCounts,plan,position,seed,view",
      "disposition fields",
    );
    const { binding, ...unsigned } = d;
    integrity(
      typeof binding === "string" && binding === sealDisposition(id, unsigned).binding,
      "disposition commitment",
    );
    integrity(typeof d.seed === "string" && /^[a-f0-9]{64}$/.test(d.seed), "page token seed");
    integrity(
      Array.isArray(d.pageCounts) &&
        d.pageCounts.length === 2 &&
        d.pageCounts.every(
          (count) => Number.isSafeInteger(count) && count >= 1 && count <= limits.resources,
        ),
      "issued page counts",
    );
    integrity(
      d.epoch === context.scopeEpoch &&
        (d.view === context.authorizationView || d.view === INITIAL_TRANSACTION_VIEW),
      "persisted context mismatch",
    );
    integrity(
      Number.isSafeInteger(d.position) &&
        d.position >= 0 &&
        d.position <= Number(context.scopePosition.slice(4)),
      "anchor exceeds owner",
    );
    integrity(
      Number.isSafeInteger(d.created) &&
        d.created >= 0 &&
        Number.isSafeInteger(d.expires) &&
        d.expires === d.created + limits.lifetimeMs,
      "fixed lifetime",
    );
    integrity(typeof d.expired === "boolean", "expiry disposition");
    integrity(
      Array.isArray(d.counts) &&
        d.counts.length === 2 &&
        d.counts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
        d.counts[0]! + d.counts[1]! <= limits.resources,
      "record counts",
    );
    integrity(
      Number.isSafeInteger(d.bytes) &&
        d.bytes >= 0 &&
        d.bytes <= limits.recordBytes &&
        typeof d.plan === "string" &&
        /^[a-f0-9]{64}$/.test(d.plan),
      "record bytes or page commitment",
    );
    integrity(
      d.pageCounts.every((count, index) => count <= Math.max(1, d.counts[index]!)),
      "page counts exceed record counts",
    );
    return d;
  }
  function ledgerBounds() {
    const bound = statement(
      "SELECT count(*) AS count,max(length(CAST(id AS BLOB))) AS idBytes,max(length(CAST(disposition AS BLOB))) AS dispositionBytes FROM snapshots",
    ).get()!;
    integrity(
      Number(bound.count) <= limits.issuedHandles &&
        Number(bound.idBytes ?? 0) <= 36 &&
        Number(bound.dispositionBytes ?? 0) <= limits.dispositionBytes,
      "issuance ledger bound",
    );
    // Parse the expiry classification once per compact row, before detail or
    // live queries rely on it. Malformed JSON is also a SQLite integrity error.
    integrity(
      !statement(
        "SELECT id FROM snapshots WHERE ifnull(json_type(disposition,'$.expired'),'?') NOT IN ('true','false') LIMIT 1",
      ).get(),
      "expiry classification",
    );
    // Drive the reverse integrity check from distinct retained-detail owners.
    // Empty historical rows incur no detail probes; all detail for one handle
    // shares a single parent lookup per table, using the snapshot-prefix index.
    for (const sql of [
      "SELECT snapshot FROM (SELECT DISTINCT snapshot FROM snapshot_records) AS detail WHERE ifnull((SELECT json_extract(disposition,'$.expired') FROM snapshots WHERE id=detail.snapshot),1)=1 LIMIT 1",
      "SELECT snapshot FROM (SELECT DISTINCT snapshot FROM snapshot_pages) AS detail WHERE ifnull((SELECT json_extract(disposition,'$.expired') FROM snapshots WHERE id=detail.snapshot),1)=1 LIMIT 1",
    ])
      integrity(!statement(sql).get(), "orphaned or expired detail");
    // Cold, detail-free expired commitments remain validated on direct lookup.
    return Number(bound.count);
  }
  function expire(now: number, context: TransactionReadContext) {
    ledgerBounds();
    // Validate before reclaiming a promised body; disposal is irreversible even
    // if the injected wall clock later moves backwards. The compact issued
    // identity stays for the entire epoch.
    const candidates = statement(
      "SELECT id FROM snapshots WHERE json_extract(disposition,'$.expired')=0 AND json_extract(disposition,'$.expires') < ? LIMIT ?",
    ).all(now, limits.issuedHandles + 1);
    integrity(candidates.length <= limits.issuedHandles, "expiry ledger bound");
    for (const candidate of candidates) {
      integrity(
        typeof candidate.id === "string" && idPattern.test(candidate.id),
        "expiry identity",
      );
      const d = disposition(candidate.id, context)!;
      statement("UPDATE snapshots SET disposition=? WHERE id=?").run(
        text(
          sealDisposition(
            candidate.id,
            (({ binding: _binding, ...unsigned }) => ({ ...unsigned, expired: true }))(d),
          ),
        ),
        candidate.id,
      );
      statement("DELETE FROM snapshot_records WHERE snapshot=?").run(candidate.id);
      statement("DELETE FROM snapshot_pages WHERE snapshot=?").run(candidate.id);
    }
  }

  function liveLedger(now: number, context: TransactionReadContext) {
    // Expiry has already run in this owner entry. Bound the returned live set
    // before materializing dispositions; expired identities stay lookup-only.
    const rows = statement(
      "SELECT id FROM snapshots WHERE json_extract(disposition,'$.expired')=0 LIMIT ?",
    ).all(limits.liveHandles + 1);
    integrity(rows.length <= limits.liveHandles, "live issuance ledger exceeds bound");
    return rows.map((row) => {
      integrity(typeof row.id === "string" && idPattern.test(row.id), "issued identity");
      const d = disposition(row.id, context)!;
      // The owner must commit expire(now, context) before capture with the same
      // instant. Never silently filter retained detail out of the live budget.
      integrity(now <= d.expires, "capture requires completed expiry at its instant");
      return { id: row.id, d };
    });
  }
  function record(id: string, kind: Kind): { body: string; value: ResourceRecord } {
    const size = statement(
      "SELECT length(CAST(body AS BLOB)) AS bytes FROM resources WHERE id=? AND kind=?",
    ).get(id, kind);
    integrity(
      size && Number(size.bytes) <= TRANSACTION_RUNTIME_LIMITS.representationBytes,
      "oversized or missing authority record",
    );
    const row = statement("SELECT * FROM resources WHERE id=? AND kind=?").get(id, kind)!;
    integrity(typeof row.body === "string", "authority record body");
    const value = readStoredResource(
      kind === "bead"
        ? { id, kind, bodyJson: row.body }
        : { id, kind, bodyJson: row.body, source: String(row.source), target: String(row.target) },
      scope,
    );
    if (kind === "bead") validateServerBead(value as BeadRecord, scope);
    else {
      const link = value as LinkRecord;
      validateServerLink(link, scope);
      for (const endpoint of ["source", "target"] as const) {
        const uri = referenceUri(link[endpoint]);
        integrity(
          row[endpoint] ===
            (validateServerEndpoint(link[endpoint], scope) ? uri.slice(scope.length) : uri),
          "endpoint index mismatch",
        );
      }
    }
    // Reuse the admitted record codec. No lossless input is converted here: the
    // store contains already-admitted binary64 values, serialized by that codec.
    const body = text(value);
    integrity(
      bytes(body) <= TRANSACTION_RUNTIME_LIMITS.representationBytes,
      "projected record exceeds bound",
    );
    return { body, value };
  }
  function checkGraph(
    id: string,
    kind: Kind,
    value: ResourceRecord,
    records: ReadonlyMap<string, { body: string; value: ResourceRecord }>,
    outgoing: ReadonlyMap<string, readonly LinkRecord[]>,
  ) {
    const descriptor = descriptors.get(value.type);
    integrity(descriptor?.describes === kind, "unknown or wrong-kind Type");
    if (kind === "bead") {
      const bead = value as BeadRecord;
      integrity(descriptor.describes === "bead", "bead descriptor");
      const expected = new Map<string, string[]>();
      for (const name of Object.keys(descriptor.ownsOutgoing ?? {}))
        if (name !== "*") expected.set(name, []);
      for (const link of descriptor.ownsOutgoing === undefined ? [] : (outgoing.get(id) ?? [])) {
        if (
          descriptor.ownsOutgoing &&
          (Object.hasOwn(descriptor.ownsOutgoing, link.type) ||
            Object.hasOwn(descriptor.ownsOutgoing, "*"))
        ) {
          const list = expected.get(link.type) ?? [];
          list.push(link.id);
          expected.set(link.type, list);
        }
      }
      if (descriptor.ownsOutgoing === undefined)
        integrity(bead.ownedLinks === undefined, "unexpected owned plane");
      else {
        integrity(
          bead.ownedLinks &&
            Object.keys(bead.ownedLinks).sort().join("\n") ===
              [...expected.keys()].sort().join("\n"),
          "owned plane Types",
        );
        for (const [type, ids] of expected) {
          const inline = bead.ownedLinks[type]!;
          integrity(
            isDeepStrictEqual(
              inline.map((link) => link.id),
              ids.sort(compareCanonicalIds),
            ),
            "owned inventory mismatch",
          );
          for (const link of inline)
            integrity(
              jsonValueEqual(link, records.get(link.id.slice(scope.length))?.value) &&
                referenceUri(link.source) === bead.id,
              "owned Link differs from first-class record",
            );
        }
      }
    } else {
      const link = value as LinkRecord;
      for (const endpoint of [link.source, link.target])
        if (validateServerEndpoint(endpoint, scope)) {
          integrity(
            records
              .get(referenceUri(endpoint).slice(scope.length))
              ?.value.id.startsWith(`${scope}beads/`),
            "missing in-Scope endpoint",
          );
        }
    }
  }
  function plan(id: string, d: Disposition): PageRange[] {
    const bound = statement(
      "SELECT count(*) AS count,max(length(CAST(kind AS BLOB))) AS kindBytes,max(length(CAST(token AS BLOB))) AS tokenBytes,max(length(CAST(digest AS BLOB))) AS digestBytes FROM snapshot_pages WHERE snapshot=?",
    ).get(id)!;
    integrity(
      Number(bound.count) <= limits.resources + 2 &&
        Number(bound.kindBytes ?? 0) <= 4 &&
        Number(bound.tokenBytes ?? 0) <= 52 &&
        Number(bound.digestBytes ?? 0) <= 64,
      "page plan size bound",
    );
    const rows = statement(
      "SELECT kind,ordinal,token,start,end,bytes,digest FROM snapshot_pages WHERE snapshot=? ORDER BY kind,ordinal LIMIT ?",
    ).all(id, limits.resources + 3) as unknown as PageRange[];
    integrity(
      rows.length <= limits.resources + 2 && hash(text(rows)) === d.plan,
      "page plan commitment",
    );
    let total = 0;
    for (const [index, kind] of (["bead", "link"] as const).entries()) {
      const pages = rows.filter((row) => row.kind === kind);
      integrity(pages.length === d.pageCounts[index], "missing stream plan");
      let end = 0;
      for (const [ordinal, row] of pages.entries()) {
        integrity(
          row.ordinal === ordinal &&
            Number.isSafeInteger(row.start) &&
            row.start === end &&
            Number.isSafeInteger(row.end) &&
            row.end >= row.start &&
            row.end - row.start <= limits.snapshotPageItems &&
            (row.end > row.start || (ordinal === 0 && d.counts[index] === 0)),
          "page range",
        );
        integrity(
          typeof row.token === "string" &&
            row.token === pageToken(d.seed, id, kind, ordinal) &&
            Number.isSafeInteger(row.bytes) &&
            row.bytes >= 0 &&
            row.bytes <= limits.pageBytes &&
            /^[a-f0-9]{64}$/.test(row.digest),
          "page binding",
        );
        end = row.end;
        total += row.bytes;
      }
      integrity(end === d.counts[index], "incomplete stream plan");
    }
    integrity(
      rows.every((row) => row.kind === "bead" || row.kind === "link") && total === d.bytes,
      "plan record bytes",
    );
    const actual = statement(
      "SELECT kind,count(*) AS count,sum(length(CAST(body AS BLOB))) AS bytes FROM snapshot_records WHERE snapshot=? GROUP BY kind",
    ).all(id);
    integrity(
      actual.every((row) => row.kind === "bead" || row.kind === "link"),
      "stored kind",
    );
    for (const [index, kind] of (["bead", "link"] as const).entries())
      integrity(
        Number(actual.find((row) => row.kind === kind)?.count ?? 0) === d.counts[index],
        "stored count",
      );
    integrity(actual.reduce((n, row) => n + Number(row.bytes), 0) === d.bytes, "stored bytes");
    return rows;
  }
  function page(
    id: string,
    ranges: PageRange[],
    kind: Kind,
    token?: string,
  ): TransactionSnapshotPage {
    const stream = ranges.filter((row) => row.kind === kind);
    const range = token === undefined ? stream[0] : stream.find((row) => row.token === token);
    if (!range) throw new TransactionSnapshotFailure("resource-not-found");
    // Inspect sizes before retrieving any body, including corrupted retained rows.
    const sizes = statement(
      "SELECT ordinal,length(CAST(id AS BLOB)) AS idBytes,length(CAST(body AS BLOB)) AS bytes FROM snapshot_records WHERE snapshot=? AND kind=? AND ordinal>=? AND ordinal<? ORDER BY ordinal",
    ).all(id, kind, range.start, range.end);
    integrity(
      sizes.length === range.end - range.start &&
        sizes.every(
          (row, index) =>
            row.ordinal === range.start + index &&
            Number(row.bytes) <= TRANSACTION_RUNTIME_LIMITS.representationBytes &&
            Number(row.idBytes) <= TRANSACTION_RUNTIME_LIMITS.representationBytes,
        ),
      "page row sizes",
    );
    const bodies = sizes.map((row) => {
      const captured = statement(
        "SELECT id,body FROM snapshot_records WHERE snapshot=? AND kind=? AND ordinal=?",
      ).get(id, kind, Number(row.ordinal));
      const body = captured?.body;
      integrity(typeof captured?.id === "string", "captured identity");
      integrity(typeof body === "string", "missing captured body");
      const value = readStoredResource(
        kind === "bead"
          ? { id: String(captured?.id).slice(scope.length), kind, bodyJson: body }
          : {
              id: String(captured?.id).slice(scope.length),
              kind,
              bodyJson: body,
              source: "",
              target: "",
            },
        scope,
      );
      if (kind === "bead") validateServerBead(value as BeadRecord, scope);
      else validateServerLink(value as LinkRecord, scope);
      return { body, value };
    });
    integrity(
      hash(bodies.map((row) => row.body).join("\n")) === range.digest,
      "captured body commitment",
    );
    const next = stream[range.ordinal + 1];
    const result = {
      items: bodies.map((row) => row.value),
      next: next ? transactionSnapshotUrl(scope, id, kind, next.token) : null,
    };
    integrity(bytes(text(result)) <= limits.pageBytes, "serialized page bound");
    return freeze(result);
  }
  function resolve(
    id: string,
    now: number,
    context: TransactionReadContext,
    kind?: Kind,
    token?: string,
  ) {
    if (typeof id !== "string" || !idPattern.test(id))
      throw new TransactionSnapshotFailure("resource-not-found");
    const d = disposition(id, context);
    if (!d) throw new TransactionSnapshotFailure("resource-not-found");
    // Recognize an actually issued continuation before expiry diagnosis. Retain
    // only bounded counts and a secret seed, not every expired page/range. The
    // authenticated ordinal is an opaque token component, not a client cursor.
    if (kind !== undefined) {
      const match =
        typeof token === "string" && token.length <= 52
          ? /^sp_(0|[1-9][0-9]{0,3})_([A-Za-z0-9_-]{43})$/.exec(token)
          : null;
      const ordinal = Number(match?.[1]);
      if (
        !match ||
        ordinal >= d.pageCounts[kind === "bead" ? 0 : 1] ||
        !timingSafeEqual(Buffer.from(token!), Buffer.from(pageToken(d.seed, id, kind, ordinal)))
      )
        throw new TransactionSnapshotFailure("resource-not-found");
    }
    // Qualified witnesses separate unexpired foreign-view and same-view expiry.
    // The simultaneous foreign+expired collision is not an admission claim.
    if (d.view !== context.authorizationView) throw new TransactionSnapshotFailure("foreign-view");
    if (d.expired || now > d.expires) throw new TransactionSnapshotFailure("cursor-expired");
    return { d, ranges: plan(id, d) };
  }

  function manifest(
    id: string,
    now: number,
    context: TransactionReadContext,
  ): TransactionSnapshotManifest {
    const { d, ranges } = resolve(id, now, context);
    return manifestValue(id, d, context, page(id, ranges, "bead"), page(id, ranges, "link"));
  }
  function manifestValue(
    id: string,
    d: Disposition,
    context: TransactionReadContext,
    beads: TransactionSnapshotPage,
    links: TransactionSnapshotPage,
  ): TransactionSnapshotManifest {
    const result: TransactionSnapshotManifest = {
      id: transactionSnapshotUrl(scope, id),
      scope,
      scopeEpoch: d.epoch,
      authorizationView: d.view,
      scopePosition: `pos-${d.position}`,
      checkpoint: transactionCheckpoint(scope, context, d.position),
      expiresAt: new Date(d.expires).toISOString(),
      erasures: [],
      beads,
      links,
    };
    integrity(bytes(text(result)) <= limits.manifestBytes, "serialized manifest bound");
    return freeze(result);
  }
  function capture(
    now: number,
    context: TransactionReadContext,
    retain: boolean,
  ): TransactionSnapshotManifest {
    // Refuse permanent exhaustion before parsing even the live subset.
    if (ledgerBounds() >= limits.issuedHandles)
      throw new TransactionSnapshotFailure("limit-exceeded");
    const live = liveLedger(now, context);
    const totals = !visible()
      ? { count: 0, bytes: 0, idBytes: 0 }
      : statement(
          "SELECT count(*) AS count,coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes,coalesce(sum(length(CAST(id AS BLOB))),0) AS idBytes FROM resources",
        ).get()!;
    if (Number(totals.count) > limits.resources || Number(totals.bytes) > limits.recordBytes)
      throw new TransactionSnapshotFailure("limit-exceeded");
    // Empty-live pressure cannot occur with the current recordBytes < liveRecordBytes
    // tuple, but a future retuning must never emit Retry-After: Infinity.
    if (
      live.length >= limits.liveHandles ||
      live.reduce((n, row) => n + row.d.bytes, 0) + Number(totals.bytes) > limits.liveRecordBytes
    ) {
      throw new TransactionSnapshotFailure(
        "temporarily-unavailable",
        live.length === 0
          ? 0
          : Math.max(0, Math.ceil((Math.min(...live.map((row) => row.d.expires)) - now) / 1000)),
      );
    }
    integrity(Number(totals.idBytes) <= limits.recordBytes, "authority identity bytes");
    // Count/byte checks precede bounded identity enumeration and every body load.
    const ids = visible()
      ? statement("SELECT id,kind FROM resources LIMIT ?").all(limits.resources + 1)
      : [];
    integrity(ids.length === Number(totals.count), "authority inventory changed inside owner");
    ids.sort((a, b) => compareCanonicalIds(String(a.id), String(b.id)));
    // The nonallocating path uses fixed-width layout witnesses, never an issued
    // identity/secret. No record/page/parent row is written in that path.
    const id = retain ? randomUUID() : "00000000-0000-0000-0000-000000000000",
      seed = retain ? randomBytes(32).toString("hex") : "0".repeat(64),
      counts: [number, number] = [0, 0];
    // One bounded decoded/serialized map and outgoing index per capture.
    // This replaces repeated Link codecs and per-Bead full-table scans. The
    // 32MiB encoded ceiling is not a promise about decoded-object heap size.
    const records = new Map<string, { body: string; value: ResourceRecord }>();
    const outgoing = new Map<string, LinkRecord[]>();
    let totalBytes = 0;
    for (const row of ids) {
      integrity(
        typeof row.id === "string" && (row.kind === "bead" || row.kind === "link"),
        "authority identity/kind",
      );
      const captured = record(row.id, row.kind);
      totalBytes += bytes(captured.body);
      if (totalBytes > limits.recordBytes) throw new TransactionSnapshotFailure("limit-exceeded");
      records.set(row.id, captured);
      if (row.kind === "link") {
        const link = captured.value as LinkRecord;
        const source = referenceUri(link.source);
        if (validateServerEndpoint(link.source, scope)) {
          const local = source.slice(scope.length);
          const links = outgoing.get(local) ?? [];
          links.push(link);
          outgoing.set(local, links);
        }
      }
    }
    const streams: Record<Kind, { body: string; value: ResourceRecord }[]> = { bead: [], link: [] };
    for (const row of ids) {
      const localId = String(row.id),
        kind = row.kind as Kind;
      const { body, value } = records.get(localId)!;
      checkGraph(localId, kind, value, records, outgoing);
      const ordinal = counts[kind === "bead" ? 0 : 1]++;
      streams[kind].push({ body, value });
      // Retained capture inserts the sealed parent last, after ranges exist.
      // This entire body is one owner transaction with no integrity reentry;
      // transient detail without a parent can never be externally observed.
      if (retain)
        statement("INSERT INTO snapshot_records VALUES(?,?,?,?,?)").run(
          id,
          kind,
          ordinal,
          value.id,
          body,
        );
    }
    if (live.reduce((n, row) => n + row.d.bytes, 0) + totalBytes > limits.liveRecordBytes)
      throw new TransactionSnapshotFailure(
        "temporarily-unavailable",
        live.length === 0
          ? 0
          : Math.max(0, Math.ceil((Math.min(...live.map((row) => row.d.expires)) - now) / 1000)),
      );
    const ranges: PageRange[] = [];
    for (const [index, kind] of (["bead", "link"] as const).entries()) {
      let start = 0,
        ordinal = 0;
      do {
        const token = pageToken(seed, id, kind, ordinal);
        // A continuation names the successor, whose ordinal can have more
        // digits (9 -> 10, 99 -> 100). Reserve that exact URL even for the
        // final page, where emitted null is smaller; never truncate.
        const successor = pageToken(seed, id, kind, ordinal + 1);
        const framing = bytes(
          text({ items: [], next: transactionSnapshotUrl(scope, id, kind, successor) }),
        );
        let size = 0,
          end = start;
        const digest = createHash("sha256");
        while (end < counts[index]! && end - start < limits.snapshotPageItems) {
          const stored = streams[kind][end];
          integrity(stored, "missing prepared stream record");
          const body = stored.body,
            length = bytes(body);
          if (framing + size + length + (end - start) > limits.pageBytes) break;
          if (end > start) digest.update("\n");
          digest.update(body);
          size += length;
          end++;
        }
        integrity(end > start || counts[index] === 0, "one record cannot fit page");
        const range = {
          kind,
          ordinal,
          token,
          start,
          end,
          bytes: size,
          digest: digest.digest("hex"),
        };
        ranges.push(range);
        if (retain)
          statement("INSERT INTO snapshot_pages VALUES(?,?,?,?,?,?,?,?)").run(
            id,
            kind,
            ordinal,
            token,
            start,
            end,
            size,
            range.digest,
          );
        start = end;
        ordinal++;
      } while (start < counts[index]!);
    }
    const d = sealDisposition(id, {
      epoch: context.scopeEpoch,
      view: context.authorizationView,
      position: Number(context.scopePosition.slice(4)),
      created: now,
      expires: now + limits.lifetimeMs,
      expired: false,
      counts,
      bytes: totalBytes,
      plan: hash(text(ranges)),
      seed,
      pageCounts: [
        ranges.filter((row) => row.kind === "bead").length,
        ranges.filter((row) => row.kind === "link").length,
      ],
    });
    integrity(bytes(text(d)) + bytes(id) <= limits.dispositionBytes, "disposition bound");
    if (retain) {
      statement("INSERT INTO snapshots VALUES(?,?)").run(id, text(d));
      return manifest(id, now, context);
    }
    function firstPage(kind: Kind): TransactionSnapshotPage {
      const range = ranges.find((row) => row.kind === kind && row.ordinal === 0);
      integrity(range, "missing prepared first page");
      const next = ranges.find((row) => row.kind === kind && row.ordinal === 1);
      const result = {
        items: streams[kind].slice(range.start, range.end).map((row) => row.value),
        next: next ? transactionSnapshotUrl(scope, id, kind, next.token) : null,
      };
      integrity(bytes(text(result)) <= limits.pageBytes, "serialized page bound");
      return result;
    }
    return manifestValue(id, d, context, firstPage("bead"), firstPage("link"));
  }
  return Object.freeze({
    expire,
    manifest,
    page(id: string, kind: Kind, token: string, now: number, context: TransactionReadContext) {
      if ((kind !== "bead" && kind !== "link") || typeof token !== "string")
        throw new TransactionSnapshotFailure("resource-not-found");
      const { ranges } = resolve(id, now, context, kind, token);
      return page(id, ranges, kind, token);
    },
    preflight(now: number, context: TransactionReadContext): void {
      capture(now, context, false);
    },
    capture(now: number, context: TransactionReadContext): TransactionSnapshotManifest {
      return capture(now, context, true);
    },
  });
}
