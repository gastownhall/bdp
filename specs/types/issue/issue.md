# Issue and Dependency Types

Draft for review, October 14, 2026. **`issue` is a base Bead Type; `task`, `bug`
and the other work classifications conform to it. `dependency` is a base Link
Type; `blocks`, `parent-child` and the other dependency classifications conform
to it.** Intrinsic Types for task, blocks and the other classifications are a
settled product decision. Preview 2 exposes that direction through CLI shims; the
inspected underlying catalog has not yet caught up. Native classification values
translate to the intrinsic `type` reference; `issue_type` and `dep_type` are not
properties in the proposed records.

This document preserves the names, fields and behavioral requirements discoverable
in Janet's inspected Preview 2 candidate. Selected changes are classification-to-Type
mapping and promotion of codified workflow metadata into schema-declared properties
on the relevant Types. Storage may retain its existing layout behind read/write
adapters. This does not redesign workflow or settle how live/computed fields should
appear in a versioned Type. No implementation change is made by this draft.

The shared [Types draft](../../profiles/types/types.md) supplies conformance, pinned definitions,
endpoint composition and arity rules. The [Memory draft](https://github.com/gastownhall/bdp/pull/143) is a companion
requirements exercise; its evolving design is tracked separately in PR143.
Neither is a replacement for the current canonical BDP contract until adopted.

## 1. Preview 2 evidence and status

**Inspected Preview 2** means the exact delivered candidate and corresponding
source below, not upstream main or the old unmerged PR97 snapshot. **Selected**
means a settled product decision, including intrinsic classification Types.
**Proposed** marks specification details not yet implemented or qualified here; it
does not reopen that product decision. **Open** means a remaining design choice.
Inspection is not fresh runtime qualification.

**Product update from Donna, October 14:** Preview 2's CLI ratifies intrinsic
classification Types through shimming. The underlying implementation is planned
to catch up for Preview 3 by Friday, October 16. This is the product plan, not a
claim that this draft has inspected or qualified the future implementation. The
source evidence below remains the inspected Preview 2 snapshot.

| Evidence | Exact identity | What it establishes |
| --- | --- | --- |
| Janet's integration source | [release/preview2-integration at b6f7115](https://github.com/donnabox/beads/tree/b6f7115adfd6b3da0055b8576c152d8d9456518a), tree 828a2ec229ac10d78e9683f1dbf446118d51cc44 | Inspected candidate selected from Janet's ledger and verified at the source audit; not a claim about subsequent heads |
| Delivered PR106 build | bin/bd SHA256 0d42c7079cb510dfc4e5d368017cceca09a8181b3f4e41b1e6e49c8014c4174c | Build in Janet's existing PR106 playground; provenance records release_approved:false; no shared database exercised |
| Source audit | [Preview 2 field and behavior audit](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/issue-dependency-preview2-audit-20261014.md) | Build/source binding, field inventory, source line citations and limitations |
| Shared design | [Types](../../profiles/types/types.md), [Provenance V2](https://github.com/gastownhall/beads/issues/7510) | Proposed semantic contracts; installed subsets and remaining decisions stay distinct |

The source audit preserves the local evidence paths for reproducibility. An older
candidate's checks are not relabeled as checks of this candidate. This document
claims neither public release approval nor execution of the new Type design.

Primary implementation references at that exact candidate:

- [Issue/Dependency data definitions](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go).
- [Installed descriptors](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/schema.go), [Issue reads](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go), [Issue updates](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_update.go), [Dependency adapter](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/dependencies.go).
- [Heartbeat adapter](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_lease.go) and [representation limits](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_field_representation.go).

BDP owns shared meanings, validation outcomes and versioning. Beads owns CLI
translation, storage, indexes and domain-operation implementation. A stored column,
Go struct field or effective display label is not automatically a portable Type
property or a new Type identity.

## 2. Type hierarchy and legacy translation

Names below are the existing lowercase classification names. Production global
identities and exact definition revisions still need selecting. Placeholder URLs
in examples are not registry assignments or derivable from native short names.

```text
Bead Type issue
    task, bug, feature, epic, chore, decision, message, molecule,
    gate, spike, story, milestone, event  -- each conforms to issue

Link Type dependency
    blocks, parent-child, conditional-blocks, waits-for, related,
    discovered-from, replies-to, relates-to, duplicates, supersedes,
    authored-by, assigned-to, approved-by, attests, tracks, until,
    caused-by, validates, delegated-from -- each conforms to dependency
```

The catalog inventories existing built-in names, including internal `event`.
Each child declaration pins its base definition revision. It inherits the base's
schema, semantics and applicable graph constraints. No additional parent relation
between these children is inferred. For example, `parent-child` does not conform
to `blocks` merely because both affect readiness.

| Inspected Preview 2 implementation | Selected product mapping |
| --- | --- |
| One nominal preview-issue Type; properties.issue_type=task | Intrinsic Type is task, whose definition conforms to issue; no properties.issue_type |
| One nominal preview-dependency Type; properties.dep_type=blocks | Intrinsic Type is blocks, whose definition conforms to dependency; no properties.dep_type |
| Existing native issue_type and dependencies.type columns | May remain storage details; adapter translates both reads and writes |
| Generic native classification editing | Becomes an explicit nominal Type change in the graph contract, with resulting-state and workflow validation |
| Existing effective type/kind display and CLI shims | Expose the settled intrinsic-Type product direction; do not by themselves establish installed conformance or pinned definition support |

`issue` and `dependency` membership queries must include conforming children.
An exact nominal query for task remains distinct from a query for everything
conforming to issue. The shared query syntax is open. Installing a Type or giving
it a familiar display name does not confer membership without a declaration.

The base Types need not freeze the list of permitted children. Existing custom
Issue classifications and arbitrary valid dependency labels still need a stable,
authorized mapping to definitions. The adapter must not invent global IDs from
suffixes, silently fall back to the base, or discard an unknown classification.
Whether base issue/dependency are directly instantiable, how ordinary create
chooses its concrete Type, and how custom definitions are provisioned are OPEN.
Existing native defaults are evidence for that decision, not automatically chosen
new defaults.

The proposed graph representation has one classification authority: `type`.
Compatibility input handling for simultaneous old discriminator and new Type
inputs needs an explicit contract; it must not store two independently editable
values. Historical stored representations retain their original meaning and pins;
an adapter mapping is not permission to rewrite old revisions in place.

A decision Issue remains a work record, not a decision Memory. The dependency
child `related` is not the preview's standalone informational Related Link or
MemoryRelated. Similarly `supersedes` retains the work-domain meaning below.
Use distinct canonical identities even where human-readable names overlap. In
the inspected CLI, related selects the native Dependency kind, while
preview-related-memory (also preview-related) selects the informational Type.
Human bd types lists 14 Bead and 22 Link selectors without custom additions;
JSON/details exposes six installed definitions, not a conformance hierarchy.

### 2.1 Definition Beads, conformance Links and instance graphs

Under the selected Types profile, issue, task, bug, dependency, blocks and the
other definitions are Beads. Instance affiliation remains the distinguished
`type` reference. Both Bead-Type and Link-Type definitions are Beads, but their
described instance worlds do not intersect.

The hierarchy above is represented by owned ConformsTo Links on the definition
Beads, with exact target pins. For example, in conceptual snapshot notation:

```text
task@t1    -- owned ConformsTo --> issue@i1
bug@b1     -- owned ConformsTo --> issue@i1
blocks@l1  -- owned ConformsTo --> dependency@d1
```

The left labels identify the definition revisions whose recorded owned state
contains the declarations; this does not select wire syntax for Link source pins.
Each declaration has its own Link identity and revision, including provenance
under V2. Conforming ConformsTo specializations may add requirements or evidence,
but cannot weaken the declared structural and semantic promises. A later review
can be an Activity about the exact declaration Link revision without changing it.

Two ownership relationships must not be confused:

- An Issue instance owns outgoing work Links satisfying dependency. A Dependency
  mutation therefore has revision effects on that Issue instance.
- A Type-definition Bead owns its conformance declarations, through its own
  metatype's ownership contract. A declaration mutation has revision effects on
  that definition Bead, not on every instance affiliated with it.

A task pinned to task@t1 continues to use task@t1's recorded declaration to
issue@i1 even if a newer task definition changes its declarations. No live
adjacency query may silently reinterpret the historical contract. Retaining the
required definitions and declaration records is a lifecycle requirement whose
concrete mechanism remains to specify.

A Type hierarchy viewer can show these actual definition Beads and Links. A
work-graph traversal starting at an Issue does not automatically enter that
hierarchy through its type field. Conversely, the definition's ConformsTo Links
are not the Issue instance's work Dependencies and do not affect its scheduler.
Generic viewer support and exact historical traversal still require qualification.

The [shared foundation example](../../profiles/types/definitions.json) makes
these definitions and the task/blocks declarations concrete, with embedded copies
of the two base property schemas. Its Type/BeadType/LinkType bootstrap, selector spelling and seed
mechanism are review candidates. It is not a complete built-in catalog or an
installation request, and does not pick the missing child-field or workflow rules.

The schemas below, endpoint eligibility, arity, pair uniqueness and ownership
rules remain descriptor fields in the definition Bead's properties. They are
not separate Schema/Constraint Beads. No competing writable conformsTo field is
introduced. Concrete definition/metatype schemas, IDs and bootstrap remain shared
Type decisions. Preview 2's classification shims do not establish that this
representation is already installed or executable.

The foundation literals affiliate issue/task with BeadType and dependency/blocks
with LinkType. Dependency uses one local Issue→Issue endpoint pair and family-wide
ordered-pair uniqueness. They do not add a blanket acyclicity rule to Dependency:
existing kind-specific cycle/hierarchy and scheduler behavior remains authoritative.
Endpoint-pin mode constraints are deferred in the shared descriptor language; this
does not expand the inspected Preview 2 CLI's floating-only endpoint support.
The portable target model promises no external resource validation; existing native
external behavior is evidence to reconcile, not an automatic protocol guarantee.

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

### 3.2 Existing classification and status behavior

The inspected native work classifications are bug, feature, task, epic, chore,
decision, message, molecule, gate, spike, story and milestone. Internal event is
also admitted by built-in/custom validation, although excluded from the ordinary
work-type list. Other classifications use the existing types.custom configuration.
Alias normalization is authoring behavior (for example enhancement/feat→feature),
not an additional canonical Type identity or a reason to reinterpret saved history.
The proposed adapter maps the normalized classification to its registered Type.

Existing description-template guidance is also classification-specific. The
[RequiredSections source](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L866)
associates bug with Steps to Reproduce and Acceptance Criteria; task/feature/story
with Acceptance Criteria; epic with Success Criteria; decision with Decision,
Rationale and Alternatives Considered; spike with Goal and Findings. Other built-in
classifications have no recommended headings in that function. Preserve these
existing lint/explicit-validation behaviors; do not turn every recommended Markdown
heading into an unconditional required JSON property or saved-state schema rule.

Built-in statuses are open, in_progress, blocked, deferred, closed, pinned and
hooked. Existing custom-status configuration supplies names and behavioral
categories: active, wip, done, frozen, or unspecified for legacy unannotated entries.
These are existing product concepts; this draft does not invent a new state machine.

A fixed enum listing only built-ins would reject valid configured values. A bare
string schema, however, cannot express configuration-dependent admission or
behavior. The shared Type design must distinguish the immutable Type contract from
an explicit Scope policy/configuration dependency. The definition must not change
meaning silently when a local status category is edited (§9).

**OPEN — P01, policy-dependent meaning:** decide how configuration such as status
categories relates to immutable Type revisions. Record the dependency and settle
activation/history semantics later; no policy-versioning mechanism is selected.

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
reads while retaining the same durable graph revision. `heartbeat_at` is not
merely computed from the clock: it is stored in the separate ephemeral, node-local
`leases` table and hydrated into the current Issue response. The heartbeat adapter
renews that lease and verifies that the graph revision did not change. Retained
snapshot comparison excludes live lease drift by substituting the retained lease
values before comparison.

The richer ordinary detail view also computes parent, dependency/dependent/comment
counts, unresolved-reference summaries and epic progress/closeability. Those are
view results, not additional authored properties. The source audit inventories the
exact detail fields separately from the 56-field native Issue struct.

`is_blocked` is different: it is a derived, persisted scheduling projection. A
field may be stored but not caller-writable, computed and then persisted, or
hydrated from separate operational state. These are independent axes.

**OPEN — observation and revision contract.** No new representation or revision
policy is selected here. Options to discuss include a separate operational view,
explicit observation fields alongside immutable state, or recording operational
changes as revisions. A query observing a new heartbeat must not be assumed to
mint a revision merely because it returns different data. If revisions are chosen,
we must decide whether the underlying operation or a read creates them, and how
that interacts with immutable pins, caching, replicas and high-frequency updates.
No such change is implied by this document's classification mapping.

Additional existing fields must survive adoption. Apart from the explicitly
selected classification and codified-metadata mappings, they are not silently dropped or
converted to new nominal Types by this specification:

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

### 3.4 Observed write surfaces

The current installed descriptors do not supply a complete properties schema.
The table below comes from the actual Preview 2 decoders and native adapter paths,
not from assuming every serialized field has a setter.

| Surface | Admitted fields or behavior in inspected Preview 2 |
| --- | --- |
| Generic Issue create properties | title, description, priority, issue_type, design, acceptance_criteria, notes, spec_id, assignee, labels, estimated_minutes, external_ref, due_at |
| Generic Issue update/properties patch | title, description, design, acceptance_criteria, notes, spec_id, assignee, priority, estimated_minutes, external_ref, due_at |
| Status, labels, claim/heartbeat and lifecycle | Separate domain command/adapter paths; inclusion in a read record is not permission for a generic patch |
| Generic Dependency create | Current dep_type discriminator plus common endpoint/identity inputs; proposed mapping replaces that discriminator with concrete Type selection |
| Generic Dependency properties/metadata update | Not implemented by the inspected adapter |
| Observed complete Issue graph read | Native Issue projection, with metadata moved to envelope and Dependencies represented as Links/ownedLinks; comments are not hydrated on this path |

The observed create-only issue_type entry above is historical/current input
evidence, not an exception allowing it in proposed properties. The new adapter
must derive the native classification from the concrete Type reference. Broader
ordinary Issue command behavior remains valid evidence of product requirements,
but does not establish equivalent generic graph-write support.

**OPEN — properties replacement.** Current Preview 2 Issue replacement operates
on its eleven-field writable projection, not on every field emitted by an Issue
read. It requires title and priority, clears omitted writable strings to empty
and nullable estimate/external_ref/due to null, and preserves nonwritable state
through the native patch. This differs from the shared draft's literal whole-
properties replacement rule. We must reconcile generated/read-only fields and the
replacement boundary before claiming the new Issue Type contract is implemented.
This draft does not silently change the command or declare that discrepancy solved.

Writability belongs to a particular operation and surface; it is not inferred
from a JSON type or from whether a value happens to be stored. Exact common-field
write annotations, derived read schemas and the observation boundary are still
Type-system decisions. The full native field inventory and command/source evidence
are in the companion audit.

### 3.5 Reviewable core properties schema

Machine-readable artifact: [Issue properties schema](issue.properties.schema.json).
The block below mirrors that review artifact apart from document annotations;
[the artifact check](../../profiles/types/README.md#validation-limits-and-reproduction) prevents drift.

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
  "required": ["id", "title", "status", "priority"],
  "not": {"required": ["issue_type"]},
  "properties": {
    "id": {"type": "string", "minLength": 1},
    "title": {"type": "string", "minLength": 1},
    "description": {"type": "string"},
    "design": {"type": "string"},
    "acceptance_criteria": {"type": "string"},
    "notes": {"type": "string"},
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

Unknown properties remain legal in the shared open-root model, except the
removed issue_type discriminator. The explicit prohibition prevents an accidental
second classification authority. Derived work Types inherit this common schema;
no new subtype-specific field requirements are invented here. Current
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

**Inspected Preview 2 rule:** at most one native Dependency exists for an ordered
Issue pair, across all dep_type values. A→B and B→A are different pairs, subject
to the applicable cycle/hierarchy rules. This is neither a global maximum of one
outgoing Dependency nor one maximum for each kind. It does not prohibit a separate
informational Link alongside the Dependency.

### 4.2 Properties and metadata

| Item | Mapping and behavior |
| --- | --- |
| Classification | Proposed intrinsic Type reference; dep_type is removed from properties and translated to/from native Dependency.type |
| source/target | Common Link reference members, not duplicate properties |
| metadata | Native edge metadata carries application and sometimes workflow data; shared common-metadata mapping requires explicit preservation |
| thread_id | Existing conversation grouping field; portable placement is unresolved and must not be discarded |
| created_at/created_by | Existing row creation facts; migration into/alongside V2 needs a defined attribution mapping |

Native DependencyType.IsValid accepts a nonempty kind of at most 32 bytes. The preview
also checks UTF-8; an omitted create kind defaults to blocks. Unknown values can
be valid without being built-in. Both current graph CLI routes, bd dep add and bd link create, accept only
well-known kinds even though the storage adapter accepts more. Their help is not
proof of broader admission; the audit identifies the executable gates.
No scheduling or hierarchy effect is inferred for an unfamiliar value.

Machine-readable artifact: [Dependency properties schema](dependency.properties.schema.json).
The following open base fragment mirrors that artifact and does not invent the
remaining child-specific schemas or domain operation checks.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "not": {"required": ["dep_type"]},
  "properties": {},
  "additionalProperties": true
}
```

The 32-byte admission bound applies to the native classification label and its
adapter mapping; it is not a bound on the global Type URI. The inspected preview
exposes dep_type only, common metadata as an empty object, and no generic
Dependency properties/metadata editor. After the selected mapping, there are no
remaining currently projected Dependency-specific properties, so the proposed
base core properties object can be empty. It deliberately forbids dep_type.
The selected promotion of codified metadata adds properties to relevant child
definitions, such as waits-for; it does not make every child require those fields.
Native Beads can already carry edge metadata
and thread_id. This is a preview limitation, not evidence that those existing
requirements can be omitted from the eventual Type specification.

For example, waits-for metadata includes gate (all-children or any-children),
optional spawner_id, and optional also_blocks. The actual scheduling evaluator
reads gate and also_blocks; the latter preserves blocking when an additional
blocks edge would collide with pair uniqueness. Missing gate is treated as
all-children by current evaluation. This is executable domain meaning in metadata,
not an opaque annotation. **Selected direction:** promote these codified fields to properties of the relevant
Type, preserving their names and existing meanings. The native implementation may
continue storing them as metadata while the BDP adapter maps reads and writes.
Exact child schemas, omission/default rules and conflict handling remain to write;
this does not promote arbitrary metadata or select a new storage layout.

Native metadata is serialized JSON in a string field. Projection and migration
must account for malformed/non-object historical values, unknown metadata members,
and simultaneous old/new input. Do not silently lose data or expose independently
editable duplicate authorities. Preserve the existing gate evaluator behavior;
adding a schema does not itself implement that evaluator.

### 4.3 Endpoint admission and pins

| Surface / target | Source | Target | Pin / external behavior |
| --- | --- | --- | --- |
| Inspected Preview 2 graph Dependency | Live local durable Issue | Live local durable Issue | Floating endpoints only; external references refused |
| Existing ordinary Beads | Existing native Issue | Local Issue, or certain external/cross-repository references under existing rules | Native references are not BDP revision pins; known absent local targets are rejected |
| Proposed initial portable Dependency boundary | conforms to issue | conforms to issue | Preserve the local floating graph rule initially; remote and pinned workflow semantics require a separate decision |

Both endpoints must satisfy issue, directly or through pinned transitive
conformance (task, bug and the other children qualify). Per-child endpoint
restrictions, if any are later needed, conjoin with these base rules. Merely being
a Memory or sharing Issue-shaped properties does not establish issue conformance.
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

## 5. Dependency child Types and existing workflow behavior

The inspected built-in list contains nineteen Dependency kinds. The proposal
represents each as a Type conforming to dependency. Their behavioral differences
remain the existing ones below; conformance to the base does not make every child
a blocker. No additional hierarchy or new workflow is inferred.
The child definitions inherit the dependency properties schema; this draft does
not add per-child discriminator properties or invent additional fields. Existing
metadata-sensitive behavior remains part of the relevant child's semantic promise;
its codified fields will be projected as properties under the selected mapping.

| Proposed child Type | Existing role to preserve |
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
merely because they conform to dependency.

`ready` is not simply status=open or zero outgoing Links. Its current selection
uses blocked-state projection, status/category rules, defer time, context markers,
Issue classification and user filters. `blocked` is not simply status=blocked.
The exact implementation and its conformance cases remain the behavioral baseline;
this draft does not attempt to replace the detailed scheduler with a new short
formula. Standalone portable scheduling specification is still needed for a BDP
implementation claiming equivalent workflow behavior.

The existing [bd supersede command](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/docs/cli-reference/supersede.md)
closes the superseded Issue with a reference to its replacement. That is a command
workflow, not permission to close an Issue merely because a generic Link create
selects the supersedes Type. The preview descriptor expressly does not authorize
edge-plus-close. Nor is it equivalent to MemorySupersedes, whose proposal has no
automatic retirement. Preserve the exact native operation's direction and effects
when writing its adapter; do not infer them from an English verb.

## 6. Ownership, mutation and history

The proposed issue base owns its outgoing Links satisfying dependency, including
blocks, parent-child and the other conforming children. The current preview owns
the single nominal preview-dependency Type. That ownership selector must be
updated with the hierarchy; exact base-ID equality would lose child Links.
Transitive user-defined dependency conformers participate too; they cannot opt out
of this ownership match. Historical owned sets retain their recorded state.
It does **not** acquire Memory's wildcard
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

| Attempt | Existing native behavior | Inspected Preview 2 adapter |
| --- | --- | --- |
| Same pair, same kind, no durable data change | No new durable change/history | Existing Link returned unchanged |
| Same pair, same kind, metadata or thread changes | Native path can update the row and source history | No such inputs admitted; reassertion returns the existing Link unchanged |
| Same pair, different kind | Conflict; no implicit replacement | Conflict |
| Same pair, same kind, different requested canonical Link ID | Native pair identity is not a caller-selected BDP ID | Refuse; do not create a parallel Dependency |

Native thread omission preserves a stored thread rather than clearing it.
These distinctions matter for import and retry adapters.

Under this proposal, changing blocks to parent-child is an explicit Type change,
not an edit to dep_type. It must rerun scheduling, hierarchy, pair and metadata
rules and preserve native/catalog consistency. The inspected generic graph update
path does not implement this operation. An open schema or conformance declaration
does not supply that writer. Delete-old/create-new in a supported atomic batch
can replace a relationship but need not preserve its canonical Link identity.
The new shared design validates arity and pair-wise uniqueness at commit, across
the dependency conformance family. A temporary duplicate pair may be staged and
removed before commit. Timing of other domain checks remains a separate decision;
this is not a claim about the current Preview 2 implementation.

Current preview deletion refuses incident Links and requires explicit unlink;
it reserves deleted identities and retains earlier snapshots. The Memory proposal's
floating-Link cleanup and surviving historical pins are a different future
lifecycle design. Do not silently apply that proposal to workflow Dependencies or
claim restore/retention/erasure semantics are solved by these two Type definitions.

V2 revisionProvenance is the proposed destination for common revision writer,
commit time, assisting agent, message and sources. Activity records remain a
separate externally defined Bead Type. Native creation/close/session fields and
historical unknown values need a migration mapping; no actor authenticity can
be inferred from an existing string field. The current heartbeat path creates
no durable graph revision; the future
observation/revision contract is open. A claimed assignment is not proof of the
writer's identity.

## 7. Explicit nominal Type changes

Explicit Type changes may preserve identity under the shared design. Issue
and Dependency make the limits concrete:

- task→bug keeps issue membership but changes exact nominal affiliation and
  native classification. Preserve earlier revisions and owned Dependencies;
  validate the target definition and affected workflow atomically. No generic
  subtype write support is inferred from the current preview.
- GenericBead→an issue child needs valid Issue state, native identity mapping, lifecycle
  capability, configured classification/status admission, and the correct owned
  Dependency set. Copying a few JSON fields is insufficient.
- Issue→Memory needs validation of affected floating Dependencies. Any that still
  require Issue must be repaired or the transition refused. Existing pinned
  citations retain the earlier Issue state. Owned-set and operational-state
  transitions need explicit rules; this is not implemented by either adapter.
- GenericLink→a dependency child needs valid local Issue endpoints, pair uniqueness,
  cycle/hierarchy checks, metadata interpretation and source History integration.
- Dependency→informational Link changes both workflow participation and potentially
  source ownership. Recompute affected workflow state and preserve earlier
  revisions atomically; never retain a hidden blocking native row after retyping.

Every old revision keeps its original exact Type and state. Current queries use
the current revision's affiliation. Type updates do not automatically alter
reference pins or remote Scope tables. The shared draft now permits temporary arity violations inside atomic batch
and validates final arity. This does not promise that every other domain check
is deferred or that today's Preview 2 implements arbitrary ownership-changing
migrations. Type-to-native mapping must change atomically with the graph state.

## 8. Worked representation and acceptance cases

Illustrative proposed payloads, omitting common identity/revision/provenance
members where not needed. Placeholder definition pins are not version labels or
current preview wire syntax.

```json
{
  "type": {"uri": "https://example.org/types/beads/task", "revision": "task-definition-1"},
  "properties": {
    "id": "bd-repair",
    "title": "Replace the pump seal",
    "description": "Repair the leak before returning the pump to service.",
    "status": "open",
    "priority": 1,
    "assignee": "sam"
  },
  "metadata": {}
}
```

```json
{
  "type": {"uri": "https://example.org/types/beads/blocks", "revision": "blocks-definition-1"},
  "source": "https://example.org/work/beads/bd-repair",
  "target": "https://example.org/work/beads/bd-delivery",
  "properties": {},
  "metadata": {}
}
```

The task definition in the first example owns a ConformsTo Link pinned to an
issue definition revision; blocks in the second owns one pinned to dependency.
These declarations belong to the definition revisions, not the instance records.
The schemas and other constraints are descriptor fields. Production definition
IDs, metatypes and the remaining reference syntax still need the shared format.

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
| I04 | Configured custom native classification/status | Preserve requirement; classification needs registered Type mapping, status remains policy-sensitive |
| I05 | status=closed without closed_at | Reject under native validator; do not infer timestamp on a raw saved-state read |
| I06 | Custom done-category status | Apply its actual contract; do not pretend it equals literal closed |
| I07 | Heartbeat advances lease time | Existing build keeps graph revision; future observation placement/revision behavior remains OPEN |
| I08 | Source Issue adds Dependency | Link and source owned state/history change atomically |
| I09 | Issue adds informational Related | Do not acquire wildcard ownership or scheduling effect |
| I10 | New arbitrary Issue property | Open-root schema is insufficient; writer preservation/admission support must be declared |
| I11 | Current --replace-properties omits nonwritable Issue fields | Existing writable-projection replacement preserves them; shared whole-properties replacement boundary requires explicit reconciliation |
| D01 | Add blocks A→B | A depends on B; B is prerequisite |
| D02 | Add parent-child C→P | C is child, P parent; preserve hierarchy validation |
| D03 | Add same pair/same kind unchanged | No new Link or source revision |
| D04 | Add same pair/different kind | Current preview conflicts immediately; proposed batch permits temporary duplication but rejects a duplicate at commit |
| D05 | Native same-kind re-add changes metadata | Preserve mutation/history semantics; preview cannot claim this editor |
| D06 | Add different pairs A→B and A→C | Pair uniqueness alone permits both; applicable total maxima and workflow checks still apply |
| D07 | Dependency endpoint has no issue conformance | Reject endpoint mismatch; task/bug children qualify |
| D08 | Dependency targets exact old Issue revision | Current graph contract refuses; portable workflow pin behavior undecided |
| D09 | Unknown valid short dependency classification | Existing admission may accept; proposed mapping needs a defined Type, never a guessed URI or invented scheduling effect |
| D10 | Self-edge or prohibited mixed scheduling cycle | Reject atomically through domain validation, not endpoint lists alone |
| D11 | Native waits-for metadata also_blocks=true | Project codified fields as properties and map writes back; preserve gate/blocking semantics and unknown metadata |
| D12 | Add informational supersedes relation | Do not infer a close operation; bd supersede is a separate workflow |
| D13 | Attempt second pair edge with another nominal definition revision | A new definition pin must not evade pair uniqueness; final state cannot retain both |
| D14 | Custom dependency label through current graph CLI | Both dep add and link create reject unknown kinds despite wider storage admission; proposed mapping must distinguish surfaces |
| T01 | Issue→Memory with floating incoming Dependency | Refuse unless explicit valid repair is part of the transition |
| T02 | GenericLink→Dependency collides with occupied pair | Reject atomically; kind label or a fresh Link ID creates no extra slot |
| T03 | Dependency retyped to informational Link | No hidden native blocker remains; shared atomic migration capability required |
| T04 | Install revised Type definition | Existing instances retain exact affiliation; no implicit migration |
| T05 | Read a native task as the proposed graph record | task Type pin; no issue_type property; issue membership follows declared conformance |
| T06 | Read native blocks as the proposed graph Link | blocks Type pin; no dep_type property; endpoints and direction unchanged |
| T07 | Query for objects satisfying issue or dependency | Include conforming child Types; exact base nominal equality is insufficient |
| T08 | Update task to bug | Explicit Type update plus native-classification change atomically; no independently editable discriminator |
| T09 | Replace task properties with an issue_type member | Proposed schema rejects the duplicate classification field |
| T10 | Replace blocks properties with dep_type | Proposed schema rejects the duplicate classification field |
| T11 | Same pair has blocks then attempts parent-child | Preserve dependency-wide uniqueness across child Types and pins |
| T12 | Ownership evaluates an Issue source's outgoing blocks Link | Count/own through dependency conformance, not only exact base ID |
| T13 | Historical record predates the hierarchy | Preserve original representation meaning; conversion requires explicit compatibility mapping |
| T14 | Only heartbeat observations change between reads | Observe existing same-revision behavior; do not infer a selected future query-time revision policy |
| T15 | A custom native classification has no registered Type mapping | Explicit unresolved-mapping outcome needed; no silent fallback or guessed global identity |
| T16 | Read task@t1 after the current task definition changes its conformance | Follow task@t1's recorded owned declarations and exact target pins; do not use current adjacency |
| T17 | Edit a ConformsTo declaration on the task definition | Create definition-owner revision effects; existing task instances retain their affiliation and state |
| T18 | Record a later review of the blocks-to-dependency declaration | An Activity may target the exact declaration Link revision without changing the definition |
| T19 | Display the definition hierarchy with a generic graph viewer | Actual ConformsTo Links can supply edges; current and historical views require distinct qualification |
| T20 | Traverse a work Issue's incident Links | Do not synthesize a Link from its type field or include definition declarations as work Dependencies |
| T21 | A declaration connects task to dependency | Reject cross-kind conformance even though both endpoints are definition Beads |
| T22 | A specialized ConformsTo relation adds evidence requirements | Preserve the full base promise; do not reinterpret workflow or allow conditional membership |
| T23 | Encode Issue/Dependency schemas and graph constraints | Keep descriptor fields; no separate Schema/Constraint Beads or new domain limits implied |

## 9. What this teaches us about the shared Type system

| Finding | Issue/Dependency evidence | Consequence for Type design |
| --- | --- | --- |
| Classification becomes Type affiliation | Native issue_type and Dependency.type select domain behavior | Explicit type mapping and subtype registration must preserve those behaviors without duplicate property discriminators |
| Pair uniqueness differs from endpoint arity | One Dependency per ordered pair, many pairs per Issue | Shared Types now selects optional family-wide ordered-pair uniqueness at commit; concrete descriptor syntax remains open |
| Graph validity is richer than endpoint Types | Mixed cycles, hierarchy and waits-for gates | Separate declarative shape/endpoint/count checks from domain operations; do not invent a universal workflow engine inside Type definitions |
| Codified metadata becomes properties | waits-for gate and also_blocks are read by scheduling | Promote named semantic fields into the child Type schema; adapters may preserve metadata storage and must avoid duplicate authorities |
| Shape validity is not write capability | Native adapters admit bounded fields and operations | A Type definition cannot imply every generic writer can persist or execute its contract |
| Immutable revisions need a clear state boundary | Live lease fields vary under the same current graph revision | Distinguish durable versioned state from operational observations before claiming complete immutable representations |
| Validation can depend on Scope policy | Custom kinds/status categories are configured | Name configuration dependencies and policy tightening explicitly; decide what must be versioned or pinned for reproducible historical interpretation |
| Storage bounds are not interchangeable | Byte limits, code-point limits, SQL integer limits | Preserve exact units and reject lossy conversion; JSON Schema alone may not encode all native admission checks |
| Type changes can transfer responsibility | Retyping Dependency changes workflow and Issue ownership | Require explicit adapter participation and atomic state migration, not just changing a type field |
| Catalog installation is not implementation | Preview descriptors name contracts whose enforcement lives in native writers | Declare capability and enforcement obligations without falsely advertising executable behavior from a descriptor alone |

These are inputs to the shared Types specification, not decisions that every
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
| issue/dependency bases with conforming classification Types | Intrinsic classification Types settled at product level; Preview 2 CLI shims expose the direction | Underlying implementation planned for Preview 3 Friday October 16; qualify delivered IDs, pins, conformance, registrations and adapter mapping when available |
| Definition representation and conformance hierarchy | Selected representation; candidate Type/ConformsTo schemas and eight-definition fixture linked from §2 | Metatype/bootstrap approval, exact IDs, historical traversal, editing/provenance and viewer qualification NYI here |
| Ordinary content, status and classification | Existing behavior inventoried; linked and embedded machine-readable base schema fragments | Full durable-field and child schemas plus configuration-dependent validation contract |
| Dependency direction, pair uniqueness and kind roles | Existing behavior documented | Portable invariant/admission encoding; no implicit new maximum syntax |
| Local floating endpoints | Current graph behavior documented; proposed initial boundary | Decide pins and remote workflow separately |
| Edge metadata/thread data | Codified semantic metadata selected for property promotion; preview gap explicit | Child schemas and lossless adapter mapping; thread placement and unknown metadata preservation still open |
| Ownership and source History | Source-backed preview behavior | Complete capability/History qualification and final limit policy |
| Scheduling and lifecycle | Existing implementation remains behavioral baseline | Standalone portable operation specification and conformance cases; not replaced by schema fragments |
| Revision provenance | External V2 direction | Legacy timestamp/actor mapping, authenticated service attribution and integration |
| Leases and derived projections | Stored heartbeat versus computed views distinguished | Observation placement and revision policy remain OPEN |
| Properties replacement | Preview uses writable subset; shared draft says whole properties | Reconcile read-only/generated fields and preserve existing command behavior until a deliberate migration |
| Explicit Type changes | Proposed use cases and refusal conditions | Migration/ownership/adapter transaction mechanism NYI here |
| Beads CLI and storage | Existing writers are referenced, not rewritten | Command parity and migration belong to their workstreams |

This draft is ready to mark up beside Memory. It is intentionally not advertised
as a complete installable Type package or full product parity: the unresolved
mapping of operational fields, edge metadata, configuration and domain operations
is exactly what this exercise is meant to expose while we complete the shared Type system.
