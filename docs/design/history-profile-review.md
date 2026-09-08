# History packet review record

Status: partial council; no full-panel clearance. Non-normative.
Date: 2026-09-08. Reviewed head: `02c598aa48630a41b2d9cf9d5b08b42878e1a9d9`.
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
review. The missing Claude seat and final exact-head panel remain required before
full council clearance. Exact-head review/CI and Donna’s transition decision are
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
