/** Source-private administrative Bead deletion. The ordinary evaluator still
 * owns revision/deletion safety and emits the identity-only deleted fact. */
import { normalizeTransaction, prepareTransactionSingleton } from "./transaction-batch.js";
import type { ResourceRecord } from "./resource-evaluator.js";

export function prepareLiveBeadTombstone(scope: string, before: ResourceRecord) {
  if (
    "source" in before ||
    Object.values(before.ownedLinks ?? {}).some((links) => links.length > 0)
  )
    throw new Error("live tombstone of Links or nonempty owned sets is unsupported");
  return normalizeTransaction(
    prepareTransactionSingleton(
      scope,
      "deleteBead",
      JSON.stringify({
        bead: before.id,
        expectedRevision: before.revision,
      }),
    ),
    () => undefined,
  );
}
