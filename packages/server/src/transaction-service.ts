import type { TransactionSnapshotRequest } from "./transaction-snapshot.js";
import type { TransactionChangefeedIntent } from "./transaction-changefeed.js";
import {
  snapshotTransactionMinimum,
  waitForTransactionMinimum,
  type TransactionMinimum,
  type TransactionMinimumWaitOptions,
} from "./transaction-consistency.js";
/** Source-private same-owner lifecycle. No HTTP receiver, directory or profile
 * advertisement. Passing ownerLifetime:"service" transfers owner shutdown to
 * this service after successful construction; callers must stop using the owner.
 * Only the existing fixed all-visible installation policy applies. */
import { createNodeLifecycleScheduler, type LifecycleScheduler } from "./sequence-executor.js";
import type { PreparedTransactionSequence } from "./transaction-batch.js";
import {
  createTransactionSequenceStepper,
  type TransactionSequenceResponse,
} from "./transaction-sequence.js";
import { createTransactionReadPlane, type TransactionReadOptions } from "./transaction-read.js";
import {
  submitTransaction,
  type TransactionSubmission,
  type TransactionSubmissionResult,
} from "./transaction-submission.js";
import type {
  openTransactionStore,
  TransactionReadContext,
  TransactionReceipt,
  TransactionReceiptPage,
} from "./transaction-store.js";

type Owner = ReturnType<typeof openTransactionStore>;
type ReceiptObservation = {
  readonly kind: "receipt";
  readonly receipt: TransactionReceipt;
  readonly context: TransactionReadContext;
};
export type TransactionServiceSubmissionResult =
  | Exclude<TransactionSubmissionResult, { readonly kind: "receipt" }>
  | ReceiptObservation;
export type TransactionServiceReceiptResult =
  | ReceiptObservation
  | { readonly kind: "refused"; readonly status: 401; readonly code: "unauthenticated" }
  | { readonly kind: "refused"; readonly status: 404; readonly code: "resource-not-found" };
export interface TransactionServiceOptions {
  readonly ownerLifetime: "service";
  readonly read: TransactionReadOptions;
  /** Private scheduler must eventually deliver every uncancelled turn. No
   * delivery timeout is invented here; nondelivery also prevents drain. */
  readonly scheduler?: Pick<LifecycleScheduler, "turn">;
  /** Existing finite comparison policy; never a fresh deadline on each retry. */
  readonly comparison?: Parameters<typeof submitTransaction>[2];
  readonly minimumReads?: TransactionMinimumWaitOptions;
}

export function createTransactionService(owner: Owner, options: TransactionServiceOptions) {
  if (options.ownerLifetime !== "service")
    throw new TypeError("explicit service owner lifetime required");
  const maximum = owner.readConfiguration().receiptMaximumItems;
  if (
    options.read.advertisedLimits.page.maximumItems !== maximum ||
    options.read.pagination.maxPageItems !== maximum
  )
    throw new TypeError("receipt page maximum differs from installed owner");
  const scheduler = options.scheduler ?? createNodeLifecycleScheduler();
  const turn = scheduler.turn.bind(scheduler);
  const comparison = Object.freeze({ ...options.comparison });
  const minimumReads = Object.freeze({ ...options.minimumReads });
  const read = createTransactionReadPlane(owner, options.read);
  const active = new Set<Promise<unknown>>();
  let accepting = true;
  let cleanupFailure: AggregateError | undefined;
  let closing: Promise<void> | undefined;
  const completion = Promise.withResolvers<void>();
  void completion.promise.catch(() => {});
  function check() {
    if (cleanupFailure)
      throw new Error("transaction service cleanup failed; close and reopen", {
        cause: cleanupFailure,
      });
    if (!accepting) throw new Error("transaction service is closing or closed");
  }
  function run<T>(start: () => Promise<T>): Promise<T> {
    check();
    const task = Promise.withResolvers<T>();
    active.add(task.promise);
    // Observe rejected detached delivery without changing what its caller sees.
    void task.promise.then(
      () => active.delete(task.promise),
      () => active.delete(task.promise),
    );
    try {
      task.resolve(start());
    } catch (error) {
      task.reject(error);
    }
    return task.promise;
  }
  function nextTurn(): Promise<void> {
    return new Promise((resolve, reject) => {
      let scheduling = true,
        inline = false,
        live = true;
      let cancel: (() => void) | undefined;
      try {
        cancel = turn(() => {
          if (!live) return;
          if (scheduling) {
            inline = true;
            return;
          }
          live = false;
          resolve();
        });
        scheduling = false;
        if (typeof cancel !== "function") throw new TypeError("scheduler must return cancellation");
        if (inline) throw new TypeError("scheduler invoked callback inline");
      } catch (error) {
        live = false;
        try {
          if (typeof cancel === "function") cancel();
        } catch (cleanup) {
          reject(
            new AggregateError([error, cleanup], "transaction scheduling and cancellation failed"),
          );
          return;
        }
        reject(error);
      }
    });
  }
  function checked(observed: {
    readonly receipt: TransactionReceipt;
    readonly context: TransactionReadContext;
  }): ReceiptObservation {
    const results = observed.receipt.results;
    // URL prefixes are construction-guaranteed by this store; retain these
    // checks as defense in depth alongside the independent result bounds.
    if (
      observed.receipt.status === "completed" &&
      observed.receipt.detail === "available" &&
      (!Array.isArray(results) ||
        results.length === 0 ||
        results.length > options.read.advertisedLimits.page.maximumItems ||
        (observed.receipt.next !== null &&
          (typeof observed.receipt.next !== "string" ||
            !observed.receipt.next.startsWith(`${observed.receipt.id}/pages/`) ||
            results.length !== maximum)))
    )
      throw new Error("transaction receipt exceeds supported inline result bound", {
        cause: { id: observed.receipt.id, key: observed.receipt.idempotencyKey },
      });
    return Object.freeze({ kind: "receipt", ...observed });
  }
  function receipt(
    principal: string,
    id: string,
    minimum?: TransactionMinimum,
  ): ReceiptObservation | undefined {
    const observed = owner.readReceipt(principal, id, minimum);
    return observed.receipt === undefined
      ? undefined
      : checked({ ...observed, receipt: observed.receipt });
  }
  async function executeSequence(
    principal: string,
    sequence: PreparedTransactionSequence,
  ): Promise<TransactionSequenceResponse> {
    const stepper = createTransactionSequenceStepper(owner, principal, sequence);
    try {
      for (;;) {
        await nextTurn();
        const step = stepper.step();
        if (step.done) {
          if (!step.response) throw new Error("completed sequence lost response");
          return step.response;
        }
      }
    } catch (error) {
      try {
        stepper.abort();
      } catch (cleanup) {
        cleanupFailure = new AggregateError(
          [...(cleanupFailure ? [cleanupFailure] : []), error, cleanup],
          "transaction sequence and cleanup failed",
        );
        throw cleanupFailure;
      }
      throw error;
    }
  }
  return Object.freeze({
    closed: completion.promise,
    /** Actual fixed-owner Read configuration; no Transactional discovery claims. */
    readFor(principal: Parameters<typeof read.readFor>[0]) {
      check();
      const facet = read.readFor(principal);
      const guarded: ReturnType<typeof read.readFor> = {
        perform: (request, options) => run(() => facet.perform(request, options)),
        resolveAlias: (url, options) => run(() => facet.resolveAlias(url, options)),
      };
      return Object.freeze(guarded);
    },
    readAtMinimum(principal: Parameters<typeof read.readFor>[0], minimum: TransactionMinimum) {
      check();
      const facet = read.minimumFor(principal, snapshotTransactionMinimum(minimum));
      const guarded: ReturnType<typeof read.readFor> = {
        perform: (request, receiving) =>
          run(() =>
            waitForTransactionMinimum(
              () => facet.perform(request, receiving),
              minimumReads,
              receiving?.signal,
            ),
          ),
        resolveAlias: () => Promise.reject(new TypeError("minimum-read aliases unsupported")),
      };
      return Object.freeze(guarded);
    },
    snapshot(request: TransactionSnapshotRequest) {
      // Finite synchronous owner work has no disconnect/interrupt claim. Track
      // its delivery with the same close/drain machinery as other service work.
      return run(async () => owner.observeSnapshot(request));
    },
    changes(
      intent: TransactionChangefeedIntent,
      supplied?: TransactionMinimum | "unsupported",
      signal?: AbortSignal,
    ) {
      // Capture controls before asynchronous retries. start=now observes admission
      // head once; advancing it at every attempt would skip intervening commits.
      const copied =
        "after" in intent
          ? Object.freeze({ after: intent.after })
          : Object.freeze({ start: intent.start });
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : snapshotTransactionMinimum(supplied);
      return run(() => {
        const after = "after" in copied ? copied.after : owner.captureChangesStart();
        return waitForTransactionMinimum(
          () => owner.readChanges(after, minimum),
          minimumReads,
          signal,
        );
      });
    },
    events(
      source: string,
      after?: string,
      supplied?: TransactionMinimum | "unsupported",
      signal?: AbortSignal,
    ) {
      return run(() =>
        waitForTransactionMinimum(
          () => owner.readEvents(source, after, supplied),
          minimumReads,
          signal,
        ),
      );
    },
    receiptPage(
      access:
        | { readonly kind: "unauthenticated" }
        | { readonly kind: "authenticated"; readonly principal: string },
      id: string,
      supplied?: TransactionMinimum | "unsupported",
    ): Promise<
      | {
          readonly kind: "page";
          readonly page: TransactionReceiptPage;
          readonly context: TransactionReadContext;
        }
      | { readonly kind: "refused"; readonly code: "unauthenticated" | "resource-not-found" }
      | { readonly kind: "expired"; readonly context: TransactionReadContext }
      | { readonly kind: "unsupported" }
    > {
      return run(async () => {
        if (access.kind === "unauthenticated") return { kind: "refused", code: "unauthenticated" };
        const principal = access.principal,
          minimum =
            supplied === undefined || supplied === "unsupported"
              ? supplied
              : snapshotTransactionMinimum(supplied);
        return waitForTransactionMinimum(() => {
          const result = owner.readReceiptPage(principal, id, minimum);
          // Prefix checking is defense in depth, not an independent plan witness.
          if (
            result.kind === "page" &&
            (result.page.results.length < 1 ||
              result.page.results.length > maximum ||
              (result.page.next !== null &&
                (!result.page.next.startsWith(`${result.page.receipt}/pages/`) ||
                  result.page.results.length !== maximum)))
          )
            throw new Error("invalid receipt page projection");
          return result.kind === "missing"
            ? { kind: "refused" as const, code: "resource-not-found" as const }
            : result;
        }, minimumReads);
      });
    },
    receiptAtMinimum(
      access:
        | { readonly kind: "unauthenticated" }
        | { readonly kind: "authenticated"; readonly principal: string },
      id: string,
      supplied: TransactionMinimum | "unsupported",
    ): Promise<TransactionServiceReceiptResult | { readonly kind: "unsupported" }> {
      return run(async () => {
        if (access.kind === "unauthenticated")
          return Object.freeze({ kind: "refused", status: 401, code: "unauthenticated" });
        const principal = access.principal;
        if (supplied === "unsupported") {
          const observed = owner.readReceipt(principal, id, supplied);
          if ("kind" in observed) return observed;
          return Object.freeze({ kind: "refused", status: 404, code: "resource-not-found" });
        }
        const minimum = snapshotTransactionMinimum(supplied);
        return waitForTransactionMinimum(
          () =>
            receipt(principal, id, minimum) ??
            Object.freeze({
              kind: "refused" as const,
              status: 404 as const,
              code: "resource-not-found" as const,
            }),
          minimumReads,
        );
      });
    },
    submit(request: TransactionSubmission): Promise<TransactionServiceSubmissionResult> {
      return run(async () => {
        const authorization = Object.freeze({ ...request.authorization });
        const result = await submitTransaction(
          owner,
          { ...request, authorization },
          comparison,
          true,
        );
        if (result.kind !== "receipt") return result;
        if (authorization.kind !== "authorized") throw new Error("unauthorized receipt delivery");
        if (!result.context)
          throw new Error("admitted receipt lost same-entry observation", {
            cause: { id: result.receipt.id, key: result.receipt.idempotencyKey },
          });
        return checked({ receipt: result.receipt, context: result.context });
      });
    },
    /** Trusted prepared carrier + authenticated principal. Raw sequence receiving
     * order/media/negotiation is intentionally left to the later HTTP boundary. */
    sequence(
      principal: string,
      sequence: PreparedTransactionSequence,
    ): Promise<TransactionSequenceResponse> {
      return run(() => executeSequence(principal, sequence));
    },
    /** The fixed all-visible owner projects stable member execution facts and
     * captures the current serving context together, after ordered execution.
     * This does not project mutable grants or erasure; those remain unsupported. */
    sequenceObserved(principal: string, sequence: PreparedTransactionSequence) {
      return run(async () => {
        const response = await executeSequence(principal, sequence);
        const observed = owner.withRead((_reader, context) => {
          const freeze = (value: unknown): void => {
            if (value !== null && typeof value === "object") {
              for (const child of Object.values(value)) freeze(child);
              Object.freeze(value);
            }
          };
          freeze(response);
          return Object.freeze({ body: response, context });
        });
        if (observed.kind === "entry-refused")
          throw new Error("transaction sequence observation refused", { cause: observed.cause });
        return observed.value;
      });
    },
    /** Authentication is transport-supplied, never inferred from actor or URL.
     * Current owner policy is all-visible; principal binding still denies foreign
     * receipts uniformly. No key lookup, receipt listing or fabricated page URL. */
    receipt(
      access:
        | { readonly kind: "unauthenticated" }
        | { readonly kind: "authenticated"; readonly principal: string },
      id: string,
    ): TransactionServiceReceiptResult {
      check();
      if (access.kind === "unauthenticated")
        return Object.freeze({ kind: "refused", status: 401, code: "unauthenticated" });
      return (
        receipt(access.principal, id) ??
        Object.freeze({ kind: "refused", status: 404, code: "resource-not-found" })
      );
    },
    /** Stop accepting work, drain admitted work even when the client dropped its
     * delivery, then close cursors and this service-owned database. No disconnect
     * cancellation exists: only authority failures retract remaining claims. */
    close(): Promise<void> {
      if (closing) return closing;
      accepting = false;
      closing = (async () => {
        await Promise.allSettled([...active]);
        const errors: unknown[] = [];
        try {
          await read.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          owner.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, "transaction service shutdown failed");
      })();
      void closing.then(completion.resolve, completion.reject);
      return closing;
    },
  });
}
