import { connect as connectPlain, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

export interface HttpExchangeRequest {
  readonly method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
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

export interface HttpExchangeResponse {
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
): HttpExchangeExecutor {
  const route = snapshotDialRoute(dialRoute);
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
    const url = parseExecutorUrl(request.url);
    const requestTarget = encodeRequestTarget(request.rawRequestTarget, url);
    const headers = effectiveHeaders(request, authorize);
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
      rawResponse,
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
      wireResponseBytes: Uint8Array.from(rawResponse),
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
): HttpExchangeExecutor {
  if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes <= 0)
    throw new RangeError("maximumBodyBytes must be a positive safe integer");
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > MAX_TIMER_DELAY_MS
  )
    throw new RangeError(`requestTimeoutMs must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`);
  return async (request) => {
    if (request.rawRequestTarget !== undefined)
      throw new HttpTransportError(
        "configuration",
        "exact raw request targets require the raw HTTP executor",
      );
    let headers: Headers;
    try {
      headers = new Headers(request.headers);
      for (const [name, value] of new Headers(authorize?.(request)).entries())
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
  method: HttpExchangeRequest["method"],
  signal: AbortSignal,
  requestTimeoutMs: number,
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let socket: Socket;
    let settled = false;
    let connected = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let headerEnd = -1;
    const maximumWireBodyBytes =
      maximumBodyBytes > Number.MAX_SAFE_INTEGER - maximumHeaderBytes
        ? Number.MAX_SAFE_INTEGER
        : maximumBodyBytes + maximumHeaderBytes;
    const finish = (error?: HttpTransportError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
      // A reset or TLS shutdown error can arrive after the exchange has already
      // settled. Keep it from escaping as an uncaught EventEmitter error while
      // the socket is being destroyed.
      socket.on("error", () => undefined);
      if (!socket.destroyed) socket.destroy();
      if (error === undefined) resolve(Buffer.concat(chunks, totalBytes));
      else reject(error);
    };
    const onAbort = (): void =>
      finish(new HttpTransportError("abort", "HTTP exchange was aborted"));
    const timer = setTimeout(
      () => finish(new HttpTransportError("timeout", "HTTP exchange timed out")),
      requestTimeoutMs,
    );
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
    } catch (error) {
      clearTimeout(timer);
      reject(
        new HttpTransportError("configuration", "HTTP dial route was invalid", { cause: error }),
      );
      return;
    }
    const connectEvent = route.transport === "plain" ? "connect" : "secureConnect";
    socket.once(connectEvent, () => {
      connected = true;
      socket.write(requestHead);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      const raw = Buffer.concat(chunks, totalBytes);
      if (headerEnd === -1) {
        headerEnd = raw.indexOf("\r\n\r\n", 0, "latin1");
        if (headerEnd === -1 && totalBytes > maximumHeaderBytes)
          finish(
            new HttpTransportError(
              "header-limit",
              "HTTP response headers exceeded the configured limit",
            ),
          );
        else if (headerEnd !== -1 && headerEnd + 4 > maximumHeaderBytes)
          finish(
            new HttpTransportError(
              "header-limit",
              "HTTP response headers exceeded the configured limit",
            ),
          );
      }
      if (headerEnd !== -1 && totalBytes - (headerEnd + 4) > maximumWireBodyBytes)
        finish(
          new HttpTransportError("body-limit", "HTTP response exceeded the configured body limit"),
        );
      if (settled || headerEnd === -1) return;
      try {
        if (
          isFramedResponseComplete(raw, method, maximumHeaderBytes, maximumBodyBytes) &&
          !socket.writableEnded
        )
          // The complete declared frame is already buffered, so this half-close
          // cannot truncate the response. Keep reading until peer FIN so bytes
          // beyond the frame are rejected independently of TCP packetization.
          socket.end();
      } catch (error) {
        finish(
          error instanceof HttpTransportError
            ? error
            : new HttpTransportError("invalid-body", "HTTP response framing was malformed", {
                cause: error,
              }),
        );
      }
    });
    socket.once("end", () =>
      finish(
        headerEnd === -1
          ? new HttpTransportError("disconnect", "HTTP response disconnected before its headers")
          : undefined,
      ),
    );
    socket.once("error", (error) =>
      finish(
        new HttpTransportError(
          connected ? "disconnect" : "network",
          connected ? "HTTP response disconnected" : "HTTP exchange failed",
          { cause: error },
        ),
      ),
    );
    socket.once("close", () => {
      if (!settled)
        finish(
          new HttpTransportError(
            connected ? "disconnect" : "network",
            connected ? "HTTP response disconnected" : "HTTP exchange failed",
          ),
        );
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isFramedResponseComplete(
  raw: Buffer,
  method: HttpExchangeRequest["method"],
  maximumHeaderBytes: number,
  maximumBodyBytes: number,
): boolean {
  const { headerEnd, status, headers } = parseRawResponseHead(raw, maximumHeaderBytes);
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
  const { headerEnd, status, headers } = parseRawResponseHead(raw, maximumHeaderBytes);
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
