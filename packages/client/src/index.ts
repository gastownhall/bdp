import {
  type BdpContinuationScope,
  captureReadRequest,
  isWithinScope,
  ReadSession,
  ReadSessionLocalError,
} from "./read-session.js";

export type { BdpContinuationScope } from "./read-session.js";

import type {
  AbsoluteHttpUrl,
  ReadDiscovery,
  ReadProblem,
  ReadRequest,
  ReadResultFor,
  ScopeProbe,
} from "@bdp/protocol";
import {
  ProtocolArtifactValidationError,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseCanonicalTypeId,
  parseLinkHeader,
  parseReadDiscovery,
  parseReadProblem,
  readProblem,
  readProblemDefinitionFor,
} from "@bdp/protocol";

/** Identifies the reusable BDP client package. */
export const packageName = "@bdp/client";

const DEFAULT_MAXIMUM_RESPONSE_BODY_BYTES = 1_048_576;
const DEFAULT_MAXIMUM_JSON_DEPTH = 128;
const DEFAULT_MAXIMUM_JSON_NODES = 100_000;
const DEFAULT_MAXIMUM_JSON_CONTAINER_ENTRIES = 100_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSPORT_SETTLEMENT_TIMEOUT_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface BdpTransport {
  perform<Body>(
    url: AbsoluteHttpUrl,
    options: { readonly scope: AbsoluteHttpUrl; readonly signal: AbortSignal },
  ): Promise<BdpTransportResult<Body>>;
  discover(
    scope: AbsoluteHttpUrl,
    options: { readonly signal: AbortSignal },
  ): Promise<BdpTransportResult<ScopeProbe>>;
}

export type BdpTransportResult<Body> =
  | { readonly kind: "success"; readonly body: Body }
  | { readonly kind: "problem"; readonly problem: unknown; readonly httpStatus?: number };

export interface FetchTransportOptions {
  readonly maximumResponseBodyBytes?: number;
  readonly maximumJsonDepth?: number;
  readonly maximumJsonNodes?: number;
  readonly maximumJsonContainerEntries?: number;
  readonly responseTimeoutMs?: number;
}

export function createFetchTransport(
  fetchImplementation: typeof fetch = fetch,
  options: FetchTransportOptions = {},
): BdpTransport {
  const limits = responseLimits(options);
  return {
    async discover(scope, options) {
      const deadline = deadlineSignal(limits.responseTimeoutMs);
      const signal = AbortSignal.any([options.signal, deadline.signal]);
      try {
        let response: Response;
        try {
          response = await fetchWithSignal(
            fetchImplementation,
            scope,
            { credentials: "omit", signal, redirect: "manual" },
            signal,
            limits.responseTimeoutMs,
          );
        } catch (error) {
          if (options.signal.aborted) throw error;
          if (deadline.signal.aborted)
            return problemResult(
              readProblem("temporarily-unavailable", "scope discovery timed out"),
            );
          return problemResult(
            readProblem("temporarily-unavailable", "scope discovery transport failed"),
          );
        }
        if (!sameCanonicalUrl(scope, response.url)) {
          const problem = responseUrlProblem(scope, response.url, "scope discovery");
          await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
          return problemResult(problem);
        }
        if (isRedirect(response.status)) {
          const problem = redirectProblem(scope, scope, response, "scope discovery");
          await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
          return problemResult(problem);
        }
        if (response.status !== 200 && response.status !== 204) {
          let body: unknown;
          try {
            body = await readBoundedJson(response, limits, signal);
          } catch (error) {
            if (options.signal.aborted) throw error;
            if (deadline.signal.aborted)
              throw new ResponseProtocolError(
                `scope discovery returned HTTP ${response.status} with an unreadable BDP Problem`,
              );
            if (error instanceof ResponseBodyEmptyError && response.status === 500)
              throw new ResponseProtocolError(
                "scope discovery returned a body-less internal fault without a BDP Problem",
              );
            if (error instanceof ResponseMediaTypeError) {
              await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
              throw new ResponseProtocolError(
                `scope discovery returned HTTP ${response.status} without a BDP Problem`,
              );
            }
            if (!isResponseBodyError(error)) throw error;
            throw new ResponseProtocolError(
              `scope discovery returned HTTP ${response.status} with an unreadable BDP Problem`,
            );
          }
          return validatedHttpProblem(body, response.status, "scope discovery");
        }
        const link = response.headers.get("link") ?? "";
        const serviceDescription = serviceDescriptionTarget(link);
        await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
        if (serviceDescription === undefined) {
          return problemResult(
            readProblem(
              "temporarily-unavailable",
              "scope discovery returned no service-desc Link relation",
            ),
          );
        }
        if (
          serviceDescription.length === 0 ||
          [...serviceDescription].some((character) => {
            const code = character.charCodeAt(0);
            return code <= 0x20 || code === 0x7f;
          })
        ) {
          return problemResult(
            readProblem(
              "temporarily-unavailable",
              "Scope discovery returned an invalid service-desc target",
            ),
          );
        }
        let resolvedServiceDescription: string;
        try {
          resolvedServiceDescription = new URL(serviceDescription, scope).href;
        } catch {
          return problemResult(
            readProblem(
              "temporarily-unavailable",
              "Scope discovery returned an invalid service-desc target",
            ),
          );
        }
        try {
          return {
            kind: "success",
            body: {
              serviceDescription: parseCanonicalHttpUrl(resolvedServiceDescription),
            },
          };
        } catch (error) {
          if (error instanceof ProtocolArtifactValidationError)
            return problemResult(readProblem("temporarily-unavailable", error.message));
          throw error;
        }
      } finally {
        deadline.clear();
      }
    },
    async perform<Body>(
      url: AbsoluteHttpUrl,
      options: { readonly scope: AbsoluteHttpUrl; readonly signal: AbortSignal },
    ) {
      const deadline = deadlineSignal(limits.responseTimeoutMs);
      const signal = AbortSignal.any([options.signal, deadline.signal]);
      try {
        let response: Response;
        try {
          response = await fetchWithSignal(
            fetchImplementation,
            url,
            {
              headers: { accept: "application/json" },
              signal,
              redirect: "manual",
              credentials: "omit",
            },
            signal,
            limits.responseTimeoutMs,
          );
        } catch (error) {
          if (options.signal.aborted) throw error;
          if (deadline.signal.aborted)
            return problemResult(
              readProblem("temporarily-unavailable", "the server response timed out"),
            );
          return problemResult(
            readProblem(
              "temporarily-unavailable",
              "the transport failed before a response was received",
            ),
          );
        }
        if (!sameCanonicalUrl(url, response.url)) {
          const problem = responseUrlProblem(options.scope, response.url, "the response");
          await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
          return problemResult(problem);
        }
        if (isRedirect(response.status)) {
          const problem = redirectProblem(options.scope, url, response, "the response");
          await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
          return problemResult(problem);
        }
        if (response.ok && response.status !== 200) {
          await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
          throw new ResponseProtocolError(
            `the server returned unexpected success status ${response.status}`,
          );
        }
        let body: unknown;
        try {
          body = await readBoundedJson(response, limits, signal);
        } catch (error) {
          if (options.signal.aborted) throw error;
          if (deadline.signal.aborted) {
            if (!response.ok)
              throw new ResponseProtocolError(
                `the server returned HTTP ${response.status} with an unreadable BDP Problem`,
              );
            return problemResult(
              readProblem("temporarily-unavailable", "the server response timed out"),
            );
          }
          if (error instanceof ResponseBodyEmptyError && response.status === 500)
            throw new ResponseProtocolError(
              "the server returned a body-less internal fault without a BDP Problem",
            );
          if (error instanceof ResponseBodyLimitError) {
            if (!response.ok)
              throw new ResponseProtocolError(
                `the server returned HTTP ${response.status} with an unreadable BDP Problem`,
              );
            return problemResult(readProblem("temporarily-unavailable", error.message));
          }
          if (error instanceof ResponseMediaTypeError) {
            await cancelResponseBodyBounded(response, limits.responseTimeoutMs);
            if (!response.ok)
              throw new ResponseProtocolError(
                `the server returned HTTP ${response.status} without a BDP Problem`,
              );
            return problemResult(readProblem("temporarily-unavailable", error.message));
          }
          if (!isResponseBodyError(error)) throw error;
          if (!response.ok)
            throw new ResponseProtocolError(
              `the server returned HTTP ${response.status} with an unreadable BDP Problem`,
            );
          return problemResult(
            readProblem("temporarily-unavailable", "the server returned a malformed JSON response"),
          );
        }
        if (!response.ok) {
          return validatedHttpProblem(body, response.status, "the server");
        }
        return { kind: "success", body: body as Body };
      } finally {
        deadline.clear();
      }
    },
  };
}

interface ResponseLimits {
  readonly maximumResponseBodyBytes: number;
  readonly maximumJsonDepth: number;
  readonly maximumJsonNodes: number;
  readonly maximumJsonContainerEntries: number;
  readonly responseTimeoutMs: number;
}

class ResponseBodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseBodyLimitError";
  }
}

class ResponseMediaTypeError extends Error {
  override readonly name = "ResponseMediaTypeError";
}

class ResponseProtocolError extends Error {
  override readonly name = "ResponseProtocolError";
}

class ResponseBodyEmptyError extends Error {
  override readonly name = "ResponseBodyEmptyError";
}

class ResponseBodyFormatError extends Error {
  override readonly name = "ResponseBodyFormatError";
}

class ResponseBodyReadError extends Error {
  override readonly name = "ResponseBodyReadError";
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function problemResult(problem: ReadProblem, httpStatus?: number): BdpTransportResult<never> {
  return { kind: "problem", problem, ...(httpStatus === undefined ? {} : { httpStatus }) };
}

function snapshotTransportResult<Body>(value: unknown): BdpTransportResult<Body> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("transport returned a result that is not an object");
  const candidate = value as Record<string, unknown>;
  if (!Object.hasOwn(candidate, "kind"))
    throw new TypeError("transport returned a result without a discriminant");
  const kind = candidate.kind;
  if (kind === "success") {
    if (
      Reflect.ownKeys(candidate).some((key) => key !== "kind" && key !== "body") ||
      !Object.hasOwn(candidate, "body")
    )
      throw new TypeError("transport returned success without a body");
    return Object.freeze({ kind, body: candidate.body as Body });
  }
  if (kind !== "problem") throw new TypeError("transport returned an invalid result kind");
  if (
    Reflect.ownKeys(candidate).some(
      (key) => key !== "kind" && key !== "problem" && key !== "httpStatus",
    ) ||
    !Object.hasOwn(candidate, "problem")
  )
    throw new TypeError("transport returned a Problem result without a Problem");
  const httpStatus = Object.hasOwn(candidate, "httpStatus") ? candidate.httpStatus : undefined;
  if (
    httpStatus !== undefined &&
    (!Number.isSafeInteger(httpStatus) ||
      (httpStatus as number) < 100 ||
      (httpStatus as number) > 599)
  )
    throw new TypeError("transport returned an invalid HTTP status");
  return Object.freeze({
    kind,
    problem: candidate.problem,
    ...(httpStatus === undefined ? {} : { httpStatus: httpStatus as number }),
  });
}

function snapshotScopeProbe(value: unknown): ScopeProbe {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("transport returned an invalid Scope probe body");
  const candidate = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(candidate).some((key) => key !== "serviceDescription") ||
    !Object.hasOwn(candidate, "serviceDescription")
  )
    throw new TypeError("transport returned an invalid Scope probe body");
  const serviceDescription = candidate.serviceDescription;
  if (typeof serviceDescription !== "string")
    throw new TypeError("transport returned an invalid Scope probe body");
  return Object.freeze({ serviceDescription: serviceDescription as AbsoluteHttpUrl });
}

function validatedHttpProblem(
  body: unknown,
  httpStatus: number,
  source: string,
): BdpTransportResult<never> {
  try {
    const problem = parseReadProblem(body);
    if (readProblemDefinitionFor(problem.code).status !== httpStatus)
      throw new ResponseProtocolError(`${source} returned an incoherent Problem response`);
    return problemResult(problem, httpStatus);
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ResponseProtocolError(`${source} returned an invalid Problem response`);
    throw error;
  }
}

function validatedTransportProblem(
  result: Extract<BdpTransportResult<unknown>, { readonly kind: "problem" }>,
): ReadProblem {
  try {
    const problem = parseReadProblem(result.problem);
    if (
      result.httpStatus !== undefined &&
      readProblemDefinitionFor(problem.code).status !== result.httpStatus
    )
      throw new BdpClientTransportError({
        cause: new ResponseProtocolError("custom transport returned an incoherent Problem"),
      });
    return problem;
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new BdpClientTransportError({
        cause: new ResponseProtocolError("custom transport returned an invalid Problem"),
      });
    throw error;
  }
}

function serviceDescriptionTarget(header: string): string | undefined {
  for (const value of parseLinkHeader(header)) {
    const relation = value.parameters.find((parameter) => parameter.name === "rel");
    if (
      relation !== undefined &&
      linkRelationTokens(relation.value, relation.quoted).some(
        (candidate) => candidate.toLowerCase() === "service-desc",
      )
    )
      return value.target;
  }
  return undefined;
}

function linkRelationTokens(value: string, quoted: boolean): readonly string[] {
  if (!quoted) return [value];
  if (value.length === 0 || value.trim() !== value) return [];
  return value.split(/ +/);
}

function redirectProblem(
  scope: AbsoluteHttpUrl,
  requestUrl: AbsoluteHttpUrl,
  response: Response,
  label: string,
): ReadProblem {
  const location = response.headers.get("location");
  if (location === null)
    return readProblem("invalid-parameter", `${label} returned a redirect without Location`);
  try {
    const target = new URL(location, requestUrl);
    if (
      !isWithinScope(scope, target) ||
      target.username !== "" ||
      target.password !== "" ||
      target.hash !== ""
    )
      return readProblem("forbidden", `${label} redirected outside the configured Scope`);
    return readProblem("invalid-parameter", `${label} returned an unsupported redirect`);
  } catch {
    return readProblem("invalid-parameter", `${label} returned an invalid redirect Location`);
  }
}

function responseUrlProblem(
  scope: AbsoluteHttpUrl,
  responseUrl: string,
  label: string,
): ReadProblem {
  try {
    const target = new URL(responseUrl);
    return isWithinScope(scope, target)
      ? readProblem("invalid-parameter", `${label} returned an unsupported redirect`)
      : readProblem("forbidden", `${label} redirected outside the configured Scope`);
  } catch {
    return readProblem("invalid-parameter", `${label} returned an invalid response URL`);
  }
}

async function fetchWithSignal(
  fetchImplementation: typeof fetch,
  input: AbsoluteHttpUrl,
  init: RequestInit,
  signal: AbortSignal,
  cleanupTimeoutMs: number,
): Promise<Response> {
  const pending = Promise.resolve().then(() => fetchImplementation(input, init));
  const lateCleanup = pending.then(
    async (response) => {
      if (signal.aborted) await cancelResponseBodyBounded(response, cleanupTimeoutMs);
    },
    () => undefined,
  );
  try {
    return await waitForPromise(pending, signal);
  } catch (error) {
    if (signal.aborted) await settleLateFetch(lateCleanup, cleanupTimeoutMs);
    throw error;
  }
}

async function settleLateFetch(cleanup: Promise<void>, timeoutMs: number): Promise<void> {
  try {
    await waitForPromise(cleanup, AbortSignal.timeout(timeoutMs));
  } catch {
    // A bounded late-fetch acknowledgement preserves close liveness when Fetch never settles.
  }
}

function responseLimits(options: FetchTransportOptions): ResponseLimits {
  const limits = {
    maximumResponseBodyBytes:
      options.maximumResponseBodyBytes ?? DEFAULT_MAXIMUM_RESPONSE_BODY_BYTES,
    maximumJsonDepth: options.maximumJsonDepth ?? DEFAULT_MAXIMUM_JSON_DEPTH,
    maximumJsonNodes: options.maximumJsonNodes ?? DEFAULT_MAXIMUM_JSON_NODES,
    maximumJsonContainerEntries:
      options.maximumJsonContainerEntries ?? DEFAULT_MAXIMUM_JSON_CONTAINER_ENTRIES,
    responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive safe integer`);
  }
  if (limits.responseTimeoutMs > MAX_TIMER_DELAY_MS)
    throw new RangeError(`responseTimeoutMs must be no more than ${MAX_TIMER_DELAY_MS}`);
  return limits;
}

async function readBoundedJson(
  response: Response,
  limits: ResponseLimits,
  signal: AbortSignal,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const jsonMediaType =
    contentType === "application/json" || contentType?.endsWith("+json") === true;
  const mustObserveEmptyBody = response.status === 500;
  if (!mustObserveEmptyBody && !jsonMediaType)
    throw new ResponseMediaTypeError("the server response did not use a JSON media type");
  if (response.body === null) throw new ResponseBodyEmptyError("response body was empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new ResponseBodyReadError("response body read aborted"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        try {
          text += decoder.decode();
        } catch (error) {
          throw new ResponseBodyFormatError("response body was not valid UTF-8", { cause: error });
        }
        break;
      }
      total += value.byteLength;
      if (total > limits.maximumResponseBodyBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ResponseBodyLimitError(
          `the server response exceeded ${limits.maximumResponseBodyBytes} bytes`,
        );
      }
      try {
        text += decoder.decode(value, { stream: true });
      } catch (error) {
        throw new ResponseBodyFormatError("response body was not valid UTF-8", { cause: error });
      }
    }
  } catch (error) {
    await cancelReaderBounded(reader, limits.responseTimeoutMs);
    if (isResponseBodyError(error) || signal.aborted) throw error;
    throw new ResponseBodyReadError("the server response body could not be read", { cause: error });
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // An aborted reader owns final cancellation.
    }
  }
  if (total === 0) throw new ResponseBodyEmptyError("response body was empty");
  if (!jsonMediaType)
    throw new ResponseMediaTypeError("the server response did not use a JSON media type");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ResponseBodyFormatError("response body was not valid JSON", { cause: error });
  }
  assertJsonComplexity(value, limits);
  assertUniqueJsonMemberNames(text);
  return value;
}

/** Native JSON.parse has already validated syntax; retain raw spelling only to detect
 * duplicate decoded names that its object construction necessarily discards.
 * One forward scan skips value strings and tracks names separately for each object.
 */
function assertUniqueJsonMemberNames(text: string): void {
  const containers: ({ readonly names: Set<string>; expectsName: boolean } | null)[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (text[index] !== '"') {
        if (text[index] === "\\") index += 1;
        index += 1;
      }
      const object = containers.at(-1);
      if (object?.expectsName) {
        const name = JSON.parse(text.slice(start, index + 1)) as string;
        if (object.names.has(name))
          throw new ResponseBodyFormatError("response body contained duplicate JSON member names");
        object.names.add(name);
        object.expectsName = false;
      }
    } else if (character === "{") {
      containers.push({ names: new Set(), expectsName: true });
    } else if (character === "[") {
      containers.push(null);
    } else if (character === "}" || character === "]") {
      containers.pop();
    } else if (character === ",") {
      const object = containers.at(-1);
      if (object !== undefined && object !== null) object.expectsName = true;
    }
  }
}

function isResponseBodyError(error: unknown): boolean {
  return (
    error instanceof ResponseBodyLimitError ||
    error instanceof ResponseMediaTypeError ||
    error instanceof ResponseBodyEmptyError ||
    error instanceof ResponseBodyFormatError ||
    error instanceof ResponseBodyReadError
  );
}

async function cancelReaderBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<void> {
  const cancellation = Promise.resolve().then(() => reader.cancel());
  void cancellation.catch(() => undefined);
  try {
    await waitForPromise(cancellation, AbortSignal.timeout(Math.min(timeoutMs, 1_000)));
  } catch {
    // A bounded cancellation attempt must not replace the response classification.
  }
}

async function cancelResponseBodyBounded(response: Response, timeoutMs: number): Promise<void> {
  if (response.body === null) return;
  const cancellation = Promise.resolve().then(() => response.body?.cancel());
  void cancellation.catch(() => undefined);
  try {
    await waitForPromise(cancellation, AbortSignal.timeout(Math.min(timeoutMs, 1_000)));
  } catch {
    // Cleanup cannot replace a response that has already been classified.
  }
}

function assertJsonComplexity(value: unknown, limits: ResponseLimits): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > limits.maximumJsonNodes)
      throw new ResponseBodyLimitError(
        `the server response exceeded ${limits.maximumJsonNodes} JSON nodes`,
      );
    if (current.depth > limits.maximumJsonDepth)
      throw new ResponseBodyLimitError(
        `the server response exceeded JSON depth ${limits.maximumJsonDepth}`,
      );
    if (typeof current.value === "number" && !Number.isFinite(current.value))
      throw new ResponseBodyFormatError("response body contained a non-finite JSON number");
    if (typeof current.value !== "object" || current.value === null) continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length > limits.maximumJsonContainerEntries)
      throw new ResponseBodyLimitError(
        `the server response exceeded ${limits.maximumJsonContainerEntries} JSON entries`,
      );
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
}

function deadlineSignal(delayMs: number): {
  readonly signal: AbortSignal;
  readonly clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("response deadline exceeded"), delayMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function boundedSettlement(
  settlements: readonly Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  if (settlements.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(settlements),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ClientOptions {
  readonly scope: AbsoluteHttpUrl;
  readonly transport: BdpTransport;
  /** Isolated, exact-ID admission for Type Descriptors hosted outside the Scope. */
  readonly externalTypeDescriptors?: ExternalTypeDescriptorPolicy;
  /** Maximum time close() waits for a custom transport Promise to settle. */
  readonly transportSettlementTimeoutMs?: number;
}

export interface ExternalTypeDescriptorPolicy {
  /** Every off-Scope Type ID that this client may retrieve. Authority grants are not inferred. */
  readonly typeIds: readonly AbsoluteHttpUrl[];
  /** A distinct Fetch implementation that cannot inherit Scope request credentials or wrappers. */
  readonly fetchImplementation: typeof fetch;
  /** Applies the same timeout, byte, and JSON-complexity bounds as the ordinary Fetch transport. */
  readonly fetchOptions?: FetchTransportOptions;
  /** Test-only escape hatch; production external Type IDs require HTTPS. */
  readonly allowInsecureHttpForTesting?: boolean;
  /** Test-only escape hatch for literal private, loopback, link-local, or local-name targets. */
  readonly allowPrivateNetworkForTesting?: boolean;
}

export interface PerformOptions {
  readonly signal?: AbortSignal;
  /** Isolates continuation capabilities retained by one logical traversal. */
  readonly continuationScope?: BdpContinuationScope;
}

export type BdpClientLocalErrorCode =
  | "client-closed"
  | "operation-aborted"
  | "safe-fetch-policy-required"
  | "transport-failed"
  | "invalid-request"
  | "continuation-capacity-exceeded";

export abstract class BdpClientLocalError extends Error {
  abstract readonly code: BdpClientLocalErrorCode;
}

export class BdpClientClosedError extends BdpClientLocalError {
  readonly code = "client-closed" as const;

  constructor() {
    super("the BDP client is closed");
    this.name = "BdpClientClosedError";
  }
}

export class BdpClientOperationAbortedError extends BdpClientLocalError {
  readonly code = "operation-aborted" as const;

  constructor(options: ErrorOptions = {}) {
    super("the BDP client operation was aborted", options);
    this.name = "BdpClientOperationAbortedError";
  }
}

export class BdpClientCapabilityError extends BdpClientLocalError {
  readonly code = "safe-fetch-policy-required" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "BdpClientCapabilityError";
  }
}

export class BdpClientTransportError extends BdpClientLocalError {
  readonly code = "transport-failed" as const;

  constructor(options: ErrorOptions = {}) {
    super("the BDP transport failed before producing a protocol result", options);
    this.name = "BdpClientTransportError";
  }
}

export class BdpClientRequestError extends BdpClientLocalError {
  readonly code = "invalid-request" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "BdpClientRequestError";
  }
}

export class BdpClientContinuationCapacityError extends BdpClientLocalError {
  readonly code = "continuation-capacity-exceeded" as const;

  constructor() {
    super("the BDP client continuation registry is at capacity");
    this.name = "BdpClientContinuationCapacityError";
  }
}

const CLIENT_PROBLEMS = new WeakSet<object>();

/** Distinguishes a protocol Problem returned by this client from success data. */
export function isBdpClientProblem(value: unknown): value is ReadProblem {
  return typeof value === "object" && value !== null && CLIENT_PROBLEMS.has(value);
}

function clientProblem(problem: ReadProblem): ReadProblem {
  const owned = Object.freeze(problem);
  CLIENT_PROBLEMS.add(owned);
  return owned;
}

/**
 * A Read client with one operation seam. Wire navigation remains explicit in
 * each request so authoritative discovery and continuation URLs pass through
 * unchanged instead of being reconstructed by convenience methods.
 */
export class BdpClient {
  readonly scope: AbsoluteHttpUrl;
  private readonly transport: BdpTransport;
  private readonly externalTypeDescriptorPolicy: ExternalTypeDescriptorRuntime | undefined;
  private readonly operations = new Map<AbortController, Promise<void>>();
  private readonly transportSettlements = new Set<Promise<void>>();
  private readonly readSession: ReadSession;
  private readonly transportSettlementTimeoutMs: number;
  private state: "open" | "closing" | "closed" = "open";
  private closePromise: Promise<void> | undefined;
  private discovery: ReadDiscovery | undefined;
  private discoveryInFlight: Promise<ReadDiscovery | ReadProblem> | undefined;

  constructor(options: ClientOptions) {
    const ownedOptions = snapshotClientOptions(options);
    assertCanonicalScope(ownedOptions.scope);
    this.scope = ownedOptions.scope;
    this.readSession = new ReadSession(this.scope);
    this.transport = ownedOptions.transport;
    this.externalTypeDescriptorPolicy = ownedOptions.externalTypeDescriptorPolicy;
    this.transportSettlementTimeoutMs = ownedOptions.transportSettlementTimeoutMs;
  }

  async perform<Request extends ReadRequest>(
    request: Request,
    options: PerformOptions = {},
  ): Promise<ReadResultFor<Request>> {
    if (this.state !== "open") throw new BdpClientClosedError();
    const ownedOptions = snapshotPerformOptions(options);
    const continuationScope = this.ownedContinuationScope(ownedOptions.continuationScope);
    if (ownedOptions.signal !== undefined && abortSignalAborted(ownedOptions.signal)) {
      throw new BdpClientOperationAbortedError({ cause: abortSignalReason(ownedOptions.signal) });
    }
    const ownedRequest = legacyReadSession(() => captureReadRequest(request));

    const operation = new AbortController();
    const completion = deferred();
    this.operations.set(operation, completion.promise);
    let detachCallerAbort: () => void = () => undefined;

    try {
      detachCallerAbort = relayAbort(ownedOptions.signal, operation);
      return await this.dispatch(ownedRequest, operation.signal, continuationScope);
    } catch (error) {
      if (operation.signal.aborted) {
        throw new BdpClientOperationAbortedError({ cause: operation.signal.reason });
      }
      throw error;
    } finally {
      detachCallerAbort();
      this.operations.delete(operation);
      completion.resolve();
    }
  }

  async discover(options: PerformOptions = {}): Promise<ReadDiscovery | ReadProblem> {
    if (this.state !== "open") throw new BdpClientClosedError();
    const ownedOptions = snapshotPerformOptions(options);
    this.ownedContinuationScope(ownedOptions.continuationScope);
    if (ownedOptions.signal !== undefined && abortSignalAborted(ownedOptions.signal)) {
      throw new BdpClientOperationAbortedError({ cause: abortSignalReason(ownedOptions.signal) });
    }
    const operation = new AbortController();
    const completion = deferred();
    this.operations.set(operation, completion.promise);
    let detach: () => void = () => undefined;
    try {
      detach = relayAbort(ownedOptions.signal, operation);
      const discovery = await this.getDiscovery(operation.signal);
      if (operation.signal.aborted) throw operation.signal.reason;
      return discovery;
    } catch (error) {
      if (operation.signal.aborted) {
        throw new BdpClientOperationAbortedError({ cause: operation.signal.reason });
      }
      throw error;
    } finally {
      detach();
      this.operations.delete(operation);
      completion.resolve();
    }
  }

  private async dispatch<Request extends ReadRequest>(
    request: Request,
    signal: AbortSignal,
    continuationScope: BdpContinuationScope | undefined,
  ): Promise<ReadResultFor<Request>> {
    if (request.kind === "scope-discovery") {
      if (!sameCanonicalUrl(this.scope, request.scope))
        return clientProblem(
          readProblem("forbidden", "the requested Scope does not match the configured Scope"),
        ) as ReadResultFor<Request>;
      const discovery = await this.getDiscovery(signal);
      if (signal.aborted) throw signal.reason;
      return discovery as ReadResultFor<Request>;
    }
    const prepared = legacyReadSession(() => this.readSession.prepare(request, continuationScope));
    try {
      const discovery = await this.getDiscovery(signal);
      if (isBdpClientProblem(discovery)) return discovery as ReadResultFor<Request>;
      const routed = legacyReadSession(() =>
        prepared.route(discovery, this.externalTypeDescriptorPolicy?.typeIds),
      );
      if (routed.kind === "refusal")
        return clientProblem(
          readProblem(routed.refusal.code, routed.refusal.detail),
        ) as ReadResultFor<Request>;
      const url = routed.value;
      if (signal.aborted) throw signal.reason;
      const transport =
        request.kind === "resource" &&
        request.resource === "type" &&
        !isWithinScope(this.scope, new URL(url))
          ? this.externalTypeDescriptorPolicy?.transport
          : this.transport;
      if (transport === undefined)
        throw new BdpClientCapabilityError(
          "external Type Descriptor retrieval requires a configured safe-fetch policy",
        );
      const result = await this.invokeTransport(
        () => transport.perform<unknown>(url, { scope: this.scope, signal }),
        signal,
      );
      if (result.kind === "problem")
        return clientProblem(validatedTransportProblem(result)) as ReadResultFor<Request>;
      const validated = legacyReadSession(() => prepared.validate(result.body));
      if (validated.kind === "refusal")
        return clientProblem(
          readProblem(validated.refusal.code, validated.refusal.detail),
        ) as ReadResultFor<Request>;
      if (signal.aborted) throw signal.reason;
      const committed = legacyReadSession(() => prepared.commit(validated.value));
      return (
        committed.kind === "success"
          ? committed.value
          : clientProblem(readProblem(committed.refusal.code, committed.refusal.detail))
      ) as ReadResultFor<Request>;
    } finally {
      prepared.release();
    }
  }

  private getDiscovery(signal: AbortSignal): Promise<ReadDiscovery | ReadProblem> {
    if (signal.aborted) throw signal.reason;
    if (this.discovery !== undefined) return Promise.resolve(this.discovery);
    const discovery = this.discoveryInFlight ?? this.startDiscovery();
    return waitForPromise(discovery, signal);
  }

  private startDiscovery(): Promise<ReadDiscovery | ReadProblem> {
    const operation = new AbortController();
    const completion = deferred();
    this.operations.set(operation, completion.promise);
    let tracked!: Promise<ReadDiscovery | ReadProblem>;
    tracked = this.loadDiscovery(operation.signal).finally(() => {
      if (this.discoveryInFlight === tracked) this.discoveryInFlight = undefined;
      this.operations.delete(operation);
      completion.resolve();
    });
    this.discoveryInFlight = tracked;
    void tracked.catch(() => undefined);
    return tracked;
  }

  private async loadDiscovery(signal: AbortSignal): Promise<ReadDiscovery | ReadProblem> {
    if (signal.aborted) throw signal.reason;
    const probeResult = await this.invokeTransport(
      () => this.transport.discover(this.scope, { signal }),
      signal,
      snapshotScopeProbe,
    );
    if (probeResult.kind === "problem")
      return clientProblem(
        validatedTransportProblem(
          probeResult as Extract<BdpTransportResult<unknown>, { readonly kind: "problem" }>,
        ),
      );
    const probe = probeResult as Extract<
      BdpTransportResult<ScopeProbe>,
      { readonly kind: "success" }
    >;
    let serviceDescription: AbsoluteHttpUrl;
    try {
      serviceDescription = parseCanonicalHttpUrl(
        probe.body.serviceDescription,
        "service description URL",
      );
    } catch (error) {
      if (error instanceof ProtocolArtifactValidationError)
        return clientProblem(
          readProblem(
            "temporarily-unavailable",
            "Scope discovery returned an invalid service-desc target",
          ),
        );
      throw error;
    }
    if (!isWithinScope(this.scope, new URL(serviceDescription)))
      throw new BdpClientCapabilityError(
        "external service description retrieval requires a configured safe-fetch policy",
      );
    if (signal.aborted) throw signal.reason;
    const discoveryResult = await this.invokeTransport(
      () =>
        this.transport.perform<ReadDiscovery>(serviceDescription, { scope: this.scope, signal }),
      signal,
    );
    if (discoveryResult.kind === "problem")
      return clientProblem(
        validatedTransportProblem(
          discoveryResult as Extract<BdpTransportResult<unknown>, { readonly kind: "problem" }>,
        ),
      );
    const discoverySuccess = discoveryResult as Extract<
      BdpTransportResult<ReadDiscovery>,
      { readonly kind: "success" }
    >;
    let discovery: ReadDiscovery;
    try {
      discovery = parseReadDiscovery(discoverySuccess.body);
    } catch (error) {
      if (error instanceof ProtocolArtifactValidationError)
        return clientProblem(
          readProblem(
            "temporarily-unavailable",
            "the Scope returned invalid or unsupported discovery metadata",
          ),
        );
      throw error;
    }
    if (!sameScope(discovery, this.scope))
      return clientProblem(
        readProblem("forbidden", "discovery metadata does not identify the configured Scope"),
      );
    this.discovery = discovery;
    return discovery;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.state = "closing";
    const admitted = [...this.operations.entries()];
    for (const [operation] of admitted) operation.abort("client closed");
    const transports = [...this.transportSettlements];
    this.closePromise = Promise.all(admitted.map(([, completion]) => completion))
      .then(() => boundedSettlement(transports, this.transportSettlementTimeoutMs))
      .then(() => {
        this.transportSettlements.clear();
        this.readSession.clear();
        this.state = "closed";
      });
    return this.closePromise;
  }

  /**
   * Creates an opaque owner for the continuation capabilities retained by one
   * logical traversal. The scope is valid only for this client.
   */
  createContinuationScope(): BdpContinuationScope {
    if (this.state !== "open") throw new BdpClientClosedError();
    return legacyReadSession(() => this.readSession.createContinuationScope());
  }

  /** Forget available capabilities for this traversal, preserving active leases. */
  forgetContinuations(scope: BdpContinuationScope): void {
    legacyReadSession(() => this.readSession.forgetContinuations(scope));
  }

  private ownedContinuationScope(
    scope: BdpContinuationScope | undefined,
  ): BdpContinuationScope | undefined {
    return legacyReadSession(() => this.readSession.owner(scope));
  }

  private async invokeTransport<Body>(
    invoke: () => Promise<BdpTransportResult<Body>>,
    signal: AbortSignal,
    snapshotSuccessBody?: (body: unknown) => Body,
  ): Promise<BdpTransportResult<Body>> {
    const pending = Promise.resolve().then(invoke);
    const settlement = pending.then(
      () => undefined,
      () => undefined,
    );
    const settlements = this.transportSettlements;
    settlements.add(settlement);
    void settlement.then(() => settlements.delete(settlement));
    try {
      const result = snapshotTransportResult<Body>(await waitForPromise(pending, signal));
      if (result.kind === "success" && snapshotSuccessBody !== undefined)
        return Object.freeze({ kind: "success" as const, body: snapshotSuccessBody(result.body) });
      return result;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new BdpClientTransportError({ cause: error });
    }
  }
}

function assertCanonicalScope(scope: AbsoluteHttpUrl): void {
  try {
    parseCanonicalScope(scope);
  } catch (cause) {
    throw new TypeError("scope must be a canonical HTTP(S) URL ending in /", { cause });
  }
}

interface OwnedClientOptions {
  readonly scope: AbsoluteHttpUrl;
  readonly transport: BdpTransport;
  readonly externalTypeDescriptorPolicy: ExternalTypeDescriptorRuntime | undefined;
  readonly transportSettlementTimeoutMs: number;
}

interface ExternalTypeDescriptorRuntime {
  readonly typeIds: ReadonlySet<string>;
  readonly transport: BdpTransport;
}

function snapshotClientOptions(value: ClientOptions): OwnedClientOptions {
  const candidate = snapshotPlainDataObject(value, "client options");
  if (
    Reflect.ownKeys(candidate).some(
      (key) =>
        key !== "scope" &&
        key !== "transport" &&
        key !== "externalTypeDescriptors" &&
        key !== "transportSettlementTimeoutMs",
    )
  )
    throw new TypeError("client options contain unknown fields");
  if (!Object.hasOwn(candidate, "scope") || !Object.hasOwn(candidate, "transport"))
    throw new TypeError("client options require scope and transport");
  if (
    typeof candidate.scope !== "string" ||
    typeof candidate.transport !== "object" ||
    candidate.transport === null
  )
    throw new TypeError("client options contain invalid fields");
  const transportSettlementTimeoutMs =
    candidate.transportSettlementTimeoutMs === undefined
      ? DEFAULT_TRANSPORT_SETTLEMENT_TIMEOUT_MS
      : candidate.transportSettlementTimeoutMs;
  if (
    !Number.isSafeInteger(transportSettlementTimeoutMs) ||
    (transportSettlementTimeoutMs as number) <= 0 ||
    (transportSettlementTimeoutMs as number) > MAX_TIMER_DELAY_MS
  )
    throw new TypeError(
      `transportSettlementTimeoutMs must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`,
    );
  return Object.freeze({
    scope: candidate.scope as AbsoluteHttpUrl,
    transport: candidate.transport as BdpTransport,
    externalTypeDescriptorPolicy: snapshotExternalTypeDescriptorPolicy(
      candidate.externalTypeDescriptors,
    ),
    transportSettlementTimeoutMs: transportSettlementTimeoutMs as number,
  });
}

function snapshotExternalTypeDescriptorPolicy(
  value: unknown,
): ExternalTypeDescriptorRuntime | undefined {
  if (value === undefined) return undefined;
  const candidate = snapshotPlainDataObject(value, "external Type Descriptor policy");
  if (
    Reflect.ownKeys(candidate).some(
      (key) =>
        key !== "typeIds" &&
        key !== "fetchImplementation" &&
        key !== "fetchOptions" &&
        key !== "allowInsecureHttpForTesting" &&
        key !== "allowPrivateNetworkForTesting",
    )
  )
    throw new TypeError("external Type Descriptor policy contains unknown fields");
  if (!Array.isArray(candidate.typeIds) || candidate.typeIds.length === 0)
    throw new TypeError("external Type Descriptor policy requires at least one Type ID");
  if (candidate.typeIds.length > 256)
    throw new TypeError("external Type Descriptor policy accepts at most 256 Type IDs");
  if (typeof candidate.fetchImplementation !== "function")
    throw new TypeError("external Type Descriptor policy requires a Fetch implementation");
  const allowInsecureHttpForTesting = readOptionalBoolean(
    candidate.allowInsecureHttpForTesting,
    "allowInsecureHttpForTesting",
  );
  const allowPrivateNetworkForTesting = readOptionalBoolean(
    candidate.allowPrivateNetworkForTesting,
    "allowPrivateNetworkForTesting",
  );
  const typeIds = new Set<string>();
  for (const [index, value] of candidate.typeIds.entries()) {
    let typeId: AbsoluteHttpUrl;
    try {
      typeId = parseCanonicalTypeId(value, `external Type Descriptor policy typeIds[${index}]`);
    } catch (cause) {
      throw new TypeError(`external Type Descriptor policy typeIds[${index}] is invalid`, {
        cause,
      });
    }
    const target = new URL(typeId);
    if (target.protocol !== "https:" && !allowInsecureHttpForTesting)
      throw new TypeError("external Type Descriptor policy requires HTTPS Type IDs");
    if (isPrivateNetworkTarget(target) && !allowPrivateNetworkForTesting)
      throw new TypeError(
        "external Type Descriptor policy rejects private, loopback, and link-local targets",
      );
    if (typeIds.has(typeId))
      throw new TypeError(`external Type Descriptor policy contains duplicate Type ID '${typeId}'`);
    typeIds.add(typeId);
  }
  const fetchOptions = snapshotFetchTransportOptions(candidate.fetchOptions);
  return Object.freeze({
    typeIds,
    transport: createFetchTransport(candidate.fetchImplementation as typeof fetch, fetchOptions),
  });
}

function readOptionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function snapshotFetchTransportOptions(value: unknown): FetchTransportOptions {
  if (value === undefined) return Object.freeze({});
  const candidate = snapshotPlainDataObject(value, "external Type Descriptor fetch options");
  const keys = [
    "maximumResponseBodyBytes",
    "maximumJsonDepth",
    "maximumJsonNodes",
    "maximumJsonContainerEntries",
    "responseTimeoutMs",
  ] as const;
  if (Reflect.ownKeys(candidate).some((key) => !keys.includes(key as (typeof keys)[number])))
    throw new TypeError("external Type Descriptor fetch options contain unknown fields");
  return Object.freeze(
    Object.fromEntries(
      keys.flatMap((key) =>
        Object.hasOwn(candidate, key) ? ([[key, candidate[key]]] as const) : [],
      ),
    ),
  );
}

function isPrivateNetworkTarget(target: URL): boolean {
  const hostname = target.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".lan")
  )
    return true;
  const ipv4 = hostname.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255))
    return isPrivateIpv4(ipv4);
  const ipv6 =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (mappedIpv4 !== null) {
    const high = Number.parseInt(mappedIpv4[1] ?? "", 16);
    const low = Number.parseInt(mappedIpv4[2] ?? "", 16);
    if (Number.isFinite(high) && Number.isFinite(low))
      return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return (
    ipv6 === "::" ||
    ipv6 === "::1" ||
    /^f[cd][0-9a-f]{2}:/i.test(ipv6) ||
    /^fe[89ab][0-9a-f]:/i.test(ipv6) ||
    /^ff[0-9a-f]{2}:/i.test(ipv6)
  );
}

function isPrivateIpv4(parts: readonly number[]): boolean {
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function snapshotPerformOptions(value: PerformOptions): PerformOptions {
  const candidate = snapshotPlainDataObject(value, "perform options");
  if (Reflect.ownKeys(candidate).some((key) => key !== "signal" && key !== "continuationScope"))
    throw new BdpClientRequestError("perform options contain unknown fields");
  const signal = candidate.signal;
  if (signal !== undefined && !isAbortSignal(signal))
    throw new BdpClientRequestError("perform options signal must be an AbortSignal");
  const continuationScope = candidate.continuationScope;
  if (
    continuationScope !== undefined &&
    (typeof continuationScope !== "object" || continuationScope === null)
  )
    throw new BdpClientRequestError("perform options continuationScope must be a client scope");
  const typedContinuationScope = continuationScope as BdpContinuationScope | undefined;
  return Object.freeze({
    ...(signal === undefined ? {} : { signal }),
    ...(typedContinuationScope === undefined ? {} : { continuationScope: typedContinuationScope }),
  });
}

function snapshotPlainDataObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BdpClientRequestError(`${label} must be a plain object`);
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw new BdpClientRequestError(`${label} must be a plain object`);
  }
  if (prototype !== Object.prototype && prototype !== null)
    throw new BdpClientRequestError(`${label} must be a plain object`);
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new BdpClientRequestError(`${label} fields must be readable data properties`);
  }
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      throw new BdpClientRequestError(`${label} contains a symbol field`);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
      throw new BdpClientRequestError(`${label} fields must be readable data properties`);
    entries.push([key, descriptor.value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== "object" || value === null) return false;
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (getter === undefined) return false;
  try {
    getter.call(value);
    return true;
  } catch {
    return false;
  }
}

function abortSignalAborted(signal: AbortSignal): boolean {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
  if (getter === undefined) throw new TypeError("AbortSignal.aborted is unavailable");
  return getter.call(signal) as boolean;
}

function abortSignalReason(signal: AbortSignal): unknown {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
  if (getter === undefined) throw new TypeError("AbortSignal.reason is unavailable");
  return getter.call(signal);
}

function sameCanonicalUrl(left: AbsoluteHttpUrl, right: AbsoluteHttpUrl): boolean {
  try {
    const parsedLeft = new URL(left);
    const parsedRight = new URL(right);
    return parsedLeft.href === left && parsedRight.href === right && left === right;
  } catch {
    return false;
  }
}

function sameScope(discovery: ReadDiscovery, scope: AbsoluteHttpUrl): boolean {
  try {
    const expected = new URL(scope);
    const actual = new URL(discovery.scope);
    if (expected.href !== scope || actual.href !== discovery.scope || expected.href !== actual.href)
      return false;
    return (
      discovery.beads === new URL("beads/", expected).href &&
      discovery.links === new URL("links/", expected).href &&
      discovery.types === new URL("types/", expected).href &&
      (discovery.aliases === undefined || discovery.aliases === new URL("alias/", expected).href)
    );
  } catch {
    return false;
  }
}

async function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}

function relayAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (source === undefined) return () => undefined;
  const abort = () => target.abort(abortSignalReason(source));
  EventTarget.prototype.addEventListener.call(source, "abort", abort, { once: true });
  if (abortSignalAborted(source)) abort();
  return () => EventTarget.prototype.removeEventListener.call(source, "abort", abort);
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export {
  BdpReadUpdateClient,
  type ReadUpdateClientAliasResolution,
  type ReadUpdateClientCallOptions,
  ReadUpdateClientError,
  type ReadUpdateClientErrorCode,
  type ReadUpdateClientMutationOptions,
  type ReadUpdateClientOptions,
  type ReadUpdateClientReadOptions,
  type ReadUpdateClientReply,
  type ReadUpdateResultFor,
} from "./read-update.js";
export {
  createReadUpdateFetchTransport,
  type ReadUpdateAliasResponse,
  type ReadUpdateFetchTransportOptions,
  type ReadUpdateHttpContext,
  type ReadUpdateHttpResponse,
  type ReadUpdateScopeProbeResponse,
  type ReadUpdateTransport,
  type ReadUpdateTransportCallOptions,
  ReadUpdateTransportError,
  type ReadUpdateTransportErrorCode,
  type ReadUpdateTransportLimits,
  type ReadUpdateTransportPostOptions,
} from "./read-update-transport.js";
export type { AbsoluteHttpUrl, ReadDiscovery, ReadProblem, ReadRequest, ReadResultFor };

/** Translate neutral shared failures only at the legacy public boundary. */
function legacyReadSession<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (!(error instanceof ReadSessionLocalError)) throw error;
    switch (error.reason) {
      case "request":
        throw new BdpClientRequestError(error.message);
      case "capability":
        throw new BdpClientCapabilityError(error.message);
      case "capacity":
        throw new BdpClientContinuationCapacityError();
      case "closed":
        throw new BdpClientClosedError();
    }
  }
}
