# Initial Transactional implementation

This slice implements the first **private atomic transaction owner**. It does not
add an HTTP target, executable, package export, discovery token or conformance
claim. Its reference storage format is deliberately separate from the current
Read+Update development store.

## Executable boundary

`transaction-batch.ts` prepares a bounded batch and reuses the existing Resource
evaluator. `transaction-store.ts` owns a SQLite file, its exclusive connection,
key namespace, pending receipts, Resource state, identity allocation and change
groups. The supported operations are `createBead` and `createLink`, with preceding
local creation references, including self-Links. Other operation kinds are
refused before key lookup or admission. The private limits are 64 KiB input,
32 operations and 32 JSON container levels. These are implementation bounds, not
advertised profile capabilities.

Installed Types are fixed, schema-free and without owned outgoing Links. Policy
is fixed all-visible/all-writable. The principal argument selects the receipt/key
namespace; it is supplied by a trusted caller and is **not authentication**.
There is no policy configuration or grant change support in this composition.

Admission commits the key, exact normalized semantic identity, pending receipt,
transaction identity and execution owner together. A proven equal pending
request receives that same pending receipt; a different request conflicts.
Batch identity preserves operation order and exact numeric equality, excludes
label spelling, expands empty properties/metadata defaults and canonicalizes
local Resource references. An allocated creator is identified by operation index;
a creator with a supplied ID is identified by its canonical Resource URL. The
Read+Update parser is reused for operation syntax and binding checks, with
synthetic member keys that never enter storage. Its admission/key-state machine
is not reused.

Execution stages every Resource operation in one SQLite transaction. The existing
Resource evaluator sees earlier staged changes. The final success commits those
Resources, identity allocations, one ordered change group, the Scope position
and the terminal receipt together. A permanent operation failure rolls back the
Resource savepoint and retains a failed receipt naming the operation; it commits
no Resources, identities, change group or new position. A live internal failure
retracts only its own pending reservation, permitting a fresh retry. Commit checks
the exact pending owner. A stale execution cannot commit a replacement's work.

For creations, groups carry complete canonical postimages and operation-ordered
Events. A Link emits its created fact followed by source and target linked facts
for in-Scope endpoints. A linked fact's subject and subject Type are the Link;
`data.endpoint` selects the incidence. The group Events use the Scope `events/`
Event Source. Future Resource views must project them with the serving Bead or
Link's `?view=events` Source URL; no Resource Event view is implemented here.
A self-Link emits both endpoint facts in that order without versioning the Bead.
Opaque external endpoints generate no endpoint fact; pinned references remain
byte-identical in Link and graph fact data.
Receipts and groups produced by executable tests are validated against the
canonical schema bundle.

The store is explicitly provisioned at a new absolute file path. Reopen verifies
its format, canonical Scope and exact installed Type configuration. The Scope
epoch persists across restart. Persistent SQLite EXCLUSIVE locking prevents two
live connections from admitting independently into the same file. Startup
retracts uncommitted pending receipts immediately, before admitting new work; it
never executes an abandoned request on its own initiative. A committed receipt
and its allocations replay after a fresh process starts.

## Observed verification

The bounded five-file suite exercises 357 tests, including 13 new atomic-owner
tests, existing Resource evaluation and semantic identity tests, Transactional
wire/schema fixtures and the Transactional catalog. New observations cover:

- Bead plus local-reference Link success, ordered Events, schema-valid receipt
  and group, one durable commit, and principal-bound receipt lookup.
- Final-operation failure rolling back all graph and identity effects while
  retaining a failed receipt, including after reopen.
- Equal pending join, differing-request conflict, retraction and stale-owner
  fencing, plus a fresh admission after an injected live internal failure.
- Label renaming, explicit/local identity equivalence, numeric equality without
  rounding, refused numeric identity and metadata-sensitive conflict.
- Unsupported/malformed operations refused without effects; separate principals;
  refusal of a concurrent live store, implicit reseeding and duplicate creation.
- Abrupt child-process exit after durable admission, after staged Resource
  changes and after terminal writes but before commit. Each restart retracts one
  pending receipt with no partial Resources, identities or group, and an explicit
  retry commits once.
- Abrupt child-process exit after commit. Reopen returns the exact original
  terminal receipt/IDs and continues the Scope's ordered group chain.

Those process exits test application-crash recovery and SQLite rollback journal
behavior, **not power-loss, filesystem durability, failover or rollback-proof
restore qualification**. No shared database, CLI branch or Type proposal is used.

## Integration and remaining work

A separate owner is necessary because `executeMember` commits one Read+Update
member and retains a different kind of outcome. Looping over that API cannot
supply atomic batch semantics. This slice reuses the Resource evaluation seam,
not the old store's state machine. It does not open, migrate or concurrently
serve the Read+Update database. Its new format must not be substituted behind the
existing receiver.

Before any Transactional HTTP integration, build one common Transactional owner
for every mutation route. Its singleton and sequence paths must use the same
receipt/key namespace as batch. They must not keep writing through a parallel
Read+Update owner. A migration or explicit new-Scope provisioning path, startup
qualification and unified read authority must accompany that integration.

Remaining requirements include the four other Resource operations and set
operations; owned-Link transitions; aliases outside batch; singleton and sequence
carriers with unresolved dependent admission; authorization projection and
reauthorized receipt disclosure; receipt expiry/compaction, failed-receipt
forgetting and pagination; Event Sources, changefeed, snapshots and erasure;
duration/recovery bounds under operational failure; complete native schemas,
aggregate policies and limits; HTTP reception/status/conditional behavior; and
executable whole-profile conformance evidence. This first owner retains receipt
detail beyond its declared minimum rather than expiring it; it does not implement
a maintenance policy for bounded retention. There is no Read+Update or
Transactional admission change in this slice.
