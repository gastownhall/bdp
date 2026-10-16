# Provenance, governance, and decision evidence: terminology sources

Research note, 2026-10-11. This is a terminology comparison, not a product specification or an implementation claim. It does not establish what Chris's proposal or current Beads implements; those require the separate proposal/source review. All mappings below are recommendations rather than adopted BDP vocabulary.

## The central distinction

“This decision was based on this data” can mean several different things. Use **decision traceability** as the product-level umbrella, then name the relationship precisely:

| Intended meaning | Useful term | Example requirement |
|---|---|---|
| Data was retrieved or presented during a decision run | Retrieval/context trace; input usage | Identify the exact memories supplied to run R, including their role and selection method. |
| The decision artifact was produced using those inputs | Decision provenance; derivation | Connect decision revision D to the process/run and the exact input revisions that influenced its production. |
| The data provides reasons to believe the decision or conclusion is justified | Evidence; evidential support; rationale | Record which observation supports which claim and the stated reasoning connecting them. |
| A decision model requires this input or invokes these rules | Information dependency; decision logic | Describe required inputs and the version of the rule/model to be evaluated. |
| A person accepted or authorized the decision | Approval; decision authority | Identify the approver, applicable policy, scope, and approval record. |
| The decision or its supporting records were changed | Revision history; audit trail | Preserve who recorded which operation and when. |
| A source changed and dependent decisions may need reconsideration | Impact analysis; revalidation | Find potentially affected conclusions and route them for review. |

The last column is our suggested requirement language. These are not interchangeable predicates. In particular, supplied context need not support a conclusion; evidence can be discovered after a decision; an approval does not prove the supporting data is correct; and a change does not necessarily invalidate every dependent decision.

## Standards and established product usage

### Provenance and attribution

W3C PROV describes production and influence through entities, activities, and responsible agents. `used` relates an activity to an entity; generation relates a produced entity to its activity; derivation relates an output entity to an influencing input. Attribution associates an entity with an agent. Crucially, PROV explicitly warns that an activity using X and producing Y is insufficient by itself to establish Y's derivation from X. It also supports provenance about provenance through bundles. [PROV-DM, introduction and §§2.1–2.2](https://www.w3.org/TR/prov-dm/)

This is broader than creator metadata or an original source URL. PROV-O permits direct entity-to-entity derivation when the intervening activity is unknown, and qualified relations when the activity and other details are available. Its vocabulary distinguishes derivation, quotation, and revision. We need not implement RDF or import the entire ontology to benefit from those distinctions. [PROV-O, starting-point and qualified terms](https://www.w3.org/TR/prov-o/)

### Lineage

In data-platform practice, lineage commonly concerns data flow and transformation across datasets and processing jobs. OpenLineage distinguishes a job definition from a particular run and represents input/output datasets; it also distinguishes runtime events from declared, design-time metadata. This is a useful precedent for separating intended dependencies from observed executions. [OpenLineage object model](https://openlineage.io/docs/spec/object-model/)

There is no consistently observed hard boundary between the words *lineage* and *provenance*. IBM's lineage overview uses provenance narrowly for origin, whereas its provenance overview includes transformations and modification history. Therefore we should define our terms explicitly, not claim an industry-wide rule that one is always narrower than the other. [IBM lineage overview](https://www.ibm.com/think/topics/data-lineage), [IBM provenance overview](https://www.ibm.com/think/topics/data-provenance)

### Evidence and rationale

OMG SACM separates claims, evidence artifacts, contextual information, and the reasoning asserted to connect them. Its `AssertedEvidence` relation represents a user's assertion that evidence helps establish a claim, not a mechanical guarantee of truth. `ArgumentReasoning` records the explanation, and counter-evidence is representable. This is a closer vocabulary for “why should we accept this conclusion?” than a bare origin reference. SACM is an assurance-case standard, not a proposed mandatory Beads format. [SACM 2.3, §§11.9–11.17, printed pp.38–41](https://www.omg.org/spec/SACM/2.3/PDF)

### Decision dependencies

OMG DMN distinguishes information requirements (input data or results needed by a decision), knowledge requirements (invocation of decision logic), and authority requirements involving knowledge sources. This is a design-time decision model, not automatically a record of what one execution actually read. The cited 1.4 edition is a terminology precedent, not a claim about the latest DMN release. [DMN 1.4, §6.2.2](https://www.omg.org/spec/DMN/1.4/PDF)

### Governance

Governance concerns the policies, responsibilities, standards, and procedures controlling data ownership, collection, storage, processing, and use. Provenance can supply evidence needed to govern; recording provenance alone does not apply those controls. [IBM data governance](https://www.ibm.com/solutions/data-governance)

Microsoft Purview illustrates the distinction operationally: governance includes stewardship, ownership, access policies, delegated roles, asset quality, and approval/access workflows. A proposed memory feature that limits who may promote, publish, edit, retain, or expose knowledge is a governance requirement even if implemented through ordinary records and workflows. [Purview overview](https://learn.microsoft.com/en-us/azure/purview/overview), [Purview roles and permissions](https://learn.microsoft.com/en-us/purview/data-governance-roles-permissions)

### Audit trail

NIST describes an audit trail as chronological system-activity records sufficient to reconstruct and examine an operation's sequence. That supports accountability about recorded actions. Our inference: a journal of writes is not automatically a source/evidence graph, and neither automatically provides tamper resistance, completeness, historical reads, or proof that a decision followed its declared policy. [NIST audit-trail glossary](https://csrc.nist.gov/glossary/term/audit_trail)

## Implications for the proposed provenance design

The agreed direction—versioned assertion Beads referring to exact Bead or Link revisions—can accommodate retrospective claims and later correction/retraction. It is still a design direction, not verified current behavior.

Do not let a single unqualified `based-on` relationship silently carry all meanings above. A compact initial vocabulary could distinguish `derived-from`, `supported-by`, `considered`, and approval records; names and representation need product decisions. Separate the decision artifact from the run/activity that produced it when runtime input accounting matters.

For an AI-assisted decision, a practical record can contain exact input revisions, run/model/tool identifiers, the output revision, citations, and an explicit rationale. It should report the strength of the evidence accurately: “supplied to the run,” “cited by the output,” and “verified to support this claim” are different observations. A later explanation is itself a claim; it is not guaranteed access to the causal process that produced the original output.

Recommended acceptance probe: create D from run R with inputs A@2 and B@5; assert A@2 supports D; record that B@5 was merely considered; later add C@1 as newly discovered support; retract the A assertion. Queries must distinguish original inputs, current supporting evidence, the assertion history, and governance approvals. None should silently substitute A@3 or treat retraction as rewriting D.
