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

The shared [Types design](../../profiles/types/types.md) owns definition representation, exact
affiliation, conformance, schema composition and graph-constraint matching. It is
an optional Scope-wide profile depending on Core, not Write. This domain uses
Types and Core; its write obligations apply where writes are supported. The
[existing protocol](../../profiles/core/core.md) remains authoritative until separately
amended. Publishing design on main does not adopt candidate wire forms.

**Shared design baseline:** public BDP main at
[`aed21767e1ade54bef6dad108c4f24b8e9cd844b`](https://github.com/gastownhall/bdp/commit/aed21767e1ade54bef6dad108c4f24b8e9cd844b),
after PR142 landed. Its Types file, including open decisions/readiness, was read in
full before this isolated domain branch was populated. Existing protocol source
was checked at `9df574a9ac980272fa31be9f443a771233b69c6a`; its relevant envelope,
History and deletion rules remain unchanged in this base. This is a source read,
not fresh implementation qualification.

Sources reviewed October 15, 2026:

| Source | Reviewed identity and effect |
| --- | --- |
| [Memory #5877](https://github.com/gastownhall/beads/issues/5877) | Current body remains Revision 4, September 22; issue updated October 9. Covers R1–R31/R27a and S1–S16. |
| [Revision 4 response](https://github.com/gastownhall/beads/issues/5877#issuecomment-5787432078) | Registration, aliases, duplicate Links, ownership, deletion and shared-operation gaps; its fixed-Link-Type sentence is superseded here by the newer explicit-retyping design. |
| [Applicability and relationship conventions](https://github.com/gastownhall/beads/issues/5877#issuecomment-5963448303) | Preserve circumstances and meaningful relationships without imposing a universal claim engine. |
| [Consolidation follow-up](https://github.com/gastownhall/beads/issues/5877#issuecomment-6009424090), [experiment](https://github.com/gastownhall/beads/issues/5877#issuecomment-6028640616) | Consolidation is external consumer work; merging records is not adjudication or proven retrieval improvement. |
| [Provenance V2 #7510](https://github.com/gastownhall/beads/issues/7510) | Current body updated October 14 and all six comments reviewed. Revision sources and Activity remain distinct; current Activity admission supersedes older existence-check suggestions. |
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

Creation receives a nonblank title or body. With body but no title, authoring
derives a title before storage. The earlier first-nonblank-line/80-code-point rule
remains a reviewable authoring candidate, not an established implementation fact.
An explicit title permits empty body; omitted body on create becomes empty. Empty
content is a found Memory, not absence. Updates preserve omitted values. Body
headings/frontmatter never create properties or Links or synthesize a classification.

Native creation may default Inception to native; conversion/import records only
known origin. Absent legacy Inception is unknown, not inferred native. Inception
changes are durable state changes, distinct from revision attribution.

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
shape**: a URI or `{uri, revision}`. Under [Core's Reference rule](../../profiles/core/core.md#references),
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

### 4.1 Allowed pairs and external expectations

L denotes any in-Scope Bead. M and I denote in-Scope Beads satisfying exact selected
Memory and Issue contracts, including their transitive conformers. E denotes an
opaque cross-Scope Bead reference with wildcard Type admission; X an opaque external
resource reference. `E(Memory)`/`E(Issue)` below describe the relation's expected role,
not a typed external constraint or a claim of verified membership.

| Link | Source → target alternatives | Target reference and meaning |
| --- | --- | --- |
| Related | L→L; L→E; E→L; L→X; X→L | Floating or exact; navigation only |
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
Related deliberately also permits Issue→Issue; that breadth does not reinterpret
existing Dependency related or supersedes records.

The local M/I arms deliberately pin `memory-contract-1` and the shared foundation's
`issue-1` in this conservative candidate. They rely on those exact semantic contracts,
not merely familiar names. An Issue@issue-2 or Memory@memory-contract-2 without
conformance to the selected revision does not match. This couples the Link catalog
to those contracts: accepting a changed base requires justified conformance back
to the selected contract or explicit new Link-definition revisions. Identity-wide
Issue selection is a review alternative if no exact Issue promise is needed; it is
not silently substituted here. Stored Link affiliations never upgrade automatically.

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
  Links survive while their states are retained. Affected source revisions and
  removed Links are disclosed. Historical owner sets are never rewritten.
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

Aliases are generic names, potentially pinned under the shared draft, not identity
or registration. Key placement, namespace collisions, historical visibility and
restore outcomes remain shared decisions. Creation of a name never implicitly
fetches/registers a Type or chooses a new definition revision. Registry installation
preserves global identity and exact dependency pins without granting publication
authority; a local fork and authorized origin update are different operations.
Registration granularity, unpinned write selection, bootstrap and packaging stay
with Types. Use exact illustrative pins here rather than deciding those defaults.

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

The current V2 base proposal accepts well-formed Activity subjects without an
existence lookup, including hidden, nonexistent, deleted or pruned subjects;
stricter policy must be declared. Activity retention after subject deletion is
independent. This does not relax R19 graph admission or settle revision-source
admission. The latter remains a shared design decision: record the contradiction
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
| R1 | Memory/conformer knowledge contract; workflow dispatch/typed refusal and peer graph operations are product enforcement |
| R2 | Canonical identity, title and optional aliases; key placement/version/restore unresolved |
| R3 | Body/metadata/Inception and V2 sources; known properties are an explicit proposed refinement, not unchanged conformance |
| R4 | Minimal title/body contract; deliberate write-only authoring, defaults and visible identity result are product work |
| R5 | Shared disappearance/restore/erasure, alias release and incident-Link cleanup; explicit lifecycle amendment |
| R6 | Memory contract matching; compact deterministic discovery, exact addresses and bound cursors are query/product obligations |
| R7 | Complete selected record/provenance/owned state and keys/aliases; full structured-knowledge rendering and empty-versus-absent handling |
| R8 | Selective retrieval and actual supported guidance commands/budget disclosure; no recursive body injection |
| R9 | Link ID/Type/target and separate expected/observed target information; shared observation encoding dependency |
| R10 | Exact attributable building blocks and truthful bounds; context budgets/receipts remain consumer-owned |
| R11 | Versioned durable/metadata/owned state, no-op detection and refusal of unversioned Memory |
| R12 | Common revisionProvenance actor/time/agent/message; Inception remains distinct writable state |
| R13 | Shared history/compare/exact reads/restore/change queries and removal reasons; not supplied by schemas |
| R14 | Shared guards/retries/conflicts/finite limits and actual-predecessor disclosure |
| R15 | Claiming Memory support requires the consumed History capability; registration is insufficient |
| R16 | Accurate retention/erasure/gone outcomes and immutable addresses; no current fallback |
| R17 | Registered open informational vocabulary/custom conformers, preserved unknown IDs and non-workflow Memory endpoints |
| R18 | Shared latest/exact references; exact local graph endpoint admission requires retained state |
| R19 | Local expected-contract and self-Link admission checks, opaque external references and accurate observations; revalidation/encoding dependencies |
| R20 | Floating local incident cleanup, exact survivors and affected-source disclosure; shared graph amendment |
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
| R31 | Product documents each selected command/input/output change and its compatibility rationale; no new CLI grammar here |

| Scenario | Observable realization and dependency |
| --- | --- |
| S1 | Ordinary Memory from body/title without taxonomy/key; authoring derives title and History records provenance |
| S2 | Compact search then exact recall/update; external tools judge duplication |
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
| Former kind/details authoring route | No discriminator dispatch; reject kind input under the new domain schema and require an explicit compatibility/migration path | Kind rejection checked; migration written |
| Observation without statement; Decision without choice; Procedure without steps; Policy without rule; Lesson without takeaway | Reject the complete specialized instance | Property shape checked |
| Procedure steps empty or containing blank text | Reject; order of valid steps is preserved | Property shape checked; ordering written |
| Observation time omitted | Unknown; do not substitute revision commit time | Property shape checked; semantics written |
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
| Related joins two Issues | Informational only; do not reinterpret a Dependency record | Written requirement |
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
| Unknown sources versus explicit empty sources round-trip | Preserve distinction, completeness and original historical values | Written requirement |
| Activity reports nonexistent/pruned/hidden subject under V2's base policy | Well-formed authorized report may be accepted without subject lookup; no access or verification claim | Written requirement |
| Activity corrects an old inspection/contract report | New Activity revision; subject and original decision sources unchanged | Written requirement |
| A new local graph citation borrows Activity's permissive subject rule | Reject invalid graph admission; revision-source admission remains separately specified | Written requirement |
| Delete subject with floating Links, exact Links and Activity reports | Apply the three separate selected contracts; enumerate affected sources/Links accurately | Written requirement |
| Restore knowledge under a retained identity | New operation provenance; no revived cleaned-up Links or stolen alias | Written requirement |
| Full human record omits Procedure steps but calls itself complete | Invalid completeness claim even when body is rendered whole | Written requirement |
| Summary/automatic export includes full body or metadata values | Violates the specified projection posture | Written requirement |
| Consolidation joins conflicting bodies | No automatic equivalence/truth claim or demonstrated retrieval benefit follows | Written requirement |
| Core Reference in origin/authority: URI, opaque URN or exact URI/revision object | Accept valid Type property shapes; reject incomplete objects, extra members, relative URI and a V2 source-entry wrapper; no Core reference admission or graph semantics | Property shape checked |
| Unknown inception/applicability member versus an unknown root property | Reject the closed nested member; allow the root extension subject to applicable schemas | Property shape checked |
| Issue or Memory definition advances without exact required conformance | Reject the old Link contract match; use justified conformance or a revised Link definition | Written requirement |
| Outgoing Link cites a historical source revision | Preserve that historical owner set; new mutation uses the source identity under the applicable current contract and shared ownership rules | Written requirement |

## 10. Readiness and decisions

“Designed” means specified for review. “NYI here” means not implemented or qualified
by this contribution, not proof every underlying facility is absent.

| Area | Design status | Implementation/evidence status |
| --- | --- | --- |
| Distinct Types; no kind fields | Donna ruling applied; plain Memory plus five candidate specializations | New catalog/runtime adoption NYI here |
| Property schemas and literal records | Review artifacts with exact illustrative pins and inherited validation | Offline artifact checks only; not runtime admission |
| Conformance-aware matching/paired endpoints | Uses shared Types; no new Type system | Shared runtime/closure/query support not qualified here |
| Required citation pins, self-Link exclusion and expected remote roles | Domain semantics explicit; generic pin/irreflexivity syntax not invented | Domain admission and observation dependencies beyond generic descriptors |
| Owned state, lifecycle and re-pinning | Required observable outcomes stated | Core/History/Write amendments and product qualification required |
| Revision sources and Activity | Composes with current V2; no competing envelope | Core envelope amendment required; V2-shaped excerpts are not current-Core-valid; no complete delivery claim |
| Capture/recall/search/consolidation/exposure | Product/consumer boundaries and compatibility obligations mapped | No Memory runtime or CLI implementation in this change |
| Pre-installation, aliases, retention and transfer | Uses shared identity/authority boundary | Bootstrap, registration granularity, installed-scope handling and packaging remain shared work |
| Preview 3 | No cutline or protocol stability claim | Exact release integration/qualification remains Janet/Donna's work |

No Beads runtime behavior is newly verified here. If implementation evidence is
added, inspect and cite final `graph-preview2` peeled commit
`703bb13e91aa2cab2092443319139006d74242c8`; do not relabel older authoring-draft
observations or a passing JSON example as current runtime qualification.

Remaining decisions are small and explicit:

1. Review the six-Bead/six-Link candidate catalog and detailed fields, including
   R3's properties refinement, closed nested objects, inherited kind prohibition,
   applicability, full human rendering and the cost of exact endpoint Type pins.
   Identity-wide Issue matching is an explicit alternative for review.
2. Coordinate source and self-Link admission, local floating revalidation, deletion cleanup,
   identity-preserving re-pins and old/new owned-state effects with shared owners.
3. Resolve R9/R19's expected/observed external-role encoding without remote Type
   validation, and retain Types' installed-definition/Scope boundary as open.
4. Follow shared choices for production identities/seed allocation, registration,
   unpinned write selection, aliases, schema admission/closure and retention/package
   mechanics. No Memory-specific substitute is introduced.
5. Review title derivation and any finite owned-Link limit against real authoring
   sizes; do not silently retain the old proposed 1024 as an established limit.

This contribution changes only the Memory specification and its owned review
artifacts. Applicable checks and independent Codex plus Claude review precede PR
readiness. A WIP design landing is separate from protocol/product acceptance;
shared-contract amendments and product qualification remain separately scoped work.
