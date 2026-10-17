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
Event Source. The finite serving slice below projects them with the serving Bead
or Link's `?view=events` Source URL.
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
contract. These alias singletons add no HTTP alias routes, redirects, replica
alias projections or new profile claims; current alias read routing is described
under the private HTTP receiver and current alias minimums below.

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
Type inventory and fixed all-visible configuration (schema-free/unowned at this
initial slice; compiled and owned support is recorded below). Named
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
effects with a bodyless internal 500, labeled as a development gap. At this
increment, unsupported read-side minimum context controls likewise cannot yield
success or a conditional shortcut; their bodyless internal failure is explicitly
**not** a normative catch-up outcome. The historical command refusal is superseded
by the later operator-approved rule: mutation POSTs ignore copied read minimum
fields. Full read minimum-position/epoch/view/expiry ordering remains required
next work for this increment.
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

The historical refusal of minimum-context fields on commands is superseded by
the later operator-approved ignore rule: mutation POSTs ignore those copied read
fields; they add no command barrier or key-identity input. The original refusal
observations remain evidence of their frozen sources, not the current command
behavior. Operation routing accepts exact canonical target URLs. Unimplemented set/unknown targets, encoded alternate
spellings and query-bearing command URLs are not registered targets and return
404, rather than advertising a Read method table. Sequence depth failures use the
same development-composition marker as batch depth failures; the alias marker is
reserved for the actual Resource-alias sequence restriction.

The private receiving maximumOperations setting controls transaction.operations
only; sequence.operations retains its separate 32-member bound. Tests exercise
both limits together. This is explicit private configuration, not new discovery.

Runtime close aborts in-flight socket delivery, including connected clients, and
then drains accepted durable work. Clients recover outcomes by key replay after
reopen; “drain” does not promise completion of response delivery. Successful sequence
response context still comes from the post-runner owner observation. A fault in that entry
can lose delivery after member commits; replay recovers the original member
outcomes. Moving that observation into the final turn remains separate work.

HTTP internal faults are deliberately bodyless and disclose no causes or stored
identifiers. The owner/service preserve causes, but this private HTTP fixture has
not yet added a bounded internal diagnostic channel for those caught exceptions.
That diagnosability gap remains open; it is not a claim that causes reach clients.

### Canonical point, Type inventory, incident view and receipt minimum-read subset

The private HTTP fixture now honors complete canonical epoch/view/minimum tuples
on existing visible Bead and Link records, their properties views, initial current
Bead/Link collections, canonical in-Scope Type descriptors and initial Type inventories,
initial incident-Link views, current aliases, and receipt instances.
It validates immutable per-request controls before waiting. The shared Read plane
has a source-private fixed condition hook after captured authorization and
materialization, still inside the same owner entry and before cursor retention
or delivery; ordinary Read/Read+Update calls use no such condition. The
Transactional hook checks the actual same-entry source context. It does not read
a diagnostic position before or after the representation, retain a mutable global
condition, or create another Read plane per request. Initial collection request
control refusals retain `invalid-parameter` (400) and `limit-exceeded` (413) before a
minimum wait; valid representations still enforce the minimum before retention
and conditional handling. Collections, Type descriptors and incident views gain no ETag.

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
accepted finite waits. The HTTP Read perform route forwards its Request signal;
the runtime connects socket disconnects to that signal. Current point, Type inventory,
initial collection and incident-view waits stop at the next loop check after abort becomes observable.
Synchronous materialization and a current bounded sleep are not preempted; this
is not an instantaneous-cancellation or latency guarantee. Receipt waits still
drain their remaining finite budget; receipt and changes/events wait behavior
is unchanged by this Read-route forwarding. The later command-minimum amendment
supersedes the former command-control refusal: mutation POSTs ignore copied read
minimum fields while retaining ordinary syntax, authorization, key and revision
checks. Receipt and other read minimum handling remains separate.

This remains a named subset, not complete minimum-position qualification.
Compatible, already-satisfied minimums on absent/deleted canonical Bead/Link
records and properties, unknown canonical in-Scope Type points, and absent/deleted
incident anchors return the actual observed404 with same-entry current context.
Simultaneous missing/hidden and behind/foreign conditions retain the
private visibility gap; their arbitration remains unqualified. The ordinary
in-process Read facet now forwards only signal, ignoring generic sourceCondition;
only minimumFor honors a minimum. Corrupt owner context propagates as an integrity
failure (sanitized500 without a visibility marker), rather than being masked as
missing/minimum ambiguity. This fixed all-visible owner does not qualify changing
visibility policies. Source and HTTP tests cover the absent/deleted, Bead/Link,
record/properties, equal/earlier product, conditionals and no-poll collisions.
The separately reported installed compatible-missing scenario uses two owned-Link
batches and eight reads (10 exchanges, one child), including a final behind failure.
Per-step source revisions prove the owned deletion sequence; no earlier create
image is represented as the final owner image. Supporting source-bound evidence
and three source-mutant controls are recorded in the
[frozen implementation report](https://github.com/donnabox/beads/blob/30cdcf30f0488f9d400343a9141c5c314eb9f02e/docs/architecture/bdp-client-v2/transaction-compatible-missing-minimum-implementation-report.md).

The current Type/incident increment reuses the same owner entry, finite wait and
compatible observed404 callback. Canonical in-Scope Type points and initial Type
inventory/incident views are supported; ordinary external Type reads remain
unchanged. Unknown Types and absent/deleted incident anchors return compatible404
with actual context, while missing+behind/foreign cases retain the explicit gap.
The ordinary facet's descriptor-safe delivery-option boundary is preserved.
Source/HTTP tests and a separate installed20-request/one-child/seven-URL scenario
are recorded in the
[frozen implementation report](https://github.com/donnabox/beads/blob/d573ce1ca7501a97a394c6ff3061771ec97e73f7/docs/architecture/bdp-client-v2/transaction-current-type-incident-minimum-implementation-report.md).
This fixed all-visible evidence does not qualify hidden policy, retained minima,
Type lifecycle, discovery activation or a full profile.

Current alias reads use the existing same-entry locator observation and current
context, with the same finite wait and service lifetime as current Resource reads.
Alias dispatch remains outside canonical ReadRequest parsing and the current
Resource/collection predicate. Repointing an alias alone advances no Scope
position and revises neither target Bead; a minimum does not freeze a locator.
A wait retries the actual mapping and requires a real Resource effect to reach a
future position. Eligible GET/HEAD remain bodyless307 with canonical Location,
no Resource ETag and no conditional or JSON-negotiation shortcut. Ordinary and
minimum alias reads forward Request.signal; cancellation remains cooperative.
Compatible missing/deleted aliases and dangling targets reuse observed404/context;
incompatible missing remains the explicit visibility gap. Under this all-visible
owner the live-future503 and missing-future500 are distinguishable, unqualified
behavior, not a hidden-policy or absence-disclosure ruling. Unreadable targets are
not exercised. Source tests cover both unchanged target revisions; the separate
installed18-request/one-child/seven-URL scenario re-reads only the canonical second
target with its actual Resource ETag. Safe source/package/configuration evidence
is recorded separately in the workstream's alias minimum implementation report.
No public discovery, profile or complete minimum-position qualification follows.

External Type identities are outside the private minimum subset and are not
addressable Scope HTTP routes; ordinary private external-Type reads are unchanged.
Collection and incident-view continuations and discovery retain the
development gap when minimum controls are supplied. Partial/malformed tuples,
bare epoch/view fields and
unknown opaque position spellings also retain that gap; no normative error rule
is invented for them. In particular, whether a minimum constrains an old retained
query page's anchor or its current serving observation remains unresolved. Normal
continuations without controls retain their existing stable data/lifetime behavior.
No public profile/discovery, schema, durable format, Type or qualification claim
changes. Fresh Snapshot creation GET/HEAD now also accepts the complete canonical
minimum tuple. Both capture and nonallocating preflight check the actual owner
context before expiry/copy/allocation and reuse one finite wait with disconnect
cancellation. Preflight remains authoritative before conditional/media decisions;
for fresh Snapshot creation, HEAD,304,412,406 and every minimum refusal carry
actual current context.
Retained Snapshot manifest/page
minimum controls and malformed/partial forms remain explicit private gaps. Their
position interpretation is not decided by fresh creation support. Synchronous
copying and a pending bounded sleep are not instantaneously interruptible; no
public discovery/profile or complete Snapshot consistency qualification follows.

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

The initial set slice enforced a total 4,096 induced-Event bound across ordinary
members and set expansion, plus 4,096 matched Resources counted across set operations.
Those historical capacities are superseded by the measured budget below.
Repeat matches and semantic no-ops each count toward the latter, bounding expanded
result entries even when they emit no Events. Exceeding either yields an atomic
transaction-wide failed receipt with limit-exceeded and the corresponding
transaction.inducedEvents or transaction.matchedResources limit, without an operation
index. Evaluator-only test seams can lower but never raise these fixed private bounds;
those initial seams added no public configuration or advertised maximum. The current
installation identity also binds the actual tuple, as described below. Collection enumeration, visibility traversal and selection still examine and
materialize the full candidate population before the matched-resource check. This is
not a bound on whole-collection scan work, memory or receipt byte size.

Private format set-core-7 protects the expanded durable witness vocabulary; the
identity codec is unchanged. No migration or reseed is provided. Core tests cover
same-version recovery/replay and an external probe uses the actual prior paging
writer to establish byte-identical incompatible-format refusal. Paging crash-recovery
repairs are integrated: SQLite may recover a hot journal before the locked
configuration check, which still precedes BDP cleanup and retention.

At this historical set-core slice the installation was all-visible, schema-free
and unowned; compiled and owned successors below supersede those restrictions.
Installed contract/policy composition and owned-source fanout were then open. Full
set HTTP admission, remaining consistency routes, replication and truthful
Transactional discovery remain separately tracked.
Recovery regressions kill a process inside maintenance and terminal execution,
not merely after a response. Sixty committed three-result receipts and their page
URLs survive hot-journal rollback; the terminal crash's pending admission is
retracted without exposing its uncommitted effects. The terminal fixture reduces
the real SQLite cache to force dirty-page spill; maintenance uses the ordinary
cache. These are process-crash witnesses, not physical disk/power-loss testing.
Concurrent page minimum waits also drain on close while an admitted commit can
satisfy them. Unsupported root/page controls withhold serving context and do not
trigger retention; independent maintenance can still expire or forget receipts.


### Nonexistent receipt page retention and recovery follow-up

A missing page plan checks parent disclosure and completed status without applying
retention. Nonexistent pages of failed receipts return 404 for owner/foreign
principals, with or without unsupported or behind minimum controls, and leave the
receipt row unchanged. Actual independently scheduled maintenance may still forget
an eligible failed receipt. Page namespace validation checks the parsed parent
before the plan lookup. Service prefix checks remain defense in depth; the store
constructs those prefixes, while the bounds checks independently validate results.

The actual hot-journal terminal-crash regression copies the database and hot journal
before attempting an incompatible page bound at an expiry-eligible clock on the copy.
The refused open must consume the copy's journal through SQLite recovery, while the
original journal remains hot for an independent valid-open witness. Both branches
then reopen compatibly: each recovers the pending row and all 60 receipt chains remain
available. The copied branch proves installation refusal precedes BDP pending cleanup
and retention; the original branch directly proves valid-open crash recovery. This is
process-crash evidence, not power-loss durability.

### Bounded set-core review repairs

Set deletion accepts the bundle's revisionProvenance input for either collection.
Syntax validation reuses the existing deleteLink root, which admits that same input;
its synthetic Link subject never reaches identity or evaluation. Deletion mints no
version for either collection supported at this historical slice (Beads and
unowned Links), so supplied provenance was inert in both. The owned successor
below mints a source Bead version on owned-Link deletion and carries its attribution.
Tests cross operation, collection, cardinality and provenance inputs against the canonical
bundle, then execute all four operation/collection pairs against the real owner and
inspect results and afterstate.

Set candidates now use the shared isResourceVisible closure before selection and
cardinality, including local endpoint visibility. Evaluator probes run the real owner
with a narrowed per-turn policy to prove hidden-endpoint Links are not matched or
mutated. This is not an installed variable-policy qualification: the actual owner
was all-visible, schema-free and unowned at this slice. The owned successor below
adds owned-source fanout and nonwritable-match evidence; the installed policy remains
all-visible. Negative Selector wire admission remains closed. Operation-local failures require an operation index at the type boundary;
only the currently implemented transaction-wide Event and match limits can omit it.

### Private compiled-contract installation and retention

The Transactional owner can now accept the existing branded DevelopmentContracts
for schema-backed Types (unowned at this installation slice; owned support follows
below). Its installed descriptor bytes, effective property validators and same-owner Read inventory come from that one authority. The older
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

This installation slice initially refused owned Types; the owned successor below
removes that restriction. The installation remains private and all-visible with
empty aggregate policy. Schema references are served in Type descriptors;
schema-byte GET/HEAD hosting is not implemented here. No HTTP set admission, new Type lifecycle,
Snapshot/changefeed, public configuration/profile admission or conformance claim is
added. Read+Update durable artifact retention remains a separate follow-up.

### Set guard, receipt failure shape and materialization bounds

Cardinality is checked before charging the matched-Resource budget. A failed guard
retains its operation-local 409 with after-state-change retry, including when the
same selection exceeds the private match cap. Passing the guard still subjects the
request to that cap. Tests prove rollback, retained replay across reopen, the cap
refusal when the guard permits the selection, and fresh-key success after shrinking
the live collection. Compiler probes require type, status and typed retry on both
failure branches, including the receipt-specific code and status subsets. The local
evaluator boundary refuses missing required fields and out-of-subset codes/statuses
as integrity failures rather than retaining invalid receipts. Tests prove immediate
same-key reuse without reopening, followed separately by durable valid-failure
replay. These checks narrow required fields; existing evaluator validation still
owns code/status/retry combinations and optional diagnostic semantics. Valid
Problems keep their existing fields and values.

The earlier suite observed its then-current 4,096-match default without lowering it: 128 Beads
matched by 32 no-op sets produce 4,128 flat result entries and no graph effects. A
129th Bead causes atomic refusal; both dispositions replay after reopen. This is a
count bound, not a receipt-byte, candidate-scan or authority-lock-duration bound.

The original materialization gap led to the measured budget below. A disposable
emitted-owner probe built one 262,144-byte Resource through real mutations, each
request at most 60,138 bytes, by growing metadata across requests. Its 32 repeated
no-op matches produced an 8,392,367-byte receipt and replayed after reopen. At 4,096
matches, just those maximum-sized Resource postimages total 1,073,741,824 bytes,
before result/envelope overhead. That figure is an arithmetic projection, not an
attempt to allocate or persist a GiB receipt. On the pinned Node 24.16.0 runtime,
V8's 536,870,888-code-unit string ceiling is lower than SQLite's 1,000,000,000-byte
limit. For the measured ASCII payload family, 2,048 maximum-sized postimages alone
already exceed V8's ceiling, before receipt overhead. This is a size projection,
not an attempted allocation failure. Those earlier count and request bounds did not
guarantee materializability: full receipt JSON is still built, stored and reparsed
despite paged serving. No byte condition is relabeled as
transaction.matchedResources or transaction.mutatedResources; those remain counts.
That slice left the fixed cap at 4,096; the later measured budget replaces it.

Deferred limitations: candidate enumeration still scans the entire collection and
repeats local-endpoint visibility reads without a projection cache. The shared
visibility predicate does not supply Read's checkedGraph body/index integrity
validation for corrupted rows. This slice changes neither behavior and makes no
whole-projection equivalence or installed profile qualification claim.

The induced-Event lower-only evaluator seam rejects zero, negative, fractional,
infinite and above-authority bounds in permanent tests. The owned-transition tests
below originally observed its then-current 4,096 default with small Resource bodies;
this count evidence does not qualify arbitrary materialization workloads.


### Compiled-contract evidence and storage bounds clarification

The shared DevelopmentContracts capture retains base64 artifact bytes in memory for
all consumers, including Read+Update. Its installed reference factory also retains
UTF8 copies for schema hosting; this additional memory retention is real even before
RU gains durable artifact storage. This slice does not deduplicate those copies.

TX's fixture uses external synthetic schema URIs, but that is a fixture convention,
not a bridge constraint: a Scope-local propertiesSchema can be installed while no
TX schema GET/HEAD route served it at this historical checkpoint. The later local
schema-serving slice below supersedes that gap for its exact retrieval-identity
subset; it adds no installation URI refusal or protocol rule.

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
pre-capture compiler and checks deep capture immutability after mutating both schema
and descriptor input buffers. That identity binds the fixture artifacts and artifact,
graph and evaluator ceilings; intentional input changes need a justified replacement
witness rather than a pasted hash. TX regressions recreate a rolled-back tentative
Resource ID, compare complete failed-batch and failed-set receipts on replay, compare
Type HEAD status/content length with GET, require exact Type inventory summaries
from the installed descriptors, and follow both IDs to compare the full documents.
Inventory items remain the normative id/name/describes summaries. These strengthen evidence without
changing runtime behavior or broadening any profile claim.

### Atomic owned-Link projection

The private Transactional owner now accepts installed owning Bead descriptors and
projects the existing Resource evaluator's owned transitions. The evaluator remains
the sole source of ownership rules, schema checks, revisions and provenance. A local
same-turn write wrapper captures each Resource's previous state before forwarding
the evaluator's write. It neither exposes version recipes nor adds another allocator
or owner. An owned mutation changes at most its Link and source Bead; an ordinary
target does not version, and a self-Link still versions the source once.

Every evaluator changed/deleted Resource contributes a canonical-ID group entry.
Repeated operations preserve intermediate receipt results and Event revision chains,
while the group's changes retain only each Resource's final postimage or tombstone.
The source's complete inline owned state agrees with the first-class Link. No-op
updates preserve both revisions/provenance and report the unchanged sourceRevision
without a group or effect position.

Owned facts use existing Event types: Link lifecycle first, source/target incidence
when creating/deleting, and the source's ownedLink updated fact last. An in-Scope
owned creation/deletion induces four Events, including both self-Link incidences;
an owned update induces two. The source Event carries its own revisions/provenance,
with a complete created Link, field-built update delta, or deleted identity nested
under ownedLink. The update delta never carries full properties and contains a patch;
the source fact never combines ownedLink with a direct properties/metadata patch.
All facts charge the total Event cap. The original default-bound test deleted
1,024 owned self-Links on separate sources: 4,096 ordered Events succeed; a selection
of 1,025 fails atomically and retains that failure across restart. Resource bodies
are small in this count test; it supplies no high-fanout or byte-size qualification.
That owned-transition slice changed no count or materialization budget; current
boundary tests use the measured limits described below.

The same application path serves the private staged-set evaluator. Selected Links
remain canonical-ID ordered, each effective member versions its source, and the
existing visibility-closure predicate and cardinality-before-cap behavior remain.
Source write refusal, stale Link/Bead guards, schema failures, ownership bounds and
late failures roll back both Resources and all group/page effects while preserving
an ordinary failed receipt. Real SIGKILL probes at staged effects and terminal
receipt boundaries reopen without either partial Resource or group effects. Tests
also cover exact durable pages/replay, transitive cyclic visibility, compiled actual
HTTP Reads/mutations and inherited-schema failure replay. This is process-loss test
evidence, not a power-loss or mutable-policy qualification.

The installation format and semantic identity stay unchanged: no durable record
shape changed, old accepted stores contained no owning descriptors, and descriptor
configuration changes already fail closed. Owning compiled bundles must still
include the complete Link/endpoint descriptor closure; the legacy schema-free path
continues to use the existing evaluator registry fallback. No new Type lifecycle,
HTTP set admission, Snapshot/changefeed, schema hosting, public profile or evidence
claim follows. The actual service still has fixed all-visible policy and empty
aggregate policy. Retained variable-grant projection, mutated-Resource accounting
and receipt/group byte materialization remain separate work.

### Owned transition evidence follow-up

Native agent/message inputs are now exercised through owned creation, update,
singleton deletion and deleteWhere. Creation/update assertions compare exact
committedAt-bearing source and Link provenance with both Event levels. Deletion
assertions compare the newly minted source's attribution while keeping the deleted
Link identity delta free of provenance. A mixed no-op/effectful updateWhere is
followed by a staged second set and an explicit owned update in the same batch;
receipt entries pin every member's sourceRevision, including the unchanged no-op,
and the Event chain pins the corresponding intermediate source versions.

These tests add evidence without changing evaluator, writer, budgets or serving.
The earlier 4,096-Event observation is retained as a dated historical record;
the subsequent boundary test used the measured 256-Event tuple. It is not evidence
that the current source still exercises the historical 4,096 limit. Reducing repeated Resource parsing in
the owned writer is deferred while separate materialization measurements proceed.

## Private finite Event serving

The same authority owner now serves finite Scope, Link and Bead Event pages.
The owner reads committed groups one at a time in one synchronous entry and
captures the current Scope context there. No live SQLite iterator escapes that
entry. Event data and ordinals are unchanged; each Source receives stable opaque
IDs bound to epoch, Authorization View, source URL, committed position and ordinal.
The Scope projection uses the same rendering helper intended for the future
changefeed. Raw storage Event IDs are not serving IDs.

Link views contain lifecycle facts. Bead views contain their own lifecycle facts,
endpoint-specific incidence facts, and incident Link property updates. Endpoint
lookup uses only that group's final Link postimages, creation facts and incidence
facts. Update then delete, and create then update then delete, remain projectable
after restart without consulting current Links or retaining preimage bodies.
The metadata-only incident Link case remains a named private development gap
pending the specification disposition; Scope and Link views support that fact.

Finite pages may split groups. They preserve ordinals, bound the complete encoded
page to 4 MiB, and return an exclusive continuation after the last returned Event.
The current M32/E256 materialization tuple bounds one encoded group to 169345024
bytes; the later table preserves earlier rejected or superseded tuples. SQLite's `length(CAST(body AS BLOB))` is checked before selecting and parsing
that row's body. This is a byte bound, not a general heap-safety claim. With the
same R/Q bounds, one largest owned update plus Resource-source URL substitution,
page envelope and continuation is bounded by `5R + 7Q + 8192 + 1024 = 1778688`
bytes, below 4 MiB. No valid admitted first Event needs a new response-size refusal.
A page scan remains synchronous and may visit many retained groups; neither total
history length nor interruption inside a synchronous scan is newly bounded.
Cursor context tags are not authentication or proof of prior issuance: a matching
context must also identify a retained Event in that Source. Malformed and
never-member cursors return `invalid-parameter` as a local reference convention.
A known Resource identity remains an Event Source after deletion; an unknown
source returns nondisclosing 404 before minimum checks, also a local reference
ordering choice. Unknown receipt pages likewise keep their local context-free404
convention under arbitrary controls. Neither convention establishes global
missing/minimum precedence: canonical current Resource/properties reads return
observed404 with context only when the supplied minimum is compatible and already
satisfied; missing+behind/foreign remains a private gap. Receipt detail expiry does
not prune Events.

HTTP authentication and Origin/Host/raw-target checks precede Event access. The
existing finite minimum wait releases the owner entry between attempts, reports
catch-up timeout rather than older success, and completes before conditional
processing. Successful GET/HEAD carry the current context, no validators, and
normal JSON negotiation and HEAD body suppression. Service facet AbortSignal
cancellation is supported; disconnected HTTP sockets may drain the bounded wait
budget rather than cancel immediately. The private fixed all-visible/no-pruning
composition does not implement SSE, mutable views, erasure, Snapshot or changefeed
serving, and does not advertise a public Transactional profile.

### Measured private transaction materialization budget

This initial measurement used one frozen, installation-bound tuple: 64 cumulative set
matches, 256 induced Events, 32 explicit operations, 65536 request/property bytes,
262144 complete Resource bytes, and 65536 encoded bytes for the Scope Event-source
URI. No public profile or capacity advertisement changes. TX evaluator options
require the properties and representation bounds; the actual owner passes that
same tuple. Generic Read+Update evaluator optionality is unchanged.

A missing/different persisted tuple refuses the existing installation before BDP
maintenance, preserving SQLite hot-journal recovery ordering. Older 4096-count
receipts and tests are historical evidence, not current-capacity claims or silently
reinterpreted stores. At that checkpoint tests exercised 64/65 matches and 256/257 Events,
including no-ops, rollback, retained refusal, conflict, fresh-key success and reopen.

For R=262144, Q=S=65536, normalized combined patch bound N=7Q, A=8192, H=1048576,
K=M+32, the closed owned Event shapes give:

- Group <= min(E*(2.5R+N+S)+K*A+H, K*(max(9R+4S,5R+2N+2S)+A)+H).
- Receipt <= K*(2R+Q+A)+32*128+S+H.

| Private matches / Events | Group byte bound | Receipt byte bound |
| --- | ---: | ---: |
| 256 / 256 (rejected after measurement) | 305397760 | 173346816 |
| 128 / 256 (insufficient measured headroom) | 304349184 | 96800768 |
| 64 / 256 (superseded after stronger stress) | 253493248 | 58527744 |

The proof includes both copies of the **combined** property/metadata patch in owned
updates, separate source/Link provenance, at most two Resource effects, and no
preimage bodies. Exact Event, result and upsert-wrapper assertions preserve those premises.
The receipt's separate S term pays its first Scope-bearing URI; H explicitly also
pays the second Scope occurrence in `next`, fixed receipt/page suffixes and the
bounded failed-receipt envelope (diagnostics <=524288, name <=Q). Those allowances
must be rechecked together if the fields or ceilings change. Scope and
complete-Resource limits are actual owner checks, not assumptions about typical
URLs or schemas. Alias/no-op results still consume result space without Events.

Bounded emitted-owner stress used normal sub-limit requests, exact Resource limits,
receipt/page reads, exact-key retries, point afterstate and durable reopen; it never
called inspect(). A post-close read-only scalar query measured only the selected
group's stored byte length. The predeclared abort bounds were 120 seconds and 1 GiB
RSS per disposable child. At 256 matches the 67,124,671-byte no-op receipt completed,
but replay exceeded the RSS ceiling and was killed: replay qualification was
inconclusive. At 128 matches no-op work passed at 802800 KiB child high-water RSS;
128 owned updates/256 Events passed at 975216 KiB, too close to the ceiling.

At that 64-match tuple, repeated no-ops produced a 16,782,715-byte receipt,
with 480000 KiB high-water RSS through replay/pages/reopen. Dense transient numeric
patches on 64 owned Links with full-size source Beads produced 128 Events and a
45,059,033-byte group, with 557584 KiB high-water RSS. That case measured 128 Events;
under that superseded 64-match tuple, the then-current boundary test exercised all
256 Events using 64 owned deletes.
These finite workloads do not prove general heap safety. Candidate selection still
materializes the complete collection before count checks; C*R scan memory, dense
object overhead, unbounded trusted principal/other SQLite-row fields, accumulated
history and multi-group reads remain separate limits of this result.


### Stronger owned materialization measurement and 32-match tuple

The current private tuple lowers cumulative set matches to **32**, retaining 256
Events, 32 explicit operations and the existing byte/diagnostic ceilings. Its
installation identity changes; existing 64-match private stores must be explicitly
reprovisioned and are not silently reopened or relabeled. There is no new public
capacity or profile claim. With K=64 the same formulas give a 169,345,024-byte group
bound and 39,391,232-byte receipt bound. These are serialized bounds, not heap bounds.

The stronger emitted-owner measurement grows each owned Link first, then fills its
source's residual metadata. Sources are exactly 262,144 bytes; Links are
261,849–261,850 bytes. Only the exact empty source metadata wrapper is reserved
before growing the Link. Both cannot independently reach R because the source embeds
the complete Link. The entire 65,536-byte request is a batch envelope plus patch
(no outside padding): 13,061 numeric values normalize to a combined 287,461-byte
patch. The transient array is removed before final properties validation.

At 64 matches an initial variant reserving 1 KiB of source metadata produced a 70,350,401-byte group and a 16,705,001-byte receipt.
Execution, replay and the first finite Link Event page completed, but verification
after reopen exceeded the 1 GiB supervisor gate (1,072,128 KiB sampled) and was
killed after 8.349s. Its final verification is **inconclusive**. The last child
self-reported high-water was 958,528 KiB before termination; it is not the peak.
The earlier smaller-Link/50KB-patch run did not establish headroom for this
achievable workload.

The actual 32-match tuple completed the tighter case in 4.161s: 35,207,784-byte
group, 8,385,225-byte receipt, 562,976 KiB child self-reported maxRSS and 540,304 KiB
supervisor sampled peak. It verified exact-key replay, receipt pages, finite Link
Event payloads and all corresponding observations after reopen. Repeated no-ops
also completed through replay/pages/reopen. All runs used disposable stores and
the same predeclared 120s/1 GiB gate; no inspect() was used. Scalar group-byte
measurement happened after owner close. The successful workload is not a universal
worst-case heap guarantee: collection scans, accumulated history and other graph
shapes remain unqualified.

All four evaluator bound fields now reject missing/invalid/raised values before
effects. TX tests pin closed create/update/delete results and upsert wrappers,
and permanently exercise extremal admitted numeric normalization through stored
Events. Current default match tests observe 32/33. The 32-owned-delete test observes
128/129 Events using a deliberately lowered evaluator Event cap; 256 remains the
owner cap, validated as a configured bound; its default refusal is not observed
by this lowered-cap fixture. The earlier 256/257 and 4,096 observations are historical, not
relabelled as current default-boundary tests. E>=4M is a usability relationship,
not a premise needed for the serialized bound.

### Private finite whole-group changefeed

The private changes/ GET/HEAD route now serves one complete committed group per
page from the same locked owner as mutations and finite Events. It reuses the
Scope Event renderer, so facts and IDs agree across those two observation paths.
An owner-internal bounded row helper prepares its two statements once per observation
and checks encoded group length before selecting
and parsing it; no inspect/all-history array or independent log is used. Body,
observedHeadPosition and response context come from one owner entry.

Requests provide exactly one after checkpoint or start=now. The reserved genesis
checkpoint is distinct from the pos-0 position. New group checkpoints bind Scope,
epoch and view; stored group records and position spelling remain unchanged. A
start=now request captures its initial head once before any finite minimum wait,
so intervening commits remain in its suffix. Continuations are absolute URLs and
never split a group. Existing failed/no-op/locator-only changes create no group.
Finite JSON ignores Last-Event-ID; it neither supplies nor overrides start intent.
SSE-only negotiation remains406, and public discovery/profile admission stays closed.

The current installation-bound32-match/256-Event tuple yields a169,345,024-byte
stored group bound. Conservatively adding all rewritten Scope-source/ID bytes and
the page/HTTP envelope gives186,334,744 encoded bytes, below pinned Node24's
536,870,888 UTF-16 code-unit string ceiling. This arithmetic allocates no giant
proof string and does not establish heap/RSS or concurrent request capacity. The
private one-group page bound is not a Resource/receipt page.maximumItems claim.

Tests reconstruct the graph from genesis with a replica oracle that stages final
postimages/tombstones and publishes graph plus checkpoint atomically. The oracle
rejects owned inline/first-class disagreement, gaps, context mismatch and conflicting
duplicates without partial publication; it compares positions only for equality.
Other evidence covers original intermediate facts versus final postimages,128
Events from32 selected owned Links in one group, large postimages/Scope sources, actual HTTP minimum and
conditional/HEAD behavior, restart-stable IDs and owner fencing. This is no Snapshot
bootstrap, erasure, pruning/late-cursor, hidden-view or SSE qualification. Remaining
unsupported minimum forms stay explicit development gaps. Cold discovery changes,
headPosition/minimumReplayPosition and cumulative installed Transactional evidence
remain separate completion work.


### Mixed explicit/set workload and reproducible emitted-tuple witnesses

A further bounded run exercised 31 explicit owned Link updates plus one set update
matching 32 other Links: 32 carrier operations, 63 affected owned pairs and 64
receipt entries including the set summary. These are the reachable explicit-plus-set
units absent from the earlier set-only measurement. All 63 source Beads were exactly
262,144 bytes, and Links were 261,849–261,850 bytes. The single 65,536-byte carrier
included 3,287 bytes of explicit operation-array serialization; its remaining set
payload contained 12,403 numbers, normalizing to a 272,985-byte combined patch.
The measurement does not allocate a full Q patch to each explicit operation.

The mixed run completed execution, exact-key retry, receipt-page and finite Link
Event reads, and the corresponding checks after reopen in 8.073 seconds. The group
was 50,568,556 bytes and receipt 16,507,992 bytes. Child self-reported maxRSS was
886,912 KiB; supervisor sampled peak was 832,480 KiB against the predeclared
1,048,576 KiB/120-second gate. This is substantially less margin than the set-only
case, not a universal heap-safety or comfortable-all-workloads claim. The tuple
remains M32/E256; no further count change was made from this measurement. The measured
serialized group is about 30% of the admitted 169,345,024-byte bound; reachability
of that conservative bound and its heap cost are not established. The supervisor
gates the sampled RSS metric, which can miss peaks; the separately reported child
high-water metric is higher and was not the gate's enforcement input.

These runs used emitted production bytes from source `d907a1e1576c5795c17edb5f15528f47edfd7d6b`
with the three reported test/prose working changes, and emitted tree digest
`73b5a9866729b2254c23d47995ab50c7cb301a27dde923d35c6d31d36236ce1a`.
[Exact scripts, outputs and provenance](https://github.com/donnabox/beads/tree/3d393dbf772dfd8b759bfaa455e04be950c1f976/docs/architecture/bdp-client-v2/transaction-materialization-closure)
retain the source status rather than claiming a pristine committed source run.

Fresh repeats on the same actual emitted tuple completed the 32-match set-only
case (551,504 KiB self / 523,040 KiB sampled) and 32 repeated no-op matches
(288,544 KiB self / 261,840 KiB sampled). Each new script imports and asserts the
emitted tuple and logs all its fields, source commit/status, relevant source hashes,
emitted server/protocol JS/JSON file hashes and tree digest, and script/helper hashes.
A separate old-M64/new-M32 probe records both actual tuples, verifies refusal leaves
database bytes unchanged, and reopens/replays the receipt under the old owner.
It makes no stronger claim about an unobserved internal maintenance execution path.

Each new named variant and its exact script remain beside its output; the supervisor
refuses to overwrite an existing run log. Earlier intermediate variants retained
outputs but overwrote script versions. Those historical scripts cannot be recovered
by asserting their contents now; that reproducibility limitation remains. New runs
provide independent evidence rather than retroactively repairing their provenance.

The permanent owned-update assertion now checks the exact two-entry changes array
against independently read Link and source records. All four extremal numeric
normalization cases pin exact serialized literals as well as the factor-seven bound.
These changes strengthen observations only; no store, runtime or Event implementation
changed in this follow-up. The default E256 refusal is still not directly observed;
actual refusal tests use the lowered evaluator cap described above.

## Private changefeed SSE (G2a)

The changefeed route now selects finite JSON or `text/event-stream` using the
shared HTTP media parser. JSON remains the default and wins equal-quality ties.
Routing, authentication and same-owner cursor/minimum observations precede
negotiation refusal and conditional shortcuts. Scope and Resource **Event
Sources** still refuse SSE-only negotiation with 406; this section supersedes
only the earlier finite-changefeed SSE limitation.

Every change-group frame uses the same `stringifyJsonValue` serialization as
finite JSON, with its checkpoint in `id`, `event: change-group`, and a complete
JSON group in `data`. A `1.0e2` request literal produces the same admitted numeric
value 100 in both representations; lexical spelling is not retained. The existing
finite envelope bound 186,334,744 plus 512 framing bytes remains below the pinned
Node 24 string ceiling. This is arithmetic over the installed M32/E256 limits,
not a large-allocation or RSS measurement and not a new post-commit refusal.

The URL must still supply exactly `after` or `start=now`. Selected SSE with an
explicit `after` or `start=now` uses a single `Last-Event-ID` as its effective
checkpoint, including `genesis`; owner validation sees that effective checkpoint
only.
Finite JSON ignores the header, including malformed/repeated values. A
header-only request remains 400. Reconnecting the same `start=now` URL resumes
exclusively after the saved header checkpoint. Headerless initial `start=now` is
captured once through any minimum wait.

A source-private service registry owns cancellable stream lifetimes separately
from finite accepted work. The private installed defaults are one live stream,
100 ms polling and 5 s heartbeat comments. They join the runtime configuration hash.
One complete frame is written at a time; `write(false)` stops further owner reads
and comments until drain, close, abort or error. Accepting bytes into Node is not
a durable replica acknowledgement. Client disconnect releases the stream slot;
shutdown cancels streams, drains accepted finite work, then closes the owner.
HEAD/304/412 perform the same initial decisions without registering a stream.
Post-header failure closes the transport rather than appending another HTTP
response or inventing an error Event.

The existing Node disconnect bridge is shared privately with this runtime.
Changes/Events minimum waits now receive actual disconnect cancellation. Point
and receipt waiting behavior is unchanged by this slice. All four transport
settings remain requestTimeout 10000, headersTimeout 10000, socket timeout 10000 and
keepAliveTimeout 1000 ms. A closed, own-data **test-only** transport seam permits
bounded lifecycle observations and suppresses configuration attestation; it is
not an installed launch option.

`transaction-sse.test.ts` covers actual replay/live/no-op/reconnect traffic,
minimum anchoring, effective-cursor errors, conditional/HEAD/capacity behavior,
a real raw response truncated before frame completion, finite minimum disconnect,
and post-header owner failure. Its shared replica oracle stages owned-Link/source
agreement and checkpoint publication atomically, including failed publication
and duplicate replay. Synthetic sink tests distinguish stalled transport from
SQLite work and verify one pending frame with no queued heartbeat/read-ahead.

`transactional-sse-installed.test.ts` launches the actual selected installed
module, validates fresh configuration binding, and uses a separate bounded raw
socket recorder. Its 25 s observation/45 s cohort/10 s cleanup budgets are independent
of the unchanged finite 5 s executor. It observes at least 15 seconds of continuous
idle service, comments without IDs, then a later actual mutation. The report
retains source/payload/configuration identity, exact response bytes/hash, complete
frame boundaries, Node version and observed timing. Preliminary dirty-source
runs and final clean tarball evidence remain distinct in the external report.
This deliberately cut live observation is not labeled a completed finite reply.

Event Source SSE, mutable-view/erasure fencing, set HTTP admission, remaining
required consistency/discovery work and full profile qualification remain open.
No public export, schema, catalog credit, profile advertisement or historical
Read evidence label changes in G2a. `claimEligible` remains false.


### G2a review closure

The private pump rejects invalid Node timer values. Default heartbeat cadence must
be strictly below the socket idle timeout; this is an ordering invariant, not a
factor-of-two policy. Short transport seams used for finite deadline tests remain
unattestable and refuse a selected live stream before headers or slot acquisition.
Their finite and HEAD behavior is preserved, and installed timers remain unchanged.

The runtime retains only its first unexpected post-header stream failure and
includes that original cause in close-time error aggregation. Capture happens
before destroying the response can turn the failure into disconnect cancellation.
Ordinary disconnect, pre-aborted registration and service cancellation remain
clean shutdown paths. No error Event or second HTTP status is introduced.

The raw SSE recorder now belongs to server test support and is imported by the app
through the existing source-only testing entry. Finite/SSE comparisons additionally
check each data payload against raw finite response text, without JSON reserialization
as the byte oracle. Numeric-like property names are included in the source witness.

A Scope changefeed reconnect on a `start=now` URL now resumes exclusively after
the checkpoint carried in `Last-Event-ID`, under the approved precedence rule.
This makes no browser interoperability claim; a client must still use its
durable applied checkpoint rather than unapplied transport progress.


The final G2a cancellation guard also distinguishes a response already destroyed
from a still-live response before the queued Node close notification aborts the
stream signal. A deterministic real-response/microtask witness reproduced the
false shutdown failure before the guard; genuine owner failures remain retained.
Capture validates effective pump timer values before serving while preserving
finite-only short transport seams and their live-stream refusal.

The raw source serialization witness explicitly pins one group in each finite
page before matching frame indices. Numeric-like key sensitivity belongs to that
source witness; the installed witness checks raw byte containment with its simpler
numeric property fixture. Its observer imports source-only server test support,
while the target remains a separate process loading the exact installed payload.

## Private Event Source SSE owner scan (G2b, owner checkpoint)

The owner now offers source-private immutable scan continuations. Each observation
projects at most one committed group and carries source/context plus the next
exclusive ordinal in an owner-local WeakMap. Caught-up observations do not construct
a group reader. No iterator, parsed group or SQLite transaction escapes, and no
durable format, public cursor or Event membership rule changes.

Finite reads retain their exact envelope/continuation byte reservation and
lookahead. The bounded stream packet conservatively reuses that charge. Known-source
parameter errors can carry the same owner entry's context; early query validation
and unknown-source nondisclosure remain distinct. HTTP serving and the shared pump
are subsequent G2b steps; this checkpoint does not enable Event Source SSE.

## Private Event Source SSE serving (G2b)

The subsequent serving slice connects Scope `events/` and retained Bead/Link
`?view=events` Sources to the same cancellable pump and one-live-stream capacity
as G2a. Finite JSON keeps its original collector, membership, byte reservation,
lookahead and `next` behavior. Live delivery uses only the current opaque scan
successor, adopting it after the packet's last drained frame. The HTTP result
releases its initial packet after transferring it to the pump. The WeakMap retains
no enumerable token inventory, parsed group, iterator or transaction.

Each owner observation examines at most one group. A packet that fills in the
middle of a group retains its exclusive last included ordinal; later facts in
that group are not skipped. Sparse Sources traverse unrelated groups once per
live scan. Caught-up idle polling prepares no group reader and performs no group
body GET. Constant metadata/identity reads and preparations for a newly inspected
group remain. Multiple packets may reparse the same large group; these are bounded
packet/group limits, not universal latency or heap promises. Append-only history
is assumed; already traversed rows are not periodically revalidated for arbitrary
out-of-owner modifications.

Heartbeat checks remain active during empty historical backlog as well as idle
polling. Every frame and comment shares one write/drain barrier. A blocked write
prevents another owner pull or queued heartbeat while leaving the SQLite owner
available for finite mutations. Event frames use the existing lossless JSON
serializer; the conservative frame bound is 4 MiB plus 512 bytes, below the pinned
Node string ceiling. The actual group-step/packet settings enter the private
runtime configuration digest; all four existing transport/stream timers are
unchanged.

SSE reconnect accepts one `Last-Event-ID` in place of `after`, including when the
query omits `after`; JSON ignores that header. Existing query grammar is still
validated. Known-source cursor errors and stream-capacity refusals preserve the
original captured entry's context, including when another commit occurs before
HTTP projection. Authentication, unknown Source and early query errors do not
acquire such context. HEAD/304/412 validate the observation but allocate no stream
slot. Deleted Resources remain retained Event Sources while canonical GET is404.

Positive finite/SSE equivalence is restricted to gap-free histories. A metadata-only
incident-Link update still refuses a Bead Source; Scope and Link projections remain
available. A live encounter closes the socket without a second response or error
Event and retains the first genuine cause for close-time reporting. Reconnect from
the same last complete Event deterministically encounters the same unresolved
group. This slice does not silently skip that history or settle its membership.

The private installed witness records actual packed Scope/Bead/Link responses and
raw finite-byte comparisons. A sparse Bead Source with unrelated historical groups
stays live for at least15 seconds under default timers, emits comments without IDs,
and then delivers a relevant mutation. Its recorder25s/cohort45s/cleanup10s bounds
remain separate from finite5s requests. Dirty preliminary runs are distinct from
final source-bound tarball evidence. The source tests additionally cover self-Link
ordinals across count/byte boundaries, exact sparse body-read counts, backpressure,
minimum cancellation, half-frame reconnect, captured error contexts and faults.

No public export, profile advertisement, schema/catalog credit or sealed Read
evidence changes. Fixed owner epoch/view cannot perform mutable grant transitions;
foreign/stale cursor and corruption tests do not qualify such transitions. Erasure
publication fences, set HTTP admission, remaining consistency/discovery obligations
and complete Transactional qualification remain open. `claimEligible` remains false.

### G2b review closure

The captured one-group Event scan constant is now a structural owner invariant:
a value other than one refuses module initialization, instead of hashing a bound
the one-group algorithm does not implement. The sparse owner witness derives
per-entry body-read and total observation counts from that shared constant.
`eventStream` contains owner scan/packet bounds only; Event and changefeed pumps
share `changefeedStream` cadence and live-slot capacity. A deterministic runtime
interception verifies the Event adapter receives the captured cadence object,
without treating elapsed timer observations as a settings-binding proof.

The both-valid cursor GET witness uses a later committed marker Event to bound
observation. A later header cursor suppresses the earlier query suffix; the mirror
case delivers that suffix. This pins delivered frames in both precedence directions.

Packet lifetime evidence is structural, not a GC or universal heap claim. The
owner WeakMap value contains source/context/position/ordinal/head and no group
body. The resolved initial HTTP result transfers its packet to the pump and the
runtime clears `selected`; the thin adapter returns the pump Promise without
retaining the input across an await. The pump clears its initial parameter and
clears each delivered packet before the next heartbeat/poll/pull, retaining only
its continuation and a prospective successor during advancement. Stream closures
retain the service and signal, not a registry of prior packets. No WeakRef/forced-GC
claim or engine-specific release deadline is inferred from those reference chains.

## S2a: private valid set singleton and batch HTTP

The normal private batch and singleton preparation now share the existing valid
set evaluator. Both `update-where` and `delete-where` are actual canonical POST
targets; the private installed target binding requires exactly twelve targets.
Read+Update and sequence grammar are unchanged. Public discovery, profile
admission, conformance receipt authority and catalog credit remain closed.

Unsupported Selector grammar/features or private Selector complexity remain
explicit development gaps pending the existing Q1/Q2 rulings. Complete known
carrier shapes, labels and key grammar are checked before principal authorization;
principal refusal now precedes the private gap. This deliberately corrects the
previous pre-auth development-limit response. A later malformed member still
wins over an earlier unsupported Selector. No unsupported request acquires a key
or partial graph effects. The shared depth bound uses equivalent singleton and
one-operation batch wrappers. The64KiB receiving cap measures the actual
submitted singleton body, not its internal batch wrapper; the exact-boundary test
fails before that correction and passes afterward.

Cardinality syntax and numeric execution admission are separate. Negative or
fractional cardinality and empty cardinality objects are pre-key malformed input.
A schema-valid integer such as9007199254740993 fails the existing number admission
with a retained422 validation-failed problem inside receipt200.1e30 is admissible
under shortest-decimal round-trip equality; a minimum that large fails cardinality
on a small graph, while a maximum that large does not. Cardinality is still checked
before cumulative matched-resource capacity.

Locatable set numeric and cardinality failures now carry `problem.pointer` into
the original submitted singleton or batch. Cross-carrier retry preserves that
original receipt rather than rewriting its location. Property Change failures map
to the unique original change path when the existing diagnostic identifies it;
repeated paths and afterstate validation identify the original `/change` array.
A final Resource diagnostic's instanceLocation is not repurposed as a request
pointer. Shared evaluator behavior is unchanged. Ordinary non-set Resource-operation
receipts still omit `problem.pointer` for some locatable failures, including a
missing Property Change path or an inadmissible property number. Their shared
RU/evaluator-to-receipt mapping needs separate scope; the conditional pointer
obligation is not fully qualified by this set-only repair.

Selectors compare stored values exactly: a bare endpoint URI comparison does not
match a Pinned Reference object. The actual HTTP cascade regression first selects
one bare Link, misses its pinned peer, then fails the guarded Bead deletion and
rolls back the entire transaction. No implicit pin stripping or Read endpoint
filter is added to sets.

The installed raw witness uses captured compiled contracts, canonical Host with
physical port0, generated credentials and real receipt/Event continuation URLs.
Its32 unowned Link deletions yield33 receipt entries over pages32+1,96 Scope Events
over pages32+32+32, and one whole change group. It also checks owned source revisions,
no-op stability, compiled afterstate rollback, retained success/failure after reopen
and changed-population retry. Independent corrupted expectations must fail; this
is bounded private observation, not an ordinary-runner qualification claim.

The existing32 matched-resource cap does not bound enumeration: each operation
still materializes staged candidates and applies visibility/selection. Later sets
must observe earlier writes; this forbids one frozen transaction-wide candidate
snapshot but does not make physical full scans a universal protocol requirement.
No owner enumeration, Selector implementation, storage format or public limit was
changed in this slice. General scan-work bounds, negative Selector admission,
metadata-only Event projection gaps and remaining discovery/consistency obligations
remain unqualified. Historical larger-budget evidence above remains historical.


### S2a review closure: syntax before private depth and one singleton shape pass

The earlier set-refusal, singleton-count and remaining-work statements in
**Executable boundary**, **Integration and remaining work**, **Private direct
receiving and admission composition**, the first private HTTP increment, and
**Private valid-set core, with serving admission still closed** are superseded
by S2a.
Valid supported sets now use the singleton and batch HTTP routes. Lists in those
historical increments that identify all set operations as remaining work are
historical; negative Selector policy, general scan-work bounds and complete
qualification remain open. Those historical refusal tests and evidence are retained.
The earlier depth/unsupported-input ordering is also superseded: complete known
carrier syntax and key checks precede authorization, and authorization precedes
an otherwise valid private depth or Selector gap.

Synthetic Resource and set syntax parsing now uses one iterative lossless
serializer that preserves numeric lexemes and object key order. It scans the
already byte-bounded received input without applying the execution depth refusal
inside a synthetic parser. All known closed shapes, references, labels and Property
Change syntax are validated before the unchanged depth-32 execution check. The
explicit depth traversal then checks the original batch root, or an equivalent
singleton wrapper. This permits a determinate malformed request to return 400
rather than being hidden by the private depth gap. It does not evaluate Selectors
or graph candidates before that check, introduce a new work limit, or resolve
negative Selector admission policy.

Set singletons now reject a raw `operation` field before adding the route's
operation, then use the one mixed-carrier shape validation. That same pass rejects
all other disallowed raw fields, including name and idempotencyKey; no second full
set/RU syntax parse is needed. The actual singleton body still owns the 64KiB
receiving limit, and one-operation batch/singleton depth boundaries are unchanged.
Actual HTTP regressions cover malformed-plus-deep Resource and set inputs, forbidden
sequence set members with no earlier member/key effects, raw route-discriminator
protection, both depth boundaries and the exact body-byte boundary.

### Resource-alias sequence HTTP integration

The reviewed turn-time alias implementation is now connected to the existing
Transactional HTTP receiver. The obsolete `sequence-resource-alias` development
catch is removed. A missing alias is a retained member failure: already committed
prefix members stay committed and independent later members can execute. The
existing set-in-sequence and private depth refusals retain their no-key-capture
checks. This explicitly supersedes the earlier Resource-alias-sequence refusal list,
Resource-alias sequence timing remaining-work entry, and alias-marker reservation
in "HTTP review follow-up boundaries"; all three describe the original slice,
not the current receiver.

Actual HTTP tests cover an alias assigned by an earlier member, allocated local
references combined with an opaque pinned alias endpoint, retained failures after
assignment, and replay after listener reopen. A separate source-private installed
fixture uses the existing launcher and raw HTTP transport; when run against a
packed service it records a repoint before an eligible member, retained
old-target results after a later repoint, a new locator that first compares equal
and then conflicts after repointing, a recorded miss versus a successful fresh key,
and durable replay with independent current-state GETs. It validates sequence and
receipt envelopes against the unchanged schema. The fixture has 36 exchanges
(28 before reopen, 8 after), two child sessions and a closed route inventory. Its
5-second exchange, 90-second cohort and 120-second outer deadlines match the
adjacent installed Set cohort; they are test budgets, not protocol limits.

The external [ea80 frozen run](https://github.com/donnabox/beads/blob/codex/vickie-bdp-client-design/docs/architecture/bdp-client-v2/transaction-sequence-alias-http-report.md)
records the original executed fixture at `ea80c77de7cd86244096a5978b65690a7ba637d8`:
36 exchanges/two clean child sessions, with installed payload
`495b3d9c1e6d6a078b91b60f6c41cfb4ab3f8928595467ec895d171d668d53a2`.
That evidence is historical and is not relabeled for later test-oracle repairs.

The fixture does not add public Transactional admission or claim cold discovery, complete profile qualification, arbitrary
concurrent alias histories, Snapshot consistency, crash durability, or a changed
store format. The parent caller still knows the private operation targets.
Source-bound commands, preparation failures, packed payload/configuration hashes
and cleanup observations are recorded separately from the historical core proof.

### Internal Transactional discovery assembly (C3)

The private service can assemble a schema-validated discovery candidate and
Operation Directory from its captured Scope and a single live owner observation.
The owner entry copies only epoch, authorization view and head position; parsing
runs after that entry releases. Both production protocol parsers snapshot and
validate detached JSON. The directory and HTTP target constructor share the same
12-operation map, and HTTP construction rejects a different owner Scope.

The candidate contains the 16 required discovery members plus a limits object.
It projects five captured page/Selector values and the actual evaluator's
validation bounds: 16 diagnostics and 524288 serialized diagnostic bytes.
These validation limits must be disclosed when diagnostics are bounded; they
are kept out of Read options. After owner release, assembly rejects a captured
Read Selector triple that differs from the fixed set-mutation limits. Existing
Read validation still checks captured limits against Read enforcement.
Receipt checks and the Read plane consume the same immutable page maximum;
the default applies to collection reads without a limit, not receipt page size.
The fixed owner retains change groups, so the position floor is
`pos-0`; the separate ordinal-zero changefeed checkpoint remains `genesis`.
Tests replay the original groups after completed receipt detail expires and the
owner reopens, without treating a compact completed receipt as a forgotten key.

This is **not a wire-ready description**. The internal validation projection
closes a disclosure prerequisite, but remaining mandatory serving behavior and
its review gates must close before activation. Optional request, Resource,
sequence, patch, transaction and retention limits remain omitted; omission does
not authorize silent truncation or non-normative errors. C3 neither serves this
candidate nor grants public Transactional admission. Scope, descriptor and
directory GET/HEAD remain explicitly refused.
The source-private installed boundary fixture has exactly 12 exchanges and one
child: six authenticated discovery GET/HEAD refusals, three anonymous refusals,
then a real batch, independent afterstate GET and exact retained retry. Its
45-second cohort, 60-second outer and 5-second exchange bounds are fixture budgets.
Fresh pack/install execution, actual source/configuration/payload bindings and
cleanup are recorded separately in the C3 implementation report; emitted tests
alone do not establish an installed result or cold-client usability.

### Internal discovery minimum observation

The private discoveryObserved accessor accepts an optional canonical minimum and
AbortSignal. It captures that tuple once, checks each attempt against the same
owner entry that supplies epoch/view/head, and uses the existing finite wait.
No owner entry spans a wait or parsing. Only a successful eligible observation is
assembled; foreign/expired context, timeout, owner refusal and parser failures
remain distinct. Service close drains admitted waits before closing the owner.
Cancellation is observed before an attempt and at the next wait-loop check; it
does not preempt synchronous SQLite work or an already running sleep.

Without a minimum, the existing synchronous observation path is preserved and
the optional signal is inert. This internal preparation adds no HTTP caller:
Scope, descriptor and directory discovery remain refused, including the existing
minimum-route gap. Source and direct emitted-module proof are recorded separately
in the [frozen implementation report](https://github.com/donnabox/beads/blob/4925b1b2d37de792b6ec35f89f29ba23fb1210d9/docs/architecture/bdp-client-v2/transaction-discovery-minimum-service-implementation-report.md). The emitted
ordinary discovery-refusal regression and the separate packed12/1 boundary cohort
are not proof of the new accessor. No wire-ready profile, installed discovery,
public admission, catalog credit or completed cumulative qualification is claimed.

### Authenticated sequence carrier refusal observation

The source-private service now observes the current owner once, without member
execution or key admission, for the existing sequence.operations over-count413
and supported-carrier unacceptable-media406. HTTP preserves syntax/auth/count/
preparation/negotiation ordering. The immutable tuple is attached only to those
two refusals. Sequence carrier-key/malformed400,401,403,415 and the unsupported
composition development500 retain their existing context absences. The former
command-minimum development500 is superseded: copied read minimum fields no
longer refuse a mutation POST. These are retained behaviors and remaining gaps,
not normative exemptions or a ruling that unauthenticated errors must disclose
context. Discovery, store format, parsing, read minimum controls and public
profile advertisement are unchanged. Unlike the successful post-runner response above, these refusals have
no committed members to recover by replay. An unexpected owner observation fault
can instead yield the existing sanitized bodyless500; no stale tuple is supplied
to preserve the nominal refusal. Normal runtime closing/not-ready503 remains
before dispatch, without implying all live owner faults are unreachable.

Source and installed observations must remain bound to their actual frozen
source and reviewed separately. No complete profile qualification or public
activation follows from this slice.


### Exact local schema retrieval (bounded private serving)

Authenticated GET/HEAD can retrieve the captured, canonical query/fragment-free
schema retrieval identities under the configured Scope's schemas/ namespace.
Root and captured transitive documents use their exact UTF8 bytes, preserving
whitespace, non-ASCII and numeric spelling. Shared selection handles200/304/406/412;
only200 receives the raw representation, and HEAD transmits no body with the exact
GET byte length. These selected local responses carry one current owner observation.
The private sender retains disconnect suppression and the non-attesting marker.

No schema fetch, alias grant, new startup restriction or $id equality rule is
introduced. Accepted external, outside-namespace and query-bearing schema artifacts
remain offline validation inputs. Differing canonical/embedded $id aliases and
relative reference bases can remain unreachable: this is not complete cold traversal
of every accepted closure. Unknown targets, unauthenticated requests and presence
of any minimum-control field fall through existing receiving/routing behavior;
minimum support and public discovery are not added. Exact source/installed evidence
must remain bound to the source that ran; no public profile or qualification claim
follows from this slice. Captured base64 and the additional eligible UTF8 strings
retain real memory; no extra parsed schema copy is required for HTTP selection.


### Current context at a healthy comparison deadline

The private observed direct submission path distinguishes a healthy finite
comparison deadline from an owner/epoch stop. At the deadline it synchronously
checks the original persisted epoch and captures the current tuple inside one
owner entry and one atomic metadata read. No database transaction spans the
comparison wait. The observed HTTP deadline requires that tuple; an unexpectedly
missing tuple takes the existing sanitized internal-fault path instead of
silently producing a contextless503. The canonical Problem, retry and Retry-After
are unchanged. Unobserved comparison/submission objects retain their old exact
shapes; only observed submission supplies the bound capture callback, which is
excluded from caller/service/runtime comparison options.

Focused tests use a real emitted listener, an unresolved creator reservation and
an independent real commit during the existing private comparison wait. Complete
small graph and Event pages plus a readonly final receipt inventory distinguish
current context from timeout effects or duplicate replay. They do not prove
change-group pagination. The injected epoch-change case is defensive only: this
owner has no supported live epoch rotation. In snapshots30035/70ac, the
pre-existing maintenance-failure closed shortcut still masked that fault before
final observation; those timeout-context snapshots did not repair it.

Eighteen explicitly selected store/submission/HTTP/dependency/alias cases pass,
including sixteen loopback HTTP requests across two fixtures. Five isolated
mutants fail the named context-presence, current-position, missing-tuple,
legacy-submission-shape and final-epoch-check assertions. Typecheck/build/static
checks and the historical Read seal pass; broader suites are not claimed.
Default installed timeout sensitivity remains unobserved: no new installed
comparison override or load-based timing test is introduced. Existing direct and
sequence refusal installed cohorts remain separate regressions, not timeout
qualification; their execution is recorded outside this source note. No public
admission or discovery claim changes.

### Maintenance-fault comparison guard successor (2026-10-14)

This separate successor changes only the early comparison epoch guard. A normally
closed owner still returns stopped; retained owner or maintenance faults reach
the existing owner-entry exception path and the HTTP handler's sanitized
bodyless500. No fault API, context synthesis, receiving policy or public profile
claim is added.

Validation used an ordinary dependent checkout of427cfef, with the exact tested
source diff and command records retained in the external maintenance-fault
repair evidence. The parent was unmerged at execution release; this note does
not claim that PR120 or this successor has landed. Two test-adapter typing
failures were preserved before the corrected source passed typecheck. Fresh
build, format, lint, dependency boundaries and the unchanged Read evidence gate
then passed.

Exactly14 selected owner/submission/service/dependency/alias/HTTP cases passed
once;363 other cases in those files were skipped. The new emitted-runtime case
completed its seed200 under selective interval timers, triggered one actual
maintenance callback failure, then observed500 with an empty body and the exact
handler headers. It closed the runtime and verified the sole retained seed
receipt against the actual parsed seed200 body.

One separately built old-guard derivative ran only that HTTP case and failed at
its named internal500 assertion with actual503. Its finally path still recorded
one fault callback, timer cancellation, runtime closure and the sole seed receipt
inventory. Source positives and control account for seven HTTP requests across
four listener lifetimes, with15 store directories,16 owner opens and two separate
readonly inventory connections by the selected fixture paths. Process-group and
temporary-directory checks found no remaining owned test processes or store
directories. Sampling did not independently count every short-lived directory.

These are bounded source/runtime observations, not a full suite or installed
fault qualification. No healthy installed direct-refusal14/1 cohort, packaging or
profile qualification was run for this successor at this checkpoint; that fresh
installed regression remains a separate gate. Earlier timeout-context evidence
and its historical reports remain bound to their original snapshots; this
repair is not retroactively part of PR120.


### Context for observed missing Resource Event sources

The private owner now captures an immutable Scope context in the same entry that
observes an unknown Bead or Link Event source. Finite and initial SSE HTTP
projections use that context on their existing404 resource-not-found responses.
Missing identity still precedes semantic minimum and reconnect checks; malformed
source syntax and unauthenticated requests still fail before this observation.
A missing or corrupt Scope metadata value follows the existing internal-fault
path rather than fabricating context or silently returning a contextless404.

The draft adds focused owner and HTTP tests, reconciles the existing SSE missing
expectation, and adds one eleven-request private installed witness. These tests
have not yet been executed at this draft checkpoint. HEAD representation length
is computed by the Read HTTP semantics before body removal and preserved by the
runtime emitter. Prior source/installed evidence retains its original attribution.
This is no public profile qualification, discovery activation, retained Snapshot
minimum ruling or metadata-only incident-Link Event membership ruling.


### Context for observed missing receipt roots and pages

This draft retains the current immutable Scope context on authenticated missing
receipt roots and on the three genuine missing-page owner returns. The HTTP
projection carries that same observation on404 while preserving the existing
uniform Problem, principal/epoch nondisclosure, minimum-before-expiry ordering,
contextless401 and private namespace defenses. No second owner read is added.
Metadata corruption follows existing error/fencing classification rather than
fabricating context; a plain metadata error after clean rollback is not claimed
to create a sticky owner fence.

The bounded draft adds owner, service and HTTP tests and one fourteen-request
private installed witness using a genuinely issued receipt page. At this draft
checkpoint no new tests, build, control or installed execution has run. The
proposed emitted HTTP control omits only the two context projections. Earlier
Event and receipt evidence retains its original source attribution. Visible
unsupported minimum handling remains a private limitation; this draft adds no
public profile qualification, discovery activation or pending product ruling.


### Context for observed changefeed parameter refusals

This draft retains the immutable current Scope context when an entered changefeed
read rejects a malformed selected reconnect value or a same-context checkpoint
ahead of the observed head. The existing400 invalid-parameter response carries
that same observation; no second owner read or fabricated checkpoint is added.
URL grammar, authentication, repeated reconnect fields, epoch/view checks and
minimum/conditional ordering retain their existing behavior. Refusals before an
owner observation remain contextless.

The bounded draft strengthens existing owner/parser assertions, adds a twelve-
request source witness and a ten-request private installed witness, and proposes
one copied-emitted HTTP context-omission control. No tests, builds, controls or
installed execution have run at this draft checkpoint. Thirty-four new witness
exchanges enforce a response-body cap; the seven selected historical regression
exchanges retain their existing reader/deadlines without a new aggregate byte-cap
claim. Earlier evidence remains attributed to its original source. This is not
public discovery activation, profile qualification or a ruling on retained
Snapshot minimums or metadata-only incident-Link Event membership.


### Retained direct keys before private carrier-depth refusal

This draft records a private depth-capacity fact only after complete direct
carrier syntax preparation, then lets the authoritative owner compare retained
keys before refusing a fresh over-depth carrier. A different normalized request
under a retained key returns the existing conflict; equal retained requests keep
their saved outcome and existing negotiation behavior. A fresh deep request still
receives the private bodyless500 development refusal without acquiring a key or
receipt. Strict preparation helpers, no-controls owner calls and sequence depth
preparation retain their existing development-limit exception behavior.

The bounded draft adds four source cases and one thirteen-request private installed
witness. Source cases include strict helper compatibility, genuine retained and
pending/dependent keys, a raw twenty-thousand-array metadata retry, and a thirteen-
request HTTP witness. No tests, builds, controls or installed execution have run
at this draft checkpoint. The proposed early-refusal control and fresh installed
witness remain separate gates; earlier evidence retains its original source
attribution. This changes neither public discovery eligibility nor the pending
Snapshot minimum or incident-Link Event membership rulings.

### Private installed principal-key isolation draft

The unexecuted draft adds one seven-request installed HTTP witness for two writable
principals using the same key, same-principal credential rotation replay, exact
retained receipts versus current context, and complete Resource/Event linkage. A
separately selected configuration-collapse control expects refusal on its second
request; it is sensitivity evidence, not a production mutation. A-credentialed
reads observe the existing serving view and do not establish principal-scoped
read semantics. No tests, builds, packages or installed runs have executed at this
draft checkpoint. Earlier evidence retains its original source attribution.
Authoring is based on 18104a03b850553641f24fe83e7318493fa102ca. The unchanged draft
was integrated onto f5511718371a6935614eae6756e796cef71570c2; reviewed validation
remains a gate before final publication/readiness. This draft
does not activate discovery, qualify a profile or settle the pending Snapshot or
incident-Link metadata decisions.

### Private installed same-key dispatch witness draft

This unexecuted draft adds one bounded installed callback that dispatches a
singleton create and its equivalent one-operation batch without awaiting either
response. Both omit the Resource id so the authority allocates it. The positive
schedule has six HTTP requests: the pair, the issued receipt root, the complete
Bead collection, the complete Scope Event page and one retained batch replay.
Independent schema and literal checks precede full receipt, Resource and Event
equality. A separate input control changes only the second key and is expected
to stop after two successful responses at the named shared-receipt assertion.

The witness records actual client lifetimes and socket milestones; it does not
prove simultaneous server admission or an internal pending join. A pending
observation is reported only for an actual pending response. If both initial
responses are pending, the callback stops as inconclusive and fails rather than
polling or passing. Safe reports retain fingerprints and selected facts, while
full parsed comparisons occur in memory. Authoring is based on merged
98c600767e8e91a79e109cb741beb91e23b9bebe. Validation and code council remain
pending. This private draft does not qualify a profile, activate discovery or
settle the pending Snapshot and incident-Link metadata decisions.


Private guarded-batch installed evidence draft (unexecuted): on verified main
`9bf601bfb570adae97ce8cdc99caf2cc7a2b34c1`, one new callback stages distinct marker
creations before two revision-guarded updates to the same observed Bead revision.
The planned seven-request positive checks one winning effect, the retained failed
receipt and exact replay/root recovery, and complete Resource/Event rollback
evidence. Its separate three-request input control omits both guards and must
establish two completed effects before the named failure oracle. This draft has
not been built or executed; it adds no catalog credit, profile qualification or
server-admission overlap claim. Existing historical validation remains attributed
to its original sources.


### Read-minimum receiving draft

The operator-approved closed tuple rule has passed local source validation: any
read minimum field requires exactly one valid token in all three fields, with
malformed tuples refused before owner observation. Mutation POST ignore behavior
and complete-tuple receipt nondisclosure remain unchanged. After two test-fixture
corrections, all 13 source validation stages passed, including 14 selected source
callbacks and four specification/static callbacks. A separate emitted-gate removal
produced the expected named failure on one actual HTTP response: bodyless500 with
`minimum-position`, in place of the required malformed-request400. The original
failed validation attempts remain retained under their original source bindings.

The private installed draft uses a real 32-create batch followed by a 32-match
update to obtain an issued receipt page at normal limits. Its 22 requests plus the
two changed Snapshot witnesses still propose 92 requests across six child starts;
installed validation and exact-head CI have not yet been credited here. These
local source results do not establish public Transactional qualification. Unknown
identity and the retained Snapshot/incident-Link product questions remain outside
this change.


### Current Resource minimum ordering draft

This draft is authored from reviewed authorization candidate 1647c5d, which was
not merged main at authoring time. It implements the operator-ruled ordinary
missing/hidden Resource, alias and initial incident-anchor precedence and bounded
unproved-position waiting for existing current Bead/Link Resource/properties.
Strict consumers and pending Snapshot/incident-Event questions remain separate.
On that isolated candidate, all 11 source-validation stages passed, including
the fresh build and 15 selected source callbacks; preceding fixture-type and
report-lint failures remain preserved under their original bindings. Actual
authorization main df80f8cb is ordinarily integrated through bf50e1e8. On clean
733728cf, five narrow integration stages passed, including the fresh build and
two selected owner-read callbacks. Fresh archives and their external consumer
passed package and dependency verification. The first installed positive failed
before ready with zero HTTP requests: its compiled Type fixture used identities
outside the configured Scope. That failure and its unknown-stop/retained-directory
report remain preserved. The test-only Scope-local Type correction leaves all
production bytes and the verified archives unchanged. Targeted typecheck and
format checks passed. The corrected installed positive passed all 32 exchanges;
two separate emitted controls each produced only their intended named failure
after two exchanges. All three children exited cleanly and stores were absent.
The external fingerprint adapter's initial JSON key-order mismatch is preserved;
its source-grounded correction re-adjudicated the same positive without repeating
HTTP. Exact-head CI remains pending. Unknown positions combined with foreign
epoch/view remain a private unsupported development gap, outside the current
operator ruling. Source and installed evidence retain their exact commit/build
provenance; no qualification is claimed.


Private sequence depth/retained-member draft (unexecuted): receiving preparation now preserves branded per-member depth facts so an existing member key can reach its ordered retained comparison, while strict source preparation still rejects deep input. Fresh deep JSON requests remain unsupported private500 responses; an unacceptable sequence Accept is refused with406 before admission. If a retained failed key expires between turns, a later private depth500 may follow an already committed and retained prefix; remaining claims are retracted without undoing that prefix. The proposed source and fresh-installed witnesses are not yet executed. This does not add arbitrary-depth execution, public Transactional discovery/admission, or cumulative qualification, and leaves the documented policy and consistency limitations unchanged.


### Fresh deep JSON serving draft

This isolated draft starts from working branch68b0f462, the reviewed test-only
successor of77b4cf98 with exact push CI green. Its product tree is identical to
reviewed11742645. It removes the private JSON nesting-depth refusal
while retaining request bytes, Resource size, Selector depth and other existing
limits. Resource no-op and Snapshot owned-Link integrity comparisons share an
internal iterative JSON comparator. Receipt maintenance filters available detail
with the existing JavaScript parser instead of SQLite JSON extraction, allowing
valid deep receipt text to survive maintenance and reopen. No storage format,
public export or profile-admission change is proposed. Both complete receipt and
receipt-page freezing now use a private iterative walk, preserving nested
immutability for deep receipt values.

The planned regressions cover real deep writes, retained retries/conflicts,
no-ops, set and sequence operations, failed-batch rollback, receipt pages and
expiry, Events, and Snapshot integrity. New deep fixtures require independent
iterative comparisons so recursive test matchers cannot mask a serving failure.
The two existing installed witnesses retain their request counts; two direct
fresh-write requests change Accept to application/json to exercise success,
while the sequence witness retains its unacceptable-Accept checks.

Production and source review findings are dispositioned; source validation is
next. Full installed-test council and frozen control/package/installed validation
remain pending. The eight-request installed sequence witness observes its deep
metadata in the command response, without independent metadata readback; separate
Snapshot and reopen witnesses check deep sequence properties persistence.
Earlier evidence keeps its original source attribution. This draft does not
qualify or advertise a write profile and does not settle retained-Snapshot
minimum semantics or incident-Link metadata Event membership.


Fresh finite changefeed start-now opaque-minimum draft (unexecuted): this subset now uses the existing bounded wait for lexically valid unrecognized minima with the actual current epoch/view, preserving the one-time admission checkpoint while recapturing current context per attempt. This supersedes the earlier unsupported-minimum gap statement only for finite non-SSE start=now (including minimum refusal before unsupported-Accept negotiation). Direct after/genesis, retained continuations, SSE and foreign-context opaque minima remain outside this extension; S1/G2 and public discovery/profile admission stay unresolved or closed as previously recorded. Earlier evidence retains its original source attribution; this draft adds no validation or qualification claim.

Fresh canonical Scope Event SSE reads without URL or raw/header reconnect controls now have a draft matched-context opaque-minimum path through the existing bounded waiter, before packet and stream admission. This separate Event slice does not supersede the preceding finite changefeed start-now paragraph's changefeed SSE exclusion. Resource Event SSE, reconnects, foreign opaque contexts, S1/G2 and public profile discovery/admission remain excluded; no validation or qualification is claimed for this draft.
