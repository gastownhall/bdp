# [Memory] Memory Bead and Link Types

Product proposal, updated October 18, 2026.

This proposal defines the **Memory link and bead types** and user-visible operations
for **Memory V1**, the first supported Memory release. It specifies product behavior
independently of its eventual BDP representation.

Memory Bead and Link Types use the same Type selection as Issue and Dependency
Types, including `--type`. A Memory Bead holds reusable knowledge; an Issue Bead
tracks work; an Activity Bead reports what happened. Each record has an explicit
Type, with no additional kind-based discriminator. A technician can save a useful
note, and an office team can record a decision and its reasons, without first
completing a classification interview.

The Types and operations below are proposed product contracts. Publishing this draft
or passing its property examples does not establish implementation support.

> **Working scope.** This project is the test bed for the Memory vocabulary below.
> Types are selected from records we use or are about to use, and the proposal is
> kept synchronized with that practice. The first supported release supplies the
> selected Types and discoverable inventory/details. User-defined/installable Types
> and public Type editing are outside that release. The supplied inventory is an implementation
> boundary, not the purpose of this proposal. Janet records the selected **Memory V1**
> name in the decision register below.
>
> **Preview 3.** Pinned References and re-pinning (M-D1), deletion with floating-Link
> cleanup and pinned survivors (M-D2), and guarded same-ID undelete via revert (M-D3) are
> required. Within-Memory retyping is also selected. Expanded provenance (M-D4) and
> Task structured informational-Link projection (M-D5) may follow Preview 3.
> Specialized payload/catalog work is M-D6. Existing truthful attribution remains
> required for the operations that ship. Janet records integration and qualification.
>
> **Decision and dependency record.** [Memory implementation status #7656](https://github.com/gastownhall/beads/issues/7656)
> owns the M-D dependency rows and MEM-DEC decision register. The broad supported
> feature set is intended to run by default, with only named individual exceptions.
> Preview allocation and the first supported release's complete scope are distinct.

## 1. Product model and boundaries

A Memory Bead has a stable identity, an explicit Type, a title and a Markdown body.
Its identity is independent of any human key or name. A saved revision preserves
its recorded Type, content, metadata, outgoing Link state and available provenance.
Changing current state creates a new revision; it does not rewrite an older one.

A **Scope** is the persistent data identity containing the Beads; a workspace gives
access to it. Reads expose canonical Bead identity and enough Scope context to
interpret it without silently substituting a local name. Initial graph operations act within
one Scope and do not require cross-Scope resolution.

An Issue Bead may point to a Memory Bead, and a Memory Bead may point to an Issue
Bead. Those relationships help someone find knowledge or understand its relevance.
They do not give Memory Beads Issue workflow states or change Issue readiness.

A Type identifies a record's meaning and property contract. Ordinary Type filters
can select a Memory Bead or Link just as they select an Issue Bead or Dependency Link.

> **Difference from Chris's R1/R3.** This proposal expresses Memory and its
> specializations through the shared Type mechanism and uses declared properties
> for known fields. Application-specific context stays in metadata. Donna and Chris
> will reconcile this refinement of the proposal's core-kind/metadata boundary.

The shared History, identity, Link and provenance capabilities supply the operations
Memory consumes. This proposal states their required outcomes rather than defining
a second History system, principal model, attestation scheme or general Type engine.
Activity means the one independent Activity-typed work report in
[Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510).

## 2. Memory Bead Types

The project's starting set is ordinary Memory plus Policy, Decision, Procedure,
Specification, Requirement, Scenario and Proposal. Memory remains both the common
base and the plain-capture option. Every Bead has two required content properties
and optional status:

| Property | Contract |
| --- | --- |
| title | Required nonblank UTF-8 text, supplied or derived before storage. |
| body | Required UTF-8 Markdown text, possibly empty. Main content whose meaning follows the Bead's Type. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

An explicit title permits an empty body on every Type. Body is preserved verbatim
and carries primary content. Additional properties add separate information rather
than requiring a second copy of the main text. The Memory family means ordinary
Memory and all seven named specializations; exact-Type selection remains distinct.

| Type | Meaning | Additional properties |
| --- | --- | --- |
| Memory Bead | Reusable knowledge without further classification. | None |
| Policy Bead | A governing rule for how the project operates. | authority |
| Decision Bead | A choice made, with its rationale and consequences. | alternatives |
| Procedure Bead | Instructions for carrying out an activity. | None |
| Specification Bead | A coherent statement of a system, interface or behavior contract. | None |
| Requirement Bead | A demanded outcome or constraint. | None |
| Scenario Bead | A concrete situation, actors, actions and relevant outcomes illustrating behavior. | None |
| Proposal Bead | A candidate change or course of action offered for consideration. | None |

Common status is omitted from the additional-properties column. An author selects
Type explicitly; content and property names do not infer or change it. Plain capture
requires no classification interview. A named Type can be selected at creation.

> **Project-driven design.** The named Types come from current or imminent project
> records, not a taxonomy required by Chris's scenarios. Janet maintains the working
> examples and mechanics; Melinda maintains definitions and this proposal. Donna
> settles product meanings. Precise boundaries are refined from these examples.

A Requirement records an obligation, while an Issue tracks work. A Specification
states a coherent contract, a Scenario describes a concrete situation, and a
Proposal offers a candidate course of action. Type and author-reported status are
separate: a draft status alone does not determine the record's Type. Whether a
particular record changes Type or produces separate records is an explicit identity
choice, not an automatic consequence of status.

### 2.1 Application context

Where, when, for whom or under what conditions content applies can be recorded in
application metadata. This release selects no universal applicability properties,
metadata schema or validity interval. Metadata may record equipment, jurisdiction
or other project context. Passing a date does not create a revision, expire a Bead
or prove its contents applicable. A references Link identifies a specific record
connection when an addressable target is useful.

> **Alignment with Chris's R3/S15.** Applicability and validity context stay in
> application metadata. The declared Type-specific properties remain an explicit
> refinement for Donna and Chris to reconcile.

### 2.2 Type-by-Type fields and project examples

The examples show Type and properties, omitting identity, revision, provenance and
Link envelopes for readability. They illustrate semantic content from the project's
current documents and table rows; those sources are not claims of existing native
typed Beads or persisted Links. Their precise working definitions remain subject
to the project design review.

#### 2.2.1 Memory Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. Reusable knowledge without further classification. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "memory",
  "properties": {
    "title": "Record exact inputs before comparison",
    "body": "Record the source revisions used by a comparison so its results can be interpreted later."
  }
}
```

#### 2.2.2 Policy Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A governing rule for how the project operates. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |
| authority | Optional URI or {uri, revision} identifying a claimed source; authored information, not permission or proof of approval. |

```json
{
  "type": "policy",
  "properties": {
    "title": "Keep Beads releases aligned with BDP",
    "body": "Each release must identify its exact contract checkpoint and record known discrepancies separately from implementation evidence.",
    "status": "draft",
    "authority": "https://github.com/gastownhall/beads/issues/7656#issuecomment-6253701616"
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/7656#issuecomment-6253701616).

#### 2.2.3 Decision Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A choice made, with its rationale and consequences. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |
| alternatives | Optional ordered array of nonblank text. Absent means unrecorded; an empty array means none listed. |

```json
{
  "type": "decision",
  "properties": {
    "title": "Revision shorthand is a CLI presentation feature",
    "body": "Use compact revision selectors for CLI input and display while retaining separate structured identity and revision fields in JSON and BDP.",
    "status": "accepted",
    "alternatives": [
      "Store the compact spelling as canonical identity"
    ]
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/7656).

The existing Issue-family decision Type still tracks work. This Memory Decision
Type records knowledge; their Type identities are distinct. Resolve short-name
collisions with unambiguous qualified Type selection, without another discriminator.

#### 2.2.4 Procedure Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. Instructions for carrying out an activity. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "procedure",
  "properties": {
    "title": "Establish BDP and Beads release synchronization",
    "body": "1. Record exact comparison inputs.\n2. Review contract and implementation differences.\n3. Agree dispositions before changing branches or pins.",
    "status": "draft"
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/7656#issuecomment-6253701908).

The current project example combines method and execution progress. Whether the
repeatable method and a particular execution need separate records remains a design
question; this shape does not select a second execution or evidence model.

#### 2.2.5 Specification Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A coherent statement of a system, interface or behavior contract. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "specification",
  "properties": {
    "title": "Graph CLI specification",
    "body": "Define commands, reference inputs, output and refusal behavior for the shared graph CLI.",
    "status": "draft"
  }
}
```

Project example: [source record](https://github.com/donnabox/beads/blob/5779b6b846d358c40bdc7bad4a2fcffc779aadb6/docs/reference/graph-cli-specification-draft.md).

#### 2.2.6 Requirement Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A demanded outcome or constraint. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "requirement",
  "properties": {
    "title": "R17: Connect work and knowledge",
    "body": "Support explicit informational relationships involving Memory Beads without giving those relationships Issue workflow effects."
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/5877).

#### 2.2.7 Scenario Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A concrete situation, actors, actions and relevant outcomes illustrating behavior. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "scenario",
  "properties": {
    "title": "S8: Connect an Issue and reusable knowledge",
    "body": "A project participant records knowledge and connects it to work. Another participant follows the recorded connection and explicitly reads the selected knowledge."
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/5877).

#### 2.2.8 Proposal Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A candidate change or course of action offered for consideration. |
| status | Optional nonblank open string, authored with no automatic workflow effect. |

```json
{
  "type": "proposal",
  "properties": {
    "title": "Revision-aware CLI syntax",
    "body": "Consider compact CLI reference input and display while preserving structured identity and revision fields in storage and wire formats.",
    "status": "proposed"
  }
}
```

Project example: [source record](https://github.com/gastownhall/beads/issues/7659).

### 2.3 Status conventions

Optional open-string status belongs to Memory and to the generic references Link.
Bead specializations inherit it. The following values illustrate conventions, not
reserved words or an enforced transition graph:

| Type | Useful example values |
| --- | --- |
| Policy, Decision | draft, proposed, ratified, withdrawn |
| Procedure | draft, reviewed, retired |
| Specification | draft, reviewed, accepted |
| Requirement | draft, accepted, withdrawn |
| Scenario | draft, reviewed |
| Proposal | proposed, accepted, rejected, withdrawn |
| Ordinary Memory | provisional, reviewed, withdrawn |
| references Link | proposed, recorded, confirmed, withdrawn |

Absence means unspecified. Values are preserved without case normalization; present
blank or non-text values refuse. Omitted fields on targeted update are preserved;
explicit removal follows ordinary property editing. A status change creates a
revision, including the source revision required by an owned Link change.

Status does not hide or delete a record, disable a relationship, change Issue
readiness, prove truth or verify approval. Explicit status predicates are available;
there is no implicit active-only filtering. A withdrawn Link remains recorded until
removed. Actual execution/test evidence and adoption/qualification state need their
own truthful records rather than being inferred from a status word.

Existing Issue has required workflow status with built-in and configured values;
Dependency has no declared status property. This proposal changes neither contract.
See [Issue status behavior](../issue/issue.md#32-existing-classification-and-status-behavior)
and [Dependency properties](../issue/issue.md#42-properties-and-metadata).

## 3. Capture, find and read Memory Beads

“Discovery” means finding Beads before reading their complete contents: list them,
search for matching text, or follow Links. Memory Beads use shared authoring, query,
Link and History operations. We define the useful operations here before choosing
Memory-specific verbs or tuning ordinary create/update/list/show/delete commands.
Appendix A gives concrete questions the query surface should help answer.

### 3.1 Capture and correct knowledge

Creating a Memory Bead supplies its Type, title, body and any additional properties
or metadata. Body remains the primary content. An omitted title is derived using
the existing Memory authoring title helper: take the first nonblank body line,
collapse display whitespace and cap the title at 80 Unicode code points including
an ellipsis when truncated. Preserve the complete body. An explicit title permits
omitted body, stored as empty. Whitespace-only input cannot derive a nonblank title.

For example, a project participant records “Record exact inputs before comparison”
as an ordinary Memory Bead. The authoring operation supplies identity and derives
a title if needed. A later guarded correction edits the same Bead and creates a
revision. Selecting Procedure is an explicit Type choice, not prose inference.

Markdown, frontmatter and ordinary document hyperlinks remain content. They do not
implicitly create properties or graph Links. Targeted updates preserve omitted fields.
The choice of positional title/body arguments, flags, file/stdin input and domain
wrappers belongs to the later authoring-ergonomics pass.

### 3.2 List, search and follow Links

| Intended action | Concrete example | Result |
| --- | --- | --- |
| Browse Memory Beads | List Specification Beads whose authored status is reviewed. | Compact summaries, using explicit Type/status predicates. |
| Find matching text | Search “revision-aware CLI” across the Memory family. | One summary per matching Bead, identifying the matched field and bounded excerpt. |
| Find connected Beads | Find Memory Beads referenced by implementation Issue I-42. | references Link summaries with direction, note/status, stored endpoint selection and observed target state. |
| Read a selected Bead | Read the exact Specification edition returned by the search. | The complete selected record, deliberately requested. |

The proposed baseline text predicate is **literal, case-insensitive substring
matching** across title, body and supported human keys. A multiword input is one
search string; a text predicate does not itself interpret Boolean syntax, regular
expressions or semantic similarity. The shared query design may compose predicates
with Boolean and graph operations. Listing omits a text predicate; an explicit text
search requires nonblank input. Default selection is current live Memory Beads,
including all specializations. History selection must be explicit.

Queries need exact-Type and family selection, exact open-string status predicates,
property presence/value predicates, explicit metadata predicates, and directional
Link predicates. Status values are compared as recorded, without aliasing proposed,
ratified or other strings to an inferred active category. Default text matching does
not search arbitrary metadata, extra properties, provenance or referenced bodies;
any added text-search fields must be named explicitly. Several matches on a Bead
still produce one result, with match information for the selected projection.

Compact results identify canonical identity, Scope, Type, title, selected exact
revision, supported keys and relevant match information. A key match identifies the
matching key. The initial proposed text-search order is title, then canonical
identity. Every query discloses a deterministic order and applies all predicates
before pagination. Count/byte limits and continuation or completeness are explicit;
a complete-results control either delivers all matching summaries within disclosed
capacity or refuses. Continuations bind to the query/ordering and accurately refuse
invalid/expired reuse or relevant state changes. Relevance ranking is consumer policy.

For Link results, identify Link ID, concrete Type, source and target References,
note/status and available endpoint summaries. Long notes and other potentially long
properties use labelled bounded excerpts in compact results; full Link details are
an explicit read. Preserve the difference between a stored current Reference and
the exact state observed while evaluating the query.
The active Link Type is references; Type filters retain its explicit identity.

A search implementation may examine body text to match it; that is distinct from
returning complete bodies to the caller. Search, list and Link traversal return
compact results. The storage-acquisition versus consumer-delivery boundary for
Chris's R8/R21 remains an explicit alignment question; compact output alone does not
prove that unrelated bodies were never acquired internally.

> **Design choice for Chris's R6.** Compact results followed by explicit recall
> follow his proposal. Literal text matching and the initial ordering remain
> concrete choices proposed for review. Query requirements below target the shared
> Bead/Link query surface; they do not require a separate Memory search engine.

### 3.3 Complete reads

An explicit complete read returns the selected Memory Bead: canonical identity and
Scope, current or selected exact revision, Type, title, body and all properties,
metadata, outgoing Links, available provenance and supported keys. For example,
a project participant selects Specification S-17 at revision R3 from a compact
result and reads that exact edition. Later edits do not change what R3 returns.

Human output renders additional properties alongside body without copying them into
stored Markdown. A body-only projection is labelled as such. An empty body is a
present value. Historical reads return retained Type, content and outgoing state,
without substituting current values. Stored content and diagnostics are untrusted
data; output escapes them appropriately. Context consumers own their budgets,
ordering and receipts and choose which full records to retrieve.

## 4. The references Link Type

The project's active Memory Link catalog contains one Type: **references**. It is
a directional informational connection involving a Memory Bead. A references Link
has its own identity, explicit Type, source and target References, properties and
metadata. The lowercase Type name is distinct from the Reference value used to
identify each endpoint.

### 4.1 Meaning and properties

| Property | Contract |
| --- | --- |
| note | Optional nonblank text explaining the connection. |
| status | Optional nonblank open string under §2.3. |

Properties and metadata remain open to additional annotations. A references Link
records a connection, not a workflow dependency, authorization, instruction,
verified approval, execution report or proof that a Requirement is fulfilled.
Its presence does not change Issue readiness or load complete target content.
The note can explain the author's reason for recording the connection without
turning that prose into an enforced relationship rule.

Changing an outgoing Link of a Memory Bead creates an atomic source revision.
Incoming Links do not version their target. Historical outgoing sets remain part
of their recorded source revisions. Parallel Links and cycles are permitted; a
self-Link is refused by identity even when endpoint revision selections differ.
The Type adds no participation minimum, ordered-pair uniqueness or acyclicity rule.

### 4.2 Endpoint pairs

Each line is one allowed source → target pair. Memory includes all seven named
specializations. Current graph operations select Beads within the same Scope.

| Type | Allowed source → target pairs |
| --- | --- |
| references | Memory → Issue<br>Issue → Memory<br>Memory → Memory |

For example, a Specification Bead can reference a Requirement Bead and an Issue
Bead can reference a Procedure Bead. Two Issue endpoints alone do not meet this
Memory Link contract. Direction is explicit; a reverse Link is a separate record.
The existing Dependency contract and its vocabulary retain their own meaning.

Cross-Scope/external graph endpoints are outside this selected slice. Ordinary
external document references may occur in body, metadata or an authored authority
value without fetching their targets or creating graph Links implicitly.

### 4.3 Current and exact references

Current selection follows the endpoint identity's current state; an omitted target
revision means current. The author may instead choose an exact retained revision
when citing an edition. Exact selection does not fall forward after edits.
Both target forms are admitted; pinning is an author choice, not a silent conversion.

Local current endpoints must exist and meet their roles. Exact endpoints resolve
to retained states meeting those roles at that revision. A later Type change does
not reinterpret a historical pin. Reads distinguish the stored selection from the
observed available, deleted, removed or unavailable state. Unknown availability
must not be presented as proven erasure or never-existence.

A source pin never permits rewriting an old revision. Source-owned changes create
new current state while preserving older snapshots; unsupported mutations refuse.
Link-ID edits, removal and same-target-identity re-pinning preserve identity where
supported. Re-targeting to another identity is a separate operation contract.

## 5. Updates, Type changes and lifecycle

A targeted update preserves omitted fields and validates the complete resulting
record. Explicit full replacement supplies every required property. An ordinary
semantic no-op creates no revision; stale guards are checked before no-op handling.
An accepted unguarded write, where offered, discloses its actual predecessor.

**Type changes are accepted product direction.** A guarded update can change Type
and necessary properties in one atomic operation. Untouched fields are preserved.
A change from Memory to Procedure with unchanged content is still a real Type change
and creates a revision; repeating the same Type and unchanged properties is a no-op.
Retyping changes the writer's explicit semantic assertion, not just its shape.

Preview 3 permits transitions within the Memory family, preserves existing Issue-family
behavior and defers Issue↔Memory conversion. It never converts a Bead into a Link.
Validate affected Link rules and ownership effects with the resulting record. Invalid
results refuse without partial state, allocations or history. No field conversion,
incident-Link deletion or repair is invented automatically. Historical affiliation
and outgoing sets retain their original meaning.

Retyping is an ordinary single-record operation, composable in batch. Batch does not
supply a missing update primitive or excuse incorrect guards. Native Memory need not
wait for a BDP deployment or a general batch rewrite. Detailed shared operation and
ownership-transition rules remain with their owners.

### 5.1 Deletion and revert

Deletion removes current state and current discovery, releases supported keys, and
preserves retained exact history. It records the selected terminal deletion evidence.
Floating incident informational Links are removed atomically; valid pinned citations
survive while their referenced states remain retained. The result reports removed
Links and affected source revisions under the shared authorization/completeness rules.
It neither leaks hidden identities nor calls a partial enumeration complete.

The accepted shared operation design is **`bd revert`**. It is not yet implemented
for this Memory workflow; Appendix A proposes its CLI as part of this release. It creates a new revision under
the same identity using a named retained revision's properties and metadata, current
operation provenance and a reference to that selected revision. A current guard and
current Type/Link admission checks apply. Reverting a deleted Memory makes it live
again; reverting a live Memory changes its selected content without recreating it.
Earlier History, including terminal deletion, stays intact.

Revert does not implicitly roll back Type or endpoints, recreate other deleted Links,
take another record's key, or copy the older writer/time. It must not silently make
invalid old properties fit the current contract. The shipping `bd restore` command
keeps its pre-compaction Issue-content recovery meaning; it is not this operation.

Erasure and retention removal, where supported, return truthful gone reasons for
removed exact states and never substitute current content. A citation cannot prevent
required erasure. Ordered project feeds and removal producers need an explicit V2
cutline; a per-Memory version list is not a project-wide feed.

### 5.2 Capacity, names and authorization

Operations disclose finite record, owned-Link and result limits and refuse before
mutation rather than truncate successful state. No new Memory-specific maximum is
selected here. Existing implementation capacities require exact-candidate qualification.
The references Type adds no participation minimum, pair uniqueness or acyclicity
requirement; no generalized constraint engine is a Memory release prerequisite.

Human keys are names resolving to stable identity, not identity themselves. Their
namespace, assignment/repoint/release operations, historical visibility and version
effects require a shared naming decision. Do not infer them from generated IDs or
silently take keys during revert. No first-release in-place migration is assumed.

Authorization is shared product behavior. A complete owned-state view must respect
its visibility rules without leaking hidden endpoints. An operation unable to honor
its required mutation/reporting contract must refuse before mutation. Deployment in
embedded or ordinary shared-server mode must preserve the selected portable meaning.

## 6. Provenance and reported work

Memory uses shared revision provenance, including truthful responsible-party context
and commit time for newly accepted native revisions. Owned-Link changes and indirect
cleanup revisions carry the initiating operation's accepted context. If required
attribution cannot be recorded truthfully, refuse before mutation. Actor/context-only
no-ops do not mint a revision; no-op and historical unknown attribution remain distinct.

Do not invent a writer, infer one from an assisting agent or OS username, or treat a
recorded identity as authenticated participation. Legacy/imported absence remains
unknown; conversion and revert attribute the new operation without fabricating old
history. No Memory-specific attestation or signing mechanism is introduced.

Recorded sources say what the writer claims informed a revision. Unrecorded sources,
a deliberate empty list and a populated list are distinct; completeness is the
writer's claim. Body-only native capture may leave sources unknown. Updates preserve
omitted source knowledge under the selected shared contract without claiming a reread.
Source corrections are explicit changes, not silent edits to old revisions. A real
knowledge correction uses the selected shared revision rules.

**Inception is one shared open-enum field**, `revisionProvenance.inception`, describing
how this identity's current period of presence in its Scope began. The accepted
[Inception/revert decision](https://github.com/gastownhall/beads/issues/7510#issuecomment-6242419971)
uses `create`, `import-insert`, `import-upsert` for an insert branch if that operation
is later supported, `revert`, or `unknown`. It is not a Memory property.

Ordinary edits and upsert updates of an already-live identity preserve Inception.
Live-to-live revert preserves it; deleted-to-live revert sets `revert`. Unknown stays
unknown, and original retained representations are not backfilled. These facts do
not infer an original creator or require signatures. The earlier origin/entry facets
and original-origin correction proposal are superseded. No upsert implementation or
preview data migration is introduced by the enum. Polly and Iris own the shared
producer/import implications; broad provenance implementation is still separate
from the required Preview 3 Reference/deletion/undelete outcomes.

Activity is the independently recorded work report defined in
[Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510). Its subject may be
work involving an Issue, Memory, Link or external artifact under that shared contract.
This proposal does not define a second Activity or settle its outstanding admission
questions. Creating an Activity does not itself revise the reported subject.

Sources, graph Links and Activities are distinct records. A references Link does
not prove reading, use or truth. Nothing is mirrored automatically between them.
Readers and external tools judge quality, freshness and applicability; the product preserves inspectable evidence.

## 7. Project test-bed examples

Current source documents and table rows seed the working definitions. Janet owns
their project representation; this proposal's typed JSON and Links remain illustrative
until those mechanics exist. A Markdown citation is not evidence of a persisted Link.

1. The project records Policy MEM-POL-002 and Decision MEM-DEC-007 separately: a
   rule for operating and a choice already made have different purposes and status.
2. The project records Procedure MEM-PROC-001. Its current mixture of instructions
   and execution progress supplies a concrete boundary question for the design jam.
3. The Graph CLI draft is a Specification example. Its draft status and authority
   are explicit; implementation staging in a PR does not become the Specification.
4. Requirement R17 and Scenario S8 from Chris's proposal supply distinct examples
   of a demanded behavior and a concrete situation illustrating it.
5. A Proposal offers a candidate change. The project can explicitly record references
   from a Decision to the Proposal and from a Specification or Scenario to a
   Requirement. Those generic connections do not establish fulfillment or test results.
6. A participant searches compact records, follows their recorded references and
   deliberately reads the selected exact editions. A later guarded correction
   versions the same record; recording a new identity remains a deliberate choice.

The real examples live in [the project ledger](https://github.com/gastownhall/beads/issues/7656),
[the revision-aware CLI proposal](https://github.com/gastownhall/beads/issues/7659),
[the Graph CLI draft](https://github.com/donnabox/beads/blob/5779b6b846d358c40bdc7bad4a2fcffc779aadb6/docs/reference/graph-cli-specification-draft.md)
and [Chris's Memory proposal](https://github.com/gastownhall/beads/issues/5877).

## 8. Acceptance and remaining decisions

Each selected workflow needs tests against one exact installed build in embedded
and ordinary shared-server modes. Property validation, a catalog row or an old
preview result is not a complete workflow pass. The implementation ledger
records source, decision, test and release evidence separately.

| Case | Required result |
| --- | --- |
| Ordinary unkeyed capture | Stable ID, stored title/body and truthful first-revision context. |
| Explicit title with empty body on any supplied Bead Type | Present readable record with no extra required primary field. |
| Status on a Memory Bead or references Link | Preserve open-string values; no implicit workflow, approval, visibility or truth effect. |
| Body contains readable instructions | Preserve content verbatim; no execution or Type inference. |
| Targeted edits with additional properties | Preserve untouched fields or refuse before mutation. |
| Missing title/body or malformed declared property | Refuse before allocation or partial changes. |
| Guarded Type change with unchanged body | New revision for semantic affiliation change; historical Type retained. |
| Repeated unchanged Type/properties | No-op after guard checks. |
| Stale/invalid update or injected failure | No partial record, Link, allocation or History effects. |
| references involving an Issue and Memory | Admit valid roles without Issue workflow or automatic body loading. |
| references joining two Issues | Refuse under this Memory Link contract. |
| Same endpoint identity with different pins | Refuse self-Link; distinct parallel Links and cycles remain allowed. |
| Current or exact references target | Preserve author selection; current follows state, exact retains the cited edition. |
| Exact target later edited or deleted | Keep the retained pin; no current fallback. |
| Outgoing Link edit/remove/re-pin | Stable identity as supported, atomic source revision, target unchanged. |
| Delete with floating and pinned incident Links | Floating cleanup, valid pinned survivors and retained terminal evidence. |
| Revert deleted Memory | Same identity, selected properties/metadata and current-operation provenance; no implicit Type/other-Link rollback. |
| Compact query with several matches | One Bead result with bounded match reasons and truthful completeness. |
| Unknown, empty and populated source records | Preserve distinctions without fabricated authorship or reading. |
| Applicability metadata and clock passage | No automatic lifecycle or revision changes. |
| Default/automatic export | Declared exposure contract; no Memory records in automatic export. |
| Complete selected read | Full content/properties and truthful retained state, escaped output. |

Open product decisions include Memory-specific workflow selection, exact query/CLI
grammar/output, names and keys, source-pin mutation details, full initial scenario
allocation and the selected storage-acquisition
boundary. The shared Inception/revert meanings are decided; producer/schema/runtime
integration remains owner work. Activity workflow, connected
interchange, legacy conversion and project-feed/removal inclusion need their own
explicit release decisions. Existing Dependency compatibility remains an integration
item. Accepted decisions are recorded in #7656 rather than silently inferred here.

## Appendix A. Memory operations and query requirements

### A.1 Principles before command spelling

This proposal defines Memory Bead and Link Types for use through shared Bead
operations, surfaced by commands such as `bd create`, `bd update` and `bd query`.
The Type, query and History capabilities described here are target behavior;
[implementation status](https://github.com/gastownhall/beads/issues/7656) is tracked
separately.

Additional Memory-specific commands are not required merely to express these
operations or the scenarios in Chris's Memory proposal. If useful scenarios emerge
from actual use, we can consider commands that make them easier to perform.

Memory-specific commands, if added, would live under a top-level `bd memory` group.
Wrappers around shared operations may be worthwhile when they simplify frequent
workflows or tailor show/list/query output to Memory use. Their value and behavior
should be established before choosing their command names or arguments.

The current model does **not yet require a new Memory-specific write verb**:

| Desired action | Existing shared operation concept |
| --- | --- |
| Record knowledge, including a Decision or Requirement Bead | Create a typed Bead. |
| Correct content, metadata or authored status | Guarded update of a Bead. |
| Change its semantic classification | Guarded Type/property update. |
| Connect knowledge records or link them to work | Create a references Link with explicit endpoint selections and optional note/status. |
| Remove a relationship or change its pin | Link-ID removal/update under the shared admission and source-version rules. |
| Delete, compare history or recover retained content | Shared deletion and History operations. |

The same principle applies to reading: a text predicate, Type filter, graph traversal
or complete record read is not a new Memory primitive simply because its input is a
Memory Bead. The distinctive work below is selecting useful combinations of the
Memory Types and relationship meanings through a capable shared query surface.

The earlier namespace/compatibility direction remains: bd memory can host justified
Memory workflows, and remember/recall/memories/forget project the canonical model.
This pass selects no new verb or domain-tuned CRUD spelling. Positional title/body,
body/title flags, file/stdin options and tuned create/update/list/delete/show commands
are deliberately deferred. It makes no claim that existing bd update accepts body
or body-file flags.

Shared bd revert meaning remains accepted design; it is not shipped for this Memory
workflow. Its concrete CLI must be designed with the shared History surface. Shipping
bd restore retains its pre-compaction Issue recovery meaning.

### A.2 Useful Memory queries

The shared query design should operate over graphs containing both Memory and
Issue Beads and their Links. The questions below serve two purposes:

1. Check that the query capabilities and Type definitions are expressive enough
   to answer common questions about Memory and its relationships to work.
2. Identify valuable recurring queries that could become named commands, sparing
   users from constructing elaborate expressions. Such commands could live under
   a future `bd memory` surface.

These scenarios guide the query design; they are not claims about today's `bd query`
grammar or implementation. Their initial release allocation is recorded with Janet.

Additional queries are welcome. Please suggest examples in the proposal discussion
so we can add them to the query corpus.

| Question | Example selection | Required information in the result |
| --- | --- | --- |
| What knowledge matches this topic? | Search “revision-aware CLI”, optionally selecting Specification or Proposal records and authored status. | Deduplicated summaries, exact selected revisions, matched fields/excerpts, order and bounds. |
| What records match this project context? | Select Policy or Procedure Beads with explicit metadata predicates. | Matching summaries and the recorded paths/values explaining each match, without inferred applicability. |
| What knowledge is connected to this work? | Inspect incoming and outgoing references for Issue I-42. | Bead summaries and Link reasons, direction, note/status, stored selection and observed endpoint state. |
| What cites this exact edition? | Reverse lookup for Specification S-17 at revision R3. | Referencing Beads/Links and exact target selection; an identity-wide query groups results by edition. |
| Which citations differ from current content? | Compare pinned references with the same identities' current revisions. | Cited/current revisions, whether they differ, and accurate unavailable/gone states. Different does not imply wrong or obsolete. |
| Which project records refer to this Requirement? | Inspect references around Requirement R17, optionally filtering connected record Types. | Explicit connections and their direction/status/note; no inferred fulfillment or test execution. |

Queries may explicitly select note, status, property or metadata predicates. A withdrawn
Link is not implicitly hidden. Generic connections do not decide authority, approval,
truth or Requirement fulfillment. Historical queries use their selected retained
records and relationship state; unsupported historical selection refuses. Bounded
subsets disclose limits and continuation/completeness rather than claiming all results.

For multi-hop references traversal, the caller selects direction and finite depth
or other bounds. Results retain paths, cycle information and revisions actually
observed. A graph-wide snapshot requires a shared capability that supplies one.
Visibility and endpoint availability follow shared rules; partial observations do
not establish exhaustive impact.

### A.3 Potential workflows requiring more design

An explicit use record has its own meaning beyond a generic reference. If actual-use
capture becomes a selected workflow, define the shared Activity/provenance contract,
who makes the assertion, which exact inputs it names and how the result is retrieved. Do not invent an executed
use record from a Link or create a second Memory-specific Activity model.

Consolidation, truth assessment, automatic applicability and context-pack construction
remain consumer work. They are not new core verbs justified by this query design.
A later domain workflow can compose the shared operations once its distinct contract
and actual user benefit are demonstrated.

### A.4 Exposure and compatibility

- Generated guidance teaches compact search, explicit complete reads and deliberate
  capture, with concrete command examples once the grammar is selected. It does not
  inject all Memory bodies or recursively follow Links.
- Ordinary search, list, traversal and records merely referring to Memory return
  summaries and bounded excerpts. Complete bodies and potentially long properties
  require explicit retrieval or a clearly labelled caller-selected full projection.
- Existing remember/recall/memories/forget compatibility surfaces share canonical
  records and preserve deliberate write-only capture, empty-body presence, exact
  reads and recoverable deletion. Their exact mapping awaits the ergonomics pass;
  a single content token never becomes a state-dependent read.
- The earlier body-carrying memories --json compatibility proposal needs an explicit
  mapping. It cannot silently become a summary or authorize full content on other
  JSON surfaces. Stored configuration cannot broaden a summary surface to full content.
- Canonical export excludes Memory unless explicitly requested. Automatic export
  emits no Memory records. Whole-store provider recovery is a separate capability.

## Appendix B. Mapping to Chris's proposal

[Memory #5877, Revision 4](https://github.com/gastownhall/beads/issues/5877) supplies the
behavioral baseline. The table names obligations and deliberate refinements, not
passes. Type-specific body interpretation, optional declared properties and shared
Inception placement make deliberate refinements explicit where alignment is needed.

| Requirement | Product outcome / disposition |
| --- | --- |
| R1 | First-class Memory family with explicit Type; no Issue workflow state. |
| R2 | Stable identity independent of names; shared key placement/versioning remains open. |
| R3 | Body-first knowledge, optional declared properties including descriptive status, and application metadata. Applicability/validity remain metadata; Type/property and shared-Inception refinements require alignment. |
| R4 | Deliberate write-only capture, title derivation, canonical success identity. |
| R5 | Deletion with retained history, same-ID undelete through shared revert, and truthful erasure where supported. |
| R6 | Topic search with explicit Type/status/property/Link predicates, compact deduplicated results and truthful order/bounds. Matching and query grammar remain proposed. |
| R7 | Complete current/exact recall, content, Links and available provenance together. |
| R8 | Selective recall/guidance; storage-acquisition boundary explicitly to settle. |
| R9 | Structured Link identity/Type/reference/target information; Task projection is M-D5. |
| R10 | Exact attributable consumer inputs; context-pack policy remains outside product. |
| R11 | Durable changes version; no-op does not; exact retained state is immutable. |
| R12 | Truthful shared revision attribution and single-field Inception per the accepted shared presence/revert decision; explicit refinement of former editable Memory state. |
| R13 | Shared versions/compare/revert; project-feed inclusion needs a cutline. |
| R14 | Guards before no-op, typed conflicts, atomic failure and actual predecessor disclosure. |
| R15 | Claim only the selected Memory workflows with their required History outcomes. |
| R16 | Accurate unavailable/gone reasons; no current fallback; removal producer scope open. |
| R17 | The generic informational references Link connects project knowledge and work, following Donna and Chris's naming agreement. Shared Type registration and broader graph capabilities retain their own scope. |
| R18 | Current and exact References with author-selected citation pins on references Links. |
| R19 | Validate local roles/current/retained targets; external graph resolution deferred. |
| R20 | Remove floating incident Links, preserve valid pins and historical sets; no restore re-add. |
| R21 | Informational Links grant no authority or automatic context expansion. |
| R22 | Outgoing Memory-Link state versions source; bounded truthful incoming lookup. |
| R23 | Stable Link-ID edit/remove/re-pin, preserving Issue workflow. |
| R24 | Conversion, if selected, preserves admitted identity/empty values/known facts or refuses; records the accepted insertion cause without fabricating earlier authorship. |
| R25 | Canonical commands plus explicit aliases; one record per Memory and empty-body parity. |
| R26 | Same record semantics across declared supported CLI/API/provider surfaces. |
| R27 | Connected identity-preserving interchange, if selected, is atomic or refuses. |
| R27a | Explicit body exposure, default/automatic export exclusions, separate whole-store backup. |
| R28 | Complete structured current/historical/deleted records and truthful bounds. |
| R29 | Shared authorization; exact embedded/shared-server qualification. |
| R30 | Preserve claims/evidence; external tools judge quality. |
| R31 | Define Memory-specific workflow semantics before adding verbs. Existing aliases retain the canonical model; domain-tuned CRUD and exact command grammar are deferred. |

| Scenario | Realization / dependency |
| --- | --- |
| S1 | Unkeyed ordinary capture, derived title and first attributable revision. |
| S2 | Search title/body/keys, explicit complete recall and guarded correction; body carries primary content. |
| S3 | Delete with Link effects, retained exact reads and same-ID undelete via revert. |
| S4 | Compact discovery and deliberate recall; no automatic body injection. |
| S5 | An Issue references an exact Policy edition; Task projection is staged separately. |
| S6 | Complete selected records as inputs to an independent context consumer. |
| S7 | Concurrent guards, current context and atomic refusal. |
| S8 | Informational Issue↔Memory / Memory↔Memory Links with source-owned effects. |
| S9 | Moving current target versus immutable exact citation. |
| S10 | Floating cleanup and pinned survival after deletion. |
| S11 | Legacy conversion only with an explicit supported path; otherwise deferred. |
| S12 | Canonical bd memory and familiar aliases over the same operations. |
| S13 | Connected interchange only after accepted format/atomicity qualification. |
| S14 | Structured viewer records, history and available provenance. |
| S15 | Record validity context; clock passage does not mutate; revert preserves identity. |
| S16 | Ordered project feed/removal is a separate explicit release decision. |

## Appendix C. Validation artifacts and future BDP mapping

The [common property schema](./memory.properties.schema.json), seven specialized
property fragments, [Link properties](./memory-link.properties.schema.json) and
[property cases](../../../fixtures/specs/memory/schema-cases.json) are review aids for
this product contract. Each specialization also validates the common Memory shape. Writers preserve existing
additional properties on targeted edits or refuse before mutation; an explicit full
replacement supplies the complete resulting properties.
The schema's technical `$id` is its identifier for tooling; it is not a Memory field,
CLI argument or another identity the user must manage.

Examples in [records.json](../../../fixtures/specs/memory/records.json) use illustrative
IDs and a test carrier. They are not a prescribed public JSON envelope. The checker
validates properties and finite supplied membership; it does not prove endpoint,
mutation, provenance, History, CLI or installed behavior.

```sh
uv run --no-project --with 'jsonschema[format]' python scripts/check_memory_examples.py
```

The [BDP exploration note](./bdp-exploration.md) and [definition graph](./definitions.json)
are separate, nonnormative experiments. They neither define the product's Type
representation nor require native Memory to deploy BDP. Once the BDP Type-definition
format is accepted, derive its Memory definitions from this accepted product contract.
A broader external-endpoint experiment is not support in the selected release.
