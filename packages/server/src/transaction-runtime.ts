/** Source-private loopback fixture. Never selected by installed config/profile
 * admission. It exposes actual routes, not an incomplete BDP discovery claim. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { TextDecoder } from "node:util";
import { stringifyJsonValue, type TypeDescriptor } from "@bdp/protocol";
import type { HttpResponse } from "./index.js";
import { normalizationSafeRawRequestPath } from "./node-http-target.js";
import { openTransactionStore } from "./transaction-store.js";
import { TRANSACTION_RUNTIME_LIMITS } from "./transaction-batch.js";
import { createTransactionService, type TransactionServiceOptions } from "./transaction-service.js";
import {
  createTransactionHttpHandler,
  transactionHttpProblem,
  TRANSACTION_HTTP_TARGET_BYTES,
  type TransactionHttpAuthorization,
  type TransactionReceivedBody,
} from "./transaction-http.js";

export interface TransactionRuntimeOptions {
  readonly directory: string;
  readonly create: boolean;
  readonly port: number;
  readonly types: readonly TypeDescriptor[];
  readonly credentials: readonly {
    readonly token: string;
    readonly principal: string;
    readonly canMutate: boolean;
  }[];
}
export interface TransactionRuntimeTestSeams {
  readonly scheduler?: TransactionServiceOptions["scheduler"];
  readonly clock?: () => number;
  readonly maximumOperations?: number;
}
async function receive(request: IncomingMessage): Promise<TransactionReceivedBody> {
  const length = request.headers["content-length"];
  if (
    length !== undefined &&
    (!/^\d+$/.test(length) || Number(length) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
  )
    return { failure: "request-too-large" };
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
      return { failure: "request-too-large" };
    chunks.push(chunk);
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) };
  } catch {
    return { failure: "malformed-request" };
  }
}
function deliver(response: ServerResponse, selected: HttpResponse): void {
  if (response.destroyed) return;
  const bytes = selected.body === undefined ? undefined : stringifyJsonValue(selected.body);
  selected.headers.set("x-bdp-development", "non-attesting");
  if (bytes !== undefined) selected.headers.set("content-length", String(Buffer.byteLength(bytes)));
  response.writeHead(selected.status, Object.fromEntries(selected.headers));
  response.end(response.req.method === "HEAD" ? undefined : bytes);
}
export async function startTransactionRuntime(
  options: TransactionRuntimeOptions,
  seams: TransactionRuntimeTestSeams = {},
) {
  if (!path.isAbsolute(options.directory) || typeof options.create !== "boolean")
    throw new TypeError("explicit absolute store directory/provisioning required");
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new TypeError("invalid private transaction port");
  const credentials = options.credentials.map(({ token, principal, canMutate }) => {
    if (
      !/^[A-Za-z0-9_-]{32,256}$/.test(token) ||
      typeof principal !== "string" ||
      !principal ||
      !principal.isWellFormed() ||
      typeof canMutate !== "boolean"
    )
      throw new TypeError("invalid private transaction credential");
    return Object.freeze({ credential: Buffer.from(`Bearer ${token}`), principal, canMutate });
  });
  if (
    !credentials.length ||
    new Set(credentials.map(({ credential }) => credential.toString())).size !== credentials.length
  )
    throw new TypeError("unique private transaction credentials required");
  let service: ReturnType<typeof createTransactionService> | undefined;
  let handler: ReturnType<typeof createTransactionHttpHandler> | undefined;
  let scope = "",
    closing = false;
  const pending = new Set<Promise<void>>();
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (closing || !handler) {
        deliver(response, transactionHttpProblem("temporarily-unavailable"));
        return;
      }
      const raw = request.url ?? "";
      if (Buffer.byteLength(raw) > TRANSACTION_HTTP_TARGET_BYTES) {
        deliver(response, transactionHttpProblem("request-too-large"));
        return;
      }
      if (
        normalizationSafeRawRequestPath(raw) === undefined ||
        !raw.startsWith("/") ||
        raw.startsWith("//") ||
        request.headers.host !== new URL(scope).host
      ) {
        deliver(response, transactionHttpProblem("malformed-request"));
        return;
      }
      const headers = new Headers();
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        headers.append(request.rawHeaders[i] ?? "", request.rawHeaders[i + 1] ?? "");
      const supplied = Buffer.from(headers.get("authorization") ?? "");
      const credential = credentials.find(
        (entry) =>
          entry.credential.length === supplied.length &&
          timingSafeEqual(entry.credential, supplied),
      );
      const authorization: TransactionHttpAuthorization =
        credential === undefined
          ? { kind: "unauthenticated" }
          : {
              kind: "authenticated",
              principal: credential.principal,
              canMutate: credential.canMutate,
            };
      const input = new Request(new URL(raw, scope), { method: request.method ?? "GET", headers });
      const body = request.method === "POST" ? await receive(request) : { text: "" };
      if (closing || response.destroyed) {
        deliver(response, transactionHttpProblem("temporarily-unavailable"));
        return;
      }
      // This fixture has no CORS policy. Origin is a transport refusal, not a
      // mutation permission synthesized from carried provenance.
      if (headers.has("origin")) {
        deliver(response, transactionHttpProblem("forbidden"));
        return;
      }
      if ("failure" in body) response.setHeader("connection", "close");
      await handler
        .handle(input, authorization, body)
        .then((selected) => deliver(response, selected));
    } catch {
      if (!response.destroyed) {
        response.writeHead(500, {
          "content-length": "0",
          "cache-control": "private, no-store",
          "x-bdp-development": "non-attesting",
        });
        response.end();
      }
    }
  };
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    const task = handle(request, response);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 10000;
  server.keepAliveTimeout = 1000;
  server.on("timeout", (socket) => socket.destroy());
  const closeListener = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  let owner: ReturnType<typeof openTransactionStore> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing private transaction address");
    scope = `http://127.0.0.1:${address.port}/acme/`;
    owner = openTransactionStore({
      file: path.join(options.directory, "transaction.sqlite"),
      scope,
      create: options.create,
      types: options.types,
      ...(seams.clock ? { clock: seams.clock } : {}),
    });
    const clock = seams.clock ?? Date.now;
    service = createTransactionService(owner, {
      ownerLifetime: "service",
      ...(seams.scheduler ? { scheduler: seams.scheduler } : {}),
      read: {
        selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
        advertisedLimits: {
          page: { defaultItems: 2, maximumItems: 32 },
          selector: { bytes: 4096, depth: 32, nodes: 256 },
          cursorTtlMilliseconds: 1000,
        },
        pagination: {
          scope,
          defaultPageItems: 2,
          maxPageItems: 32,
          cursorTtlMs: 1000,
          retainedStateCapacity: 100,
          maxRetainedCursorPositionsPerSnapshot: 20,
          retainedSnapshotByteCapacity: 1048576,
          retainedSnapshotNodeCapacity: 100000,
          maxOpaqueTokenLength: 64,
          tokenGenerationAttempts: 3,
          idleCleanup: "on-demand",
          clock,
          generateOpaqueToken: () => randomBytes(24).toString("base64url"),
        },
      },
    });
    handler = createTransactionHttpHandler(service, scope, seams.maximumOperations);
  } catch (error) {
    const failures: unknown[] = [error];
    if (server.listening)
      try {
        await closeListener();
      } catch (failure) {
        failures.push(failure);
      }
    try {
      if (service) await service.close();
      else owner?.close();
    } catch (failure) {
      failures.push(failure);
    }
    throw failures.length === 1
      ? error
      : new AggregateError(failures, "transaction runtime startup cleanup failed");
  }
  let completion: Promise<void> | undefined;
  return Object.freeze({
    scope,
    /** Test-only inventory, not an HTTP Operation Directory. */ targets: handler.targets,
    close(): Promise<void> {
      if (!completion) {
        closing = true;
        completion = (async () => {
          const failures: unknown[] = [];
          try {
            await closeListener();
          } catch (error) {
            failures.push(error);
          }
          await Promise.allSettled([...pending]);
          try {
            await service?.close();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length)
            throw new AggregateError(failures, "transaction runtime shutdown failed");
        })();
        void completion.catch(() => {});
      }
      return completion;
    },
  });
}
