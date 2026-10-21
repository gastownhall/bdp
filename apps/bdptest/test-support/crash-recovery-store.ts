import { writeSync } from "node:fs";
import type { openTransactionStore as StoreFactory } from "../../../packages/server/src/transaction-store.js";

export type CrashPhase = "after-admission" | "after-commit";

const url = process.env.BDP_CRASH_STORE_URL;
if (!url) throw new Error("missing installed store URL");
const actual = (await import(url)) as { openTransactionStore: typeof StoreFactory };
function park(phase: string, observation: unknown): void {
  writeSync(3, `${JSON.stringify({ event: "parked", phase, observation })}\n`);
  // This process owns no timing claim: parent observes the pipe and SIGKILLs it.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("park unexpectedly returned");
}
export const openTransactionStore: typeof StoreFactory = (options) => {
  const owner = actual.openTransactionStore(options);
  writeSync(
    3,
    `${JSON.stringify({ event: "owner-opened", recoveredPending: owner.recoveredPending })}\n`,
  );
  return {
    ...owner,
    admitObserved(...args) {
      const result = owner.admitObserved(...args);
      if (process.env.BDP_CRASH_PHASE === "after-admission" && result.kind === "owned")
        park("after-admission", result.claim.receipt);
      return result;
    },
    executeObserved(...args) {
      const result = owner.executeObserved(...args);
      if (process.env.BDP_CRASH_PHASE === "after-commit") park("after-commit", result);
      return result;
    },
  };
};
