# History packet review record

Status: all seats returned on `195071d`; subsequent source-checked author fold awaits final-head review; no clearance for this fold. Non-normative.
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
requirements PROTO-013 68–78); #23 `2c537a6f8a4f42e4fef0fa5d47439bcb25d2efe7`
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
