import type {
  JsonValue,
  ScenarioAssertion,
  ScenarioCapture,
  ScenarioRequest,
} from "./executable-manifest.js";

export type ScenarioActionFamily = "client" | "lifecycle";

export type ScenarioJsonAssertion = Extract<
  ScenarioAssertion,
  {
    readonly kind:
      | "json-equals"
      | "json-pointer"
      | "json-array-set"
      | "json-array-tuples"
      | "json-schema";
  }
>;

export type ScenarioJsonCapture = Extract<
  ScenarioCapture,
  { readonly from: { readonly kind: "json-pointer" } }
>;

/** An HTTP action is the existing request contract with only its lane made explicit. */
export type ScenarioHttpAction = ScenarioRequest & { readonly family: "http" };

interface ScenarioProgrammaticActionBase {
  readonly id: string;
  readonly family: ScenarioActionFamily;
  readonly operation: string;
  readonly captures: readonly ScenarioJsonCapture[];
  readonly assertions: readonly ScenarioJsonAssertion[];
  readonly prerequisiteScenario?: string;
}

/** A programmable action. The runner, rather than its executor, owns all oracle logic. */
export type ScenarioProgrammaticAction = ScenarioProgrammaticActionBase &
  (
    | {
        readonly input: JsonValue;
        readonly inputFixturePointer?: never;
      }
    | {
        readonly input?: never;
        /** Target-realization input selected from the bound fixture's oracle namespace. */
        readonly inputFixturePointer: string;
      }
  );

export type ScenarioAction = ScenarioHttpAction | ScenarioProgrammaticAction;

export interface ScenarioActionExecution {
  readonly family: ScenarioActionFamily;
  readonly operation: string;
  readonly scope: string;
  readonly bindings: Readonly<Record<string, JsonValue>>;
  readonly input: JsonValue;
  readonly signal: AbortSignal;
}

export type ScenarioActionExecutor = (execution: ScenarioActionExecution) => Promise<unknown>;
