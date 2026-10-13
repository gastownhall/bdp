# Memory Beads and Links: a practical design starting point

October 13, 2026. Research-backed design recommendation for discussion, not an
approved Type catalog, canonical BDP amendment, implementation plan or release gate.

## Start with the work people do

A maintenance technician wants to find the note that applies to this machine,
see what was tried, and avoid repeating a failed repair. A purchasing team wants
to find the decision behind a supplier choice, see its evidence, and learn why
that choice changed. Both need the same basics: identifiable knowledge, useful
relationships, exact references when history matters, and understandable updates.

Recommend **one base Memory Type**, alongside Task and the proposed Activity Type,
with a small optional vocabulary of Link Types. Start procedure, observation,
decision, policy and lesson as authoring templates over Memory. Promote one to a
separate Type only when it needs a distinct validated data contract or behavior.
No user should have to learn a knowledge ontology before saving a useful note.

This is intentional Type design: Memory promises knowledge without task workflow;
Task promises work to do; Activity records work reportedly performed. A classification
like “decision” alone does not yet justify a fourth lifecycle or required schema.
The templates and link vocabulary are useful shared conventions, not mandatory BDP
core Types. Chris explicitly asks for this distinction in R3/R17/R30 and his
[October 3 follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303).

## Evidence and boundaries

Read [Memory proposal #5877](https://github.com/gastownhall/beads/issues/5877), body
Revision 4 dated September 22, retrieved October 13; latest issue activity October
9. Its R1–R31, R27a and S1–S16 are requirements of that proposal, not assertions
that the product implements them. Also read the author's
[Revision 4 clarifications](https://github.com/gastownhall/beads/issues/5877#issuecomment-5787432078),
October 3 relationship/applicability guidance, and
[October 6 consolidation discussion](https://github.com/gastownhall/beads/issues/5877#issuecomment-6009424090).
The latter recommends consumer-owned consolidation, not automatic core truth judgment.

Fresh source heads, verified October 13:

- [BDP main at 2e7d454](https://github.com/gastownhall/bdp/blob/2e7d454a616467122884306fcd8d1d853b0bf5c1/docs/specs/bdp.md):
  typed Resources, common metadata, owned outgoing Links and History are described.
  The current revisionProvenance envelope has actor/time/agent/message only;
  sources, Activity records and terminal deletion versions are explicitly excluded.
  Current Link endpoints remain immutable; in-Scope endpoints require live Beads,
  and incident-Link deletion refusal remains. Do not carry forward older claims
  that main lacks common metadata or the consolidated provenance name.
- [Beads main at 55aac47](https://github.com/gastownhall/beads/blob/55aac471761c69704551bdecda67e32b9b9fef3d/memoryops/memories.go):
  the public Memory interface still operates on keys/content and returns a
  key/value map. Its [CLI](https://github.com/gastownhall/beads/blob/55aac471761c69704551bdecda67e32b9b9fef3d/cmd/bd/memory.go)
  still has the derived-key read/write branch. This is a bounded source check,
  not an audit of every preview branch or a runtime test.
- [Provenance V2 at 119b6f1](https://github.com/gastownhall/bdp/blob/119b6f1fd29f3c7337ac02d53eeae3eae702c0e1/docs/design/provenance-on-resource-versions-proposal.md):
  selected design direction in this discussion; source lists, authenticated actor
  derivation, Activity records and terminal deletion are not all adopted BDP law.
- [Prior-art note](memory-type-prior-art-20261013.md): primary-source examples and
  the specific patterns worth borrowing. These provide design evidence, not new
  requirements imposed on Chris's proposal.

Causality IDs, run/session fields, cascading/transitive causality and Type
installation/version plumbing remain outside this exercise.

## Bead contracts

| Bead Type | Plain meaning | Content and rules | Example |
| --- | --- | --- | --- |
| Task (existing work model) | Work someone needs to do | Its existing workflow contract; Memory Links cannot change readiness | Inspect pump 7; choose next quarter's supplier |
| Memory (proposed target) | Knowledge worth keeping | Title and verbatim Markdown body; versioned; no ready/blocked/assigned/closed lifecycle | Recurring seal-wear observation; purchasing decision |
| Activity (Provenance V2 proposal) | Work reportedly performed | Subject, kind, producer, optional participant/time/artifacts; ordinary versioned Bead | Inspection performed; supplier review meeting recorded |

A job, the reusable guidance for doing it, and a report that it happened are
three different things. Do not turn a procedure into a Task so it can be marked
complete, or create an Activity merely because someone edited a Memory; ordinary
revision provenance already records the edit. A completed inspection's reusable
finding can become a Memory, with its sources explicitly recorded.

Memory's proposed placement:

| Information | Location | Meaning |
| --- | --- | --- |
| Title and Markdown body | Type-specific properties | Portable readable content; at least one nonblank on create, with a derived title when only body supplied |
| Canonical identity and exact revision | Common Bead identity/history | Keys and captions never substitute for identity |
| Familiar keys | Shared alias/name facility, placement still a decision | R2's namespace and restore rules must be reconciled explicitly |
| Origin/import/conversion record (Inception) | Editable Memory properties, precise schema still open | Required by Chris's R3/R12; distinct from the writer of the current revision |
| Writer, commit time, agent, message and recorded inputs | revisionProvenance under V2 | Map R3 derivation/completeness and R12 attribution once; no second editable derived-from list |
| Application classification and applicability | Common metadata | Suggested convention below; not a universal core truth or workflow state |
| Outgoing relationships | Owned Links | All outgoing Memory Link Types version with the source, including extension Types; incoming views are computed |

Use BDP wildcard ownership for the open Memory relationship vocabulary. The
installed contract needs an explicit finite maximum; select it from practical
size/authoring cases rather than inventing an arbitrary universal number here.
The declaration does not itself provide Memory restore, retained pin admission,
or deletion cascade behavior.

## Templates before more Bead Types

Templates help people author useful bodies; they do not extract facts from prose
or turn headings into independently authoritative properties.

| Template | Questions the body answers |
| --- | --- |
| Observation | What did we see? Where and under what conditions? What remains uncertain? |
| Procedure | What is this for? When does it apply? What are the steps and checks? |
| Decision | What did we choose? Why? Which alternatives mattered? |
| Policy | What rule is being recorded? To whom and when does it apply? Where is its authority documented? |
| Lesson | What happened? What should someone remember next time? |

A document may serve more than one use. A decision explaining a choice can later
be consulted as guidance without changing its nominal Type. Do not make “fact”
a privileged Type that asserts truth. A mistaken observation remains an observation.

A future Procedure Type could earn its place with independently addressable
steps and step-result validation; a Decision Type could require structured
options and a selected option. Those would be optional domain contracts, possibly
conforming to Memory once that relationship is specified. We do not require them
to satisfy Chris's baseline, or silently move his application fields into core.

## A small applicability convention

A useful memory must say when it applies. Begin with one documented, optional
application metadata convention: classification, an applicability explanation,
and optional effective-from/effective-until times. A team may add structured
asset/site/product selectors when a real consumer needs them. Illustrative only:

```json
{
  "knowledge": {
    "form": "procedure",
    "applicability": {
      "description": "Pump 7, housing revision B; excludes the replacement housing",
      "validFrom": "2026-10-01T00:00:00Z"
    }
  }
}
```

This lives in common metadata, not body frontmatter or mandatory Memory properties.
The `knowledge` name and field spellings are candidates, not reserved names.
Before adoption, fix namespace ownership, time-bound semantics and absent/unknown
meaning. Missing conditions do not establish universal applicability. A time
window never automatically deletes, closes or validates a Memory.

Current BDP propertiesSchema validates properties, not common metadata. A
convention can guide consumers today; a validated shared metadata contract would
need an explicit additional mechanism or product validation. Do not advertise
schema enforcement that the Type descriptor cannot express. For now, keep prose
conditions readable and preserve unknown metadata without claiming interpretation.

## Candidate Link Types

These are optional shared vocabulary, not additional mandatory core Types.
Names below are readable handles; published definitions need stable global IDs.
None grants permission, loads a body, changes task readiness, or proves truth.
For Memory-constrained endpoints, accept the agreed Memory contract rather than
requiring every future domain Memory to have identical nominal affiliation;
exact conformance/version matching remains Type design work.

| Candidate | Direction and endpoint meaning | Useful question | Reference policy |
| --- | --- | --- | --- |
| related | Any Bead to another Bead/resource; at least one Memory for this use | What else might help? | Floating or pinned, with no stronger implied meaning |
| guidance | Task → Memory | What knowledge should someone consult for this work? | Floating for intended current guidance; pin when selecting a particular edition; does not prove use |
| applies-to | Memory → asset/product/site Bead or external resource | What is this note about or applicable to? | Identity reference usually appropriate; exact pin only when a particular recorded state matters; body/metadata still explains conditions |
| supports | Memory → Memory | What recorded material offers support for this conclusion? | Prefer exact target revision for a substantive claim; unpinned means a declared relationship to the evolving record, not proof for every future revision |
| challenges | Memory → Memory | What should make us reconsider this conclusion? | Same exact-target guidance; a challenge does not mark the target false or invalidate it automatically |
| supersedes | New Memory → older Memory | What should I consult instead, in the stated context? | Scope of replacement must be explained; no automatic deletion, retargeting or transitive selection |

For applies-to, an existing external asset ID is sufficient; this exercise does
not require a new universal Asset Type. For supports/challenges, put the reasoning
in the source Memory's body. Relationship-specific application qualifications may
use Link metadata. Do not create a second canonical explanation in both body and
Link fields. Adding an incoming supporting/challenging Memory never edits the
target, so later evidence need not rewrite the decision it discusses.

At least one endpoint must be an in-Scope Bead under BDP. Unknown remote kinds
remain unverified; nominal endpoint constraints do not magically verify external
resources. These example relations concern Beads, not Links-as-graph-endpoints.
Activity's subject property can still identify a Link under Provenance V2.

Pin **the knowledge relied on**, not every relationship indiscriminately. A
source Memory's retained revision includes its then-owned Link records. A source
pin is not a shortcut to freezing the whole surrounding graph; historical
questions require reading that exact source revision and its retained owned set.
Updating evidence does not automatically update decisions or their original sources.

## Sources versus Links: one question for each

- revisionProvenance.sources: “What information did the writer say this saved
  revision was based on?” Stored with that revision; exact pins when available.
- guidance/related: “What should I look at?” A navigation or intended-use relation
  is not a claim that anyone read it.
- supports/challenges: “What recorded material now offers a reason for or against
  this conclusion?” A declared relationship, including later contributions.
- Activity: “What reportedly happened?” It can record a later use or inspection
  without pretending that it was part of the original decision's recorded inputs.

A reference may legitimately appear in both a source list and a Link, but the
claims differ. Never automatically mirror one into the other. A reverse source
index can answer “which saved revisions cited this?” without another authored Link.
No new causality propagation is implied.

## Two worked examples

### Technician: a recurring pump fault

1. A Task asks for inspection of pump 7. A guidance Link points to the current
   procedure Memory. An applies-to Link associates that procedure with pump 7.
   The technician sees a short result and deliberately opens the procedure.
2. The technician records the observed fault in an Observation-template Memory,
   citing the exact procedure revision and an inspection report where those were
   inputs. An Activity reports the inspection; its subject is the Task, not a
   pretend completion state on the procedure.
3. A different technician finds that the procedure does not apply to a newer
   housing. A new observation challenges the particular procedure revision and
   explains the condition. The procedure's author makes a corrected revision
   with explicit sources. The earlier revision and its inputs remain available
   while retained.
4. The old job still identifies the procedure actually recorded as used. A future
   job following floating guidance sees the new procedure. Neither reference
   grants operational approval; this is record design, not maintenance advice.

### Office team: choosing a supplier

1. A Task asks the team to choose a supplier. A Decision-template Memory records
   the choice, alternatives and reasons. Its saved sources pin the assessment
   and policy revisions actually cited by the writer.
2. An assessment Memory supports the decision revision. A later finding can
   challenge that revision without changing the original record or claiming the
   finding was known earlier.
3. A routine correction to wording produces another version of the same decision.
   A deliberate new choice may deserve a new decision identity with a supersedes
   Link to the old one, so both decisions remain understandable. This is an
   authoring judgment, not an automatic rule based on how much text changed.
4. Supersession does not make the old decision disappear or silently move old
   citations. A consumer may present the newer decision prominently after checking
   its applicable context. Conflicting replacements require a human/product rule;
   no global “winner” is inferred from the graph.

The display vocabulary can be “Work”, “Knowledge”, “Activity”, “Guidance”,
“Supporting information”, “Contrary information” and “Replaced by”. BDP retains
exact identities and directions. Both audiences get the same semantics; neither
must see protocol vocabulary to do an ordinary task.

## Requirement coverage and honest readiness

A Type schema alone cannot satisfy Memory Beads. It must compose with the shared
operations and the product behavior below. “Defined in BDP” is not “implemented
in Beads”; only the bounded current-source checks above were performed.

| Chris's requirements | Proposed realization | Readiness / gap |
| --- | --- | --- |
| R1–R4: knowledge identity/content, explicit authoring | Memory Type, title/body, aliases, shared metadata; proposed source envelope and Inception | Design candidate; canonical Memory command model not supplied by current keyed interface |
| R5, R13–R16: delete/restore/history/exactness | Shared History and lifecycle operations | Current BDP describes exact reads; restore, Memory-compatible deletion/erasure and retention propagation need end-to-end qualification |
| R6–R10: discovery, recall, structured Links, selective context | Summary/search and complete-read surfaces over one graph | Cannot be created by a Memory schema; continuation, excerpts, body exposure and task views need product contracts |
| R11–R12: every durable change versions with attribution | Memory ownership plus History and revisionProvenance | Current BDP has ownership/history foundations; full proposed source/authentication and Inception mapping still pending |
| R17–R23: open informational Links and source-owned history | Wildcard ownership, registered relation definitions, endpoint validation | Re-pinning under stable Link ID and surviving pinned Links conflict with current BDP rules; require explicit amendments |
| R24–R26, R31: conversion and one coherent command model | Existing commands become adapters to canonical Memory | Compatibility/migration work, not a Type declaration; no implementation claimed |
| R27/R27a: connected interchange and deliberate body exposure | Shared interchange and enumerated surface policies | Needs separate contract and qualification; a graph export is not a historical backup |
| R28–R30: public records, shared governance, outside quality judgment | Shared read/history/access; optional application metadata and tools | Preserve boundaries; no claim of automatic truth, approval or applicability |

Key seams to resolve explicitly:

- **Outgoing ownership versus late evidence:** incoming support leaves the target
  unchanged; editing an outgoing Memory Link versions its source. Do not promise
  both operations leave every resource unchanged.
- **Deletion:** Chris removes local floating incident Links and retains pinned
  ones, while current BDP refuses incident-Link deletion. Activity retention in
  Provenance V2 is a separate subject-reference rule; it does not settle graph Links.
- **Re-pinning:** Chris keeps Link identity; current BDP uses delete/create. This
  exercise records the mismatch rather than disguising either behavior in a Type.
- **Origins and aliases:** provenance sources are not Inception; revision writer
  is not original author. Alias placement and restore semantics remain open.
- **Classification versus constraints:** optional metadata cannot be relied on as
  a server-validated Type contract without specifying enforcement.
- **Preservation versus exposure:** R27a's summary-only boundaries and explicit
  body-carrying exceptions need deliberate CLI/API handling, not generic dumping.

## Acceptance cases for the design session

1. Save a short useful note without choosing a category or key; it is usable.
2. Save an explicitly titled empty-body Memory; recall finds it, rather than
   confusing empty content with no record.
3. Attach guidance to a Task; readiness does not change and no body auto-loads.
4. Explain applicability to one machine edition or business region; absence of
   that condition is not treated as proof of applicability everywhere.
5. Cite Memory M at r2; after M becomes r3, the citation still yields r2 or an
   honest authorized gone result, never r3.
6. Add later supporting or challenging knowledge; distinguish it from the sources
   recorded with the original decision, and do not silently revise that decision.
7. Edit a Memory's outgoing Link; the new source revision owns the new Link set
   and a retained old revision keeps its old set.
8. Replace a decision with a new one; old citations remain exact, replacement is
   not deletion, and two proposed replacements do not produce a silent winner.
9. Delete a subject with floating Links, pinned Links and Activity reports;
   demonstrate each selected lifecycle separately. Until the BDP mismatch is
   resolved, this is a required design test, not an implemented promise.
10. Display a support Link from another Scope whose target cannot be checked;
    show the declared relation and unavailable observation without inventing truth.
11. Consolidate duplicate memories deliberately, preserving citations/history;
    do not infer equivalence from similar titles, keys or embedding scores.
12. A plain reader encountering an unfamiliar relation retains its ID and shows
    the records; it does not invent workflow or recursively load their bodies.

## Suggested next discussion

Start with the Memory contract and one paired example, then test the relationship
vocabulary against it. First decision: **do we agree that procedure/decision/
observation begin as Memory templates, and only become separate Bead Types when
we can name the extra contract they require?** Then select relation names and
pinning promises. Type packaging/version selection can follow once these meanings
are useful and stable enough to encode.
