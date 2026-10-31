import {
  type Reference,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseLinkHeader,
  parseRetainedDiscovery,
  parseRetainedProperties,
  parseRetainedResource,
  parseRetainedProblem,
  parseRetainedWriteInput,
  parseRetainedWriteResult,
  type RetainedDiscovery,
  type RetainedJsonObject,
  type RetainedResourceKind,
  RETAINED_V01_MEDIA_TYPE,
  RETAINED_V01_SPECIFICATION,
  RETAINED_WRITE_OPERATIONS,
} from "@bdp/protocol";
import { RetainedWriteBinding, type PreparedRetainedWrite } from "./retained-write.js";
import {
  type RetainedHttpContext,
  type RetainedHttpResponse,
  type RetainedTransport,
  type RetainedTransportCallOptions,
  RetainedTransportError,
} from "./retained-transport.js";

export interface RetainedClientOptions {
  readonly transport: RetainedTransport;
  readonly maximumDocumentBytes: number;
  readonly maximumRequestBodyBytes: number;
  /** One deadline across navigation and delivery, separate from each exchange. */
  readonly operationTimeoutMs: number;
}
export interface RetainedClientCallOptions {
  readonly signal?: AbortSignal;
}
export interface RetainedPointReadOptions extends RetainedTransportCallOptions {
  /** Already resolved by the sole CLI/domain resolver. No suffix parsing here. */
  readonly reference: Reference;
  readonly view?: "properties";
  readonly expectedKind?: RetainedResourceKind;
  readonly scope?: string;
  readonly method?: "GET" | "HEAD";
}
export interface RetainedPointValue {
  readonly specification: typeof RETAINED_V01_SPECIFICATION;
  readonly scope: string;
  readonly resourceKind: RetainedResourceKind;
  readonly representation: "resource" | "properties";
  /** Absent for successful HEAD/304, never replaced with an empty record. */
  readonly body?: RetainedJsonObject;
}
export type RetainedReply<T> =
  | {
      readonly kind: "success";
      readonly value: T;
      readonly http: RetainedHttpContext;
      /** Exact validated received UTF-8 bytes; absent for HEAD/304. Owned by this reply. */
      readonly nativeBody?: Uint8Array;
    }
  | {
      readonly kind: "problem";
      readonly problem: RetainedJsonObject;
      readonly http: RetainedHttpContext;
      readonly nativeBody: Uint8Array;
    }
  | { readonly kind: "http"; readonly http: RetainedHttpContext };

export class RetainedClientError extends Error {
  override readonly name = "RetainedClientError";
  constructor(
    readonly code: "invalid-input" | "invalid-response" | "unsupported-feature",
    readonly submission: "not-submitted" | "unknown" = "not-submitted",
    readonly http?: RetainedHttpContext,
  ) {
    super(`retained client ${code} (${submission})`);
  }
}
const media = (value: string | null): string | undefined =>
  value?.split(";", 1)[0]?.trim().toLowerCase();
const invalid = (): never => {
  throw new RetainedClientError("invalid-response");
};

/** One generic retained client. This increment selects current full/properties
 * reads and singleton native Write; no CLI grammar, local store fallback,
 * History, projection, aggregate, implicit paging or durable retry journal.
 */
export class RetainedClient {
  readonly #transport: RetainedTransport;
  readonly #documentBytes: number;
  readonly #requestBytes: number;
  readonly #timeout: number;
  readonly #checks = new WeakMap<AbortSignal, () => void>();
  constructor(options: RetainedClientOptions) {
    const transport = options.transport;
    this.#transport = Object.freeze({
      get: transport.get.bind(transport),
      head: transport.head.bind(transport),
      post: transport.post.bind(transport),
      probeScope: transport.probeScope.bind(transport),
      resolveAlias: transport.resolveAlias.bind(transport),
    });
    this.#documentBytes = options.maximumDocumentBytes;
    this.#requestBytes = options.maximumRequestBodyBytes;
    this.#timeout = options.operationTimeoutMs;
    for (const n of [this.#documentBytes, this.#requestBytes, this.#timeout])
      if (!Number.isSafeInteger(n) || n < 1) throw new RetainedClientError("invalid-input");
    if (this.#timeout > 2_147_483_647) throw new RetainedClientError("invalid-input");
    Object.freeze(this);
  }

  inspectScope(
    scope: string,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<RetainedDiscovery>> {
    const selected = parseCanonicalScope(scope);
    const callerSignal = signalOnly(call);
    return this.#run(callerSignal, async (signal) => {
      const landing = await this.#transport.probeScope(selected, { signal });
      this.#check(signal);
      const fault = failure(landing);
      if (fault) return fault;
      if (landing.kind !== "scope-probe" || ![200, 204].includes(landing.status)) return invalid();
      return this.#discovery(description(landing), selected, signal);
    });
  }

  bindWrite(
    scope: string,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<RetainedWriteBinding>> {
    const selected = parseCanonicalScope(scope);
    const callerSignal = signalOnly(call);
    return this.#run(callerSignal, async (signal) => {
      const landing = await this.#transport.probeScope(selected, { signal });
      this.#check(signal);
      const fault = failure(landing);
      if (fault) return fault;
      if (landing.kind !== "scope-probe" || ![200, 204].includes(landing.status)) return invalid();
      const received = await this.#transport.get(description(landing), { signal });
      this.#check(signal);
      const refused = failure(received);
      if (refused) return refused;
      const text = this.#document(received);
      const discovery = parseRetainedDiscovery(text);
      if (discovery.scope !== selected) return invalid();
      if (discovery.profile !== "write") throw new RetainedClientError("unsupported-feature");
      const directory = await this.#transport.get(discovery.operations as string, { signal });
      this.#check(signal);
      const directoryFault = failure(directory);
      if (directoryFault) return directoryFault;
      const directoryText = this.#document(directory);
      return Object.freeze({
        kind: "success",
        http: context(directory),
        nativeBody: nativeBody(directory),
        value: new RetainedWriteBinding({
          scope: selected,
          discovery: { contentType: received.contentType!, bodyText: text },
          directory: { contentType: directory.contentType!, bodyText: directoryText },
          maximumDocumentBytes: this.#documentBytes,
          maximumRequestBodyBytes: this.#requestBytes,
        }),
      });
    });
  }

  read(options: RetainedPointReadOptions): Promise<RetainedReply<RetainedPointValue>> {
    // Snapshot once before the first await. This is an already-resolved native
    // intent, not a second CLI Reference/ordinal grammar.
    const { reference, view, expectedKind, scope, method = "GET", signal, ...controls } = options;
    if (typeof reference !== "string") throw new RetainedClientError("unsupported-feature");
    const resource = parseCanonicalHttpUrl(reference);
    if (
      resource.includes("?") ||
      (view !== undefined && view !== "properties") ||
      (expectedKind !== undefined && expectedKind !== "bead" && expectedKind !== "link") ||
      (method !== "GET" && method !== "HEAD")
    )
      throw new RetainedClientError("invalid-input");
    for (const name of Object.keys(controls))
      if (!["ifMatch", "ifNoneMatch", "ifModifiedSince", "ifUnmodifiedSince"].includes(name))
        throw new RetainedClientError("unsupported-feature");
    const selectedScope = scope === undefined ? undefined : parseCanonicalScope(scope);
    const url = view === undefined ? resource : `${resource}?view=properties`;
    return this.#run(signal, async (active) => {
      const response = await this.#transport[method === "HEAD" ? "head" : "get"](url, {
        ...controls,
        signal: active,
      });
      this.#check(active);
      const refused = failure(response, method === "HEAD");
      if (refused) return refused;
      if (response.status !== 200 && response.status !== 304) return invalid();
      if (
        response.status === 304 &&
        controls.ifNoneMatch === undefined &&
        controls.ifModifiedSince === undefined
      )
        return invalid();
      const kind = response.headers["bdp-resource-kind"];
      if (
        (kind !== "bead" && kind !== "link") ||
        (expectedKind !== undefined && kind !== expectedKind)
      )
        return invalid();
      let body: RetainedJsonObject | undefined;
      let originalBytes: Uint8Array | undefined;
      if (response.contentType !== null && media(response.contentType) !== RETAINED_V01_MEDIA_TYPE)
        return invalid();
      if (method === "HEAD" || response.status === 304) {
        if (response.kind !== "empty") return invalid();
      } else {
        const text = this.#document(response);
        originalBytes = nativeBody(response);
        body =
          view === "properties" ? parseRetainedProperties(text) : parseRetainedResource(text, kind);
        if (view === undefined && (body.id !== resource || body.links !== undefined))
          return invalid();
      }
      const discovery = await this.#discovery(description(response), selectedScope, active);
      if (discovery.kind !== "success") return discovery;
      if (!resource.startsWith(discovery.value.scope)) return invalid();
      return Object.freeze({
        kind: "success",
        http: context(response),
        ...(originalBytes === undefined ? {} : { nativeBody: originalBytes }),
        value: Object.freeze({
          specification: RETAINED_V01_SPECIFICATION,
          scope: discovery.value.scope,
          resourceKind: kind,
          representation: view === "properties" ? "properties" : "resource",
          ...(body === undefined ? {} : { body }),
        }),
      });
    });
  }

  submit(
    prepared: PreparedRetainedWrite,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<RetainedJsonObject>> {
    // Freeze the saved invocation again at this trust boundary; never rediscover
    // or apply fresh defaults. The caller owns pre-submission durable storage.
    if (
      Object.keys(prepared).sort().join(",") !==
      "bodyText,headers,method,operation,scope,specification,url"
    )
      throw new RetainedClientError("unsupported-feature");
    const { specification, scope, operation, url, method, bodyText, headers } = prepared;
    const savedHeaders = { ...headers };
    if (
      specification !== RETAINED_V01_SPECIFICATION ||
      method !== "POST" ||
      !RETAINED_WRITE_OPERATIONS.includes(operation) ||
      savedHeaders.accept !== RETAINED_V01_MEDIA_TYPE ||
      savedHeaders["content-type"] !== RETAINED_V01_MEDIA_TYPE ||
      Object.keys(savedHeaders).sort().join(",") !== "accept,content-type,idempotency-key" ||
      typeof savedHeaders["idempotency-key"] !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(savedHeaders["idempotency-key"])
    )
      throw new RetainedClientError("invalid-input");
    const selected = parseCanonicalScope(scope);
    parseCanonicalHttpUrl(url);
    if (
      typeof bodyText !== "string" ||
      bodyText.length > this.#requestBytes ||
      new TextEncoder().encode(bodyText).byteLength > this.#requestBytes
    )
      throw new RetainedClientError("invalid-input");
    parseRetainedWriteInput(operation, bodyText);
    const callerSignal = signalOnly(call);
    return this.#run(callerSignal, async (signal, markSubmitted) => {
      markSubmitted();
      const response = await this.#transport.post(url, {
        signal,
        bodyText,
        idempotencyKey: savedHeaders["idempotency-key"],
      });
      try {
        const refused = failure(response);
        if (refused) return refused;
        privateNoStore(response);
        const value = parseRetainedWriteResult(operation, this.#document(response));
        const identity =
          value.resource !== undefined
            ? (value.resource as RetainedJsonObject).id
            : value.deleted === undefined
              ? undefined
              : ((value.deleted as RetainedJsonObject).resource as RetainedJsonObject).id;
        if (typeof identity === "string" && !identity.startsWith(selected)) return invalid();
        return Object.freeze({
          kind: "success",
          value,
          http: context(response),
          nativeBody: nativeBody(response),
        });
      } catch {
        throw new RetainedClientError("invalid-response", "unknown", context(response));
      }
    });
  }

  async #discovery(
    url: string,
    scope: string | undefined,
    signal: AbortSignal,
  ): Promise<RetainedReply<RetainedDiscovery>> {
    this.#check(signal);
    const response = await this.#transport.get(url, { signal });
    this.#check(signal);
    const fault = failure(response);
    if (fault) return fault;
    const value = parseRetainedDiscovery(this.#document(response));
    if (scope !== undefined && value.scope !== scope) return invalid();
    return Object.freeze({
      kind: "success",
      value,
      http: context(response),
      nativeBody: nativeBody(response),
    });
  }
  #document(response: RetainedHttpResponse): string {
    if (
      response.status !== 200 ||
      response.kind !== "json" ||
      typeof response.bodyText !== "string" ||
      media(response.contentType) !== RETAINED_V01_MEDIA_TYPE ||
      new TextEncoder().encode(response.bodyText).byteLength > this.#documentBytes
    )
      return invalid();
    return response.bodyText;
  }
  #check(signal: AbortSignal): void {
    this.#checks.get(signal)?.();
  }
  async #run<T>(
    caller: AbortSignal | undefined,
    action: (signal: AbortSignal, markSubmitted: () => void) => Promise<T>,
  ): Promise<T> {
    if (caller !== undefined && !(caller instanceof AbortSignal))
      throw new RetainedClientError("invalid-input");
    const deadline = new AbortController();
    const signal =
      caller === undefined ? deadline.signal : AbortSignal.any([caller, deadline.signal]);
    const expires = performance.now() + this.#timeout;
    const timer = setTimeout(() => deadline.abort(), this.#timeout);
    let submitted = false;
    const firstAbort = { value: undefined as "aborted" | "timeout" | undefined };
    // Record the first source when this operation signal aborts, before any
    // transport settlement wait. A later source cannot relabel that cause.
    const recordAbort = () => {
      firstAbort.value ??= caller?.aborted ? "aborted" : "timeout";
    };
    signal.addEventListener("abort", recordAbort, { once: true });
    if (signal.aborted) recordAbort();
    const aborted = () =>
      new RetainedTransportError(
        firstAbort.value ?? (caller?.aborted ? "aborted" : "timeout"),
        submitted ? "unknown" : "not-submitted",
      );
    const check = () => {
      if (performance.now() >= expires) deadline.abort();
      if (signal.aborted) throw aborted();
    };
    this.#checks.set(signal, check);
    try {
      check();
      // The transport owns a bounded cleanup/settlement observation phase.
      // Do not race that phase here. Its abortSettlement snapshot distinguishes
      // observed completion from a cap; custom IO can outlive that cap.
      const value = await action(signal, () => {
        check();
        submitted = true;
      });
      check();
      return value;
    } catch (error) {
      if (
        firstAbort.value === "timeout" &&
        error instanceof RetainedTransportError &&
        error.code === "aborted"
      )
        throw new RetainedTransportError(
          "timeout",
          error.submission,
          error.httpStatus,
          error.contentType,
          error.retryAfter,
          error.headers,
          error.abortSettlement,
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", recordAbort);
      this.#checks.delete(signal);
    }
  }
}

function context(value: RetainedHttpContext): RetainedHttpContext {
  return Object.freeze({
    status: value.status,
    url: value.url,
    contentType: value.contentType,
    retryAfter: value.retryAfter,
    headers: value.headers,
  });
}
function failure(
  response: RetainedHttpContext & {
    readonly kind: string;
    readonly bodyText?: string;
    readonly bodyBytes?: Uint8Array;
  },
  head = false,
): Exclude<RetainedReply<never>, { kind: "success" }> | undefined {
  if (response.status < 400) return undefined;
  if (response.kind === "empty" && (head || [405, 406, 412, 500].includes(response.status)))
    return Object.freeze({ kind: "http", http: context(response) });
  if (
    response.kind !== "json" ||
    typeof response.bodyText !== "string" ||
    media(response.contentType) !== "application/problem+json"
  )
    return invalid();
  privateNoStore(response);
  return Object.freeze({
    kind: "problem",
    problem: parseRetainedProblem(response.bodyText, response.status),
    http: context(response),
    nativeBody: nativeBody(response),
  });
}
function description(response: RetainedHttpContext): string {
  try {
    const targets = new Set<string>();
    for (const entry of parseLinkHeader(response.headers.link ?? "")) {
      const rels = entry.parameters.filter((p) => p.name === "rel");
      if (!rels.some((p) => p.value.split(/ +/).some((v) => v.toLowerCase() === "service-desc")))
        continue;
      if (rels.length !== 1) return invalid();
      const anchors = entry.parameters.filter((p) => p.name === "anchor");
      const types = entry.parameters.filter((p) => p.name === "type");
      if (anchors.length > 1 || types.length > 1) return invalid();
      if (anchors[0] !== undefined && new URL(anchors[0].value, response.url).href !== response.url)
        continue;
      if (types[0] !== undefined && media(types[0].value) !== RETAINED_V01_MEDIA_TYPE) continue;
      targets.add(parseCanonicalHttpUrl(new URL(entry.target, response.url).href));
    }
    if (targets.size !== 1) return invalid();
    return [...targets][0]!;
  } catch {
    return invalid();
  }
}

function privateNoStore(response: RetainedHttpContext): void {
  const directives = (response.headers["cache-control"] ?? "")
    .toLowerCase()
    .split(",")
    .map((v) => v.trim());
  if (!directives.includes("private") || !directives.includes("no-store")) invalid();
}

function signalOnly(call: RetainedClientCallOptions): AbortSignal | undefined {
  if (Object.keys(call).some((name) => name !== "signal"))
    throw new RetainedClientError("unsupported-feature");
  return call.signal;
}

/** Parsing may ignore a UTF-8 BOM; native delivery must still retain those
 * original bytes. Never recover them by serializing the parsed object.
 */
function nativeBody(response: {
  readonly kind: string;
  readonly bodyText?: string;
  readonly bodyBytes?: Uint8Array;
}): Uint8Array {
  if (!(response.bodyBytes instanceof Uint8Array) || typeof response.bodyText !== "string")
    return invalid();
  const bytes = new Uint8Array(response.bodyBytes);
  try {
    if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== response.bodyText)
      return invalid();
  } catch {
    return invalid();
  }
  return bytes;
}
