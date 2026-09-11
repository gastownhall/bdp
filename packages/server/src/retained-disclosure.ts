import {
  parseBeadRecord,
  parseCanonicalScope,
  parseLinkRecord,
  resolveCanonicalLocalResourceId,
  stringifyJsonValue,
} from "@bdp/protocol";
import {
  isResourceVisible,
  type ResourceMutationPolicy,
  type ResourceRecord,
  type ResourceTransaction,
} from "./resource-evaluator.js";

/** Current-view disclosure of an already guarded retained postimage. This is
 * not History permission or a live-subject existence check. The same immutable
 * member-turn policy and synchronous reader must cover the entire traversal. */
export function mayDiscloseRetainedResource(
  reader: Pick<ResourceTransaction, "resource">,
  record: ResourceRecord,
  scope: string,
  policy: Pick<ResourceMutationPolicy, "canRead">,
): boolean {
  const canonicalScope = parseCanonicalScope(scope);
  const kind = "source" in record ? "link" : "bead";
  const retained = kind === "link" ? parseLinkRecord(record) : parseBeadRecord(record);
  if (!retained.id.startsWith(scope)) throw new TypeError("retained Resource escaped its Scope");
  const id = retained.id.slice(scope.length);
  if (resolveCanonicalLocalResourceId(canonicalScope, kind, id) !== retained.id)
    throw new TypeError("retained Resource has a noncanonical identity");
  // Closure can return to the subject through its own inline Link. Return that
  // exact retained Bead, including its old owned collection, even after deletion.
  const retainedBead =
    kind === "bead"
      ? Object.freeze({ kind: "bead" as const, id, bodyJson: stringifyJsonValue(retained) })
      : undefined;
  const overlay =
    retainedBead !== undefined
      ? {
          resource(key: string) {
            return key === id ? retainedBead : reader.resource(key);
          },
        }
      : reader;
  return isResourceVisible(overlay, retained, scope, policy);
}
