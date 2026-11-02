import { parseCanonicalScope, RETAINED_V01_MEDIA_TYPE } from "@bdp/protocol";
import {
  createBoundedFetchTransport,
  BoundedHttpTransportError,
  type BoundedAbortSettlement,
  type BoundedFetchOptions,
  type BoundedHttpCallOptions,
  type BoundedHttpContext,
  type BoundedHttpLimits,
  type BoundedHttpResponse,
  type BoundedHttpTransport,
} from "./bounded-http-transport.js";

export type RetainedAbortSettlement = BoundedAbortSettlement;
export type RetainedTransportLimits = BoundedHttpLimits;
export type RetainedTransportCallOptions = BoundedHttpCallOptions;
export type RetainedHttpContext = BoundedHttpContext;
export type RetainedHttpResponse = BoundedHttpResponse;
export type RetainedTransport = BoundedHttpTransport;
export class RetainedTransportError extends BoundedHttpTransportError {
  override readonly name = "RetainedTransportError";
}
export interface RetainedFetchTransportOptions {
  readonly limits: RetainedTransportLimits;
  readonly fetchImplementation?: typeof fetch;
  /** Explicit network policy for every actual target, including discovery.
   * Advertised navigation and owning Scope do not grant network access.
   */
  readonly allowTarget: (url: string) => boolean;
  /** Per-attempt authorization for this exact target. Nothing is forwarded
   * from the preceding request or inferred from a discovered URL.
   */
  readonly credentialForTarget?: BoundedFetchOptions["credentialForTarget"];
}

export function createRetainedFetchTransport(
  options: RetainedFetchTransportOptions,
): RetainedTransport {
  const { allowTarget, limits, fetchImplementation, credentialForTarget } = options;
  if (typeof allowTarget !== "function")
    throw new RetainedTransportError("invalid-input", "not-submitted");
  const transport = createBoundedFetchTransport({
    limits,
    ...(fetchImplementation === undefined ? {} : { fetchImplementation }),
    ...(credentialForTarget === undefined ? {} : { credentialForTarget }),
    mediaType: RETAINED_V01_MEDIA_TYPE,
    captureNativeBody: true,
    validateEmptyMedia: true,
    allowConditionals: true,
    responseHeaderNames: [
      "content-type",
      "content-length",
      "link",
      "etag",
      "last-modified",
      "location",
      "retry-after",
      "cache-control",
      "www-authenticate",
      "allow",
      "bdp-resource-kind",
      "bdp-collection-kind",
    ],
    validateTarget: (url) => {
      if (allowTarget(url) !== true) throw new TypeError();
    },
    makeError: (...args) => new RetainedTransportError(...args),
  });
  return Object.freeze({
    ...transport,
    probeScope: async (url: string, call: RetainedTransportCallOptions = {}) => {
      let scope: string;
      try {
        scope = parseCanonicalScope(url);
      } catch {
        throw new RetainedTransportError("invalid-input", "not-submitted");
      }
      return transport.probeScope(scope, call);
    },
  });
}
