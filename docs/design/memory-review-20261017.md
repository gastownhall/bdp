# Donna's first Memory review — October 17

Disposition of the first fourteen review annotations in
`specs/types/memory/memory.md`. The annotations have been consumed and removed from
the editable draft. Original comments are archived in the author's local review
checkpoint. This note records outcomes; it is not another specification or a claim
of full contract/runtime adoption.

| Comment / question | Response and disposition |
| --- | --- |
| Match Issue Type modeling | Explicit affiliation plus named properties follows the agreed Issue/Dependency design. Called out in the opening; existing legacy runtime projections are not claimed migrated. |
| Fixed catalog beyond previews | Sidebar makes fixed catalog plus inventory/details the first supported-release target; general installation/public Type editing are outside it. Release name remains pending Janet/Donna. |
| Which Activity / V2? | Precisely Provenance V2 #7510's independent Activity-typed work report. No second Activity definition. Polly/Iris are reconciling shared provenance, not adding another Type. |
| Required actor: more elaborate provenance? | No Memory-specific actor fields or attestation. Responsibility uses the selected shared encoding; recorded identity is not authenticated participation. Wider principal/role redesign remains Polly's work and M-D4 may follow P3. |
| Cost of widening related | Background source audit completed. Native Dependency related is Issue-backed, source-owned and pair-unique; private preview-related already accepts Memory. Keep Association while considering any later convenience or precursor reuse. See the linked research report. |
| Where did the catalog come from? | Plain Memory follows capture/reuse requirements. Policy citation follows S5. Decision is informed by ADRs; Procedure by reusable job plans. Observation/Lesson and the exact six Link names are our design synthesis, not a taxonomy required by Chris or an external standard. R3 field contracts and the useful minimum catalog remain review work. |
| Common conformance bars? | Memory is parent of Observation/Decision/Procedure/Policy/Lesson. Association is an independent Link, not parent of the other five. Supplied Links declare no conformance to each other or Dependency. |
| Delegate Inception to Polly / notify Iris | Done. Polly has shared Bead/Link create/import/unknown/restore/origin requirements and Iris has the import-format dependency. Memory-only property/schema removed; fourteen old shape cases retired, not counted as provenance passes. Exact shared representation remains open. |
| Which Types can use applicability? | Optional on all six via the Memory base: circumstances, scope, equipment, jurisdiction or relevant conditions. Absence is unspecified; dates do not change lifecycle automatically. |
| Do not prohibit every subtype's kind | Corrected prose, base/Link schemas and embedded copies. Supplied Types do not dispatch on kind; open extensions can use the name without changing affiliation. Two cases show it neither selects a subtype nor satisfies required subtype fields. |
| Derive title from body: CLI affordance? | Authoring affordance shared by selected writers. Reuse existing first-nonblank-line display helper: collapse whitespace, at most 80 code points including truncation ellipsis, preserve body. Storage final state still requires a title; readers do not synthesize one. |
| bd memory tailored surface | Permitted proposal over canonical records/shared mutations. Exact command grammar is still to design with Janet; bd query redesign is respected. |
| Knowledge form / remember default | Removed jargon. Plain bd remember creates ordinary Memory; a specialization is explicit, not inferred from content. |
| Creation causes / open enum | Polly proposes semantic create/import causes rather than literal CLI names, with origin versus destination entry; identity continuity/copy and legacy-conversion transformation are distinct. Restore preserves identity origin. This is a recommendation, not an adopted wire enum. |

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

Checks:60 active property cases and95 shared cases pass. Count change is72 minus14
retired Memory-property Inception cases plus2 new extension/dispatch distinctions.
Seven schemas/12 definitions/record closure remain checked. No runtime tests or
current-build Memory support claimed. No merge/main/pin/release action performed. The draft and companion artifacts are
published through PR143; publication is separate from acceptance.

Artifacts: [specific gaps](../research/memory-implementation-gaps-20261017.md),
[related compatibility cost](../research/memory-related-compatibility-cost-20261017.md),
[editable Memory draft](../../specs/types/memory/memory.md).

## Completed shared Inception design handoff

Polly completed the bounded recommendation and proposal edit-map; native Codex,
Claude and Iris format review findings are processed. This is design review, not
adopted fields or runtime qualification. The owning recommendation, proposal edit-map and review record are retained in
Polly's design packet for [Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510).

Two semantic decisions remain with Donna:

1. Adopt the distinction between the Resource identity's recorded original origin
   and its entry into the present recording authority. A later revision operation
   is separate; import does not rewrite retained source representations, and restore
   preserves current origin/entry while selecting old content.
2. Permit an explicit correction to the recorded origin account in a new revision
   under a shared rule. Earlier accounts remain immutable; an identical resubmission
   stays a no-op and observed entry facts cannot be overwritten by arbitrary claims.

Melinda recommends both meanings and correction under the guarded shared rule.
Exact names, input/read encoding and correction operation remain shared editor work.
An old Memory-property entry claim cannot be relabeled as identity birth or a
service observation. No full provenance expansion becomes a new M-D3 prerequisite.

## Decision capture format suggested to Janet

Use a table as a projection of Decision-shaped records: stable record ID, title,
choice, rationale/body, optional alternatives, applicability/scope and source links.
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

The command-layout question is brought back to Donna in chat: recommend `bd memory`
as the primary group, keeping existing remember/recall/memories/forget as aliases.
This is a proposal until Donna rules. Polly's origin/entry and correction semantics
remain her separately reviewed shared-design questions; no answer is inferred here.

Iris's [interchange and dependency draft PR165](https://github.com/gastownhall/bdp/pull/165)
provides a durable shared review surface. Its publication does not adopt pending
provenance fields or authorize runtime activation.
