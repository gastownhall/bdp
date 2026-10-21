# Local administrative live Bead tombstone

This follow-up adds the unowned-Bead tombstone path required by the existing Version erasure contract in `docs/specs/bdp.md`. It follows the historical erasure and live-correction slices without changing the agreed specification or completing every baseline erasure obligation.

`owner.tombstoneLiveBeadVersion(canonicalSubject, currentRevision)` is delegated by the same-owner service and authentic source-private `transactionRuntimeAdministration(runtime)` capability. It is not a new BDP operation, HTTP route, package export, config field or Mutation Receipt. The public runtime facade retains its six keys, and the administrative capability refuses cloned handles and calls after shutdown begins.

## Atomic deletion and purge

Only the exact current canonical Bead version with no nonempty inline owned-Link set is selected. Links, owned cascades, foreign targets, stale revisions and missing current Beads refuse. Mutation ownership must be drained, as for the preceding erasure operations.

The owner prepares an ordinary `deleteBead` with the actual current identity and revision guard. The existing evaluator owns all deletion checks, including refusal when **any live incident Link** exists. There is no incident-Link filtering or special deletion bypass. Its validated staged deletion lets the unchanged historical erasure planner process the old version; no live-version guard in that planner is weakened.

One atomic group contains the old version's original-record digest, lineage marker and permanent per-view erasure record, the exact `{id,type,revision}` tombstone, and the evaluator's ordinary identity-only `deleted` Event under the new administrative transaction and Scope position. The Event data contains only the deleted revision. It does not carry properties, metadata or provenance. The same commit removes every retained copy of the named erased version through the existing purge pipeline. Existing identity reservations remain, so tombstoning cannot permit ID reuse in the same epoch.

The erasure keeps the epoch. Existing receipt replay returns the original receipt with erased postimages; it does not execute again. Previously valid exclusive Event cursors retain their meaning across withheld Events, and the new deleted fact is served at its original ordinal. Old Snapshot pages and cached ordinary Read continuations are fenced. Fresh current reads return the existing not-found disclosure, while healthy neighboring Beads remain readable. An already caught-up SSE lease receives the complete tombstone group; behind-floor finite/reconnect requests refuse.

Before-commit faults or abrupt exits roll back both deletion and purge. After-commit abrupt exits reopen with both applied. These are SQLite transaction/recovery checks, not a forensic storage or backup-erasure claim.

The correction API remains explicit: an unchanged correction still refuses rather than unexpectedly deleting the Bead. A local administrator may deliberately choose this separate tombstone operation.

## Verification and remaining work

Fourteen distinct new focused cases cover complete purge/lineage/deleted fact/receipt/cursor/Snapshot behavior, all four incoming/outgoing/self/external-target incident-Link refusals, stale/foreign/Link targets, owned-set refusal, rollback, abrupt exits before and after commit, and actual HTTP/SSE/ordinary-continuation/receipt/Event/reopen behavior, and tombstoning a corrected successor while preserving both ledger obligations. The initial owner cohort stopped in fixture parsing because it supplied an invalid null provenance actor; the corrected fixture uses the existing grammar and the full failure history remains retained. No passing correction cohort was repeated merely for ownership.

The ordinary evaluator, historical purge/fence suffix and prior correction helper are preserved, with exact source comparisons recorded in the validation evidence. The new shared dispatch is an explicit correction-or-tombstone union; the correction request remains the same actual prepared object.

Still unsupported: live Link tombstones or correction, owned-Link cascade erasure/correction, restore/import ledger re-emission, general restricted-view erasure projection, and replica/client persistence. No new packed/installed tombstone cohort or complete twenty-row erasure/profile acceptance is claimed.
