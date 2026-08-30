import type {
  AbsoluteHttpUrl,
  BeadCollection,
  BeadCollectionRequest,
  BeadRecord,
  LinkCollection,
  LinkCollectionRequest,
  LinkRecord,
  ReadDiscovery,
  ReadProblem,
  ReadRequest,
  ReadResultFor,
  ScopeProbe,
  ScopeReadOperation,
  TypeInventory,
  TypeInventoryRequest,
} from "@bdp/protocol";
import {
  referenceUri,
  ProtocolArtifactValidationError,
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseCanonicalTypeId,
  parseLinkCollection,
  parseLinkHeader,
  parseLinkRecord,
  parsePropertiesRecord,
  parseReadDiscovery,
  parseReadProblem,
  parseTypeDescriptor,
  parseTypeInventory,
  readProblem,
  readProblemDefinitionFor,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";

/** Identifies the reusable BDP client package. */
export const packageName = "@bdp/client";

const DEFAULT_MAXIMUM_RESPONSE_BODY_BYTES = 1_048_576;
const DEFAULT_MAXIMUM_JSON_DEPTH = 128;
const DEFAULT_MAXIMUM_JSON_NODES = 100_000;
const DEFAULT_MAXIMUM_JSON_CONTAINER_ENTRIES = 100_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSPORT_SETTLEMENT_TIMEOUT_MS = 30_000;
const MAXIMUM_CONTINUATION_CONTEXTS = 1_024;
const MAXIMUM_CONTINUATION_HISTORY_ENTRIES = 10_000;
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
  return value;
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

declare const CONTINUATION_SCOPE_BRAND: unique symbol;

/** Opaque ownership token for continuation capabilities issued to one traversal. */
export interface BdpContinuationScope {
  readonly [CONTINUATION_SCOPE_BRAND]: true;
}

type ContinuationContext =
  | { readonly kind: "collection"; readonly collection: "beads" | "links" | "types" }
  | {
      readonly kind: "bead-links";
      readonly bead: AbsoluteHttpUrl;
      readonly direction: "inbound" | "outbound" | "both";
    };

class ContinuationRegistryError extends Error {}

class ContinuationRegistryProtocolError extends ContinuationRegistryError {}

class ContinuationRegistryCapacityError extends ContinuationRegistryError {}

interface ContinuationLease {
  readonly url: AbsoluteHttpUrl;
  readonly context: ContinuationContext;
  readonly owner: BdpContinuationScope | undefined;
  readonly history: Set<AbsoluteHttpUrl>;
}

interface ContinuationReservation {
  readonly context: ContinuationContext;
  readonly lease?: ContinuationLease;
}

class ContinuationRegistry {
  private readonly entries = new Map<
    AbsoluteHttpUrl,
    Array<{
      readonly context: ContinuationContext;
      readonly owner: BdpContinuationScope | undefined;
      readonly history: Set<AbsoluteHttpUrl>;
    }>
  >();
  private readonly leases = new Set<ContinuationLease>();
  private size = 0;
  private historySize = 0;

  reserve(
    url: AbsoluteHttpUrl,
    owner: BdpContinuationScope | undefined,
    matches: (context: ContinuationContext) => boolean,
  ): ContinuationLease | undefined {
    const entries = this.entries.get(url);
    const index =
      entries?.findIndex((entry) => entry.owner === owner && matches(entry.context)) ?? -1;
    if (entries === undefined || index < 0) return undefined;
    const entry = entries[index];
    if (entry === undefined) return undefined;
    entries.splice(index, 1);
    if (entries.length === 0) this.entries.delete(url);
    const lease = { url, context: entry.context, owner: entry.owner, history: entry.history };
    this.leases.add(lease);
    return lease;
  }

  commit(
    lease: ContinuationLease | undefined,
    next: AbsoluteHttpUrl | null,
    context: ContinuationContext,
    owner: BdpContinuationScope | undefined,
  ): void {
    if (lease !== undefined && !this.leases.has(lease))
      throw new ContinuationRegistryProtocolError("the continuation lease is no longer active");
    if (lease !== undefined && !sameContinuationContext(lease.context, context))
      throw new ContinuationRegistryProtocolError("the continuation context changed");
    if (lease !== undefined && lease.owner !== owner)
      throw new ContinuationRegistryProtocolError("the continuation owner changed");
    if (next !== null && lease?.url === next)
      throw new ContinuationRegistryProtocolError("the response repeated its continuation URL");
    if (next !== null && lease?.history.has(next))
      throw new ContinuationRegistryProtocolError(
        "the response cycled to an earlier continuation URL",
      );

    const candidates = next === null ? undefined : this.entries.get(next);
    if (
      context.kind === "bead-links" &&
      (candidates?.some(
        (candidate) =>
          candidate.owner === owner &&
          candidate.context.kind === "bead-links" &&
          candidate.context.bead === context.bead &&
          candidate.context.direction !== context.direction,
      ) ||
        [...this.leases].some(
          (candidate) =>
            candidate.owner === owner &&
            candidate.url === next &&
            candidate.context.kind === "bead-links" &&
            candidate.context.bead === context.bead &&
            candidate.context.direction !== context.direction,
        ))
    )
      throw new ContinuationRegistryProtocolError(
        "the continuation URL is ambiguous across incident-Link directions",
      );
    const additions = next === null ? 0 : 1;
    const consumed = lease === undefined ? 0 : 1;
    if (this.size - consumed + additions > MAXIMUM_CONTINUATION_CONTEXTS)
      throw new ContinuationRegistryCapacityError(
        "the continuation registry reached its local bound",
      );
    const releasedHistory = next === null ? (lease?.history.size ?? 0) : 0;
    const addedHistory = next === null ? 0 : 1;
    if (this.historySize - releasedHistory + addedHistory > MAXIMUM_CONTINUATION_HISTORY_ENTRIES)
      throw new ContinuationRegistryCapacityError(
        "the continuation history reached its local bound",
      );
    if (lease !== undefined) {
      this.leases.delete(lease);
      this.size -= 1;
      if (next === null) this.historySize -= lease.history.size;
    }
    if (next !== null) {
      const history = lease?.history ?? new Set<AbsoluteHttpUrl>();
      history.add(next);
      this.historySize += 1;
      this.add(next, context, owner, true, history);
    }
  }

  restore(lease: ContinuationLease | undefined): void {
    if (lease === undefined || !this.leases.delete(lease)) return;
    this.add(lease.url, lease.context, lease.owner, false, lease.history);
  }

  clear(): void {
    this.entries.clear();
    this.leases.clear();
    this.size = 0;
    this.historySize = 0;
  }

  forgetAvailable(owner: BdpContinuationScope): void {
    for (const [url, entries] of this.entries) {
      const retained = entries.filter((entry) => entry.owner !== owner);
      for (const entry of entries) {
        if (entry.owner === owner) {
          this.size -= 1;
          this.historySize -= entry.history.size;
        }
      }
      if (retained.length === 0) this.entries.delete(url);
      else this.entries.set(url, retained);
    }
  }

  private add(
    url: AbsoluteHttpUrl,
    context: ContinuationContext,
    owner: BdpContinuationScope | undefined,
    count = true,
    history: Set<AbsoluteHttpUrl>,
  ): void {
    const entries = this.entries.get(url);
    const entry = { context, owner, history };
    if (entries === undefined) this.entries.set(url, [entry]);
    else entries.push(entry);
    if (count) this.size += 1;
  }
}

function sameContinuationContext(left: ContinuationContext, right: ContinuationContext): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "collection" && right.kind === "collection")
    return left.collection === right.collection;
  if (left.kind !== "bead-links" || right.kind !== "bead-links") return false;
  return left.bead === right.bead && left.direction === right.direction;
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

type ReadRequestVariantMap = {
  readonly "scope-discovery": Extract<ReadRequest, { readonly kind: "scope-discovery" }>;
  readonly "collection:beads": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "beads" }
  >;
  readonly "collection:links": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "links" }
  >;
  readonly "collection:types": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "types" }
  >;
  readonly "resource:bead": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "bead" }
  >;
  readonly "resource:link": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "link" }
  >;
  readonly "resource:type": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "type" }
  >;
  readonly "properties:bead": Extract<
    ReadRequest,
    { readonly kind: "properties"; readonly resource: "bead" }
  >;
  readonly "properties:link": Extract<
    ReadRequest,
    { readonly kind: "properties"; readonly resource: "link" }
  >;
  readonly "bead-links": Extract<ReadRequest, { readonly kind: "bead-links" }>;
};

type ReadRequestVariant = keyof ReadRequestVariantMap;
type RegisteredReadRequest = ReadRequestVariantMap[ReadRequestVariant];
type ExhaustiveReadRequestRegistration =
  Exclude<ReadRequest, RegisteredReadRequest> extends never
    ? unknown
    : { readonly missingReadRequestRegistration: never };

type ReadRequestVisitor<Result> = {
  readonly [Variant in ReadRequestVariant]: (request: ReadRequestVariantMap[Variant]) => Result;
};

function visitReadRequest<Result>(
  request: ReadRequest,
  visitor: ReadRequestVisitor<Result>,
): Result {
  switch (request.kind) {
    case "scope-discovery":
      return visitor["scope-discovery"](request);
    case "collection":
      switch (request.collection) {
        case "beads":
          return visitor["collection:beads"](request);
        case "links":
          return visitor["collection:links"](request);
        case "types":
          return visitor["collection:types"](request);
      }
      return unreachableReadRequestVariant(request);
    case "resource":
      switch (request.resource) {
        case "bead":
          return visitor["resource:bead"](request);
        case "link":
          return visitor["resource:link"](request);
        case "type":
          return visitor["resource:type"](request);
      }
      return unreachableReadRequestVariant(request);
    case "properties":
      switch (request.resource) {
        case "bead":
          return visitor["properties:bead"](request);
        case "link":
          return visitor["properties:link"](request);
      }
      return unreachableReadRequestVariant(request);
    case "bead-links":
      return visitor["bead-links"](request);
  }
}

function unreachableReadRequestVariant(value: never): never {
  throw new TypeError(`unregistered Read request variant ${String(value)}`);
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
  private readonly continuations = new ContinuationRegistry();
  private readonly continuationScopes = new WeakSet<BdpContinuationScope>();
  private readonly transportSettlementTimeoutMs: number;
  private state: "open" | "closing" | "closed" = "open";
  private closePromise: Promise<void> | undefined;
  private discovery: ReadDiscovery | undefined;
  private discoveryInFlight: Promise<ReadDiscovery | ReadProblem> | undefined;

  constructor(options: ClientOptions) {
    const ownedOptions = snapshotClientOptions(options);
    assertCanonicalScope(ownedOptions.scope);
    this.scope = ownedOptions.scope;
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
    const ownedRequest = snapshotRequestParameters(request);

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
    const continuation = continuationContextFor(request, this.continuations, continuationScope);
    const lease = continuation?.lease;
    let committed = false;
    try {
      const url = await this.urlFor(request, signal);
      if (typeof url !== "string") return clientProblem(url) as ReadResultFor<Request>;
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
        () => transport.perform<ReadResultFor<Request>>(url, { scope: this.scope, signal }),
        signal,
      );
      if (result.kind === "problem")
        return clientProblem(
          validatedTransportProblem(
            result as Extract<BdpTransportResult<unknown>, { readonly kind: "problem" }>,
          ),
        ) as ReadResultFor<Request>;
      const validated = validateReadBody(
        request,
        (result as Extract<BdpTransportResult<unknown>, { readonly kind: "success" }>).body,
        this.scope,
        continuation?.context,
      );
      if (validated.kind === "problem")
        return clientProblem(validated.problem) as ReadResultFor<Request>;
      const value = validated.body as ReadResultFor<Request>;
      if (continuation !== undefined) {
        const next = (value as { readonly next: AbsoluteHttpUrl | null }).next;
        try {
          this.continuations.commit(lease, next, continuation.context, continuationScope);
          committed = true;
        } catch (error) {
          if (error instanceof ContinuationRegistryCapacityError)
            throw new BdpClientContinuationCapacityError();
          if (error instanceof ContinuationRegistryProtocolError)
            return clientProblem(
              readProblem(
                "temporarily-unavailable",
                "the server returned a structurally invalid Read response",
              ),
            ) as ReadResultFor<Request>;
          throw error;
        }
      }
      return value;
    } finally {
      if (lease !== undefined && !committed) this.continuations.restore(lease);
    }
  }

  private async urlFor(
    request: ScopeReadOperation,
    signal: AbortSignal,
  ): Promise<AbsoluteHttpUrl | ReadProblem> {
    const discovery = await this.getDiscovery(signal);
    if (isBdpClientProblem(discovery)) return discovery;
    return readRequestUrl(
      request,
      this.scope,
      discovery,
      this.externalTypeDescriptorPolicy?.typeIds ?? new Set<string>(),
    );
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
        this.continuations.clear();
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
    const scope = Object.freeze(Object.create(null)) as BdpContinuationScope;
    this.continuationScopes.add(scope);
    return scope;
  }

  /**
   * Forgets this traversal's retained continuations that are not currently
   * leased by an admitted operation. Other traversal owners are unaffected.
   */
  forgetContinuations(scope: BdpContinuationScope): void {
    const owned = this.ownedContinuationScope(scope);
    if (owned === undefined) throw new BdpClientRequestError("continuation scope is required");
    this.continuations.forgetAvailable(owned);
  }

  private ownedContinuationScope(
    scope: BdpContinuationScope | undefined,
  ): BdpContinuationScope | undefined {
    if (scope !== undefined && !this.continuationScopes.has(scope))
      throw new BdpClientRequestError("continuation scope was not created by this client");
    return scope;
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

interface ReadRequestDescriptor {
  readonly kind: ReadRequest["kind"];
  readonly qualifierValue?: string;
  readonly allowedFields: readonly string[];
  readonly requiredUrlFields: readonly string[];
  readonly continuationIncompatibleFields: readonly string[];
  readonly validatesDirection?: true;
}

type ReadRequestQualifier<Request extends ReadRequest> = Request extends {
  readonly kind: "collection";
  readonly collection: infer Qualifier extends string;
}
  ? Qualifier
  : Request extends {
        readonly kind: "resource" | "properties";
        readonly resource: infer Qualifier extends string;
      }
    ? Qualifier
    : never;

type RegisteredReadRequestDescriptor<Variant extends ReadRequestVariant> = ReadRequestDescriptor & {
  readonly kind: ReadRequestVariantMap[Variant]["kind"];
} & ([ReadRequestQualifier<ReadRequestVariantMap[Variant]>] extends [never]
    ? { readonly qualifierValue?: never }
    : {
        readonly qualifierValue: ReadRequestQualifier<ReadRequestVariantMap[Variant]>;
      });

const READ_REQUEST_DESCRIPTORS = {
  "scope-discovery": {
    kind: "scope-discovery",
    allowedFields: ["kind", "scope"],
    requiredUrlFields: ["scope"],
    continuationIncompatibleFields: [],
  },
  "collection:beads": {
    kind: "collection",
    qualifierValue: "beads",
    allowedFields: [
      "kind",
      "collection",
      "continuation",
      "type",
      "conformsTo",
      "limit",
      "selector",
    ],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "collection:links": {
    kind: "collection",
    qualifierValue: "links",
    allowedFields: [
      "kind",
      "collection",
      "continuation",
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "limit",
      "selector",
    ],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "collection:types": {
    kind: "collection",
    qualifierValue: "types",
    allowedFields: ["kind", "collection", "continuation", "limit"],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "resource:bead": {
    kind: "resource",
    qualifierValue: "bead",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "resource:link": {
    kind: "resource",
    qualifierValue: "link",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "resource:type": {
    kind: "resource",
    qualifierValue: "type",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "properties:bead": {
    kind: "properties",
    qualifierValue: "bead",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "properties:link": {
    kind: "properties",
    qualifierValue: "link",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "bead-links": {
    kind: "bead-links",
    allowedFields: ["kind", "bead", "continuation", "direction", "limit"],
    requiredUrlFields: ["bead"],
    continuationIncompatibleFields: ["limit", "direction"],
    validatesDirection: true,
  },
} satisfies {
  readonly [Variant in ReadRequestVariant]: RegisteredReadRequestDescriptor<Variant>;
} & ExhaustiveReadRequestRegistration;

type ReadRequestFamilyDescriptor =
  | {
      readonly kind: "scope-discovery" | "bead-links";
    }
  | {
      readonly kind: "collection" | "resource" | "properties";
      readonly qualifierField: "collection" | "resource";
      readonly missingQualifierMessage: string;
      readonly invalidQualifierMessage: string;
    };

const READ_REQUEST_FAMILIES = {
  "scope-discovery": { kind: "scope-discovery" },
  collection: {
    kind: "collection",
    qualifierField: "collection",
    missingQualifierMessage: "collection requests require a collection kind",
    invalidQualifierMessage: "request has an invalid collection kind",
  },
  resource: {
    kind: "resource",
    qualifierField: "resource",
    missingQualifierMessage: "Resource requests require a Resource kind",
    invalidQualifierMessage: "request has an invalid Resource kind",
  },
  properties: {
    kind: "properties",
    qualifierField: "resource",
    missingQualifierMessage: "properties requests require a Resource kind",
    invalidQualifierMessage: "request has an invalid properties Resource kind",
  },
  "bead-links": { kind: "bead-links" },
} satisfies Readonly<Record<ReadRequest["kind"], ReadRequestFamilyDescriptor>>;

function requestDescriptorForCandidate(
  candidate: Readonly<Record<string, unknown>>,
): ReadRequestDescriptor {
  const family = Object.values(READ_REQUEST_FAMILIES).find(
    (registered) => registered.kind === candidate.kind,
  );
  if (family === undefined)
    throw new BdpClientRequestError("request has an invalid operation kind");
  const candidates: readonly ReadRequestDescriptor[] = Object.values(
    READ_REQUEST_DESCRIPTORS,
  ).filter((descriptor) => descriptor.kind === family.kind);
  if (!("qualifierField" in family)) {
    const descriptor = candidates[0];
    if (descriptor === undefined)
      throw new BdpClientRequestError("request has an invalid operation kind");
    return descriptor;
  }
  if (!Object.hasOwn(candidate, family.qualifierField))
    throw new BdpClientRequestError(family.missingQualifierMessage);
  const qualifierValue = candidate[family.qualifierField];
  const descriptor = candidates.find((registered) => registered.qualifierValue === qualifierValue);
  if (descriptor === undefined) throw new BdpClientRequestError(family.invalidQualifierMessage);
  return descriptor;
}

function continuationContextFor(
  request: ReadRequest,
  continuations: ContinuationRegistry,
  owner: BdpContinuationScope | undefined,
): ContinuationReservation | undefined {
  if (request.kind === "collection") {
    if (request.continuation === undefined)
      return { context: { kind: "collection", collection: request.collection } };
    const lease = continuations.reserve(
      request.continuation,
      owner,
      (candidate) => candidate.kind === "collection" && candidate.collection === request.collection,
    );
    if (lease === undefined)
      throw new BdpClientRequestError("continuation was not issued for this collection");
    return { context: lease.context, lease };
  }
  if (request.kind === "bead-links") {
    if (request.continuation === undefined)
      return {
        context: {
          kind: "bead-links",
          bead: request.bead,
          direction: Object.hasOwn(request, "direction") ? (request.direction ?? "both") : "both",
        },
      };
    const lease = continuations.reserve(
      request.continuation,
      owner,
      (candidate) => candidate.kind === "bead-links" && candidate.bead === request.bead,
    );
    if (lease === undefined)
      throw new BdpClientRequestError("continuation was not issued for this Bead");
    return { context: lease.context, lease };
  }
  return undefined;
}

function snapshotRequestParameters<Request extends ReadRequest>(value: Request): Request {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BdpClientRequestError("request must be an object");
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw new BdpClientRequestError("request must be a plain object");
  }
  if (prototype !== Object.prototype && prototype !== null)
    throw new BdpClientRequestError("request must be a plain object");
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new BdpClientRequestError("request fields must be readable data properties");
  }
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      throw new BdpClientRequestError("request contains fields not allowed for its operation kind");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
      throw new BdpClientRequestError("request fields must be readable data properties");
    entries.push([key, descriptor.value]);
  }
  const candidate = Object.freeze(Object.fromEntries(entries)) as Record<string, unknown>;
  if (!Object.hasOwn(candidate, "kind") || typeof candidate.kind !== "string")
    throw new BdpClientRequestError("request must have an operation kind");
  const descriptor = requestDescriptorForCandidate(candidate);

  if (
    Reflect.ownKeys(candidate).some(
      (key) => typeof key !== "string" || !descriptor.allowedFields.includes(key),
    )
  )
    throw new BdpClientRequestError("request contains fields not allowed for its operation kind");

  for (const field of descriptor.requiredUrlFields) {
    if (!Object.hasOwn(candidate, field) || typeof candidate[field] !== "string")
      throw new BdpClientRequestError("request is missing a required URL field");
  }
  for (const field of [
    "continuation",
    "type",
    "conformsTo",
    "source",
    "target",
    "endpoint",
    "selector",
  ]) {
    if (
      Object.hasOwn(candidate, field) &&
      candidate[field] !== undefined &&
      typeof candidate[field] !== "string"
    )
      throw new BdpClientRequestError("request URL and selector fields must be strings");
  }

  const limit = Object.hasOwn(candidate, "limit") ? candidate.limit : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) <= 0))
    throw new BdpClientRequestError("limit must be a positive safe integer");
  const direction = Object.hasOwn(candidate, "direction") ? candidate.direction : undefined;
  if (descriptor.validatesDirection === true && direction !== undefined) {
    if (direction !== "inbound" && direction !== "outbound" && direction !== "both")
      throw new BdpClientRequestError("direction must be inbound, outbound, or both");
  }
  const continuation = Object.hasOwn(candidate, "continuation")
    ? candidate.continuation
    : undefined;
  if (continuation !== undefined) {
    if (descriptor.continuationIncompatibleFields.some((field) => Object.hasOwn(candidate, field)))
      throw new BdpClientRequestError("continuation requests must not repeat predicates or limit");
  }
  return candidate as unknown as Request;
}

function readRequestUrl(
  request: ScopeReadOperation,
  scope: AbsoluteHttpUrl,
  discovery: ReadDiscovery,
  externalTypeDescriptorIds: ReadonlySet<string>,
): AbsoluteHttpUrl | ReadProblem {
  return visitReadRequest<AbsoluteHttpUrl | ReadProblem>(request, {
    "scope-discovery": () => {
      throw new TypeError("Scope discovery does not have a Read operation URL");
    },
    "collection:beads": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "collection:links": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "collection:types": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "resource:bead": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource),
    "resource:link": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource),
    "resource:type": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource, externalTypeDescriptorIds),
    "properties:bead": (propertiesRequest) => propertiesUrl(propertiesRequest, scope),
    "properties:link": (propertiesRequest) => propertiesUrl(propertiesRequest, scope),
    "bead-links": (beadLinksRequest) => beadLinksUrl(beadLinksRequest, scope),
  });
}

function collectionRequestUrl(
  request: BeadCollectionRequest | LinkCollectionRequest | TypeInventoryRequest,
  scope: AbsoluteHttpUrl,
  discovery: ReadDiscovery,
): AbsoluteHttpUrl | ReadProblem {
  if (Object.hasOwn(request, "continuation") && request.continuation !== undefined)
    return confinedUrl(scope, request.continuation);
  return collectionUrl(request, discovery);
}

function propertiesUrl(
  request: ReadRequestVariantMap["properties:bead" | "properties:link"],
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadProblem {
  const id = resourceUrl(scope, request.id, request.resource);
  return typeof id !== "string" ? id : appendQuery(id, { view: "properties" });
}

function beadLinksUrl(
  request: ReadRequestVariantMap["bead-links"],
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadProblem {
  const bead = resourceUrl(scope, request.bead, "bead");
  if (typeof bead !== "string") return bead;
  if (Object.hasOwn(request, "continuation") && request.continuation !== undefined)
    return confinedUrl(scope, request.continuation);
  return appendQuery(bead, {
    view: "links",
    direction: Object.hasOwn(request, "direction") ? (request.direction ?? "both") : "both",
    ...(Object.hasOwn(request, "limit") && request.limit !== undefined
      ? { limit: String(request.limit) }
      : {}),
  });
}

function resourceUrl(
  scope: AbsoluteHttpUrl,
  candidate: AbsoluteHttpUrl,
  resource: "bead" | "link" | "type",
  externalTypeDescriptorIds: ReadonlySet<string> = new Set<string>(),
): AbsoluteHttpUrl | ReadProblem {
  let parsed: AbsoluteHttpUrl;
  try {
    parsed = parseCanonicalHttpUrl(candidate, `${resource} Resource URL`);
  } catch {
    return readProblem("invalid-parameter", `the requested ${resource} URL is invalid`);
  }
  if (resource === "type") {
    const typeUrl = new URL(parsed);
    if (!isWithinScope(scope, typeUrl) && !externalTypeDescriptorIds.has(parsed))
      throw new BdpClientCapabilityError(
        "external Type Descriptor retrieval requires a configured safe-fetch policy",
      );
    return parsed;
  }
  const confined = confinedUrl(scope, candidate);
  if (typeof confined !== "string") return confined;
  try {
    const localId = parsed.slice(scope.length);
    if (resolveCanonicalLocalResourceId(scope, resource, localId) !== parsed)
      throw new Error("Resource identity did not resolve canonically");
  } catch {
    return readProblem(
      "invalid-parameter",
      `the requested URL is not a canonical ${resource} Resource ID`,
    );
  }
  return confined;
}

function isWithinScope(scope: AbsoluteHttpUrl, candidate: URL): boolean {
  const root = new URL(scope);
  return candidate.origin === root.origin && candidate.pathname.startsWith(root.pathname);
}

function isWithinScopeAlias(scope: AbsoluteHttpUrl, candidate: URL): boolean {
  const root = new URL(scope);
  if (candidate.origin !== root.origin) return false;
  const candidatePath = normalizePathPercentEncoding(candidate.pathname);
  const rootPath = normalizePathPercentEncoding(root.pathname);
  if (candidatePath === undefined || rootPath === undefined) return isWithinScope(scope, candidate);
  return candidatePath.startsWith(rootPath);
}

function normalizePathPercentEncoding(pathname: string): string | undefined {
  let normalized = "";
  for (let index = 0; index < pathname.length; index += 1) {
    const character = pathname[index];
    if (character !== "%") {
      normalized += character;
      continue;
    }
    const digits = pathname.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(digits)) return undefined;
    const byte = Number.parseInt(digits, 16);
    const decoded = String.fromCharCode(byte);
    normalized += /^[A-Za-z0-9._~-]$/.test(decoded) ? decoded : `%${digits.toUpperCase()}`;
    index += 2;
  }
  return normalized;
}

class ReadResponseValidationError extends Error {}

type ReadBodyValidationResult =
  | { readonly kind: "success"; readonly body: unknown }
  | { readonly kind: "problem"; readonly problem: ReadProblem };

function validateReadBody(
  request: ReadRequest,
  body: unknown,
  scope: AbsoluteHttpUrl,
  continuation: ContinuationContext | undefined,
): ReadBodyValidationResult {
  try {
    return visitReadRequest<ReadBodyValidationResult>(request, {
      "scope-discovery": () => ({ kind: "success", body: parseReadDiscovery(body) }),
      "collection:beads": () => ({
        kind: "success",
        body: validateBeadCollection(parseBeadCollection(body), scope),
      }),
      "collection:links": () => ({
        kind: "success",
        body: validateLinkCollection(parseLinkCollection(body), scope),
      }),
      "collection:types": () => ({
        kind: "success",
        body: validateTypeInventory(parseTypeInventory(body), scope),
      }),
      "resource:bead": (resourceRequest) => ({
        kind: "success",
        body: validateBeadSingleton(parseBeadRecord(body), resourceRequest.id, scope),
      }),
      "resource:link": (resourceRequest) => ({
        kind: "success",
        body: validateLinkSingleton(parseLinkRecord(body), resourceRequest.id, scope),
      }),
      "resource:type": (resourceRequest) => {
        const descriptor = parseTypeDescriptor(body);
        if (descriptor.id !== resourceRequest.id)
          throw new ReadResponseValidationError("wrong Type ID");
        return { kind: "success", body: descriptor };
      },
      "properties:bead": () => ({ kind: "success", body: parsePropertiesRecord(body) }),
      "properties:link": () => ({ kind: "success", body: parsePropertiesRecord(body) }),
      "bead-links": () => {
        if (continuation?.kind !== "bead-links")
          throw new ReadResponseValidationError("missing incident-Link continuation context");
        return {
          kind: "success",
          body: validateIncidentLinkCollection(
            parseLinkCollection(body),
            continuation.bead,
            continuation.direction,
            scope,
          ),
        };
      },
    });
  } catch (error) {
    if (error instanceof BdpClientLocalError) throw error;
    if (
      !(error instanceof ProtocolArtifactValidationError) &&
      !(error instanceof ReadResponseValidationError)
    )
      throw error;
    return {
      kind: "problem",
      problem: readProblem(
        "temporarily-unavailable",
        "the server returned a structurally invalid Read response",
      ),
    };
  }
}

function validateNext(next: AbsoluteHttpUrl | null, scope: AbsoluteHttpUrl): void {
  if (next !== null && typeof confinedUrl(scope, next) !== "string")
    throw new ReadResponseValidationError("collection next escaped the Scope");
}

function validateBeadCollection(page: BeadCollection, scope: AbsoluteHttpUrl): BeadCollection {
  validateNext(page.next, scope);
  return Object.freeze({
    ...page,
    items: Object.freeze(page.items.map((item) => validateBeadRecord(item, scope))),
  });
}

function validateLinkCollection(page: LinkCollection, scope: AbsoluteHttpUrl): LinkCollection {
  validateNext(page.next, scope);
  return Object.freeze({
    ...page,
    items: Object.freeze(page.items.map((item) => validateLinkRecord(item, scope))),
  });
}

function validateIncidentLinkCollection(
  page: LinkCollection,
  bead: AbsoluteHttpUrl,
  direction: "inbound" | "outbound" | "both",
  scope: AbsoluteHttpUrl,
): LinkCollection {
  const validated = validateLinkCollection(page, scope);
  for (const link of validated.items) {
    const outbound = referenceUri(link.source) === bead;
    const inbound = referenceUri(link.target) === bead;
    if (
      (direction === "inbound" && !inbound) ||
      (direction === "outbound" && !outbound) ||
      (direction === "both" && !inbound && !outbound)
    )
      throw new ReadResponseValidationError(
        "incident-Link response contains a Link unrelated to the requested Bead or direction",
      );
  }
  return validated;
}

function validateTypeInventory(page: TypeInventory, scope: AbsoluteHttpUrl): TypeInventory {
  validateNext(page.next, scope);
  return page;
}

function validateBeadSingleton(
  record: BeadRecord,
  requestedId: AbsoluteHttpUrl,
  scope: AbsoluteHttpUrl,
): BeadRecord {
  if (record.id !== requestedId) throw new ReadResponseValidationError("wrong Bead ID");
  return validateBeadRecord(record, scope);
}

function validateLinkSingleton(
  record: LinkRecord,
  requestedId: AbsoluteHttpUrl,
  scope: AbsoluteHttpUrl,
): LinkRecord {
  if (record.id !== requestedId) throw new ReadResponseValidationError("wrong Link ID");
  return validateLinkRecord(record, scope);
}

function validateBeadRecord(record: BeadRecord, scope: AbsoluteHttpUrl): BeadRecord {
  if (typeof resourceUrl(scope, record.id, "bead") !== "string")
    throw new ReadResponseValidationError("invalid Bead ID");
  if (record.links !== undefined)
    throw new ReadResponseValidationError("unexpected embedded Links");
  return record;
}

function validateLinkRecord(record: LinkRecord, scope: AbsoluteHttpUrl): LinkRecord {
  if (typeof resourceUrl(scope, record.id, "link") !== "string")
    throw new ReadResponseValidationError("invalid Link ID");
  const sourceInScope = validateEndpoint(record.source, scope);
  const targetInScope = validateEndpoint(record.target, scope);
  if (!sourceInScope && !targetInScope)
    throw new ReadResponseValidationError("a Link must have an in-Scope endpoint");
  return record;
}

function validateEndpoint(endpoint: LinkRecord["source"], scope: AbsoluteHttpUrl): boolean {
  // In-Scope or external is derived, never declared: an endpoint URI that is
  // (an alias of) this Scope claims an in-Scope Bead and must be canonical;
  // every other URI is an opaque external reference.
  const uri = referenceUri(endpoint);
  let claimsScope = false;
  try {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
    const normalized = scheme === "http" || scheme === "https" ? new URL(uri) : undefined;
    claimsScope = normalized !== undefined && isWithinScopeAlias(scope, normalized);
  } catch {
    // Schema validation already proved this is an absolute URI. Some opaque URI
    // spellings are deliberately outside WHATWG URL representation.
  }
  if (!claimsScope) return false;
  let canonicalEndpoint: AbsoluteHttpUrl;
  try {
    canonicalEndpoint = parseCanonicalHttpUrl(uri, "Link endpoint ID");
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ReadResponseValidationError("in-Scope endpoint is not canonical");
    throw error;
  }
  const localId = canonicalEndpoint.slice(scope.length);
  let resolvedEndpoint: AbsoluteHttpUrl;
  try {
    resolvedEndpoint = resolveCanonicalLocalResourceId(scope, "bead", localId);
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ReadResponseValidationError("endpoint is not a canonical in-Scope Bead ID");
    throw error;
  }
  if (resolvedEndpoint !== canonicalEndpoint)
    throw new ReadResponseValidationError("endpoint is not a canonical in-Scope Bead ID");
  return true;
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

function confinedUrl(
  scope: AbsoluteHttpUrl,
  candidate: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadProblem {
  try {
    const expected = new URL(scope);
    const actual = new URL(candidate);
    const prefix = expected.pathname.endsWith("/") ? expected.pathname : `${expected.pathname}/`;
    if (
      actual.origin !== expected.origin ||
      !actual.pathname.startsWith(prefix) ||
      actual.username !== "" ||
      actual.password !== "" ||
      actual.hash !== ""
    )
      return readProblem("forbidden", "the requested URL is outside the configured Scope");
    parseCanonicalHttpUrl(candidate, "Scoped URL");
    return actual.href;
  } catch {
    return readProblem("invalid-parameter", "the requested URL is invalid");
  }
}

function collectionUrl(
  request: BeadCollectionRequest | LinkCollectionRequest | TypeInventoryRequest,
  discovery: ReadDiscovery,
): AbsoluteHttpUrl {
  const root =
    request.collection === "beads"
      ? discovery.beads
      : request.collection === "links"
        ? discovery.links
        : discovery.types;
  const parameters: Record<string, string> = {};
  for (const key of ["type", "conformsTo", "source", "target", "endpoint", "selector"] as const) {
    const value = Object.hasOwn(request, key)
      ? (request as unknown as Record<string, unknown>)[key]
      : undefined;
    if (typeof value === "string") parameters[key] = value;
  }
  if (Object.hasOwn(request, "limit") && request.limit !== undefined)
    parameters.limit = String(request.limit);
  return appendQuery(root, parameters);
}

function appendQuery(url: AbsoluteHttpUrl, parameters: Readonly<Record<string, string>>): string {
  const parsed = new URL(url);
  for (const [name, value] of Object.entries(parameters)) parsed.searchParams.set(name, value);
  return parsed.href;
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

export type { AbsoluteHttpUrl, ReadDiscovery, ReadProblem, ReadRequest, ReadResultFor };
