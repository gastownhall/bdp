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
`bdp-private-transaction-provenance-5`, with durable creator facts and unresolved
receipt templates as well as the alias table and receipt witnesses. The identity
policy is `transaction-revision-provenance-4`. Missing or mismatched policies and
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
with canonical Resource operands and backward `@name` dependencies, including
pinned endpoints and alias puts targeting an earlier Bead creation. Repeated keys
and invalid/forward/wrong-kind labels remain whole-carrier errors. Resource-alias
operands remain explicitly refused before any key lookup or reservation. This is a
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
remaining unknown members.

Canonical dependencies reserve their pending receipts with an unresolved template
that pins the sequence attempt, creator member and operation slot, retaining every
other normalized semantic field. Creator binding facts commit atomically with the
creator's effects and terminal receipt, independently of receipt retention. A failed
creator therefore remains unbound even after its failed key is forgotten and reused.
A completed dependent stores the ordinary immutable canonical identity; a permanently
failed creator gives its dependent the private unbound identity and a retained
`binding-unavailable` failed receipt. Supplied-ID creators also wait for disposition.
A pending/transient creator skips dependent-key comparison entirely and releases
only this attempt's dependent reservation. Internal bindings are independent of
projected result entries; the current composition still has fixed all-visible policy.

`transaction-dependencies.ts` holds pure template/binding comparison helpers.
`transaction-comparison.ts` provides the private asynchronous direct-carrier seam.
It rejects provable differences in known fields, pins, repeated references and
already durable creator facts. Otherwise it waits outside any database transaction,
with one finite monotonic comparison deadline separate from transaction duration.
As soon as durable facts prove equality it returns the existing pending/terminal
receipt. Unresolved timeout yields an internal `temporarily-unavailable` result for
future direct 503 mapping, without changing the owner's receipt. Retraction permits
fresh ordinary admission under the same deadline; no owner or receipt is inherited.
Epoch change stops comparison. The low-level store's `comparison-pending` value is
internal, not a receipt or a new wire outcome. Sequence presentations never wait.

Sequence Resource aliases also need a representation follow-up. The Transactional
admission rule records normalized identity, while the inherited sequence rules
resolve aliases when each member is reached. Earlier alias mutations and other
requests may change a later member's locator before its turn. Freezing a missing
alias at sequence admission would violate that behavior. This is recorded as a
representation question for the next slice, not a new wire ruling or a blocker
for the supported canonical dependency carrier.

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

The bounded 11-file regression suite passes 807 tests, including 83 atomic-owner,
15 sequence-adapter and 23 canonical dependency cases. Resource/alias evaluation,
semantic identity and existing RU sequence behavior are included. Build, typecheck,
dependency boundaries, formatting and installed-package smoke are checked locally.
Lint retains the existing three warnings and one informational finding. These are
private implementation observations, not product acceptance or full-profile
qualification. Observations cover:

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
  crash-prefix recovery and pre-effect refusal of duplicate keys, invalid `@name`
  edges and Resource-alias operands.
- Durable creator-attempt facts, transitive dependencies, supplied-ID failure,
  failed-key forgetting/reuse, immutable unbound retry identity, interleaved guards
  and independent-prefix preservation.
- Direct finite comparison outside SQLite transactions, provable partial conflicts,
  pending equality after creator commit, unchanged timeout state, fresh admission
  after retraction, non-resetting deadlines under churn and epoch-change refusal.
- Abrupt dependency-prefix recovery, creator/fact/receipt rollback, fenced dependent
  finalization and byte-identical refusal of the previous private storage format.
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
same owner with turn-time Resource-alias handling and current authorization/disclosure.
These routes must not write through a parallel Read+Update owner. A migration or
explicit new-Scope provisioning path, startup qualification and unified read authority must accompany that integration.

Remaining requirements include set operations; owned-Link transitions; sequence
carriers with turn-time Resource aliases;
authorization projection and reauthorized receipt disclosure and pagination; Event Sources, changefeed, snapshots and erasure;
duration/recovery bounds under operational failure; complete native schemas,
aggregate policies and limits; HTTP reception/status/conditional behavior; and
executable whole-profile conformance evidence. Live receipt retention now runs,
but it does not qualify workload bounds, policy/erasure projection or a complete
Transactional lifecycle. There is no Read+Update or Transactional profile
admission change in this slice.

## Private direct receiving and admission composition

`transaction-submission.ts` now composes body/syntax/key checks, a trusted
Scope-authentication decision, and direct singleton/batch admission. It returns
typed internal receipt/refusal decisions, not HTTP responses or public Problem
representations. Raw header multiplicity, target/media checks, socket handling,
receipt response headers and HTTP wait/status rules remain unimplemented.

The same Transactional owner accepts a frozen value-only receiving snapshot:
response JSON acceptability and a private operation-count bound from 1 to 32.
Existing-key comparison and unknown-key admission stay in one atomic owner step.
A conflict precedes negotiation. An equal pending, available or expired duplicate
negotiates before fresh-request capacity controls and never renews its retained
detail. An unknown key checks operation count before negotiation; neither refusal
inserts a receipt or owner. No admit-then-retract path implements a receiving
refusal, and no caller callback runs inside SQLite for these controls.

Batch preparation now distinguishes a syntactically valid count above 32 from
admission refusal. The trusted three-argument store entry retains the private
32-operation ceiling; submission controls may narrow it, not widen it. Thus the
existing persisted alias-witness bound and private format remain unchanged.
Unsupported set operations and excessive private depth return an explicit
development-limit result, not a protocol-wide malformed-request ruling.

Direct unresolved comparison snapshots the controls once before waiting and
carries them through the existing finite deadline, including fresh competition
after retraction. It returns no pending receipt before equality; a proven equal
request can then receive either the retained receipt or the negotiation refusal.
Sequence admission/projection remains unchanged. Ordinary execution and fenced
storage errors propagate with their original cause chains rather than becoming
new permanent outcomes. The private fixed all-visible policy is unchanged; a
trusted authentication result is not an HTTP authentication implementation.

Focused observations cover receiving precedence and no key capture, overlapping
presentations, original failed/expired receipts, cross-carrier numeric/default/
context identity, alias repoint witnesses, finite comparison under ownership
churn and epoch change, immutable controls during a wait, and injected admission
and cleanup faults. These are private implementation tests, not endpoint or
whole-profile qualification. The next receiver still needs same-owner Resource
reads and current serving observations, receipt HTTP semantics, and lifecycle
ownership through disconnection; no discovery or executable admission changed.


## Common revision provenance integration

The private Transactional normalizer accepts the common `revisionProvenance`
input envelope. Empty and omitted input still compare equally, while explicit
null context members and actor values remain significant. Created/updated
Events copy the complete envelope of their named version; Resource postimages,
retained results and Event projections agree. Input agent/message values remain
strings or null, while output context uses the protocol value-state objects.
Deletion, aliases, Activity and public profile admission are unchanged.

Previous private stores are refused before recovery or expiry maintenance.
The Transactional format and identity policy above, the Read+Update recovery
format (3), and the development installation identity all advance. No existing
Resource, receipt, fingerprint, Event or key is rewritten or silently reseeded.
Disposable compatibility tests retain pending claims, creator facts and outcomes
byte-identically on refusal. Historical Read evidence remains attached to its
original observed head until a fresh frozen-head qualification is performed.

## Private same-owner Read composition

The Transactional owner now supplies an expiring synchronous Resource/configuration
reader to the existing AuthorityReadPlane. The shared Read contract contains only
resource, resources, incidentLinks, alias and policy; it does not require or fabricate
Read+Update key outcomes. The owner's actual immutable installation supplies the
Type inventory and fixed all-visible, schema-free/unowned configuration. Named
policy lookups are absent in this private installation.

The private transaction-read module composes canonical Resource/properties reads,
revisions, collections/selectors, incident Links, Types, alias resolution and retained
pagination with the same owner that commits mutations. Reader methods expire after
callback completion or failure, reject asynchronous callbacks, and cannot reenter
writes or close. Frozen row snapshots carry no live SQLite capability. Fenced owners
refuse reads with their failure cause retained. The caller owns the store lifetime;
closing the Read plane releases its cursors without closing the write owner.

Tests exercise actual commits and failed-batch rollback, alias repoint/deletion and
dangling targets, reopen recovery, pagination across later commits, callback lifetime,
reentrant reads during tentative effects, and injected before/after-COMMIT failures.
Those injections are not disk/power-loss qualification. Existing private format,
public exports, profile advertisements and the pinned Read evidence remain unchanged.

This is not yet a Transactional serving surface. Same-entry source-position
propagation, continuation source context, current serving fields, minimum-position
barriers, receipt reads and replication Snapshot/changefeed support remain outside
this slice. Existing collection pagination is not a replication bootstrap. No HTTP
listener or Transactional profile claim is introduced.

## Private Transactional Read source context

The same-owner Read entry now captures an immutable epoch/view/position record
alongside the rows. The epoch comes from persisted owner metadata; the view is the
owner's existing fixed all-visible projection, also used by its receipts/groups.
The position comes from the committed metadata head, including `pos-0` for an empty
Scope. Admission, no-op, alias-only and failed batches do not invent a new position.
No receipt effect position or later diagnostic inspection supplies read context.

The shared Read plane treats this as optional, source-private string data. Basic
Read and Read+Update gain no required Scope-history field or wire member. On a
collection continuation, the observation distinguishes current `sourceContext`
from the retained page's original `snapshotSourceContext`. The latter stays paired
with its original selected rows and revisions while current context is captured at
each serving entry. A WeakMap pairs actual immutable page objects with their original
context; it neither retains page keys indefinitely nor points back to snapshots.
It is not a traversal capability. Cursor expiry and projection checks remain in
ordinary pagination, and context storage consumes the same retained byte/node budget.

The private Transactional composition validates exact epoch/view/position records
before delivering observed results, including alias and observed-problem responses.
Tests distinguish synchronous capture from later Promise delivery, a newer position
with an unchanged Resource revision, repeated continuation serving context, current
context on expired-cursor refusal, and immutable callback capture. Existing
provenance, metadata, diagnostic-budget and storage-format changes on main are
preserved through ordinary merge ancestry.

This supplies internal observations, not HTTP consistency qualification. Selecting
and enforcing response fields/minimum barriers, conditional/HEAD ordering, receipt
serving context, replication Snapshots and changefeeds remain separate work. No
public profile advertisement or historical evidence relabeling is implied.

The source-context capability uses a package-private pagination factory over the
same engine. Public `createReadPagination` retains its original facade and input
type: it does not consume an extra context property or argument, and exposes no
context accessor. The private helper is absent from root exports and remains
behind the package's deep-import boundary. Source public declarations, an actual
Node package-root import and installed-package smoke tests cover this separation;
internal context/retention tests continue to exercise the same engine.

## Private Transactional service and receipt observations

The source-private `transaction-service` composes one existing Transactional owner
with its Read plane, direct submission boundary and sequence stepper. Construction
requires `ownerLifetime: "service"`: successful construction transfers shutdown
responsibility, and callers stop using the raw owner. Failed construction leaves
ownership with the caller. Closing stops new work, drains accepted work, releases
Read cursors and closes that same database. A detached response does not cancel
admitted execution. Scheduler failure retracts only the affected sequence's
unexecuted reservations; committed members and another attempt's reservations
remain. Failed cleanup fences service entry and retains original/cleanup causes.

The owner now offers an atomic receipt observation. Principal-filtered lookup,
retention cleanup, fixed all-visible projection, detached immutable receipt bytes
and current epoch/view/position share one guarded SQLite entry. Direct delivery
and later receipt reads use that observation, never an earlier receipt object
paired with a later `inspect()`/`withRead()` position. The body's original execution
view/positions/postimages remain unchanged when the serving head advances or a
Resource is deleted. Trusted transport identity supplies receipt access; writer
attribution does not. Unknown, foreign, forgotten and retracted receipts remain
uniformly absent. Current policy is still the fixed all-visible development view;
this does not qualify changing grants, withheld/erased projection or owned Types.

This bounded service inlines all supported results with `next: null`. The spec's
Mutation Receipt responses section applies advertised `page.maximumItems` to
receipt results as well as pages. Accordingly, this interim service refuses a
configuration below 32 entries, the existing private batch limit. That restriction
is a supported-configuration limit, not a protocol minimum. Sets and durable
receipt pages remain unimplemented. No maximum representation-byte limit or
complete Transactional directory/profile is advertised.

Tests cover shared singleton/batch/sequence key identity, canonical afterstate,
receipt immutability/current context, principal nondisclosure, retention and exact
retry, finite unresolved comparison, drain after detached delivery, scheduler
failures, and abrupt process exits before and after commit. Process exits and SQL
fault injections are not disk/power-loss qualification. The receipt reader inherits
the owner's reentrancy and sticky fencing checks. HTTP routing, raw sequence
receiving order, minimum-position barriers/conditional fields, required Snapshot
and changefeed paths, receipt pages/erasure, installed contracts and public evidence
remain subsequent slices. No public API, storage format or normative change is
part of this service layer.

### Private actual HTTP service and atomic receipt delivery

A source-private loopback runtime now composes one Transactional owner, Read
plane and service. It serves the ten implemented operation targets, canonical
Resource/collection/alias reads, and receipt GET/HEAD. Its credentials supply
principal and mutation permission independently of carried actor attribution.
A configured canonical Scope can stay fixed across listener addresses; receipt
identities and navigation are never rewritten. Omitting this private fixture
setting retains the disposable same-port behavior only.

Direct admission retains the established bounds/syntax/auth/key/limits/Accept
order. Exact pending retries return 202 with the receipt's own Location;
original accepted submissions execute to terminal before returning. POST
conditions do not suppress execution or its receipt. Sequence uses one runner,
independent member commits and canonical dependencies; current response context
is observed after that runner completes. Closing the listener prevents new work
and drains admitted work even after delivery disconnect, before closing the
service-owned database. A supplied test scheduler must eventually deliver each
uncancelled turn; no new protocol timeout is implied.

Executed and replayed direct receipts are projected with current context inside
their original authoritative execution/admission entry. Delivery does not make a
second retention-clock observation or scan receipts by ID. Receipt GET continues
to apply retention in its own entry; its current ID lookup is still a linear
principal-scoped scan. Serving asserts current position covers required/effect
positions. Prior-epoch stored receipts are hidden; the test injects stored facts,
not a production epoch-rotation capability. Fixed all-visible projection does
not implement variable grants or erasure.

The unchanged 32-operation development bound is shared by preparation, owner,
service and HTTP. Available completed receipts must fit the configured inline
page bound and have next:null. No set expansion or durable receipt paging was
added. The minimum configured receipt page bound is an interim implementation
limit, not a protocol-wide minimum.

This increment does not advertise Transactional discovery or a profile. Valid
unsupported set/depth/Resource-alias-sequence requests fail before key capture or
effects with a bodyless internal 500, labeled as a development gap. Minimum
context controls likewise cannot yield success or a conditional shortcut; their
bodyless internal failure is explicitly **not** a normative catch-up outcome.
Full minimum-position/epoch/view/expiry ordering remains required next work.
Discovery, Directory, snapshot/changes/events, set operations, installed
contracts, Resource-alias sequence timing, variable authorization/erasure,
receipt pagination and complete executable qualification remain open. Public
exports, installed profile admission, schemas and pinned Read evidence are
unchanged.

Verification includes real loopback precedence and receipt conditions, finite
comparison 503, no key capture for unsupported valid requests, listener
close/reopen, a child-process SIGKILL/restart after a completed response, client
disconnect with admitted work, and an injected post-commit failure followed by
sticky refusal/reopen. These are bounded executable witnesses, not disk or
power-loss qualification. External exact-command results accompany the frozen
candidate.

#### HTTP review follow-up boundaries

Unsupported minimum-context fields on commands also fail before any key binding
or effect; no command barrier semantics are inferred. Operation routing accepts
exact canonical target URLs. Unimplemented set/unknown targets, encoded alternate
spellings and query-bearing command URLs are not registered targets and return
404, rather than advertising a Read method table. Sequence depth failures use the
same development-composition marker as batch depth failures; the alias marker is
reserved for the actual Resource-alias sequence restriction.

The private receiving maximumOperations setting controls transaction.operations
only; sequence.operations retains its separate 32-member bound. Tests exercise
both limits together. This is explicit private configuration, not new discovery.

Runtime close aborts in-flight socket delivery, including connected clients, and
then drains accepted durable work. Clients recover outcomes by key replay after
reopen; “drain” does not promise completion of response delivery. Sequence response
context still comes from the post-runner owner observation. A fault in that entry
can lose delivery after member commits; replay recovers the original member
outcomes. Moving that observation into the final turn remains separate work.

HTTP internal faults are deliberately bodyless and disclose no causes or stored
identifiers. The owner/service preserve causes, but this private HTTP fixture has
not yet added a bounded internal diagnostic channel for those caught exceptions.
That diagnosability gap remains open; it is not a claim that causes reach clients.

### Canonical point and receipt minimum-read subset

The private HTTP fixture now honors complete canonical epoch/view/minimum tuples
on existing visible Bead and Link records, their properties views, and receipt instances.
It validates immutable per-request controls before waiting. The shared Read plane
has a source-private fixed condition hook after captured authorization and point
materialization, still inside the same owner entry and before delivery; ordinary
Read/Read+Update calls use no such condition. The
Transactional hook checks the actual same-entry source context. It does not read
a diagnostic position before or after the representation, retain a mutable global
condition, or create another Read plane per request.

Receipt attempts retain principal/epoch nondisclosure before minimum decisions,
recheck actual retention each turn and capture body/current context together.
Current owner integrity guards remain ahead of a wait decision. A foreign epoch
returns cursor-expired; a foreign view returns foreign-view. An actual behind
observation retries outside the owner until the original finite monotonic deadline
or an actual concurrent commit satisfies it. Exhaustion returns catch-up-timeout
with Retry-After. No SQLite entry remains open while awaiting. GET/HEAD and
conditional decisions then use the resulting representation and current context.
The existing exclusive synchronous owner entry provides point-read consistency;
this does not add a separate SQLite BEGIN around every ordinary Read.

The default private wait budget is finite; injected scheduling/clock seams are
for tests, not new public configuration or advertised limits. Service close drains
accepted finite waits. The private point facet accepts an AbortSignal, but the
HTTP path does not pass a signal or connect socket disconnects to a controller.
Actual HTTP point and receipt disconnects both drain the remaining finite wait
budget, which also bounds their shutdown delay. Unsupported command controls
still fail before mutation admission, after authentication/authorization.

This remains a named subset, not complete minimum-position qualification.
Absent/hidden Resource ordering relative to a minimum has no established ruling;
such point requests return the explicit private visibility gap without adopting
either 404-first or barrier-first semantics. This fixed all-visible owner does
not qualify changing visibility policies. Collection continuations and other nonpoint routes retain the development gap
when controls are supplied. Partial/malformed tuples, bare epoch/view fields and
unknown opaque position spellings also retain that gap; no normative error rule
is invented for them. In particular, whether a minimum constrains an old retained
query page's anchor or its current serving observation remains unresolved. Normal
continuations without controls retain their existing stable data/lifetime behavior.
No public profile/discovery, schema, durable format, Type or evidence change was
made. Snapshot/replay and the other previously named required gaps remain open.

The configured fixture has no eligible replica routing and waits locally, one
permitted strategy. CORS is disabled by the inherited Origin refusal. Actual
409/410/503 wire bodies are schema-checked and carry the final attempt's captured
context; receipt 401/404 nondisclosure responses carry none. HTTP method handling
uses target shape without checking non-operation existence. The origin-form
CONNECT probes exercise method dispatch; actual authority-form CONNECT is rejected
by raw-target validation with 400, and neither path establishes a tunnel.


### Durable receipt pages in the private receiver

Completed receipt facts remain whole in the owner. Root wire projection returns
all entries if they fit the exact installed page maximum, otherwise a prefix and
an absolute next URL. Durable opaque page tokens and contiguous entry boundaries
commit with the terminal receipt, effects and group. Pages select original facts;
they never rebuild results from current Resources. Full facts still feed sequence
projection and creation-allocation tombstones, including tail-page allocations.

One validated maximum configures store partitioning, the service page bound and
Read pagination. It defaults to 32; paging tests use maxima 1, 2 and 5 with a valid
default at or below the maximum. This changes only the new private fixture's page
setting and makes no change to historical Read evidence. Prior private formats or
changed installation bounds are refused by the locked configuration check before
BDP pending retraction, creator cleanup or retention maintenance; no migration or
reseed. SQLite hot-journal recovery must run before that check can read configuration.
Normal incompatible files are refused byte-identically; a hot-journal file may first
be restored by SQLite to its committed state, even if its installation is then refused.
Recorded missing, overlapping, truncated or wrong-parent chains are service faults,
never permission to generate replacement handles or truncate results.

Receipt-page reads use current principal/epoch nondisclosure first, then the
supported minimum context and finite wait, then expiry and representation in the
same owner entry. Unsupported minimum forms remain a private gap after disclosure
and before read-triggered expiry for both roots and pages. Known expired pages return 410; unknown/foreign pages return
uniform 404. Recorded page identities survive same-epoch process loss and changed
listener ports with a stable configured Scope. Root/page GET and HEAD retain the
current observation and normal conditional handling without validators.

Minimum-read review corrections also preserve already-decided query 400 errors,
accept the reserved genesis minimum, and move root read-triggered retention after
the minimum check for a still-stored disclosed receipt. If independent maintenance
actually forgets a failed receipt while a read waits, the next lookup still returns
uniform 404; no retention pin is introduced. The 5 ms polling strategy can repeatedly
materialize points and acquire receipt transactions, including after disconnect;
its bounded loopback behavior is not a production concurrency or load qualification.

This implements paging for existing explicit mutations, not the catalog's large-set
expansion witness. Sets, installed-contract integration, variable-view/erasure
projection, replication and truthful full Transactional discovery remain open.


### Private valid-set core, with serving admission still closed

A source-private preparation seam now admits valid bounded updateWhere/deleteWhere
records to the existing Transactional owner for core testing. The normal batch,
singleton and HTTP preparation paths still refuse sets. Selector grammar/complexity
error timing remains an explicit development gap, pending normative review; this
core is not a second wire parser or a completed set-serving claim.

The staged collection facade reads the active owner's transaction, expires at the
end of that turn and freezes returned stored rows. Selection uses canonical records
and the existing Selector evaluator at the operation turn. The selected set is
fixed before expansion, sorted in canonical ID order, and applies the same Resource
mutation/fact path used by ordinary members. Cardinality failure and late Resource
failure roll back the complete transaction while retaining its failed receipt.
Matched entries, no-op results, intermediate postimages, final group state,
provenance and metadata retain their existing meanings. Receipt pages persist the
complete flat set result, including the matched entry, without recomputing selection.

The private authority now enforces a total 4,096 induced-Event bound across ordinary
members and set expansion. Exceeding it yields an atomic transaction-wide failed
receipt with limit-exceeded; an evaluator-only test seam can lower but never raise
that bound. It is not a new public configuration or protocol maximum. Selection and
complete result materialization remain linear in collection/population size.

Private format set-core-7 protects the expanded durable witness vocabulary; the
identity codec is unchanged. No migration or reseed is provided. Core tests cover
same-version recovery/replay and an external probe uses the actual prior paging
writer to establish byte-identical incompatible-format refusal. Paging crash-recovery
repairs are integrated: SQLite may recover a hot journal before the locked
configuration check, which still precedes BDP cleanup and retention.

The supported installation remains all-visible, schema-free and unowned. Installed
contract/policy composition, owned-source fanout, full set HTTP admission, remaining
consistency routes, replication and truthful Transactional discovery remain open.
Recovery regressions kill a process inside maintenance and terminal execution,
not merely after a response. Sixty committed three-result receipts and their page
URLs survive hot-journal rollback; the terminal crash's pending admission is
retracted without exposing its uncommitted effects. The terminal fixture reduces
the real SQLite cache to force dirty-page spill; maintenance uses the ordinary
cache. These are process-crash witnesses, not physical disk/power-loss testing.
Concurrent page minimum waits also drain on close while an admitted commit can
satisfy them. Unsupported root/page controls withhold serving context and do not
trigger retention; independent maintenance can still expire or forget receipts.

### Private compiled-contract installation and retention

The Transactional owner can now accept the existing branded DevelopmentContracts
for schema-backed unowned Types. Its installed descriptor bytes, effective property
validators and same-owner Read inventory come from that one authority. The older
schema-free administrative path remains available for newly provisioned stores.
Compiled Types must be Scope-local; a separately supplied descriptor inventory must
match the installed bytes exactly. JSON serialization retains property order and is
not a new canonical identity algorithm.

DevelopmentContracts exposes the immutable ingestion capture: exact artifact URI,
base64 bytes, byte length and digest, bounded artifact limits, and the current schema
compiler/evaluator ceiling witnesses. Its identity algorithm is unchanged. Private
format `bdp-private-transaction-contracts-8` records that capture in a separate
`contractCapture` metadata row at explicit creation. The existing configuration
holds the closure identity and fixed runtime property/diagnostic limits, keeping the
artifact payload out of Read configurationIdentity. The capture has a finite private
serialized byte bound derived from artifact ceilings (142,610,432 bytes); it is kept
for the whole installation lifetime without garbage collection.

Reopen compares configuration and exact capture under the existing locked owner
entry before pending retraction or maintenance. SQLite may first recover a hot
journal. Clean mismatches refuse byte-identically; no migration, automatic refresh
or reseeding occurs. Compiler constants are comparison witnesses, not persisted
controls that override the running build. Changed constants or runtime bounds fail
closed. Administrative configuration is still required to reopen; exact persisted
artifacts can reconstruct the same compiler object offline. The capture proves
artifact retention/reconstruction; the existing identity supplies changed-artifact
refusal.

The private HTTP fixture accepts bounded plain URI/UTF8 artifact data, requires an
explicit stable Scope and compiles inside its own module instance before owner use.
It derives Type inventory if the redundant types argument is omitted, preserving
strict agreement if both are supplied. Branded compiler objects never cross the
child-process or source/dist module boundary. Tests cover immutable capture,
inherited validation, unknown Types, deterministic retained diagnostics, late batch
and selected-set rollback, independent sequence prefix/tail commits, Type inventory
and Resource reads, exact saved-capture reconstruction, tampered metadata refusal,
actual process-loss restart and a real predecessor-format file refusal.

This remains a private all-visible installation with empty aggregate policy and
owned Types refused. Schema references are served in Type descriptors; schema-byte
GET/HEAD hosting is not implemented here. No HTTP set admission, new Type lifecycle,
Snapshot/changefeed, public configuration/profile admission or conformance claim is
added. Read+Update durable artifact retention remains a separate follow-up.


### Compiled-contract evidence and storage bounds clarification

The shared DevelopmentContracts capture retains base64 artifact bytes in memory for
all consumers, including Read+Update. Its installed reference factory also retains
UTF8 copies for schema hosting; this additional memory retention is real even before
RU gains durable artifact storage. This slice does not deduplicate those copies.

TX's fixture uses external synthetic schema URIs, but that is a fixture convention,
not a bridge constraint: a Scope-local propertiesSchema can be installed while no
TX schema GET/HEAD route serves it. Schema hosting remains explicitly unimplemented;
no new URI refusal or protocol rule is introduced here.

The separate capture row has its explicit byte cap. The configuration text still
embeds installed descriptor inventory with no additional TX serialization cap. The
compiled path is bounded by ingestion's aggregate 16MiB artifact-byte ceiling (and
separate URI limit), not 4096 independent 1MiB allowances; a multi-GiB compiled raw
inventory estimate would ignore that aggregate bound. Serialization/parsed inventory
may expand relative to raw bytes, and configurationIdentity still processes that
text in Read entries. The legacy schema-free descriptor input lacks those ingestion
bounds. The small fixture's configuration length is evidence about the fixture only,
not a general configuration byte budget.

A shared compiler regression now pins a literal identity observed from the actual
pre-capture compiler and checks deep capture immutability. TX regressions recreate a
rolled-back tentative Resource ID, replay the exact failed-set receipt, and compare
Type HEAD status/content length with GET. These strengthen evidence without changing
runtime behavior or broadening any profile claim.
