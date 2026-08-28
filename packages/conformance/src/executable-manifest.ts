import { isProtocolProfile, type ProtocolProfile } from "@bdp/protocol";
import type {
  ScenarioAction,
  ScenarioHttpAction,
  ScenarioJsonAssertion,
  ScenarioJsonCapture,
  ScenarioProgrammaticAction,
} from "./scenario-action.js";

/** The executable scenario-manifest shape is intentionally separate from the metadata catalog. */
export const EXECUTABLE_MANIFEST_VERSION = 1 as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ScenarioSetup {
  readonly fixture: string;
  readonly requires: readonly string[];
}

export interface ScenarioApplicability {
  readonly requires: readonly string[];
}

export interface ScenarioTarget {
  /** A binding established by the harness or a prior capture. */
  readonly binding: string;
  /** A relative URL path resolved against the binding. */
  readonly path?: string;
  readonly query?: Readonly<Record<string, ScenarioQueryValue>>;
}

export type ScenarioQueryValue =
  | string
  /** A deliberately repeated query key; at least two occurrences, literals only. */
  | readonly [string, string, ...string[]]
  | {
      readonly binding: string;
      readonly representation: "absolute-url" | "scope-relative-url";
    };

export interface ScenarioRequest {
  readonly id: string;
  readonly method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly target: ScenarioTarget;
  /** Catalog scenario whose behavior must succeed before this scenario's own probe can run. */
  readonly prerequisiteScenario?: string;
  /** Scenario-authored headers are deliberately limited to non-secret protocol fields. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Explicitly marks the single POST used to observe Read-profile 405 behavior. */
  readonly negativeMethodProbe?: true;
  /** Exact authored request-target octets for the raw HTTP transport lane. */
  readonly rawRequestTarget?: ScenarioRawRequestTarget;
  readonly captures: readonly ScenarioCapture[];
  readonly assertions: readonly ScenarioAssertion[];
}

export type ScenarioRawRequestTargetBytes =
  | { readonly encoding: "ascii"; readonly value: string }
  | { readonly encoding: "base64"; readonly value: string };

export type ScenarioRawRequestTarget =
  | ScenarioRawRequestTargetBytes
  | {
      /** Materialize exact octets from the request's already-resolved semantic URL. */
      readonly template: "resolved-url";
      readonly form: "origin" | "scheme-relative" | "absolute";
      /** Replaces only the request-target authority; dialing and Host retain canonical identity. */
      readonly authority?: string;
      readonly insertBeforeFinalPathSegment?: ScenarioRawRequestTargetBytes;
      readonly suffix?: ScenarioRawRequestTargetBytes;
    };

export type ScenarioCapture =
  | {
      readonly binding: string;
      readonly from: { readonly kind: "response-url" };
    }
  | {
      readonly binding: string;
      readonly from: { readonly kind: "header-link"; readonly rel: string };
    }
  | {
      readonly binding: string;
      readonly from: { readonly kind: "json-pointer"; readonly pointer: string };
    };

export type ScenarioAssertion =
  | {
      readonly id: string;
      readonly kind: "status";
      readonly equals?: number;
      readonly oneOf?: readonly number[];
    }
  | {
      readonly id: string;
      readonly kind: "header";
      readonly name: string;
      readonly equals?: string;
      readonly contains?: string;
      readonly absent?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: "header-tokens";
      readonly name: string;
      readonly includes: readonly string[];
      readonly optional?: readonly string[];
      readonly allowsAdditional: boolean;
      readonly caseInsensitive?: true;
    }
  | { readonly id: string; readonly kind: "media-type"; readonly equals: string }
  | { readonly id: string; readonly kind: "body-absent" }
  | {
      readonly id: string;
      readonly kind: "wire-not-contains";
      /** Private fixture string whose UTF-8 octets must be absent from the entire raw response. */
      readonly fixturePointer: string;
    }
  | {
      readonly id: string;
      readonly kind: "response-metadata-equals";
      /** Earlier request in this scenario whose status and named headers are the oracle. */
      readonly request: string;
      readonly headers: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: "json-equals";
      readonly value: JsonValue;
      readonly fixturePointer?: never;
      readonly normalize?: "iso-timestamps";
      /** JSON Pointers relative to the compared value whose timestamp values are target-dynamic. */
      readonly timestampPointers?: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: "json-equals";
      readonly value?: never;
      /** Exact expected JSON selected from the bound target realization's oracle namespace. */
      readonly fixturePointer: string;
      readonly normalize?: "iso-timestamps";
      /** JSON Pointers relative to the compared value whose timestamp values are target-dynamic. */
      readonly timestampPointers?: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: "json-pointer";
      readonly pointer: string;
      readonly exists: boolean;
      readonly equals?: JsonValue;
      readonly equalsRunProfile?: true;
      /** Expected value after optional normalization, selected from the bound realization. */
      readonly fixturePointer?: string;
      readonly normalize?: "scope-relative-url" | "iso-timestamps";
      /** JSON Pointers relative to the selected value whose timestamp values are target-dynamic. */
      readonly timestampPointers?: readonly string[];
    }
  | {
      readonly id: string;
      readonly kind: "json-array-set";
      readonly pointer: string;
      readonly itemPointer: string;
      readonly equals: readonly JsonValue[];
      readonly fixturePointer?: never;
      readonly normalize?: "scope-relative-url" | "scope-relative-or-absolute-uri";
    }
  | {
      readonly id: string;
      readonly kind: "json-array-set";
      readonly pointer: string;
      readonly itemPointer: string;
      readonly equals?: never;
      /** Exact expected multiset selected from the bound target realization. */
      readonly fixturePointer: string;
      readonly normalize?: "scope-relative-url" | "scope-relative-or-absolute-uri";
    }
  | {
      readonly id: string;
      readonly kind: "json-array-tuples";
      readonly pointer: string;
      readonly projections: readonly {
        readonly pointer: string;
        readonly normalize?: "scope-relative-url" | "scope-relative-or-absolute-uri";
      }[];
      readonly equals: readonly (readonly JsonValue[])[];
      readonly fixturePointer?: never;
    }
  | {
      readonly id: string;
      readonly kind: "json-array-tuples";
      readonly pointer: string;
      readonly projections: readonly {
        readonly pointer: string;
        readonly normalize?: "scope-relative-url" | "scope-relative-or-absolute-uri";
      }[];
      readonly equals?: never;
      /** Exact expected tuple multiset selected from the bound target realization. */
      readonly fixturePointer: string;
    }
  | { readonly id: string; readonly kind: "json-schema"; readonly schema: string };

interface ExecutableScenarioBase {
  readonly id: string;
  readonly requiredProfile: ProtocolProfile;
  readonly setup: ScenarioSetup;
  readonly applicability: ScenarioApplicability;
  readonly cleanup: { readonly resetFixture: true };
}

export type ExecutableScenario = ExecutableScenarioBase &
  (
    | { readonly requests: readonly ScenarioRequest[]; readonly actions?: never }
    | { readonly requests?: never; readonly actions: readonly ScenarioAction[] }
  );

export interface ExecutableScenarioManifest {
  readonly manifestVersion: typeof EXECUTABLE_MANIFEST_VERSION;
  readonly catalogId: string;
  readonly scenarios: readonly ExecutableScenario[];
}

export interface ManifestIssue {
  readonly path: string;
  readonly message: string;
}

export class ManifestValidationError extends Error {
  readonly issues: readonly ManifestIssue[];

  constructor(issues: readonly ManifestIssue[], sourceLabel?: string) {
    super(
      `${sourceLabel === undefined ? "scenario manifest" : sourceLabel}: validation failed (${issues.length} issue(s))`,
    );
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

const ROOT_KEYS = new Set(["manifestVersion", "catalogId", "scenarios"]);
const SCENARIO_KEYS = new Set([
  "id",
  "requiredProfile",
  "setup",
  "applicability",
  "requests",
  "actions",
  "cleanup",
]);
const SETUP_KEYS = new Set(["fixture", "requires"]);
const APPLICABILITY_KEYS = new Set(["requires"]);
const REQUEST_KEYS = new Set([
  "id",
  "method",
  "target",
  "prerequisiteScenario",
  "headers",
  "negativeMethodProbe",
  "rawRequestTarget",
  "captures",
  "assertions",
]);
const HTTP_ACTION_KEYS = new Set([...REQUEST_KEYS, "family"]);
const PROGRAMMATIC_ACTION_KEYS = new Set([
  "id",
  "family",
  "operation",
  "input",
  "inputFixturePointer",
  "captures",
  "assertions",
  "prerequisiteScenario",
]);
const ACTION_KEYS = new Set([...HTTP_ACTION_KEYS, ...PROGRAMMATIC_ACTION_KEYS]);
const RAW_REQUEST_TARGET_BYTES_KEYS = new Set(["encoding", "value"]);
const RAW_REQUEST_TARGET_TEMPLATE_KEYS = new Set([
  "template",
  "form",
  "authority",
  "insertBeforeFinalPathSegment",
  "suffix",
]);
const TARGET_KEYS = new Set(["binding", "path", "query"]);
const QUERY_BINDING_KEYS = new Set(["binding", "representation"]);
const CAPTURE_KEYS = new Set(["binding", "from"]);
const RESPONSE_URL_CAPTURE_KEYS = new Set(["kind"]);
const HEADER_LINK_CAPTURE_KEYS = new Set(["kind", "rel"]);
const JSON_POINTER_CAPTURE_KEYS = new Set(["kind", "pointer"]);
const STATUS_ASSERTION_KEYS = new Set(["id", "kind", "equals", "oneOf"]);
const HEADER_ASSERTION_KEYS = new Set(["id", "kind", "name", "equals", "contains", "absent"]);
const HEADER_TOKENS_ASSERTION_KEYS = new Set([
  "id",
  "kind",
  "name",
  "includes",
  "optional",
  "allowsAdditional",
  "caseInsensitive",
]);
const MEDIA_TYPE_ASSERTION_KEYS = new Set(["id", "kind", "equals"]);
const BODY_ABSENT_ASSERTION_KEYS = new Set(["id", "kind"]);
const WIRE_NOT_CONTAINS_ASSERTION_KEYS = new Set(["id", "kind", "fixturePointer"]);
const RESPONSE_METADATA_EQUALS_ASSERTION_KEYS = new Set(["id", "kind", "request", "headers"]);
const JSON_EQUALS_ASSERTION_KEYS = new Set([
  "id",
  "kind",
  "value",
  "fixturePointer",
  "normalize",
  "timestampPointers",
]);
const JSON_POINTER_ASSERTION_KEYS = new Set([
  "id",
  "kind",
  "pointer",
  "exists",
  "equals",
  "equalsRunProfile",
  "fixturePointer",
  "normalize",
  "timestampPointers",
]);
const JSON_ARRAY_SET_ASSERTION_KEYS = new Set([
  "id",
  "kind",
  "pointer",
  "itemPointer",
  "equals",
  "fixturePointer",
  "normalize",
]);
const JSON_ARRAY_TUPLES_ASSERTION_KEYS = new Set([
  "id",
  "kind",
  "pointer",
  "projections",
  "equals",
  "fixturePointer",
]);
const JSON_TUPLE_PROJECTION_KEYS = new Set(["pointer", "normalize"]);
const JSON_SCHEMA_ASSERTION_KEYS = new Set(["id", "kind", "schema"]);
const CLEANUP_KEYS = new Set(["resetFixture"]);
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const HEADER_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SECRET_HEADER_PATTERN =
  /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token)$/;
const HTTP_FIELD_VALUE_PATTERN = /^[\t\x20-\x7e\x80-\xff]*$/;
const MAXIMUM_RAW_REQUEST_TARGET_BYTES = 8_192;
const STABLE_RESPONSE_METADATA_HEADERS = new Set([
  "cache-control",
  "content-language",
  "content-length",
  "content-location",
  "content-type",
  "etag",
  "last-modified",
  "link",
  "vary",
]);

export function loadExecutableScenarioManifestJson(
  text: string,
  sourceLabel?: string,
): ExecutableScenarioManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ManifestValidationError(
      [
        {
          path: "$",
          message: `invalid JSON: ${cause instanceof Error ? cause.message : "parse failure"}`,
        },
      ],
      sourceLabel,
    );
  }
  return parseExecutableScenarioManifest(value, sourceLabel);
}

export function parseExecutableScenarioManifest(
  value: unknown,
  sourceLabel?: string,
): ExecutableScenarioManifest {
  const issues: ManifestIssue[] = [];
  if (!isPlainRecord(value)) {
    throw new ManifestValidationError(
      [{ path: "$", message: "must be a plain record" }],
      sourceLabel,
    );
  }
  reportUnknownKeys(value, ROOT_KEYS, "$", issues);
  if (ownValue(value, "manifestVersion") !== EXECUTABLE_MANIFEST_VERSION)
    issues.push({ path: "$.manifestVersion", message: "must equal 1" });
  const catalogId = readId(ownValue(value, "catalogId"), "$.catalogId", issues);
  const scenariosValue = ownValue(value, "scenarios");
  const scenarios: ExecutableScenario[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(scenariosValue)) {
    issues.push({ path: "$.scenarios", message: "must be an array" });
  } else {
    for (const [index, candidate] of scenariosValue.entries()) {
      const scenario = parseScenario(candidate, `$.scenarios[${index}]`, issues);
      if (scenario === undefined) continue;
      if (ids.has(scenario.id))
        issues.push({ path: `$.scenarios[${index}].id`, message: "must be unique" });
      else ids.add(scenario.id);
      scenarios.push(scenario);
    }
  }
  if (issues.length > 0) throw new ManifestValidationError(issues, sourceLabel);
  return { manifestVersion: 1, catalogId: catalogId as string, scenarios };
}

function parseScenario(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ExecutableScenario | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, SCENARIO_KEYS, path, issues);
  const id = readId(ownValue(value, "id"), `${path}.id`, issues);
  const requiredProfile = readProfile(
    ownValue(value, "requiredProfile"),
    `${path}.requiredProfile`,
    issues,
  );
  const setup = parseSetup(ownValue(value, "setup"), `${path}.setup`, issues);
  const applicability = parseApplicability(
    ownValue(value, "applicability"),
    `${path}.applicability`,
    issues,
  );
  const requestsValue = ownValue(value, "requests");
  const actionsValue = ownValue(value, "actions");
  const hasRequests = requestsValue !== undefined;
  const hasActions = actionsValue !== undefined;
  if (hasRequests === hasActions)
    issues.push({ path, message: "must choose exactly one of requests or actions" });
  const requests = hasRequests
    ? parseRequests(requestsValue, `${path}.requests`, issues, requiredProfile)
    : undefined;
  const actions = hasActions
    ? parseActions(actionsValue, `${path}.actions`, issues, requiredProfile)
    : undefined;
  const cleanup = parseCleanup(ownValue(value, "cleanup"), `${path}.cleanup`, issues);
  if (
    id === undefined ||
    requiredProfile === undefined ||
    setup === undefined ||
    applicability === undefined ||
    hasRequests === hasActions ||
    (hasRequests && requests === undefined) ||
    (hasActions && actions === undefined) ||
    cleanup === undefined
  )
    return undefined;
  return hasRequests
    ? {
        id,
        requiredProfile,
        setup,
        applicability,
        requests: requests as ScenarioRequest[],
        cleanup,
      }
    : { id, requiredProfile, setup, applicability, actions: actions as ScenarioAction[], cleanup };
}

function parseSetup(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ScenarioSetup | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, SETUP_KEYS, path, issues);
  const fixture = readId(ownValue(value, "fixture"), `${path}.fixture`, issues);
  const requires = readStringArray(ownValue(value, "requires"), `${path}.requires`, issues, true);
  return fixture === undefined || requires === undefined ? undefined : { fixture, requires };
}

function parseApplicability(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ScenarioApplicability | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, APPLICABILITY_KEYS, path, issues);
  const requires = readStringArray(ownValue(value, "requires"), `${path}.requires`, issues, true);
  return requires === undefined ? undefined : { requires };
}

function parseRequests(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
  requiredProfile: ProtocolProfile | undefined,
): readonly ScenarioRequest[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must be a non-empty array" });
    return undefined;
  }
  const requests: ScenarioRequest[] = [];
  const ids = new Set<string>();
  const establishedBindings = new Set(["scope"]);
  let ownRequestSeen = false;
  for (const [index, candidate] of value.entries()) {
    const requestPath = `${path}[${index}]`;
    const priorRequestIds = new Set(ids);
    if (!isPlainRecord(candidate)) {
      issues.push({ path: requestPath, message: "must be a plain record" });
      continue;
    }
    reportUnknownKeys(candidate, REQUEST_KEYS, requestPath, issues);
    const id = readId(ownValue(candidate, "id"), `${requestPath}.id`, issues);
    if (id !== undefined && ids.has(id))
      issues.push({ path: `${requestPath}.id`, message: "must be unique within the scenario" });
    else if (id !== undefined) ids.add(id);
    const method = readMethod(ownValue(candidate, "method"), `${requestPath}.method`, issues);
    const prerequisiteScenarioValue = ownValue(candidate, "prerequisiteScenario");
    const prerequisiteScenario =
      prerequisiteScenarioValue === undefined
        ? undefined
        : readId(prerequisiteScenarioValue, `${requestPath}.prerequisiteScenario`, issues);
    if (prerequisiteScenario === undefined) ownRequestSeen = true;
    else if (ownRequestSeen)
      issues.push({
        path: `${requestPath}.prerequisiteScenario`,
        message: "prerequisite requests must precede this scenario's own requests",
      });
    const negativeMethodProbeValue = ownValue(candidate, "negativeMethodProbe");
    const negativeMethodProbe = negativeMethodProbeValue === true ? true : undefined;
    if (negativeMethodProbeValue !== undefined && negativeMethodProbeValue !== true)
      issues.push({ path: `${requestPath}.negativeMethodProbe`, message: "must equal true" });
    if (requiredProfile === "read" && method !== undefined) {
      const ordinaryReadMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
      if (ordinaryReadMethod && negativeMethodProbe === true)
        issues.push({
          path: `${requestPath}.negativeMethodProbe`,
          message: "is only valid for the explicit POST 405 probe",
        });
      if (!ordinaryReadMethod && !(method === "POST" && negativeMethodProbe === true))
        issues.push({
          path: `${requestPath}.method`,
          message: "Read scenarios permit only GET, HEAD, OPTIONS, or an explicit POST probe",
        });
    }
    const rawRequestTarget = parseRawRequestTarget(
      ownValue(candidate, "rawRequestTarget"),
      `${requestPath}.rawRequestTarget`,
      issues,
    );
    const target = parseTarget(ownValue(candidate, "target"), `${requestPath}.target`, issues);
    const headers = parseHeaders(ownValue(candidate, "headers"), `${requestPath}.headers`, issues);
    const captures = parseCaptures(
      ownValue(candidate, "captures"),
      `${requestPath}.captures`,
      issues,
    );
    const assertions = parseAssertions(
      ownValue(candidate, "assertions"),
      `${requestPath}.assertions`,
      issues,
    );
    if (assertions !== undefined)
      for (const [assertionIndex, assertion] of assertions.entries())
        if (
          assertion.kind === "response-metadata-equals" &&
          !priorRequestIds.has(assertion.request)
        )
          issues.push({
            path: `${requestPath}.assertions[${assertionIndex}].request`,
            message: "must name an earlier request in this scenario",
          });
    if (
      id === undefined ||
      method === undefined ||
      target === undefined ||
      headers === undefined ||
      captures === undefined ||
      assertions === undefined
    )
      continue;
    const parsedRequest = {
      id,
      method,
      target,
      ...(prerequisiteScenario === undefined ? {} : { prerequisiteScenario }),
      headers,
      ...(negativeMethodProbe === undefined ? {} : { negativeMethodProbe }),
      ...(rawRequestTarget === undefined ? {} : { rawRequestTarget }),
      captures,
      assertions,
    } satisfies ScenarioRequest;
    const requestBindings = new Set<string>();
    for (const [captureIndex, capture] of captures.entries()) {
      if (requestBindings.has(capture.binding)) continue;
      requestBindings.add(capture.binding);
      if (establishedBindings.has(capture.binding))
        issues.push({
          path: `${requestPath}.captures[${captureIndex}].binding`,
          message: `must not shadow established binding '${capture.binding}'`,
        });
    }
    for (const capture of captures) establishedBindings.add(capture.binding);
    requests.push(parsedRequest);
  }
  if (requests.length === value.length && requests.every((request) => request.prerequisiteScenario))
    issues.push({ path, message: "must include at least one request owned by the scenario" });
  return requests.length === value.length ? requests : undefined;
}

function parseActions(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
  requiredProfile: ProtocolProfile | undefined,
): readonly ScenarioAction[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must be a non-empty array" });
    return undefined;
  }
  const actions: ScenarioAction[] = [];
  const ids = new Set<string>();
  const establishedBindings = new Set(["scope"]);
  let ownActionSeen = false;
  for (const [index, candidate] of value.entries()) {
    const actionPath = `${path}[${index}]`;
    const priorHttpActionIds = new Set(
      actions
        .filter((action): action is ScenarioHttpAction => action.family === "http")
        .map(({ id: actionId }) => actionId),
    );
    if (!isPlainRecord(candidate)) {
      issues.push({ path: actionPath, message: "must be a plain record" });
      continue;
    }
    const family = ownValue(candidate, "family");
    const id = readId(ownValue(candidate, "id"), `${actionPath}.id`, issues);
    if (id !== undefined && ids.has(id))
      issues.push({ path: `${actionPath}.id`, message: "must be unique within the scenario" });
    else if (id !== undefined) ids.add(id);
    const prerequisiteScenarioValue = ownValue(candidate, "prerequisiteScenario");
    const prerequisiteScenario =
      prerequisiteScenarioValue === undefined
        ? undefined
        : readId(prerequisiteScenarioValue, `${actionPath}.prerequisiteScenario`, issues);
    if (prerequisiteScenario === undefined) ownActionSeen = true;
    else if (ownActionSeen)
      issues.push({
        path: `${actionPath}.prerequisiteScenario`,
        message: "prerequisite actions must precede this scenario's own actions",
      });

    let parsed: ScenarioAction | undefined;
    if (family === "http") {
      reportUnknownKeys(candidate, HTTP_ACTION_KEYS, actionPath, issues);
      parsed = parseHttpAction(
        candidate,
        actionPath,
        issues,
        requiredProfile,
        id,
        prerequisiteScenario,
        priorHttpActionIds,
      );
    } else if (family === "client" || family === "lifecycle") {
      reportUnknownKeys(candidate, PROGRAMMATIC_ACTION_KEYS, actionPath, issues);
      parsed = parseProgrammaticAction(
        candidate,
        actionPath,
        issues,
        family,
        id,
        prerequisiteScenario,
      );
    } else {
      reportUnknownKeys(candidate, ACTION_KEYS, actionPath, issues);
      issues.push({
        path: `${actionPath}.family`,
        message: "must be 'http', 'client', or 'lifecycle'",
      });
    }

    if (parsed !== undefined) {
      const actionBindings = new Set<string>();
      for (const [captureIndex, capture] of parsed.captures.entries()) {
        if (actionBindings.has(capture.binding)) continue;
        actionBindings.add(capture.binding);
        if (establishedBindings.has(capture.binding))
          issues.push({
            path: `${actionPath}.captures[${captureIndex}].binding`,
            message: `must not shadow established binding '${capture.binding}'`,
          });
      }
      for (const capture of parsed.captures) establishedBindings.add(capture.binding);
      actions.push(parsed);
    }
  }
  if (actions.length === value.length && actions.every((action) => action.prerequisiteScenario))
    issues.push({ path, message: "must include at least one action owned by the scenario" });
  return actions.length === value.length ? actions : undefined;
}

function parseHttpAction(
  candidate: Record<string, unknown>,
  path: string,
  issues: ManifestIssue[],
  requiredProfile: ProtocolProfile | undefined,
  id: string | undefined,
  prerequisiteScenario: string | undefined,
  priorHttpActionIds: ReadonlySet<string>,
): ScenarioHttpAction | undefined {
  const method = readMethod(ownValue(candidate, "method"), `${path}.method`, issues);
  const negativeMethodProbeValue = ownValue(candidate, "negativeMethodProbe");
  const negativeMethodProbe = negativeMethodProbeValue === true ? true : undefined;
  if (negativeMethodProbeValue !== undefined && negativeMethodProbeValue !== true)
    issues.push({ path: `${path}.negativeMethodProbe`, message: "must equal true" });
  if (requiredProfile === "read" && method !== undefined) {
    const ordinaryReadMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
    if (ordinaryReadMethod && negativeMethodProbe === true)
      issues.push({
        path: `${path}.negativeMethodProbe`,
        message: "is only valid for the explicit POST 405 probe",
      });
    if (!ordinaryReadMethod && !(method === "POST" && negativeMethodProbe === true))
      issues.push({
        path: `${path}.method`,
        message: "Read scenarios permit only GET, HEAD, OPTIONS, or an explicit POST probe",
      });
  }
  const target = parseTarget(ownValue(candidate, "target"), `${path}.target`, issues);
  const headers = parseHeaders(ownValue(candidate, "headers"), `${path}.headers`, issues);
  const captures = parseCaptures(ownValue(candidate, "captures"), `${path}.captures`, issues);
  const assertions = parseAssertions(
    ownValue(candidate, "assertions"),
    `${path}.assertions`,
    issues,
  );
  const rawRequestTarget = parseRawRequestTarget(
    ownValue(candidate, "rawRequestTarget"),
    `${path}.rawRequestTarget`,
    issues,
  );
  if (assertions !== undefined)
    for (const [assertionIndex, assertion] of assertions.entries())
      if (
        assertion.kind === "response-metadata-equals" &&
        !priorHttpActionIds.has(assertion.request)
      )
        issues.push({
          path: `${path}.assertions[${assertionIndex}].request`,
          message: "must name an earlier action in this scenario",
        });
  if (
    id === undefined ||
    method === undefined ||
    target === undefined ||
    headers === undefined ||
    captures === undefined ||
    assertions === undefined
  )
    return undefined;
  return {
    id,
    family: "http",
    method,
    target,
    ...(prerequisiteScenario === undefined ? {} : { prerequisiteScenario }),
    headers,
    ...(negativeMethodProbe === undefined ? {} : { negativeMethodProbe }),
    ...(rawRequestTarget === undefined ? {} : { rawRequestTarget }),
    captures,
    assertions,
  };
}

function parseRawRequestTarget(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ScenarioRawRequestTarget | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  if (ownValue(value, "template") !== undefined)
    return parseRawRequestTargetTemplate(value, path, issues);
  return parseRawRequestTargetBytes(value, path, issues, true);
}

function parseRawRequestTargetTemplate(
  value: Record<string, unknown>,
  path: string,
  issues: ManifestIssue[],
): ScenarioRawRequestTarget | undefined {
  const issueCount = issues.length;
  reportUnknownKeys(value, RAW_REQUEST_TARGET_TEMPLATE_KEYS, path, issues);
  const template = ownValue(value, "template");
  if (template !== "resolved-url")
    issues.push({ path: `${path}.template`, message: "must equal 'resolved-url'" });
  const form = ownValue(value, "form");
  if (form !== "origin" && form !== "scheme-relative" && form !== "absolute")
    issues.push({
      path: `${path}.form`,
      message: "must be 'origin', 'scheme-relative', or 'absolute'",
    });
  const authority = ownValue(value, "authority");
  const parsedAuthority = isRawRequestTargetAuthority(authority) ? authority : undefined;
  if (form === "origin" && authority !== undefined)
    issues.push({ path: `${path}.authority`, message: "must be absent for origin form" });
  else if ((form === "scheme-relative" || form === "absolute") && parsedAuthority === undefined)
    issues.push({
      path: `${path}.authority`,
      message: "must be a non-empty ASCII authority without '/', '?', or '#'",
    });
  const insertBeforeFinalPathSegment = parseRawRequestTargetBytes(
    ownValue(value, "insertBeforeFinalPathSegment"),
    `${path}.insertBeforeFinalPathSegment`,
    issues,
    false,
  );
  const suffix = parseRawRequestTargetBytes(
    ownValue(value, "suffix"),
    `${path}.suffix`,
    issues,
    false,
  );
  if (
    issues.length !== issueCount ||
    template !== "resolved-url" ||
    (form !== "origin" && form !== "scheme-relative" && form !== "absolute")
  )
    return undefined;
  return {
    template,
    form,
    ...(parsedAuthority === undefined ? {} : { authority: parsedAuthority }),
    ...(insertBeforeFinalPathSegment === undefined ? {} : { insertBeforeFinalPathSegment }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}

function parseRawRequestTargetBytes(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
  required: boolean,
): ScenarioRawRequestTargetBytes | undefined {
  if (value === undefined && !required) return undefined;
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  const issueCount = issues.length;
  reportUnknownKeys(value, RAW_REQUEST_TARGET_BYTES_KEYS, path, issues);
  const encoding = ownValue(value, "encoding");
  const targetValue = ownValue(value, "value");
  if (encoding !== "ascii" && encoding !== "base64")
    issues.push({ path: `${path}.encoding`, message: "must be 'ascii' or 'base64'" });
  if (typeof targetValue !== "string" || targetValue.length === 0)
    issues.push({ path: `${path}.value`, message: "must be a non-empty string" });
  else if (
    (encoding === "ascii" && targetValue.length > MAXIMUM_RAW_REQUEST_TARGET_BYTES) ||
    (encoding === "base64" &&
      (targetValue.length > Math.ceil(MAXIMUM_RAW_REQUEST_TARGET_BYTES / 3) * 4 ||
        base64DecodedLength(targetValue) > MAXIMUM_RAW_REQUEST_TARGET_BYTES))
  )
    issues.push({
      path: `${path}.value`,
      message: `must encode at most ${MAXIMUM_RAW_REQUEST_TARGET_BYTES} bytes`,
    });
  else if (
    encoding === "ascii" &&
    [...targetValue].some((character) => character.charCodeAt(0) > 0x7f)
  )
    issues.push({ path: `${path}.value`, message: "must contain only ASCII characters" });
  else if (encoding === "base64" && !isCanonicalBase64(targetValue))
    issues.push({ path: `${path}.value`, message: "must be canonical base64" });
  if (
    issues.length !== issueCount ||
    (encoding !== "ascii" && encoding !== "base64") ||
    typeof targetValue !== "string"
  )
    return undefined;
  return { encoding, value: targetValue };
}

function isRawRequestTargetAuthority(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return (
        code >= 0x21 && code <= 0x7e && character !== "/" && character !== "?" && character !== "#"
      );
    })
  );
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary) === value;
  } catch {
    return false;
  }
}

function base64DecodedLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length / 4) * 3 - padding;
}

export function decodeScenarioRawRequestTarget(target: ScenarioRawRequestTargetBytes): Uint8Array {
  const issues: ManifestIssue[] = [];
  const parsed = parseRawRequestTargetBytes(target, "rawRequestTarget", issues, true);
  if (parsed === undefined)
    throw new TypeError("raw request target bytes failed runtime validation");
  return decodeValidatedRawRequestTarget(parsed);
}

export function materializeScenarioRawRequestTarget(
  target: ScenarioRawRequestTarget,
  resolvedUrl: string,
): Uint8Array {
  const issues: ManifestIssue[] = [];
  const parsed = parseRawRequestTarget(target, "rawRequestTarget", issues);
  if (parsed === undefined) throw new TypeError("raw request target failed runtime validation");
  if (typeof resolvedUrl !== "string")
    throw new TypeError("resolved raw request-target URL must be a string");
  if ("encoding" in parsed) return decodeValidatedRawRequestTarget(parsed);
  const url = new URL(resolvedUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("resolved raw request-target URL must use HTTP or HTTPS");
  const pathname = asciiBytes(url.pathname);
  const query = asciiBytes(url.search);
  const insertion =
    parsed.insertBeforeFinalPathSegment === undefined
      ? new Uint8Array()
      : decodeValidatedRawRequestTarget(parsed.insertBeforeFinalPathSegment);
  const suffix =
    parsed.suffix === undefined ? new Uint8Array() : decodeValidatedRawRequestTarget(parsed.suffix);
  const finalSegmentOffset = url.pathname.lastIndexOf("/") + 1;
  const prefix =
    parsed.form === "origin"
      ? new Uint8Array()
      : asciiBytes(
          parsed.form === "scheme-relative"
            ? `//${parsed.authority}`
            : `${url.protocol}//${parsed.authority}`,
        );
  const length = prefix.length + pathname.length + insertion.length + query.length + suffix.length;
  if (length > MAXIMUM_RAW_REQUEST_TARGET_BYTES)
    throw new RangeError(
      `materialized raw request target must not exceed ${MAXIMUM_RAW_REQUEST_TARGET_BYTES} bytes`,
    );
  const materialized = new Uint8Array(length);
  let offset = 0;
  const append = (bytes: Uint8Array): void => {
    materialized.set(bytes, offset);
    offset += bytes.length;
  };
  append(prefix);
  append(pathname.subarray(0, finalSegmentOffset));
  append(insertion);
  append(pathname.subarray(finalSegmentOffset));
  append(query);
  append(suffix);
  return materialized;
}

function decodeValidatedRawRequestTarget(target: ScenarioRawRequestTargetBytes): Uint8Array {
  if (target.encoding === "ascii") return asciiBytes(target.value);
  return Uint8Array.from(atob(target.value), (character) => character.charCodeAt(0));
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function parseProgrammaticAction(
  candidate: Record<string, unknown>,
  path: string,
  issues: ManifestIssue[],
  family: ScenarioProgrammaticAction["family"],
  id: string | undefined,
  prerequisiteScenario: string | undefined,
): ScenarioProgrammaticAction | undefined {
  const operation = readId(ownValue(candidate, "operation"), `${path}.operation`, issues);
  const inputValue = ownValue(candidate, "input");
  const inputFixturePointerValue = ownValue(candidate, "inputFixturePointer");
  const hasInput = inputValue !== undefined;
  const hasInputFixturePointer = inputFixturePointerValue !== undefined;
  if (hasInput === hasInputFixturePointer)
    issues.push({
      path,
      message: "must choose exactly one of input or inputFixturePointer",
    });
  const input = hasInput && isJsonValue(inputValue) ? cloneJson(inputValue) : undefined;
  if (hasInput && input === undefined)
    issues.push({ path: `${path}.input`, message: "must be a finite JSON value" });
  const inputFixturePointer = hasInputFixturePointer
    ? readJsonPointer(inputFixturePointerValue, `${path}.inputFixturePointer`, issues)
    : undefined;
  if (inputFixturePointer !== undefined && !inputFixturePointer.startsWith("/oracles/"))
    issues.push({
      path: `${path}.inputFixturePointer`,
      message: "must select from the fixture /oracles/ namespace",
    });
  const captures = parseCaptures(ownValue(candidate, "captures"), `${path}.captures`, issues);
  const assertions = parseAssertions(
    ownValue(candidate, "assertions"),
    `${path}.assertions`,
    issues,
  );
  const jsonCaptures = captures?.filter(
    (capture): capture is ScenarioJsonCapture => capture.from.kind === "json-pointer",
  );
  if (captures !== undefined)
    for (const [index, capture] of captures.entries())
      if (capture.from.kind !== "json-pointer")
        issues.push({
          path: `${path}.captures[${index}].from.kind`,
          message: "non-HTTP actions permit only json-pointer captures",
        });
  const jsonAssertions = assertions?.filter((assertion): assertion is ScenarioJsonAssertion =>
    assertion.kind.startsWith("json-"),
  );
  if (assertions !== undefined)
    for (const [index, assertion] of assertions.entries())
      if (!assertion.kind.startsWith("json-"))
        issues.push({
          path: `${path}.assertions[${index}].kind`,
          message: "non-HTTP actions permit only JSON assertions",
        });
  if (
    id === undefined ||
    operation === undefined ||
    (input === undefined && inputFixturePointer === undefined) ||
    captures === undefined ||
    jsonCaptures?.length !== captures.length ||
    assertions === undefined ||
    jsonAssertions?.length !== assertions.length
  )
    return undefined;
  const action = {
    id,
    family,
    operation,
    captures: jsonCaptures,
    assertions: jsonAssertions,
    ...(prerequisiteScenario === undefined ? {} : { prerequisiteScenario }),
  };
  return input === undefined
    ? { ...action, inputFixturePointer: inputFixturePointer as string }
    : { ...action, input };
}

function parseTarget(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ScenarioTarget | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, TARGET_KEYS, path, issues);
  const binding = readId(ownValue(value, "binding"), `${path}.binding`, issues);
  const pathValue = ownValue(value, "path");
  if (pathValue !== undefined && (typeof pathValue !== "string" || !isSafeRelativePath(pathValue)))
    issues.push({
      path: `${path}.path`,
      message: "must be a relative path without authority, scheme, query, or fragment",
    });
  const queryValue = ownValue(value, "query");
  const query =
    queryValue === undefined ? undefined : parseQueryMap(queryValue, `${path}.query`, issues);
  if (
    binding === undefined ||
    (pathValue !== undefined &&
      (typeof pathValue !== "string" || !isSafeRelativePath(pathValue))) ||
    (queryValue !== undefined && query === undefined)
  )
    return undefined;
  return {
    binding,
    ...(pathValue === undefined ? {} : { path: pathValue }),
    ...(query === undefined ? {} : { query }),
  };
}

function parseQueryMap(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): Readonly<Record<string, ScenarioQueryValue>> | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  const result: Record<string, ScenarioQueryValue> = Object.create(null) as Record<
    string,
    ScenarioQueryValue
  >;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (typeof entry === "string") {
      result[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      // A repeated key is a deliberate authoring act; a one-element array is a
      // string spelled confusingly and is rejected to keep the vocabulary sharp.
      if (entry.length < 2 || entry.some((occurrence) => typeof occurrence !== "string")) {
        issues.push({
          path: entryPath,
          message: "a repeated query key must be an array of at least two strings",
        });
        continue;
      }
      result[key] = entry as [string, string, ...string[]];
      continue;
    }
    if (!isPlainRecord(entry)) {
      issues.push({ path: entryPath, message: "must be a string or query binding" });
      continue;
    }
    reportUnknownKeys(entry, QUERY_BINDING_KEYS, entryPath, issues);
    const binding = readId(ownValue(entry, "binding"), `${entryPath}.binding`, issues);
    const representation = ownValue(entry, "representation");
    if (representation !== "absolute-url" && representation !== "scope-relative-url")
      issues.push({
        path: `${entryPath}.representation`,
        message: "must be 'absolute-url' or 'scope-relative-url'",
      });
    if (
      binding !== undefined &&
      (representation === "absolute-url" || representation === "scope-relative-url")
    )
      result[key] = { binding, representation };
  }
  return Object.keys(result).length === Object.keys(value).length ? result : undefined;
}

function parseHeaders(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return {};
  const headers = parseStringMap(value, path, issues);
  if (headers === undefined) return undefined;
  for (const name of Object.keys(headers)) {
    if (!HEADER_PATTERN.test(name) || name !== name.toLowerCase())
      issues.push({ path: `${path}.${name}`, message: "must be a lowercase HTTP field name" });
    if (
      name === name.toLowerCase() &&
      (SECRET_HEADER_PATTERN.test(name) || /(?:token|secret|password|credential|auth)/i.test(name))
    )
      issues.push({
        path: `${path}.${name}`,
        message: "secret headers are not allowed in a scenario",
      });
    if (!HTTP_FIELD_VALUE_PATTERN.test(headers[name] as string))
      issues.push({ path: `${path}.${name}`, message: "must be a valid HTTP field value" });
  }
  return headers;
}

function parseCaptures(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): readonly ScenarioCapture[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return undefined;
  }
  const captures: ScenarioCapture[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const capturePath = `${path}[${index}]`;
    if (!isPlainRecord(candidate)) {
      issues.push({ path: capturePath, message: "must be a plain record" });
      continue;
    }
    reportUnknownKeys(candidate, CAPTURE_KEYS, capturePath, issues);
    const binding = readId(ownValue(candidate, "binding"), `${capturePath}.binding`, issues);
    const from = ownValue(candidate, "from");
    if (!isPlainRecord(from)) {
      issues.push({ path: `${capturePath}.from`, message: "must be a plain record" });
      continue;
    }
    const kind = ownValue(from, "kind");
    let parsed: ScenarioCapture | undefined;
    if (kind === "response-url") {
      reportUnknownKeys(from, RESPONSE_URL_CAPTURE_KEYS, `${capturePath}.from`, issues);
      parsed = binding === undefined ? undefined : { binding, from: { kind } };
    } else if (kind === "header-link") {
      reportUnknownKeys(from, HEADER_LINK_CAPTURE_KEYS, `${capturePath}.from`, issues);
      const rel = readNonemptyString(ownValue(from, "rel"), `${capturePath}.from.rel`, issues);
      parsed =
        binding === undefined || rel === undefined ? undefined : { binding, from: { kind, rel } };
    } else if (kind === "json-pointer") {
      reportUnknownKeys(from, JSON_POINTER_CAPTURE_KEYS, `${capturePath}.from`, issues);
      const pointer = readJsonPointer(
        ownValue(from, "pointer"),
        `${capturePath}.from.pointer`,
        issues,
      );
      parsed =
        binding === undefined || pointer === undefined
          ? undefined
          : { binding, from: { kind, pointer } };
    } else
      issues.push({
        path: `${capturePath}.from.kind`,
        message: "must be 'response-url', 'header-link', or 'json-pointer'",
      });
    if (binding !== undefined && ids.has(binding))
      issues.push({ path: `${capturePath}.binding`, message: "must be unique within the request" });
    else if (binding !== undefined) ids.add(binding);
    if (parsed !== undefined) captures.push(parsed);
  }
  return captures.length === value.length ? captures : undefined;
}

function parseAssertions(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): readonly ScenarioAssertion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must be a non-empty array" });
    return undefined;
  }
  const assertions: ScenarioAssertion[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const assertionPath = `${path}[${index}]`;
    if (!isPlainRecord(candidate)) {
      issues.push({ path: assertionPath, message: "must be a plain record" });
      continue;
    }
    const id = readId(ownValue(candidate, "id"), `${assertionPath}.id`, issues);
    if (id !== undefined && ids.has(id))
      issues.push({ path: `${assertionPath}.id`, message: "must be unique within the request" });
    else if (id !== undefined) ids.add(id);
    const kind = ownValue(candidate, "kind");
    let assertion: ScenarioAssertion | undefined;
    if (kind === "status") {
      reportUnknownKeys(candidate, STATUS_ASSERTION_KEYS, assertionPath, issues);
      const equalsValue = ownValue(candidate, "equals");
      const oneOfValue = ownValue(candidate, "oneOf");
      const hasEquals = equalsValue !== undefined;
      const hasOneOf = oneOfValue !== undefined;
      if (hasEquals === hasOneOf)
        issues.push({
          path: assertionPath,
          message: "status assertion must choose exactly one of equals or oneOf",
        });
      else if (hasEquals && (!isInteger(equalsValue) || equalsValue < 100 || equalsValue > 599))
        issues.push({ path: `${assertionPath}.equals`, message: "must be an HTTP status" });
      else if (
        hasOneOf &&
        (!Array.isArray(oneOfValue) ||
          oneOfValue.length === 0 ||
          oneOfValue.some((status) => !isInteger(status) || status < 100 || status > 599))
      )
        issues.push({
          path: `${assertionPath}.oneOf`,
          message: "must be a non-empty array of HTTP statuses",
        });
      else if (
        hasOneOf &&
        new Set(oneOfValue as readonly number[]).size !== (oneOfValue as readonly number[]).length
      )
        issues.push({ path: `${assertionPath}.oneOf`, message: "must not contain duplicates" });
      else if (id !== undefined)
        assertion = hasEquals
          ? { id, kind, equals: equalsValue as number }
          : { id, kind, oneOf: [...(oneOfValue as number[])] };
    } else if (kind === "header") {
      reportUnknownKeys(candidate, HEADER_ASSERTION_KEYS, assertionPath, issues);
      const name = ownValue(candidate, "name");
      const equalsValue = ownValue(candidate, "equals");
      const containsValue = ownValue(candidate, "contains");
      const absentValue = ownValue(candidate, "absent");
      const alternatives = [equalsValue, containsValue, absentValue].filter(
        (entry) => entry !== undefined,
      );
      if (typeof name !== "string" || !HEADER_PATTERN.test(name) || name !== name.toLowerCase())
        issues.push({
          path: `${assertionPath}.name`,
          message: "must be a lowercase HTTP field name",
        });
      if (alternatives.length !== 1)
        issues.push({
          path: assertionPath,
          message: "header assertion must choose exactly one of equals, contains, or absent",
        });
      else if (equalsValue !== undefined && typeof equalsValue !== "string")
        issues.push({ path: `${assertionPath}.equals`, message: "must be a string" });
      else if (containsValue !== undefined && typeof containsValue !== "string")
        issues.push({ path: `${assertionPath}.contains`, message: "must be a string" });
      else if (absentValue !== undefined && typeof absentValue !== "boolean")
        issues.push({ path: `${assertionPath}.absent`, message: "must be a boolean" });
      else if (id !== undefined && typeof name === "string")
        assertion = {
          id,
          kind,
          name,
          ...(equalsValue === undefined ? {} : { equals: equalsValue }),
          ...(containsValue === undefined ? {} : { contains: containsValue }),
          ...(absentValue === undefined ? {} : { absent: absentValue }),
        };
    } else if (kind === "header-tokens") {
      reportUnknownKeys(candidate, HEADER_TOKENS_ASSERTION_KEYS, assertionPath, issues);
      const name = ownValue(candidate, "name");
      const includes = ownValue(candidate, "includes");
      const optional = ownValue(candidate, "optional");
      const allowsAdditional = ownValue(candidate, "allowsAdditional");
      const caseInsensitiveValue = ownValue(candidate, "caseInsensitive");
      const caseInsensitive = caseInsensitiveValue === true ? true : undefined;
      if (typeof name !== "string" || !HEADER_PATTERN.test(name) || name !== name.toLowerCase())
        issues.push({
          path: `${assertionPath}.name`,
          message: "must be a lowercase HTTP field name",
        });
      if (caseInsensitiveValue !== undefined && caseInsensitiveValue !== true)
        issues.push({
          path: `${assertionPath}.caseInsensitive`,
          message: "must equal true when present",
        });
      const includesAreStrings =
        Array.isArray(includes) &&
        includes.length > 0 &&
        includes.every(
          (entry) => typeof entry === "string" && entry.trim() === entry && entry.length > 0,
        );
      const normalizedIncludes = includesAreStrings
        ? (includes as string[]).map((entry) =>
            caseInsensitive === true ? entry.toLowerCase() : entry,
          )
        : [];
      const includesIsValid =
        includesAreStrings && new Set(normalizedIncludes).size === normalizedIncludes.length;
      if (!includesIsValid)
        issues.push({
          path: `${assertionPath}.includes`,
          message: "must be unique non-empty strings",
        });
      if (typeof allowsAdditional !== "boolean")
        issues.push({ path: `${assertionPath}.allowsAdditional`, message: "must be a boolean" });
      const optionalAreStrings =
        optional === undefined ||
        (Array.isArray(optional) &&
          optional.length > 0 &&
          optional.every(
            (entry) => typeof entry === "string" && entry.trim() === entry && entry.length > 0,
          ));
      const normalizedOptional =
        Array.isArray(optional) && optionalAreStrings
          ? (optional as string[]).map((entry) =>
              caseInsensitive === true ? entry.toLowerCase() : entry,
            )
          : [];
      const optionalIsValid =
        optionalAreStrings && new Set(normalizedOptional).size === normalizedOptional.length;
      if (!optionalIsValid)
        issues.push({
          path: `${assertionPath}.optional`,
          message: "must be unique non-empty strings",
        });
      const optionalOverlapsRequired =
        normalizedOptional.length > 0 &&
        normalizedIncludes.some((entry) => normalizedOptional.includes(entry));
      if (optionalOverlapsRequired)
        issues.push({
          path: `${assertionPath}.optional`,
          message: "must not duplicate a required token",
        });
      else if (
        optionalIsValid &&
        includesIsValid &&
        id !== undefined &&
        typeof name === "string" &&
        typeof allowsAdditional === "boolean"
      )
        assertion = {
          id,
          kind,
          name,
          includes: [...includes] as string[],
          ...(Array.isArray(optional) ? { optional: [...optional] as string[] } : {}),
          allowsAdditional,
          ...(caseInsensitive === undefined ? {} : { caseInsensitive }),
        };
    } else if (kind === "media-type") {
      reportUnknownKeys(candidate, MEDIA_TYPE_ASSERTION_KEYS, assertionPath, issues);
      const equals = ownValue(candidate, "equals");
      if (
        typeof equals !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(equals)
      )
        issues.push({ path: `${assertionPath}.equals`, message: "must be an HTTP media type" });
      else if (id !== undefined) assertion = { id, kind, equals: equals.toLowerCase() };
    } else if (kind === "body-absent") {
      reportUnknownKeys(candidate, BODY_ABSENT_ASSERTION_KEYS, assertionPath, issues);
      if (id !== undefined) assertion = { id, kind };
    } else if (kind === "wire-not-contains") {
      reportUnknownKeys(candidate, WIRE_NOT_CONTAINS_ASSERTION_KEYS, assertionPath, issues);
      const fixturePointer = readJsonPointer(
        ownValue(candidate, "fixturePointer"),
        `${assertionPath}.fixturePointer`,
        issues,
      );
      if (fixturePointer !== undefined && !fixturePointer.startsWith("/private/"))
        issues.push({
          path: `${assertionPath}.fixturePointer`,
          message: "must select a value beneath /private/",
        });
      else if (id !== undefined && fixturePointer !== undefined)
        assertion = { id, kind, fixturePointer };
    } else if (kind === "response-metadata-equals") {
      reportUnknownKeys(candidate, RESPONSE_METADATA_EQUALS_ASSERTION_KEYS, assertionPath, issues);
      const request = readId(ownValue(candidate, "request"), `${assertionPath}.request`, issues);
      const headers = ownValue(candidate, "headers");
      const validHeaders =
        Array.isArray(headers) &&
        headers.length > 0 &&
        headers.every(
          (header) => typeof header === "string" && STABLE_RESPONSE_METADATA_HEADERS.has(header),
        ) &&
        new Set(headers).size === headers.length;
      if (!validHeaders)
        issues.push({
          path: `${assertionPath}.headers`,
          message: "must be unique stable lowercase response header names",
        });
      else if (id !== undefined && request !== undefined)
        assertion = { id, kind, request, headers: [...headers] as string[] };
    } else if (kind === "json-equals") {
      reportUnknownKeys(candidate, JSON_EQUALS_ASSERTION_KEYS, assertionPath, issues);
      const value = ownValue(candidate, "value");
      const fixturePointerValue = ownValue(candidate, "fixturePointer");
      const normalize = ownValue(candidate, "normalize");
      const timestampPointersValue = ownValue(candidate, "timestampPointers");
      const hasValue = value !== undefined;
      const hasFixturePointer = fixturePointerValue !== undefined;
      const timestampPointers =
        timestampPointersValue === undefined
          ? undefined
          : readTimestampPointers(
              timestampPointersValue,
              `${assertionPath}.timestampPointers`,
              issues,
            );
      if (hasValue === hasFixturePointer)
        issues.push({
          path: assertionPath,
          message: "json-equals assertion must choose exactly one of value or fixturePointer",
        });
      else if (hasValue && !isJsonValue(value))
        issues.push({ path: `${assertionPath}.value`, message: "must be a JSON value" });
      if (normalize !== undefined && normalize !== "iso-timestamps")
        issues.push({
          path: `${assertionPath}.normalize`,
          message: "must be iso-timestamps",
        });
      if (normalize === "iso-timestamps" && timestampPointersValue === undefined)
        issues.push({
          path: `${assertionPath}.timestampPointers`,
          message: "must explicitly list dynamic timestamp JSON Pointers",
        });
      else if (normalize !== "iso-timestamps" && timestampPointersValue !== undefined)
        issues.push({
          path: `${assertionPath}.timestampPointers`,
          message: "requires normalize: iso-timestamps",
        });
      if (hasFixturePointer && !hasValue) {
        const fixturePointer = readJsonPointer(
          fixturePointerValue,
          `${assertionPath}.fixturePointer`,
          issues,
        );
        if (fixturePointer !== undefined && !fixturePointer.startsWith("/oracles/"))
          issues.push({
            path: `${assertionPath}.fixturePointer`,
            message: "must select a value beneath /oracles/",
          });
        else if (id !== undefined && fixturePointer !== undefined)
          assertion = {
            id,
            kind,
            fixturePointer,
            ...(normalize === "iso-timestamps" ? { normalize } : {}),
            ...(timestampPointers === undefined ? {} : { timestampPointers }),
          };
      } else if (hasValue && isJsonValue(value) && id !== undefined)
        assertion = {
          id,
          kind,
          value: cloneJson(value),
          ...(normalize === "iso-timestamps" ? { normalize } : {}),
          ...(timestampPointers === undefined ? {} : { timestampPointers }),
        };
    } else if (kind === "json-pointer") {
      reportUnknownKeys(candidate, JSON_POINTER_ASSERTION_KEYS, assertionPath, issues);
      const pointer = readJsonPointer(
        ownValue(candidate, "pointer"),
        `${assertionPath}.pointer`,
        issues,
      );
      const exists = ownValue(candidate, "exists");
      const equals = ownValue(candidate, "equals");
      const equalsRunProfile = ownValue(candidate, "equalsRunProfile");
      const fixturePointerValue = ownValue(candidate, "fixturePointer");
      const timestampPointersValue = ownValue(candidate, "timestampPointers");
      const fixturePointer =
        fixturePointerValue === undefined
          ? undefined
          : readJsonPointer(fixturePointerValue, `${assertionPath}.fixturePointer`, issues);
      const normalize = ownValue(candidate, "normalize");
      const timestampPointers =
        timestampPointersValue === undefined
          ? undefined
          : readTimestampPointers(
              timestampPointersValue,
              `${assertionPath}.timestampPointers`,
              issues,
            );
      if (typeof exists !== "boolean")
        issues.push({ path: `${assertionPath}.exists`, message: "must be a boolean" });
      if (equalsRunProfile !== undefined && equalsRunProfile !== true)
        issues.push({ path: `${assertionPath}.equalsRunProfile`, message: "must equal true" });
      if (equals !== undefined && !isJsonValue(equals))
        issues.push({ path: `${assertionPath}.equals`, message: "must be a JSON value" });
      if (
        [equals !== undefined, equalsRunProfile === true, fixturePointerValue !== undefined].filter(
          Boolean,
        ).length > 1
      )
        issues.push({
          path: assertionPath,
          message: "json-pointer assertion may choose only one expected value source",
        });
      if (fixturePointer !== undefined && !fixturePointer.startsWith("/oracles/"))
        issues.push({
          path: `${assertionPath}.fixturePointer`,
          message: "must select a value beneath /oracles/",
        });
      if (
        normalize !== undefined &&
        normalize !== "scope-relative-url" &&
        normalize !== "iso-timestamps"
      )
        issues.push({
          path: `${assertionPath}.normalize`,
          message: "must be scope-relative-url or iso-timestamps",
        });
      if (normalize === "iso-timestamps" && timestampPointersValue === undefined)
        issues.push({
          path: `${assertionPath}.timestampPointers`,
          message: "must explicitly list dynamic timestamp JSON Pointers",
        });
      else if (normalize !== "iso-timestamps" && timestampPointersValue !== undefined)
        issues.push({
          path: `${assertionPath}.timestampPointers`,
          message: "requires normalize: iso-timestamps",
        });
      if (
        normalize === "scope-relative-url" &&
        fixturePointer === undefined &&
        typeof equals !== "string"
      )
        issues.push({
          path: `${assertionPath}.normalize`,
          message: "requires a string equals value or fixturePointer",
        });
      else if (
        exists === false &&
        (equals !== undefined || equalsRunProfile === true || fixturePointer !== undefined)
      )
        issues.push({
          path:
            equals !== undefined
              ? `${assertionPath}.equals`
              : equalsRunProfile === true
                ? `${assertionPath}.equalsRunProfile`
                : `${assertionPath}.fixturePointer`,
          message: "must be true when an expected value is supplied",
        });
      else if (
        normalize === "iso-timestamps" &&
        (equalsRunProfile === true || (equals === undefined && fixturePointer === undefined))
      )
        issues.push({
          path: `${assertionPath}.normalize`,
          message: "iso-timestamps requires an explicit string or fixturePointer oracle",
        });
      else if (id !== undefined && pointer !== undefined && typeof exists === "boolean")
        assertion = {
          id,
          kind,
          pointer,
          exists,
          ...(equals === undefined ? {} : { equals: cloneJson(equals as JsonValue) }),
          ...(equalsRunProfile === true ? { equalsRunProfile: true } : {}),
          ...(fixturePointer === undefined ? {} : { fixturePointer }),
          ...(normalize === "scope-relative-url" || normalize === "iso-timestamps"
            ? { normalize }
            : {}),
          ...(timestampPointers === undefined ? {} : { timestampPointers }),
        };
    } else if (kind === "json-array-set") {
      reportUnknownKeys(candidate, JSON_ARRAY_SET_ASSERTION_KEYS, assertionPath, issues);
      const pointer = readJsonPointer(
        ownValue(candidate, "pointer"),
        `${assertionPath}.pointer`,
        issues,
      );
      const itemPointer = readJsonPointer(
        ownValue(candidate, "itemPointer"),
        `${assertionPath}.itemPointer`,
        issues,
      );
      const equals = ownValue(candidate, "equals");
      const fixturePointerValue = ownValue(candidate, "fixturePointer");
      const hasEquals = equals !== undefined;
      const hasFixturePointer = fixturePointerValue !== undefined;
      const fixturePointer =
        fixturePointerValue === undefined
          ? undefined
          : readJsonPointer(fixturePointerValue, `${assertionPath}.fixturePointer`, issues);
      const normalize = ownValue(candidate, "normalize");
      const equalsIsValid =
        Array.isArray(equals) &&
        equals.every(isJsonValue) &&
        (normalize === undefined || equals.every((value) => typeof value === "string"));
      if (hasEquals === hasFixturePointer)
        issues.push({
          path: assertionPath,
          message: "json-array-set assertion must choose exactly one of equals or fixturePointer",
        });
      else if (hasEquals && !equalsIsValid)
        issues.push({
          path: `${assertionPath}.equals`,
          message:
            "must be an array of JSON values, with strings when scope-relative-url normalization is selected",
        });
      if (fixturePointer !== undefined && !fixturePointer.startsWith("/oracles/"))
        issues.push({
          path: `${assertionPath}.fixturePointer`,
          message: "must select a value beneath /oracles/",
        });
      if (
        normalize !== undefined &&
        normalize !== "scope-relative-url" &&
        normalize !== "scope-relative-or-absolute-uri"
      )
        issues.push({
          path: `${assertionPath}.normalize`,
          message: "must be scope-relative-url or scope-relative-or-absolute-uri",
        });
      if (
        id !== undefined &&
        pointer !== undefined &&
        itemPointer !== undefined &&
        hasEquals !== hasFixturePointer &&
        (equalsIsValid || fixturePointer !== undefined) &&
        (fixturePointer === undefined || fixturePointer.startsWith("/oracles/")) &&
        (normalize === undefined ||
          normalize === "scope-relative-url" ||
          normalize === "scope-relative-or-absolute-uri")
      )
        assertion = {
          id,
          kind,
          pointer,
          itemPointer,
          ...(fixturePointer === undefined
            ? { equals: (equals as JsonValue[]).map(cloneJson) }
            : { fixturePointer }),
          ...(normalize === undefined ? {} : { normalize }),
        };
    } else if (kind === "json-array-tuples") {
      reportUnknownKeys(candidate, JSON_ARRAY_TUPLES_ASSERTION_KEYS, assertionPath, issues);
      const pointer = readJsonPointer(
        ownValue(candidate, "pointer"),
        `${assertionPath}.pointer`,
        issues,
      );
      const projectionsValue = ownValue(candidate, "projections");
      const projections: {
        pointer: string;
        normalize?: "scope-relative-url" | "scope-relative-or-absolute-uri";
      }[] = [];
      if (!Array.isArray(projectionsValue) || projectionsValue.length === 0) {
        issues.push({
          path: `${assertionPath}.projections`,
          message: "must be a non-empty array",
        });
      } else {
        for (const [projectionIndex, projectionValue] of projectionsValue.entries()) {
          const projectionPath = `${assertionPath}.projections[${projectionIndex}]`;
          if (!isPlainRecord(projectionValue)) {
            issues.push({ path: projectionPath, message: "must be a plain record" });
            continue;
          }
          reportUnknownKeys(projectionValue, JSON_TUPLE_PROJECTION_KEYS, projectionPath, issues);
          const projectionPointer = readJsonPointer(
            ownValue(projectionValue, "pointer"),
            `${projectionPath}.pointer`,
            issues,
          );
          const normalize = ownValue(projectionValue, "normalize");
          const normalizeIsValid =
            normalize === undefined ||
            normalize === "scope-relative-url" ||
            normalize === "scope-relative-or-absolute-uri";
          if (!normalizeIsValid)
            issues.push({
              path: `${projectionPath}.normalize`,
              message: "must be scope-relative-url or scope-relative-or-absolute-uri",
            });
          if (projectionPointer !== undefined && normalizeIsValid)
            projections.push({
              pointer: projectionPointer,
              ...(normalize === undefined ? {} : { normalize }),
            });
        }
      }
      const equals = ownValue(candidate, "equals");
      const fixturePointerValue = ownValue(candidate, "fixturePointer");
      const hasEquals = equals !== undefined;
      const hasFixturePointer = fixturePointerValue !== undefined;
      const fixturePointer =
        fixturePointerValue === undefined
          ? undefined
          : readJsonPointer(fixturePointerValue, `${assertionPath}.fixturePointer`, issues);
      if (hasEquals === hasFixturePointer)
        issues.push({
          path: assertionPath,
          message:
            "json-array-tuples assertion must choose exactly one of equals or fixturePointer",
        });
      if (fixturePointer !== undefined && !fixturePointer.startsWith("/oracles/"))
        issues.push({
          path: `${assertionPath}.fixturePointer`,
          message: "must select a value beneath /oracles/",
        });
      const projectionWidth = Array.isArray(projectionsValue) ? projectionsValue.length : 0;
      const equalsShapeIsValid =
        hasEquals &&
        Array.isArray(equals) &&
        equals.every(
          (tuple) =>
            Array.isArray(tuple) && tuple.length === projectionWidth && tuple.every(isJsonValue),
        );
      const projectionsAreValid =
        Array.isArray(projectionsValue) &&
        projectionsValue.length > 0 &&
        projections.length === projectionsValue.length;
      const normalizedCellsAreValid =
        !equalsShapeIsValid ||
        !projectionsAreValid ||
        (equals as JsonValue[][]).every((tuple) =>
          tuple.every(
            (value, index) =>
              projections[index]?.normalize === undefined || typeof value === "string",
          ),
        );
      const equalsIsValid = equalsShapeIsValid && normalizedCellsAreValid;
      if (hasEquals && !equalsIsValid)
        issues.push({
          path: `${assertionPath}.equals`,
          message:
            "must contain JSON tuples matching the projection width with strings for normalized values",
        });
      if (
        id !== undefined &&
        pointer !== undefined &&
        Array.isArray(projectionsValue) &&
        projectionsValue.length > 0 &&
        projectionsAreValid &&
        hasEquals !== hasFixturePointer &&
        (equalsIsValid || fixturePointer?.startsWith("/oracles/"))
      )
        assertion = {
          id,
          kind,
          pointer,
          projections,
          ...(fixturePointer === undefined
            ? {
                equals: (equals as JsonValue[][]).map((tuple) => tuple.map(cloneJson)),
              }
            : { fixturePointer }),
        };
    } else if (kind === "json-schema") {
      reportUnknownKeys(candidate, JSON_SCHEMA_ASSERTION_KEYS, assertionPath, issues);
      const schema = readNonemptyString(
        ownValue(candidate, "schema"),
        `${assertionPath}.schema`,
        issues,
      );
      if (id !== undefined && schema !== undefined) assertion = { id, kind, schema };
    } else issues.push({ path: `${assertionPath}.kind`, message: "unknown assertion kind" });
    if (assertion !== undefined) assertions.push(assertion);
  }
  return assertions.length === value.length ? assertions : undefined;
}

function parseCleanup(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): { readonly resetFixture: true } | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, CLEANUP_KEYS, path, issues);
  if (ownValue(value, "resetFixture") !== true) {
    issues.push({ path: `${path}.resetFixture`, message: "must equal true" });
    return undefined;
  }
  return { resetFixture: true };
}

function readId(value: unknown, path: string, issues: ManifestIssue[]): string | undefined {
  const result = readNonemptyString(value, path, issues);
  if (result !== undefined && (!ID_PATTERN.test(result) || result.length > 128))
    issues.push({ path, message: "must be 1..128 lowercase identifier characters" });
  return result !== undefined && ID_PATTERN.test(result) && result.length <= 128
    ? result
    : undefined;
}

function readProfile(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ProtocolProfile | undefined {
  if (isProtocolProfile(value)) return value;
  issues.push({ path, message: "must be 'read', 'read-update', or 'transactional'" });
  return undefined;
}

function readMethod(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): ScenarioRequest["method"] | undefined {
  if (
    value === "GET" ||
    value === "HEAD" ||
    value === "OPTIONS" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  )
    return value;
  issues.push({ path, message: "must be a supported HTTP method" });
  return undefined;
}

function readJsonPointer(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): string | undefined {
  if (
    typeof value !== "string" ||
    (value !== "" && !value.startsWith("/")) ||
    value.split("/").some((part) => /~(?![01])/.test(part))
  ) {
    issues.push({ path, message: "must be an RFC 6901 JSON Pointer" });
    return undefined;
  }
  return value;
}

function readTimestampPointers(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must be a non-empty array of RFC 6901 JSON Pointers" });
    return undefined;
  }
  const pointers: string[] = [];
  for (const [index, pointer] of value.entries()) {
    const parsed = readJsonPointer(pointer, `${path}[${index}]`, issues);
    if (parsed !== undefined) pointers.push(parsed);
  }
  if (new Set(pointers).size !== pointers.length) {
    issues.push({ path, message: "must not contain duplicates" });
    return undefined;
  }
  return pointers.length === value.length ? pointers : undefined;
}

function readStringArray(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
  allowEmpty: boolean,
): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.trim() !== entry)
  ) {
    issues.push({ path, message: "must be an array of non-empty strings" });
    return undefined;
  }
  const result = [...value] as string[];
  if (new Set(result).size !== result.length)
    issues.push({ path, message: "must not contain duplicates" });
  return result;
}

function parseStringMap(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): Readonly<Record<string, string>> | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string")
      issues.push({ path: `${path}.${key}`, message: "must be a string" });
    else result[key] = entry;
  }
  return Object.keys(result).length === Object.keys(value).length ? result : undefined;
}

function readNonemptyString(
  value: unknown,
  path: string,
  issues: ManifestIssue[],
): string | undefined {
  if (typeof value === "string" && value.length > 0 && value.trim() === value) return value;
  issues.push({ path, message: "must be a non-empty string without surrounding whitespace" });
  return undefined;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isPlainRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJson(entry as JsonValue)]),
    );
  return value;
}

function reportUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  path: string,
  issues: ManifestIssue[],
): void {
  for (const key of Object.keys(value))
    if (!known.has(key)) issues.push({ path: `${path}.${key}`, message: "unknown member" });
}

function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("?") ||
    value.includes("#") ||
    hasForbiddenControl(value) ||
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    /%(?:2f|5c)/i.test(value)
  )
    return false;
  try {
    const segments = value.split("/");
    return segments.every((segment, index) => {
      for (const match of segment.matchAll(/%([0-9A-Fa-f]{2})/g)) {
        const encoded = match[1] as string;
        if (encoded !== encoded.toUpperCase()) return false;
        const decodedByte = String.fromCharCode(Number.parseInt(encoded, 16));
        if (/^[A-Za-z0-9._~-]$/.test(decodedByte)) return false;
      }
      const decoded = decodeURIComponent(segment);
      return (
        (segment.length > 0 || index === segments.length - 1) &&
        ![".", ".."].includes(decoded) &&
        !decoded.includes("\\") &&
        !decoded.includes("/") &&
        !hasForbiddenControl(decoded)
      );
    });
  } catch {
    return false;
  }
}

function hasForbiddenControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) as number;
    return code <= 0x1f || code === 0x7f;
  });
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
