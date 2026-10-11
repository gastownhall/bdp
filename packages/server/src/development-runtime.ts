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
  type ReadProblemCode,
  type ReadUpdateOperation,
} from "@bdp/protocol";
import { applyReadHttpSemantics, resourceRevisionEtag, acceptsJson } from "./read-http.js";
import { normalizationSafeRawRequestPath } from "./node-http-target.js";
import type { HttpResponse } from "./index.js";
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
) {
  if (!path.isAbsolute(options.directory) || typeof options.create !== "boolean")
    throw new TypeError("explicit absolute store directory and provisioning choice required");
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new TypeError("invalid development port");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.token))
    throw new TypeError("development token must have 32-256 base64url characters");
  const credential = Buffer.from(`Bearer ${options.token}`);
  let authority: Awaited<ReturnType<typeof openDevelopmentAuthority>> | undefined;
  let closing = false;
  const pending = new Set<Promise<void>>();
  let scope = "";
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (closing || !authority) throw new ReceivingError("temporarily-unavailable");
      const authorization = Buffer.from(header(request, "authorization") ?? "");
      if (authorization.length !== credential.length || !timingSafeEqual(authorization, credential))
        throw new ReceivingError("unauthenticated");
      if (header(request, "host") !== new URL(scope).host)
        throw new ReceivingError("malformed-request");
      if (header(request, "origin") !== undefined) throw new ReceivingError("forbidden");
      const rawUrl = request.url ?? "";
      if (
        !rawUrl.startsWith("/") ||
        rawUrl.startsWith("//") ||
        normalizationSafeRawRequestPath(rawUrl) === undefined
      )
        throw new ReceivingError("malformed-request");
      const url = new URL(rawUrl, scope);
      if (url.origin !== new URL(scope).origin) throw new ReceivingError("malformed-request");
      const name = rawUrl.startsWith("/development/") ? rawUrl.slice(13) : "";
      const operation = Object.hasOwn(operations, name) ? operations[name] : undefined;
      const mutationTarget = operation !== undefined || name === "sequence";
      if (rawUrl.startsWith("/development/") && !mutationTarget)
        throw new ReceivingError("resource-not-found");
      if (request.method !== "POST" && mutationTarget) {
        empty(response, 405, "POST");
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
        const result = await authority.read(url);
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
          ? await authority.mutate(
              operation,
              text,
              key,
              acceptsJson(request.headers.accept ?? null),
            )
          : await authority.sequence(text, acceptsJson(request.headers.accept ?? null));
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
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.on("timeout", (socket) => socket.destroy());
  const closeListener = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no development address");
    scope = `http://127.0.0.1:${address.port}/`;
    authority = await openDevelopmentAuthority({
      scope,
      directory: options.directory,
      create: options.create,
      ...(scheduler === undefined ? {} : { scheduler }),
    });
  } catch (error) {
    if (server.listening) await closeListener();
    throw error;
  }
  let completion: Promise<void> | undefined;
  return Object.freeze({
    scope,
    close(): Promise<void> {
      if (!completion) {
        closing = true;
        completion = (async () => {
          await closeListener();
          await Promise.allSettled([...pending]);
          await authority?.close();
        })();
      }
      return completion;
    },
  });
}
