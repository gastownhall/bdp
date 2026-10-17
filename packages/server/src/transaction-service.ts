import { projectTransactionEntry } from "./transaction-authorization.js";
import { assembleTransactionDiscovery } from "./transaction-discovery.js";
import { transactionEventRequest, TransactionEventParameterError } from "./transaction-events.js";
import type { TransactionSnapshotRequest } from "./transaction-snapshot.js";
import type { TransactionChangefeedIntent } from "./transaction-changefeed.js";
import {
  checkCurrentReadMinimum,
  snapshotTransactionMinimum,
  snapshotCurrentReadMinimum,
  waitForTransactionMinimum,
  type TransactionMinimum,
  type TransactionMinimumWaitOptions,
} from "./transaction-consistency.js";
/** Source-private same-owner lifecycle. No HTTP receiver, directory or profile
 * advertisement. Passing ownerLifetime:"service" transfers owner shutdown to
 * this service after successful construction; callers must stop using the owner.
 * Trusted policy publication drains finite mutations before revoking delivery. */
import { createNodeLifecycleScheduler, type LifecycleScheduler } from "./sequence-executor.js";
import type { PreparedTransactionSequence } from "./transaction-batch.js";
import {
  createTransactionSequenceStepper,
  type TransactionSequenceResponse,
} from "./transaction-sequence.js";
import {
  createTransactionReadPlane,
  captureTransactionReadDeliveryOptions,
  captureTransactionReadRequest,
  type TransactionReadOptions,
} from "./transaction-read.js";
import {
  submitTransaction,
  type TransactionSubmission,
  type TransactionSubmissionResult,
} from "./transaction-submission.js";
import type {
  openTransactionStore,
  TransactionReadContext,
  TransactionEventScan,
  TransactionReceipt,
  TransactionReceiptPage,
} from "./transaction-store.js";

export class TransactionStreamCapacityError extends Error {}

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
  | {
      readonly kind: "refused";
      readonly status: 404;
      readonly code: "resource-not-found";
      readonly context: TransactionReadContext;
    };
export interface TransactionServiceOptions {
  readonly ownerLifetime: "service";
  readonly read: TransactionReadOptions;
  /** Private scheduler must eventually deliver every uncancelled turn. No
   * delivery timeout is invented here; nondelivery also prevents drain. */
  readonly scheduler?: Pick<LifecycleScheduler, "turn">;
  /** Existing finite comparison policy; never a fresh deadline on each retry. */
  readonly comparison?: Parameters<typeof submitTransaction>[2];
  readonly minimumReads?: TransactionMinimumWaitOptions;
  readonly maximumStreams?: number;
}

export function createTransactionService(owner: Owner, options: TransactionServiceOptions) {
  if (options.ownerLifetime !== "service")
    throw new TypeError("explicit service owner lifetime required");
  const scope = owner.scope;
  const supplied = options.read,
    limits = supplied.advertisedLimits,
    page = limits.page,
    selector = limits.selector,
    enforcedSelector = supplied.selectorLimits;
  const suppliedPagination = supplied.pagination;
  const pagination = { ...suppliedPagination };
  // Capture callback values once, but keep the receiver the Read plane used
  // before scalar snapshotting. Stateful callbacks belong to their caller,
  // not to the frozen copy. Leave invalid values for existing validation.
  const clock = pagination.clock,
    generateOpaqueToken = pagination.generateOpaqueToken;
  if (typeof clock === "function") pagination.clock = clock.bind(suppliedPagination);
  if (typeof generateOpaqueToken === "function")
    pagination.generateOpaqueToken = generateOpaqueToken.bind(suppliedPagination);
  const capturedRead: TransactionReadOptions = Object.freeze({
    selectorLimits: Object.freeze({
      bytes: enforcedSelector.bytes,
      depth: enforcedSelector.depth,
      nodes: enforcedSelector.nodes,
    }),
    pagination: Object.freeze(pagination),
    advertisedLimits: Object.freeze({
      page: Object.freeze({ defaultItems: page.defaultItems, maximumItems: page.maximumItems }),
      selector: Object.freeze({
        bytes: selector.bytes,
        depth: selector.depth,
        nodes: selector.nodes,
      }),
      cursorTtlMilliseconds: limits.cursorTtlMilliseconds,
    }),
  });
  const maximum = owner.readConfiguration().receiptMaximumItems;
  if (
    capturedRead.advertisedLimits.page.maximumItems !== maximum ||
    capturedRead.pagination.maxPageItems !== maximum
  )
    throw new TypeError("receipt page maximum differs from installed owner");
  const scheduler = options.scheduler ?? createNodeLifecycleScheduler();
  const turn = scheduler.turn.bind(scheduler);
  const comparison = Object.freeze({ ...options.comparison });
  const minimumReads = Object.freeze({ ...options.minimumReads });
  const read = createTransactionReadPlane(owner, capturedRead);
  const active = new Set<Promise<unknown>>();
  const mutations = new Set<Promise<unknown>>();
  const maximumStreams = options.maximumStreams ?? 1;
  if (!Number.isSafeInteger(maximumStreams) || maximumStreams < 1)
    throw new TypeError("invalid private stream capacity");
  const streams = new Map<AbortController, Promise<void>>();
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
  function mutate<T>(start: () => Promise<T>): Promise<T> {
    const task = run(start);
    mutations.add(task);
    void task.then(
      () => mutations.delete(task),
      () => mutations.delete(task),
    );
    return task;
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
        results.length > capturedRead.advertisedLimits.page.maximumItems ||
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
  ): ReceiptObservation | Extract<TransactionServiceReceiptResult, { readonly status: 404 }> {
    const observed = owner.readReceipt(principal, id, minimum);
    return observed.receipt === undefined
      ? Object.freeze({
          kind: "refused",
          status: 404,
          code: "resource-not-found",
          context: observed.context,
        })
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
    scope,
    /** Internal candidate only: no wire exposure or readiness assertion. Without
     * a minimum the synchronous observation does not inspect signal. */
    discoveryObserved(supplied?: TransactionMinimum, signal?: AbortSignal) {
      const minimum = supplied === undefined ? undefined : snapshotCurrentReadMinimum(supplied);
      const observe = () => {
        const observed = owner.withRead((_reader, context) => {
          if (minimum !== undefined) checkCurrentReadMinimum(minimum, context, true);
          return Object.freeze({
            scopeEpoch: context.scopeEpoch,
            authorizationView: context.authorizationView,
            scopePosition: context.scopePosition,
          });
        });
        if (observed.kind === "entry-refused")
          throw new Error("transaction discovery observation refused", { cause: observed.cause });
        return observed.value;
      };
      const assemble = (context: TransactionReadContext) =>
        Object.freeze({
          ...assembleTransactionDiscovery(scope, context, capturedRead.advertisedLimits),
          context,
        });
      // Preserve zero-minimum entry timing. A minimum-bearing call owns one
      // finite lifetime; neither waits nor parsing retain a live owner entry.
      if (minimum === undefined) return run(async () => assemble(observe()));
      return run(async () =>
        assemble(await waitForTransactionMinimum(observe, minimumReads, signal)),
      );
    },
    /** Separate cancellable lifetime, never an infinite finite-work drain. The
     * callback starts only after capacity registration and abort wiring. */
    stream(
      start: (signal: AbortSignal) => Promise<void>,
      supplied: AbortSignal,
      expected?: TransactionReadContext,
    ): Promise<void> {
      check();
      if (supplied.aborted) return Promise.reject(supplied.reason);
      if (streams.size >= maximumStreams)
        throw new TransactionStreamCapacityError("private live stream capacity reached");
      const selected = expected ?? owner.withRead((_reader, context) => context);
      const context =
        "kind" in selected ? (selected.kind === "read" ? selected.value : undefined) : selected;
      if (!context) throw new Error("stream context observation refused");
      const lease = owner.acquireAuthorizationLease(context);
      const controller = new AbortController();
      const revoke = () => controller.abort(lease.signal.reason);
      lease.signal.addEventListener("abort", revoke, { once: true });
      const abort = () => controller.abort(supplied.reason);
      supplied.addEventListener("abort", abort, { once: true });
      const task = Promise.withResolvers<void>();
      streams.set(controller, task.promise);
      const finish = () => {
        supplied.removeEventListener("abort", abort);
        streams.delete(controller);
        lease.signal.removeEventListener("abort", revoke);
        lease.release();
      };
      void task.promise.then(finish, finish);
      try {
        task.resolve(start(controller.signal));
      } catch (error) {
        task.reject(error);
      }
      return task.promise;
    },
    /** Trusted administration, never HTTP. Cancellation stops waiting, not writes. */
    replaceAuthorizationPolicy(options: {
      readonly timeoutMs: number;
      readonly signal?: AbortSignal;
    }) {
      const timeoutMs = options.timeoutMs,
        signal = options.signal;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
        throw new TypeError("finite administrative timeout required");
      check();
      signal?.throwIfAborted();
      const deadline = performance.now() + timeoutMs;
      const resume = owner.pauseMutationAdmission();
      return run(async () => {
        let abort: (() => void) | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const cancelled = new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal?.reason);
            signal?.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => reject(new Error("authorization drain deadline")), timeoutMs);
            if (signal?.aborted) abort();
          });
          const settled = await Promise.race([Promise.allSettled([...mutations]), cancelled]);
          signal?.throwIfAborted();
          if (performance.now() >= deadline) throw new Error("authorization drain deadline");
          check();
          const failed = settled.filter((result) => result.status === "rejected");
          if (failed.length)
            throw new AggregateError(
              failed.map((result) => result.reason),
              "authorization drain failed",
            );
          return owner.replaceAuthorizationPolicy();
        } finally {
          clearTimeout(timer);
          if (abort) signal?.removeEventListener("abort", abort);
          resume();
        }
      });
    },
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
      const facet = read.minimumFor(principal, snapshotCurrentReadMinimum(minimum));
      const guarded: ReturnType<typeof read.readFor> = {
        perform: (request, receiving) =>
          run(() => {
            const capturedRequest = captureTransactionReadRequest(request);
            let captured: ReturnType<typeof captureTransactionReadDeliveryOptions>;
            try {
              captured = captureTransactionReadDeliveryOptions(receiving);
            } catch {
              // Preserve authority receiving errors without reading a caller
              // signal getter or allowing an unconditioned successful fallback.
              return facet.perform(capturedRequest, receiving);
            }
            return waitForTransactionMinimum(
              () => facet.perform(capturedRequest, captured),
              minimumReads,
              captured?.signal,
            );
          }),
        resolveAlias: (url, receiving) =>
          run(() => {
            let captured: ReturnType<typeof captureTransactionReadDeliveryOptions>;
            try {
              captured = captureTransactionReadDeliveryOptions(receiving);
            } catch {
              // Never inspect an unchecked signal while selecting the wait.
              return facet.resolveAlias(url, receiving);
            }
            return waitForTransactionMinimum(
              () => facet.resolveAlias(url, captured),
              minimumReads,
              captured?.signal,
            );
          }),
      };
      return Object.freeze(guarded);
    },
    snapshot(
      request: TransactionSnapshotRequest,
      supplied?: TransactionMinimum,
      signal?: AbortSignal,
    ) {
      // Without a minimum, preserve the synchronous owner path: it does not
      // observe signal or claim interruption of retained reads or copying.
      if (supplied === undefined) return run(async () => owner.observeSnapshot(request));
      let captured: { minimum: TransactionMinimum } | { error: TypeError };
      try {
        captured = { minimum: snapshotTransactionMinimum(supplied) };
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        captured = { error };
      }
      let minimum: TransactionMinimum;
      let kind: TransactionSnapshotRequest["kind"];
      if ("error" in captured) {
        // Revalidate only data fields synchronously; kind/lifecycle errors are
        // outside both catches. Excluded requests retain the original refusal.
        try {
          minimum = snapshotCurrentReadMinimum(supplied);
        } catch {
          throw captured.error;
        }
        kind = request.kind;
        if (kind !== "create" && kind !== "preflight") throw captured.error;
      } else {
        minimum = captured.minimum;
        kind = request.kind;
      }
      if (kind !== "create" && kind !== "preflight")
        throw new TypeError("minimum Snapshot observation requires fresh creation or preflight");
      // Freeze both controls before the first asynchronous attempt. Each owner
      // entry revalidates the tuple; no SQLite entry survives a finite wait.
      const copied = Object.freeze({ kind });
      return run(() =>
        waitForTransactionMinimum(
          () => owner.observeSnapshot(copied, minimum),
          minimumReads,
          signal,
        ),
      );
    },
    changes(
      intent: TransactionChangefeedIntent,
      supplied?: TransactionMinimum | "unsupported",
      signal?: AbortSignal,
      admission?: "finite-start-now",
    ) {
      // Capture controls before asynchronous retries. start=now observes admission
      // head once; advancing it at every attempt would skip intervening commits.
      const copied =
        "after" in intent
          ? Object.freeze({ after: intent.after })
          : Object.freeze({ start: intent.start });
      const finiteStartNow =
        admission === "finite-start-now" && "start" in copied && copied.start === "now";
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : finiteStartNow
            ? snapshotCurrentReadMinimum(supplied)
            : snapshotTransactionMinimum(supplied);
      return run(() => {
        const after = "after" in copied ? copied.after : owner.captureChangesStart();
        return waitForTransactionMinimum(
          () => owner.readChanges(after, minimum, finiteStartNow ? "finite-start-now" : undefined),
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
      return run(() => {
        let minimum = supplied;
        let captured = false;
        return waitForTransactionMinimum(
          () => {
            // Preserve waiter preflight, then capture once before any deferred wait.
            if (!captured) {
              if (after === undefined && supplied !== undefined && supplied !== "unsupported") {
                let initialMinimumSource = source === new URL("events/", scope).href;
                if (!initialMinimumSource && typeof source === "string") {
                  try {
                    const parsed = transactionEventRequest(new URL(source), scope);
                    initialMinimumSource =
                      parsed !== undefined &&
                      (parsed.source.kind === "bead" || parsed.source.kind === "link") &&
                      parsed.after === undefined &&
                      parsed.source.url === source;
                  } catch (error) {
                    // Classification failures retain the owner's source-error ordering.
                    if (
                      !(error instanceof TypeError) &&
                      !(error instanceof TransactionEventParameterError)
                    )
                      throw error;
                  }
                }
                // Malformed selected tuples must not be swallowed as classification errors.
                if (initialMinimumSource) minimum = snapshotCurrentReadMinimum(supplied);
              }
              captured = true;
            }
            return owner.readEvents(source, after, minimum);
          },
          minimumReads,
          signal,
        );
      });
    },
    beginEvents(
      source: string,
      after?: string,
      supplied?: TransactionMinimum | "unsupported",
      signal?: AbortSignal,
      invalidReconnect = false,
      admission?: "initial-scope-sse",
    ) {
      const initialScopeSseMinimum =
        admission === "initial-scope-sse" &&
        source === new URL("events/", scope).href &&
        after === undefined &&
        !invalidReconnect;
      const minimum =
        supplied === undefined || supplied === "unsupported"
          ? supplied
          : initialScopeSseMinimum
            ? snapshotCurrentReadMinimum(supplied)
            : snapshotTransactionMinimum(supplied);
      return run(() =>
        waitForTransactionMinimum(
          () =>
            owner.beginEventScan(
              source,
              after,
              minimum,
              invalidReconnect,
              initialScopeSseMinimum ? "initial-scope-sse" : undefined,
            ),
          minimumReads,
          signal,
        ),
      );
    },
    nextEvents(scan: TransactionEventScan, signal?: AbortSignal) {
      return run(async () => {
        signal?.throwIfAborted();
        return owner.advanceEventScan(scan);
      });
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
      | { readonly kind: "refused"; readonly code: "unauthenticated" }
      | {
          readonly kind: "refused";
          readonly code: "resource-not-found";
          readonly context?: TransactionReadContext;
        }
      | { readonly kind: "expired"; readonly context: TransactionReadContext }
      | { readonly kind: "unsupported" }
    > {
      return run(async () => {
        if (access.kind === "unauthenticated") return { kind: "refused", code: "unauthenticated" };
        const principal = access.principal,
          minimum =
            supplied === undefined || supplied === "unsupported"
              ? supplied
              : snapshotCurrentReadMinimum(supplied);
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
            ? Object.freeze({
                kind: "refused" as const,
                code: "resource-not-found" as const,
                ...(result.context === undefined ? {} : { context: result.context }),
              })
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
          return Object.freeze({
            kind: "refused",
            status: 404,
            code: "resource-not-found",
            context: observed.context,
          });
        }
        const minimum = snapshotCurrentReadMinimum(supplied);
        return waitForTransactionMinimum(() => receipt(principal, id, minimum), minimumReads);
      });
    },
    submit(request: TransactionSubmission): Promise<TransactionServiceSubmissionResult> {
      return mutate(async () => {
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
      return mutate(() => executeSequence(principal, sequence));
    },
    /** Authenticated exact local schema response; no mutation or minimum wait. */
    schemaObserved() {
      return run(async () => {
        const observed = owner.withRead((_reader, context) => Object.freeze({ context }));
        if (observed.kind === "entry-refused")
          throw new Error("transaction schema observation refused", { cause: observed.cause });
        return observed.value;
      });
    },
    /** Trusted HTTP refusal after carrier/auth checks. Observe without executing
     * members or admitting keys; an unavailable owner remains an internal fault. */
    sequenceRefusalObserved() {
      return run(async () => {
        const observed = owner.withRead((_reader, context) => Object.freeze({ context }));
        if (observed.kind === "entry-refused")
          throw new Error("transaction sequence refusal observation refused", {
            cause: observed.cause,
          });
        return observed.value;
      });
    },
    /** Project stable member execution facts in the current serving entry after
     * ordered execution. Version erasure remains outside this private policy. */
    sequenceObserved(principal: string, sequence: PreparedTransactionSequence) {
      return mutate(async () => {
        const response = await executeSequence(principal, sequence);
        const observed = owner.withRead((reader, context) => {
          const policy = owner.captureReadAuthorization(reader, {
            kind: "authenticated",
            principal: { id: principal },
          });
          const body = {
            results: response.results.map((entry) =>
              projectTransactionEntry(entry, policy.readPolicy === "all-visible"),
            ),
          };
          // Traverse frozen parents too: this observation guarantees every descendant is frozen.
          const freeze = (value: unknown): void => {
            const pending: unknown[] = [value];
            while (pending.length) {
              const node = pending.pop();
              if (node !== null && typeof node === "object") {
                for (const child of Object.values(node)) pending.push(child);
                Object.freeze(node);
              }
            }
          };
          freeze(body);
          return Object.freeze({ body, context });
        });
        if (observed.kind === "entry-refused")
          throw new Error("transaction sequence observation refused", { cause: observed.cause });
        return observed.value;
      });
    },
    /** Authentication is transport-supplied, never inferred from actor or URL.
     * Current owner policy projects contents; principal binding denies foreign
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
      return receipt(access.principal, id);
    },
    /** Stop accepting work, drain admitted work even when the client dropped its
     * delivery, then close cursors and this service-owned database. No disconnect
     * cancellation of accepted writes exists: stream cancellation is separate. */
    close(): Promise<void> {
      if (closing) return closing;
      accepting = false;
      closing = (async () => {
        for (const controller of streams.keys()) controller.abort(new Error("service shutdown"));
        await Promise.allSettled([...streams.values(), ...active]);
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
