/** Private receiving/admission composition. No socket, export or profile claim. */
import { JsonSyntaxError, ReadUpdateCarrierError, type ReadUpdateOperation } from "@bdp/protocol";
import {
  prepareTransaction,
  prepareTransactionSingleton,
  TransactionDevelopmentLimitError,
} from "./transaction-batch.js";
import { compareAndAdmitTransaction } from "./transaction-comparison.js";
import {
  snapshotTransactionReceivingControls,
  type openTransactionStore,
  type TransactionReceipt,
  type TransactionReceivingControls,
} from "./transaction-store.js";

type Authorization =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "authorized"; readonly principal: string };
export interface TransactionSubmission {
  readonly carrier:
    | { readonly kind: "batch" }
    | { readonly kind: "singleton"; readonly operation: ReadUpdateOperation };
  readonly body: string;
  readonly key: string;
  /** Trusted authentication/Scope permission decision, not client attribution. */
  readonly authorization: Authorization;
  readonly receiving: TransactionReceivingControls;
}
export type TransactionSubmissionResult =
  | { readonly kind: "receipt"; readonly receipt: TransactionReceipt }
  | { readonly kind: "not-acceptable" }
  | { readonly kind: "development-limit"; readonly message: string }
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
      readonly limit?: "transaction.operations";
      readonly retry?: "after-delay";
    };

/** These are typed internal receiving results, not emitted HTTP Problem bodies.
 * Raw headers/targets/media and receipt HTTP representation remain future work.
 * Once admitted, this call owns execution independently of response consumption.
 * Internal/fenced failures propagate intact; they are not permanent receipts. */
export async function submitTransaction(
  store: ReturnType<typeof openTransactionStore>,
  submission: TransactionSubmission,
  comparison: Omit<NonNullable<Parameters<typeof compareAndAdmitTransaction>[4]>, "receiving"> = {},
): Promise<TransactionSubmissionResult> {
  const receiving = snapshotTransactionReceivingControls(submission.receiving);
  const { body, key } = submission;
  if (Buffer.byteLength(body) > 65536)
    return { kind: "refused", status: 413, code: "request-too-large" };
  let prepared: ReturnType<typeof prepareTransaction>;
  try {
    prepared =
      submission.carrier.kind === "batch"
        ? prepareTransaction(store.scope, body)
        : prepareTransactionSingleton(store.scope, submission.carrier.operation, body);
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(key))
      return { kind: "refused", status: 400, code: "malformed-request" };
  } catch (error) {
    if (error instanceof TransactionDevelopmentLimitError)
      return { kind: "development-limit", message: error.message };
    if (
      error instanceof JsonSyntaxError ||
      error instanceof ReadUpdateCarrierError ||
      error instanceof TypeError
    )
      return { kind: "refused", status: 400, code: "malformed-request" };
    throw error;
  }
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
  const result = await compareAndAdmitTransaction(store, authorization.principal, key, prepared, {
    ...comparison,
    receiving,
  });
  switch (result.kind) {
    case "conflict":
      return { kind: "refused", status: 409, code: "idempotency-conflict" };
    case "operation-limit":
      return {
        kind: "refused",
        status: 413,
        code: "limit-exceeded",
        limit: "transaction.operations",
      };
    case "not-acceptable":
      return result;
    case "temporarily-unavailable":
      return {
        kind: "refused",
        status: 503,
        code: "temporarily-unavailable",
        retry: "after-delay",
      };
    case "existing":
      return { kind: "receipt", receipt: result.receipt };
    case "owned":
      return { kind: "receipt", receipt: store.execute(result.claim) };
  }
}
