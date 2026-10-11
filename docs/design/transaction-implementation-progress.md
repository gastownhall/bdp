# Initial Transactional implementation

This slice implements the first **private atomic transaction owner**. It does not
add an HTTP target, executable, package export, discovery token or conformance
claim. Its reference storage format is deliberately separate from the current
Read+Update development store.

## Executable boundary

`transaction-batch.ts` prepares bounded Resource batches, eight singleton
request kinds and a restricted sequence carrier, reusing the Resource and alias
evaluators. `transaction-sequence.ts` owns sequence stepping and receipt projection. `transaction-store.ts`
owns a SQLite file, its exclusive connection, key namespace, pending receipts,
Resource state, alias locator state, identity allocation and change groups. The
supported Resource operations are `createBead`, `updateBead`, `deleteBead`,
`createLink`, `updateLink` and `deleteLink`, with preceding local creation
references, including self-Links. Singleton `putAlias` and `deleteAlias` use the
same owner and receipt/key namespace. Update and delete revision guards use the
same staged Resource evaluator. Set operations and alias batch members are refused
before key lookup or admission. The private limits are 64 KiB input,
32 operations and 32 JSON container levels. These are implementation bounds, not
advertised profile capabilities.

Installed Types are fixed, schema-free and without owned outgoing Links. Policy
is fixed all-visible/all-writable. The principal argument selects the receipt/key
namespace; it is supplied by a trusted caller and is **not authentication**.
There is no policy configuration or grant change support in this composition.

Preparation performs syntax and Scope checks without resolving aliases. Admission
normalizes inside the authority database transaction, then commits the key, exact
semantic identity, original alias witnesses, pending receipt, transaction identity
and execution owner together. A proven equal pending
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
normalization policy. The current format is
`bdp-private-transaction-alias-witnesses-3`, with an alias locator table and a
witness column beside each receipt. The identity policy is
`transaction-context-and-alias-witnesses-2`. Missing or mismatched policies and
earlier formats are refused before pending recovery or receipt maintenance.
This prevents an older owner from silently ignoring alias path uniqueness or
reinterpreting retained identities without their original alias witnesses.
There is no migration, in-place upgrade or reseed: new disposable stores require
explicit provisioning at a new path. Old retained outcomes and pending owners are
never reinterpreted or removed by a refused open. The Scope epoch persists
across restart. Persistent SQLite EXCLUSIVE locking prevents two
live connections from admitting independently into the same file. Startup
retracts uncommitted pending receipts immediately, before admitting new work; it
never executes an abandoned request on its own initiative. A committed receipt
and its allocations replay after a fresh process starts.

## Alias singletons

`putAlias` and `deleteAlias` execute through the existing alias evaluator inside
this owner's effects savepoint. Their alias table change and terminal receipt
commit together. Available results contain exactly one alias result with index
zero and no Resource postimage or operation name. Effectful puts, repoints and
deletes, and same-target puts, all leave Resource revisions, Events, groups and
Scope positions unchanged. The receipt carries the current observation barrier
as `requiredPosition` and omits `effectPosition`. Expired completed alias receipts
carry `allocated: []`; their key still protects the original effect. Replaying an
old put after repointing, or an old delete after recreating the locator, returns
the original disposition without touching the current alias.

Committed Bead identities permanently reserve their suffix against alias puts,
even after deletion. A live alias reserves that suffix against Bead creation;
Link identities use their independent root. Resource allocation checks the same
constraints. The alias evaluator preserves its existing target visibility and
write checks under the fixed private policy. Deleting a Bead does not delete its
aliases or treat them as Link incidences. A subsequent operation whose current
alias target is missing fails `resource-not-found`, as in the reused evaluator.

## Resource alias witnesses

Resource aliases are supported for Bead update/delete subjects and Link creation
endpoints, including pinned endpoints. Each operation durably records its
original canonical alias locators and their canonical Bead targets or misses.
The map is per operation, following the specification's sequence of operation
identities; it is not shared across all operations in a batch. Within one
operation, an original locator keeps its captured meaning across reference slots
and equivalent local/canonical spellings.

Alias resolution and durable admission share one database transaction. Execution
uses the admitted targets and an overlay for captured misses, so repointing,
deleting or assigning an alias before execution changes neither its admitted
identity nor the Resource it addresses. Numeric admission, Resource existence,
revision guards and Type checks still run at execution against staged Resource
state. The existing Resource evaluator and the Read+Update capture/overlay
pattern are reused without adopting Read+Update's key-state machine. Batch-local
creator references remain symbolic operation indices or supplied canonical IDs;
they are never replaced with provisional allocated identities.

Retry comparison first consults the original operation's locator map. An
original miss stays unresolved even if that alias has since been assigned;
distinct missing locators remain distinct. Direct canonical references compare
with the recorded target. A previously unseen retry locator resolves through the
current alias table, without a Resource visibility lookup, solely for comparison.
That transient witness is never added to the original metadata: a later retry
resolves it again. Pins retain their original revision value. Alias mutation
subjects/targets and Link subjects do not acquire Bead-alias resolution.

Witness metadata commits with pending admission and remains unchanged beside
available or expired completed receipts. Failed-key forgetting and pending
retraction remove its row. Startup never resumes an old captured execution: a
fresh admission after retraction captures current locator state. Malformed
persisted witnesses are owner faults, not ordinary missing aliases or key
conflicts. These are internal metadata, not new receipt or wire fields.

Alias operations remain forbidden in batches, as required by the normative
contract. There are no HTTP alias routes, redirects, replica alias projections
or new profile claims.

## First private sequence adapter

The sequence preparer applies the shared protocol syntax and Scope checks to the
whole carrier before key effects. It accepts the eight singleton operation kinds
with explicit Resource operands and creation labels for reporting. Repeated keys
remain a whole-carrier error. Every `@name` operand and every Resource-alias
operand is explicitly refused before any key lookup or reservation. This is a
private implementation limit, not an advertised narrower sequence contract.

The store reserves all unknown member keys and their pending receipts in one
SQLite admission transaction. It then executes members in declaration order,
with a separate commit per member through the same owner used by singleton and
batch. An earlier successful member remains committed when a later member fails;
independent members continue after ordinary failure. A source-private stepping
interface permits unrelated owner calls between members. The async adapter uses
one event-loop turn per member and continues after admission without requiring a
caller to consume its response. There is no HTTP disconnection handler in this
slice; dropping response consumption is tested independently of authority abort.

The envelope projects available results and retained failures with the current
member's index and creation label. A foreign pending owner projects
`idempotency-in-progress` before comparing immutable fields; it is never executed
or retracted by this carrier. A later turn that finds the earlier owner completed
compares and replays that receipt. Expired Resource creations project exactly
`allocated: { id, type }`, without receipt allocation indices; expired alias and
noncreation results omit it. The adapter has the owner's fixed all-visible
policy and does not implement withholding or erasure projection.

An internal failure or explicit authority abort retracts only pending keys still
owned by this attempt. It preserves its committed prefix and another owner's
reservations. A replacement attempt can acquire the released tail; the cancelled
attempt cannot execute or cancel those replacement keys. On process restart,
the existing recovery path retracts abandoned pending member receipts and never
resumes the tail. An explicit client retry replays the prefix and admits the
remaining unknown members. This slice adds no storage format or identity-policy
change: all supported member identities were already fully resolvable.

The next dependency slice needs durable creator-attempt/operation-slot
reservations, successful and unbound binding facts, failed-key retention
independence, pending-dependent projection without dependent-key lookup, and the
finite direct-carrier comparison wait. Even supplied-ID `@name` references must
wait for the creator's disposition because a failed creator binds no identity;
textual substitution would be incorrect.

Sequence Resource aliases also need a representation follow-up. The Transactional
admission rule records normalized identity, while the inherited sequence rules
resolve aliases when each member is reached. Earlier alias mutations and other
requests may change a later member's locator before its turn. Freezing a missing
alias at sequence admission would violate that behavior. This is recorded as a
representation question for the next slice, not a new wire ruling or a blocker
for the supported explicit-reference carrier.

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
Retention adds no separate schema change or migration.

## Observed verification

The bounded seven-file suite exercises 494 tests, including 83 atomic-owner
cases and 15 sequence-adapter cases, Resource and alias evaluation, semantic
identity, Transactional wire/schema fixtures and the Transactional catalog. Build, typecheck, dependency boundaries,
formatting and installed-package smoke pass. Lint completes with the existing
three warnings and one informational finding. Observations cover:

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
- Alias creation, same-target put, repoint and deletion with exact locator-only
  results; canonical/local retry identity and shared Resource/alias key namespace.
- Alias pending join and stale-owner fencing; empty-allocation expiry; failed-key
  forgetting; live fault rollback and abrupt process-exit recovery before/after
  commit, with unchanged graph groups and positions.
- Bead/alias path uniqueness, deleted-Bead reservation and independent Link
  identity; refused earlier private formats without pending retraction.
- Durable original Resource-alias targets and misses, canonical/singleton/batch
  equivalence, endpoint-slot changes, pins and symbolic batch creator indices.
- Transient new retry locators before/after assignment and repoint, unchanged
  original metadata through replay and expiry, and per-operation map isolation.
- Captured-miss late failure with full graph rollback, canonical alias deletion
  tombstones, persisted-witness validation and abrupt Resource-alias execution
  recovery before/after commit. Earlier alias stores are refused byte-identically
  before pending retraction or expiry maintenance.
- Atomic sequence admission with fault rollback after its second reservation,
  separate member commits, interleaving and continuation after ordinary failure.
- All eight explicit operation kinds; overlapping presentations and pending-owner
  precedence; mixed retained/conflicting/failed/unknown keys; cross-carrier value
  equality; current labels; expired creation and alias projections.
- Response-independent async continuation, fenced abort/replacement cleanup,
  crash-prefix recovery and pre-effect refusal of duplicate keys, `@name` edges
  and Resource-alias operands.
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

All eight singleton preparation paths already use batch's owner and
receipt/key namespace. Before any Transactional HTTP integration, extend that
same owner with full sequence dependencies and turn-time Resource-alias handling.
These routes must not write through a parallel Read+Update owner. A migration or
explicit new-Scope provisioning path, startup qualification and unified read authority must accompany that integration.

Remaining requirements include set operations; owned-Link transitions; sequence
carriers with unresolved dependent admission and turn-time Resource aliases;
authorization projection and reauthorized receipt disclosure and pagination; Event Sources, changefeed, snapshots and erasure;
duration/recovery bounds under operational failure; complete native schemas,
aggregate policies and limits; HTTP reception/status/conditional behavior; and
executable whole-profile conformance evidence. Live receipt retention now runs,
but it does not qualify workload bounds, policy/erasure projection or a complete
Transactional lifecycle. There is no Read+Update or Transactional profile
admission change in this slice.
