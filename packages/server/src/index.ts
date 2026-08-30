import { randomBytes } from "node:crypto";
import {
  createServer as createNodeServer,
  type Server as NodeHttpServer,
  type RequestListener,
} from "node:http";
import process from "node:process";
import { isProxy } from "node:util/types";

import type {
  AbsoluteHttpUrl,
  BeadCollection,
  BeadRecord,
  Reference,
  LinkCollection,
  LinkRecord,
  ProtocolProfile,
  ReadBodyFor,
  ReadDiscovery,
  ReadProblem,
  ReadRequest,
  ReadResultFor,
  ScopeProbe,
  ScopeReadOperation,
  TypeInventory,
  TypeSummary,
} from "@bdp/protocol";
import {
  referenceUri,
  isJsonSchemaUri,
  isReadProblem,
  ProtocolArtifactValidationError,
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalTypeId,
  parseLinkCollection,
  parseLinkRecord,
  parsePropertiesRecord,
  parseReadProblem,
  parseTypeDescriptor,
  parseTypeInventory,
  readProblem,
  readProblemDefinitionFor,
  assertCanonicalPathSegments,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";
import {
  hasReadConformanceEvidence,
  type ReadServerTarget,
} from "./read-conformance-capability.js";
import {
  createReadPagination as createReadPaginationEngine,
  type ReadPagination,
  ReadPaginationError,
  type ReadPaginationOptions,
} from "./read-pagination.js";
import {
  ReadSelectorError,
  type ReadSelectorLimits,
  selectReadResources,
} from "./read-selector.js";

/** Identifies the shared BDP server package. */
export const packageName = "@bdp/server";

/**
 * The backend-facing Read authority seam. The server owns HTTP routing and
 * navigation; the port receives one semantic operation union.
 */
export interface ScopePort {
  perform<Operation extends ScopeReadOperation>(
    operation: Operation,
    options: { readonly signal: AbortSignal },
  ): Promise<ScopePortResultFor<Operation>>;
}

export type ScopePortResultFor<Operation extends ScopeReadOperation> =
  | {
      readonly kind: "success";
      readonly body: ReadBodyFor<Operation>;
    }
  | {
      readonly kind: "problem";
      readonly problem: ReadProblem;
    };

export function scopePortSuccess<Operation extends ScopeReadOperation>(
  body: ReadBodyFor<Operation>,
): ScopePortResultFor<Operation> {
  return Object.freeze({ kind: "success", body });
}

export function scopePortProblem<Operation extends ScopeReadOperation>(
  problem: ReadProblem,
): ScopePortResultFor<Operation> {
  return Object.freeze({ kind: "problem", problem });
}

export interface ServerOptions {
  readonly scope: AbsoluteHttpUrl;
  /** Composition-root identity checked against the admitted target. */
  readonly target: ReadServerTarget;
  /** Opaque proof returned only by the public profile-admission boundary. */
  readonly admittedProfile: AdmittedReadProfile;
  readonly port: ScopePort;
  /**
   * Explicit authority-owned dependencies for Read identity and collection
   * controls. Omission preserves the fail-closed behavior for Selector,
   * limit, and cursor reads.
   */
  readonly readControls?: ServerReadControls;
  /** Binding Read bounds emitted by Scope discovery when supplied. */
  readonly advertisedLimits?: ServerAdvertisedReadLimits;
  readonly serviceDescription?: AbsoluteHttpUrl;
  /**
   * The alias table: repointable names beneath `alias/` (relative
   * one-or-more-segment paths) mapped to canonical in-Scope Bead URLs.
   * Resolution is redirect-only (307 + Location, no body); an authority
   * without aliases omits this and the discovery member together.
   */
  readonly aliases?: Readonly<Record<string, AbsoluteHttpUrl>>;
  /** Grace period for admitted Read operations before close forwards cancellation. */
  readonly closeGraceMs?: number;
  /** Total close bound after which an unsettled Scope port is explicitly abandoned. */
  readonly closeTimeoutMs?: number;
}

export interface ServerAdvertisedReadLimits {
  readonly page: {
    readonly defaultItems: number;
    readonly maximumItems: number;
  };
  readonly selector: ReadSelectorLimits;
  readonly cursorTtlMilliseconds: number;
}

export interface ServerReadIdentity {
  readonly authorizationView: string;
  readonly scopeEpoch: string;
}

type ServerReadPageItem = BeadRecord | LinkRecord | TypeSummary;

/**
 * Internal policy seam for controls whose public defaults and authority
 * identities are deliberately not selected by the shared server package.
 */
export interface ServerReadControls {
  readonly selectorLimits: ReadSelectorLimits;
  readonly pagination: ReadPagination<ServerReadPageItem>;
  /** Complete RFC authentication challenge used only when identityFor returns unauthenticated. */
  readonly unauthenticatedChallenge?: string;
  readonly identityFor: (
    operation: ReadRequest,
    options: { readonly signal: AbortSignal; readonly httpRequest?: Request },
  ) => ServerReadIdentity | ReadProblem | Promise<ServerReadIdentity | ReadProblem>;
  readonly problemFor: (error: ReadSelectorError | ReadPaginationError) => ReadProblem;
}

const serverReadPaginations = new WeakSet<object>();
const boundServerReadPaginations = new WeakSet<object>();

/** Creates the only pagination engine admitted by ServerReadControls. */
export function createReadPagination<Item extends ServerReadPageItem = ServerReadPageItem>(
  options: ReadPaginationOptions,
): ReadPagination<Item> {
  const pagination = createReadPaginationEngine<Item>(options);
  serverReadPaginations.add(pagination);
  return pagination;
}

/**
 * Creates production controls for an unauthenticated public Read service.
 * Restart rotates its opaque Authorization View and Scope epoch, invalidating
 * retained cursors. Authenticated compositions must provide their own policy.
 */
export function createPublicReadControls(options: {
  readonly scope: AbsoluteHttpUrl;
  readonly limits: ServerAdvertisedReadLimits;
}): ServerReadControls {
  const limits = snapshotServerAdvertisedReadLimits(options.limits);
  const authorizationView = randomBytes(24).toString("base64url");
  const scopeEpoch = randomBytes(24).toString("base64url");
  const controls: ServerReadControls = {
    selectorLimits: limits.selector,
    pagination: createReadPagination({
      scope: options.scope,
      defaultPageItems: limits.page.defaultItems,
      maxPageItems: limits.page.maximumItems,
      cursorTtlMs: limits.cursorTtlMilliseconds,
      retainedStateCapacity: 10_000,
      maxRetainedCursorPositionsPerSnapshot: 100,
      retainedSnapshotByteCapacity: 64 * 1_024 * 1_024,
      retainedSnapshotNodeCapacity: 1_000_000,
      maxOpaqueTokenLength: 64,
      tokenGenerationAttempts: 8,
      idleCleanup: "timer",
      clock: Date.now,
      generateOpaqueToken: () => randomBytes(24).toString("base64url"),
    }),
    identityFor: (_operation, { httpRequest }) => {
      if (
        httpRequest !== undefined &&
        (httpRequest.headers.has("authorization") || httpRequest.headers.has("cookie"))
      ) {
        return readProblem("forbidden");
      }
      return { authorizationView, scopeEpoch };
    },
    problemFor: (error) => {
      if (error.code === "foreign-view") return readProblem("foreign-view");
      if (error.code === "cursor-expired") return readProblem("cursor-expired");
      if (error instanceof ReadSelectorError)
        return readProblem(
          error.code === "source-bytes-limit-exceeded" ||
            error.code === "ast-depth-limit-exceeded" ||
            error.code === "ast-nodes-limit-exceeded"
            ? "limit-exceeded"
            : "invalid-parameter",
        );
      if (error.code === "invalid-limit") return readProblem("limit-exceeded");
      if (error.code === "foreign-projection" || error.code === "invalid-input")
        return readProblem("invalid-parameter");
      return readProblem("temporarily-unavailable");
    },
  };
  return snapshotServerReadControls(controls);
}

export interface PerformOptions {
  readonly signal?: AbortSignal;
  /** Originating Fetch request, when this operation entered through HTTP. */
  readonly httpRequest?: Request;
}

interface NodeHttpRequestOptions {
  readonly method?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Headers;
}

const RAW_AUTHORITY_REG_NAME = /^(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[0-9A-Fa-f]{2})+$/;
const RAW_AUTHORITY_IP_LITERAL = /^(?:[A-Za-z0-9._~!$&'()*+,;=:-]|%[0-9A-Fa-f]{2})+$/;

interface NodeHttpDisconnectSource {
  once(event: "aborted", listener: () => void): unknown;
}

interface NodeHttpResponseCloseSource {
  readonly writableFinished: boolean;
  once(event: "close", listener: () => void): unknown;
}

export type ScopeServerLocalErrorCode = "server-closed" | "operation-aborted";

export abstract class ScopeServerLocalError extends Error {
  abstract readonly code: ScopeServerLocalErrorCode;
}

export class ScopeServerClosedError extends ScopeServerLocalError {
  readonly code = "server-closed" as const;

  constructor() {
    super("the BDP server is closed");
    this.name = "ScopeServerClosedError";
  }
}

export class ScopeServerOperationAbortedError extends ScopeServerLocalError {
  readonly code = "operation-aborted" as const;

  constructor(options: ErrorOptions = {}) {
    super("the BDP server operation was aborted", options);
    this.name = "ScopeServerOperationAbortedError";
  }
}

export interface ReadServer {
  readonly scope: AbsoluteHttpUrl;
  /** Validated alias table (relative alias path -> canonical Bead URL); undefined when the authority serves no aliases. */
  readonly aliases?: ReadonlyMap<string, AbsoluteHttpUrl>;
  perform<Request extends ReadRequest>(
    request: Request,
    options?: PerformOptions,
  ): Promise<ReadResultFor<Request>>;
  probe(options?: PerformOptions): Promise<ScopeProbe>;
  close(): Promise<void>;
}

const ADMITTED_READ_PROFILE: unique symbol = Symbol("ADMITTED_READ_PROFILE");
const admittedReadProfiles = new WeakSet<object>();
const verifiedReadServers = new WeakSet<object>();
const nodeHeaderSizeForReadServer = new WeakMap<object, number>();
const verifiedNodeHttpServers = new WeakSet<object>();
const boundNodeHttpServers = new WeakSet<object>();
const SERVER_PROBLEMS = new WeakSet<object>();
const SERVER_PROBLEM_CHALLENGES = new WeakMap<object, string>();

/** Opaque at both the TypeScript and JavaScript boundaries. */
export interface AdmittedReadProfile {
  readonly profile: "read";
  readonly target: ReadServerTarget;
  readonly [ADMITTED_READ_PROFILE]: true;
}

export type ReadServerAdmissionErrorCode = "profile-required" | "profile-unsupported";

/**
 * Refuses public listener admission unless configured intent and established
 * implementation capability agree. A reviewed matrix-landing change records
 * target-bound evidence only after the cumulative black-box Read matrix is green.
 */
export class ReadServerAdmissionError extends Error {
  constructor(
    readonly code: ReadServerAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReadServerAdmissionError";
  }
}

export function isReadServerAdmissionError(error: unknown): error is ReadServerAdmissionError {
  return error instanceof ReadServerAdmissionError;
}

export function admitReadServerProfile(
  advertisedProfile: ProtocolProfile | undefined,
  target: ReadServerTarget,
): AdmittedReadProfile {
  if (advertisedProfile === undefined) {
    throw new ReadServerAdmissionError(
      "profile-required",
      "server.advertisedProfile must be explicitly configured before a listener may bind",
    );
  }
  if (advertisedProfile !== "read") {
    throw new ReadServerAdmissionError(
      "profile-unsupported",
      `this Read server cannot advertise the cumulative '${advertisedProfile}' profile`,
    );
  }
  if (!hasReadConformanceEvidence(target)) {
    throw new ReadServerAdmissionError(
      "profile-unsupported",
      "this executable cannot advertise Read until its cumulative black-box Read matrix passes",
    );
  }
  const admittedProfile: AdmittedReadProfile = Object.freeze({
    profile: advertisedProfile,
    target,
    [ADMITTED_READ_PROFILE]: true as const,
  });
  admittedReadProfiles.add(admittedProfile);
  return admittedProfile;
}

/**
 * Conformance launch flag: fail exactly one configured resource read with a
 * private fault. The detail never crosses the wire — the listener maps an
 * unexpected internal failure to a body-less 500 — and nothing else changes:
 * admission, profiles, and every other route are untouched. Shared by both
 * composition roots so the two shipping servers cannot drift apart.
 */
export function withConfiguredInternalFault(
  port: ScopePort,
  resourceId: string | undefined,
): ScopePort {
  if (resourceId === undefined) return port;
  return {
    async perform(operation, options) {
      if (operation.kind === "resource" && operation.id === resourceId)
        throw new Error(`private configured internal fault [${resourceId}]`);
      return port.perform(operation, options);
    },
  };
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body?: unknown;
}

export type HttpHandler = (request: Request) => Promise<HttpResponse>;

export interface NodeRequestListenerOptions {
  /** Receives an unexpected internal failure without exposing it on the wire. */
  readonly onError?: (error: unknown) => void;
}

export interface NodeHttpListenOptions {
  readonly host: string;
  readonly port: number;
  /** Receives listener failures emitted after a successful bind. */
  readonly onError: (error: NodeHttpListenerError) => void;
}

export interface NodeHttpCloseOptions {
  /** Grace period before slow or silent peers are forcibly disconnected. */
  readonly forceAfterMilliseconds?: number;
}

export type NodeHttpServeResult =
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" }
  | { readonly kind: "listener-failure"; readonly error: NodeHttpListenerError };

export interface NodeHttpServeOptions {
  readonly host: string;
  readonly port: number;
  readonly terminationSignal?: AbortSignal;
  readonly onStarted?: () => void;
  readonly onRequestError?: (error: unknown) => void;
}

export class NodeHttpListenerError extends Error {
  readonly reason: string;

  constructor(cause: unknown) {
    const reason = nodeListenerErrorReason(cause);
    super(`the HTTP listener failed (${reason})`, { cause });
    this.name = "NodeHttpListenerError";
    this.reason = reason;
  }
}

export function isNodeHttpListenerError(error: unknown): error is NodeHttpListenerError {
  return error instanceof NodeHttpListenerError;
}

function nodeListenerErrorReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Converts a Node HTTP request target into the canonical public Scope origin.
 * The listener's bind authority and untrusted forwarding headers never define
 * protocol identity; only the incoming path/query are retained.
 */
function createCanonicalHttpRequest(
  scope: AbsoluteHttpUrl,
  requestTarget: string | undefined,
  options: NodeHttpRequestOptions = {},
): Request {
  const target = requestTarget ?? "/";
  const canonicalOrigin = `${new URL(scope).origin}/`;
  const pathAndQuery = normalizationSafeRawRequestPath(target);
  const canonical = new URL(pathAndQuery ?? ".bdp-invalid-request-target", canonicalOrigin);
  return new Request(canonical, {
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
}

function nodeRequestHeaders(rawHeaders: readonly string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

function normalizationSafeRawRequestPath(target: string): string | undefined {
  if (target.includes("#")) return undefined;
  const queryIndex = target.indexOf("?");
  const withoutQuery = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : target.slice(queryIndex);
  const schemeAuthority = /^https?:\/\//i.exec(withoutQuery);
  if (!withoutQuery.startsWith("/") && schemeAuthority === null) return undefined;
  const authorityStart =
    schemeAuthority !== null
      ? schemeAuthority[0].length
      : withoutQuery.startsWith("//")
        ? 2
        : undefined;
  const pathStart =
    authorityStart === undefined ? 0 : Math.max(withoutQuery.indexOf("/", authorityStart), 0);
  if (authorityStart !== undefined) {
    const authorityEnd = pathStart === 0 ? withoutQuery.length : pathStart;
    const authority = withoutQuery.slice(authorityStart, authorityEnd);
    if (!isNormalizationSafeRawAuthority(authority)) return undefined;
  }
  const pathname =
    pathStart === 0 && authorityStart !== undefined ? "/" : withoutQuery.slice(pathStart);
  if (target.includes("\\") || /%5c/i.test(pathname)) return undefined;
  if (!pathname.split("/").every((segment) => ![".", ".."].includes(segment.replace(/%2e/gi, "."))))
    return undefined;
  try {
    const parsed = new URL(target, "http://request.invalid");
    const pathAndQuery = `${pathname}${search}`;
    return `${parsed.pathname}${parsed.search}` === pathAndQuery ? pathAndQuery : undefined;
  } catch {
    return undefined;
  }
}

function isNormalizationSafeRawAuthority(authority: string): boolean {
  if (authority.length === 0 || authority.includes("@")) return false;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) return false;
    const literal = authority.slice(1, closingBracket);
    const port = authority.slice(closingBracket + 1);
    return RAW_AUTHORITY_IP_LITERAL.test(literal) && (port === "" || /^:[0-9]+$/.test(port));
  }
  const portSeparator = authority.lastIndexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? undefined : authority.slice(portSeparator + 1);
  return RAW_AUTHORITY_REG_NAME.test(host) && (port === undefined || /^[0-9]+$/.test(port));
}

/** Propagates either Node-side disconnect signal into one Web AbortSignal. */
function createNodeHttpDisconnectSignal(
  incoming: NodeHttpDisconnectSource,
  outgoing: NodeHttpResponseCloseSource,
): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("client disconnected"));
  incoming.once("aborted", abort);
  outgoing.once("close", () => {
    if (!outgoing.writableFinished) abort();
  });
  return controller.signal;
}

/**
 * Owns the complete Node-to-Web HTTP bridge used by both executable targets.
 * Unsupported methods are rejected before Fetch's Request constructor can
 * reject forbidden tokens such as TRACE or CONNECT.
 */
function createNodeRequestListener(
  scope: AbsoluteHttpUrl,
  handler: HttpHandler,
  options: NodeRequestListenerOptions = {},
): RequestListener {
  return async (incoming, outgoing) => {
    try {
      const method = incoming.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        incoming.resume();
        outgoing.statusCode = 405;
        outgoing.setHeader("allow", "GET, HEAD");
        outgoing.setHeader("content-length", 0);
        outgoing.end();
        return;
      }
      const signal = createNodeHttpDisconnectSignal(incoming, outgoing);
      const request = createCanonicalHttpRequest(scope, incoming.url, {
        method,
        signal,
        headers: nodeRequestHeaders(incoming.rawHeaders),
      });
      const response = await handler(request);
      if (outgoing.destroyed) return;
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => {
        outgoing.setHeader(key, value);
      });
      const body = response.body === undefined ? undefined : JSON.stringify(response.body);
      if (body !== undefined && !response.headers.has("content-length")) {
        outgoing.setHeader("content-length", Buffer.byteLength(body));
      }
      outgoing.end(method === "HEAD" ? undefined : body);
    } catch (error) {
      if (error instanceof ScopeServerOperationAbortedError) {
        outgoing.destroy();
        return;
      }
      options.onError?.(error);
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) {
        outgoing.destroy();
        return;
      }
      for (const name of outgoing.getHeaderNames()) outgoing.removeHeader(name);
      outgoing.statusCode = 500;
      outgoing.setHeader("content-length", 0);
      outgoing.end();
    }
  };
}

/** Creates the complete Node HTTP transport, including CONNECT rejection. */
export function createNodeHttpServer(
  server: ReadServer,
  options: NodeRequestListenerOptions = {},
): NodeHttpServer {
  if (!verifiedReadServers.has(server)) {
    throw new TypeError("createNodeHttpServer requires a server created by createReadServer");
  }
  const maxHeaderSize = nodeHeaderSizeForReadServer.get(server);
  if (maxHeaderSize !== undefined && maxHeaderSize > MAX_NODE_HEADER_SIZE) {
    throw new RangeError("Server Selector byte limit exceeds the safe Node transport ceiling");
  }
  const listener = createNodeServer(
    { maxHeaderSize },
    createNodeRequestListener(server.scope, createHttpHandler(server), options),
  );
  listener.on("connect", (_request, socket) => {
    socket.on("error", () => undefined);
    socket.end(
      "HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      () => socket.destroy(),
    );
  });
  verifiedNodeHttpServers.add(listener);
  return listener;
}

/** Binds a verified listener and keeps later listener failures structured. */
export function listenNodeHttpServer(
  listener: NodeHttpServer,
  options: NodeHttpListenOptions,
): Promise<void> {
  if (!verifiedNodeHttpServers.has(listener)) {
    throw new TypeError("listenNodeHttpServer requires a listener created by createNodeHttpServer");
  }
  if (boundNodeHttpServers.has(listener)) {
    throw new TypeError("listenNodeHttpServer may bind each listener only once");
  }
  boundNodeHttpServers.add(listener);
  return new Promise((resolve, reject) => {
    const onBindError = (error: unknown): void => {
      boundNodeHttpServers.delete(listener);
      listener.removeListener("error", onBindError);
      listener.removeListener("listening", onListening);
      reject(new NodeHttpListenerError(error));
    };
    const onListening = (): void => {
      listener.removeListener("error", onBindError);
      listener.on("error", (error) => options.onError(new NodeHttpListenerError(error)));
      resolve();
    };
    listener.once("error", onBindError);
    listener.once("listening", onListening);
    try {
      listener.listen(options.port, options.host);
    } catch (error) {
      onBindError(error);
    }
  });
}

/** Closes a verified listener, forcibly draining slow peers after a bounded grace period. */
export function closeNodeHttpServer(
  listener: NodeHttpServer,
  options: NodeHttpCloseOptions = {},
): Promise<void> {
  if (!verifiedNodeHttpServers.has(listener)) {
    throw new TypeError("closeNodeHttpServer requires a listener created by createNodeHttpServer");
  }
  if (!listener.listening) return Promise.resolve();
  const forceAfterMilliseconds = options.forceAfterMilliseconds ?? 1_000;
  return new Promise((resolve, reject) => {
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    listener.close((error) => {
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (error) reject(error);
      else resolve();
    });
    listener.closeIdleConnections();
    forceTimer = setTimeout(() => listener.closeAllConnections(), forceAfterMilliseconds);
    forceTimer.unref();
  });
}

/** Owns one Node listener and its ReadServer through bind, termination, and cleanup. */
export async function serveNodeHttpServer(
  server: ReadServer,
  options: NodeHttpServeOptions,
): Promise<NodeHttpServeResult> {
  const listener = createNodeHttpServer(
    server,
    options.onRequestError === undefined ? {} : { onError: options.onRequestError },
  );
  const processTermination =
    options.terminationSignal === undefined ? createProcessTerminationSignal() : undefined;
  const terminationSignal = options.terminationSignal ?? processTermination?.signal;
  if (terminationSignal === undefined) throw new TypeError("termination signal was not created");
  const termination = observeTermination(terminationSignal);
  let reportListenerFailure: (error: NodeHttpListenerError) => void = () => undefined;
  const listenerFailure = new Promise<NodeHttpListenerError>((resolve) => {
    reportListenerFailure = resolve;
  });
  let outcome: NodeHttpServeResult | undefined;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    await listenNodeHttpServer(listener, {
      host: options.host,
      port: options.port,
      onError: reportListenerFailure,
    });
    options.onStarted?.();
    outcome = await Promise.race([
      termination.promise.then((signal) => ({
        kind: "signal" as const,
        signal,
      })),
      listenerFailure.then((error) => ({ kind: "listener-failure" as const, error })),
    ]);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  } finally {
    termination.dispose();
    processTermination?.dispose();
  }
  const cleanup = await Promise.allSettled([closeNodeHttpServer(listener), server.close()]);
  const cleanupFailures = cleanup
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(({ reason }) => reason);
  if (primaryFailed) {
    if (cleanupFailures.length > 0)
      throw new AggregateError(
        [primaryError, ...cleanupFailures],
        "Node Read server operation and cleanup failed",
      );
    throw primaryError;
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(cleanupFailures, "Node Read server cleanup failed");
  if (outcome === undefined) throw new TypeError("Node Read server produced no stop outcome");
  return outcome;
}

function createProcessTerminationSignal(): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const stop = (signal: "SIGINT" | "SIGTERM"): void => controller.abort(signal);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    },
  };
}

function observeTermination(signal: AbortSignal): {
  readonly promise: Promise<"SIGINT" | "SIGTERM">;
  readonly dispose: () => void;
} {
  let stop: (() => void) | undefined;
  const promise = new Promise<"SIGINT" | "SIGTERM">((resolve, reject) => {
    stop = (): void => {
      if (signal.reason === "SIGINT" || signal.reason === "SIGTERM") resolve(signal.reason);
      else reject(new TypeError("termination signal reason must be SIGINT or SIGTERM"));
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (stop !== undefined) signal.removeEventListener("abort", stop);
    },
  };
}

export function createHttpHandler(server: ReadServer): HttpHandler {
  if (!verifiedReadServers.has(server)) {
    throw new TypeError("createHttpHandler requires a server created by createReadServer");
  }
  return async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return {
          status: 405,
          headers: new Headers({ allow: "GET, HEAD", "content-length": "0" }),
        };
      }
      const url = new URL(request.url);
      const scopeUrl = new URL(server.scope);
      if (url.origin !== scopeUrl.origin) return problemResponse(notFound());
      const probe = await server.probe({ signal: request.signal, httpRequest: request });
      const aliasPath = classifyAliasPath(url, server.scope);
      if (aliasPath !== undefined) {
        // Alias resolution runs inside the same authorization projection as
        // any read at this Scope, and strictly in this order: classify the
        // URL (no table access), apply the identity gate, and only then
        // consult the table — so neither the response nor its timing can
        // disclose alias existence to a caller the projection refuses.
        // Alias routing also precedes every representation-bearing route:
        // nothing is ever served at an alias URL.
        const gate = await server.perform(
          { kind: "scope-discovery", scope: server.scope },
          { signal: request.signal, httpRequest: request },
        );
        if (isReadServerProblem(gate)) return problemResponse(gate);
        if (isReadProblem(aliasPath)) return problemResponse(aliasPath);
        const aliasTarget = server.aliases?.get(aliasPath) ?? notFound();
        if (isReadProblem(aliasTarget)) return problemResponse(aliasTarget);
        return {
          status: 307,
          headers: new Headers({ location: aliasTarget, "content-length": "0" }),
        };
      }
      if (url.pathname === scopeUrl.pathname) {
        return {
          status: 204,
          headers: new Headers({
            link: `<${probe.serviceDescription}>; rel="service-desc"; type="application/json"`,
          }),
        };
      }
      if (url.href === probe.serviceDescription) {
        const discovery = await server.perform(
          { kind: "scope-discovery", scope: server.scope },
          { signal: request.signal, httpRequest: request },
        );
        return isReadServerProblem(discovery)
          ? problemResponse(discovery)
          : jsonResponse(discovery);
      }
      const parsed = requestFromUrl(url, server.scope);
      if (isReadProblem(parsed)) return problemResponse(parsed);
      const result = await server.perform(parsed, {
        signal: request.signal,
        httpRequest: request,
      });
      return isReadServerProblem(result)
        ? problemResponse(result)
        : scopeDataResponse(parsed, result);
    } catch (error) {
      if (error instanceof ScopeServerLocalError) {
        if (error.code === "operation-aborted") {
          throw error;
        }
        return problemResponse(readProblem("temporarily-unavailable", error.message));
      }
      throw error;
    }
  };
}

function jsonResponse(body: unknown): HttpResponse {
  return {
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body,
  };
}

function scopeDataResponse(operation: ReadRequest, body: unknown): HttpResponse {
  const response = jsonResponse(body);
  response.headers.set("cache-control", "private, no-store");
  if (
    operation.kind === "resource" &&
    operation.resource !== "type" &&
    typeof body === "object" &&
    body !== null &&
    "revision" in body &&
    typeof body.revision === "string"
  ) {
    response.headers.set("etag", resourceRevisionEtag(body.revision));
  }
  return response;
}

function resourceRevisionEtag(revision: string): string {
  // RFC 9110 entity tags are quoted opaque byte sequences, not HTTP quoted-
  // strings: a quote or control byte cannot be escaped inside the tag. BDP's
  // ordinary ASCII revisions are emitted unchanged as shown in the spec. For
  // revisions outside the entity-tag character profile, use an unambiguous
  // base64url projection whose marker cannot collide with an unchanged tag.
  const bytes = Buffer.from(revision, "utf8");
  const unchanged =
    bytes.length === revision.length &&
    bytes.every((byte) => byte === 0x21 || (byte >= 0x23 && byte <= 0x7e));
  let opaque: string;
  if (unchanged && !revision.startsWith("bdp-b64_") && !revision.startsWith("bdp-u16_")) {
    opaque = revision;
  } else if (isWellFormedUnicode(revision)) {
    opaque = `bdp-b64_${bytes.toString("base64url")}`;
  } else {
    // JavaScript can represent lone UTF-16 surrogates, for which UTF-8's
    // replacement encoding is not injective. Preserve those otherwise-valid
    // JSON strings with a separate code-unit projection.
    const codeUnits = Buffer.allocUnsafe(revision.length * 2);
    for (let index = 0; index < revision.length; index += 1) {
      codeUnits.writeUInt16BE(revision.charCodeAt(index), index * 2);
    }
    opaque = `bdp-u16_${codeUnits.toString("base64url")}`;
  }
  return `"${opaque}"`;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || following < 0xdc00 || following > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function problemResponse(problem: ReadProblem): HttpResponse {
  const definition = readProblemDefinitionFor(problem.code);
  const status = definition.status;
  if (problem.status !== undefined && problem.status !== status)
    throw new TypeError("Read Problem status does not match its code");
  if (problem.type !== definition.type)
    throw new TypeError("Read Problem type does not match its code");
  if (problem.retry !== definition.retry)
    throw new TypeError("Read Problem retry does not match its code");
  const headers = new Headers({
    "content-type": "application/problem+json",
    "cache-control": "private, no-store",
  });
  if (status === 401) {
    const challenge = SERVER_PROBLEM_CHALLENGES.get(problem);
    if (challenge === undefined) {
      throw new TypeError("Read Problem 401 requires a configured authentication challenge");
    }
    headers.set("www-authenticate", challenge);
  }
  return {
    status,
    headers,
    body: problem,
  };
}

function serverProblem(problem: ReadProblem, challenge?: string): ReadProblem {
  const branded = Object.freeze({ ...problem });
  SERVER_PROBLEMS.add(branded);
  if (challenge !== undefined) SERVER_PROBLEM_CHALLENGES.set(branded, challenge);
  return branded;
}

/** Narrows a ReadServer result without structurally inspecting success data. */
export function isReadServerProblem(value: unknown): value is ReadProblem {
  return typeof value === "object" && value !== null && SERVER_PROBLEMS.has(value);
}

function requestFromUrl(url: URL, scope: AbsoluteHttpUrl): ReadRequest | ReadProblem {
  const scopeUrl = new URL(scope);
  if (url.origin !== scopeUrl.origin) return notFound();
  if (!url.pathname.startsWith(scopeUrl.pathname)) return notFound();
  const relative = url.pathname.slice(scopeUrl.pathname.length);
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 1 && ["beads", "links", "types"].includes(segments[0] ?? "")) {
    const collection = segments[0] as "beads" | "links" | "types";
    if (relative !== `${collection}/`) return notFound();
    const parameterIssue = validateCollectionParameters(url, collection);
    if (parameterIssue !== undefined) return parameterIssue;
    const parameter = (name: string): string | undefined => url.searchParams.get(name) ?? undefined;
    const limit = parseOptionalLimit(parameter("limit"));
    if (isReadProblem(limit)) return limit;
    if (collection === "types") {
      if (parameter("cursor") !== undefined)
        return { kind: "collection", collection, continuation: url.href };
      return {
        kind: "collection",
        collection,
        ...(limit === undefined ? {} : { limit }),
      };
    }
    const type = parseOptionalTypeParameter(parameter("type"), scope);
    if (isReadProblem(type)) return type;
    const conformsTo = parseOptionalTypeParameter(parameter("conformsTo"), scope);
    if (isReadProblem(conformsTo)) return conformsTo;
    const filters = {
      ...(type === undefined ? {} : { type }),
      ...(conformsTo === undefined ? {} : { conformsTo }),
    };
    const controls = {
      ...(limit === undefined ? {} : { limit }),
      ...(parameter("selector") === undefined ? {} : { selector: parameter("selector") as string }),
    };
    if (collection === "beads") {
      if (parameter("cursor") !== undefined)
        return { kind: "collection", collection, continuation: url.href };
      return { kind: "collection", collection, ...filters, ...controls };
    }
    const source = normalizeEndpointParameter(parameter("source"), scope);
    if (isReadProblem(source)) return source;
    const target = normalizeEndpointParameter(parameter("target"), scope);
    if (isReadProblem(target)) return target;
    const endpoint = normalizeEndpointParameter(parameter("endpoint"), scope);
    if (isReadProblem(endpoint)) return endpoint;
    if (parameter("cursor") !== undefined)
      return { kind: "collection", collection, continuation: url.href };
    return {
      kind: "collection",
      collection,
      ...filters,
      ...(source === undefined ? {} : { source }),
      ...(target === undefined ? {} : { target }),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...controls,
    } as ReadRequest;
  }
  if (
    segments.length >= 2 &&
    (segments[0] === "beads" || segments[0] === "links" || segments[0] === "types")
  ) {
    const resourceRoot = segments[0];
    const localId = `${resourceRoot}/${segments.slice(1).join("/")}`;
    if (relative !== localId) return notFound();
    let id: AbsoluteHttpUrl;
    try {
      id = resolveCanonicalLocalResourceId(
        scope,
        resourceRoot === "beads" ? "bead" : resourceRoot === "links" ? "link" : "type",
        localId,
      );
    } catch (error) {
      if (error instanceof ProtocolArtifactValidationError) return notFound();
      throw error;
    }
    if (resourceRoot === "types")
      return validateParameters(url, []) ?? { kind: "resource", resource: "type", id };
    const view = url.searchParams.get("view") ?? undefined;
    if (view === undefined)
      return (validateParameters(url, []) ?? {
        kind: "resource",
        resource: resourceRoot === "beads" ? "bead" : "link",
        id,
      }) as ReadRequest;
    if (view === "properties") {
      const parameterIssue = validateParameters(url, ["view"]);
      if (parameterIssue !== undefined) return parameterIssue;
      return {
        kind: "properties",
        resource: resourceRoot === "beads" ? "bead" : "link",
        id,
      } as ReadRequest;
    }
    if (view === "links" && resourceRoot === "beads") {
      const parameterIssue = validateParameters(url, ["view", "direction", "limit", "cursor"]);
      if (parameterIssue !== undefined) return parameterIssue;
      const direction = url.searchParams.get("direction") ?? "both";
      if (direction !== "inbound" && direction !== "outbound" && direction !== "both")
        return invalidParameter();
      const limit = parseOptionalLimit(url.searchParams.get("limit") ?? undefined);
      if (isReadProblem(limit)) return limit;
      if (url.searchParams.has("cursor"))
        return { kind: "bead-links", bead: id, continuation: url.href };
      return {
        kind: "bead-links",
        bead: id,
        direction,
        ...(limit === undefined ? {} : { limit }),
      };
    }
    return invalidParameter();
  }
  return notFound();
}

function parseOptionalLimit(value: string | undefined): number | undefined | ReadProblem {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) return invalidParameter();
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : invalidParameter();
}

function notFound(): ReadProblem {
  return readProblem("resource-not-found");
}

function invalidParameter(): ReadProblem {
  return readProblem("invalid-parameter");
}

function parseOptionalTypeParameter(
  value: string | undefined,
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | undefined | ReadProblem {
  if (value === undefined) return undefined;
  return parseTypeIdentity(value, scope);
}

function parseTypeIdentity(value: unknown, scope: AbsoluteHttpUrl): AbsoluteHttpUrl | ReadProblem {
  try {
    const id = parseCanonicalTypeId(value);
    if (id.startsWith(scope)) {
      const localId = id.slice(scope.length);
      if (resolveCanonicalLocalResourceId(scope, "type", localId) !== id) return invalidParameter();
    }
    return id;
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) return invalidParameter();
    throw error;
  }
}

const COLLECTION_PARAMETERS = {
  beads: ["type", "conformsTo", "selector", "limit", "cursor"],
  links: ["type", "conformsTo", "source", "target", "endpoint", "selector", "limit", "cursor"],
  types: ["limit", "cursor"],
} as const;

function validateCollectionParameters(
  url: URL,
  collection: "beads" | "links" | "types",
): ReadProblem | undefined {
  return validateParameters(url, COLLECTION_PARAMETERS[collection]);
}

function validateParameters(url: URL, allowed: readonly string[]): ReadProblem | undefined {
  for (const name of new Set(url.searchParams.keys()))
    if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1)
      return invalidParameter();
  return undefined;
}

function normalizeEndpointParameter(
  value: string | undefined,
  scope: AbsoluteHttpUrl,
): string | undefined | ReadProblem {
  if (value === undefined) return undefined;
  try {
    if (!isJsonSchemaUri(value)) return resolveCanonicalLocalResourceId(scope, "bead", value);
    // RFC 3986 admits absolute URI spellings (for example IPvFuture authorities)
    // that WHATWG URL cannot parse. They cannot identify this WHATWG-canonical Scope.
    if (!URL.canParse(value)) return value;
    const parsed = new URL(value);
    const scopeUrl = new URL(scope);
    const insideScope =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === scopeUrl.origin &&
      parsed.pathname.startsWith(scopeUrl.pathname);
    // External endpoint identity is opaque: validate the original RFC 3986
    // spelling, classify with a parsed copy, and never serialize it back.
    if (!insideScope) return value;
    if (parsed.username !== "" || parsed.password !== "" || !value.startsWith(scope))
      return invalidParameter();
    const localId = value.slice(scope.length);
    return resolveCanonicalLocalResourceId(scope, "bead", localId) === value
      ? value
      : invalidParameter();
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError || error instanceof TypeError)
      return invalidParameter();
    throw error;
  }
}

function validateLocalResourceIdentity(
  value: unknown,
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link",
): ReadProblem | undefined {
  if (typeof value !== "string" || !value.startsWith(scope)) return invalidParameter();
  try {
    const localId = value.slice(scope.length);
    if (resolveCanonicalLocalResourceId(scope, resource, localId) !== value)
      return invalidParameter();
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) return invalidParameter();
    throw error;
  }
  return undefined;
}

const SERVER_OPTION_FIELDS = [
  "scope",
  "target",
  "admittedProfile",
  "port",
  "readControls",
  "advertisedLimits",
  "serviceDescription",
  "aliases",
  "closeGraceMs",
  "closeTimeoutMs",
] as const;

function snapshotServerOptions(value: ServerOptions): ServerOptions {
  const fields = snapshotOwnDataObject(value, "ServerOptions", SERVER_OPTION_FIELDS, [
    "scope",
    "target",
    "admittedProfile",
    "port",
  ]);
  const readControls =
    fields.readControls === undefined
      ? undefined
      : snapshotServerReadControls(fields.readControls as ServerReadControls);
  const advertisedLimits =
    fields.advertisedLimits === undefined
      ? undefined
      : snapshotServerAdvertisedReadLimits(fields.advertisedLimits);
  return Object.freeze({
    scope: fields.scope as AbsoluteHttpUrl,
    target: fields.target as ReadServerTarget,
    admittedProfile: fields.admittedProfile as AdmittedReadProfile,
    port: snapshotScopePort(fields.port),
    ...(readControls === undefined ? {} : { readControls }),
    ...(advertisedLimits === undefined ? {} : { advertisedLimits }),
    ...(fields.aliases === undefined
      ? {}
      : {
          aliases: Object.freeze({
            ...(fields.aliases as Readonly<Record<string, AbsoluteHttpUrl>>),
          }),
        }),
    ...(fields.serviceDescription === undefined
      ? {}
      : { serviceDescription: fields.serviceDescription as AbsoluteHttpUrl }),
    ...(fields.closeGraceMs === undefined ? {} : { closeGraceMs: fields.closeGraceMs as number }),
    ...(fields.closeTimeoutMs === undefined
      ? {}
      : { closeTimeoutMs: fields.closeTimeoutMs as number }),
  });
}

function snapshotServerAdvertisedReadLimits(value: unknown): ServerAdvertisedReadLimits {
  const fields = snapshotOwnDataObject(
    value,
    "Server advertised limits",
    ["page", "selector", "cursorTtlMilliseconds"],
    ["page", "selector", "cursorTtlMilliseconds"],
  );
  const page = snapshotOwnDataObject(
    fields.page,
    "Server advertised page limits",
    ["defaultItems", "maximumItems"],
    ["defaultItems", "maximumItems"],
  );
  const selector = snapshotOwnDataObject(
    fields.selector,
    "Server advertised Selector limits",
    ["bytes", "depth", "nodes"],
    ["bytes", "depth", "nodes"],
  );
  for (const [name, candidate] of [
    ["page.defaultItems", page.defaultItems],
    ["page.maximumItems", page.maximumItems],
    ["selector.bytes", selector.bytes],
    ["selector.depth", selector.depth],
    ["selector.nodes", selector.nodes],
    ["cursorTtlMilliseconds", fields.cursorTtlMilliseconds],
  ] as const) {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0) {
      throw new TypeError(`Server advertised limit ${name} must be a positive safe integer`);
    }
  }
  if ((page.defaultItems as number) > (page.maximumItems as number)) {
    throw new TypeError("Server advertised page defaultItems must not exceed page maximumItems");
  }
  return Object.freeze({
    page: Object.freeze({
      defaultItems: page.defaultItems as number,
      maximumItems: page.maximumItems as number,
    }),
    selector: Object.freeze({
      bytes: selector.bytes as number,
      depth: selector.depth as number,
      nodes: selector.nodes as number,
    }),
    cursorTtlMilliseconds: fields.cursorTtlMilliseconds as number,
  });
}

function snapshotServerReadControls(value: ServerReadControls): ServerReadControls {
  const fields = snapshotOwnDataObject(
    value,
    "ServerReadControls",
    ["selectorLimits", "pagination", "unauthenticatedChallenge", "identityFor", "problemFor"],
    ["selectorLimits", "pagination", "identityFor", "problemFor"],
  );
  const limits = snapshotOwnDataObject(
    fields.selectorLimits,
    "ServerReadControls selector limits",
    ["bytes", "depth", "nodes"],
    ["bytes", "depth", "nodes"],
  );
  return Object.freeze({
    selectorLimits: Object.freeze({
      bytes: limits.bytes as number,
      depth: limits.depth as number,
      nodes: limits.nodes as number,
    }),
    pagination: fields.pagination as ReadPagination<ServerReadPageItem>,
    ...(fields.unauthenticatedChallenge === undefined
      ? {}
      : { unauthenticatedChallenge: fields.unauthenticatedChallenge as string }),
    identityFor: fields.identityFor as ServerReadControls["identityFor"],
    problemFor: fields.problemFor as ServerReadControls["problemFor"],
  });
}

function snapshotScopePort(value: unknown): ScopePort {
  if (typeof value !== "object" || value === null || isProxy(value))
    throw new TypeError("ScopePort must be a non-proxy object");
  let owner: object | null = value;
  let descriptor: PropertyDescriptor | undefined;
  while (owner !== null && descriptor === undefined) {
    descriptor = Object.getOwnPropertyDescriptor(owner, "perform");
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function"
  )
    throw new TypeError("ScopePort perform must be a data function");
  const perform = descriptor.value.bind(value) as ScopePort["perform"];
  return Object.freeze({ perform });
}

function snapshotOwnDataObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value))
    throw new TypeError(`${label} must be a plain non-proxy object`);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} must be a plain non-proxy object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key))
      throw new TypeError(`${label} contains an unexpected field`);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError(`${label} fields must be own data properties`);
    result[key] = descriptor.value;
  }
  for (const key of required)
    if (!Object.hasOwn(result, key)) throw new TypeError(`${label} is missing ${key}`);
  return Object.freeze(result);
}

export function createReadServer(options: ServerOptions): ReadServer {
  options = snapshotServerOptions(options);
  validateConfiguredScope(options.scope);
  if (
    typeof options.admittedProfile !== "object" ||
    options.admittedProfile === null ||
    !admittedReadProfiles.has(options.admittedProfile)
  ) {
    throw new TypeError("createReadServer requires a profile returned by admitReadServerProfile");
  }
  if (options.target !== options.admittedProfile.target) {
    throw new TypeError(
      `server target '${options.target}' does not match admitted target '${options.admittedProfile.target}'`,
    );
  }
  if (options.readControls !== undefined) validateServerReadControls(options.readControls);
  validateAdvertisedReadControlsBinding(options.advertisedLimits, options.readControls);
  const closeGraceMs = options.closeGraceMs ?? 250;
  const closeTimeoutMs = options.closeTimeoutMs ?? 2_000;
  validateServerCloseBound("closeGraceMs", closeGraceMs);
  validateServerCloseBound("closeTimeoutMs", closeTimeoutMs);
  if (closeGraceMs > closeTimeoutMs)
    throw new RangeError("closeGraceMs must not exceed closeTimeoutMs");
  const readControls = options.readControls;
  const nodeHeaderSize =
    readControls === undefined
      ? undefined
      : nodeHeaderSizeForSelector(readControls.selectorLimits.bytes);
  if (readControls !== undefined && boundServerReadPaginations.has(readControls.pagination)) {
    throw new TypeError("each Read pagination engine may be bound to only one server");
  }
  if (readControls !== undefined) boundServerReadPaginations.add(readControls.pagination);
  const admitted = new Set<Promise<unknown>>();
  const closing = new AbortController();
  const aliasTable = validateAliasTable(options.aliases, options.scope, options.serviceDescription);
  const discovery = Object.freeze(discoveryFor(options));
  let state: "open" | "closing" | "closed" = "open";
  let closePromise: Promise<void> | undefined;

  const server: ReadServer = {
    scope: options.scope,
    ...(aliasTable === undefined ? {} : { aliases: aliasTable }),

    probe(): Promise<ScopeProbe> {
      if (state !== "open") return Promise.reject(new ScopeServerClosedError());
      return Promise.resolve({
        serviceDescription: options.serviceDescription ?? new URL("bdp.json", options.scope).href,
      });
    },

    perform<Request extends ReadRequest>(
      request: Request,
      performOptions: PerformOptions = {},
    ): Promise<ReadResultFor<Request>> {
      if (state !== "open") return Promise.reject(new ScopeServerClosedError());
      if (performOptions.signal?.aborted === true) {
        return Promise.reject(
          new ScopeServerOperationAbortedError({ cause: performOptions.signal.reason }),
        );
      }

      const signal =
        performOptions.signal === undefined
          ? closing.signal
          : AbortSignal.any([performOptions.signal, closing.signal]);
      const operation = dispatchWithAbort(
        options,
        request,
        signal,
        discovery,
        performOptions.httpRequest,
      );
      admitted.add(operation.completion);
      void operation.completion.then(
        () => admitted.delete(operation.completion),
        () => admitted.delete(operation.completion),
      );
      return operation.result;
    },

    close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      state = "closing";
      const draining = [...admitted];
      closePromise = drainServerOperations(draining, closing, closeGraceMs, closeTimeoutMs).finally(
        () => {
          readControls?.pagination.close();
          state = "closed";
        },
      );
      return closePromise;
    },
  };
  if (nodeHeaderSize !== undefined) nodeHeaderSizeForReadServer.set(server, nodeHeaderSize);
  verifiedReadServers.add(server);
  return server;
}

const NODE_HEADER_OVERHEAD_BYTES = 16 * 1024;
const MAX_NODE_HEADER_SIZE = 1024 * 1024;

function nodeHeaderSizeForSelector(selectorBytes: number): number {
  // The request target shares Node's header budget. Every decoded Selector byte
  // can occupy three percent-encoded octets. Reserve another 16 KiB for the
  // request line, ordinary headers, and the canonical Scope path, while keeping
  // the parser ceiling at 1 MiB so configuration cannot create an unbounded
  // per-connection header allocation.
  const size = selectorBytes * 3 + NODE_HEADER_OVERHEAD_BYTES;
  if (!Number.isSafeInteger(size))
    throw new RangeError("Server Selector byte limit exceeds the safe transport size range");
  return size;
}

function validateAdvertisedReadControlsBinding(
  advertised: ServerAdvertisedReadLimits | undefined,
  controls: ServerReadControls | undefined,
): void {
  if (advertised === undefined) return;
  if (controls === undefined) {
    throw new TypeError("advertised Read limits require enforced ServerReadControls");
  }
  const pagination = controls.pagination.limits;
  if (
    advertised.page.defaultItems !== pagination.defaultPageItems ||
    advertised.page.maximumItems !== pagination.maxPageItems ||
    advertised.cursorTtlMilliseconds !== pagination.cursorTtlMs ||
    advertised.selector.bytes !== controls.selectorLimits.bytes ||
    advertised.selector.depth !== controls.selectorLimits.depth ||
    advertised.selector.nodes !== controls.selectorLimits.nodes
  ) {
    throw new TypeError("advertised Read limits must exactly match enforced ServerReadControls");
  }
}

function validateServerReadControls(value: ServerReadControls): void {
  if (typeof value !== "object" || value === null)
    throw new TypeError("ServerReadControls must be an object");
  if (!serverReadPaginations.has(value.pagination))
    throw new TypeError("ServerReadControls requires pagination returned by createReadPagination");
  if (typeof value.identityFor !== "function" || typeof value.problemFor !== "function")
    throw new TypeError("ServerReadControls policy dependencies must be functions");
  if (value.unauthenticatedChallenge !== undefined) {
    validateAuthenticationChallenge(value.unauthenticatedChallenge);
  }
  if (typeof value.selectorLimits !== "object" || value.selectorLimits === null)
    throw new TypeError("ServerReadControls selector limits must be an object");
  for (const limit of [
    value.selectorLimits.bytes,
    value.selectorLimits.depth,
    value.selectorLimits.nodes,
  ]) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new TypeError("ServerReadControls selector limits must be positive safe integers");
  }
}

function validateServerCloseBound(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
    throw new RangeError(`${name} must be a non-negative safe timer duration`);
}

const AUTH_SCHEME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function validateAuthenticationChallenge(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new TypeError(
      "unauthenticatedChallenge must be a non-empty RFC authentication challenge",
    );
  }
  const scheme = value.split(/[ \t]/, 1)[0];
  if (scheme === undefined || !AUTH_SCHEME.test(scheme)) {
    throw new TypeError("unauthenticatedChallenge must begin with an RFC auth-scheme token");
  }
  try {
    new Headers({ "www-authenticate": value });
  } catch {
    throw new TypeError("unauthenticatedChallenge is not a valid HTTP header value");
  }
}

async function drainServerOperations(
  operations: readonly Promise<unknown>[],
  controller: AbortController,
  graceMs: number,
  timeoutMs: number,
): Promise<void> {
  if (operations.length === 0) return;
  const drained = Promise.allSettled(operations);
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    graceTimer = setTimeout(resolve, graceMs);
  });
  const timeout = new Promise<void>((resolve) => {
    timeoutTimer = setTimeout(resolve, timeoutMs);
  });
  try {
    const settledDuringGrace = await Promise.race([
      drained.then(() => true),
      grace.then(() => false),
    ]);
    if (settledDuringGrace) return;
    controller.abort(new ScopeServerClosedError());
    await Promise.race([drained, timeout]);
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  }
}

function validateConfiguredScope(scope: unknown): asserts scope is AbsoluteHttpUrl {
  try {
    if (typeof scope !== "string") throw new TypeError("Scope must be a string");
    resolveCanonicalLocalResourceId(scope as AbsoluteHttpUrl, "bead", "beads/scope-validation");
  } catch (cause) {
    throw new TypeError("createReadServer scope must be a canonical HTTP(S) URL ending in /", {
      cause,
    });
  }
}

function dispatchWithAbort<RequestType extends ReadRequest>(
  options: ServerOptions,
  request: RequestType,
  signal: AbortSignal,
  discovery: ReadDiscovery,
  httpRequest: Request | undefined,
): {
  readonly result: Promise<ReadResultFor<RequestType>>;
  readonly completion: Promise<ReadResultFor<RequestType>>;
} {
  let completion: Promise<ReadResultFor<RequestType>>;
  try {
    completion = dispatch(options, request, signal, discovery, httpRequest);
  } catch (error) {
    const result = Promise.reject<ReadResultFor<RequestType>>(error);
    return { result, completion: result };
  }
  const result = new Promise<ReadResultFor<RequestType>>((resolve, reject) => {
    const abort = (): void => {
      reject(new ScopeServerOperationAbortedError({ cause: signal.reason }));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void completion.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  return { result, completion };
}

function dispatch<RequestType extends ReadRequest>(
  options: ServerOptions,
  request: RequestType,
  signal: AbortSignal,
  discovery: ReadDiscovery,
  httpRequest: Request | undefined,
): Promise<ReadResultFor<RequestType>> {
  const variant = resolveReadRequestVariant(request);
  if (variant === undefined)
    return Promise.resolve(serverProblem(invalidParameter())) as Promise<
      ReadResultFor<RequestType>
    >;
  return variant.execute(request, {
    options,
    signal,
    discovery,
    ...(httpRequest === undefined ? {} : { httpRequest }),
  }) as Promise<ReadResultFor<RequestType>>;
}

interface ReadRequestDispatchContext {
  readonly options: ServerOptions;
  readonly signal: AbortSignal;
  readonly discovery: ReadDiscovery;
  readonly httpRequest?: Request;
}

interface ReadRequestVariant {
  readonly fields: readonly string[];
  matches(request: Readonly<Record<string, unknown>>): boolean;
  execute(request: unknown, context: ReadRequestDispatchContext): Promise<unknown>;
}

type ReadRequestVariantKey<Request extends ReadRequest = ReadRequest> = Request extends ReadRequest
  ? Request extends { readonly kind: "scope-discovery" }
    ? "scope-discovery"
    : Request extends {
          readonly kind: "collection";
          readonly collection: infer Collection extends string;
        }
      ? `collection:${Collection}`
      : Request extends {
            readonly kind: "resource" | "properties";
            readonly resource: infer Resource extends string;
          }
        ? `${Request["kind"]}:${Resource}`
        : Request extends { readonly kind: "bead-links" }
          ? "bead-links"
          : Request extends { readonly kind: infer Kind extends string }
            ? `unhandled:${Kind}`
            : "unhandled:request"
  : never;

type ScopeRequestValidation<Operation extends ScopeReadOperation> = (
  operation: Operation,
  options: ServerOptions,
) => ReadProblem | undefined;

type ScopeBodyValidation<Operation extends ScopeReadOperation> = (
  operation: Operation,
  value: unknown,
  scope: AbsoluteHttpUrl,
) => ReadBodyFor<Operation>;

function readRequestDiscriminant(
  kind: ReadRequest["kind"],
  secondary?: readonly ["collection" | "resource", string],
): (request: Readonly<Record<string, unknown>>) => boolean {
  return (request) =>
    request.kind === kind && (secondary === undefined || request[secondary[0]] === secondary[1]);
}

function defineScopeReadVariant<Operation extends ScopeReadOperation>(options: {
  readonly matches: (request: Readonly<Record<string, unknown>>) => boolean;
  readonly fields: readonly string[];
  readonly validate: ScopeRequestValidation<Operation>;
  readonly validateBody: ScopeBodyValidation<Operation>;
}): ReadRequestVariant {
  return Object.freeze({
    fields: options.fields,
    matches: options.matches,
    execute(request: unknown, context: ReadRequestDispatchContext): Promise<unknown> {
      // The descriptor's discriminant and exact-field check establish this variant.
      const operation = request as unknown as Operation;
      const issue = options.validate(operation, context.options);
      if (issue !== undefined) return Promise.resolve(serverProblem(issue));
      return executeScopeRead(operation, context, options.validateBody);
    },
  });
}

async function executeScopeRead<Operation extends ScopeReadOperation>(
  operation: Operation,
  context: ReadRequestDispatchContext,
  validateBody: ScopeBodyValidation<Operation>,
): Promise<unknown> {
  const controls = context.options.readControls;
  if (controls === undefined) {
    const result = await context.options.port.perform(operation, { signal: context.signal });
    assertReadNotAborted(context.signal);
    const validated = validateScopePortResult(
      operation,
      result,
      context.options.scope,
      validateBody,
    );
    // The advertised canonical-uri order binds every collection response,
    // with or without read controls: discovery always advertises it, so
    // every path that can serve items must sort them.
    return sortCollectionResult(operation, validated);
  }

  try {
    const identified = await identifyReadOperation(operation, context, controls);
    if (isReadServerProblem(identified)) return identified;
    if (!isPageOperation(operation)) {
      const result = await context.options.port.perform(operation, { signal: context.signal });
      assertReadNotAborted(context.signal);
      return validateScopePortResult(operation, result, context.options.scope, validateBody);
    }
    const identity = identified;
    controls.pagination.validateLimit(operation.limit);
    if (
      operation.kind === "collection" &&
      operation.collection !== "types" &&
      operation.selector !== undefined
    ) {
      selectReadResources(operation.selector, controls.selectorLimits, []);
    }
    if (operation.continuation !== undefined) {
      const continuation = continuationDetails(operation, context.options.scope);
      if (isReadProblem(continuation)) return serverProblem(continuation);
      assertReadNotAborted(context.signal);
      return controls.pagination.continuePage({
        token: continuation.token,
        projection: continuation.projection,
        authorizationView: identity.authorizationView,
        scopeEpoch: identity.scopeEpoch,
      });
    }

    const structuralOperation = withoutPageControls(operation);
    const result = await context.options.port.perform(structuralOperation, {
      signal: context.signal,
    });
    assertReadNotAborted(context.signal);
    const body = validateScopePortResult(
      structuralOperation,
      result,
      context.options.scope,
      validateBody as ScopeBodyValidation<typeof structuralOperation>,
    );
    if (isReadServerProblem(body)) return body;
    const items =
      operation.kind === "collection" &&
      operation.collection !== "types" &&
      operation.selector !== undefined
        ? selectReadResources(
            operation.selector,
            controls.selectorLimits,
            body.items as readonly (BeadRecord | LinkRecord)[],
          )
        : body.items;
    const continuationUrl = continuationUrlFor(operation, context.options.scope);
    assertReadNotAborted(context.signal);
    return controls.pagination.firstPage({
      items: inCanonicalUriOrder(items as readonly { readonly id: string }[]) as typeof items,
      ...(operation.limit === undefined ? {} : { limit: operation.limit }),
      authorizationView: identity.authorizationView,
      scopeEpoch: identity.scopeEpoch,
      projection: continuationUrl,
      continuationUrl,
    });
  } catch (error) {
    if (error instanceof ReadSelectorError || error instanceof ReadPaginationError) {
      return serverProblem(
        parseReadProblem(controls.problemFor(error), "ServerReadControls Problem"),
      );
    }
    throw error;
  }
}

async function identifyReadOperation(
  operation: ReadRequest,
  context: ReadRequestDispatchContext,
  controls: ServerReadControls,
): Promise<ServerReadIdentity | ReadProblem> {
  const identified = await controls.identityFor(operation, {
    signal: context.signal,
    ...(context.httpRequest === undefined ? {} : { httpRequest: context.httpRequest }),
  });
  assertReadNotAborted(context.signal);
  if (!isReadProblem(identified)) return identified;
  return serverProblem(
    parseReadProblem(identified, "ServerReadControls identity Problem"),
    identified.code === "unauthenticated" ? controls.unauthenticatedChallenge : undefined,
  );
}

function assertReadNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ScopeServerOperationAbortedError({ cause: signal.reason });
}

type PageOperation =
  | BeadCollectionOperation
  | LinkCollectionOperation
  | TypeInventoryOperation
  | BeadLinksOperation;

/**
 * The advertised `canonical-uri` collection order: ascending lexicographic
 * comparison, by Unicode code unit, of each item's absolute canonical id.
 * Applied by the authority before pagination so every page of one logical
 * snapshot observes one total order.
 */
function inCanonicalUriOrder<Item extends { readonly id: string }>(
  items: readonly Item[],
): readonly Item[] {
  return Object.freeze(
    [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  );
}

/** Applies the canonical-uri order to any successful collection-shaped result. */
function sortCollectionResult(operation: ReadRequest, validated: unknown): unknown {
  if (!isPageOperation(operation)) return validated;
  if (isReadServerProblem(validated)) return validated;
  const body = validated as { readonly items?: readonly { readonly id: string }[] };
  if (!Array.isArray(body.items)) return validated;
  return Object.freeze({ ...body, items: inCanonicalUriOrder(body.items) });
}

function isPageOperation(operation: ReadRequest): operation is PageOperation {
  return operation.kind === "collection" || operation.kind === "bead-links";
}

function withoutPageControls(operation: PageOperation): PageOperation {
  if (operation.kind === "bead-links") {
    return {
      kind: "bead-links",
      bead: operation.bead,
      ...(operation.direction === undefined ? {} : { direction: operation.direction }),
    };
  }
  if (operation.collection === "types") return { kind: "collection", collection: "types" };
  const common = {
    kind: "collection" as const,
    collection: operation.collection,
    ...(operation.type === undefined ? {} : { type: operation.type }),
    ...(operation.conformsTo === undefined ? {} : { conformsTo: operation.conformsTo }),
  };
  if (operation.collection === "beads") return common;
  return {
    ...common,
    ...(operation.source === undefined ? {} : { source: operation.source }),
    ...(operation.target === undefined ? {} : { target: operation.target }),
    ...(operation.endpoint === undefined ? {} : { endpoint: operation.endpoint }),
  };
}

function continuationUrlFor(operation: PageOperation, scope: AbsoluteHttpUrl): string {
  const url =
    operation.kind === "bead-links"
      ? new URL(operation.bead)
      : new URL(`${operation.collection}/`, scope);
  if (operation.kind === "bead-links") {
    url.searchParams.set("view", "links");
    if (operation.direction !== undefined) url.searchParams.set("direction", operation.direction);
  } else if (operation.collection !== "types") {
    if (operation.type !== undefined) url.searchParams.set("type", operation.type);
    if (operation.conformsTo !== undefined)
      url.searchParams.set("conformsTo", operation.conformsTo);
    if (operation.collection === "links") {
      if (operation.source !== undefined) url.searchParams.set("source", operation.source);
      if (operation.target !== undefined) url.searchParams.set("target", operation.target);
      if (operation.endpoint !== undefined) url.searchParams.set("endpoint", operation.endpoint);
    }
    if (operation.selector !== undefined) url.searchParams.set("selector", operation.selector);
  }
  if (operation.limit !== undefined) url.searchParams.set("limit", String(operation.limit));
  return url.href;
}

function continuationDetails(
  operation: PageOperation,
  scope: AbsoluteHttpUrl,
): { readonly token: string; readonly projection: string } | ReadProblem {
  let url: URL;
  try {
    url = new URL(operation.continuation ?? "");
  } catch {
    return invalidParameter();
  }
  const parsed = requestFromUrl(url, scope);
  if (isReadProblem(parsed)) return parsed;
  if (
    !isPageOperation(parsed) ||
    parsed.continuation !== url.href ||
    parsed.kind !== operation.kind ||
    (operation.kind === "collection" &&
      (parsed.kind !== "collection" || parsed.collection !== operation.collection)) ||
    (operation.kind === "bead-links" &&
      (parsed.kind !== "bead-links" || parsed.bead !== operation.bead))
  )
    return invalidParameter();
  const token = url.searchParams.get("cursor");
  if (token === null) return invalidParameter();
  url.searchParams.delete("cursor");
  return Object.freeze({ token, projection: url.href });
}

function collectionControlIssue(
  operation: {
    readonly continuation?: AbsoluteHttpUrl;
    readonly limit?: number;
    readonly selector?: string;
  },
  enabled: boolean,
  continuationIncompatible: readonly unknown[],
): ReadProblem | undefined {
  if (enabled) {
    if (
      operation.continuation !== undefined &&
      (operation.limit !== undefined ||
        operation.selector !== undefined ||
        continuationIncompatible.some((value) => value !== undefined))
    )
      return invalidParameter();
    if (operation.selector !== undefined && typeof operation.selector !== "string")
      return invalidParameter();
    return undefined;
  }
  return operation.continuation !== undefined ||
    operation.limit !== undefined ||
    operation.selector !== undefined
    ? invalidParameter()
    : undefined;
}

function typeFilterIssue(
  operation: { readonly type?: AbsoluteHttpUrl; readonly conformsTo?: AbsoluteHttpUrl },
  scope: AbsoluteHttpUrl,
): ReadProblem | undefined {
  for (const value of [operation.type, operation.conformsTo]) {
    const parsed = parseOptionalTypeParameter(value, scope);
    if (isReadProblem(parsed)) return parsed;
  }
  return undefined;
}

function localResourceIssue(
  operation: { readonly id: AbsoluteHttpUrl; readonly resource: "bead" | "link" },
  scope: AbsoluteHttpUrl,
): ReadProblem | undefined {
  return validateLocalResourceIdentity(operation.id, scope, operation.resource);
}

type BeadCollectionOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "beads" }
>;
type LinkCollectionOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "links" }
>;
type TypeInventoryOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "types" }
>;
type BeadResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "bead" }
>;
type LinkResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "link" }
>;
type TypeResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "type" }
>;
type BeadPropertiesOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "properties"; readonly resource: "bead" }
>;
type LinkPropertiesOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "properties"; readonly resource: "link" }
>;
type BeadLinksOperation = Extract<ScopeReadOperation, { readonly kind: "bead-links" }>;

// This is the only semantic Read-variant registration point. The derived key
// union makes a newly added protocol variant a compile error until its exact
// fields, request validation, and response validation are registered here.
const READ_REQUEST_VARIANTS = Object.freeze({
  "scope-discovery": Object.freeze({
    fields: ["kind", "scope"],
    matches: readRequestDiscriminant("scope-discovery"),
    async execute(value: unknown, context: ReadRequestDispatchContext): Promise<unknown> {
      const request = value as Readonly<Record<string, unknown>>;
      if (request.scope !== context.options.scope) return serverProblem(invalidParameter());
      const controls = context.options.readControls;
      if (controls !== undefined) {
        const identified = await identifyReadOperation(
          request as unknown as ReadRequest,
          context,
          controls,
        );
        if (isReadServerProblem(identified)) return identified;
      }
      return context.discovery;
    },
  }),
  "collection:beads": defineScopeReadVariant<BeadCollectionOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "beads"]),
    fields: ["kind", "collection", "continuation", "type", "conformsTo", "limit", "selector"],
    validate: (operation, options) =>
      collectionControlIssue(operation, options.readControls !== undefined, [
        operation.type,
        operation.conformsTo,
      ]) ?? typeFilterIssue(operation, options.scope),
    validateBody: validateBeadCollectionBody,
  }),
  "collection:links": defineScopeReadVariant<LinkCollectionOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "links"]),
    fields: [
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
    validate: validateLinkCollectionRequest,
    validateBody: validateLinkCollectionBody,
  }),
  "collection:types": defineScopeReadVariant<TypeInventoryOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "types"]),
    fields: ["kind", "collection", "continuation", "limit"],
    validate: (operation, options) =>
      collectionControlIssue(operation, options.readControls !== undefined, []),
    validateBody: (_operation, value) =>
      validateTypeInventory(parseTypeInventory(value, "ScopePort Type inventory")),
  }),
  "resource:bead": defineScopeReadVariant<BeadResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "bead"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validateBeadResourceBody,
  }),
  "resource:link": defineScopeReadVariant<LinkResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "link"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validateLinkResourceBody,
  }),
  "resource:type": defineScopeReadVariant<TypeResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "type"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => {
      const parsed = parseTypeIdentity(operation.id, options.scope);
      return isReadProblem(parsed) ? parsed : undefined;
    },
    validateBody: validateTypeResourceBody,
  }),
  "properties:bead": defineScopeReadVariant<BeadPropertiesOperation>({
    matches: readRequestDiscriminant("properties", ["resource", "bead"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validatePropertiesBody,
  }),
  "properties:link": defineScopeReadVariant<LinkPropertiesOperation>({
    matches: readRequestDiscriminant("properties", ["resource", "link"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validatePropertiesBody,
  }),
  "bead-links": defineScopeReadVariant<BeadLinksOperation>({
    matches: readRequestDiscriminant("bead-links"),
    fields: ["kind", "bead", "continuation", "direction", "limit"],
    validate: validateBeadLinksRequest,
    validateBody: validateBeadLinksBody,
  }),
} satisfies Record<ReadRequestVariantKey, ReadRequestVariant>);

function resolveReadRequestVariant(value: unknown): ReadRequestVariant | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const request = value as Readonly<Record<string, unknown>>;
  const variant = Object.values(READ_REQUEST_VARIANTS).find((candidate) =>
    candidate.matches(request),
  );
  return variant !== undefined && hasOnlyVariantFields(request, variant.fields)
    ? variant
    : undefined;
}

function validateLinkCollectionRequest(
  operation: LinkCollectionOperation,
  options: ServerOptions,
): ReadProblem | undefined {
  const commonIssue =
    collectionControlIssue(operation, options.readControls !== undefined, [
      operation.type,
      operation.conformsTo,
      operation.source,
      operation.target,
      operation.endpoint,
    ]) ?? typeFilterIssue(operation, options.scope);
  if (commonIssue !== undefined) return commonIssue;
  for (const value of [operation.source, operation.target, operation.endpoint]) {
    if (value === undefined) continue;
    const normalized = normalizeEndpointParameter(value, options.scope);
    if (isReadProblem(normalized) || normalized !== value) return invalidParameter();
  }
  return undefined;
}

function validateBeadLinksRequest(
  operation: BeadLinksOperation,
  options: ServerOptions,
): ReadProblem | undefined {
  if (
    operation.direction !== undefined &&
    operation.direction !== "inbound" &&
    operation.direction !== "outbound" &&
    operation.direction !== "both"
  )
    return invalidParameter();
  const controlIssue = collectionControlIssue(operation, options.readControls !== undefined, [
    operation.direction,
  ]);
  if (controlIssue !== undefined) return controlIssue;
  return validateLocalResourceIdentity(operation.bead, options.scope, "bead");
}

function validateScopePortResult<Operation extends ScopeReadOperation>(
  operation: Operation,
  value: unknown,
  scope: AbsoluteHttpUrl,
  validateBody: ScopeBodyValidation<Operation>,
): ReadResultFor<Operation> {
  const result = snapshotScopePortEnvelope(value);
  if (result.kind === "problem") {
    assertExactScopePortFields(result, ["kind", "problem"]);
    return serverProblem(parseReadProblem(result.problem, "ScopePort Problem"));
  }
  if (result.kind !== "success") throw new TypeError("ScopePort result has an invalid kind");
  assertExactScopePortFields(result, ["kind", "body"]);
  return validateBody(operation, result.body, scope);
}

function snapshotScopePortEnvelope(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("ScopePort result must be a plain object");
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("ScopePort result must be a plain object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new TypeError("ScopePort result contains a symbol field");
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
      throw new TypeError("ScopePort result fields must be readable data properties");
    entries.push([key, descriptor.value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function assertExactScopePortFields(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const fields = Object.keys(value);
  if (fields.length !== expected.length || expected.some((field) => !Object.hasOwn(value, field)))
    throw new TypeError("ScopePort result contains fields not allowed for its kind");
}

function validateBeadCollectionBody(
  operation: BeadCollectionOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadCollectionOperation> {
  const page = parseBeadCollection(value, "ScopePort Bead collection");
  validateCollectionNext(page);
  for (const bead of page.items) {
    validateServerBead(bead, scope);
    if (operation.type !== undefined && bead.type !== operation.type)
      throw new ProtocolArtifactValidationError(
        "ScopePort Bead collection violated the requested Type filter",
      );
  }
  return page;
}

function validateLinkCollectionBody(
  operation: LinkCollectionOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<LinkCollectionOperation> {
  const page = parseLinkCollection(value, "ScopePort Link collection");
  validateCollectionNext(page);
  for (const link of page.items) {
    validateServerLink(link, scope);
    validateLinkCollectionFilters(link, operation);
  }
  return page;
}

function validateBeadResourceBody(
  operation: BeadResourceOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadResourceOperation> {
  const bead = parseBeadRecord(value, "ScopePort Bead");
  validateServerBead(bead, scope);
  if (bead.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Bead ID");
  return bead;
}

function validateLinkResourceBody(
  operation: LinkResourceOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<LinkResourceOperation> {
  const link = parseLinkRecord(value, "ScopePort Link");
  validateServerLink(link, scope);
  if (link.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Link ID");
  return link;
}

function validateTypeResourceBody(
  operation: TypeResourceOperation,
  value: unknown,
): ReadBodyFor<TypeResourceOperation> {
  const body = parseTypeDescriptor(value, "ScopePort Type Descriptor");
  if (body.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Type ID");
  return body;
}

function validatePropertiesBody(
  _operation: BeadPropertiesOperation | LinkPropertiesOperation,
  value: unknown,
): ReadBodyFor<BeadPropertiesOperation | LinkPropertiesOperation> {
  return parsePropertiesRecord(value, "ScopePort properties");
}

function validateBeadLinksBody(
  operation: BeadLinksOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadLinksOperation> {
  const page = parseLinkCollection(value, "ScopePort incident-Link collection");
  validateCollectionNext(page);
  const direction = operation.direction ?? "both";
  for (const link of page.items) {
    validateServerLink(link, scope);
    const inbound = referenceUri(link.target) === operation.bead;
    const outbound = referenceUri(link.source) === operation.bead;
    if (
      (direction === "inbound" && !inbound) ||
      (direction === "outbound" && !outbound) ||
      (direction === "both" && !inbound && !outbound)
    )
      throw new ProtocolArtifactValidationError(
        "ScopePort returned a Link outside the requested incident direction",
      );
  }
  return page;
}

function validateTypeInventory(page: TypeInventory): TypeInventory {
  validateCollectionNext(page);
  return page;
}

function validateCollectionNext(page: BeadCollection | LinkCollection | TypeInventory): void {
  if (page.next === null) return;
  throw new ProtocolArtifactValidationError(
    "ScopePort pagination is unsupported until the server owns continuation navigation",
  );
}

function validateServerBead(bead: BeadRecord, scope: AbsoluteHttpUrl): void {
  validateServerLocalResourceId(bead.id, scope, "bead");
  if (bead.links !== undefined)
    throw new ProtocolArtifactValidationError("ScopePort returned unexpected embedded Links");
}

function validateServerLink(link: LinkRecord, scope: AbsoluteHttpUrl): void {
  validateServerLocalResourceId(link.id, scope, "link");
  const sourceInScope = validateServerEndpoint(link.source, scope);
  const targetInScope = validateServerEndpoint(link.target, scope);
  if (!sourceInScope && !targetInScope)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link must have at least one in-Scope endpoint",
    );
}

function validateServerEndpoint(endpoint: Reference, scope: AbsoluteHttpUrl): boolean {
  // In-Scope or external is derived from the URI: a Scope-alias URI claims an
  // in-Scope Bead and must be its canonical spelling; every other URI is an
  // opaque external reference. Either may carry a pin.
  const uri = referenceUri(endpoint);
  if (!endpointAliasesScope(uri, scope)) return false;
  validateServerLocalResourceId(uri, scope, "bead");
  return true;
}

function endpointAliasesScope(value: string, scope: AbsoluteHttpUrl): boolean {
  if (!URL.canParse(value)) return false;
  const candidate = new URL(value);
  const root = new URL(scope);
  if (candidate.origin !== root.origin) return false;
  const candidatePath = normalizeResponsePath(candidate.pathname);
  const rootPath = normalizeResponsePath(root.pathname);
  return candidatePath !== undefined && rootPath !== undefined
    ? candidatePath.startsWith(rootPath)
    : candidate.pathname.startsWith(root.pathname);
}

function normalizeResponsePath(pathname: string): string | undefined {
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

function validateServerLocalResourceId(
  id: string,
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link",
): void {
  if (!id.startsWith(scope))
    throw new ProtocolArtifactValidationError(`ScopePort ${resource} ID escaped the Scope`);
  const localId = id.slice(scope.length);
  if (resolveCanonicalLocalResourceId(scope, resource, localId) !== id)
    throw new ProtocolArtifactValidationError(`ScopePort ${resource} ID is not canonical`);
}

function validateLinkCollectionFilters(
  link: LinkRecord,
  operation: Extract<
    ScopeReadOperation,
    { readonly kind: "collection"; readonly collection: "links" }
  >,
): void {
  if (operation.type !== undefined && link.type !== operation.type)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested Type filter",
    );
  if (operation.source !== undefined && referenceUri(link.source) !== operation.source)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested source filter",
    );
  if (operation.target !== undefined && referenceUri(link.target) !== operation.target)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested target filter",
    );
  if (
    operation.endpoint !== undefined &&
    referenceUri(link.source) !== operation.endpoint &&
    referenceUri(link.target) !== operation.endpoint
  )
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested endpoint filter",
    );
}

const READ_REQUEST_FIELDS = [
  "kind",
  "scope",
  "collection",
  "continuation",
  "type",
  "conformsTo",
  "source",
  "target",
  "endpoint",
  "limit",
  "selector",
  "resource",
  "id",
  "bead",
  "direction",
] as const;

function hasOnlyVariantFields(
  request: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return (
    Reflect.ownKeys(request).every(
      (field) => typeof field === "string" && allowed.includes(field),
    ) && READ_REQUEST_FIELDS.every((field) => allowed.includes(field) || !(field in request))
  );
}

/**
 * Validates the alias table at composition time, fail-closed: every alias
 * path is one-or-more canonical safe segments (the Resource-ID grammar),
 * and every target is a canonical in-Scope Bead URL. Alias-to-alias is
 * structurally impossible because targets must live beneath `beads/`.
 */
function validateAliasTable(
  aliases: Readonly<Record<string, AbsoluteHttpUrl>> | undefined,
  scope: AbsoluteHttpUrl,
  serviceDescription: AbsoluteHttpUrl | undefined,
): ReadonlyMap<string, AbsoluteHttpUrl> | undefined {
  // Unconditional: the alias root serves representations for no
  // composition, alias table or not.
  if (serviceDescription?.startsWith(`${scope}alias/`) === true)
    throw new TypeError(
      "serviceDescription must not live beneath the alias root; aliases are redirect-only",
    );
  if (aliases === undefined) return undefined;
  const table = new Map<string, AbsoluteHttpUrl>();
  for (const [path, target] of Object.entries(aliases)) {
    // The exact Resource-ID segment grammar, shared with beads/ and links/:
    // canonical encodings only, one valid spelling per name.
    try {
      assertCanonicalPathSegments(path, "alias path");
    } catch (error) {
      throw new TypeError(`alias path is not canonical: ${path}`, { cause: error });
    }
    const canonicalTarget = resolveCanonicalLocalResourceId(
      scope,
      "bead",
      target.startsWith(scope) ? target.slice(scope.length) : target,
    );
    if (canonicalTarget !== target)
      throw new TypeError(`alias target is not a canonical in-Scope Bead URL: ${target}`);
    table.set(path, target);
  }
  return table;
}

/**
 * Alias URL classification — deliberately table-free, so it can run before
 * the identity gate. Returns undefined when the URL is not beneath the
 * alias root, the alias path when it is well-formed, and the uniform 404
 * problem for malformed alias URLs (query, fragment, empty, or a path the
 * Resource-ID grammar refuses). Raw-target canonicality (dot segments,
 * alternate encodings the WHATWG parser normalizes away) is the transport
 * bridge's duty, exactly as for Resource URLs.
 */
function classifyAliasPath(url: URL, scope: AbsoluteHttpUrl): string | ReadProblem | undefined {
  const scopeUrl = new URL(scope);
  if (url.origin !== scopeUrl.origin) return undefined;
  const aliasRoot = `${scopeUrl.pathname}alias/`;
  if (!url.pathname.startsWith(aliasRoot)) return undefined;
  if (url.search !== "" || url.hash !== "") return notFound();
  const path = url.pathname.slice(aliasRoot.length);
  if (path.length === 0) return notFound();
  try {
    assertCanonicalPathSegments(path, "alias path");
  } catch {
    return notFound();
  }
  return path;
}

function discoveryFor(options: ServerOptions): ReadDiscovery {
  const advertisedLimits = options.advertisedLimits;
  const discovery = {
    bdpVersion: "0",
    profile: options.admittedProfile.profile,
    scope: options.scope,
    beads: new URL("beads/", options.scope).href,
    links: new URL("links/", options.scope).href,
    types: new URL("types/", options.scope).href,
    ...(options.aliases === undefined ? {} : { aliases: new URL("alias/", options.scope).href }),
    order: "canonical-uri",
    ...(advertisedLimits === undefined
      ? {}
      : {
          limits: Object.freeze({
            page: advertisedLimits.page,
            selector: advertisedLimits.selector,
            retention: Object.freeze({
              maximumSnapshotLifetime: iso8601DurationFromMilliseconds(
                advertisedLimits.cursorTtlMilliseconds,
              ),
            }),
          }),
        }),
  } as const;
  return discovery;
}

function iso8601DurationFromMilliseconds(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  const remainder = milliseconds % 1_000;
  if (remainder === 0) return `PT${seconds}S`;
  const fraction = remainder.toString().padStart(3, "0").replace(/0+$/, "");
  return `PT${seconds}.${fraction}S`;
}

export type { ProtocolProfile } from "@bdp/protocol";
export type { ReadServerTarget } from "./read-conformance-capability.js";
export type { ReadPagination, ReadPaginationOptions } from "./read-pagination.js";
export { ReadPaginationError } from "./read-pagination.js";
export type { ReadSelectorLimits } from "./read-selector.js";
export { ReadSelectorError } from "./read-selector.js";
export type { AbsoluteHttpUrl, ReadRequest, ReadResultFor, ScopeReadOperation };
