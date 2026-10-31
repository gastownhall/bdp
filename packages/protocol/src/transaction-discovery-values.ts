/** Transactional envelope parsing is structural validation, never serving admission. */
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { ReadUpdateDiscovery, ReadUpdateOperationDirectory } from "./read-update-values.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";
import {
  parseCanonicalScope,
  parseCanonicalHttpUrl,
  parseCanonicalTypeId,
  readCanonicalSchemaBundle,
  requireSchemaValidator,
  snapshotProtocolRecord,
} from "./read-values.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

export interface TransactionalDiscovery extends Omit<ReadUpdateDiscovery, "profile"> {
  readonly profile: "transactional";
  readonly scopeEpoch: string;
  readonly authorizationView: string;
  readonly headPosition: string;
  readonly minimumReplayPosition: string;
  readonly receipts: string;
  readonly snapshot: string;
  readonly changes: string;
  readonly events: string;
}
export type TransactionalOperationDirectory = Readonly<
  Record<keyof ReadUpdateOperationDirectory | "updateWhere" | "deleteWhere" | "batch", string>
>;
const roots = Object.freeze({
  discovery: "#/$defs/transactionalDiscovery",
  directory: "#/$defs/transactionalOperationDirectory",
});
let validators: Readonly<Record<keyof typeof roots, ValidateFunction>> | undefined;
function parse(value: unknown, kind: keyof typeof roots): Readonly<Record<string, unknown>> {
  const snapshot = snapshotProtocolRecord(value, `Transactional ${kind}`);
  if (!validators) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = readCanonicalSchemaBundle();
    ajv.addSchema(bundle);
    if (typeof bundle.$id !== "string")
      throw new ProtocolArtifactValidationError("schema bundle needs $id");
    validators = Object.freeze({
      discovery: requireSchemaValidator(ajv, bundle.$id, roots.discovery),
      directory: requireSchemaValidator(ajv, bundle.$id, roots.directory),
    });
  }
  const validate = validators[kind];
  if (!validate(snapshot))
    throw new ProtocolArtifactValidationError(
      `Invalid Transactional ${kind}: ${JSON.stringify(validate.errors)}`,
    );
  return snapshot;
}
export function parseTransactionalDiscovery(value: unknown): TransactionalDiscovery {
  const result = parse(value, "discovery");
  parseCanonicalScope(result.scope);
  for (const field of [
    "beads",
    "links",
    "types",
    "operations",
    "aliases",
    "receipts",
    "snapshot",
    "changes",
    "events",
  ])
    parseCanonicalHttpUrl(result[field], field);
  for (const policy of (result.maximumEndpointMultiplicity as
    | readonly { linkConformsTo: string }[]
    | undefined) ?? [])
    parseCanonicalTypeId(policy.linkConformsTo);
  return result as unknown as TransactionalDiscovery;
}
export function parseTransactionalOperationDirectory(
  value: unknown,
): TransactionalOperationDirectory {
  return parse(value, "directory") as unknown as TransactionalOperationDirectory;
}
