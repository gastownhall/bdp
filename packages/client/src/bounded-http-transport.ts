import {
  type AdmittedJsonValue,
  admitJsonNumbers,
  decodeJsonDocument,
  isUnicodeScalarString,
  parseCanonicalHttpUrl,
} from "@bdp/protocol";

/** Shared bounded HTTP IO. Protocol selection, target admission and credentials
 * are captured policies; the legacy and retained clients use this same engine.
 */
export interface BoundedHttpLimits {
  readonly requestBodyBytes: number;
  readonly responseBodyBytes: number;
  readonly responseTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
}
export interface BoundedHttpCallOptions {
  readonly signal?: AbortSignal;
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
  readonly ifUnmodifiedSince?: string;
}
export interface BoundedHttpPostOptions extends BoundedHttpCallOptions {
  readonly bodyText: string;
  readonly idempotencyKey?: string;
}
export type BoundedHttpErrorCode =
  | "invalid-input"
  | "aborted"
  | "timeout"
  | "network"
  | "redirect"
  | "invalid-response"
  | "response-too-large";
/** Snapshot at the end of the bounded dispatched-fetch abort phase. A settled
 * cancellation attempt may fail; reaching the cap never proves physical close.
 */
export interface BoundedAbortSettlement {
  readonly status: "settled" | "cap-exceeded";
  readonly bodyCancellation: "not-acquired" | "not-needed" | "pending" | "completed" | "failed";
}
export class BoundedHttpTransportError extends Error {
  override readonly name: string = "BoundedHttpTransportError";
  constructor(
    readonly code: BoundedHttpErrorCode,
    readonly submission: "not-submitted" | "unknown",
    readonly httpStatus?: number,
    readonly contentType?: string | null,
    readonly retryAfter?: string | null,
    readonly headers?: Readonly<Record<string, string>>,
    readonly abortSettlement?: BoundedAbortSettlement,
  ) {
    super(`HTTP transport ${code} (${submission})`);
  }
}
export interface BoundedHttpContext {
  readonly status: number;
  readonly url: string;
  readonly contentType: string | null;
  readonly retryAfter: string | null;
  readonly headers: Readonly<Record<string, string>>;
}
export type BoundedHttpResponse = BoundedHttpContext &
  (
    | {
        readonly kind: "json";
        readonly body: AdmittedJsonValue;
        readonly bodyText?: string;
        readonly bodyBytes?: Uint8Array;
      }
    | { readonly kind: "empty" }
  );
export type BoundedScopeProbeResponse =
  | BoundedHttpResponse
  | (BoundedHttpContext & { readonly kind: "scope-probe" });
export type BoundedAliasResponse =
  | BoundedHttpResponse
  | (BoundedHttpContext & { readonly kind: "alias-redirect" });
export interface BoundedHttpTransport {
  probeScope(url: string, options?: BoundedHttpCallOptions): Promise<BoundedScopeProbeResponse>;
  get(url: string, options?: BoundedHttpCallOptions): Promise<BoundedHttpResponse>;
  head(url: string, options?: BoundedHttpCallOptions): Promise<BoundedHttpResponse>;
  post(url: string, options: BoundedHttpPostOptions): Promise<BoundedHttpResponse>;
  resolveAlias(url: string, options?: BoundedHttpCallOptions): Promise<BoundedAliasResponse>;
}
export interface BoundedFetchOptions {
  readonly limits: BoundedHttpLimits;
  readonly fetchImplementation?: typeof fetch;
  readonly credentialForTarget?: (
    url: string,
    signal: AbortSignal,
  ) => string | undefined | Promise<string | undefined>;
  readonly validateTarget: (url: string) => void;
  readonly mediaType: string;
  readonly captureNativeBody?: boolean;
  readonly validateEmptyMedia?: boolean;
  readonly allowConditionals?: boolean;
  readonly responseHeaderNames?: readonly string[];
  readonly makeError: (
    ...args: ConstructorParameters<typeof BoundedHttpTransportError>
  ) => BoundedHttpTransportError;
}
const MAX_TIMER_MS = 2_147_483_647;
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "link",
  "etag",
  "location",
  "retry-after",
  "cache-control",
  "www-authenticate",
  "allow",
] as const;
const BODYLESS_STATUSES = new Set([204, 304, 405, 406, 412, 500]);

export function createBoundedFetchTransport(options: BoundedFetchOptions): BoundedHttpTransport {
  const makeError = options.makeError;
  const failInput = (): never => {
    throw makeError("invalid-input", "not-submitted");
  };
  let limits: BoundedHttpLimits;
  let fetchImplementation: typeof fetch;
  let credential: BoundedFetchOptions["credentialForTarget"];
  let validateTarget: BoundedFetchOptions["validateTarget"];
  let mediaType: string;
  let captureNativeBody: boolean;
  let validateEmptyMedia: boolean;
  let allowConditionals: boolean;
  let responseHeaderNames: readonly string[];
  try {
    const supplied = options.limits;
    limits = Object.freeze({
      requestBodyBytes: supplied.requestBodyBytes,
      responseBodyBytes: supplied.responseBodyBytes,
      responseTimeoutMs: supplied.responseTimeoutMs,
      cleanupTimeoutMs: supplied.cleanupTimeoutMs,
    });
    fetchImplementation = options.fetchImplementation ?? fetch;
    credential = options.credentialForTarget;
    validateTarget = options.validateTarget;
    mediaType = options.mediaType;
    captureNativeBody = options.captureNativeBody === true;
    validateEmptyMedia = options.validateEmptyMedia === true;
    allowConditionals = options.allowConditionals === true;
    responseHeaderNames = Object.freeze([...(options.responseHeaderNames ?? RESPONSE_HEADERS)]);
  } catch {
    return failInput();
  }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || (key.endsWith("Ms") && value > MAX_TIMER_MS))
      return failInput();
  }
  if (
    typeof fetchImplementation !== "function" ||
    typeof validateTarget !== "function" ||
    typeof mediaType !== "string" ||
    !mediaType ||
    (credential !== undefined && typeof credential !== "function")
  )
    return failInput();

  function exchange(
    method: "GET" | "HEAD" | "POST",
    urlInput: string,
    call: BoundedHttpCallOptions | BoundedHttpPostOptions,
  ): Promise<BoundedHttpResponse>;
  function exchange(
    method: "GET",
    urlInput: string,
    call: BoundedHttpCallOptions,
    mode: "scope-probe",
  ): Promise<BoundedScopeProbeResponse>;
  function exchange(
    method: "GET",
    urlInput: string,
    call: BoundedHttpCallOptions,
    mode: "alias",
  ): Promise<BoundedAliasResponse>;
  async function exchange(
    method: "GET" | "HEAD" | "POST",
    urlInput: string,
    call: BoundedHttpCallOptions | BoundedHttpPostOptions,
    mode?: "scope-probe" | "alias",
  ): Promise<BoundedScopeProbeResponse | BoundedAliasResponse> {
    const scopeProbe = mode === "scope-probe";
    let submitted = false;
    let status: number | undefined;
    let contentType: string | null | undefined;
    let retryAfter: string | null | undefined;
    let responseHeaders: Readonly<Record<string, string>> | undefined;
    const localErrors = new WeakSet<BoundedHttpTransportError>();
    let abortSettlement: BoundedAbortSettlement | undefined;
    const error = (code: BoundedHttpErrorCode) => {
      const failure = makeError(
        code,
        submitted ? "unknown" : "not-submitted",
        status,
        contentType,
        retryAfter,
        responseHeaders,
        abortSettlement,
      );
      localErrors.add(failure);
      return failure;
    };
    let url: string;
    let body: Uint8Array | undefined;
    let key: string | undefined;
    let callerSignal: AbortSignal | undefined;
    const conditionalHeaders: Record<string, string> = {};
    try {
      url = parseCanonicalHttpUrl(urlInput);
      validateTarget(url);
      callerSignal = call.signal;
      if (allowConditionals)
        for (const [field, header] of [
          ["ifMatch", "if-match"],
          ["ifNoneMatch", "if-none-match"],
          ["ifModifiedSince", "if-modified-since"],
          ["ifUnmodifiedSince", "if-unmodified-since"],
        ] as const) {
          const value = call[field];
          if (value !== undefined) {
            if (typeof value !== "string" || !/^[\t\x20-\x7e]+$/.test(value))
              throw error("invalid-input");
            conditionalHeaders[header] = value;
          }
        }
      if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal))
        throw error("invalid-input");
      if (method === "POST") {
        const post = call as BoundedHttpPostOptions;
        const text = post.bodyText;
        key = post.idempotencyKey;
        if (typeof text !== "string" || !isUnicodeScalarString(text)) throw error("invalid-input");
        if (
          key !== undefined &&
          (typeof key !== "string" ||
            key.length < 1 ||
            key.length > 256 ||
            /[^A-Za-z0-9_-]/.test(key))
        )
          throw error("invalid-input");
        // UTF-8 needs at least one byte per UTF-16 code unit. Avoid allocating
        // an already-provably oversized buffer, then enforce the exact count.
        if (text.length > limits.requestBodyBytes) throw error("invalid-input");
        body = new TextEncoder().encode(text);
        if (body.byteLength > limits.requestBodyBytes) throw error("invalid-input");
      }
    } catch {
      throw error("invalid-input");
    }
    if (callerSignal?.aborted) throw error("aborted");
    const deadline = new AbortController();
    const expiresAt = performance.now() + limits.responseTimeoutMs;
    const timer = setTimeout(() => deadline.abort(), limits.responseTimeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, deadline.signal])
      : deadline.signal;
    const abortError = () => error(callerSignal?.aborted ? "aborted" : "timeout");
    // A stream can continually settle reads in microtasks and starve timers.
    // Check elapsed time as well; this is the caller's deadline, not a wire cap.
    const checkAbort = () => {
      if (performance.now() >= expiresAt) deadline.abort();
      if (signal.aborted) throw abortError();
    };
    try {
      let token: string | undefined;
      try {
        token = credential
          ? await withAbort(
              Promise.resolve().then(() => credential(url, signal)),
              signal,
              abortError,
            )
          : undefined;
      } catch {
        if (signal.aborted) throw abortError();
        throw error("invalid-input");
      }
      checkAbort();
      if (
        token !== undefined &&
        (typeof token !== "string" || /^[A-Za-z0-9\-._~+/]+=*$/.exec(token)?.[0] !== token)
      )
        throw error("invalid-input");
      const headers: Record<string, string> = {
        accept: scopeProbe ? "*/*" : mediaType,
        ...conditionalHeaders,
      };
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      if (method === "POST") headers["content-type"] = mediaType;
      if (key !== undefined) headers["idempotency-key"] = key;
      let response: Response;
      let settlementEnd: number | undefined;
      const cancellationState = {
        value: "not-acquired" as BoundedAbortSettlement["bodyCancellation"],
      };
      const remainingSettlement = () => {
        settlementEnd ??= performance.now() + limits.cleanupTimeoutMs;
        return Math.max(0, settlementEnd - performance.now());
      };
      // Keep this dispatched continuation owned and rejection-observed even
      // after abort. Both fetch and late-body cleanup share one finite window.
      const pending = Promise.resolve().then(async () => {
        checkAbort();
        submitted = method === "POST";
        const received = await fetchImplementation(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: body as NonNullable<RequestInit["body"]> }),
          signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "manual",
        });
        if (performance.now() >= expiresAt) deadline.abort();
        if (signal.aborted) {
          cancellationState.value = "pending";
          const cancellation = Promise.resolve()
            .then(async () => {
              if (received.body === null) cancellationState.value = "not-needed";
              else {
                await received.body.cancel();
                cancellationState.value = "completed";
              }
            })
            .catch(() => {
              cancellationState.value = "failed";
            });
          await settleWithin(cancellation, remainingSettlement());
          throw abortError();
        }
        return received;
      });
      try {
        response = await withAbort(pending, signal, abortError);
      } catch {
        if (signal.aborted) {
          // Capture the original cause before waiting; a later caller abort
          // cannot relabel an already observed deadline expiration.
          const code = callerSignal?.aborted ? "aborted" : "timeout";
          const observed = await settleWithin(pending, remainingSettlement());
          abortSettlement = Object.freeze({
            status:
              observed === "settled" && cancellationState.value !== "pending"
                ? "settled"
                : "cap-exceeded",
            bodyCancellation: cancellationState.value,
          });
          throw error(code);
        }
        throw error("network");
      }
      try {
        status = response.status;
        const metadata: Record<string, string> = {};
        const receivedHeaders = response.headers;
        for (const name of responseHeaderNames) {
          const value = receivedHeaders.get(name);
          if (value !== null) metadata[name] = value;
        }
        responseHeaders = Object.freeze(metadata);
        contentType = metadata["content-type"] ?? null;
        retryAfter = metadata["retry-after"] ?? null;
        if (!Number.isInteger(status) || status < 200 || status > 599 || response.url !== url)
          throw error("invalid-response");
        const aliasRedirect = mode === "alias" && status === 307;
        if (status >= 300 && status < 400 && status !== 304 && !aliasRedirect)
          throw error("redirect");
        const context: BoundedHttpContext = Object.freeze({
          status,
          url,
          contentType,
          retryAfter,
          headers: responseHeaders,
        });
        if (scopeProbe && status === 200) {
          // The Scope representation is uninterpreted, even if it claims JSON.
          // Cancellation has its own bounded wait; no body size or parser applies.
          await cleanupBody(response, limits.cleanupTimeoutMs);
          checkAbort();
          return Object.freeze({ ...context, kind: "scope-probe" });
        }
        const bodyless = method === "HEAD" || aliasRedirect || BODYLESS_STATUSES.has(status);
        const media = context.contentType?.split(";", 1)[0]?.trim().toLowerCase();
        if (!bodyless && media !== mediaType && media !== "application/problem+json")
          throw error("invalid-response");
        if (
          validateEmptyMedia &&
          bodyless &&
          !scopeProbe &&
          !aliasRedirect &&
          media !== undefined &&
          media !== (status >= 400 ? "application/problem+json" : mediaType)
        )
          throw error("invalid-response");
        const data = await readBody(
          response,
          limits,
          signal,
          abortError,
          error,
          checkAbort,
          bodyless,
        );
        checkAbort();
        if (bodyless) {
          if (aliasRedirect) return Object.freeze({ ...context, kind: "alias-redirect" });
          if (scopeProbe && status === 204)
            return Object.freeze({ ...context, kind: "scope-probe" });
          return Object.freeze({ ...context, kind: "empty" });
        }
        let value: AdmittedJsonValue;
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(data);
          // Reuse the protocol's exact numeric admission. Its bounded internal
          // refusal is discarded, never exposed as a synthesized BDP Problem.
          const admitted = admitJsonNumbers(decodeJsonDocument(text), {
            diagnostics: 1,
            diagnosticBytes: 64,
            diagnostic: () => ({ message: "invalid response number" }),
          });
          if (!admitted.ok) throw error("invalid-response");
          value = admitted.value;
        } catch {
          throw error("invalid-response");
        }
        checkAbort();
        return Object.freeze({
          ...context,
          kind: "json",
          body: value,
          ...(captureNativeBody ? { bodyText: text, bodyBytes: new Uint8Array(data) } : {}),
        });
      } catch (cause) {
        await cleanupBody(response, limits.cleanupTimeoutMs);
        if (cause instanceof BoundedHttpTransportError && localErrors.has(cause)) throw cause;
        if (signal.aborted) throw abortError();
        throw error("invalid-response");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    probeScope: (url: string, call: BoundedHttpCallOptions = {}) =>
      exchange("GET", url, call, "scope-probe"),
    head: (url: string, call: BoundedHttpCallOptions = {}) => exchange("HEAD", url, call),
    get: (url: string, call: BoundedHttpCallOptions = {}) => exchange("GET", url, call),
    post: (url: string, call: BoundedHttpPostOptions) => exchange("POST", url, call),
    resolveAlias: (url: string, call: BoundedHttpCallOptions = {}) =>
      exchange("GET", url, call, "alias"),
  });
}

function withAbort<T>(pending: Promise<T>, signal: AbortSignal, error: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const detach = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      detach();
      reject(error());
    };
    if (signal.aborted) reject(error());
    else signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        detach();
        resolve(value);
      },
      (cause) => {
        detach();
        reject(cause);
      },
    );
  });
}

/** Observe fulfillment/rejection within the remaining finite settlement window.
 * The promise stays rejection-observed after the cap. Uncooperative custom IO
 * may complete later or never; this is observation, not guaranteed physical close.
 */
async function settleWithin(
  pending: Promise<unknown>,
  timeoutMs: number,
): Promise<"settled" | "cap-exceeded"> {
  const completed = pending.then(
    () => "settled" as const,
    () => "settled" as const,
  );
  if (timeoutMs <= 0) return "cap-exceeded";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      completed,
      new Promise<"cap-exceeded">((resolve) => {
        timer = setTimeout(() => resolve("cap-exceeded"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A custom stream may ignore cancellation. Observe its rejection and stop waiting. */
async function boundedCleanup(action: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(action)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function cleanupBody(response: Response, timeoutMs: number): Promise<void> {
  await boundedCleanup(async () => {
    await response.body?.cancel();
  }, timeoutMs);
}

async function readBody(
  response: Response,
  limits: BoundedHttpLimits,
  signal: AbortSignal,
  abortError: () => Error,
  error: (code: BoundedHttpErrorCode) => Error,
  checkAbort: () => void,
  expectEmpty: boolean,
): Promise<Uint8Array> {
  checkAbort();
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  // One owned backing buffer grows geometrically; no retained object per chunk.
  let bytes = new Uint8Array();
  let length = 0;
  let done = false;
  try {
    for (;;) {
      checkAbort();
      const item = await withAbort(reader.read(), signal, abortError);
      checkAbort();
      if (item.done) {
        done = true;
        break;
      }
      if (!(item.value instanceof Uint8Array)) throw error("invalid-response");
      const chunk = item.value;
      if (expectEmpty && chunk.byteLength !== 0) throw error("invalid-response");
      if (chunk.byteLength > limits.responseBodyBytes - length) throw error("response-too-large");
      const nextLength = length + chunk.byteLength;
      if (nextLength > bytes.byteLength) {
        const grown = new Uint8Array(
          Math.min(limits.responseBodyBytes, Math.max(nextLength, bytes.byteLength * 2)),
        );
        grown.set(bytes);
        bytes = grown;
      }
      // set copies Buffer chunks too; producer reuse cannot mutate accepted bytes.
      bytes.set(chunk, length);
      length = nextLength;
    }
    return bytes.subarray(0, length);
  } finally {
    if (!done) await boundedCleanup(() => reader.cancel(), limits.cleanupTimeoutMs);
    reader.releaseLock();
  }
}
