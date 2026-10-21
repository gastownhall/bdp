import { isDeepStrictEqual } from "node:util";
import { referenceDeploymentState } from "./reference-deployment-state.js";
import type { PreparedReferenceDeployment } from "./reference-deployment.js";
import { TransactionAuthorizationFailure } from "./transaction-authorization.js";
/** Source-private loopback fixture. Never selected by installed config/profile
 * admission. It exposes actual routes, not an incomplete BDP discovery claim. */
import { createTransactionSchemaHttp } from "./transaction-schema-http.js";
import { createNodeHttpDisconnectSignal } from "./node-http-disconnect.js";
import { pumpTransactionChanges, pumpTransactionEvents } from "./transaction-sse.js";
import { ScopeServerOperationAbortedError } from "./read-request.js";
import { createServer, type IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Socket } from "node:net";
import { TextDecoder } from "node:util";
import { stringifyJsonValue, type TypeDescriptor } from "@bdp/protocol";
import type { ContractArtifactLimits } from "./installed-contract-artifact.js";
import { captureTransactionRuntimeConfiguration } from "./transaction-runtime-configuration.js";
import type { HttpResponse } from "./index.js";
import { normalizationSafeRawRequestPath } from "./node-http-target.js";
import { openTransactionStore, type TransactionReadContext } from "./transaction-store.js";
import { TRANSACTION_RUNTIME_LIMITS } from "./transaction-batch.js";
import {
  createTransactionService,
  TransactionStreamCapacityError,
  type TransactionServiceOptions,
} from "./transaction-service.js";
import {
  createTransactionHttpHandler,
  transactionHttpProblem,
  TRANSACTION_HTTP_TARGET_BYTES,
  type TransactionReceivedBody,
  type TransactionHttpResult,
} from "./transaction-http.js";

export interface TransactionRuntimeOptions {
  /** Stable configured identity; omission is a disposable same-port fixture only. */
  readonly scope?: string;
  readonly authorityMode?: "listener" | "canonical";
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
  /** Source-only deadline observations. Any supplied seam suppresses metadata. */
  readonly transport?: Partial<
    Record<"requestTimeout" | "headersTimeout" | "timeout" | "keepAliveTimeout", number>
  >;
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
function deliver(response: ServerResponse, selected: HttpResponse, raw?: string): void {
  if (response.destroyed) return;
  const bytes =
    raw ?? (selected.body === undefined ? undefined : stringifyJsonValue(selected.body));
  selected.headers.set("x-bdp-development", "non-attesting");
  if (bytes !== undefined) selected.headers.set("content-length", String(Buffer.byteLength(bytes)));
  response.writeHead(selected.status, Object.fromEntries(selected.headers));
  response.end(response.req.method === "HEAD" ? undefined : bytes);
}
export async function startTransactionRuntime(
  options: TransactionRuntimeOptions,
  seams: TransactionRuntimeTestSeams = {},
) {
  const { scope, listenUrl, configurationMetadata, replaceAuthorizationPolicy, targets, close } =
    await startTransactionRuntimeCore(captureTransactionRuntimeConfiguration(options, seams));
  // Keep the legacy declaration and runtime result restricted to its original six keys.
  return Object.freeze({
    scope,
    listenUrl,
    configurationMetadata,
    replaceAuthorizationPolicy,
    targets,
    close,
  });
}
export async function startPreparedTransactionRuntime(
  handle: PreparedReferenceDeployment,
  signal?: AbortSignal,
) {
  const state = referenceDeploymentState(handle);
  if (state.profile !== "transactional") throw new TypeError("prepared Transactional required");
  signal?.throwIfAborted();
  return startTransactionRuntimeCore(state.preflight, {
    handle,
    ...(signal === undefined ? {} : { signal }),
  });
}
async function startTransactionRuntimeCore(
  captured: ReturnType<typeof captureTransactionRuntimeConfiguration>,
  prepared?: { readonly handle: PreparedReferenceDeployment; readonly signal?: AbortSignal },
) {
  const { settings, configuredScope, contracts, types } = captured;
  const capturedSeams = captured.seams;
  let service: ReturnType<typeof createTransactionService> | undefined;
  let handler: ReturnType<typeof createTransactionHttpHandler> | undefined;
  let schemas: ReturnType<typeof createTransactionSchemaHttp> | undefined;
  let configurationMetadata: ReturnType<typeof captured.metadata>;
  let listenUrl = "";
  let scope = "",
    closing = false;
  const pending = new Set<Promise<void>>();
  // Retain only the first unexpected live fault. Wire cancellation remains
  // silent; close surfaces the original cause through existing aggregation.
  let firstStreamFault: { readonly cause: unknown } | undefined;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let signal: AbortSignal | undefined;
    let streamContext: TransactionReadContext | undefined;
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
        request.headers.host !==
          new URL(captured.authorityMode === "canonical" ? scope : listenUrl).host
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
      const authorization = captured.authenticate(supplied);
      signal = createNodeHttpDisconnectSignal(request, response);
      const input = new Request(url, { method: request.method ?? "GET", headers, signal });
      const lastEventIds: string[] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        if (request.rawHeaders[i]?.toLowerCase() === "last-event-id")
          lastEventIds.push(request.rawHeaders[i + 1] ?? "");
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
      const schema = await schemas?.(input, authorization);
      if (schema) {
        deliver(response, schema.response, schema.raw);
        return;
      }
      let selected: TransactionHttpResult | undefined = await handler.handle(
        input,
        authorization,
        body,
        lastEventIds,
      );
      if (selected.kind === "finite") deliver(response, selected);
      else {
        if (!captured.liveStreamsAvailable) {
          deliver(response, {
            status: 500,
            headers: new Headers({
              "cache-control": "private, no-store",
              "x-bdp-development-limit": "stream-transport-timing",
            }),
          });
          return;
        }
        const activeService = service!;
        streamContext = selected.context;
        await activeService.stream(
          async (streamSignal) => {
            try {
              streamSignal.throwIfAborted();
              if (!selected || selected.kind === "finite")
                throw new Error("missing stream selection");
              response.writeHead(selected.status, Object.fromEntries(selected.headers));
              response.flushHeaders();
              const pumping =
                selected.kind === "changefeed-stream"
                  ? pumpTransactionChanges(
                      response,
                      selected.page,
                      async (after, nextSignal) => {
                        const observed = await activeService.changes(
                          { after },
                          undefined,
                          nextSignal,
                        );
                        if (observed.kind !== "page")
                          throw new Error("changefeed stream lost serving entry");
                        return observed.page;
                      },
                      streamSignal,
                      settings.changefeedStream,
                    )
                  : pumpTransactionEvents(
                      response,
                      selected.packet,
                      (scan, nextSignal) => activeService.nextEvents(scan, nextSignal),
                      streamSignal,
                      settings.changefeedStream,
                    );
              // Transfer the initial packet into the pump; do not retain the HTTP
              // result/group body for the lifetime of the live stream.
              selected = undefined;
              await pumping;
            } catch (error) {
              // Capture before destroy() turns a genuine fault into a disconnect.
              if (
                response.headersSent &&
                !streamSignal.aborted &&
                !response.destroyed &&
                !firstStreamFault
              )
                firstStreamFault = { cause: error };
              throw error;
            } finally {
              response.destroy();
            }
          },
          signal,
          streamContext,
        );
      }
    } catch (error) {
      if (
        signal?.aborted ||
        response.headersSent ||
        error instanceof ScopeServerOperationAbortedError
      ) {
        response.destroy();
      } else if (error instanceof TransactionAuthorizationFailure) {
        deliver(response, transactionHttpProblem(error.code, error.context));
      } else if (error instanceof TransactionStreamCapacityError) {
        deliver(response, transactionHttpProblem("temporarily-unavailable", streamContext));
      } else if (!response.destroyed) {
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
  const server = createServer({ maxHeaderSize: settings.transport.maxHeaderSize }, dispatch);
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
  server.requestTimeout = settings.transport.requestTimeout;
  server.headersTimeout = settings.transport.headersTimeout;
  server.timeout = settings.transport.timeout;
  server.keepAliveTimeout = settings.transport.keepAliveTimeout;
  for (const key of [
    "maxHeaderSize",
    "requestTimeout",
    "headersTimeout",
    "timeout",
    "keepAliveTimeout",
  ] as const)
    if (Reflect.get(server, key) !== settings.transport[key])
      throw new Error("runtime transport configuration mismatch");
  server.on("timeout", (socket) => socket.destroy());
  const sockets = new Set<Socket>();
  if (prepared)
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  const terminal = Promise.withResolvers<void>();
  void terminal.promise.catch(() => {});
  let liveFault: { readonly cause: unknown } | undefined;
  const listenerFaults: unknown[] = [];
  let rejectListening: ((error: unknown) => void) | undefined;
  let published = false;
  let checkedOwner:
    | ReturnType<ReturnType<typeof openTransactionStore>["readConfiguration"]>
    | undefined;
  const checkPrepared = () => {
    prepared?.signal?.throwIfAborted();
    if (liveFault) throw liveFault.cause;
  };
  const onListenerError = (error: Error) => {
    if (!listenerFaults.includes(error)) listenerFaults.push(error);
    liveFault ??= { cause: error };
    rejectListening?.(error);
    terminal.reject(error);
    if (published) void close().catch(() => {});
  };
  const onAbort = () => {
    if (published) void close().catch(() => {});
  };
  if (prepared) {
    server.on("error", onListenerError);
    prepared.signal?.addEventListener("abort", onAbort, { once: true });
  }
  const closeListener = () =>
    new Promise<void>((resolve, reject) => {
      if (prepared && !server.listening) {
        for (const socket of sockets) socket.destroy();
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
      if (prepared) for (const socket of sockets) socket.destroy();
    });
  let owner: ReturnType<typeof openTransactionStore> | undefined;
  const prepareOwner = () => {
    owner = openTransactionStore({
      file: path.join(captured.directory, "transaction.sqlite"),
      scope,
      create: captured.create,
      types,
      ...(contracts ? { contracts } : {}),
      receiptMaximumItems: settings.receiptMaximumItems,
      maintenanceIntervalMs: settings.maintenanceIntervalMs,
      ...(capturedSeams.clock ? { clock: capturedSeams.clock } : {}),
    });
    if (prepared) {
      checkPrepared();
      const actual = owner.readConfiguration();
      if (
        actual.receiptMaximumItems !== settings.receiptMaximumItems ||
        !isDeepStrictEqual(
          captured.readOptions(scope).advertisedLimits,
          prepared.handle.preflightReadLimits,
        )
      )
        throw new Error("prepared Transactional read limits mismatch");
      configurationMetadata = captured.metadata(actual, scope);
      if (!configurationMetadata || configurationMetadata.authorityMode !== "canonical")
        throw new Error("prepared Transactional metadata unavailable");
      checkedOwner = actual;
    }
    service = createTransactionService(owner, {
      ownerLifetime: "service",
      maximumStreams: settings.changefeedStream.maximumStreams,
      ...(capturedSeams.scheduler ? { scheduler: capturedSeams.scheduler } : {}),
      comparison: { budgetMs: settings.comparisonBudgetMs, ...capturedSeams.comparison },
      minimumReads: { budgetMs: settings.minimumReadBudgetMs, ...capturedSeams.minimumReads },
      read: captured.readOptions(scope),
    });
    if (!prepared) configurationMetadata = captured.metadata(owner.readConfiguration(), scope);
    schemas = createTransactionSchemaHttp(scope, contracts, service.schemaObserved);
    handler = createTransactionHttpHandler(service, scope, capturedSeams.maximumOperations);
  };
  try {
    if (prepared) {
      if (prepared.handle.listener.port < 1 || !configuredScope)
        throw new TypeError("intended listener required");
      scope = configuredScope;
      checkPrepared();
      prepareOwner();
      await Promise.resolve();
      checkPrepared();
    }
    await new Promise<void>((resolve, reject) => {
      if (prepared) rejectListening = reject;
      else server.once("error", reject);
      server.listen(
        prepared?.handle.listener.port ?? captured.port,
        prepared?.handle.listener.host ?? settings.transport.host,
        () => {
          if (!prepared) server.removeListener("error", reject);
          rejectListening = undefined;
          resolve();
        },
      );
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing private transaction address");
    listenUrl = `http://127.0.0.1:${address.port}/`;
    scope = configuredScope ?? new URL("acme/", listenUrl).href;
    if (!prepared) prepareOwner();
    checkPrepared();
    if (prepared) {
      await Promise.resolve();
      checkPrepared();
    }
    published = true;
  } catch (error) {
    prepared?.signal?.removeEventListener("abort", onAbort);
    terminal.reject(error);
    const failures: unknown[] = [error, ...listenerFaults.filter((fault) => fault !== error)];
    if (server.listening)
      try {
        await closeListener();
      } catch (failure) {
        failures.push(failure);
      }
    if (prepared) await Promise.allSettled([...pending]);
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
  const legacy = {
    scope,
    listenUrl,
    configurationMetadata,
    replaceAuthorizationPolicy: (options: {
      readonly timeoutMs: number;
      readonly signal?: AbortSignal;
    }) => service!.replaceAuthorizationPolicy(options),
    /** Test-only inventory, not an HTTP Operation Directory. */ targets: handler!.targets,
    close,
  };
  function close(): Promise<void> {
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
        if (firstStreamFault) failures.unshift(firstStreamFault.cause);
        failures.unshift(...listenerFaults);
        if (failures.length)
          throw new AggregateError(failures, "transaction runtime shutdown failed");
      })()
        .then(
          () => {
            terminal.resolve();
          },
          (error: unknown) => {
            terminal.reject(error);
            throw error;
          },
        )
        .finally(() => {
          prepared?.signal?.removeEventListener("abort", onAbort);
        });
      void completion.catch(() => {});
    }
    return completion;
  }
  if (!prepared) return Object.freeze(legacy);
  if (!checkedOwner || !configurationMetadata) throw new Error("missing prepared owner");
  return Object.freeze({
    ...legacy,
    history: configurationMetadata.history,
    completion: terminal.promise,
    ownerFacts: Object.freeze({
      scope,
      scopeEpoch: checkedOwner.scopeEpoch,
      readLimits: captured.readOptions(scope).advertisedLimits,
      installedTypeIds: Object.freeze(checkedOwner.installedTypes.map((t) => t.id)),
    }),
  });
}
