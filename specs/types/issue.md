# Issue and Dependency Types

Draft for review, October 13, 2026. **Issue is one Bead Type; Dependency is one
Link Type.** Their subordinate discriminators remain `issue_type` and `dep_type`.
This draft carries existing product semantics forward and exposes the work needed
to express them as versioned BDP Types. It does not rename task, bug, blocks,
parent-child or any other established classification.

The companion [Memory proposal](memory.md) develops new vocabulary. This document
uses existing work tracking as a second test of the forthcoming Type Bead design.
Neither draft adopts a new general constraint language or grants implementation
approval.

## 1. Status and sources

There are three distinct evidence levels. **Existing** means inspected ordinary
Beads behavior; **Pending preview** means code in the unmerged consolidation PR;
**Proposed** means the shared BDP representation or rule recommended here. A source
observation is not an installed-runtime test or release qualification.

| Source | Exact source inspected | What it establishes |
| --- | --- | --- |
| Ordinary Beads | [main at e6a891b](https://github.com/gastownhall/beads/tree/e6a891b9008cabf87a1133edb90829380116cfe9) | Current Issue fields, validators and native Dependency behavior; not a claim about every shipped release |
| Pending Type consolidation | [donnabox/beads PR #97](https://github.com/donnabox/beads/pull/97), [head acf49fc](https://github.com/donnabox/beads/tree/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16) | One Issue Type and one Dependency Type, dep_type property, native writer adapters; PR was open and unqualified for staging when checked |
| BDP | [main at 627b560](https://github.com/gastownhall/bdp/blob/627b560c0daf1a76b292615718c86670255ac9af/docs/specs/bdp.md) | Current canonical protocol; proposed flat Types, OR constraints and nominal Type updates still require amendments |
| Shared design | [Type lifecycle](../../docs/design/type-lifecycle-preview2.md), [Provenance V2](https://github.com/gastownhall/beads/issues/7510) | Proposed Type definitions and revision/activity provenance; not implemented by this draft |

Primary implementation references used below:

- [Native Issue/Dependency structures and validation](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/internal/types/types.go).
- [Public Dependency contract](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/issueops/dependencyeditor.go) and [native mutation implementation](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/internal/storage/issueops/dependencies.go).
- [Ready selection](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/internal/storage/sqlbuild/ready.go) and [blocked-state evaluation](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/internal/storage/issueops/blocked_state.go).
- [Pending installed descriptors](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/storage/graphstore/schema.go), [Issue adapter](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/storage/graphstore/issues.go), and [Dependency adapter](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/storage/graphstore/dependencies.go).
- [Issue update adapter](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/storage/graphstore/issue_update.go), [field representation checks](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/storage/graphstore/issue_field_representation.go), and [BDP Read projection](https://github.com/donnabox/beads/blob/acf49fc5bb418acabcbfe0c1a8009c2e98fcda16/internal/httpapi/graphread/reader.go).

BDP owns shared meanings, validation outcomes and versioning. Beads owns storage,
indexes, native writer integration, CLI defaults and operator workflows. SQL tables,
Go structs and helper names are evidence of current behavior, not the portable Type
contract. Where this draft identifies a mismatch, it records a decision rather
than silently changing the existing product.

## 2. Identity and classification

| Concept | Shared model | Existing/pending representation |
| --- | --- | --- |
| Issue | One nominal Bead Type | Preview ID is Scope URL + types/preview-issue |
| Issue classification | properties.issue_type | Native Issue.issue_type; task, bug and other values are not BDP Type identities |
| Dependency | One nominal Link Type | PR97 ID is Scope URL + types/preview-dependency |
| Dependency classification | properties.dep_type | Native dependencies.type; blocks and parent-child are values, not separate nominal Types |
| Issue identity | Common canonical Bead ID | Native Issue ID also survives as properties.id in the inspected projection |
| Dependency identity | Common canonical Link ID | Preview allocates it independently; native pair-derived row ID is its backing key |
| Definition version | Exact pin on intrinsic type reference, proposed | Preview currently has fixed installed descriptors and unpinned Type URLs |

`Issue` and `Dependency` below abbreviate exact nominal Type identities, not URL
prefixes or conformance families. Examples use publisher placeholders
`https://example.org/beads-types/issue` and `/dependency`; production identities,
installation names and migration from Scope-local preview IDs remain unselected.
Do not publish a preview path as the permanent global identity by accident.

The proposed Type model pins a definition on each saved Resource revision. An
explicit Type update may select a new definition or another nominal Type, subject
to shared validation and migration rules. Omission preserves the exact affiliation.
This draft does not grant arbitrary conversion out of the specialized Issue or
Dependency adapter. That requires the shared migration design in §7.

Changing issue_type or dep_type is conceptually distinct from changing nominal
Type. Existing Issue classification remains configurable. A decision Issue is
still a work record; it does not become a decision Memory or inherit Memory fields.
Dependency(kind=related) remains distinct from a generic informational Related
Link or the proposed MemoryRelated Type.

## 3. Issue data and validation

### 3.1 Content and ordinary work fields

Preserve existing names and meanings. The target Type must describe durable Issue
state; a particular command may expose only a subset of writes. A schema-valid
record does not by itself authorize bypassing native lifecycle operations.

| Field in properties | Meaning and observed rule |
| --- | --- |
| id | Native Issue identifier retained by the current graph projection; distinct from the common canonical URI |
| title | Required nonempty string; native validator limits UTF-8 encoded length to 500 bytes, despite an error message saying characters |
| description | Main work description; do not rename body to match Memory |
| design | Existing design text |
| acceptance_criteria | Existing acceptance text |
| notes | Existing notes text; append and replacement are distinct operations |
| issue_type | Existing work classification; built-in or configured custom value |
| status | Existing workflow status; built-in or configured custom value |
| priority | Integer 0–4; zero is P0, not absence |
| assignee | Existing assignment string; empty/unset assignment and active transfer rules remain native behavior |
| owner | Existing human-owner field; not the revision writer or authenticated principal |
| estimated_minutes | Optional nonnegative integer; zero is a real estimate; preview storage also requires a signed 32-bit representation |
| labels | Existing label collection; mutation and query conventions remain the Issue contract |
| due_at | Optional intended completion time; not a command to close the Issue |
| defer_until | Optional scheduling exclusion until a time; not deletion |
| external_ref | Existing optional literal integration reference; not automatically a URI or a BDP Resource reference |
| spec_id | Existing literal specification reference; no URI coercion |

The current Issue validation checks nonempty title, not the Memory proposal's
nonblank rule. Do not silently strengthen it while transcribing the Type.
Likewise, a byte limit is not JSON Schema maxLength: 300 two-byte characters fit
maxLength=500 but fail the native 500-byte title limit. UTF-8 validation and byte
bounds need specified admission checks beyond that keyword.

Native assignment/owner bounds use 255 Unicode code points. The inspected preview
also checks external_ref at 255 code points and spec_id at 1024; it rejects lossy
storage rather than truncating values. These are existing adapter limits, not
new universal BDP limits. A portable definition and service capability must make
any such limits explicit rather than advertise acceptance the writer cannot meet.

Update omission preserves values. Empty, null, removal and zero are not
interchangeable: preview empty external_ref clears to null, empty spec_id clears
to an empty string, and due dates and estimates have explicit clearing paths.
The Issue update source has an older comment saying estimate clear is unsupported,
but its request field and implementation admit ClearEstimatedMinutes. The draft
follows executable code and marks per-command exposure for verification, rather
than treating that comment as authority.

Authoring defaults remain operation-specific. The inspected native create
preparation defaults an omitted status to open and an omitted created_by to the
request actor. Priority defaulting uses a separate absent/default indication, so
explicit P0 is preserved. Saved-state schemas must not apply create defaults to
old reads or ordinary updates. V2 authenticated attribution will need an explicit
migration from these existing writer-supplied conventions.

### 3.2 Classifications and statuses

The inspected native work classifications are bug, feature, task, epic, chore,
decision, message, molecule, gate, spike, story and milestone. Internal event is
also admitted by built-in/custom validation, although excluded from the ordinary
work-type list. Other classifications use the existing types.custom configuration.
Alias normalization is authoring behavior (for example enhancement/feat→feature),
not an additional nominal Type or a reason to reinterpret saved history.

Built-in statuses are open, in_progress, blocked, deferred, closed, pinned and
hooked. Existing custom-status configuration supplies names and behavioral
categories: active, wip, done, frozen, or unspecified for legacy unannotated entries.
These are existing product concepts; this draft does not invent a new state machine.

A fixed enum listing only built-ins would reject valid configured values. A bare
string schema, however, cannot express configuration-dependent admission or
behavior. The Type Bead design must distinguish the immutable Type contract from
an explicit Scope policy/configuration dependency. The definition must not change
meaning silently when a local status category is edited (§9).

The core native validator requires closed_at exactly when status equals the
literal closed status. Do not assume every custom done-category status has that
same timestamp rule. Status-category support does not automatically rewrite all
older comparisons throughout the product.

### 3.3 Attribution, lifecycle and operational fields

The native Issue struct mixes durable data, projections and local runtime state.
Copying every JSON field into an immutable Type definition would conceal that
boundary. Preserve existing data while making its role explicit:

| Field group | Current meaning | Proposed treatment / remaining work |
| --- | --- | --- |
| created_at, created_by, updated_at | Legacy creation/change information in Issue properties | Retain during compatibility; reconcile with V2 revisionProvenance without two independently writable accounts of the same mutation |
| started_at, closed_at, close_reason, closed_by_session | Work lifecycle facts and close context | Preserve meanings; do not collapse started/closed times into revision commit time or confuse a closing session with authenticated actor |
| lease_expires_at, heartbeat_at, lease_granted_node | Node-local current lease observations | Keep distinguishable from immutable revision content; exact transport/placement is an open shared design decision |
| is_blocked | Derived scheduling projection; included explicitly in journal snapshots | Not caller-authored status and not equivalent to status=blocked |
| metadata | Existing application JSON | Current graph adapter moves it to common Resource metadata; avoid a duplicate properties.metadata authority |
| dependencies | Native relation projection used in interchange/history | Current graph adapter removes it from properties and expresses canonical Links/ownedLinks instead |
| comments | Separate native comment records, sometimes hydrated into a view | Preserve legacy behavior; canonical revision inclusion and operation exposure require explicit mapping, not an invented Comment Type here |
| revision/row lock/history ordinal | Different existing concurrency/history mechanisms | Common graph revision is opaque; never substitute an internal ordinal or partially covering native row-lock token for a portable exact revision |

The inspected preview intentionally returns live lease fields on current Issue
reads while keeping the same graph revision; it excludes those fields when
checking current durable state against the retained snapshot. A heartbeat does
not mint Issue History. This is a real boundary to resolve, not evidence that
any bytes returned under a revision are necessarily immutable. A proposed complete
BDP revision needs a stable state portion and an explicitly separate operational
observation; this draft does not choose a new envelope member for that split.

Additional existing fields must survive a full adoption inventory. They are not
silently dropped or converted to new nominal Types by this specification:

| Existing group | Native JSON fields / concepts | Adoption boundary |
| --- | --- | --- |
| Integration/origin | source_system, sender, source_formula, source_location | Preserve established meaning; not automatically V2 sources or authenticated attribution |
| Storage/retention | ephemeral, no_history, storage_class, wisp_type | Distinct storage contracts; preview Issue create refuses ephemeral/no-history records |
| Context/template | pinned, is_template | Product markers; pinned here is not a reference revision pin |
| Molecule/bonding | bonded_from, mol_type | Existing orchestration state, not new Bead Types coined here |
| Assignment model | work_type (mutex or open_competition; empty defaults to mutex) | Existing assignment semantics, distinct from issue_type and assignee |
| Gates | await_type, await_id, timeout, waiters | Existing asynchronous coordination; execution support is not supplied by a properties schema |
| Event-shaped Issues | event_kind, actor, target, payload | Existing specialized content; actor here is not automatically the revision actor |
| Compaction | compaction_level, compacted_at, compacted_at_commit, original_size | Existing maintenance data; preserve or explicitly map during conversion |

Internal fields with no JSON representation (routing hints, content hash, row
lock and hydration flags) are not added as public Type properties. No total
Issue-parity claim is made until these groups and their command paths are mapped.

### 3.4 Reviewable core properties schema

This is a **core fragment**, not a complete installable Issue definition or proof
of native write admissibility. It records common structural checks without
closing the root, freezing custom-value enums or pretending JSON Schema can
validate configured workflows. The inventory above and native semantic checks
remain part of the proposed contract. An omitted optional field uses its existing
surface semantics; the fragment does not apply authoring defaults.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "title", "issue_type", "status", "priority"],
  "properties": {
    "id": {"type": "string", "minLength": 1},
    "title": {"type": "string", "minLength": 1},
    "description": {"type": "string"},
    "design": {"type": "string"},
    "acceptance_criteria": {"type": "string"},
    "notes": {"type": "string"},
    "issue_type": {"type": "string", "minLength": 1},
    "status": {"type": "string", "minLength": 1},
    "priority": {"type": "integer", "minimum": 0, "maximum": 4},
    "assignee": {"type": "string", "maxLength": 255},
    "owner": {"type": "string", "maxLength": 255},
    "estimated_minutes": {"type": ["integer", "null"], "minimum": 0},
    "labels": {"type": "array", "items": {"type": "string"}},
    "external_ref": {"type": ["string", "null"]},
    "spec_id": {"type": "string"},
    "due_at": {"type": ["string", "null"], "format": "date-time"},
    "defer_until": {"type": ["string", "null"], "format": "date-time"},
    "closed_at": {"type": ["string", "null"], "format": "date-time"},
    "close_reason": {"type": "string"}
  },
  "additionalProperties": true
}
```

Unknown top-level properties remain legal in the shared open-root model. Current
native storage and command writers accept bounded field sets, not arbitrary
new persisted properties. That gap must be resolved with preservation support
or an honest supported-write boundary before claiming this fragment is a fully
implemented open Issue contract. Read acceptance, write capability and authoring
field exposure are three different claims.

## 4. Dependency data, direction and endpoint rules

### 4.1 Direction and identity

A native row has issue_id as source and depends_on_id as target. For blocks,
**A→B means A depends on B: B blocks A**. For parent-child, source is child and
target is parent. CLI conveniences such as --blocks may reverse the supplied
operands; they do not reverse the stored convention.

The current native Dependency row has a deterministic backing ID derived from
its ordered pair. The preview additionally allocates a canonical Link identity.
A portable Link ID must not be reconstructed from a title, native row ID or an
assumption that all Link Types prohibit parallel edges.

**Existing/pending rule:** at most one native Dependency exists for an ordered
Issue pair, across all dep_type values. A→B and B→A are different pairs, subject
to the applicable cycle/hierarchy rules. This is neither a global maximum of one
outgoing Dependency nor one maximum for each kind. It does not prohibit a separate
informational Link alongside the Dependency.

### 4.2 Properties and metadata

| Item | Mapping and behavior |
| --- | --- |
| dep_type | Required saved string, mirrors native Dependency.type; the proposed discriminator is not renamed kind |
| source/target | Common Link reference members, not duplicate properties |
| metadata | Native edge metadata carries application and sometimes workflow data; shared common-metadata mapping requires explicit preservation |
| thread_id | Existing conversation grouping field; portable placement is unresolved and must not be discarded |
| created_at/created_by | Existing row creation facts; migration into/alongside V2 needs a defined attribution mapping |

Native Dependency.IsValid accepts a nonempty kind of at most 32 bytes. The preview
also checks UTF-8; an omitted create kind defaults to blocks. Unknown values can
be valid without being built-in. Some user-facing commands deliberately accept
only well-known kinds, so do not generalize one command's whitelist to the Type.
No scheduling or hierarchy effect is inferred for an unfamiliar value.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["dep_type"],
  "properties": {
    "dep_type": {"type": "string", "minLength": 1}
  },
  "additionalProperties": true
}
```

The 32-byte admission bound is separate from this schema fragment. The pending
preview exposes dep_type only, common metadata as an empty object, and no generic
Dependency properties/metadata editor. Native Beads can already carry edge metadata
and thread_id. This is a preview limitation, not evidence that those existing
requirements can be omitted from the eventual Type specification.

For example, waits-for metadata includes gate (all-children or any-children),
optional spawner_id, and optional also_blocks. The actual scheduling evaluator
reads gate and also_blocks; the latter preserves blocking when an additional
blocks edge would collide with pair uniqueness. Missing gate is treated as
all-children by current evaluation. This is executable domain meaning in metadata,
not an opaque annotation. Preserve it and its validation rather than moving it
into properties merely to fit a new general rule. Native metadata is serialized
JSON in a string field; converting it to common object metadata needs explicit
handling of malformed/non-object historical values, never silent loss.

### 4.3 Endpoint admission and pins

| Surface / target | Source | Target | Pin / external behavior |
| --- | --- | --- | --- |
| Pending PR97 graph Dependency | Live local durable Issue | Live local durable Issue | Floating endpoints only; external references refused |
| Existing ordinary Beads | Existing native Issue | Local Issue, or certain external/cross-repository references under existing rules | Native references are not BDP revision pins; known absent local targets are rejected |
| Recommended first portable Dependency contract | [Issue] | [Issue] | Preserve the local floating graph rule initially; remote and pinned workflow semantics require a separate decision |

No conformance relation or per-kind endpoint dispatch is needed for the two
nominal Issue endpoint selections. Both must pass; Memory is not an Issue.
Self-dependencies are rejected. Ordinary external capability references cannot
use parent-child, and dotted-child/ancestor restrictions remain part of existing
admission. A textual remote target is not proof of an observed remote Type.

General Links may support pinned endpoints while this workflow Type restricts
its supported endpoints. A pin to B@r1 when B was open must not silently be read
as B's current closed state to make A ready. Conversely, simply accepting the
pin might freeze A's blocker forever. Neither choice is selected here. Historical
citation of work is already possible through other reference roles without
changing live Dependency scheduling.

Remote native dependencies likewise need a deliberate shared mapping: resolution,
unknown availability, Type expectations, cycle scope and scheduling observation.
Do not convert external: identifiers into guessed Scope URLs or claim existing
native external support is already portable BDP federation.

## 5. Existing kinds and workflow behavior

The current built-in list contains nineteen Dependency kinds. These are one
Type's values. Classification into scheduling roles below is not a new Type
hierarchy and is not a universal rule for other catalogs.

| dep_type | Existing role to preserve |
| --- | --- |
| blocks | Hard prerequisite; source depends on target |
| parent-child | Child→parent hierarchy; participates in readiness propagation but is not an ordinary hard-blocking edge |
| conditional-blocks | Conditional workflow prerequisite; preserve existing outcome-sensitive behavior rather than reducing it to blocks |
| waits-for | Dynamic-child gate with metadata-sensitive readiness |
| related, discovered-from | Existing association/origin relationships |
| replies-to, relates-to | Existing conversation/knowledge relationships; thread grouping may matter |
| duplicates, supersedes | Existing duplication/replacement relations; not Resource version links |
| authored-by, assigned-to, approved-by, attests | Existing entity/approval/attestation vocabulary; a label alone does not authenticate the assertion |
| tracks | Existing convoy/tracking relation |
| until, caused-by, validates | Existing reference/condition/validation vocabulary |
| delegated-from | Existing delegation relation; command/domain behavior is not supplied by its spelling |

Three sets must not be conflated:

- AffectsReadyWork includes blocks, parent-child, conditional-blocks and waits-for.
- IsBlockingEdge includes blocks, conditional-blocks and waits-for, excluding
  structural parent-child.
- The inspected upstream combined-cycle set includes blocks, conditional-blocks
  and parent-child. waits-for is deliberately excluded because its gate observes
  the spawner's children instead of forming the same static prerequisite edge.

Thus “query all Dependency Links” is not a query for blockers. The native readiness
algorithm also depends on Issue statuses, parent chains, gate metadata and policy.
It cannot be represented by endpoint Type lists plus maximum counts. Keep existing
mixed-cycle and hierarchy checks; do not replace them with a blanket prohibition
on every possible graph cycle. Non-scheduling associations do not become blocking
merely because they share Dependency's nominal identity.

`ready` is not simply status=open or zero outgoing Links. Its current selection
uses blocked-state projection, status/category rules, defer time, context markers,
Issue classification and user filters. `blocked` is not simply status=blocked.
The exact implementation and its conformance cases remain the behavioral baseline;
this draft does not attempt to replace the detailed scheduler with a new short
formula. Standalone portable scheduling specification is still needed for a BDP
implementation claiming equivalent workflow behavior.

The existing [bd supersede command](https://github.com/gastownhall/beads/blob/e6a891b9008cabf87a1133edb90829380116cfe9/docs/cli-reference/supersede.md)
closes the superseded Issue with a reference to its replacement. That is a command
workflow, not permission to close an Issue merely because a generic Link create
contains dep_type=supersedes. The preview descriptor expressly does not authorize
edge-plus-close. Nor is it equivalent to MemorySupersedes, whose proposal has no
automatic retirement. Preserve the exact native operation's direction and effects
when writing its adapter; do not infer them from an English verb.

## 6. Ownership, mutation and history

Issue owns its outgoing Dependency Links. It does **not** acquire Memory's wildcard
ownership of all outgoing Link Types. In the inspected preview an Issue-source
informational Related Link is unowned, while a Memory-source informational Link
is owned by Memory. Installing another Link Type does not silently change Issue
history or ownership.

The preview declares a maximum of 1000 outgoing owned Dependency Links per Issue.
That is an explicit disposable descriptor budget, not the product's universal
arity. Final limits need product review. Pair uniqueness remains separate: a
source may depend on many different targets while each pair has only one Dependency.

An accepted durable Dependency addition/removal versions its source Issue and
retains the canonical owned set atomically with the Link/catalog mutation. Incoming
Dependency changes do not themselves version the target. Earlier owned sets retain
their own exact Link state. A failed operation must leave neither a native row
without a canonical mapping nor an advertised Link without its backing state.

Repeated writes need a precise contract, not merely the word idempotent:

| Attempt | Existing native behavior | Pending graph adapter |
| --- | --- | --- |
| Same pair, same kind, no durable data change | No new durable change/history | Existing Link returned unchanged |
| Same pair, same kind, metadata or thread changes | Native path can update the row and source history | No such inputs admitted; reassertion returns the existing Link unchanged |
| Same pair, different kind | Conflict; no implicit replacement | Conflict |
| Same pair, same kind, different requested canonical Link ID | Native pair identity is not a caller-selected BDP ID | Refuse; do not create a parallel Dependency |

Native thread omission preserves a stored thread rather than clearing it.
These distinctions matter for import and retry adapters.

A future explicit dep_type edit would remain within the same nominal Dependency
Type, but must rerun scheduling, hierarchy, pair and metadata rules. The inspected
generic graph update path does not implement that operation. Adding it is a
separate capability decision, not an automatic consequence of an open properties
schema. Delete-old/create-new in a valid ordered atomic batch can replace a pair;
it does not by itself preserve the old canonical Link identity.

Current preview deletion refuses incident Links and requires explicit unlink;
it reserves deleted identities and retains earlier snapshots. The Memory proposal's
floating-Link cleanup and surviving historical pins are a different future
lifecycle design. Do not silently apply that proposal to workflow Dependencies or
claim restore/retention/erasure semantics are solved by these two Type definitions.

V2 revisionProvenance is the proposed destination for common revision writer,
commit time, assisting agent, message and sources. Activity records remain a
separate externally defined Bead Type. Native creation/close/session fields and
historical unknown values need a migration mapping; no actor authenticity can
be inferred from an existing string field. Lease heartbeat is not a provenance
revision, and a claimed assignment is not proof of the writer's identity.

## 7. Explicit nominal Type changes

The Memory work now assumes explicit Type changes may preserve identity. Issue
and Dependency make the limits concrete:

- GenericBead→Issue needs valid Issue state, native identity mapping, lifecycle
  capability, configured classification/status admission, and the correct owned
  Dependency set. Copying a few JSON fields is insufficient.
- Issue→Memory needs validation of affected floating Dependencies. Any that still
  require Issue must be repaired or the transition refused. Existing pinned
  citations retain the earlier Issue state. Owned-set and operational-state
  transitions need explicit rules; this is not implemented by either adapter.
- GenericLink→Dependency needs valid local Issue endpoints, pair uniqueness,
  cycle/hierarchy checks, metadata interpretation and source History integration.
- Dependency→informational Link changes both workflow participation and potentially
  source ownership. Recompute affected workflow state and preserve earlier
  revisions atomically; never retain a hidden blocking native row after retyping.

Every old revision keeps its original exact Type and state. Current queries use
the current revision's affiliation. Type updates do not automatically alter
reference pins or remote Scope tables. Ordered atomic batch can help when a valid
staged sequence exists; it does not waive intermediate validity or guarantee
that every ownership-changing migration can be expressed today.

## 8. Worked representation and acceptance cases

Illustrative proposed payloads, omitting common identity/revision/provenance
members where not needed. Placeholder definition pins are not version labels or
current preview wire syntax.

```json
{
  "type": {"uri": "https://example.org/beads-types/issue", "revision": "issue-definition-1"},
  "properties": {
    "id": "bd-repair",
    "title": "Replace the pump seal",
    "description": "Repair the leak before returning the pump to service.",
    "issue_type": "task",
    "status": "open",
    "priority": 1,
    "assignee": "sam"
  },
  "metadata": {}
}
```

```json
{
  "type": {"uri": "https://example.org/beads-types/dependency", "revision": "dependency-definition-1"},
  "source": "https://example.org/work/beads/bd-repair",
  "target": "https://example.org/work/beads/bd-delivery",
  "properties": {"dep_type": "blocks"},
  "metadata": {}
}
```

Repair depends on delivery; delivery blocks repair. A separate MemoryGuidance
Link may point from repair to a procedure Memory. It is not a Dependency and
must not change readiness merely by existing. Updating the procedure does not
complete the repair or delivery Issue.

The following are design acceptance cases, not executed product tests:

| ID | Case | Expected outcome / gate |
| --- | --- | --- |
| I01 | Issue priority zero | Preserve P0, not absent/default |
| I02 | Empty title | Reject; do not import Memory's derived-title behavior |
| I03 | 300 two-byte characters in title | Reject native 500-byte bound despite passing maxLength=500 |
| I04 | Configured custom issue_type/status | Preserve existing admission; do not freeze a built-in-only enum |
| I05 | status=closed without closed_at | Reject under native validator; do not infer timestamp on a raw saved-state read |
| I06 | Custom done-category status | Apply its actual contract; do not pretend it equals literal closed |
| I07 | Heartbeat advances lease time | No durable Issue revision solely for heartbeat; expose operational observation distinctly |
| I08 | Source Issue adds Dependency | Link and source owned state/history change atomically |
| I09 | Issue adds informational Related | Do not acquire wildcard ownership or scheduling effect |
| I10 | New arbitrary Issue property | Open-root schema is insufficient; writer preservation/admission support must be declared |
| D01 | Add blocks A→B | A depends on B; B is prerequisite |
| D02 | Add parent-child C→P | C is child, P parent; preserve hierarchy validation |
| D03 | Add same pair/same kind unchanged | No new Link or source revision |
| D04 | Add same pair/different kind | Conflict; no second Dependency slot |
| D05 | Native same-kind re-add changes metadata | Preserve mutation/history semantics; preview cannot claim this editor |
| D06 | Add different pairs A→B and A→C | Pair uniqueness alone permits both; applicable total maxima and workflow checks still apply |
| D07 | Dependency endpoint is Memory | Reject nominal endpoint mismatch |
| D08 | Dependency targets exact old Issue revision | Pending graph contract refuses; portable workflow pin behavior undecided |
| D09 | Unknown valid short dep_type | May be valid at native/preview admission; no inferred scheduling effect; individual CLI whitelist can differ |
| D10 | Self-edge or prohibited mixed scheduling cycle | Reject atomically through domain validation, not endpoint lists alone |
| D11 | Native waits-for metadata also_blocks=true | Preserve both gate and carried blocking semantics; not opaque discardable metadata |
| D12 | Add informational supersedes relation | Do not infer a close operation; bd supersede is a separate workflow |
| D13 | Attempt second pair edge with another nominal definition revision | A new definition pin must not evade pair uniqueness |
| T01 | Issue→Memory with floating incoming Dependency | Refuse unless explicit valid repair is part of the transition |
| T02 | GenericLink→Dependency collides with occupied pair | Reject atomically; kind label or a fresh Link ID creates no extra slot |
| T03 | Dependency retyped to informational Link | No hidden native blocker remains; shared atomic migration capability required |
| T04 | Install revised Type definition | Existing instances retain exact affiliation; no implicit migration |

## 9. What this teaches us about the Type Bead

| Finding | Issue/Dependency evidence | Consequence for Type design |
| --- | --- | --- |
| A discriminator may affect behavior | dep_type selects scheduling; issue_type/status select product paths | A kind is not necessarily a display label; using one does not require nominal inheritance |
| Pair uniqueness differs from endpoint arity | One Dependency per ordered pair, many pairs per Issue | Decide whether a reusable pair-key constraint belongs in BDP or remains a declared domain invariant; no new syntax selected here |
| Graph validity is richer than endpoint Types | Mixed cycles, hierarchy and waits-for gates | Separate declarative shape/endpoint/count checks from domain operations; do not invent a universal workflow engine inside Type Beads |
| Metadata can be contractual | waits-for gate and also_blocks are read by scheduling | Do not define metadata as necessarily semantically inert; preserve legacy placement and state which validator owns it |
| Shape validity is not write capability | Native adapters admit bounded fields and operations | A Type definition cannot imply every generic writer can persist or execute its contract |
| Immutable revisions need a clear state boundary | Live lease fields vary under the same current graph revision | Distinguish durable versioned state from operational observations before claiming complete immutable representations |
| Validation can depend on Scope policy | Custom kinds/status categories are configured | Name configuration dependencies and policy tightening explicitly; decide what must be versioned or pinned for reproducible historical interpretation |
| Storage bounds are not interchangeable | Byte limits, code-point limits, SQL integer limits | Preserve exact units and reject lossy conversion; JSON Schema alone may not encode all native admission checks |
| Type changes can transfer responsibility | Retyping Dependency changes workflow and Issue ownership | Require explicit adapter participation and atomic state migration, not just changing a type field |
| Catalog installation is not implementation | Preview descriptors name contracts whose enforcement lives in native writers | Declare capability and enforcement obligations without falsely advertising executable behavior from a descriptor alone |

These are inputs to the Type Bead specification, not decisions that every
invariant becomes a new descriptor field. The immediate useful boundary is:
the definition states the immutable meaning and requirements; supported services
must say which operations they can honor and enforce those requirements. How
policy references, domain validators and operational observations are represented
remains to be designed.

## 10. Ready / pending / NYI

“Ready” means reviewable here. NYI means this contribution neither implements nor
qualifies the capability; some underlying native functionality already exists.

| Area | Design/source status | Remaining work |
| --- | --- | --- |
| One Issue / one Dependency with existing discriminators | Documented; PR97 implements the pending catalog shape | Production IDs, Type pins, installation/versioning and release acceptance |
| Ordinary content, status and classification | Existing behavior inventoried; core schema fragment provided | Full durable-field schema and configuration-dependent validation contract |
| Dependency direction, pair uniqueness and kind roles | Existing behavior documented | Portable invariant/admission encoding; no implicit new maximum syntax |
| Local floating endpoints | Pending graph behavior documented and recommended initial boundary | Decide pins and remote workflow separately |
| Edge metadata/thread data | Existing native requirement; preview gap explicit | Lossless common-metadata/thread mapping and supported editors |
| Ownership and source History | Source-backed preview behavior | Complete capability/History qualification and final limit policy |
| Scheduling and lifecycle | Existing implementation remains behavioral baseline | Standalone portable operation specification and conformance cases; not replaced by schema fragments |
| Revision provenance | External V2 direction | Legacy timestamp/actor mapping, authenticated service attribution and integration |
| Leases and derived projections | Boundary problem identified | Stable revision versus operational observation representation |
| Explicit Type changes | Proposed use cases and refusal conditions | Migration/ownership/adapter transaction mechanism NYI here |
| Beads CLI and storage | Existing writers are referenced, not rewritten | Command parity and migration belong to their workstreams |

This draft is ready to mark up beside Memory. It is intentionally not advertised
as a complete installable Type package or full product parity: the unresolved
mapping of operational fields, edge metadata, configuration and domain operations
is exactly what this exercise is meant to expose before we design the Type Bead.
