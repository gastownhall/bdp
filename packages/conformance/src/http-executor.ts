import { createHash } from "node:crypto";
import { connect as connectPlain, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

export type HttpMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpExchangeRequest {
  readonly method: HttpMethod;
  readonly raw?: never;
  readonly credentialRef?: never;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /**
   * Exact request-target octets for socket-level conformance probes. The semantic
   * URL still supplies response identity and the Host header. Fetch executors do
   * not support this field and reject requests that provide it.
   */
  readonly rawRequestTarget?: Uint8Array;
}

/** Explicit, socket-only authored bytes. No JSON or Headers normalization is applied. */
export interface ExactHttpExchangeRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly signal: AbortSignal;
  readonly headers?: never;
  readonly rawRequestTarget?: Uint8Array;
  readonly credentialRef?: string;
  readonly raw: {
    readonly headerLines: readonly RawHeaderLine[];
    readonly bodyBytes?: Uint8Array;
  };
}

export interface RawHeaderLine {
  readonly name: string;
  readonly value: string;
}

export type RequestWriteState = "not-started" | "started-completion-unestablished" | "complete";

export interface ExactRequestObservation {
  readonly source: "raw-http1-serializer";
  /** Transient secret-bearing data, never safe to serialize directly into a report. */
  readonly headerLines: readonly RawHeaderLine[];
  /** Full authored entity metadata, not a claim about a transmitted prefix or server receipt. */
  readonly bodyPresent: boolean;
  readonly bodyOctets: number;
  readonly bodyDigest?: string;
  readonly writeState: RequestWriteState;
}

/** Trusted harness configuration, not portable scenario data or target-supplied authority. */
export interface ExactHttpModeOptions {
  readonly scope: string;
  readonly profile: "read" | "read-update";
  readonly routes: readonly { readonly method: HttpMethod; readonly url: string }[];
  readonly maximumRequestHeaderBytes: number;
  readonly maximumRequestBodyBytes: number;
  readonly defaultCredentialRef: string;
  readonly credentialHandles: readonly {
    readonly id: string;
    /** Empty means a deliberately anonymous handle; names are lower-case. */
    readonly headerNames: readonly string[];
  }[];
  /** Synchronous, trusted nonblocking lookup. Promises/thenables are rejected. */
  readonly resolveCredentials: (
    context: Readonly<{
      scope: string;
      url: string;
      method: HttpMethod;
      credentialRef: string;
      signal: AbortSignal;
    }>,
  ) => Readonly<Record<string, string>>;
}

export type RawHttpExchangeExecutor = (
  request: HttpExchangeRequest | ExactHttpExchangeRequest,
) => Promise<HttpExchangeResponse>;

export interface HttpExchangeResponse {
  readonly exactRequest?: ExactRequestObservation;
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  /** Decoded message-body octets observed below a method-aware HTTP client, when available. */
  readonly bodyOctets?: number;
  /**
   * Exact bounded HTTP/1.x response bytes from status line through framed body.
   * Only the socket-level executor can supply this pre-normalization evidence.
   */
  readonly wireResponseBytes?: Uint8Array;
  /** Effective wire request after authorization/runtime header decoration. */
  readonly effectiveRequest?: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    /** Present only when the reported headers match bytes serialized onto the wire. */
    readonly headersTransmitted?: true;
  };
}

export type HttpExchangeExecutor = (request: HttpExchangeRequest) => Promise<HttpExchangeResponse>;

export type RawHttpDialRoute =
  | {
      readonly transport: "plain";
      readonly host: string;
      readonly port: number;
    }
  | {
      readonly transport: "tls";
      readonly host: string;
      readonly port: number;
      readonly servername?: string;
      readonly ca?: string;
    };

export interface RawHttpExchangeExecutorOptions {
  readonly exactMode?: ExactHttpModeOptions;
  readonly authorize?: (request: HttpExchangeRequest) => Readonly<Record<string, string>>;
  readonly maximumBodyBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumHeaderBytes?: number;
}

export type HttpTransportErrorCategory =
  | "abort"
  | "configuration"
  | "timeout"
  | "disconnect"
  | "header-limit"
  | "body-limit"
  | "invalid-body"
  | "network";

export class HttpTransportError extends Error {
  constructor(
    readonly category: HttpTransportErrorCategory,
    message: string,
    options: ErrorOptions = {},
    readonly requestWriteState?: RequestWriteState,
  ) {
    super(message, options);
    this.name = "HttpTransportError";
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_MAXIMUM_HEADER_BYTES = 65_536;
const MAXIMUM_RAW_REQUEST_TARGET_BYTES = 8_192;

/**
 * Socket-level executor for evidence that a method-aware Fetch/HTTP client would erase.
 * The semantic request URL remains canonical while the explicit route selects only the
 * network peer used to observe it.
 */
export function createRawHttpExchangeExecutor(
  dialRoute: RawHttpDialRoute,
  options: RawHttpExchangeExecutorOptions = {},
): RawHttpExchangeExecutor {
  const route = snapshotDialRoute(dialRoute);
  const exactMode =
    options.exactMode === undefined ? undefined : snapshotExactHttpMode(options.exactMode);
  const {
    authorize,
    maximumBodyBytes = 1_048_576,
    requestTimeoutMs = 30_000,
    maximumHeaderBytes = DEFAULT_MAXIMUM_HEADER_BYTES,
  } = Object.freeze({ ...options });
  if (authorize !== undefined && typeof authorize !== "function")
    throw new TypeError("authorize must be a function when present");
  requirePositiveBound(maximumBodyBytes, "maximumBodyBytes");
  requireTimerBound(requestTimeoutMs);
  requirePositiveBound(maximumHeaderBytes, "maximumHeaderBytes");
  return async (request) => {
    if (isExactRequest(request))
      return executeExact(
        request,
        route,
        exactMode,
        requestTimeoutMs,
        maximumHeaderBytes,
        maximumBodyBytes,
      );
    if (request.headers === undefined || request.credentialRef !== undefined)
      throw new HttpTransportError("configuration", "ordinary HTTP request headers are required");
    const ordinary = request;
    const url = parseExecutorUrl(request.url);
    const requestTarget = encodeRequestTarget(request.rawRequestTarget, url);
    const headers = effectiveHeaders(ordinary, authorize);
    headers.set("host", url.host);
    headers.set("connection", "close");
    const requestHead = Buffer.concat([
      Buffer.from(`${request.method} `, "ascii"),
      requestTarget,
      Buffer.from(
        ` HTTP/1.1\r\n${[...headers.entries()]
          .map(([name, value]) => `${canonicalHeaderName(name)}: ${value}`)
          .join("\r\n")}\r\n\r\n`,
        "latin1",
      ),
    ]);
    const rawResponse = await exchangeRawBytes(
      route,
      requestHead,
      request.method,
      request.signal,
      requestTimeoutMs,
      maximumHeaderBytes,
      maximumBodyBytes,
    );
    const parsed = parseRawResponse(
      rawResponse.bytes,
      request.method,
      maximumHeaderBytes,
      maximumBodyBytes,
    );
    return {
      url: request.url,
      status: parsed.status,
      headers: parsed.headers,
      bodyText: parsed.bodyText,
      bodyOctets: parsed.bodyOctets,
      wireResponseBytes: Uint8Array.from(rawResponse.bytes),
      effectiveRequest: {
        url: request.url,
        headers: Object.fromEntries(headers.entries()),
        headersTransmitted: true,
      },
    };
  };
}

/**
 * Fetch adapter for the conformance seam. It preserves status, headers, URL,
 * and raw body text; the runner performs all semantic assertions independently.
 */
export function createFetchHttpExchangeExecutor(
  fetchImplementation: typeof fetch = fetch,
  authorize?: (request: HttpExchangeRequest) => Readonly<Record<string, string>>,
  maximumBodyBytes = 1_048_576,
  requestTimeoutMs = 30_000,
): RawHttpExchangeExecutor {
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes <= 0)
    throw new RangeError("maximumBodyBytes must be a positive safe integer");
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > MAX_TIMER_DELAY_MS
  )
    throw new RangeError(`requestTimeoutMs must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`);
  return async (request) => {
    if (isExactRequest(request) || request.rawRequestTarget !== undefined)
      throw new HttpTransportError(
        "configuration",
        "exact raw request targets require the raw HTTP executor",
      );
    if (request.headers === undefined || request.credentialRef !== undefined)
      throw new HttpTransportError("configuration", "ordinary HTTP request headers are required");
    const ordinary = request;
    let headers: Headers;
    try {
      headers = new Headers(request.headers);
      for (const [name, value] of new Headers(authorize?.(ordinary)).entries())
        headers.set(name, value);
    } catch (error) {
      throw new HttpTransportError("configuration", "HTTP request headers were invalid", {
        cause: error,
      });
    }
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("accept-language")) headers.set("accept-language", "*");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate");
    if (!headers.has("user-agent")) headers.set("user-agent", "bdp-conformance/0");
    const deadline = createDeadlineSignal(requestTimeoutMs);
    const signal = AbortSignal.any([request.signal, deadline.signal]);
    try {
      let response: Response;
      try {
        response = await fetchImplementation(request.url, {
          method: request.method,
          headers,
          signal,
          redirect: "manual",
        });
      } catch (error) {
        if (deadline.signal.aborted && !request.signal.aborted)
          throw new HttpTransportError("timeout", "HTTP exchange timed out", { cause: error });
        if (request.signal.aborted)
          throw new HttpTransportError("abort", "HTTP exchange was aborted", { cause: error });
        throw new HttpTransportError("network", "HTTP exchange failed", { cause: error });
      }
      let bodyText: string;
      try {
        bodyText = await readBoundedBody(response, maximumBodyBytes, signal);
      } catch (error) {
        if (error instanceof HttpTransportError) throw error;
        if (deadline.signal.aborted && !request.signal.aborted)
          throw new HttpTransportError("timeout", "HTTP response body timed out", { cause: error });
        if (request.signal.aborted)
          throw new HttpTransportError("abort", "HTTP response body read was aborted", {
            cause: error,
          });
        throw new HttpTransportError(
          "disconnect",
          "HTTP response disconnected before its body was read",
          { cause: error },
        );
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      return {
        url: response.url === "" ? request.url : response.url,
        status: response.status,
        headers: responseHeaders,
        bodyText,
        effectiveRequest: {
          url: request.url,
          headers: Object.fromEntries(headers.entries()),
        },
      };
    } finally {
      deadline.clear();
    }
  };
}

const HTTP_FIELD_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HTTP_FIELD_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const HANDLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SECRET_FIELD =
  /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token)$|(?:token|secret|password|credential|auth)/i;
const RESERVED_FIELDS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "trailer",
  "expect",
  "upgrade",
  "proxy-connection",
  "proxy-authorization",
  "forwarded",
  "via",
]);
const METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype);
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "byteLength")?.get;
const BYTE_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY, "buffer")?.get;
const SET_BYTES = Uint8Array.prototype.set;

function configuration(): never {
  throw new HttpTransportError("configuration", "exact HTTP request configuration is invalid");
}

/** Capture data descriptors without invoking caller accessors. */
function dataRecord(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return configuration();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return configuration();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (allowed !== undefined && !allowed.includes(key)))
      return configuration();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
      return configuration();
    result[key] = descriptor.value;
  }
  return result;
}

function arrayItems(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return configuration();
  return value;
}

function arrayItem(values: readonly unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
  if (descriptor === undefined || !("value" in descriptor)) return configuration();
  return descriptor.value;
}

function canonicalHttpUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.isWellFormed()) return configuration();
  const url = parseExecutorUrl(value);
  if (url.href !== value || value.includes("#")) return configuration();
  // Check decoded path segments too: URL normalization alone accepts malformed % and encoded separators.
  try {
    const segments = url.pathname.split("/");
    for (const [index, segment] of segments.entries()) {
      if (segment === "" && index !== 0 && index !== segments.length - 1) return configuration();
      for (const match of segment.matchAll(/%([0-9A-Fa-f]{2})/g)) {
        const encoded = match[1];
        if (
          encoded === undefined ||
          encoded !== encoded.toUpperCase() ||
          /^[A-Za-z0-9._~-]$/.test(String.fromCharCode(Number.parseInt(encoded, 16)))
        )
          return configuration();
      }
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\"))
        return configuration();
      for (const character of decoded) {
        const point = character.codePointAt(0);
        if (point !== undefined && (point <= 31 || point === 127)) return configuration();
      }
    }
  } catch {
    return configuration();
  }
  return url;
}

/** Shared by the session wrapper and executor; only closed trusted configuration is accepted. */
export function snapshotExactHttpMode(value: ExactHttpModeOptions): ExactHttpModeOptions {
  const fields = dataRecord(value, [
    "scope",
    "profile",
    "routes",
    "maximumRequestHeaderBytes",
    "maximumRequestBodyBytes",
    "defaultCredentialRef",
    "credentialHandles",
    "resolveCredentials",
  ]);
  const scope = canonicalHttpUrl(fields.scope);
  if (
    scope.href.includes("?") ||
    !scope.pathname.endsWith("/") ||
    (fields.profile !== "read" && fields.profile !== "read-update")
  )
    return configuration();
  if (
    typeof fields.maximumRequestHeaderBytes !== "number" ||
    typeof fields.maximumRequestBodyBytes !== "number"
  )
    return configuration();
  requirePositiveBound(fields.maximumRequestHeaderBytes, "maximumRequestHeaderBytes");
  requirePositiveBound(fields.maximumRequestBodyBytes, "maximumRequestBodyBytes");
  const routes: { method: HttpMethod; url: string }[] = [];
  const sourceRoutes = arrayItems(fields.routes);
  for (let i = 0; i < sourceRoutes.length; i++) {
    const entry = dataRecord(arrayItem(sourceRoutes, i), ["method", "url"]);
    if (!isHttpMethod(entry.method)) return configuration();
    const url = canonicalHttpUrl(entry.url);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
      return configuration();
    routes.push(Object.freeze({ method: entry.method, url: url.href }));
  }
  const handles: { id: string; headerNames: readonly string[] }[] = [];
  const sourceHandles = arrayItems(fields.credentialHandles);
  for (let i = 0; i < sourceHandles.length; i++) {
    const entry = dataRecord(arrayItem(sourceHandles, i), ["id", "headerNames"]);
    if (
      typeof entry.id !== "string" ||
      !HANDLE_ID.test(entry.id) ||
      entry.id.length > 128 ||
      handles.some(({ id }) => id === entry.id)
    )
      return configuration();
    const names: string[] = [];
    const sourceNames = arrayItems(entry.headerNames);
    for (let j = 0; j < sourceNames.length; j++) {
      const name = arrayItem(sourceNames, j);
      if (
        typeof name !== "string" ||
        !HTTP_FIELD_NAME.test(name) ||
        name !== name.toLowerCase() ||
        !SECRET_FIELD.test(name) ||
        RESERVED_FIELDS.has(name) ||
        names.includes(name)
      )
        return configuration();
      names.push(name);
    }
    handles.push(Object.freeze({ id: entry.id, headerNames: Object.freeze(names) }));
  }
  if (
    typeof fields.defaultCredentialRef !== "string" ||
    !handles.some(({ id }) => id === fields.defaultCredentialRef) ||
    typeof fields.resolveCredentials !== "function"
  )
    return configuration();
  // Keep the callback identity, not mutable caller configuration surrounding it.
  const resolve = fields.resolveCredentials;
  return Object.freeze({
    scope: scope.href,
    profile: fields.profile,
    routes: Object.freeze(routes),
    credentialHandles: Object.freeze(handles),
    maximumRequestHeaderBytes: fields.maximumRequestHeaderBytes,
    maximumRequestBodyBytes: fields.maximumRequestBodyBytes,
    defaultCredentialRef: fields.defaultCredentialRef,
    resolveCredentials: (context: Parameters<ExactHttpModeOptions["resolveCredentials"]>[0]) =>
      resolve(context),
  });
}

function isHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === "string" && METHODS.includes(value);
}

function isExactRequest(
  request: HttpExchangeRequest | ExactHttpExchangeRequest,
): request is ExactHttpExchangeRequest {
  return "raw" in request;
}

/** Does not admit a profile or resolve discovery: this is a configured harness route firewall. */
export function validateExactRunConfiguration(
  mode: Pick<ExactHttpModeOptions, "scope" | "routes">,
  url: string,
  method: HttpMethod,
): void {
  const target = canonicalHttpUrl(url);
  const scope = canonicalHttpUrl(mode.scope);
  if (
    target.origin !== scope.origin ||
    !target.pathname.startsWith(scope.pathname) ||
    !mode.routes.some((route) => route.url === target.href && route.method === method)
  )
    configuration();
}

function copyBoundedBytes(value: unknown, maximum: number): Buffer {
  if (!(value instanceof Uint8Array) || BYTE_LENGTH === undefined) return configuration();
  const length: number = Reflect.apply(BYTE_LENGTH, value, []);
  if (
    length > maximum ||
    BYTE_BUFFER === undefined ||
    Reflect.apply(BYTE_BUFFER, value, []) instanceof SharedArrayBuffer
  )
    return configuration();
  const copied = Buffer.alloc(length);
  Reflect.apply(SET_BYTES, copied, [value]);
  return copied;
}

function requestDeadline(signal: AbortSignal, deadline: number): number {
  if (signal.aborted) throw new HttpTransportError("abort", "HTTP exchange was aborted");
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new HttpTransportError("timeout", "HTTP exchange timed out");
  return Math.max(1, Math.ceil(remaining));
}

function safeCredentialTarget(target: Buffer, semantic: URL): boolean {
  const text = target.toString("latin1");
  if (text.startsWith("/") && !text.startsWith("//") && !text.includes("\\")) return true;
  if (/[^\x21-\x7e]/.test(text) || text.includes("\\")) return false;
  try {
    const url = new URL(text, semantic.origin);
    return (
      url.origin === semantic.origin &&
      url.username === "" &&
      url.password === "" &&
      (text.startsWith(`${semantic.protocol}//`) || text.startsWith("//"))
    );
  } catch {
    return false;
  }
}

async function executeExact(
  input: ExactHttpExchangeRequest,
  route: RawHttpDialRoute,
  mode: ExactHttpModeOptions | undefined,
  timeoutMs: number,
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
): Promise<HttpExchangeResponse> {
  const deadline = performance.now() + timeoutMs;
  let state: RequestWriteState = "not-started";
  try {
    if (mode === undefined) return configuration();
    const request = dataRecord(input, [
      "method",
      "url",
      "signal",
      "rawRequestTarget",
      "credentialRef",
      "raw",
    ]);
    if (!isHttpMethod(request.method) || !(request.signal instanceof AbortSignal))
      return configuration();
    const signal = request.signal;
    requestDeadline(signal, deadline);
    const url = canonicalHttpUrl(request.url);
    const raw = dataRecord(request.raw, ["headerLines", "bodyBytes"]);
    if (
      request.rawRequestTarget === undefined &&
      url.pathname.length + url.search.length > mode.maximumRequestHeaderBytes
    )
      return configuration();
    const target =
      request.rawRequestTarget === undefined
        ? encodeRequestTarget(undefined, url)
        : encodeRequestTarget(
            copyBoundedBytes(
              request.rawRequestTarget,
              Math.min(MAXIMUM_RAW_REQUEST_TARGET_BYTES, mode.maximumRequestHeaderBytes),
            ),
            url,
          );
    const body =
      raw.bodyBytes === undefined
        ? undefined
        : copyBoundedBytes(raw.bodyBytes, mode.maximumRequestBodyBytes);
    if (mode.profile === "read" && body !== undefined) return configuration();
    const lines: RawHeaderLine[] = [];
    let headBytes = Buffer.byteLength(`${request.method} `) + target.length + 13;
    const append = (name: string, value: string): void => {
      headBytes += name.length + value.length + 4;
      if (headBytes > mode.maximumRequestHeaderBytes) configuration();
      lines.push(Object.freeze({ name, value }));
    };
    const sourceLines = arrayItems(raw.headerLines);
    for (let i = 0; i < sourceLines.length; i++) {
      const entry = dataRecord(arrayItem(sourceLines, i), ["name", "value"]);
      if (
        typeof entry.name !== "string" ||
        typeof entry.value !== "string" ||
        !HTTP_FIELD_NAME.test(entry.name) ||
        !HTTP_FIELD_VALUE.test(entry.value)
      )
        return configuration();
      const name = entry.name.toLowerCase();
      if (SECRET_FIELD.test(name) || RESERVED_FIELDS.has(name)) return configuration();
      append(entry.name, entry.value);
    }
    if (headBytes > mode.maximumRequestHeaderBytes) return configuration();
    validateExactRunConfiguration(mode, url.href, request.method);
    const ref = request.credentialRef ?? mode.defaultCredentialRef;
    if (typeof ref !== "string" || !HANDLE_ID.test(ref) || ref.length > 128) return configuration();
    const handle = mode.credentialHandles.find(({ id }) => id === ref);
    if (
      handle === undefined ||
      (handle.headerNames.length > 0 && !safeCredentialTarget(target, url))
    )
      return configuration();
    requestDeadline(signal, deadline);
    const credentials = dataRecord(
      mode.resolveCredentials(
        Object.freeze({
          scope: mode.scope,
          url: url.href,
          method: request.method,
          credentialRef: ref,
          signal,
        }),
      ),
    );
    requestDeadline(signal, deadline);
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(credentials)) {
      const normalized = name.toLowerCase();
      if (
        !handle.headerNames.includes(normalized) ||
        seen.has(normalized) ||
        typeof value !== "string" ||
        !HTTP_FIELD_VALUE.test(value) ||
        !HTTP_FIELD_NAME.test(name)
      )
        return configuration();
      seen.add(normalized);
      append(name, value);
    }
    if (seen.size !== handle.headerNames.length) return configuration();
    for (const [name, value] of [
      ["Accept", "*/*"],
      ["Accept-Language", "*"],
      ["Accept-Encoding", "identity"],
      ["User-Agent", "bdp-conformance/0"],
    ] as const)
      if (!lines.some((line) => line.name.toLowerCase() === name.toLowerCase()))
        append(name, value);
    append("Host", url.host);
    append("Connection", "close");
    if (body !== undefined) append("Content-Length", String(body.length));
    const head = Buffer.concat([
      Buffer.from(`${request.method} `, "ascii"),
      target,
      Buffer.from(
        ` HTTP/1.1\r\n${lines.map(({ name, value }) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`,
        "latin1",
      ),
    ]);
    const exchanged = await exchangeRawBytes(
      route,
      head,
      request.method,
      signal,
      requestDeadline(signal, deadline),
      maximumHeaderBytes,
      maximumBodyBytes,
      body,
      (next) => {
        state = next;
      },
    );
    const parsed = parseRawResponse(
      exchanged.bytes,
      request.method,
      maximumHeaderBytes,
      maximumBodyBytes,
    );
    const exactRequest = Object.freeze({
      source: "raw-http1-serializer" as const,
      headerLines: Object.freeze(lines),
      bodyPresent: body !== undefined,
      bodyOctets: body?.length ?? 0,
      ...(body === undefined
        ? {}
        : { bodyDigest: createHash("sha256").update(body).digest("hex") }),
      writeState: exchanged.writeState,
    });
    return {
      url: url.href,
      ...parsed,
      wireResponseBytes: Uint8Array.from(exchanged.bytes),
      exactRequest,
      effectiveRequest: {
        url: url.href,
        headers: Object.freeze(
          Object.fromEntries(lines.map(({ name, value }) => [name.toLowerCase(), value])),
        ),
      },
    };
  } catch (error) {
    if (error instanceof HttpTransportError)
      throw new HttpTransportError(error.category, error.message, {}, state);
    throw new HttpTransportError(
      "configuration",
      "exact HTTP request configuration is invalid",
      {},
      state,
    );
  }
}

function snapshotDialRoute(route: RawHttpDialRoute): RawHttpDialRoute {
  if (route.transport !== "plain" && route.transport !== "tls")
    throw new TypeError("dialRoute.transport must be 'plain' or 'tls'");
  if (typeof route.host !== "string" || route.host.length === 0)
    throw new TypeError("dialRoute.host must be a non-empty string");
  if (!Number.isSafeInteger(route.port) || route.port < 1 || route.port > 65_535)
    throw new RangeError("dialRoute.port must be an integer from 1 to 65535");
  if (route.transport === "plain") return Object.freeze({ ...route });
  if (
    route.servername !== undefined &&
    (typeof route.servername !== "string" || route.servername.length === 0)
  )
    throw new TypeError("dialRoute.servername must be a non-empty string when present");
  if (route.ca !== undefined && (typeof route.ca !== "string" || route.ca.length === 0))
    throw new TypeError("dialRoute.ca must be a non-empty string when present");
  return Object.freeze({ ...route });
}

function requirePositiveBound(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer`);
}

function requireTimerBound(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS)
    throw new RangeError(`requestTimeoutMs must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`);
}

function parseExecutorUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported");
    if (url.username !== "" || url.password !== "") throw new Error("credentials");
    return url;
  } catch (error) {
    throw new HttpTransportError("configuration", "HTTP request URL was invalid", {
      cause: error,
    });
  }
}

function encodeRequestTarget(rawRequestTarget: Uint8Array | undefined, url: URL): Buffer {
  if (rawRequestTarget === undefined) return Buffer.from(`${url.pathname}${url.search}`, "latin1");
  if (!(rawRequestTarget instanceof Uint8Array))
    throw new HttpTransportError("configuration", "exact raw request target must be a Uint8Array");
  if (rawRequestTarget.byteLength > MAXIMUM_RAW_REQUEST_TARGET_BYTES)
    throw new HttpTransportError(
      "configuration",
      `exact raw request target exceeded ${MAXIMUM_RAW_REQUEST_TARGET_BYTES} bytes`,
    );
  if (rawRequestTarget.some((octet) => octet === 0x20 || octet === 0x0d || octet === 0x0a))
    throw new HttpTransportError(
      "configuration",
      "exact raw request target contained SP, CR, or LF",
    );
  return Buffer.from(rawRequestTarget);
}

function effectiveHeaders(
  request: HttpExchangeRequest,
  authorize: ((request: HttpExchangeRequest) => Readonly<Record<string, string>>) | undefined,
): Headers {
  try {
    const headers = new Headers(request.headers);
    for (const [name, value] of new Headers(authorize?.(request)).entries())
      headers.set(name, value);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("accept-language")) headers.set("accept-language", "*");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    if (!headers.has("user-agent")) headers.set("user-agent", "bdp-conformance/0");
    return headers;
  } catch (error) {
    throw new HttpTransportError("configuration", "HTTP request headers were invalid", {
      cause: error,
    });
  }
}

function canonicalHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("-");
}

function exchangeRawBytes(
  route: RawHttpDialRoute,
  requestHead: Uint8Array,
  method: HttpMethod,
  signal: AbortSignal,
  requestTimeoutMs: number,
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
  requestBody?: Uint8Array,
  observeWrite?: (state: RequestWriteState) => void,
): Promise<{ bytes: Buffer; writeState: RequestWriteState }> {
  return new Promise((resolve, reject) => {
    let socket: Socket | undefined;
    let settled = false;
    let connected = false;
    let state: RequestWriteState = "not-started";
    let completedWrites = 0;
    const requiredWrites = requestBody === undefined ? 1 : 2;
    const wireLimit = Math.min(Number.MAX_SAFE_INTEGER, maximumBodyBytes + maximumHeaderBytes * 2);
    let buffered = Buffer.alloc(Math.min(8192, wireLimit));
    let total = 0;
    const raw = (): Buffer => buffered.subarray(0, total);
    const recordState = (next: RequestWriteState): void => {
      if (settled) return;
      state = next;
      observeWrite?.(next);
    };
    const finish = (error?: HttpTransportError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (socket !== undefined) {
        socket.removeAllListeners();
        socket.on("error", () => undefined);
        socket.destroy();
      }
      if (error !== undefined) reject(error);
      else resolve({ bytes: Buffer.from(raw()), writeState: state });
      buffered = Buffer.alloc(0);
    };
    const completeResponse = (): boolean => {
      try {
        return isFramedResponseComplete(raw(), method, maximumHeaderBytes, maximumBodyBytes);
      } catch {
        return false;
      }
    };
    const writeDone = (error?: Error | null): void => {
      if (settled) return;
      if (error !== undefined && error !== null) {
        finish(
          completeResponse()
            ? undefined
            : new HttpTransportError("disconnect", "HTTP request write disconnected"),
        );
        return;
      }
      completedWrites++;
      if (completedWrites === requiredWrites) recordState("complete");
    };
    const onAbort = (): void =>
      finish(new HttpTransportError("abort", "HTTP exchange was aborted"));
    const timer = setTimeout(
      () => finish(new HttpTransportError("timeout", "HTTP exchange timed out")),
      requestTimeoutMs,
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      socket =
        route.transport === "plain"
          ? connectPlain({ host: route.host, port: route.port })
          : connectTls({
              host: route.host,
              port: route.port,
              ...(route.servername === undefined ? {} : { servername: route.servername }),
              ...(route.ca === undefined ? {} : { ca: route.ca }),
            });
    } catch {
      finish(new HttpTransportError("configuration", "HTTP dial route was invalid"));
      return;
    }
    const peer = socket;
    peer.once(route.transport === "plain" ? "connect" : "secureConnect", () => {
      if (settled) return;
      connected = true;
      recordState("started-completion-unestablished");
      try {
        // Bounded owned buffers; two writes avoid copying a large entity again.
        peer.write(requestHead, writeDone);
        if (requestBody !== undefined) peer.write(requestBody, writeDone);
      } catch {
        finish(
          completeResponse()
            ? undefined
            : new HttpTransportError("disconnect", "HTTP request write disconnected"),
        );
      }
    });
    peer.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (chunk.length > wireLimit - total) {
        finish(
          new HttpTransportError("body-limit", "HTTP response exceeded the configured body limit"),
        );
        return;
      }
      const next = total + chunk.length;
      if (next > buffered.length) {
        const grown = Buffer.alloc(Math.min(wireLimit, Math.max(next, buffered.length * 2)));
        buffered.copy(grown, 0, 0, total);
        buffered = grown;
      }
      chunk.copy(buffered, total);
      total = next;
      try {
        const head = locateFinalResponseHead(raw(), maximumHeaderBytes);
        if (head === undefined) return;
        if (total - head.headerEnd - 4 > maximumBodyBytes + maximumHeaderBytes)
          throw new HttpTransportError(
            "body-limit",
            "HTTP response exceeded the configured body limit",
          );
        if (
          isFramedResponseComplete(raw(), method, maximumHeaderBytes, maximumBodyBytes) &&
          state === "complete" &&
          !peer.writableEnded
        )
          // Preserve the existing FIN/trailing-byte observation. Do not wait for a queued
          // outbound body to drain merely to acknowledge an early complete refusal.
          peer.end();
      } catch (error) {
        finish(
          error instanceof HttpTransportError
            ? error
            : new HttpTransportError("invalid-body", "HTTP response framing was malformed"),
        );
      }
    });
    peer.once("end", () => {
      try {
        parseRawResponse(raw(), method, maximumHeaderBytes, maximumBodyBytes);
        finish();
      } catch (error) {
        finish(
          error instanceof HttpTransportError
            ? error
            : new HttpTransportError("invalid-body", "HTTP response framing was malformed"),
        );
      }
    });
    peer.once("error", () =>
      finish(
        completeResponse()
          ? undefined
          : new HttpTransportError(
              connected ? "disconnect" : "network",
              connected ? "HTTP response disconnected" : "HTTP exchange failed",
            ),
      ),
    );
    peer.once("close", () => {
      if (!settled)
        finish(
          completeResponse()
            ? undefined
            : new HttpTransportError(
                connected ? "disconnect" : "network",
                connected ? "HTTP response disconnected" : "HTTP exchange failed",
              ),
        );
    });
  });
}

function isFramedResponseComplete(
  raw: Buffer,
  method: HttpExchangeRequest["method"],
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
): boolean {
  const head = locateFinalResponseHead(raw, maximumHeaderBytes);
  if (head === undefined) return false;
  const { headerEnd, status, headers } = head;
  if (method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200))
    return false;
  if (headers["transfer-encoding"] === undefined && headers["content-length"] === undefined)
    return false;
  try {
    decodeResponseBody(raw.subarray(headerEnd + 4), headers, maximumBodyBytes);
    return true;
  } catch (error) {
    if (error instanceof HttpTransportError && error.category === "disconnect") return false;
    throw error;
  }
}

/** All informational heads share one byte budget with the final head. */
function locateFinalResponseHead(
  raw: Buffer,
  maximumHeaderBytes: number,
): ReturnType<typeof parseRawResponseHead> | undefined {
  let offset = 0;
  while (true) {
    const end = raw.indexOf("\r\n\r\n", offset, "latin1");
    if (end === -1) {
      if (raw.length > maximumHeaderBytes)
        throw new HttpTransportError(
          "header-limit",
          "HTTP response headers exceeded the configured limit",
        );
      return undefined;
    }
    if (end + 4 > maximumHeaderBytes)
      throw new HttpTransportError(
        "header-limit",
        "HTTP response headers exceeded the configured limit",
      );
    const head = parseRawResponseHead(raw.subarray(offset, end + 4), maximumHeaderBytes - offset);
    if (head.status >= 200) return { ...head, headerEnd: end };
    if (
      head.status === 101 ||
      head.headers["content-length"] !== undefined ||
      head.headers["transfer-encoding"] !== undefined
    )
      throw new HttpTransportError(
        "invalid-body",
        "HTTP informational response was unsupported or malformed",
      );
    offset = end + 4;
  }
}

function parseRawResponseHead(
  raw: Buffer,
  maximumHeaderBytes: number,
): {
  readonly headerEnd: number;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
} {
  const headerEnd = raw.indexOf("\r\n\r\n", 0, "latin1");
  if (headerEnd === -1)
    throw new HttpTransportError("invalid-body", "HTTP response headers were malformed");
  if (headerEnd + 4 > maximumHeaderBytes)
    throw new HttpTransportError(
      "header-limit",
      "HTTP response headers exceeded the configured limit",
    );
  const lines = raw.subarray(0, headerEnd).toString("latin1").split("\r\n");
  const statusMatch = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/.exec(lines.shift() ?? "");
  if (statusMatch?.[1] === undefined)
    throw new HttpTransportError("invalid-body", "HTTP response status line was malformed");
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of lines) {
    const separator = line.indexOf(":");
    const name = separator === -1 ? "" : line.slice(0, separator).trim().toLowerCase();
    const value = separator === -1 ? "" : line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\0\r\n]/.test(value))
      throw new HttpTransportError("invalid-body", "HTTP response header was malformed");
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return { headerEnd, status: Number(statusMatch[1]), headers };
}

function parseRawResponse(
  raw: Buffer,
  method: HttpExchangeRequest["method"],
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
): {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly bodyOctets: number;
} {
  const head = locateFinalResponseHead(raw, maximumHeaderBytes);
  if (head === undefined)
    throw new HttpTransportError(
      "disconnect",
      "HTTP response disconnected before a final response",
    );
  const { headerEnd, status, headers } = head;
  const framed = raw.subarray(headerEnd + 4);
  const body =
    method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200)
      ? framed
      : decodeResponseBody(framed, headers, maximumBodyBytes);
  if (body.byteLength > maximumBodyBytes)
    throw new HttpTransportError("body-limit", "HTTP response exceeded the configured body limit");
  let bodyText: string;
  try {
    bodyText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch (error) {
    throw new HttpTransportError("invalid-body", "HTTP response was not valid UTF-8", {
      cause: error,
    });
  }
  return { status, headers, bodyText, bodyOctets: body.byteLength };
}

function decodeResponseBody(
  framed: Buffer,
  headers: Readonly<Record<string, string>>,
  maximumBodyBytes: number,
): Buffer {
  const transferEncoding = headers["transfer-encoding"]?.toLowerCase();
  const contentLength = headers["content-length"];
  if (transferEncoding !== undefined && contentLength !== undefined)
    throw new HttpTransportError("invalid-body", "HTTP response framing was ambiguous");
  if (transferEncoding !== undefined) {
    if (transferEncoding !== "chunked")
      throw new HttpTransportError("invalid-body", "HTTP response transfer coding was unsupported");
    return decodeChunkedBody(framed, maximumBodyBytes);
  }
  if (contentLength === undefined) return framed;
  if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength))
    throw new HttpTransportError("invalid-body", "HTTP response Content-Length was malformed");
  const expected = Number(contentLength);
  if (!Number.isSafeInteger(expected))
    throw new HttpTransportError("body-limit", "HTTP response Content-Length exceeded safe bounds");
  if (expected > maximumBodyBytes)
    throw new HttpTransportError("body-limit", "HTTP response exceeded the configured body limit");
  if (framed.byteLength < expected)
    throw new HttpTransportError(
      "disconnect",
      "HTTP response disconnected before its body was read",
    );
  if (framed.byteLength > expected)
    throw new HttpTransportError(
      "invalid-body",
      "HTTP response contained bytes beyond Content-Length",
    );
  return framed;
}

function decodeChunkedBody(framed: Buffer, maximumBodyBytes: number): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  let total = 0;
  while (true) {
    const lineEnd = framed.indexOf("\r\n", offset, "latin1");
    if (lineEnd === -1)
      throw new HttpTransportError("disconnect", "chunked HTTP response ended before a size line");
    const sizeText = framed.subarray(offset, lineEnd).toString("latin1").split(";", 1)[0] ?? "";
    if (!/^[0-9A-Fa-f]+$/.test(sizeText))
      throw new HttpTransportError("invalid-body", "chunked HTTP response size was malformed");
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isSafeInteger(size))
      throw new HttpTransportError("body-limit", "chunked HTTP response size exceeded safe bounds");
    offset = lineEnd + 2;
    if (size === 0) {
      validateChunkedTrailers(framed.subarray(offset));
      return Buffer.concat(chunks);
    }
    total += size;
    if (total > maximumBodyBytes)
      throw new HttpTransportError(
        "body-limit",
        "HTTP response exceeded the configured body limit",
      );
    const end = offset + size;
    if (end + 2 > framed.byteLength)
      throw new HttpTransportError("disconnect", "chunked HTTP response ended inside a chunk");
    if (framed.subarray(end, end + 2).toString("latin1") !== "\r\n")
      throw new HttpTransportError("invalid-body", "chunked HTTP response delimiter was malformed");
    chunks.push(framed.subarray(offset, end));
    offset = end + 2;
  }
}

function validateChunkedTrailers(trailers: Buffer): void {
  if (trailers.subarray(0, 2).toString("latin1") === "\r\n") {
    if (trailers.byteLength === 2) return;
    throw new HttpTransportError("invalid-body", "chunked HTTP response contained trailing bytes");
  }
  const trailerEnd = trailers.indexOf("\r\n\r\n", 0, "latin1");
  if (trailerEnd === -1)
    throw new HttpTransportError("disconnect", "chunked HTTP response trailers were incomplete");
  if (trailerEnd + 4 !== trailers.byteLength)
    throw new HttpTransportError("invalid-body", "chunked HTTP response contained trailing bytes");
  for (const line of trailers.subarray(0, trailerEnd).toString("latin1").split("\r\n")) {
    const separator = line.indexOf(":");
    const name = separator === -1 ? "" : line.slice(0, separator).trim().toLowerCase();
    const value = separator === -1 ? "" : line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\0\r\n]/.test(value))
      throw new HttpTransportError("invalid-body", "chunked HTTP response trailer was malformed");
  }
}

function createDeadlineSignal(delayMs: number): {
  readonly signal: AbortSignal;
  readonly clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), delayMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function readBoundedBody(
  response: Response,
  maximumBodyBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new Error("response body read aborted"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) {
        try {
          return `${text}${decoder.decode()}`;
        } catch (error) {
          void reader.cancel().catch(() => undefined);
          throw new HttpTransportError("invalid-body", "HTTP response was not valid UTF-8", {
            cause: error,
          });
        }
      }
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        void reader.cancel().catch(() => undefined);
        throw new HttpTransportError(
          "body-limit",
          "HTTP response exceeded the configured body limit",
        );
      }
      try {
        text += decoder.decode(value, { stream: true });
      } catch (error) {
        void reader.cancel().catch(() => undefined);
        throw new HttpTransportError("invalid-body", "HTTP response was not valid UTF-8", {
          cause: error,
        });
      }
    }
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // An abort may leave a pending reader operation; cancellation owns final release.
    }
  }
}
