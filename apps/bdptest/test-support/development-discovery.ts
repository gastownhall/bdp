/** Source-only canonical wire fixture. Never an installed launch/profile option. */
import { parseReadUpdateDiscovery, isReadProblem, type ReadProblem } from "@bdp/protocol";
import type {
  DevelopmentServerOptions,
  DevelopmentHttpComposition,
} from "../../../packages/server/src/development-runtime.js";
import type { LifecycleScheduler } from "../../../packages/server/src/sequence-executor.js";
// Load the actual emitted implementation, like the existing process harness.
const runtime = (await import(
  new URL("../../../packages/server/dist/development-runtime.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-runtime.js");
const routing = (await import(
  new URL("../../../packages/server/dist/read-http-routing.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/read-http-routing.js");

export const canonicalDevelopmentComposition: DevelopmentHttpComposition = Object.freeze({
  scopePath: "/acme/",
  createReadRoute(authority, directory) {
    const { scope } = authority;
    const serviceDescription = new URL("bdp.json", scope).href;
    const operations = new URL("operations/", scope).href;
    function problem(value: ReadProblem) {
      const response = routing.jsonResponse(value);
      response.status = value.status ?? 500;
      response.headers.set("content-type", "application/problem+json");
      return response;
    }
    async function discovery() {
      const result = await authority.discover();
      if (result.kind === "problem") return problem(result.problem);
      const { limits, ...data } = result.data;
      return routing.jsonResponse(
        parseReadUpdateDiscovery({
          ...data,
          bdpVersion: "0",
          profile: "read-update",
          operations,
          limits: {
            page: limits.page,
            selector: limits.selector,
            request: { bodyBytes: authority.limits.requestBodyBytes },
            sequence: { operations: authority.limits.sequenceOperations },
            validation: {
              diagnostics: authority.limits.diagnosticCount,
              diagnosticBytes: authority.limits.diagnosticBytes,
            },
          },
        }),
      );
    }
    const route = routing.createReadHttpRoute({
      scope,
      probe: async () => ({ serviceDescription }),
      problem,
      discover: discovery,
      async alias(suffix, request) {
        if (isReadProblem(suffix)) return problem(suffix);
        const result = await authority.resolveAlias(request.url);
        return result.kind === "problem"
          ? problem(result.problem)
          : {
              status: 307,
              headers: new Headers({
                location: result.target,
                "content-length": "0",
                "cache-control": "private, no-store",
              }),
            };
      },
      async perform(parsed) {
        const result = await authority.perform(parsed);
        return result.kind === "problem"
          ? problem(result.problem)
          : result.kind === "success"
            ? routing.scopeDataResponse(parsed, result.body)
            : problem({
                code: "resource-not-found",
                type: "https://github.com/gastownhall/bdp/problems/resource",
                retry: "never",
                status: 404,
              });
      },
    });
    return async (request) => {
      // Gate every route through the current owner; no pre-auth/static directory escape.
      const gate = await authority.discover();
      if (gate.kind === "problem") return problem(gate.problem);
      if (request.url === operations && (request.method === "GET" || request.method === "HEAD"))
        return routing.jsonResponse(directory);
      return route(request);
    };
  },
});

export function startCanonicalDevelopmentFixture(
  options: DevelopmentServerOptions,
  scheduler?: LifecycleScheduler,
) {
  return runtime.startDevelopmentReferenceRuntime(
    options,
    scheduler,
    undefined,
    canonicalDevelopmentComposition,
  );
}
export const startPrivateRuntime = runtime.startDevelopmentReferenceRuntime;
