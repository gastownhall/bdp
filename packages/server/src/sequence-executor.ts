import { clearImmediate, clearTimeout, setImmediate, setTimeout } from "node:timers";
import {
  assertPreparedReadUpdateCarrier,
  isReadProblemCode,
  parseReadUpdateProblem,
  parseReadUpdateSequenceMemberProblem,
  parseReadUpdateSequenceResponse,
  readProblem,
  readProblemDefinitionFor,
  type PreparedReadUpdateCarrier,
  type ReadProblemCode,
  type ReadUpdateProblem,
  type ReadUpdateProblemCode,
  type ReadUpdateSequenceResponse,
} from "@bdp/protocol";
import {
  runMember,
  snapshotMemberExecutorOptions,
  type MemberDisposition,
  type MemberExecutorOptions,
  type MemberTurn,
  type StablePrincipal,
} from "./member-executor.js";
import type { MemberCreatorBinding } from "./member-identity.js";
import { RecoveryStoreError, type Admission, type RecoveryStore } from "./recovery-store.js";

export type CancelScheduled = () => void;
export interface LifecycleScheduler {
  turn(callback: () => void): CancelScheduled;
  delay(milliseconds: number, callback: () => void): CancelScheduled;
}
export interface SequenceLifecycleOptions {
  readonly store: RecoveryStore;
  readonly member: MemberExecutorOptions;
  readonly maximumSequenceOperations: number | undefined;
  readonly maintenanceIntervalMs: number;
  readonly scheduler?: LifecycleScheduler;
}
export type SubmissionCompletion =
  | { readonly kind: "singleton"; readonly disposition: MemberDisposition }
  | { readonly kind: "sequence"; readonly response: ReadUpdateSequenceResponse };
export type Submission =
  | { readonly kind: "refused"; readonly problem: ReadUpdateProblem }
  | { readonly kind: "admitted"; readonly completion: Promise<SubmissionCompletion> };
export interface SequenceLifecycle {
  submit(carrier: PreparedReadUpdateCarrier, principal: StablePrincipal): Submission;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}
export type LifecyclePhase =
  | "initialize"
  | "not-accepting"
  | "reentrant"
  | "admit"
  | "register"
  | "schedule"
  | "member"
  | "project"
  | "cleanup"
  | "maintenance"
  | "cancel"
  | "close";
export type AttemptCleanupEvidence =
  | { readonly kind: "returned"; readonly releasedClaims: number }
  | { readonly kind: "failed"; readonly error: unknown };
interface Failure {
  phase: LifecyclePhase;
  cause: unknown;
  secondary: { readonly phase: LifecyclePhase; readonly error: unknown }[];
}
export class SequenceLifecycleError extends Error {
  readonly phase: LifecyclePhase;
  override readonly cause: unknown;
  readonly secondary: readonly { readonly phase: LifecyclePhase; readonly error: unknown }[];
  readonly cleanup?: AttemptCleanupEvidence;
  constructor(
    phase: LifecyclePhase,
    cause: unknown,
    secondary: Failure["secondary"] = [],
    cleanup?: AttemptCleanupEvidence,
  ) {
    super(`sequence lifecycle ${phase} failed`, { cause });
    this.name = "SequenceLifecycleError";
    this.phase = phase;
    this.cause = cause;
    this.secondary = Object.freeze(secondary.map((item) => Object.freeze({ ...item })));
    if (cleanup !== undefined) this.cleanup = cleanup;
  }
}
function failure(phase: LifecyclePhase, cause: unknown): Failure {
  return { phase, cause, secondary: [] };
}
function append(prior: Failure | undefined, phase: LifecyclePhase, error: unknown): Failure {
  if (!prior) return failure(phase, error);
  prior.secondary.push({ phase, error });
  return prior;
}
function errorOf(f: Failure, cleanup?: AttemptCleanupEvidence): SequenceLifecycleError {
  return new SequenceLifecycleError(f.phase, f.cause, f.secondary, cleanup);
}
function synchronous(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  ) {
    // Rejection hygiene only: foreign thenables can still cause later effects.
    // The authority must qualify synchronous callbacks, not rely on this sink.
    Promise.resolve(value).catch(() => {});
    throw new TypeError("synchronous lifecycle callback required");
  }
}
function positive(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError("positive safe integer required");
}
function fenced(error: unknown): boolean {
  return error instanceof RecoveryStoreError && error.reason === "fenced";
}
/** Referenced Node handles provide later-turn opportunities, not exact latency
 * or ordering against all I/O. Long logical maintenance periods are chunked by
 * the controller, never handed to Node as an overflowing timeout. */
export function createNodeLifecycleScheduler(): LifecycleScheduler {
  return Object.freeze({
    turn(callback: () => void) {
      const handle = setImmediate(callback);
      return () => clearImmediate(handle);
    },
    delay(milliseconds: number, callback: () => void) {
      const handle = setTimeout(callback, milliseconds);
      return () => clearTimeout(handle);
    },
  });
}
const updateStatuses: Readonly<Record<Exclude<ReadUpdateProblemCode, ReadProblemCode>, number>> =
  Object.freeze({
    "unsupported-media-type": 415,
    "binding-unavailable": 400,
    "validation-failed": 422,
    "type-not-installed": 422,
    "identity-taken": 409,
    "alias-path-taken": 409,
    "revision-mismatch": 409,
    "incident-links-exist": 409,
    "aggregate-constraint-violation": 409,
    "idempotency-conflict": 409,
    "idempotency-in-progress": 409,
    "idempotency-expired": 410,
    "revision-allocation-unsafe": 409,
  });
function project(turn: MemberTurn, carrier: PreparedReadUpdateCarrier, index: number): unknown {
  const operation = carrier.operations[index];
  if (!operation) throw new TypeError("lost original member");
  const position = {
    operationIndex: index,
    ...(operation.name === undefined ? {} : { operationName: operation.name }),
  };
  if (!("code" in turn.disposition)) return Object.freeze({ ...turn.disposition, ...position });
  const problem = parseReadUpdateProblem(turn.disposition);
  const status =
    problem.status ??
    (isReadProblemCode(problem.code)
      ? readProblemDefinitionFor(problem.code).status
      : updateStatuses[problem.code]);
  return parseReadUpdateSequenceMemberProblem({ ...problem, status, ...position });
}
interface Token {
  state: "scheduling" | "runnable" | "invalid";
  inline: boolean;
  cancel?: CancelScheduled | undefined;
}
interface Attempt {
  carrier: PreparedReadUpdateCarrier;
  principal: StablePrincipal;
  principalId: string;
  admission?: Admission;
  next: number;
  creators: (MemberCreatorBinding | undefined)[];
  entries: unknown[];
  token?: Token | undefined;
  cleanup?: AttemptCleanupEvidence;
  done: boolean;
  resolve(value: SubmissionCompletion): void;
  reject(error: unknown): void;
}
/** Takes an already qualified exclusive synchronous S6 owner after pure
 * validation. Prior expiry and complete retained/type/graph/population checks
 * remain the transferring authority's obligation. No HTTP or readiness facet.
 * After any factory throw, the receiving caller must close its supplied store,
 * preserving/reporting the original error if cleanup also fails. Pre-transfer
 * failures require this cleanup; after transfer, repeated close is safe on an
 * already-closed S6 store outside an active store callback.
 * Collected results and claims sum over all live attempts; no aggregate memory
 * or concurrency bound is supplied here. */
export function createSequenceLifecycle(options: SequenceLifecycleOptions): SequenceLifecycle {
  let store: RecoveryStore,
    member: MemberExecutorOptions,
    cap: number | undefined,
    interval: number;
  let scheduleTurn: LifecycleScheduler["turn"], scheduleDelay: LifecycleScheduler["delay"];
  try {
    const {
      store: suppliedStore,
      member: suppliedMember,
      maximumSequenceOperations,
      maintenanceIntervalMs,
      scheduler: suppliedScheduler,
    } = options;
    store = suppliedStore;
    member = snapshotMemberExecutorOptions(suppliedMember);
    cap = maximumSequenceOperations;
    interval = maintenanceIntervalMs;
    if (cap !== undefined) positive(cap);
    positive(interval);
    if (store.scope !== member.scope) throw new TypeError("lifecycle Scope differs from store");
    const scheduler = suppliedScheduler ?? createNodeLifecycleScheduler();
    const { turn, delay } = scheduler;
    if (typeof turn !== "function" || typeof delay !== "function")
      throw new TypeError("scheduler methods required");
    scheduleTurn = turn.bind(scheduler);
    scheduleDelay = delay.bind(scheduler);
  } catch (error) {
    throw new SequenceLifecycleError("initialize", error);
  }
  const clock = member.clock;
  let resolveClosed!: () => void, rejectClosed!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  closed.catch(() => {});
  let state: "initializing" | "accepting" | "draining" | "closed" = "initializing";
  let busy = false,
    storeFenced = false,
    closing = false;
  let ownerFailure: Failure | undefined;
  let maintenance: Token | undefined;
  let fenceDrainScheduled = false;
  const attempts = new Set<Attempt>();
  const deferred: (() => void)[] = [];
  function cancel(token: Token | undefined): void {
    if (!token) return;
    token.state = "invalid";
    const stop = token.cancel;
    token.cancel = undefined;
    if (stop) synchronous(stop());
  }
  function shutdown(f?: Failure): void {
    if (f)
      ownerFailure = ownerFailure
        ? append(ownerFailure, f.phase, errorOf(f))
        : { ...f, secondary: [...f.secondary] };
    if (state === "closed") return;
    state = "draining";
    const timer = maintenance;
    maintenance = undefined;
    try {
      cancel(timer);
    } catch (error) {
      ownerFailure = append(ownerFailure, "cancel", error);
    }
    if (storeFenced && !fenceDrainScheduled && attempts.size !== 0) {
      fenceDrainScheduled = true;
      deferred.push(() => {
        try {
          // Each cleanup can itself fail fenced. It must not recursively sweep
          // the registry or append into a sibling's mutable failure accumulator.
          for (const attempt of attempts) {
            const cause = ownerFailure;
            finish(
              attempt,
              cause
                ? failure(cause.phase, cause.cause)
                : failure("member", new Error("fenced store")),
            );
          }
        } finally {
          fenceDrainScheduled = false;
        }
      });
    }
  }
  function finish(attempt: Attempt, fault?: Failure, result?: SubmissionCompletion): boolean {
    if (attempt.done) return false;
    attempt.done = true;
    let fatal = false;
    const token = attempt.token;
    attempt.token = undefined;
    try {
      cancel(token);
    } catch (error) {
      fault = append(fault, "cancel", error);
      fatal = true;
    }
    if (attempt.admission) {
      try {
        const count = store.abandonAttempt(attempt.admission);
        attempt.cleanup = Object.freeze({ kind: "returned", releasedClaims: count });
        if (!fault && count !== 0) {
          fault = failure("cleanup", new Error("completed attempt retained outstanding claims"));
          fatal = true;
        }
      } catch (error) {
        attempt.cleanup = Object.freeze({ kind: "failed", error });
        fault = append(fault, "cleanup", error);
        if (fenced(error)) storeFenced = true;
        fatal = true;
      }
    }
    attempts.delete(attempt);
    if (fault) attempt.reject(errorOf(fault, attempt.cleanup));
    else if (result) attempt.resolve(result);
    else throw new Error("finalization lacks a result or fault");
    if (fatal) shutdown(fault);
    return fatal;
  }
  function closeIfDrained(): void {
    if (state !== "draining" || attempts.size !== 0 || closing) return;
    closing = true;
    try {
      store.close();
    } catch (error) {
      ownerFailure = append(ownerFailure, "close", error);
    }
    state = "closed";
    if (ownerFailure) rejectClosed(errorOf(ownerFailure));
    else resolveClosed();
  }
  function enter<T>(action: () => T): T {
    if (busy) throw new SequenceLifecycleError("reentrant", new Error("owner entry is active"));
    busy = true;
    try {
      return action();
    } finally {
      try {
        for (let index = 0; index < deferred.length; index++) deferred[index]?.();
        deferred.length = 0;
        closeIfDrained();
      } finally {
        busy = false;
      }
    }
  }
  function schedule(
    token: Token,
    action: () => void,
    fail: (f: Failure) => void,
    milliseconds?: number,
  ): void {
    const callback = () => {
      if (token.state === "invalid") return;
      if (token.state === "scheduling") {
        token.inline = true;
        return;
      }
      token.state = "invalid";
      token.cancel = undefined;
      if (busy) {
        deferred.push(() => fail(failure("schedule", new Error("reentrant scheduled callback"))));
        return;
      }
      enter(action);
    };
    let fault: Failure | undefined;
    try {
      const stop =
        milliseconds === undefined ? scheduleTurn(callback) : scheduleDelay(milliseconds, callback);
      if (typeof stop !== "function") {
        synchronous(stop);
        throw new TypeError("synchronous cancellation function required");
      }
      token.cancel = stop;
      if (token.inline) throw new TypeError("scheduler invoked callback inline");
      token.state = "runnable";
    } catch (error) {
      token.state = "invalid";
      fault = failure("schedule", error);
      try {
        cancel(token);
      } catch (cancelError) {
        fault = append(fault, "cancel", cancelError);
      }
    }
    if (fault) fail(fault);
  }
  function token(): Token {
    return { state: "scheduling", inline: false };
  }
  function maintenanceFailure(f: Failure): void {
    shutdown(f);
  }
  function armPeriod(remaining: number): void {
    if (state !== "initializing" && state !== "accepting") return;
    const chunk = Math.min(remaining, 2_147_483_647);
    const scheduled = token();
    maintenance = scheduled;
    schedule(
      scheduled,
      () => {
        maintenance = undefined;
        if (remaining > chunk) armPeriod(remaining - chunk);
        else {
          try {
            expire();
          } catch (error) {
            if (fenced(error)) storeFenced = true;
            maintenanceFailure(failure("maintenance", error));
            return;
          }
          armPeriod(interval);
        }
      },
      maintenanceFailure,
      chunk,
    );
  }
  function expire(): void {
    const now: unknown = clock();
    synchronous(now);
    if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0)
      throw new TypeError("maintenance epoch must be nonnegative safe integer");
    // S6's two unindexed predicates examine all key-state rows, including
    // permanent tombstones, with synchronous traversal/change/journal costs.
    // Restarting after completion bounds no individual pass or empty-set cost.
    store.expire(now);
  }
  function scheduleMember(attempt: Attempt): void {
    const scheduled = token();
    attempt.token = scheduled;
    schedule(
      scheduled,
      () => {
        attempt.token = undefined;
        if (attempt.done) return;
        if (storeFenced) {
          const first = ownerFailure;
          finish(
            attempt,
            first
              ? failure(first.phase, first.cause)
              : failure("member", new Error("fenced store")),
          );
          return;
        }
        let turn: MemberTurn;
        try {
          if (attempt.principal.id !== attempt.principalId)
            throw new TypeError("principal changed between turns");
          const admission = attempt.admission;
          if (!admission) throw new Error("unregistered Admission");
          const prefix = attempt.creators.length;
          turn = runMember(
            store,
            admission,
            attempt.principal,
            attempt.carrier,
            attempt.next,
            (index) => {
              if (!Number.isSafeInteger(index) || index < 0 || index >= prefix)
                throw new TypeError("creator outside completed prefix");
              const fact = attempt.creators[index];
              if (!fact) throw new TypeError("completed prefix lacks creator fact");
              return fact;
            },
            member,
          );
        } catch (error) {
          const fault = failure("member", error);
          if (fenced(error)) storeFenced = true;
          const fatal = finish(attempt, fault);
          if (storeFenced && !fatal) shutdown(fault);
          return;
        }
        attempt.creators.push(turn.creator);
        try {
          if (attempt.carrier.kind === "sequence")
            attempt.entries.push(project(turn, attempt.carrier, attempt.next));
          attempt.next++;
          if (attempt.next === attempt.carrier.operations.length) {
            const result: SubmissionCompletion =
              attempt.carrier.kind === "singleton"
                ? Object.freeze({ kind: "singleton", disposition: turn.disposition })
                : Object.freeze({
                    kind: "sequence",
                    response: parseReadUpdateSequenceResponse(
                      { results: attempt.entries },
                      { operations: attempt.carrier.operations },
                    ),
                  });
            finish(attempt, undefined, result);
          } else scheduleMember(attempt);
        } catch (error) {
          finish(attempt, failure("project", error));
        }
      },
      (f) => {
        const notified = finish(attempt, f);
        if (!notified) shutdown(f);
      },
    );
  }
  // Ownership transfers here, after all pure receiving validation above.
  enter(() => {
    try {
      expire();
      armPeriod(interval);
    } catch (error) {
      shutdown(failure("initialize", error));
    }
    if (state === "initializing") state = "accepting";
  });
  if (ownerFailure) throw errorOf(ownerFailure);
  return Object.freeze({
    closed,
    submit(carrier: PreparedReadUpdateCarrier, principal: StablePrincipal): Submission {
      return enter(() => {
        if (state !== "accepting")
          throw new SequenceLifecycleError("not-accepting", new Error("owner is not accepting"));
        const principalId = principal.id;
        if (typeof principalId !== "string" || !principalId || !principalId.isWellFormed())
          throw new TypeError("stable principal required");
        assertPreparedReadUpdateCarrier(carrier, member.scope);
        if (carrier.kind === "sequence" && cap !== undefined && carrier.operations.length > cap)
          return Object.freeze({
            kind: "refused",
            problem: parseReadUpdateProblem(readProblem("limit-exceeded")),
          });
        let resolve!: (value: SubmissionCompletion) => void, reject!: (error: unknown) => void;
        const completion = new Promise<SubmissionCompletion>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        completion.catch(() => {});
        const attempt: Attempt = {
          carrier,
          principal,
          principalId,
          next: 0,
          creators: [],
          entries: [],
          done: false,
          resolve,
          reject,
        };
        try {
          attempt.admission = store.admit(principalId, carrier.keys);
        } catch (error) {
          const fault = failure("admit", error);
          reject(errorOf(fault));
          if (fenced(error)) {
            storeFenced = true;
            shutdown(fault);
          }
          throw errorOf(fault);
        }
        try {
          attempts.add(attempt);
        } catch (error) {
          const fault = failure("register", error);
          finish(attempt, fault);
          throw errorOf(fault, attempt.cleanup);
        }
        scheduleMember(attempt);
        return Object.freeze({ kind: "admitted", completion });
      });
    },
    close(): Promise<void> {
      return enter(() => {
        shutdown();
        return closed;
      });
    },
  });
}
