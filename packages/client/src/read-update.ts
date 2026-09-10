import {
  assertCanonicalPathSegments,
  type BeadRecord,
  isHttpScopeCandidate,
  type LinkRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseLinkHeader,
  parseReadProblem,
  parseReadUpdateAliasResult,
  parseReadUpdateDiscovery,
  parseReadUpdateMutationResult,
  parseReadUpdateOperationDirectory,
  parseReadUpdateProblem,
  parseReadUpdateSequenceResponse,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  type ReadBodyFor,
  type ReadProblem,
  type ReadUpdateAliasResult,
  type ReadUpdateDiscovery,
  type ReadUpdateMutationResult,
  type ReadUpdateOperation,
  type ReadUpdateOperationDirectory,
  type ReadUpdateProblem,
  type ReadUpdateSequenceResponse,
  type Reference,
  referenceUri,
  resolveCanonicalLocalResourceId,
  type ScopeReadOperation,
  snapshotJsonValue,
  type UnadmittedReadUpdateOperation,
} from "@bdp/protocol";
import {
  type BdpContinuationScope,
  type PreparedRead,
  ReadSession,
  ReadSessionLocalError,
  type StagedRead,
} from "./read-session.js";
import {
  type ReadUpdateAliasResponse,
  type ReadUpdateHttpContext,
  type ReadUpdateScopeProbeResponse,
  type ReadUpdateTransport,
  ReadUpdateTransportError,
} from "./read-update-transport.js";

export interface ReadUpdateClientOptions {
  readonly scope: string;
  readonly transport: ReadUpdateTransport;
  /** Total caller delivery deadline, including discovery/navigation. No retry. */
  readonly settlementTimeoutMs: number;
}
export interface ReadUpdateClientCallOptions {
  readonly signal?: AbortSignal;
}
export interface ReadUpdateClientReadOptions extends ReadUpdateClientCallOptions {
  readonly continuationScope?: BdpContinuationScope;
}
export interface ReadUpdateClientAliasResolution {
  readonly alias: string;
  readonly target: string;
}
export interface ReadUpdateClientMutationOptions extends ReadUpdateClientCallOptions {
  readonly idempotencyKey: string;
}
export type ReadUpdateClientReply<T, P = ReadUpdateProblem> =
  | { readonly kind: "success"; readonly value: T; readonly http: ReadUpdateHttpContext }
  | {
      readonly kind: "problem";
      readonly problem: P;
      readonly http: ReadUpdateHttpContext;
    }
  | { readonly kind: "http"; readonly http: ReadUpdateHttpContext };
export type ReadUpdateResultFor<K extends ReadUpdateOperation> = K extends
  | "putAlias"
  | "deleteAlias"
  ? ReadUpdateAliasResult
  : ReadUpdateMutationResult;
export type ReadUpdateClientErrorCode =
  | "invalid-input"
  | "closed"
  | "aborted"
  | "timeout"
  | "transport"
  | "invalid-response";
/** A local delivery failure is never a server Problem or a rollback guarantee. */
export class ReadUpdateClientError extends Error {
  override readonly name = "ReadUpdateClientError";
  constructor(
    readonly code: ReadUpdateClientErrorCode,
    readonly submission: "not-submitted" | "unknown",
    readonly httpStatus?: number,
    readonly contentType?: string | null,
    readonly retryAfter?: string | null,
    readonly headers?: Readonly<Record<string, string>>,
    readonly operationIndex?: number,
  ) {
    super(`Read+Update client ${code} (${submission})`);
  }
}
interface Call {
  readonly signal: AbortSignal;
  check(): void;
  failure(
    code: ReadUpdateClientErrorCode,
    http?: ReadUpdateHttpContext | null,
    operationIndex?: number,
  ): ReadUpdateClientError;
  exchange<Response extends ClientResponse>(
    action: () => Promise<Response>,
    url: string,
    mutation?: boolean,
  ): Promise<Response>;
}
type ClientResponse = ReadUpdateScopeProbeResponse | ReadUpdateAliasResponse;
type FailureReply<P = ReadUpdateProblem> = Exclude<
  ReadUpdateClientReply<never, P>,
  { readonly kind: "success" }
>;

/** Read+Update navigation and commands. No semantic identity, credential policy
 * or authority admission is implemented here.
 * Injected transports must be confined to the same configured Scope.
 */
export class BdpReadUpdateClient {
  readonly scope: string;
  private readonly transport: ReadUpdateTransport;
  private readonly timeoutMs: number;
  private readonly readSession: ReadSession;
  private readonly active = new Set<AbortController>();
  private closed = false;

  constructor(options: ReadUpdateClientOptions) {
    try {
      this.scope = parseCanonicalScope(options.scope);
      this.timeoutMs = options.settlementTimeoutMs;
      this.readSession = new ReadSession(this.scope);
      const transport = options.transport;
      const resolveAlias = transport.resolveAlias;
      this.transport = Object.freeze({
        ...(resolveAlias === undefined ? {} : { resolveAlias: resolveAlias.bind(transport) }),
        get: transport.get.bind(transport),
        post: transport.post.bind(transport),
        probeScope: transport.probeScope.bind(transport),
      });
      if (
        !Number.isSafeInteger(this.timeoutMs) ||
        this.timeoutMs <= 0 ||
        this.timeoutMs > 2_147_483_647
      )
        throw Error();
    } catch {
      throw new ReadUpdateClientError("invalid-input", "not-submitted");
    }
  }

  createContinuationScope(): BdpContinuationScope {
    this.assertReadOpen();
    return this.readLocal(() => this.readSession.createContinuationScope());
  }
  forgetContinuations(owner: BdpContinuationScope): void {
    this.assertReadOpen();
    this.readLocal(() => this.readSession.forgetContinuations(owner));
  }
  read<R extends ScopeReadOperation>(
    request: R,
    options: ReadUpdateClientReadOptions = {},
  ): Promise<ReadUpdateClientReply<ReadBodyFor<R>, ReadProblem>> {
    const startedAt = performance.now();
    let captured: ReadUpdateClientReadOptions;
    let localFailure: ReadUpdateClientError | undefined;
    const refuse = (code: ReadUpdateClientErrorCode): never => {
      localFailure = new ReadUpdateClientError(code, "not-submitted");
      throw localFailure;
    };
    let prepared: PreparedRead<R>;
    try {
      if (this.closed) refuse("closed");
      captured = snapshotReadOptions(options);
      this.readSession.owner(captured.continuationScope);
      if (captured.signal?.aborted) refuse("aborted");
      prepared = this.readSession.prepare(request, captured.continuationScope);
    } catch (cause) {
      return Promise.reject(
        cause === localFailure && localFailure !== undefined
          ? localFailure
          : new ReadUpdateClientError("invalid-input", "not-submitted"),
      );
    }
    type Delivery =
      | FailureReply<ReadProblem>
      | {
          readonly kind: "staged";
          readonly staged: StagedRead<R>;
          readonly http: ReadUpdateHttpContext;
        };
    try {
      return this.run<Delivery, ReadUpdateClientReply<ReadBodyFor<R>, ReadProblem>>(
        captured,
        async (call) => {
          const discovery = await this.loadDiscovery(call, parseReadProblem);
          if (discovery.kind !== "success") return discovery;
          let route: ReturnType<PreparedRead<R>["route"]>;
          try {
            route = prepared.route(discovery.value);
          } catch (cause) {
            if (cause instanceof ReadSessionLocalError) throw call.failure("invalid-input", null);
            throw cause;
          }
          if (route.kind === "refusal") throw call.failure("invalid-input", null);
          const url = route.value;
          const received = await call.exchange(
            () => this.transport.get(url, { signal: call.signal }),
            url,
          );
          const fault = responseFailure(received, parseReadProblem);
          if (fault) return fault;
          const http = responseContext(received);
          if (
            received.kind !== "json" ||
            received.status !== 200 ||
            media(received) !== "application/json"
          )
            throw call.failure("invalid-response", http);
          assertPrivateNoStore(http);
          const validated = prepared.validate(received.body);
          if (validated.kind === "refusal") throw call.failure("invalid-response", http);
          return { kind: "staged", staged: validated.value, http };
        },
        startedAt,
        (delivery, call) => {
          if (delivery.kind !== "staged") return delivery;
          try {
            const committed = prepared.commit(delivery.staged);
            if (committed.kind === "refusal") throw call.failure("invalid-response", delivery.http);
            return success(committed.value, delivery.http);
          } catch (cause) {
            if (cause instanceof ReadSessionLocalError)
              throw call.failure(
                cause.reason === "capacity" ? "invalid-input" : "invalid-response",
                cause.reason === "capacity" ? null : delivery.http,
              );
            throw cause;
          }
        },
      ).finally(() => prepared.release());
    } catch {
      prepared.release();
      return Promise.reject(new ReadUpdateClientError("invalid-input", "not-submitted"));
    }
  }
  resolveAlias(
    alias: string,
    options: ReadUpdateClientCallOptions = {},
  ): Promise<ReadUpdateClientReply<ReadUpdateClientAliasResolution, ReadProblem>> {
    const startedAt = performance.now();
    let captured: ReadUpdateClientReadOptions;
    let localFailure: ReadUpdateClientError | undefined;
    const refuse = (code: ReadUpdateClientErrorCode): never => {
      localFailure = new ReadUpdateClientError(code, "not-submitted");
      throw localFailure;
    };
    const resolve = this.transport.resolveAlias;
    try {
      if (this.closed) refuse("closed");
      captured = snapshotReadOptions(options);
      if (captured.continuationScope !== undefined) throw Error();
      if (captured.signal?.aborted) refuse("aborted");
      if (
        !resolve ||
        typeof alias !== "string" ||
        !alias.startsWith(`${this.scope}alias/`) ||
        alias.includes("?")
      )
        throw Error();
      parseCanonicalHttpUrl(alias);
      assertCanonicalPathSegments(alias.slice(`${this.scope}alias/`.length), "alias");
    } catch (cause) {
      return Promise.reject(
        cause === localFailure && localFailure !== undefined
          ? localFailure
          : new ReadUpdateClientError("invalid-input", "not-submitted"),
      );
    }
    return this.run(
      captured,
      async (call) => {
        const discovery = await this.loadDiscovery(call, parseReadProblem);
        if (discovery.kind !== "success") return discovery;
        const received = await call.exchange(() => resolve(alias, { signal: call.signal }), alias);
        const fault = responseFailure(received, parseReadProblem);
        if (fault) return fault;
        const http = responseContext(received);
        if (received.kind !== "alias-redirect" || received.status !== 307)
          throw call.failure("invalid-response", http);
        assertPrivateNoStore(http);
        const target = http.headers.location;
        if (target === undefined || target.includes("?"))
          throw call.failure("invalid-response", http);
        parseCanonicalHttpUrl(target);
        this.resourceId(target, "bead");
        return success(Object.freeze({ alias, target }), http);
      },
      startedAt,
    );
  }
  private assertReadOpen(): void {
    if (this.closed) throw new ReadUpdateClientError("closed", "not-submitted");
  }
  private readLocal<T>(action: () => T): T {
    try {
      return action();
    } catch (cause) {
      throw new ReadUpdateClientError(
        cause instanceof ReadSessionLocalError && cause.reason === "closed"
          ? "closed"
          : "invalid-input",
        "not-submitted",
      );
    }
  }

  discover(
    options: ReadUpdateClientCallOptions = {},
  ): Promise<ReadUpdateClientReply<ReadUpdateDiscovery>> {
    return this.run(options, (call) => this.loadDiscovery(call));
  }
  operationDirectory(
    options: ReadUpdateClientCallOptions = {},
  ): Promise<ReadUpdateClientReply<ReadUpdateOperationDirectory>> {
    return this.run(options, (call) => this.loadDirectory(call));
  }
  mutate<K extends ReadUpdateOperation>(
    operation: K,
    bodyText: string,
    options: ReadUpdateClientMutationOptions,
  ): Promise<ReadUpdateClientReply<ReadUpdateResultFor<K>>> {
    const startedAt = performance.now();
    let key: string;
    let prepared: ReturnType<typeof prepareReadUpdateSingleton>;
    try {
      key = options.idempotencyKey;
      if (
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 256 ||
        /[^A-Za-z0-9_-]/.test(key)
      )
        throw Error();
      prepared = prepareReadUpdateSingleton(this.scope, operation, bodyText, key);
    } catch {
      return Promise.reject(new ReadUpdateClientError("invalid-input", "not-submitted"));
    }
    const operationInput = prepared.operations[0];
    if (!operationInput)
      return Promise.reject(new ReadUpdateClientError("invalid-input", "not-submitted"));
    return this.run(
      options,
      async (call) => {
        const directory = await this.loadDirectory(call);
        if (directory.kind !== "success") return directory;
        const url = this.confined(directory.value[operation], `${this.scope}operations/`);
        const received = await call.exchange(
          () => this.transport.post(url, { bodyText, idempotencyKey: key, signal: call.signal }),
          url,
          true,
        );
        const fault = responseFailure(received);
        if (fault) return fault;
        const http = responseContext(received);
        if (
          received.kind !== "json" ||
          received.status !== 200 ||
          media(received) !== "application/json" ||
          http.headers.etag !== undefined ||
          http.headers.location !== undefined
        )
          throw call.failure("invalid-response", http);
        assertPrivateNoStore(http);
        const value =
          operation === "putAlias" || operation === "deleteAlias"
            ? parseReadUpdateAliasResult(received.body)
            : parseReadUpdateMutationResult(received.body);
        this.correspond(operationInput, value, new Map());
        return success(value as ReadUpdateResultFor<K>, http);
      },
      startedAt,
    );
  }
  sequence(
    bodyText: string,
    options: ReadUpdateClientCallOptions = {},
  ): Promise<ReadUpdateClientReply<ReadUpdateSequenceResponse>> {
    const startedAt = performance.now();
    let prepared: ReturnType<typeof prepareReadUpdateSequence>;
    try {
      prepared = prepareReadUpdateSequence(this.scope, bodyText);
    } catch {
      return Promise.reject(new ReadUpdateClientError("invalid-input", "not-submitted"));
    }
    return this.run(
      options,
      async (call) => {
        const directory = await this.loadDirectory(call);
        if (directory.kind !== "success") return directory;
        const url = this.confined(directory.value.sequence, `${this.scope}operations/`);
        const received = await call.exchange(
          () => this.transport.post(url, { bodyText, signal: call.signal }),
          url,
          true,
        );
        const fault = responseFailure(received);
        if (fault) return fault;
        const http = responseContext(received);
        if (
          received.kind !== "json" ||
          received.status !== 200 ||
          media(received) !== "application/json"
        )
          throw call.failure("invalid-response", http);
        assertPrivateNoStore(http);
        const value = parseReadUpdateSequenceResponse(received.body, {
          operations: prepared.operations,
        });
        const bindings = new Map<string, string>();
        const transientCreators = new Set<string>();
        for (const [index, entry] of value.results.entries()) {
          try {
            const operation = prepared.operations[index];
            if (!operation) throw call.failure("invalid-response");
            // A transient creator forbids even consulting the dependent key. Its
            // required in-progress response is observable without current lookup.
            for (const field of ["bead", "link", "source", "target"]) {
              const reference = operation.input[field];
              const uri =
                typeof reference === "string"
                  ? reference
                  : reference && typeof reference === "object" && "uri" in reference
                    ? reference.uri
                    : undefined;
              if (
                typeof uri === "string" &&
                uri.startsWith("@") &&
                transientCreators.has(uri.slice(1))
              ) {
                if (!("code" in entry) || entry.code !== "idempotency-in-progress")
                  throw call.failure("invalid-response", http);
              }
            }
            if (!("outcome" in entry)) {
              if (operation.name !== undefined && entry.retry === "after-delay")
                transientCreators.add(operation.name);
              continue;
            }
            // Envelope fields are already validated against the request above.
            const { operationIndex: _index, operationName: _name, ...outcome } = entry;
            const result =
              operation.operation === "putAlias" || operation.operation === "deleteAlias"
                ? parseReadUpdateAliasResult(outcome)
                : parseReadUpdateMutationResult(outcome);
            this.correspond(operation, result, bindings);
            if (operation.name !== undefined && "resource" in result && result.resource)
              bindings.set(operation.name, result.resource.id);
          } catch {
            // Report only the caller's member index, never a partly trusted envelope.
            throw call.failure("invalid-response", http, index);
          }
        }
        return success(value, http);
      },
      startedAt,
    );
  }
  /** Ends client delivery, not admitted server work. Uncooperative transports
   * are observed but cannot hold close() open or deliver a later client result.
   */
  close(): Promise<void> {
    this.closed = true;
    this.readSession.clear();
    for (const controller of this.active) controller.abort();
    return Promise.resolve();
  }

  private run<T>(
    options: ReadUpdateClientCallOptions,
    action: (call: Call) => Promise<T>,
    startedAt?: number,
  ): Promise<T>;
  private run<T, R>(
    options: ReadUpdateClientCallOptions,
    action: (call: Call) => Promise<T>,
    startedAt: number,
    finalize: (value: T, call: Call) => R,
  ): Promise<R>;
  private run<T, R = T>(
    options: ReadUpdateClientCallOptions,
    action: (call: Call) => Promise<T>,
    startedAt = performance.now(),
    finalize?: (value: T, call: Call) => R,
  ): Promise<T | R> {
    if (this.closed) return Promise.reject(new ReadUpdateClientError("closed", "not-submitted"));
    let caller: AbortSignal | undefined;
    try {
      caller = options.signal;
      if (caller !== undefined && !(caller instanceof AbortSignal)) throw Error();
    } catch {
      return Promise.reject(new ReadUpdateClientError("invalid-input", "not-submitted"));
    }
    const controller = new AbortController();
    this.active.add(controller);
    const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
    const expires = startedAt + this.timeoutMs;
    let submitted = false,
      timedOut = false;
    const local = new WeakSet<ReadUpdateClientError>();
    let latest: ReadUpdateHttpContext | undefined;
    const failure = (
      code: ReadUpdateClientErrorCode,
      http: ReadUpdateHttpContext | null | undefined = latest,
      operationIndex?: number,
    ) => {
      const error = new ReadUpdateClientError(
        code,
        submitted ? "unknown" : "not-submitted",
        http?.status,
        http?.contentType,
        http?.retryAfter,
        http?.headers,
        operationIndex,
      );
      local.add(error);
      return error;
    };
    const abortFailure = () =>
      failure(this.closed ? "closed" : caller?.aborted ? "aborted" : "timeout");
    const check = () => {
      if (performance.now() >= expires) {
        timedOut = true;
        controller.abort();
      }
      if (signal.aborted || timedOut) throw abortFailure();
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(0, expires - performance.now()),
    );
    const call: Call = {
      signal,
      check,
      failure,
      exchange: async <Response extends ClientResponse>(
        send: () => Promise<Response>,
        url: string,
        mutation = false,
      ): Promise<Response> => {
        latest = undefined; // Earlier navigation metadata is not this exchange's response.
        check();
        if (mutation) submitted = true;
        let received: Response;
        try {
          received = await send();
        } catch (cause) {
          check();
          if (cause instanceof ReadUpdateTransportError) {
            // Copy only bounded-shape HTTP context, never external causes or fields.
            const status = Number.isInteger(cause.httpStatus) ? cause.httpStatus : undefined;
            const failure = new ReadUpdateClientError(
              "transport",
              cause.submission === "not-submitted"
                ? "not-submitted"
                : submitted
                  ? "unknown"
                  : "not-submitted",
              status,
              typeof cause.contentType === "string" || cause.contentType === null
                ? cause.contentType
                : undefined,
              typeof cause.retryAfter === "string" || cause.retryAfter === null
                ? cause.retryAfter
                : undefined,
              cause.headers === undefined ? undefined : selectedHeaders(cause.headers),
            );
            local.add(failure);
            throw failure;
          }
          throw failure("transport");
        }
        check();
        latest = responseContext(received);
        if (latest.url !== url) throw failure("invalid-response");
        return received;
      },
    };
    return new Promise<T | R>((resolve, reject) => {
      const abort = () => reject(abortFailure());
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        signal.removeEventListener("abort", cleanup);
        this.active.delete(controller);
      };
      Promise.resolve()
        .then(() => {
          check();
          return action(call);
        })
        .then(
          (value) => {
            try {
              check();
              resolve(finalize ? finalize(value, call) : value);
            } catch (cause) {
              reject(
                cause instanceof ReadUpdateClientError && local.has(cause)
                  ? cause
                  : failure("invalid-response"),
              );
            }
          },
          (cause) => {
            reject(
              cause instanceof ReadUpdateClientError && local.has(cause)
                ? cause
                : failure("invalid-response"),
            );
          },
        )
        .finally(cleanup);
      // Clean up delivery ownership even if a custom transport never settles.
      signal.addEventListener("abort", cleanup, { once: true });
      if (signal.aborted) {
        abort();
        cleanup();
      }
    });
  }

  private loadDiscovery(call: Call): Promise<ReadUpdateClientReply<ReadUpdateDiscovery>>;
  private loadDiscovery<P extends ReadUpdateProblem>(
    call: Call,
    parseProblem: (value: unknown) => P,
  ): Promise<ReadUpdateClientReply<ReadUpdateDiscovery, P>>;
  private async loadDiscovery(
    call: Call,
    parseProblem: (value: unknown) => ReadUpdateProblem = parseReadUpdateProblem,
  ): Promise<ReadUpdateClientReply<ReadUpdateDiscovery>> {
    const probe = await call.exchange(
      () => this.transport.probeScope({ signal: call.signal }),
      this.scope,
    );
    const fault = responseFailure(probe, parseProblem);
    if (fault) return fault;
    if (probe.kind !== "scope-probe" || (probe.status !== 200 && probe.status !== 204))
      throw call.failure("invalid-response");
    const link = probe.headers.link;
    if (link === undefined) throw call.failure("invalid-response");
    let target: string | undefined;
    for (const entry of parseLinkHeader(link)) {
      const rel = entry.parameters.find((p) => p.name === "rel");
      if (
        !rel?.value.split(/ +/).some((token) => token.toLowerCase() === "service-desc") ||
        rel.value.trim() !== rel.value
      )
        continue;
      const anchor = entry.parameters.find((p) => p.name === "anchor");
      if (anchor) {
        // An anchored link describes that context, not this Scope request.
        try {
          if (new URL(anchor.value, this.scope).href !== this.scope) continue;
        } catch {
          continue;
        }
      }
      target = this.confined(entry.target, this.scope);
      break;
    }
    if (!target) throw call.failure("invalid-response");
    const descriptionUrl = target;
    const received = await call.exchange(
      () => this.transport.get(descriptionUrl, { signal: call.signal }),
      descriptionUrl,
    );
    const problem = responseFailure(received, parseProblem);
    if (problem) return problem;
    if (
      received.kind !== "json" ||
      received.status !== 200 ||
      media(received) !== "application/json"
    )
      throw call.failure("invalid-response");
    const discovery = parseReadUpdateDiscovery(received.body);
    if (discovery.scope !== this.scope) throw call.failure("invalid-response");
    for (const [field, suffix] of [
      ["beads", "beads/"],
      ["links", "links/"],
      ["types", "types/"],
      ["operations", "operations/"],
      ["aliases", "alias/"],
    ] as const)
      if (discovery[field] !== `${this.scope}${suffix}`) throw call.failure("invalid-response");
    return success(discovery, responseContext(received));
  }
  private async loadDirectory(
    call: Call,
  ): Promise<ReadUpdateClientReply<ReadUpdateOperationDirectory>> {
    const discovery = await this.loadDiscovery(call);
    if (discovery.kind !== "success") return discovery;
    const url = this.confined(discovery.value.operations, this.scope);
    const received = await call.exchange(
      () => this.transport.get(url, { signal: call.signal }),
      url,
    );
    const fault = responseFailure(received);
    if (fault) return fault;
    if (
      received.kind !== "json" ||
      received.status !== 200 ||
      media(received) !== "application/json"
    )
      throw call.failure("invalid-response");
    const directory = parseReadUpdateOperationDirectory(received.body);
    for (const target of Object.values(directory)) this.confined(target, url);
    return success(directory, responseContext(received));
  }
  private confined(reference: string, base: string): string {
    if (
      typeof reference !== "string" ||
      reference.length === 0 ||
      reference.includes("\\") ||
      Array.from(reference).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    )
      throw Error();
    const url = parseCanonicalHttpUrl(new URL(reference, base).href);
    if (!url.startsWith(this.scope)) throw Error();
    return url;
  }
  private resourceId(id: string, kind: "bead" | "link"): string {
    if (!id.startsWith(this.scope)) throw Error();
    if (resolveCanonicalLocalResourceId(this.scope, kind, id.slice(this.scope.length)) !== id)
      throw Error();
    return id;
  }
  private known(
    reference: unknown,
    kind: "bead" | "link",
    bindings: ReadonlyMap<string, string>,
  ): string | undefined {
    if (typeof reference !== "string") return undefined;
    if (reference.startsWith("@")) return bindings.get(reference.slice(1));
    const url = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
      ? reference
      : new URL(reference, this.scope).href;
    if (!url.startsWith(this.scope)) return url; // Exact external spelling, never normalization.
    if (url.startsWith(`${this.scope}alias/`)) return undefined;
    return this.resourceId(url, kind);
  }
  private endpoint(reference: Reference): void {
    const uri = referenceUri(reference);
    if (URL.canParse(uri)) {
      const candidate = new URL(uri),
        scope = new URL(this.scope);
      if (isHttpScopeCandidate(scope, candidate, uri)) this.resourceId(uri, "bead");
    }
  }
  private resource(record: BeadRecord | LinkRecord): void {
    const isLink = "source" in record;
    this.resourceId(record.id, isLink ? "link" : "bead");
    if (isLink) {
      this.endpoint(record.source);
      this.endpoint(record.target);
      if (![record.source, record.target].some((ref) => referenceUri(ref).startsWith(this.scope)))
        throw Error();
    } else {
      // The guarded Bead parser checks declared-key/type/source/sorting shape.
      for (const links of Object.values(record.ownedLinks ?? {}))
        for (const link of links) this.resource(link);
    }
  }
  private correspond(
    operation: UnadmittedReadUpdateOperation,
    result: ReadUpdateMutationResult | ReadUpdateAliasResult,
    bindings: ReadonlyMap<string, string>,
  ): void {
    const kind = operation.operation,
      input = operation.input;
    if (kind === "putAlias" || kind === "deleteAlias") {
      if (
        !("alias" in result) ||
        result.outcome === (kind === "putAlias" ? "deleted" : "created") ||
        (kind === "deleteAlias" && result.outcome !== "deleted")
      )
        throw Error();
      const alias = this.confined(input.alias as string, this.scope);
      if (
        !alias.startsWith(`${this.scope}alias/`) ||
        alias === `${this.scope}alias/` ||
        result.alias !== alias
      )
        throw Error();
      if ("target" in result) {
        this.resourceId(result.target, "bead");
        const expected = this.known(input.target, "bead", bindings);
        if (expected === undefined && !(input.target as string).startsWith("@")) throw Error();
        if (expected !== undefined && result.target !== expected) throw Error();
      }
      return;
    }
    if (!("resource" in result) && !("deleted" in result)) throw Error();
    const resourceKind = kind.includes("Bead") ? "bead" : "link";
    const expectedOutcome = kind.startsWith("create")
      ? "created"
      : kind.startsWith("update")
        ? "updated"
        : "deleted";
    if (result.outcome !== expectedOutcome) throw Error();
    const resource = result.resource ?? result.deleted?.resource;
    if (!resource) throw Error();
    this.resourceId(resource.id, resourceKind);
    if (
      kind.startsWith("create") &&
      input.id === undefined &&
      resource.id.slice(this.scope.length).split("/").length !== 2
    )
      throw Error();
    if (result.resource) {
      if ("source" in result.resource !== (resourceKind === "link")) throw Error();
      this.resource(result.resource);
    } else if (result.deleted?.resourceKind !== resourceKind) throw Error();
    const expectedId = this.known(input.id ?? input.bead ?? input.link, resourceKind, bindings);
    if (expectedId !== undefined && resource.id !== expectedId) throw Error();
    if (input.type !== undefined && resource.type !== input.type) throw Error();
    if (result.source !== undefined) {
      this.resourceId(result.source, "bead");
      if (
        result.resource &&
        "source" in result.resource &&
        result.source !== referenceUri(result.resource.source)
      )
        throw Error();
    }
    if (kind === "createLink" && result.resource && "source" in result.resource) {
      for (const field of ["source", "target"] as const) {
        const supplied = input[field];
        const uri =
          typeof supplied === "string" ? supplied : (supplied as { readonly uri: string }).uri;
        const expected = this.known(uri, "bead", bindings);
        const actual = result.resource[field];
        if (expected !== undefined && referenceUri(actual) !== expected) throw Error();
        if (typeof supplied === "string") {
          if (typeof actual !== "string") throw Error();
        } else if (
          typeof actual === "string" ||
          actual.revision !== (supplied as { readonly revision: string }).revision
        )
          throw Error();
      }
    }
    if (
      result.deleted &&
      input.expectedRevision !== undefined &&
      result.deleted.resource.revision !== input.expectedRevision
    )
      throw Error();
  }
}

function media(response: ReadUpdateHttpContext): string | undefined {
  return response.contentType?.split(";", 1)[0]?.trim().toLowerCase();
}
/** Select the same transport metadata at the injected-transport boundary;
 * cookie/credential/unknown fields never become client errors or reply context.
 */
function selectedHeaders(value: unknown): Readonly<Record<string, string>> {
  const headers = snapshotJsonValue(value) as Readonly<Record<string, unknown>>;
  if (
    !headers ||
    Array.isArray(headers) ||
    typeof headers !== "object" ||
    Object.entries(headers).some(([key, v]) => key !== key.toLowerCase() || typeof v !== "string")
  )
    throw Error();
  const selected = [
    "content-type",
    "content-length",
    "link",
    "etag",
    "location",
    "retry-after",
    "cache-control",
    "www-authenticate",
    "allow",
  ];
  return Object.freeze(
    Object.fromEntries(
      selected.flatMap((name) =>
        headers[name] === undefined ? [] : [[name, headers[name] as string]],
      ),
    ),
  );
}
function responseContext(value: ClientResponse): ReadUpdateHttpContext {
  const { status, url, contentType, retryAfter } = value;
  if (
    !Number.isInteger(status) ||
    status < 200 ||
    status > 599 ||
    typeof url !== "string" ||
    (contentType !== null && typeof contentType !== "string") ||
    (retryAfter !== null && typeof retryAfter !== "string")
  )
    throw Error();
  parseCanonicalHttpUrl(url);
  const headers = selectedHeaders(value.headers);
  if (
    (headers["content-type"] ?? null) !== contentType ||
    (headers["retry-after"] ?? null) !== retryAfter
  )
    throw Error();
  return Object.freeze({
    status,
    url,
    contentType,
    retryAfter,
    headers,
  });
}
function responseFailure(response: ClientResponse): FailureReply | undefined;
function responseFailure<P extends ReadUpdateProblem>(
  response: ClientResponse,
  parseProblem: (value: unknown) => P,
): FailureReply<P> | undefined;
function responseFailure(
  response: ClientResponse,
  parseProblem: (value: unknown) => ReadUpdateProblem = parseReadUpdateProblem,
): FailureReply | undefined {
  const http = responseContext(response);
  if (response.status === 405 || response.status === 406 || response.status === 500) {
    if (response.kind !== "empty") throw Error();
    return Object.freeze({ kind: "http", http });
  }
  if (response.status >= 400) {
    if (response.kind !== "json" || media(response) !== "application/problem+json") throw Error();
    const problem = parseProblem(response.body);
    const status = problem.status;
    if (status !== undefined && status !== response.status) throw Error();
    parseProblem({ ...problem, status: response.status });
    assertPrivateNoStore(http);
    return Object.freeze({ kind: "problem", problem, http });
  }
  return undefined;
}
function success<T>(
  value: T,
  http: ReadUpdateHttpContext,
): { readonly kind: "success"; readonly value: T; readonly http: ReadUpdateHttpContext } {
  return Object.freeze({ kind: "success", value, http });
}

/** RFC 9111 section 5.2 and RFC 9110 section 5.6.4: commas in a
 * quoted-string are value bytes, not additional cache directives. */
const CACHE_DIRECTIVE =
  /^[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t\x20\x21\x23-\x5B\x5D-\x7E\x80-\xFF]|\\[\t\x20-\x7E\x80-\xFF])*"))?$/;

/** Require full unqualified directives, not names inside a quoted argument. */
function assertPrivateNoStore(http: ReadUpdateHttpContext): void {
  const value = http.headers["cache-control"];
  if (value === undefined) throw Error();
  let quoted = false,
    escaped = false,
    start = 0,
    isPrivate = false,
    noStore = false;
  const consume = (end: number) => {
    const directive = value.slice(start, end).replace(/^[ \t]+|[ \t]+$/g, "");
    if (directive === "") return; // HTTP lists tolerate empty members.
    if (!CACHE_DIRECTIVE.test(directive)) throw Error();
    const name = directive.toLowerCase();
    if (name === "private") isPrivate = true;
    if (name === "no-store") noStore = true;
  };
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") {
      consume(index);
      start = index + 1;
    }
  }
  if (quoted || escaped) throw Error();
  consume(value.length);
  if (!isPrivate || !noStore) throw Error();
}

function snapshotReadOptions(value: ReadUpdateClientReadOptions): ReadUpdateClientReadOptions {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error();
  const captured: { signal?: AbortSignal; continuationScope?: BdpContinuationScope } = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "signal" && key !== "continuationScope") throw Error();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw Error();
    if (key === "signal") {
      if (descriptor.value !== undefined && !(descriptor.value instanceof AbortSignal))
        throw Error();
      if (descriptor.value !== undefined) captured.signal = descriptor.value;
    } else if (descriptor.value !== undefined) captured.continuationScope = descriptor.value;
  }
  return Object.freeze(captured);
}
