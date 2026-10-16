import { INITIAL_TRANSACTION_VIEW } from "./transaction-authorization.js";
/** Private finite projection of committed facts. No pruning, mutable views,
 * SSE, replication bootstrap or public profile admission. */
import { createHash } from "node:crypto";
import { TransactionMinimumFailure } from "./transaction-consistency.js";
import {
  parseCanonicalScope,
  resolveCanonicalLocalResourceId,
  stringifyJsonValue,
  type Reference,
} from "@bdp/protocol";
import {
  TRANSACTION_RUNTIME_LIMITS,
  type TransactionEvent,
  type TransactionStateChange,
} from "./transaction-batch.js";
import type { TransactionReadContext } from "./transaction-store.js";

export const TRANSACTION_EVENT_PAGE_BYTES = 4 * 1024 * 1024;
/** Actual private stream mechanics, not public paging limits. */
export const TRANSACTION_EVENT_STREAM = Object.freeze({
  maximumGroupsPerObservation: 1,
  packetBytes: TRANSACTION_EVENT_PAGE_BYTES,
});
// Same closed-shape proof as the admitted tuple in the implementation progress
// document. This bounds encoded group bytes, not parsed object/heap overhead.
const R = TRANSACTION_RUNTIME_LIMITS.representationBytes,
  Q = TRANSACTION_RUNTIME_LIMITS.requestBodyBytes,
  S = TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes,
  N = 7 * Q,
  A = 8192,
  H = 1048576,
  K = TRANSACTION_RUNTIME_LIMITS.matchedResources + TRANSACTION_RUNTIME_LIMITS.maximumOperations;
export const TRANSACTION_EVENT_GROUP_BYTES = Math.min(
  TRANSACTION_RUNTIME_LIMITS.inducedEvents * (2.5 * R + N + S) + K * A + H,
  K * (Math.max(9 * R + 4 * S, 5 * R + 2 * N + 2 * S) + A) + H,
);
// Largest owned update <= 2R+N+source+A. A Resource source is at most R
// plus its view suffix; the page repeats it in source and next. Reserve 1024
// extra bytes for suffixes, cursor and envelope. Scope source is smaller.
export const TRANSACTION_EVENT_FIRST_PAGE_BYTES = 5 * R + N + A + 1024;
if (TRANSACTION_EVENT_FIRST_PAGE_BYTES > TRANSACTION_EVENT_PAGE_BYTES)
  throw new Error("transaction tuple cannot support the finite Event page budget");
export class TransactionEventProjectionGap extends Error {}
export class TransactionEventParameterError extends Error {
  constructor(
    message?: string,
    readonly context?: TransactionReadContext,
  ) {
    super(message);
  }
}
export interface TransactionEventSource {
  readonly url: string;
  readonly subject?: string;
  readonly kind: "scope" | "bead" | "link";
}
export interface TransactionEventGroup {
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly position: string;
  readonly checkpoint: string;
  readonly transaction: string;
  readonly eventCount: number;
  readonly events: readonly TransactionEvent[];
  readonly changes: readonly TransactionStateChange[];
}
export interface TransactionEventPage {
  readonly source: string;
  readonly events: readonly TransactionEvent[];
  readonly next: string | null;
}
const ordinal = /^(0|[1-9][0-9]*)$/;
const position = /^pos-(0|[1-9][0-9]*)$/;
const cursor =
  /^ev_([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{43})_(pos-(?:0|[1-9][0-9]*))_(0|[1-9][0-9]*)$/;
const hash = (tag: string, value: string) =>
  createHash("sha256")
    .update(JSON.stringify([tag, value]))
    .digest("base64url");

/** Scope and Resource token spelling is deliberately private, not a fixture law. */
export function renderTransactionEvent(
  context: Pick<TransactionReadContext, "scopeEpoch" | "authorizationView">,
  source: string,
  checkpoint: string,
  event: TransactionEvent,
): TransactionEvent {
  if (
    !position.test(checkpoint) ||
    !Number.isSafeInteger(Number(checkpoint.slice(4))) ||
    Number(checkpoint.slice(4)) < 1 ||
    !Number.isSafeInteger(event.ordinal) ||
    event.ordinal < 0
  )
    throw new Error("invalid committed Event position");
  return {
    ...event,
    source,
    id: `ev_${hash("epoch", context.scopeEpoch)}_${hash("view", context.authorizationView)}_${hash("source", source)}_${checkpoint}_${event.ordinal}`,
  };
}
export function parseTransactionEventCursor(
  value: string,
  context?: TransactionReadContext,
): {
  position: number;
  ordinal: number;
  epoch: string;
  view: string;
  source: string;
} {
  const match = value.length <= 256 ? cursor.exec(value) : null;
  if (!match || !ordinal.test(match[5] ?? ""))
    throw new TransactionEventParameterError(undefined, context);
  const p = Number(match[4]?.slice(4)),
    o = Number(match[5]);
  if (!Number.isSafeInteger(p) || p < 1 || !Number.isSafeInteger(o) || o < 0)
    throw new TransactionEventParameterError(undefined, context);
  return {
    position: p,
    ordinal: o,
    epoch: match[1] as string,
    view: match[2] as string,
    source: match[3] as string,
  };
}
export function checkTransactionEventCursor(
  value: ReturnType<typeof parseTransactionEventCursor>,
  context: TransactionReadContext,
  source: string,
): void {
  // Opaque context tags diagnose incompatible context; they are not credentials
  // or proof of prior issuance. Matching context still requires source membership.
  if (value.epoch !== hash("epoch", context.scopeEpoch))
    throw new TransactionMinimumFailure("cursor-expired", context);
  if (value.view !== hash("view", context.authorizationView))
    throw new TransactionMinimumFailure("foreign-view", context);
  if (value.source !== hash("source", source))
    throw new TransactionEventParameterError(undefined, context);
}

/** Undefined means this is not an Event route; malformed Event requests throw. */
export function transactionEventRequest(
  url: URL,
  scopeText: string,
): { readonly source: TransactionEventSource; readonly after?: string } | undefined {
  const scope = parseCanonicalScope(scopeText),
    base = new URL(scope);
  const scopeSource = new URL("events/", scope).href;
  const wantsResource = url.searchParams.getAll("view").includes("events");
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
  const scopeRoute = url.origin + url.pathname === scopeSource;
  if (!scopeRoute && !wantsResource) return undefined;
  const allowed = scopeRoute ? ["after"] : ["view", "after"];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new TransactionEventParameterError();
  if (url.hash) throw new TransactionEventParameterError();
  let source: TransactionEventSource;
  if (scopeRoute) source = { kind: "scope", url: scopeSource };
  else {
    const local = url.pathname.slice(base.pathname.length),
      kind = local.startsWith("beads/") ? "bead" : local.startsWith("links/") ? "link" : undefined;
    if (!kind || url.searchParams.get("view") !== "events")
      throw new TransactionEventParameterError();
    try {
      const subject = resolveCanonicalLocalResourceId(scope, kind, local);
      if (new URL(subject).pathname !== url.pathname) throw new Error("noncanonical Event subject");
      source = { kind, subject, url: `${subject}?view=events` };
    } catch {
      throw new TransactionEventParameterError();
    }
  }
  const after = url.searchParams.get("after");
  if (after !== null) parseTransactionEventCursor(after);
  return Object.freeze({ source: Object.freeze(source), ...(after === null ? {} : { after }) });
}
function reference(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Reference & { uri?: unknown }).uri === "string"
  )
    return (value as { uri: string }).uri;
  throw new Error("invalid retained Event endpoint");
}

/** Uses only this group's final upserts/creation/incidence facts, never live Links. */
export function projectTransactionEventGroup(
  value: unknown,
  context: TransactionReadContext,
  source: TransactionEventSource,
  scope: string,
  expectedPosition: number,
  visible = true,
): readonly TransactionEvent[] {
  if (!value || typeof value !== "object") throw new Error("invalid retained Event group");
  const group = value as TransactionEventGroup;
  if (
    group.scopeEpoch !== context.scopeEpoch ||
    group.authorizationView !== (visible ? context.authorizationView : INITIAL_TRANSACTION_VIEW) ||
    group.position !== `pos-${expectedPosition}` ||
    group.checkpoint !== group.position ||
    !Array.isArray(group.events) ||
    group.eventCount !== group.events.length ||
    !Array.isArray(group.changes) ||
    typeof group.transaction !== "string"
  )
    throw new Error("retained Event group context mismatch");
  const endpoints = new Map<string, readonly [unknown, unknown]>();
  const linkIds = new Set<string>();
  const remember = (id: string, from: unknown, to: unknown) => {
    reference(from);
    reference(to);
    const old = endpoints.get(id),
      next = [from, to] as const;
    if (old && stringifyJsonValue(old) !== stringifyJsonValue(next))
      throw new Error("inconsistent retained Link endpoints");
    endpoints.set(id, next);
  };
  for (const change of group.changes) {
    if (change.resourceKind === "link") {
      linkIds.add(change.resource.id);
      if (change.operation === "upsert" && "source" in change.resource)
        remember(change.resource.id, change.resource.source, change.resource.target);
    }
  }
  for (const event of group.events) {
    const data = event.data as Record<string, unknown>;
    if (!data || typeof data !== "object") throw new Error("invalid retained Event data");
    if (
      event.type === "linked" ||
      event.type === "unlinked" ||
      (event.type === "created" && linkIds.has(event.subject))
    )
      remember(event.subject, data.source, data.target);
  }
  const result: TransactionEvent[] = [];
  for (const [index, event] of group.events.entries()) {
    if (
      event.ordinal !== index ||
      event.source !== `${scope}events/` ||
      event.transaction !== group.transaction ||
      !["created", "updated", "deleted", "linked", "unlinked"].includes(event.type)
    )
      throw new Error("invalid retained Event framing");
    const data = event.data as Record<string, unknown>;
    let include = source.kind === "scope";
    if (visible && source.kind !== "scope") {
      include =
        event.subject === source.subject && ["created", "updated", "deleted"].includes(event.type);
      if (source.kind === "bead" && (event.type === "linked" || event.type === "unlinked")) {
        if (data.endpoint !== "source" && data.endpoint !== "target")
          throw new Error("invalid endpoint fact");
        include = reference(data[data.endpoint]) === source.subject;
      }
      if (source.kind === "bead" && event.type === "updated" && linkIds.has(event.subject)) {
        const pair = endpoints.get(event.subject);
        if (!pair) throw new Error("incident Link update lacks same-group endpoints");
        include = pair.some((endpoint) => reference(endpoint) === source.subject);
        // Literal incident rule currently mentions properties only. Do not silently
        // decide metadata-only membership while the spec disposition is pending.
        if (include && data.change === undefined && data.metadataChange !== undefined)
          throw new TransactionEventProjectionGap("incident-link-metadata");
      }
    }
    if (visible && include)
      result.push(renderTransactionEvent(context, source.url, group.checkpoint, event));
  }
  return result;
}
export function eventContinuation(source: string, id: string): string {
  const next = new URL(source);
  next.searchParams.set("after", id);
  return next.href;
}
export function freezeEventPage(page: TransactionEventPage): TransactionEventPage {
  const pending: unknown[] = [page];
  while (pending.length) {
    const value = pending.pop();
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      pending.push(...Object.values(value));
      Object.freeze(value);
    }
  }
  return page;
}
