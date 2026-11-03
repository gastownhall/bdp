/** Explicit historical-update1 carriers. Base Resource/result schemas stay closed. */
import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { stringifyJsonValue } from "./json-values.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import { parseCanonicalHttpUrl, requireSchemaValidator } from "./read-values.js";
import {
  parseRetainedResource,
  parseRetainedWriteResult,
  type RetainedJsonObject,
} from "./retained-read-values.js";
import { parseRetainedObject, type RetainedWriteDiscovery } from "./retained-write-values.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";
import { withBdpSourceAnnotations } from "./schema-source-annotations.js";

export const HISTORICAL_UPDATE_CAPABILITY =
  "https://github.com/gastownhall/bdp/capabilities/historical-update";
export const HISTORICAL_UPDATE_SCHEMA =
  "https://github.com/gastownhall/bdp/schemas/historical-update-v1.schema.json";
export const HISTORICAL_UPDATE_MEDIA = "application/vnd.bdp.v0.1.historical-update.v1+json";
export type HistoricalUpdateContext = Readonly<{ fromRevision: string; previousRevision: string }>;
export type HistoricalUpdateCapability = Readonly<{ atomicBatch: boolean }>;
export type HistoricalUpdateResult = RetainedJsonObject & {
  readonly result: RetainedJsonObject;
  readonly historicalUpdate?: HistoricalUpdateContext;
};
export type HistoricalUpdateView = RetainedJsonObject & {
  readonly resource: RetainedJsonObject;
  readonly historicalUpdate?: HistoricalUpdateContext;
};
export type HistoricalUpdateTerminalView = RetainedJsonObject & {
  readonly terminal: RetainedJsonObject;
};
type Root =
  | "historicalUpdateCapabilityV1"
  | "historicalUpdateRequest"
  | "historicalUpdateResult"
  | "historicalUpdateView"
  | "historicalUpdateTerminalView"
  | "historicalUpdateProblem";
let validator: Ajv2020 | undefined;
const checks = new Map<Root, ValidateFunction>();
function validate(root: Root, value: RetainedJsonObject): void {
  let check = checks.get(root);
  if (check === undefined) {
    if (validator === undefined) {
      const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true, allErrors: true }));
      ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
      ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
      for (const name of ["bdp-v0.1.schema.json", "historical-update-v1.schema.json"]) {
        ajv.addSchema(
          JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8")),
        );
      }
      validator = ajv;
    }
    check = requireSchemaValidator(validator, HISTORICAL_UPDATE_SCHEMA, `#/$defs/${root}`);
    checks.set(root, check);
  }
  if (!check(value))
    throw new ProtocolArtifactValidationError(`invalid historical-update1 ${root}`);
}

/** Only exact version1 selects this feature. Call after ordinary discovery
 * admission; unknown versions never grant support and base use stays opaque. */
export function readHistoricalUpdateCapability(
  discovery: RetainedWriteDiscovery,
): HistoricalUpdateCapability | undefined {
  const capabilities = discovery.capabilities;
  if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities))
    return undefined;
  const versions = (capabilities as RetainedJsonObject)[HISTORICAL_UPDATE_CAPABILITY];
  if (
    versions === null ||
    typeof versions !== "object" ||
    Array.isArray(versions) ||
    !Object.hasOwn(versions, "1")
  )
    return undefined;
  const selected = parseRetainedObject(stringifyJsonValue((versions as RetainedJsonObject)["1"]));
  validate("historicalUpdateCapabilityV1", selected);
  return selected as HistoricalUpdateCapability;
}
export function parseHistoricalUpdateRequest(text: string): RetainedJsonObject {
  const value = parseRetainedObject(text);
  validate("historicalUpdateRequest", value);
  return value;
}
export function parseHistoricalUpdateResult(text: string): HistoricalUpdateResult {
  const value = parseRetainedObject(text);
  validate("historicalUpdateResult", value);
  parseRetainedWriteResult("updateBead", stringifyJsonValue(value.result));
  return value as HistoricalUpdateResult;
}
export function parseHistoricalUpdateView(text: string): HistoricalUpdateView {
  const value = parseRetainedObject(text);
  validate("historicalUpdateView", value);
  parseRetainedResource(stringifyJsonValue(value.resource), "bead");
  return value as HistoricalUpdateView;
}
export function parseHistoricalUpdateTerminalView(text: string): HistoricalUpdateTerminalView {
  const value = parseRetainedObject(text);
  validate("historicalUpdateTerminalView", value);
  const terminal = value.terminal as RetainedJsonObject;
  parseCanonicalHttpUrl(terminal.id, "terminal identity");
  if (terminal.revision === terminal.previousRevision)
    throw new ProtocolArtifactValidationError(
      "terminal version must differ from its live predecessor",
    );
  return value as HistoricalUpdateTerminalView;
}
export function parseHistoricalUpdateProblem(text: string, status: number): RetainedJsonObject {
  const value = parseRetainedObject(text);
  validate("historicalUpdateProblem", value);
  if (value.status !== undefined && value.status !== status)
    throw new ProtocolArtifactValidationError("Problem status contradicts HTTP status");
  validate("historicalUpdateProblem", { ...value, status });
  return value;
}
