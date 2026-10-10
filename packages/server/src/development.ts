/** Explicitly non-attesting, loopback-only mutable development server. */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import path from "node:path";
import {
  ReadUpdateCarrierError,
  JsonSyntaxError,
  stringifyJsonValue,
  type ReadUpdateOperation,
} from "@bdp/protocol";
import { DEVELOPMENT_LIMITS, openDevelopmentAuthority } from "./development-authority.js";
export { DEVELOPMENT_BEAD_TYPE, DEVELOPMENT_LINK_TYPE } from "./development-authority.js";

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
});
class ReceivingError extends Error {
  constructor(readonly status: number) {
    super("development request refused");
  }
}
function header(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length > 1) throw new ReceivingError(400);
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
  response.end(bytes);
}
function refused(response: ServerResponse, status: number): void {
  // Receiving failures deliberately have no BDP Problem claim yet. The response
  // remains RFC9457; the bounded adapter is not a cumulative profile receiver.
  response.setHeader("connection", "close");
  if (status === 401) response.setHeader("www-authenticate", 'Bearer realm="bdptest-development"');
  json(
    response,
    status,
    { type: "about:blank", status, title: "Development request refused" },
    true,
  );
}
async function body(request: IncomingMessage): Promise<string> {
  const length = header(request, "content-length");
  if (
    length !== undefined &&
    (!/^\d+$/.test(length) || Number(length) > DEVELOPMENT_LIMITS.requestBodyBytes)
  )
    throw new ReceivingError(413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > DEVELOPMENT_LIMITS.requestBodyBytes) throw new ReceivingError(413);
    chunks.push(chunk);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ReceivingError(400);
  }
}

export async function startDevelopmentReferenceServer(options: DevelopmentServerOptions) {
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
      if (closing || !authority) throw new ReceivingError(503);
      const authorization = Buffer.from(header(request, "authorization") ?? "");
      if (authorization.length !== credential.length || !timingSafeEqual(authorization, credential))
        throw new ReceivingError(401);
      if (header(request, "host") !== new URL(scope).host) throw new ReceivingError(400);
      if (header(request, "origin") !== undefined) throw new ReceivingError(403);
      const rawUrl = request.url ?? "";
      if (!rawUrl.startsWith("/") || rawUrl.startsWith("//")) throw new ReceivingError(400);
      const url = new URL(rawUrl, scope);
      if (url.origin !== new URL(scope).origin) throw new ReceivingError(400);
      if (request.method === "GET") {
        if (rawUrl === "/") {
          json(response, 200, {
            development: true,
            claimEligible: false,
            scope,
            operations: Object.keys(operations).map((name) => `${scope}development/${name}`),
          });
          return;
        }
        // No service-desc or BDP discovery profile. Reads use the same authority
        // as writes; full HTTP conditional/HEAD negotiation is a later gate.
        const result = await authority.read(url);
        if (result.kind === "problem")
          json(response, result.problem.status ?? 500, result.problem, true);
        else if (result.kind === "success") json(response, 200, result.body);
        else refused(response, 404);
        return;
      }
      if (request.method !== "POST") throw new ReceivingError(405);
      const name = rawUrl.startsWith("/development/") ? rawUrl.slice(13) : "";
      const operation = Object.hasOwn(operations, name) ? operations[name] : undefined;
      if (!operation) throw new ReceivingError(404);
      if (header(request, "content-type")?.toLowerCase() !== "application/json")
        throw new ReceivingError(415);
      if (header(request, "content-encoding") !== undefined) throw new ReceivingError(415);
      const key = header(request, "idempotency-key");
      if (key === undefined) throw new ReceivingError(400);
      const text = await body(request);
      if (response.destroyed || closing) throw new ReceivingError(503);
      // After admission, delivery is only an observer. Disconnect never cancels
      // committed/admitted work; an exact-key retry retrieves its disposition.
      const result = await authority.mutate(operation, text, key);
      const problem = "code" in result;
      json(response, problem ? (result.status ?? 500) : 200, result, problem);
    } catch (error) {
      if (error instanceof ReceivingError) refused(response, error.status);
      else if (error instanceof ReadUpdateCarrierError || error instanceof JsonSyntaxError)
        refused(response, 400);
      else refused(response, 500);
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
