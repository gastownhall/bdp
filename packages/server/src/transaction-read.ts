/** Same-owner private Read composition with source conditions for canonical
 * current points, Type inventory and initial Resource/incident-Link reads. The service owns finite
 * waits; continuation minimums, receipt serving and replication Snapshots are
 * separate contracts. */
import {
  checkCurrentReadMinimum,
  snapshotCurrentReadMinimum,
  TransactionMinimumFailure,
  type TransactionMinimum,
} from "./transaction-consistency.js";
import { isProxy } from "node:util/types";
import {
  createAuthorityReadPlane,
  AuthorityReadError,
  type AuthorityReadDeliveryOptions,
  type AuthorityReadOptions,
  type AuthorityReadPlane,
  type AuthorityReadFacet,
  type AuthorityReadResult,
  type AuthorityAliasResult,
  type ReadObservation,
} from "./authority-read.js";
import type { ReadRequest } from "@bdp/protocol";
import type { TransactionReadContext } from "./transaction-store.js";
import type { openTransactionStore } from "./transaction-store.js";

export class TransactionMinimumVisibilityGap extends Error {}

/** Current private minimum subset; full request validation remains with Read. */
export function isCurrentTransactionMinimumRead(request: ReadRequest, scope: string): boolean {
  if (isProxy(request)) return false;
  switch (request.kind) {
    case "resource": {
      if (request.resource !== "type")
        return request.resource === "bead" || request.resource === "link";
      // Locality is checked before Read captures the request. Do not execute
      // an ID getter or method here; canonical syntax remains Read's decision.
      const id = Object.getOwnPropertyDescriptor(request, "id");
      return (
        id !== undefined &&
        "value" in id &&
        typeof id.value === "string" &&
        id.value.startsWith(scope)
      );
    }
    case "properties":
      return request.resource === "bead" || request.resource === "link";
    case "collection":
      return (
        (request.collection === "beads" ||
          request.collection === "links" ||
          request.collection === "types") &&
        request.continuation === undefined
      );
    case "bead-links":
      return request.continuation === undefined;
    default:
      return false;
  }
}

/** Capture route fields before any receiving signal callback can mutate the caller's
 * request. Preserve rejected descriptors/prototypes for the authority's own
 * receiving path; never invoke a getter while making this private snapshot. */
export function captureTransactionReadRequest<O extends ReadRequest>(request: O): O {
  if (request === null || typeof request !== "object" || isProxy(request)) return request;
  return Object.freeze(
    Object.create(Object.getPrototypeOf(request), Object.getOwnPropertyDescriptors(request)),
  ) as O;
}

function dataOnlyReadRequest(request: ReadRequest): boolean {
  if (request === null || typeof request !== "object" || isProxy(request) || Array.isArray(request))
    return false;
  const prototype = Object.getPrototypeOf(request);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(request).every((key) => {
      const field = Object.getOwnPropertyDescriptor(request, key);
      return typeof key === "string" && field !== undefined && "value" in field;
    })
  );
}

/** Classify only own data fields. Authority receiving still validates the full request. */
export function currentReadMinimumKind(
  request: ReadRequest,
): "resource" | "missing" | "initial-collection" | "strict" {
  if (isProxy(request) || !request || typeof request !== "object") return "strict";
  const fields = Object.getOwnPropertyDescriptors(request);
  const data = (key: string): unknown => {
    const field = fields[key];
    return field && "value" in field ? field.value : undefined;
  };
  if (
    (data("kind") === "resource" || data("kind") === "properties") &&
    (data("resource") === "bead" || data("resource") === "link")
  )
    return "resource";
  if (data("kind") === "bead-links" && data("continuation") === undefined) return "missing";
  if (
    data("kind") === "collection" &&
    (data("collection") === "beads" || data("collection") === "links") &&
    data("continuation") === undefined
  )
    return "initial-collection";
  return "strict";
}
type MinimumCondition = Readonly<{
  minimum: TransactionMinimum;
  kind: ReturnType<typeof currentReadMinimumKind> | "alias";
}>;
const minimumConditions = new WeakSet<object>();
function minimumCondition(
  minimum: TransactionMinimum,
  kind: MinimumCondition["kind"],
): MinimumCondition {
  const condition = Object.freeze({ minimum, kind });
  minimumConditions.add(condition);
  return condition;
}
function capturedCondition(value: unknown): MinimumCondition {
  if (!value || typeof value !== "object" || !minimumConditions.has(value))
    throw new TypeError("unrecognized private minimum condition");
  return value as MinimumCondition;
}

/** Preserve the authority's data-only option boundary while ignoring only the
 * ordinary facet's sourceCondition. Signal validation stays with the authority. */
function ordinaryDeliveryOptions(
  options: AuthorityReadDeliveryOptions | undefined,
): AuthorityReadDeliveryOptions | undefined {
  if (options === undefined) return undefined;
  if (options === null || typeof options !== "object" || isProxy(options) || Array.isArray(options))
    throw new AuthorityReadError(
      "invalid-input",
      "Read delivery options must be a plain data object",
    );
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null)
    throw new AuthorityReadError(
      "invalid-input",
      "Read delivery options must have a plain prototype",
    );
  let signal: PropertyDescriptor | undefined;
  let unknownKey = false;
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string")
      throw new AuthorityReadError(
        "invalid-input",
        "Read delivery options cannot have symbol fields",
      );
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new AuthorityReadError("invalid-input", "Read delivery options cannot have accessors");
    if (key !== "signal" && key !== "sourceCondition") unknownKey = true;
    if (key === "signal") signal = descriptor;
  }
  if (unknownKey) throw new AuthorityReadError("invalid-input", "unknown Read delivery option");
  return signal === undefined ? undefined : { signal: signal.value };
}

/** Source-private minimum-read receiving snapshot. Only authority-rejected option or
 * signal shapes throw; callers retain authority error/lifecycle delivery on that
 * path. The configured minimum replaces the caller's opaque condition value. */
export function captureTransactionReadDeliveryOptions(
  options: AuthorityReadDeliveryOptions | undefined,
): AuthorityReadDeliveryOptions | undefined {
  const captured = ordinaryDeliveryOptions(options);
  const signal = captured?.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      isProxy(signal) ||
      !(signal instanceof AbortSignal))
  )
    throw new AuthorityReadError("invalid-input", "Read signal must be an AbortSignal");
  return captured === undefined ? undefined : Object.freeze(captured);
}

export type TransactionReadOptions = Pick<
  AuthorityReadOptions,
  "selectorLimits" | "pagination" | "advertisedLimits"
>;

/** The caller owns the store lifetime. Closing the plane invalidates its cursors
 * but does not close or replace the mutation owner. Configuration is fixed for
 * this private store's lifetime and is captured through its guarded entry. */
export function createTransactionReadPlane(
  owner: ReturnType<typeof openTransactionStore>,
  options: TransactionReadOptions,
) {
  const configuration = owner.readConfiguration();
  const plane = createAuthorityReadPlane({
    entry: owner,
    scopeEpoch: configuration.scopeEpoch,
    installedTypes: configuration.installedTypes,
    scopeConfiguration: {
      capture: (reader) => ({
        ...configuration.scopeConfiguration,
        policyIdentity: owner.captureReadAuthorization(reader, { kind: "anonymous" })
          .authorizationView,
      }),
    },
    selectorLimits: options.selectorLimits,
    pagination: options.pagination,
    advertisedLimits: options.advertisedLimits,
    checkSourceCondition: (condition, observation, refusal) => {
      // Preserve the initial collection's already-materialized request-control
      // Problem. It is not a representation whose minimum can be satisfied.
      if (refusal?.code === "invalid-parameter" || refusal?.code === "limit-exceeded") return;
      const { minimum, kind } = capturedCondition(condition);
      const current = transactionReadContexts(observation).current;
      if (refusal?.code === "resource-not-found") {
        if (kind === "resource" || kind === "missing" || kind === "alias") return;
        try {
          checkCurrentReadMinimum(minimum, current, false);
          return;
        } catch (error) {
          // Only simultaneous missing/consistency failures remain unqualified.
          if (
            error instanceof TransactionMinimumFailure &&
            (error.reason === "behind" ||
              error.reason === "foreign-view" ||
              error.reason === "cursor-expired")
          )
            throw new TransactionMinimumVisibilityGap(
              "minimum-position visibility ordering unqualified",
            );
          throw error;
        }
      }
      checkCurrentReadMinimum(
        minimum,
        current,
        kind === "resource" || kind === "initial-collection" || kind === "alias",
      );
    },
    captureReadAuthorization: (reader, principal) => {
      const policy = owner.captureReadAuthorization(reader, principal);
      return {
        kind: "authorized",
        authorization: {
          scopeEpoch: configuration.scopeEpoch,
          authorizationView: policy.authorizationView,
          policy: { canRead: () => policy.readPolicy === "all-visible" },
          canReadType: () => policy.readPolicy === "all-visible",
        },
      };
    },
  });
  const checked = <Result extends AuthorityReadResult<ReadRequest> | AuthorityAliasResult>(
    result: Result,
  ): Result => {
    if ("observation" in result) transactionReadContexts(result.observation);
    return result;
  };
  const observe = <T>(promise: Promise<T>): Promise<T> => {
    void promise.catch(() => {});
    return promise;
  };
  const composed: AuthorityReadPlane = {
    closed: plane.closed,
    close: () => plane.close(),
    readFor(principal) {
      const facet = plane.readFor(principal);
      return {
        perform: (request, options) => {
          try {
            return observe(
              facet
                .perform(request, ordinaryDeliveryOptions(options))
                .then((result) => checked(result)),
            );
          } catch {
            // Invalid options still go through the authority's rejection path,
            // preserving lifecycle/error precedence and Promise delivery.
            return observe(facet.perform(request, options).then((result) => checked(result)));
          }
        },
        resolveAlias: (url, options) => {
          try {
            return observe(
              facet
                .resolveAlias(url, ordinaryDeliveryOptions(options))
                .then((result) => checked(result)),
            );
          } catch {
            return observe(facet.resolveAlias(url, options).then((result) => checked(result)));
          }
        },
      };
    },
  };
  return Object.freeze({
    ...composed,
    minimumFor(
      principal: Parameters<AuthorityReadPlane["readFor"]>[0],
      supplied: TransactionMinimum,
    ): AuthorityReadFacet {
      const minimum = snapshotCurrentReadMinimum(supplied),
        facet = plane.readFor(principal);
      return Object.freeze({
        perform: (request, options) => {
          const capturedRequest = captureTransactionReadRequest(request);
          if (!dataOnlyReadRequest(capturedRequest))
            return observe(
              facet.perform(capturedRequest, options).then((result) => checked(result)),
            );
          if (!isCurrentTransactionMinimumRead(capturedRequest, owner.scope))
            return Promise.reject(new TypeError("minimum-read route outside supported subset"));
          const condition = minimumCondition(minimum, currentReadMinimumKind(capturedRequest));
          let captured: AuthorityReadDeliveryOptions | undefined;
          try {
            captured = captureTransactionReadDeliveryOptions(options);
          } catch {
            // Capture rejects only shapes the authority also rejects. Preserve
            // its observed Promise and closed/reentrant receiving precedence.
            return observe(
              facet.perform(capturedRequest, options).then((result) => checked(result)),
            );
          }
          return observe(
            facet
              .perform(capturedRequest, { ...captured, sourceCondition: condition })
              .then((result) => checked(result)),
          );
        },
        resolveAlias: (url, options) => {
          const condition = minimumCondition(minimum, "alias");
          let captured: AuthorityReadDeliveryOptions | undefined;
          try {
            captured = captureTransactionReadDeliveryOptions(options);
          } catch {
            // Capture rejects only shapes the authority itself rejects. Preserve
            // its observed Promise and closed/reentrant receiving precedence.
            return observe(facet.resolveAlias(url, options).then((result) => checked(result)));
          }
          return observe(
            facet
              .resolveAlias(url, { ...captured, sourceCondition: condition })
              .then((result) => checked(result)),
          );
        },
      } satisfies AuthorityReadFacet);
    },
  });
}

/** Validated TX interpretation of the generic private Read observation. A
 * continuation's snapshot is its original selected data; current is the new
 * entry that checked whether that retained page can still be served. Neither
 * is inferred from a mutation receipt, and this does not implement HTTP barriers. */
export function transactionReadContexts(observation: ReadObservation): {
  readonly current: TransactionReadContext;
  readonly snapshot?: TransactionReadContext;
} {
  const parse = (value: ReadObservation["sourceContext"]): TransactionReadContext => {
    if (
      !value ||
      typeof value !== "object" ||
      isProxy(value) ||
      Reflect.ownKeys(value).length !== 3 ||
      Object.keys(value).sort().join(",") !== "authorizationView,scopeEpoch,scopePosition"
    )
      throw new Error("missing or invalid Transactional Read context");
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some((field) => !("value" in field)))
      throw new Error("invalid Transactional Read context fields");
    const scopeEpoch: unknown = fields.scopeEpoch?.value;
    const authorizationView: unknown = fields.authorizationView?.value;
    const scopePosition: unknown = fields.scopePosition?.value;
    if (
      scopeEpoch !== observation.scopeEpoch ||
      authorizationView !== observation.authorizationView ||
      typeof scopeEpoch !== "string" ||
      scopeEpoch.length === 0 ||
      typeof authorizationView !== "string" ||
      authorizationView.length === 0 ||
      typeof scopePosition !== "string" ||
      !/^pos-(0|[1-9][0-9]*)$/.test(scopePosition) ||
      !Number.isSafeInteger(Number(scopePosition.slice(4)))
    )
      throw new Error("invalid Transactional Read context");
    return Object.freeze({ scopeEpoch, authorizationView, scopePosition });
  };
  const current = parse(observation.sourceContext);
  if (observation.snapshotSourceContext === undefined) return Object.freeze({ current });
  const snapshot = parse(observation.snapshotSourceContext);
  if (Number(snapshot.scopePosition.slice(4)) > Number(current.scopePosition.slice(4)))
    throw new Error("Transactional Read snapshot is ahead of its serving entry");
  return Object.freeze({ current, snapshot });
}
