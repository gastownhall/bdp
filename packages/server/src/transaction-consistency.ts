/** Source-private minimum receiving and canonical semantic subset.
 * Alphabet-valid unknown identities and continuation comparisons remain separate. */
import { setTimeout as delay } from "node:timers/promises";
import { isProxy } from "node:util/types";
import { ScopeServerOperationAbortedError } from "./read-request.js";
import type { TransactionReadContext } from "./transaction-store.js";

export interface TransactionMinimum {
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly minimumPosition: string;
}
const token = /^[A-Za-z0-9_-]{1,256}$/;
/** Receiving syntax only: unknown token identities are not malformed fields. */
export function malformedTransactionMinimumHeaders(headers: Headers): boolean {
  const values = [
    headers.get("bdp-minimum-scope-position"),
    headers.get("bdp-scope-epoch"),
    headers.get("bdp-authorization-view"),
  ];
  return (
    values.some((value) => value !== null) &&
    values.some((value) => value === null || !token.test(value))
  );
}
const position = (value: unknown): number | undefined => {
  if (value === "genesis") return 0;
  if (typeof value !== "string" || !/^pos-(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const number = Number(value.slice(4));
  return Number.isSafeInteger(number) ? number : undefined;
};
/** Lexical data-only capture for the selected current-Read paths. */
export function snapshotCurrentReadMinimum(value: unknown): TransactionMinimum {
  if (!value || typeof value !== "object" || isProxy(value))
    throw new TypeError("unsupported minimum tuple");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(fields).sort().join(",") !== "authorizationView,minimumPosition,scopeEpoch" ||
    Reflect.ownKeys(value).length !== 3 ||
    Object.values(fields).some((field) => !("value" in field))
  )
    throw new TypeError("unsupported minimum tuple");
  const scopeEpoch: unknown = fields.scopeEpoch?.value;
  const authorizationView: unknown = fields.authorizationView?.value;
  const minimumPosition: unknown = fields.minimumPosition?.value;
  if (
    typeof scopeEpoch !== "string" ||
    !token.test(scopeEpoch) ||
    typeof authorizationView !== "string" ||
    !token.test(authorizationView) ||
    typeof minimumPosition !== "string" ||
    !token.test(minimumPosition)
  )
    throw new TypeError("unsupported minimum tuple");
  return Object.freeze({ scopeEpoch, authorizationView, minimumPosition });
}
export function snapshotTransactionMinimum(value: unknown): TransactionMinimum {
  const minimum = snapshotCurrentReadMinimum(value);
  if (position(minimum.minimumPosition) === undefined)
    throw new TypeError("unsupported minimum tuple");
  return minimum;
}
export function currentReadMinimumHeaders(headers: Headers): TransactionMinimum | undefined {
  try {
    return snapshotCurrentReadMinimum({
      scopeEpoch: headers.get("bdp-scope-epoch"),
      authorizationView: headers.get("bdp-authorization-view"),
      minimumPosition: headers.get("bdp-minimum-scope-position"),
    });
  } catch {
    return undefined;
  }
}
export function transactionMinimumHeaders(headers: Headers): TransactionMinimum | undefined {
  try {
    return snapshotTransactionMinimum({
      scopeEpoch: headers.get("bdp-scope-epoch"),
      authorizationView: headers.get("bdp-authorization-view"),
      minimumPosition: headers.get("bdp-minimum-scope-position"),
    });
  } catch {
    return undefined;
  }
}
export class TransactionMinimumFailure extends Error {
  constructor(
    readonly reason: "behind" | "foreign-view" | "cursor-expired" | "catch-up-timeout",
    readonly context: TransactionReadContext,
  ) {
    super(`transaction minimum read: ${reason}`);
  }
}
/** Runs within the representation's owner entry, after authorization. */
export function checkTransactionMinimum(
  minimum: TransactionMinimum,
  context: TransactionReadContext,
): void {
  if (minimum.scopeEpoch !== context.scopeEpoch)
    throw new TransactionMinimumFailure("cursor-expired", context);
  if (minimum.authorizationView !== context.authorizationView)
    throw new TransactionMinimumFailure("foreign-view", context);
  const required = position(minimum.minimumPosition),
    current = position(context.scopePosition);
  if (required === undefined || current === undefined)
    throw new Error("invalid owner minimum position");
  if (current < required) throw new TransactionMinimumFailure("behind", context);
}
/** An unknown identity is not behind or malformed, and carries no ordering claim. */
export class TransactionMinimumUnproved extends Error {
  constructor(readonly context: TransactionReadContext) {
    super("current Resource minimum eligibility unproved");
  }
}
export class TransactionMinimumUnsupported extends Error {}
export function checkCurrentReadMinimum(
  minimum: TransactionMinimum,
  context: TransactionReadContext,
  waitable: boolean,
): void {
  if (position(context.scopePosition) === undefined)
    throw new Error("invalid owner minimum position");
  if (position(minimum.minimumPosition) === undefined) {
    if (!waitable) throw new TransactionMinimumUnsupported("minimum-position");
    if (minimum.scopeEpoch !== context.scopeEpoch)
      throw new TransactionMinimumFailure("cursor-expired", context);
    if (minimum.authorizationView !== context.authorizationView)
      throw new TransactionMinimumFailure("foreign-view", context);
    throw new TransactionMinimumUnproved(context);
  }
  checkTransactionMinimum(minimum, context);
}
export interface TransactionMinimumWaitOptions {
  readonly budgetMs?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}
/** No SQLite entry survives an await. The original finite deadline never renews. */
export async function waitForTransactionMinimum<T>(
  attempt: () => T | Promise<T>,
  options: TransactionMinimumWaitOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const budget = options.budgetMs ?? 1000,
    now = options.now ?? (() => performance.now()),
    wait = options.wait ?? ((milliseconds) => delay(milliseconds));
  if (
    !Number.isSafeInteger(budget) ||
    budget <= 0 ||
    budget > 2147483647 ||
    typeof now !== "function" ||
    typeof wait !== "function"
  )
    throw new TypeError("finite minimum-read wait policy required");
  const started = now();
  if (!Number.isFinite(started)) throw new TypeError("invalid minimum-read clock");
  const deadline = started + budget;
  let previous = started;
  if (!Number.isFinite(deadline)) throw new TypeError("invalid minimum-read deadline");
  for (;;) {
    if (signal?.aborted) throw new ScopeServerOperationAbortedError();
    try {
      return await attempt();
    } catch (error) {
      if (
        !(error instanceof TransactionMinimumUnproved) &&
        (!(error instanceof TransactionMinimumFailure) || error.reason !== "behind")
      )
        throw error;
      const current = now();
      if (!Number.isFinite(current) || current < previous)
        throw new TypeError("invalid minimum-read clock");
      previous = current;
      if (current >= deadline)
        throw new TransactionMinimumFailure("catch-up-timeout", error.context);
      await wait(Math.min(5, deadline - current));
    }
  }
}
