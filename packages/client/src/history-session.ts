import type {
  AbsoluteHttpUrl,
  BeadRecord,
  HistoryVersionsPage,
  LinkRecord,
  ReadDiscovery,
  ReadProblem,
} from "@bdp/protocol";
import {
  ProtocolArtifactValidationError,
  parseCanonicalScope,
  parseHistoricalBeadRecord,
  parseHistoricalLinkRecord,
  parseHistoryVersionsPage,
} from "@bdp/protocol";
import {
  type BdpContinuationScope,
  type ContinuationContext,
  type ContinuationLease,
  ContinuationRegistryCapacityError,
  ContinuationRegistryOwnershipError,
  ContinuationRegistryProtocolError,
  localRefusal,
  ReadSessionBodyInspectionError,
  ReadSessionLocalError,
  ReadSessionRequestError,
  type ReadSessionResult,
  type SessionCore,
} from "./continuations.js";
import {
  ReadResponseValidationError,
  resourceUrl,
  validateBeadSingleton,
  validateLinkSingleton,
} from "./read-record-validation.js";

/** Body-only History operations for a Read-profile client. HTTP cache/navigation
 * metadata, HEAD and History service/provider qualification are separate. */
export type HistoryRequest =
  | {
      readonly kind: "revision";
      readonly resource: "bead" | "link";
      readonly id: AbsoluteHttpUrl;
      readonly revision: string;
    }
  | {
      readonly kind: "versions";
      readonly resource: "bead" | "link";
      readonly id: AbsoluteHttpUrl;
      readonly limit?: number;
      readonly continuation?: AbsoluteHttpUrl;
    };
export type HistoryBodyFor<R extends HistoryRequest> = R extends { readonly kind: "versions" }
  ? HistoryVersionsPage
  : R extends { readonly resource: "bead" }
    ? BeadRecord
    : R extends { readonly resource: "link" }
      ? LinkRecord
      : BeadRecord | LinkRecord;
export type HistoryResultFor<R extends HistoryRequest> = HistoryBodyFor<R> | ReadProblem;

type HistoryContext = Extract<ContinuationContext, { readonly kind: "history-versions" }>;

const capturedRequests = new WeakSet<object>();

/** Capture only primitive own data before any asynchronous discovery. */
export function captureHistoryRequest<R extends HistoryRequest>(value: R): R {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries: Array<[string, unknown]> = [];
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") throw new Error();
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) throw new Error();
      entries.push([key, descriptor.value]);
    }
    const request = Object.fromEntries(entries);
    const fields =
      request.kind === "revision"
        ? ["kind", "resource", "id", "revision"]
        : ["kind", "resource", "id", "limit", "continuation"];
    if (
      Object.keys(request).some((key) => !fields.includes(key)) ||
      (request.kind !== "revision" && request.kind !== "versions") ||
      (request.resource !== "bead" && request.resource !== "link") ||
      typeof request.id !== "string"
    )
      throw new Error();
    if (request.kind === "revision") {
      if (typeof request.revision !== "string" || request.revision.length === 0) throw new Error();
      const query = new URLSearchParams({ revision: request.revision });
      if (query.get("revision") !== request.revision) throw new Error();
    } else {
      if (
        request.limit !== undefined &&
        (typeof request.limit !== "number" ||
          !Number.isSafeInteger(request.limit) ||
          request.limit <= 0)
      )
        throw new Error();
      if (
        request.continuation !== undefined &&
        (typeof request.continuation !== "string" || Object.hasOwn(request, "limit"))
      )
        throw new Error();
    }
    capturedRequests.add(request);
    return Object.freeze(request) as R;
  } catch {
    throw new ReadSessionRequestError("invalid History request or lossless revision token");
  }
}

export interface StagedHistory<R extends HistoryRequest> {
  readonly body: HistoryBodyFor<R>;
}
export interface PreparedHistory<R extends HistoryRequest> {
  route(discovery: ReadDiscovery): ReadSessionResult<AbsoluteHttpUrl>;
  validate(body: unknown): ReadSessionResult<StagedHistory<R>>;
  commit(staged: StagedHistory<R>): ReadSessionResult<HistoryBodyFor<R>>;
  release(): void;
}

function invalidBody<T>(): ReadSessionResult<T> {
  return {
    kind: "refusal",
    refusal: localRefusal(
      "temporarily-unavailable",
      "the server returned a structurally invalid History response",
    ),
  };
}

/** Pure History routing and staging. No current preflight, body cache, inferred
 * default limit or cross-page revision/window inventory is retained. */
export class HistorySession {
  private readonly scope: AbsoluteHttpUrl;
  constructor(
    scope: AbsoluteHttpUrl,
    private readonly core: SessionCore,
  ) {
    this.scope = parseCanonicalScope(scope);
  }

  prepare<R extends HistoryRequest>(request: R, owner?: BdpContinuationScope): PreparedHistory<R> {
    this.core.checkOpen();
    this.core.owner(owner);
    const owned = capturedRequests.has(request) ? request : captureHistoryRequest(request);
    let lease: ContinuationLease | undefined;
    let context: HistoryContext | undefined;
    if (owned.kind === "versions") {
      context = {
        kind: "history-versions",
        resource: owned.resource,
        subject: owned.id,
        limit: owned.limit,
      };
      if (owned.continuation !== undefined) {
        lease = this.core.continuations.reserve(
          owned.continuation,
          owner,
          (candidate) =>
            candidate.kind === "history-versions" &&
            candidate.resource === owned.resource &&
            candidate.subject === owned.id,
        );
        if (lease === undefined)
          throw new ReadSessionRequestError("continuation was not issued for this History subject");
        context = lease.context as HistoryContext;
      }
    }
    // The actual requested URL may include a server-added limit even when the
    // initial caller omitted one. It bounds only this page, not later cursors.
    const requestedLimit =
      owned.kind !== "versions"
        ? undefined
        : owned.continuation !== undefined
          ? (new URL(owned.continuation).searchParams.get("limit") ?? undefined)
          : owned.limit !== undefined
            ? String(owned.limit)
            : undefined;
    const generation = this.core.generation;
    let state: "active" | "staged" | "committed" | "released" = "active";
    let staged: StagedHistory<R> | undefined;
    let next: AbsoluteHttpUrl | null = null;
    const check = () => {
      this.core.checkOpen();
      if (generation !== this.core.generation || state === "released" || state === "committed")
        throw new ReadSessionLocalError(
          "closed",
          "the prepared History operation is no longer active",
        );
    };
    return Object.freeze({
      route: (discovery: ReadDiscovery) => {
        check();
        const id = resourceUrl(this.scope, owned.id, owned.resource);
        if (typeof id !== "string") return { kind: "refusal" as const, refusal: id };
        if (discovery.historicalResolution?.version !== 1)
          return {
            kind: "refusal" as const,
            refusal: localRefusal(
              "invalid-parameter",
              "the Scope does not advertise History version 1",
            ),
          };
        if (owned.kind === "versions" && owned.continuation !== undefined)
          return { kind: "success" as const, value: owned.continuation };
        const url = new URL(id);
        if (owned.kind === "revision") url.searchParams.set("revision", owned.revision);
        else {
          url.searchParams.set("view", "versions");
          if (owned.limit !== undefined) url.searchParams.set("limit", String(owned.limit));
        }
        return { kind: "success" as const, value: url.href };
      },
      validate: (body: unknown) => {
        check();
        if (state !== "active")
          throw new ReadSessionRequestError("History body was already staged");
        let validated: BeadRecord | LinkRecord | HistoryVersionsPage;
        try {
          if (owned.kind === "revision") {
            const expected = { id: owned.id, revision: owned.revision };
            validated =
              owned.resource === "bead"
                ? validateBeadSingleton(
                    parseHistoricalBeadRecord(body, expected),
                    owned.id,
                    this.scope,
                  )
                : validateLinkSingleton(
                    parseHistoricalLinkRecord(body, expected),
                    owned.id,
                    this.scope,
                  );
          } else {
            const page = parseHistoryVersionsPage(body, owned.id);
            // Issued limits are already positive canonical decimal strings.
            // Compare to an array length without Number rounding or BigInt allocation.
            const count = String(page.items.length);
            if (
              requestedLimit !== undefined &&
              (count.length > requestedLimit.length ||
                (count.length === requestedLimit.length && count > requestedLimit))
            )
              throw new ReadResponseValidationError("History page exceeds requested limit");
            if (context?.limit !== undefined) {
              if (
                page.next !== null &&
                new URL(page.next).searchParams.get("limit") !== String(context.limit)
              )
                throw new ReadResponseValidationError("History next changed requested limit");
            }
            validated = page;
            next = page.next;
          }
        } catch (error) {
          if (
            !(error instanceof ProtocolArtifactValidationError) &&
            !(error instanceof ReadResponseValidationError)
          )
            throw new ReadSessionBodyInspectionError(error);
          return invalidBody<StagedHistory<R>>();
        }
        // Protocol inspection may trigger hostile proxy reentrancy.
        check();
        staged = Object.freeze({ body: validated as HistoryBodyFor<R> });
        state = "staged";
        return { kind: "success" as const, value: staged };
      },
      commit: (value: StagedHistory<R>) => {
        check();
        if (state !== "staged" || value !== staged)
          throw new ReadSessionRequestError("History stage does not belong to this operation");
        if (context !== undefined) {
          try {
            this.core.continuations.commit(lease, next, context, owner);
          } catch (error) {
            if (error instanceof ContinuationRegistryOwnershipError)
              throw new ReadSessionRequestError(error.message);
            if (error instanceof ContinuationRegistryCapacityError)
              throw new ReadSessionLocalError(
                "capacity",
                "the BDP client continuation registry is at capacity",
              );
            if (error instanceof ContinuationRegistryProtocolError)
              return invalidBody<HistoryBodyFor<R>>();
            throw error;
          }
        }
        state = "committed";
        return { kind: "success" as const, value: value.body };
      },
      release: () => {
        if (state === "released" || state === "committed") return;
        state = "released";
        staged = undefined;
        if (!this.core.closed && this.core.generation === generation)
          this.core.continuations.restore(lease);
      },
    });
  }
}
