import {
  type BeadRecord,
  type LinkRecord,
  type Reference,
  type ReadUpdateAliasResult,
  type ReadUpdateDiscovery,
  type ReadUpdateMutationResult,
  type ReadUpdateOperation,
  type ReadUpdateOperationDirectory,
  type ReadUpdateProblem,
  type ReadUpdateSequenceResponse,
  type UnadmittedReadUpdateOperation,
  parseCanonicalHttpUrl,
  isHttpScopeCandidate,
  parseCanonicalScope,
  parseLinkHeader,
  parseReadUpdateAliasResult,
  parseReadUpdateDiscovery,
  parseReadUpdateMutationResult,
  parseReadUpdateOperationDirectory,
  parseReadUpdateProblem,
  parseReadUpdateSequenceResponse,
  prepareReadUpdateSingleton,
  prepareReadUpdateSequence,
  referenceUri,
  resolveCanonicalLocalResourceId,
  snapshotJsonValue,
} from "@bdp/protocol";
import {
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
export interface ReadUpdateClientMutationOptions extends ReadUpdateClientCallOptions {
  readonly idempotencyKey: string;
}
export type ReadUpdateClientReply<T> =
  | { readonly kind: "success"; readonly value: T; readonly http: ReadUpdateHttpContext }
  | {
      readonly kind: "problem";
      readonly problem: ReadUpdateProblem;
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
  ) {
    super(`Read+Update client ${code} (${submission})`);
  }
}
interface Call {
  readonly signal: AbortSignal;
  check(): void;
  failure(code: ReadUpdateClientErrorCode, http?: ReadUpdateHttpContext): ReadUpdateClientError;
  exchange(
    action: () => Promise<ReadUpdateScopeProbeResponse>,
    url: string,
    mutation?: boolean,
  ): Promise<ReadUpdateScopeProbeResponse>;
}
type FailureReply = Exclude<ReadUpdateClientReply<never>, { readonly kind: "success" }>;

/** Read+Update operations only. No profile-specific Read session, alias lookup,
 * semantic identity, credential policy or authority admission is implemented here.
 * Injected transports must be confined to the same configured Scope.
 */
export class BdpReadUpdateClient {
  readonly scope: string;
  private readonly transport: ReadUpdateTransport;
  private readonly timeoutMs: number;
  private readonly active = new Set<AbortController>();
  private closed = false;

  constructor(options: ReadUpdateClientOptions) {
    try {
      this.scope = parseCanonicalScope(options.scope);
      this.timeoutMs = options.settlementTimeoutMs;
      const transport = options.transport;
      this.transport = Object.freeze({
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
        const value =
          operation === "putAlias" || operation === "deleteAlias"
            ? parseReadUpdateAliasResult(received.body)
            : parseReadUpdateMutationResult(received.body);
        const operationInput = prepared.operations[0];
        if (!operationInput) throw call.failure("invalid-input");
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
          media(received) !== "application/json" ||
          http.headers.etag !== undefined ||
          http.headers.location !== undefined
        )
          throw call.failure("invalid-response", http);
        const value = parseReadUpdateSequenceResponse(received.body, {
          operations: prepared.operations,
        });
        const bindings = new Map<string, string>();
        const transientCreators = new Set<string>();
        for (const [index, entry] of value.results.entries()) {
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
    for (const controller of this.active) controller.abort();
    return Promise.resolve();
  }

  private run<T>(
    options: ReadUpdateClientCallOptions,
    action: (call: Call) => Promise<T>,
    startedAt = performance.now(),
  ): Promise<T> {
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
    const failure = (code: ReadUpdateClientErrorCode, http = latest) => {
      const error = new ReadUpdateClientError(
        code,
        submitted ? "unknown" : "not-submitted",
        http?.status,
        http?.contentType,
        http?.retryAfter,
        http?.headers,
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
      exchange: async (send, url, mutation = false) => {
        check();
        latest = undefined; // Earlier navigation metadata is not this exchange's response.
        if (mutation) submitted = true;
        let received: ReadUpdateScopeProbeResponse;
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
    return new Promise<T>((resolve, reject) => {
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
              resolve(value);
            } catch (cause) {
              reject(cause);
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

  private async loadDiscovery(call: Call): Promise<ReadUpdateClientReply<ReadUpdateDiscovery>> {
    const probe = await call.exchange(
      () => this.transport.probeScope({ signal: call.signal }),
      this.scope,
    );
    const fault = responseFailure(probe);
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
    const problem = responseFailure(received);
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
function responseContext(value: ReadUpdateScopeProbeResponse): ReadUpdateHttpContext {
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
function responseFailure(response: ReadUpdateScopeProbeResponse): FailureReply | undefined {
  const http = responseContext(response);
  if (response.status === 406 || response.status === 500) {
    if (response.kind !== "empty") throw Error();
    return Object.freeze({ kind: "http", http });
  }
  if (response.status >= 400) {
    if (response.kind !== "json" || media(response) !== "application/problem+json") throw Error();
    const problem = parseReadUpdateProblem(response.body);
    if (problem.status !== undefined && problem.status !== response.status) throw Error();
    parseReadUpdateProblem({ ...problem, status: response.status });
    const cache =
      http.headers["cache-control"]?.split(",").map((v) => v.trim().toLowerCase()) ?? [];
    if (!cache.includes("private") || !cache.includes("no-store")) throw Error();
    return Object.freeze({ kind: "problem", problem, http });
  }
  return undefined;
}
function success<T>(value: T, http: ReadUpdateHttpContext): ReadUpdateClientReply<T> {
  return Object.freeze({ kind: "success", value, http });
}
