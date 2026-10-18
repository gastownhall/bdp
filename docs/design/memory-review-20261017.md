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
| Common conformance bars? | Memory is parent of Observation/Decision/Procedure/Policy/Lesson. The earlier independent-Association choice is superseded by the Association-family decision below. All five specialized Links now conform to Association; none declares Dependency conformance. |
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
The earlier independent-Association choice is superseded below; applicability is optional on all supplied
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
| Informational Link common contract | All six share one documented product behavior contract and schema. The later decision makes existing Association the common parent, without adding a seventh Type. Pair/pin differences remain explicit. |
| Issue↔Memory relationships | Explicit Issue→Memory Guidance/Association and Memory→Issue AppliesTo/Association. No Issue workflow-state dependence. |
| What is schema $id? | Technical tooling identifier, explained only in validation appendix; not a user field or product identity. |
| Unreadable endpoint table | Spell out pairs, one pair per displayed line, with a plain-language legend and reverse-direction example. |
| Link properties | All six accept optional nonblank note, open annotations, no additional mandatory fields. |
| Current versus pinned | Author chooses for Association/Guidance/AppliesTo and, following the later decision, Supersedes. Exact target remains mandatory for Supports/Challenges. Never silently auto-pin. |
| Existing relationship reconciliation | Short integration note preserves current Dependency semantics; full naming/preview compatibility remains explicit follow-through. |

At published head7202384, the product checker has64 positive/negative cases,9 Bead excerpts and6 local Link
excerpts. Four earlier external Link examples and the12-definition graph remain
optional BDP exploration. Seven obsolete duplicate-primary-field cases are retired;
new empty-body and non-text-body cases cover every specialization. No installed
Memory behavior or automatic data migration is claimed.

## Association family and replacement follow-up

Donna accepted Association as both directly authorable general connection and common
Link Type, analogous to Memory. Guidance, AppliesTo, Supports, Challenges and Supersedes
are its five specializations. All inherit optional nonblank note. Conformance-aware
family selection must not require a closed union; exact Association selection stays
distinct. No first-release general query engine or seventh Type is implied.

The AppliesTo target Reference identifies what the source applies to; no duplicate
target property or new structured conditions field is introduced.

Same-identity revision and new-identity replacement are both supported. Supersedes
points from replacement to predecessor, with current as default or an explicitly
chosen exact edition. It does not delete, redirect or rewrite incoming Links. Normal
floating cleanup and pinned-survival rules apply. Supports/Challenges still require
exact targets. This supersedes the earlier exact-only Supersedes rule.

The examples retain an exact replacement citation and add a current identity-level
replacement Link. The optional BDP experiment records ten family declarations: five
for Memory and five for Association. Previous 7202384 evidence above retains its
original six-Link excerpt count; this successor has seven local Link excerpts.

## Third pass: fields, status and concrete user operations

All eighteen annotations (seventeen /// lines and one unprefixed action-writing
request) are consumed from the editable proposal. Originals are archived in the
author's third-review checkpoint. Earlier field/count conclusions above retain their
original source identity; the following dispositions describe the current successor.

| Comment / discussion | Disposition |
| --- | --- |
| Release name | Verified Janet's public #7656/MEM-DEC-003: **Memory V1**, selected by Donna. Naming is not a ship-readiness claim. |
| Lead with ordinary Types and --type | Opening now states shared Bead/Link Type selection with no extra kind dispatcher. Existing Issue decision and Memory Decision have distinct identities; ambiguous short names require qualified selection. |
| Mark differences from Chris | Added sidebars at shared Type modeling/R1/R3, proposed vocabulary/minimum, applicability/R3/S15 and concrete search/R6. They identify alignment work, not invented acceptance. |
| Fields before meanings | Common title/body appear first; optional status is separate from the two required content properties. Meaning table is shorter. |
| Explain Memory family | Ordinary Memory plus all six specializations; distinguish family selection from exact-Type selection. |
| Applicability versus AppliesTo | Applicability context remains application metadata; AppliesTo names a specific target Bead. No supplied applicability property, metadata field schema or validity interval. |
| Minimum vocabulary | Ordinary Memory Bead plus a general informational Link supports Chris's scenarios when required shared behavior exists. His baseline is related; Association naming needs reconciliation. Extra Types provide explicit meanings/selection, not minimum conformance. |
| Duplicate primary-field/internal extension discussion | Removed from main narrative. Body is the primary text, unknown-field preservation stays a concise writer rule in validation notes. |
| Full applicability fields | No standardized applicability fields selected; metadata examples are application conventions. Prior applicability property stays uninterpreted extension data if encountered. |
| Type-by-Type field tables and JSON | Seven subsections repeat inherited title/body/status and list local properties, each with a concrete JSON value. |
| Reuse Memory title synthesis | Existing graph-Memory title helper supplies the rule; implementation should reuse it. Legacy remember DeriveKey synthesizes a slug key, not a display title, so it is not substituted. |
| Remove query-review housekeeping | Removed bd query process notes from the user proposal. Shared search/filters supply concrete user operations. |
| Discovery/traversal too abstract | Defined discovery once, then used list/search/follow Links/read with CLI examples. Search matching/order are explicit review proposals. |
| bd revert not shipped | Clearly marked unavailable for this Memory workflow; added proposed shared CLI in Appendix A. Meaning is accepted; exact shared selector/flags remain proposed. |
| Use Bead and action statements | Technician/team walkthroughs now describe creating, linking, searching, reading and revising named Bead Types. |
| Justify bd memory command group | Four tailored capture/list/search/full-read commands; ordinary update/delete/Link/History operations use shared commands. Compatibility aliases retain the accepted direction. |
| Decision status | Optional nonblank open string, no enum/default or verified ratification. Same-revision/history rules apply. |
| Requirement Type | Added Requirement specialization with demanded outcome/constraint in body, distinct from Issue work and Policy/Decision meaning. |
| Which Types benefit from status? | Donna selected optional status on both Memory and Association bases, inherited by all specializations. Example conventions per Type have no implicit filtering/activation or enforced vocabulary. |
| Existing Issue/Dependency status | Issue has required workflow status with built-ins/configured values; Dependency has no declared status field. Existing contracts are unchanged. |

The source-level changes include one new Requirement schema/definition, updated
common schema copies, metadata examples and inherited optional status cases. The
validated inventory is eight owned schemas,102 property cases,ten Bead and
eight local Link excerpts,thirteen exploratory definitions and eleven declarations
(six Memory/five Association). The checks passed on this candidate;
none of these counts qualify runtime search, status workflow or new CLI support.

Donna answered the placement question explicitly: **Memory and Association bases**.
That placement is accepted product direction; the example strings remain conventions.

## Fourth pass: Memory-specific functionality before CLI tuning

Donna redirected CLI work to principles and genuinely distinct functionality before
choosing create/update/list/show/delete customizations. Treat bd query as a redesign
surface and specify useful Memory Bead/Link questions without its existing grammar.
The three new /// annotations are consumed; originals are archived locally.

| Comment / direction | Disposition |
| --- | --- |
| Examples for each operation | Section3 now supplies concrete capture/correction, browse, topic search, Link navigation and exact-read examples without inventing command flags. Appendix A adds eight query scenarios with inputs and result contracts. |
| Second positional title, body/title flags | Deferred to the authoring-ergonomics pass as requested in chat. No decision made about positionals or domain wrappers. |
| bd update lacks body/body-file flags | Removed the misleading illustrative command and all tuned CRUD grammar from the current proposal. Shared operation capabilities are stated without claiming existing flags. |
| Unique Memory verbs first | Current model justifies no new write primitive: create/update/retype/Link/Supersedes/History use shared mechanisms. A future workflow verb must supply a distinct contract, not only preselect Type. |
| Query redesign | Eight proposed scenarios: topic search, explicit context selection, knowledge linked to work, evidence for an edition, replacement navigation, pinned-versus-current comparison, reverse impact and Decisions linked to Requirements. Preserve concrete Link meanings, pins/history, bounds and match reasons. These do not automatically expand Preview3 allocation. |
| Candidate actual-use workflow | Distinguish Guidance from an asserted use record. Shared Activity/provenance needs further design before selecting a verb; no second Activity model or automatic use inference. |

The earlier four-command CLI/flag proposals above are historical and superseded by
this principles-first pass. Schema/case/example JSON, including accepted common
status and the Requirement catalog entry, are byte-identical to c064cc3; do not
report the old property passes as a runtime query or CLI qualification.
