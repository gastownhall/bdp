/** Internal Read HTTP projection shared by admitted and source-only test compositions. */
import {
  isReadProblem,
  type AbsoluteHttpUrl,
  type ReadProblem,
  type ReadRequest,
} from "@bdp/protocol";
import type { HttpHandler, HttpResponse } from "./index.js";
import { classifyAliasPath, notFound, requestFromUrl } from "./read-request.js";
import { resourceRevisionEtag } from "./read-http.js";

interface ReadHttpRoutes {
  readonly scope: AbsoluteHttpUrl;
  probe(request: Request): Promise<{ readonly serviceDescription: string }>;
  problem(problem: ReadProblem): HttpResponse;
  discover(request: Request): Promise<HttpResponse>;
  alias(path: string | ReadProblem, request: Request): Promise<HttpResponse>;
  perform(parsed: ReadRequest, request: Request): Promise<HttpResponse>;
}
/** Raw projection only; the caller applies Read HTTP semantics exactly once. */
export function createReadHttpRoute(routes: ReadHttpRoutes): HttpHandler {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return { status: 405, headers: new Headers({ allow: "GET, HEAD", "content-length": "0" }) };
    const url = new URL(request.url);
    const scopeUrl = new URL(routes.scope);
    if (url.origin !== scopeUrl.origin) return routes.problem(notFound());
    const probe = await routes.probe(request);
    const aliasPath = classifyAliasPath(url, routes.scope);
    if (aliasPath !== undefined) return routes.alias(aliasPath, request);
    if (url.pathname === scopeUrl.pathname)
      return {
        status: 204,
        headers: new Headers({
          link: `<${probe.serviceDescription}>; rel="service-desc"; type="application/json"`,
        }),
      };
    if (url.href === probe.serviceDescription) return routes.discover(request);
    const parsed = requestFromUrl(url, routes.scope);
    return isReadProblem(parsed) ? routes.problem(parsed) : routes.perform(parsed, request);
  };
}

export function jsonResponse(body: unknown): HttpResponse {
  return {
    status: 200,
    headers: new Headers({
      "content-type": "application/json",
      "cache-control": "private, no-store",
    }),
    body,
  };
}

export function scopeDataResponse(
  operation: ReadRequest,
  body: unknown,
  observedResourceRevision?: string,
): HttpResponse {
  const response = jsonResponse(body);
  // Properties carry no revision in their body. Owner-backed adapters can supply
  // the revision captured atomically with that value, never a later fresh read.
  if (operation.kind === "properties" && observedResourceRevision !== undefined)
    response.headers.set("etag", resourceRevisionEtag(observedResourceRevision));
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
