# Memory Beads: provenance, governance, and decision traceability

October 11, 2026. Research and design recommendation for Donna; not a normative
amendment, implementation qualification, or release commitment.

## Finding

The useful product umbrella is **decision traceability**: preserve what a decision
says, the exact information associated with it, the reasons offered for it, who
recorded or approved it, and how those records changed. Provenance is an important
part of this. Governance determines the policies and authority under which the
information is maintained and used. Neither term should absorb the other.

Our proposed versioned Provenance Assertion Bead is a suitable mechanism for
claims about exact Bead or Link revisions, including claims made after the fact.
It is not a replacement for every source of operational history, and the mere
presence of an assertion cannot prove a decision actually used, was justified by,
or was authorized by its referenced material.

## Sources and method

- Chris Sells's [Memory Beads proposal #5877](https://github.com/gastownhall/beads/issues/5877),
  body revision 4, dated September 22; retrieved October 11. The issue's latest
  activity timestamp was October 9, not a new body revision. Read the full body
  and relevant author comments; distinguish later commentary from amendments.
- Chris's [revision-2 naming explanation](https://github.com/gastownhall/beads/issues/5877#issuecomment-5472794536),
  [revision-4 clarification](https://github.com/gastownhall/beads/issues/5877#issuecomment-5787432078),
  [October 3 RDF lessons](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303),
  and [October 6 consolidation discussion](https://github.com/gastownhall/beads/issues/5877#issuecomment-6009424090).
- [Product audit](memory-provenance-product-audit-20261011.md): freshly verified
  released, upstream-development, and preview evidence, kept separate.
- [Terminology sources](provenance-terminology-sources-20261011.md): W3C PROV,
  OMG SACM and DMN, OpenLineage, NIST, and official governance documentation.
- The proposal's pinned [MindSpec architecture](https://github.com/mrmaxsteel/mindspec/blob/09f62bd97b28bae7b171054066117cb19a33874d/.mindspec/core/ARCHITECTURE.md)
  and [context budgeter specification](https://github.com/mrmaxsteel/mindspec/blob/09f62bd97b28bae7b171054066117cb19a33874d/.mindspec/specs/088-context-pack-budgeter/spec.md)
  were read as design evidence. No claim that their current implementation was tested.

No production data, shared database, CLI feature, canonical specification, or
reviewed Type draft was changed. Source inspection is not a runtime test.

## What Chris's terms actually require

The current proposal does not offer one universal provenance object. It separates:

| Proposal location | Requirement | Suggested precise name |
| --- | --- | --- |
| R12 | Responsible actor, assisting agent, time, optional message per accepted version | Change attribution and change context |
| R3, R12 | Editable native/conversion/import origin | Ingestion/transfer provenance (the proposal calls it Inception) |
| R3 | Sources of content, including unknown/empty/populated and completeness distinctions | Derivation provenance |
| S4–S6, R7/R9/R10/R18 | Exact citations and consumer-owned context receipts | Citation and context-input traceability |
| R6 | Why a search result matched | Retrieval explanation |
| S1/S8, R3/R30 | Explanations and evidence, with quality judgment outside core | Decision rationale and evidential support |
| R29, TC1, out-of-scope | Shared policy facilities; no mandatory Memory-specific roles or approval scheme | Governance boundary |
| R5/R16/R27a | Retention, erasure, and deliberate body exposure | Lifecycle and disclosure requirements |

Source: [proposal](https://github.com/gastownhall/beads/issues/5877).

The name Inception was chosen partly to avoid collision with shipped
`bd provenance`, not because origin/transfer information falls outside the normal
meaning of provenance. Chris explicitly records that rename in the
[revision-2 comment](https://github.com/gastownhall/beads/issues/5877#issuecomment-5472794536).

My interpretation: the proposal asks for dependable, attributable, citable
knowledge inputs and enough records for consumers to explain decisions. It does
not ask core Beads to infer truth, reconstruct unrecorded reasoning, or enforce a
universal knowledge-approval workflow. Governance is largely delegated, but the
specific retention and disclosure requirements remain real obligations.

## Reading the whole proposal through a decision scenario

Consider a decision D@4 to choose storage engine X after examining benchmark B@2,
policy P@7, and an alternative A@1. Five different questions arise:

1. **What was supplied?** A context receipt identifies B@2, P@7 and A@1 as inputs
   presented to a particular run. It does not establish their influence on D.
2. **What produced the decision?** Production provenance connects the output
   revision to a process/run, its inputs and responsible actors to the extent
   actually recorded. A citation alone is weaker evidence.
3. **Why accept the decision?** An assertion that B@2 supports D@4 needs a stated
   evidential relation and, when material, the reason it supports the conclusion.
   A@1 may be considered and rejected rather than supporting D.
4. **Was it allowed?** A policy/approval record establishes a claim about authority
   or process compliance. Enforcement belongs to the governing application or
   service, not to the existence of a reference to P@7.
5. **What should happen when B changes?** Impact analysis can identify D for
   reconsideration. It cannot conclude mechanically that every dependent decision
   is false or automatically rewrite D's historical inputs.

These are our interpretation and proposed acceptance questions, not additional
requirements silently attributed to Chris. His October 3 comment directly
motivates more useful relationship conventions and separately addressable
disputable knowledge. It recommends examples before mandatory standardization.

The cited MindSpec design illustrates the split. Its context-pack design records
input identities/hashes; its architecture separately describes ADR status,
supersession and approval gates. A hash can bind recorded bytes; it does not prove
that those bytes justified a decision or that the reviewer had authority.

## Established terminology

| Term | Working meaning for this design |
| --- | --- |
| Provenance | Production, use, derivation and responsibility history of an entity |
| Attribution | Association with the actor responsible for a particular entity/version |
| Lineage | Often data flow/transformation ancestry; usage overlaps provenance |
| Evidence | Material asserted to support or challenge a claim |
| Rationale | The explanation connecting facts, alternatives and criteria to a decision |
| Governance | Policies, responsibilities, rights and processes controlling stewardship and use |
| Audit trail | Chronological records of observed or recorded operations |
| Decision traceability | Our recommended umbrella for the linked records answering the questions above |

This is a proposed local vocabulary, not a claim that every industry source draws
identical boundaries. W3C PROV distinguishes use, generation, derivation and
attribution, and explicitly cautions that use of an input and production of an
output do not alone prove derivation. OMG SACM distinguishes evidence from the
reasoning asserting that it supports a claim. The [source note](provenance-terminology-sources-20261011.md)
provides the primary references and cautions. In particular, our informal phrase
“informed by” is not a declaration that it has the exact PROV activity-to-activity
`wasInformedBy` semantics.

## Product comparison

The [product audit](memory-provenance-product-audit-20261011.md) is the source-pinned
implementation ledger. The significant distinctions are:

- Shipped keyed memories do not expose the proposal's exact, independently
  identified Memory revisions and derivation record.
- Shipped `bd provenance` records Issue/artifact activity. Its event subject is an
  Issue identity, not a selected Bead or Link revision, and it is append-only.
- The journal supplies replayable mutation observations within documented coverage
  and retention. It does not infer source/evidence relationships.
- Graph/History work in a preview can supply useful identity and version
  foundations without implementing the whole Memory proposal or our new assertion
  design. Main, release and preview must not be described as the same product.
- Existing metadata, actor fields, access controls and export gates address parts
  of the problem; none alone is a general knowledge-governance system.

For the interrupted journal question, Vickie's
[published 1.3-vs-BDP comparison](https://github.com/donnabox/beads/blob/7cf7dcfa2aafaa4479d1559570d165f855dddb1e/docs/architecture/bdp-client-v2/beads-1.3-journal-vs-bdp.md)
is a separate existing artifact. This research does not choose 1.4 scope or claim
to repeat that complete protocol audit.

## Recommendation for our Provenance Bead direction

Keep the agreed direction: a well-known Type, an immutable exact subject reference
to a Bead or Link revision, and ordinary assertion versioning for corrections and
explicit retraction. Arbitrary web resources can be origins; arbitrary web
subjects are unnecessary. Inter-Scope subject admission is still a proposal, not
a decided rule.

Make the **meaning of the assertion** explicit. At minimum, do not conflate an
origin/derivation claim, an assertion of supporting evidence, a context-inclusion
record, and an approval. A relation field or a family of Types can express the
distinction; that representation is still a product decision. The actor who
asserts the relationship can differ from both the original decision-maker and
the source's author.

Keep immutable change attribution distinct from a later claim about that
attribution. Correcting our understanding of who authored D@4 can add/version an
assertion about D@4 without rewriting D@4's original committed record. Consumers
must be able to ask both “what did the system record then?” and “what is asserted
now?”, with an explicit policy for resolving conflicts between claims.

Do not silently replace R3 with the new assertion mechanism. In R3, changing
derivation changes Memory state and creates a new Memory revision; our post-facto
assertion mechanism deliberately leaves its subject unchanged. Decide whether
R3 remains the declaration recorded with the original version, becomes a defined
view of assertion records, or is revised. Two independently editable sources of
truth would create ambiguity.

Preserve completeness as a separate dimension. Finding one assertion does not
mean all sources are known. With multiple assertions, completeness belongs to a
defined declaration or evidence set, qualified by visibility and Scope; it is not
inferred from the number of rows returned. The proposal's missing/empty/populated
distinction should survive any representation change.

## Design gaps worth resolving with Chris

1. **What does “based on” promise?** Recorded context, claimed actual use,
   derivation, justification, and approval need separate queryable meanings.
2. **Which part of a decision is supported?** A whole Bead may suffice; split out
   independently disputable claims when needed, rather than automatically
   atomizing every paragraph.
3. **What is the historical question?** Current evidence about an old decision
   differs from evidence recorded before the decision. Assertion history plus
   suitable temporal discovery is needed for the latter; pins alone are not a
   historical collection snapshot.
4. **How do we correct the record?** An assertion corrected later should not be
   presented as evidence available to the original decision-maker.
5. **What does absence mean?** Unknown sources, a deliberate direct assertion,
   hidden assertions and omitted/unavailable sources need different answers.
6. **What governs decisions?** If approval, applicability, ownership or promotion
   is required, name that requirement and its enforcing owner explicitly.
7. **How do references align?** R3 permits non-Bead origins although the core
   Reference definition is Bead-specific. R23 allows endpoint re-pinning under
   stable Link identity, unlike current BDP main. These are specification seams,
   not terminology fixes.

## Acceptance walkthrough

Create D@4 from run R with B@2 and P@7 in its recorded context. Record one assertion
that B@2 supports D@4, and one that P@7 was the applicable policy. Later discover
C@1, add it as supporting evidence for the unchanged D@4, correct the B assertion,
then retract it through another assertion revision.

The system should separately answer: original recorded inputs; currently active
support; assertion corrections/retractions; who recorded each claim; and any
approval under a specific policy. It must not substitute B@3, imply C was known
at decision time, treat a policy citation as permission, or infer completeness or
truth from the existence of these records. Retention or authorization limits must
remain visible where the contract permits their disclosure.

This walkthrough is a recommended design test, not an implemented test or a new
release requirement.
