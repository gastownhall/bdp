import type { AbsoluteHttpUrl, AdmittedJsonValue } from "./index.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import { parseCanonicalHttpUrl, parseCanonicalScope } from "./read-values.js";
import {
  parseRetainedObject,
  validateRetainedValue,
  RETAINED_WRITE_OPERATIONS,
  type RetainedWriteOperation,
} from "./retained-write-values.js";

export type RetainedJsonObject = Readonly<Record<string, AdmittedJsonValue>>;
export type RetainedResourceKind = "bead" | "link";
export type RetainedDiscovery = RetainedJsonObject & {
  readonly bdpVersion: "0.1";
  readonly profile: "core" | "write";
  readonly scope: AbsoluteHttpUrl;
  readonly beads: AbsoluteHttpUrl;
  readonly links: AbsoluteHttpUrl;
  readonly events: AbsoluteHttpUrl;
};

/** Both selected profiles supply Core reads. Unknown advertisements are opaque;
 * parsing discovery does not select or qualify an optional feature.
 */
export function parseRetainedDiscovery(text: string): RetainedDiscovery {
  const value = parseRetainedObject(text);
  validateRetainedValue("retainedDiscovery", value);
  parseCanonicalScope(value.scope);
  for (const name of ["beads", "links", "events", "operations", "aliases"] as const)
    if (value[name] !== undefined) parseCanonicalHttpUrl(value[name], `discovery.${name}`);
  return value as RetainedDiscovery;
}

export function parseRetainedResource(
  text: string,
  kind: RetainedResourceKind,
): RetainedJsonObject {
  if (kind !== "bead" && kind !== "link")
    throw new ProtocolArtifactValidationError("invalid Resource kind");
  const value = parseRetainedObject(text);
  validateRetainedValue(kind === "bead" ? "currentBeadRecord" : "currentLinkRecord", value);
  validateResourceIdentity(value);
  return value;
}
function validateResourceIdentity(value: RetainedJsonObject): void {
  parseCanonicalHttpUrl(value.id, "Resource identity");
  const affiliation = value.type;
  parseCanonicalHttpUrl(
    typeof affiliation === "string" ? affiliation : (affiliation as RetainedJsonObject).uri,
    "Type identity",
  );
}

export function parseRetainedProperties(text: string): RetainedJsonObject {
  const value = parseRetainedObject(text);
  validateRetainedValue("properties", value);
  return value;
}

/** Inject the received status only for validation; preserve the actual native
 * body, including omission and open Problem extensions, in the returned value.
 */
export function parseRetainedProblem(text: string, status: number): RetainedJsonObject {
  const value = parseRetainedObject(text);
  validateRetainedValue("readUpdateProblem", value);
  if (value.status !== undefined && value.status !== status)
    throw new ProtocolArtifactValidationError("Problem status contradicts HTTP status");
  validateRetainedValue("readUpdateProblem", { ...value, status });
  return value;
}

export function parseRetainedWriteResult(
  operation: RetainedWriteOperation,
  text: string,
): RetainedJsonObject {
  if (!RETAINED_WRITE_OPERATIONS.includes(operation))
    throw new ProtocolArtifactValidationError("unsupported retained Write operation");
  const value = parseRetainedObject(text);
  const alias = operation === "putAlias" || operation === "deleteAlias";
  validateRetainedValue(alias ? "aliasResult" : "mutationResult", value);
  const outcomes = operation.startsWith("create")
    ? ["created"]
    : operation.startsWith("update")
      ? ["updated"]
      : operation === "putAlias"
        ? ["created", "updated"]
        : ["deleted"];
  if (!outcomes.includes(value.outcome as string))
    throw new ProtocolArtifactValidationError("mutation result contradicts native operation");
  if (alias) {
    parseCanonicalHttpUrl(value.alias, "alias result");
    if (value.target !== undefined) parseCanonicalHttpUrl(value.target, "alias target");
  } else {
    const kind = operation.endsWith("Bead") ? "bead" : "link";
    if (value.outcome === "deleted") {
      const deleted = value.deleted as RetainedJsonObject;
      if (deleted.resourceKind !== kind)
        throw new ProtocolArtifactValidationError("deleted identity has the wrong Resource kind");
      validateResourceIdentity(deleted.resource as RetainedJsonObject);
    } else {
      // Validate the current native record; do not downgrade to the old v0
      // helper whose Type and metadata requirements differ.
      const resource = value.resource as RetainedJsonObject;
      validateRetainedValue(kind === "bead" ? "currentBeadRecord" : "currentLinkRecord", resource);
      validateResourceIdentity(resource);
    }
  }
  return value;
}
