/** Source-private partial Transactional HTTP projection. No discovery/profile
 * advertisement: required sets, replication and consistency barriers are absent. */
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
  type ReadUpdateOperation,
} from "@bdp/protocol";
import { createReadHttpRoute, jsonResponse, scopeDataResponse } from "./read-http-routing.js";
import { acceptsJson, applyReadHttpSemantics } from "./read-http.js";
import type { HttpResponse } from "./index.js";
import {
  prepareTransactionSequence,
  TransactionDevelopmentLimitError,
  TRANSACTION_RUNTIME_LIMITS,
} from "./transaction-batch.js";
import type { createTransactionService } from "./transaction-service.js";
import { transactionReadContexts } from "./transaction-read.js";
import type { TransactionReadContext } from "./transaction-store.js";
import type { TransactionSubmission } from "./transaction-submission.js";

export const TRANSACTION_HTTP_OPERATIONS = Object.freeze({
  createBead: "create-bead",
  updateBead: "update-bead",
  deleteBead: "delete-bead",
  createLink: "create-link",
  updateLink: "update-link",
  deleteLink: "delete-link",
  putAlias: "put-alias",
  deleteAlias: "delete-alias",
  batch: "batch",
  sequence: "sequence",
} as const);
export type TransactionHttpAuthorization =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "authenticated"; readonly principal: string; readonly canMutate: boolean };
export type TransactionReceivedBody =
  | { readonly text: string }
  | { readonly failure: "request-too-large" | "malformed-request" };
export const TRANSACTION_HTTP_TARGET_BYTES = 8192;
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
function problem(value: ReadProblem | ReturnType<typeof parseReadUpdateProblem>): HttpResponse {
  const response = jsonResponse(value);
  response.headers.set("content-type", "application/problem+json");
  if (value.code === "unauthenticated")
    response.headers.set("www-authenticate", 'Bearer realm="bdp-transaction-development"');
  if (value.retry === "after-delay") response.headers.set("retry-after", "1");
  return { ...response, status: value.status ?? 500 };
}
export function transactionHttpProblem(code: ReadProblemCode): HttpResponse {
  return problem(readProblem(code));
}
function context(response: HttpResponse, observation: TransactionReadContext): HttpResponse {
  response.headers.set("bdp-scope-epoch", observation.scopeEpoch);
  response.headers.set("bdp-authorization-view", observation.authorizationView);
  response.headers.set("bdp-scope-position", observation.scopePosition);
  return response;
}
function unavailable(feature: string): HttpResponse {
  const response = transactionHttpProblem("temporarily-unavailable");
  response.headers.set("x-bdp-development-limit", feature);
  return response;
}
function hasMinimumControls(request: Request): boolean {
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
  maximumOperations = 32,
) {
  const scope = parseCanonicalScope(canonicalScope),
    scopeUrl = new URL(scope);
  if (!Number.isSafeInteger(maximumOperations) || maximumOperations < 1 || maximumOperations > 32)
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
  const readRoute = createReadHttpRoute({
    scope,
    probe: async () => ({ serviceDescription: new URL("bdp.json", scope).href }),
    problem,
    discover: async () => unavailable("transactional-discovery"),
    async alias(suffix, request) {
      if (isReadProblem(suffix)) return problem(suffix);
      const result = await service.readFor({ kind: "anonymous" }).resolveAlias(request.url);
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
    async perform(parsed) {
      const result = await service.readFor({ kind: "anonymous" }).perform(parsed);
      const response =
        result.kind === "problem"
          ? problem(result.problem)
          : result.kind === "discovery"
            ? unavailable("transactional-discovery")
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
  async function route(
    request: Request,
    authorization: TransactionHttpAuthorization,
    received: TransactionReceivedBody,
  ): Promise<HttpResponse> {
    const url = new URL(request.url),
      operation = names.get(url.href);
    if (Buffer.byteLength(url.pathname + url.search) > TRANSACTION_HTTP_TARGET_BYTES)
      return transactionHttpProblem("request-too-large");
    if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname))
      return transactionHttpProblem("resource-not-found");
    if (operation !== undefined) {
      if (request.method !== "POST") return empty(405, "POST");
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
        if (carrier.operations.length > 32)
          return problem({ ...readProblem("limit-exceeded"), limit: "sequence.operations" });
        let prepared: ReturnType<typeof prepareTransactionSequence>;
        try {
          prepared = prepareTransactionSequence(scope, received.text);
        } catch (error) {
          if (
            error instanceof TransactionDevelopmentLimitError ||
            (error instanceof TypeError &&
              error.message ===
                "development sequence Resource aliases require turn-time resolution")
          )
            return unavailable("sequence-resource-alias");
          throw error;
        }
        if (!acceptsJson(request.headers.get("accept"))) return empty(406);
        const observed = await service.sequenceObserved(authorization.principal, prepared);
        return context(jsonResponse(observed.body), observed.context);
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
            : { kind: "singleton", operation: operation as ReadUpdateOperation },
        body: received.text,
        key: request.headers.get("idempotency-key") ?? "",
        authorization: decision,
        receiving: { acceptsJson: acceptsJson(request.headers.get("accept")), maximumOperations },
      });
      if (result.kind === "receipt") return receiptResponse(result, true);
      if (result.kind === "not-acceptable") return empty(406);
      if (result.kind === "development-limit")
        return unavailable("unsupported-transaction-composition");
      if (result.code === "idempotency-conflict")
        return problem(
          parseReadUpdateProblem({
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            code: result.code,
            status: 409,
            retry: "never",
          }),
        );
      return problem({
        ...readProblem(result.code),
        ...(result.limit ? { limit: result.limit } : {}),
      });
    }
    if (authorization.kind === "unauthenticated") return transactionHttpProblem("unauthenticated");
    if (request.method !== "GET" && request.method !== "HEAD") return empty(405, "GET, HEAD");
    if (
      url.pathname.startsWith(`${scopeUrl.pathname}receipts/`) ||
      url.pathname === `${scopeUrl.pathname}receipts`
    ) {
      const result = service.receipt(
        { kind: "authenticated", principal: authorization.principal },
        url.href,
      );
      if (result.kind === "refused") return transactionHttpProblem(result.code);
      // Missing barrier support cannot disclose a foreign receipt, nor permit a
      // conditional shortcut to serve an unchecked minimum checkpoint.
      if (hasMinimumControls(request)) return unavailable("minimum-position");
      return receiptResponse(result, false);
    }
    if (hasMinimumControls(request)) return unavailable("minimum-position");
    // No fabricated discovery or incomplete Operation Directory is exposed. The
    // source fixture gives tests actual canonical targets out of band.
    if (
      url.pathname === scopeUrl.pathname ||
      url.href === new URL("bdp.json", scope).href ||
      url.href === new URL("operations/", scope).href
    )
      return unavailable("transactional-discovery");
    return readRoute(request);
  }
  return Object.freeze({
    targets,
    async handle(
      request: Request,
      authorization: TransactionHttpAuthorization,
      received: TransactionReceivedBody = { text: "" },
    ): Promise<HttpResponse> {
      let response: HttpResponse;
      try {
        response = await route(request, authorization, received);
      } catch {
        response = empty(500);
      }
      response.headers.set("x-bdp-development", "non-attesting");
      if (request.method === "POST") response.headers.set("vary", "Accept");
      return request.method === "GET" || request.method === "HEAD"
        ? applyReadHttpSemantics(request, response)
        : response;
    },
  });
}
