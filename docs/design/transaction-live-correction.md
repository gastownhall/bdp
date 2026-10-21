# Local administrative live Bead correction

This follow-up implements the live-version correction part of `docs/specs/bdp.md`'s Version erasure contract. It builds on the historical purge and ordinary Read continuation fence. It does not complete every erasure obligation.

The source-private `transactionRuntimeAdministration(authenticRuntime)` capability now also exposes `correctLiveBeadVersion(subject, revision, preparedUpdate)`. The owner and same-owner service carry the same operation. The legacy runtime facade retains its six keys. There is no new package export, configured endpoint, BDP operation, Operation Directory entry, or Mutation Receipt. The capability rejects a cloned handle and refuses calls once runtime shutdown begins.

## Supported correction

The target must be the exact current canonical Bead revision, with no nonempty inline owned-Link sets. The authentic prepared singleton must contain one `updateBead` targeting that same Bead, using complete root replacements for properties, metadata, or both, with an optional ordinary `expectedRevision` guard. Aliases, revision-provenance changes, partial patches, other operations, and supplied owned-set changes are unsupported in this tranche. Existing transaction ownership must be drained first.

The shared transaction evaluator validates the successor against the installed descriptors, schemas, revision guards, and existing mutation limits inside the owner's SQLite transaction. The successor must actually change properties or metadata. An unchanged state requires the later tombstone implementation and is refused with the entire transaction rolled back.

The same atomic commit contains:

- the old version's lineage marker, original-record JCS digest, permanent per-view erasure ledger entry, and complete purge;
- a valid fresh successor upsert and new revision;
- one authority-generated administrative transaction and Scope position;
- one fresh `updated` Event with `previousRevision` equal to the erased revision and exactly one complete root replacement per actually changed object.

Supplying an unchanged object alongside a changed object does not emit an unnecessary delta for the unchanged object. Prior immutable Events are not rewritten. The existing erasure planner sees the staged successor and therefore erases only a historical old version; no bypass of its live-version safety guard was added.

All existing purge and delivery machinery is shared: retained versions, receipt postimages, retained groups and unsafe Events, Snapshot pages, ordinary collection continuation caches, final finite-response source-context checks, and caught-up SSE publication leases. Fresh current reads remain healthy. Old exclusive Event cursors retain their identity and ordinal meaning despite withheld Events. A pre-erasure caught-up stream receives the whole correction group; new finite/reconnect admissions behind the erasure floor refuse.

A before-commit fault or abrupt exit rolls back both successor and purge. An after-commit fault fences the owner; reopening retains the complete committed successor and erasure. This makes no forensic backup or operating-system storage-erasure guarantee.

## Verification and limits

Twenty-one distinct new focused cases cover property/metadata/both corrections, unchanged-delta suppression, malformed or unsupported forms, real schema refusal, Link and owned-Bead refusal, pending mutation ownership, before-commit rollback, after-commit fencing, abrupt exits on both sides of commit, and real HTTP/SSE/receipt/continuation/Snapshot/Event/reopen behavior. Raw observations, failed fixture attempts, exact source snapshots, process receipts, EOF and reaping evidence are retained separately under the product live-correction evidence directory. Passing cases were not replayed merely to obtain a single green cohort.

The evaluator extraction also receives a small affected ordinary-transaction regression cohort. Historical PR194 evidence is inherited with its original attribution; it is not represented as a newly repeated whole-suite pass.

Still unsupported: live Link correction, owned-Link cascade correction, live tombstones/deletion safety, restore/import erasure-ledger re-emission, general restricted-view erasure projection, and client or replica persistence. Unchanged correction is refused rather than silently producing an invalid successor. The private all-visible reference runtime is not complete coverage of the baseline erasure matrix or a qualified installed deployment.
