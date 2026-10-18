import { TransactionAuthorizationFailure } from "./transaction-authorization.js";
import type { TransactionEventPacket } from "./transaction-store.js";
import type { TransactionSnapshotRequest } from "./transaction-snapshot.js";
import {
  transactionChangefeedRequest,
  TransactionChangefeedParameterError,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";
import {
  transactionEventRequest,
  TransactionEventParameterError,
  TransactionEventProjectionGap,
} from "./transaction-events.js";
import {
  malformedTransactionMinimumHeaders,
  transactionMinimumHeaders,
  currentReadMinimumHeaders,
  TransactionMinimumUnsupported,
  TransactionMinimumFailure,
} from "./transaction-consistency.js";
/** Private Transactional HTTP projection. Discovery is non-attesting; public
 * profile admission and cumulative qualification remain separate. */
import {
  isReadProblem,
  JsonSyntaxError,
  ReadUpdateCarrierError,
  parseCanonicalScope,
  parseReadUpdateProblem,
  prepareReadUpdateSequence,
  readProblem,
  type ReadProblem,
  type ReadProblemCode,
} from "@bdp/protocol";
import { createReadHttpRoute, jsonResponse, scopeDataResponse } from "./read-http-routing.js";
import {
  acceptsJson,
  applyReadHttpSemantics,
  selectChangefeedMedia,
  conditionalReadStatus,
} from "./read-http.js";
import type { HttpResponse } from "./index.js";
import {
  type TransactionSingletonOperation,
  prepareTransactionSequenceForReceiving,
  TransactionDevelopmentLimitError,
  TRANSACTION_RUNTIME_LIMITS,
  TRANSACTION_MAXIMUM_OPERATIONS,
} from "./transaction-batch.js";
import type { createTransactionService } from "./transaction-service.js";
import {
  classifyAliasPath,
  requestFromUrl,
  ScopeServerOperationAbortedError,
} from "./read-request.js";
import {
  TransactionMinimumVisibilityGap,
  transactionReadContexts,
  isCurrentTransactionMinimumRead,
  currentReadMinimumKind,
} from "./transaction-read.js";
import type { TransactionReadContext } from "./transaction-store.js";
import type { TransactionSubmission } from "./transaction-submission.js";

import { TRANSACTION_HTTP_OPERATIONS } from "./transaction-discovery.js";
export type TransactionHttpAuthorization =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "authenticated"; readonly principal: string; readonly canMutate: boolean };
export type TransactionReceivedBody =
  | { readonly text: string }
  | { readonly failure: "request-too-large" | "malformed-request" };
export const TRANSACTION_HTTP_TARGET_BYTES = 8192;
type ChangefeedStream = HttpResponse & {
  readonly kind: "changefeed-stream";
  readonly page: TransactionChangefeedPage;
  readonly context: TransactionReadContext;
};
type EventStream = HttpResponse & {
  readonly kind: "event-stream";
  readonly packet: TransactionEventPacket;
  readonly context: TransactionReadContext;
};
export type TransactionHttpResult =
  | (HttpResponse & { readonly kind: "finite" })
  | ChangefeedStream
  | EventStream;
type Service = ReturnType<typeof createTransactionService>;
function empty(status: number, allow?: string): HttpResponse {
  return {
    status,
    headers: new Headers({
      "cache-control": "private, no-store",
      "content-length": "0",
      ...(allow ? { allow } : {}),
    }),
  };
}
function problem(
  value:
    | ReadProblem
    | ReturnType<typeof parseReadUpdateProblem>
    | {
        readonly type: string;
        readonly code: "catch-up-timeout";
        readonly status: 503;
        readonly retry: "after-delay";
      },
): HttpResponse {
  const response = jsonResponse(value);
  response.headers.set("content-type", "application/problem+json");
  if (value.code === "unauthenticated")
    response.headers.set("www-authenticate", 'Bearer realm="bdp-transaction-development"');
  if (value.retry === "after-delay") response.headers.set("retry-after", "1");
  return { ...response, status: value.status ?? 500 };
}
export function transactionHttpProblem(
  code: ReadProblemCode,
  observation?: TransactionReadContext,
): HttpResponse {
  const response = problem(readProblem(code));
  return observation ? context(response, observation) : response;
}
function context(response: HttpResponse, observation: TransactionReadContext): HttpResponse {
  response.headers.set("bdp-scope-epoch", observation.scopeEpoch);
  response.headers.set("bdp-authorization-view", observation.authorizationView);
  response.headers.set("bdp-scope-position", observation.scopePosition);
  return response;
}
function streamResponse(request: Request, observation: TransactionReadContext): HttpResponse {
  const response = context(
    {
      status: 200,
      headers: new Headers({
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        vary: "Accept",
      }),
    },
    observation,
  );
  const status = conditionalReadStatus(request.headers, null);
  if (status !== 200) {
    response.headers.delete("content-type");
    if (status !== 304) response.headers.set("content-length", "0");
  }
  return { status, headers: response.headers };
}
function developmentGap(feature: string): HttpResponse {
  const response = empty(500);
  response.headers.set("x-bdp-development-limit", feature);
  return response;
}
export function hasMinimumControls(request: Request): boolean {
  return ["bdp-minimum-scope-position", "bdp-scope-epoch", "bdp-authorization-view"].some((field) =>
    request.headers.has(field),
  );
}
function syntax(error: unknown): boolean {
  return error instanceof JsonSyntaxError || error instanceof ReadUpdateCarrierError;
}

export function createTransactionHttpHandler(
  service: Service,
  canonicalScope: string,
  maximumOperations = TRANSACTION_MAXIMUM_OPERATIONS,
) {
  const scope = parseCanonicalScope(canonicalScope),
    scopeUrl = new URL(scope);
  if (scope !== service.scope) throw new TypeError("HTTP Scope differs from transaction owner");
  if (
    !Number.isSafeInteger(maximumOperations) ||
    maximumOperations < 1 ||
    maximumOperations > TRANSACTION_MAXIMUM_OPERATIONS
  )
    throw new TypeError("invalid private transaction receiving limit");
  const targets = Object.freeze(
    Object.fromEntries(
      Object.entries(TRANSACTION_HTTP_OPERATIONS).map(([operation, target]) => [
        operation,
        new URL(`operations/${target}`, scope).href,
      ]),
    ) as Readonly<Record<keyof typeof TRANSACTION_HTTP_OPERATIONS, string>>,
  );
  const names = new Map(Object.entries(targets).map(([name, url]) => [url, name]));
  function receiptResponse(
    observed: {
      readonly receipt: { readonly id: string; readonly status: string };
      readonly context: TransactionReadContext;
    },
    mutation: boolean,
  ): HttpResponse {
    const response = context(jsonResponse(observed.receipt), observed.context);
    if (mutation && observed.receipt.status === "pending") {
      response.headers.set("location", observed.receipt.id);
      response.headers.set("retry-after", "1");
      return { ...response, status: 202 };
    }
    return response;
  }
  const readPrincipals = new WeakMap<
    Request,
    { readonly kind: "authenticated"; readonly principal: { readonly id: string } }
  >();
  const readPrincipal = (request: Request) => {
    const principal = readPrincipals.get(request);
    if (!principal) throw new Error("missing authenticated Read principal");
    return principal;
  };
  const readRoute = createReadHttpRoute({
    scope,
    probe: async () => ({ serviceDescription: new URL("bdp.json", scope).href }),
    problem,
    discover: async () => {
      throw new Error("unreachable Transactional discovery route");
    },
    async alias(suffix, request) {
      if (isReadProblem(suffix)) return problem(suffix);
      const minimum = currentReadMinimumHeaders(request.headers);
      const facet = minimum
        ? service.readAtMinimum(readPrincipal(request), minimum)
        : service.readFor(readPrincipal(request));
      const result = await facet.resolveAlias(request.url, { signal: request.signal });
      const response =
        result.kind === "problem"
          ? problem(result.problem)
          : {
              status: 307,
              headers: new Headers({
                location: result.target,
                "content-length": "0",
                "cache-control": "private, no-store",
              }),
            };
      return "observation" in result
        ? context(response, transactionReadContexts(result.observation).current)
        : response;
    },
    async perform(parsed, request) {
      const minimum = currentReadMinimumHeaders(request.headers);
      const facet = minimum
        ? service.readAtMinimum(readPrincipal(request), minimum)
        : service.readFor(readPrincipal(request));
      const result = await facet.perform(parsed, { signal: request.signal });
      if (result.kind === "discovery") throw new Error("unreachable Transactional discovery route");
      const response =
        result.kind === "problem"
          ? problem(result.problem)
          : scopeDataResponse(
              parsed,
              result.body,
              "resourceRevision" in result.observation
                ? result.observation.resourceRevision
                : undefined,
            );
      return "observation" in result
        ? context(response, transactionReadContexts(result.observation).current)
        : response;
    },
  });
  // Target shape, never receipt existence or authorization, determines Allow.
  // The raw listener also uses this before constructing a Fetch Request, whose
  // method vocabulary excludes TRACE/TRACK/CONNECT.
  function methodResponse(url: URL, method: string): HttpResponse | undefined {
    if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname))
      return transactionHttpProblem("resource-not-found");
    if (names.has(url.href)) return method === "POST" ? undefined : empty(405, "POST");
    // Operation targets use exact canonical URLs. A missing target, alternate
    // encoded spelling, or query-bearing command URL is not a Read resource.
    if (
      url.pathname.startsWith(`${scopeUrl.pathname}operations/`) &&
      url.href !== new URL("operations/", scope).href
    )
      return transactionHttpProblem("resource-not-found");
    return method === "GET" || method === "HEAD" ? undefined : empty(405, "GET, HEAD");
  }
  async function route(
    request: Request,
    authorization: TransactionHttpAuthorization,
    received: TransactionReceivedBody,
    lastEventIds?: readonly string[],
  ): Promise<HttpResponse | ChangefeedStream | EventStream> {
    const url = new URL(request.url),
      operation = names.get(url.href);
    if (
      request.method === "POST" &&
      Buffer.byteLength(url.pathname + url.search) > TRANSACTION_HTTP_TARGET_BYTES
    )
      return transactionHttpProblem("request-too-large");
    const methodFailure = methodResponse(url, request.method);
    if (methodFailure) return methodFailure;
    if (operation !== undefined) {
      if ("failure" in received && received.failure === "request-too-large")
        return transactionHttpProblem(received.failure);
      if (
        "text" in received &&
        Buffer.byteLength(received.text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes
      )
        return transactionHttpProblem("request-too-large");
      if (
        request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json" ||
        request.headers.has("content-encoding")
      )
        return problem(
          parseReadUpdateProblem({
            type: "https://github.com/gastownhall/bdp/problems/request",
            code: "unsupported-media-type",
            status: 415,
            retry: "never",
          }),
        );
      if ("failure" in received) return transactionHttpProblem(received.failure);
      if (operation === "sequence") {
        if (request.headers.has("idempotency-key"))
          return transactionHttpProblem("malformed-request");
        let carrier: ReturnType<typeof prepareReadUpdateSequence>;
        try {
          carrier = prepareReadUpdateSequence(scope, received.text);
        } catch (error) {
          if (syntax(error)) return transactionHttpProblem("malformed-request");
          throw error;
        }
        if (authorization.kind === "unauthenticated")
          return transactionHttpProblem("unauthenticated");
        if (!authorization.canMutate) return transactionHttpProblem("forbidden");
        if (carrier.operations.length > TRANSACTION_MAXIMUM_OPERATIONS) {
          const observed = await service.sequenceRefusalObserved();
          return context(
            problem({ ...readProblem("limit-exceeded"), limit: "sequence.operations" }),
            observed.context,
          );
        }
        const prepared = prepareTransactionSequenceForReceiving(scope, received.text);
        if (!acceptsJson(request.headers.get("accept"))) {
          const observed = await service.sequenceRefusalObserved();
          return context(empty(406), observed.context);
        }
        try {
          const observed = await service.sequenceObserved(authorization.principal, prepared);
          return context(jsonResponse(observed.body), observed.context);
        } catch (error) {
          if (error instanceof TransactionDevelopmentLimitError)
            return developmentGap("unsupported-transaction-composition");
          throw error;
        }
      }
      const decision: TransactionSubmission["authorization"] =
        authorization.kind === "unauthenticated"
          ? authorization
          : authorization.canMutate
            ? { kind: "authorized", principal: authorization.principal }
            : { kind: "forbidden" };
      const result = await service.submit({
        carrier:
          operation === "batch"
            ? { kind: "batch" }
            : { kind: "singleton", operation: operation as TransactionSingletonOperation },
        body: received.text,
        key: request.headers.get("idempotency-key") ?? "",
        authorization: decision,
        receiving: { acceptsJson: acceptsJson(request.headers.get("accept")), maximumOperations },
      });
      if (result.kind === "receipt") return receiptResponse(result, true);
      if (result.kind === "comparison-refusal") {
        const response = problem(readProblem(result.code));
        if (result.reason === "owner-stopped") return response;
        if (!result.context) throw new Error("comparison deadline lost same-entry context");
        return context(response, result.context);
      }
      if (result.kind === "not-acceptable") {
        if (!result.context) throw new Error("negotiation refusal lost same-entry context");
        return context(empty(406), result.context);
      }
      if (result.code === "idempotency-conflict") {
        if (!result.context) throw new Error("conflict refusal lost same-entry context");
        return context(
          problem(
            parseReadUpdateProblem({
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              code: result.code,
              status: 409,
              retry: "never",
            }),
          ),
          result.context,
        );
      }
      if (result.code === "limit-exceeded" && result.limit !== undefined) {
        if (!result.context) throw new Error("operation-limit refusal lost same-entry context");
        return context(
          problem({
            ...readProblem(result.code),
            limit: result.limit,
            ...(result.pointer ? { pointer: result.pointer } : {}),
          }),
          result.context,
        );
      }
      return problem({
        ...readProblem(result.code),
        ...(result.limit ? { limit: result.limit } : {}),
        ...(result.pointer ? { pointer: result.pointer } : {}),
      });
    }
    if (authorization.kind === "unauthenticated") return transactionHttpProblem("unauthenticated");
    if (malformedTransactionMinimumHeaders(request.headers))
      return transactionHttpProblem("malformed-request");
    if (url.pathname === new URL("snapshot", scope).pathname) {
      const fields = [...url.searchParams.keys()];
      const id = url.searchParams.get("snapshot"),
        stream = url.searchParams.get("stream"),
        token = url.searchParams.get("page");
      let target: TransactionSnapshotRequest;
      // These closed query shapes are local route conventions. Unknown well-
      // shaped identities go to the owner; they are never guessed as expired.
      if (new Set(fields).size !== fields.length)
        return transactionHttpProblem("invalid-parameter");
      if (fields.length === 0) target = { kind: "create" };
      else if (fields.length === 1 && id !== null && id !== "") target = { kind: "manifest", id };
      else if (fields.length === 3 && id && token && (stream === "beads" || stream === "links"))
        target = { kind: "page", id, token, stream: stream === "beads" ? "bead" : "link" };
      else return transactionHttpProblem("invalid-parameter");
      // Only fresh creation has an unambiguous current observation. Retained
      // anchors and unsupported tuple shapes keep their explicit private gap.
      const minimum = hasMinimumControls(request)
        ? currentReadMinimumHeaders(request.headers)
        : undefined;
      if (hasMinimumControls(request) && (target.kind !== "create" || minimum === undefined))
        return developmentGap("minimum-position");
      function snapshotResponse(result: Awaited<ReturnType<Service["snapshot"]>>): HttpResponse {
        if (result.kind === "problem") {
          const response = context(transactionHttpProblem(result.code), result.context);
          if (result.retryAfter !== undefined)
            response.headers.set("retry-after", String(result.retryAfter));
          return response;
        }
        if (result.kind === "eligible")
          return context(
            {
              status: 200,
              headers: new Headers({
                "content-type": "application/json",
                "cache-control": "private, no-store",
              }),
            },
            result.context,
          );
        return context(jsonResponse(result.body), result.context);
      }
      if (target.kind === "create") {
        // A pure successful-JSON candidate may select direct capture, but never
        // authorizes an owner-free response. Nonallocating decisions still need
        // authoritative capacity/integrity checks and same-entry context.
        const candidate = applyReadHttpSemantics(request, {
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
        });
        if (request.method === "HEAD" || candidate.status !== 200) {
          const eligible = snapshotResponse(
            await service.snapshot({ kind: "preflight" }, minimum, request.signal),
          );
          // Candidate and eligible share successful JSON with no validator;
          // their media/conditional decisions agree. This branch is terminal:
          // never start a second capture or renew the minimum wait deadline.
          return applyReadHttpSemantics(request, eligible);
        }
      }
      return snapshotResponse(await service.snapshot(target, minimum, request.signal));
    }
    const changefeed = transactionChangefeedRequest(url, scope);
    if (changefeed) {
      const media = selectChangefeedMedia(request.headers.get("accept"));
      // URL grammar is always required. Only selected SSE consults the raw
      // reconnect field; JSON ignores it, including repeated/malformed values.
      const fields =
        lastEventIds ??
        (request.headers.has("last-event-id") ? [request.headers.get("last-event-id")!] : []);
      if (media === "sse" && fields.length > 1)
        throw new TransactionChangefeedParameterError("repeated Last-Event-ID");
      const effective = media === "sse" && fields.length === 1 ? { after: fields[0]! } : changefeed;
      // Canonical current changefeed admission preserves one lexical minimum
      // across finite/reconnect attempts, before ordinary media negotiation.
      const minimum = hasMinimumControls(request)
        ? (currentReadMinimumHeaders(request.headers) ?? "unsupported")
        : undefined;
      const observed = await service.changes(
        effective,
        minimum,
        request.signal,
        "current-changefeed",
      );
      if (observed.kind === "unsupported") return developmentGap("minimum-position");
      if (media !== "sse") return context(jsonResponse(observed.page), observed.context);
      const response = streamResponse(request, observed.context);
      return response.status !== 200 || request.method === "HEAD"
        ? response
        : {
            ...response,
            kind: "changefeed-stream",
            page: observed.page,
            context: observed.context,
          };
    }
    // Alias query refusals and receipt identity checks own these routes, even
    // when a query happens to spell view=events. Do not reclassify them as Events.
    const alias = classifyAliasPath(url, scope);
    if (alias !== undefined && typeof alias !== "string") return problem(alias);
    const receiptRoute =
      url.pathname.startsWith(`${scopeUrl.pathname}receipts/`) ||
      url.pathname === `${scopeUrl.pathname}receipts`;
    const eventRequest = receiptRoute ? undefined : transactionEventRequest(url, scope);
    if (eventRequest) {
      const media = selectChangefeedMedia(request.headers.get("accept"));
      const fields =
        lastEventIds ??
        (request.headers.has("last-event-id") ? [request.headers.get("last-event-id")!] : []);
      const minimum = hasMinimumControls(request)
        ? (currentReadMinimumHeaders(request.headers) ?? "unsupported")
        : undefined;
      if (media !== "sse") {
        const observed = await service.events(
          eventRequest.source.url,
          eventRequest.after,
          minimum,
          request.signal,
        );
        if (observed.kind === "missing")
          return transactionHttpProblem("resource-not-found", observed.context);
        if (observed.kind === "unsupported") return developmentGap("minimum-position");
        return context(jsonResponse(observed.page), observed.context);
      }
      const observed = await service.beginEvents(
        eventRequest.source.url,
        fields.length === 1 ? fields[0] : eventRequest.after,
        minimum,
        request.signal,
        fields.length > 1,
        "current-event",
      );
      if (observed.kind === "missing")
        return transactionHttpProblem("resource-not-found", observed.context);
      if (observed.kind === "unsupported") return developmentGap("minimum-position");
      const response = streamResponse(request, observed.context);
      return response.status !== 200 || request.method === "HEAD"
        ? response
        : { ...response, kind: "event-stream", packet: observed, context: observed.context };
    }
    if (receiptRoute) {
      const access = { kind: "authenticated" as const, principal: authorization.principal };
      if (url.pathname.slice(`${scopeUrl.pathname}receipts/`.length).includes("/pages/")) {
        const minimum = hasMinimumControls(request)
          ? currentReadMinimumHeaders(request.headers)
          : undefined;
        const page = await service.receiptPage(
          access,
          url.href,
          minimum ?? (hasMinimumControls(request) ? "unsupported" : undefined),
        );
        if (page.kind === "refused")
          return transactionHttpProblem(
            page.code,
            page.code === "resource-not-found" ? page.context : undefined,
          );
        if (page.kind === "unsupported") return developmentGap("minimum-position");
        return context(
          page.kind === "expired"
            ? transactionHttpProblem("cursor-expired")
            : jsonResponse(page.page),
          page.context,
        );
      }
      const minimum = hasMinimumControls(request)
        ? currentReadMinimumHeaders(request.headers)
        : undefined;
      const result = hasMinimumControls(request)
        ? await service.receiptAtMinimum(access, url.href, minimum ?? "unsupported")
        : service.receipt(access, url.href);
      if (result.kind === "refused")
        return transactionHttpProblem(
          result.code,
          result.code === "resource-not-found" ? result.context : undefined,
        );
      // Missing barrier support cannot disclose a foreign receipt, nor permit a
      // conditional shortcut to serve an unchecked minimum checkpoint.
      if (result.kind === "unsupported") return developmentGap("minimum-position");
      return receiptResponse(result, false);
    }
    // Specialised Snapshot/changefeed/Event/receipt lifetimes above retain their
    // own receiving and minimum rules. Discovery is one current observation.
    const scopeProbe = url.pathname === scopeUrl.pathname;
    const descriptor = url.href === new URL("bdp.json", scope).href;
    const directory = url.href === new URL("operations/", scope).href;
    if (scopeProbe || descriptor || directory) {
      const supplied = hasMinimumControls(request);
      const minimum = supplied ? currentReadMinimumHeaders(request.headers) : undefined;
      if (supplied && minimum === undefined)
        throw new Error("lexically valid discovery minimum lost its tuple");
      const observed = await service.discoveryObserved(minimum, request.signal);
      return context(
        scopeProbe
          ? {
              status: 204,
              headers: new Headers({
                link: `<${new URL("bdp.json", scope).href}>; rel="service-desc"; type="application/json"`,
                "cache-control": "private, no-store",
              }),
            }
          : jsonResponse(descriptor ? observed.discovery : observed.directory),
        observed.context,
      );
    }
    const minimum = hasMinimumControls(request)
      ? currentReadMinimumHeaders(request.headers)
      : undefined;
    if (hasMinimumControls(request) && !minimum) return developmentGap("minimum-position");
    if (minimum && alias === undefined) {
      // Aliases have their own conditioned authority path, not a canonical
      // ReadRequest or a member of the current Resource/collection subset.
      const parsed = requestFromUrl(url, scope);
      if (isReadProblem(parsed) && parsed.status === 400) return problem(parsed);
      // Preserve the early unknown-token label on excluded valid routes and parser 404s.
      if (
        !transactionMinimumHeaders(request.headers) &&
        (isReadProblem(parsed) || currentReadMinimumKind(parsed) === "strict")
      )
        return developmentGap("minimum-position");
      if (isReadProblem(parsed) || !isCurrentTransactionMinimumRead(parsed, scope))
        return developmentGap("minimum-position-route");
    }
    return readRoute(request);
  }
  return Object.freeze({
    targets,
    methodResponse,
    async handle(
      request: Request,
      authorization: TransactionHttpAuthorization,
      received: TransactionReceivedBody = { text: "" },
      lastEventIds?: readonly string[],
    ): Promise<TransactionHttpResult> {
      let response: HttpResponse | ChangefeedStream | EventStream;
      try {
        if (authorization.kind === "authenticated")
          readPrincipals.set(
            request,
            Object.freeze({
              kind: "authenticated",
              principal: Object.freeze({ id: authorization.principal }),
            }),
          );
        response = await route(request, authorization, received, lastEventIds);
      } catch (error) {
        if (error instanceof ScopeServerOperationAbortedError) throw error;
        if (error instanceof TransactionMinimumFailure && error.reason !== "behind") {
          response = context(
            problem(
              error.reason === "catch-up-timeout"
                ? {
                    ...readProblem("temporarily-unavailable"),
                    code: "catch-up-timeout",
                    status: 503,
                    retry: "after-delay",
                  }
                : readProblem(error.reason),
            ),
            error.context,
          );
        } else if (error instanceof TransactionAuthorizationFailure)
          response = transactionHttpProblem(error.code, error.context);
        else if (
          error instanceof TransactionEventParameterError ||
          error instanceof TransactionChangefeedParameterError
        )
          response = transactionHttpProblem("invalid-parameter", error.context);
        else if (error instanceof TransactionEventProjectionGap)
          response = developmentGap(error.message);
        else if (error instanceof TransactionMinimumUnsupported)
          response = developmentGap("minimum-position");
        else if (error instanceof TransactionMinimumVisibilityGap)
          response = developmentGap("minimum-position-visibility");
        else response = empty(500);
      } finally {
        readPrincipals.delete(request);
      }
      response.headers.set("x-bdp-development", "non-attesting");
      if (request.method === "POST") response.headers.set("vary", "Accept");
      if (
        "kind" in response &&
        (response.kind === "changefeed-stream" || response.kind === "event-stream")
      )
        return response;
      return {
        ...(request.method === "GET" || request.method === "HEAD"
          ? applyReadHttpSemantics(request, response)
          : response),
        kind: "finite",
      };
    },
  });
}
