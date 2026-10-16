# BDP Types

Work-in-progress design specification, October 15, 2026. This document records agreed design rules and
explicit open decisions for an optional, Scope-wide Types profile. It is not yet
an adopted protocol specification, an installable definition format, or a claim
that Beads implements these rules. The [current BDP specifications](../../README.md)
remain the protocol authority until coordinated amendments land. Landing this
document on main makes the evolving design available for collaboration; it does
not adopt its candidate wire shapes or require implementation of unfinished rules.

The [Issue and Dependency draft](../../types/issue/issue.md) and [Memory draft](https://github.com/gastownhall/bdp/pull/143)
provide requirements and acceptance scenarios. Issue/Dependency records the
selected product hierarchy of classification Types conforming to issue/dependency.
Memory is being reconciled and reviewed separately in PR143; this document does
not silently settle its remaining shared-design questions. The earlier [Type lifecycle exploration](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-lifecycle-preview2.md)
is background. Where it conflicts, this document records the current design
position: this Types profile represents definitions as Beads; Core does not
require that representation.

## 1. Scope and responsibilities

Core defines the common Resource envelope, references, revisions, ownership
behavior and recognizable constraint errors. A Type reference is required even
when a Scope does not implement the Types profile. Core may enforce native
constraints without resolving a Type definition. Core defines the Type reference's
representation and handling without requiring that its target be a Bead. It does
not prescribe a Type-description language or the conformance semantics of this
profile. An alternative typing profile may define a different interpretation and
description format while preserving Core's Resource and reference contracts.
Advertising this Types profile, however, promises this profile's semantics.

The optional Types profile applies Scope-wide. Advertising it promises that all
Bead and Link affiliations follow its rules. It supplies definition and conformance
semantics, properties validation, and eventually declarative graph constraints.
Read-only implementations can support it; its write obligations apply when writes
are supported. A client need not understand Type definitions to read the graph.

Types depends on Core, not Write. Write depends on Core, not Types. Domain Type
specifications depend on Types and Core and describe conditional write obligations.
The agreed Write direction is atomic individual writes and optional, always-atomic
batch. Non-atomic sequence is excluded from that proposed direction. Changing the
existing Write profiles, moving Events, and extracting Core/Write documents are
separate work; this draft does not direct changes to active implementations.

BDP owns shared meanings and acceptance outcomes. Beads owns CLI affordances,
storage, indexes, installation UX and operator workflows. The examples below use
CLI terminology only where it clarifies a shared semantic requirement.

## 2. Definitions, identity and affiliation

A Type definition has a stable identity, an immutable revision, a properties
schema, and semantic promises. It describes Bead or Link instances. Its schema
applies to the instance's `properties`, not to the whole common Resource envelope.
Within this profile, a Type definition is represented as a Bead. The instance's
Type reference is interpreted as a Bead reference to that definition; its identity
and revision identify the definition Bead and the selected Bead revision. The
candidate definition fields and a bootstrap proposal appear in §§2.1–2.3; their
unresolved choices remain marked for review.

Affiliation remains the distinguished `type` field on each Bead and Link; it is
not represented by a Link to the definition Bead. Following ordinary incident
Links does not implicitly follow this field into the Type graph. A Type-definition
Bead may participate in explicit graph Links like other Beads, but an instance's
reference to it does not create an edge, ownership or access permission.

An instance saved under the Types profile pins its exact Type definition revision.
Explicit floating Type input resolves before commit; an omitted Type on update
preserves the existing exact affiliation. Supplying a Type reference replaces
that reference as a whole, rather than merging its identity and revision members.
An explicit change of Type or Type revision must validate with the resulting
properties and other applicable constraints, or the change fails atomically.

Both Bead-Type and Link-Type definitions are represented as Beads. A Bead that
describes a Link Type is itself a Bead; the Type it describes governs Link
instances. This representation does not create conformance between the Bead-Type
and Link-Type worlds. Choosing Beads for definitions does not yet settle the
remaining bootstrap mechanics, installation controls or retention rules. The
foundation categories and publication-authority decisions are recorded in §§2.1–2.3
and §7.2.

Apart from owned conformance declarations, the Type contract is represented by
fields in the Type-definition Bead's `properties`. This includes the embedded
JSON Schema, endpoint eligibility, incoming/outgoing arity, pair-wise uniqueness,
ownership declarations and other descriptor information. Their precise field
names and schemas are drafted in §2.1 and remain subject to review. Ordinary
changes to those fields produce a
new definition-Bead revision, while its owned conformance Links are covered by
that same revision's recorded owned state.

No separate Schema or Constraint Beads, or Links to such resources, are introduced
by this design. Independent factoring can be revisited if a concrete requirement
emerges; it is not needed to complete the current profile. Schema reference and
dependency-resolution rules still require definition and must preserve immutable
meaning; embedding the schema does not by itself settle those rules.

The representation boundary is:

| Information | Authoritative representation |
| --- | --- |
| An instance's affiliation | Distinguished `type` field, pinned to a definition Bead revision under this profile |
| The definition Bead's own affiliation | Its own `type` field; Type metatype and bootstrap candidate in §§2.1–2.3 |
| Direct conformance declarations | Owned ConformsTo Links, recorded with the source definition revision |
| Properties schema and other constraints | Fields in the definition Bead's `properties`; candidate schema linked from §2.1 |
| Later review of a declaration | An independent Activity under Provenance V2, referencing the declaration Link revision |

The current direction uses Type-to-Type conformance for reusable structural and
semantic promises. A separate Capability entity is not required by the rules
below; it should be introduced only if a distinct requirement warrants it.
"Capability" in Scope feature discovery is not this Type conformance relation.

### 2.1 Type, BeadType and LinkType

The profile defines three Bead Types: **Type**, **BeadType** (`bead-type`) and
**LinkType** (`link-type`). BeadType and LinkType each declare conformance to Type.
An instance of LinkType is a Bead defining a Link Type; it is not itself a Link.
The common Type contract supplies description, properties schema and
ownership of outgoing ConformsTo declarations. Category-specific schemas supply
Bead participation/ownership rules or Link endpoint/graph constraints.

The descriptor **is the definition Bead's properties object**. Consequently the
properties schema of Type is the common descriptor schema; there is no additional
independent descriptor-schema layer. The envelope supplies identity, revision,
affiliation, recorded owned state, metadata and revision provenance.

| Definition Bead | Own affiliation in the candidate seed | Direct conformance |
| --- | --- | --- |
| Type | BeadType | None |
| BeadType | BeadType | Type |
| LinkType | BeadType | Type |
| ConformsTo | LinkType | None |
| issue / task | BeadType | task declares issue |
| dependency / blocks | LinkType | blocks declares dependency |

Own affiliation answers what this definition Bead is; outgoing ConformsTo Links
answer what the instances it defines must satisfy. In particular LinkType's
conformance to Type is between two Bead Types, not cross-kind conformance.
Category is derived from affiliation/conformance to BeadType or LinkType, not a
second writable `describes` discriminator. Admission must reject ambiguous
membership in both categories. How direct common-Type instances are treated is
still open; the candidate uses the category-specific affiliations for usable definitions.

Candidate schemas:

- [Common Type properties](type-definition.properties.schema.json).
- [BeadType properties](bead-type-definition.properties.schema.json).
- [LinkType properties](link-type-definition.properties.schema.json).

The latter two schemas include the common schema and add category restrictions.
Their `$ref` factoring is repository authoring; published immutable schema
closure/resolution still requires lifecycle rules. The [schema notes](README.md)
record the starting descriptor and the candidate changes.

| Descriptor property | Candidate structure and meaning |
| --- | --- |
| `description` | Optional semantic documentation; canonical identity comes from the Bead ID |
| `propertiesSchema` | Required embedded JSON Schema applying to described instances' properties |
| `version` | Optional proposed SemVer label; author information, not a revision or conformance proof |
| `incoming`, `outgoing` | Bead-only participation rules with Link-Type selectors and minimum and/or maximum |
| `ownsOutgoing` | Bead-only Link-Type selectors; ownership is distinct from count limits |
| `linkConstraints.typeConstraints` | Link-only nonempty list of endpoint pairs; any pair may match; each side has an OR array of Type references or a lone wildcard |
| `linkConstraints.sourceMax`, `targetMax` | Optional nonnegative maxima per source/target identity, across all alternatives |
| `linkConstraints.unique`, `acyclic` | Optional family-wide ordered-pair uniqueness and directed acyclicity |

Names/requiredness and endpoint resource/scope spellings remain review syntax.
The pair-list/OR-array model and shared constraint population are selected design.
An absent or false boolean adds no local restriction; it cannot remove inherited
restrictions. Duplicate envelope fields, `describes`, old independent source/target
fields and a competing descriptor `conformsTo` field are prohibited in this candidate.
Roots remain open for extensions, without assuming unknown semantics are implemented.

Type owns ConformsTo; BeadType and LinkType inherit this behavior. That governs
**definition Beads**. A descriptor's own `ownsOutgoing` instead governs the instances
it describes. Neither rule synthesizes affiliation edges in the ordinary graph.
Passing a properties schema does not establish semantic compatibility, valid
conformance closure, supported constraints, category agreement or admission for use.

### 2.2 The ConformsTo Link Type

**ConformsTo** is defined by a Bead affiliated with LinkType. Its endpoint
alternatives are `(BeadType → BeadType) OR (LinkType → LinkType)`. The source and
target must match the same alternative; independently allowing both categories
on both sides would wrongly admit cross-kind declarations.

| Aspect | Contract |
| --- | --- |
| Direction | Source definition declares conformance to target definition |
| Source | Declaration belongs to the source definition revision's recorded owned state |
| Target | Exact pinned definition revision; no floating target in a stored declaration |
| Kind agreement | Both definitions belong to the same category; enforced through endpoint pairs and semantic admission |
| Meaning | Every valid source-Type instance satisfies the target's structural, semantic and explicit behavioral promises |
| Inheritance | Transitive and acyclic over exact definition revisions; all inherited requirements apply |
| Ownership | Through the common Type contract; mutations have source revision effects |
| Provenance | Common Link revision provenance; later Activities may reference the exact declaration revision |
| Specialization | Additional requirements/evidence may only tighten the base promise |

The [ConformsTo properties schema](conforms-to.properties.schema.json)
is an open object with no required relationship-specific fields. No conditional
membership, confidence or method semantics are invented. No arbitrary maximum or
pair-uniqueness rule is added: multiple direct declarations with independent
evidence still need a policy.

General identity-based `acyclic` (§5.8) and exact-revision conformance cycle checks
are different. The example deliberately does not turn on the general constraint:
it would prohibit T@2 → T@1 as an identity self-loop, deciding part of the deferred
revision-evolution question. Exact-revision cycles remain prohibited. This corrects
the earlier illustrative suggestion to set `acyclic: true` directly on ConformsTo.
Source-pin operation details and cross-Scope definition installation remain open.
Stored target pins are an intrinsic ConformsTo semantic requirement, not a generic
endpoint pin-mode constraint added to the descriptor language.

### 2.3 Literal graph and bootstrap candidate

The [foundation graph](definitions.json) contains eight
illustrative definition Beads and four owned declarations: BeadType→Type,
LinkType→Type, task→issue and blocks→dependency. All affiliations and declaration
targets pin revisions. Schema copies match the adjacent artifacts.

Type, BeadType, LinkType and ConformsTo are the intrinsic bootstrap definitions.
They are supplied by the implementation and cannot be updated or removed through
ordinary Scope operations. They need an explicit trusted bootstrap boundary.
The candidate affiliates all three metatype definitions with BeadType; BeadType
therefore pins itself. These definition-reference dependencies are not conformance
cycles. This supersedes the earlier lone self-typed Type seed. Ordinary create
cannot be assumed to know its future opaque revision. Seed establishment,
trusted installation mechanics, revision allocation, binary-upgrade coordination
and production identities remain proposals/open decisions. This does not reopen
ordinary client mutation of intrinsic definitions.

This file is a **literal final-state example**, not a BDP transaction, installation
API or package format. Its revision strings are illustrative, not permission for
clients to assign server revisions. The separate packaging requirements are in §7.1.

## 3. Conformance in plain language

If **ApprovedProduct conforms to Product**, every valid ApprovedProduct must also
be a valid Product, with the same meanings for shared fields. The reverse need
not hold. Conformance is directional. It describes the effective definition,
including all inherited requirements, not the author's local schema in isolation.

Bead Types and Link Types are non-intersecting. A Bead Type may conform only to
Bead Types; a Link Type may conform only to Link Types. Reject a cross-kind
conformance declaration, even if the property schemas happen to be identical.
Reusing a property schema does not establish Type membership across these worlds.

### 3.1 Structure and meaning both count

If Product says `price` is measured in US dollars, ApprovedProduct cannot interpret
that field as cents. Matching JSON shapes are not enough. An author asserting
conformance is responsible for all inherited semantic promises, including those
that no validator can mechanically prove.

Machine-readable units or other semantic declarations can help detect conflicts
only when the Type system defines their interpretation. An arbitrary annotation
is not automatically an enforced constraint. The vocabulary and required checks
for such declarations remain open.

### 3.2 All requirements apply together

ApprovedProduct must satisfy its own schema and every schema it transitively
conforms to. No schema overrides another. Inherited requirements become part of
the effective definition; authors need not repeat them in their local schemas.
This is conjunction of requirements, not a field-by-field merge with precedence.

If the requirements cannot be satisfied together, the definition is invalid.
This validity rule does not claim that an implementation can decide every possible
schema or semantic contradiction. Required admission checks, supported schema
features and handling of contradictions that cannot be established mechanically
remain to specify.

When inherited schemas give the same optional property disjoint allowed values,
the combination may still be valid by omitting that property. For example, A
permits an optional string `code` and B permits an optional numeric `code`. A Type
conforming to both may omit `code`, but cannot supply any value for it. Allow this
combination with a warning identifying the unusable property, provided omission
satisfies the other requirements. The warning does not relax instance validation.
If either schema requires `code`, no value can satisfy both and the combination
is invalid. Other requirements that force the property to be present have the
same effect. This does not promise complete mechanical contradiction detection.

### 3.3 A conforming Type may add requirements

ApprovedProduct may require an `approvalCode` or restrict `price` to nonnegative
numbers. Its valid records are a subset of those Product accepts. Additional
requirements must also preserve Product's semantic promises.

A reusable Product definition that permits an optional property may be refined
by requiring that property. A definition requiring a property cannot be refined
by allowing it to disappear: the effective inherited requirement still applies.
Absence and JSON null are different states and must be specified separately.

### 3.4 The parent must allow additional properties

Product must permit `approvalCode` for ApprovedProduct to add it. A Product schema
that forbids every property it does not name prevents a conforming Type from
introducing new properties. A schema that restricts additional properties also
constrains those introduced by conforming Types.

Reusable Types should normally leave room for extensions. Closure remains an
explicit author choice. ApprovedProduct may itself be closed if the resulting
records satisfy Product; that closure then limits further extensions of
ApprovedProduct.

Exact schema composition must preserve these meanings. JSON Schema closure
keywords have different scopes; merely placing schemas beside one another must
not be mistaken for overriding a parent's closed-record rule. Composition syntax,
reference resolution and closure examples remain specification work.

### 3.5 Read compatibility does not guarantee write acceptance

A Product-aware reader may interpret an ApprovedProduct. A Product-aware writer
may propose a change that violates ApprovedProduct's additional requirements.
Validate the resulting state against the instance's actual, exact Type revision,
including inherited requirements and applicable graph constraints. Reject an
invalid change atomically; do not partially change the record or ownership state.

Use revision preconditions when a write depends on previously read state. The
exact protocol spelling remains owned by the Write contract. No implicit Type
upgrade occurs merely because the caller updates properties.

### 3.6 Targeted changes and replacement have different responsibilities

A targeted change preserves properties it does not change. Updating `title` can
preserve an unfamiliar `approvalCode`, although the result must still validate.

The proposed full-properties replacement operation supplies the whole new
properties object. If `approvalCode` is mandatory, omitting it fails.
The server must not silently retain it and turn replacement into a merge.
A client knowing only Product cannot assume it can create or replace an
ApprovedProduct. Reading and preserving unfamiliar fields can help, but does not
establish that an arbitrary change will be valid.

This is the shared design rule, not a claim that the current Beads CLI already
implements it. The inspected Issue `--replace-properties` replaces a writable
subset and preserves nonwritable fields. The [Issue draft](../../types/issue/issue.md#34-observed-write-surfaces)
records this discrepancy; the boundary for generated/read-only properties remains
an explicit decision before implementation alignment.

### 3.7 Behavioral promises must survive conformance

A schema permitting numeric prices in stored records is not a promise that every
price-changing operation succeeds. ApprovedProduct may narrow those stored values.
But if Product explicitly promises that a particular operation is supported under
stated conditions, ApprovedProduct cannot claim conformance while withdrawing that
promise under those conditions. Preserve authorization and other stated operation
preconditions; conformance grants no permission to write.

Schemas describe valid states. They do not by themselves describe every guarantee
about state transitions. Generic writes are validated attempts unless the semantic
contract supplies a stronger guarantee. No new operation-description language is
selected by this draft.

### 3.8 Exact revisions and transitive requirements

Conformance declarations pin exact definition revisions. If T@1 conforms to A@2,
and A@2 conforms to B@3, T@1 must satisfy both A@2 and B@3. Later revisions of A or B
do not change T@1. Changing declarations or adopting newer definitions requires a
new Type revision and is not automatically compatible.

The implementation resolves the transitive closure; authors declare direct
relationships and callers need not enumerate inherited relationships. Exact
required definitions must be available before a Type is accepted for use. This
requirement does not select an installation mechanism or storage layout. Normal
validation and matching should not depend on a fresh network fetch.

A Type may reach both C@1 and C@2 through different paths. It then promises both,
not whichever is newer. If their requirements conflict, the Type cannot fulfill
its declarations.

Conformance must be acyclic. Reject a direct self-reference or an indirect chain
that returns to the same exact definition revision. Check the complete conformance
graph before accepting a Type for use. Multiple paths to a shared ancestor are
not, by themselves, a cycle; diamond conformance remains permitted. This rule
concerns conformance declarations, not recursive references within a JSON Schema.
The required handling of repeated paths remains to specify.

### 3.9 Conformance qualifiers may only tighten

A qualifier or specialized conformance relationship may add requirements or
stronger guarantees, but may not weaken the base conformance promise. Every valid
source-Type instance must still satisfy the target Type's full structural and
semantic contract, including any explicit behavioral promises.

For example, a qualifier restricting price to at most 100 may become an additional
enforced requirement of the source Type's effective definition. It may not leave
higher-priced instances valid under that source Type while excluding them from
its declared conformance. Evidence, review or confidence annotations do not relax
the promise or turn membership into a probabilistic result.

A specialized Link Type that conforms to the base ConformsTo Link Type must
preserve this same promise. Qualifier syntax and execution remain to specify.
A consumer recognizing the base relationship can rely on the base promise; that
does not imply it can validate additional requirements it does not understand.

### 3.10 Conformance declarations are owned Links

Direct conformance declarations are represented by owned ConformsTo Links from
one Type-definition Bead to another. The source declares conformance to the exact
pinned target definition revision. Conforming specializations of ConformsTo also
participate, under the tightening-only rule in §3.9 and transitive ownership
matching in §5.7. The name here describes the selected relationship; production
identity and bootstrap remain open; §2 supplies a candidate properties schema
and seed definition.

The authoritative declarations for T@r are the Link records captured in that
exact Type-definition Bead revision's owned-Link state. Creating, modifying or
deleting a declaration has Core ownership revision effects on its source. Older
Type revisions retain their recorded declarations. Unrelated assertions or Links
stored elsewhere do not alter that owned state or the Type's contract. There is
no separately writable conformsTo field competing with these Links.

Resolve conformance using exact definition revisions at every step: follow the
recorded Link revision and its pinned Link-Type definition, follow its pinned
target, and then inspect that target revision's recorded owned declarations.
For T@3 → A@2 → B@1, later changes to A do not change T@3's conformance. Live
adjacency or ordinary identity-based incident-Link listing cannot substitute for
this historical traversal. Missing required records do not permit falling back
to newer revisions. Source endpoint pin syntax and the traversal API still need
to express this recorded-state authority without conflating it with live incidence.

Each declaration is a first-class Link with its own identity and revisions. Under
Provenance V2, its revision provenance can record the declaration's author and
sources; later Activity records can refer to the exact Link revision without
changing it. Editing the declaration itself creates owner revision effects;
recording an independent Activity does not. Provenance supplies evidence about a
claim, not proof that its semantic promises hold.

Both endpoints are definition Beads, but their described instance kinds must
agree: no Bead-Type-to-Link-Type conformance. The metatype pair constraint is specified in §2; bootstrap mechanics
remain open. Existing acyclicity, exact dependency availability, inherited validation
and authorization requirements remain applicable. JSON Schema and other constraints
remain descriptor fields as specified in §2. Selecting owned conformance Links
does not establish that existing traversal implementations already support the
required historical walk.

### 3.11 Evaluate conformance Links before extending the pattern

ConformsTo is a bounded first use of relationships between definition Beads. It
is selected for this draft so we can evaluate ordinary Link editing, declaration
provenance, specialization and graph display together. It is not a decision to
represent every constraint as a Link. Link constraints remain descriptor fields;
possible later reuse of the pattern is a hypothesis to test.

A general Bead/Link viewer can display an exposed Type hierarchy using the actual
ConformsTo Links without understanding their semantic contract. This is a benefit
of the representation, not a claim that today's `bd graph` is qualified against
this future catalog. A current-state view and the exact historical hierarchy of
T@r are different views; the latter requires §3.10's recorded-state traversal.
Instance traversal does not implicitly enter either hierarchy through `type`.

Evaluation should cover editing and retracting declarations, recording later
reviews without altering history, displaying specialized ConformsTo Links, and
reading historical closures after current declarations change. Measure query and
index behavior rather than assume Links are faster than indexed fields. Bootstrap,
publication/transaction behavior and retention must also be made concrete before
claiming implementation readiness. An unfavorable result is reason to revisit the
representation deliberately, not to maintain two writable declaration authorities.

## 4. Conformance is not revision compatibility

A new revision is not automatically compatible with an old one. Review each
promised direction separately:

| Question | Example of a breaking change |
| --- | --- |
| Can the new definition accept old valid records? | Adding a mandatory field |
| Can old readers correctly interpret new valid records? | Allowing a previously mandatory field to disappear |
| Do existing promised write operations still work? | Prohibiting a value an operation previously promised to accept |
| Do shared fields retain their meaning? | Changing dollars to cents |

Conformance allows a more specific Type to impose additional requirements.
Revision compatibility asks which guarantees a changed definition preserves for
existing data, readers and writers. Adding a required field may be valid
conformance while breaking old-data acceptance as a revision change.

The earlier lifecycle draft explores a strong compatibility-family promise.
Whether to retain that exact promise, how to express it, SemVer labels, and whether
matching ever follows a compatibility claim remain explicit decisions. An exact
conformance pin does not silently match another revision through SemVer or age.

### 4.1 Proposed informational version label

An optional descriptor `version` may carry SemVer syntax, such as `2.1.0`.
The author supplies it; the immutable Bead revision remains the exact identity of
recorded content. It is not an alias, matching rule, installation selection rule,
conformance proof or automatic upgrade instruction. Compatibility must include
meaning and behavior as well as structure (dollars versus cents, for example).
The [SemVer specification](https://semver.org/) requires a declared public contract;
this profile still needs its precise compatibility promises. Syntax checking alone
cannot establish that an author's version increment is truthful.

The field and its spelling are review proposals. Whether a published label must
uniquely name one definition revision is left to publication/lifecycle design;
no uniqueness rule or version-range resolution is introduced here.

### 4.2 Exact and identity-wide Type selectors

A pinned constraint `Product@r1` matches nominal affiliation with that exact
revision or transitive conformance to that exact revision. Product@r2 does not
match merely because it has the same identity, a higher version or a SemVer label.
An unpinned constraint `Product` matches any revision of that identity, or a Type
whose exact conformance closure includes any revision of that identity. It never
means “resolve latest each time validation runs.” The predicate is stable even
though future incompatible revisions can satisfy it by identity. Use a pin when
the relationship relies on a particular structural/semantic contract.

This selector rule does not change storage of affiliations or ConformsTo targets:
those still pin exact revisions; explicit floating author input resolves once
before commit. Constraint selectors may intentionally remain identity-wide.
Nominal-only query filtering is a distinct operation; it must not accidentally
acquire conformance matching just because both accept Type references.

## 5. Endpoint constraints and arity

These rules apply within the separate Bead-Type and Link-Type worlds under the
same structural and semantic conformance principles. Cross-kind conformance is
forbidden. Examples below are conceptual, not selected wire syntax.

### 5.1 Endpoint eligibility is a union of pairs

Each local endpoint constraint is a nonempty list of allowed pairs. A Link must
match at least one pair, and both endpoints must match **that same pair**. Within
each side, a nonempty Type-reference array means OR. `['*']` means no Type
restriction and the wildcard must appear alone. Actual JSON uses double quotes.
Each non-wildcard entry may be a floating Type reference or `{uri, revision}`;
matching follows §4.2. These are pins on
**Type references**, not requirements that endpoint references be pinned.

```text
ConformsTo:
    (source [BeadType], target [BeadType])
 OR (source [LinkType], target [LinkType])

Example:
    (source [Issue, Activity], target [Memory])
 OR (source [Decision], target [Issue, Memory])
```

Each side's array is independent within a pair: `[A,B] → [C,D]` permits all four
combinations. Separate pairs preserve correlations. Source-only restrictions use
a wildcard target. Explicit AND/NOT/exact-affiliation operators remain deferred.

Every inherited **list** applies conjunctively. Do not concatenate inherited
lists into a larger OR. Broad local declarations may warn but cannot widen an
inherited requirement. For example `(Issue|Memory) AND (Memory|Activity)` can
match Memory or a Type conforming to both Issue and Activity; it must not be
simplified to nominal Memory alone. Impossible effective contracts are rejected.

The candidate endpoint object holds `resourceKind`, `scope`, and `types` (the
array). Local Bead endpoints may impose Type requirements. Scope spellings
`same`, `cross`, `either` and resource kind spellings remain proposals. A general
external `resource` arm is opaque and carries no Type requirement. Link endpoints
are not enabled by this Type-profile syntax; their admissibility is a Core question.

**No validation of external resources is required or promised.** The Scope may
inspect reference syntax and Scope addressing but does not fetch to establish a
remote Type, existence, content or immutability. External resources may change
without notification. An external-capable arm therefore cannot claim a specific
Type requirement: the candidate requires wildcard Types for cross/either Bead
references and prohibits `types` on an opaque resource arm. Unknown is not proof
of conformance. Reference classification/canonicalization needs precise Core rules.

Arity, uniqueness and acyclicity apply across the combined family, not separately
per alternative. One Link matching multiple alternatives counts once per rule.
No generic endpoint `pinned`/`floating`/`either` restriction is added now; both
reference forms remain possible, subject to any intrinsic domain semantics.
A pin on an external endpoint does not establish that the resource exists or is immutable.

### 5.2 Both Bead and Link Types can declare arity

Arity constrains the number of matching Links at an endpoint. Bead Types can
declare incoming or outgoing participation requirements, including obligations
that exist before any matching Link exists. Link Types can impose source-side
or target-side count constraints on their relationship.

```text
Assignment Link Type:
    source accepts Issue
    target accepts Person
    at most five Assignments per target identity

AssignedIssue conforms to Issue:
    requires exactly one outgoing Link satisfying Assignment
```

Every qualifying local AssignedIssue must satisfy its own requirement, even when
it currently has zero Links. An ordinary Issue does not acquire that obligation
merely because Assignment permits Issue sources. The Assignment target maximum
and the AssignedIssue outgoing requirement both apply.

| Bounds | Meaning |
| --- | --- |
| 0..1 | Optional, at most one |
| 1..1 | Exactly one |
| 0..unbounded | No count restriction |
| 0..0 | Matching Links are forbidden |

Bead Types can declare both minimums and maximums on incoming or outgoing
matching Links. Link Types can declare source-side and target-side maximums,
including zero, but cannot independently impose positive minimums. A positive
minimum belongs on the Bead Type whose instances owe that relationship. Endpoint
eligibility alone does not establish a mandatory relationship for every eligible
Bead. No rule requires enumerating every eligible external resource.

An omitted minimum means zero. A maximum of zero is meaningful. All applicable
bounds, including inherited bounds, remain in force. For the same counted Link
set, direction and endpoint population, the effective maximum is the smallest
maximum and the effective minimum is the largest minimum. For example, Assignment
allows at most five outgoing Links per source, but RestrictedIssue allows at most
two outgoing Assignments: a RestrictedIssue is limited to two. A more permissive
Bead maximum cannot relax the Link maximum. Different counted sets remain separate
checks; a bound on all Dependencies cannot be collapsed into a bound on blocks.

If the effective minimum exceeds the effective maximum, the requirements conflict;
neither overrides the other. Constraint syntax must identify the counted Link set
and incoming/outgoing direction explicitly. Exact declaration syntax remains open.

### 5.3 Counts include conforming Link Types

Conformance brings Links into the declaring Type's count. If Assignment has a
maximum of one per source, PrimaryAssignment and TemporaryAssignment both conform
to Assignment, and one of each leaves X, X has two Assignments and violates the
maximum. Separate allowances per conforming Type would defeat the promise.

Each Link counts once within a given constraint, even when multiple conformance
paths reach the declaring Type. A more specific Type's count constraint is an
additional check, not a partition or replacement of the inherited count. The
previously agreed ability to aggregate an explicit set of Link Types under one
maximum remains a requirement for the eventual constraint syntax.

### 5.4 Scope boundaries, identities and pins

Count the storing Scope's own Link table, including its Links referring to external
endpoints. Do not count or claim to validate other Scopes' Link tables. A constraint
on one external endpoint identity can therefore be enforced against the Links
this Scope stores without controlling that external resource's lifecycle.

Count by endpoint identity across floating references and references pinned to
different revisions. Three distinct Links whose source references are X, X@r1 and
X@r2 consume three slots in the same source-identity count. Pins do not create
additional arity allowances. Retained historical Link revisions are not additional
current Links in that count.

Endpoint eligibility is separate from count grouping: a pinned endpoint refers
to the selected Resource revision; a floating endpoint refers to current state.
Local availability and floating-endpoint revalidation still require explicit rules.
External resources are opaque under §5.1; their Type is not remotely validated.

The arity allowance is shared across revisions of the declaring Link-Type identity;
a new definition pin does not create another allowance. Installing or publishing a
new definition does not change existing affiliations or their guarantees.

**Selected mixed-revision case:** Assignment@1 permits at most one incoming Link
per Task, Assignment@2 permits two, and neither declares conformance to the other.
If Task X already has an Assignment@1 Link, adding an Assignment@2 Link to X fails:
both Links share the count, and the existing @1 Link keeps the maximum of one in
force. The presence of @2 does not supersede @1's restriction.

An explicit atomic migration can change the old Link's affiliation to @2 and add
the second @2 Link. This may commit if the final graph satisfies all remaining
constraints. No automatic migration follows from installing @2. If @2 conforms to
@1, or another applicable declaration retains the maximum of one, changing the
nominal affiliation does not escape that inherited or independent constraint.

Activation is local to the affected endpoint and direction. An @1 Link targeting
X does not impose its incoming maximum on independent Y. At Y, all current Links
in the Assignment family count together, including @1, @2 and conforming Types;
count membership is distinct from which limit declarations are active there.
Two @2 Links at Y can satisfy max2; one @1 plus one @2 at Y fails max1.

An installed definition with no current usage and no other applicable contract
requiring its constraint is inactive for the live graph. Retained historical Link
revisions alone do not activate it. A newly created Link using that definition
makes its constraints applicable to the proposed final state: validation happens
before commit, not after admitting a violation. For example, adding an @1 max1
Link at Y with two @2 Links fails because the proposed count is three. An explicit
atomic migration may remove old usage and its constraint while introducing new
usage, provided all final-state requirements hold.

The same locality principle for uniqueness is selected in §5.6. Still open:
precise inherited-revision activation and selector matching. Acyclicity is
the per-Link promise selected in §5.8. Do not generalize
these rules into a Scope-wide minimum over every installed or historical definition.

### 5.5 Validate arity at transaction commit

Arity is checked against the complete final staged state of an atomic transaction.
Temporary lower- or upper-bound violations are permitted between its operations.
Later operations see earlier staged changes; other clients do not see the invalid
intermediate state. Commit succeeds only if all applicable arity constraints hold.
Otherwise the entire transaction rolls back, including owned-Link/source revision
effects. A single-operation write must also leave a valid committed graph.

For an AssignedIssue requiring exactly one Assignment, a batch may create the new
Assignment before deleting the old one (temporarily two), or delete the old one
first (temporarily zero). Either ordering can commit if its final state satisfies
all applicable constraints. A batch may likewise build the Beads and Links of a
required graph segment before the arity check.

Syntax, authorization and revision preconditions are not waived. This decision
specifically defers arity validation; it does not silently defer every properties,
endpoint or reference check. Pair-wise uniqueness and declared directed acyclicity also validate at commit
(§§5.6 and 5.8). Other graph checks remain separate design work.

A server without optional batch support may be unable to express some valid
transitions. It must reject the invalid single write rather than break an
invariant. Creating or changing a Bead to a Type with a positive minimum creates
an obligation on the resulting Bead. Deleting that Bead removes its own obligation,
but effects on surviving Beads and Links must still satisfy their constraints.
Activating stricter definitions over existing data requires explicit migration
and activation rules; no implicit exemption for existing violations is selected.

**These decisions supersede the earlier maximums-only rule and the requirement
that arity hold after every operation.** They are proposed shared semantics, not
claims about current BDP batch or Beads behavior. Canonical Write changes and
implementation coordination remain separate landing work.

### 5.6 Pair-wise uniqueness across conformance

A Link Type may declare uniqueness of the ordered pair of source and target
identities. The constraint covers all Links satisfying the declaring Type,
including transitively conforming Link Types. It does not allocate a separate
allowance to each child Type. Each distinct Link identity is a participant;
idempotently returning an existing Link is not creation of another participant.

```text
dependency: unique ordered pair (source identity, target identity)
blocks conforms to dependency
parent-child conforms to dependency
```

If A has a blocks Link to B, a distinct blocks or parent-child Link from A to B
would violate this dependency constraint. B to A is a different pair; domain
cycle/hierarchy rules may independently reject it. A Link outside dependency's
conformance family is not restricted by this particular uniqueness declaration.
Endpoint revision pins do not create new pair identities. As with arity, the
constraint concerns the storing Scope's own Link table, not other Scopes' Links.

Validate pair-wise uniqueness against final transaction state. A batch may create
A's replacement parent-child Link to B before deleting the old blocks Link. The
temporary duplicate is allowed; if both remain at commit, reject and roll back
the entire transaction. Deleting first is also possible. All independent domain
constraints remain applicable; deferring uniqueness does not automatically defer
domain-specific hierarchy, endpoint, properties or authorization checks. Declared
acyclicity has its own commit-time rule in §5.8.

This is an optional declared constraint, not a universal prohibition of parallel
Links. Under mixed revisions, activation is local to the ordered endpoint pair,
while counting includes all current Links in the declaring family across revisions
and conforming Types. A different child Type or endpoint pin creates no extra slot.

For example, Relationship@1 permits parallel Links and Relationship@2 requires
pair uniqueness; assume neither revision inherits the other. Two existing @1
Links at A→B do not prohibit creating a unique @2 Link at independent C→D. Creating
an @2 Link at A→B fails because the same-pair population includes both @1 Links.
An atomic migration of A→B can remove duplicates and move the surviving Link to
@2. Installing @2 alone neither activates its rule everywhere nor changes the old
records. Inherited/independent uniqueness declarations remain binding wherever
applicable. This refines revision activation, not the family-wide counted set.

### 5.7 Ownership matches through conformance

A Bead Type's ownership declaration matches qualifying Link Types through
transitive conformance, not only exact nominal affiliation. If issue owns outgoing
Links satisfying dependency, blocks conforms to dependency, and custom-blocker
conforms to blocks, outgoing Links of both child Types are owned by an issue
source. User-defined conformers need not be individually added to the ownership
list. A conforming Link cannot opt out of matching the source's ownership rule.

Creating, modifying or deleting a matching owned Link has the source-revision
effects required by Core ownership semantics. Conformance establishes membership;
it does not grant authorization or bypass other constraints. A Link outside the
selected family is not owned by this declaration, though another ownership rule
may apply. Historical Bead revisions retain their recorded owned-Link state;
current matching rules must not reinterpret old revision contents.

Ownership selector syntax and exact-definition evolution remain open alongside
the other matching and lifecycle decisions. Registering a new definition alone
does not rewrite an existing Resource revision or silently change its affiliation.

### 5.8 Acyclicity is a per-Link promise

A Link Type may declare `linkConstraints.acyclic: true`. **Every current Link
subject to this constraint must be outside every directed cycle formed by Links
in the constrained family.** This is a per-Link promise, not a requirement that
all old Links in that family suddenly form a DAG when a new definition is installed
or first used. This section refines the earlier whole-family acyclicity wording.

Cycle traversal includes all current Links in the declaring family, across Type
revisions, endpoint alternatives and transitive conformers. Activation and traversal
population are distinct: an old Link that does not itself require acyclicity still
participates in finding cycles through a Link that does. Each applicable inherited
acyclicity declaration must be satisfied using its own family population. A local
false/omission cannot disable an inherited promise.

Vertices are endpoint identities across pins and floating references. A self-Link
subject to the constraint is a cycle of length one. Check the storing Scope's own
Link table, including external endpoint identities, without fetching or validating
those resources; no global guarantee about other Scopes' Link tables is claimed.

For Relationship@1 permitting cycles and @2 requiring acyclicity, with neither
revision inheriting the other, an existing @1 cycle A→B→A may remain. An independent
@2 Link C→D is allowed. C→A is also allowed if there is no path back to C: membership
in the same connected region as an old cycle does not mean this Link participates
in a cycle. An @2 Link B→A fails because the existing A→B completes a cycle through
it. Later adding an @1 Link that completes a cycle through an existing @2 Link
also fails; validating only new Links or only @2 traversal edges would be wrong.

Validate all affected promises against final transaction state, allowing a temporary
cycle removed before commit. A remaining cycle through any constrained Link rejects
the entire transaction, including owned revision effects. Installing a definition
alone and historical-only usage do not activate this promise on current Links.
Explicitly adopting the constraint on old Links may require an atomic graph repair.

**Tradeoff:** a whole-family DAG rule is easier to infer from the word “acyclic,”
but would make an unrelated old cycle block incremental adoption elsewhere. The
selected per-Link rule follows the same local-adoption principle as arity and
uniqueness while retaining all family Links as validation evidence. It does not
promise cheap validation: implementations must account for new paths through old
Links and may use indexes or scan the relevant graph. Performance does not change
the invariant.

**CLI opportunity (design work, not selected flags):** offer a preflight check of
the whole family, report old cycles and participating identities, preview which
Links would adopt the contract, and support an atomic migration/repair. Such UX can
address the least-surprise concern and offer a stronger voluntary readiness check.
CLI flags must not waive the protocol invariant or claim that all family Links
are acyclic when only the adopting Links carry that promise. Property spelling may
be reviewed for clarity without changing the selected semantics.

ConformsTo's intrinsic DAG over exact definition revisions remains distinct from
this identity-based constraint (§2.2). No blanket acyclicity is imposed on generic
Dependency or substituted for existing scheduler/hierarchy rules.

## 6. Concrete acceptance cases

These are design acceptance cases, not claims of implemented or executed tests.
Product/ApprovedProduct are illustrative and do not add shipping domain Types.

| Case | Required interpretation |
| --- | --- |
| Core Scope uses a Type reference whose target is not a Bead | Not invalid merely for that reason; the applicable typing profile defines its interpretation |
| Instance is stored under this Types profile | Its Type reference pins an exact revision of a Type-definition Bead |
| Author a Type's JSON Schema and graph constraints | Store them as descriptor properties; separate Schema/Constraint Beads are not required |
| Change a descriptor constraint field | Create a new definition revision; older revisions retain their field values and recorded owned conformance state |
| A Bead represents a Link-Type definition | The definition is a Bead; its described instances are Links; no cross-kind conformance follows |
| Traverse an instance's ordinary incident Links | Its distinguished type field creates no implicit Link into the Type graph |
| T@3 owns a ConformsTo declaration targeting A@2; A@2 owns one targeting B@1 | T@3's closure includes those exact revisions even after A changes |
| Delete or edit a conformance declaration | Apply source ownership revision effects; preserve the declaration in historical owner revisions |
| Someone publishes an assertion outside T's authoritative owned set | It does not change T's conformance contract |
| Record a later review as an Activity whose subject is the declaration Link revision | Preserve the declaration and owner revision; the Activity is independent |
| Specialized ConformsTo Link has valid tightening-only semantics | Include it in conformance and ownership through transitive Link-Type conformance |
| T conforms to C | Every valid T record satisfies C's structure and semantics |
| A conformance qualifier adds a price ceiling to T | Enforce the ceiling as part of T's effective contract; preserve every target-Type promise |
| A qualifier leaves some valid T instances outside the declared target contract | Invalid as a conformance declaration; qualifiers cannot weaken or make membership conditional |
| A specialized conformance relationship requires review evidence | It must still carry the full base conformance promise; evidence requirements do not replace it |
| C requires title; T omits title from its local schema | Effective T still requires title |
| C permits optional note; T requires note | Valid narrowing, subject to inherited behavioral promises |
| C requires note; T's local schema makes it optional | Effective T still requires note |
| C is open; T adds mandatory approvalCode | Permitted if all inherited constraints are satisfied |
| C forbids approvalCode; T requires it | Impossible effective definition; invalid |
| C permits extra string values; T adds string approvalCode | Allowed by that extra-property restriction |
| C accepts price as number; T requires integer | Structural narrowing, not a string/number-style contradiction |
| C requires string price; T requires numeric price | Impossible effective definition; invalid |
| A permits optional string code; B permits optional numeric code; T conforms to both | Allow with a warning if omission satisfies all requirements; code cannot be supplied |
| Such a T instance supplies code as string, number or null | Reject: no supplied value satisfies both property schemas |
| Either inherited schema requires code in that combination | Invalid effective definition; omission cannot rescue a required incompatible field |
| C means dollars; T reinterprets the same price as cents | Invalid semantic conformance, even with identical schemas |
| C permits numeric price; T requires nonnegative price | Read conformance can hold; a negative write to T fails |
| C explicitly promises an operation that T refuses under the same conditions | Invalid behavioral conformance |
| Update only ApprovedProduct.title | Preserve approvalCode; validate complete resulting state |
| Replace ApprovedProduct properties with a Product-only object lacking mandatory approvalCode | Reject atomically; do not merge missing properties back in |
| T@1 reaches C@1 and C@2 | Both exact definitions apply; neither supersedes the other |
| Bead Type declares conformance to a Link Type | Reject: the Type worlds do not intersect |
| Link Type declares conformance to a Bead Type with identical properties | Reject: shared property shapes do not establish cross-kind conformance |
| A@1 directly conforms to A@1 | Reject the direct conformance cycle |
| A@1 conforms to B@2, which conforms to A@1 | Reject the indirect conformance cycle |
| A@1 and B@1 both reach C@1 without a path back | Shared ancestry is not a cycle; diamond conformance is permitted |
| A newer revision of an inherited definition appears | Existing T revision retains its original exact promises |
| A required transitive definition is unavailable | Do not accept the Type for use with incomplete conformance knowledge |
| New Type revision adds a mandatory field | May break old-data acceptance even if conformance to a parent remains valid |
| ReviewLink declares Memory OR Activity while conforming to AnnotationLink allowing Issue OR Memory | Warn about the broader local declaration; enforce both constraints |
| Source conforms to both Issue and Activity in that example | Accept under both endpoint constraints; do not reduce the result to Memory only |
| Ordinary Issue has no Assignment; only AssignedIssue requires one | No minimum obligation follows merely from Assignment accepting Issue sources |
| Link maximum five and Bead maximum two govern the same outgoing Assignment set | Effective maximum two; all inherited constraints also apply |
| Link maximum two and Bead maximum five govern the same set | Effective maximum two; the Bead declaration cannot relax the Link constraint |
| Bead maximum five Dependencies and maximum two blocks | Enforce both counts independently; five is not reduced to two for all Dependencies |
| Link Type declares a positive minimum | Invalid declaration; place the participation obligation on a Bead Type |
| Bead minimum three and applicable maximum two govern the same set | Conflicting requirements; no valid final count |
| AssignedIssue has zero Assignments at commit | Reject the transaction |
| PrimaryAssignment and TemporaryAssignment conform to Assignment with maximum one per source | One of each from the same source exceeds the shared maximum |
| Multiple paths reach the same declaring Link-Type revision | Count a given Link once in that constraint |
| Distinct Links use X, X@r1 and X@r2 as source | Count all three under the source identity X |
| This Scope stores two Links to the same external target with maximum one | Reject even though the target is external; other Scopes' Links are not counted |
| Replace the sole Assignment in a batch, creating first or deleting first | Permit intermediate two or zero; accept only a valid final graph |
| Batch creates an AssignedIssue and its required Assignment | Accept if the complete final graph satisfies all applicable constraints |
| Batch finishes with an unsatisfied minimum or exceeded maximum | Roll back all operations and ownership revision effects |
| Bounds are 0..0 and a matching Link exists at commit | Reject; zero maximum prohibits participation |
| Deleting a Bead removes its own participation obligation | Still validate effects on surviving endpoints; other deletion rules remain applicable |
| X has an Assignment@1 Link with maximum one; add an Assignment@2 Link with maximum two | Reject: shared count exceeds the retained @1 guarantee; installing @2 alone changes nothing |
| Atomically move that old Link to @2 and add the second @2 Link; @2 does not conform to @1 | May commit if final graph meets all other constraints; explicit migration removes this old affiliation |
| @2 conforms to @1, or another applicable rule still limits X to one | Migration to @2 does not remove the inherited or independent maximum |
| Distinct blocks and parent-child Links have the same ordered pair under dependency uniqueness | They share the constraint population; cannot both remain at commit |
| Endpoint pins differ for the same source/target identities | Same uniqueness pair; no extra slot |
| Reverse the source/target pair | Different uniqueness key; independent workflow constraints still apply |
| A Link outside the dependency family uses the occupied pair | This dependency uniqueness declaration does not prohibit it |
| Batch creates a replacement pair Link before deleting the old Link | Temporary duplicate allowed; final duplicate rolls back the complete transaction |
| issue owns dependency; custom-blocker transitively conforms to dependency | Matching outgoing custom-blocker Links are owned without individual registration in the ownership list |
| Create, modify or delete such an owned Link | Apply Core source-revision effects atomically; no subtype opt-out |
| Read a historical Issue revision after new definitions are registered | Preserve its recorded owned set; do not recompute history using current rules |
| Endpoint alternatives are BeadType→BeadType or LinkType→LinkType | Reject a cross-category declaration; endpoints must match the same pair |
| One Link matches multiple endpoint alternatives | One participant per count/uniqueness/acyclicity rule, not a new budget per arm |
| Two allowed arms are Person→Task and Team→Task with targetMax one | One combined Assignment allowance per Task identity |
| Parent and child each declare endpoint pair lists | Require a match in each list; do not concatenate into OR |
| Source or target Type array is empty or mixes wildcard with another entry | Reject the descriptor shape |
| External-capable endpoint arm asks for a specific Type | Reject this candidate shape; do not fetch or pretend unknown proves conformance |
| External resource changes or disappears | No remote validation guarantee; stored reference remains a reference |
| Cycle alternates between endpoint arms or sibling Link Types and includes a Link subject to acyclicity | Reject at commit using the declaring family across all arms/revisions |
| Batch temporarily creates a cycle then removes it | May commit if final graph satisfies all constraints |
| An @1-only cycle exists at A→B→A; independent @2 C→D adopts acyclicity | Allow C→D; old Links do not acquire the promise implicitly |
| Add @2 C→A where A is in that old cycle but no path returns to C | Allow: the constrained Link itself is not in a cycle |
| Add an @1 Link that completes a cycle through an existing constrained @2 Link | Reject; old Type usage cannot evade the existing Link's promise |
| Link endpoints use differing revisions of the same identity in a cycle | Pins do not evade identity-based acyclicity |
| T@2 declares conformance to T@1 | Do not decide revision-evolution policy via a generic acyclic flag; exact-revision and identity cycles differ |
| Type definition has version 2.1.0 and exact revision r7 | Pins still identify r7; label alone establishes no matching or conformance |
| Constraint requires Product@r1; endpoint is nominally Product@r2 with no conformance to r1 | Reject; shared identity does not satisfy the exact contract |
| Constraint requires unpinned Product; endpoint is Product@r2 or conforms to Product@r1 | Match identity-wide without resolving latest |
| Create a valid local Type definition with no name property | Accept; ID supplies identity and display can be derived |
| Create a valid definition with complete admitted closure | Make exact revision usable without a separate activation step; existing instances do not move |
| X uses Assignment@1 max1; independent Y uses two Assignment@2 max2 Links | Y may have two; X's incoming limit does not apply at Y |
| @1 is retained only as an installed definition or in history, with no other applicable contract | Do not activate its limit on the current graph |
| Create an @1 max1 Link at Y already having two @2 Links | Reject before commit: all three count, even though @1 was previously unused there |
| Two parallel Relationship@1 Links remain at A→B; create unique Relationship@2 at C→D | Allow if C→D meets all applicable constraints; A→B does not block independent migration |
| Create that unique @2 Link at A→B instead | Reject: old @1 Links participate in the same-pair uniqueness count |

## 7. Decisions still needed

Conformance questions to work through next:

- Repeated paths and deterministic closure identity; conformance cycles are forbidden.
- Operational/query syntax for the selected exact versus identity-wide matching
  rules; keep nominal affiliation filters distinct from conformance-aware matching.
- Schema dialect/composition details and semantic annotations; minimum mandatory
  checks versus author responsibility, without claiming complete satisfiability
  or semantic proofs.

Other Type-system work:

- Review the candidate definition fields and Type/BeadType/LinkType/ConformsTo seed in §2;
  finalize metatype/bootstrap, IDs and revision availability, installation,
  removal, packaging and retention.
- Endpoint pair-object wire syntax, inherited conjunction and warning details. Explicit
  AND/NOT/exact-only selectors remain deferred; unresolved does not mean nonmember.
- Arity syntax, constraint identity and changing
  limits across definition revisions; ownership, pair-uniqueness declaration syntax
  and which other graph constraints are checked at commit.
- Explicit affiliation changes, migrations, floating endpoint revalidation and
  operation behavior during transitions.
- Compatibility families and publication claims, including semantic changes.

Issue/Dependency exercises pair uniqueness, workflow-sensitive metadata,
classification-to-Type translation, computed/live observations and ownership. Memory exercises reusable content, heterogeneous endpoints, pinned
citations and reference availability. Use these as requirements, not automatic
precedent. Keep their domain semantics and the Provenance V2 proposal intact while
reviewing shared Type mechanisms.

The [completion decision list](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/types-completion-decisions-20261014.md)
collects unresolved questions and consistency work, including Memory updates held
for user review. It supplies no additional normative rules.

### 7.0 Local authoring and availability

Successful creation of a valid Type-definition Bead makes that exact definition
revision available for explicit use in the Scope. There is no separate local
activation/publish step in this proposal. Validate the definition and required
conformance closure before acceptance. Ordinary Bead operations and specialized
CLI commands must enforce the same rules. A new definition revision does not
upgrade existing affiliations or activate graph constraints on old instances.
Registry identity and publication authority are selected in §7.2. Removal/history
retention and bootstrap mechanics remain separate lifecycle questions; the portable
import/export format is parked for a later design discussion.

Canonical identity comes from the Bead ID. This profile defines no separate
Type-specific name or display-name field. Generic resource aliases may resolve
references without changing identity, equality or conformance. Alias persistence,
Scope resolution and ambiguity handling belong to the CLI design.

The independent [CLI proposal](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-proposal.md) captures
Type-specific CRUD affordances and check versus validate. A bounded first
implementation exercise is kept in separate [implementation notes](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-cli-implementation-notes.md).
Both are review material, not requirements that BDP adopt CLI command names or
assertions that the preview implements them.

### 7.1 Portable graph files and command-line literals

A portable graph representation is needed for file-based authoring/sharing and
command-line input. Reuse Core identities and references, including intra-Scope
references; do not invent another persistent identity system. The final-state
foundation file is a requirements example, not a selected package envelope.

Keep two operations distinct:

- **Export/history preservation:** preserve original identities, exact revision
  references and recorded owned states. Import must not silently reinterpret
  those pins as destination revisions or latest state.
- **Creation:** new records receive destination revisions. References among records
  in the same input may need to resolve to revisions not known until creation.
  A temporary document-local binding/resolution scheme is a candidate, not an
  adopted syntax. Existing exact references must retain their meaning.

Open decisions: envelope/version/media type; Scope binding and identity conflicts;
external-reference treatment; dependency closure; missing revisions; restoration
versus creation authority; mapping returned to the caller; and atomic installation.
Mutually dependent seed definitions make revision allocation substantive, especially
if revision tokens are content-derived. Atomic batch alone does not solve forward
pins or recursive allocation. No client-assigned revision, remapping rule or
package manager is implied. Prefer the same payload for files and command-line
arguments, with CLI quoting/reading conventions owned by Beads.

Acceptance targets: export/reload an exact historical owned graph; create two new
Beads with an intra-input Link; create the foundational Type graph with pinned
references; reject an unresolved exact pin without falling back to latest; reject
an ID collision without overwriting implicitly; preserve opaque outside references;
and roll back the whole installation on a final graph-constraint failure. Format,
importer and these runtime cases are NYI.

### 7.2 Definition origin, installed identity and publication authority

The following lifecycle distinctions are selected design. They do not introduce
four different Type systems; registry-published definitions may also be pre-installed.

| Category | Meaning |
| --- | --- |
| Intrinsic | The minimum definitions needed to bootstrap the Types system; supplied by the implementation binary. Scope clients cannot update or remove them. |
| Pre-installed | Ordinary definitions supplied initially because product users expect them; governed by ordinary Type lifecycle rules rather than intrinsic status. |
| Registry-published | Discoverable Type graphs published through a public read-only BDP server and available for installation. Registry publication is a distribution/authority role, not a different definition representation. |
| Locally authored | Ordinary Type-definition Beads created in the Scope through normal operations. |

Only intrinsic Types belong in the binary. The intended distribution model for
common pre-installed Types is locally supplied copies of graphs published by the
registry. Pre-installation mechanics are still to be discussed. Foundation binary
upgrade/version coordination is not permission for ordinary clients to revise
intrinsic definitions.

By default, installing a registry Type preserves its globally recognized ID and
exact revision, along with the identities and pins of its required definition
graph. The same ID denotes the same nominal Type across federated graphs; the same
ID/revision pair denotes the same immutable definition and meaning. Conflicting
content under an already known exact identity must be rejected rather than silently
overwritten. Content-equivalence and publisher-verification mechanisms still need
specification; this does not require selecting a hash or signature scheme now.

Installation grants availability, not publication authority over the registry ID.
A receiving Scope that only holds an installed copy must reject an attempt to
publish a new definition revision locally under that imported identity. This does
not prohibit an authorized update at the origin. With future absolute-ID routing,
a CLI update can be sent over BDP to the authoritative origin server, which applies
its normal write authorization and Type validation. Public registry access may be
read-only while authorized publishers have a write path. Routing is CLI/client
behavior, not a special Type mutation mechanism; offline or denied origin writes
must not silently become edits to a local copy or forks. Intrinsic definitions
remain subject to their separate no-update rule.

Users obtain later revisions from the publisher, publish at the origin when
authorized, or explicitly fork under an identity they control. A fork is a new Type; any conformance
to its source must be declared and justified rather than inferred from copying.
Generic operations and specialized Type commands must enforce the same authority
boundary. Local removal of a retained copy is a separate retention-policy question,
not deletion of the publisher's resource.

Installed definitions must remain usable when their registry is unavailable.
Retain the exact dependency closure, schemas and historical owned declarations
needed for their interpretation; eviction of an opportunistic cache must not
invalidate installed or retained historical meaning. Updating installed availability
with a later publisher revision does not move existing instance affiliations.
Registration means that a definition is accepted for use in this Scope, not merely
present in an opportunistic cache. Successful valid local creation or installation
provides that status; this does not add a separate activation step.

The selected acquisition modes are:

| Mode | Behavior |
| --- | --- |
| Require registration (default) | Refuse use of a Type not registered for the Scope; do not automatically install it. |
| Automatic installation (explicit mode) | Acquire and validate the requested Type and its required definition graph, retain them locally, then validate the instance before accepting its write. Retrieval alone is not acceptance; failed installation or validation must not admit an unvalidated instance. |
| Unvalidated use | Not supported initially. A possible future mode would need an explicit persisted indication that a Bead/Link was not validated; it must not silently claim ordinary Types-profile validation. No representation or bypass mechanism is selected. |

Whether acquisition policy is configured per Scope, requested per operation, or
both remains open, as do permissions for enabling automatic installation. The
precise registration granularity (identity versus exact revision/closure) remains
open; identity recognition must not be confused with possessing and validating the
exact definition required by a stored pin. Cache population alone does not authorize
use. Registry discovery and absolute-ID routing do not imply automatic installation.
Selection of a revision for an explicit unpinned Type write is also unresolved:
a Scope-selected default versus the origin's current revision was proposed but
not decided. Do not infer a latest-selection policy from identity-wide query matching,
installation order, alias creation or revision-token ordering.

Acceptance cases: two Scopes installing the same graph preserve exact Type equality;
registry outage does not break use of retained definitions; conflicting exact copies
fail; unauthorized local publication under an imported registry identity fails;
an authorized routed origin update follows ordinary write rules; an explicit local fork
has a new identity; obtaining a newer publisher revision leaves existing pins intact.
Installed replicas' exposure through Scope reads/listing, distribution format,
authority verification and retention/deletion behavior remain to specify. In
particular, local availability does not silently turn a globally addressed replica
into an in-Scope resource. Reconcile the endpoint scope/category rules for exact
installed Type graphs with §5's opaque-external-endpoint policy before implementing
registry-backed conformance. This is an open integration question, not a promise to
validate arbitrary external resources.

### 7.3 Local aliases for canonical references

Selected direction: a local alias may target an absolute Bead or Link ID in another
Scope and may optionally include an exact revision. A name has exactly one target;
it cannot simultaneously name a local resource and an alias or have multiple alias
bindings. Naming/uniqueness granularity follows the eventual resource namespace
contract; this does not select one shared bare-name namespace across Beads and Links.

Alias creation is independent of fetching or registering its target. At use, resolve
the alias to the canonical reference and apply normal acquisition, registration,
authorization and validation rules. An unpinned target names an identity; a pinned
target names an exact revision. Stored instance Type affiliation remains an exact
canonical pin, never a mutable alias. Repointing an alias cannot change existing
stored affiliations or other canonical references.

The existing CLI's Bead/Link prefix shorthand is the precedent: general resource
commands interpret a bare path as beads/PATH; Link-only commands interpret it as
links/PATH. Explicit selectors retain their resource meaning. Placement of aliases
under these namespaces versus a dedicated root, possible types/ shorthand, collision
and explicit revision-override diagnostics, and alias lookup precedence remain to
specify. CLI shorthand is not a change to global canonical identity.

This expands the current canonical BDP alias contract, which uses an alias/ root
and targets only in-Scope Bead URLs. Its existing alias table/operations provide a
starting point, not evidence that cross-Scope, Link or pinned aliases work today.
Any adoption requires coordinated Core/Write alias schema and operation changes;
this draft does not silently amend [Core](../core/core.md),
[Write](../write/write.md), or active Write work.

## 8. Readiness and landing

| Item | Status |
| --- | --- |
| Optional Scope-wide Types boundary | Agreed design; canonical integration pending |
| Conformance rules in §3 and distinctions in §4 | Agreed design foundation; detailed syntax/checks open |
| Endpoint composition and arity in §5 | Agreed design direction; cross-revision evolution and detailed syntax open |
| Acceptance cases in §6 | Written for review; implementation qualification NYI |
| Definition representation | Beads with descriptor fields and owned conformance Links selected; candidate property schemas and seed example in §2; bootstrap/lifecycle decisions remain open |
| ConformsTo editing, provenance and graph-display experiment | Evaluation cases identified; runtime behavior/performance not qualified |
| Constraint expression syntax and matching | Candidate selector/bound syntax in the descriptor schema; exact/identity-wide predicates selected; query syntax and local revalidation open; external validation explicitly excluded |
| Beads CLI/storage implementation of this draft | Not established by this document |

Continue this work-in-progress design through focused branches from BDP main.
Land coordinated, bounded amendments against current BDP and Beads sources, with
acceptance cases and explicit
implementation status. Do not merge the accumulated design branch as an implicit
runtime migration. Core/Write document extraction and changes to active Write work
are not prerequisites for finishing the Types and Memory designs.
