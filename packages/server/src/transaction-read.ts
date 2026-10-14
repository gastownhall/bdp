/** Same-owner private Read composition with source conditions for canonical
 * current point and initial Bead/Link collection reads. The service owns finite
 * waits; continuation minimums, receipt serving and replication Snapshots are
 * separate contracts. */
import {
  checkTransactionMinimum,
  snapshotTransactionMinimum,
  type TransactionMinimum,
} from "./transaction-consistency.js";
import { isProxy } from "node:util/types";
import {
  createAuthorityReadPlane,
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

/** Exact private collection subset shared by the facet and HTTP route gate. */
export function isInitialTransactionCollection(request: ReadRequest): boolean {
  return (
    request.kind === "collection" &&
    (request.collection === "beads" || request.collection === "links") &&
    request.continuation === undefined
  );
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
    scopeConfiguration: { capture: () => configuration.scopeConfiguration },
    selectorLimits: options.selectorLimits,
    pagination: options.pagination,
    advertisedLimits: options.advertisedLimits,
    checkSourceCondition: (condition, observation, refusal) => {
      // Preserve the initial collection's already-materialized request-control
      // Problem. It is not a representation whose minimum can be satisfied.
      if (refusal?.code === "invalid-parameter" || refusal?.code === "limit-exceeded") return;
      // Absence/visibility versus minimum ordering is not yet specified.
      if (refusal?.code === "resource-not-found")
        throw new TransactionMinimumVisibilityGap(
          "minimum-position visibility ordering unqualified",
        );
      checkTransactionMinimum(
        snapshotTransactionMinimum(condition),
        transactionReadContexts(observation).current,
      );
    },
    captureReadAuthorization: () => ({
      kind: "authorized",
      authorization: {
        scopeEpoch: configuration.scopeEpoch,
        authorizationView: configuration.authorizationView,
        policy: { canRead: () => true },
        canReadType: () => true,
      },
    }),
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
        perform: (request, options) =>
          observe(facet.perform(request, options).then((result) => checked(result))),
        resolveAlias: (url, options) =>
          observe(facet.resolveAlias(url, options).then((result) => checked(result))),
      };
    },
  };
  return Object.freeze({
    ...composed,
    minimumFor(
      principal: Parameters<AuthorityReadPlane["readFor"]>[0],
      supplied: TransactionMinimum,
    ): AuthorityReadFacet {
      const minimum = snapshotTransactionMinimum(supplied),
        facet = plane.readFor(principal);
      return Object.freeze({
        perform: (request, options) => {
          if (
            !isInitialTransactionCollection(request) &&
            ((request.kind !== "resource" && request.kind !== "properties") ||
              (request.resource !== "bead" && request.resource !== "link"))
          )
            return Promise.reject(new TypeError("minimum-read route outside supported subset"));
          return observe(
            facet
              .perform(request, { ...options, sourceCondition: minimum })
              .then((result) => checked(result)),
          );
        },
        resolveAlias: () => Promise.reject(new TypeError("minimum-read aliases unsupported")),
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
