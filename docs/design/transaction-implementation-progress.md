# Initial Transactional implementation

This slice implements the first **private atomic transaction owner**. It does not
add an HTTP target, executable, package export, discovery token or conformance
claim. Its reference storage format is deliberately separate from the current
Read+Update development store.

## Executable boundary

`transaction-batch.ts` prepares bounded batches and six Resource singleton
request records, then reuses the existing Resource evaluator. `transaction-store.ts` owns a SQLite file, its exclusive connection,
key namespace, pending receipts, Resource state, identity allocation and change
groups. The supported operations are `createBead`, `updateBead`, `deleteBead`,
`createLink`, `updateLink` and `deleteLink`, with preceding local creation
references, including self-Links. Update and delete revision guards use the same
staged Resource evaluator. Set operations and alias batch members are refused
before key lookup or admission. The private limits are 64 KiB input,
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
local Resource references. Omitted `changeContext` and an empty object share
one identity; explicit null agent/message members remain distinct. An allocated
creator is identified by operation index;
a creator with a supplied ID is identified by its canonical Resource URL. The
Read+Update parser is reused for operation syntax and binding checks, with
synthetic member keys that never enter storage. Its admission/key-state machine
is not reused.

Execution stages every Resource operation in one SQLite transaction. The existing
Resource evaluator sees earlier staged changes. The final success commits those
Resources, identity allocations, one ordered change group, the Scope position
and the terminal receipt together. An all-no-op batch instead completes with the
current required position, no effect position and no group or revision changes.
A permanent operation failure rolls back the
Resource savepoint and retains a failed receipt naming the operation; it commits
no Resources, identities, change group or new position. A live internal failure
retracts only its own pending reservation, permitting a fresh retry. Commit checks
the exact pending owner. A stale execution cannot commit a replacement's work.

Groups normalize each changed Resource to its final canonical postimage or
identity-bearing tombstone. Receipts and Events preserve intermediate transitions
in operation order, including an update followed by a reversal. A create, update
and deletion of one local binding leaves one final tombstone while retaining all
three lifecycle facts and operation results. Deletion retains identity history;
a new key cannot recreate that identity.

Updated Events carry the committed properties and/or metadata patch and the
previous/new revision. A no-op emits no Event. Deleted Events identify the final
live revision. A Link emits its created/deleted fact followed by source and target
linked/unlinked facts for in-Scope endpoints. A graph fact's subject and subject
Type are the Link;
`data.endpoint` selects the incidence. The group Events use the Scope `events/`
Event Source. Future Resource views must project them with the serving Bead or
Link's `?view=events` Source URL; no Resource Event view is implemented here.
A self-Link emits both endpoint facts in that order without versioning the Bead.
Opaque external endpoints generate no endpoint fact; pinned references remain
byte-identical in Link and graph fact data.
Receipts and groups produced by executable tests are validated against the
canonical schema bundle.

The store is explicitly provisioned at a new absolute file path. Reopen verifies
its format, canonical Scope, exact installed Type configuration and identity
normalization policy. Files created before the empty-context normalization policy
was recorded, or carrying another policy, are refused with an explicit identity-policy
diagnostic before pending recovery or receipt maintenance. This deliberately changes
the private configuration fingerprint without changing the SQL format number.
There is no migration, in-place upgrade or reseed: new disposable stores require
explicit provisioning at a new path. Old retained outcomes and pending owners are
never reinterpreted or removed by a refused open. The Scope epoch persists
across restart. Persistent SQLite EXCLUSIVE locking prevents two
live connections from admitting independently into the same file. Startup
retracts uncommitted pending receipts immediately, before admitting new work; it
never executes an abandoned request on its own initiative. A committed receipt
and its allocations replay after a fresh process starts.

## Receipt retention in a live owner

Terminal receipts promise the existing fixed one-day minimum, measured after
Resource evaluation reaches its terminal decision rather than from admission or
the beginning of evaluation. At the exact `expiresAt` instant their detail remains
available. Once that instant has passed, completed receipts compact to
`detail: expired`: their original receipt and transaction identities, key, epoch,
view, positions and ordered creation allocations remain. The compact form contains
no results, next page or expiry field. Allocations come from the original retained
creation entries, preserving their operation indices and names even if those
Resources were subsequently deleted. Completed no-op receipts compact with an
empty allocation list and continue to omit `effectPosition`. Their keys remain
bound for the epoch, and semantic conflicts remain conflicts.

Failed receipts are forgotten whole after their promised instant. Their old URLs
then become unknown, and their keys can admit a new request under current state
and guards. They never acquire `detail: expired`. This differs deliberately from
completed receipts and from pending ownership. Live detail maintenance never
retracts a pending execution; abandoned pending receipts are still retracted
synchronously during startup recovery.

Maintenance runs on startup, through the private `maintain()` entry point, on
access to a key or receipt, and on an unreferenced periodic timer (one second by
default). Each full sweep is atomic. A background sweep failure rolls back its
changes, stops the timer, closes and fences the owner; subsequent owner operations
report that failure rather than continuing silently. Closing the owner cancels
its timer. The private test/configuration cadence is not an advertised retention
or transaction-duration limit. The reference sweep scans available terminal
receipts; population, work and operational timing bounds remain unqualified.
There is no schema change or automatic migration in this slice.

## Observed verification

The prior bounded five-file suite exercised 387 tests, including 43 atomic-owner
tests alongside Resource evaluation, semantic identity, Transactional wire/schema
fixtures and catalog tests. The context-default correction adds ten atomic-owner
tests for a total of 53 in that file; its focused rerun does not repeat that broader
suite. The focused 53-test run, build, typecheck, dependency-boundary and format
checks passed for the correction. Observations cover:

- Bead plus local-reference Link success, ordered Events, schema-valid receipt
  and group, one durable commit, and principal-bound receipt lookup.
- Final-operation failure rolling back all graph and identity effects while
  retaining a failed receipt, including after reopen.
- Repeated update/reversal results and Events with one final postimage; all-no-op
  receipts with unchanged position/revisions and replay after restart.
- Two admitted requests carrying the same revision guard serialize into one
  successful update and one retained revision mismatch.
- Atomic Link property/metadata updates, Link-subject Events and unchanged
  endpoint Bead revisions; self-Link deletion before Bead deletion with ordered
  unlink facts and final tombstones.
- Late guard failure rolling back earlier update and Link deletion; local-label
  create/update/delete normalization and prevention of deleted-ID reuse.
- Equal pending join, differing-request conflict, retraction and stale-owner
  fencing, plus a fresh admission after an injected live internal failure.
- Label renaming, explicit/local identity equivalence, numeric equality without
  rounding, refused numeric identity and metadata-sensitive conflict.
- Unsupported/malformed operations refused without effects; separate principals;
  refusal of a concurrent live store, implicit reseeding and duplicate creation.
- All six Resource operations executed with singleton-first and batch-first
  admission, equivalent local/canonical references and one shared receipt through
  pending join, completion and restart; creation labels remain as first admitted.
- Empty/omitted context equality for create and update, both carrier directions
  and both default spellings, through pending join, completion and restart; explicit
  null context members remain conflicts. Unversioned and unknown-policy files are
  refused without changing file bytes, retained completed receipts or pending owners.
- Cross-carrier numeric failure and conflict, retraction and stale-owner fencing,
  completed expiry/replay, failed-key forgetting and rejection of singleton-only
  syntax violations before owner admission.
- Receipt availability through the promised instant, ordered retained creation
  allocations after Resource deletion, compact no-op replay after restart, and
  principal-bound expired-receipt lookup.
- Failed receipt forgetting and fresh same-key admission against changed state;
  unchanged pending joins/fencing across the detail-retention interval.
- Terminal-time retention calculation, maintenance while idle, timer cleanup,
  atomic rollback of a failed sweep and sticky background failure with restart
  recovery.
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

The six Resource singleton preparation paths already use batch's owner and
receipt/key namespace. Before any Transactional HTTP integration, extend that
same owner to the remaining alias and sequence routes, including unresolved
sequence dependencies. They must not keep writing through a parallel Read+Update
owner. A migration or explicit new-Scope provisioning path, startup
qualification and unified read authority must accompany that integration.

Remaining requirements include set operations; owned-Link transitions; aliases
outside batch; sequence carriers with unresolved dependent admission; authorization projection and
reauthorized receipt disclosure and pagination; Event Sources, changefeed,
snapshots and erasure;
duration/recovery bounds under operational failure; complete native schemas,
aggregate policies and limits; HTTP reception/status/conditional behavior; and
executable whole-profile conformance evidence. Live receipt retention now runs,
but it does not qualify workload bounds, policy/erasure projection or a complete
Transactional lifecycle. There is no Read+Update or Transactional profile
admission change in this slice.
