import type { ConformanceFixture } from "./artifact-bundle.js";
import type { ExecutableScenario } from "./executable-manifest.js";
import {
  createRawHttpExchangeExecutor,
  type RawHttpExchangeExecutor,
  type ExactHttpExchangeRequest,
  type ExactHttpModeOptions,
  HttpTransportError,
  snapshotExactHttpMode,
  validateExactRunConfiguration,
  type HttpExchangeRequest,
  type RawHttpDialRoute,
  type RawHttpExchangeExecutorOptions,
} from "./http-executor.js";
import type { FixturePreparation, ScenarioHarness } from "./runner.js";

export interface RawHttpScenarioSession extends FixturePreparation {
  readonly dialRoute: RawHttpDialRoute;
  close(signal: AbortSignal): Promise<void>;
}

export type StartRawHttpScenarioSession = (
  scenario: ExecutableScenario,
  scope: string,
  seed: number,
  fixture: ConformanceFixture,
  signal: AbortSignal,
) => Promise<RawHttpScenarioSession>;

export type RawHttpScenarioTargetOptions = RawHttpExchangeExecutorOptions;

export type ExactHttpConfiguration = Omit<ExactHttpModeOptions, "resolveCredentials">;

export interface RawHttpScenarioTarget {
  /** Actual frozen harness configuration, without the credential resolver or credential bytes. */
  readonly exactConfiguration?: ExactHttpConfiguration;
  readonly execute: RawHttpExchangeExecutor;
  /** Fetch-compatible view of the active public target for programmable client diagnostics. */
  readonly fetch: typeof fetch;
  readonly harness: ScenarioHarness;
  /** Emergency cleanup for a run that exits outside the runner's normal lifecycle. */
  close(signal?: AbortSignal): Promise<void>;
}

/**
 * Composes a sequential scenario harness with the raw HTTP executor without
 * letting target identity, fixture preparation, or the socket dial route leak
 * into the semantic request URL.
 */
export function createRawHttpScenarioTarget(
  start: StartRawHttpScenarioSession,
  options: RawHttpScenarioTargetOptions = {},
): RawHttpScenarioTarget {
  if (typeof start !== "function") throw new TypeError("start must be a function");
  const snapshot = Object.freeze({
    ...options,
    ...(options.exactMode === undefined
      ? {}
      : { exactMode: snapshotExactHttpMode(options.exactMode) }),
  });
  const cleanupTimeoutMs = snapshot.requestTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs <= 0 ||
    cleanupTimeoutMs > 2_147_483_647
  )
    throw new RangeError("requestTimeoutMs must be a positive timer bound");
  let preparation:
    | { controller: AbortController; settled: Promise<void>; finish: () => void }
    | undefined;
  let closing: Promise<void> | undefined;
  let active:
    | {
        readonly execute: RawHttpExchangeExecutor;
        readonly close: RawHttpScenarioSession["close"];
        readonly controller: AbortController;
        readonly pending: Set<Promise<unknown>>;
      }
    | undefined;

  const close = (signal: AbortSignal = new AbortController().signal): Promise<void> => {
    if (closing !== undefined) return closing;
    const ending = active;
    active = undefined;
    const starting = preparation;
    starting?.controller.abort();
    if (ending === undefined && starting === undefined) return Promise.resolve();
    ending?.controller.abort();
    const cleanupSignal = AbortSignal.any([signal, AbortSignal.timeout(cleanupTimeoutMs)]);
    const cleanup = Promise.resolve().then(async () => {
      if (starting !== undefined) await starting.settled;
      if (ending !== undefined) {
        await Promise.allSettled([...ending.pending]);
        await ending.close(cleanupSignal);
      }
    });
    closing = settleCleanup(cleanup, cleanupSignal).finally(() => {
      closing = undefined;
    });
    return closing;
  };

  const harness: ScenarioHarness = {
    prepare: async (scenario, scope, seed, fixture, signal) => {
      if (active !== undefined || preparation !== undefined || closing !== undefined)
        throw new Error("raw HTTP scenario target already has an active fixture");
      if (snapshot.exactMode !== undefined && snapshot.exactMode.scope !== scope)
        throw new HttpTransportError(
          "configuration",
          "prepared Scope does not match configured exact mode",
        );
      const controller = new AbortController();
      let finish = (): void => undefined;
      const settled = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const starting = { controller, settled, finish };
      preparation = starting;
      const preparingSignal = AbortSignal.any([signal, controller.signal]);
      try {
        const session = await start(scenario, scope, seed, fixture, preparingSignal);
        const closeStarted = (): Promise<void> => {
          const closeSignal = AbortSignal.timeout(cleanupTimeoutMs);
          return settleCleanup(
            Promise.resolve().then(() => session.close(closeSignal)),
            closeSignal,
          );
        };
        if (preparingSignal.aborted) {
          await closeStarted();
          throw new Error("raw HTTP scenario target preparation was aborted");
        }
        try {
          const execute = createRawHttpExchangeExecutor(session.dialRoute, snapshot);
          const prepared = {
            capabilities: Object.freeze([...session.capabilities]),
            ...(session.bindings === undefined
              ? {}
              : { bindings: Object.freeze({ ...session.bindings }) }),
          };
          active = {
            execute,
            close: (closeSignal) => session.close(closeSignal),
            controller: new AbortController(),
            pending: new Set(),
          };
          return prepared;
        } catch (error) {
          await closeStarted();
          throw error;
        }
      } finally {
        if (preparation === starting) preparation = undefined;
        starting.finish();
      }
    },
    cleanup: async (_scenario, _scope, signal) => close(signal),
  };

  const mode = snapshot.exactMode;
  const exactConfiguration: ExactHttpConfiguration | undefined =
    mode === undefined
      ? undefined
      : Object.freeze({
          scope: mode.scope,
          profile: mode.profile,
          routes: mode.routes,
          maximumRequestHeaderBytes: mode.maximumRequestHeaderBytes,
          maximumRequestBodyBytes: mode.maximumRequestBodyBytes,
          defaultCredentialRef: mode.defaultCredentialRef,
          credentialHandles: mode.credentialHandles,
        });
  return Object.freeze({
    ...(exactConfiguration === undefined ? {} : { exactConfiguration }),
    execute: dispatch,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.body !== null)
        throw new TypeError("raw HTTP scenario Fetch does not support request bodies");
      if (!isSupportedMethod(request.method))
        throw new TypeError("raw HTTP scenario Fetch received an unsupported method");
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      const response = await dispatch({
        method: request.method,
        url: request.url,
        headers,
        signal: request.signal,
      });
      const fetchResponse = new Response(
        response.bodyText.length === 0 ? null : response.bodyText,
        {
          status: response.status,
          headers: response.headers,
        },
      );
      Object.defineProperty(fetchResponse, "url", { value: response.url });
      return fetchResponse;
    },
    harness,
    close,
  });

  function dispatch(
    request: HttpExchangeRequest | ExactHttpExchangeRequest,
  ): ReturnType<RawHttpExchangeExecutor> {
    const session = active;
    if (session === undefined)
      return Promise.reject(
        new Error("raw HTTP scenario target executed outside a prepared fixture"),
      );
    let inspected = false;
    let exactBoundary = snapshot.exactMode !== undefined;
    try {
      const exactArm = "raw" in request;
      inspected = true;
      exactBoundary ||= exactArm;
      if (exactBoundary) {
        const prototype = Object.getPrototypeOf(request);
        if (prototype !== null && prototype !== Object.prototype)
          return Promise.reject(
            new HttpTransportError(
              "configuration",
              "exact HTTP session request was refused",
              {},
              "not-started",
            ),
          );
      }
      // The executor snapshots exact data descriptors; avoid invoking accessors through object spread.
      const descriptors = Object.getOwnPropertyDescriptors(request);
      const signalDescriptor = descriptors.signal;
      if (
        signalDescriptor === undefined ||
        !("value" in signalDescriptor) ||
        !(signalDescriptor.value instanceof AbortSignal)
      )
        throw new HttpTransportError("configuration", "HTTP request signal is invalid");

      if (snapshot.exactMode !== undefined) {
        if (
          !descriptors.url ||
          !("value" in descriptors.url) ||
          !descriptors.method ||
          !("value" in descriptors.method)
        )
          throw new HttpTransportError("configuration", "HTTP target is invalid");
        validateExactRunConfiguration(
          snapshot.exactMode,
          descriptors.url.value,
          descriptors.method.value,
        );
      }
      const captured = Object.defineProperties(Object.create(null), {
        ...descriptors,
        signal: {
          value: AbortSignal.any([signalDescriptor.value, session.controller.signal]),
          enumerable: true,
        },
      });
      const operation = session.execute(captured);
      session.pending.add(operation);
      void operation.then(
        () => session.pending.delete(operation),
        () => session.pending.delete(operation),
      );
      return operation;
    } catch (error) {
      if (exactBoundary || !inspected)
        return Promise.reject(
          new HttpTransportError(
            "configuration",
            "exact HTTP session request was refused",
            {},
            "not-started",
          ),
        );
      return Promise.reject(error);
    }
  }
}

function isSupportedMethod(method: string): method is HttpExchangeRequest["method"] {
  return ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(method);
}

async function settleCleanup(operation: Promise<void>, signal: AbortSignal): Promise<void> {
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new HttpTransportError("abort", "raw HTTP session cleanup was aborted"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([operation, aborted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}
