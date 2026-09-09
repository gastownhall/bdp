import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Attribution, BeadRecord, LinkRecord } from "./index.js";
import {
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseLinkRecord,
  snapshotProtocolRecord,
} from "./read-values.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

/** Owning History parser roots. Evidence integration is separate from parser support. */
export const HISTORY_VALUE_SCHEMA_REFS = Object.freeze({
  capability: "#/$defs/historyCapability",
  context: "#/$defs/changeContext",
  missing: "#/$defs/historyMissing",
  versions: "#/$defs/historyVersionsPage",
  bead: "#/$defs/historicalBeadRecord",
  link: "#/$defs/historicalLinkRecord",
} as const);

/** Write-only roots; they are not Read parser/evidence roots. */
export const HISTORY_WRITE_VALUE_SCHEMA_REFS = Object.freeze({
  contextInput: "#/$defs/changeContextInput",
  allocation: "#/$defs/revisionAllocationUnsafeProblem",
} as const);
const HISTORY_SCHEMA_REFS = {
  ...HISTORY_VALUE_SCHEMA_REFS,
  ...HISTORY_WRITE_VALUE_SCHEMA_REFS,
} as const;

export interface RevisionAllocationUnsafeProblem {
  readonly type: "https://github.com/gastownhall/bdp/problems/conflict";
  readonly code: "revision-allocation-unsafe";
  readonly status?: 409;
  readonly retry: "after-state-change";
  readonly title?: string;
  readonly detail?: string;
  readonly instance?: string;
}

export interface HistoryCapability {
  readonly version: 1;
}
export type ContextValue<T> =
  | { readonly state: "present"; readonly value: T }
  | { readonly state: "absent" | "undetermined" };
export interface ChangeContext {
  readonly committedAt:
    | { readonly state: "present"; readonly value: string }
    | { readonly state: "undetermined" };
  readonly agent: ContextValue<string>;
  readonly message: ContextValue<string>;
}
/** Omission is undetermined; explicit null records known absence. No caller timestamp. */
export interface ChangeContextInput {
  readonly agent?: string | null;
  readonly message?: string | null;
}
export type HistoryMissingItem =
  | { readonly kind: "record" }
  | { readonly kind: "property"; readonly pointer: string }
  | { readonly kind: "owned-links"; readonly type?: string };
export interface HistoryMissing {
  readonly complete: boolean;
  readonly items: readonly HistoryMissingItem[];
}
export interface HistoryVersionRow {
  readonly revision: string;
  readonly attribution?: Attribution;
  readonly changeContext?: ChangeContext;
  readonly lineage: "current" | "replaced";
  readonly body: "complete" | "incomplete";
}
export interface HistoryVersionsPage {
  readonly subject: string;
  readonly population: "all-retained";
  readonly participation: "tracked" | "not-tracked" | "undetermined";
  readonly window: {
    readonly newest: string | null;
    readonly oldest: string | null;
    readonly complete: boolean;
  };
  readonly items: readonly HistoryVersionRow[];
  readonly next: string | null;
}

let validators: Readonly<Record<keyof typeof HISTORY_SCHEMA_REFS, ValidateFunction>> | undefined;
function parseShape(value: unknown, kind: keyof typeof HISTORY_SCHEMA_REFS) {
  const snapshot = snapshotProtocolRecord(value, `History ${kind}`);
  if (!validators) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const schema = JSON.parse(
      readFileSync(new URL("../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
    );
    ajv.addSchema(schema);
    validators = Object.fromEntries(
      Object.entries(HISTORY_SCHEMA_REFS).map(([key, $ref]) => [
        key,
        ajv.compile({ $ref: `${schema.$id}${$ref}` }),
      ]),
    ) as Record<keyof typeof HISTORY_SCHEMA_REFS, ValidateFunction>;
  }
  const validate = validators[kind];
  if (!validate(snapshot))
    throw new ProtocolArtifactValidationError(`History ${kind}: ${ajvError(validate)}`);
  return snapshot;
}
function ajvError(validate: ValidateFunction): string {
  const error = validate.errors?.[0];
  return `${error?.instancePath ?? ""} ${error?.message ?? "invalid shape"}`;
}
export function parseHistoryCapability(value: unknown): HistoryCapability {
  return parseShape(value, "capability") as unknown as HistoryCapability;
}
export function parseChangeContext(value: unknown): ChangeContext {
  return parseShape(value, "context") as unknown as ChangeContext;
}
export function parseRevisionAllocationUnsafeProblem(
  value: unknown,
): RevisionAllocationUnsafeProblem {
  return parseShape(value, "allocation") as unknown as RevisionAllocationUnsafeProblem;
}
export function parseChangeContextInput(value: unknown): ChangeContextInput {
  return parseShape(value, "contextInput") as unknown as ChangeContextInput;
}
export function parseHistoryMissing(value: unknown): HistoryMissing {
  return parseShape(value, "missing") as unknown as HistoryMissing;
}
export function parseHistoryVersionsPage(value: unknown, subject?: string): HistoryVersionsPage {
  const page = parseShape(value, "versions") as unknown as HistoryVersionsPage;
  const parsed = new URL(parseCanonicalHttpUrl(page.subject));
  if (parsed.search !== "" || (subject !== undefined && page.subject !== subject))
    throw new ProtocolArtifactValidationError(
      "History page subject does not match its canonical target",
    );
  if (new Set(page.items.map((row) => row.revision)).size !== page.items.length)
    throw new ProtocolArtifactValidationError("History page repeats a revision");
  if (page.next !== null) {
    parseCanonicalHttpUrl(page.next);
    const next = new URL(page.next);
    const query = parseHistoryQuery(next.search, true);
    next.search = "";
    if (
      next.href !== page.subject ||
      query.kind !== "versions" ||
      query.cursor === undefined ||
      page.items.length === 0
    )
      throw new ProtocolArtifactValidationError(
        "History continuation must make progress on the same subject",
      );
  }
  if (page.items.length > 0 && page.window.newest === null)
    throw new ProtocolArtifactValidationError(
      "A nonempty History window must have revision bounds",
    );
  return page;
}
interface HistoricalAddress {
  readonly id: string;
  readonly revision: string;
}
function assertAddress(record: BeadRecord | LinkRecord, expected?: HistoricalAddress): void {
  if (expected && (record.id !== expected.id || record.revision !== expected.revision))
    throw new ProtocolArtifactValidationError(
      "Historical response substituted another address or revision",
    );
}
export function parseHistoricalBeadRecord(
  value: unknown,
  expected?: HistoricalAddress,
): BeadRecord {
  const record = parseBeadRecord(parseShape(value, "bead"));
  assertAddress(record, expected);
  return record;
}
export function parseHistoricalLinkRecord(
  value: unknown,
  expected?: HistoricalAddress,
): LinkRecord {
  const record = parseLinkRecord(parseShape(value, "link"));
  assertAddress(record, expected);
  return record;
}

/** Query syntax only. The HTTP owner must still apply authentication and disclosure precedence. */
export type HistoryQuery =
  | { readonly kind: "revision"; readonly revision: string }
  | { readonly kind: "versions"; readonly cursor?: string; readonly limit?: number };
export class HistoryQueryError extends ProtocolArtifactValidationError {
  constructor(readonly code: "invalid-parameter" | "resource-not-found") {
    super(`History query refused: ${code}`);
    this.name = "HistoryQueryError";
  }
}
export function parseHistoryQuery(query: string, advertised: boolean, alias = false): HistoryQuery {
  if (alias) throw new HistoryQueryError("resource-not-found");
  const invalid = (): never => {
    throw new HistoryQueryError("invalid-parameter");
  };
  if (!advertised) return invalid();
  // Validate escapes before URLSearchParams' forgiving decoder. Decode exactly once.
  try {
    decodeURIComponent(query.replace(/\+/g, " "));
  } catch {
    return invalid();
  }
  const values = new URLSearchParams(query);
  for (const key of values.keys()) if (values.getAll(key).length !== 1) return invalid();
  if (values.has("revision")) {
    const revision = values.get("revision");
    if (values.size !== 1 || !revision) return invalid();
    return Object.freeze({ kind: "revision", revision });
  }
  if (values.get("view") !== "versions") return invalid();
  for (const key of values.keys()) if (!["view", "cursor", "limit"].includes(key)) return invalid();
  const cursor = values.get("cursor");
  const limit = values.get("limit");
  if (
    cursor === "" ||
    (limit !== null && (!/^[1-9][0-9]*$/.test(limit) || !Number.isSafeInteger(Number(limit))))
  )
    return invalid();
  return Object.freeze({
    kind: "versions",
    ...(cursor === null ? {} : { cursor }),
    ...(limit === null ? {} : { limit: Number(limit) }),
  });
}
