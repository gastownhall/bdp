/** Source-private unowned-Link administrative recipes. The ordinary evaluator
 * owns schema, endpoint, pin, revision, deletion and capacity validation. */

import type { ResourceRecord } from "./resource-evaluator.js";
import { encodeSemanticValue } from "./semantic-identity.js";
import {
  assertPreparedTransaction,
  normalizeTransaction,
  type PreparedTransaction,
  prepareTransactionSingleton,
} from "./transaction-batch.js";

export function validateLiveLinkCorrection(
  request: PreparedTransaction,
  scope: string,
  before: ResourceRecord,
) {
  assertPreparedTransaction(request, scope);
  if (!("source" in before)) throw new TypeError("current Link required");
  const operation = request.carrier.operations[0];
  if (request.carrier.operations.length !== 1 || !operation || operation.operation !== "updateLink")
    throw new TypeError("one prepared updateLink correction required");
  const input = operation.input;
  if (
    Object.keys(input).some(
      (key) => !["link", "expectedRevision", "propertiesChange", "metadataChange"].includes(key),
    )
  )
    throw new TypeError("live Link correction supports only properties and metadata");
  if (input.expectedRevision !== before.revision)
    throw new TypeError("exact current Link expectedRevision required");
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
      throw new TypeError("live Link correction requires complete object root replacements");
  }
  const normalized = normalizeTransaction(request, () => undefined);
  if (normalized.referenceIdentities.get("link") !== encodeSemanticValue(before.id))
    throw new TypeError("live Link correction requires the exact canonical Link, not an alias");
  return normalized;
}
export function prepareLiveLinkTombstone(scope: string, before: ResourceRecord) {
  if (!("source" in before)) throw new TypeError("current Link required");
  return normalizeTransaction(
    prepareTransactionSingleton(
      scope,
      "deleteLink",
      JSON.stringify({ link: before.id, expectedRevision: before.revision }),
    ),
    () => undefined,
  );
}
