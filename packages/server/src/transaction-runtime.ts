/** Source-private loopback fixture. Never selected by installed config/profile
 * admission. It exposes actual routes, not an incomplete BDP discovery claim. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Socket } from "node:net";
import { TextDecoder } from "node:util";
import { parseCanonicalScope, stringifyJsonValue, type TypeDescriptor } from "@bdp/protocol";
import {
  administrativeArray,
  administrativeData,
  compileDevelopmentContracts,
} from "./development-contracts.js";
import {
  CONTRACT_ARTIFACT_CEILINGS,
  type ContractArtifactLimits,
} from "./installed-contract-artifact.js";
import type { HttpResponse } from "./index.js";
import { normalizationSafeRawRequestPath } from "./node-http-target.js";
import { openTransactionStore, transactionReceiptMaximum } from "./transaction-store.js";
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
  /** Stable configured identity; omission is a disposable same-port fixture only. */
  readonly scope?: string;
  readonly directory: string;
  readonly create: boolean;
  readonly port: number;
  readonly types?: readonly TypeDescriptor[];
  /** Plain child-process data. Compiled in this module instance, never transported branded. */
  readonly artifacts?: {
    readonly descriptors: readonly { readonly retrievalUri: string; readonly utf8: string }[];
    readonly schemas: readonly { readonly retrievalUri: string; readonly utf8: string }[];
    readonly limits: ContractArtifactLimits;
  };
  readonly credentials: readonly {
    readonly token: string;
    readonly principal: string;
    readonly canMutate: boolean;
  }[];
}
export interface TransactionRuntimeTestSeams {
  readonly scheduler?: TransactionServiceOptions["scheduler"];
  readonly clock?: () => number;
  /** Direct transaction.operations only; sequence.operations retains its own32 bound. */
  readonly maximumOperations?: number;
  readonly comparison?: TransactionServiceOptions["comparison"];
  readonly minimumReads?: TransactionServiceOptions["minimumReads"];
  readonly receiptMaximumItems?: number;
  /** Store timer isolation for clock-advancing HTTP tests; default unchanged. */
  readonly maintenanceIntervalMs?: number;
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
  // One detached bound configures all three consumers before owner open/recovery.
  const receiptMaximumItems = transactionReceiptMaximum(seams.receiptMaximumItems);
  const defaultItems = Math.min(2, receiptMaximumItems);
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
  const configuredScope =
    options.scope === undefined ? undefined : parseCanonicalScope(options.scope);
  if (options.artifacts !== undefined && !configuredScope)
    throw new TypeError("compiled transaction artifacts require explicit stable Scope");
  const compile = () => {
    const source = administrativeData(options.artifacts, ["descriptors", "schemas", "limits"]);
    let totalBytes = 0;
    const artifacts = (value: unknown) =>
      administrativeArray(value, CONTRACT_ARTIFACT_CEILINGS.submittedArtifacts).map((item) => {
        const entry = administrativeData(item, ["retrievalUri", "utf8"]);
        if (
          typeof entry.utf8 !== "string" ||
          !entry.utf8.isWellFormed() ||
          typeof entry.retrievalUri !== "string"
        )
          throw new TypeError("plain UTF8 transaction artifact required");
        const bytes = Buffer.byteLength(entry.utf8);
        totalBytes += bytes;
        if (
          bytes > CONTRACT_ARTIFACT_CEILINGS.artifactBytes ||
          totalBytes > CONTRACT_ARTIFACT_CEILINGS.totalBytes
        )
          throw new TypeError("transaction artifact byte bound");
        return { retrievalUri: entry.retrievalUri, utf8Bytes: Buffer.from(entry.utf8) };
      });
    return compileDevelopmentContracts({
      descriptors: artifacts(source.descriptors),
      schemas: artifacts(source.schemas),
      limits: source.limits as ContractArtifactLimits,
    });
  };
  const contracts = options.artifacts === undefined ? undefined : compile();
  const types = options.types === undefined ? contracts?.descriptors : options.types;
  if (!types) throw new TypeError("transaction Type inventory required");
  let listenUrl = "";
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
      if (request.method === "POST" && Buffer.byteLength(raw) > TRANSACTION_HTTP_TARGET_BYTES) {
        deliver(response, transactionHttpProblem("request-too-large"));
        return;
      }
      if (
        normalizationSafeRawRequestPath(raw) === undefined ||
        !raw.startsWith("/") ||
        raw.startsWith("//") ||
        request.headers.host !== new URL(listenUrl).host
      ) {
        deliver(response, transactionHttpProblem("malformed-request"));
        return;
      }
      const url = new URL(raw, scope);
      const methodFailure = handler.methodResponse(url, request.method ?? "GET");
      if (methodFailure) {
        // Refused bodies are not consumed and cannot keep this connection alive.
        methodFailure.headers.set("connection", "close");
        deliver(response, methodFailure);
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
      const input = new Request(url, { method: request.method ?? "GET", headers });
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
  function dispatch(request: IncomingMessage, response: ServerResponse): void {
    const task = handle(request, response);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
  }
  const server = createServer({ maxHeaderSize: 16 * 1024 }, dispatch);
  // Node emits CONNECT separately from ordinary requests. This service never
  // opens a tunnel: the same raw target/method gate determines its refusal.
  server.on("connect", (request, socket) => {
    if (!(socket instanceof Socket)) {
      socket.destroy();
      return;
    }
    const response = new ServerResponse(request);
    response.assignSocket(socket);
    response.setHeader("connection", "close");
    response.once("finish", () => socket.end());
    response.once("error", () => socket.destroy());
    dispatch(request, response);
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
    listenUrl = `http://127.0.0.1:${address.port}/`;
    scope = configuredScope ?? new URL("acme/", listenUrl).href;
    owner = openTransactionStore({
      file: path.join(options.directory, "transaction.sqlite"),
      scope,
      create: options.create,
      types,
      ...(contracts ? { contracts } : {}),
      receiptMaximumItems,
      ...(seams.maintenanceIntervalMs === undefined
        ? {}
        : { maintenanceIntervalMs: seams.maintenanceIntervalMs }),
      ...(seams.clock ? { clock: seams.clock } : {}),
    });
    const clock = seams.clock ?? Date.now;
    service = createTransactionService(owner, {
      ownerLifetime: "service",
      ...(seams.scheduler ? { scheduler: seams.scheduler } : {}),
      ...(seams.comparison ? { comparison: seams.comparison } : {}),
      ...(seams.minimumReads ? { minimumReads: seams.minimumReads } : {}),
      read: {
        selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
        advertisedLimits: {
          page: { defaultItems, maximumItems: receiptMaximumItems },
          selector: { bytes: 4096, depth: 32, nodes: 256 },
          cursorTtlMilliseconds: 1000,
        },
        pagination: {
          scope,
          defaultPageItems: defaultItems,
          maxPageItems: receiptMaximumItems,
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
    listenUrl,
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
