import {
  type AdmittedJsonValue,
  admitJsonNumbers,
  decodeJsonDocument,
  isUnicodeScalarString,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
} from "@bdp/protocol";

/** Local client budgets, not advertised server limits or protocol defaults. */
export interface ReadUpdateTransportLimits {
  readonly requestBodyBytes: number;
  readonly responseBodyBytes: number;
  readonly responseTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
}
export interface ReadUpdateFetchTransportOptions {
  readonly scope: string;
  readonly limits: ReadUpdateTransportLimits;
  /** Must return a Response whose url is the requested URL, including custom
   * implementations that reconstruct a native Response (whose default url is empty). */
  readonly fetchImplementation?: typeof fetch;
  /** Called per exchange, only for URLs confined to this configured Scope. */
  readonly credential?: (signal: AbortSignal) => string | undefined | Promise<string | undefined>;
}
export interface ReadUpdateTransportCallOptions {
  readonly signal?: AbortSignal;
}
export interface ReadUpdateTransportPostOptions extends ReadUpdateTransportCallOptions {
  /** Sent unchanged as UTF-8. This transport does not normalize or admit operations. */
  readonly bodyText: string;
  /** Singleton field. Omit for sequence; the operation layer owns that distinction. */
  readonly idempotencyKey?: string;
}
export type ReadUpdateTransportErrorCode =
  | "invalid-input"
  | "aborted"
  | "timeout"
  | "network"
  | "redirect"
  | "invalid-response"
  | "response-too-large";

/** No raw request, key, token, response body or external error cause is retained.
 * Submission describes a mutation dispatch; GET failures remain not-submitted.
 * Received media/Retry-After are context only, never a retry or commit guarantee.
 */
export class ReadUpdateTransportError extends Error {
  override readonly name = "ReadUpdateTransportError";
  constructor(
    readonly code: ReadUpdateTransportErrorCode,
    readonly submission: "not-submitted" | "unknown",
    readonly httpStatus?: number,
    readonly contentType?: string | null,
    readonly retryAfter?: string | null,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(`Read+Update transport ${code} (${submission})`);
  }
}

export interface ReadUpdateHttpContext {
  readonly status: number;
  readonly url: string;
  readonly contentType: string | null;
  /** Uninterpreted received Retry-After; not a synthesized member retryAfter. */
  readonly retryAfter: string | null;
  /** Selected response metadata only; excludes cookies and credential fields.
   * Browser CORS filtering may hide fields: absence here cannot distinguish an
   * absent server header from a header the browser does not expose. */
  readonly headers: Readonly<Record<string, string>>;
}
export type ReadUpdateHttpResponse = ReadUpdateHttpContext &
  ({ readonly kind: "json"; readonly body: AdmittedJsonValue } | { readonly kind: "empty" });
export type ReadUpdateScopeProbeResponse =
  | ReadUpdateHttpResponse
  | (ReadUpdateHttpContext & { readonly kind: "scope-probe" });
export type ReadUpdateAliasResponse =
  | ReadUpdateHttpResponse
  | (ReadUpdateHttpContext & { readonly kind: "alias-redirect" });
export interface ReadUpdateTransport {
  /** Discover through Link metadata; a successful Scope body is never discovery JSON. */
  probeScope(options?: ReadUpdateTransportCallOptions): Promise<ReadUpdateScopeProbeResponse>;
  get(url: string, options?: ReadUpdateTransportCallOptions): Promise<ReadUpdateHttpResponse>;
  post(url: string, options: ReadUpdateTransportPostOptions): Promise<ReadUpdateHttpResponse>;
  /** One-hop alias response only; the caller validates Location and never implicitly follows it. */
  resolveAlias?(
    url: string,
    options?: ReadUpdateTransportCallOptions,
  ): Promise<ReadUpdateAliasResponse>;
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

/** First transport slice only. It interprets HTTP framing/JSON, not operation
 * outcomes, profile discovery, Problem code/status correspondence or retry policy.
 * A returned HTTP fault is not proof that a mutation did not commit.
 */
export function createReadUpdateFetchTransport(
  options: ReadUpdateFetchTransportOptions,
): ReadUpdateTransport {
  const failInput = (): never => {
    throw new ReadUpdateTransportError("invalid-input", "not-submitted");
  };
  let scope: string;
  let limits: ReadUpdateTransportLimits;
  let fetchImplementation: typeof fetch;
  let credential: ReadUpdateFetchTransportOptions["credential"];
  try {
    scope = parseCanonicalScope(options.scope);
    const suppliedLimits = options.limits;
    limits = Object.freeze({
      requestBodyBytes: suppliedLimits.requestBodyBytes,
      responseBodyBytes: suppliedLimits.responseBodyBytes,
      responseTimeoutMs: suppliedLimits.responseTimeoutMs,
      cleanupTimeoutMs: suppliedLimits.cleanupTimeoutMs,
    });
    fetchImplementation = options.fetchImplementation ?? fetch;
    credential = options.credential;
  } catch {
    return failInput();
  }
  const scopeUrl = new URL(scope);
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) return failInput();
    if (key.endsWith("Ms") && value > MAX_TIMER_MS) return failInput();
  }
  if (typeof fetchImplementation !== "function") return failInput();
  if (credential !== undefined && typeof credential !== "function") return failInput();

  function exchange(
    method: "GET" | "POST",
    urlInput: string,
    call: ReadUpdateTransportCallOptions | ReadUpdateTransportPostOptions,
  ): Promise<ReadUpdateHttpResponse>;
  function exchange(
    method: "GET",
    urlInput: string,
    call: ReadUpdateTransportCallOptions,
    mode: "scope-probe",
  ): Promise<ReadUpdateScopeProbeResponse>;
  function exchange(
    method: "GET",
    urlInput: string,
    call: ReadUpdateTransportCallOptions,
    mode: "alias",
  ): Promise<ReadUpdateAliasResponse>;
  async function exchange(
    method: "GET" | "POST",
    urlInput: string,
    call: ReadUpdateTransportCallOptions | ReadUpdateTransportPostOptions,
    mode?: "scope-probe" | "alias",
  ): Promise<ReadUpdateScopeProbeResponse | ReadUpdateAliasResponse> {
    const scopeProbe = mode === "scope-probe";
    let submitted = false;
    let status: number | undefined;
    let contentType: string | null | undefined;
    let retryAfter: string | null | undefined;
    let responseHeaders: Readonly<Record<string, string>> | undefined;
    const localErrors = new WeakSet<ReadUpdateTransportError>();
    const error = (code: ReadUpdateTransportErrorCode) => {
      const failure = new ReadUpdateTransportError(
        code,
        submitted ? "unknown" : "not-submitted",
        status,
        contentType,
        retryAfter,
        responseHeaders,
      );
      localErrors.add(failure);
      return failure;
    };
    let url: string;
    let body: Uint8Array | undefined;
    let key: string | undefined;
    let callerSignal: AbortSignal | undefined;
    try {
      url = parseCanonicalHttpUrl(urlInput);
      const parsed = new URL(url);
      if (parsed.origin !== scopeUrl.origin || !parsed.pathname.startsWith(scopeUrl.pathname))
        throw error("invalid-input");
      callerSignal = call.signal;
      if (callerSignal !== undefined && !(callerSignal instanceof AbortSignal))
        throw error("invalid-input");
      if (method === "POST") {
        const post = call as ReadUpdateTransportPostOptions;
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
              Promise.resolve().then(() => credential(signal)),
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
        accept: scopeProbe ? "*/*" : "application/json",
      };
      if (token !== undefined) headers.authorization = `Bearer ${token}`;
      if (method === "POST") headers["content-type"] = "application/json";
      if (key !== undefined) headers["idempotency-key"] = key;
      let response: Response;
      try {
        const pending = Promise.resolve().then(async () => {
          checkAbort();
          submitted = method === "POST";
          const received = await fetchImplementation(url, {
            method,
            headers,
            ...(body === undefined ? {} : { body: body as NonNullable<RequestInit["body"]> }),
            signal,
            credentials: "omit",
            // Isolate rotating credentials even from a misconfigured HTTP cache.
            cache: "no-store",
            redirect: "manual",
          });
          if (performance.now() >= expiresAt) deadline.abort();
          if (signal.aborted) {
            await cleanupBody(received, limits.cleanupTimeoutMs);
            throw abortError();
          }
          return received;
        });
        response = await withAbort(pending, signal, abortError);
      } catch {
        if (signal.aborted) throw abortError();
        throw error("network");
      }
      try {
        status = response.status;
        const metadata: Record<string, string> = {};
        const receivedHeaders = response.headers;
        for (const name of RESPONSE_HEADERS) {
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
        const context: ReadUpdateHttpContext = Object.freeze({
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
        const bodyless = aliasRedirect || BODYLESS_STATUSES.has(status);
        const media = context.contentType?.split(";", 1)[0]?.trim().toLowerCase();
        if (!bodyless && media !== "application/json" && media !== "application/problem+json")
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
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
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
        return Object.freeze({ ...context, kind: "json", body: value });
      } catch (cause) {
        await cleanupBody(response, limits.cleanupTimeoutMs);
        if (cause instanceof ReadUpdateTransportError && localErrors.has(cause)) throw cause;
        if (signal.aborted) throw abortError();
        throw error("invalid-response");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    probeScope: (call: ReadUpdateTransportCallOptions = {}) =>
      exchange("GET", scope, call, "scope-probe"),
    get: (url: string, call: ReadUpdateTransportCallOptions = {}) => exchange("GET", url, call),
    post: (url: string, call: ReadUpdateTransportPostOptions) => exchange("POST", url, call),
    resolveAlias: (url: string, call: ReadUpdateTransportCallOptions = {}) =>
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
  limits: ReadUpdateTransportLimits,
  signal: AbortSignal,
  abortError: () => Error,
  error: (code: ReadUpdateTransportErrorCode) => Error,
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
