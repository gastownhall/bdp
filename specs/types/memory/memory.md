# Memory Bead and Link Types

Work-in-progress domain specification, October 15, 2026. Memory preserves reusable
knowledge; Issues represent work; Activities report what happened. A technician
can save a useful note immediately, and an office team can record a decision with
its reasons and sources. Neither must complete a taxonomy interview first.

**Donna's ruling: use distinct Bead and Link Types, with no domain `kind`
discriminators.** This replaces the earlier one-Memory-plus-kind recommendation.
Memory itself is usable for an ordinary note. Observation, Decision, Procedure,
Policy and Lesson specialize its contract through conformance. Their additional
data is directly named properties, not a `details` dispatcher. The six proposed
informational relationships remain distinct Link Types.

The ruling selects Type granularity. The exact field contracts, supplied catalog,
illustrative identities and remaining operation dependencies are draft proposals.
MUST/SHOULD/MAY below describe this proposed domain contract, not adopted wire
syntax, runtime delivery, release acceptance or a Preview 3 cutline.

## 1. Sources, authority and reconciliation

The shared [Types design](../../types.md) owns definition representation, exact
affiliation, conformance, schema composition and graph-constraint matching. It is
an optional Scope-wide profile depending on Core, not Write. This domain uses
Types and Core; its write obligations apply where writes are supported. The
[existing protocol](../../../docs/specs/bdp.md) remains authoritative until separately
amended. Publishing design on main does not adopt candidate wire forms.

**Shared design baseline:** public BDP main at
[`aed21767e1ade54bef6dad108c4f24b8e9cd844b`](https://github.com/gastownhall/bdp/commit/aed21767e1ade54bef6dad108c4f24b8e9cd844b),
after PR142 landed. Its Types file, including open decisions/readiness, was read in
full before this isolated domain branch was populated. Existing protocol source
was checked at `9df574a9ac980272fa31be9f443a771233b69c6a`; its relevant envelope,
History and deletion rules remain unchanged in this base. This is a source read,
not fresh implementation qualification.

The illustrative definitions below use the **candidate Types-profile format**,
not a current-Core installation format. In particular, Core uses object-keyed
ownership declarations with mandatory `max`; Types proposes selector arrays and
separates ownership from count constraints. Core v0 also lacks these endpoint-pair
unions. Adopting either change requires a shared semantic amendment, separately
from editorial file moves. This draft neither translates the formats nor waives
Core's current limits, complete-owned-state reads or authorization closure.
Compact discovery projections need their own shared view contract; a partial Core
Bead record cannot simply be relabeled complete.

Sources reviewed October 15, 2026:

| Source | Reviewed identity and effect |
| --- | --- |
| [Memory #5877](https://github.com/gastownhall/beads/issues/5877) | Current body remains Revision 4, September 22; issue updated October 9. Covers R1–R31/R27a and S1–S16. |
| [Revision 4 response](https://github.com/gastownhall/beads/issues/5877#issuecomment-5787432078) | Registration, aliases, duplicate Links, ownership, deletion and shared-operation gaps; its fixed-Link-Type sentence is superseded here by the newer explicit-retyping design. |
| [Applicability and relationship conventions](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303) | Preserve circumstances and meaningful relationships without imposing a universal claim engine. |
| [Consolidation follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-6009424090), [experiment](https://github.com/gastownhall/beads/issues/5877#issuecomment-6028640616) | Consolidation is external consumer work; merging records is not adjudication or proven retrieval improvement. |
| [Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510) | Current body and all six comments refreshed October 15. Revision sources and Activity remain distinct. The body/comment Activity-admission conflict and Core/V2 actor-basis difference are named in §6. |
| [Product Types #7590](https://github.com/gastownhall/beads/issues/7590) | October 15 proposal and its triage comment; product context, not a duplicate CLI specification. |
| [Earlier Memory draft](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/specs/types/memory.md) | Starting proposal at exact authoring commit `cbd59b601875ec5c20dd189c22a95ccad4b33390`; useful semantics/examples retained, flat-Type and kind-dispatch assumptions replaced. |
| [Historical A/B comparison](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/specs/types/memory-approaches.md), [rationale](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/memory-bead-link-model-20261013.md) | Background preserved unchanged, not a second current specification. |
| [Issue/Dependency](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/specs/types/issue.md), [prior art](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/memory-type-prior-art-20261013.md) | Same exact authoring commit. Preserve established work semantics and practical field/office examples; old discriminator/flat-Type statements are historical. |

Issue's task/bug/etc and Dependency's blocks/parent-child/etc conform to their
respective bases. This specification neither restores `issue_type`/`dep_type`
properties nor treats every Dependency as blocking. Activity is defined by V2;
this domain ruling does not edit Activity's fields or invent another Activity,
provenance envelope, run identity or causality system.

**Explicit refinement of R3.** Chris places application taxonomy and validity in
metadata. This proposal defines known portable knowledge fields and applicability
as properties of distinct Types. That is a visible proposed refinement, not
unchanged R3 conformance. Open application metadata remains available. Type
granularity is settled by Donna's ruling; detailed property/metadata boundaries
and upstream proposal alignment remain review items.

Other reconciliation points must not disappear behind the requirement mapping:

| Proposal requirement | Reconciliation in this draft |
| --- | --- |
| R1/TC1/R31, first-class Memory | A first-class Beads product concept can use an ordinary registered domain Type, not a new intrinsic BDP bootstrap definition. The literal `type: "memory"` test becomes affiliation/conformance matching, including specializations, for generic lists and typed workflow refusal. This requires shared closure/query support; installation alone does not supply it. |
| R3, absent derivation | V2 permits unknown sources on native creation too, preserving body-only capture. This broadens Chris's pre-schema/converted description; omission never fabricates a deliberate empty list. |
| R6/R27a, knowledge in direct properties | Discovery must search the declared knowledge fields, and compact outputs must not expose them in full merely because they are outside Markdown. |
| R4/R31, authoring and Type operations | Specialized creation explicitly supplies the Type and complete properties in one write. Product contracts must account for this, guarded retyping and Type-aware discovery beyond the old command table; their grammar remains with the product/shared owners. |
| R12, responsible actor | New native Memory revisions require an actor even though the general shared envelope permits absence. This is a domain operation requirement, not a new provenance representation. |
| R17/R23/R31, existing `related` | The candidate Memory Related identity does not itself extend the existing product selector or Dependency-related contract. Compatibility needs an explicit shared/product decision. |
| R5/R20 versus Type participation minimums | Unconditional cleanup can invalidate a surviving Bead's minimum. This is an unresolved cross-contract conflict, not a completed requirement. |

## 2. Catalog, identity and conformance

`K` abbreviates illustrative publisher namespace
`https://example.org/memory-types/`. It is not a production registry assignment.
`memory-contract-1`, `issue-1` and other revision strings are illustrative
opaque revisions, not version labels or client-assignable revision tokens.

| Definition identity | Described instances | Direct domain conformance | Purpose |
| --- | --- | --- | --- |
| K/memory | Bead | None | Ordinary durable note; common knowledge contract |
| K/observation | Bead | Memory at an exact definition revision | A recorded observation and optional observed time |
| K/decision | Bead | Memory at an exact definition revision | A choice and optionally recorded alternatives |
| K/procedure | Bead | Memory at an exact definition revision | Reusable ordered instructions |
| K/policy | Bead | Memory at an exact definition revision | A recorded rule and optional claimed authority |
| K/lesson | Bead | Memory at an exact definition revision | A reusable takeaway |
| K/memory-related | Link | None | Informational navigation |
| K/memory-guidance | Link | None | Intended guidance for an Issue |
| K/memory-applies-to | Link | None | Claimed applicability to a subject |
| K/memory-supports | Link | None | Offered support for particular content |
| K/memory-challenges | Link | None | A reason to reconsider particular content |
| K/memory-supersedes | Link | None | An offered replacement for particular content |

These twelve definitions are a bounded review candidate, not twelve new core
Resource kinds. A separate Note Type is unnecessary: use Memory directly. Further
labels need not become Types unless a shared contract justifies them. There is no
generic discriminator escape hatch or per-kind validator dispatch.

Definitions are ordinary Beads affiliated with exact foundational BeadType or
LinkType definitions. That affiliation does not mean their described instances
conform to those metatypes. Only the bootstrap minimum is intrinsic; potential
pre-installation does not make Memory intrinsic or exempt from ordinary lifecycle.

Each child definition owns a ConformsTo Link to the exact Memory contract it
promises. Recorded historical owner state supplies those declarations. Editing
Memory or a declaration does not change an existing instance or descendant pin.
The [illustrative definition graph](./definitions.json) shows
these domain declarations without defining new bootstrap or package mechanics.

Conformance holds because every valid specialization preserves title/body,
Inception, applicability, open metadata, history and non-workflow meaning, and adds
its own fields without weakening inherited promises. All applicable schemas and
constraints are conjunctive. A specialized Type cannot reinterpret shared units
or withdraw an explicitly promised base operation under its stated preconditions.
Matching JSON alone or passing a prospective check does not declare conformance.

A custom Memory specialization is permitted through justified exact conformance.
A custom informational Link may be independent or conform to a supplied Link
contract; the latter must preserve endpoint and pin semantics as well as property
shape. The supplied relationships declare no conformance to each other or to
Dependency. Similar names are not declarations.

## 3. Bead properties and complete reads

All properties below are authored/writable subject to authorization and validation;
none is a computed workflow observation. Identity, revision, affiliation, metadata,
owned state and common revision provenance remain in the shared envelope. A
properties schema is not an envelope schema or complete domain-operation validator.

### 3.1 Common Memory contract

| Property | Requiredness and meaning |
| --- | --- |
| title | Required nonblank UTF-8 string; caller supplied or derived before creation |
| body | Required UTF-8 Markdown string, possibly empty; preserved verbatim |
| inception | Optional origin/transfer object; method native, converted, imported or unknown; optional origin reference, not a source list |
| applicability | Optional claimed conditions: nonblank description and optional validFrom/validUntil RFC3339 instants |

The [Memory properties schema](./memory.properties.schema.json) has an
open root for future/conforming properties. The `inception` and `applicability`
objects are deliberately closed in this candidate; conformers cannot add nested
members without adopting a revised base contract. A specialization may introduce
well-named root properties where the inherited schemas permit them. The inherited
prohibition on `kind` also applies to every conformer, including unrelated uses
of that property name; this makes Donna's no-discriminator boundary explicit.
These are reviewable closure choices, not an ability to override a parent schema.
Open roots do not confer semantics on unknown fields. Preserve
unfamiliar values on safe targeted edits, or refuse edits that cannot preserve them.
Application-specific annotations may use common open metadata; this proposal
introduces no second metadata/extension store.
Properties and metadata are retained versioned state. A value that must not
persist belongs in neither; editing or deleting current state does not erase
retained history. Required removal uses the shared erasure contract.

Creation receives a nonblank title or body. With body but no title, authoring
derives a title before storage. The earlier first-nonblank-line/80-code-point rule
remains a reviewable authoring candidate, not an established implementation fact.
An explicit title permits empty body; omitted body on create becomes empty. Empty
content is a found Memory, not absence. Updates preserve omitted values. Body
headings/frontmatter never create properties or Links or synthesize a classification.

Plain capture selects Memory without asking for a knowledge form. A specialized
creation deliberately supplies its exact Type affiliation and complete properties,
including required local fields, in one atomic write validated against the whole
inherited contract. Creating a Procedure does not require first publishing a plain
note and then retyping it. Type/property selection is an R4/R31 product extension;
this document defines the outcome without inventing CLI arguments or an envelope.
On legacy conversion, an empty value keeps its empty body and gets a title derived
from the legacy key. The key remains an alias, never canonical identity. This is a
conversion rule, not permission for ordinary capture to invent keys or content.

Native creation may default Inception to native; conversion/import records only
known origin. Absent legacy Inception is unknown, not inferred native. Inception
changes are durable state changes, distinct from revision attribution.
Absence means Inception was not recorded; an explicit `{method: "unknown"}` records
that the origin method is deliberately unknown and may carry other known fields.
Both leave origin knowledge unknown, but their presence differs. Complete reads
preserve that distinction rather than synthesizing or normalizing either state.

For applicability, validFrom is inclusive and validUntil exclusive. Both supplied
requires from < until after normalization; malformed timestamps fail. Omitted
bounds state no boundary, not universal validity. An absent applicability object
means unspecified. Clock crossings never version, delete or certify a Memory.
JSON Schema format handling and interval ordering require explicit admission checks;
this is not proof the claimed conditions are true.

### 3.2 Specialized contracts

Each linked schema defines the Type's **local** properties requirements. Complete
instance validation also applies the exact inherited Memory schema through the
recorded ConformsTo graph; a local fragment passing alone is not complete acceptance.

| Type | Added properties | Meaning |
| --- | --- | --- |
| [Observation](./memory-observation.local-properties.schema.json) | statement required/nonblank; observedAt optional RFC3339 instant | Caller-reported observation and observation time; omitted time remains unknown, never commit time |
| [Decision](./memory-decision.local-properties.schema.json) | choice required/nonblank; alternatives optional ordered array of nonblank strings | A recorded choice, without approval, Issue completion or exhaustive-alternatives claim |
| [Procedure](./memory-procedure.local-properties.schema.json) | steps required/nonempty ordered array of nonblank strings | Reusable instructions; no automatic execution, work plan, progress or step identities |
| [Policy](./memory-policy.local-properties.schema.json) | rule required/nonblank; authority optional URI or `{uri, revision}` authored value | A recorded rule and claimed authority reference, never an access grant or compliance certification |
| [Lesson](./memory-lesson.local-properties.schema.json) | takeaway required/nonblank | A reusable lesson, not proof of general applicability |

All inherit the common contract. Fields are directly named: no `kind`, `details`
wrapper or inference from prose. Missing alternatives means unrecorded; an empty
array means none listed, not exhaustive consideration. Order of procedure steps
is significant; numbers are positions, not persistent step identities.

`inception.origin` and `authority` reuse only the existing Core Reference **value
shape**: a URI or `{uri, revision}`. Under [Core's Reference rule](../../../docs/specs/bdp.md#references),
values inside properties are authored data, not protocol References or graph edges.
These fields confer no Core canonicalization, resolution, traversal, incident-Link
behavior or target validation. Their shape restrictions are this Type's own
properties contract, not Core Reference admission. They may contain resource URIs
or opaque external URIs/URNs, without authenticating a target or its content. For
graph semantics, use a declared owned Link under the applicable shared contract;
do not silently promote a property value into an edge. The inline schemas mirror
the value shape only. V2's `{ref, rel?, note?}` is a source entry containing a
Reference; sources remain in V2, not these authored fields.

Structured fields carry their defined assertions; body supplies narrative,
reasoning, limitations and tradeoffs. Repeated prose is not synchronized or
semantically checked. Full structured reads keep canonical Project/Scope and Bead
identity, the selected exact state Reference, all properties, metadata, Inception,
exact affiliation, owned Links, revision provenance and keys/aliases together.
Historical key visibility and restoration follow the eventual shared alias
contract and Memory Open question 1; missing historical names are not invented.
A full human record must render the specialized knowledge alongside body. An explicitly
body-only projection returns the complete body and must not claim to be the full
record. Do not duplicate structured fields into stored Markdown to disguise an
incomplete reader. This rendering/product refinement is explicit under R7/R31.
Stored content and provider diagnostics remain untrusted input under Chris's TC8:
human renderers prevent terminal-diagnostic impersonation, structured renderers
escape values correctly, and neither turns stored knowledge into instructions or
rewrites the stored body to implement display protection.

## 4. Informational Link contracts

Every Link is directional, has its own identity and exact Type affiliation, and
uses common source/target References. It grants no instruction, execution, trust,
permission, workflow effect, automatic context loading or quality judgment.
At a known in-Scope Memory endpoint, reject every relationship whose meaning
requires Issue workflow state, including blocking readiness. This applies to
incoming and outgoing Links and to custom registered Link Types, even when their
property schema or a permissive endpoint pair would otherwise pass. Do not infer
these semantics from a short name or treat every Dependency as a blocker. Opaque
external roles remain expectations, not a remotely verified endpoint Type.
This is a semantic obligation of Type authors and registrars as well as writers.
Supported admission can check exact conformance to a recognized workflow Link
contract with that declared promise; neither conformance to Dependency in general
nor an Issue endpoint alone proves workflow dependence. For custom Types without
such a declaration, authors/registrars must preserve the non-workflow contract;
shape matching cannot establish that their prose is truthful. No workflow category
field or semantic-classification language is introduced here. Automated discovery
and enforcement for arbitrary custom contracts remain shared design work. Report
the declarable checks actually supported; do not label them full semantic validation.
The [common relationship properties schema](./memory-link.properties.schema.json)
allows an optional nonblank note; it has no relationship selector. Common metadata
holds application annotations. A note explains the relationship, not a competing
canonical rationale or evidence envelope.
The six definitions deliberately share one schema resource with identical bytes
under one `$id`. A changed common schema requires a new schema identity and affected
definition revisions; a per-Type divergence needs its own `$id` and new definition
revision. Independent Type revisioning cannot give that shared schema ID two meanings.

### 4.1 Allowed pairs and external expectations

L denotes any in-Scope Bead. M and I denote in-Scope Beads satisfying exact selected
Memory and Issue contracts, including their transitive conformers. E denotes an
opaque cross-Scope Bead reference with wildcard Type admission; X an opaque external
resource reference. `E(Memory)`/`E(Issue)` below describe the relation's expected role,
not a typed external constraint or a claim of verified membership.

| Link | Source → target alternatives | Target reference and meaning |
| --- | --- | --- |
| Related | M→L; L→M; M→E; L→E(Memory); E→M; E(Memory)→L; M→X; X→M | Floating or exact; navigation with at least one known/expected Memory role |
| Guidance | I→M; I→E(Memory); E(Issue)→M | Floating or exact; intended guidance, not proof it was read or used |
| AppliesTo | M→L; M→E; M→X; E(Memory)→L | Floating or exact; source claims relevance under its stated conditions |
| Supports | M→M; M→E(Memory); E(Memory)→M | Exact target required by this proposed domain contract; source offers support for that content |
| Challenges | M→M; M→E(Memory); E(Memory)→M | Exact target required; source offers a reason to reconsider that content |
| Supersedes | M→M; M→E(Memory); E(Memory)→M | Exact target required; source offers replacement for that content in its stated context |

Each row is a union of **pairs**. Both endpoints must match the same alternative;
source/target lists cannot be flattened independently. Every inherited pair set
also applies. The illustrative descriptors use current candidate pair syntax;
external-capable arms use wildcard Types and never request a remote Memory/Issue
Type check. At least one endpoint is local. Links-as-graph-endpoints are not enabled.
Related in this catalog requires at least one known or expected Memory role.
An entirely local Issue→Issue pair uses the existing Issue/Dependency contract,
not this new Type. Existing related or supersedes records are not reinterpreted.

In particular, `K/memory-related` is a distinct illustrative identity. It does not
silently rebind the existing `--type related` selector or change historical Links.
R17/R23/R31's baseline requires an explicit choice by the shared Type/product owners:
evolve the baseline contract, define a compatible selector mapping, or acknowledge
a change to Chris's requirement. Conformance cannot widen an inherited Issue-only
endpoint restriction. No option is selected here, and this candidate catalog alone
does not establish the promised existing-command compatibility.

The local M/I arms deliberately pin `memory-contract-1` and the shared foundation's
`issue-1` in this conservative candidate. They rely on those exact semantic contracts,
not merely familiar names. An Issue@issue-2 or Memory@memory-contract-2 without
conformance to the selected revision does not match. This couples the Link catalog
to those contracts: accepting a changed base requires justified conformance back
to the selected contract or explicit new Link-definition revisions. Identity-wide
Issue selection is a review alternative if no exact Issue promise is needed; it is
not silently substituted here. Stored Link affiliations never upgrade automatically.
Same-identity cross-revision conformance remains an open Types evolution question;
this document does not assume that a new base revision may declare the old one.
A breaking base change can instead require new specialization and Link-definition
revisions with new exact pins and an explicit migration. Relaxing a closed nested
schema cannot claim conformance back to a contract that forbids the added members.

No target fetch, import or control is required for cross-Scope admission. The Link
Type records an expected role, not an observed Type. Reads distinguish stored
expectations from observed kind/lifecycle/availability; unavailable is not proof
of gone. The shared encoding for that expected/observed distinction remains an
explicit R9/R19 dependency; these descriptors alone do not supply it. A locally
available registry replica does not become an in-Scope endpoint merely by caching.
Apply the open installed-definition/Scope boundary in Types §7.2, not a new local-ID
remapping rule.

Local floating endpoints must name live Beads satisfying expected contracts; local
exact endpoints must name valid retained states and are checked using those states'
Type pins. Self-Links compare canonical endpoint identity, regardless of revisions,
and fail before mutation under this domain contract.

### 4.2 Pins, ownership and graph restrictions

Self-Link rejection, required citation pins, retained local endpoint admission and
non-workflow participation need domain admission support beyond properties schemas
and the current pair descriptors. In particular, no irreflexivity member is added
to shared `linkConstraints`: generic acyclicity would also prohibit longer cycles,
which these informational Types do not promise. Keep self-Link admission as a named
shared-coordination dependency. A server must not claim full domain validation while
silently ignoring any supported required check. An implementation limited to
property shapes and declared contracts must report that limit; it cannot certify
arbitrary custom Type semantics from those checks.

Endpoint references default to floating. An explicit exact-target requirement is
not fulfilled by silently pinning a bare input to current content. No generic
pin-mode descriptor member is introduced: required citation pins are proposed
domain semantics requiring supported admission beyond properties schema. A server
cannot claim to validate this contract while silently ignoring that requirement.
A pin on an external reference is not proof of existence, availability or immutability.

All six Link Types have no local participation minimum, pair-uniqueness requirement
or acyclicity declaration. Distinct parallel Links are allowed. Supersession can
be disputed, multiple replacements can coexist, and cycles are recorded claims;
no winner, total order, transitive replacement, deletion or retargeting is inferred.
The author makes a deliberate choice between revising one identity and recording
a new decision that offers replacement of another.

Ownership follows the source's exact Bead contract. Every outgoing Link of an
in-Scope Memory, including custom informational Links and conformers, is owned.
Outgoing changes version that source atomically, not the target. A Guidance Link
from an Issue follows the external Issue ownership contract; this file cannot add
Issue ownership or otherwise change established workflow. For a source outside
the storing Scope, do not pretend this Scope revised the remote owner. Incoming
Links never become durable target Memory state.
With the illustrative Issue ownership list, a Guidance Link is not thereby part
of the Issue's owned snapshot either. Its own retention and query visibility need
the shared Link/History contract; do not promise an Issue revision or infer that
the Link has no independent history. Issue ownership remains with its owner.

Current Core also requires owned-state view closure: a Memory with an owned Link
or local endpoint hidden from a view is itself hidden from that view. A reader
must not return a partial owned set as complete or reveal the hidden endpoint to
explain the omission. Historical/pinned endpoint authorization needs the shared
History/graph resolution contract; this draft creates no Memory-specific exception.

A pinned source Reference identifies retained state; it is never permission to
edit that historical revision. Where mutation of such a Link is supported, owner
write effects apply to the source identity under the applicable current write and
ownership contract, creating new state rather than changing the pinned snapshot.
Source-pin operation syntax and old/new ownership admission remain shared
dependencies; unsupported cases must refuse accurately.

No new finite domain count limit is selected. The previous proposed 1024-owned-Link
bound remains a review item, not a shipping guarantee. Any adopted bound follows
Types' precise count population and activation rules: endpoint identities across
pins, current local Links across relevant Type revisions/conformers, no separate
budget per alternative or subtype. Product operation limits may still be disclosed
and rejected before mutation under R14.
This does not permit a current-Core writer to omit its mandatory wildcard `max`.
Types-profile adoption must explicitly reconcile that bound and complete-owned-set
reads. Large owned sets amplify record size and source-version writes; finite
admission/capacity limits and truthful refusal are required before qualification,
not silent truncation or a claim that an unbounded catalog is operationally proven.

Arity, pair uniqueness and declared acyclicity are checked against the final
atomic state where applicable. This supersedes the old draft's each-operation-valid
assumption; authorization, syntax and revision guards are not thereby deferred.
A conforming specialization adding acyclicity inherits the shared **per-Link**
promise, not a blanket whole-family DAG: relevant old Links participate in finding
cycles through constrained Links, while unrelated old-only cycles need not vanish.
No such new constraint is imposed on these six definitions by default.

## 5. Updates, discovery and lifecycle

Explicit retyping can preserve Resource identity. A Memory note may become a
Procedure only with valid complete resulting properties and all affected graph
requirements satisfied. No fields are automatically dropped, renamed or interpreted
as another Type. The old revision remains a Memory note. Conversely a downgrade
does not silently remove unfamiliar properties; the writer supplies any intended
data transformation. Type/category change is not Bead-to-Link conversion.

Omitted affiliation preserves its exact identity/pin. Explicit Type updates need
the shared revision precondition and atomically validate transformed properties,
ownership and affected Links. Floating local endpoints require shared revalidation
rules; historical endpoint pins continue to name their old states. Old/new ownership
projection, source revision materialization and coordinated repairs are dependencies,
not invented migration algorithms here. Reject unsupported transitions honestly.

All-Memory discovery selects affiliation/conformance to the required Memory
contract. This includes a qualifying Decision/Procedure/custom descendant without
enumerating its nominal ID. A nominal-only filter remains a distinct operation.
A pinned Type constraint means exact affiliation/conformance; an identity-wide
constraint spans revisions and does not resolve latest. Identity-wide browsing
must not claim structural compatibility with every future revision. Unsupported
query/matching/continuation guarantees must be reported, not emulated by filtering
one page or concatenating incomplete first pages.

Discovery also searches the knowledge that this catalog places outside Markdown:
`statement`, `choice`, `alternatives`, `steps`, `rule`, `takeaway` and
`applicability.description`, when those members belong to the record's declared
contract. This extends R6's keys/title/body search for the direct-property design;
it does not infer a subtype from a similarly named property. A matching result
identifies the property path, including the relevant array position where needed,
and supplies only a bounded excerpt under the same compact-result budget. Multiple
field/key matches still produce one Memory result. No field's full value is an
implicit discovery projection. Arbitrary metadata, unknown extension properties,
provenance and referenced resources are not automatically searched; additional
custom-contract search coverage must be documented truthfully. The shared query
surface owns result encoding, continuation and ordering. Neither an embedding
service nor a full-text index is required by this search contract.

For a specific Procedure-only relationship, a Type selector can now express that
contract without a property-sensitive kind predicate. No additional supplied Link
Type is created without an actual use case. Changing a Type revision is not an
automatic compatibility claim or SemVer upgrade.

Memory requires these shared outcomes, which registration alone does not implement:

- Every durable content/metadata/Inception/owned-state change creates a version;
  semantic no-ops do not. Memory rejects unversioned storage. Guarded stale writes
  fail; accepted unguarded writes disclose their actual predecessor and attribution.
- Deletion removes current state, releases keys, and preserves retained history.
  Local incident Links with latest endpoints are cleaned up per R20; exact pinned
  Links survive while their states are retained. Reports of affected source revisions
  and removed Links follow shared authorization and completeness rules. Do not leak
  hidden identities or claim a Scope-complete enumeration from an authorized subset;
  an operation unable to satisfy the required authorized mutation/reporting contract
  must refuse before mutation. R20/R29 need that shared contract, not truncated success.
  Historical owner sets are never rewritten.
- Restoration creates a new live revision under the same identity, with the new
  operation's provenance. It does not resurrect cleaned-up Links or take keys now
  belonging to another live resource. Proposed V2 terminal history/revert behavior
  remains external design; no new CLI grammar is selected here.
- Erasure and retention removal yield accurate authorized gone reasons, never
  latest fallback. A citation cannot hold required erasure hostage. Scope and
  replica/cache propagation obligations belong to shared History.
- Updating the pin on the same endpoint identity preserves Link identity under
  R23's target contract. Retargeting to another identity is not granted by that
  requirement. Coordinate explicit amendments to existing immutable-pin and
  incident-Link deletion rules; this document does not silently change them.

One shared conflict is still unresolved. An Issue conformer may validly require
at least one outgoing Guidance Link; its sole Link may float to Memory M. R20 says
deleting M removes that Link, and R5 says no Link blocks deletion. Types §5.5 says
the surviving Issue must still meet its minimum at commit. Atomicity alone cannot
make all three outcomes hold. This needs a joint decision about admissible
constraints, explicitly authorized repair, or the deletion guarantee. Do not
silently drop the minimum, cascade-delete/retype the survivor, invent a replacement
Link, or present a rollback as satisfying R5/R20. Until resolved, implementations
cannot claim these requirements are jointly qualified for such a graph. Required
actor context for any cleanup-created Memory revisions is another shared-operation
integration gate; accepted indirect changes must remain attributable.

Aliases are generic names, potentially pinned under the shared draft, not identity
or registration. Key placement, namespace collisions, historical visibility and
restore outcomes remain shared decisions. Creation of a name never implicitly
fetches/registers a Type or chooses a new definition revision. Registry installation
preserves global identity and exact dependency pins without granting publication
authority; a local fork and authorized origin update are different operations.
Registration granularity, unpinned write selection, bootstrap and packaging stay
with Types. Use exact illustrative pins here rather than deciding those defaults.
Historical restoration here does not select the existing `bd restore` command,
which has a pre-compaction recovery meaning. Shared History/product compatibility
must select its surface explicitly rather than silently overloading that command.

## 6. Revision provenance, relationships and Activity

Use [Provenance V2](https://github.com/gastownhall/beads/issues/7510), not a second
Memory-derived-from envelope. V2 adds sources/source completeness to Core's
currently closed revision-provenance envelope; adopting those members requires a
Core amendment. The worked source-bearing excerpts are V2-shaped, not valid under
the current Core envelope. Revision provenance records the containing revision's
writer/context and its claimed input sources. Source absence, known empty list and
declared completeness are distinct. Omitted update sources preserve prior source
knowledge per V2, without claiming a reread. A source/completeness correction makes
a new revision; actor/agent/message-only no-ops do not. A newly minted revision uses
the new write's provenance, never wholesale copied prior actor/time.

On native creation, omitted sources mean unknown, not an empty source list or a
claim that the author asserted the content directly. This includes ordinary
body-only capture under S1. Explicit `[]` remains a deliberate value; omitted
completeness means unknown under V2. Native unknown sources are an explicit R3
refinement requiring alignment of Chris's absent-state description, rather than
new Memory-specific defaults.

R12 is a stronger Memory capability requirement than the optional actor in the
general envelope. An operation minting a new native Memory revision must record
a responsible actor from the accepted service/caller context and the shared commit
timestamp. This includes owned-Link writes and cleanup revisions caused by an
operation on another Bead; the initiating operation's accepted context must reach
those effects. If either actor or commit time cannot be recorded truthfully, refuse before mutation
with a typed attribution failure. Never invent an actor, infer one from an assisting
agent or OS username, or infer authentication from a recorded identity. Use the
selected shared actor encoding and basis vocabulary; this rule does not adopt
V2's proposed authentication basis ahead of the shared contract. An actorless
semantic no-op creates no revision and retains existing provenance. Legacy or
imported historical absence remains unknown; conversion/restoration attributes
the new native operation without fabricating the older writer. The excerpts omit
some common envelope fields; that is not an example of actorless native acceptance.
In particular, current Core excludes an authentication-asserting basis while V2
proposes `authenticated`. That difference requires an explicit shared decision;
recording a required actor here does not resolve it or supply attestation.

Inception is editable origin/transfer state, separate from who wrote this revision
or what information informed it. Import cannot fabricate original authorship or
backdate a native write. No authenticated basis, attestation or truth is inferred
from stored actor/time/source values.

| Mechanism | Question it answers | Effect on the referenced subject |
| --- | --- | --- |
| Revision sources | What does the writer say this revision was based on? | No implicit graph Link or target revision |
| Guidance/Related | Where should someone look? | No proof of use and no body loading |
| Supports/Challenges/Supersedes | What material now offers support, objection or replacement? | Later incoming assertions do not rewrite the target or its original sources |
| Activity | What reportedly happened, involving which work/artifacts? | Independent record; no subject revision merely to report work |

A source may appear in both a Link and provenance when the claims differ; neither
is automatically mirrored. An Activity's artifact is not automatically a source
of its subject or of the Activity record. A subject can be an Issue, Memory, Link
or external work artifact under V2 without making Links valid graph endpoints.
Do not guess Bead revisions from Git SHAs, event time or opaque legacy strings.

The current V2 body accepts well-formed Activity subjects without an existence
lookup, including nonexistent subjects. However, its owner's
[October 13 comment](https://github.com/gastownhall/beads/issues/7510#issuecomment-6149528423)
says proven nonexistent local subjects require an import path and qualifies pruned
ones with retained evidence. Those statements conflict; Memory does not declare
the comment superseded or select an admission rule on V2's behalf. Acceptance of
these cases remains contingent on the V2 owner's reconciliation. Hidden or
unavailable is not proof of never-existence. Activity retention remains independent.
Neither possible rule relaxes R19 graph admission or settles revision-source
admission. The latter also remains a shared design decision: record a contradiction
if a proposed rule would require false existence claims or unavailable external
fetches, rather than designing a new evidence index here.

## 7. Worked field and office examples

The [worked records](../../../fixtures/specs/memory/records.json) are illustrative
final-state excerpts using exact Type pins, not import/creation payloads, package
syntax or permission to assign revisions. Work/inspection Issue endpoints are assumed existing Issue-contract fixtures, not
new Issue definitions or Memory Bead excerpts. Separate schema cases validate property
shape only; the sequences below remain written operation acceptance scenarios.

### 7.1 Field service: recurring pump fault

1. A technician saves “Housing B uses a different seal” as an ordinary Memory note.
   No subtype selection, key or form-specific fields are required.
2. A Procedure Memory defines ordered steps and claimed applicability to housing B.
   An Issue gets Guidance to its identity; the Procedure AppliesTo an asset Bead
   or external asset reference. Discovery is compact and the technician explicitly
   reads the complete procedure. No readiness or operational approval follows.
3. An Observation records an inspection finding in its statement, optional observed time,
   and the actual report/procedure references in revision sources when those were
   inputs. An independent Activity reports the inspection of the Issue, preserving
   the procedure edition recorded as used and the report artifact under V2.
4. Another Observation Challenges Procedure@procedure-r1 for a different housing. It does
   not alter the old procedure or original inspection report. The author corrects
   the Procedure through a new revision with deliberate new source information.
5. The completed job's exact reference still identifies procedure-r1; current guidance may
   follow the new procedure. Retention can yield accurate gone, never substitution.
   A disagreement in observations is kept with its stated context, not resolved by age.

### 7.2 Office work: supplier decision

1. A Policy records a supplier-selection rule; it confers no purchasing authority. A supplier
   assessment is an Observation with its own sources and stated context.
2. A Decision records choice, optional alternatives and body reasons, citing exact
   policy/assessment revisions where those were the writer's inputs. The work Issue
   can use Guidance to discover this knowledge; it retains its own workflow.
3. The assessment Supports the exact decision revision. A later finding Challenges
   that revision without claiming the finding was known to its original author.
4. A spelling correction is another revision of the same Decision. A deliberately
   different choice may be a new Decision that Supersedes the old exact revision.
   Two proposed replacements coexist; no winner or deletion is automatic.
5. An Activity records a contract landing with a PR/document artifact. Its reporter,
   participant, occurrence time and revision writer remain distinct under V2. It
   is not a new source entry silently appended to the old Decision.

The literal excerpts include all six Link Types, an opaque asset reference, a
cross-Scope asset Bead, a replacement Decision and references in both directions
across a Scope boundary. External roles are expected roles, not verified Types.
The Activity steps above remain V2 operation scenarios rather than invented
Activity payloads.

A consolidation consumer may compare, recall, revise one Memory and forget others
while preserving exact citations/history and recording its own inputs. It must not
infer equivalence from keys or similar bodies, or advertise concatenation as truth
resolution. This Type specification implements no scheduler, summarizer or policy.

## 8. Traceability to Chris's requirements and scenarios

“Type” denotes data/semantic contract; “shared” denotes a required protocol or
operation; “product” denotes Beads surface/conversion behavior. These are assignments
of requirements, not evidence of complete current implementation or a release plan.

| Requirement | Type data, shared operation, product obligation or explicit gap |
| --- | --- |
| R1 | First-class product knowledge via exact Memory affiliation/conformance, replacing the literal `type: memory` test; closure-aware workflow refusal and peer graph operations need product/shared query enforcement |
| R2 | Canonical identity, title and optional aliases; key placement/version/restore unresolved |
| R3 | Body/metadata/Inception and V2 sources; known properties are an explicit proposed refinement, not unchanged conformance |
| R4 | Minimal title/body contract; deliberate write-only authoring, defaults and visible identity result are product work |
| R5 | Shared disappearance/restore/erasure, alias release and incident-Link cleanup; explicit lifecycle amendment |
| R6 | Contract matching and known direct-content field search; compact deterministic discovery, property-path match information, exact addresses and bound cursors are query/product obligations |
| R7 | Complete selected record/provenance/owned state and keys/aliases; full structured-knowledge rendering and empty-versus-absent handling |
| R8 | Selective retrieval and actual supported guidance commands/budget disclosure; no recursive body injection |
| R9 | Link ID/Type/target and separate expected/observed target information; shared observation encoding dependency |
| R10 | Exact attributable building blocks and truthful bounds; context budgets/receipts remain consumer-owned |
| R11 | Versioned durable/metadata/owned state, no-op detection and refusal of unversioned Memory |
| R12 | Common revisionProvenance encoding; new native Memory revisions require responsible actor/time, including indirect writes, beyond the general optional-actor envelope; Inception remains distinct writable state |
| R13 | Shared history/compare/exact reads/restore/change queries and removal reasons; not supplied by schemas |
| R14 | Shared guards/retries/conflicts/finite limits and actual-predecessor disclosure |
| R15 | Claiming Memory support requires the consumed History capability; registration is insufficient |
| R16 | Accurate retention/erasure/gone outcomes and immutable addresses; no current fallback |
| R17 | Registered informational vocabulary/custom conformers, preserved unknown IDs and non-workflow endpoints; existing `related` identity/selector compatibility remains an explicit shared/product gate |
| R18 | Shared latest/exact references; exact local graph endpoint admission requires retained state |
| R19 | Local expected-contract and self-Link admission checks, opaque external references and accurate observations; revalidation/encoding dependencies |
| R20 | Floating cleanup, exact survivors and affected-source disclosure; shared amendment must resolve surviving participation minimums and attributable indirect revisions |
| R21 | Informational semantics and body-free nonrecursive traversal; no authority or execution |
| R22 | Wildcard outgoing ownership and exact historical sets; bounded computed incoming views |
| R23 | Link-ID update/removal and identity-preserving re-pin; explicit shared operation amendment |
| R24 | Truthful legacy conversion including empty body and unknown origin/sources; no identity from generated keys |
| R25 | Canonical command projections, one record per Memory and empty presence; explicit compatibility cutover |
| R26 | One model across supported surfaces; incapable writers refuse before mutation |
| R27 | Shared atomic connected interchange preserving identities/pins/meaning; packaging/import remains separate |
| R27a | Enumerate excluded/summary/explicit-body postures; automatic export excludes Memories, whole-store backup distinct |
| R28 | Provider-independent current/history/Link/provenance state with accurate bounds |
| R29 | Shared authorization/deployment/governance; no Memory-specific role or topology semantics |
| R30 | Preserve claims/evidence, leave truth/quality/applicability judgments with humans and consumers |
| R31 | Product must extend the original table for specialized creation, guarded retyping, Type-aware search and `related` compatibility, with explicit rationale; no new CLI grammar here |

| Scenario | Observable realization and dependency |
| --- | --- |
| S1 | Ordinary Memory from body/title without taxonomy/key; authoring derives title and History records provenance |
| S2 | Compact search includes declared knowledge properties, then exact recall/update; external tools judge duplication |
| S3 | Delete current knowledge, retain exact history, restore identity without resurrecting Links; shared lifecycle |
| S4 | Guidance/search returns summaries; explicit complete recall and exact references |
| S5 | Issue Guidance to policy/other Memory contract; target body remains separate |
| S6 | Exact sources/content/provenance for a consumer-owned context pack; no core budget/receipt policy |
| S7 | Shared stale guards/retained writes and unguarded predecessor disclosure |
| S8 | Directional informational relationships and Link-ID removal; no readiness effects |
| S9 | Floating local cleanup versus retained exact citation; external observations remain separate |
| S10 | Exact source/owned state and target pins never drift; bounded incoming completeness |
| S11 | Preserve legacy keys/empty bodies/known origins; disclose missing authorship and atomic conversion state |
| S12 | Existing commands adapt to one canonical model and explicit output compatibility choices |
| S13 | Atomic connected transfer preserves Type/identity/pins or fails without partial graph |
| S14 | Public current/history/comparison/Link/provenance records support independent viewers/quality tools |
| S15 | Claimed applicability changes only through writes; clock transitions cause no lifecycle change; properties refinement explicit |
| S16 | Ordinary shared History positions/removal reasons support consumer-owned synchronization |

Summary views expose no complete bodies or metadata values. Body-carrying list or
export exceptions require R25/R27a's explicit contract and labeling; automatic
export creates no Memory rows. Installing Types does not enumerate or fix those
projection surfaces. Janet/Donna's exact-source gap audit remains the release
evidence; this traceability table does not duplicate its as-built verdicts.

Moving knowledge into direct properties does not create a summary-output escape.
Statements, choices, alternatives, steps, rules, takeaways, Inception and
applicability values are omitted from summary views except for an explicitly
bounded excerpt governed by the same discovery budget. Summaries carry only the
declared compact identity, title, keys, exact address, attribution, match and
completeness information; an exact Type affiliation may identify the contract
without expanding its knowledge fields. Returning complete knowledge properties
is subject to the same explicit body-carrying posture and disclosure as returning
the complete Markdown body, even if that body is empty. Generated guidance, Link
summaries and ordinary discovery must not invoke a bulk compatibility projection
to bypass that boundary. This extends R27a's exposure rule to the direct-property
refinement of R3.

## 9. Positive and negative acceptance cases

The [schema cases](../../../fixtures/specs/memory/schema-cases.json) and
[offline checker](../../../scripts/check_memory_examples.py) exercise artifact shapes
and the explicitly listed finite definition examples. The evidence column below
distinguishes checked property shapes from written operation requirements. No
case here executes History, transactions, remote resolution, graph runtime, CLI
or full semantic conformance. Literal records are illustrative fixtures. Run the
Memory checker from the repository root with
`uv run --no-project --with 'jsonschema[format]' python scripts/check_memory_examples.py`.
The shared schemas README/checker describes its separate foundational artifacts;
this Memory section documents the additional domain artifacts and invocation.

| Case | Required outcome | Evidence here |
| --- | --- | --- |
| Plain Memory with title and empty body | Valid final properties; complete recall is found, not absent | Property shape checked; recall written |
| Ordinary body-only authoring | Derive title before final-state validation; never infer a subtype or key | Written requirement |
| Specialized creation supplies exact Procedure Type and complete steps | Create one valid inherited instance atomically; no intermediate plain-note revision is required | Written requirement |
| Legacy key has an empty value | Preserve key and empty body, derive the nonblank title from that key, and never use the key as identity | Written requirement |
| Former kind/details authoring route | No discriminator dispatch; reject kind input under the new domain schema and require an explicit compatibility/migration path | Kind rejection checked; migration written |
| Observation without statement; Decision without choice; Procedure without steps; Policy without rule; Lesson without takeaway | Reject the complete specialized instance | Property shape checked |
| Procedure steps empty or containing blank text | Reject; order of valid steps is preserved | Property shape checked; ordering written |
| Observation time omitted | Unknown; do not substitute revision commit time | Property shape checked; semantics written |
| Search term appears only in Policy.rule or Procedure.steps | Return the matching Memory once with property-path match provenance and a bounded excerpt, without the full rule/steps payload | Written requirement |
| Invalid applicability instant or from >= until | Reject at domain admission; clock crossing alone is no write | Instant format checked; ordering/clock written |
| Custom Type conforms to exact Memory and adds a required field | Apply both contracts and preserve shared meaning/owned state | Written requirement |
| Custom Type has same shape but claims Memory participates in readiness | Not valid semantic conformance | Written requirement |
| Parent Memory reader replaces specialized properties but omits a mandatory field | Reject atomically; full replacement is not merge | Written requirement |
| Prospective schema check succeeds for an unrelated Type | No conformance declaration is created | Written requirement |
| Exact versus identity-wide Type selectors after a definition revision | Exact matches only that affiliation/closure; identity-wide matches across revisions without latest resolution | Written requirement |
| New definition or alias target is installed/repointed | Existing instance and historical conformance pins do not move | Written requirement |
| Generic note explicitly becomes Procedure with valid steps | Preserve identity and old note revision; validate resulting properties and affected graph | Written requirement |
| Explicit retyping uses a stale guard or invalid properties | Reject without partial property/ownership/Link effects | Written requirement |
| Floating local endpoint becomes incompatible after retyping | Use the resolved shared rejection/repair contract; do not silently admit invalid state or invent a migration | Written requirement |
| Endpoint pinned before target Type/content changes | Evaluate retained historical state; never new current Type | Written requirement |
| Task/custom Issue conformer uses Guidance to a Memory conformer | Accept if exact required contracts and all domain checks hold | Written requirement |
| Endpoints match different arms but no one permitted pair | Reject; independent OR flattening is incorrect | Written requirement |
| Memory Related joins two local Issues without a Memory endpoint | Reject its endpoint mismatch; existing Issue-related meaning and ownership remain with that separate contract | Written requirement |
| Existing `--type related` selector is used with a Memory | Use only an explicitly selected shared/product compatibility contract; this new identity alone does not establish that mapping | Written requirement; compatibility gate open |
| A custom workflow-dependent Link passes its shape/endpoint checks at a local Memory | Reject before mutation; wildcard ownership/eligibility does not waive the Memory non-workflow contract | Written requirement |
| Supports source is a local Issue rather than Memory/conformer | Reject endpoint mismatch | Written requirement |
| Required citation target is floating | Reject; do not silently pin current state | Written requirement |
| External target claims a Memory role | Preserve reference/expectation, perform no remote Type verification or import | Written requirement |
| External target is unreachable | Accurate unavailable observation, not invented gone/type/approval | Written requirement |
| Self-Link uses two revision pins of one identity | Reject under the domain self-Link rule | Written requirement |
| Parallel Links have independent IDs | Allowed absent an independently applicable constraint | Written requirement |
| Outgoing custom informational Link changes | Version the local Memory source atomically; target unchanged | Written requirement |
| Incoming late Support/Challenge is recorded | Target revision and original provenance stay unchanged | Written requirement |
| Historical owner is read after Links/definitions change | Retain its exact recorded owned-Link set and Type closure | Written requirement |
| Link source is outside the storing Scope | No fictitious remote owner revision is reported | Written requirement |
| Another Type pin/subtype/endpoint arm is used under a finite bound | Same relevant identity/family population, no fresh allowance | Written requirement |
| Atomic replacement temporarily violates an applicable bound | Final-state validation may permit it; guard/auth checks still apply | Written requirement |
| Specialized relationship adopts acyclicity alongside old cyclic Links | Preserve Types' per-Link promise and complete family traversal, not whole-family DAG shorthand | Written requirement |
| Two measurements or replacement decisions conflict | Keep both conditions/claims; no automatic truth, exclusivity or winner | Written requirement |
| Source/completeness alone changes versus actor/message-only no-op | First creates revision; second does not fabricate provenance/time | Written requirement |
| Native body-only creation omits sources | Preserve unknown sources/completeness; do not manufacture an explicit empty direct-assertion list | Written requirement; R3 refinement |
| A native Memory revision would be minted without a responsible actor or commit time | Refuse before mutation; do not synthesize an actor or infer authentication; an actorless semantic no-op still preserves the existing revision | Written requirement |
| A generic deletion causes an owned-Link cleanup revision of a Memory | Propagate accepted operation attribution to the new Memory revision; source history remains unchanged | Written requirement; shared integration gate |
| Unknown sources versus explicit empty sources round-trip | Preserve distinction, completeness and original historical values | Written requirement |
| Activity reports a nonexistent/pruned local subject | Body and owner-comment admission rules conflict; acceptance is contingent on V2 reconciliation, never a Memory-specific lookup policy | Written conflict case; unresolved |
| Activity corrects an old inspection/contract report | New Activity revision; subject and original decision sources unchanged | Written requirement |
| A new local graph citation borrows Activity's permissive subject rule | Reject invalid graph admission; revision-source admission remains separately specified | Written requirement |
| Delete subject with floating Links, exact Links and Activity reports | Apply the three separate selected contracts; enumerate affected sources/Links accurately | Written requirement |
| Deletion would expose hidden source/Link identities in its result | Apply shared authorization and truthful view bounds; never leak hidden identities or claim a partial enumeration is Scope-complete | Written requirement; shared contract |
| A Memory owns a Link whose local endpoint is hidden from the reader's view | Apply current Core view closure; hide the Memory rather than return an incomplete owned snapshot as complete | Written requirement |
| Deleting Memory M would remove a surviving Issue's sole required Guidance Link | Current Type minimum and R5/R20 cleanup guarantees conflict; require a shared decision before claiming this graph is qualified, with no silent invariant waiver or survivor cascade | Written conflict case; unresolved |
| Restore knowledge under a retained identity | New operation provenance; no revived cleaned-up Links or stolen alias | Written requirement |
| Full human record omits Procedure steps but calls itself complete | Invalid completeness claim even when body is rendered whole | Written requirement |
| Summary/automatic export includes full body or metadata values | Violates the specified projection posture | Written requirement |
| Procedure summary omits body but includes its complete steps, or Decision summary includes complete choice/alternatives | Reject the summary claim; complete structured knowledge requires an explicitly selected body-carrying contract | Written requirement |
| Consolidation joins conflicting bodies | No automatic equivalence/truth claim or demonstrated retrieval benefit follows | Written requirement |
| Core Reference in origin/authority: URI, opaque URN or exact URI/revision object | Accept valid Type property shapes; reject incomplete objects, extra members, relative URI and a V2 source-entry wrapper; no Core reference admission or graph semantics | Property shape checked |
| Unknown inception/applicability member versus an unknown root property | Reject the closed nested member; allow the root extension subject to applicable schemas | Property shape checked |
| Inception is absent versus explicitly unknown | Preserve recorded presence; both leave origin knowledge unknown, but reads do not synthesize or normalize one into the other | Unknown-object shape checked; read/write semantics written |
| Issue or Memory definition advances without exact required conformance | Reject the old Link contract match; use justified conformance or a revised Link definition | Written requirement |
| Outgoing Link cites a historical source revision | Preserve that historical owner set; new mutation uses the source identity under the applicable current contract and shared ownership rules | Written requirement |

## 10. Readiness and decisions

“Designed” means specified for review. “NYI here” means not implemented or qualified
by this contribution, not proof every underlying facility is absent.

| Area | Design status | Implementation/evidence status |
| --- | --- | --- |
| Distinct Types; no kind fields | Donna ruling applied; plain Memory plus five candidate specializations | New catalog/runtime adoption NYI here |
| Property schemas and literal records | Review artifacts with exact illustrative pins and inherited validation | Offline artifact checks only; not runtime admission |
| Ownership descriptors, endpoint pairs and compact views | Consumes candidate Types syntax; current Core mandatory bounds, ownership syntax and view contracts differ | Shared semantic adoption required; not current-Core-installable artifacts |
| Conformance-aware matching/paired endpoints | Uses shared Types; no new Type system | Shared runtime/closure/query support not qualified here |
| Required citation pins, self-Link exclusion and expected remote roles | Domain semantics explicit; generic pin/irreflexivity syntax not invented | Domain admission and observation dependencies beyond generic descriptors |
| Owned state, lifecycle and re-pinning | Required observable outcomes stated | Core/History/Write amendments and product qualification required |
| Revision sources and Activity | Uses V2, with actor-basis and body/comment Activity-admission conflicts named | Core envelope amendment and owner reconciliation required; V2-shaped excerpts are not current-Core-valid |
| Capture/recall/search/consolidation/exposure | Includes direct-property search and bounded exposure; `related` compatibility decision open | No Memory runtime or CLI implementation in this change |
| Responsible actor and indirect writes | R12 tightens optional shared attribution for new native Memory revisions; no-op and legacy distinctions explicit | Admission and cross-operation attribution not qualified here |
| Deletion and surviving participation minimums | Concrete R5/R20 versus Types §5.5 conflict identified | Unresolved shared decision; escalation is not conformance evidence |
| Pre-installation, aliases, retention and transfer | Uses shared identity/authority boundary | Bootstrap, registration granularity, installed-scope handling and packaging remain shared work |
| Preview 3 | No cutline or protocol stability claim | Exact release integration/qualification remains Janet/Donna's work |

No Beads runtime behavior is newly verified here. If implementation evidence is
added, inspect and cite final `graph-preview2` peeled commit
`703bb13e91aa2cab2092443319139006d74242c8`; do not relabel older authoring-draft
observations or a passing JSON example as current runtime qualification.

Remaining decisions are explicit:

1. Review the six-Bead/six-Link candidate catalog and detailed fields, including
   R3's properties refinement and closure costs under the fixed no-kind ruling,
   applicability, full human rendering and the cost of exact endpoint Type pins.
   Identity-wide Issue matching is an explicit alternative for review.
2. Coordinate source and self-Link admission, local floating revalidation, deletion cleanup,
   identity-preserving re-pins and old/new owned-state effects with shared owners.
   Resolve the surviving-minimum deletion conflict and propagate actor context to
   indirect Memory revisions before qualifying those operations.
3. Resolve R9/R19's expected/observed external-role encoding without remote Type
   validation, and retain Types' installed-definition/Scope boundary as open.
4. Follow shared choices for production identities/seed allocation, registration,
   unpinned write selection, aliases, schema admission/closure and retention/package
   mechanics. No Memory-specific substitute is introduced.
5. Review title derivation and any finite owned-Link limit against real authoring
   sizes; reconcile Core's required bound and complete-owned-state reads before
   adoption. Do not silently retain 1024 as an established limit or omit Core's max.
6. Select the existing `related` compatibility contract with shared/product owners,
   and align Chris's proposal with native unknown sources, stronger actor admission
   and direct-property discovery/exposure. These are not automatic ID substitutions.
7. Resolve V2's Activity-admission body/comment conflict and actor-basis difference
   from Core with its owner; Memory does not adjudicate those shared meanings.

This contribution changes only the Memory specification and its owned review
artifacts. Applicable checks and independent Codex plus Claude review precede PR
readiness. A WIP design landing is separate from protocol/product acceptance;
shared-contract amendments and product qualification remain separately scoped work.
