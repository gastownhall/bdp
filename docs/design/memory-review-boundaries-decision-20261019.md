---
type: Decision
id: ""
status: accepted
---

# MEM-DEC-009. Constraint applicability and independent assessments

## Choice

Subject To is not transitive. For a subject X, discover explicit or implicitly selected Subject To roots, then follow their Requires family, including Defines. A Constraint's own Subject To declarations govern that Constraint as a subject; they do not automatically govern X. This separates requirements on a Specification document from requirements on the result it describes.

Conformance is abstract. No Link may declare Conformance as its actual Type. Concrete refinements remain usable and inherit its contract; abstractness is not automatically inherited. Family queries and ownership selectors still recognize concrete refinements, and the Conformance definition Bead remains a legal metatype instance. The shared Types contract owns the representation; no field spelling, kind field, or outcome enum is selected.

Recording an assessment must not revise the assessed subject. Under the current subject → Constraint representation, Addresses, Satisfies, and Violates are unowned independent claims. An Assessment Bead owning a set of claims is a promising follow-up direction, not a selected ninth Bead Type or a third-party ownership extension. Its endpoints, subject-revision binding, grouping, and cleanup need a separate decision. No deletion cascade or removal of retained history is inferred.

Only a Bead whose Type is Issue or refines Issue is eligible for dispatch; ordinary readiness rules still apply. Blocking semantics require a Link whose Type is Dependency or refines Dependency. Memory/Constraint membership, Requires, Subject To, and Conformance claims introduce neither dispatch eligibility nor Issue blocking semantics.

Closing an Issue is a workflow transition, not a satisfaction claim or proof. Consumers using coverage to gate closure, release, or compliance own their acceptance and reconciliation policy: accepted evidence and authority, assessed revisions/context, and treatment of unknown, conflicting, inaccessible, or bounded results. Neither a test-run label nor the presence or count of claims is verification.

Type-constraint enforcement must validate affected create/update/delete outcomes, including surviving graph state, and reject invalid results at the shared commit boundary. Concurrent writes and admission of merged state must preserve the claimed invariants. Exact storage and merge mechanisms remain implementation work, not Memory-specific protocol additions.

## Rationale

A policy about how a document is reviewed must not become an obligation of every result described by that document. Independent assessments avoid changing the object merely by examining it. Issue workflow, applicability, recorded claims, and verified judgments answer different questions and must not be conflated by consumers.

## Supersession and remaining work

This supersedes MEM-DEC-008's source-owned Conformance-family rule and its open question about direct Conformance instances. It preserves that Decision's peer hierarchy, evidence inheritance, and Refines naming. It also replaces the earlier transitive Subject To rule. Requires remains transitive; Requires cycles and the existing body requiredness rules are unchanged.

Assessment-Bead modeling is under discussion. Executable applicability, detailed revision/context binding, structured attestation and reconciliation policy representation, query grammar, and runtime qualification remain separate work. This records accepted design, not an implementation completion or release allocation.

## Decision provenance

Donna directly accepted the Slack-review follow-through in Melinda's chat. Trish separately relayed Donna's accepted abstract-Conformance default after Melinda's consultation. The reviewed feedback is in [the announcement thread](https://gascityinc.slack.com/archives/C0BHVRDE6LW/p1792447437974909). The [Memory catalog](../../specs/types/memory/memory.md) carries the current wording. MEM-DEC-009 is an authoring label, not a store-assigned Bead identity.
