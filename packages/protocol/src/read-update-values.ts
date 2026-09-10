import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Attribution, BeadRecord, LinkRecord, ReadDiscovery } from "./index.js";
import type { ChangeContextInput } from "./history-values.js";
import {
  admitJsonNumbers,
  decodeJsonDocument,
  mapLosslessJson,
  isUnicodeScalarString,
  type AdmittedJsonValue,
  type JsonNumericAdmission,
  type JsonNumberDiagnosticBudget,
  type LosslessJsonValue,
} from "./json-admission.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import {
  assertCanonicalPathSegments,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseLinkRecord,
  parseCanonicalTypeId,
  readCanonicalSchemaBundle,
  requireSchemaValidator,
  snapshotProtocolRecord,
} from "./read-values.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";
import type { ReadUpdateProblem } from "./read-update-problems.js";

/** RU wire roots are separate from both Read registries. Parsing is not admission. */
export const READ_UPDATE_VALUE_SCHEMA_REFS = Object.freeze({
  createBead: "#/$defs/createBeadRequest",
  updateBeadProperties: "#/$defs/updateBeadPropertiesRequest",
  deleteBead: "#/$defs/deleteBeadRequest",
  createLink: "#/$defs/createLinkRequest",
  updateLinkProperties: "#/$defs/updateLinkPropertiesRequest",
  deleteLink: "#/$defs/deleteLinkRequest",
  putAlias: "#/$defs/putAliasRequest",
  deleteAlias: "#/$defs/deleteAliasRequest",
  sequenceRequest: "#/$defs/sequenceRequest",
  discovery: "#/$defs/readUpdateDiscovery",
  operationDirectory: "#/$defs/readUpdateOperationDirectory",
  mutationResult: "#/$defs/mutationResult",
  aliasResult: "#/$defs/aliasResult",
  problem: "#/$defs/readUpdateProblem",
  sequenceMemberProblem: "#/$defs/sequenceMemberProblem",
  sequenceResponse: "#/$defs/sequenceResponse",
} as const);
export type ReadUpdateOperation =
  | "createBead"
  | "updateBeadProperties"
  | "deleteBead"
  | "createLink"
  | "updateLinkProperties"
  | "deleteLink"
  | "putAlias"
  | "deleteAlias";
export type ReadUpdateInputReference = string | { readonly uri: string; readonly revision: string };
export type PropertyChange = readonly (
  | { readonly op: "add" | "replace"; readonly path: string; readonly value: AdmittedJsonValue }
  | { readonly op: "remove"; readonly path: string }
)[];
interface MintInput {
  readonly attribution?: Attribution;
  readonly changeContext?: ChangeContextInput;
}
export interface ReadUpdateInputs {
  readonly createBead: MintInput & {
    readonly type: string;
    readonly id?: string;
    readonly properties?: Readonly<Record<string, AdmittedJsonValue>>;
  };
  readonly updateBeadProperties: MintInput & {
    readonly bead: string;
    readonly change: PropertyChange;
    readonly expectedRevision?: string;
  };
  readonly deleteBead: { readonly bead: string; readonly expectedRevision?: string };
  readonly createLink: MintInput & {
    readonly type: string;
    readonly id?: string;
    readonly source: ReadUpdateInputReference;
    readonly target: ReadUpdateInputReference;
    readonly properties?: Readonly<Record<string, AdmittedJsonValue>>;
  };
  readonly updateLinkProperties: MintInput & {
    readonly link: string;
    readonly change: PropertyChange;
    readonly expectedRevision?: string;
  };
  readonly deleteLink: MintInput & { readonly link: string; readonly expectedRevision?: string };
  readonly putAlias: { readonly alias: string; readonly target: string };
  readonly deleteAlias: { readonly alias: string };
}
/** Raw input still contains literal nodes. No identity, numeric admission,
 * authorization, limits, contracts, storage or effect has been established.
 * These parsers check Scope-independent carrier syntax only. Before any key
 * claim or execution, the transport must preflight the WHOLE carrier against
 * its actual Scope: absolute in-Scope references need canonical local-path
 * checks, and absolute creation IDs need the correct fixed root. This is not
 * deferred member-time validation; opaque external endpoints stay unchanged.
 */
export interface UnadmittedReadUpdateOperation<
  K extends ReadUpdateOperation = ReadUpdateOperation,
> {
  readonly operation: K;
  readonly input: Readonly<Record<string, LosslessJsonValue>>;
  readonly idempotencyKey?: string;
  readonly name?: string;
}
export interface ReadUpdateSequenceRequest {
  readonly operations: readonly UnadmittedReadUpdateOperation[];
}
export type ReadUpdateNumericAdmission<K extends ReadUpdateOperation> =
  | { readonly ok: true; readonly input: ReadUpdateInputs[K] }
  | Extract<JsonNumericAdmission, { readonly ok: false }>;
export class ReadUpdateCarrierError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ReadUpdateCarrierError";
  }
}

let validators:
  | Readonly<Record<keyof typeof READ_UPDATE_VALUE_SCHEMA_REFS, ValidateFunction>>
  | undefined;
function validator(key: keyof typeof READ_UPDATE_VALUE_SCHEMA_REFS): ValidateFunction {
  if (!validators) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = readCanonicalSchemaBundle();
    ajv.addSchema(bundle);
    const id = bundle.$id;
    if (typeof id !== "string")
      throw new ProtocolArtifactValidationError("schema bundle needs $id");
    validators = Object.freeze(
      Object.fromEntries(
        Object.entries(READ_UPDATE_VALUE_SCHEMA_REFS).map(([name, ref]) => [
          name,
          requireSchemaValidator(ajv, id, ref),
        ]),
      ),
    ) as unknown as typeof validators;
  }
  const found = validators?.[key];
  if (!found) throw new ProtocolArtifactValidationError("unknown Read+Update schema root");
  return found;
}
function validate(value: unknown, key: keyof typeof READ_UPDATE_VALUE_SCHEMA_REFS): void {
  const check = validator(key);
  if (!check(value))
    throw new ProtocolArtifactValidationError(`Invalid ${key}: ${JSON.stringify(check.errors)}`);
}
/** Internal shared schema/snapshot boundary for RU response parsers. Object
 * inputs have already lost source spelling; raw requests MUST use text APIs.
 * Existing protocol artifact snapshot resource bounds are local reader bounds.
 */
export function parseReadUpdateShape(
  value: unknown,
  key: keyof typeof READ_UPDATE_VALUE_SCHEMA_REFS,
): Readonly<Record<string, unknown>> {
  const record = snapshotProtocolRecord(value, key);
  const pending: unknown[] = [record];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string" && !isUnicodeScalarString(item))
      throw new ProtocolArtifactValidationError("RU value contains an unpaired surrogate");
    if (item && typeof item === "object")
      for (const [name, value] of Object.entries(item)) {
        if (!isUnicodeScalarString(name))
          throw new ProtocolArtifactValidationError(
            "RU member name contains an unpaired surrogate",
          );
        pending.push(value);
      }
  }
  validate(record, key);
  return record;
}
const parsedOperations = new WeakSet<object>();
function operation<K extends ReadUpdateOperation>(
  kind: K,
  input: Readonly<Record<string, LosslessJsonValue>>,
  key?: string,
  name?: string,
): UnadmittedReadUpdateOperation<K> {
  const value = Object.freeze({
    operation: kind,
    input,
    ...(key === undefined ? {} : { idempotencyKey: key }),
    ...(name === undefined ? {} : { name }),
  });
  parsedOperations.add(value);
  return value;
}
function record(value: LosslessJsonValue): Readonly<Record<string, LosslessJsonValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReadUpdateCarrierError("operation record must be an object");
  return value as Readonly<Record<string, LosslessJsonValue>>;
}
function carrier(
  text: string,
  key: keyof typeof READ_UPDATE_VALUE_SCHEMA_REFS,
): Readonly<Record<string, LosslessJsonValue>> {
  const root = decodeJsonDocument(text);
  // Numbers are only structural placeholders here, private and discarded.
  // The reachable-root invariant in read-update-numeric-schema.test.ts guards
  // that placeholders cannot turn valid property literals into syntax errors.
  const structural = mapLosslessJson(root, () => 0);
  // Schema loading/validator failures are internal faults, never blamed on input.
  const check = validator(key);
  if (!check(structural)) throw new ReadUpdateCarrierError(`Malformed ${key} carrier`);
  return record(root);
}
export function parseReadUpdateRequest<K extends ReadUpdateOperation>(
  kind: K,
  text: string,
): UnadmittedReadUpdateOperation<K> {
  if (
    ![
      "createBead",
      "updateBeadProperties",
      "deleteBead",
      "createLink",
      "updateLinkProperties",
      "deleteLink",
      "putAlias",
      "deleteAlias",
    ].includes(kind)
  )
    throw new TypeError("unknown RU singleton operation");
  const input = carrier(text, kind);
  validateReferenceSyntax(kind, input);
  validateAliasSyntax(kind, input);
  return operation(kind, input);
}
const REFERENCE_FIELDS: Readonly<Record<ReadUpdateOperation, readonly string[]>> = {
  createBead: ["id"],
  updateBeadProperties: ["bead"],
  deleteBead: ["bead"],
  createLink: ["id", "source", "target"],
  updateLinkProperties: ["link"],
  deleteLink: ["link"],
  putAlias: ["target"],
  deleteAlias: [],
};
/** Check only declared reference locations, before any carrier can be admitted.
 * Relative spelling obeys the safe-segment grammar independently of its root.
 * Absolute endpoints remain byte-exact. Creation IDs have their own fixed-root
 * and canonical HTTP(S) shape. Scope-aware syntax still requires preflight.
 */
function validateReferenceSyntax(
  kind: ReadUpdateOperation,
  input: Readonly<Record<string, LosslessJsonValue>>,
): void {
  for (const field of REFERENCE_FIELDS[kind]) {
    const value = input[field];
    if (value === undefined) continue;
    const reference = (typeof value === "string" ? value : record(value).uri) as string;
    // The schema and sequence binding pass enforce where @name is permitted.
    if (reference.startsWith("@")) continue;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) {
      if (!isJsonSchemaUri(reference))
        throw new ReadUpdateCarrierError(`malformed ${field} absolute reference`);
      if (field === "id") {
        try {
          parseCanonicalHttpUrl(reference, "creation id");
        } catch (cause) {
          throw new ReadUpdateCarrierError("malformed absolute creation id", { cause });
        }
      }
    } else {
      try {
        assertCanonicalPathSegments(reference, `${field} reference`);
        if (field === "id") {
          const [root, firstIdSegment] = reference.split("/");
          if (root !== (kind === "createBead" ? "beads" : "links") || firstIdSegment === undefined)
            throw new Error("creation id requires the correct fixed root and an id path");
        }
      } catch (cause) {
        throw new ReadUpdateCarrierError(`malformed ${field} local reference`, { cause });
      }
    }
  }
}
/** Alias spelling grammar is syntax; its root, target existence and authority
 * membership remain member semantics. Never reinterpret a wrong root as syntax.
 */
function validateAliasSyntax(
  kind: ReadUpdateOperation,
  input: Readonly<Record<string, LosslessJsonValue>>,
): void {
  if (kind !== "putAlias" && kind !== "deleteAlias") return;
  const alias = input.alias as string;
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(alias)) {
      const url = new URL(parseCanonicalHttpUrl(alias));
      if (url.search !== "") throw new Error("alias query");
      assertCanonicalPathSegments(url.pathname.slice(1), "alias path");
    } else assertCanonicalPathSegments(alias, "alias path");
  } catch (cause) {
    throw new ReadUpdateCarrierError("malformed alias spelling", { cause });
  }
}
export function parseReadUpdateSequenceRequest(text: string): ReadUpdateSequenceRequest {
  const root = carrier(text, "sequenceRequest");
  const operations = root.operations as readonly LosslessJsonValue[];
  const keys = new Set<string>();
  const names = new Map<string, "bead" | "link">();
  const parsed: UnadmittedReadUpdateOperation[] = [];
  for (const member of operations) {
    const fields = record(member);
    const kind = fields.operation as ReadUpdateOperation;
    validateReferenceSyntax(kind, fields);
    validateAliasSyntax(kind, fields);
    const key = fields.idempotencyKey as string;
    const name = fields.name as string | undefined;
    if (keys.has(key)) throw new ReadUpdateCarrierError("duplicate sequence idempotencyKey");
    keys.add(key);
    const expected: Readonly<Record<string, "bead" | "link">> =
      kind === "createLink"
        ? { source: "bead", target: "bead" }
        : kind === "putAlias"
          ? { target: "bead" }
          : kind === "updateBeadProperties" || kind === "deleteBead"
            ? { bead: "bead" }
            : kind === "updateLinkProperties" || kind === "deleteLink"
              ? { link: "link" }
              : {};
    for (const [field, resourceKind] of Object.entries(expected)) {
      const reference = fields[field];
      const uri = typeof reference === "string" ? reference : record(reference ?? null).uri;
      if (
        typeof uri === "string" &&
        uri.startsWith("@") &&
        names.get(uri.slice(1)) !== resourceKind
      )
        throw new ReadUpdateCarrierError("forward, unknown or wrong-kind sequence binding");
    }
    // Register only after references: a creator cannot reference its own name.
    if (name !== undefined) {
      if (names.has(name)) throw new ReadUpdateCarrierError("duplicate sequence name");
      names.set(name, kind === "createBead" ? "bead" : "link");
    }
    const input = Object.freeze(
      Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => key !== "operation" && key !== "idempotencyKey" && key !== "name",
        ),
      ),
    );
    parsed.push(operation(kind, input, key, name));
  }
  return Object.freeze({ operations: Object.freeze(parsed) });
}
/** Call in the member's admission/validation turn, not as sequence syntax.
 * HTTP keys, current contracts and authorization are the owner's work. The
 * explicit budget and formatter must match its advertised validation limits
 * and map operation-relative occurrences to valid property-relative diagnostics.
 */
export function admitReadUpdateOperationNumbers<K extends ReadUpdateOperation>(
  value: UnadmittedReadUpdateOperation<K>,
  budget: JsonNumberDiagnosticBudget,
): ReadUpdateNumericAdmission<K> {
  if (!parsedOperations.has(value)) throw new TypeError("expected a parsed RU operation");
  const result = admitJsonNumbers(value.input, budget);
  return result.ok
    ? Object.freeze({ ok: true, input: result.value as unknown as ReadUpdateInputs[K] })
    : result;
}

export interface ReadUpdateDiscovery extends Omit<ReadDiscovery, "profile" | "limits" | "aliases"> {
  readonly profile: "read-update";
  readonly operations: string;
  readonly aliases: string;
  readonly limits?: Readonly<Record<string, Readonly<Record<string, number | string>>>>;
}
export type ReadUpdateOperationDirectory = Readonly<
  Record<ReadUpdateOperation | "sequence", string>
>;
export interface ReadUpdateMutationResult {
  readonly outcome: "created" | "updated" | "deleted";
  readonly resource?: BeadRecord | LinkRecord;
  readonly deleted?: {
    readonly resourceKind: "bead" | "link";
    readonly resource: { readonly id: string; readonly type: string; readonly revision: string };
  };
  readonly source?: string;
  readonly sourceRevision?: string;
}
export type ReadUpdateAliasResult =
  | { readonly outcome: "created" | "updated"; readonly alias: string; readonly target: string }
  | { readonly outcome: "deleted"; readonly alias: string };
export type ReadUpdateSequenceEntry = (
  | ReadUpdateMutationResult
  | ReadUpdateAliasResult
  | ReadUpdateProblem
) & {
  readonly operationIndex: number;
  readonly operationName?: string;
};
export interface ReadUpdateSequenceResponse {
  readonly results: readonly ReadUpdateSequenceEntry[];
}
export function parseReadUpdateDiscovery(value: unknown): ReadUpdateDiscovery {
  const result = parseReadUpdateShape(value, "discovery");
  for (const name of ["scope", "beads", "links", "types", "operations", "aliases"])
    parseCanonicalHttpUrl(result[name], name);
  for (const policy of (result.maximumEndpointMultiplicity as readonly {
    linkConformsTo: string;
  }[]) ?? [])
    parseCanonicalTypeId(policy.linkConformsTo);
  return result as unknown as ReadUpdateDiscovery;
}
export function parseReadUpdateOperationDirectory(value: unknown): ReadUpdateOperationDirectory {
  return parseReadUpdateShape(
    value,
    "operationDirectory",
  ) as unknown as ReadUpdateOperationDirectory;
}
function validateResultResource(result: Readonly<Record<string, unknown>>): void {
  if (result.resource !== undefined) {
    const resource = result.resource as Record<string, unknown>;
    if ("source" in resource) parseLinkRecord(resource);
    else parseBeadRecord(resource);
  }
  if (result.source !== undefined) parseCanonicalHttpUrl(result.source);
  if (result.deleted !== undefined) {
    const deleted = result.deleted as { resource: { id: string; type: string } };
    parseCanonicalHttpUrl(deleted.resource.id);
    parseCanonicalTypeId(deleted.resource.type);
  }
  if (result.alias !== undefined) parseCanonicalHttpUrl(result.alias);
  if (result.target !== undefined) parseCanonicalHttpUrl(result.target);
}
export function parseReadUpdateMutationResult(value: unknown): ReadUpdateMutationResult {
  const result = parseReadUpdateShape(value, "mutationResult");
  validateResultResource(result);
  return result as unknown as ReadUpdateMutationResult;
}
export function parseReadUpdateAliasResult(value: unknown): ReadUpdateAliasResult {
  const result = parseReadUpdateShape(value, "aliasResult");
  validateResultResource(result);
  return result as unknown as ReadUpdateAliasResult;
}
export function parseReadUpdateSequenceResponse(
  value: unknown,
  expected?: ReadUpdateSequenceRequest,
): ReadUpdateSequenceResponse {
  const result = parseReadUpdateShape(value, "sequenceResponse");
  const entries = result.results as readonly Readonly<Record<string, unknown>>[];
  if (expected && entries.length !== expected.operations.length)
    throw new ProtocolArtifactValidationError("sequence response count differs from request");
  for (const [index, entry] of entries.entries()) {
    if (entry.operationIndex !== index)
      throw new ProtocolArtifactValidationError(
        "sequence response indexes must match declaration order",
      );
    if (expected && entry.operationName !== expected.operations[index]?.name)
      throw new ProtocolArtifactValidationError("sequence response name differs from request");
    if (entry.outcome !== undefined) validateResultResource(entry);
  }
  return result as unknown as ReadUpdateSequenceResponse;
}
