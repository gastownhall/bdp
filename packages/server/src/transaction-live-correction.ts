/** Local administrative direct-object Bead correction. Complete existing owned
 * Links remain unchanged. No BDP operation, receipt, tombstone or alias resolution. */
import {
  assertPreparedTransaction,
  normalizeTransaction,
  type PreparedTransaction,
  type TransactionEvent,
} from "./transaction-batch.js";
import type { ResourceRecord } from "./resource-evaluator.js";
import { encodeSemanticValue } from "./semantic-identity.js";
import { jsonValueEqual } from "./json-value-equality.js";

export function validateLiveBeadCorrection(
  request: PreparedTransaction,
  scope: string,
  before: ResourceRecord,
) {
  assertPreparedTransaction(request, scope);
  if ("source" in before) throw new Error("live Bead correction requires a Bead");
  const operations = request.carrier.operations,
    operation = operations[0];
  if (operations.length !== 1 || !operation || operation.operation !== "updateBead")
    throw new TypeError("one prepared updateBead correction required");
  const input = operation.input;
  if (
    Object.keys(input).some(
      (key) => !["bead", "expectedRevision", "propertiesChange", "metadataChange"].includes(key),
    )
  )
    throw new TypeError("live correction supports only properties and metadata");
  for (const name of ["propertiesChange", "metadataChange"] as const) {
    const delta = input[name];
    if (delta === undefined) continue;
    if (
      !Array.isArray(delta) ||
      delta.length !== 1 ||
      delta[0]?.op !== "replace" ||
      delta[0]?.path !== "" ||
      delta[0]?.value === null ||
      typeof delta[0]?.value !== "object" ||
      Array.isArray(delta[0]?.value)
    )
      throw new TypeError("live correction requires complete object root replacements");
  }
  const normalized = normalizeTransaction(request, () => undefined);
  if (normalized.referenceIdentities.get("bead") !== encodeSemanticValue(before.id))
    throw new TypeError("live correction requires the exact canonical Bead, not an alias");
  return normalized;
}

/** Construct a new administrative fact from actual validated before/after
 * states; never rewrite a previously committed immutable Event. */
export function liveCorrectionEvent(
  before: ResourceRecord,
  after: ResourceRecord,
  event: TransactionEvent,
): TransactionEvent {
  const propertiesChanged = !jsonValueEqual(before.properties, after.properties);
  const metadataChanged = !jsonValueEqual(before.metadata ?? {}, after.metadata ?? {});
  if ((!propertiesChanged && !metadataChanged) || before.revision === after.revision)
    throw new Error("unchanged correction requires unsupported tombstone");
  return {
    ...event,
    data: {
      previousRevision: before.revision,
      revision: after.revision,
      ...(propertiesChanged
        ? { change: [{ op: "replace", path: "", value: after.properties }] }
        : {}),
      ...(metadataChanged
        ? { metadataChange: [{ op: "replace", path: "", value: after.metadata ?? {} }] }
        : {}),
      ...(after.revisionProvenance === undefined
        ? {}
        : { revisionProvenance: after.revisionProvenance }),
    },
  };
}
