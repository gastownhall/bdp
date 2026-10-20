---
type: Decision
id: ""
status: accepted
---

# MEM-DEC-010. Evaluation-owned collective conformance claims

## Choice

Every Addresses, Satisfies, or Violates claim belongs to a Bead representing a conformance evaluation, including self-authored or unattested claims. Direct, unowned subject-to-Constraint claims are not part of the successor model. Any Bead may be an assessed subject; the evaluation owns the claim without owning or revising those subjects. The claims run from that evaluation Bead to the assessed Constraint Beads; the evaluation identifies the actual assessed subjects and their selected revisions separately. This uses source ownership rather than introducing a third-party owner for a subject-to-Constraint Link.

An evaluation can concern multiple subjects or one compound subject. A claim about several subjects concerns them together. For example, a Web app and an API may together satisfy a Requirement without either component satisfying it independently. Individual conformance needs an explicit claim about the individual subject; group membership alone supplies none.

Each evaluation declares one subject group, and every claim it owns concerns that whole group. A different group requires a separate evaluation; claims do not select subsets of the owner's group. Multiple independent evaluations may assess the same group, retaining their own claims and provenance.

Query results must distinguish the evaluation/claim owner from the assessed subjects, preserve the assessed group and selected revisions, and avoid distributing collective claims to individual members. A query for one participant may show the collective claim as context without presenting it as that participant's individual satisfaction. Claims about overlapping groups are not automatically claims about the same assessed scope.

## Rationale

Recording a conformance evaluation should not revise the subject being examined. A dedicated evaluation record can group its claims for understandable provenance and lifecycle handling. Collective scope supports systems whose components jointly meet a constraint without making false per-component claims.

## Original representation boundary (historical)

Assessment was Melinda's working name for the evaluation record, not an existing or selected Type name. The concrete Type or reuse/refinement of an existing Type, subject-reference representation, revision syntax, evaluation-group binding, and cleanup/retention behavior remain to be specified. This ruling does not introduce a ninth Memory Bead Type, a new kind/outcome field, an automatic cascade, or a third-party ownership field.

This resolves MEM-DEC-009's open evaluation-owner direction, collective-versus-individual meaning, full-group versus per-claim-subset scope, and the choice of one uniform evaluation-owned claim model. The earlier Memory source at 010be646 describes the direct subject-to-Constraint, unowned-claim baseline and retains its exact identity for historical/frozen consumers. The main Memory draft now propagates this decision and proposes Evaluation as a Memory subtype with a typed subject-group property. That concrete carrier, reference encoding and lifecycle still need review; publishing the successor does not switch a frozen implementation input. Accepted direction is not implemented or qualified behavior.

## Subsequent concrete carrier selection

Donna subsequently approved: **“Yes—Evaluation with exact subject revisions”**, answering Trish's explicit implementation question on October 19, 2026. Evaluation refines Memory and owns Conformance-family claims. Its `subjects` property is a required nonempty array of exact Bead references, each shaped as `{"uri": "…", "revision": "…"}`. Floating subject references are refused; selected exact revisions identify the assessed versions. This resolves the original carrier/refinement and subject-reference shape boundary above without changing the collective-group or ownership rules.

The main Memory catalog propagates this selection. No installed Type ID, special lifecycle automation, deletion cascade, evaluator framework, ephemeral graph identity/framing, or broader pin policy is selected. Context/run bindings, structured evidence, reconciliation and detailed lifecycle integration remain open. Accepted design is distinct from implementation and qualification.

## Subsequent identity-binding clarification

On October 20, 2026, Donna selected keeping the original subject group bound to the Bead identity when an Evaluation is retyped away from Evaluation and later back. The first successfully accepted Evaluation state establishes that binding. Reordering the same exact subject group is allowed; changing its membership or selected revisions requires a new Evaluation Bead identity. Repeated leave/return transitions and removing claims do not reset the binding. An ordinary `subjects` extension property before the Bead first becomes an Evaluation does not bind it.

The main Memory draft carries this invariant. It does not prescribe a new database field or retention mechanism, change the previously selected BDP source revision, or claim product qualification. The implementation owner records evidence separately in [BDP59](https://github.com/gastownhall/bdp/issues/59).

## Decision provenance

Donna accepted evaluation-owned claims with multiple subjects or a compound subject, then explicitly selected collective meaning, one full subject group per evaluation, and evaluation ownership for all claims in Melinda's chat. The [query/CLI scope proposal](https://github.com/donnabox/beads/blob/3a161244f44a9ef97c952af965929f3cc32ff610/engdocs/design/memory-query-scope.md) carries the design implications; its exact published revision is recorded in the publication ledger. MEM-DEC-010 is an authoring label, not a store-assigned Bead identity.

The concrete-carrier ruling was verified directly in Donna's question reply in **Beads: Trish (Active)**, chat `01a15316-0acc-7c71-b4d8-3e330e80d9de`, question `call_b0de333c50484d85a60a0bbbf401b3d0`, reply `01a156b7-cead-72c1-9d5b-9bee324115cf`. This is a recorded human ruling, not a claim of cryptographic attestation.

The identity-binding ruling was verified in Donna's question reply in **Beads: Trish (Active)**, chat `01a15316-0acc-7c71-b4d8-3e330e80d9de`, question `call_b7c0b11d98ce471985d324c6e7fefd8f`, reply `01a159b6-f123-7d72-974d-b33545b0b985`: **“Keep original group for that identity (Recommended)”**. The first-acceptance, ordering and pre-Evaluation-extra details are recorded in the current [BDP59 ledger](https://github.com/gastownhall/bdp/issues/59) and Trish's implementation handoff.
