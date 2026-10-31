import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { admitJsonNumbers, decodeJsonDocument, type AdmittedJsonValue } from "./json-admission.js";
import { snapshotJsonValue } from "./json-values.js";
import type { AbsoluteHttpUrl } from "./index.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import {
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  requireSchemaValidator,
} from "./read-values.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

export const RETAINED_V01_SPECIFICATION =
  "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json";
export const RETAINED_V01_MEDIA_TYPE = "application/vnd.bdp.v0.1+json";
export const RETAINED_WRITE_OPERATIONS = Object.freeze([
  "createBead",
  "updateBead",
  "deleteBead",
  "createLink",
  "updateLink",
  "deleteLink",
  "putAlias",
  "deleteAlias",
] as const);
export type RetainedWriteOperation = (typeof RETAINED_WRITE_OPERATIONS)[number];
export type RetainedWriteDirectory = Readonly<Record<RetainedWriteOperation, AbsoluteHttpUrl>>;
type JsonObject = Readonly<Record<string, AdmittedJsonValue>>;
export interface RetainedWriteDiscovery extends JsonObject {
  readonly bdpVersion: "0.1";
  readonly profile: "write";
  readonly scope: AbsoluteHttpUrl;
  readonly beads: AbsoluteHttpUrl;
  readonly links: AbsoluteHttpUrl;
  readonly events: AbsoluteHttpUrl;
  readonly operations: AbsoluteHttpUrl;
  readonly aliases: AbsoluteHttpUrl;
}

type SchemaRoot =
  | "writeDiscovery"
  | "writeOperationDirectory"
  | RetainedWriteOperation
  | "retainedDiscovery"
  | "currentBeadRecord"
  | "currentLinkRecord"
  | "properties"
  | "mutationResult"
  | "aliasResult"
  | "readUpdateProblem";
const validators = new Map<SchemaRoot, ValidateFunction>();
let schemaValidator: Ajv2020 | undefined;

export function validateRetainedValue(root: SchemaRoot, value: JsonObject): void {
  let check = validators.get(root);
  if (check === undefined) {
    if (schemaValidator === undefined) {
      const bundle: unknown = JSON.parse(
        readFileSync(new URL("../schemas/bdp-v0.1.schema.json", import.meta.url), "utf8"),
      );
      if (
        typeof bundle !== "object" ||
        bundle === null ||
        !("$id" in bundle) ||
        bundle.$id !== RETAINED_V01_SPECIFICATION
      )
        throw new ProtocolArtifactValidationError("retained v0.1 schema identity mismatch");
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
      ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
      ajv.addSchema(bundle as Record<string, unknown>);
      schemaValidator = ajv;
    }
    const definition = RETAINED_WRITE_OPERATIONS.includes(root as RetainedWriteOperation)
      ? `${root}Request`
      : root;
    check = requireSchemaValidator(
      schemaValidator,
      RETAINED_V01_SPECIFICATION,
      `#/$defs/${definition}`,
    );
    validators.set(root, check);
  }
  if (!check(value)) throw new ProtocolArtifactValidationError(`invalid retained v0.1 ${root}`);
}

/** Raw JSON only: reject duplicates, invalid Unicode and inadmissible numbers
 * before a rounded value can reach schema validation. The caller bounds bytes.
 * This is carrier validation, not Scope admission, authorization or execution.
 */
export function parseRetainedObject(text: string): JsonObject {
  if (typeof text !== "string")
    throw new ProtocolArtifactValidationError("retained v0.1 input must be JSON text");
  const admitted = admitJsonNumbers(decodeJsonDocument(text), {
    diagnostics: 1,
    diagnostic: () => ({ message: "inadmissible JSON number" }),
  });
  if (!admitted.ok)
    throw new ProtocolArtifactValidationError("retained v0.1 input has an inadmissible number");
  const value = snapshotJsonValue(admitted.value);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ProtocolArtifactValidationError("retained v0.1 input must be a JSON object");
  return value as JsonObject;
}

/** Selected Write discovery only; Core-only clients need a separate read seam.
 * Unknown capability advertisements remain opaque and grant no feature support.
 */
export function parseRetainedWriteDiscovery(text: string): RetainedWriteDiscovery {
  const value = parseRetainedObject(text);
  validateRetainedValue("writeDiscovery", value);
  parseCanonicalScope(value.scope);
  for (const field of ["beads", "links", "events", "operations", "aliases"] as const)
    parseCanonicalHttpUrl(value[field], `Write discovery.${field}`);
  return value as RetainedWriteDiscovery;
}

/** No relative suffixes, inferred paths, extra operations or duplicate targets. */
export function parseRetainedWriteDirectory(text: string): RetainedWriteDirectory {
  const value = parseRetainedObject(text);
  validateRetainedValue("writeOperationDirectory", value);
  const targets = new Set<string>();
  for (const operation of RETAINED_WRITE_OPERATIONS) {
    const url = parseCanonicalHttpUrl(value[operation], `Write directory.${operation}`);
    if (targets.has(url))
      throw new ProtocolArtifactValidationError("retained Write directory has ambiguous targets");
    targets.add(url);
  }
  return value as RetainedWriteDirectory;
}

/** Native singleton root, without a sequence/client envelope. Exact JSON text
 * remains the caller's frozen transmission; this snapshot is never reserialized.
 * Local reference resolution and destination admission are separate obligations.
 */
export function parseRetainedWriteInput(
  operation: RetainedWriteOperation,
  text: string,
): JsonObject {
  if (!RETAINED_WRITE_OPERATIONS.includes(operation))
    throw new ProtocolArtifactValidationError("unsupported retained Write operation");
  const value = parseRetainedObject(text);
  validateRetainedValue(operation, value);
  return value;
}
