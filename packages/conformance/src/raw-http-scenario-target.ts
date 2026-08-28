import type { ConformanceFixture } from "./artifact-bundle.js";
import type { ExecutableScenario } from "./executable-manifest.js";
import {
  createRawHttpExchangeExecutor,
  type HttpExchangeExecutor,
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

export interface RawHttpScenarioTarget {
  readonly execute: HttpExchangeExecutor;
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
  const snapshot = Object.freeze({ ...options });
  let active:
    | {
        readonly execute: HttpExchangeExecutor;
        readonly close: RawHttpScenarioSession["close"];
      }
    | undefined;

  const close = async (signal: AbortSignal = new AbortController().signal): Promise<void> => {
    const closing = active;
    active = undefined;
    await closing?.close(signal);
  };

  const harness: ScenarioHarness = {
    prepare: async (scenario, scope, seed, fixture, signal) => {
      if (active !== undefined)
        throw new Error("raw HTTP scenario target already has an active fixture");
      const session = await start(scenario, scope, seed, fixture, signal);
      if (signal.aborted) {
        await session.close(new AbortController().signal);
        throw new Error("raw HTTP scenario target preparation was aborted");
      }
      let execute: HttpExchangeExecutor;
      try {
        execute = createRawHttpExchangeExecutor(session.dialRoute, snapshot);
      } catch (error) {
        await session.close(new AbortController().signal);
        throw error;
      }
      active = { execute, close: (closeSignal) => session.close(closeSignal) };
      return {
        capabilities: Object.freeze([...session.capabilities]),
        ...(session.bindings === undefined
          ? {}
          : { bindings: Object.freeze({ ...session.bindings }) }),
      };
    },
    cleanup: async (_scenario, _scope, signal) => close(signal),
  };

  return Object.freeze({
    execute: async (request: HttpExchangeRequest) => {
      const execute = active?.execute;
      if (execute === undefined)
        throw new Error("raw HTTP scenario target executed outside a prepared fixture");
      return execute(request);
    },
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
      const response = await activeExecute()({
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

  function activeExecute(): HttpExchangeExecutor {
    const execute = active?.execute;
    if (execute === undefined)
      throw new Error("raw HTTP scenario target executed outside a prepared fixture");
    return execute;
  }
}

function isSupportedMethod(method: string): method is HttpExchangeRequest["method"] {
  return ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].includes(method);
}
