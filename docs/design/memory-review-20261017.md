# Memory review dispositions — October 17

Historical disposition of the first fourteen review annotations in
`specs/types/memory/memory.md`. The annotations have been consumed and removed from
the editable draft. Original comments are archived in the author's local review
checkpoint. The second pass reframes the proposal for the Memory Release; its current outcomes
are recorded below. This note is not another specification or runtime claim.

| Comment / question | Response and disposition |
| --- | --- |
| Match Issue Type modeling | Explicit affiliation plus named properties follows the agreed Issue/Dependency design. Called out in the opening; existing legacy runtime projections are not claimed migrated. |
| Fixed catalog beyond previews | Sidebar makes fixed catalog plus inventory/details the first supported-release target; general installation/public Type editing are outside it. Release name remains pending Janet/Donna. |
| Which Activity / V2? | Precisely Provenance V2 #7510's independent Activity-typed work report. No second Activity definition. Polly/Iris are reconciling shared provenance, not adding another Type. |
| Required actor: more elaborate provenance? | No Memory-specific actor fields or attestation. Responsibility uses the selected shared encoding; recorded identity is not authenticated participation. Wider principal/role design remains Polly's work and M-D4 may follow P3. |
| Cost of widening related | Background source audit completed. Native Dependency related is Issue-backed, source-owned and pair-unique; private preview-related already accepts Memory. Keep Association while considering any later convenience or precursor reuse. See the linked research report. |
| Where did the catalog come from? | Plain Memory follows capture/reuse requirements. Policy citation follows S5. Decision is informed by ADRs; Procedure by reusable job plans. Observation/Lesson and the exact six Link names are our design synthesis, not a taxonomy required by Chris or an external standard. R3 field contracts and the useful minimum catalog remain review work. |
| Common conformance bars? | Memory is parent of Observation/Decision/Procedure/Policy/Lesson. Association is an independent Link, not parent of the other five. Supplied Links declare no conformance to each other or Dependency. |
| Delegate Inception to Polly / notify Iris | Done. Polly has shared Bead/Link create/import/unknown/restore/origin requirements and Iris has the import-format dependency. Memory-only property/schema removed; fourteen old shape cases retired, not counted as provenance passes. The later accepted single-field presence/revert decision supersedes the earlier origin/entry recommendation; see the current-pass section. |
| Which Types can use applicability? | Optional on all six via the Memory base: circumstances, scope, equipment, jurisdiction or relevant conditions. Absence is unspecified; dates do not change lifecycle automatically. |
| Do not prohibit every subtype's kind | Corrected prose, base/Link schemas and embedded copies. Supplied Types do not dispatch on kind; open extensions can use the name without changing affiliation. Two cases show it neither selects a subtype nor satisfies required subtype fields. |
| Derive title from body: CLI affordance? | Authoring affordance shared by selected writers. Reuse existing first-nonblank-line display helper: collapse whitespace, at most 80 code points including truncation ellipsis, preserve body. Storage final state still requires a title; readers do not synthesize one. |
| bd memory tailored surface | Donna selected canonical bd memory with remember/recall/memories/forget compatibility aliases over the same records and writers. Exact subcommands/flags/output remain design work; bd query is under review for scenario coverage. |
| Knowledge form / remember default | Removed jargon. Plain bd remember creates ordinary Memory; a specialization is explicit, not inferred from content. |
| Creation causes / open enum | The later shared decision selects one Inception open enum for the current period of presence in a Scope; ordinary edits preserve it, and deleted-to-live revert sets revert. The origin/entry facets were never adopted. |

## Cross-workstream decisions

Janet owns #7656 keys M-D1 References/re-pin, M-D2 deletion and M-D3 restore —
required in P3. M-D4 broad provenance and M-D5 Task Link projection may follow P3.
M-D6 specialized payload/catalog runtime remains the parallel Trish implementation
plan, not a second worker lane. Updates cite exact contract/source, acceptance and
readiness per Janet's requested ledger model. Sidebars link that record.

Donna confirms Type mutability is already decided; Types §2 specifies atomic
whole-reference replacement with resulting-property/constraint validation. Iris's
finding concerns the frozen Core singleton/batch wire members, not an open product
choice. Trish confirmed Types §2, product #7590 and implementation plan99ab2594 as durable
sources. Retyping is one ordinary guarded Bead/Link update, composable in batch.
Targeted property edits preserve untouched fields and validate complete resulting
state; a full replacement must supply all mandatory fields. Runtime/wire adoption
and detailed ownership transitions remain pending; no BDP deployment dependency.

First-pass evidence at0b151ac/d6337ab:60 property cases and95 shared cases passed. Count change is72 minus14
retired Memory-property Inception cases plus2 new extension/dispatch distinctions.
Seven schemas/12 definitions/record closure remain checked. No runtime tests or
current-build Memory support claimed. No merge/main/pin/release action performed. The draft and companion artifacts are
published through PR143; publication is separate from acceptance.

Artifacts: [specific gaps](../research/memory-implementation-gaps-20261017.md),
[related compatibility cost](../research/memory-related-compatibility-cost-20261017.md),
[editable Memory draft](../../specs/types/memory/memory.md).

## Accepted shared Inception and revert follow-through

Polly's [decision receipt](https://github.com/gastownhall/beads/issues/7510#issuecomment-6242419971)
supersedes the unadopted origin/entry facets and correction proposal. There is one
shared revisionProvenance.inception open enum describing this identity's current
period of presence in its Scope. Ordinary edits preserve it; live-to-live revert
preserves it; deleted-to-live revert sets revert. Shared bd revert selects old
properties/metadata into a new same-ID revision with current-operation provenance.
It does not roll back Type/endpoints or implicitly recreate other deleted Links.
Shipping bd restore retains pre-compaction Issue-content recovery. Shared runtime
and wire adoption remain separate from this accepted product decision.

## Decision capture format suggested to Janet

Use a table as a projection of Decision-shaped records: stable record ID, title,
body (decision and rationale), optional alternatives, applicability/scope and source
links. A displayed choice column is a projection of body, not a second required
canonical primary-content field.
A supersedes link relates a replacement decision to its predecessor. Decision-maker
and decision time are distinct from the actor/time that captured this row; preserve
the evidence rather than invent authentication. Proposed/accepted/deferred is a
ledger convention, not another universal Memory property or Task workflow.

Link each decision to relevant M-D dependency rows. Recording the ruling, updating
contract prose, implementing it and qualifying it are separate evidence states.
Janet chooses the final format and authoritative location; this is not another ledger.

## Interactive conversation carried forward

Resolved questions are answered in the draft: Memory is the Bead conformance base,
Association is an independent Link Type, applicability is optional on all supplied
Memory Types, plain capture defaults to Memory, and title derivation is an authoring
affordance. The catalog is a proposal grounded in scenarios and selected prior art,
not a taxonomy mandated by Chris. The `related` compatibility audit is complete.

Donna answered the command-layout question in chat: `bd memory` is canonical,
with existing remember/recall/memories/forget compatibility aliases. This selects
the group/alias direction, not exact new verbs, flags or output contracts. Polly's newer accepted single-field Inception/revert ruling replaces the earlier
origin/entry questions; it is reflected in the current draft.

Iris's [interchange and dependency draft PR165](https://github.com/gastownhall/bdp/pull/165)
provides a durable shared review surface. Its publication does not adopt pending
provenance fields or authorize runtime activation.

## Second pass: Memory Release product proposal

Donna selected product proposal scope: **Memory link and bead types** plus supporting
CLI. Generic BDP Type-definition/bootstrap/evolution discussions leave the main
narrative. The property checker now runs independently of the BDP profile; an
explicit optional mode retains checks of the separate exploration.

The pass consumes thirteen new prefix comments and two unprefixed design questions;
original wording is retained in the author's review checkpoint, not the spec.

| Comment / discussion | Current disposition |
| --- | --- |
| Product or BDP specification? | Product proposal with CLI appendix; later derive BDP mapping from the accepted contract. Opening uses Memory link and bead types, as Donna requested. |
| bd query wording | Exactly states bd query is under review for scenario coverage. |
| Body versus primary fields | Donna chose body as primary. Trish confirms semantic Types need not have structurally different schemas. Removed required statement/choice/steps/rule/takeaway everywhere; optional distinct information remains. Empty body compatibility is preserved. |
| Is applicability timespan required by Chris? | S15 motivates validity metadata, not this interval vocabulary. Defer validFrom/validUntil and ordering; retain descriptive applicability. No automatic expiry/revisions. |
| URI plus revision syntax | Keep existing test-artifact representation; no new compact syntax invented. Convenient CLI revision notation remains a reference-surface question. |
| Project terminology | Remove the invented Project/Scope mixture; define only existing Scope context and canonical identity. No new Project record/ID. |
| Informational Link common contract | All six share one documented product behavior contract and schema. Trish confirms a seventh authorable nominal parent is unnecessary for this release. Pair/pin differences remain explicit. |
| Issue↔Memory relationships | Explicit Issue→Memory Guidance/Association and Memory→Issue AppliesTo/Association. No Issue workflow-state dependence. |
| What is schema $id? | Technical tooling identifier, explained only in validation appendix; not a user field or product identity. |
| Unreadable endpoint table | Spell out pairs, one pair per displayed line, with a plain-language legend and reverse-direction example. |
| Link properties | All six accept optional nonblank note, open annotations, no additional mandatory fields. |
| Current versus pinned | Author chooses for Association/Guidance/AppliesTo; exact target mandatory for Supports/Challenges/Supersedes. Never silently auto-pin. |
| Existing relationship reconciliation | Short integration note preserves current Dependency semantics; full naming/preview compatibility remains explicit follow-through. |

The product checker has64 positive/negative cases,9 Bead excerpts and6 local Link
excerpts. Four earlier external Link examples and the12-definition graph remain
optional BDP exploration. Seven obsolete duplicate-primary-field cases are retired;
new empty-body and non-text-body cases cover every specialization. No installed
Memory behavior or automatic data migration is claimed.
