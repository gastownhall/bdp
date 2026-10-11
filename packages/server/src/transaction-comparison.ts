/** Private direct-carrier comparison loop. All DB work is in short owner steps. */
import { setTimeout as delay } from "node:timers/promises";
import type { PreparedTransaction } from "./transaction-batch.js";
import type { openTransactionStore, TransactionAdmission } from "./transaction-store.js";
export type DirectComparison =
  | Exclude<TransactionAdmission, { kind: "comparison-pending" }>
  | { readonly kind: "temporarily-unavailable" };
/** The private default is finite and independent of transaction duration. Options
 * are test seams, not protocol/discovery configuration or another key owner. */
export async function compareAndAdmitTransaction(
  store: Pick<ReturnType<typeof openTransactionStore>, "scopeEpoch" | "comparisonEpoch" | "admit">,
  principal: string,
  key: string,
  request: PreparedTransaction,
  options: {
    readonly budgetMs?: number;
    readonly now?: () => number;
    readonly wait?: () => Promise<void>;
  } = {},
): Promise<DirectComparison> {
  const budget = options.budgetMs ?? 1000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 2147483647)
    throw new TypeError("finite positive comparison budget required");
  const now = options.now ?? (() => performance.now());
  const deadline = now() + budget;
  const epoch = store.scopeEpoch;
  for (;;) {
    if (store.comparisonEpoch() !== epoch || now() >= deadline)
      return { kind: "temporarily-unavailable" };
    // Retraction may make this a fresh admission. Same original deadline and no
    // inherited claim: admit consults the current authoritative key each time.
    const result = store.admit(principal, key, request);
    if (result.kind !== "comparison-pending") return result;
    await (options.wait ? options.wait() : delay(Math.min(5, Math.max(0, deadline - now()))));
  }
}
