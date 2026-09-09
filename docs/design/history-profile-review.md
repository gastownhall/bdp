# History packet review record

Status: all 38 presented History answer units are ACKed. The consolidated decision-document fold requires its own review; normative/wire/runtime materialization remains pending. Non-normative; no implementation or conformance claim.
Initial review date: 2026-09-08. Initial reviewed head: `02c598aa48630a41b2d9cf9d5b08b42878e1a9d9`.
Full branch scope: `history-profile-packet.md`, this `history-profile-review.md`,
`docs/design/README.md`, and the pinned authority inputs. Earlier two-file write-scope
statements describe those individual folds, not the complete branch. Future final-head
snapshots/reviews must include all three documents.
The TX apply checkout, branch and packet were excluded from every initial seat.
The later source reconciliation below is separate from those reviews.

## Seats and execution

- Codex: independent native reviewer, no authoring context, no subagents or edits.
  Returned 0 Critical, 1 High, 1 Medium, 0 Low.
- Gemini: staged snapshot on stdin, workspace trusted, read-only plan mode, explicit
  prohibition on delegation and at-token expansion. Returned 3 High, 2 Medium.
  Each claim was checked against the actual packet and the provided authorities;
  there were no accepted findings based on expanded at-tokens or imagined files.
- Claude: gateway invocation failed with `401 INVALID_TOKEN`, no review. A retry
  using the existing direct login, with gateway overrides removed only for that
  process, reported the session limit until 16:30 America/Buenos_Aires. No review
  was returned, no persistent configuration changed, and no quota reset was used.

## Finding dispositions

| Finding | Disposition and concrete change |
| --- | --- |
| Codex High: erased Link revisions remain in historical source records | Accepted in the initial fold: H12 queued containing-version erasure versus restricted non-serving versions, distinguished embedded bytes from target references, named copy paths and live-source handling, and added HR15. At that initial snapshot this was recorded as a missing design fork. The later TX reconciliation below supersedes the fork with the already ruled T19 containing-version erasure; it does not reopen that policy. |
| Codex Medium: durable version_id addressing claimed as implemented at #6358 | Accepted. H10 distinguishes the selected durable-address design from deferred 0068 steps 1–5 and the current single-writer restriction. |
| Gemini High: Unretained must be 410/never because the input proposed it | Not accepted as a contradiction of selected law. The proposal is explicitly input, and the actual item-3 ruling selects complete-or-refuse without a code/status/retry tuple. H5 already presents 410 as an alternative. Clarified that after-state-change does not mean polling or waiting for sync; permanent versus repairable disposition remains Donna’s decision. |
| Gemini Medium: not-tracked must use never because only operator action helps | Not accepted as established law. Operator action is a state change; no selected rule makes after-state-change an automatic sync/retry loop. H5 now states the distinction explicitly and leaves the tuple open. |
| Gemini High: HEAD statuses already form the full admission oracle | Partly accepted as a clarity finding. H8 now acknowledges the useful 200/410/404 coarse check for authorized callers in that subset. It still does not distinguish unauthorized 404, unknown revision, or the proposed 409 restrictions, and it reserves no retention. GET supplies detailed diagnosis where required. |
| Gemini High: concrete incident-deletion alternatives lost | Accepted. H12 restores both input proposals (per-Type liveness policy, source-ownership exemption) and the cost of retaining the current refusal. None is selected. |
| Gemini Medium: checkpoint token grammar is already required | Not accepted as selected law. Baseline revisions are nonempty opaque strings, unlike checkpoint tokens. H3 now expressly preserves that existing contract while reserving scheme-specific grammar for H10. |

There are no findings corroborated by both completed seats. No recommendation in
H1–H12 was marked ruled by this fold. Gemini’s proposed status changes were not
silently applied as protocol law.

## Validation and remaining gate

The change is confined to design documents. Both bundle copies and all 26 sealed
definitions remain byte-identical to main `0b7d86e7`. Whitespace and local Markdown
link checks are appropriate here; no runtime test or conformance result is claimed.

The independent Codex fold recheck returned 0 Critical, 0 High, 0 Medium and 0 Low:
both original findings are resolved and the recorded dispositions preserve the
distinction between proposals and law. This is a recheck, not a fresh full-panel
review. At that checkpoint the missing Claude seat and final exact-head panel
remained required; the later completed seats and author fold are recorded below. Exact-head review/CI and Donna’s transition decision are
separate release gates. This record does not authorize a merge or advertise History.

## 2026-09-08 — TX source reconciliation after exclusion release

The [operator’s release record](https://github.com/donnabox/agent-coordination/blob/ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368/context/janet/beads-workstream-state.md#L744-L751)
records Donna’s explicit completion relay and directions after the earlier absolute
hold. It supplies the authorization provenance for this reconciliation.

Inspected TX head: `1eef4e439629e247e9055ef8e42045acbea66b75`; History starting
head: `42a24be9b8baa2c2db97934211d9512585d9a8ea`. This was a bounded authoring
reconciliation, not an independent review seat or a replacement for the pending
full-panel review. Source anchors and ruling links are recorded in the packet’s
[dated reconciliation](history-profile-packet.md#2026-09-08-reconciliation-with-the-applied-transactional-draft).

- H12/HR15 withdraw the containing-version erasure-versus-restriction fork. Applied
  T19 already requires an erasure record for every source version embedding an
  erased owned Link revision. T25/T26 supply copy cleanup and disclosure duties;
  a successful partial historical record remains forbidden.
- H12/HR13 incorporate ruled T28/T29: pre-erasure checkpoint/snapshot expiry,
  fresh snapshot recovery, the permanent projected ledger across restore and
  rotations, cleanup of old retained copies, and discard when erasure status
  cannot be established. The initial description that all three erasure questions
  remained wholly open was stale.
- H12 keeps History-only capability applicability, stale-import admission, the
  externally claimable assurance boundary, and incident-Link lifecycle open. It
  points to still-open TX T64 for caught-up live delivery and does not infer a
  choice from the fixed finite/reconnect fence.
- H9/HR11 distinguish surviving unerased old addresses from content whose permanent
  erasure obligation survives the epoch. The applied TX Scope-history paragraph
  still broadly fences revisions; the conflict with Memory-compat item 4 is
  explicitly preserved for dated normative materialization, not described as fixed.

All H1–H12 remain OPEN, all HR01–HR15 remain proposed cases, and no runtime or
conformance result is claimed. Only the two History design documents were edited.
Validation: inspected pinned source paragraphs and recorded T19/T25–T31 rulings;
read back the primary Memory-compat item 4 and original erasure-question comments;
checked diff whitespace and local Markdown links. No runtime tests, commit, push,
or external post were performed by this reconciliation worker. The parent must
review the diff and retain the full exact-head council gate before any clearance.


## 2026-09-08 — council on reconciled head 500100aa

Native Codex reviewed the whole reconciled packet at
`500100aacf2afd4bb999684cc0b9c70ef3ca2119`: 0C/0H/1M/1L. Gemini reviewed the
same frozen packet with bounded source context: 0C/2H/0M/0L. Claude and the
final correction-head checks remain pending. This is not full-panel clearance.

- Codex Medium, replacement-history enumeration: accepted. H7 now explicitly
  queues current-lineage-only versus all-retained enumeration after
  `r1→r2→r3`, restore to r1, retain r2/r3, then mint r4. It names ordering,
  completeness and H6 predecessor/successor consequences; HR09/HR10 exercise
  that case. No alternative selected and H9 retained addresses stay fixed.
- Codex Low, RP1 queue wording: accepted. RP1’s by-name 26-definition projection
  is already ruled. The introduction now names only the remaining separate
  coverage-walk judgment, whose walk never changes the digest.
- Gemini High, exact-decimal versus binary64 admission: not accepted. The
  snapshot did not include #23’s full later admission paragraph. At pinned
  `2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7`, Revisions lines 632–661 explicitly
  retains exact-decimal equality and admits only literals that round-trip
  through binary64 unchanged in exact decimal value. It states agreement on
  admitted values and the named JCS model. TX’s erasure paragraph references
  that already selected law; restricting numeric admission to digest-only
  would contradict it. No numeric law was changed. Supplement the next seat’s
  snapshot with the actual #23 paragraph rather than treating absent merged
  prerequisites as a newly discovered History contradiction.
- Gemini High, baseline wildcard schema rejects `*`: the baseline observation
  is true and already identified as an unmerged #22 prerequisite. Exact
  `c201cc28f74c6f71212aaf7f25966aabf55fb97e` has `ownsOutgoing.propertyNames.anyOf`
  allowing either `*` or absoluteHttpUrl, and a separate wildcard declaration.
  The source map expressly separates that head from the sealed main baseline.
  Do not modify the baseline schema or treat a known integration prerequisite
  as a new packet defect. Supply this actual shape in the next review snapshot.

Parent independently checked the changed History paragraphs, pinned TX erasure
text, #23 numeric paragraph and #22 wildcard definition. Only design documents
change. Runtime/product/harness conformance remains untested and unclaimed.


## 2026-09-08 — completed seats on ef6e997 and author fold

Reviewed head: `ef6e99768d0270817f3d898aa99e24bee6dbf240`. Fresh native Codex
and Gemini reviews each returned 0 Critical, 0 High, 0 Medium, and 0 Low. Claude
completed its review of that head with 0 Critical, 1 High, 7 Medium, and 5 Low.
Its claim that Claude had never returned or that no seat had reviewed this head
was stale at completion. All three seats have now returned on that head; their
counts do not clear the subsequent author fold. A final-head review remains owed.

The table numbers match Claude’s report. Findings were checked against the owning
source rather than accepted solely from the review. No H1–H12 choice was ruled.

| Finding | Disposition and concrete fold |
| --- | --- |
| 1 High — post-restore token collision can rebind a retained address | Accepted as a missing proof/case. H9 now explicitly preserves item 4’s non-rebinding invariant, queues recovery/allocation proof alternatives, and HR11 rejects a colliding new mint. The suggested lifetime token uniqueness is not adopted: a content-derived token may identify the same state again. A durable registry is one possible proof, not prescribed architecture. The suggested loss disposition for actually retained state is rejected; unsafe allocation must not fabricate pruning or prevent the ruled retained read. Exact write refusal remains open. |
| 2 Medium — sha256-jcs versus sha-256-jcs | Accepted as contextual ambiguity, not as an established conflicting global name. Exact #23 text names the revision-token scheme `sha256-jcs`; TX T18 names erasure `digest.scheme` `sha-256-jcs` over a complete erased Resource record. H10, HR12, HR15, and a new pinned reconciliation row distinguish both contexts. No unification is selected; changing either would need a future ruling. |
| 3 Medium — RP1 coverage judgment allegedly already closed | Citation/scheduling portion accepted; closure claim rejected. The operator handoff ledger explicitly keeps that apply judgment pending even though #24 has applied it. The introduction now links the pinned handoff and distinguishes already ruled projection by 26 names from the remaining ratification. W1 priority is operator queue order, not a semantic dependency of H1–H4. |
| 4 Medium — evidence for pruning and retention advertisement omitted | Accepted. H5 queues durable disposition evidence and its lifetime, including honest unknown after a bounded record expires when state/evidence are absent. A minted-token digest or absence alone does not establish removal reason. H1 queues retention advertisement versus omission, exact member ownership, client cost, and the sealed `advertisedLimits` reseal consequence. TX’s permanent erasure ledger cannot be shortened by this choice. |
| 5 Medium — replacement navigation covers only two relations | Accepted. H7 now covers all four H6 relations, version-history membership, latest target, and the required disclosure carrier. HR10 exercises membership gaps and boundary semantics without selecting a carrier or lineage model. |
| 6 Medium — enumeration at a deleted subject unqueued | Accepted. H7 explicitly queues authorized enumeration versus refusal, status/disclosure consequences, and the unauthorized case. H4/H7 name Reads after deletion as a dated-amendment destination; HR09 covers the selected behavior. |
| 7 Medium — alias query refusal conflated with invalid-parameter | Accepted. Exact #19 Alias resolution already requires uniform `404 resource-not-found` for alias queries. H3/HR07 distinguish that fixed law from malformed revision queries on canonical Resources. |
| 8 Medium — missing disclosure and navigation destinations | Partly accepted. H5 now names requirements PROTO-013 and Reads after deletion, with dated amendments if the fourth 410 is selected. H6 names historical Resource response navigation. The Scope discovery paragraph says `service-desc` is the one required machine entry and avoids BDP-specific duplicate navigation; it does not prohibit registered RFC 5829 relations on historical Resource responses. No unsupported Scope discovery change is introduced. |
| 9 Low — H9 cited as authority for retained-address law | Accepted. H7 now attributes the law to Memory-compat item 4 and H9 only to its materialization. |
| 10 Low — bare T15/T49 citations | Accepted. H9 links pinned T15 with RATIFIED status and its character-profile subject; H4 links pinned T49 with OPEN status and its Transactional alias subject. |
| 11 Low — nonexistent mayChangeAfterSync member implied | Accepted. H5 states the evidentiary caution in prose and introduces no diagnostic member. |
| 12 Low — stale review summary | Accepted as summary drift, corrected against completed results. Both earlier partial councils remain recorded; the current summary reports fresh Codex/Gemini zero-finding results and Claude’s completed 13 findings on ef6e997. It does not repeat the review’s now-stale claim that no seat reviewed that head. |
| 13 Low — missing spaces | Accepted. Corrected all identified operator-facing spacing sites and the RP1 sentence. |

Verified source pins: #19 `06ebabdb391d8ea730295f4e01ed00bc1206fe38` (Alias
resolution 2300–2317, Reads after deletion 2319–2354, discovery 1747–1756,
requirements PROTO-013 68–77); #23 `2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7`
(Revisions 633–661); #20 `1eef4e439629e247e9055ef8e42045acbea66b75` (erasure
digest 4957–4974, packet T15 3231–3243, T18 4671–4683, T49 7161–7220).
The [operator handoff](https://github.com/donnabox/agent-coordination/blob/ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368/context/janet/beads-workstream-state.md#L701-L725)
is cited only for queue/ratification state, not normative law. All source ranges
are pinned in the packet; the sealed baseline’s `advertisedLimits.retention` was
also inspected directly. This fold does not alter any protocol, schema, catalog,
fixture, runtime, or evidence file.

Validation for this author fold: diff whitespace, local Markdown paths/anchors,
pinned source ranges, all twelve H decision headings still OPEN, all fifteen HR
rows still proposals, and owned-file scope. No runtime tests, reviewer processes,
commit, push, or external post were performed by the fold worker. Parent review
and the final-head gate remain required before clearance.


## 2026-09-08 — completed seats on 9c93b0e and second author fold

Reviewed head: `9c93b0e4026f846a7afb195330a5be4d4199f2ec`. Native Codex and
Gemini returned 0 Critical, 0 High, 0 Medium, and 0 Low. Claude completed with
0 Critical, 3 High, 5 Medium, and 4 Low (12 findings). The following source-checked
fold records all twelve; it is authoring, not a new independent review or clearance.
H1–H12 remain OPEN, with H1a/H1b sequenced as subparts rather than new decision IDs.

| Claude finding | Disposition and concrete fold |
| --- | --- |
| 1 High — retained-address destination excludes Read/RU | Accepted. H1/H9 explicitly state those profiles expose no TX epoch. H9 queues one profile-neutral owning home for retained-address law and a separate Transactional fencing amendment, without requiring new epoch fields on read-only resolvers. HR11 covers every advertised History profile. |
| 2 High — proposed fencing sentence narrows tokens/triggers | Accepted. H9 now explicitly replaces the offending TX sentence, preserves restore/destructive-reinitialization/authority-replacement triggers, all existing non-revision history-token classes, epoch/view-bound cached representations, and refusal behavior. It retains independent Read/RU continuation rules and removes only blanket invalidation of surviving version addresses. |
| 3 High — deletion alternatives omit closure/snapshot consequences | Accepted as missing consequences; the universal invalid-snapshot claim is too broad. Hiding the source and its Link consistently can preserve projection validity, but defeats the intended readable surviving citation. H12 now blocks either non-default alternative on an explicit endpoint/visibility model and names Authorization views, Owned Links, PROTO-011, endpoint liveness/DeleteBead, snapshot/group agreement, and live-erasure validity as potential amendment destinations. It permits no invisible reinterpretation of in-Scope references and selects no deletion model or weakening of T19/T25–T31. |
| 4 Medium — disclosure amendments apply beyond fourth 410 | Accepted. H5 lists all four proposed wire rows’ effects on PROTO-013, Reads after deletion, the problem table, and applicable code/problem definitions, including authorized 404/409 distinctions. The trigger is any materialized new disclosure row, not only revision-reorganized. |
| 5 Medium — include=links combination missing | Accepted. H3 explicitly recommends refusal of `revision` plus `include`, including `include=links`, under canonical-Resource invalid-parameter. HR07 names the combination; historical incident-Link aggregate/ETag semantics require a later explicit contract. |
| 6 Medium — H1/H7 dependency cycle | Accepted. First batch contains H1a placement plus H2/H3/H4; H1b advertised shape/retention returns after H2–H9. H7 costs the chosen placement and supplies input to H1b. No complete H1 ruling is implied by batch one. |
| 7 Medium — TX hold release lacks citation | Accepted as missing provenance; no confirmation is needed. Pinned ledger ee0c6b3 lines 744–751 records Donna’s explicit relay that the old apply finished and her gates/push/council direction, superseding the earlier hold. Both documents now cite it. |
| 8 Medium — H11 conditional owner/input absent | Accepted. Read back csells’s Memory #5877 R12 and the History revision-2 §7 mapping. H11 records the four required elements, Chris Sells as Memory requirement owner, and Donna’s first-BDP-release scope decision as the prerequisite. Richer fields are required for claiming that Memory capability, not silently mandated for every basic History deployment. No outreach was sent. |
| 9 Low — H5 reseal cost omitted | Accepted. H5 names changes to sealed readProblemCode/readProblem, the Read projection digest and reseal. Their names are already sealed; no list edit follows merely from expanding their contents. New supporting definitions still need the projection/coverage audit. |
| 10 Low — settled revision-unknown name omitted | Accepted after primary-source readback. Memory-compat item 2 preserves the read-side answer name. The fixed-constraint row and H5 distinguish that from the still-unmaterialized family/status/retry/evidence tuple; no settled name is reopened. |
| 11 Low — ruled revision query address offered as a live alternative | Accepted after primary-source readback. Comment 5464020140 explicitly names `?revision=` among prior rulings. The source annotation and H3 reflect that; a new target/path is historical alternative only, requiring an explicit amendment to reopen. Method/combination/refusal details remain open. The older disclosure direction does not supply all later exact code tuples. |
| 12 Low — reorganization retry assumes permanent loss | Accepted. H5 surfaces never versus after-state-change with later restore/reimport of the same version as the distinguishing case; the retry field no longer silently selects never. It does not invent a prohibition on administrative restore or change existing pruning/erasure retry contracts. |

Verification sources: TX `1eef4e439629e247e9055ef8e42045acbea66b75` spec
Authorization views 792–823, Scope-history profile/triggers 1079–1102, absence of
Read/RU epoch exposure 2449–2454, include aggregate 2635–2678, snapshot/group
agreement 4895–4914, live-erasure validity 5017–5032; requirements PROTO-011
51–60. Those exact source ranges are linked from the packet. The earlier #19
PROTO-013 and Reads-after-deletion sources were re-used unchanged. Primary comments
5464020140, 5586084982, and 5573074065 were read back, as was csells’s #5877 R12
(issue last updated 2026-09-08T15:12:50Z at inspection). The operator release is
pinned to coordination `ee0c6b32f06f5960c6d74dfc5a5cfb20ce42e368` lines 744–751.

Validation: diff whitespace, local links/anchors, pinned-source range checks,
twelve H headings and fifteen HR proposal rows, plus the two-file write scope.
No normative/schema/catalog/runtime/fixture/evidence edits, tests, review CLIs,
agents, commit, push, or external posts were performed by this fold worker.
Parent inspection and final-head review remain owed; this record grants neither
readiness nor a merge transition.


## 2026-09-08 — completed seats on 195071d and third author fold

Reviewed input head: `195071dff40c2fe0058ec9b06d040dc8a30ce9f1`. Native Codex
and Gemini returned 0 Critical, 0 High, 0 Medium and 0 Low. Claude subsequently
returned 0 Critical, 2 High, 10 Medium and 5 Low. The seventeen report labels
below are Claude’s counts, not seventeen selected policies or an independent
clearance of the edits. This native seat checked the full packet and each claim
against local pinned sources, then authored the bounded correction in a separate
worktree based on that input head. The original review tree remained unchanged.

**Queue-state supersession.** The earlier T49/T62–T64 OPEN descriptions are
historical at their named heads. [Operator ACK at `267f79d`](https://github.com/gastownhall/bdp/blob/267f79d44d5883f70b0310378719ae0303b5445f/docs/design/w1-transactional-packet.md#L7570-L7595)
materializes T49 option 1, T63(a), and T64(a). T62 selects the PostgreSQL-feasible
unresolved-reservation direction; canonical singleton retry before binding,
bounded wait/timeout and static mismatch precedence remain unruled. T50–T61 remain
provisional. H4/H12/HR13 and the packet’s source map now reflect those distinctions.
T64’s illustrative schedules are not executed replication evidence. No History
choice was closed by these separate TX rulings.

| Claude label / severity | Independent disposition and concrete correction |
| --- | --- |
| H1 — High: omitted key namespace and transaction identifiers | Accepted as a faulty completeness claim in proposed wording. H9 now includes both classes, keeps the list non-exhaustive, and explicitly preserves the key-specific new-epoch outcome: unbound and executed anew, not uniformly rejected or replayed. HR11 names that distinction. No token fence was newly invented. |
| H2 — High: RU restore-signal conflict | Accepted conditionally: H1a plus the proposed reorganization signal would conflict with the closed RU list; neither option is selected, and not every H5 code signals a restore. H1a/H5/H9 now name the amendment and the alternatives of withholding that signal on RU or excluding RU from History placement. No RU epoch or new disclosure is imposed. |
| M1 — Medium: undefined H9 replacement range | Accepted. H9 replaces exactly TX 1094–1102 as one paragraph, reproduces the definition, unguessability, stability and trigger sentences, preserves canonical identity within a logical Scope, and delegates token-specific handling to its existing contracts. This avoids duplicate triggers and accidental loss of the definition. |
| M2 — Medium: normative matrix destinations | Accepted as missing destinations. H9 explicitly names `transactional.restore.epoch-fence`, preserves key-namespace/token-profile rows, and pins their locations at both inspected TX heads. The conformance plan names the baseline normative coverage categories and capability applicability as materialization destinations. The current generic categories do not independently prove History conformance, nor does a proposal already invalidate the matrix. |
| M3 — Medium: per-profile schemas | Accepted. H1b lists all three distinct discovery/limits pairs; H5 lists Read/RU code and problem definitions plus `directProblemCode`, `transactionalProblemCode` and `transactionalProblem`, with composition/context audits in both mirrors. Only changes within the sealed Read projection move that digest. There is no definition named `directProblem`; the actual TX response definition was checked. Receipt contexts must not gain new read codes accidentally. |
| M4 — Medium: query vocabulary and non-advertising authority | Accepted as an omitted destination/case. H3/H7 name Resource views and capability-scoped query registration. H3 recommends existing `invalid-parameter` handling for unsupported revision requests and HR07 tests the selected contract. This is proposed History materialization, not a claim that the baseline already recognizes the new operation. Alias-query 404 remains fixed. |
| M5 — Medium: dated ledger destinations | Accepted as amendment bookkeeping. H1 names profile/vocabulary/limits summaries and H5 names problem/disclosure summaries in the spec ledger and requirements blockers, with dated amendments as applicable. Fixed vocabulary means changes need definition; it does not mean a future ruled extension is impossible. A closed problem table must remain closed after explicit expansion. |
| M6 — Medium: witness `revision-mismatch` collision | Accepted. H10 and HR12 retain the already ruled RU 409 expected-revision meaning and queue a distinct optional witness-failure name/tuple. Reuse at 412 cannot happen silently; it would require an explicit amendment of the existing contexts and dependent rows. No witness shape or code is selected. |
| M7 — Medium: literal revision-to-ETag claim | Partly accepted. Literal quote wrapping was overbroad, but the report’s optional/absent-ETag inference overlooks baseline HTTP consistency, which already uses ETags for Resource revisions. Baseline server code also implements a strong, collision-safe projection for non-quotable strings. H6 separates that implementation from the general wire-encoding materialization, keeps revision strings opaque, and queues mapping adoption versus delegation to the separate rule with History parity. It does not offer an optional-ETag exception or restrict the revision alphabet. |
| M8 — Medium: imported out-of-contract values | Partly accepted as an integration boundary/case. T56 remains provisional; product writer rounding does not prove an existing BDP historical record is being changed. H10 distinguishes a mapping before BDP identity allocation from value changes under an already bound address; the latter cannot claim complete unchanged state. Exact refusal/diagnostic handling remains open. HR02/HR12 cover the boundary without treating every serialization change as a value change or forcing generic exact-byte witnesses into tranche A. |
| M9 — Medium: dual-token disclosure | Partly accepted: the input’s extra current-address disclosure was missing; the report incorrectly calls the packet recommendation a selection. H9 now records requested-token-only versus additional current-address disclosure and requires record revision, validator, equality, navigation and write-guard semantics before choosing. Item 4’s non-rebinding law stays fixed. |
| M10 — Medium: refusal windows | Accepted as a dropped input choice. H5 queues no refusal-body window versus a bounded, authorized, explicitly specified window, coordinates its completeness/snapshot/size with H7, and names the pruned `archivedAt` rule as an amendment destination. Erased refusals gain no condition-specific extension either way. HR06 covers the chosen outcome. |
| L1 — Low: incomplete erasure ruling range | Accepted citation correction. References consistently identify T19/T25–T31, and H12 directly links T31’s already ruled administrative deletion path. Neither tombstone safety nor containing-version erasure is reopened. |
| L2 — Low: BDBD requirement ID | Accepted. Implementation step 3 separately preserves BDBD-003 honest advertisement and BDBD-001 supported CLI/documented output. |
| L3 — Low: unpinned product/topology evidence | Partly accepted. The harness pin now has a link and is explicitly reported, uninspected in this pass; no harness run is claimed. Q30/A10 is independently found in pinned coordination ledger ee0c6b3 line 684 and linked as an operator record. Harness compatibility with that graph contract still needs verification. |
| L4 — Low: baseline law cited through draft heads | Citation improvement accepted; the stronger claim that a draft-head citation makes identical law conditional on merge is not warranted. Alias resolution, Reads after deletion, discovery and PROTO-011/013 now cite main 0b7d86e7; TX-specific amendments remain pinned to TX. |
| L5 — Low: omitted design index scope | Accepted for complete-branch accounting. Scope now names all three files and requires all three in the next review snapshot. Historical two-file fold scopes remain accurate as historical writes. The existing index entry was inspected and gains a direct review-record link; it carries no readiness claim. |

The preserved operator queue is H1–H12, all OPEN: placement and later advertised
shape; Resource coverage; method/query/refusal details; whole-record historical
authorization; exact refusal tuples/evidence/windows; currency and validator
materialization; enumeration/membership/lifetime; HEAD/bulk details; retained-address
home, mapping and safe-allocation proof; optional verification and stored-value
integration; first-release Memory change context; and History erasure applicability,
stale imports and incident-Link lifecycle. Ruled `?revision=` addressing,
`revision-unknown` naming, complete-or-refuse, retained-address non-rebinding,
opaque properties, numeric equality, attribution and the TX erasure constraints
remain fixed. No durable registry, lifetime token uniqueness, fourth profile,
window shape or new witness failure is prescribed.

Source validation used local git objects: main `0b7d86e7`, RU `06ebabd`, TX
`1eef4e4` and ACK `267f79d`, numeric `2c537a6`, wildcard `c201cc2`, and RP1
`87de37f`. The full baseline HTTP consistency/Resource views/deletion sections,
server validator projection, per-profile bundle definitions, TX restore/key namespace,
T15/T31/T56 and later ACK sections were inspected. Revision-2 window/witness/mapping
input was read from the supplied primary-comment snapshot; the coordination Q30
record was read from ee0c6b3 locally. No network lookups, messages to outside parties,
review CLIs, subagents, runtime tests, harness execution, commit or push were used.

Validation for this fold: diff whitespace; Markdown local paths/anchors; locally
available pinned GitHub source paths and line ranges; twelve H headings, fifteen HR
proposal rows, both unchanged schema mirrors and the three-file branch scope.
External comment bodies and the reported harness tree were not independently
refetched, and link syntax/local object checks are not live URL checks. This is an
author fold and must receive fresh independent final-head review before clearance.

## 2026-09-08 — completed 9cc4cf4 review and residual author fold

Input head: `9cc4cf47fd95e15f6f90aa1a98f3cc11c6eb1674`. Native Codex returned
0 Critical/High/Medium/Low; the completed Gemini report also reports zero across
all four severities. Claude returned **0 Critical, 1 High, 5 Medium, 3 Low**.
Independent adjudication accepted six findings and partly accepted three. This
bounded author fold applies those dispositions in a new checkout; it is not a
clearance of the resulting content. Earlier review scopes and conclusions remain
historical records, qualified by this follow-up where stated below.

| Claude finding | Disposition and correction |
| --- | --- |
| 1 High — Unretained gate versus success authorization | Partly accepted. Fixed item 3 and H4/H5 now separate the already ruled Bead-history refusal gate from H4’s open successful-record permission model. HR03/05/06 cover missing owned content, authorized refusal, uniform non-disclosure and permission denial that proves no gap. Rejected reopening the fixed Bead gate, asserting that all authorization implementations require absent content, or inventing a fixed independent Link refusal contract. |
| 2 Medium — baseline citations through draft heads | Partly accepted as a further citation improvement. Aggregate ETag, Read/RU no-epoch, view bindings and current closure now cite main 2025–2068, 1848–1853, **794–802**, and 771–792 respectively. Rejected the stronger claim that identical law becomes conditional because cited at a pinned draft, or that the earlier L4 disposition claimed every citation was replaced. TX amendment targets stay pinned to TX. |
| 3 Medium — Gone reason versus bounded evidence | Accepted with qualification. Fixed item 1 now includes Gone with the removal reason. H5/HR06 explicitly require a dated amendment to end that promise through diagnosis expiry; a tombstone budget does not select it. This qualifies the earlier bounded-evidence dispositions: sufficient compact evidence may preserve the consequence, but Unknown after expiry is not ordinary implementation discretion where it retires ruled Gone. No lifetime storage mechanism is imposed; the TX permanent ledger remains fixed. |
| 4 Medium — discovery participation input | Accepted. H1b queues authorized counts, a defined coverage class, or honest omission, with category/consistency definitions conditional on selection. Complete capability does not mean every Resource participates; HR01 covers that distinction and hidden-count protection. No member or denominator selected. |
| 5 Medium — pre-removal administrative disclosure input | Partly accepted. H12 queues local affected-address disclosure, authorized recipient, actor information and required-History versus later-administration scope, cross-referenced to H5/H1b. Primary acceptance comment 5464020140 confirms the history-authorization direction, not this exact administrative API. Rejected adopting broadcast/changefeed retention propagation or a new mutation endpoint; explicit deferral claims no assurance. |
| 6 Medium — H6/H7 enumeration dependency | Accepted. Version-history depends on actual H7 enumeration. H7-B leaves only truthful authorized latest/direct predecessor/successor candidates, without guaranteeing all exist. Replacement semantics cover the selected relation subset and page membership only where a page exists. Batching/work order and HR10 preserve that dependency; caching/validator work remains independent and H1b returns later. |
| 7 Low — fixed visibility closure omitted | Accepted. Item 5 includes hidden in-Scope target hiding its owning source; the properties amendment did not withdraw it. H4/H12 distinguish this fixed current-plane constraint from open historical-success permission and deleted-target lifecycle choices. No deletion exception supplied. |
| 8 Low — sync-uncertainty carrier input | Accepted as input accounting. H5 queues no extra member (recommendation) versus a separately defined, evidenced mayChangeAfterSync member. HR06 follows the selected carrier; neither option promises recovery or requires polling. The member is not restored as selected wire shape. |
| 9 Low — PROTO-013 range | Accepted. Packet URL and earlier verification prose now stop at line 77; line 78 begins PROTO-014. Requirement content is unchanged. |

Primary verification used the locally supplied Memory-compat ruling 5586084982,
properties amendment 5587346463, revision-2 input 5573074065 (including §3/§8), and
the previously supplied primary-comment snapshot for acceptance 5464020140.
Main `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8` Authorization views, HTTP/aggregate,
Reads after deletion and PROTO-013 were checked from local git objects. The
new **794–802** citation includes the actual token bindings; 771–792 alone does
not. No live source refetch was performed in this fold.

All H1–H12 remain OPEN. Item-3 Bead-history refusal authorization, item-1
Gone-with-reason and item-5 current-plane closure remain fixed. Additional explicit
choices are participation advertisement, an amendment if bounded diagnosis ends
Gone, local administrative scope/disclosure and the optional sync carrier. T49,
T63 and T64 are ruled at ACK 267f79d; T62’s direction is selected with its observable
contract open; T50–T61 remain provisional. None supplies a History default.

Validation: diff whitespace, local Markdown paths/anchors, pinned local git source
paths/ranges, twelve H headings and fifteen HR proposal rows, and unchanged schema
mirrors. The tracked fold writes only this record and the packet; the existing
index remains an accurate non-normative pointer and needs no edit. The separate
scratch first-ruling brief now presents **four items together**, with four separate
answers/open edges, and reflects this fold. No normative/schema/catalog/runtime or
evidence change, tests, agents, network calls, commit, push, post or merge occurred.
Parent inspection and independent review of the resulting final head remain owed;
this author record grants no clearance or implementation authorization.


## 2026-09-09 — final 297465d reports, corrections and operator ACKs

Reviewed input: `297465d1edde0acd5904526f1dd79b9d61d02e2f`. Native Codex reviewed
the full three-file branch and residual fold, returning 0 Critical, 0 High, 0 Medium
and 0 Low. The later completed Claude report returned **0 Critical, 1 High,
2 Medium and 3 Low: six findings**. This records the available reports, not an
inference that every other final-head seat has returned. The native zero-finding
review did not identify the documentation gaps below and does not clear this fold.

Independent adjudication checked the six claims against the frozen packet, local
baseline git objects and supplied primary comments. Findings 1 and 3 were partly
accepted; 2, 4 and 5 accepted; 6 accepted as provenance precision with qualification.
The corrections preserve settled intent and its distinction from unmaterialized
normative text. They do not create six new operator questions.

| Claude finding | Disposition and concrete correction |
| --- | --- |
| 1 High — Gone obligation versus baseline MAY | Partly accepted. The fixed row and H5 explicitly distinguish item 1’s required, history-authorized historical-address consequence from baseline ordinary Read’s discretionary disclosure. Reads after deletion and PROTO-013 are named as dated destinations for that scope/obligation materialization; unauthorized uniform 404 and optional archivedAt remain intact. Rejected asking Donna again whether History should require the already ruled consequence, treating baseline MAY as overriding later operator intent, or implying the packet retroactively invalidates existing ordinary-Read implementations. H5/HR06 retain the explicit amendment requirement if a diagnosis bound would end Gone. |
| 2 Medium — packet review chronology | Accepted. The summary now includes Codex/Gemini and Claude on 195071d, the nine-finding 9cc4cf4 council/fold, and the available 297465d reports. It distinguishes those reviewed inputs from this subsequent correction/ACK fold. |
| 3 Medium — retention-policy hold input | Partly accepted. The omitted input now has an explicit disposition: revision-2 C1/§1 proposed reporting an operator/provider hold in the window, but the later item-1 ruling says BDP carries no hold on the wire. The fixed row and H7 preserve that constraint. Local retention policy is not prohibited; adding wire hold state would require an explicit amendment, not an ordinary unruled H7 member choice. H1b bounds and H12 administration do not silently select it. |
| 4 Low — review status header | Accepted with finding 2. The header now names the recorded final native/Claude reviews and identifies this later fold as needing its own review, without inventing another seat’s completion. |
| 5 Low — missing baseline epoch anchor | Accepted as discoverability. Main 0b7d86e7 spec 1040–1048 is linked beside TX 1eef4e4 1094–1102; H9 locates the paragraph by text/section in the actual integration target. The immutable TX anchor was not invalidated by a possible rebase. No new epoch choice selected. |
| 6 Low — relation provenance | Accepted as precision. Acceptance 5464020140 explicitly names latest-version/successor-version; revision-2 also proposes predecessor-version/version-history. The later compatibility record broadly reaffirms currency input, so generic prior wording did not itself select new normative relations. H6 now states exact provenance; the operator’s separate ACK below selects its core. |

**Separate operator decisions, 2026-09-09.** After the interviews Donna ACKed A for
H1a, H2, H3, H4, H5 core, H6 core, H7 enumeration and H8, with every presented
deferral retained. The author received that exact scope through the parent handoff;
these selections come from the operator, not this review or its recommendations.
The packet records the selections beside each decision:

| Item | ACKed core | Explicit remaining boundary |
| --- | --- | --- |
| H1a | Optional complete History capability on Read, Read+Update and Transactional; no fourth profile | H1b advertisement remains OPEN; required Read+Update restore-disclosure amendment must precede implementation |
| H2 | Both canonical Bead and Link historical records; full historical owned state | Exact wire/admission materialization and independent Link disclosure details remain work; no partial or current-state fallback |
| H3 | GET/HEAD with exactly one nonempty opaque revision, complete record only; reject mixed/repeated/empty queries; canonical invalid-parameter, alias uniform 404 | No alternate address or nearest/current fallback; exact schema/fixture implementation still absent |
| H4 | Current whole-record authorization for successful historical resolution, uniform 404 on denial | Exact historical-target permission follow-up remains OPEN; fixed Unretained subject-history gate remains separate |
| H5 core | revision-unknown 404, revision-unretained 409, revision-reorganized 410, revision-not-tracked 409, all after-state-change; substantiated, history-authorized diagnoses | Existing pruned/erased contracts unchanged; no promised polling or repair; evidence shape/lifetime, sync carrier and refusal windows remain OPEN |
| H6 core | private/no-store; authority’s existing validator projection; truthful authorized latest/direct predecessor/direct successor and version-history to enumeration | General validator encoding and replacement navigation remain OPEN; no guaranteed target where none is truthful/authorized |
| H7 enumeration | Stable cursor-paginated versions surface, revision/attribution rows without payload, window/completeness, authority ordering, no retention hold | Row/page shape, replacement membership, deleted-subject enumeration and cursor/limit details remain OPEN |
| H8 | HEAD matches GET status/headers without body; GET provides typed diagnosis | Bulk checks explicitly deferred |

H9–H12 remain OPEN except for their fixed constraints; H1b and the listed residuals
are not implicitly ACKed. All fifteen HR scenarios remain design proposals, not
catalog entries or executable evidence. The frozen baseline has no History schema.
No normative/schema/runtime edit belongs in this fold while these details remain open.

**Queue supersession.** Donna also ACKed RP1’s separate coverage walk (never part
of the digest), T58–T61, T62a/b and T65. Earlier pending descriptions in this record
remain accurate only for their named historical heads; this record does not infer
current unanswered TX items from the older provisional list.
These current statuses were relayed with the operator handoff; this History fold
neither materializes the separate TX decisions nor infers a History assurance choice
from them. Their operational records remain the owning workstreams’ responsibility.

**Source and validation boundary.** The adjudication reread baseline disclosure
2095–2111, PROTO-013 68–77 and epoch paragraph 1040–1048. Supplied JSON and Markdown
bodies match for comments 5586084982, 5587346463 and 5573074065; their recorded update
dates put revision-2 input before the no-hold ruling. Acceptance 5464020140 was read
from the supplied primary snapshot. No live comment refetch or product-harness run
was performed. This fold edits only the packet, review record and design index.
Validation is limited to diff whitespace, local links/anchors, pinned local source
paths/ranges and three-file scope. No tests, installs, agents, commit, push, merge or
external post were performed by this author. A subsequent review must inspect the
actual correction head; this authoring record is not that review.


## 2026-09-09 — second eight-item History ACK and current queue verification

Donna ACKed the second presented batch as **A/A/A/A/B/A/B/A** with its explicit
initial-release boundaries. The previous section records the first batch’s state;
the following selections supersede only its corresponding open subchoices. They
were relayed explicitly in the authoring handoff, not inferred from recommendations.

| Item | Selected outcome | Remaining boundary |
| --- | --- | --- |
| H9a A | Common retained-address law in Revisions, referenced from History, plus narrow TX epoch amendment | Exact normative text/fixtures still to materialize; all other token fences and triggers remain |
| H5b A | No mayChangeAfterSync member initially; selected retry semantics and honest uncertainty prose | Any later hint requires exact evidence/meaning; no promised polling or repair |
| H9c A | Requested-token historical record without an extra current-scheme address initially | Internal mapping preserves the address; old/new revision identity, replacement navigation and write-guard details remain |
| H10 A | Opaque revisions and complete ordinary records initially; exact-byte witnesses later | No selected witness envelope/scheme/failure tuple or pin digest expansion |
| H11 B | Distinct immutable change-context envelope now meeting Memory R12 metadata | Exact wire/supply-state semantics remain; truthful absence, unchanged attribution/no-op law and no authentication/authorization claim; not full Memory compatibility |
| H12a A | Keep incident-Link deletion refusal initially | Alternative Memory surviving-citation lifecycle explicitly deferred; no hidden endpoint or snapshot exception |
| H1b B | No advance age/count retention guarantees initially; observed window remains distinct | Exact capability shape and participation advertisement remain; Gone duty and no-wire-hold law unchanged |
| H4b A | Current target visibility or explicit current historical identity/relationship disclosure permission satisfies historical closure | Never inferred from source access and grants no target body access; current-plane closure/DeleteBead unchanged |

H9b’s Read+Update History restore-signal exception was already required by the first
H1a/H5 ACK and was removed from the second ballot. It is materialization work, not
an independent unanswered choice. Donna’s current presentation preference is eight
answer units per batch, as recorded in the current ledger; the packet work order now
reflects that. The remaining-decision inventory distinguishes open initial-surface
choices from optional amendment requests and explicitly deferred capabilities.

**Current TX/Read status verified locally.** The [ledger at 63f3d786](https://github.com/donnabox/agent-coordination/blob/63f3d78674f93b85dad99fcfcf6cd0eed6d325c4/context/janet/beads-workstream-state.md#L944-L970)
records T50–T53 A, T54–T56 A, T57 B, T58–T61 A, T62a/b A, T65 A and RP1 ACK.
Its latest relevant records confirm the parent’s current status; older provisional
labels in frozen review history are not rewritten. T57 integration is selected but
was not implemented on the cited frozen TX head. T65’s supported claim route does
not by itself settle History-only assurance or weaken the every-store erasure duty.

**R12 primary readback.** The supplied gastownhall/beads#5877 primary issue body
was read directly. R12 distinguishes Change Attribution from editable Inception;
requires responsible actor, assisting agent when present, timestamp and message
when present; says otherwise-identical context-only requests create no version;
and makes no authentication or authorization claim. H11 now records the selected
metadata envelope against that primary input, without claiming full Memory
compatibility, verified product behavior or a live refetch in this author pass.

This extension remains confined to the packet, review and index. No normative,
schema, catalog, runtime or evidence artifacts are changed. Validation covers local
links/anchors, pinned local paths/ranges, whitespace and the three-file scope. No
tests, agents, install, commit, push, merge or external post were performed. Both
ACK batches and this combined uncommitted fold require parent review and subsequent
review of the actual saved head; prior frozen-head reports do not clear it.


## 2026-09-09 — consolidated ballot ACK: 38 History answer units

Input History head: `2774ff4d1d4ab82e921d9de0311186e79cc21aaf`, preserved frozen.
This author created an isolated `codex/janet-history-complete-rulings` worktree from
that head and changed only the packet, this review record and the design index.
The [durable consolidated ballot ACK](https://github.com/donnabox/agent-coordination/blob/4fd57836ae052dec41b66493b88954bdabbb4d0f/context/janet/history-tx-complete-ballot-20260909.md)
selects **B1/B3/B19 and A for every other unit**. Its units 1–22 are History;
23–27 belong to the separately owned Transactional/shared HTTP fold. The packet’s
22-row answer inventory maps every new selection to its owning H section. The
prior sixteen answers remain intact: **16 + 22 = 38 History answer units**.

This closes the presented initial-release semantic ballot, not the wire or runtime.
Equivalent encodings and truthful legacy-state restatements are not extra answer
units. Present/known-absent/undetermined context states and legacy-envelope absence
were already selected. Materialization authority was granted by the separate
PR/materialization ballot’s item 9, so neither execution permission nor that repeated
state question is queued again. Concrete contradictory requirements still require
Donna’s decision; delegated materialization cannot invent an exception.

**Recorded outcomes and consequence check:**

- Units **1 B / 2 A**: bounded known-missing inventory declares incompleteness;
  it remains whole-answer Unretained, without invented paths/temporary failures or
  partial Resource success. No refusal-body windows initially.
- Units **3 B / 4 A / 5 A / 6 A**: enumerate the selected all-retained population,
  distinguishing current/replaced entries; preserve truthful direct relations within
  each recorded lineage, without singular-cardinality assumptions or r3→r4 invention;
  omit erased entries; permit history-authorized deleted-subject enumeration.
- Units **7 A / 8 A / 9 A**: no minimum cursor-lifetime promise, existing
  cursor-expired and meaningful snapshot-preserving bounded progress; no aggregate
  participation advertisement; truthful subject participation knowledge without a
  new permanent marker promise. Gone and erasure evidence are not shortened.
- Units **10 A / 11 A / 12 A**: native authority-observed commit time, one instant
  for an atomic transaction and separate instants for independently committed
  sequence members; optional per-operation agent/message; the originating context
  reaches every version actually minted. No context-only no-op/delete version;
  original imported time needs provenance, never import-time substitution. Existing
  Event-time meaning, attribution fan-out and ordinary authentication stay fixed.
- Units **13 A / 14 A**: extra import-provenance fields deferred; native context
  required only for versions minted under advertised History, with compatible optional
  shared schemas and truthful legacy absence. Expose it in ordinary version records,
  mutation/receipt postimages, authorized history rows and matching created/updated
  Event data; not tombstones, aliases, identity references or properties-only views.
  Existing every-copy erasure and authorization rules cover the added context.
- Units **15 A / 16 A / 17 A**: all-profile local-store assurance and scoped tested
  persistent-consumer routes without a generic History acquisition promise; preserve
  exact TX/T65 duties where applicable. Imports require positive authoritative
  origin/version erasure status before visibility, else reject/discard. No identity
  laundering, uncontrolled quarantine or arbitrary-downloaded-copy promise. Generic
  pre-removal administration is deferred; Gone/erasure processing still applies.
- Unit **18 A**: new authorized `revision-unrepresentable`, conflict/409/
  after-state-change, initially without condition-specific payload. Positive declared-
  contract incompatibility is required; missing bytes, unknown provenance, private
  tooling limits or outage are insufficient. Erasure/non-disclosure takes precedence;
  Unretained and temporary service failures remain distinct. No original-value rewrite.
- Unit **19 B**: new write-only `revision-allocation-unsafe`, conflict/409/
  after-state-change for positively persistent repair-required conflict; transient
  evidence-inspection failure retains 503/after-delay. Preserve direct versus admitted
  failure, rollback/retained-failure rules, reads, duplicates, deadlines and safe
  candidate retry. No mandatory registry or new History read failure is introduced.
- Units **20 A / 21 A / 22 A**: newest-first stable authority display order;
  include positively evidenced retained incomplete non-erased versions with explicit
  body state, excluding disposition-only entries; authorize whole metadata rows,
  omit undisclosable rows and keep completeness/window metadata authorization-relative
  without hidden counts or redaction relabeled as uncertainty.

All outcomes were checked against the complete ACKed wording, including rationale
and fixed-boundary paragraphs, rather than just option letters. The packet’s older
open inventory is replaced by the selected-answer/materialization inventory and
explicit deferred-extension list. The 15 HR cases remain proposals and were updated
to exercise the newly selected diagnoses, membership/context/import and allocation
boundaries; no catalog row or evidence result is claimed.

**Validation boundary.** Diff whitespace, local Markdown paths/anchors, locally
available pinned source paths/ranges, 12 H headings, 15 HR proposals, exactly 22
consolidated answer rows and the three-file scope were checked. Both schema mirrors
and normative/runtime/catalog artifacts are unchanged by scope. No test suite,
harness, reviewer process, dependency install or external post was run. This author
is authorized to commit the decision-document fold locally; no push or merge is
part of the task. A separate scratch fan-out map identifies later integrated-base
materialization targets and validation slices without modifying those targets.
Historical reviews remain tied to their original heads and do not clear this fold.
