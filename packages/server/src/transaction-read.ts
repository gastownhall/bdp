/** Same-owner private Read composition. This does not supply Transactional HTTP
 * context, minimum-position barriers, receipt reads or replication Snapshots. */
import { createAuthorityReadPlane, type AuthorityReadOptions } from "./authority-read.js";
import type { openTransactionStore } from "./transaction-store.js";

export type TransactionReadOptions = Pick<
  AuthorityReadOptions,
  "selectorLimits" | "pagination" | "advertisedLimits"
>;

/** The caller owns the store lifetime. Closing the plane invalidates its cursors
 * but does not close or replace the mutation owner. Configuration is fixed for
 * this private store's lifetime and is captured through its guarded entry. */
export function createTransactionReadPlane(
  owner: ReturnType<typeof openTransactionStore>,
  options: TransactionReadOptions,
) {
  const configuration = owner.readConfiguration();
  return createAuthorityReadPlane({
    entry: owner,
    scopeEpoch: configuration.scopeEpoch,
    installedTypes: configuration.installedTypes,
    scopeConfiguration: { capture: () => configuration.scopeConfiguration },
    selectorLimits: options.selectorLimits,
    pagination: options.pagination,
    advertisedLimits: options.advertisedLimits,
    captureReadAuthorization: () => ({
      kind: "authorized",
      authorization: {
        scopeEpoch: configuration.scopeEpoch,
        authorizationView: configuration.authorizationView,
        policy: { canRead: () => true },
        canReadType: () => true,
      },
    }),
  });
}
