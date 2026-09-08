# History resolution decision packet

Status: **draft for council and Donna’s rulings; non-normative; not implemented**.
Prepared 2026-09-08. Plan of record: [gastownhall/bdp#1](https://github.com/gastownhall/bdp/issues/1).
The word “History” names this design lane, not a selected fourth `profile` value.

This packet turns the historical-resolution proposal into bounded decisions.
It proposes no edit to the normative specification, schema, catalog, or evidence.
A recommendation is not a ruling. Existing rulings below are constraints, not
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

Pending changes were checked against their remote heads:

| Input | Head | Relevance |
| --- | --- | --- |
| BDP #20 | `1eef4e439629e247e9055ef8e42045acbea66b75` | Ruled TX erasure constraints, checked in the dated reconciliation below; open T49/T62–T64 and provisional T50–T61 remain unselected |
| BDP #19 | `06ebabdb391d8ea730295f4e01ed00bc1206fe38` | Ruled Read+Update wire decisions; no write implementation claim |
| BDP #22 | `c201cc28f74c6f71212aaf7f25966aabf55fb97e` | Wildcard ownership and opaque properties |
| BDP #23 | `2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7` | Exact-decimal equality, admission, named numeric models |
| BDP #24 | `87de37f673f83ec54989fdff4891bacc05730ea6` | Sealed definition projection; separate coverage-check judgment pending |
| Beads #6358 | `c8995b58c00d4407f49af13c6cb3330d903a2988` | Issue-plane version writer; product evidence only |
| Beads #6422 | `ec692e146ad2a879d1c6819ecc8bf786597d617b` | Graph P0; subsequent History/serving implementation remains work |

**Initial Transactional exclusion ended 2026-09-08.** The initial packet and its
first council excluded the TX apply. After Donna released that hold, the read-only
reconciliation below checked the applied TX specification and its recorded rulings
at the pinned #20 head. That draft PR is not merged or a conformance claim. Its
remaining choices and provisional ratifications are not History defaults.

Primary records:

- [History proposal revision 2](https://github.com/gastownhall/bdp/issues/1#issuecomment-5573074065): input, including withdrawn earlier positions.
- [Accepted inputs](https://github.com/gastownhall/bdp/issues/1#issuecomment-5464020140): currency relations, per-Bead versus repository chain distinction, erasure propagation gap.
- [Memory-compat rulings](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982), followed by the [properties amendment](https://github.com/gastownhall/bdp/issues/1#issuecomment-5587346463).
- [Numeric ruling](https://github.com/gastownhall/bdp/issues/21#issuecomment-5586406564).
- [Open erasure questions](https://github.com/gastownhall/bdp/issues/12#issuecomment-5570349470).
- [Jim’s writer](https://github.com/gastownhall/beads/pull/6358) and [Phase 3 complete-or-refuse handoff](https://github.com/gastownhall/beads/issues/6136#issuecomment-5586085324).

## Fixed constraints and proposed-text conflicts

| Fixed constraint | Consequence for this packet |
| --- | --- |
| Complete or refuse (item 3) | Never return an incomplete version as success, never fill gaps from current or adjacent versions. A disclosed Unretained refusal names missing properties and owned-Link sets and carries no partial record. |
| References do not hold their targets (item 1) | No reference-triggered retention hold, cascade, rewrite, or retargeting. A domain may keep a cache under its own policy; erasure obligations remain separate. |
| Invalid, known-Gone, unresolved-here admission outcomes (item 2) | These are available to validating write policy; this read lane does not require all references to be resolved or all unknown citations stored provisionally. |
| Retained addresses survive epoch change (item 4) | A surviving version remains resolvable at its old address. No blanket rejection of old revisions. Positions, snapshots, cursors, and receipts still need their own fencing rules. |
| Whole-set wildcard ownership and opaque properties (item 5, amended) | Owned Links are graph state; `properties` values are never reference-typed protocol edges. No new property-reference annotation mechanism. |
| Attribution `claimed` or `unknown` | Carry the version’s existing attribution, including absence. Do not introduce `verified`, infer an actor, or promote import provenance into authentication. |
| Exact-decimal equality and admission (#21) | Preserve the ruling. Issue-plane JCS storage is evidence of one declared serialization discipline, not a mandate to make generic graph equality binary64. |
| Erasure propagates; retention does not | T19/T25–T29 now fix containing-version erasure, copy cleanup, pre-erasure token expiry, and the permanent projected ledger. History capability applicability, stale-import admission, and the exact externally claimable promise remain open; resolution alone proves none of them. |

The baseline’s Scope-history paragraph still says all prior-epoch history tokens,
including revisions, are rejected. The pinned TX head retains that paragraph too
([lines 1094–1102](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1094-L1102)).
It conflicts with Memory-compat item 4’s retained-address ruling; H9 materialization
must amend it with a dated marker, preserving the fences for tokens that name a
history position. T29’s erasure ledger survives those fences; retaining an old
address never authorizes retaining or serving erased content.

The input’s suggestion to cache immutable historical responses conflicts with the
selected `private, no-store` rule for authorization-dependent Scope data. Content
immutability also does not make currency links or authorization immutable.

The input proposes both ordinary Resource records (which contain `revision`) and
a revision equal to the hash of the entire received body. That is self-referential
unless an exact representation or exclusion rule is chosen. “Strip a field” is
not a byte-level rule. H10 makes this a visible decision rather than an adapter trick.

## Proposed decisions — all OPEN

Each recommendation below remains unruled. Draft wording is quoted for review,
not inserted into the normative spec. H1–H4 form the first History batch after
W1’s remaining RP1 apply judgment is addressed: whether the `$ref` walk stays as
a coverage check that never changes the digest. RP1’s projection by the26 sealed
definition names is already ruled. Subsequent batches follow dependencies.

### H1 — Profile placement and advertised capability

**Context.** There are three cumulative profiles. The proposal wants a read-only
citation resolver without requiring a mutation authority or a changefeed.

**Options.** A: an optional capability on each existing profile, with one complete
minimum History surface. B: a fourth cumulative profile, which makes History
placement relative to mutation/replication awkward. C: Transactional-only, excluding
read-only resolvers.

**Recommendation: A.** Proposed discovery member `historicalResolution`, with its
closed shape selected after H2–H9. No new `profile` enum value. Absence means the
capability is not advertised; clients must not infer support from the profile.

**Proposed wording:** “Historical resolution is an optional advertised capability.
An authority advertises it only when it implements its complete required surface.
It does not imply mutation, Scope replication, or erasure-reconciliation capability.”

**Destinations/consequences.** Profiles, discovery, startup admission; discovery
schemas, catalog applicability, client negotiation, and evidence. Adding the member
to sealed `readDiscovery` changes the Read projection and requires a reseal before
shipping that change. A documentation-only packet does not change the projection.

### H2 — Which Resources can be resolved

**Context.** The motivating examples name Beads, but Links also have identities and
revisions. A historical Bead includes its owned Links as part of its own version.

**Options.** A: minimum capability covers canonical Bead and Link URLs uniformly.
B: Beads only, with explicit exclusion of independent Link-history retrieval.

**Recommendation: A.** A resolver must not advertise uniform Resource history and
then silently return current Link state. A product lacking independent Link history
must refuse the capability or use an explicitly selected narrower capability.

**Proposed wording:** “A version-addressed read identifies a canonical Resource URL
and one opaque revision. Success returns that Resource’s complete record at that
revision, including the Bead’s owned-Link state where applicable.”

**Edge/effect.** An owned Link changing produces distinct Link and source revisions;
either address resolves independently. Frozen inline Link records must not be loaded
from today’s graph. Owners: Resource reads and schemas; two category-specific fixture
families, adapter retention, and capability admission. No claim that #6358 meets this.

### H3 — Address and query combinations

**Context.** `?revision=` is the accepted design direction, but the exact operation
and interaction with existing views are not selected wire law.

**Options.** A: one `revision` query member on a canonical Resource URL, full record
only in the first cut. B: a separate history target or new path. A preserves citation
addressing; B could isolate the wire shape but adds another locator.

**Recommendation: A.** `GET` and `HEAD` share it. Reject repeated `revision`, an empty
value, and combinations with `view`, selection, or pagination on this operation;
`view=versions` is H7’s separate operation. Do not add query semantics to aliases.
Use existing `invalid-parameter` for malformed query use. Revisions are decoded once
as query data and remain opaque; do not impose checkpoint-token grammar on existing
opaque revisions. A later advertised verification scheme may select its own explicit
token grammar under H10 without narrowing the tokens already admitted by Read.

**Proposed wording:** “A canonical Resource request with exactly one nonempty
`revision` selects the complete retained state at that revision. It is never a
request for the nearest state. Unsupported or repeated query members are refused.”

**Consequences.** Resource routing, query parser, client escaping, invalid-parameter
fixtures. Positive test: a revision containing reserved URL characters round-trips;
negative test: a twice-encoded spelling never aliases a different token.

### H4 — Historical authorization and complete owned state

**Context.** Ordinary reads hide unknown/deleted/non-visible identities. Historical
reads must serve retained deleted versions, while owned-Link closure and disclosure
rules must not expose hidden targets or partial state.

**Options.** A: authorize the requested historical record as a whole at request time,
including its owned state, and refuse uniformly when that whole record cannot be
shown. B: redact the historical success, which violates complete-or-refuse. C: serve
according to acceptance-time authorization alone, which could bypass revocation.

**Recommendation: A.** History authorization can permit a deleted subject’s retained
version; it is not equivalent to current Resource visibility. It must cover the whole
historical owned closure. Whether current target visibility or an explicitly granted
historical target permission satisfies that closure must be recorded by the ruling;
authorities may not silently borrow current target existence to reconstruct old state.

**Proposed wording:** “Historical resolution checks current authorization for the
requested historical record and its complete owned state. A caller not permitted
that complete record receives the uniform resource-not-found result, without history,
window, gap, or currency disclosures.”

**Consequences.** Owning text: Authorization views, owned Links, historical reads,
and disclosures. Schema success remains whole. Required cases include revocation,
deleted subject, a target hidden after citation, and an owned Link no longer live.
T49 and the still-open incident-Link deletion proposal must be reconciled separately;
this decision does not authorize dangling live Links or change DeleteBead.

### H5 — Typed refusal vocabulary and evidence for each answer

**Context.** The read problem table is closed. Existing `resource-pruned` and
`resource-erased` are usable only under their selected disclosure rules; a backend
failure is not proof that a revision never existed.

**Recommendation.** Keep those codes and propose three new rows below, plus a
separate participation row. Every new code/status/retry tuple requires Donna’s
ruling. Meaning is scoped to this responder; another store may retain a pruned
version. `revision-unknown` is not proof of tampering or a promise that sync will help.

| Proposed code | Family / status / retry | Evidence and response |
| --- | --- | --- |
| `revision-unknown` | not-found / 404 / after-state-change | Authorized subject, syntactically valid revision, no retained state or known disposition; do not assert `mayChangeAfterSync: true` universally. |
| `revision-unretained` | conflict / 409 / after-state-change | Known version, incomplete reconstructible record; typed `missing` diagnostics identify property JSON Pointers and owned-Link sets, never a partial record. |
| `revision-reorganized` | gone / 410 / never | Positive evidence that this responder lost that address through history replacement, not merely an unrecognized opaque token or an epoch mismatch. |
| `revision-not-tracked` | conflict / 409 / after-state-change | Positive knowledge of non-participation; distinguish it from unknown revision only under history authorization. |

**Alternatives.** Use `410` for Unretained as in the input; or collapse participation
into unknown and advertise less diagnosis. Recommendation keeps incomplete retained
state distinct from confirmed removal and allows an explicit repair/reimport policy.
`after-state-change` requires a changed state or a newly constructed request; it is
not an instruction to poll, wait for sync, or repeat a request indefinitely. Operator
repair can be such a change. If a disposition is permanently unrepairable at the
responder, the alternative `never` contract must be selected explicitly.
Existing pruning and erasure rows retain their current status/retry contracts;
erasure gains no condition-specific extensions. All historical diagnostics, including
404 distinctions and participation, are gated by H4. A backend timeout remains a
normative temporary failure, not one of the absence outcomes above.

**Proposed wording:** “A resolver reports only dispositions it can substantiate.
Incomplete reconstruction is a refusal with no Resource record. Authorization is
checked before disclosing whether a revision is known, missing members, or untracked.”

**Consequences.** Problem table, closed code schemas, diagnostic shapes, client
classification, fixtures. Missing-set names and JSON Pointer escaping need exact
bundle definitions before implementation. No implementation starts with prose alone.

### H6 — Currency relations and caching

**Context.** The RFC 5829 relations are accepted input. Their target selection and
interaction with mutable authorization and retention still need wire rules.

**Options.** A: retain current private/no-store semantics and expose currency at the
responding store. B: cache historical bodies indefinitely and invent an independent
freshness/revocation channel.

**Recommendation: A.** Use `latest-version`, `version-history`, and retained direct
`predecessor-version`/`successor-version` relations when authorized. Do not call the
next surviving entry a direct successor if intermediate versions are missing. The
relations report this responder’s knowledge at the response, never global freshness.
A deleted or undisclosable current state has no invented latest target.

**Proposed wording:** “A pinned body does not make its authorization or navigation
metadata immutable. Scope caching rules remain in force. Version navigation is
limited to authorized targets known to the responder.”

**Consequences.** HTTP/Link construction, conditional responses and HEAD parity,
client currency display, revoked-access and stale-replica cases. ETag remains the
quoted Resource revision; conditional handling must not skip authorization or erase
required navigation metadata. RFC 5829 defines navigation, not a notification SLA.

### H7 — Retained-version enumeration

**Options.** A: `GET canonical-resource?view=versions` with cursor pagination over a
stable enumeration snapshot. B: address resolution only in the first capability,
with enumeration as a later independently advertised feature.

**Recommendation: A**, subject to H1’s cost decision. Rows carry revision and retained
attribution without properties or owned payloads. A page reports its retained window
and explicit completeness/participation state. Ordering comes from the responder’s
authority order, never token spelling, wall-clock comparison, or storage ordinals
promoted to protocol positions. Internal ordinals may implement the order.

**Proposed wording:** “A versions page enumerates a stable retained window of the
Resource’s version history. Its cursor does not authorize disclosure or guarantee
that a listed version will remain retained for a later request.”

**Open subchoices.** Exact row/page members; whether erased versions have disclosable
metadata rows; lifetime of the ever-participated marker; limits and cursor expiry.
Recommend pagination pins enumeration only, creates no retention hold, and fails
explicitly if it cannot honor that snapshot. A latest link need not be a page member.
History lineage branching/merge navigation is not inferred from importing Jim’s
store-local ordinals. The generic authority remains the selected single history.

**History replacement fork (OPEN, added 2026-09-08 council).** Start with
`r1 → r2 → r3`; restore the authority to `r1`, retain the old addresses for
`r2`/`r3`, then mint `r4`. H9 requires retained exact addresses to keep resolving,
but does not say which versions this page enumerates. Choose between:
(a) enumerate only the current authority lineage, with completeness explicitly
limited to that lineage, while retained replaced versions remain directly
addressable; or (b) enumerate every retained version, with an explicit ordering
and membership model distinguishing replaced history from the current lineage.
The second option costs extra metadata and navigation rules; the first makes
address resolution broader than enumeration and must disclose that limit.
H7 option B can instead defer enumeration until this is settled. No alternative
is selected here. H6 must then say which predecessor/successor relations survive
replacement and whether any can cross it; never label `r4` a direct successor
of `r3` just because a storage ordinal is larger. All options preserve H9’s
retained-address law and H12’s permanent erasure obligations.

**Consequences.** New page definitions, page/cursor fixtures, participation retention
budget, client iteration. Coverage counts must be authorization-relative and observed
consistently or omitted; global hidden-resource counts would leak information.

### H8 — HEAD and bulk address checks

**Options.** A: HEAD uses GET’s status and headers, no body; callers needing a typed
refusal use GET. B: new diagnostic response headers. C: a separate checking endpoint.

**Recommendation: A for the first cut; defer bulk checks explicitly.** HTTP status
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

The survival law is already ruled by Memory-compat item 4. Both the main baseline
and the pinned TX Scope-history paragraph still need its dated materialization;
T15 preserves opaque revisions but does not itself repair epoch fencing. The open
choice is the materialization and evidence required to report loss for an opaque
token. T29 independently fixes erasure-ledger survival across restore and rotation;
an erased version is not a surviving retained state eligible for successful resolution.

**Recommendation.** Amend the Scope-history paragraph to distinguish Resource-state
addresses from authority-position tokens. Preserve exact old-address resolution for
surviving states; any internal mapping must preserve the requested revision externally,
not quietly return a newly minted revision. Keep graph `authority_epoch` separate from
issue-plane `store_epoch`; neither storage name is a new wire field by itself.

**Proposed wording:** “After history replacement, positions, snapshot cursors, and
receipts from the replaced history are fenced. A retained Resource version continues
to resolve at its existing address to exactly that state. A resolver that lacks proof
of the disposition of an opaque revision reports unknown rather than deriving loss
from token spelling.”

**Alternative.** Introduce a new client-visible History epoch and token provenance
mechanism now. More disclosure and schema work; not needed to preserve retained
addresses. A `revisionScheme` change cannot silently rebind an old address.

**Consequences.** Dated amendment to Scope history, historical-resolution cases for
retained/lost/unknown versions across restore, mixed old/new addressing, and cursors.
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

**Options.** A: first-cut History uses existing opaque revisions and ordinary complete
records; keep optional verifiable representations/witnesses as an explicit second
tranche. B: now define a separate exact-byte version payload with the self-token
outside the hashed payload, media/encoding rules, metadata and ancestry boundaries,
and an independently named response digest. C: specify a value projection and its
canonicalization; this is not verification of the entire body as received.

**Recommendation: A for initial wire closure, B for the following focused tranche.**
The per-Bead versus repository chain distinction and advertised verifiability remain
accepted inputs, not a mandated scheme. Do not modify the closed Pinned Reference
shape to add `digest` before that tranche is ruled. Never silently change `sha256-jcs`
to mean arbitrary stored bytes or exact-decimal canonicalization: #21 fixes that name.

**Proposed wording:** “Historical resolution preserves the Resource’s opaque revision.
A successful read does not by itself advertise a content-verification scheme. Token
schemes, when advertised, name their exact representation and numeric discipline.”

**Consequences.** This avoids a circular hash and a false interoperability claim in
the first cut. It delays independently verifiable citation bytes; state that cost to
Memory consumers. The following tranche must settle self-token exclusion/envelope,
content encoding, Authorization View binding, parents/serialization version, witness
placement, erasure digest linkage and multi-replica tests before its implementation.

### H11 — Change context beyond existing attribution

**Options.** A: first cut carries the exact existing per-version attribution, including
absence; assisting agent, acceptance time, message and import provenance wait for a
separate generic change-context envelope. B: define that envelope now without
expanding `attribution` or changing no-op semantics.

**Recommendation: B if Memory requires those fields at its first History release;
otherwise A.** This is a product-completeness choice, not permission to drop data
silently. A Memory-specific client must not treat basic History as proof of its richer
contract. No field moves into `properties` merely to avoid a schema decision.

**Proposed wording common to both:** “Historical records carry the attribution
recorded for that version, unchanged. Absence is distinct from an unknown principal.
Import provenance and assisting-actor context do not assert authenticated authorship.”

**Consequences.** If B: define supplied/absent/undetermined semantics for each new
field, immutable acceptance context, exact wire names, no-op exclusion, and schema,
write-input, Event and history-list fan-out. Existing `claimed|unknown` is not reopened.

### H12 — History erasure boundary and incident-Link deletion

**Context.** Ordinary deletion, retention, and erasure remain different operations.
The input’s surviving-citation requirement cannot by itself change the refusal to
delete a Bead with live incident Links. The TX reconciliation now removes choices
that T19/T25–T29 already settled; H12 remains OPEN for the History-specific boundary
and incident-Link lifecycle, not for a second erasure mechanism.

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
The exact behavior of a caught-up live stream crossing P is separately OPEN as TX
T64; History cannot select that behavior or reopen T28’s finite/reconnect fence.

**Incident-Link alternatives.** Whether and how a live citation can survive target
deletion without changing its source’s owned state or violating endpoint liveness
remains unruled:

- Check endpoint liveness at creation and introduce a per-Link-Type policy controlling
  whether an existing Link requires its target to remain live. This separates source
  ownership from target liveness but adds a new policy surface.
- Exempt Links owned by their source from blocking target deletion. This is smaller
  but couples the source-versioning declaration to a target-liveness rule.
- Preserve the current refusal and explicitly limit the Memory mapping until a later
  lifecycle design; this delays the requested surviving-citation behavior.

**Recommendation.** Preserve the ruled TX constraints and decide the remaining
History assurance/applicability, stale-import, and incident-Link questions explicitly.
No incident-Link alternative is selected by this packet. A historical success or a
`resource-erased` refusal alone proves neither erasure recovery nor physical purge.
T49/T62–T64 and T50–T61 remain on their own TX ruling/ratification queue.

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

| Case | Positive proof | Refusal or adversarial proof |
| --- | --- | --- |
| HR01 negotiation | Complete capability discovered at allowed profiles | Absent/partial capability never advertised or guessed |
| HR02 exact resolution | Bead and Link old revisions return complete selected records | Current/nearest substitution rejected |
| HR03 owned state | Old source includes its historical owned records | Missing owned set refuses whole answer; current Link lookup caught |
| HR04 attribution | Historical claimed/unknown/absence preserved | Current writer and fabricated verification status rejected |
| HR05 authorization | Authorized deleted-subject history can resolve | Revoked/hidden closure gets uniform 404 with no navigation/gap leak |
| HR06 dispositions | Pruned/erased/unknown/unretained distinguished by evidence | Storage timeout never becomes not-found; erased payload never disclosed |
| HR07 addressing | Escaped opaque token resolves exactly | Repeated/empty/query-mixed/alias revision request rejected |
| HR08 HEAD | Status and permitted headers match GET; body empty | Client never treats status alone as a full typed absence diagnosis |
| HR09 enumeration | Stable paginated window, declared order and explicit current-lineage/all-retained membership after history replacement | Restore r1 after r1→r2→r3, retain r2/r3, mint r4; verify selected membership/completeness; concurrent pruning yields selected refusal and no retention hold |
| HR10 currency | Authorized responder-relative relations, including the selected replacement boundary | Hidden latest/successor omitted; no invented global freshness or direct r3→r4 relation after restoration |
| HR11 restore | Surviving unerased old address resolves unchanged; permanent ledger still applies to old copies | Positional tokens fenced; erased content never restored by epoch change; loss inferred only from positive evidence |
| HR12 numeric/token boundary | Declared scheme and admitted values honored | Issue/graph serialization or ordinal mistaken for identity detected |
| HR13 erasure recovery | For a Transactional consumer, T28 resnapshot and T29 projected-ledger cleanup cover old copies across restore/view rotation before publication | Pre-P checkpoint/snapshot refused; unestablishable retained content discarded; stale-import admission and History-only applicability remain unruled |
| HR14 product differential | Memory behavior compared through its public interface | A product-only harness result is never counted as BDP HTTP conformance |
| HR15 embedded erasure | T19 emits a same-group erasure record for the Link revision and every source version embedding it; T25/T26 cleanup and authorization apply | Probe all historical and retained copy paths, including receipts and snapshots; no erased bytes, partial success, or old-token rebinding; any affected live version gets a valid successor or tombstone |

The RFC navigation definitions are [RFC 5829 §3](https://www.rfc-editor.org/rfc/rfc5829.html#section-3).
JCS’s numeric serialization is [RFC 8785 §3.2.2.3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2.2.3).
These sources establish those standards’ rules, not this packet’s unruled BDP choices.

## 2026-09-08 reconciliation with the applied Transactional draft

This is a source reconciliation after release of the initial exclusion, not a new
ruling or council clearance. H1–H12 all remain OPEN. The initial review record is
preserved, with its containing-version fork superseded by the verified T19 ruling.
Only this packet and its review record change; no normative, schema, catalog,
implementation, fixture, or evidence artifact changes.

The following anchors pin the inspected #20 head, not a moving branch. The
specification is the owning protocol text; the packet links establish the recorded
ruling behind it. They do not promote the design packet into normative authority.

| Verified constraint | Owning text at `1eef4e4` | Recorded ruling / effect here |
| --- | --- | --- |
| Owned-Link erasure reaches containing source versions; live versions need valid successors/tombstones | [Version erasure, lines 4982–5032](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4982-L5032) | [T19, lines 4685–4702](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4685-L4702); H12/HR15 no longer reopen containing-version disposition |
| Content and copy-path obligations, with authorized disclosures | [Version erasure, lines 4976–4980](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L4976-L4980) and [lines 5034–5071](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5034-L5071) | [T25/T26, lines 4717–4747](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4717-L4747); HR13/HR15 cover held copies without inventing a weaker History default |
| Pre-P checkpoint/snapshot expiry and fresh bootstrap | [Version erasure, lines 5073–5082](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5073-L5082) | [T28, lines 4763–4789](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4763-L4789); HR13 recovery expectations fixed, live-delivery T64 remains open |
| Permanent ledger, old-copy cleanup, restore re-emission, discard if status cannot be established | [Version erasure, lines 5084–5100](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L5084-L5100) | [T29, lines 4791–4810](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/design/w1-transactional-packet.md#L4791-L4810); H9/HR11 distinguish surviving address from erased content |
| Retained addresses survive epochs, while current text still fences revisions | [Scope history, lines 1094–1115](https://github.com/gastownhall/bdp/blob/1eef4e439629e247e9055ef8e42045acbea66b75/docs/specs/bdp.md#L1094-L1115) | [Memory-compat item 4](https://github.com/gastownhall/bdp/issues/1#issuecomment-5586084982); H9 retains the dated-amendment obligation and opaque-token loss-evidence question |

The earlier [three open erasure questions](https://github.com/gastownhall/bdp/issues/12#issuecomment-5570349470)
are historical input: T28/T29 subsequently select the Transactional missed-announcement
and durable-ledger mechanisms. They do not by themselves settle every stale-import
admission rule, optional History capability boundary, or provider-history proof.
No expected result for those remaining choices is inferred from the reference runner.

## Implementation and evidence work after rulings

1. Materialize protocol text, exact bundle shapes (both copies), problem rows and
   illustrative fixtures together; record dated amendments to prior wording.
2. Add the History catalog and manifest with derived applicability/coverage. Build
   the server/client variants through the existing generic Scope-port seam, then
   retain versions in the in-memory adapter. No new HTTP-shaped adapter interface.
3. Give each other realization an honest capability boundary. Jim’s issue writer,
   graph P0, and `bdpbd` do not automatically satisfy Resource History. Preserve
   BDBD-003; the bd adapter stays on public CLI behavior, not private database reads.
4. Use Steph’s adoption harness as external product differential evidence. Verified
   input: `sjarmak/mem`, `adoption-harness-share`,
   `19763909b5a212922730f2273f77b8a09535bd7f`, `docs/adoption-harness/`.
   Its embed-and-isolate deployment must remain covered by the already ruled solo
   graph topology; do not turn that into permission for embedded BDP serving.
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
  [History packet review](./history-profile-review.md). The first council is incomplete:
  two seats returned findings; the third was unavailable. The fold does not imply
  a full-panel clearance or a ruling. No History tests, harness trial, or conformance
  run is claimed by this document.
