---
status: draft
intended-status: normative
version: "0.1"
---

# Required Event observation

Paired with the [canonical Event CLI](../../../docs/cli-design/events.md) under
existing #153/#59. [Donna's accepted minimum](../../../docs/cli-design/event-decisions-20261022.md)
is required postimages, optional deltas, declared observation coverage, bounded
replay and explicit gaps. The concrete shapes/defaults below are author source for
review. Native entry is `retainedEventPage`, not the inherited `eventPage`/`event`
helpers or the old Transactional Event algorithm. The old v0 slot stays unchanged.

## Required source, truthful coverage

Every retained Core/Write Scope MUST expose the discovered `events` source and a
Resource-scoped projection through `view=events`. A source is an observation
endpoint, not a third Resource kind, public receipt or replica log. Resource
selection uses canonical identity/kind and current disclosure; the source can
remain readable after subject deletion under its actual retention/disclosure.
Unknown subjects do not become distinguishable from forbidden subjects. Opaque
external Link endpoints do not acquire in-Scope Event sources.

An Event records a published Resource transition or a truthfully described external
observation. Policy declares `observation:"committed"` when it covers every relevant
published transition from the stated boundary; `observation:"observed"` when the
external mechanism can miss original intermediate mutations. Required `description`
states that mechanism and any intermediate-loss limitation. Observed coverage MUST
NOT be represented as a gap-free original mutation history. No cross-source order,
universal latency or globally latest-state guarantee follows from either mode.

Write MUST durably produce its required facts with its own effects and terminal
outcome, regardless of how unrelated external state is observed. A crash/retry
cannot lose those facts or mint duplicate transitions. Failures/rollbacks produce
none; a semantic no-op under the selected publication model produces none. Commit
correlation is not a receipt, public position or atomic replica-application claim.
Alias-only changes produce no Resource Event; aliases acquire no Resource kind or
revision merely to make route updates into a Resource lifecycle operation.

Coverage names opaque `start`, `retainedFrom` and `through` boundaries. The first
is where this observation regime begins, the second its current replay floor,
and the last the captured upper boundary for this finite traversal. Tokens admit
no client arithmetic or cross-source comparison. Earlier unknown history is not
fabricated. Initialization may establish a baseline without emitting fake creates
for pre-existing Resources. A newly discovered record is not evidence of original
creation without a known covered absence or an actual observed creation fact.
If the producer cannot describe a transition truthfully, it must report its
coverage loss/refuse the claim rather than invent a prior revision or postimage.

Each page advertises positive `minimumRetentionSeconds` and
`minimumCursorLifetimeSeconds`, plus supported `representations` including
`postimage`. No protocol-wide number is required; zero-retention live-only sources
cannot claim this contract. Promises apply to the admitted facts/issued cursor,
not only current configuration. An ordinary upgrade or configuration change cannot
silently shorten them. The replay floor may advance according to those promises.
Issuing a cursor protects its context and remaining captured range for the promised
lifetime, including facts already older when that cursor was issued; merely setting
a duration shorter than the general Event retention is not sufficient.
Static sources can expose an empty covered interval. Source initialization,
observation restart or an unobserved interval MUST NOT be hidden by an empty page.

## HTTP selection and finite replay

Scope observation GETs the discovered absolute URL. Resource observation GETs its
canonical URL with `view=events`. Requests select the existing v0.1 JSON media type
through `Accept`; response Content-Type MUST confirm it before interpretation.
The complete selected contract defines the required Event vocabulary. This cut
requires finite JSON, not SSE; live CLI observation polls this same source.
Usual admitted finite-read HEAD/conditional semantics remain applicable. A bodyless
HEAD/304 response supplies no Event page or successful consumer progress; it must
not be interpreted as an empty covered interval.

Parsed query `retainedEventQuery` admits:

| Parameter | Meaning |
| --- | --- |
| `from=retained` | Start at the earliest currently retained covered boundary; default |
| `from=now` | Capture current boundary; return no prior Events and a usable cursor |
| `after=TOKEN` | Resume strictly after an issued source cursor; conflicts with `from` |
| `representation=postimage` | Required common mode and default |
| `representation=delta` | Explicit optional mode; unsupported selection refuses |
| `limit=N` | Positive native page bound under actual configured limits |

Duplicate/unknown parameters and invalid/conflicting values refuse; no silent
ignoring of a new semantic selector. For a Resource, `view=events` selects this
operation and is not an extra selection field in the parsed query object. Tokens
are decoded once using normal query escaping. `from=retained` is a deliberate new
start, never a repair automatically substituted for failed continuation.

The first response confirms `selection`, `policy`, `coverage`, `source`, optional
`subject`, `events`, `cursor` and `next`. Its captured upper boundary is fixed while
following `next`. A native absolute `next` preserves source, selected contract,
representation, principal/authorization context, coverage regime, traversal bound
and issued page size. Clients follow it unchanged; ordinary collection resizing
rules do not apply. `next:null` means this captured range is drained, not no future
Events. `cursor` resumes after every fact/scanned position covered by the page;
the authority MUST NOT advance past an undisclosed gap or incompatible required
fact. A later `after=cursor` traversal can capture a new upper boundary for polling.
Pages preserve one stable source order; concurrent commit ordering is the source's
choice, fixed before publication. Paging may split a commit's facts and never
implies atomic replica application. The authority enforces finite page/byte bounds
and must support a complete single admitted fact plus its envelope. Write admission
protects required postimage production/retention before effects commit; a later
size failure cannot authorize dropping/truncating a fact. External-source bounds
must likewise be compatible with the conformance claim.
New facts append after previously captured boundaries. Late external observations
are recorded in that append order, not inserted behind an already issued cursor;
observation time never fabricates an original backend commit time.

Cursor identity is opaque and bound to this selection/context and source history.
An Event ID is not a cursor. Restoration cannot reuse a cursor namespace in a way
that makes an old ahead-of-head cursor look caught up. A service may retain enough
old context to continue safely; otherwise it must diagnose the discontinuity. No
public epoch, replica checkpoint or arithmetic position is introduced.

Ordinary read Problems cover malformed/unsupported selection (`invalid-parameter`,
400), wrong context/history (`foreign-view`,409), expired/pruned continuation
(`cursor-expired`,410), and temporary inability (`temporarily-unavailable`,503),
with their existing family/retry meanings. Missing/forbidden subjects retain normal
non-disclosure. Lost observation coverage that prevents safe continuation uses
`foreign-view`; known retention expiry uses `cursor-expired`. Neither is successful
catch-up. A read-only source unable to provide the declared mechanism cannot
advertise conformance. No new transaction/receipt Problem grammar is imported.

## Facts use the mutation vocabulary

`retainedEvent` is the union of postimage and delta fact shapes. Common envelope
members are source-local stable `id`, absolute `source`, observation `time`,
`origin:"write"|"observation"`, actual `revision`, selected `representation` and
`effect`. A Write-origin fact MUST have actual Scope-local `transaction` correlation;
observations may include it only when known, never infer it from a polling interval.
`time` is fact-recording time, not a total order or an invented external commit time.
Only `annotations` is a declared ignorable extension object. Unknown required
members/operations/controls are not annotations.
An ID MUST NOT be reassigned to a different fact after retention or source recovery.

`effect.operation` is exactly one of `createBead`, `updateBead`, `deleteBead`,
`createLink`, `updateLink`, `deleteLink`. Creation uses allocated absolute `id`;
update/deletion uses absolute `bead` or `link`. Alias/binding strings and relative
inputs resolve before publication. Resource kind and identity do not change.

Create carries its fresh `revision` and no `previousRevision`. Update carries actual
`previousRevision` and new `revision`, independent of whether its author supplied
a guard. Delete carries its final live `revision`, no fresh revision, and no
`previousRevision`. Deletion `effect.deleted` contains kind, recorded affiliation,
identity and final live revision; for a Link it also contains its complete recorded
source/target References. It retains no properties. Delete is not erase.
The operation target, record/deleted identity and envelope revision MUST agree.
Each Event's source and representation MUST agree with its selected page. These
cross-value obligations require semantic validation beyond the JSON grammar.

### Observed predecessors and disappearance

For `origin:"observation"` under `policy.observation:"observed"`, the sequence is
the source's actual observations, not an assertion of every backend mutation.
If its complete prior observation is X@r1 and its next complete observation is
X@r4, `previousRevision:r1` and `revision:r4` link those two known states. The
backend may have passed through unobserved r2/r3; r1 MUST NOT be described as its
proven immediate mutation predecessor. The postimage is the sampled r4 record;
an offered delta transforms the known r1 record to that r4 record, not an invented
r3-to-r4 patch. No intermediate Event, revision, commit time or transaction is
inferred. A declared sampling limitation is not itself an unexpected coverage gap.

For such an observed disappearance, "final live" means the last complete live
record in **this observed sequence**, not a proven final backend version. After
X@r4 and confirmed absence, a deletion observation reports r4 and that record's
known affiliation/kind and, for a Link, endpoints. It MUST use observation origin
and the observed policy; it is not an authoritative deletion result/tombstone or
proof that no unseen retype/update occurred before backend deletion. No final
backend revision or affiliation is manufactured. Delta and postimage modes report
the same last-observed deletion context and mint no new Resource revision.

The source must possess the complete required preceding record/context and must
be able to distinguish absence from forbidden/temporary/tier-only unavailability.
A hot-tier miss is insufficient. If it cannot establish that context or absence,
it uses the existing explicit coverage-loss/refusal path; it cannot emit an
invented deletion or advance a cursor past the unresolved fact. Unexpected loss
of the observation mechanism also remains a gap, distinct from its declared
sampling interval. `committed` coverage and Write-origin facts still require
their actual published predecessor/final-live context; these observation rules
do not weaken Write durability or decide Trish's batch publication model.

### Postimage and delta representations

In required postimage mode, create/update `effect.resource` is the complete published
Resource at that transition, including metadata, recorded affiliation and owned
state when applicable; it has no optional incident-Link aggregate. It MUST NOT be
replaced by a later GET or reinterpreted through today's Type default. Historical
authorization/controlled-content erasure still apply; unavailable promised data
cannot be returned as an invented complete postimage. Ordinary deletion retains
its selected context rather than fetching an already deleted Link.

In optional delta mode, creation carries `type`, complete `properties`/`metadata`
and Link endpoints; update carries actual changed `type`, `properties` or
`propertiesChange`, and `metadata` or `metadataChange`. Each object's replacement
and patch are exclusive, exactly as in ordinary input. Patches share native
`propertyChange` items/semantics. They need not reproduce the author's edit syntax,
but applying them to the actual prior state MUST yield the recorded next state.
Unchanged fields are omitted, never silently cleared. Type-only updates need no
dummy patch. Under Types, exact resolved affiliation is recorded; Core-only
carrying does not suddenly require definition interpretation.

Delta `revisionProvenance` records the resulting version's actual carried value;
absence means no provenance recorded in that complete representation. Current
wire suppression is not offered, so absence never means an omitted display view.
It is not a replayable provenance-input override. Create/update facts with an
owned-state change carry `derived.ownedLinks`: the complete newly recorded map,
`{}` for an empty owner or `null` for no longer an owner. Omitted derived state is
unchanged. Map nominal keys, full Link records and legacy retained captures obey
[affiliations](affiliations.md); no rebucketing from current definitions occurs.

The owner may therefore have a derived-only `updateBead` fact even though an authored
update without input is invalid. `derived` is not an accepted mutation command
field. Full-map replacement is a deliberately simple optional-delta representation,
not a minimum-byte patch promise or another ownership implementation. It handles
ownership entry/exit without pretending the Link was created/deleted. Actual Link
and owner revisions stay independent and share known commit correlation.

Facts exclude `expectedRevision`, local `name`/`@name`, execution keys and
credentials. They describe committed/observed state; submitting them to a mutation
endpoint would be new intent and is not Event consumption or replica replay.

## Projection and compatible extension

Scope source covers authorized Resource transitions. Link source projects its
lifecycle; Bead source projects its lifecycle and lifecycle effects of incident
Links, including a Link Type-only change. Keep the same Link operation/fact
vocabulary rather than adding duplicate linked/unlinked payload kinds. A self-Link
appears once per source. Incidence alone does not version an endpoint Bead. Actual
owned-state transitions are separate Resource facts under the selected commit model.
Projection preserves relative order and known correlation, not a promise that an
authorized page contains every fact/member of a transaction. No arbitrary predicate
filter or property projection is added.

Postimage/delta represent the same selected facts with the same source identity,
relative order and revision meaning; they do not select a different coverage model.
Changing representation requires a new explicit selection, not reuse of a cursor
bound to another mode. Optional detail can be omitted only at a declared extension
point while preserving all base effects. New capabilities MUST project their base
Resource effects truthfully for older subscribers. If that is impossible, they are
not transparently additive under this contract: select a different supported contract
or refuse/stop explicitly before advancing past the incompatible position. Silently
dropping an unknown required fact cannot produce a successful continuation.

Receiving bytes is not successful consumer application. Page cursors are safe
consumer progress only after every included fact has been validated/processed.
Repeated delivery preserves fact identity and does not reexecute writes. Required
Events do not promise consistent state bootstrap, complete application History,
durable subscriber state, erasure reconciliation or replica group application.

## Shared batch/owner gate remains explicit

Trish's per-operation-versus-final-publication and net-zero batch questions are
unanswered. This source does not choose which internal batch stages become
published Resource revisions, exact owner allocation, Event counts, per-member
indexes or create-then-delete/provenance policy. It describes each transition the
eventual selected model actually publishes. The earlier unadopted operation-local
PR292 examples must be composed with that ruling before adoption; their presence
does not settle it. Separate committed singleton A→B and B→C writes do retain both
facts; that example is not an answer about one atomic batch.

Types activation/intrinsics, normal source integration and actual qualification
also remain gates. The inherited Transactional `event`/`updatedData`/`ownedLinkDelta`
definitions and old `linked`/`unlinked` examples remain staging input, not this
entry. No runtime, provider, CLI, SSE or installed/full-suite proof is claimed by
the accompanying grammar and paper cases.
