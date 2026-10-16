/** Private finite whole-group replication. No Snapshot, SSE, pruning or mutable view. */
import { createHash } from "node:crypto";
import { constants } from "node:buffer";
import { parseCanonicalScope } from "@bdp/protocol";
import {
  TRANSACTION_RUNTIME_LIMITS,
  type TransactionEvent,
  type TransactionStateChange,
} from "./transaction-batch.js";
import {
  TRANSACTION_EVENT_GROUP_BYTES,
  projectTransactionEventGroup,
} from "./transaction-events.js";
import { TransactionMinimumFailure } from "./transaction-consistency.js";
import type { TransactionReadContext } from "./transaction-store.js";

// Conservative additions even where stored source/id bytes already pay part.
// JSON UTF-8 bytes upper-bound UTF-16 code units; this is not a live heap bound.
export const TRANSACTION_CHANGEFEED_BYTES =
  TRANSACTION_EVENT_GROUP_BYTES +
  TRANSACTION_RUNTIME_LIMITS.inducedEvents *
    (TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes + 258 + 32) +
  2 * TRANSACTION_RUNTIME_LIMITS.scopeSourceBytes +
  12 * 258 +
  4096;
if (TRANSACTION_CHANGEFEED_BYTES >= constants.MAX_STRING_LENGTH)
  throw new Error("transaction tuple cannot support whole-group serialization");

export class TransactionChangefeedParameterError extends Error {
  constructor(
    message?: string,
    readonly context?: TransactionReadContext,
  ) {
    super(message);
  }
}
export type TransactionChangefeedIntent = { readonly after: string } | { readonly start: "now" };
interface TransactionVisibleChangeGroup {
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly checkpoint: string;
  readonly position: string;
  readonly previousPosition: string;
  readonly projectionAdvance: false;
  readonly transaction: string;
  readonly changes: readonly TransactionStateChange[];
  readonly erasures: readonly never[];
  readonly eventCount: number;
  readonly events: readonly TransactionEvent[];
}
export type TransactionChangeGroup =
  | TransactionVisibleChangeGroup
  | {
      readonly scopeEpoch: string;
      readonly authorizationView: string;
      readonly checkpoint: string;
      readonly position: string;
      readonly previousPosition: string;
      readonly projectionAdvance: true;
      readonly changes: readonly never[];
      readonly erasures: readonly never[];
      readonly eventCount: 0;
      readonly events: readonly never[];
    };
export interface TransactionChangefeedPage {
  readonly scope: string;
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly after: string;
  readonly observedHeadPosition: string;
  readonly groups: readonly TransactionChangeGroup[];
  readonly next: string | null;
}
const checkpoint = /^cg_([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{43})_([1-9][0-9]*)$/;
const tag = (...values: string[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("base64url");
function parseCheckpoint(value: string, context?: TransactionReadContext) {
  if (value === "genesis") return { position: 0 } as const;
  const match = value.length <= 256 ? checkpoint.exec(value) : null;
  const position = Number(match?.[3]);
  if (!match || !Number.isSafeInteger(position) || position < 1)
    throw new TransactionChangefeedParameterError(undefined, context);
  return { position, epoch: match[1], view: match[2] } as const;
}
export function transactionCheckpoint(
  scope: string,
  context: TransactionReadContext,
  position: number,
): string {
  if (!Number.isSafeInteger(position) || position < 0) throw new Error("invalid group position");
  return position === 0
    ? "genesis"
    : `cg_${tag("epoch", scope, context.scopeEpoch)}_${tag("view", scope, context.scopeEpoch, context.authorizationView)}_${position}`;
}
export function checkpointPosition(
  scope: string,
  context: TransactionReadContext,
  value: string,
): number {
  const parsed = parseCheckpoint(value, context);
  if (parsed.position === 0) return 0;
  if (parsed.epoch !== tag("epoch", scope, context.scopeEpoch))
    throw new TransactionMinimumFailure("cursor-expired", context);
  if (parsed.view !== tag("view", scope, context.scopeEpoch, context.authorizationView))
    throw new TransactionMinimumFailure("foreign-view", context);
  return parsed.position;
}
export function transactionChangefeedRequest(
  url: URL,
  canonicalScope: string,
): TransactionChangefeedIntent | undefined {
  const scope = parseCanonicalScope(canonicalScope);
  if (url.origin + url.pathname !== `${scope}changes/`) return undefined;
  if (url.hash) throw new TransactionChangefeedParameterError();
  for (const key of url.searchParams.keys())
    if (!["after", "start"].includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new TransactionChangefeedParameterError();
  const after = url.searchParams.get("after"),
    start = url.searchParams.get("start");
  if ((after === null) === (start === null)) throw new TransactionChangefeedParameterError();
  if (after !== null) {
    parseCheckpoint(after);
    return Object.freeze({ after });
  }
  if (start !== "now") throw new TransactionChangefeedParameterError();
  return Object.freeze({ start: "now" });
}
export function projectTransactionChangeGroup(
  value: unknown,
  scope: string,
  context: TransactionReadContext,
  position: number,
  visible = true,
): TransactionChangeGroup {
  if (!value || typeof value !== "object") throw new Error("invalid retained change group");
  const group = value as TransactionChangeGroup;
  if (
    group.previousPosition !== `pos-${position - 1}` ||
    group.projectionAdvance !== false ||
    !Array.isArray(group.erasures) ||
    group.erasures.length !== 0 ||
    !Array.isArray(group.changes) ||
    !Array.isArray(group.events) ||
    group.changes.length + group.events.length === 0
  )
    throw new Error("invalid retained change group framing");
  const ids = new Set<string>();
  for (const change of group.changes) {
    if (
      !["upsert", "tombstone"].includes(change.operation) ||
      !["bead", "link"].includes(change.resourceKind) ||
      typeof change.resource?.id !== "string" ||
      ids.has(change.resource.id)
    )
      throw new Error("invalid retained state change");
    ids.add(change.resource.id);
  }
  // This same projection validates all-visible contiguous ordinals/context and
  // gives exactly the Scope Event Source's fact representation and IDs.
  const events = projectTransactionEventGroup(
    value,
    context,
    { kind: "scope", url: `${scope}events/` },
    scope,
    position,
    visible,
  );
  if (!visible)
    return {
      scopeEpoch: context.scopeEpoch,
      authorizationView: context.authorizationView,
      checkpoint: transactionCheckpoint(scope, context, position),
      position: group.position,
      previousPosition: group.previousPosition,
      projectionAdvance: true,
      changes: [],
      erasures: [],
      eventCount: 0,
      events: [],
    };
  return {
    scopeEpoch: group.scopeEpoch,
    authorizationView: group.authorizationView,
    checkpoint: transactionCheckpoint(scope, context, position),
    position: group.position,
    previousPosition: group.previousPosition,
    projectionAdvance: false,
    transaction: group.transaction,
    changes: group.changes,
    erasures: [],
    eventCount: events.length,
    events,
  };
}
export function freezeChangefeedPage(page: TransactionChangefeedPage): TransactionChangefeedPage {
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
