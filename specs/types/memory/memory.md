# Memory Release: link and bead types

Product proposal, October 17, 2026.

This proposal defines the **Memory link and bead types** and user-visible operations
for the first supported Memory release. It specifies product behavior independently
of its eventual BDP representation.

Memory preserves reusable knowledge. Issues represent work. Activities report what
happened. A technician can save a useful note, and an office team can record a decision
and its reasons, without first completing a classification interview.

The Types and operations below are proposed product contracts. Publishing this draft
or passing its property examples does not establish implementation support.

> **Release scope.** The first supported release supplies the Memory Types and
> discoverable inventory/details. User-defined/installable Types and public Type
> editing are outside that release. The supplied inventory is an implementation
> boundary, not the purpose of this proposal. The release name remains open.
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
access to it. This proposal introduces no separate Project record, Type or ID.
Reads expose canonical Bead identity and enough Scope context to interpret it
without silently substituting a local name. Initial graph operations act within
one Scope and do not require cross-Scope resolution.

An Issue may point to Memory, and Memory may point to an Issue. Those relationships
help someone find knowledge or understand its relevance. They do not make the Memory
ready, blocked, assigned, completed or closed, and do not change Issue readiness.

A Type identifies the contract and meaning of a record. Properties carry its data.
The supplied Memory Types do not use a `kind` or `details` dispatcher. This follows
the agreed Issue-Type modeling direction. An extension property named `kind` is
not globally forbidden, but it never selects a supplied Type or changes its meaning.

The shared History, identity, Link and provenance capabilities supply the operations
Memory consumes. This proposal states their required outcomes rather than defining
a second History system, principal model, attestation scheme or general Type engine.
Activity means the one independent Activity-typed work report in
[Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510).

## 2. Memory Bead Types

All six Types have the common Memory contract. The five specializations are Memories
with more specific meaning; conformance does not require different JSON shapes.
Selecting the Memory family includes all six. Selecting a concrete Type can select
only that Type; the CLI must distinguish these operations clearly.

| Type | Meaning of `body` | Optional additional properties |
| --- | --- | --- |
| Memory | Reusable Markdown knowledge without further classification | applicability |
| Observation | What the author observed, with relevant circumstances and qualifications | observedAt, applicability |
| Decision | What was decided and the reasons and consequences | alternatives, applicability |
| Procedure | How to carry out a task, usually as readable ordered instructions | applicability |
| Policy | The recorded rule and its explanation | authority, applicability |
| Lesson | A reusable takeaway and the experience supporting it | applicability |

Memory is the common Bead contract for the five specializations. The Type is explicit;
software does not infer it from headings, property names or the subject matter of
`body`. An ordinary capture defaults to Memory. A writer may deliberately create a
specialization directly, without first creating and then retyping an ordinary note.

The catalog is a design synthesis, not a taxonomy mandated by Chris. S1/S2 motivate
plain capture and reuse; S5 motivates policy citation. Decision draws on
[architecture decision records](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Procedure draws on the reusable-job-plan/work-order distinction documented in the
[prior-art study](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/memory-type-prior-art-20261013.md).
Observation and Lesson are proposed contracts for observations and reusable takeaways,
not claims of an external standard requiring these exact six Types.

### 2.1 Common properties and body semantics

| Property | Contract |
| --- | --- |
| title | Required nonblank UTF-8 string. Supplied or derived before storage. |
| body | Required UTF-8 Markdown string, possibly empty. Preserved verbatim. The Type supplies its intended meaning. |
| applicability | Optional object containing a nonblank description of the conditions in which the knowledge claims to apply. |

**Body is the primary content for every Type.** Observation does not require a second
`statement`; Decision does not require a second `choice`; Procedure does not require
`steps`; Policy does not require `rule`; Lesson does not require `takeaway`. There is
no precedence or synchronization rule between a primary field and a duplicate body.
A Procedure's Markdown list remains content, not executable steps or tracked work.

An explicit title permits an empty body, including on a specialization. Empty content
is a present record, not absence. The Type states the writer's intended meaning;
validation does not prove that the prose is a useful procedure or justified decision.
A later machine-executable procedure would need its own explicit contract.

Properties are open at the root. Writers preserve unfamiliar values on targeted
edits or refuse before mutation when they cannot do so. Fields from an older draft
such as `choice` may survive as extension data; they do not override `body`, confer
Type membership or acquire automatic search/interpretation. A full replacement is
explicit about the complete resulting properties.

`applicability.description` is available on all six Types. It can describe an
observation's circumstances, a decision's scope, a procedure's equipment, a policy's
jurisdiction or a lesson's relevant conditions. Absence means unspecified.

The proposed `validFrom`/`validUntil` interval and its ordering rules are **deferred**.
Chris's S15 motivates recording validity context in metadata; it does not require
this particular structured interval. Applications can record their own validity
metadata, and author context can describe conditions. Passing a date never creates
a revision, expires or deletes Memory, or proves that its contents are applicable.

### 2.2 Additional properties

| Type / property | Contract |
| --- | --- |
| Observation.observedAt | Optional RFC3339 instant reported by the author. Omission means unrecorded; do not substitute commit time. |
| Decision.alternatives | Optional ordered array of nonblank strings naming considered alternatives. Absent means unrecorded; empty means none listed, not exhaustive consideration. |
| Policy.authority | Optional authored reference to the claimed source of a rule. It is not an access grant or proof of compliance. |

These properties add information that is distinct from primary content. They are
not mandatory templates. No specialization adds another required primary field.
Known portable fields use properties; open metadata remains available for application
annotations. The exact Type/property boundary deliberately refines Chris's R3.

An authority reference may identify a document or a recorded revision. It is authored
information, not a graph Link or a request to fetch, authenticate or authorize its
target. The current test artifacts permit a URI or `{uri, revision}`. A more compact
revision-reference notation remains future reference/CLI design; this proposal does
not invent one or change stored identities.

## 3. Authoring, reads and discovery

Creation accepts a nonblank title or body. With body but no title, the authoring path
uses the first nonblank body line, collapses display whitespace and caps the derived
title at 80 Unicode code points, including an ellipsis when truncated. It leaves the
body unchanged. This reuses the existing
[title helper](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/cmd/bd/graph_preview_creation.go#L36).
It is a deterministic display summary, not an inferred semantic title. Reads return
the stored title. Whitespace-only input cannot supply a nonblank derived title.

An explicit title permits omitted body on create, which becomes empty. Updates
preserve omitted fields. Markdown, frontmatter and ordinary document hyperlinks
remain body text: they do not create properties, Types, graph Links or permissions.

**Canonical CLI:** `bd memory` is the main Memory command group. `remember`, `recall`,
`memories` and `forget` remain compatibility aliases over the same records and shared
operations. Plain capture through either surface creates ordinary Memory unless the
caller deliberately selects another supplied Type. Memory commands do not create a
second key/value store. Appendix A proposes concrete commands for review.

**`bd query` is under review for scenario coverage.** This proposal specifies required
Memory selection and discovery outcomes without freezing that command's grammar.

Discovery searches title, body and documented human keys, plus the declared distinct
knowledge fields where supported, such as alternatives and applicability.description.
It does not automatically search arbitrary metadata, unknown properties, provenance
or referenced bodies. A hit identifies the matching field and gives only a bounded
excerpt. Several field/key matches still produce one Memory result.

Results have deterministic order and honest count/byte limits. Filtering happens
before pagination. Continuations, if offered, state their validity and refusal
conditions; an implementation may instead refuse an over-limit query. It must not
simulate complete results by filtering one page or concatenating incomplete pages.

Discovery and traversal are compact; complete recall is deliberate. A full read
returns the canonical identity, selected current or exact revision, Type, title,
complete body and properties, metadata, outgoing Links, available provenance and
supported keys together. Human output renders distinct properties alongside body;
it does not copy them into stored Markdown or call a body-only projection complete.

Empty and absent remain distinct. Historical reads return the retained Type, content
and outgoing set, never current replacements. Stored content and diagnostics remain
untrusted data: output is escaped appropriately and never gains execution authority.

The storage-acquisition versus consumer-delivery boundary for R8/R21 remains an
explicit acceptance question. Compact output alone is not proof that the reader
avoids acquiring unrelated bodies internally. Context-pack budgets, ordering and
receipts belong to the consumer; the product reports its actual delivery bounds.

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
- Association defines an optional nonblank `note` property explaining the relationship;
  all five specializations inherit it. The note is about the Link, while the Memory's
  body carries its knowledge. Open properties and metadata preserve additional
  annotations. There are no other declared Link properties in this release proposal.
- Changes to an outgoing Link of a Memory version that source atomically. They do
  not version the target merely because it has an incoming Link. Historical outgoing
  sets stay attached to their original source revisions.
- Parallel claims and cycles are permitted. A Link from an identity to itself is
  refused, even if its two endpoints use different revision selections.

The specialized Types retain their own meanings and narrower endpoint/pin rules
while satisfying the Association contract. The common property need not be required
to justify the hierarchy: shared behavior is also part of the contract. This does
not change the existing Dependency contract.

### 4.2 Allowed endpoint pairs

Each line in the middle column is one complete allowed **source → target** pair.
“Memory” includes all five specializations. For this release, “Issue” and “Memory”
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

The accepted shared operation is **`bd revert`**. It creates a new revision under
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

1. A technician captures ordinary Memory: “Housing B uses a different seal.” A stable
   identity and first attributable revision are created without inventing a human key.
2. An Observation body records the inspection and its circumstances. `observedAt`,
   if known, records observation time rather than commit time.
3. A Procedure body contains the readable seal-replacement instructions. Its
   applicability description says “Housing B only.” There is no duplicate steps array.
4. An Issue→Procedure Guidance Link helps the next technician find those instructions.
   It can follow current guidance or pin the edition intended for that job.
5. A later Observation challenges the exact old Procedure revision. Both records
   remain available; the system does not automatically declare one true or change
   the job's readiness.

### 7.2 Office work: supplier decision

A Decision body says “Use Acme for the next quarter” and explains the delivery and
capacity reasons. Optional alternatives list Beta; applicability says which orders
are covered. A Policy body records the supplier-assessment rule, optionally naming
its claimed authority. No `choice` or `rule` field repeats either body.

An assessment Observation may Support the exact Decision revision. A later Decision
with a new identity may Supersede the earlier Decision, following its current state
or explicitly pinning the replaced edition. Revising the existing Decision under the
same identity is also supported. The older decision and the reasons recorded at the
time remain addressable. A source list records what the writer says informed a
particular revision; later incoming support does not rewrite that list.

## 8. Acceptance and remaining decisions

Each selected workflow needs tests against one exact installed build in embedded
and ordinary shared-server modes. Property validation, a catalog row or an old
preview observation is not a complete workflow pass. The implementation ledger
records source, decision, test and release evidence separately.

| Case | Required result |
| --- | --- |
| Ordinary unkeyed capture | Stable ID, stored title/body and truthful first-revision context; no invented key. |
| Explicit title and empty body, including a specialization | Present readable Memory, not absence; no extra mandatory primary field. |
| Procedure body is Markdown | Preserve it verbatim; no executable steps or Type inference. |
| Unknown root property, including kind | Preserve on targeted edit; do not change Type or override body meaning. |
| Missing title/body or malformed optional property | Typed refusal before allocation, current state or history changes. |
| Retype Memory→Procedure with unchanged body | New revision for the affiliation change; old Type/history preserved. |
| Repeated unchanged Type/properties | No-op after guard checks. |
| Stale/invalid retype or injected write failure | No partial property, owned-Link, allocation or revision effects. |
| Issue→Memory Guidance and Memory→Issue AppliesTo | Admit valid roles without changing Issue workflow or loading bodies. |
| Association family versus exact Type | Family includes all conforming specializations when supported; exact selection returns only Association, without a closed-union requirement. |
| Association or specialization with note | Preserve the inherited optional note; absence is valid, present whitespace-only note refuses. |
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
| Applicability dates in application metadata | Clock passage makes no revision or lifecycle change. |
| Default/automatic export | Follow declared exposure contract; automatic export emits no Memory records. |
| Full read/output | Include complete selected content and distinct properties; escape untrusted text. |

Open product decisions include exact CLI grammar/output, names and keys, source-pin
mutation details, full initial scenario allocation and the selected storage-acquisition
boundary. The shared Inception/revert meanings are decided; producer/schema/runtime
integration remains owner work. Activity workflow, connected
interchange, legacy conversion and project-feed/removal inclusion need their own
explicit release decisions. Existing Dependency compatibility remains an integration
item. Accepted decisions are recorded in #7656 rather than silently inferred here.

## Appendix A. Proposed Memory CLI

The canonical `bd memory` group and compatibility aliases are accepted direction.
**The concrete verbs and flag spellings below are proposals for reviewing the user
design**, not claims of implemented CLI support. All entry points use the same
canonical records, validators and operations. Unknown/unsupported writers refuse
rather than lose required state. `bd query` is under review for scenario coverage.

| Proposed command | Operation and acceptance |
| --- | --- |
| `bd memory create [BODY]` | Create ordinary Memory by default; explicit Type selects a specialization. One body source: positional text, file or stdin. Optional title; otherwise derive it. Return canonical identity and accepted revision. |
| `bd memory show MEMORY` | Complete explicit recall. A revision option selects an exact retained state. Human and structured output preserve empty content and distinct properties. |
| `bd memory list [SEARCH]` | Compact deterministic discovery with documented bounds and Type-family versus concrete-Type selection. Complete content requires explicit selection. Search/query grammar remains under review. |
| `bd memory update MEMORY` | Targeted property/body/metadata edits or an explicit full replacement. Retyping and necessary content edits are one guarded operation. Omitted Type/fields preserve current values. |
| `bd memory delete MEMORY` | Recoverable disappearance with selected Link cleanup, terminal evidence and affected-source reporting. Preview/apply conventions must be reconciled with shared deletion CLI. |
| `bd memory revert MEMORY` | Proposed Memory facade over shared `bd revert`: select retained properties/metadata with a current guard; same ID, new current-operation provenance. Deleted-to-live resumes presence. No implicit Type, endpoint or other-Link rollback. |

Proposed shared options include `--type`, `--title`, `--body-file`, `--stdin`,
`--properties`, `--if-revision`, explicit replacement and structured-output selection.
The exact write grammar must reject conflicting body sources and ambiguous field
replacement before opening input or mutating storage. Revision pins need a convenient
CLI notation; no new serialized Reference format is adopted here.

| Compatibility entry point | Canonical behavior to preserve |
| --- | --- |
| `bd remember` | Deliberate write-only capture/update. A single content token is text, never a state-dependent read. Same default Memory Type and explicit operation rules. |
| `bd recall` | Complete selected current or exact Memory read by supported ID/key. Empty body remains present. |
| `bd memories` | Compact list/search by default. The existing proposal's body-carrying `--json` compatibility result must be explicitly mapped and labelled; do not silently turn it into a summary or hide bodies in an unlabelled projection. |
| `bd forget` | Recoverable Memory deletion, including empty-body records, under its documented immediate-write semantics. Generic `bd delete` retains its separately reviewed preview/apply behavior. |

Aliases can normalize their explicit options onto the canonical operations. They
must not maintain separate state, silently drop additional fields, bypass Type/Link
checks or infer a read from store contents. All deliberate shipping changes need
rationale and refusal/output tests. Generic `bd create`, `show`, `update`, `list`
and Link operations must either preserve the same selected Memory contract or
refuse before mutation.

Memory Link authoring/edit/removal uses the shared `bd link` surface and Link IDs.
This proposal adds the endpoint/pin requirements, not another Link command store.
Issue inspection exposing informational Memory Links is M-D5 and may follow Preview 3;
separate Link discovery still must report its actual supported completeness.

### A.1 Walkthrough to vet the surface

The following names/flags illustrate the proposed grammar:

```sh
bd memory create --type procedure --title "Replace housing B seal" --body-file seal-procedure.md
bd memory list "housing B"
bd memory show MEMORY_ID
bd memory update MEMORY_ID --type lesson --body-file lesson.md --if-revision REVISION
```

The Procedure body contains the instructions; there is no steps payload to maintain.
The update is an explicit semantic Type change with body edits, one guard and one
atomic outcome. A stale revision or invalid Link outcome leaves state unchanged.
The full workflow is not accepted merely because help or a property test passes.

### A.2 Exposure and guidance

- Generated guidance teaches search, explicit recall and deliberate capture. It does
  not inject all Memory bodies or recursively follow Links. Exact `prime` commands
  and delivery budgets require supported-surface acceptance.
- Ordinary search, list, graph traversal and records merely referring to Memory use
  compact summaries. They do not include full body or complete alternatives/other
  potentially long properties. Match excerpts have the same bounded budget.
- Complete `show`/recall is deliberate. Other body-carrying modes require an explicit
  caller choice and clear output labelling; stored configuration cannot broaden a
  surface from summary to full content. Legacy `memories --json` is an explicitly
  named compatibility contract, not permission for other JSON views to expose bodies.
- `bd export` excludes Memory unless explicitly requested. Automatic export emits
  no Memory records, even if a prior manual export included them. A provider-level
  whole-store restore backup is distinct from canonical export.

## Appendix B. Mapping to Chris's proposal

[Memory #5877, Revision 4](https://github.com/gastownhall/beads/issues/5877) supplies the
behavioral baseline. The table names obligations and deliberate refinements, not
passes. Type-specific body interpretation, optional distinct properties, Association
and shared Inception placement need explicit upstream alignment where they differ.

| Requirement | Product outcome / disposition |
| --- | --- |
| R1 | First-class Memory family with explicit Type; no Issue workflow state. |
| R2 | Stable identity independent of names; shared key placement/versioning remains open. |
| R3 | Body-first knowledge, optional distinct properties and application metadata; intentional Type/property and shared-Inception refinements. Exact validity interval deferred. |
| R4 | Deliberate write-only capture, title derivation, canonical success identity. |
| R5 | Deletion with retained history, same-ID undelete through shared revert, and truthful erasure where supported. |
| R6 | Compact ordered discovery, one result per Memory, truthful bounds/continuation. |
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
| R17 | Association is the usable common Type; five specializations inherit its informational contract and note. Family selection is open to conforming Types; open-vocabulary differences remain explicit. |
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
| R31 | Canonical bd memory and aliases selected; exact command changes justified and tested. |

| Scenario | Realization / dependency |
| --- | --- |
| S1 | Unkeyed ordinary capture, derived title and first attributable revision. |
| S2 | Search, explicit recall and guarded correction; no duplicate required primary content. |
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

The [common property schema](./memory.properties.schema.json), five specialized
property fragments, [Link properties](./memory-link.properties.schema.json) and
[property cases](../../../fixtures/specs/memory/schema-cases.json) are review aids for
this product contract. Each specialization also validates the common Memory shape.
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
