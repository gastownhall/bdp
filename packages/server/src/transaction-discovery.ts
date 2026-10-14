/** Internal assembly only. No HTTP serving, advertisement or readiness decision. */
import { parseTransactionalDiscovery, parseTransactionalOperationDirectory } from "@bdp/protocol";
import type { TransactionReadContext } from "./transaction-store.js";
import type { TransactionReadOptions } from "./transaction-read.js";
import { TRANSACTION_RUNTIME_LIMITS } from "./transaction-batch.js";
import { TRANSACTION_SELECTOR_LIMITS } from "./transaction-set.js";

export const TRANSACTION_HTTP_OPERATIONS = Object.freeze({
  createBead: "create-bead",
  updateBead: "update-bead",
  deleteBead: "delete-bead",
  createLink: "create-link",
  updateLink: "update-link",
  deleteLink: "delete-link",
  putAlias: "put-alias",
  deleteAlias: "delete-alias",
  updateWhere: "update-where",
  deleteWhere: "delete-where",
  batch: "batch",
  sequence: "sequence",
} as const);
/** Caller supplies only its captured owner context and enforcement-validated
 * Read configuration. Parsing occurs after the owner entry has been released. */
export function assembleTransactionDiscovery(
  scope: string,
  context: TransactionReadContext,
  limits: TransactionReadOptions["advertisedLimits"],
) {
  // Read enforcement was validated during capture; the same advertised triple
  // must also describe this owner's fixed set-mutation Selector enforcement.
  const { bytes, depth, nodes } = limits.selector;
  if (
    bytes !== TRANSACTION_SELECTOR_LIMITS.bytes ||
    depth !== TRANSACTION_SELECTOR_LIMITS.depth ||
    nodes !== TRANSACTION_SELECTOR_LIMITS.nodes
  )
    throw new TypeError("discovery Selector limits must match set enforcement");
  const discovery = parseTransactionalDiscovery({
    bdpVersion: "0",
    profile: "transactional",
    scope,
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    operations: `${scope}operations/`,
    aliases: `${scope}alias/`,
    receipts: `${scope}receipts/`,
    snapshot: `${scope}snapshot`,
    changes: `${scope}changes/`,
    events: `${scope}events/`,
    scopeEpoch: context.scopeEpoch,
    authorizationView: context.authorizationView,
    headPosition: context.scopePosition,
    // This owner retains all groups; this is a position, not a feed checkpoint.
    minimumReplayPosition: "pos-0",
    limits: {
      page: { defaultItems: limits.page.defaultItems, maximumItems: limits.page.maximumItems },
      selector: { bytes, depth, nodes },
      validation: {
        diagnostics: TRANSACTION_RUNTIME_LIMITS.diagnosticCount,
        diagnosticBytes: TRANSACTION_RUNTIME_LIMITS.diagnosticBytes,
      },
    },
  });
  const directory = parseTransactionalOperationDirectory(TRANSACTION_HTTP_OPERATIONS);
  return Object.freeze({ discovery, directory });
}
