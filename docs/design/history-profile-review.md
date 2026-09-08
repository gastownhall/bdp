# History packet review record

Status: all seats completed on `ef6e997`; author fold awaits final-head review; no full-panel clearance. Non-normative.
Initial review date: 2026-09-08. Initial reviewed head: `02c598aa48630a41b2d9cf9d5b08b42878e1a9d9`.
Scope: `history-profile-packet.md` and its pinned authority snapshot.
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
Validation: inspected pinned source paragraphs and recorded T19/T25–T29 rulings;
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
