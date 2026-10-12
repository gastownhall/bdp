/** Private bounded Transactional sequence carrier. No HTTP or profile admission. */
import { setImmediate } from "node:timers/promises";
import { parseReadUpdateProblem } from "@bdp/protocol";
import type { PreparedTransactionSequence } from "./transaction-batch.js";
import type { openTransactionStore, TransactionSequenceTurn } from "./transaction-store.js";

type Entry = Readonly<Record<string, unknown>>;
export interface TransactionSequenceResponse {
  readonly results: readonly Entry[];
}
const problems = {
  "idempotency-conflict": ["conflict", 409, "never"],
  "idempotency-in-progress": ["conflict", 409, "after-delay"],
  "idempotency-expired": ["gone", 410, "never"],
} as const;
function problem(code: keyof typeof problems): Entry {
  const [family, status, retry] = problems[code];
  return {
    ...parseReadUpdateProblem({
      type: `https://github.com/gastownhall/bdp/problems/${family}`,
      code,
      status,
      retry,
    }),
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid retained sequence disposition");
  return value as Record<string, unknown>;
}
function project(sequence: PreparedTransactionSequence, turn: TransactionSequenceTurn): Entry {
  const member = sequence.members[turn.index];
  if (!member) throw new Error("sequence turn outside carrier");
  let entry: Record<string, unknown>;
  if (turn.result.kind === "transient") entry = { ...problem("idempotency-in-progress") };
  else if (turn.result.kind === "conflict") entry = { ...problem("idempotency-conflict") };
  else {
    const receipt = turn.result.receipt;
    if (receipt.status === "pending") entry = { ...problem("idempotency-in-progress") };
    else if (receipt.detail === "expired") {
      if (receipt.status !== "completed") throw new Error("expired noncompleted receipt");
      entry = { ...problem("idempotency-expired") };
      if (member.operation === "createBead" || member.operation === "createLink") {
        if (!Array.isArray(receipt.allocated) || receipt.allocated.length !== 1)
          throw new Error("expired singleton creation lost its allocation");
        const allocated = record(receipt.allocated[0]);
        if (
          allocated.operationIndex !== 0 ||
          typeof allocated.id !== "string" ||
          typeof allocated.type !== "string"
        )
          throw new Error("invalid expired singleton allocation");
        entry.allocated = { id: allocated.id, type: allocated.type };
      }
    } else if (receipt.detail !== "available")
      throw new Error("unsupported private receipt disclosure");
    else if (receipt.status === "failed") entry = { ...record(receipt.problem) };
    else {
      if (!Array.isArray(receipt.results) || receipt.results.length !== 1 || receipt.next !== null)
        throw new Error("singleton sequence receipt must have exactly one result");
      entry = { ...record(receipt.results[0]) };
    }
  }
  // The current presentation supplies the position and label. Retained result
  // labels belong to the original carrier and are not semantic identity.
  delete entry.operationIndex;
  delete entry.operationName;
  return Object.freeze({
    ...entry,
    operationIndex: turn.index,
    ...(member.name === undefined ? {} : { operationName: member.name }),
  });
}
/** Source-private stepping gives unrelated owner calls a turn between commits.
 * Cancellation models an authority abort, not client disconnection. */
export function createTransactionSequenceStepper(
  store: ReturnType<typeof openTransactionStore>,
  principal: string,
  sequence: PreparedTransactionSequence,
) {
  const admission = store.admitSequence(principal, sequence);
  const results: Entry[] = [];
  let done = false,
    cancelled = false;
  return Object.freeze({
    step(): {
      readonly done: boolean;
      readonly entry: Entry;
      readonly response?: TransactionSequenceResponse;
    } {
      if (done || cancelled) throw new Error("sequence already complete or cancelled");
      try {
        const turn = store.nextSequence(admission);
        const entry = project(sequence, turn);
        results.push(entry);
        done = turn.done;
        return Object.freeze({
          done,
          entry,
          ...(done ? { response: Object.freeze({ results: Object.freeze([...results]) }) } : {}),
        });
      } catch (error) {
        cancelled = true;
        try {
          store.cancelSequence(admission);
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "sequence projection and cleanup failed");
        }
        throw error;
      }
    },
    abort(): number {
      const count = store.cancelSequence(admission);
      cancelled = true;
      return count;
    },
  });
}
/** Once admitted, response consumption does not control execution. Each turn
 * yields to unrelated calls; an internal failure retracts only this attempt's
 * remaining reservations and preserves its already committed prefix. */
export async function runTransactionSequence(
  store: ReturnType<typeof openTransactionStore>,
  principal: string,
  sequence: PreparedTransactionSequence,
): Promise<TransactionSequenceResponse> {
  const stepper = createTransactionSequenceStepper(store, principal, sequence);
  for (;;) {
    await setImmediate();
    const step = stepper.step();
    if (step.done) {
      if (!step.response) throw new Error("completed sequence lost response");
      return step.response;
    }
  }
}
