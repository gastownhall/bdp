/** Private cumulative Read+Update composition; not a public profile admission. */
import {
  parseReadUpdateDiscovery,
  isReadProblem,
  readProblem,
  type ReadProblem,
} from "@bdp/protocol";
import * as routing from "./read-http-routing.js";
import type { DevelopmentHttpComposition } from "./development-runtime.js";

export function createDevelopmentComposition(scopePath: string): DevelopmentHttpComposition {
  return Object.freeze<DevelopmentHttpComposition>({
    scopePath,
    createReadRoute(authority, directory) {
      const { scope } = authority;
      const serviceDescription = new URL("bdp.json", scope).href;
      const operations = new URL("operations/", scope).href;
      function problem(value: ReadProblem) {
        const response = routing.jsonResponse(value);
        response.headers.set("content-type", "application/problem+json");
        return { ...response, status: value.status ?? 500 };
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
              ? routing.scopeDataResponse(
                  parsed,
                  result.body,
                  "resourceRevision" in result.observation
                    ? result.observation.resourceRevision
                    : undefined,
                )
              : problem(readProblem("resource-not-found"));
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
}
