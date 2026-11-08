import {
  ProtocolArtifactValidationError,
  HISTORICAL_UPDATE_MEDIA,
  type HistoricalUpdateTerminalView,
  type HistoricalUpdateView,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseHistoricalUpdateProblem,
  parseHistoricalUpdateRequest,
  parseHistoricalUpdateResult,
  parseHistoricalUpdateTerminalView,
  parseHistoricalUpdateView,
  parseLinkHeader,
  parseRetainedCollection,
  parseRetainedDiscovery,
  parseRetainedProblem,
  parseRetainedProperties,
  parseRetainedResource,
  parseRetainedWriteDiscovery,
  parseRetainedWriteInput,
  parseRetainedWriteResult,
  RETAINED_V01_MEDIA_TYPE,
  RETAINED_V01_SPECIFICATION,
  RETAINED_WRITE_OPERATIONS,
  type Reference,
  type RetainedCollection,
  type RetainedDiscovery,
  type RetainedJsonObject,
  type RetainedResourceKind,
  readHistoricalUpdateCapability,
  stringifyJsonValue,
} from "@bdp/protocol";
import {
  CALLABLE_QUERY_TYPE,
  type CallableDeclaration,
  callableMount,
  parseCallableProblem,
  parseCallableResult,
} from "./callable.js";
import {
  type RetainedHttpContext,
  type RetainedHttpResponse,
  type RetainedTransport,
  type RetainedTransportCallOptions,
  RetainedTransportError,
} from "./retained-transport.js";
import { type PreparedRetainedWrite, RetainedWriteBinding } from "./retained-write.js";

export interface RetainedClientOptions {
  readonly transport: RetainedTransport;
  /** Explicitly selected feature transport; base navigation keeps base media. */
  readonly historicalUpdateTransport?: RetainedTransport;
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
  /** Core's optional `include=links` aggregate: a Bead with the first page of its Links. */
  readonly includeLinks?: {
    readonly direction?: "inbound" | "outbound" | "both";
    readonly limit?: number;
  };
  readonly expectedKind?: RetainedResourceKind;
  readonly scope?: string;
  readonly method?: "GET" | "HEAD";
  /** Explicit CLI adapter selection; the existing current-only SDK stays closed. */
  readonly allowExactRevision?: true;
  /** Verify and follow at most one native alias; default never follows redirects. */
  readonly followAlias?: true;
}
export type RetainedCollectionFilters = Readonly<
  Partial<Record<"type" | "conformsTo" | "source" | "target" | "endpoint" | "selector", string>>
>;
export interface RetainedPageReadOptions extends RetainedTransportCallOptions {
  readonly url: string;
  readonly scope: string;
  readonly collectionKind: RetainedResourceKind;
  readonly subject?: string;
  readonly method?: "GET" | "HEAD";
}
export interface RetainedPageValue {
  readonly specification: typeof RETAINED_V01_SPECIFICATION;
  readonly scope: string;
  readonly collectionKind: RetainedResourceKind;
  readonly subject?: string;
  readonly page?: RetainedCollection;
}
export interface RetainedPointValue {
  readonly specification: typeof RETAINED_V01_SPECIFICATION;
  readonly scope: string;
  readonly resourceKind: RetainedResourceKind;
  readonly representation: "resource" | "properties";
  /** Present after a verified one-step alias resolution. */
  readonly subject?: string;
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
    /** What was wrong, in words fit for a diagnostic. */
    readonly detail?: string,
  ) {
    super(`retained client ${code} (${submission})`);
  }
}
const CALLABLES_CAPABILITY = "https://github.com/gastownhall/bdp/capabilities/callables";
const IDEMPOTENCY_CAPABILITY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
const KEY = /^[A-Za-z0-9_-]{1,256}$/;

function advertises(discovery: RetainedDiscovery, capability: string): boolean {
  const capabilities = discovery.capabilities;
  if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities))
    return false;
  const versions = (capabilities as RetainedJsonObject)[capability];
  return (
    versions !== null &&
    typeof versions === "object" &&
    !Array.isArray(versions) &&
    Object.hasOwn(versions, "1")
  );
}

export interface CallableInvocationInput {
  readonly declaration: CallableDeclaration;
  readonly arguments: RetainedJsonObject;
  /** Write's attribution input; a CallableBatch only. */
  readonly revisionProvenance?: RetainedJsonObject;
  /** A CallableBatch under `idempotency` only; one is minted when this is absent. */
  readonly idempotencyKey?: string;
}
export interface PreparedCallableInvocation {
  readonly kind: "query" | "batch";
  readonly url: string;
  readonly method: "POST";
  readonly bodyText: string;
  readonly idempotencyKey?: string;
}

/** What one verified discovery admits for invocation. Preparing an invocation performs no
 * IO, so a caller holds the exact key before anything is transmitted. */
export class CallableBinding {
  readonly #scope: string;
  /** Whether the Scope advertises Write's `idempotency` capability at version 1. */
  readonly idempotencyAdvertised: boolean;

  constructor(scope: string, discovery: RetainedDiscovery) {
    if (!advertises(discovery, CALLABLES_CAPABILITY))
      throw new RetainedClientError(
        "unsupported-feature",
        "not-submitted",
        undefined,
        "the Scope does not advertise Callables1",
      );
    this.#scope = scope;
    this.idempotencyAdvertised = advertises(discovery, IDEMPOTENCY_CAPABILITY);
    Object.freeze(this);
  }

  prepare(input: CallableInvocationInput): PreparedCallableInvocation {
    const { declaration, revisionProvenance, idempotencyKey } = input;
    const query = declaration.type === CALLABLE_QUERY_TYPE;
    if (query && (revisionProvenance !== undefined || idempotencyKey !== undefined))
      throw new RetainedClientError("invalid-input");
    if (idempotencyKey !== undefined) {
      if (!KEY.test(idempotencyKey)) throw new RetainedClientError("invalid-input");
      if (!this.idempotencyAdvertised)
        throw new RetainedClientError(
          "unsupported-feature",
          "not-submitted",
          undefined,
          "the Scope does not advertise idempotency, so a key cannot be honored",
        );
    }
    let url: string;
    try {
      url = callableMount(this.#scope, declaration.name);
    } catch {
      throw new RetainedClientError("invalid-input");
    }
    const key =
      !query && this.idempotencyAdvertised
        ? (idempotencyKey ?? globalThis.crypto.randomUUID())
        : undefined;
    return Object.freeze({
      kind: query ? ("query" as const) : ("batch" as const),
      url,
      method: "POST" as const,
      bodyText: stringifyJsonValue({
        arguments: input.arguments,
        ...(revisionProvenance === undefined ? {} : { revisionProvenance }),
      }),
      ...(key === undefined ? {} : { idempotencyKey: key }),
    });
  }
}

const media = (value: string | null): string | undefined =>
  value?.split(";", 1)[0]?.trim().toLowerCase();
const invalid = (): never => {
  throw new RetainedClientError("invalid-response");
};
/** An answer that cannot be read as BDP, keeping which answer it was for the diagnostic. */
const unusable = (response: RetainedHttpContext, detail?: string): never => {
  throw new RetainedClientError("invalid-response", "not-submitted", context(response), detail);
};
const reasonOf = (cause: unknown): string | undefined =>
  cause instanceof RetainedClientError
    ? cause.detail
    : cause instanceof Error
      ? cause.message
      : undefined;

/** One generic retained client. This increment selects current full/properties
 * reads and singleton native Write; no CLI grammar, local store fallback,
 * History, projection, aggregate, implicit paging or durable retry journal.
 */
export class RetainedClient {
  readonly #transport: RetainedTransport;
  readonly #historicalUpdateTransport: RetainedTransport | undefined;
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
    const historical = options.historicalUpdateTransport;
    this.#historicalUpdateTransport =
      historical === undefined
        ? undefined
        : Object.freeze({
            get: historical.get.bind(historical),
            head: historical.head.bind(historical),
            post: historical.post.bind(historical),
            probeScope: historical.probeScope.bind(historical),
            resolveAlias: historical.resolveAlias.bind(historical),
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
      if (landing.kind !== "scope-probe" || ![200, 204].includes(landing.status))
        return unusable(landing, "the Scope landing must answer 200 or 204");
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
      // As every other discovery read does: name what the provider got wrong, send nothing.
      let discovery: RetainedDiscovery;
      try {
        discovery = parseRetainedDiscovery(text);
      } catch (cause) {
        return unusable(received, reasonOf(cause) ?? "its discovery document is not valid");
      }
      if (discovery.scope !== selected) return invalid();
      if (discovery.profile !== "write") throw new RetainedClientError("unsupported-feature");
      // Core fixes every operation at <scope>/bdp/operations/NAME: discovery alone binds.
      let value: RetainedWriteBinding;
      try {
        value = new RetainedWriteBinding({
          scope: selected,
          discovery: { contentType: received.contentType!, bodyText: text },
          maximumDocumentBytes: this.#documentBytes,
          maximumRequestBodyBytes: this.#requestBytes,
        });
      } catch (cause) {
        // Name what the provider got wrong: no mutation has been sent, and none will be.
        if (cause instanceof ProtocolArtifactValidationError)
          return unusable(received, cause.message);
        throw cause;
      }
      return Object.freeze({
        kind: "success",
        http: context(received),
        nativeBody: nativeBody(received),
        value,
      });
    });
  }

  /** Discovery for invoking Callables. Refuses a Scope without Callables1. */
  async bindCallables(
    scope: string,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<CallableBinding>> {
    const selected = parseCanonicalScope(scope);
    const discovery = await this.inspectScope(selected, call);
    if (discovery.kind !== "success") return discovery;
    return Object.freeze({ ...discovery, value: new CallableBinding(selected, discovery.value) });
  }

  /** One POST to the prepared mount. A Problem is a reply; an unusable response leaves the
   * invocation's disposition unknown. The result is not checked against any schema. */
  invokeCallable(
    prepared: PreparedCallableInvocation,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<RetainedJsonObject>> {
    const { kind, url, method, bodyText, idempotencyKey } = prepared;
    if (method !== "POST" || (kind !== "query" && kind !== "batch"))
      throw new RetainedClientError("invalid-input");
    parseCanonicalHttpUrl(url);
    const callerSignal = signalOnly(call);
    return this.#run(callerSignal, async (signal, markSubmitted) => {
      markSubmitted();
      const response = await this.#transport.post(url, {
        signal,
        bodyText,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      try {
        const refused = failure(response, false, parseCallableProblem);
        if (refused) return refused;
        return Object.freeze({
          kind: "success",
          value: parseCallableResult(this.#document(response), kind),
          http: context(response),
          nativeBody: nativeBody(response),
        });
      } catch (cause) {
        throw new RetainedClientError(
          "invalid-response",
          "unknown",
          context(response),
          reasonOf(cause),
        );
      }
    });
  }

  /** Redirect-only GET; never follows an alias or transfers credentials. */
  resolveAlias(
    alias: string,
    scope: string,
    call: RetainedClientCallOptions = {},
  ): Promise<RetainedReply<{ readonly alias: string; readonly target: string }>> {
    const selected = parseCanonicalScope(scope);
    const url = parseCanonicalHttpUrl(alias);
    if (!url.startsWith(selected) || url.includes("?"))
      throw new RetainedClientError("invalid-input");
    const caller = signalOnly(call);
    return this.#run(caller, async (active) => {
      const response = await this.#transport.resolveAlias(url, { signal: active });
      this.#check(active);
      const refused = failure(response, true);
      if (refused) return refused;
      if (
        response.kind !== "alias-redirect" ||
        response.status !== 307 ||
        response.headers["bdp-resource-kind"] !== undefined ||
        response.headers["bdp-collection-kind"] !== undefined
      )
        return invalid();
      const target = parseCanonicalHttpUrl(response.headers.location);
      if (!target.startsWith(selected) || target.includes("?")) return invalid();
      return Object.freeze({
        kind: "success",
        http: context(response),
        value: Object.freeze({ alias: url, target }),
      });
    });
  }

  /** One native page per call: no flattening, speculative fetch or synthesized cursor. */
  list(options: {
    readonly scope: string;
    readonly kind: RetainedResourceKind;
    readonly filters?: RetainedCollectionFilters;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<RetainedReply<RetainedPageValue>> {
    if (
      Object.keys(options).some(
        (name) => !["scope", "kind", "filters", "limit", "signal"].includes(name),
      )
    )
      throw new RetainedClientError("unsupported-feature");
    const scope = parseCanonicalScope(options.scope);
    const { kind, limit, signal } = options;
    if (kind !== "bead" && kind !== "link") throw new RetainedClientError("invalid-input");
    const filters = { ...options.filters };
    for (const [name, value] of Object.entries(filters))
      if (
        !["type", "conformsTo", "source", "target", "endpoint", "selector"].includes(name) ||
        typeof value !== "string" ||
        (kind === "bead" && ["source", "target", "endpoint"].includes(name))
      )
        throw new RetainedClientError("invalid-input");
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new RetainedClientError("invalid-input");
    return this.#run(signal, async (active) => {
      const landing = await this.#transport.probeScope(scope, { signal: active });
      this.#check(active);
      const fault = failure(landing);
      if (fault) return fault;
      if (landing.kind !== "scope-probe" || ![200, 204].includes(landing.status))
        return unusable(landing, "the Scope landing must answer 200 or 204");
      const discovery = await this.#discovery(description(landing), scope, active);
      if (discovery.kind !== "success") return discovery;
      const url = new URL(kind === "bead" ? "bdp/beads" : "bdp/links", scope);
      for (const [name, value] of Object.entries(filters)) {
        if (url.searchParams.has(name)) return invalid();
        url.searchParams.append(name, value);
      }
      if (limit !== undefined) {
        if (url.searchParams.has("limit")) return invalid();
        url.searchParams.append("limit", String(limit));
      }
      return this.#page({ url: url.href, scope, collectionKind: kind }, active);
    });
  }
  /** Use an issued URL verbatim. To resize, replace only its limit externally. */
  readPage(options: RetainedPageReadOptions): Promise<RetainedReply<RetainedPageValue>> {
    const captured = { ...options };
    const scope = parseCanonicalScope(captured.scope);
    parseCanonicalHttpUrl(captured.url);
    if (!captured.url.startsWith(scope)) throw new RetainedClientError("invalid-input");
    if (captured.collectionKind !== "bead" && captured.collectionKind !== "link")
      throw new RetainedClientError("invalid-input");
    if (
      captured.subject !== undefined &&
      (captured.collectionKind !== "link" ||
        !parseCanonicalHttpUrl(captured.subject).startsWith(scope))
    )
      throw new RetainedClientError("invalid-input");
    return this.#run(captured.signal, (active) => this.#page(captured, active));
  }
  incident(options: {
    readonly bead: string;
    readonly scope: string;
    readonly direction?: "inbound" | "outbound" | "both";
    readonly filters?: RetainedCollectionFilters;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<RetainedReply<RetainedPageValue>> {
    if (
      Object.keys(options).some(
        (name) => !["scope", "bead", "direction", "filters", "limit", "signal"].includes(name),
      )
    )
      throw new RetainedClientError("unsupported-feature");
    const bead = parseCanonicalHttpUrl(options.bead);
    if (bead.includes("?")) throw new RetainedClientError("invalid-input");
    if (
      options.direction !== undefined &&
      !["both", "inbound", "outbound"].includes(options.direction)
    )
      throw new RetainedClientError("invalid-input");
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
      throw new RetainedClientError("invalid-input");
    const url = new URL(bead);
    for (const [name, value] of Object.entries(options.filters ?? {})) {
      if (
        !["type", "conformsTo", "source", "target", "endpoint", "selector"].includes(name) ||
        typeof value !== "string"
      )
        throw new RetainedClientError("invalid-input");
      url.searchParams.set(name, value);
    }
    url.searchParams.set("view", "links");
    if (options.direction !== undefined) url.searchParams.set("direction", options.direction);
    if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
    return this.readPage({
      url: url.href,
      scope: options.scope,
      collectionKind: "link",
      subject: bead,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }
  async #page(
    options: RetainedPageReadOptions,
    active: AbortSignal,
  ): Promise<RetainedReply<RetainedPageValue>> {
    const {
      url,
      scope,
      collectionKind,
      subject,
      method = "GET",
      signal: _signal,
      ...controls
    } = options;
    if (method !== "GET" && method !== "HEAD") throw new RetainedClientError("invalid-input");
    for (const name of Object.keys(controls))
      if (!["ifMatch", "ifNoneMatch", "ifModifiedSince", "ifUnmodifiedSince"].includes(name))
        throw new RetainedClientError("unsupported-feature");
    const response = await this.#transport[method === "HEAD" ? "head" : "get"](url, {
      ...controls,
      signal: active,
    });
    this.#check(active);
    const refused = failure(response, method === "HEAD");
    if (refused) return refused;
    if (
      ![200, 304].includes(response.status) ||
      response.headers["bdp-collection-kind"] !== collectionKind ||
      (subject === undefined
        ? response.headers["bdp-resource-kind"] !== undefined
        : response.headers["bdp-resource-kind"] !== "bead")
    )
      return unusable(response, "it is not the collection that was asked for");
    if (
      response.status === 304 &&
      controls.ifNoneMatch === undefined &&
      controls.ifModifiedSince === undefined
    )
      return unusable(response, "a 304 answered an unconditional read");
    if (response.contentType !== null && media(response.contentType) !== RETAINED_V01_MEDIA_TYPE)
      return unusable(response, `expected ${RETAINED_V01_MEDIA_TYPE}`);
    let page: RetainedCollection | undefined;
    if (method === "HEAD" || response.status === 304) {
      if (response.kind !== "empty") return invalid();
    } else {
      page = parseRetainedCollection(this.#document(response), collectionKind);
      if (
        page.items.some((item) => !(item.id as string).startsWith(scope)) ||
        (page.next !== null && !page.next.startsWith(scope))
      )
        return unusable(response, "its page names something outside the Scope");
    }
    const owner = await this.#discovery(description(response), scope, active);
    if (owner.kind !== "success") return owner;
    return Object.freeze({
      kind: "success",
      http: context(response),
      ...(page === undefined ? {} : { nativeBody: nativeBody(response) }),
      value: Object.freeze({
        specification: RETAINED_V01_SPECIFICATION,
        scope,
        collectionKind,
        ...(subject === undefined ? {} : { subject }),
        ...(page === undefined ? {} : { page }),
      }),
    });
  }

  read(options: RetainedPointReadOptions): Promise<RetainedReply<RetainedPointValue>> {
    // Snapshot once before the first await. This is an already-resolved native
    // intent, not a second CLI Reference/ordinal grammar.
    const {
      reference,
      view,
      includeLinks,
      expectedKind,
      scope,
      method = "GET",
      signal,
      allowExactRevision,
      followAlias,
      ...controls
    } = options;
    if (typeof reference !== "string" && allowExactRevision !== true)
      throw new RetainedClientError("unsupported-feature");
    if (
      (allowExactRevision !== undefined && allowExactRevision !== true) ||
      (followAlias !== undefined && followAlias !== true)
    )
      throw new RetainedClientError("invalid-input");
    let resource = parseCanonicalHttpUrl(typeof reference === "string" ? reference : reference.uri);
    const revision = typeof reference === "string" ? undefined : reference.revision;
    if (revision !== undefined && (typeof revision !== "string" || revision.length === 0))
      throw new RetainedClientError("invalid-input");
    if (
      includeLinks !== undefined &&
      (view !== undefined ||
        revision !== undefined ||
        (includeLinks.limit !== undefined &&
          (!Number.isSafeInteger(includeLinks.limit) || includeLinks.limit < 1)) ||
        (includeLinks.direction !== undefined &&
          !["both", "inbound", "outbound"].includes(includeLinks.direction)))
    )
      throw new RetainedClientError("invalid-input");
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
    const readUrl = (): string => {
      const target = new URL(resource);
      if (revision !== undefined) target.searchParams.set("revision", revision);
      if (view !== undefined) target.searchParams.set("view", view);
      if (includeLinks !== undefined) {
        target.searchParams.set("include", "links");
        if (includeLinks.direction !== undefined)
          target.searchParams.set("direction", includeLinks.direction);
        if (includeLinks.limit !== undefined)
          target.searchParams.set("limit", String(includeLinks.limit));
      }
      return target.href;
    };
    const url = readUrl();
    const originalResource = resource;
    return this.#run(signal, async (active) => {
      let response: Awaited<ReturnType<RetainedTransport["resolveAlias"]>>;
      try {
        response = await this.#transport[method === "HEAD" ? "head" : "get"](url, {
          ...controls,
          signal: active,
        });
      } catch (error) {
        if (
          followAlias !== true ||
          !(error instanceof RetainedTransportError) ||
          error.code !== "redirect" ||
          error.httpStatus !== 307 ||
          method !== "GET"
        )
          throw error;
        response = await this.#transport.resolveAlias(url, { ...controls, signal: active });
      }
      let aliased = false;
      if (response.kind === "alias-redirect") {
        if (
          response.headers["bdp-resource-kind"] !== undefined ||
          response.headers["bdp-collection-kind"] !== undefined
        )
          return invalid();
        const location = parseCanonicalHttpUrl(response.headers.location);
        if (
          (selectedScope !== undefined && !location.startsWith(selectedScope)) ||
          location.includes("?")
        )
          return invalid();
        resource = location;
        aliased = true;
        // A second redirect is rejected by ordinary GET. No chain, credential
        // transfer, inventory lookup or path-derived owner is inferred.
        response = await this.#transport.get(readUrl(), { ...controls, signal: active });
      }
      this.#check(active);
      const refused = failure(response, method === "HEAD");
      if (refused) return refused;
      if (response.status !== 200 && response.status !== 304)
        return unusable(response, "a read must answer 200 or 304");
      if (
        response.status === 304 &&
        controls.ifNoneMatch === undefined &&
        controls.ifModifiedSince === undefined
      )
        return unusable(response, "a 304 answered an unconditional read");
      const kind = response.headers["bdp-resource-kind"];
      if (kind !== "bead" && kind !== "link")
        return unusable(response, "it has no usable BDP-Resource-Kind");
      if (expectedKind !== undefined && kind !== expectedKind)
        return unusable(response, `expected a ${expectedKind}, and it is a ${kind}`);
      if (includeLinks !== undefined && kind !== "bead")
        return unusable(response, "included Links are valid only for a Bead");
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
        if (
          view === undefined &&
          (body.id !== resource ||
            (includeLinks === undefined ? body.links !== undefined : body.links === undefined) ||
            (revision !== undefined && body.revision !== revision))
        )
          return unusable(response, "its record does not match what was asked for");
      }
      const discovery = await this.#discovery(description(response), selectedScope, active);
      if (discovery.kind !== "success") return discovery;
      if (
        !resource.startsWith(discovery.value.scope) ||
        (aliased && !originalResource.startsWith(discovery.value.scope))
      )
        return invalid();
      return Object.freeze({
        kind: "success",
        http: context(response),
        ...(originalBytes === undefined ? {} : { nativeBody: originalBytes }),
        value: Object.freeze({
          specification: RETAINED_V01_SPECIFICATION,
          scope: discovery.value.scope,
          resourceKind: kind,
          representation: view === "properties" ? "properties" : "resource",
          ...(aliased ? { subject: resource } : {}),
          ...(body === undefined ? {} : { body }),
        }),
      });
    });
  }

  /** Explicit current feature view. Terminal reads supply only the current
   * body-free terminal version; this does not select full History. */
  readHistoricalUpdate(
    reference: string,
    options: {
      readonly terminal?: boolean;
      readonly scope?: string;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<RetainedReply<HistoricalUpdateView | HistoricalUpdateTerminalView>> {
    if (
      Object.keys(options).some((key) => !["terminal", "scope", "signal"].includes(key)) ||
      (options.terminal !== undefined && typeof options.terminal !== "boolean")
    )
      throw new RetainedClientError("unsupported-feature");
    const uri = parseCanonicalHttpUrl(reference);
    if (new URL(uri).search || new URL(uri).hash) throw new RetainedClientError("invalid-input");
    const selectedScope =
      options.scope === undefined ? undefined : parseCanonicalScope(options.scope);
    const transport = this.#historicalUpdateTransport;
    if (transport === undefined) throw new RetainedClientError("unsupported-feature");
    const terminal = options.terminal === true;
    return this.#run(options.signal, async (signal) => {
      const response = await transport.get(uri + (terminal ? "?view=terminal" : ""), { signal });
      this.#check(signal);
      const refused = failure(response, false, parseHistoricalUpdateProblem);
      if (
        refused?.kind === "problem" &&
        refused.problem.code === "capability-not-supported" &&
        refused.problem.pointer !== undefined
      )
        return invalid();
      if (refused) return refused;
      if (response.headers["bdp-resource-kind"] !== "bead") return invalid();
      const text = this.#document(response, HISTORICAL_UPDATE_MEDIA);
      let value: HistoricalUpdateView | HistoricalUpdateTerminalView;
      try {
        value = terminal
          ? parseHistoricalUpdateTerminalView(text)
          : parseHistoricalUpdateView(text);
      } catch {
        return invalid();
      }
      const subject = (terminal ? value.terminal : value.resource) as RetainedJsonObject;
      if (subject.id !== uri) return invalid();
      const discovery = await this.#discovery(description(response), selectedScope, signal);
      if (discovery.kind !== "success") return discovery;
      if (!uri.startsWith(discovery.value.scope) || discovery.value.profile !== "write")
        return invalid();
      const writeDiscovery = parseRetainedWriteDiscovery(stringifyJsonValue(discovery.value));
      if (readHistoricalUpdateCapability(writeDiscovery) === undefined) return invalid();
      return Object.freeze({
        kind: "success",
        value,
        http: context(response),
        nativeBody: nativeBody(response),
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
    const historical = savedHeaders.accept === HISTORICAL_UPDATE_MEDIA;
    const selectedMedia = historical ? HISTORICAL_UPDATE_MEDIA : RETAINED_V01_MEDIA_TYPE;
    if (
      specification !== RETAINED_V01_SPECIFICATION ||
      method !== "POST" ||
      !RETAINED_WRITE_OPERATIONS.includes(operation) ||
      savedHeaders.accept !== selectedMedia ||
      savedHeaders["content-type"] !== selectedMedia ||
      (historical && operation !== "updateBead") ||
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
    const input = historical
      ? parseHistoricalUpdateRequest(bodyText)
      : parseRetainedWriteInput(operation, bodyText);
    const transport = historical ? this.#historicalUpdateTransport : this.#transport;
    if (transport === undefined) throw new RetainedClientError("unsupported-feature");
    const callerSignal = signalOnly(call);
    return this.#run(callerSignal, async (signal, markSubmitted) => {
      markSubmitted();
      const response = await transport.post(url, {
        signal,
        bodyText,
        idempotencyKey: savedHeaders["idempotency-key"],
      });
      try {
        const refused = failure(
          response,
          false,
          historical ? parseHistoricalUpdateProblem : parseRetainedProblem,
        );
        if (
          historical &&
          refused?.kind === "problem" &&
          refused.problem.code === "capability-not-supported" &&
          refused.problem.pointer !== "/fromRevision"
        )
          return invalid();
        if (refused) return refused;
        const value = historical
          ? parseHistoricalUpdateResult(this.#document(response, selectedMedia))
          : parseRetainedWriteResult(operation, this.#document(response));
        const result = historical ? (value.result as RetainedJsonObject) : value;
        if (historical && result.changed === true) {
          const evidence = value.historicalUpdate as RetainedJsonObject;
          if (
            evidence.fromRevision !== input.fromRevision ||
            (input.expectedRevision !== undefined &&
              evidence.previousRevision !== input.expectedRevision)
          )
            return invalid();
        }
        const identity =
          result.resource !== undefined
            ? (result.resource as RetainedJsonObject).id
            : result.deleted === undefined
              ? undefined
              : ((result.deleted as RetainedJsonObject).resource as RetainedJsonObject).id;
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
    let value: RetainedDiscovery;
    try {
      value = parseRetainedDiscovery(this.#document(response));
    } catch (cause) {
      return unusable(response, reasonOf(cause) ?? "its discovery document is not valid");
    }
    if (scope !== undefined && value.scope !== scope)
      return unusable(response, "its discovery document names a different Scope");
    return Object.freeze({
      kind: "success",
      value,
      http: context(response),
      nativeBody: nativeBody(response),
    });
  }
  #document(
    response: RetainedHttpResponse,
    selectedMedia: string = RETAINED_V01_MEDIA_TYPE,
  ): string {
    if (
      response.status !== 200 ||
      response.kind !== "json" ||
      typeof response.bodyText !== "string" ||
      media(response.contentType) !== selectedMedia ||
      new TextEncoder().encode(response.bodyText).byteLength > this.#documentBytes
    )
      return unusable(response, `expected a 200 ${selectedMedia} document`);
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
  parseProblem: (text: string, status: number) => RetainedJsonObject = parseRetainedProblem,
): Exclude<RetainedReply<never>, { kind: "success" }> | undefined {
  if (response.status < 400) return undefined;
  if (response.kind === "empty" && (head || [405, 406, 412, 500].includes(response.status)))
    return Object.freeze({ kind: "http", http: context(response) });
  if (
    response.kind !== "json" ||
    typeof response.bodyText !== "string" ||
    media(response.contentType) !== "application/problem+json"
  )
    return unusable(response, "a failure must carry a BDP Problem");
  let problem: RetainedJsonObject;
  try {
    problem = parseProblem(response.bodyText, response.status);
  } catch (cause) {
    return unusable(response, `its Problem body is not a BDP Problem: ${reasonOf(cause)}`);
  }
  return Object.freeze({
    kind: "problem",
    problem,
    http: context(response),
    nativeBody: nativeBody(response),
  });
}
function description(response: RetainedHttpContext): string {
  const unadvertised = (): never =>
    unusable(response, 'the Scope landing has no single usable Link rel="service-desc"');
  try {
    const targets = new Set<string>();
    for (const entry of parseLinkHeader(response.headers.link ?? "")) {
      const rels = entry.parameters.filter((p) => p.name === "rel");
      if (!rels.some((p) => p.value.split(/ +/).some((v) => v.toLowerCase() === "service-desc")))
        continue;
      if (rels.length !== 1) return unadvertised();
      const anchors = entry.parameters.filter((p) => p.name === "anchor");
      const types = entry.parameters.filter((p) => p.name === "type");
      if (anchors.length > 1 || types.length > 1) return unadvertised();
      if (anchors[0] !== undefined && new URL(anchors[0].value, response.url).href !== response.url)
        continue;
      if (types[0] !== undefined && media(types[0].value) !== RETAINED_V01_MEDIA_TYPE) continue;
      targets.add(parseCanonicalHttpUrl(new URL(entry.target, response.url).href));
    }
    if (targets.size !== 1) return unadvertised();
    return [...targets][0]!;
  } catch {
    return unadvertised();
  }
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
