# Offline native Transactional restore

This source-private lifecycle restores a valid native SQLite backup into an
**existing current destination for the same logical Scope**, before serving.
The operator must stop its current owner. Use `openTransactionStore` with
`create: false` and the private `nativeRestore` absolute backup path, then close
the resulting owner before normal runtime startup. This is not a public package
export, HTTP operation, configuration field or runtime facade method.

The existing destination is the permanent anchor, never the backup. It must
retain the actually current identities, erasure ledger/lineage, original retained
versions and authorization policy. A copy of an obsolete database cannot establish
that it is this anchor. The administrator is responsible for selecting the current
authoritative destination; no caller `complete` flag substitutes for it. Loss of
that permanent state is outside this same-logical-Scope lifecycle.

The backup is a consistent native database (the focused tests copy the closed
SQLite file under DELETE journaling), with the exact current installation,
contract capture and request fingerprint policy. It is opened read-only in one
SQLite read transaction. Every backup identity must already belong to the anchor.
Each surviving original version must equal the anchor's retained original at its
address. An erased historical copy is not imported; an erased **live** image is
refused, rather than manufacturing a successor or tombstone. Original metadata
omission in older native records is not replaced with a read projection for this
comparison. A backup with an incompatible capture, unknown identity or conflicting
retained address fails atomically.

One destination SQLite transaction imports the backed-up current graph and
aliases while leaving current permanent state and permissions intact. It retires
old receipts, key bindings, groups, transient claims and epoch-local cursor facts;
creates a fresh epoch; and emits the permanent ledger as contiguous, bounded
initial erasure-only groups. Framing uses the existing group byte cap, including
actual envelope, record and comma bytes. Ordinary mutations follow that prefix.
No prior-epoch group is relabeled or served. Current projection rules still apply:
an empty grant does not disclose the permanent ledger, and there is no special
genesis bypass around the existing erasure floor. Fresh Snapshots carry the ledger.

Known old Snapshot and continuation issuance commitments remain compact and
expired, preserving their original epoch/view/head, seed and issued page counts.
Their old page bodies are removed. A bounded per-issued-epoch head fence permits
validation after a new head starts below the old one. Epochs without issued handles
add no fence. The existing total issued-handle cap remains unchanged. Existing
foreign-view/minimum collisions retain their existing handling; this does not
select a new rule for those collisions. Changefeed/Event tokens use their existing
epoch fences; an old receipt is absent and its old key is unbound.

A caught validation error rolls back the entire destination transaction. The new
focused process-exit tests cover the before-commit and after-commit boundaries;
normal reopen determines which complete state committed. They are not a universal
power-loss, media-corruption or multi-machine backup qualification. The fresh packed
boundary uses the actual installed private modules, authenticated normal HTTP and
the unchanged six-key facade. No History HTTP surface, replica restore, public
administration, different Scope/capture migration or whole-profile claim is added.
