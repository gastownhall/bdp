import {
  assertFactoryCreatedArtifactBundle,
  type ConformanceArtifactBundle,
  type ConformanceFixture,
} from "./artifact-bundle.js";
import { parseLinkHeader } from "@bdp/protocol";
import type { ScenarioCatalog, ScenarioMetadata } from "./catalog.js";
import type {
  ExecutableScenario,
  JsonValue,
  ScenarioAssertion,
  ScenarioCapture,
  ScenarioQueryValue,
  ScenarioRequest,
} from "./executable-manifest.js";
import { materializeScenarioRawRequestTarget } from "./executable-manifest.js";
import type {
  ScenarioAction,
  ScenarioActionExecution,
  ScenarioActionExecutor,
  ScenarioProgrammaticAction,
} from "./scenario-action.js";
import {
  type HttpExchangeExecutor,
  type HttpExchangeResponse,
  HttpTransportError,
} from "./http-executor.js";
import type { SchemaValidator } from "./schema-validator.js";
import { profileIncludes, selectApplicableScenariosForProfile } from "./selection.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const BINDING_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const OBSERVED_JSON_MAX_DEPTH = 128;
const OBSERVED_JSON_MAX_NODES = 100_000;
const OBSERVED_JSON_MAX_CONTAINER_ENTRIES = 10_000;
const RAW_WIRE_EVIDENCE_MAX_BYTES = 2_097_152;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

export type ScenarioRunState =
  | "pass"
  | "fail"
  | "not-applicable"
  | "unsupported-profile"
  | "harness-error";

type PrerequisiteFailureCategory = "deadline" | "containment" | "observation-limit";

export interface FixturePreparation {
  readonly capabilities: readonly string[];
  readonly bindings?: Readonly<Record<string, string>>;
}

export interface ScenarioHarness {
  prepare(
    scenario: ExecutableScenario,
    scope: string,
    seed: number,
    fixture: ConformanceFixture,
    signal: AbortSignal,
  ): Promise<FixturePreparation>;
  cleanup(scenario: ExecutableScenario, scope: string, signal: AbortSignal): Promise<void>;
}

export interface ScenarioRunOptions {
  readonly scope: string;
  readonly profile: "read" | "read-update" | "transactional";
  readonly seed: number;
  readonly artifactBundle: ConformanceArtifactBundle;
  readonly execute: HttpExchangeExecutor;
  /** Executes only programmable actions; HTTP remains on the transport executor. */
  readonly actionExecutor?: ScenarioActionExecutor;
  readonly harness: ScenarioHarness;
  readonly schemaValidator?: SchemaValidator;
  readonly scenarioFilter?: string;
  /**
   * Exact-id selection, for a run that deliberately carries a declared subset
   * of the catalog — the packaged cohort run selects precisely the rows whose
   * provenance it claims. Every id must name an applicable scenario, and the
   * request is recorded verbatim in the result so a partial run can never
   * present itself as a full one. Mutually exclusive with `scenarioFilter`.
   */
  readonly scenarioSelection?: readonly string[];
  readonly signal?: AbortSignal;
  /** Caller declaration only; target provenance remains a later pre-evidence gate. */
  readonly declaredTargetLabel: string;
  /** Maximum time permitted for fixture preparation before each scenario. */
  readonly prepareTimeoutMs?: number;
  /** Maximum time permitted for each executor request. */
  readonly requestTimeoutMs?: number;
  /** Maximum time permitted for fixture cleanup after each scenario. */
  readonly cleanupTimeoutMs?: number;
}

export interface AssertionOutcome {
  readonly id: string;
  readonly passed: boolean;
  readonly message?: string;
}

export interface ObservedExchange {
  readonly request: {
    readonly id: string;
    readonly method: ScenarioRequest["method"];
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly wireHeadersObserved?: true;
  };
  readonly response?: {
    readonly url: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly decodedBodyBytes: number;
    readonly wireBodyOctets?: number;
    readonly bodyKind: "empty" | "json" | "invalid-json" | "unrepresentable-json";
  };
  readonly transportError?: { readonly category: string; readonly message: string };
  readonly assertions: readonly AssertionOutcome[];
}

/** Redacted programmable-action evidence. Inputs, bindings, and output values are never reported. */
export interface ObservedAction {
  readonly action: {
    readonly id: string;
    readonly family: ScenarioProgrammaticAction["family"];
    readonly operation: string;
  };
  readonly output?: { readonly kind: "json" };
  readonly executionError?: { readonly category: string; readonly message: string };
  readonly assertions: readonly AssertionOutcome[];
}

export interface ScenarioRunResult {
  readonly id: string;
  readonly requiredProfile: string;
  readonly state: ScenarioRunState;
  readonly category?:
    | "aborted"
    | "cleanup"
    | "deadline"
    | "not-implemented"
    | "not-run"
    | "observation-limit"
    | "out-of-scope-target"
    | "wire-observation-unavailable";
  readonly requirements: readonly string[];
  readonly prerequisiteFailure?:
    | {
        readonly id: string;
        readonly requirements: readonly string[];
        readonly reason: string;
        readonly phase: "initial";
      }
    | {
        readonly id: string;
        readonly requirements: readonly string[];
        readonly reason: string;
        readonly phase: "recheck";
        readonly category?: PrerequisiteFailureCategory;
      };
  readonly reason?: string;
  readonly cleanupError?: string;
  readonly exchanges: readonly ObservedExchange[];
  /** Present only when a scenario observed at least one non-HTTP action. */
  readonly actions?: readonly ObservedAction[];
}

export interface ConformanceRunResult {
  readonly reportVersion: 3;
  readonly scope: string;
  readonly profile: ScenarioRunOptions["profile"];
  readonly seed: number;
  readonly selectedScenarioIds: readonly string[];
  readonly scenarioFilter?: string;
  /** The exact-id selection this run was asked to carry, recorded verbatim. */
  readonly scenarioSelection?: readonly string[];
  readonly artifacts: {
    readonly catalogDigest: string;
    readonly manifestDigest: string;
    readonly fixtureDigest: string;
  };
  readonly declarations: {
    /** Caller-supplied label, not cryptographically derived target identity. */
    readonly targetLabel: string;
  };
  readonly scenarios: readonly ScenarioRunResult[];
  readonly claimEligible: false;
}

export class ConformanceRunnerError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ConformanceRunnerError";
  }
}

/** A target-side protocol observation was missing or malformed. */
export class ScenarioObservationFailure extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ScenarioObservationFailure";
  }
}

/** Valid target JSON exceeded a runner materialization bound. */
class ScenarioObservationLimitError extends ConformanceRunnerError {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioObservationLimitError";
  }
}

class ScenarioWireObservationUnavailableError extends ConformanceRunnerError {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioWireObservationUnavailableError";
  }
}

/** A public harness may use this only after observing the target's discovery profile. */
export class ScenarioUnsupportedProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioUnsupportedProfileError";
  }
}

export async function runConformanceMatrix(
  options: ScenarioRunOptions,
): Promise<ConformanceRunResult> {
  const runOptions = snapshotRunOptions(options);
  validateRunOptions(runOptions);
  const { catalog, manifest } = runOptions.artifactBundle;
  const metadata = selectApplicableScenariosForProfile(catalog, runOptions.profile);
  const allCatalogIds = new Set(catalog.scenarios.map(({ id }) => id));
  const unknownPlan = manifest.scenarios.find(({ id }) => !allCatalogIds.has(id));
  if (unknownPlan !== undefined)
    throw new ConformanceRunnerError(`executable plan '${unknownPlan.id}' has no catalog metadata`);
  const byId = new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]));
  let selected =
    runOptions.scenarioFilter === undefined
      ? metadata
      : metadata.filter(({ id }) => id.includes(runOptions.scenarioFilter as string));
  if (runOptions.scenarioFilter !== undefined && selected.length === 0)
    throw new ConformanceRunnerError("scenarioFilter matched no applicable scenarios");
  if (runOptions.scenarioSelection !== undefined) {
    const applicable = new Set(metadata.map(({ id }) => id));
    const missing = runOptions.scenarioSelection.filter((id) => !applicable.has(id));
    if (missing.length > 0)
      throw new ConformanceRunnerError(
        `scenarioSelection names scenarios that are unknown or inapplicable: ${missing.join(", ")}`,
      );
    const requested = new Set(runOptions.scenarioSelection);
    // Catalog order is preserved: the selection names membership, not sequence.
    selected = metadata.filter(({ id }) => requested.has(id));
  }
  const results: ScenarioRunResult[] = [];
  const resultsById = new Map<string, ScenarioRunResult>();
  for (const [index, scenario] of selected.entries()) {
    if (runOptions.signal?.aborted === true) {
      for (const remaining of selected.slice(index)) results.push(stoppedScenarioResult(remaining));
      break;
    }
    const plan = byId.get(scenario.id);
    const scenarioResult =
      plan === undefined
        ? missingPlanResult(scenario)
        : (prerequisiteResultBeforeRun(scenario, plan, resultsById, catalog) ??
          (await runScenario(scenario, plan, runOptions)));
    results.push(scenarioResult);
    resultsById.set(scenarioResult.id, scenarioResult);
    if (mustStopMatrixAfter(scenarioResult)) {
      for (const remaining of selected.slice(results.length))
        results.push(stoppedScenarioResult(remaining));
      break;
    }
  }
  return {
    reportVersion: 3,
    scope: runOptions.scope,
    profile: runOptions.profile,
    seed: runOptions.seed,
    selectedScenarioIds: selected.map(({ id }) => id),
    ...(runOptions.scenarioFilter === undefined
      ? {}
      : { scenarioFilter: runOptions.scenarioFilter }),
    ...(runOptions.scenarioSelection === undefined
      ? {}
      : { scenarioSelection: runOptions.scenarioSelection }),
    artifacts: runOptions.artifactBundle.digests,
    declarations: { targetLabel: runOptions.declaredTargetLabel },
    scenarios: results,
    claimEligible: false,
  };
}

function mustStopMatrixAfter(result: ScenarioRunResult): boolean {
  const category = result.category;
  if (result.cleanupError !== undefined) return true;
  if (
    result.prerequisiteFailure?.phase === "recheck" &&
    result.prerequisiteFailure.category !== undefined
  )
    return true;
  switch (category) {
    case "aborted":
    case "cleanup":
    case "deadline":
    case "out-of-scope-target":
      return true;
    case undefined:
    case "not-implemented":
    case "not-run":
    case "observation-limit":
    case "wire-observation-unavailable":
      return false;
    default: {
      const exhaustive: never = category;
      void exhaustive;
      return true;
    }
  }
}

function snapshotRunOptions(options: ScenarioRunOptions): ScenarioRunOptions {
  const {
    scope,
    profile,
    seed,
    artifactBundle,
    execute,
    actionExecutor,
    harness,
    schemaValidator,
    scenarioFilter,
    scenarioSelection,
    signal,
    declaredTargetLabel,
    prepareTimeoutMs,
    requestTimeoutMs,
    cleanupTimeoutMs,
  } = options;
  return Object.freeze({
    scope,
    profile,
    seed,
    artifactBundle,
    execute,
    harness,
    declaredTargetLabel,
    ...(schemaValidator === undefined ? {} : { schemaValidator }),
    ...(actionExecutor === undefined ? {} : { actionExecutor }),
    ...(scenarioFilter === undefined ? {} : { scenarioFilter }),
    ...(scenarioSelection === undefined
      ? {}
      : { scenarioSelection: Object.freeze([...scenarioSelection]) }),
    ...(signal === undefined ? {} : { signal }),
    ...(prepareTimeoutMs === undefined ? {} : { prepareTimeoutMs }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(cleanupTimeoutMs === undefined ? {} : { cleanupTimeoutMs }),
  });
}

async function runScenario(
  metadata: ScenarioMetadata,
  scenario: ExecutableScenario,
  options: ScenarioRunOptions,
): Promise<ScenarioRunResult> {
  if (metadata.requiredProfile !== scenario.requiredProfile)
    return result(
      metadata,
      scenario,
      "harness-error",
      "catalog and executable plan disagree on requiredProfile",
      [],
    );
  if (!profileIncludes(options.profile, scenario.requiredProfile))
    return {
      id: scenario.id,
      requiredProfile: scenario.requiredProfile,
      state: "unsupported-profile",
      requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
      reason: "scenario requires a higher cumulative profile",
      exchanges: [],
    };
  const controller = new AbortController();
  const detach = relayAbort(options.signal, controller);
  const exchanges: ObservedExchange[] = [];
  const actions: ObservedAction[] = [];
  let fixturePreparationSettled = true;
  const actionSettlement = { settled: true, description: "HTTP exchange" };
  let runResult: ScenarioRunResult;
  try {
    if (controller.signal.aborted)
      throw new ConformanceRunnerError("scenario run was aborted before preparation");
    const prepareDeadline = createDeadlineSignal(options.prepareTimeoutMs ?? 30_000);
    const prepareSignal = AbortSignal.any([controller.signal, prepareDeadline.signal]);
    let preparation: FixturePreparation;
    fixturePreparationSettled = false;
    try {
      const preparationOperation = Promise.resolve()
        .then(() =>
          options.harness.prepare(
            scenario,
            options.scope,
            options.seed,
            options.artifactBundle.fixture,
            prepareSignal,
          ),
        )
        .then(
          (value) => {
            fixturePreparationSettled = true;
            return value;
          },
          (error: unknown) => {
            fixturePreparationSettled = true;
            throw error;
          },
        );
      preparation = snapshotFixturePreparation(
        await enforceDeadline(preparationOperation, prepareSignal, () =>
          controller.signal.aborted
            ? new ConformanceRunnerError("scenario run was aborted during preparation")
            : new ScenarioDeadlineError("fixture preparation timed out"),
        ),
      );
    } catch (error) {
      if (prepareDeadline.signal.aborted && !controller.signal.aborted)
        throw new ScenarioDeadlineError("fixture preparation timed out");
      throw error;
    } finally {
      prepareDeadline.clear();
    }
    validateFixturePreparation(preparation, options.artifactBundle.fixture, options.scope);
    const capabilities = new Set(preparation.capabilities);
    const missingSetup = scenario.setup.requires.filter(
      (capability) => !capabilities.has(capability),
    );
    const missingApplicability = scenario.applicability.requires.filter(
      (capability) => !capabilities.has(capability),
    );
    // An inapplicable scenario must not demand its bindings: the gate runs
    // before binding-flow validation so honest absence is not a harness error.
    if (missingSetup.length === 0 && missingApplicability.length === 0)
      validateScenarioBindingFlow(scenario, preparation.bindings ?? {}, options.scope);
    if (missingSetup.length > 0) {
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        `missing harness capabilities: ${missingSetup.join(", ")}`,
        exchanges,
      );
    } else if (missingApplicability.length > 0) {
      runResult = result(
        metadata,
        scenario,
        "not-applicable",
        `harness does not provide optional capabilities: ${missingApplicability.join(", ")}`,
        exchanges,
      );
    } else {
      const bindings = new Map<string, JsonValue>([
        ["scope", options.scope],
        ...Object.entries(preparation.bindings ?? {}),
      ]);
      const priorResponses = new Map<string, ComparableResponse>();
      for (const action of scenarioActionSequence(scenario)) {
        actionSettlement.settled = true;
        actionSettlement.description =
          action.family === "http" ? "HTTP exchange" : "action execution";
        try {
          await runScenarioAction(
            action,
            bindings,
            exchanges,
            actions,
            options.execute,
            options.actionExecutor,
            options.schemaValidator,
            options.artifactBundle.fixture,
            options.scope,
            options.profile,
            controller.signal,
            options.requestTimeoutMs ?? 30_000,
            actionSettlement,
            priorResponses,
          );
        } catch (error) {
          if (action.prerequisiteScenario !== undefined)
            throw new ScenarioPrerequisiteRecheckFailure(action.prerequisiteScenario, error);
          throw error;
        }
      }
      runResult = result(metadata, scenario, "pass", undefined, exchanges);
    }
  } catch (error) {
    if (controller.signal.aborted)
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        "scenario run was aborted",
        exchanges,
        "aborted",
      );
    else if (error instanceof ScenarioPrerequisiteRecheckFailure)
      runResult = prerequisiteFailureResult(
        metadata,
        scenario,
        error,
        exchanges,
        options.artifactBundle.catalog,
      );
    else if (error instanceof ScenarioActionExecutorMissingError)
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        error.message,
        exchanges,
        "not-implemented",
      );
    else if (error instanceof ScenarioAssertionFailure)
      runResult = result(metadata, scenario, "fail", error.message, exchanges);
    else if (error instanceof ScenarioActionExecutionFailure)
      runResult = result(metadata, scenario, "fail", error.message, exchanges);
    else if (error instanceof ScenarioUnsupportedProfileError)
      runResult = result(
        metadata,
        scenario,
        "unsupported-profile",
        "target advertised an unsupported profile",
        exchanges,
      );
    else if (error instanceof ScenarioOutOfScopeTargetError)
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        error.message,
        exchanges,
        "out-of-scope-target",
      );
    else if (error instanceof ScenarioObservationFailure)
      runResult = result(metadata, scenario, "fail", error.message, exchanges);
    else if (error instanceof ScenarioObservationLimitError)
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        error.message,
        exchanges,
        "observation-limit",
      );
    else if (error instanceof ScenarioWireObservationUnavailableError)
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        error.message,
        exchanges,
        "wire-observation-unavailable",
      );
    else if (error instanceof HttpTransportError && error.category === "abort")
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        "scenario run was aborted",
        exchanges,
        "aborted",
      );
    else if (error instanceof ScenarioDeadlineError)
      runResult = result(metadata, scenario, "harness-error", error.message, exchanges, "deadline");
    else if (error instanceof HttpTransportError && error.category === "configuration")
      runResult = result(
        metadata,
        scenario,
        "harness-error",
        "HTTP executor configuration failed",
        exchanges,
      );
    else if (error instanceof HttpTransportError) {
      const harnessCategory =
        error.category === "timeout"
          ? ("deadline" as const)
          : isTransportObservationLimit(error.category)
            ? ("observation-limit" as const)
            : undefined;
      runResult = result(
        metadata,
        scenario,
        harnessCategory === undefined ? "fail" : "harness-error",
        transportFailureMessage(error.category),
        exchanges,
        harnessCategory,
      );
    } else if (error instanceof ConformanceRunnerError)
      runResult = result(metadata, scenario, "harness-error", error.message, exchanges);
    else
      runResult = result(metadata, scenario, "harness-error", "scenario harness failed", exchanges);
  }
  if (actions.length > 0) runResult = { ...runResult, actions };
  if (!fixturePreparationSettled || !actionSettlement.settled) {
    detach();
    return {
      ...runResult,
      cleanupError: !fixturePreparationSettled
        ? "cleanup skipped because fixture preparation did not settle"
        : `cleanup skipped because an ${actionSettlement.description} did not settle`,
    };
  }
  const cleanupDeadline = createDeadlineSignal(options.cleanupTimeoutMs ?? 10_000);
  const cleanupSignal = cleanupDeadline.signal;
  try {
    await enforceDeadline(
      options.harness.cleanup(scenario, options.scope, cleanupSignal),
      cleanupSignal,
      () => new ScenarioDeadlineError("fixture cleanup timed out"),
    );
  } catch {
    const timedOut = cleanupDeadline.signal.aborted;
    runResult = {
      ...runResult,
      ...(runResult.state === "pass" ? { state: "harness-error" as const } : {}),
      ...(runResult.category === undefined
        ? { category: timedOut ? ("deadline" as const) : ("cleanup" as const) }
        : {}),
      cleanupError: timedOut ? "cleanup timed out" : "cleanup failed",
    };
  } finally {
    cleanupDeadline.clear();
    detach();
  }
  return runResult;
}

function scenarioActionSequence(scenario: ExecutableScenario): readonly ScenarioAction[] {
  return scenario.actions ?? scenario.requests.map((request) => ({ ...request, family: "http" }));
}

async function runScenarioAction(
  action: ScenarioAction,
  bindings: Map<string, JsonValue>,
  exchanges: ObservedExchange[],
  actions: ObservedAction[],
  execute: HttpExchangeExecutor,
  actionExecutor: ScenarioActionExecutor | undefined,
  schemaValidator: SchemaValidator | undefined,
  fixture: ConformanceFixture,
  scope: string,
  runProfile: ScenarioRunOptions["profile"],
  signal: AbortSignal,
  timeoutMs: number,
  settlement: { settled: boolean; description: string },
  priorResponses: Map<string, ComparableResponse>,
): Promise<void> {
  if (action.family === "http") {
    await runRequest(
      action,
      bindings,
      exchanges,
      execute,
      schemaValidator,
      fixture,
      scope,
      runProfile,
      signal,
      timeoutMs,
      settlement,
      priorResponses,
    );
    return;
  }
  await runProgrammaticAction(
    action,
    bindings,
    actions,
    actionExecutor,
    schemaValidator,
    fixture,
    scope,
    runProfile,
    signal,
    timeoutMs,
    settlement,
  );
}

async function runProgrammaticAction(
  action: ScenarioProgrammaticAction,
  bindings: Map<string, JsonValue>,
  actions: ObservedAction[],
  execute: ScenarioActionExecutor | undefined,
  schemaValidator: SchemaValidator | undefined,
  fixture: ConformanceFixture,
  scope: string,
  runProfile: ScenarioRunOptions["profile"],
  signal: AbortSignal,
  timeoutMs: number,
  settlement: { settled: boolean },
): Promise<void> {
  const observed: ObservedAction = {
    action: { id: action.id, family: action.family, operation: action.operation },
    assertions: [],
  };
  actions.push(observed);
  if (execute === undefined) {
    actions[actions.length - 1] = {
      ...observed,
      executionError: {
        category: "not-implemented",
        message: "no programmable action executor was configured",
      },
    };
    throw new ScenarioActionExecutorMissingError(
      `action '${action.id}' requires a programmable action executor`,
    );
  }
  const deadline = createDeadlineSignal(timeoutMs);
  const actionSignal = AbortSignal.any([signal, deadline.signal]);
  let output: unknown;
  try {
    settlement.settled = false;
    const execution: ScenarioActionExecution = {
      family: action.family,
      operation: action.operation,
      scope,
      bindings: Object.freeze(
        Object.fromEntries(
          [...bindings].map(([binding, value]) => [binding, cloneRuntimeJson(value)]),
        ),
      ),
      input: materializeActionInput(action, fixture),
      signal: actionSignal,
    };
    const operation = Promise.resolve()
      .then(() => execute(execution))
      .then(
        (value) => {
          settlement.settled = true;
          return value;
        },
        (error: unknown) => {
          settlement.settled = true;
          throw error;
        },
      );
    output = await enforceDeadline(operation, actionSignal, () =>
      signal.aborted
        ? new ScenarioActionExecutionFailure("action execution was aborted")
        : new ScenarioDeadlineError("action execution timed out"),
    );
  } catch (error) {
    const failure = signal.aborted
      ? new ScenarioActionExecutionFailure("action execution was aborted", { cause: error })
      : deadline.signal.aborted
        ? new ScenarioDeadlineError("action execution timed out", { cause: error })
        : error instanceof ScenarioDeadlineError
          ? error
          : new ScenarioActionExecutionFailure("action execution failed", { cause: error });
    actions[actions.length - 1] = {
      ...observed,
      executionError: {
        category: failure instanceof ScenarioDeadlineError ? "timeout" : "execution",
        message: failure.message,
      },
    };
    throw failure;
  } finally {
    deadline.clear();
  }

  const snapshot = snapshotActionOutput(output);
  const next: ObservedAction = { ...observed, output: { kind: "json" } };
  actions[actions.length - 1] = next;
  const body: ObservedBody = { kind: "json", value: snapshot };
  const outcomes = action.assertions.map((assertion) =>
    evaluateAssertion(
      assertion,
      { url: scope, status: 200, headers: {}, bodyText: "" },
      body,
      schemaValidator,
      fixture,
      scope,
      runProfile,
      new Map(),
      {},
    ),
  );
  actions[actions.length - 1] = { ...next, assertions: outcomes };
  if (outcomes.some(({ passed }) => !passed))
    throw new ScenarioAssertionFailure(
      outcomes
        .filter(({ passed }) => !passed)
        .map(({ message }) => message ?? "assertion failed")
        .join("; "),
    );
  for (const capture of action.captures) {
    const value = jsonPointer(snapshot, capture.from.pointer);
    if (value === undefined)
      throw new ScenarioObservationFailure(
        `capture '${capture.binding}' JSON pointer did not resolve`,
      );
    bindings.set(capture.binding, cloneRuntimeJson(value as JsonValue));
  }
}

async function runRequest(
  request: ScenarioRequest,
  bindings: Map<string, JsonValue>,
  exchanges: ObservedExchange[],
  execute: HttpExchangeExecutor,
  schemaValidator: SchemaValidator | undefined,
  fixture: ConformanceFixture,
  scope: string,
  runProfile: ScenarioRunOptions["profile"],
  signal: AbortSignal,
  requestTimeoutMs: number,
  settlement: { settled: boolean },
  priorResponses: Map<string, ComparableResponse>,
): Promise<void> {
  const url = resolveTarget(request, bindings, scope);
  const observed: ObservedExchange = {
    request: {
      id: request.id,
      method: request.method,
      url: redactUrl(url),
      headers: redactHeaders(request.headers ?? {}),
    },
    assertions: [],
  };
  exchanges.push(observed);
  let rawRequestTarget: Uint8Array | undefined;
  if (request.rawRequestTarget !== undefined) {
    try {
      rawRequestTarget = materializeScenarioRawRequestTarget(request.rawRequestTarget, url);
    } catch (error) {
      throw new ConformanceRunnerError("raw request-target materialization failed", {
        cause: error,
      });
    }
  }
  let response: HttpExchangeResponse;
  const requestDeadline = createDeadlineSignal(requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, requestDeadline.signal]);
  try {
    settlement.settled = false;
    const executionOperation = Promise.resolve()
      .then(() =>
        execute({
          method: request.method,
          url,
          headers: request.headers ?? {},
          signal: requestSignal,
          ...(rawRequestTarget === undefined ? {} : { rawRequestTarget }),
        }),
      )
      .then(
        (value) => {
          settlement.settled = true;
          return value;
        },
        (error: unknown) => {
          settlement.settled = true;
          throw error;
        },
      );
    response = await enforceDeadline(executionOperation, requestSignal, () =>
      signal.aborted
        ? new HttpTransportError("abort", "HTTP exchange was aborted")
        : new HttpTransportError("timeout", "HTTP exchange timed out"),
    );
  } catch (error) {
    const transport = signal.aborted
      ? new HttpTransportError("abort", "HTTP exchange was aborted", { cause: error })
      : requestDeadline.signal.aborted
        ? new HttpTransportError("timeout", "HTTP exchange timed out", { cause: error })
        : error instanceof HttpTransportError
          ? error
          : new HttpTransportError("network", "HTTP exchange failed", { cause: error });
    exchanges[exchanges.length - 1] = {
      ...observed,
      transportError: {
        category: transport.category,
        message: transportFailureMessage(transport.category),
      },
    };
    throw transport;
  } finally {
    requestDeadline.clear();
  }
  if (!isHttpUrl(response.url))
    throw new ScenarioObservationFailure("HTTP response did not expose an absolute HTTP(S) URL");
  assertConfinedToScope(response.url, scope, `request '${request.id}' response`);
  const wireOutcomes = evaluateRawWireAssertions(request.assertions, response, fixture);
  if ([...wireOutcomes.values()].some(({ passed }) => !passed)) {
    const assertions = request.assertions.flatMap((assertion) => {
      const wireOutcome = wireOutcomes.get(assertion.id);
      return wireOutcome === undefined ? [] : [wireOutcome];
    });
    exchanges[exchanges.length - 1] = { ...observed, assertions };
    throw new ScenarioAssertionFailure(
      assertions
        .filter(({ passed }) => !passed)
        .map(({ message }) => message ?? "assertion failed")
        .join("; "),
    );
  }
  const bodyObservation = parseObservedBody(response.bodyText);
  const responseHeaders = normalizeHeaders(response.headers);
  if (
    response.bodyOctets !== undefined &&
    (!Number.isSafeInteger(response.bodyOctets) || response.bodyOctets < 0)
  )
    throw new ConformanceRunnerError("HTTP executor returned an invalid body-octet count");
  if (
    response.bodyOctets !== undefined &&
    response.bodyOctets !== new TextEncoder().encode(response.bodyText).byteLength
  )
    throw new ConformanceRunnerError(
      "HTTP executor body-octet count did not match its decoded response body",
    );
  const effectiveRequest = response.effectiveRequest;
  if (effectiveRequest !== undefined) assertEffectiveRequest(effectiveRequest, url, scope);
  const next: ObservedExchange = {
    ...observed,
    ...(effectiveRequest === undefined
      ? {}
      : {
          request: {
            ...observed.request,
            url: redactUrl(effectiveRequest.url),
            headers: redactHeaders(effectiveRequest.headers),
            ...(effectiveRequest.headersTransmitted === true
              ? { wireHeadersObserved: true as const }
              : {}),
          },
        }),
    response: {
      url: redactUrl(response.url),
      status: response.status,
      headers: redactHeaders(responseHeaders),
      decodedBodyBytes: new TextEncoder().encode(response.bodyText).byteLength,
      ...(response.bodyOctets === undefined ? {} : { wireBodyOctets: response.bodyOctets }),
      bodyKind: bodyObservation.kind,
    },
  };
  exchanges[exchanges.length - 1] = next;
  if (bodyObservation.kind === "unrepresentable-json") {
    if (bodyObservation.attribution === "runner-limit")
      throw new ScenarioObservationLimitError(bodyObservation.reason);
  }
  const outcomes = request.assertions.map(
    (assertion) =>
      wireOutcomes.get(assertion.id) ??
      evaluateAssertion(
        assertion,
        { ...response, headers: responseHeaders },
        bodyObservation,
        schemaValidator,
        fixture,
        scope,
        runProfile,
        priorResponses,
        request.headers ?? {},
      ),
  );
  exchanges[exchanges.length - 1] = { ...next, assertions: outcomes };
  if (outcomes.some(({ passed }) => !passed))
    throw new ScenarioAssertionFailure(
      outcomes
        .filter(({ passed }) => !passed)
        .map(({ message }) => message ?? "assertion failed")
        .join("; "),
    );
  for (const capture of request.captures)
    bindings.set(
      capture.binding,
      captureValue(capture, { ...response, headers: responseHeaders }, bodyObservation, scope),
    );
  priorResponses.set(request.id, {
    status: response.status,
    headers: responseHeaders,
  });
}

interface ComparableResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

function evaluateRawWireAssertions(
  assertions: readonly ScenarioAssertion[],
  response: HttpExchangeResponse,
  fixture: ConformanceFixture,
): ReadonlyMap<string, AssertionOutcome> {
  const selected = assertions.filter(
    (assertion): assertion is Extract<ScenarioAssertion, { readonly kind: "wire-not-contains" }> =>
      assertion.kind === "wire-not-contains",
  );
  if (selected.length === 0) return new Map();
  if (response.wireResponseBytes === undefined)
    throw new ScenarioWireObservationUnavailableError(
      "raw-wire noncontainment assertion requires exact response bytes",
    );
  const wireBytes = copyBoundedWireResponseBytes(response.wireResponseBytes);
  return new Map(
    selected.map((assertion) => {
      const sentinel = jsonPointer(fixture, assertion.fixturePointer);
      if (typeof sentinel !== "string" || sentinel.length === 0)
        throw new ConformanceRunnerError("private wire sentinel was unavailable");
      const sentinelBytes = new TextEncoder().encode(sentinel);
      return [
        assertion.id,
        outcome(
          assertion.id,
          !containsByteSequence(wireBytes, sentinelBytes),
          "raw HTTP response contained a private fixture sentinel",
        ),
      ] as const;
    }),
  );
}

function copyBoundedWireResponseBytes(value: Uint8Array): Uint8Array {
  let byteLength: number;
  try {
    if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined || TYPED_ARRAY_TAG_GETTER === undefined)
      throw new Error("missing intrinsic");
    const tag = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) as unknown;
    if (tag !== "Uint8Array") throw new Error("not Uint8Array");
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  } catch {
    throw new ConformanceRunnerError("HTTP executor returned invalid raw-wire evidence");
  }
  if (byteLength > RAW_WIRE_EVIDENCE_MAX_BYTES)
    throw new ConformanceRunnerError("HTTP executor raw-wire evidence exceeded its safety bound");
  const copy = new Uint8Array(byteLength);
  try {
    Reflect.apply(UINT8_ARRAY_SET, copy, [value]);
  } catch {
    throw new ConformanceRunnerError("HTTP executor returned invalid raw-wire evidence");
  }
  return copy;
}

function containsByteSequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0) return true;
  const finalStart = haystack.byteLength - needle.byteLength;
  for (let start = 0; start <= finalStart; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.byteLength; offset += 1)
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    if (matched) return true;
  }
  return false;
}

function evaluateAssertion(
  assertion: ScenarioAssertion,
  response: HttpExchangeResponse,
  body: ObservedBody,
  schemaValidator: SchemaValidator | undefined,
  fixture: ConformanceFixture,
  scope: string,
  runProfile: ScenarioRunOptions["profile"],
  priorResponses: ReadonlyMap<string, ComparableResponse>,
  requestedHeaders: Readonly<Record<string, string>>,
): AssertionOutcome {
  if (assertion.kind === "wire-not-contains")
    throw new ConformanceRunnerError("raw-wire assertion was not evaluated before normalization");
  if (assertion.kind === "status") {
    const expected =
      assertion.equals === undefined ? (assertion.oneOf as readonly number[]) : [assertion.equals];
    return outcome(
      assertion.id,
      expected.includes(response.status),
      `expected status ${expected.join(" or ")}, got ${response.status}`,
    );
  }
  if (assertion.kind === "header") {
    if (assertion.absent === true && assertion.name.startsWith("access-control-")) {
      const requestedOrigin = requestedHeaders.origin;
      if (requestedOrigin === undefined || requestedOrigin.length === 0)
        throw new ScenarioWireObservationUnavailableError(
          "CORS-header absence assertion requires matching nonempty Origin evidence",
        );
      if (response.effectiveRequest?.headersTransmitted !== true)
        throw new ScenarioWireObservationUnavailableError(
          "CORS-header absence assertion requires serialized wire-request evidence",
        );
      requireMatchingEffectiveHeader(response.effectiveRequest.headers, "origin", requestedOrigin);
      const requestedPreflightMethod = requestedHeaders["access-control-request-method"];
      if (requestedPreflightMethod !== undefined)
        requireMatchingEffectiveHeader(
          response.effectiveRequest.headers,
          "access-control-request-method",
          requestedPreflightMethod,
        );
    }
    const actual = response.headers[assertion.name.toLowerCase()];
    if (assertion.absent !== undefined)
      return outcome(
        assertion.id,
        assertion.absent === (actual === undefined),
        `header '${assertion.name}' presence did not match`,
      );
    if (assertion.equals !== undefined)
      return outcome(
        assertion.id,
        actual === assertion.equals,
        `header '${assertion.name}' did not equal the expected value`,
      );
    if (assertion.equalsBinding !== undefined) {
      const bound = (fixture.bindings as Readonly<Record<string, unknown>>)[
        assertion.equalsBinding
      ];
      if (typeof bound !== "string")
        throw new ConformanceRunnerError(
          `header assertion '${assertion.id}' references unknown binding '${assertion.equalsBinding}'`,
        );
      const expected = isHttpUrl(bound) ? new URL(bound).href : new URL(bound, scope).href;
      assertConfinedToScope(expected, scope, `header assertion '${assertion.id}' binding`);
      return outcome(
        assertion.id,
        actual === expected,
        `header '${assertion.name}' did not equal the bound canonical URL`,
      );
    }
    return outcome(
      assertion.id,
      actual?.includes(assertion.contains as string) === true,
      `header '${assertion.name}' did not contain the expected value`,
    );
  }
  if (assertion.kind === "header-tokens") {
    const actual = response.headers[assertion.name.toLowerCase()];
    const normalizeToken = (token: string): string =>
      assertion.caseInsensitive === true ? token.toLowerCase() : token;
    const tokens =
      actual === undefined
        ? []
        : actual
            .split(",")
            .map((token) => token.trim())
            .filter(Boolean)
            .map(normalizeToken);
    const expected = new Set(assertion.includes.map(normalizeToken));
    const optional = new Set((assertion.optional ?? []).map(normalizeToken));
    const observed = new Set(tokens);
    const includesAll = [...expected].every((token) => observed.has(token));
    const allowed = new Set([...expected, ...optional]);
    const noAdditional =
      assertion.allowsAdditional || [...observed].every((token) => allowed.has(token));
    return outcome(
      assertion.id,
      includesAll && noAdditional,
      `header '${assertion.name}' tokens did not match`,
    );
  }
  if (assertion.kind === "media-type") {
    const actual = response.headers["content-type"];
    const mediaType = actual?.split(";", 1)[0]?.trim().toLowerCase();
    return outcome(
      assertion.id,
      mediaType === assertion.equals,
      `response media type did not equal '${assertion.equals}'`,
    );
  }
  if (assertion.kind === "body-absent") {
    if (response.bodyOctets === undefined)
      throw new ScenarioWireObservationUnavailableError(
        "body-absence assertion requires raw wire-body observation",
      );
    return outcome(assertion.id, response.bodyOctets === 0, "expected no response body octets");
  }
  if (assertion.kind === "response-metadata-equals") {
    const expected = priorResponses.get(assertion.request);
    if (expected === undefined)
      throw new ConformanceRunnerError(
        `response metadata assertion references unavailable request '${assertion.request}'`,
      );
    const headersMatch = assertion.headers.every((name) => {
      const prior = expected.headers[name];
      const current = response.headers[name];
      return current === prior;
    });
    return outcome(
      assertion.id,
      response.status === expected.status && headersMatch,
      `response metadata did not match request '${assertion.request}'`,
    );
  }
  if (assertion.kind === "json-equals") {
    if (body.kind !== "json") return outcome(assertion.id, false, observedBodyIssue(body));
    const expected =
      assertion.fixturePointer === undefined
        ? assertion.value
        : jsonPointer(fixture, assertion.fixturePointer);
    if (expected === undefined)
      throw new ConformanceRunnerError("fixture oracle pointer did not resolve");
    if (
      assertion.normalize === "iso-timestamps" &&
      (!hasCanonicalIsoTimestamps(body.value, assertion.timestampPointers ?? []) ||
        !hasCanonicalIsoTimestamps(expected, assertion.timestampPointers ?? []))
    )
      return outcome(
        assertion.id,
        false,
        "declared timestamp pointer was absent or not a canonical ISO timestamp",
      );
    const actual =
      assertion.normalize === "iso-timestamps"
        ? normalizeIsoTimestampsAtPointers(body.value, assertion.timestampPointers ?? [])
        : body.value;
    const normalizedExpected =
      assertion.normalize === "iso-timestamps"
        ? normalizeIsoTimestampsAtPointers(expected, assertion.timestampPointers ?? [])
        : expected;
    return outcome(
      assertion.id,
      deepEqual(actual, normalizedExpected),
      "JSON body did not equal the expected value",
    );
  }
  if (assertion.kind === "json-pointer") {
    if (body.kind !== "json") return outcome(assertion.id, false, observedBodyIssue(body));
    const value = jsonPointer(body.value, assertion.pointer);
    const exists = value !== undefined;
    const fixtureExpected =
      assertion.fixturePointer === undefined
        ? undefined
        : jsonPointer(fixture, assertion.fixturePointer);
    if (assertion.fixturePointer !== undefined && fixtureExpected === undefined)
      throw new ConformanceRunnerError("fixture oracle pointer did not resolve");
    let normalizedValue = value;
    let normalizedFixtureExpected = fixtureExpected;
    let normalizedEquals = assertion.equals;
    if (assertion.normalize === "scope-relative-url") {
      try {
        normalizedValue = scopeRelativeUrl(value, scope);
      } catch {
        normalizedValue = undefined;
      }
    } else if (assertion.normalize === "iso-timestamps") {
      const pointers = assertion.timestampPointers ?? [];
      const expected =
        assertion.fixturePointer !== undefined ? normalizedFixtureExpected : assertion.equals;
      if (
        !hasCanonicalIsoTimestamps(value, pointers) ||
        !hasCanonicalIsoTimestamps(expected, pointers)
      )
        return outcome(
          assertion.id,
          false,
          "declared timestamp pointer was absent or not a canonical ISO timestamp",
        );
      normalizedValue = normalizeIsoTimestampsAtPointers(value, pointers);
      normalizedFixtureExpected = normalizeIsoTimestampsAtPointers(fixtureExpected, pointers);
      normalizedEquals = normalizeIsoTimestampsAtPointers(
        assertion.equals,
        pointers,
      ) as typeof assertion.equals;
    }
    return assertion.exists
      ? outcome(
          assertion.id,
          exists &&
            (assertion.equalsRunProfile === true
              ? normalizedValue === runProfile
              : assertion.fixturePointer !== undefined
                ? deepEqual(normalizedValue, normalizedFixtureExpected)
                : normalizedEquals === undefined || deepEqual(normalizedValue, normalizedEquals)),
          "JSON pointer was absent or mismatched",
        )
      : outcome(assertion.id, !exists, "JSON pointer unexpectedly existed");
  }
  if (assertion.kind === "json-array-set") {
    if (body.kind !== "json") return outcome(assertion.id, false, observedBodyIssue(body));
    const array = jsonPointer(body.value, assertion.pointer);
    if (!Array.isArray(array)) return outcome(assertion.id, false, "JSON pointer was not an array");
    const actual = array.map((item) => jsonPointer(item, assertion.itemPointer));
    if (actual.some((item) => item === undefined))
      return outcome(assertion.id, false, "array item projection was absent");
    let normalized: unknown[] = actual;
    if (assertion.normalize !== undefined) {
      try {
        normalized = actual.map((item) =>
          assertion.normalize === "scope-relative-url"
            ? scopeRelativeUrl(item, scope)
            : scopeRelativeOrAbsoluteUri(item, scope),
        );
      } catch {
        return outcome(assertion.id, false, "array item was not a valid URI for normalization");
      }
    }
    let expected: readonly unknown[];
    if (assertion.fixturePointer === undefined) expected = assertion.equals;
    else {
      const fixtureExpected = jsonPointer(fixture, assertion.fixturePointer);
      if (!Array.isArray(fixtureExpected))
        throw new ConformanceRunnerError("fixture oracle pointer did not resolve to an array");
      expected = fixtureExpected;
    }
    const passed = multisetEquals(normalized, expected);
    return outcome(assertion.id, passed, "array projection did not match the expected set");
  }
  if (assertion.kind === "json-array-tuples") {
    if (body.kind !== "json") return outcome(assertion.id, false, observedBodyIssue(body));
    const array = jsonPointer(body.value, assertion.pointer);
    if (!Array.isArray(array)) return outcome(assertion.id, false, "JSON pointer was not an array");
    let actual: unknown[][];
    try {
      actual = array.map((item) =>
        assertion.projections.map((projection) => {
          const value = jsonPointer(item, projection.pointer);
          if (value === undefined) throw new Error("array tuple projection was absent");
          if (projection.normalize === "scope-relative-url") return scopeRelativeUrl(value, scope);
          if (projection.normalize === "scope-relative-or-absolute-uri")
            return scopeRelativeOrAbsoluteUri(value, scope);
          if (projection.normalize === "endpoint-uri") {
            const isPin = typeof value === "object" && value !== null && !Array.isArray(value);
            return scopeRelativeOrAbsoluteUri(
              isPin ? (value as { readonly uri?: unknown }).uri : value,
              scope,
            );
          }
          if (projection.normalize === "endpoint-revision") {
            if (typeof value === "string") return "";
            const revision = (value as { readonly revision?: unknown }).revision;
            if (typeof revision !== "string")
              throw new Error("endpoint pin revision was not a string");
            return revision;
          }
          return value;
        }),
      );
    } catch (error) {
      return outcome(
        assertion.id,
        false,
        error instanceof Error ? error.message : "array tuple projection failed",
      );
    }
    let expected: readonly unknown[];
    if (assertion.fixturePointer === undefined) expected = assertion.equals;
    else {
      const fixtureExpected = jsonPointer(fixture, assertion.fixturePointer);
      if (
        !Array.isArray(fixtureExpected) ||
        fixtureExpected.some(
          (tuple) =>
            !Array.isArray(tuple) ||
            tuple.length !== assertion.projections.length ||
            tuple.some(
              (value, index) =>
                assertion.projections[index]?.normalize !== undefined && typeof value !== "string",
            ),
        )
      )
        throw new ConformanceRunnerError("fixture oracle pointer did not resolve to valid tuples");
      expected = fixtureExpected;
    }
    return outcome(
      assertion.id,
      multisetEquals(actual, expected),
      "array tuples did not match the expected multiset",
    );
  }
  if (body.kind !== "json") return outcome(assertion.id, false, observedBodyIssue(body));
  if (schemaValidator === undefined)
    throw new ConformanceRunnerError("schema assertion requires an offline schema validator");
  const failures = schemaValidator.validate(assertion.schema, body.value);
  return {
    id: assertion.id,
    passed: failures.length === 0,
    ...(failures.length === 0
      ? {}
      : {
          message: failures.map(({ message }) => `response body ${message}`).join("; "),
        }),
  };
}

function normalizeIsoTimestampsAtPointers(value: unknown, pointers: readonly string[]): unknown {
  return pointers.reduce(
    (current, pointer) => normalizeIsoTimestampAtPointer(current, pointer),
    value,
  );
}

function hasCanonicalIsoTimestamps(value: unknown, pointers: readonly string[]): boolean {
  return pointers.every((pointer) => {
    const candidate = jsonPointer(value, pointer);
    return typeof candidate === "string" && isCanonicalIsoTimestamp(candidate);
  });
}

function normalizeIsoTimestampAtPointer(value: unknown, pointer: string): unknown {
  const segments =
    pointer === ""
      ? []
      : pointer
          .slice(1)
          .split("/")
          .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  return normalizeIsoTimestampAtSegments(value, segments, 0);
}

function normalizeIsoTimestampAtSegments(
  value: unknown,
  segments: readonly string[],
  index: number,
): unknown {
  if (index === segments.length)
    return typeof value === "string" && isCanonicalIsoTimestamp(value) ? "<TIMESTAMP>" : value;
  if (typeof value !== "object" || value === null) return value;
  const key = segments[index] as string;
  if (Array.isArray(value)) {
    if (!/^(?:0|[1-9]\d*)$/.test(key)) return value;
    const arrayIndex = Number(key);
    if (arrayIndex >= value.length) return value;
    const normalized = normalizeIsoTimestampAtSegments(value[arrayIndex], segments, index + 1);
    if (normalized === value[arrayIndex]) return value;
    const copy = [...value];
    copy[arrayIndex] = normalized;
    return copy;
  }
  if (!Object.hasOwn(value, key)) return value;
  const record = value as Record<string, unknown>;
  const normalized = normalizeIsoTimestampAtSegments(record[key], segments, index + 1);
  if (normalized === record[key]) return value;
  return Object.fromEntries(
    Object.entries(record).map(([entryKey, entry]) => [
      entryKey,
      entryKey === key ? normalized : entry,
    ]),
  );
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

function captureValue(
  capture: ScenarioCapture,
  response: HttpExchangeResponse,
  body: ObservedBody,
  scope: string,
): string {
  let value: unknown;
  if (capture.from.kind === "response-url") value = response.url;
  else if (capture.from.kind === "header-link")
    value = linkHeader(response.headers.link, capture.from.rel, response.url);
  else {
    if (body.kind !== "json") throw new ScenarioObservationFailure(observedBodyIssue(body));
    value = jsonPointer(body.value, capture.from.pointer);
  }
  if (typeof value !== "string" || !isHttpUrl(value))
    throw new ScenarioObservationFailure(
      `capture '${capture.binding}' did not produce an absolute HTTP(S) URL`,
    );
  try {
    assertConfinedToScope(value, scope, `capture '${capture.binding}'`);
  } catch (error) {
    if (capture.from.kind === "header-link")
      throw new ScenarioOutOfScopeTargetError(
        "discovered link target is outside the runner's safe fetch boundary",
        { cause: error },
      );
    throw error;
  }
  return value;
}

function resolveTarget(
  request: ScenarioRequest,
  bindings: ReadonlyMap<string, JsonValue>,
  scope: string,
): string {
  const base = bindings.get(request.target.binding);
  if (base === undefined)
    throw new ConformanceRunnerError(
      `request '${request.id}' references unknown binding '${request.target.binding}'`,
    );
  if (typeof base !== "string")
    throw new ConformanceRunnerError(
      `request '${request.id}' references non-URL binding '${request.target.binding}'`,
    );
  const boundUrl = isHttpUrl(base) ? new URL(base) : new URL(base, scope);
  const url = request.target.path === undefined ? boundUrl : new URL(request.target.path, boundUrl);
  for (const [key, value] of Object.entries(request.target.query ?? {})) {
    if (isRepeatedQueryKey(value)) {
      url.searchParams.delete(key);
      for (const occurrence of value) url.searchParams.append(key, occurrence);
      continue;
    }
    url.searchParams.set(key, resolveQueryValue(value, bindings, scope, request.id));
  }
  if (!isHttpUrl(url.href))
    throw new ConformanceRunnerError("scenario target must be an absolute HTTP(S) URL");
  assertConfinedToScope(url.href, scope, `request '${request.id}' target`);
  return url.href;
}

function isRepeatedQueryKey(
  value: ScenarioQueryValue,
): value is readonly [string, string, ...string[]] {
  return Array.isArray(value);
}

function resolveQueryValue(
  value: Exclude<ScenarioQueryValue, readonly string[]>,
  bindings: ReadonlyMap<string, JsonValue>,
  scope: string,
  requestId: string,
): string {
  if (typeof value === "string") return value;
  const bound = bindings.get(value.binding);
  if (bound === undefined)
    throw new ConformanceRunnerError(
      `request '${requestId}' query references unknown binding '${value.binding}'`,
    );
  if (typeof bound !== "string")
    throw new ConformanceRunnerError(
      `request '${requestId}' query references non-URL binding '${value.binding}'`,
    );
  const absolute = isHttpUrl(bound) ? new URL(bound).href : new URL(bound, scope).href;
  assertConfinedToScope(absolute, scope, `request '${requestId}' query binding`);
  if (value.representation === "absolute-url") return absolute;
  if (!absolute.startsWith(scope))
    throw new ConformanceRunnerError(
      `request '${requestId}' query binding cannot be represented relative to Scope`,
    );
  return absolute.slice(scope.length);
}

type ObservedBody =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid-json" }
  | { readonly kind: "json"; readonly value: JsonValue }
  | {
      readonly kind: "unrepresentable-json";
      readonly reason: string;
      readonly attribution: "runner-limit" | "target-value";
    };

function parseObservedBody(text: string): ObservedBody {
  if (text.length === 0) return { kind: "empty" };
  try {
    const value: unknown = JSON.parse(text);
    const issue = observedJsonIssue(value);
    return issue === undefined
      ? { kind: "json", value: value as JsonValue }
      : { kind: "unrepresentable-json", ...issue };
  } catch {
    return { kind: "invalid-json" };
  }
}

function snapshotActionOutput(value: unknown): JsonValue {
  let nodes = 0;
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown, depth: number): JsonValue => {
    nodes += 1;
    if (nodes > OBSERVED_JSON_MAX_NODES)
      throw new ScenarioObservationLimitError(
        `action output exceeded the runner node limit of ${OBSERVED_JSON_MAX_NODES}`,
      );
    if (depth > OBSERVED_JSON_MAX_DEPTH)
      throw new ScenarioObservationLimitError(
        `action output exceeded the runner depth limit of ${OBSERVED_JSON_MAX_DEPTH}`,
      );
    if (current === null || typeof current === "string" || typeof current === "boolean")
      return current;
    if (typeof current === "number") {
      if (Number.isFinite(current)) return current;
      throw new ScenarioObservationFailure("action output contained a non-finite number");
    }
    if (typeof current !== "object")
      throw new ScenarioObservationFailure("action output contained a non-JSON runtime value");
    if (ancestors.has(current))
      throw new ScenarioObservationFailure("action output contained a cyclic reference");

    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = Object.getPrototypeOf(current) as object | null;
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      throw new ScenarioObservationFailure("action output could not be safely inspected");
    }
    const isArray = Array.isArray(current);
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    )
      throw new ScenarioObservationFailure("action output contained a non-plain runtime object");
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol"))
      throw new ScenarioObservationFailure("action output contained a symbol-keyed property");

    ancestors.add(current);
    try {
      if (isArray) {
        const lengthDescriptor = descriptors.length;
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        )
          throw new ScenarioObservationFailure("action output array had an invalid length");
        const length = lengthDescriptor.value as number;
        if (length > OBSERVED_JSON_MAX_CONTAINER_ENTRIES)
          throw new ScenarioObservationLimitError(
            `action output exceeded the runner per-container entry limit of ${OBSERVED_JSON_MAX_CONTAINER_ENTRIES}`,
          );
        const allowedKeys = new Set([
          "length",
          ...Array.from({ length }, (_, index) => `${index}`),
        ]);
        if (keys.some((key) => typeof key !== "string" || !allowedKeys.has(key)))
          throw new ScenarioObservationFailure(
            "action output array contained a non-index property",
          );
        const snapshot: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[`${index}`];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
            throw new ScenarioObservationFailure(
              "action output array contained a hole or accessor property",
            );
          snapshot.push(visit(descriptor.value, depth + 1));
        }
        return snapshot;
      }
      if (keys.length > OBSERVED_JSON_MAX_CONTAINER_ENTRIES)
        throw new ScenarioObservationLimitError(
          `action output exceeded the runner per-container entry limit of ${OBSERVED_JSON_MAX_CONTAINER_ENTRIES}`,
        );
      const snapshot: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (
          typeof key !== "string" ||
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable
        )
          throw new ScenarioObservationFailure(
            "action output object contained an accessor or non-enumerable property",
          );
        snapshot[key] = visit(descriptor.value, depth + 1);
      }
      return snapshot;
    } finally {
      ancestors.delete(current);
    }
  };
  return visit(value, 0);
}

function cloneRuntimeJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeActionInput(
  action: ScenarioProgrammaticAction,
  fixture: ConformanceFixture,
): JsonValue {
  const selected =
    action.inputFixturePointer === undefined
      ? action.input
      : jsonPointer(fixture, action.inputFixturePointer);
  if (selected === undefined)
    throw new ConformanceRunnerError("programmable action fixture input did not resolve");
  return cloneRuntimeJson(selected as JsonValue);
}

function observedBodyIssue(body: Exclude<ObservedBody, { readonly kind: "json" }>): string {
  return body.kind === "unrepresentable-json" ? body.reason : "response body was not valid JSON";
}

function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
      current = current[Number(key)];
    } else {
      if (!Object.hasOwn(current, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

function linkHeader(value: string | undefined, rel: string, base: string): string | undefined {
  if (value === undefined) return undefined;
  for (const entry of parseLinkHeader(value)) {
    const relations =
      entry.parameters
        .filter(({ name }) => name === "rel")
        .at(-1)
        ?.value.split(/\s+/) ?? [];
    if (relations.some((candidate) => candidate.toLowerCase() === rel.toLowerCase())) {
      try {
        return new URL(entry.target, base).href;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function validateRunOptions(options: ScenarioRunOptions): void {
  try {
    assertFactoryCreatedArtifactBundle(options.artifactBundle);
  } catch (error) {
    throw new ConformanceRunnerError("artifact bundle failed runtime provenance validation", {
      cause: error,
    });
  }
  if (!isCanonicalScope(options.scope))
    throw new ConformanceRunnerError(
      "scope must be an absolute credential-free HTTP(S) URL ending in '/' without query or fragment",
    );
  if (!Number.isSafeInteger(options.seed) || options.seed < 0)
    throw new ConformanceRunnerError("seed must be a non-negative safe integer");
  if (options.seed !== options.artifactBundle.fixture.seed)
    throw new ConformanceRunnerError("seed must equal the bound fixture seed");
  if (options.scenarioFilter !== undefined && options.scenarioFilter.length === 0)
    throw new ConformanceRunnerError("scenarioFilter must not be empty");
  if (options.scenarioSelection !== undefined) {
    if (options.scenarioFilter !== undefined)
      throw new ConformanceRunnerError(
        "scenarioSelection and scenarioFilter are mutually exclusive",
      );
    if (options.scenarioSelection.length === 0)
      throw new ConformanceRunnerError("scenarioSelection must not be empty");
    if (new Set(options.scenarioSelection).size !== options.scenarioSelection.length)
      throw new ConformanceRunnerError("scenarioSelection must not repeat scenario ids");
  }
  if (
    !BINDING_ID_PATTERN.test(options.declaredTargetLabel) ||
    options.declaredTargetLabel.length > 128
  )
    throw new ConformanceRunnerError(
      "declaredTargetLabel must be 1..128 lowercase identifier characters",
    );
  for (const [name, value] of [
    ["prepareTimeoutMs", options.prepareTimeoutMs],
    ["requestTimeoutMs", options.requestTimeoutMs],
    ["cleanupTimeoutMs", options.cleanupTimeoutMs],
  ] as const)
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS)
    )
      throw new ConformanceRunnerError(
        `${name} must be an integer from 1 to ${MAX_TIMER_DELAY_MS}`,
      );
  if (options.artifactBundle.manifest.catalogId === "read-v1" && options.profile !== "read")
    throw new ConformanceRunnerError(
      "read-v1 executable scaffold currently supports targets advertising the Read profile only",
    );
  const catalogIds = new Set(options.artifactBundle.catalog.scenarios.map(({ id }) => id));
  const catalogPositions = new Map(
    options.artifactBundle.catalog.scenarios.map(({ id }, index) => [id, index]),
  );
  for (const scenario of options.artifactBundle.manifest.scenarios)
    for (const action of scenarioActionSequence(scenario)) {
      const actionKind = action.family === "http" ? "request" : "action";
      if (action.prerequisiteScenario !== undefined && !catalogIds.has(action.prerequisiteScenario))
        throw new ConformanceRunnerError(
          `${actionKind} '${action.id}' references unknown prerequisite scenario '${action.prerequisiteScenario}'`,
        );
      if (action.prerequisiteScenario === scenario.id)
        throw new ConformanceRunnerError(
          `${actionKind} '${action.id}' cannot use its own scenario as a prerequisite`,
        );
      if (
        action.prerequisiteScenario !== undefined &&
        catalogPositions.has(scenario.id) &&
        (catalogPositions.get(action.prerequisiteScenario) ?? Number.POSITIVE_INFINITY) >=
          (catalogPositions.get(scenario.id) as number)
      )
        throw new ConformanceRunnerError(
          `scenario '${scenario.id}' prerequisite '${action.prerequisiteScenario}' must appear earlier in catalog order`,
        );
      for (const assertion of action.assertions)
        if (assertion.kind === "json-schema") {
          if (options.schemaValidator === undefined)
            throw new ConformanceRunnerError(
              "schema assertion requires an offline schema validator",
            );
          options.schemaValidator.resolve(assertion.schema);
        }
    }
  if (options.scenarioFilter !== undefined) {
    const selectedIds = new Set(
      selectApplicableScenariosForProfile(options.artifactBundle.catalog, options.profile)
        .filter(({ id }) => id.includes(options.scenarioFilter as string))
        .map(({ id }) => id),
    );
    for (const scenario of options.artifactBundle.manifest.scenarios) {
      if (!selectedIds.has(scenario.id)) continue;
      const prerequisites = new Set(
        scenarioActionSequence(scenario).flatMap((action) =>
          action.prerequisiteScenario === undefined ? [] : [action.prerequisiteScenario],
        ),
      );
      for (const prerequisite of prerequisites)
        if (!selectedIds.has(prerequisite))
          throw new ConformanceRunnerError(
            `scenarioFilter selects dependent scenario '${scenario.id}' but excludes prerequisite '${prerequisite}'`,
          );
    }
  }
}

function snapshotFixturePreparation(value: FixturePreparation): FixturePreparation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ConformanceRunnerError("fixture preparation must be an object");
  const { capabilities, bindings } = value;
  if (!Array.isArray(capabilities) || capabilities.some((entry) => typeof entry !== "string"))
    throw new ConformanceRunnerError("fixture preparation capabilities must be strings");
  if (
    bindings !== undefined &&
    (typeof bindings !== "object" || bindings === null || Array.isArray(bindings))
  )
    throw new ConformanceRunnerError("fixture preparation bindings must be an object");
  const bindingSnapshot =
    bindings === undefined ? undefined : Object.fromEntries(Object.entries(bindings));
  if (
    bindingSnapshot !== undefined &&
    Object.values(bindingSnapshot).some((entry) => typeof entry !== "string")
  )
    throw new ConformanceRunnerError("fixture preparation binding values must be strings");
  return Object.freeze({
    capabilities: Object.freeze([...capabilities]),
    ...(bindingSnapshot === undefined ? {} : { bindings: Object.freeze(bindingSnapshot) }),
  });
}

function validateFixturePreparation(
  preparation: FixturePreparation,
  fixture: ConformanceFixture,
  scope: string,
): void {
  const declaredCapabilities = new Set(fixture.capabilities);
  if (
    new Set(preparation.capabilities).size !== preparation.capabilities.length ||
    preparation.capabilities.some((capability) => !declaredCapabilities.has(capability))
  )
    throw new ConformanceRunnerError(
      "fixture preparation capabilities must be a unique subset of the bound fixture",
    );
  const preparedBindingNames = Object.keys(preparation.bindings ?? {}).sort();
  const fixtureBindingNames = Object.keys(fixture.bindings).sort();
  if (
    preparedBindingNames.length !== fixtureBindingNames.length ||
    preparedBindingNames.some((name, index) => name !== fixtureBindingNames[index])
  )
    throw new ConformanceRunnerError(
      "fixture preparation binding names must match the bound fixture",
    );
  if (fixtureBindingNames.includes("scope"))
    throw new ConformanceRunnerError("fixture bindings must not shadow Scope");
  try {
    for (const name of fixtureBindingNames) {
      const prepared = resolveFixtureBinding(preparation.bindings?.[name], scope);
      const bound = resolveFixtureBinding(fixture.bindings[name], scope);
      if (prepared !== bound)
        throw new ConformanceRunnerError(
          "fixture preparation binding values must match the bound fixture",
        );
    }
  } catch (error) {
    if (error instanceof ConformanceRunnerError) throw error;
    throw new ConformanceRunnerError("fixture binding must resolve within the canonical Scope", {
      cause: error,
    });
  }
}

function resolveFixtureBinding(value: unknown, scope: string): string {
  if (typeof value !== "string") throw new Error("fixture binding is not a string");
  const resolved = isHttpUrl(value) ? new URL(value).href : new URL(value, scope).href;
  assertConfinedToScope(resolved, scope, "fixture binding");
  return resolved;
}

function missingPlanResult(metadata: ScenarioMetadata): ScenarioRunResult {
  return {
    id: metadata.id,
    requiredProfile: metadata.requiredProfile,
    state: "harness-error",
    category: "not-implemented",
    requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
    reason: "catalog scenario has no executable plan",
    exchanges: [],
  };
}

function stoppedScenarioResult(metadata: ScenarioMetadata): ScenarioRunResult {
  return {
    id: metadata.id,
    requiredProfile: metadata.requiredProfile,
    state: "harness-error",
    category: "not-run",
    requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
    reason: "matrix stopped before this scenario could run",
    exchanges: [],
  };
}

function prerequisiteResultBeforeRun(
  metadata: ScenarioMetadata,
  scenario: ExecutableScenario,
  priorResults: ReadonlyMap<string, ScenarioRunResult>,
  catalog: ScenarioCatalog,
): ScenarioRunResult | undefined {
  const prerequisiteIds = new Set(
    scenarioActionSequence(scenario).flatMap((action) =>
      action.prerequisiteScenario === undefined ? [] : [action.prerequisiteScenario],
    ),
  );
  for (const prerequisiteId of prerequisiteIds) {
    const prior = priorResults.get(prerequisiteId);
    if (prior?.state === "pass") continue;
    const prerequisite = catalog.scenarios.find(({ id }) => id === prerequisiteId);
    if (prerequisite === undefined)
      throw new ConformanceRunnerError(
        `unknown prerequisite scenario '${prerequisiteId}' escaped option validation`,
      );
    return {
      id: scenario.id,
      requiredProfile: scenario.requiredProfile,
      state: "harness-error",
      category: "not-run",
      requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
      reason: `prerequisite '${prerequisiteId}' did not pass; dependent scenario was not run`,
      prerequisiteFailure: {
        id: prerequisiteId,
        requirements: prerequisite.requirements.map(({ source, anchor }) => `${source}${anchor}`),
        reason:
          prior === undefined
            ? "prerequisite was not selected or did not run"
            : scenarioResultReason(prior),
        phase: "initial",
      },
      exchanges: [],
    };
  }
  return undefined;
}

function prerequisiteFailureResult(
  metadata: ScenarioMetadata,
  scenario: ExecutableScenario,
  failure: ScenarioPrerequisiteRecheckFailure,
  exchanges: readonly ObservedExchange[],
  catalog: ScenarioCatalog,
): ScenarioRunResult {
  const prerequisite = catalog.scenarios.find(({ id }) => id === failure.scenarioId);
  if (prerequisite === undefined)
    throw new ConformanceRunnerError(
      `unknown prerequisite scenario '${failure.scenarioId}' escaped option validation`,
    );
  const category = prerequisiteFailureCategory(failure.cause);
  return {
    id: scenario.id,
    requiredProfile: scenario.requiredProfile,
    state: "harness-error",
    category: "not-run",
    requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
    reason: prerequisiteRecheckResultReason(failure.scenarioId, category),
    prerequisiteFailure: {
      id: failure.scenarioId,
      requirements: prerequisite.requirements.map(({ source, anchor }) => `${source}${anchor}`),
      reason: prerequisiteFailureReason(failure.cause),
      phase: "recheck",
      ...(category === undefined ? {} : { category }),
    },
    exchanges,
  };
}

function scenarioResultReason(result: ScenarioRunResult): string {
  return result.reason ?? `scenario completed with state '${result.state}'`;
}

function prerequisiteRecheckResultReason(
  scenarioId: string,
  category: PrerequisiteFailureCategory | undefined,
): string {
  const prefix = `prerequisite recheck '${scenarioId}'`;
  if (category === "containment")
    return `${prefix} was not safely contained; dependent scenario was not run`;
  if (category === "deadline")
    return `${prefix} exceeded its deadline; dependent scenario was not run`;
  if (category === "observation-limit")
    return `${prefix} exceeded a harness observation bound; dependent scenario was not run`;
  return `${prefix} failed; dependent scenario was not run`;
}

function prerequisiteFailureCategory(error: unknown): PrerequisiteFailureCategory | undefined {
  if (error instanceof ScenarioDeadlineError) return "deadline";
  if (error instanceof HttpTransportError && error.category === "timeout") return "deadline";
  if (error instanceof ScenarioObservationLimitError) return "observation-limit";
  if (error instanceof HttpTransportError && isTransportObservationLimit(error.category))
    return "observation-limit";
  if (error instanceof ScenarioOutOfScopeTargetError) return "containment";
  return undefined;
}

function validateScenarioBindingFlow(
  scenario: ExecutableScenario,
  fixtureBindings: Readonly<Record<string, string>>,
  scope: string,
): void {
  const established = new Set(["scope"]);
  for (const [binding, value] of Object.entries(fixtureBindings)) {
    if (!BINDING_ID_PATTERN.test(binding) || binding.length > 128)
      throw new ConformanceRunnerError(
        "fixture binding names must be 1..128 lowercase identifier characters",
      );
    if (established.has(binding))
      throw new ConformanceRunnerError("fixture bindings must not shadow Scope");
    try {
      if (typeof value !== "string") throw new Error("not a string");
      const resolved = isHttpUrl(value) ? new URL(value).href : new URL(value, scope).href;
      assertConfinedToScope(resolved, scope, `fixture binding '${binding}'`);
    } catch (error) {
      throw new ConformanceRunnerError("fixture binding must resolve within the canonical Scope", {
        cause: error,
      });
    }
    established.add(binding);
  }
  for (const action of scenarioActionSequence(scenario)) {
    if (action.family !== "http") {
      for (const capture of action.captures) {
        if (established.has(capture.binding))
          throw new ConformanceRunnerError(
            `capture '${capture.binding}' shadows an established binding`,
          );
        established.add(capture.binding);
      }
      continue;
    }
    const request = action;
    if (!established.has(request.target.binding))
      throw new ConformanceRunnerError(
        `request '${request.id}' references unknown binding '${request.target.binding}'`,
      );
    for (const queryValue of Object.values(request.target.query ?? {})) {
      if (
        typeof queryValue !== "string" &&
        !isRepeatedQueryKey(queryValue) &&
        !established.has(queryValue.binding)
      )
        throw new ConformanceRunnerError(
          `request '${request.id}' query references unknown binding '${queryValue.binding}'`,
        );
    }
    for (const capture of request.captures) {
      if (established.has(capture.binding))
        throw new ConformanceRunnerError(
          `capture '${capture.binding}' shadows an established binding`,
        );
      established.add(capture.binding);
    }
  }
}

function result(
  metadata: ScenarioMetadata,
  scenario: ExecutableScenario,
  state: ScenarioRunState,
  reason: string | undefined,
  exchanges: readonly ObservedExchange[],
  category?: ScenarioRunResult["category"],
): ScenarioRunResult {
  return {
    id: scenario.id,
    requiredProfile: scenario.requiredProfile,
    state,
    ...(category === undefined ? {} : { category }),
    requirements: metadata.requirements.map(({ source, anchor }) => `${source}${anchor}`),
    ...(reason === undefined ? {} : { reason }),
    exchanges,
  };
}

function outcome(id: string, passed: boolean, message: string): AssertionOutcome {
  return { id, passed, ...(passed ? {} : { message }) };
}

class ScenarioAssertionFailure extends Error {}
class ScenarioActionExecutionFailure extends Error {}
class ScenarioActionExecutorMissingError extends ConformanceRunnerError {}
class ScenarioDeadlineError extends ConformanceRunnerError {}
class ScenarioOutOfScopeTargetError extends ConformanceRunnerError {}
class ScenarioPrerequisiteRecheckFailure extends Error {
  constructor(
    readonly scenarioId: string,
    override readonly cause: unknown,
  ) {
    super(`prerequisite recheck '${scenarioId}' failed`, { cause });
    this.name = "ScenarioPrerequisiteRecheckFailure";
  }
}

function prerequisiteFailureReason(error: unknown): string {
  if (error instanceof ScenarioAssertionFailure || error instanceof ScenarioObservationFailure)
    return error.message;
  if (error instanceof ScenarioUnsupportedProfileError)
    return "target advertised an unsupported profile";
  if (error instanceof ScenarioOutOfScopeTargetError) return error.message;
  if (error instanceof HttpTransportError) return transportFailureMessage(error.category);
  if (error instanceof ConformanceRunnerError) return error.message;
  return "prerequisite execution failed";
}
function relayAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (source === undefined) return () => undefined;
  const abort = (): void => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function enforceDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  deadlineError: () => Error,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(deadlineError()));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function createDeadlineSignal(delayMs: number): {
  readonly signal: AbortSignal;
  readonly clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), delayMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

const REPORT_HEADER_NAMES = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "allow",
  "authorization",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-location",
  "content-type",
  "cookie",
  "etag",
  "expires",
  "link",
  "location",
  "origin",
  "retry-after",
  "set-cookie",
  "user-agent",
  "vary",
  "www-authenticate",
]);

function redactHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.keys(headers)
      .map((name) => name.toLowerCase())
      .filter((name) => REPORT_HEADER_NAMES.has(name))
      .map((name) => [name, "<redacted>"] as const)
      .sort(([left], [right]) => compareKeys(left, right)),
  );
}

function redactUrl(value: string): string {
  const url = new URL(value);
  const hadQuery = url.search !== "";
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  return `${url.href}${hadQuery ? "?<redacted>" : ""}`;
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) normalized[name.toLowerCase()] = value;
  return normalized;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCanonicalScope(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const parsed = new URL(value);
  return (
    parsed.href === value &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.pathname.endsWith("/") &&
    isCanonicalUrlPath(parsed.pathname)
  );
}

function assertConfinedToScope(value: string, scope: string, label: string): void {
  const target = new URL(value);
  const root = new URL(scope);
  if (target.href !== value)
    throw new ScenarioObservationFailure(`${label} is not a canonical URL`);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname))
    throw new ScenarioObservationFailure(`${label} resolved outside the canonical Scope`);
  if (target.username !== "" || target.password !== "")
    throw new ScenarioObservationFailure(`${label} contains credentials or an unsafe authority`);
  if (target.hash !== "" || !isCanonicalUrlPath(target.pathname))
    throw new ScenarioObservationFailure(`${label} contains a noncanonical URL path or fragment`);
}

function assertEffectiveRequest(
  effectiveRequest: NonNullable<HttpExchangeResponse["effectiveRequest"]>,
  requestedUrl: string,
  scope: string,
): void {
  if (!isHttpUrl(effectiveRequest.url))
    throw new ConformanceRunnerError("HTTP executor returned an unsafe effective request");
  try {
    const effective = new URL(effectiveRequest.url);
    const requested = new URL(requestedUrl);
    if (
      effective.origin !== requested.origin ||
      effective.pathname !== requested.pathname ||
      effective.search !== requested.search ||
      effective.hash !== ""
    )
      throw new Error("effective request changed the target");
    assertConfinedToScope(effectiveRequest.url, scope, "effective request");
  } catch {
    throw new ConformanceRunnerError("HTTP executor returned an unsafe effective request");
  }
  for (const value of Object.values(effectiveRequest.headers))
    if (typeof value !== "string")
      throw new ConformanceRunnerError("HTTP executor returned invalid effective headers");
  if (
    effectiveRequest.headersTransmitted !== undefined &&
    effectiveRequest.headersTransmitted !== true
  )
    throw new ConformanceRunnerError("HTTP executor returned invalid wire-header evidence");
}

function requireMatchingEffectiveHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
  requestedValue: string,
): void {
  const effectiveValue = Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === name,
  )?.[1];
  const diagnosticName =
    name === "origin"
      ? "Origin"
      : name === "access-control-request-method"
        ? "Access-Control-Request-Method"
        : name;
  if (requestedValue.length === 0 || effectiveValue !== requestedValue)
    throw new ScenarioWireObservationUnavailableError(
      `CORS-header absence assertion requires matching nonempty ${diagnosticName} evidence`,
    );
}

function scopeRelativeUrl(value: unknown, scope: string): string {
  if (typeof value !== "string" || !isHttpUrl(value)) throw new Error("not URL");
  assertConfinedToScope(value, scope, "array item");
  const target = new URL(value);
  const root = new URL(scope);
  return `${target.pathname.slice(root.pathname.length)}${target.search}${target.hash}`;
}

function scopeRelativeOrAbsoluteUri(value: unknown, scope: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value))
    throw new Error("array tuple value was not an absolute URI");
  if (!isHttpUrl(value)) return value;
  const target = new URL(value);
  const root = new URL(scope);
  if (target.origin === root.origin && target.pathname.startsWith(root.pathname))
    return scopeRelativeUrl(value, scope);
  return value;
}

function multisetEquals(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const value of left) {
    const key = JSON.stringify(sortJsonValue(value));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const value of right) {
    const key = JSON.stringify(sortJsonValue(value));
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

function transportFailureMessage(category: string): string {
  if (category === "header-limit")
    return "HTTP response exceeded the configured executor header limit";
  if (category === "body-limit") return "HTTP response exceeded the configured executor body limit";
  return `HTTP transport failed (${category})`;
}

function isTransportObservationLimit(category: string): boolean {
  return category === "header-limit" || category === "body-limit";
}

function isCanonicalUrlPath(pathname: string): boolean {
  if (/%(?:2f|5c)/i.test(pathname)) return false;
  const segments = pathname.split("/");
  try {
    return segments.every((segment, index) => {
      if ((index === 0 || index === segments.length - 1) && segment.length === 0) return true;
      if (segment.length === 0) return false;
      for (const match of segment.matchAll(/%([0-9A-Fa-f]{2})/g)) {
        const encoded = match[1] as string;
        if (encoded !== encoded.toUpperCase()) return false;
        const decodedByte = String.fromCharCode(Number.parseInt(encoded, 16));
        if (/^[A-Za-z0-9._~-]$/.test(decodedByte)) return false;
      }
      const decoded = decodeURIComponent(segment);
      return (
        decoded !== "." &&
        decoded !== ".." &&
        !decoded.includes("/") &&
        !decoded.includes("\\") &&
        ![...decoded].some((character) => {
          const code = character.codePointAt(0) as number;
          return code <= 0x1f || code === 0x7f;
        })
      );
    });
  } catch {
    return false;
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  if (typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left as object).sort();
    const rightKeys = Object.keys(right as object).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          deepEqual(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key],
          ),
      )
    );
  }
  return false;
}

function observedJsonIssue(
  value: unknown,
): { readonly reason: string; readonly attribution: "runner-limit" | "target-value" } | undefined {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let targetValueIssue:
    | { readonly reason: string; readonly attribution: "target-value" }
    | undefined;
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    nodes += 1;
    if (nodes > OBSERVED_JSON_MAX_NODES)
      return {
        reason: `response JSON exceeded the runner node limit of ${OBSERVED_JSON_MAX_NODES}`,
        attribution: "runner-limit",
      };
    if (current.depth > OBSERVED_JSON_MAX_DEPTH)
      return {
        reason: `response JSON exceeded the runner depth limit of ${OBSERVED_JSON_MAX_DEPTH}`,
        attribution: "runner-limit",
      };
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    )
      continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value))
        targetValueIssue ??= {
          reason:
            "response JSON contained a number that is not representable as a finite runtime value",
          attribution: "target-value",
        };
      continue;
    }
    if (typeof current.value !== "object") {
      targetValueIssue ??= {
        reason: "response JSON contained an unsupported runtime value",
        attribution: "target-value",
      };
      continue;
    }
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length > OBSERVED_JSON_MAX_CONTAINER_ENTRIES)
      return {
        reason: `response JSON exceeded the runner per-container entry limit of ${OBSERVED_JSON_MAX_CONTAINER_ENTRIES}`,
        attribution: "runner-limit",
      };
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
  return targetValueIssue;
}
