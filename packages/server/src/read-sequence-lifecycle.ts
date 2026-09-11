import {
  parseCanonicalScope,
  type PreparedReadUpdateCarrier,
  type ReadRequest,
} from "@bdp/protocol";
import {
  AuthorityReadError,
  createAuthorityReadPlane,
  type AuthorityAliasResult,
  type AuthorityReadFacet,
  type AuthorityReadOptions,
  type AuthorityReadPlane,
  type AuthorityReadResult,
  type ReadPrincipal,
} from "./authority-read.js";
import type { StablePrincipal } from "./member-executor.js";
import { ScopeServerClosedError } from "./read-request.js";
import type { SequenceLifecycle, Submission } from "./sequence-executor.js";

export interface ReadSequenceLifecycleOptions {
  readonly owner: SequenceLifecycle;
  readonly read: Omit<AuthorityReadOptions, "entry">;
}
export interface ReadSequenceLifecycle {
  submit(carrier: PreparedReadUpdateCarrier, principal: StablePrincipal): Submission;
  readFor(principal: ReadPrincipal): AuthorityReadFacet;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}
export type ReadSequenceEntryOrigin = "coordinator" | "owner" | "read";
export class ReadSequenceEntryError extends Error {
  constructor(
    readonly reason: "reentrant" | "not-accepting",
    readonly origin: ReadSequenceEntryOrigin,
  ) {
    super(`Read/sequence entry ${reason}: ${origin}`);
    this.name = "ReadSequenceEntryError";
  }
}
export type ComponentCompletion =
  | { readonly kind: "fulfilled" }
  | { readonly kind: "rejected"; readonly error: unknown };
export interface ComponentCloseEvidence {
  readonly component: "owner" | "read";
  readonly invocationFault?: { readonly error: unknown };
  readonly completion: ComponentCompletion;
}
function firstError(evidence: ComponentCloseEvidence): { readonly error: unknown } | undefined {
  return (
    evidence.invocationFault ??
    (evidence.completion.kind === "rejected" ? evidence.completion : undefined)
  );
}
export class ReadSequenceCloseError extends Error {
  override readonly cause: unknown;
  constructor(
    readonly owner: ComponentCloseEvidence,
    readonly read: ComponentCloseEvidence,
  ) {
    const cause = (firstError(owner) ?? firstError(read))?.error;
    super("Read/sequence close failed", { cause });
    this.name = "ReadSequenceCloseError";
    this.cause = cause;
    Object.freeze(this);
  }
}
export class ReadSequenceConstructionError extends Error {
  constructor(
    readonly phase: "receiving" | "plane",
    readonly ownership: "caller" | "coordinator",
    override readonly cause: unknown,
    readonly ownerCleanup?: ComponentCloseEvidence,
  ) {
    super(`Read/sequence construction failed during ${phase}`, { cause });
    this.name = "ReadSequenceConstructionError";
    Object.freeze(this);
  }
}

// Every original and derived internal Promise has a nonthrowing rejection owner.
// This observer does not change the completion returned to the caller.
function observe<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = observe(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { promise, resolve, reject };
}
function record(
  component: ComponentCloseEvidence["component"],
  invocationFault: ComponentCloseEvidence["invocationFault"],
  result: PromiseSettledResult<void>,
): ComponentCloseEvidence {
  const completion: ComponentCompletion =
    result.status === "fulfilled"
      ? Object.freeze({ kind: "fulfilled" })
      : Object.freeze({ kind: "rejected", error: result.reason });
  return Object.freeze({
    component,
    ...(invocationFault === undefined ? {} : { invocationFault }),
    completion,
  });
}
function invokeClose(
  close: () => Promise<void>,
  closed: Promise<void>,
): ComponentCloseEvidence["invocationFault"] {
  try {
    const returned = close();
    if (returned !== closed) {
      if (returned instanceof Promise) observe(returned);
      throw new TypeError("component close must return its fixed closed Promise");
    }
  } catch (error) {
    return Object.freeze({ error });
  }
  return undefined;
}
function receive(options: ReadSequenceLifecycleOptions) {
  if ("scope" in options) throw new TypeError("coordinator Scope must come from its owner");
  const { owner, read } = options;
  if ("entry" in read) throw new TypeError("Read entry must come from its owner");
  const { scope: ownerScope, submit, withRead, inspectLifecycle, close, closed } = owner;
  if (
    [submit, withRead, inspectLifecycle, close].some((method) => typeof method !== "function") ||
    !(closed instanceof Promise)
  )
    throw new TypeError("actual synchronous lifecycle methods and completion required");
  const scope = parseCanonicalScope(ownerScope);
  const {
    scopeEpoch,
    scopeConfiguration,
    installedTypes,
    selectorLimits,
    pagination,
    advertisedLimits,
    captureReadAuthorization,
  } = read;
  const { capture } = scopeConfiguration;
  const { clock, generateOpaqueToken } = pagination;
  if (
    typeof scopeEpoch !== "string" ||
    installedTypes === undefined ||
    selectorLimits === undefined ||
    advertisedLimits === undefined ||
    [capture, captureReadAuthorization, clock, generateOpaqueToken].some(
      (method) => typeof method !== "function",
    )
  )
    throw new TypeError("complete qualified Read inputs required");
  const copiedPagination = Object.freeze({
    scope: pagination.scope,
    defaultPageItems: pagination.defaultPageItems,
    maxPageItems: pagination.maxPageItems,
    cursorTtlMs: pagination.cursorTtlMs,
    retainedStateCapacity: pagination.retainedStateCapacity,
    maxRetainedCursorPositionsPerSnapshot: pagination.maxRetainedCursorPositionsPerSnapshot,
    retainedSnapshotByteCapacity: pagination.retainedSnapshotByteCapacity,
    retainedSnapshotNodeCapacity: pagination.retainedSnapshotNodeCapacity,
    maxOpaqueTokenLength: pagination.maxOpaqueTokenLength,
    tokenGenerationAttempts: pagination.tokenGenerationAttempts,
    idleCleanup: pagination.idleCleanup,
  });
  if (copiedPagination.scope !== scope)
    throw new TypeError("pagination Scope differs from actual lifecycle Scope");
  const inspect = inspectLifecycle.bind(owner);
  const state = inspect();
  if (state.busy || !state.accepting)
    throw new TypeError("coordinator requires an idle accepting lifecycle");
  return {
    scope,
    submit: submit.bind(owner),
    withRead: withRead.bind(owner),
    inspect,
    close: close.bind(owner),
    closed,
    read: {
      scopeEpoch,
      scopeConfiguration: Object.freeze({ capture: capture.bind(scopeConfiguration) }),
      installedTypes,
      selectorLimits,
      advertisedLimits,
      captureReadAuthorization: captureReadAuthorization.bind(read),
    },
    pagination: copiedPagination,
    clock: clock.bind(pagination),
    generateOpaqueToken: generateOpaqueToken.bind(pagination),
  };
}

type Phase =
  | "constructing"
  | "construction-cleanup"
  | "accepting"
  | "submitting"
  | "binding-read"
  | "reading"
  | "read-callback"
  | "closing"
  | "draining"
  | "closed";
function delegationActive(phase: Phase): boolean {
  return (
    phase === "submitting" || phase === "binding-read" || phase === "reading" || phase === "closing"
  );
}
type Decision = {
  readonly reason: ReadSequenceEntryError["reason"];
  readonly origin: ReadSequenceEntryOrigin;
};
function readRefusal(decision: Decision): Error {
  const cause = new ReadSequenceEntryError(decision.reason, decision.origin);
  if (decision.reason === "reentrant")
    return new AuthorityReadError("reentrant", "Read/sequence entry is active", { cause });
  const error = new ScopeServerClosedError();
  Object.defineProperty(error, "cause", { value: cause, configurable: true, writable: true });
  return error;
}

/** Takes exclusive operational ownership of an already qualified S5 owner only
 * after receiving succeeds. Checked Scope is identity, not installation or
 * provenance. Shared current configuration, immutable principals/contracts and
 * feasible workloads remain upstream qualifications. No raw store escapes.
 * Successful construction finishes synchronously; a post-transfer failure waits
 * for actual S5 cleanup before rejecting the observed factory Promise. */
export function createReadSequenceLifecycle(
  options: ReadSequenceLifecycleOptions,
): Promise<ReadSequenceLifecycle> {
  const factory = deferred<ReadSequenceLifecycle>();
  let captured: ReturnType<typeof receive>;
  try {
    captured = receive(options);
  } catch (error) {
    factory.reject(new ReadSequenceConstructionError("receiving", "caller", error));
    return factory.promise;
  }

  // Ownership transfers here. Observe the owner before constructing the plane.
  const joint = deferred<void>();
  let phase: Phase = "constructing";
  let plane: {
    readFor: AuthorityReadPlane["readFor"];
    close(): Promise<void>;
    closed: Promise<void>;
  };
  const failSettlement = (error: unknown): void => {
    phase = "closed";
    joint.reject(error);
  };
  const gate = (admission: boolean): Decision | undefined => {
    if (delegationActive(phase)) return { reason: "reentrant", origin: "coordinator" };
    if (phase === "read-callback") return { reason: "reentrant", origin: "read" };
    const state = captured.inspect();
    if (state.busy) return { reason: "reentrant", origin: "owner" };
    if (admission) {
      if (phase !== "accepting") return { reason: "not-accepting", origin: "coordinator" };
      if (!state.accepting) return { reason: "not-accepting", origin: "owner" };
    }
    return undefined;
  };
  function close(): Promise<void> {
    const decision = gate(false);
    if (decision) throw new ReadSequenceEntryError(decision.reason, decision.origin);
    if (phase === "construction-cleanup" || phase === "draining" || phase === "closed")
      return joint.promise;
    phase = "closing";
    const ownerFault = invokeClose(captured.close, captured.closed);
    const readFault = invokeClose(plane.close, plane.closed);
    phase = "draining";
    // Invocation faults do not replace fixed completion evidence. An invalid
    // component that never settles its captured completion leaves this pending;
    // do not synthesize cleanup success or a timeout.
    observe(
      Promise.allSettled([captured.closed, plane.closed]).then((results) => {
        try {
          const owner = record("owner", ownerFault, results[0]);
          const read = record("read", readFault, results[1]);
          phase = "closed";
          if (firstError(owner) || firstError(read))
            joint.reject(new ReadSequenceCloseError(owner, read));
          else joint.resolve(undefined);
        } catch (error) {
          failSettlement(error);
        }
      }),
    );
    return joint.promise;
  }
  const ownerFinished = (): void => {
    // The actual qualified inspector only reads two local primitives. Native
    // reactions run after active entries unwind; phase ordering below separates
    // construction cleanup and ordinary drain. failSettlement is no general
    // cleanup recovery guarantee for an invalid structural owner handle.
    if (phase === "construction-cleanup" || phase === "closed" || phase === "draining") return;
    try {
      // Never return/adopt joint.closed from an owner observer reaction.
      close();
    } catch (error) {
      failSettlement(error);
    }
  };
  observe(captured.closed.then(ownerFinished, ownerFinished));

  const callback = <T>(original: () => T): T => {
    if (delegationActive(phase) || phase === "read-callback") return original();
    const previous = phase;
    phase = "read-callback";
    try {
      return original();
    } finally {
      // Automatic owner drain can leave common accepting while owner rejects.
      // Restore the saved phase, never manufacture restored admission.
      phase = previous;
    }
  };
  try {
    const actual = createAuthorityReadPlane({
      ...captured.read,
      entry: Object.freeze({ scope: captured.scope, withRead: captured.withRead }),
      pagination: Object.freeze({
        ...captured.pagination,
        clock: () => callback(captured.clock),
        generateOpaqueToken: () => callback(captured.generateOpaqueToken),
      }),
    });
    plane = {
      readFor: actual.readFor.bind(actual),
      close: actual.close.bind(actual),
      closed: actual.closed,
    };
    const lifecycle: ReadSequenceLifecycle = Object.freeze({
      closed: joint.promise,
      close,
      submit(carrier: PreparedReadUpdateCarrier, principal: StablePrincipal): Submission {
        const decision = gate(true);
        if (decision) throw new ReadSequenceEntryError(decision.reason, decision.origin);
        const previous = phase;
        phase = "submitting";
        try {
          return captured.submit(carrier, principal);
        } finally {
          phase = previous;
        }
      },
      readFor(principal: ReadPrincipal): AuthorityReadFacet {
        const decision = gate(true);
        if (decision) throw readRefusal(decision);
        const previous = phase;
        phase = "binding-read";
        try {
          const facet = plane.readFor(principal);
          const perform = facet.perform.bind(facet);
          const resolveAlias = facet.resolveAlias.bind(facet);
          const deliver = <T>(action: () => Promise<T>): Promise<T> => {
            let owned: { readonly previous: Phase } | undefined;
            try {
              const refusal = gate(true);
              if (refusal) throw readRefusal(refusal);
              owned = { previous: phase };
              phase = "reading";
              return action();
            } catch (error) {
              return observe(Promise.reject<T>(error));
            } finally {
              if (owned) phase = owned.previous;
            }
          };
          return Object.freeze({
            perform<O extends ReadRequest>(
              request: O,
              options?: { readonly signal?: AbortSignal },
            ): Promise<AuthorityReadResult<O>> {
              return deliver(() => perform(request, options));
            },
            resolveAlias(
              url: string,
              options?: { readonly signal?: AbortSignal },
            ): Promise<AuthorityAliasResult> {
              return deliver(() => resolveAlias(url, options));
            },
          });
        } finally {
          phase = previous;
        }
      },
    });
    phase = "accepting";
    factory.resolve(lifecycle);
  } catch (original) {
    phase = "construction-cleanup";
    const invocationFault = invokeClose(captured.close, captured.closed);
    const finish = (result: PromiseSettledResult<void>): void => {
      try {
        const cleanup = record("owner", invocationFault, result);
        const error = new ReadSequenceConstructionError("plane", "coordinator", original, cleanup);
        phase = "closed";
        joint.reject(error);
        factory.reject(error);
      } catch (error) {
        failSettlement(error);
        factory.reject(error);
      }
    };
    observe(
      captured.closed.then(
        () => finish({ status: "fulfilled", value: undefined }),
        (reason: unknown) => finish({ status: "rejected", reason }),
      ),
    );
  }
  return factory.promise;
}
