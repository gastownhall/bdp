/** Private Scope policy. Installation facts and retained execution facts are separate. */
import { randomUUID } from "node:crypto";
import type { TransactionReceipt, TransactionReadContext } from "./transaction-store.js";

export const INITIAL_TRANSACTION_VIEW = "development-all-visible";
export interface TransactionAuthorizationLease {
  readonly signal: AbortSignal;
  release(): void;
}
export interface TransactionAuthorizationSnapshot {
  readonly revision: 1;
  readonly bindingKind: "scope";
  readonly generation: 0 | 1;
  readonly authorizationView: string;
  readonly readPolicy: "all-visible" | "empty";
  readonly canMutate: boolean;
}
export function initialTransactionAuthorization(): TransactionAuthorizationSnapshot {
  return Object.freeze({
    revision: 1,
    bindingKind: "scope",
    generation: 0,
    authorizationView: INITIAL_TRANSACTION_VIEW,
    readPolicy: "all-visible",
    canMutate: true,
  });
}
export function emptyTransactionAuthorization(): TransactionAuthorizationSnapshot {
  return Object.freeze({
    revision: 1,
    bindingKind: "scope",
    generation: 1,
    authorizationView: randomUUID(),
    readPolicy: "empty",
    canMutate: false,
  });
}
export function parseTransactionAuthorization(text: string): TransactionAuthorizationSnapshot {
  if (Buffer.byteLength(text) > 4096) throw new Error("authorization policy exceeds storage bound");
  const v: unknown = JSON.parse(text);
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(",") !==
      "authorizationView,bindingKind,canMutate,generation,readPolicy,revision"
  )
    throw new Error("invalid authorization policy fields");
  const p = v as TransactionAuthorizationSnapshot;
  if (
    p.revision !== 1 ||
    p.bindingKind !== "scope" ||
    !(
      (p.generation === 0 &&
        p.authorizationView === INITIAL_TRANSACTION_VIEW &&
        p.readPolicy === "all-visible" &&
        p.canMutate === true) ||
      (p.generation === 1 &&
        typeof p.authorizationView === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          p.authorizationView,
        ) &&
        p.readPolicy === "empty" &&
        p.canMutate === false)
    )
  )
    throw new Error("invalid authorization policy");
  return Object.freeze(p);
}
export class TransactionAuthorizationFailure extends Error {
  constructor(
    readonly code: "forbidden" | "temporarily-unavailable" | "foreign-view",
    readonly context?: TransactionReadContext,
  ) {
    super("private authorization admission refused");
  }
}
/** Execution identities survive; only Resource-bearing entries are withheld. */
export function projectTransactionEntry(value: unknown, visible: boolean): unknown {
  if (visible || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const entry = value as Record<string, unknown>;
  if ((entry.outcome !== "created" && entry.outcome !== "updated") || entry.resource === undefined)
    return value;
  return {
    operationIndex: entry.operationIndex,
    ...(entry.operationName === undefined ? {} : { operationName: entry.operationName }),
    outcome: "withheld",
  };
}
export function projectTransactionReceipt(
  receipt: TransactionReceipt,
  visible: boolean,
): TransactionReceipt {
  if (visible) return receipt;
  const projected = { ...receipt };
  if (Array.isArray(receipt.allocated))
    projected.allocated = receipt.allocated.map((entry: Record<string, unknown>) => ({
      operationIndex: entry.operationIndex,
      ...(entry.operationName === undefined ? {} : { operationName: entry.operationName }),
      withheld: true,
    }));
  if (
    receipt.status === "completed" &&
    receipt.detail === "available" &&
    Array.isArray(receipt.results)
  ) {
    projected.results = receipt.results.map((entry) => projectTransactionEntry(entry, false));
  }
  const allResultsWithheld =
    Array.isArray(projected.results) &&
    projected.results.length > 0 &&
    projected.results.every((entry) => entry.outcome === "withheld");
  const allAllocationsWithheld =
    Array.isArray(projected.allocated) &&
    projected.allocated.length > 0 &&
    projected.allocated.every((entry) => entry.withheld === true);
  if (receipt.status === "completed" && (allResultsWithheld || allAllocationsWithheld)) {
    projected.detail = "withheld";
    delete projected.results;
    delete projected.next;
    delete projected.allocated;
    delete projected.expiresAt;
  }
  return projected;
}
