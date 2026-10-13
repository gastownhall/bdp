# Practical prior art for Memory bead and link types

October 13, 2026. Research input for design discussion, not adopted BDP semantics
or an implementation plan. Sources are primary documentation read for this note.

## Starting point

Chris's [Memory Beads proposal, revision 4](https://github.com/gastownhall/beads/issues/5877)
asks for durable Markdown knowledge with identity, retained versions, explicit
non-workflow relationships, attribution, and selective retrieval. It explicitly
keeps application categories, evidence, confidence, and validity in structured
metadata (R3); it does not mandate a universal taxonomy of knowledge. The
proposal's task-to-policy example requires a relationship that helps someone
find relevant information without turning that relationship into a work blocker
(S5, S8, R17). These are requirements; the patterns below are inspiration for
satisfying them.

“Metadata” here follows Chris's proposal. It must not quietly become
Type-validated `properties`: the current BDP boundary requires that mapping to
be decided explicitly if a profile needs schema enforcement.

The current [Provenance V2 proposal](provenance-on-resource-versions-proposal.md)
already supplies two mechanisms: revision provenance accompanies a saved
revision; an Activity bead independently records work reported to have happened.
This note assumes that division. It proposes no new run, session, causality ID,
or transitive-causality fields.

## 1. Architecture decision records: preserve the reason, not just the answer

Michael Nygard's original ADR format records one significant decision in a short
document with context, decision, status, and consequences. A reversed decision
remains available and points to its replacement. Consequences include drawbacks,
not just benefits. The stated purpose is to help future readers understand a
choice before accepting or reversing it.
[Primary source: Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

**Useful pattern for our design:** a decision can start as a Memory with readable
sections: “What we chose,” “Why,” and “What this means.” A decision template can
add structured application metadata when filtering requires it. Do not require
every memory to fill an ADR form.

**Trap:** revising the spelling of a decision and making a different decision are
different operations. BDP revisions solve the first. A separately identifiable
replacement decision may need an explicit `supersedes` relationship for the
second. That candidate relation needs a selected direction and defined scope;
it must not automatically delete the earlier decision or propagate approval.
An ADR's accepted/proposed status belongs to a decision profile, not Task status
or generic Memory lifecycle.

## 2. Maximo: reusable instructions, the particular job, and the work record

IBM Maximo distinguishes reusable job plans from work orders. Applying a job plan
makes a work plan for that work order; the work plan can then change without
changing the reusable job plan. Job plans describe work and associated resources
and can apply to particular sites or organizations.
[Primary source: Job Plans](https://www.ibm.com/docs/en/masv-and-l/maximo-manage/cd?topic=module-job-plans).

Maximo also documents an ordinary Related relationship that carries information
without status inheritance, workflow effects, or hierarchical meaning. It
separately defines other relationships with operational effects.
[Primary source: Record relationships and work orders](https://www.ibm.com/docs/en/masv-and-l/maximo-manage/cd?topic=overview-record-relationships-work-orders).

**Useful pattern for our design:** distinguish “how we normally do this” from
“the job we need to do” and “what we did.” These map naturally to Memory, Task,
and the proposed Activity bead. A work order may cite an exact procedure revision
and also maintain a discovery relationship to the procedure's current identity.
This is our BDP mapping, not a claim that Maximo implements BDP revision pins.

**Trap:** copying a procedure into a task body without recording which edition
was used loses the connection. Merely linking the current procedure also loses
the historical answer. Pin the recorded input when an exact edition matters;
keep an ordinary relationship for finding current guidance. Editing guidance
must not silently rewrite completed work records.

An asset type can be useful in a maintenance package, but Memory does not require
core BDP to define pumps, buildings, customers, or contracts. Such entities can
remain application beads or external references.

## 3. Wikidata: distinguish a statement, its conditions, its sources, and preference

Wikidata statements pair a property with a value and can carry qualifiers,
references, and rank. This separates the statement itself from additional
information about it.
[Primary source: Statements](https://www.wikidata.org/wiki/Help:Statements).

Qualifiers can express when a value applies, how it was measured, and what it
covers. Multiple values can coexist when time, method, or scope explains their
differences. Qualifiers should not ambiguously qualify other qualifiers.
[Primary source: Qualifiers](https://www.wikidata.org/wiki/Help:Qualifiers).

Ranks help consumers select among values. Wikidata explicitly distinguishes rank
from references: a source explains where a value came from but can itself be
incorrect. Normal rank does not assert accuracy or currency.
[Primary source: Ranking](https://www.wikidata.org/wiki/Help:Ranking).

**Useful pattern for our design:** a procedure's applicability, the sources used
to write it, and a team's decision to use it are different facts. Keep
applicability in application metadata under Chris's baseline; a future dedicated
Type would need an explicit decision before moving that contract into validated
properties. Keep recorded revision inputs in revision provenance; keep adoption/approval judgments explicit where
an application needs them. A reference to a policy does not establish compliance
with it.

**Trap:** borrowing all of Wikidata would turn ordinary notes into a statement
model users must learn. We only need its discipline about distinct meanings.
Do not add a universal confidence number, truth flag, or rank system. BDP cannot
infer that one memory is false because another has a newer timestamp or a
preferred label. Link properties may qualify a relationship; they should not
become an unbounded nested assertion language.

## 4. W3C PROV: input, output, and recorded activity are different

The PROV primer distinguishes entities from activities and distinguishes an
activity's use of inputs from its production of outputs. Its example separates a
dataset, a data-processing activity, and the resulting chart.
[Primary source: PROV Model Primer, sections 3.1–3.3](https://www.w3.org/TR/prov-primer/).

**Useful pattern for our design:** identify what a saved record was based on and
what a reported piece of work produced without pretending those are the same
relationship. The proposed `sources` entries and their relation labels can carry
the input meaning; the existing Activity proposal can describe work and its
artifacts. A formal PROV export might be a later mapping.

**Trap:** a cited input does not prove that someone read it, that it supported the
conclusion, or that the conclusion was authorized. Nor does a chain of references
establish transitive causality. Do not introduce PROV's full vocabulary,
inference rules, or execution graph as a prerequisite to remembering a useful
fact. Causality remains explicitly deferred.

## A candidate everyday model to test

This is a design recommendation, not a selection of new mandatory types.

| User question | Candidate record or relationship | Meaning to preserve |
| --- | --- | --- |
| What do we need to do? | Task | The job and its workflow |
| What should the next person know? | Memory | Readable, reusable knowledge with independent identity |
| What happened? | Activity | A report about work, with its own creation/correction history |
| Where should I look? | Informational Link, starting with `related` | A navigable connection; no implied evidence, approval, or blocking |
| What information was this version based on? | Revision provenance `sources` | Recorded inputs, exact versions when supplied, explicit completeness |
| Where/when does this guidance apply? | Profile metadata and, where useful, a typed relationship | Applicability, separate from the time the record was saved |

“Decision,” “procedure,” “policy,” “observation,” and “lesson” are useful authoring
templates or optional profiles to test. They need not all become nominal bead
types. Introduce a dedicated type only when its fields and behavior need a
portable contract that a category label cannot supply. In particular, “evidence”
is often the role a record plays for another record, rather than an intrinsic
kind of that record.

For link vocabulary, start with the required `related`. Test `about` or
`applies-to` where subject/applicability queries need precision, and `supersedes`
where replacement across identities matters. Do not ship a dozen near-synonyms
for “based on.” The meaning and authoritative location of a relation should be
chosen once: storing both a source entry and a separately editable Link as the
same fact creates reconciliation work. A UI may display source entries beside
Links, but must keep their distinct contracts visible.

## Acceptance examples for both kinds of work

These examples are proposed tests, not new requirements attributed to Chris.

| Case | Shop-floor example | Office example | Model must let the reader establish |
| --- | --- | --- | --- |
| Find guidance | Technician opens a seal-replacement job and finds the applicable procedure | Analyst opens a purchasing task and finds the spending policy | Relevant knowledge can be discovered without loading every body or changing readiness |
| Preserve the edition used | Job records procedure revision 3; revision 4 arrives tomorrow | Decision cites policy revision 7; revision 8 arrives tomorrow | Exactly which retained version was cited, with no silent retargeting |
| Keep a local adjustment local | A particular repair uses an approved job-specific variation | A particular contract has a negotiated exception | The job-specific record does not silently rewrite the reusable guidance |
| Preserve a decision's reason | Team chooses a replacement part because of lead time and fit | Team chooses a supplier because of capacity and delivery terms | A readable reason, the recorded source material, and acknowledged tradeoffs |
| Correct a reported result | Later inspection corrects the repair report | Reconciliation corrects the reported invoice result | A new Activity revision preserves what was previously reported |
| Handle disagreement | Two technicians report different measurements under different conditions | Two forecasts use different assumptions | Both records and their conditions survive; the newest one does not automatically become truth |
| Separate applicability from edit time | Instruction applies only to one machine model | Policy applies only to a particular region | Saving a record today does not make it universally applicable today |

## Decisions these sources help frame, but cannot make for us

1. Which optional profiles need interoperability on day one, versus convenient
   templates over Memory and metadata?
2. Do readers need explicit cross-identity supersession, or is ordinary revision
   history sufficient for the initial scenarios? If the former, define its
   direction and authority without automatic deletion or workflow effects.
3. Which relationships need stored Links for navigation, and which are already
   expressed by revision sources or Activity properties?
4. How should current guidance be distinguished in the UI from exact historical
   guidance cited by a completed job? Do not make users learn “floating reference”
   to answer “what did we use?”

The small starting model is a useful basis for exercising Chris's scenarios;
it does not by itself supply the required history, lifecycle or command behavior.
The hard work is selecting a few clear meanings and preserving them through
editing, history, and display—not finding a more elaborate taxonomy.
