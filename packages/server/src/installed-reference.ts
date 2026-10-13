/** Exact installed candidate factory. Public startup may call this only behind
 * independently verified profile evidence; P1a provides no such admission. */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  parseReadUpdateDiscovery,
  isReadProblem,
  readProblem,
  type ReadProblem,
} from "@bdp/protocol";
import * as routing from "./read-http-routing.js";
import {
  startDevelopmentReferenceRuntime,
  type DevelopmentHttpComposition,
} from "./development-runtime.js";
import { captureInstalledReferenceConfiguration } from "./installed-reference-configuration.js";

export async function startInstalledReferenceCandidate(input: unknown) {
  const config = captureInstalledReferenceConfiguration(input);
  // Bind actual installed executable bytes, independently of caller assertions.
  const payload = createHash("sha256");
  for (const [name, root] of [
    ["server", new URL("./", import.meta.url)],
    ["protocol", new URL("./", import.meta.resolve("@bdp/protocol"))],
  ] as const) {
    for (const file of (await readdir(root)).filter((f) => f.endsWith(".js")).sort()) {
      const bytes = await readFile(new URL(file, root));
      payload.update(`${name}/${file}:${bytes.length}:`).update(bytes);
    }
  }
  const payloadIdentity = payload.digest("hex");
  const composition: DevelopmentHttpComposition = Object.freeze<DevelopmentHttpComposition>({
    scopePath: new URL(config.scope).pathname,
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
  const first = config.credentials[0];
  if (first === undefined) throw new TypeError("credential required");
  const runtime = await startDevelopmentReferenceRuntime(
    { directory: config.directory, port: config.port, create: config.create, token: first.token },
    undefined,
    undefined,
    composition,
    { configuration: config.configuration, credentials: config.credentials },
    { scope: config.scope, host: config.host, schemas: config.schemas },
  );
  return Object.freeze({
    ...runtime,
    configurationIdentity: config.identity,
    artifactIdentity: config.artifactIdentity,
    payloadIdentity,
    claimEligible: false as const,
  });
}
