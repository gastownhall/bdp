# **Memory V1**: link and bead types

Product proposal, October 17, 2026.

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

> **Release scope.** The first supported release supplies the Memory Types and
> discoverable inventory/details. User-defined/installable Types and public Type
> editing are outside that release. The supplied inventory is an implementation
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

Every Memory Bead has two required content properties and an optional status:

| Property | Contract |
| --- | --- |
| title | Required nonblank UTF-8 text, supplied or derived before storage. |
| body | Required UTF-8 Markdown text, possibly empty. This is the main text of the Memory Bead; its Type determines its meaning in the table below. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

An explicit title permits an empty body on every Type. Body text is preserved
verbatim. A Procedure Bead's instructions remain readable content, not executable
steps. Each Type uses body for its primary content, with additional properties only
for separate information.

The Memory family means ordinary Memory Beads plus every specialized Memory Bead
Type below. Listing the family includes them all; selecting exactly one Type returns
only that Type. The command surface must distinguish these choices.

| Type | Meaning | Additional properties |
| --- | --- | --- |
| Memory Bead | Reusable knowledge without further classification | None |
| Observation Bead | What the author observed, with circumstances and qualifications | observedAt |
| Decision Bead | What was decided, why, and with what consequences | alternatives |
| Requirement Bead | A demanded outcome or constraint | None |
| Procedure Bead | How to carry out a task | None |
| Policy Bead | A governing rule and its explanation | authority |
| Lesson Bead | A reusable takeaway and the experience supporting it | None |

The additional-properties column omits common status, which every Type inherits.

Capture defaults to an ordinary Memory Bead. An author can create a specialized
Bead directly. Selecting a Type is an explicit author assertion; matching prose or
property names does not infer or change it.

> **Minimum versus proposed Types.** Chris's capture, search, recall and linking
> scenarios need an ordinary Memory Bead and a general informational Link, together
> with their required shared identity, History and graph behavior. His baseline
> Link is related; this design uses Association, whose compatibility remains to
> reconcile. The six specialized Bead Types and five specialized Link Types add
> explicit meanings and useful selection. They are our proposed product vocabulary,
> not extra Types required by Chris's scenarios.

Decision Beads draw on [architecture decision records](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Procedure Beads follow the reusable-job-plan/work-order distinction in the
[prior-art study](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/memory-type-prior-art-20261013.md).
A Requirement Bead states an obligation; an Issue Bead tracks work to fulfill it.
Closing the Issue does not prove the Requirement satisfied. The exact supplied
vocabulary remains a product proposal for review.

### 2.1 Applicability context and AppliesTo Links

A Memory Bead may record where, when, for whom or under what conditions its content
applies in application metadata. This release selects no standard applicability
property, metadata schema or validity interval. For example, an application may
record equipment or jurisdiction there. Clock passage does not expire a Memory
Bead, create a revision or prove its contents applicable.

An **AppliesTo Link** instead identifies a particular Bead to which the source
Memory Bead applies. Its target Reference answers “applies to what?” For example,
a Procedure Bead may link to the Issue Bead for a particular repair, while its
metadata records the equipment and operating conditions. Authors need not create
both; use the Link when an addressable target is useful.

> **Alignment with Chris's R3/S15.** Applicability and validity context stay in
> application metadata. No universal applicability or validity fields are selected.
> The Type-specific properties below remain an explicit refinement for Donna and
> Chris to reconcile.

### 2.2 Type-by-Type fields and examples

Examples show Type, properties and occasional application metadata. Canonical
identity, revision, provenance and Link envelopes are omitted for readability;
these are illustrative values, not a prescribed wire format. Metadata examples
are application conventions, not additional standardized fields.

#### 2.2.1 Memory Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. Reusable knowledge without further classification. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

```json
{
  "type": "memory",
  "properties": {
    "title": "Housing B uses a different seal",
    "body": "Check the housing before ordering the seal."
  }
}
```

#### 2.2.2 Observation Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. What the author observed. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |
| observedAt | Optional RFC3339 instant reported by the author. Omission means unrecorded; commit time is not substituted. |

```json
{
  "type": "observation",
  "properties": {
    "title": "Seal inspection",
    "body": "Housing B leaked after the old seal was fitted.",
    "observedAt": "2026-10-01T10:00:00Z"
  }
}
```

#### 2.2.3 Decision Bead

The existing Issue-family decision Type continues to track work with Issue workflow.
This Memory-family Decision Type records the choice and its reasoning. They have
distinct Type identities. A short --type name must be unambiguous; use a qualified
Type selector when names collide rather than adding another discriminator.

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. What was decided, why, and with what consequences. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |
| alternatives | Optional ordered array of nonblank text values. Absent means unrecorded; an empty array means none listed. |

```json
{
  "type": "decision",
  "properties": {
    "title": "Supplier choice",
    "body": "Use Acme for the next quarter. Acme met the delivery window; Beta did not.",
    "alternatives": [
      "Beta"
    ],
    "status": "ratified"
  }
}
```

#### 2.2.4 Requirement Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. The demanded outcome or constraint. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

```json
{
  "type": "requirement",
  "properties": {
    "title": "EU data residency",
    "body": "Customer data must remain within the EU.",
    "status": "accepted"
  }
}
```

#### 2.2.5 Procedure Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. Readable instructions for carrying out a task. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

```json
{
  "type": "procedure",
  "properties": {
    "title": "Replace housing B seal",
    "body": "1. Isolate the pump.\n2. Replace the seal.\n3. Run the leak test.",
    "status": "draft"
  }
}
```

#### 2.2.6 Policy Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. The governing rule and its explanation. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |
| authority | Optional URI or {uri, revision} identifying a claimed source. It is authored information, not a graph Link or an access grant. |

```json
{
  "type": "policy",
  "properties": {
    "title": "Supplier assessment",
    "body": "Record delivery capability before selecting a supplier.",
    "authority": "https://example.org/supplier-policy",
    "status": "proposed"
  }
}
```

#### 2.2.7 Lesson Bead

| Property | Contract |
| --- | --- |
| title | Required nonblank text. |
| body | Required Markdown text, possibly empty. A reusable takeaway with the experience supporting it. |
| status | Optional nonblank open string, reported by the author. No default or automatic workflow effect. |

```json
{
  "type": "lesson",
  "properties": {
    "title": "Check the housing variant first",
    "body": "Identify the housing before ordering a seal; the older variant used a different part."
  }
}
```

### 2.3 Status conventions

Optional status belongs to the common Memory Bead and Association Link contracts,
so all supplied specializations inherit it. Donna selected this placement. These are open
strings, not an enumeration. The following values are examples, not reserved words:

| Bead or Link Type | Useful status examples |
| --- | --- |
| Decision Bead | draft, proposed, ratified, withdrawn |
| Requirement Bead | draft, accepted, withdrawn |
| Procedure or Policy Bead | draft, approved, retired |
| Ordinary Memory or Lesson Bead | provisional, reviewed, withdrawn |
| Observation Bead | recorded, corrected, retracted |
| Association, Guidance or AppliesTo Link | proposed, confirmed, withdrawn |
| Supports, Challenges or Supersedes Link | proposed, accepted, disputed, withdrawn |

Status records what the author says about the Bead or relationship. Absence means
unspecified. Values are preserved without case normalization; present blank or
non-text values refuse. An omitted field on update preserves its value; explicit
removal follows ordinary property editing. A status change creates an ordinary
revision, including the source revision required for an owned Link change.

No status value hides a Bead/Link, deletes it, disables a relationship, changes Issue
readiness, proves truth or verifies approval. Authors may explicitly filter status;
there is no implicit active-only selection. A withdrawn Link remains a recorded
relationship until explicitly removed. A Supersedes Link identifies a predecessor
independently of any authored superseded status on a Bead; neither is inferred from
the other.

**Comparison with existing Types.** Issue has a required workflow status, with
built-in and configured custom values and existing scheduling rules. Dependency
has no declared status property. This proposal adds descriptive status to the
Memory/Association families and does not change either existing contract. See
[Issue status behavior](../issue/issue.md#32-existing-classification-and-status-behavior)
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

For example, a technician records “Housing B uses a different seal” as an ordinary
Memory Bead. The authoring operation supplies its stable identity and derives that
display title if the technician did not supply one. A later guarded correction edits
the same Bead and creates a revision. Choosing a Procedure Type is an explicit
Type selection, not prose inference.

Markdown, frontmatter and ordinary document hyperlinks remain content. They do not
implicitly create properties or graph Links. Targeted updates preserve omitted fields.
The choice of positional title/body arguments, flags, file/stdin input and domain
wrappers belongs to the later authoring-ergonomics pass.

### 3.2 List, search and follow Links

| Intended action | Concrete example | Result |
| --- | --- | --- |
| Browse Memory Beads | List Procedure Beads whose authored status is approved. | Compact summaries, using explicit Type/status predicates. |
| Find matching text | Search “housing B” across the Memory family. | One summary per matching Bead, identifying the matched field and bounded excerpt. |
| Find connected Beads | Find knowledge explicitly linked to repair Issue I-42. | Guidance, AppliesTo or Association Link summaries with their direction, note/status and target/reference selection. |
| Read a selected Bead | Read the exact Procedure edition returned by the search. | The complete selected record, deliberately requested. |

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
Following an Association family includes its conforming specializations when
supported; exact Association selection remains distinct.

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
a technician selects Procedure P-17 at revision R3 from a compact result and reads
that exact edition. A later edit to P-17 does not change what R3 returns.

Human output renders additional properties alongside body without copying them into
stored Markdown. A body-only projection is labelled as such. An empty body is a
present value. Historical reads return retained Type, content and outgoing state,
without substituting current values. Stored content and diagnostics are untrusted
data; output escapes them appropriately. Context consumers own their budgets,
ordering and receipts and choose which full records to retrieve.

## 4. Memory Link Types

**Association is the common Link Type**, usable directly for a general informational
connection involving Memory. Guidance, AppliesTo, Supports, Challenges and Supersedes
are specialized Associations, just as Observation and the other Memory specializations
are Memories. There are six authorable Link Types, including Association itself.

Selecting the Association family includes its specializations. Once conformance-aware
queries are supported, this selection includes any conforming Type without enumerating
a closed union. Selecting exactly Association remains a separate operation. This is
the intended selection behavior, not a requirement to ship a general conformance
query engine in the first Memory release.

A Link is directional and has its own identity, an explicit Type, source and target,
properties and metadata. Its Type determines the meaning of the relationship.
Issue→Memory and Memory→Issue Links are supported where the table permits them.
The presence of an Issue endpoint does not make the Link a workflow dependency.

### 4.1 Common informational contract

- A Memory Link does not block, schedule, assign or complete work. It grants no
  permission or authority and triggers no execution or automatic body loading.
- Each concrete Link preserves its own endpoint and pin rules. A shared contract
  does not let a caller combine the source from one permitted pair with the target
  from another.
- Association defines optional nonblank `note` and `status` properties, inherited
  by all five specializations. Note explains the relationship; status records an
  author-reported state under §2.3. The Memory Bead's body carries its knowledge.
  Open properties and metadata preserve additional annotations.
- Changing an outgoing Link of a Memory Bead creates an atomic source revision.
  It does not version the target merely because it has an incoming Link. Historical
  outgoing sets stay attached to their original source revisions.
- Parallel claims and cycles are permitted. A Link from an identity to itself is
  refused, even if its two endpoints use different revision selections.

The specialized Types retain their own meanings and narrower endpoint/pin rules
while satisfying the Association contract. The common property need not be required
to justify the hierarchy: shared behavior is also part of the contract. This does
not change the existing Dependency contract.

### 4.2 Allowed endpoint pairs

Each line in the middle column is one complete allowed **source → target** pair.
“Memory” includes all six specializations. For this release, “Issue” and “Memory”
refer to Beads in the same Scope. A reversed arrow is a different relationship.

| Link Type | Allowed source → target pairs | Meaning |
| --- | --- | --- |
| Association | Memory → Issue<br>Issue → Memory<br>Memory → Memory | A navigable connection involving knowledge. |
| Guidance | Issue → Memory | Knowledge someone should consult for this work; not proof that they read or used it. |
| AppliesTo | Memory → Issue<br>Memory → Memory | The source applies to the Bead identified by the target Reference. |
| Supports | Memory → Memory | The source offers support for the selected target content. |
| Challenges | Memory → Memory | The source offers a reason to reconsider the selected target content. |
| Supersedes | Memory → Memory | The source offers a replacement for the target Memory or a selected edition of it. |

For example, Issue→Procedure Guidance is allowed. Procedure→Issue Guidance is not;
Procedure→Issue AppliesTo is allowed. Association cannot join two Issues without a
Memory endpoint. These are endpoint rules, not rules about Issue workflow state.

For AppliesTo, the target Reference identifies what the source applies to; no extra
property repeats that target. The inherited note can explain the relationship.
No separate structured applicability property is selected for the Link.

The relationships are based on the Memory proposal and the field/office scenarios.
Full reconciliation with existing Dependency `related`, `relates-to` and `supersedes`
remains an integration item. Their current meanings and selectors stay unchanged;
Association is the selected starting name for the new Memory navigation relationship.
The earlier private preview-related records are not silently renamed or reinterpreted.

Cross-Scope and external graph endpoints are outside the selected release slice.
Ordinary external references may still occur in body text, authority or recorded
sources without fetching their targets. Future graph support must state its admission
and observation behavior rather than claiming that an opaque URI was resolved.

### 4.3 Current versus pinned targets

A **current** reference follows the target's current state. An **exact** or **pinned**
reference identifies one retained revision and continues to identify it after edits.
The caller supplies an exact revision when pinning; an omitted revision means current.

| Link Type | Target selection | Who chooses? |
| --- | --- | --- |
| Association, Guidance, AppliesTo | Current by default; exact allowed | The author chooses whether navigation should follow current knowledge or cite a particular edition. |
| Supersedes | Current by default; exact allowed | The author chooses replacement of the target Memory as a continuing identity or replacement of one particular edition. |
| Supports, Challenges | Exact target required | The author selects the revision being supported or challenged. A bare target refuses; the system does not silently pin current content. |

Local current endpoints must exist and satisfy the permitted roles. Exact endpoints
must resolve to retained states satisfying those roles at that revision. A later
Type change does not reinterpret an old pin. Reads distinguish the stored selection
from what is presently observable: available, deleted, removed or unavailable.
Unknown availability must not be presented as proven erasure or never-existence.

A source pin never permits rewriting a historical revision. Supported source-owned
changes create new current state and preserve old snapshots. Operations that cannot
honor that contract refuse explicitly. Link-ID edits, removal and same-target-identity
re-pinning preserve identity where supported; re-targeting to a different identity
is a separate operation contract, not implied by re-pinning.

### 4.4 Revision versus replacement

Correcting or extending the same Memory creates a new revision under its existing
identity. Offering a different Memory as its replacement creates a distinct identity
and an explicit Supersedes Link from the new Memory to the predecessor. Both paths
are supported; neither requires a special replacement Bead Type.

A current target means “this Memory replaces that Memory” as a continuing identity;
an exact target means “this Memory replaces that particular edition.” The stored
Reference preserves the author's selection. A current target may expose later
content; an exact target never follows it. The normal deletion rules apply: floating
Links are removed on deletion, while valid pinned citations survive.

Supersedes records a replacement claim. It does not delete the predecessor, redirect
its identity, rewrite its incoming Links or automatically declare either Memory true.
The predecessor and its retained revisions remain independently addressable. Source
creation and Link authoring use the shared operations and source-version rules.

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
The supplied relationships add no participation minimum, pair uniqueness or acyclicity
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

Sources, graph Links and Activities are distinct claims. Guidance does not prove use;
Supports does not prove truth; Supersedes does not erase or authorize replacement.
Nothing is mirrored automatically between them. Readers and external tools judge
quality, freshness and applicability; the product preserves inspectable evidence.

## 7. Worked field and office examples

### 7.1 Field service: recurring pump fault

1. A technician creates an ordinary Memory Bead: “Housing B uses a different seal.”
   The authoring operation creates its identity and first attributable revision.
2. The technician creates an Observation Bead describing the inspection, recording
   observedAt if known rather than substituting commit time.
3. The technician creates a Procedure Bead with readable seal-replacement steps,
   using application metadata to record “Housing B only” when useful.
4. The technician creates an Issue→Procedure Guidance Link so the next technician
   can find those instructions, following current guidance or pinning an edition.
5. A later technician searches “housing B”, reads compact results, and explicitly
   retrieves the Procedure Bead before doing the work.
6. The technician creates another Observation Bead and a Challenges Link to the exact
   old Procedure revision. Both Beads remain available; the Link does not automatically
   declare one true or change the Issue Bead's readiness.

### 7.2 Office work: supplier decision

1. A purchasing team creates a Requirement Bead: “Orders must arrive within five days.”
2. The team creates a Decision Bead: “Use Acme for the next quarter,” explaining its
   delivery/capacity reasons and optionally listing Beta as an alternative.
3. The team creates a Policy Bead recording the supplier-assessment rule, optionally
   naming its claimed authority, and uses an Association Link to connect the Decision
   Bead to the Requirement Bead. The Link does not prove satisfaction.
4. An assessor creates an Observation Bead and a Supports Link to the exact Decision
   revision. Incoming support does not rewrite that revision's recorded sources.
5. Later, the team either revises the same Decision Bead or creates a new Decision
   Bead with a Supersedes Link to the predecessor's current identity or selected edition.
   The predecessor and the reasons recorded at the time remain addressable.

## 8. Acceptance and remaining decisions

Each selected workflow needs tests against one exact installed build in embedded
and ordinary shared-server modes. Property validation, a catalog row or an old
preview observation is not a complete workflow pass. The implementation ledger
records source, decision, test and release evidence separately.

| Case | Required result |
| --- | --- |
| Ordinary unkeyed capture | Stable ID, stored title/body and truthful first-revision context; no invented key. |
| Explicit title and empty body, including a Requirement Bead | Present readable Memory Bead, not absence; no extra mandatory primary field. |
| Authored status on a Memory Bead or Association Link | Preserve open-string values; absence is unspecified; blank/non-text refuses; no automatic workflow, filtering, approval or truth effect. |
| Procedure body is Markdown | Preserve it verbatim; no executable steps or Type inference. |
| Existing additional properties | Preserve on targeted edit or refuse before mutation. |
| Missing title/body or malformed optional property | Typed refusal before allocation, current state or history changes. |
| Retype Memory→Procedure with unchanged body | New revision for the affiliation change; old Type/history preserved. |
| Repeated unchanged Type/properties | No-op after guard checks. |
| Stale/invalid retype or injected write failure | No partial property, owned-Link, allocation or revision effects. |
| Issue→Memory Guidance and Memory→Issue AppliesTo | Admit valid roles without changing Issue workflow or loading bodies. |
| Association family versus exact Type | Family includes all conforming specializations when supported; exact selection returns only Association, without a closed-union requirement. |
| Association or specialization with note/status | Preserve inherited optional fields; absent is valid, present whitespace-only values refuse. |
| Association Issue→Issue | Refuse: no Memory endpoint. |
| Same endpoint identity under different pins | Refuse self-Link. Parallel distinct claims and ordinary cycles remain allowed. |
| Supports/Challenges with bare target | Refuse; require author-selected exact target. |
| New Memory Supersedes a different Memory | Accept current or exact target as selected; distinct source identity, no implicit deletion, redirect or incoming-Link rewrite. |
| Revise the same Memory | Keep identity and create a revision; no replacement identity or Supersedes Link is implied. |
| Exact target changes or is deleted | Pin stays on original retained state; no current fallback. |
| Outgoing Memory-Link edit/remove/re-pin | Stable Link ID as supported, atomic source revision; target unchanged. |
| Delete Memory with floating and pinned incident Links | Remove/report floating Links, retain valid pins/history and terminal evidence. |
| Revert deleted Memory | Same ID, selected properties/metadata and current guard/provenance; Inception=revert, no Type/other-Link rollback or stolen key. |
| Compact discovery with several matches | One bounded result per Memory, matched field/excerpt, truthful completeness. |
| Unknown, empty and populated source records | Keep distinctions; never invent reading, authorship or authentication. |
| Applicability context in application metadata | No standardized fields; clock passage makes no revision or lifecycle change. |
| Default/automatic export | Follow declared exposure contract; automatic export emits no Memory records. |
| Full read/output | Include complete selected content and distinct properties; escape untrusted text. |

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

A Memory-specific verb should express an operation with a distinct user contract,
not merely repeat a shared operation with a Type preselected. A sequence of generic
operations may justify a workflow command if it adds a necessary guarantee, but the
sequence's actual semantics must be defined first.

The current model does **not yet require a new Memory-specific write verb**:

| Desired action | Existing shared operation concept |
| --- | --- |
| Record knowledge, including a Decision or Requirement Bead | Create a typed Bead. |
| Correct content, metadata or authored status | Guarded update of a Bead. |
| Change its semantic classification | Guarded Type/property update. |
| Relate knowledge to work, offer evidence or identify a replacement | Create an appropriately typed Link. Supersedes expresses replacement; it does not require a new write primitive. |
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

Treat **bd query as a design surface**, rather than restricting these questions to
its current grammar. The following scenarios specify useful inputs and results;
they do not prescribe syntax, a separate query engine or a new Memory verb. Text
search with shared filters is the baseline. The relationship-aware scenarios are
proposed capabilities whose initial release allocation is recorded with Janet.

| Question | Example selection | Required information in the result |
| --- | --- | --- |
| What knowledge matches this topic? | Search “housing B”; optionally restrict to Procedure Beads with status approved. | Deduplicated Bead summaries, exact selected revisions, matched fields/excerpts, explicit order and bounds. |
| What knowledge is recorded for this context? | Select Procedure or Policy Beads with explicit metadata predicates such as equipment=Housing B or jurisdiction=EU, optionally filtering authored status. | Matching summaries and the recorded paths/values explaining each match. The query applies the caller's predicates; it does not infer applicability or execute rules hidden in metadata. |
| What knowledge is linked to this work? | For Issue I-42, collect outgoing Guidance targets, incoming AppliesTo sources and exact Association Links in either direction. | Knowledge summaries and the Link(s) explaining each match, including direction, note/status, stored current/exact Reference and observed state. |
| What supports or challenges this edition? | For Decision D-8 at revision R2, find incoming Supports and Challenges Links targeting that exact revision. | Source Bead summaries, Link identities/status/notes and the exact edition each claim addresses. An identity-wide variant groups claims by targeted edition rather than merging their meanings. |
| What replaces this knowledge, and what did it replace? | For Procedure P-17, inspect incoming and outgoing Supersedes Links, optionally following a bounded chain. | Replacement/predecessor direction and current-versus-exact target selections. If traversing, preserve paths, branches and cycle information; do not choose a winner or newest valid policy. |
| Which citations differ from current knowledge? | For the exact References recorded on an Issue's Guidance Links, compare the cited revisions with the same identities' current revisions. | Pinned revision, current revision if available, whether they differ, and truthful unavailable/gone states. Different does not mean obsolete or wrong. Exact reads never fall forward. |
| What work or knowledge refers to this Bead? | Reverse lookup for Policy K-4, optionally restricted to edition R3 and selected Link Types. | Referencing Beads and Links, direction and target selection. Incoming Guidance finds work citing the policy; outgoing AppliesTo can identify work the policy claims to apply to. A Link is not proof of reading or use. |
| Which Decisions are connected to this Requirement? | From Requirement Q-6, find associated Decision Beads, optionally restricting Decision status to ratified. | Decision and Association summaries, matching Link directions and recorded statuses. Association does not assert satisfaction and ratified is authored status, not verified approval. |

For the work-knowledge query, Guidance and AppliesTo have specific directional roles;
Association is the generic connection. Do not include Supports or Challenges simply
because they conform to Association when the caller selected exactly Association.
Conversely, an explicit family query includes all conforming Types with each concrete
meaning visible. Deduplicate Beads while retaining the multiple Link reasons that
made them match.

Queries may explicitly request recorded status, note, property or metadata predicates.
No query silently treats a withdrawn Link as absent, interprets applicability metadata
as an executable rule, infers which policy is authoritative or proves a Requirement
fulfilled. Historical queries use their selected retained Bead/Link states rather
than mixing historical content with current relationship state. An unsupported
historical selection refuses. A bounded subset is returned only with its disclosed
limits and continuation/completeness; a partial answer is never labelled complete.

For multi-hop traversal, the caller chooses Link Types, direction and depth or other
finite traversal bounds. Results identify paths and the revisions actually observed.
Do not promise a graph-wide snapshot without a shared capability supplying one;
recorded exact inputs remain exact even when current references later change.
Unreachable or unauthorized endpoints follow shared visibility rules; report only
what can be disclosed and do not claim exhaustive impact from a partial view.

### A.3 Potential workflows requiring more design

“Record that I used this edition” differs from “recommend this knowledge to this
Issue.” Guidance records the latter. If actual-use capture becomes a selected user
workflow, define the shared Activity/provenance contract, who makes the assertion,
what exact inputs it names and how the result is retrieved. Do not invent an executed
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
passes. Type-specific body interpretation, optional distinct properties, Association
and shared Inception placement need explicit upstream alignment where they differ.

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
| R17 | Association is the usable common Type; five specializations inherit its informational contract, note and status. Family selection is open to conforming Types; open-vocabulary differences remain explicit. |
| R18 | Current and exact references, author-selected citation pins; Supersedes supports identity/current replacement and edition-specific replacement. |
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
| S5 | Issue Guidance and selected exact policy edition; Task projection staged separately. |
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

The [common property schema](./memory.properties.schema.json), six specialized
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
