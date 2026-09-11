import {
  requestFromUrl,
  notFound,
  invalidParameter,
  isPageOperation,
  withoutPageControls,
  continuationUrlFor,
  continuationDetails,
  inCanonicalUriOrder,
  resolveReadRequestVariant,
  classifyAliasPath,
  ScopeServerLocalError,
  ScopeServerClosedError,
  ScopeServerOperationAbortedError,
  type ScopeBodyValidation,
  type ReadRequestVariant,
  readControlProblem,
} from "./read-request.js";
export {
  ScopeServerLocalError,
  ScopeServerClosedError,
  ScopeServerOperationAbortedError,
  type ScopeServerLocalErrorCode,
} from "./read-request.js";
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
  BeadRecord,
  LinkRecord,
  ProtocolProfile,
  ReadBodyFor,
  ReadDiscovery,
  ReadProblem,
  ReadRequest,
  ReadResultFor,
  ScopeProbe,
  ScopeReadOperation,
  TypeSummary,
} from "@bdp/protocol";
import {
  stringifyJsonValue,
  isReadProblem,
  parseReadProblem,
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
import { applyReadHttpSemantics } from "./read-http.js";
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
    problemFor: readControlProblem,
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
      const body = response.body === undefined ? undefined : stringifyJsonValue(response.body);
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
  const route: HttpHandler = async (request) => {
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
  return async (request) => applyReadHttpSemantics(request, await route(request));
}

function jsonResponse(body: unknown): HttpResponse {
  return {
    status: 200,
    headers: new Headers({
      "content-type": "application/json",
      "cache-control": "private, no-store",
    }),
    body,
  };
}

function scopeDataResponse(operation: ReadRequest, body: unknown): HttpResponse {
  const response = jsonResponse(body);
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
  const context: ReadRequestDispatchContext = {
    options,
    signal,
    discovery,
    ...(httpRequest === undefined ? {} : { httpRequest }),
  };
  if (variant.kind === "discovery")
    return executeDiscoveryRead(request, context, variant) as Promise<ReadResultFor<RequestType>>;
  const issue = variant.validate(request, {
    scope: options.scope,
    controlsEnabled: options.readControls !== undefined,
  });
  if (issue !== undefined)
    return Promise.resolve(serverProblem(issue)) as Promise<ReadResultFor<RequestType>>;
  return executeScopeRead(request as ScopeReadOperation, context, variant.validateBody) as Promise<
    ReadResultFor<RequestType>
  >;
}

interface ReadRequestDispatchContext {
  readonly options: ServerOptions;
  readonly signal: AbortSignal;
  readonly discovery: ReadDiscovery;
  readonly httpRequest?: Request;
}

async function executeDiscoveryRead(
  value: unknown,
  context: ReadRequestDispatchContext,
  variant: Extract<ReadRequestVariant, { readonly kind: "discovery" }>,
): Promise<unknown> {
  const issue = variant.validate(value, {
    scope: context.options.scope,
    controlsEnabled: context.options.readControls !== undefined,
  });
  if (issue !== undefined) return serverProblem(issue);
  const controls = context.options.readControls;
  if (controls !== undefined) {
    const identified = await identifyReadOperation(value as ReadRequest, context, controls);
    if (isReadServerProblem(identified)) return identified;
  }
  return context.discovery;
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

/** Applies the canonical-uri order to any successful collection-shaped result. */
function sortCollectionResult(operation: ReadRequest, validated: unknown): unknown {
  if (!isPageOperation(operation)) return validated;
  if (isReadServerProblem(validated)) return validated;
  const body = validated as { readonly items?: readonly { readonly id: string }[] };
  if (!Array.isArray(body.items)) return validated;
  return Object.freeze({ ...body, items: inCanonicalUriOrder(body.items) });
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
