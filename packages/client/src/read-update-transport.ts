import { parseCanonicalHttpUrl, parseCanonicalScope } from "@bdp/protocol";
import {
  createBoundedFetchTransport,
  BoundedHttpTransportError,
  type BoundedHttpLimits,
  type BoundedHttpErrorCode,
  type BoundedHttpContext,
  type BoundedHttpResponse,
  type BoundedScopeProbeResponse,
  type BoundedAliasResponse,
} from "./bounded-http-transport.js";

export type ReadUpdateTransportLimits = BoundedHttpLimits;
export interface ReadUpdateTransportCallOptions {
  readonly signal?: AbortSignal;
}
export interface ReadUpdateTransportPostOptions extends ReadUpdateTransportCallOptions {
  readonly bodyText: string;
  readonly idempotencyKey?: string;
}
export type ReadUpdateTransportErrorCode = BoundedHttpErrorCode;
export type ReadUpdateHttpContext = BoundedHttpContext;
export type ReadUpdateHttpResponse = BoundedHttpResponse;
export type ReadUpdateScopeProbeResponse = BoundedScopeProbeResponse;
export type ReadUpdateAliasResponse = BoundedAliasResponse;
export interface ReadUpdateFetchTransportOptions {
  readonly scope: string;
  readonly limits: ReadUpdateTransportLimits;
  readonly fetchImplementation?: typeof fetch;
  readonly credential?: (signal: AbortSignal) => string | undefined | Promise<string | undefined>;
}
export class ReadUpdateTransportError extends BoundedHttpTransportError {
  override readonly name = "ReadUpdateTransportError";
  constructor(...args: ConstructorParameters<typeof BoundedHttpTransportError>) {
    super(...args);
    this.message = `Read+Update transport ${this.code} (${this.submission})`;
  }
}
export interface ReadUpdateTransport {
  probeScope(options?: ReadUpdateTransportCallOptions): Promise<ReadUpdateScopeProbeResponse>;
  get(url: string, options?: ReadUpdateTransportCallOptions): Promise<ReadUpdateHttpResponse>;
  post(url: string, options: ReadUpdateTransportPostOptions): Promise<ReadUpdateHttpResponse>;
  resolveAlias?(
    url: string,
    options?: ReadUpdateTransportCallOptions,
  ): Promise<ReadUpdateAliasResponse>;
}

/** The legacy binding keeps generic JSON, confined targets and its public errors.
 * Shared IO below does not upgrade this adapter to the retained contract.
 */
export function createReadUpdateFetchTransport(
  options: ReadUpdateFetchTransportOptions,
): ReadUpdateTransport {
  let scope: string;
  let credential: ReadUpdateFetchTransportOptions["credential"];
  let limits: ReadUpdateTransportLimits;
  let fetchImplementation: typeof fetch | undefined;
  try {
    scope = parseCanonicalScope(options.scope);
    credential = options.credential;
    limits = options.limits;
    fetchImplementation = options.fetchImplementation;
    if (credential !== undefined && typeof credential !== "function") throw new TypeError();
  } catch {
    throw new ReadUpdateTransportError("invalid-input", "not-submitted");
  }
  const base = new URL(scope);
  const transport = createBoundedFetchTransport({
    limits,
    ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
    mediaType: "application/json",
    validateTarget: (value) => {
      const parsed = new URL(parseCanonicalHttpUrl(value));
      if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname))
        throw new TypeError();
    },
    ...(credential === undefined
      ? {}
      : { credentialForTarget: (_url: string, signal: AbortSignal) => credential(signal) }),
    makeError: (...args) => new ReadUpdateTransportError(...args),
  });
  return Object.freeze({
    probeScope: (call: ReadUpdateTransportCallOptions = {}) => transport.probeScope(scope, call),
    get: transport.get,
    post: transport.post,
    resolveAlias: transport.resolveAlias,
  });
}
