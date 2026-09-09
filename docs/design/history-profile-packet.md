# History resolution decision packet

Status: **selected cores recorded; remaining choices OPEN; non-normative; not implemented**.
Prepared 2026-09-08; operator ACKs recorded 2026-09-09. Plan of record: [gastownhall/bdp#1](https://github.com/gastownhall/bdp/issues/1).
The word “History” names this design lane, not a selected fourth `profile` value.

This packet turns the historical-resolution proposal into bounded decisions.
It proposes no edit to the normative specification, schema, catalog, or evidence.
A recommendation is not a ruling. The dated ACK record below identifies Donna’s
selected cores and their explicit deferrals. Existing rulings are constraints, not
questions to reopen. Apply approved wording to its owning artifact after review;
this packet never becomes an alternative specification.

## Source and authority map

The specification owns protocol law, the canonical bundle owns wire shapes,
and `packages/conformance/matrices/README.md` owns evidence law. The requirements,
startup contract, architecture, and client/Scope-port design constrain their
respective implementation work. Issues record rulings and implementation inputs;
implementation choices do not override protocol intent.

Inspected protocol baseline: main `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`.
Its canonical bundle has 26 definitions, a closed `readDiscovery`, a closed
`pinnedReference` with only `uri` and `revision`, and Resource records that require
`revision`. There is no historical-resolution discovery member or History wire
bundle. The existing Read surface and its sealed evidence are not a History claim.

Pending changes were checked against the following pinned heads. The later #20
ACK record supersedes the earlier queue state; earlier source citations remain
explicitly pinned and do not imply those drafts have merged:

| Input | Head | Relevance |
| --- | --- | --- |
| BDP #20, initial reconciliation | `1eef4e439629e247e9055ef8e42045acbea66b75` | Ruled TX erasure constraints; its then-open queue is historical |
| BDP #20, later operator ACK | `267f79d44d5883f70b0310378719ae0303b5445f` | T49 option 1, T63(a), T64(a) ruled and materialized; its then-open T62 retry contract and T50–T61 queue are historical, superseded in part by the 2026-09-09 operator record below |
| BDP #19 | `06ebabdb391d8ea730295f4e01ed00bc1206fe38` | Ruled Read+Update wire decisions; no write implementation claim |
| BDP #22 | `c201cc28f74c6f71212aaf7f25966aabf55fb97e` | Wildcard ownership and opaque properties |
| BDP #23 | `2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7` | Exact-decimal equality, admission, named numeric models |
| BDP #24 | `87de37f673f83ec54989fdff4891bacc05730ea6` | Sealed definition projection ruled; separate coverage-check judgment subsequently ACKed on 2026-09-09 (record below) |
| Beads #6358 | `c8995b58c00d4407f49af13c6cb3330d903a2988` | Issue-plane version writer; product evidence only |
| Beads #6422 | `ec692e146ad2a879d1c6819ecc8bf786597d617b` | Graph P0; subsequent History/serving implementation remains work |

**Initial Transactional exclusion ended 2026-09-08.** The initial packet and its
first council excluded the TX apply. Donna explicitly relayed completion and directed
gates, push, and council 13; the [release record](https://github.com/donnabox/agent-coordination/blob/ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368/context/janet/beads-workstream-state.md#L744-L751)
supersedes the earlier hold in that same ledger. After that release, the read-only
reconciliation below checked the applied TX specification and its recorded rulings
at the pinned #20 head. That draft PR is not merged or a conformance claim. Its
remaining choices and provisional ratifications are not History defaults.

Primary records:

- [History proposal revision 2](https://github.com/gastownhall/bdp/issues/1#issuecomment-5573074065): input, including withdrawn earlier positions.
- [Accepted inputs](https://github.com/gastownhall/bdp/issues/1#issuecomment-5464020140): records `?revision=` retrieval and restore/replacement fencing as already ruled, and the history-authorized disclosure direction; separately accepts `latest-version` / `successor-version`, the per-Bead versus repository chain distinction, and the erasure propagation gap. Revision-2 additionally proposes `predecessor-version` and `version-history`.
- [Memory-compat rulings](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982), followed by the [properties amendment](https://github.com/gastownhall/bdp/issues/1#issuecomment-5587346463).
- [Numeric ruling](https://github.com/gastownhall/bdp/issues/21#issuecomment-5586406564).
- [Open erasure questions](https://github.com/gastownhall/bdp/issues/12#issuecomment-5570349470).
- [Jim’s writer](https://github.com/gastownhall/beads/pull/6358) and [Phase 3 complete-or-refuse handoff](https://github.com/gastownhall/beads/issues/6136#issuecomment-5586085324).

## Fixed constraints and proposed-text conflicts

| Fixed constraint | Consequence for this packet |
| --- | --- |
| Complete or refuse (item 3) | Never return an incomplete version as success, never fill gaps from current or adjacent versions. An Unretained refusal names missing properties and owned-Link sets, carries no partial record, and is disclosed only to a caller authorized for the Bead’s history. |
| References do not hold their targets (item 1) | No reference-triggered retention hold, cascade, rewrite, or retargeting. BDP carries no hold on the wire. For the ruled historical-address contract, removing a cited version leaves its address answering Gone with its reason to a caller authorized for the subject’s retained history; other callers receive uniform resource-not-found. This direction still requires explicit materialization against baseline Read’s discretionary disclosure. A domain may keep a cache under its own policy; erasure obligations remain separate. |
| Invalid, known-Gone, unresolved-here admission outcomes (item 2) | These are available to validating write policy; item 2 also preserves `revision-unknown` as the read-side answer. Its code name is fixed; H5’s tuple is now ACKed, with wire materialization still required. No mandatory reference resolution or provisional storage is introduced. |
| Retained addresses survive epoch change (item 4) | A surviving version remains resolvable at its old address. No blanket rejection of old revisions. Positions, snapshots, cursors, and receipts still need their own fencing rules. |
| Whole-set wildcard ownership and opaque properties (item 5, amended) | Owned Links are graph state; `properties` values are never reference-typed protocol edges. No new property-reference annotation mechanism. A view is closed over owned Links: hiding an in-Scope target also hides its owning source; the properties amendment did not withdraw this consequence. |
| Attribution `claimed` or `unknown` | Carry the version’s existing attribution, including absence. Do not introduce `verified`, infer an actor, or promote import provenance into authentication. |
| Exact-decimal equality and admission (#21) | Preserve the ruling. Issue-plane JCS storage is evidence of one declared serialization discipline, not a mandate to make generic graph equality binary64. |
| Erasure propagates; retention does not | T19/T25–T31 fix containing-version erasure, copy cleanup, pre-erasure token expiry, the permanent projected ledger, agreement, and administrative tombstone deletion. History capability applicability, stale-import admission, and the exact externally claimable promise remain open; resolution alone proves none of them. |

Baseline [Reads after deletion](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2088-L2125) permits history-authorized disclosure (`MAY`); item 1 fixes the
Gone-with-reason consequence for removed cited historical versions. Materialization
must state that capability/operation boundary and amend Reads after deletion and
[PROTO-013](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/design/requirements.md#L68-L77) with dated wording. Preserve unauthorized uniform 404 and do not
silently strengthen ordinary non-History reads. The obligation is already ruled;
its wire materialization is H5 work, not a new MUST-versus-MAY vote. Existing
Transactional erasure obligations remain independently fixed.

The baseline’s [Scope-history paragraph](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1040-L1048) still says all prior-epoch history tokens,
including revisions, are rejected. The pinned TX head retains that paragraph too
([lines 1094–1102](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1094-L1102)).
It conflicts with Memory-compat item 4’s retained-address ruling; H9 materialization
must amend it with a dated marker, preserving all existing non-revision token
fences and their triggers. The retained-address rule also needs a profile-neutral home. T29’s erasure ledger survives those fences; retaining an old
address never authorizes retaining or serving erased content.

The input’s suggestion to cache immutable historical responses conflicts with the
selected `private, no-store` rule for authorization-dependent Scope data. Content
immutability also does not make currency links or authorization immutable.

The input proposes both ordinary Resource records (which contain `revision`) and
a revision equal to the hash of the entire received body. That is self-referential
unless an exact representation or exclusion rule is chosen. “Strip a field” is
not a byte-level rule. H10 makes this a visible decision rather than an adapter trick.

## Operator selections and remaining decisions

**2026-09-09 operator ACK.** Donna selected A for the eight presented items:
H1a, H2, H3, H4, H5 core, H6 core, H7 enumeration and H8, retaining every
explicit deferral. This record comes from her ACK of the eight-item interview,
relayed in the authoring handoff; it is not inferred from a reviewer preference.
The section-level records below define its scope. Quoted wording remains a
materialization draft until the owning specification, bundle and fixtures are updated.

**Second eight-item ACK, 2026-09-09.** Donna subsequently selected H9a A, H5b A,
H9c A, H10 A, H11 B, H12a A, H1b B and H4b A, with the boundaries recorded in their
sections. The common retained-address law belongs in Revisions; no sync hint or
extra current-scheme address is added initially; opaque ordinary records precede
exact-byte witnesses; a distinct immutable change-context envelope is required now;
incident-Link deletion refusal remains initially; advance age/count retention
guarantees are omitted initially; and explicit current historical identity/relationship
disclosure permission can satisfy historical target closure without granting target
body access. H9b’s Read+Update exception was already required, not another vote.

Remaining OPEN work includes H1 advertisement shape/participation; H5 evidence
lifetime/shape and refusal windows; H6 general validator encoding and replacement
navigation; H7 page/row, replacement membership, deleted-subject and cursor/limit
details; H9 safe allocation and old-revision write guards; H10 imported-value
integration and the deferred witness tranche; H11 exact envelope semantics/wire
shape; and H12 History assurance/import and administrative disclosure. H8 bulk
checks and H12’s alternative surviving-citation lifecycle are explicitly deferred.
None of these ACKs supplies schema, runtime, evidence or readiness.

The first eight-item batch selected H1a/H2/H3/H4 and H5–H8 cores; the second
eight-item batch selected the follow-ups listed above.
H1a placement now supplies H7’s profile context. H6’s selected navigation must be
materialized against H7’s selected enumeration; replacement semantics remain a
joint follow-up. H1’s exact advertisement shape follows the remaining H2–H9
materialization choices; the no-advance-guarantee boundary is already selected.

**Separate queue supersession, 2026-09-09.** The current [operator ledger](https://github.com/donnabox/agent-coordination/blob/63f3d78674f93b85dad99fcfcf6cd0eed6d325c4/context/janet/beads-workstream-state.md#L944-L970)
records T50–T56 A, T57 B, T58–T61 A, T62a/b A, T65 A and RP1’s separate
coverage walk ACK. The walk never changes the digest. The [earlier handoff](https://github.com/donnabox/agent-coordination/blob/ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368/context/janet/beads-workstream-state.md#L701-L725)
and provisional labels at the older source pins remain historical, not current
unanswered questions. T57’s later canonicalization integration remains implementation
work after its decision. T65 selects the existing changefeed/snapshot-ledger route
for persistent Event consumers claiming protocol-backed erasure handling; it does
not settle the separate History assurance boundary. This History fold neither
materializes the TX decisions nor claims their implementation. Do not ask these
ACKed questions again as pending rulings.

### H1 — Profile placement and advertised capability

**H1a — placement (ACKed A, 2026-09-09).** There are three cumulative profiles. The proposal wants a read-only
citation resolver without requiring a mutation authority or a changefeed.

**Options considered.** A: an optional capability on each existing profile, with one complete
minimum History surface. B: a fourth cumulative profile, which makes History
placement relative to mutation/replication awkward. C: Transactional-only, excluding
read-only resolvers.

**Selected: A.** Optional capability on all three existing profiles, with one complete
minimum History surface. Proposed discovery member `historicalResolution`, with its
closed shape selected after H2–H9. No new `profile` enum value. Absence means the
capability is not advertised; clients must not infer support from the profile.
The Read+Update leg requires reconciling its closed restore-signal list with the
selected History reorganization disclosure (H5/H9) before implementation. Excluding
Read+Update was considered and not selected. Exact amendment wording remains H9
work; all-profile placement does not silently amend the current specification.

**Proposed wording:** “Historical resolution is an optional advertised capability.
An authority advertises it only when it implements its complete required surface.
It does not imply mutation, Scope replication, or erasure-reconciliation capability.”

**H1b — initial retention advertisement (ACKed B, 2026-09-09).** Initially advertise
no advance age/count retention guarantees. Clients observe H5’s substantiated
outcomes and H7’s retained window; an observed window is not an advance promise
that listed versions will remain retained. Explicit guarantees and their exceptions
are deferred. This does not weaken item 1’s Gone-with-reason duty and introduces no
wire hold. H1’s exact closed advertisement shape remains OPEN after H2–H9;
participation advertisement is a separate choice below. Names such as `versions`,
`history` and `tombstones` from the input remain unselected fields.

**Participation advertisement subchoice (OPEN).** Revision-2 §3 also proposes
participation/legacy/unversioned coverage counts. Choose authorized counts, a
precisely defined coverage class, or no participation advertisement; the last leaves
clients to H5’s selected not-tracked diagnosis and H7’s selected enumeration surface.
Define the categories and observation consistency if selected. Counts or classes
must be authorization-relative or omitted so they reveal no hidden Resources.
H1a’s complete-surface capability claim does not assert that every Resource
participates. No member names or coverage denominator are selected here.

**Destinations/consequences.** Profiles, discovery, startup admission, and H9’s
profile-neutral retained-address home. Read and Read+Update do not expose Scope
epochs; putting that rule only in the Transactional Scope-history section would
not bind the read-only resolver H1a permits. H1a’s selected placement does not
select the exact advertisement member set. H1b now selects no advance retention
guarantees for the initial surface. The advertisement also affects
discovery schemas, catalog applicability, client negotiation, and evidence. Adding the member
to sealed `readDiscovery` changes the Read projection and requires a reseal before
shipping that change. The sealed `advertisedLimits.retention` is also closed, with
only `idempotency`, `receipt`, `maximumSnapshotLifetime`, and `replay`; extending it
for History bounds would independently change the Read projection and require a
reseal. A documentation-only packet changes neither definition.
For each profile selected by H1a, define any selected advertisement or limit
members in that profile’s own closed definitions in **both** bundle copies: `readDiscovery` / `advertisedLimits`,
`readUpdateDiscovery` / `readUpdateAdvertisedLimits`, and
`transactionalDiscovery` / `transactionalAdvertisedLimits`. These are distinct
definitions at #20, not inherited fields. Only definitions included in the sealed
Read projection affect that digest; changing an unsealed later-profile definition
alone does not. Reconcile the baseline spec’s [question ledger](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L3599-L3658)
entries 1/3/4 (profile, vocabulary, limits) and corresponding requirements blockers
1/3/4 with dated amendments where the selected capability changes their scope.

### H2 — Which Resources can be resolved

**Context.** The motivating examples name Beads, but Links also have identities and
revisions. A historical Bead includes its owned Links as part of its own version.

**Options considered.** A: minimum capability covers canonical Bead and Link URLs uniformly.
B: Beads only, with explicit exclusion of independent Link-history retrieval.

**Selected: A (2026-09-09).** Canonical Bead and Link URLs both support complete
historical records. A resolver must not advertise uniform Resource history and
then silently return current Link state. A product lacking independent Link history
must not advertise this selected capability. A narrower capability would require
a separate future decision.

**Proposed wording:** “A version-addressed read identifies a canonical Resource URL
and one opaque revision. Success returns that Resource’s complete record at that
revision, including the Bead’s owned-Link state where applicable.”

**Edge/effect.** An owned Link changing produces distinct Link and source revisions;
either address resolves independently. Frozen inline Link records must not be loaded
from today’s graph. Owners: Resource reads and schemas; two category-specific fixture
families, adapter retention, and capability admission. No claim that #6358 meets this.

### H3 — Address and query combinations

**Context.** The [accepted-input record](https://github.com/gastownhall/bdp/issues/1#issuecomment-5464020140)
identifies `?revision=` retrieval as already ruled. H3 records that address
form and the ACKed method, query-combination, and refusal details;
it does not reopen the retrieval address.

**Selected scope (2026-09-09).** Use the ruled `revision` query on a canonical Resource
URL for full-record-only reads. A separate history target
or path is recorded as an alternative not taken, not as a live H3 option: changing
the ruled address would require an explicit amendment. A historical incident-Link
aggregate would require its own later representation, snapshot, and ETag contract.

**Selected: A.** `GET` and `HEAD` share it. Reject repeated `revision`, an empty
value, and combinations with `view`, `include` (including `include=links`), selection,
or pagination on this operation;
`view=versions` is H7’s separate operation. Use existing `invalid-parameter` for
malformed query use on canonical Resource URLs. Alias URLs gain no query semantics:
any alias URL carrying `revision` retains the ruled `404` `resource-not-found`,
under the ordinary authorization projection, just like every alias query
([Alias resolution, baseline](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2069-L2087)). Revisions are decoded once
as query data and remain opaque; do not impose checkpoint-token grammar on existing
opaque revisions. A later advertised verification scheme may select its own explicit
token grammar under H10 without narrowing the tokens already admitted by Read.

**Proposed wording:** “A canonical Resource request with exactly one nonempty
`revision` selects the complete retained state at that revision. It is never a
request for the nearest state. Unsupported or repeated query members are refused.”

**Consequences.** Resource routing, query parser, client escaping, invalid-parameter
fixtures, and the [Resource views](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1987-L2068)
query vocabulary. Add and capability-scope `revision` there when materializing the
ruled address. The selected unsupported-query handling requires a non-advertising
authority to refuse the unsupported parameter as `invalid-parameter`, consistent with the existing unsupported-query
rule, rather than ignore it and return current state; materialize this case in
the final contract. Positive test: a revision containing reserved URL characters round-trips;
negative tests: a twice-encoded spelling never aliases a different token, and
`?revision=r&include=links` refuses rather than mixing historical state with a
current incident-Link page. The current [aggregate and its ETag contract](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2025-L2068)
are not imported into a historical success.

### H4 — Historical authorization and complete owned state

**Context.** Ordinary reads hide unknown/deleted/non-visible identities. Historical
reads must serve retained deleted versions, while owned-Link closure and disclosure
rules must not expose hidden targets or partial state.

**Options considered.** A: for successful resolution, authorize the requested historical record
as a whole at request time, including its owned state, and refuse uniformly when that whole record cannot be
shown. B: redact the historical success, which violates complete-or-refuse. C: serve
according to acceptance-time authorization alone, which could bypass revocation.

**Selected: A for successful records (2026-09-09).** History authorization can permit a
deleted subject’s retained version; it is not equivalent to current Resource
visibility. Successful resolution must cover the whole historical owned closure.

**H4b selected A (2026-09-09).** A target satisfies that historical closure through
current visibility or explicit current permission to disclose its historical identity
and relationship. Source access alone never implies that permission, and this
permission grants no target body access. Exact authorization/wire materialization
remains work; authorities may not silently borrow current target existence to reconstruct old state.

**Proposed success wording:** “Before returning a complete historical record, the
resolver checks current authorization for that record and its complete owned state.
Failure of that success authorization produces uniform resource-not-found and does
not itself justify history, window, gap, or currency disclosures.”

That success criterion does not replace item 3’s ruled Bead-history authorization
gate for an Unretained refusal. A caller satisfying that gate may receive the selected
missing-state diagnosis without a partial record; a caller lacking it receives
uniform resource-not-found. Applying that gate must not require reconstructing the
absent owned set. An authorization failure is not evidence of Unretained. H2 now
selects independent Link-history coverage and H5 selects history-authorized diagnoses. Their exact disclosure materialization remains work; item 3 alone did
not supply a separate fixed Link refusal contract.
The fixed item-5 current-plane hidden-target/source closure still applies; choosing
historical-success permissions supplies no exception to current-plane closure or
to H12’s explicitly deferred alternative deleted-target lifecycle.

**Consequences.** Owning text: Authorization views, owned Links, historical reads,
and [Reads after deletion](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2088-L2125), including its dated amendment for History surfaces. Schema success remains whole.
Required cases include revocation,
deleted subject, a target hidden after citation, and an owned Link no longer live.
[T49 — Transactional alias targets](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/design/w1-transactional-packet.md#L7163-L7178) is now ruled as locator-only singleton receipts, while the incident-Link deletion proposal remains open;
this decision does not authorize dangling live Links or change DeleteBead.

### H5 — Typed refusal vocabulary and evidence for each answer

**Context.** The read problem table is closed. Existing `resource-pruned` and
`resource-erased` are usable only under their selected disclosure rules; a backend
failure is not proof that a revision never existed.

**Selected: core A (2026-09-09).** Keep the existing pruning/erasure codes and
select the following four diagnosis tuples. Memory-compat item 2 had already fixed
the read-side `revision-unknown` name; the ACK now selects its tuple and the three
additional rows. Meaning is scoped to this responder; another store may retain a
pruned version. `revision-unknown` is not proof of tampering or a promise of sync repair.

| Selected code | Family / status / retry | Evidence and response |
| --- | --- | --- |
| `revision-unknown` | not-found / 404 / after-state-change | History-authorized subject, syntactically valid revision, no retained state or known disposition; no assertion that later sync will change the answer. |
| `revision-unretained` | conflict / 409 / after-state-change | Known version, incomplete reconstructible record; typed missing diagnostics name missing properties and owned-Link sets, never a partial record. Exact diagnostic shape remains OPEN. |
| `revision-reorganized` | gone / 410 / after-state-change | Positive evidence that this responder lost that address through history replacement, not merely an unrecognized opaque token or epoch mismatch. |
| `revision-not-tracked` | conflict / 409 / after-state-change | Positive knowledge of non-participation, disclosed only under history authorization. |

The input's 410 Unretained tuple, collapsed participation diagnosis and `never`
alternatives were not selected. `after-state-change` requires a changed state or a
newly constructed request; it is not an instruction to poll, wait for sync, or
repeat a request indefinitely. Operator repair can be such a change. The selected
retry advice does not promise that repair or recovery exists, and does not prohibit
an administrator from restoring the same version at its unchanged address.
Existing pruning and erasure rows retain their current status/retry contracts;
erasure gains no condition-specific extensions.

H4’s selected whole-record authorization governs successful records. Unretained
Bead refusals retain item 3’s ruled Bead-history gate even when owned content is
unavailable. The selected History diagnoses use subject-history authorization;
existing 410 disclosures retain their single retained-history gate. An unauthorized
caller receives uniform resource-not-found without gaps or participation evidence.
Exact wire definitions and cross-profile disclosure wording still need
materialization; they must not require reconstructing missing state merely to apply
the refusal gate. Permission denial proves no retention gap. A backend timeout
remains a normative temporary failure, not one of these absence outcomes.

**H5b — sync-uncertainty carrier (ACKed A, 2026-09-09).** No
`mayChangeAfterSync` member initially. Use the selected retry semantics and explicit
uncertainty prose; neither promises recovery nor requires polling. Revision-2’s
proposed evidence-backed hint is deferred, with exact meaning and evidence required
before any later wire addition. HR06 exercises the selected absence of this member.

**Disposition evidence subchoices (OPEN).** For representation, choose durable
per-revision disposition records or another evidence structure that can positively
establish both the requested version and its removal reason. A minted-token digest
alone proves no removal reason unless its selected construction also establishes
that fact. Separately, item 1’s ruled historical-address contract requires the removed cited
version’s address to answer Gone with its reason under history authorization. This
is the gated History obligation identified against baseline `MAY` above, not a
retroactive strengthening of ordinary Read. Bounded storage must preserve that consequence
through sufficient evidence, or changing the answer to Unknown after state and
evidence expire requires an explicit dated amendment defining the diagnosis
guarantee’s duration. A tombstone budget alone does not select that amendment.
No particular lifetime storage mechanism is prescribed. Bounded versus lifetime
diagnosis is therefore an OPEN amendment choice where it changes that ruled promise,
not ordinary implementation discretion. H1b selects no advance age/count retention guarantees initially; it does not
select expiry of diagnosis evidence. Absence of a retained record is not
proof of pruning, and a retained record cannot be called pruned merely because token
allocation after recovery is uncertain (H9). The permanent TX erasure ledger is not
subject to a proposed shorter disposition lifetime.

**Refusal-window subchoice (OPEN).** The revision-2 input proposes a retained
window in `resource-pruned`, `revision-reorganized`, and `revision-unretained`
responses. Choose (a) no window in refusal bodies, with authorized enumeration
available through H7’s selected surface, or (b) an explicitly bounded window disclosure.
Option (b) must define its exact members, size, snapshot/completeness meaning and
the applicable refusal-disclosure authorization gate above, coordinate with H7 so
it is not an unspecified second enumeration
surface, and amend the existing `resource-pruned` condition-specific `archivedAt`
rule before adding a window there. H1b’s no-advance-guarantee selection does not decide this response window.
`resource-erased` gains no window or other condition-specific extension under
either option. No window policy is selected by carrying this input forward.

**Proposed wording:** “A resolver reports only dispositions it can substantiate.
Incomplete reconstruction is a refusal with no Resource record. Authorization is
checked before disclosing whether a revision is known, missing members, or untracked.”

**Consequences.** Problem table, closed code schemas, diagnostic shapes, client
classification, fixtures, and durable disposition storage. Materializing any of the
four selected history-authorization-gated rows requires amending the disclosure vocabulary in
[Reads after deletion](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2088-L2125) and
[requirements PROTO-013](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/design/requirements.md#L68-L77)
with dated markers alongside the problem table. Explicitly materialize the conversion
from baseline discretionary disclosure to item 1’s required Gone-with-reason response
for removed cited versions on the History surface, preserving uniform unauthorized
404 and ordinary Read’s separate scope. Do not require optional `archivedAt`. Per row: `revision-unknown` adds
the authorized 404 distinction under its already fixed name; `revision-unretained`
adds the 409 missing-state diagnosis; `revision-not-tracked` adds the 409 participation
disclosure; `revision-reorganized` adds the 410 removal reason and selected retry
advice. Each row touches those two disclosure homes, the problem table, and the
applicable problem definitions. For every selected profile, audit `readProblemCode`
and `readProblem`, `readUpdateProblemCode` and `readUpdateProblem`, and
`directProblemCode`, `transactionalProblemCode` and `transactionalProblem` in both
bundle copies, including family/status/retry branches and composed response
contexts. The `readUpdateProblemCode` and `directProblemCode` enums repeat Read
names; changing `readProblemCode` alone does not extend them. Do not widen receipt-only codes merely
because a new read failure exists. Expanding either sealed Read
definition changes the Read projection digest and requires a reseal; the names are
already in RP1’s sealed set, so this does not itself require a list change. New
supporting definitions would need the separate projection/coverage audit. Missing-set
names and JSON Pointer escaping need exact bundle definitions before implementation. No implementation starts with prose alone.
Also reconcile spec question-ledger entries 6/9 and [requirements blockers 6/9](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/design/requirements.md#L208-L243)
with dated amendments; their closed table and ordinary-read non-disclosure summaries
must distinguish the selected History surface. A new `revision-reorganized` signal
on Read+Update specifically requires H9’s restore-signal amendment; not every new
H5 code is itself evidence of a restore.

### H6 — Currency relations and caching

**Context.** The acceptance record specifically names RFC 5829 `latest-version`
and `successor-version`; revision-2 additionally proposes `predecessor-version`
and `version-history`. The core subset is now selected below; replacement target
semantics and exact wire materialization remain work.

**Options considered.** A: retain current private/no-store semantics and expose currency at the
responding store. B: cache historical bodies indefinitely and invent an independent
freshness/revocation channel.

**Selected: core A (2026-09-09).** Preserve `private, no-store` and the authority’s
existing validator projection. Use `latest-version` and retained direct
`predecessor-version`/`successor-version` relations only where authorized and truthful,
and `version-history` to H7’s selected enumeration surface. Selection does not
guarantee each relation always has an authorized, truthful target. H6/H7 replacement
navigation and the general validator encoding remain OPEN; omission is required
where no truthful target can be supplied. Do not call the next surviving entry a direct successor if intermediate versions are missing. The
relations report this responder’s knowledge at the response, never global freshness.
A deleted or undisclosable current state has no invented latest target.

**Proposed wording:** “A pinned body does not make its authorization or navigation
metadata immutable. Scope caching rules remain in force. Version navigation is
limited to authorized targets known to the responder.”

**Consequences.** Historical Resource response navigation, HTTP `Link` construction,
conditional responses and HEAD parity, client currency display, revoked-access and
stale-replica cases. ETag represents the Resource revision under the HTTP validator
projection; it is not necessarily the revision surrounded by quote characters.
Conditional handling must not skip authorization or erase
required navigation metadata. These registered relations describe Resource-version
navigation; they do not replace the Scope response’s `service-desc` machine entry
or invent BDP-specific duplicates of discovery navigation. The
[existing discovery paragraph](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1688-L1698)
does not close all Resource response relations. RFC 5829 defines navigation, not a
notification SLA.

**Validator encoding boundary (OPEN materialization).** The baseline [HTTP
consistency section](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1846-L1853)
already assigns Resource ETags; T15’s separate validator-encoding rule does not
make those optional or restrict opaque revision strings. The baseline
[server projection](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/packages/server/src/index.ts#L877-L916)
already emits strong tags, with collision-safe encoding for revisions that cannot
be quoted directly. That is implementation evidence, not a universally selected
wire encoding. H6’s ACK selects History parity against the authority’s existing validator
projection. A universally specified mapping remains a separate materialization
choice: adopt that mapping through the owning HTTP rule or select another explicit
encoding rule without changing opaque revision identity. Preserve the opaque
revision and test reserved characters, quotes and non-ASCII, including encoding
marker collisions; History must not invent an optional-ETag exemption.

### H7 — Retained-version enumeration

**Options considered.** A: `GET canonical-resource?view=versions` with cursor pagination over a
stable enumeration snapshot. B: address resolution only in the first capability,
with enumeration as a later independently advertised feature.

**Selected: enumeration A (2026-09-09)** on H1a’s selected profiles; option B’s
address-only first capability was not selected. H7 supplies input to the remaining
closed advertisement shape; it does not wait for that shape to be settled. Rows carry revision and retained
attribution without properties or owned payloads. A page reports its retained window
and explicit completeness; exact participation metadata remains part of the open
page shape. Ordering comes from the responder’s
authority order, never token spelling, wall-clock comparison, or storage ordinals
promoted to protocol positions. Internal ordinals may implement the order.

**Proposed wording:** “A versions page enumerates a stable retained window of the
Resource’s version history. Its cursor does not authorize disclosure or guarantee
that a listed version will remain retained for a later request.”

**Open subchoices.** Exact row/page members; whether erased versions have disclosable
metadata rows; lifetime of the ever-participated marker; limits and cursor expiry.
Also select enumeration at a deleted subject: permit an authorized caller to see
its retained window, or refuse that surface while exact retained addresses can still
resolve under H4. State the status/disclosure contract and include an unauthorized
caller in either case; H4’s resolution choice does not silently choose enumeration.
Selected pagination pins enumeration only, creates no retention hold, and fails
explicitly if it cannot honor that snapshot; exact cursor/limit/refusal details
remain OPEN. A latest link need not be a page member.

Revision-2 C1/§1 proposed reporting an operator/provider retention-policy hold in
the versions window. The later item-1 ruling says BDP carries no hold on the wire,
so that member is not carried forward. Local retention policy is not prohibited;
exposing a hold as BDP wire state would require an explicit amendment of item 1.
H1b’s no-advance-guarantee choice and H12’s administrative disclosure do not select such a
member implicitly. No hold-member vote is required to complete this selected surface.

History lineage branching/merge navigation is not inferred from importing Jim’s
store-local ordinals. The generic authority remains the selected single history.

**History replacement fork (OPEN, added 2026-09-08 council).** Start with
`r1 → r2 → r3`; restore the authority to `r1`, retain the old addresses for
`r2`/`r3`, then mint `r4`. Memory-compat item 4 requires retained exact addresses
to keep resolving (H9 materializes that law), but does not say which versions this
page enumerates. Choose between:
(a) enumerate only the current authority lineage, with completeness explicitly
limited to that lineage, while retained replaced versions remain directly
addressable; or (b) enumerate every retained version, with an explicit ordering
and membership model distinguishing replaced history from the current lineage.
The second option costs extra metadata and navigation rules; the first makes
address resolution broader than enumeration and must disclose that limit.
Enumeration is selected, but neither replacement-membership alternative is. The
selected surface therefore requires this follow-up before wire closure. H6 must
define its selected relations across replacement:
whether `predecessor-version`/`successor-version` can cross the boundary, which
`latest-version` target is meaningful for a retained replaced version, and what
membership `version-history` promises when its page might omit the source version.
Select the disclosure carrier too: explicit page membership/completeness metadata,
relation omission where no truthful navigation can be supplied, or a separately
specified response disclosure. Omit relations without truthful authorized targets;
selected enumeration does not itself determine a retained replaced version’s
relationship to that page. A page that silently excludes still-resolvable
versions does not disclose the limit. Never label `r4` a direct successor of `r3`
just because a storage ordinal is larger. All options preserve Memory-compat
item 4’s retained-address law and H12’s permanent erasure obligations.

**Consequences.** New page definitions, page/cursor fixtures, participation retention
budget, client iteration, `view=versions` and its capability restriction in
Resource views (the H3 destination), and a dated [Reads after deletion](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L2088-L2125)
amendment specifying deleted-subject enumeration. Coverage counts must be
authorization-relative and observed
consistently or omitted; global hidden-resource counts would leak information.

### H8 — HEAD and bulk address checks

**Options considered.** A: HEAD uses GET’s status and headers, no body; callers needing a typed
refusal use GET. B: new diagnostic response headers. C: a separate checking endpoint.

**Selected: A for the first cut (2026-09-09); bulk checks explicitly deferred.** HTTP status
alone cannot distinguish every selected outcome: several use 404, 409, or 410.
For an authorized caller in the retained/known-removal/unresolved subset, 200/410/404
do provide a useful coarse address check. They do not distinguish an invisible
subject from an unknown revision, or diagnose all H5 restrictions. Never advertise
that coarse check as the complete typed admission oracle, and never convert a 409
restriction into either Gone or Unknown just to fit three buckets.

**Proposed wording:** “HEAD performs the same authorization and resolution decision
as GET and omits the content. A caller requiring the problem code obtains the GET
problem representation. A check does not reserve retention or validate a later write.”

**Consequences.** HEAD parity cases, no body leakage, GET fallback in the client.
A future bulk check needs explicit limits, per-item outcomes and snapshot semantics;
it is not implemented as Transactional batch and cannot silently strengthen admission.

### H9 — Epochs, retained mappings, and selective loss

The survival law is already ruled by Memory-compat item 4. [Read and Read+Update
expose no Scope epoch](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1848-L1853);
their retained-address obligation cannot depend on a Transactional token or live
inside a section those profiles may skip. Both the main baseline
and the pinned TX Scope-history paragraph still need its dated materialization;
[T15 — history-token character profile](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L3231-L3243), RATIFIED 2026-09-08, preserves opaque revisions but does not itself repair epoch
fencing. The open
choice is the materialization and evidence required to report loss for an opaque
token. T29 independently fixes erasure-ledger survival across restore and rotation;
an erased version is not a surviving retained state eligible for successful resolution.

**H9a selected A (2026-09-09).** Put the common retained-address law in Revisions,
referenced by the History capability. Ownership in the History section was not
selected. No new wire epoch is introduced for Read/Read+Update. Separately replace the Transactional
Scope-history epoch paragraph with a dated amendment that distinguishes Resource-state
addresses from every other history-dependent token. Preserve exact old-address resolution for
surviving states; any internal mapping must preserve the requested revision externally,
not quietly return a newly minted revision. Keep graph `authority_epoch` separate from
issue-plane `store_epoch`; neither storage name is a new wire field by itself.

**Proposed common wording:** “Whenever a store retains a Resource version across
restore, destructive reinitialization, or authority replacement, its existing address
continues to resolve to exactly that state. No exposed Scope epoch is required to
preserve that address. A resolver that lacks proof of an opaque revision’s disposition
reports unknown rather than deriving loss from token spelling.”

**Selected narrow Transactional amendment (exact wording still to materialize).** Replace the entire
[Scope-epoch paragraph, TX lines 1094–1102](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1094-L1102),
from “Each Scope history” through “epoch.”, with a dated amendment. The main
baseline has the same paragraph at [lines 1040–1048](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L1040-L1048). Locate it by text and section in
the actual integration target; pinned line numbers identify inspected objects. The following
retains its epoch definition, restart/failover stability and trigger sentences:

> Each Scope history has an opaque, unguessable **Scope epoch**. The epoch
> remains stable across ordinary restart and failover that preserve identical
> committed history. It changes whenever restore, destructive
> reinitialization, or authority replacement may discard, rewrite, or replace
> history. The epoch is not part of canonical Scope or Resource identity.
> Retained Resource-version addresses follow the common retained-address rule.
> Every other history-dependent token remains fenced by that epoch, including
> Scope positions, transaction identifiers, snapshots and their handles, read and
> Event cursors, changefeed checkpoints, minimum-read barriers, receipts, and the
> idempotency-key namespace and its bound dispositions. This list does not replace
> the individual token contracts. Cached representations retain their epoch and
> Authorization View bindings under Authorization views. An epoch change within
> the same logical Scope preserves its canonical Scope and Resource URLs.
> Prior-epoch uses retain each token class’s existing handling: in particular,
> a prior-epoch idempotency key is unbound in the new namespace, so submission
> under the new epoch executes anew rather than replaying a prior disposition.

This narrows only blanket rejection of surviving Resource-version addresses;
it does not turn every prior-epoch token use into the same refusal. Preserve the
[Mutation Transactions key-namespace rule](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1210-L1220),
T15’s transaction-identifier class, and the individual token bindings/refusals.
Read/Read+Update retain their own continuation rules and do not acquire
Transactional epoch fields. The [existing view bindings](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L794-L802)
are additional amendment inputs. Reconcile the normative matrix’s
[`transactional.restore.epoch-fence`](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5682-L5684)
with the retained-address exception; retain `transactional.restore.key-namespace`
and `transactional.http.token-profile`. The successor #20 ACK head still carries
[those rows](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/specs/bdp.md#L5762-L5764),
so a future apply must locate them by row ID rather than stale line number.

**Read+Update restore-signal materialization (required; wording OPEN).** Its [closed restore description](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L3644-L3649)
says there is no exposed epoch and no restore signal beyond `resource-not-found`,
`revision-mismatch`, and `idempotency-expired`. H1a’s selected all-profile capability plus H5’s
selected `revision-reorganized` conflicts with that list. The ACK requires an
explicit dated History-capability exception there before implementation. Withholding
the selected diagnosis on Read+Update or excluding the profile was not selected.
Retained-address survival alone did not require a new restore signal; the combined
ACK now requires this materialization, preserving Read+Update’s logical-Scope and
identity-preservation rule without introducing an exposed epoch.

**Alternative not selected.** A new client-visible History epoch and token
provenance mechanism is not introduced. It is unnecessary to preserve retained
addresses. A `revisionScheme` change cannot silently rebind an old address.

**H9c — scheme-change disclosure (ACKed A, 2026-09-09).** Initially serve the
requested-token historical record without an extra current-scheme address. The
record’s `revision` preserves the requested token and uses H6’s selected authority
validator projection. Revision-2’s additional mapping carrier is deferred. Retained
internal mappings must preserve old-address resolution; they are not new wire state.

This selection does not settle whether two tokens identify one state versus one
revision identity, replacement navigation or the boundary with write
`expectedRevision`. A current token must not silently replace the requested token
or authorize a current write merely because an old address resolves. Any future
extra mapping carrier needs explicit identity/validator/navigation/write-guard
semantics consistent with item 4; dual reporting alone would not settle them.

**Recovery/allocation proof subchoice (OPEN).** A post-restore mint must not bind an
existing retained address to different state. This is already required by item 4,
not a new lifetime-unique-token rule: a content-derived scheme may use the same token
for the same state. Choose how the realization proves safe allocation after recovery:
(a) preserve enough durable allocation/binding evidence to check prospective tokens,
or (b) use a token construction and retained-state verification that establish the
same non-rebinding invariant without prescribing a particular registry. State the
restore prerequisites, collision handling, and proof obligations of the selected
scheme. If safe allocation cannot be established, refuse the unsafe new mint; never
rebind the retained address or invent a `resource-pruned`/loss outcome for state that
is actually retained. Selecting the exact refusal path remains work with the write
profiles; historical reads must still resolve the retained state under item 4.

**Consequences.** Common retained-address text in the selected profile-neutral home,
a dated replacement in Transactional Scope history, and historical-resolution cases for
retained/lost/unknown versions across restore, mixed old/new addressing, and cursors.
Include both normative restore rows, transaction identifiers, key reuse as a new
execution, and the selected scheme-mapping record/validator/navigation behavior.
Include an erased version whose address survives as lineage but whose content must
remain unavailable after restore; apply the permanent ledger to old retained copies.
The after-restore write-guard treatment of an old revision needs an explicit boundary
with the write profiles; it is not settled by a historical GET succeeding.

### H10 — Token, witness, bytes, and numeric planes

**Context.** Jim’s #6358 stores JCS bytes in a LONGBLOB and has product-specific
version contents. It names `version_id` as the durable-address design and ordinals
as store-local, but explicitly defers migration 0068 steps 1–5 (including the UUID
primary-key/address reshape). Its current writer is documented as single-writer-only
until that swap lands. This is selected design plus partial implementation, not proof
that the durable-address migration or a historical resolver has shipped.
BDP’s ordinary record is a different representation. Never claim those bytes are
identical, or that an internal content hash is automatically the BDP revision.

**Options considered.** A: first-cut History uses existing opaque revisions and ordinary complete
records; keep optional verifiable representations/witnesses as an explicit second
tranche. B: now define a separate exact-byte version payload with the self-token
outside the hashed payload, media/encoding rules, metadata and ancestry boundaries,
and an independently named response digest. C: specify a value projection and its
canonicalization; this is not verification of the entire body as received.

**Selected A (2026-09-09): opaque revisions and complete ordinary Resource records
initially; exact-byte witnesses are deferred to a later tranche.** The ACK does not
select that later tranche’s envelope, witness scheme or failure tuple.
The per-Bead versus repository chain distinction and advertised verifiability remain
accepted inputs, not a mandated scheme. Do not modify the closed Pinned Reference
shape to add `digest` before that tranche is ruled. Never silently change `sha256-jcs`
to mean arbitrary stored bytes or exact-decimal canonicalization: #21/#23 fixes that
name in the revision-token context. Separately, TX T18’s erasure `digest.scheme` is
`sha-256-jcs`, over the complete erased Resource record (with attribution/owned Links,
without the `links` aggregate). These are separately ruled spellings in distinct
contexts, not interchangeable wire values. HR12 checks a declared revision-token
scheme; HR15 checks the TX erasure digest as `sha-256-jcs`. This packet selects no
History witness scheme and does not unify the names; unification would require a
future ruling in their owning contexts.

**Proposed wording:** “Historical resolution preserves the Resource’s opaque revision.
A successful read does not by itself advertise a content-verification scheme. Token
schemes, when advertised, name their exact representation and numeric discipline.”

**Consequences.** This avoids a circular hash and a false interoperability claim in
the first cut. It delays independently verifiable citation bytes; state that cost to
Memory consumers. The following tranche must settle self-token exclusion/envelope,
content encoding, Authorization View binding, parents/serialization version, witness
placement, erasure digest linkage and multi-replica tests before its implementation.
The input’s optional witness-failure name `revision-mismatch` at 412 collides with
[the ruled Read+Update 409 code](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L2227-L2240)
for an `expectedRevision` conflict. Queue a distinct witness-failure name and exact
wire tuple; do not silently reuse that name, reclassify write conflicts, or widen
Read status enums before the witness tranche is ruled. Reusing it would require an
explicit amendment of the existing code’s contexts and dependent conformance rows.

**Stored-value boundary (OPEN integration contract).** #23’s numeric refusal is a
mutation-admission rule, not proof that every imported historical store was admitted
under it. [T56](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L7285-L7299)
records the adapter map-or-refuse stored-value boundary; its then-provisional T56
was subsequently ACKed A in the current operator ledger. That admission/integration rule
cannot authorize rounding, dropping or substituting an already version-addressed
BDP record while claiming the same historical state or witness. H2/H10 must identify
the original BDP representation and selected numeric scheme, then define the refusal
and diagnostic path if it cannot be served faithfully. A product-to-BDP mapping
established before allocating the BDP revision is a different boundary; product JCS
writer rounding does not prove a generic historical resolver changes BDP state.
If a realization needs such a mapping, define its identity/provenance before claiming
History. Otherwise refuse an unservable version; the exact wire outcome remains
open, and is not automatically `revision-unretained`, pruning, or erasure.
A value-preserving serialization change is not the same as a value-changing map;
any exact-byte witness must separately cover the representation it actually names.

### H11 — Change context beyond existing attribution

**Options considered.** A: first cut carries the exact existing per-version attribution, including
absence; assisting agent, acceptance time, message and import provenance wait for a
separate generic change-context envelope. B: define that envelope now without
expanding `attribution` or changing no-op semantics.

**Recorded input and owner.** [Memory #5877 R12](https://github.com/gastownhall/beads/issues/5877)
requires responsible actor, assisting agent when present, timestamp, and change
message when present as a Memory capability requirement on shared History. The
[History revision-2 input, §7](https://github.com/gastownhall/bdp/issues/1#issuecomment-5573074065)
maps these onto BDP’s carried attribution and proposed separate change-context fields.
Chris Sells owns that Memory requirement. Its primary R12 text was read from the
supplied issue record for this fold: Change Attribution and editable Inception are
distinct, and change context alone does not create a version. Donna has now selected
the first-release metadata scope below; this does not claim full Memory compatibility.

**Selected B (2026-09-09).** Define a distinct immutable change-context envelope
now so that the existing attribution and distinct context together meet Memory R12’s
metadata requirement: responsible actor, assisting agent when present, timestamp
and change message when present. Preserve existing
attribution and truthful absence/undetermined states; do not fabricate an actor,
agent, time or message. The envelope is separate from `attribution` and `properties`,
and changing only context on an otherwise unchanged write creates no version.
Neither attribution nor context claims authentication or authorization. Exact
members, supply states and cross-surface wire placement remain to be defined.
This metadata selection alone is not full Memory compatibility, particularly while
exact-byte witnesses and surviving-citation lifecycle behavior are deferred.

**Proposed wording:** “Historical records carry the attribution
recorded for that version, unchanged. Absence is distinct from an unknown principal.
Import provenance and assisting-actor context do not assert authenticated authorship.”

**Consequences.** Define supplied/absent/undetermined semantics for each new
field, immutable acceptance context, exact wire names, no-op exclusion, and schema,
write-input, Event and history-list fan-out. Existing `claimed|unknown` is not reopened.

### H12 — History erasure boundary and incident-Link deletion

**Context.** Ordinary deletion, retention, and erasure remain different operations.
The input’s surviving-citation requirement cannot by itself change the refusal to
delete a Bead with live incident Links. The TX reconciliation now removes choices
that T19/T25–T31 already settled; H12 remains OPEN for the History-specific boundary
and administrative scope, not for a second erasure mechanism. H12a now preserves
the existing incident-Link deletion refusal initially, deferring the alternative
Memory surviving-citation lifecycle.

**Fixed TX constraints.** Erasing an owned Link revision erases every source version
that inlined it, with a separate erasure record for each in the same group. A store
processing a record removes its erased content from every held copy before making
further state visible, retains only the permitted lineage evidence, and applies the
selected history-authorization disclosure. A live affected Resource needs a successor
or tombstone in the same group, preserving endpoint liveness and owned-state agreement.
A restricted-but-unerased containing version is no longer an alternative here, and
no successful historical record may omit embedded bytes or change them under its old
revision. Embedded Link content is distinct from a non-owning reference to a target;
erasing target content alone does not invent reference retention or rewriting.

T28 already requires a replica behind erasure position P to resnapshot at or after P;
older checkpoints and snapshots expire in each view receiving the record. T29 keeps
the authority’s ledger for the logical Scope’s lifetime across restore, epoch rotation,
and view rotation; each snapshot manifest projects it for its view. Installing a replacement generation applies that ledger to old
retained groups, Events, receipts, indexes, caches, and other held copies. A replica
unable to establish a retained copy’s erasure status must discard it. Restore
re-emits the projected ledger before other groups in the new epoch. Missing an old
feed announcement or rotating an epoch is therefore not permission to serve an
erased copy. These duties are fixed constraints on any applicable History surface;
this packet neither relaxes them nor claims a runnable History proof.

**Remaining erasure choices.** Determine how an optional History-only resolver and
its consumers establish these obligations without assuming Transactional replication
from a read capability (H1); define stale-import admission and the evidence it checks;
and select what conformance actually proves across supported reads, cooperating
replicas/caches, and provider history. The existing store obligations must remain
intact within their applicable scope. Do not reinterpret an open assurance or
capability boundary as permission for an obligated store to retain erased content.
[T64(a)](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/design/w1-transactional-packet.md#L7477-L7506)
now fixes caught-up live-stream delivery through atomic eligibility/fence/publication;
lagging streams and finite/reconnect requests retain T28’s fence. Its normative
[Version erasure rule](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/specs/bdp.md#L5128-L5150)
is a constraint where applicable, not a History choice or a runtime delivery proof.

**Administrative disclosure input (OPEN scope choice).** Revision-2 §3 proposes
that an operation stopping published addresses from resolving reports the affected
addresses before acting; §8 also proposes actor disclosure. Choose whether such
local operation disclosure belongs to the required History surface or a later
administrative surface (explicit deferral is an option), which authorized
administrator/requester receives it, and whether actor information is included.
Coordinate the selected contract with H5’s diagnosis evidence and H1b’s advertisement.
Comment 5464020140 accepts the Gone/Unretained history-authorization direction;
it does not select this exact pre-action administrative mechanism. The same input
says retention removals are not announced, and [PROTO-013](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/design/requirements.md#L75-L77)
forbids retention propagation. Local disclosure is therefore distinct from broadcast
or changefeed notification. No retention mutation endpoint or notification contract
is selected, and a deferred surface cannot be claimed as an implemented assurance.

**H12a selected A (2026-09-09).** Keep the current incident-Link deletion refusal
initially. Explicitly defer Memory’s surviving-citation lifecycle behavior; basic
History does not claim that compatibility. Whether and how a live citation can later
survive target deletion without changing its source’s owned state or violating
endpoint liveness remains a deferred design question. Alternatives considered:

- Check endpoint liveness at creation and introduce a per-Link-Type policy controlling
  whether an existing Link requires its target to remain live. This separates source
  ownership from target liveness but adds a new policy surface.
- Exempt Links owned by their source from blocking target deletion. This is smaller
  but couples the source-versioning declaration to a target-liveness rule.
- Preserve the current refusal and explicitly limit the Memory mapping until a later
  lifecycle design; this delays the requested surviving-citation behavior.

**Deferred lifecycle fork (not part of the initial surface).** The first two alternatives are blocked on
an explicit endpoint/visibility model; they are not local DeleteBead exceptions.
Current [Authorization views](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L771-L792)
require every visible Link’s in-Scope endpoint Beads to be visible, and a visible
source cannot filter its owned Links, as fixed by item 5 despite its properties
amendment. This current-plane hidden-target closure is distinct from H4’s historical
success permissions and the deferred deleted-target model here. Hiding the entire source
with its Link could
preserve closure, but would not deliver the intended still-readable source/citation
behavior. Keeping it visible with an absent endpoint would violate the
[snapshot and group agreement rule](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4895-L4914).

For either non-default alternative, first decide whether a deleted target has an
explicit identity/visibility state that closure can include, whether a separately
ruled endpoint model changes the treatment of deleted targets, or whether neither
change is acceptable and the current refusal remains. No candidate permits
reinterpreting an in-Scope URL as an opaque external reference by implementation
policy. The chosen model must supply one consistent rule for Resource reads,
owned-state projection, snapshots, and groups; simply omitting an endpoint from a
snapshot is not a valid solution. Required amendment destinations, if changed, are
Authorization views, Owned Links, [requirements PROTO-011](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/design/requirements.md#L51-L60), endpoint liveness and
DeleteBead, Scope snapshots/group agreement, and the
[live-erasure validity rule](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5017-L5032).
[T31’s administrative deletion rule](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4826-L4837)
is included in the fixed T19/T25–T31 set; none is changed without an explicit dated ruling; ordinary
retention or target deletion does not authorize an erasure exception. Conformance
must exercise a still-visible source with a deleted target and snapshot/group
agreement if a later alternative model is selected. The initial surface instead
checks the retained incident-Link deletion refusal and current hidden-source closure.
Preserving that refusal requires no lifecycle amendment and preserves the stated
Memory cost.

**Remaining decision scope.** Preserve the ruled TX constraints and decide the
remaining History assurance/applicability, stale-import and administration questions
explicitly. The initial incident-Link refusal is selected; alternative lifecycle
behavior is deferred. A historical success or a
`resource-erased` refusal alone proves neither erasure recovery nor physical purge.
The [later operator ACK record](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/design/w1-transactional-packet.md#L7570-L7595)
closes T49/T63/T64. Its then-open T62 contract and provisional queue are historical:
Donna subsequently ACKed T50–T56 A, T57 B, T58–T61 A, T62a/b A and T65 A,
as recorded in the current ledger linked above.
Those separate ACKs supply no History defaults and are
not materialized by this documentation-only History fold.

**First adversarial case.** Disconnect a Transactional consumer; erase a version;
expire its checkpoint; reconnect via a fresh snapshot; check the ledger against all
old retained copies before exposing the replacement generation. Repeat after restore
and view rotation, including inability to obtain a prior view’s ledger. Those expected
duties are fixed. Attempt a stale reimport separately: its admission contract and the
History-only variant remain unruled, so they cannot receive an invented passing result.

## Conformance plan — proposals, not catalog entries

No scenario here is claim-eligible. After rulings, assign stable catalog IDs, exact
schema assertions, applicable capability rules and fixtures; create the manifest,
runner realization and packaged evidence before advertising support. The following
observable cases are the minimum review checklist, not a hand-maintained required set.
Materialization must also amend the baseline [Normative conformance matrix](https://github.com/gastownhall/bdp/blob/0b7d86e7cfec47f88cd1ec22314a73f39763bcf8/docs/specs/bdp.md#L3563-L3588)
coverage categories and profile/capability applicability, alongside the stable
catalog rows. Update H9’s contradictory restore row rather than leaving prose and
matrix expectations opposed. This packet supplies neither normative categories
nor executable acceptance evidence.

| Case | Positive proof | Refusal or adversarial proof |
| --- | --- | --- |
| HR01 negotiation | Complete capability discovered at allowed profiles; selected participation counts/class are authorized and consistent, or honestly omitted | Absent/partial capability never advertised or guessed; complete surface never implies universal Resource participation or reveals hidden counts |
| HR02 exact resolution | Bead and Link old revisions return complete selected records | Current/nearest substitution and value-changing mapping under an already bound revision rejected; unservable imported values follow the selected explicit refusal |
| HR03 owned state | Old source includes its historical owned records | Missing owned set refuses whole answer; history-authorized Bead caller receives the selected Unretained diagnosis despite absent owned content; current Link lookup caught |
| HR04 attribution/context | Historical claimed/unknown/absence and selected immutable R12 change context preserved under the eventual envelope | Current writer, fabricated context/authentication, and context-only version creation rejected |
| HR05 authorization | Authorized deleted-subject history can resolve under the selected successful-record model, with current target visibility or explicit current historical identity/relationship permission; incomplete Bead refusal uses the fixed subject-history gate | Failed success authorization does not manufacture Unretained; caller lacking Bead-history authorization gets uniform 404 without gap disclosure; source access never supplies target permission or grants target body access |
| HR06 dispositions | On the selected History surface under the applicable history-authorization gate, selected durable evidence substantiates pruned/erased/unknown/unretained outcomes for its stated lifetime | Mere absence never proves pruning; expiry to unknown requires absent state/evidence and an explicit amendment where it ends item 1’s Gone-with-reason promise; fixed Bead-history Unretained gate and selected other gates apply with no mayChangeAfterSync member initially and no promised sync recovery; storage timeout and unsafe allocation never fabricate loss; refusal windows follow H5’s selected bounds/authorization, with none on erased refusals |
| HR07 addressing | Escaped opaque token resolves exactly | Malformed/repeated/mixed revision, including include=links, on a canonical Resource gives invalid-parameter; an alias revision query gives the ruled 404 resource-not-found; non-advertising authority exercises the selected unsupported-query refusal |
| HR08 HEAD | Status and permitted headers, including the authority’s projected revision validator, match GET; body empty | Client never treats status alone as a full typed absence diagnosis |
| HR09 enumeration | Stable paginated window, declared order and explicit current-lineage/all-retained membership after history replacement | Restore r1 after r1→r2→r3, retain r2/r3, mint r4; verify selected membership/completeness and deleted-subject enumeration under authorization; concurrent pruning yields selected refusal and no retention hold |
| HR10 currency | Selected authorized responder-relative relation subset honors the replacement boundary and disclosure carrier; version-history requires H7 enumeration | No undisclosed version-history membership gap, invented latest target/global freshness, or false direct r3→r4 relation after restoration |
| HR11 restore | Surviving unerased old address resolves unchanged on every advertised History profile without adding epoch fields to Read/RU; permanent ledger still applies to obligated old copies | Post-restore ordinal reuse attempting to bind a retained token to different state is refused without rebinding or fabricated loss; all existing TX history-token classes remain fenced at existing restore/reinitialization/replacement triggers, including transaction identifiers and new-epoch key execution rather than replay; requested-token record and its authority-projected ETag are preserved without extra current-scheme address initially; erased content stays erased; loss requires evidence |
| HR12 numeric/token boundary | Declared revision-token scheme (including sha256-jcs when selected) and admitted values honored | Issue/graph serialization or ordinal mistaken for identity detected; revision scheme name never substituted for TX erasure digest.scheme; out-of-contract historical values are not rounded under their old identity; witness mismatch never silently redefines the existing 409 revision-mismatch |
| HR13 erasure recovery | For a Transactional consumer, T28 resnapshot and T29 projected-ledger cleanup cover old copies across restore/view rotation before publication; T64(a) governs eligible caught-up live delivery | Pre-P checkpoint/snapshot and lagging-stream continuation refused; live/disconnect races follow T64(a), not a finite-replay exemption; unestablishable retained content discarded; stale-import admission and History-only applicability remain unruled |
| HR14 product differential | Memory behavior compared through its public interface | A product-only harness result is never counted as BDP HTTP conformance |
| HR15 embedded erasure | T19 emits a same-group erasure record for the Link revision and every source version embedding it; T18 uses sha-256-jcs over each complete erased record; T25/T26 cleanup and authorization apply | Probe all historical and retained copy paths, including receipts and snapshots; no erased bytes, partial success, or old-token rebinding; any affected live version gets a valid successor or tombstone |

The RFC navigation definitions are [RFC 5829 §3](https://www.rfc-editor.org/rfc/rfc5829.html#section-3).
JCS’s numeric serialization is [RFC 8785 §3.2.2.3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2.2.3).
These sources establish those standards’ rules; Donna’s dated ACK establishes only
the selected BDP cores above, with the remaining choices still OPEN.

## 2026-09-08 reconciliation with the applied Transactional draft

This is a source reconciliation after release of the initial exclusion, not a new
ruling or council clearance. At that reconciliation H1–H12 all remained OPEN;
the 2026-09-09 ACK above subsequently selected eight cores with deferrals. The initial review record is
preserved, with its containing-version fork superseded by the verified T19 ruling.
That reconciliation edited only this packet and its review record; the complete
branch also includes their design-index entry. No normative, schema, catalog,
implementation, fixture, or evidence artifact changes.

The following anchors pin the inspected #20 head, not a moving branch. The
specification is the owning protocol text; the packet links establish the recorded
ruling behind it. They do not promote the design packet into normative authority.

| Verified constraint | Owning text at `1eef4e4` | Recorded ruling / effect here |
| --- | --- | --- |
| Owned-Link erasure reaches containing source versions; live versions need valid successors/tombstones | [Version erasure, lines 4982–5032](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4982-L5032) | [T19, lines 4685–4702](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4685-L4702); H12/HR15 no longer reopen containing-version disposition |
| Content and copy-path obligations, with authorized disclosures | [Version erasure, lines 4976–4980](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4976-L4980) and [lines 5034–5071](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5034-L5071) | [T25/T26, lines 4717–4747](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4717-L4747); HR13/HR15 cover held copies without inventing a weaker History default |
| Pre-P checkpoint/snapshot expiry and fresh bootstrap | [Version erasure, lines 5073–5082](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5073-L5082) | [T28, lines 4763–4789](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4763-L4789); HR13 recovery expectations fixed; live-delivery T64 was open at this pin and is superseded by the later ACK record |
| Permanent ledger, old-copy cleanup, restore re-emission, discard if status cannot be established | [Version erasure, lines 5084–5100](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5084-L5100) | [T29, lines 4791–4810](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4791-L4810); H9/HR11 distinguish surviving address from erased content |
| Distinct revision-token and erasure-digest contexts | [TX digest, lines 4957–4974](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4957-L4974) and [#23 revision scheme, lines 656–661](https://github.com/gastownhall/bdp/blob/2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7/docs/specs/bdp.md#L656-L661) | [T18, RATIFIED](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4671-L4683): erasure uses `sha-256-jcs`; #21/#23 revision-token context uses `sha256-jcs`; H10/HR12/HR15 keep the input domains and wire names distinct |
| Retained addresses survive epochs, while current text still fences revisions | [Scope history, lines 1094–1115](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1094-L1115) | [Memory-compat item 4](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982); H9 retains the dated-amendment obligation and opaque-token loss-evidence question |

The earlier [three open erasure questions](https://github.com/gastownhall/bdp/issues/12#issuecomment-5570349470)
are historical input: T28/T29 subsequently select the Transactional missed-announcement
and durable-ledger mechanisms. They do not by themselves settle every stale-import
admission rule, optional History capability boundary, or provider-history proof.
No expected result for those remaining choices is inferred from the reference runner.

## Remaining decision inventory after both ACKs

The selected cores are not reopened. The following choices already appear in the
owning sections and remain independent of the sixteen recorded answers. Exact wire
materialization must follow their outcomes; implementation evidence is a separate gate.

| Owner | Remaining choice | Fixed or deferred boundary |
| --- | --- | --- |
| H1 | Exact closed capability advertisement; participation counts, a defined coverage class, or omission, with categories/consistency | All-profile placement and no advance age/count retention guarantees are selected; no wire hold |
| H5 | Disposition-evidence representation and positive proof; missing-member diagnostic shape | Substantiated outcomes, the four tuples, history gates and no initial sync hint are selected; absence does not prove removal |
| H5 | No refusal-body window versus a bounded, authorized window and its completeness/size contract | No resource-erased extension; observed window is not an advance retention guarantee |
| H6/H7 | Replacement history membership, truthful navigation across replacement and disclosure carrier | Enumeration and authorized relation subset are selected; retained old addresses keep resolving and storage order is not lineage |
| H7 | Deleted-subject enumeration permitted under history authorization versus refusal | Authorized exact-address resolution and unauthorized non-disclosure remain separate |
| H7 | Exact row/page participation and completeness fields; erased-version metadata disclosure; ever-participated marker lifetime | Revision/attribution without payload and a stable observed window are selected; no erased content or hidden-resource oracle |
| H7 | Cursor/limit/expiry and inability-to-honor-snapshot response contract | Cursor pins enumeration without holding versions; authority order is fixed |
| H9 | Recovery/allocation proof and unsafe-mint refusal with write profiles | Retained-address non-rebinding is fixed; no lifetime-unique token or mandatory registry selected |
| H9 | Old/new token revision-identity/equality and write-guard boundary after restore | Requested-token historical record and no extra mapping initially are selected; a successful old read does not authorize a write |
| H10 | Imported stored-value mapping boundary and exact refusal/diagnostics for unservable BDP versions | No value-changing map under an already bound revision; opaque ordinary records initially |
| H11 | Exact immutable envelope, supplied/absent/undetermined states and cross-surface placement | R12 metadata now, truthful absence, no-op behavior and no authentication/authorization claim are selected |
| H12 | History-only assurance/acquisition and stale-import admission evidence | Existing TX erasure duties and T65’s Event-consumer claim route are not reopened; History does not imply TX replication |
| H12 | Initial versus later administrative pre-removal disclosure, recipient and actor scope | No retention broadcast, new hold state or implicit mutation endpoint; initial incident-Link deletion refusal remains |

H5’s possible bounded diagnosis that would end Gone is an **explicit amendment
request if desired**, not a required vote on the already ruled Gone duty. General
validator-encoding materialization remains separate under H6’s selected existing-
authority projection. Exact-byte witness representation/scheme/failure, extra scheme-
mapping disclosure, a sync-hint member, advance retention guarantees, bulk checks and
Memory’s alternative surviving-citation lifecycle are explicitly later work. Their
deferral does not promise the missing capabilities or require deciding them for the
initial surface. No item in this inventory selects an answer.

## Implementation and evidence work after rulings

1. Apply the recorded H1a/H2/H3/H4 and H5/H6/H7/H8 core selections with their
   explicit deferrals. Resolve the remaining detailed choices in eight-item batches;
   the remaining H1 advertisement shape follows H2–H9, H6/H7 replacement navigation is joint work,
   and the required Read+Update restore-disclosure amendment precedes implementation.
   Materialize H11’s selected distinct change-context envelope against Memory R12;
   do not treat that metadata selection as full Memory compatibility. Materialize protocol text,
   exact bundle shapes (both copies), problem rows and
   illustrative fixtures together; record dated amendments to prior wording.
2. Add the History catalog and manifest with derived applicability/coverage. Build
   the server/client variants through the existing generic Scope-port seam, then
   retain versions in the in-memory adapter. No new HTTP-shaped adapter interface.
3. Give each other realization an honest capability boundary. Jim’s issue writer,
   graph P0, and `bdpbd` do not automatically satisfy Resource History. Preserve
   BDBD-003 (advertise only guarantees preservable over `bd`) and BDBD-001
   (use the supported public CLI and documented output, not private database reads).
4. Use Steph’s adoption harness as external product differential evidence. Reported
   input, source tree not independently inspected in this pass:
   [`sjarmak/mem`, `docs/adoption-harness/` at `19763909b5a212922730f2273f77b8a09535bd7f`](https://github.com/sjarmak/mem/tree/19763909b5a212922730f2273f77b8a09535bd7f/docs/adoption-harness),
   reportedly on `adoption-harness-share`. Verify that pin and interface before use.
   The [recorded Q30/A10 solo-topology ruling](https://github.com/donnabox/agent-coordination/blob/ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368/context/janet/beads-workstream-state.md#L684)
   is verified as an operator record. Check the harness’s reported embed-and-isolate
   deployment against the actual graph contract; this is not an authorization for
   embedded BDP serving or a claim that the uninspected harness satisfies A10.
   Capture target heads, commands, fixtures and outputs when it is actually run.
5. Reseal when sealed Read definitions, Read catalog/manifest, or bound verification
   inputs change. The current #24 seal does not preapprove a new History schema.
   Later implementation needs negative gate tests, packaged launches, honest
   applicability and provenance, and exact-head CI/review before release.

## Review and completion predicates

- Draft complete when sources, fixed constraints, numbered forks, draft wording,
  destinations, evidence effects and adversarial cases are present.
- Council reviews this packet against the pinned authorities, distinguishing missing
  decisions from implementation bugs. Record each finding and its fold; do not mark
  any recommendation ruled because reviewers prefer it.
- Wire ready only when Donna’s rulings and every required schema/problem/fixture
  artifact exist and the cross-profile reconciliation is complete.
- Implemented only when public HTTP scenarios execute for the target. Claimable only
  when the required set is derived and its evidence gate verifies the packaged target.
- Review status and finding dispositions are recorded in
  [History packet review](./history-profile-review.md). Two earlier partial councils
  were followed by fresh native Codex and Gemini reviews of `ef6e997`, each with no
  findings, and a completed Claude review reporting 1 High, 7 Medium, and 5 Low.
  At the next head, `9c93b0e`, native Codex and Gemini again reported no findings;
  Claude returned 3 High, 5 Medium, and 4 Low. The subsequent author fold records
  all twelve dispositions. At `195071d`, native Codex and Gemini returned no
  findings; Claude returned 2 High, 10 Medium and 5 Low, folded at `9cc4cf4`.
  At `9cc4cf4`, native Codex and Gemini returned no findings; Claude returned
  1 High, 5 Medium and 3 Low, folded at `297465d`. Native Codex then reviewed
  `297465d` with no findings; the later Claude report returned 1 High, 2 Medium
  and 3 Low. The review record contains their bounded scopes and six dispositions.
  This subsequent operator-ACK/documentation fold requires its own review.
  No completed review clears later edits or supplies an operator ruling. No History tests, harness
  trial, or conformance run is claimed by this document.
