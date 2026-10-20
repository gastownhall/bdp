---
type: Decision
id: ""
status: accepted
---

# MEM-DEC-008. Conformance claim peers and Type refinement

## Choice

Conformance is a neutral Link Type refining References. Addresses, Satisfies, and Violates are peers directly refining Conformance. Satisfies no longer refines Addresses. All use Any Bead → Constraint endpoints, including Issue Beads as subjects.

Conformance declares the common optional evidence property and source-owned claim contract, including independent parallel claims, provenance, and no general transitivity. Each peer retains its distinct assertion and composition rules: Addresses claims contribution without a completeness judgment, Satisfies claims complete satisfaction and supports compatible uninterrupted satisfaction chains, and Violates claims breach with no implicit transitivity. Membership in the common family supplies no conclusion or verification. No `kind` or outcome enum is introduced.

Memory declares outgoing Conformance-family ownership instead of separate Addresses/Violates ownership. Other source Type definitions, including Issue, need the same family declaration when adopting this contract. A Conformance-family query includes all three forms; an Addresses-only query no longer includes Satisfies.

Rename the Type-to-Type relationship ConformsTo to Refines. Its universal structural and semantic promise remains: every valid instance of the source Type meets the target Type's contract. This is conceptually closer to Requires necessity than an individual Satisfies claim. No actual Refines→Requires subtype edge or synthesized `type`-field claim Link is selected.

## Rationale

The shared parent captures common evidence and ownership without making breach a contribution or complete satisfaction a contribution subtype. Separate names distinguish a claim about one subject's conformance from universal Type refinement.

## Alternatives considered

Retaining Satisfies under Addresses would keep a contribution inheritance that the new peer model deliberately removes. Putting Violates under Addresses would imply contribution from breach. Using ConformsTo for both the shared Type relationship and individual claims would obscure the different promises.

## Scope and follow-through

Accepted design direction for the Memory proposal and shared Type naming. The Memory catalog now contains eight Bead Types and nine Link Types. Direct authoring of unspecialized Conformance Links remains undecided. Predicate/pin/evidence/lifecycle deferrals and the informative CLI sketch remain separate work.

The [Memory catalog](../../specs/types/memory/memory.md#conformance--link-type) applies the new hierarchy. Trish owns propagation into the shared Type profile/metatype, authoring format, and source-bound projection with Janet. This Decision does not select stored Type IDs/URIs, rename wire/storage fields automatically, waive compatibility work, allocate a preview, unfreeze a candidate, or establish runtime qualification.

## Decision provenance

Donna Box directly accepted the Conformance peer hierarchy and Refines name in Melinda's chat on October 19, 2026. Melinda records the decision and projects it into the existing [beads#7656 Decision register](https://github.com/gastownhall/beads/issues/7656#mem-dec-008-conformance-claim-peers-and-type-refinement). MEM-DEC-008 is an authoring label; the Bead identity is unassigned.

## Subsequent decision

[MEM-DEC-009](memory-review-boundaries-decision-20261019.md) supersedes this entry's source-owned assessment rule and open direct-authoring question: Conformance is abstract and assessment claims do not revise the assessed subject. Its peer hierarchy, common evidence inheritance, and Refines name remain accepted. The original Choice above is retained as the historical decision.
