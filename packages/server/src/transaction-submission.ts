import {
  TransactionSelectorSyntaxError,
  type TransactionSelectorLimit,
} from "./transaction-set.js";
/** Private receiving/admission composition. No socket, export or profile claim. */
import { JsonSyntaxError, ReadUpdateCarrierError } from "@bdp/protocol";
import {
  type TransactionSingletonOperation,
  prepareTransactionForReceiving,
  TRANSACTION_RUNTIME_LIMITS,
} from "./transaction-batch.js";
import { compareAndAdmitTransaction } from "./transaction-comparison.js";
import {
  snapshotTransactionReceivingControls,
  type openTransactionStore,
  type TransactionReceipt,
  type TransactionReadContext,
  type TransactionReceivingControls,
} from "./transaction-store.js";

type Authorization =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "authorized"; readonly principal: string };
export interface TransactionSubmission {
  readonly carrier:
    | { readonly kind: "batch" }
    | { readonly kind: "singleton"; readonly operation: TransactionSingletonOperation };
  readonly body: string;
  readonly key: string;
  /** Trusted authentication/Scope permission decision, not client attribution. */
  readonly authorization: Authorization;
  readonly receiving: TransactionReceivingControls;
}
type ObservedComparisonRefusal = {
  readonly kind: "comparison-refusal";
  readonly status: 503;
  readonly code: "temporarily-unavailable";
  readonly retry: "after-delay";
} & (
  | { readonly reason: "deadline"; readonly context: TransactionReadContext }
  | { readonly reason: "owner-stopped" }
);
export type TransactionSubmissionResult =
  | ObservedComparisonRefusal
  | {
      readonly kind: "receipt";
      readonly receipt: TransactionReceipt;
      readonly context?: TransactionReadContext;
    }
  | { readonly kind: "not-acceptable"; readonly context?: TransactionReadContext }
  | {
      readonly kind: "refused";
      readonly status: 400 | 401 | 403 | 409 | 413 | 503;
      readonly code:
        | "malformed-request"
        | "unauthenticated"
        | "forbidden"
        | "idempotency-conflict"
        | "request-too-large"
        | "limit-exceeded"
        | "temporarily-unavailable";
      readonly limit?: "transaction.operations" | TransactionSelectorLimit;
      readonly pointer?: string;
      readonly retry?: "after-delay";
      readonly context?: TransactionReadContext;
    };

/** These are typed internal receiving results, not emitted HTTP Problem bodies.
 * Raw headers/targets/media and receipt HTTP representation remain future work.
 * Once admitted, this call owns execution independently of response consumption.
 * Internal/fenced failures propagate intact; they are not permanent receipts. */
export async function submitTransaction(
  store: ReturnType<typeof openTransactionStore>,
  submission: TransactionSubmission,
  comparison: Omit<
    NonNullable<Parameters<typeof compareAndAdmitTransaction>[4]>,
    "receiving" | "observeDeadline"
  > = {},
  observed = false,
): Promise<TransactionSubmissionResult> {
  const receiving = snapshotTransactionReceivingControls(submission.receiving);
  const { body, key } = submission;
  if (Buffer.byteLength(body) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    return { kind: "refused", status: 413, code: "request-too-large" };
  let prepared: ReturnType<typeof prepareTransactionForReceiving>;
  try {
    prepared = prepareTransactionForReceiving(store.scope, submission.carrier, body);
  } catch (error) {
    if (error instanceof TransactionSelectorSyntaxError)
      return { kind: "refused", status: 400, code: "malformed-request", pointer: error.pointer };
    if (
      error instanceof JsonSyntaxError ||
      error instanceof ReadUpdateCarrierError ||
      error instanceof TypeError
    )
      return { kind: "refused", status: 400, code: "malformed-request" };
    else throw error;
  }
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(key))
    return { kind: "refused", status: 400, code: "malformed-request" };
  const authorization = submission.authorization;
  if (authorization.kind === "unauthenticated")
    return { kind: "refused", status: 401, code: "unauthenticated" };
  if (authorization.kind === "forbidden")
    return { kind: "refused", status: 403, code: "forbidden" };
  if (
    typeof authorization.principal !== "string" ||
    authorization.principal.length === 0 ||
    !authorization.principal.isWellFormed()
  )
    throw new TypeError("invalid trusted principal");
  const comparisonStore = observed
    ? {
        scopeEpoch: store.scopeEpoch,
        comparisonEpoch: store.comparisonEpoch,
        admit: store.admitObserved,
      }
    : store;
  const result = await compareAndAdmitTransaction(
    comparisonStore,
    authorization.principal,
    key,
    prepared,
    {
      ...comparison,
      receiving,
      // Override even an untyped caller's extra field; only this owner supplies it.
      observeDeadline: observed ? store.observeComparisonDeadline : undefined,
    },
  );
  if (
    observed &&
    (result.kind === "conflict" ||
      result.kind === "operation-limit" ||
      result.kind === "selector-limit" ||
      result.kind === "not-acceptable") &&
    !result.context
  )
    throw new Error("admission refusal lost same-entry context");
  switch (result.kind) {
    case "conflict":
      return {
        kind: "refused",
        status: 409,
        code: "idempotency-conflict",
        ...(result.context ? { context: result.context } : {}),
      };
    case "operation-limit":
      return {
        kind: "refused",
        status: 413,
        code: "limit-exceeded",
        limit: "transaction.operations",
        ...(result.context ? { context: result.context } : {}),
      };
    case "selector-limit":
      return {
        kind: "refused",
        status: 413,
        code: "limit-exceeded",
        limit: result.limit,
        pointer: result.pointer,
        ...(result.context ? { context: result.context } : {}),
      };
    case "not-acceptable":
      return result;
    case "comparison-deadline":
      return {
        kind: "comparison-refusal",
        reason: "deadline",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
        context: result.context,
      };
    case "comparison-owner-stopped":
      return {
        kind: "comparison-refusal",
        reason: "owner-stopped",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
      };
    case "temporarily-unavailable":
      return {
        kind: "refused",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
      };
    case "existing":
      if (observed && !result.context)
        throw new Error("existing receipt lost same-entry context", {
          cause: { id: result.receipt.id, key },
        });
      return observed
        ? {
            kind: "receipt",
            receipt: result.receipt,
            ...(result.context ? { context: result.context } : {}),
          }
        : { kind: "receipt", receipt: result.receipt };
    case "owned":
      return observed
        ? { kind: "receipt", ...store.executeObserved(result.claim) }
        : { kind: "receipt", receipt: store.execute(result.claim) };
  }
}
