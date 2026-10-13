/** Explicitly non-attesting, loopback-only mutable development server. */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import path from "node:path";
import {
  ReadUpdateCarrierError,
  JsonSyntaxError,
  stringifyJsonValue,
  readProblem,
  parseReadUpdateProblem,
  decodeJsonDocument,
  parseCanonicalScope,
  parseReadUpdateOperationDirectory,
  type ReadUpdateOperationDirectory,
  type ReadProblemCode,
  type ReadUpdateOperation,
} from "@bdp/protocol";
import { applyReadHttpSemantics, resourceRevisionEtag, acceptsJson } from "./read-http.js";
import { normalizationSafeRawRequestPath } from "./node-http-target.js";
import type { HttpResponse, HttpHandler } from "./index.js";
import {
  administrativeArray,
  administrativeData,
  assertDevelopmentContracts,
  assertDevelopmentAccessPolicy,
  captureDevelopmentAggregatePolicy,
} from "./development-contracts.js";
import type { DevelopmentAuthorityConfiguration } from "./development-authority.js";
import { DEVELOPMENT_LIMITS, openDevelopmentAuthority } from "./development-authority.js";
import type { LifecycleScheduler } from "./sequence-executor.js";

export interface DevelopmentServerOptions {
  readonly directory: string;
  readonly port: number;
  readonly create: boolean;
  /** Local operator credential. Not carried Resource attribution. */
  readonly token: string;
}
const operations: Readonly<Record<string, ReadUpdateOperation>> = Object.freeze({
  "create-bead": "createBead",
  "update-bead": "updateBead",
  "delete-bead": "deleteBead",
  "create-link": "createLink",
  "update-link": "updateLink",
  "delete-link": "deleteLink",
  "put-alias": "putAlias",
  "delete-alias": "deleteAlias",
});
/** Private value seam; ordinary exported development startup never supplies it.
 * Canonical discovery construction lives solely in source test support.
 */
export interface DevelopmentHttpComposition {
  readonly scopePath: string;
  createReadRoute(
    authority: Pick<
      ReturnType<Awaited<ReturnType<typeof openDevelopmentAuthority>>["forPrincipal"]>,
      "scope" | "limits" | "discover" | "resolveAlias" | "perform"
    >,
    directory: ReadUpdateOperationDirectory,
  ): HttpHandler;
}
/** Private installed-candidate transport; never accepted by the development facade. */
export interface InstalledReferenceTransport {
  readonly scope: string;
  readonly host: string;
  readonly schemas: readonly { readonly uri: string; readonly utf8: string }[];
}
export interface DevelopmentDeployment {
  readonly configuration: DevelopmentAuthorityConfiguration;
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
}
class ReceivingError extends Error {
  constructor(readonly code: ReadProblemCode | "unsupported-media-type") {
    super("development request refused");
  }
}
function header(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length > 1) throw new ReceivingError("malformed-request");
  return values[0];
}
function json(response: ServerResponse, status: number, body: unknown, problem = false): void {
  if (response.destroyed) return;
  const bytes = stringifyJsonValue(body);
  response.writeHead(status, {
    "content-type": problem ? "application/problem+json" : "application/json",
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(bytes),
    "x-bdp-development": "non-attesting",
  });
  response.end(response.req.method === "HEAD" ? undefined : bytes);
}
function refused(response: ServerResponse, code: ReceivingError["code"]): void {
  response.setHeader("connection", "close");
  if (code === "unauthenticated")
    response.setHeader("www-authenticate", 'Bearer realm="bdptest-development"');
  const problem =
    code === "unsupported-media-type"
      ? parseReadUpdateProblem({
          type: "https://github.com/gastownhall/bdp/problems/request",
          code,
          status: 415,
          retry: "never",
        })
      : readProblem(code);
  json(response, problem.status ?? 500, problem, true);
}
function empty(response: ServerResponse, status: number, allow?: string): void {
  if (response.destroyed) return;
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "content-length": "0",
    "x-bdp-development": "non-attesting",
    ...(allow === undefined ? {} : { allow }),
  });
  response.end();
}
function readJson(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  value: unknown,
  revision?: string,
): void {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
    "x-bdp-development": "non-attesting",
  });
  if (revision !== undefined) headers.set("etag", resourceRevisionEtag(revision));
  const incomingHeaders = new Headers();
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    incomingHeaders.append(request.rawHeaders[i] ?? "", request.rawHeaders[i + 1] ?? "");
  const selected: HttpResponse = applyReadHttpSemantics(
    new Request(url, { method: request.method ?? "GET", headers: incomingHeaders }),
    { status: 200, headers, body: value },
  );
  const bytes = selected.body === undefined ? undefined : stringifyJsonValue(selected.body);
  if (bytes !== undefined) selected.headers.set("content-length", String(Buffer.byteLength(bytes)));
  response.writeHead(selected.status, Object.fromEntries(selected.headers));
  response.end(bytes);
}
async function body(request: IncomingMessage): Promise<string> {
  const length = header(request, "content-length");
  if (
    length !== undefined &&
    (!/^\d+$/.test(length) || Number(length) > DEVELOPMENT_LIMITS.requestBodyBytes)
  )
    throw new ReceivingError("request-too-large");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > DEVELOPMENT_LIMITS.requestBodyBytes) throw new ReceivingError("request-too-large");
    chunks.push(chunk);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ReceivingError("malformed-request");
  }
}

export async function startDevelopmentReferenceRuntime(
  options: DevelopmentServerOptions,
  scheduler?: LifecycleScheduler,
  clock?: () => number,
  composition?: DevelopmentHttpComposition,
  deployment?: DevelopmentDeployment,
  installedTransport?: InstalledReferenceTransport,
) {
  if (!path.isAbsolute(options.directory) || typeof options.create !== "boolean")
    throw new TypeError("explicit absolute store directory and provisioning choice required");
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new TypeError("invalid development port");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.token))
    throw new TypeError("development token must have 32-256 base64url characters");
  if (
    composition !== undefined &&
    (composition === null ||
      typeof composition !== "object" ||
      typeof composition.scopePath !== "string" ||
      typeof composition.createReadRoute !== "function")
  )
    throw new TypeError("invalid private HTTP composition");
  const transport =
    installedTransport === undefined
      ? undefined
      : administrativeData(installedTransport, ["scope", "host", "schemas"]);
  if (
    transport !== undefined &&
    (typeof transport.scope !== "string" ||
      parseCanonicalScope(transport.scope) !== transport.scope ||
      typeof transport.host !== "string" ||
      !["127.0.0.1", "::1"].includes(transport.host) ||
      composition === undefined ||
      deployment === undefined)
  )
    throw new TypeError("invalid private installed transport");
  const schemaArtifacts =
    transport === undefined
      ? []
      : administrativeArray(transport.schemas, 4096).map((value) => {
          const entry = administrativeData(value, ["uri", "utf8"]);
          if (
            typeof entry.uri !== "string" ||
            !entry.uri.startsWith(`${transport.scope}schemas/`) ||
            typeof entry.utf8 !== "string"
          )
            throw new TypeError("invalid hosted schema");
          return Object.freeze({
            uri: entry.uri,
            utf8: entry.utf8,
            value: decodeJsonDocument(entry.utf8),
          });
        });
  const scopePath = composition?.scopePath ?? "/";
  const createReadRoute = composition?.createReadRoute;
  if (
    parseCanonicalScope(`http://127.0.0.1${scopePath}`) !== `http://127.0.0.1${scopePath}` ||
    !scopePath.startsWith("/") ||
    scopePath.startsWith("//") ||
    (composition !== undefined && typeof composition.createReadRoute !== "function")
  )
    throw new TypeError("invalid private HTTP composition");
  if (transport !== undefined && new URL(transport.scope as string).pathname !== scopePath)
    throw new TypeError("configured Scope path differs from route composition");
  const directory = parseReadUpdateOperationDirectory({
    ...Object.fromEntries(
      Object.entries(operations).map(([target, operation]) => [operation, target]),
    ),
    sequence: "sequence",
  });
  const configuredDeployment =
    deployment === undefined
      ? undefined
      : administrativeData(deployment, ["configuration", "credentials"]);
  const credentials =
    configuredDeployment === undefined
      ? [
          {
            credential: Buffer.from(`Bearer ${options.token}`),
            principal: "bdptest-development-operator",
          },
        ]
      : administrativeArray(configuredDeployment.credentials, 32).map((value) => {
          const input = administrativeData(value, ["token", "principal"]);
          if (
            typeof input.token !== "string" ||
            !/^[A-Za-z0-9_-]{32,256}$/.test(input.token) ||
            typeof input.principal !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(input.principal)
          )
            throw new TypeError("invalid trusted credential mapping");
          return Object.freeze({
            credential: Buffer.from(`Bearer ${input.token}`),
            principal: input.principal,
          });
        });
  if (
    !credentials.length ||
    new Set(credentials.map((c) => c.credential.toString())).size !== credentials.length
  )
    throw new TypeError("unique trusted credentials required");
  const configuredAuthority =
    configuredDeployment === undefined
      ? undefined
      : (administrativeData(configuredDeployment.configuration, [
          "contracts",
          "access",
          "maximumEndpointMultiplicity",
        ]) as unknown as DevelopmentAuthorityConfiguration);
  if (configuredAuthority !== undefined) {
    assertDevelopmentContracts(configuredAuthority.contracts);
    assertDevelopmentAccessPolicy(configuredAuthority.access);
    for (const { principal } of credentials) configuredAuthority.access.capture(principal);
  }
  const authorityConfiguration =
    configuredAuthority === undefined
      ? undefined
      : Object.freeze({
          contracts: configuredAuthority.contracts,
          access: configuredAuthority.access,
          maximumEndpointMultiplicity: captureDevelopmentAggregatePolicy(
            configuredAuthority.maximumEndpointMultiplicity,
            configuredAuthority.contracts.descriptors,
          ),
        });
  const principalViews = new Map<
    string,
    ReturnType<Awaited<ReturnType<typeof openDevelopmentAuthority>>["forPrincipal"]>
  >();
  const composedReads = new Map<string, HttpHandler>();
  let authority: Awaited<ReturnType<typeof openDevelopmentAuthority>> | undefined;
  let closing = false;
  let serving = false;
  const pending = new Set<Promise<void>>();
  let scope = "";
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (!serving || closing || !authority) throw new ReceivingError("temporarily-unavailable");
      const authorization = Buffer.from(header(request, "authorization") ?? "");
      const authenticated = credentials.find(
        ({ credential }) =>
          authorization.length === credential.length && timingSafeEqual(authorization, credential),
      );
      if (!authenticated) throw new ReceivingError("unauthenticated");
      const principal = Object.freeze({ id: authenticated.principal });
      const principalAuthority = principalViews.get(principal.id);
      if (!principalAuthority) throw new ReceivingError("unauthenticated");
      const composedRead = composedReads.get(principal.id);
      const host = header(request, "host");
      if (
        host === undefined ||
        normalizationSafeRawRequestPath(`http://${host}/`) !== "/" ||
        (transport === undefined && host !== new URL(scope).host)
      )
        throw new ReceivingError("malformed-request");
      const origin = header(request, "origin");
      if (transport === undefined && origin !== undefined) throw new ReceivingError("forbidden");
      const rawUrl = request.url ?? "";
      const pathAndQuery = normalizationSafeRawRequestPath(rawUrl);
      if (
        pathAndQuery === undefined ||
        (transport === undefined && (!rawUrl.startsWith("/") || rawUrl.startsWith("//")))
      )
        throw new ReceivingError("malformed-request");
      // Only configured Scope determines identity, including absolute-form requests.
      const url = new URL(pathAndQuery, new URL(scope).origin);
      const schema = schemaArtifacts.find((entry) => entry.uri === url.href);
      if (schema !== undefined) {
        response.setHeader("x-bdp-development", "non-attesting");
        const gate = await principalAuthority.discover();
        if (gate.kind === "problem") {
          json(response, gate.problem.status ?? 500, gate.problem, true);
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          empty(response, 405, "GET, HEAD");
          return;
        }
        const headers = new Headers();
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          headers.append(request.rawHeaders[i] ?? "", request.rawHeaders[i + 1] ?? "");
        const selected = applyReadHttpSemantics(
          new Request(url, { method: request.method, headers }),
          {
            status: 200,
            headers: new Headers({
              "content-type": "application/json",
              "cache-control": "private, no-store",
            }),
            body: schema.value,
          },
        );
        if (selected.status === 200)
          selected.headers.set("content-length", String(Buffer.byteLength(schema.utf8)));
        response.writeHead(selected.status, Object.fromEntries(selected.headers));
        response.end(
          selected.status === 200 && request.method !== "HEAD" ? schema.utf8 : undefined,
        );
        return;
      }
      const targetRoot = composition === undefined ? "/development/" : `${scopePath}operations/`;
      const name = pathAndQuery.startsWith(targetRoot) ? pathAndQuery.slice(targetRoot.length) : "";
      const operation = Object.hasOwn(operations, name) ? operations[name] : undefined;
      const mutationTarget = operation !== undefined || name === "sequence";
      if (
        pathAndQuery.startsWith(targetRoot) &&
        (composition === undefined || pathAndQuery !== targetRoot) &&
        !mutationTarget
      )
        throw new ReceivingError("resource-not-found");
      if (request.method !== "POST" && mutationTarget) {
        empty(response, 405, "POST");
        return;
      }
      if (composedRead && !mutationTarget) {
        // The trusted receiver's credential, Origin and raw-target gates already ran.
        // No request body, database handle or mutation callback is routed by this seam.
        if (request.method !== "GET" && request.method !== "HEAD") {
          empty(response, 405, "GET, HEAD");
          return;
        }
        const headers = new Headers();
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          headers.append(request.rawHeaders[i] ?? "", request.rawHeaders[i + 1] ?? "");
        const input = new Request(url, { method: request.method, headers });
        const selected = applyReadHttpSemantics(input, await composedRead(input));
        selected.headers.set("x-bdp-development", "non-attesting");
        const bytes = selected.body === undefined ? undefined : stringifyJsonValue(selected.body);
        if (bytes !== undefined)
          selected.headers.set("content-length", String(Buffer.byteLength(bytes)));
        response.writeHead(selected.status, Object.fromEntries(selected.headers));
        response.end(bytes);
        return;
      }
      if (request.method === "GET" || request.method === "HEAD") {
        if (rawUrl === "/") {
          readJson(request, response, url, {
            development: true,
            claimEligible: false,
            scope,
            operations: [...Object.keys(operations), "sequence"].map(
              (name) => `${scope}development/${name}`,
            ),
          });
          return;
        }
        // No service-desc or BDP discovery profile. Reads use the same authority
        // as writes and reuse the qualified Read HTTP projection helpers.
        const result = await principalAuthority.read(url);
        if (result.kind === "problem")
          json(response, result.problem.status ?? 500, result.problem, true);
        else if (result.kind === "success") {
          const resource = result.request.kind === "resource" && result.request.resource !== "type";
          const value = result.body;
          const revision =
            resource &&
            typeof value === "object" &&
            value !== null &&
            "revision" in value &&
            typeof value.revision === "string"
              ? value.revision
              : undefined;
          readJson(request, response, url, value, revision);
        } else if (result.kind === "target") {
          response.writeHead(307, {
            location: result.target,
            "cache-control": "private, no-store",
            "x-bdp-development": "non-attesting",
          });
          response.end();
        } else refused(response, "resource-not-found");
        return;
      }
      if (request.method !== "POST" || !mutationTarget) {
        empty(response, 405, "GET, HEAD");
        return;
      }
      if (
        header(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        throw new ReceivingError("unsupported-media-type");
      if (header(request, "content-encoding") !== undefined)
        throw new ReceivingError("unsupported-media-type");
      const key = header(request, "idempotency-key");
      if (name === "sequence" ? key !== undefined : key === undefined)
        throw new ReceivingError("malformed-request");
      const text = await body(request);
      if (response.destroyed || closing) throw new ReceivingError("temporarily-unavailable");
      // After admission, delivery is only an observer. Disconnect never cancels
      // committed/admitted work; an exact-key retry retrieves its disposition.
      const result =
        operation !== undefined && key !== undefined
          ? await principalAuthority.mutate(
              operation,
              text,
              key,
              acceptsJson(request.headers.accept ?? null),
            )
          : await principalAuthority.sequence(text, acceptsJson(request.headers.accept ?? null));
      if ("kind" in result && result.kind === "not-acceptable") {
        response.setHeader("vary", "Accept");
        empty(response, 406);
        return;
      }
      response.setHeader("vary", "Accept");
      const problem = "code" in result;
      json(response, problem ? (result.status ?? 500) : 200, result, problem);
    } catch (error) {
      if (error instanceof ReceivingError) refused(response, error.code);
      else if (error instanceof ReadUpdateCarrierError || error instanceof JsonSyntaxError)
        refused(response, "malformed-request");
      else empty(response, 500);
    }
  };
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    const task = handle(request, response);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  if (transport !== undefined)
    server.on("connect", (_request, socket) => {
      socket.on("error", () => undefined);
      socket.end(
        "HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\nContent-Length: 0\r\nX-Bdp-Development: non-attesting\r\nConnection: close\r\n\r\n",
        () => socket.destroy(),
      );
    });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.on("timeout", (socket) => socket.destroy());
  const closeListener = () =>
    new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, (transport?.host as string | undefined) ?? "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no development address");
    scope =
      transport === undefined
        ? `http://127.0.0.1:${address.port}${scopePath}`
        : (transport.scope as string);
    authority = await openDevelopmentAuthority({
      scope,
      directory: options.directory,
      create: options.create,
      ...(scheduler === undefined ? {} : { scheduler }),
      ...(clock === undefined ? {} : { clock }),
      ...(authorityConfiguration === undefined ? {} : { configuration: authorityConfiguration }),
    });
    for (const { principal } of credentials) {
      if (principalViews.has(principal)) continue;
      const view = authority.forPrincipal(Object.freeze({ id: principal }));
      // Validate the configured principal against the actual authority before serving.
      if ((await view.discover()).kind !== "discovery")
        throw new Error("configured principal Read refused");
      principalViews.set(principal, view);
      if (createReadRoute !== undefined) {
        const route = createReadRoute(
          Object.freeze({
            scope: view.scope,
            limits: view.limits,
            discover: view.discover,
            resolveAlias: view.resolveAlias,
            perform: view.perform,
          }),
          directory,
        );
        if (typeof route !== "function") throw new TypeError("invalid private Read route");
        composedReads.set(principal, route);
      }
    }
    serving = true;
  } catch (error) {
    const cleanup = await Promise.allSettled([
      ...(server.listening ? [closeListener()] : []),
      ...(authority === undefined ? [] : [authority.close()]),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length)
      throw new AggregateError([error, ...failures], "installed startup cleanup failed", {
        cause: error,
      });
    throw error;
  }
  let completion: Promise<void> | undefined;
  // The owner has a terminal close result. Retry listener cleanup only; never
  // re-invoke owner close or erase its original failure.
  let ownerCompletion: Promise<void> | undefined;
  return Object.freeze({
    scope,
    close(): Promise<void> {
      if (!completion) {
        closing = true;
        serving = false;
        completion = (async () => {
          const listener = await Promise.allSettled([closeListener()]);
          await Promise.allSettled([...pending]);
          ownerCompletion ??= Promise.resolve().then(() => authority?.close());
          const owner = await Promise.allSettled([ownerCompletion]);
          const failures = [...listener, ...owner].flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length)
            throw new AggregateError(failures, "installed shutdown cleanup failed");
        })().catch((error) => {
          completion = undefined;
          throw error;
        });
      }
      return completion;
    },
  });
}
