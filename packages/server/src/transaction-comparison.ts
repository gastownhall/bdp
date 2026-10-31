/** Private direct-carrier comparison loop. All DB work is in short owner steps. */
import { setTimeout as delay } from "node:timers/promises";
import type { PreparedTransaction } from "./transaction-batch.js";
import {
  snapshotTransactionReceivingControls,
  type openTransactionStore,
  type TransactionReceivingAdmission,
  type TransactionReceivingControls,
  type TransactionReadContext,
} from "./transaction-store.js";
export type DirectComparison =
  | Exclude<TransactionReceivingAdmission, { kind: "comparison-pending" }>
  | { readonly kind: "temporarily-unavailable" }
  | { readonly kind: "comparison-deadline"; readonly context: TransactionReadContext }
  | { readonly kind: "comparison-owner-stopped" };
/** The private default is finite and independent of transaction duration. Options
 * are test seams, not protocol/discovery configuration or another key owner. */
export async function compareAndAdmitTransaction(
  store: Pick<ReturnType<typeof openTransactionStore>, "scopeEpoch" | "comparisonEpoch"> & {
    admit(
      principal: string,
      key: string,
      request: PreparedTransaction,
      controls?: TransactionReceivingControls,
    ): TransactionReceivingAdmission;
  },
  principal: string,
  key: string,
  request: PreparedTransaction,
  options: {
    readonly receiving?: TransactionReceivingControls;
    readonly budgetMs?: number;
    readonly now?: () => number;
    readonly wait?: () => Promise<void>;
    /** Bound by observed submission only; never runtime/caller configuration. */
    readonly observeDeadline?:
      | ReturnType<typeof openTransactionStore>["observeComparisonDeadline"]
      | undefined;
  } = {},
): Promise<DirectComparison> {
  const receiving =
    options.receiving === undefined
      ? undefined
      : snapshotTransactionReceivingControls(options.receiving);
  const budget = options.budgetMs ?? 1000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 2147483647)
    throw new TypeError("finite positive comparison budget required");
  const now = options.now ?? (() => performance.now());
  const deadline = now() + budget;
  const epoch = store.scopeEpoch;
  for (;;) {
    if (store.comparisonEpoch() !== epoch)
      return options.observeDeadline
        ? { kind: "comparison-owner-stopped" }
        : { kind: "temporarily-unavailable" };
    if (now() >= deadline) {
      if (!options.observeDeadline) return { kind: "temporarily-unavailable" };
      // Synchronous final check + current tuple; never hold its owner entry over wait.
      const observed = options.observeDeadline(epoch);
      return observed.kind === "observed"
        ? { kind: "comparison-deadline", context: observed.context }
        : { kind: "comparison-owner-stopped" };
    }
    // Retraction may make this a fresh admission. Same original deadline and no
    // inherited claim: admit consults the current authoritative key each time.
    const result =
      receiving === undefined
        ? store.admit(principal, key, request)
        : store.admit(principal, key, request, receiving);
    if (result.kind !== "comparison-pending") return result;
    await (options.wait ? options.wait() : delay(Math.min(5, Math.max(0, deadline - now()))));
  }
}
