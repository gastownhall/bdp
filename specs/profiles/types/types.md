# BDP Types

Work-in-progress design specification, October 17, 2026. This document records
agreed design rules and explicit open decisions for an optional, Scope-wide Types profile. It is not yet
an adopted protocol specification, an installable definition format, or a claim
that Beads implements these rules. The [current BDP specifications](../../README.md)
remain the protocol authority until coordinated amendments land. Landing this
document on main makes the evolving design available for collaboration; it does
not adopt its candidate wire shapes or require implementation of unfinished rules.

The [Issue and Dependency draft](../../types/issue/issue.md) and
[Memory product proposal](https://github.com/gastownhall/beads/issues/7661)
provide requirements and acceptance scenarios. Issue/Dependency records the
selected product hierarchy of classification Types conforming to issue/dependency.
Memory defines product behavior independently of its eventual BDP representation.
Its fixed supplied catalog and compiled validators can exercise these semantics
without exposing Type-definition Beads or implementing this profile. Its exploratory
BDP definition graph is not an adopted installation format. Memory's remaining
product choices and implementation status belong to its
[decision and dependency record](https://github.com/gastownhall/beads/issues/7656).
The earlier [Type lifecycle exploration](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/type-lifecycle-preview2.md)
is background. Where it conflicts, this document records the current design
position: this Types profile represents definitions as Beads; the proposed Core
boundary does not require that representation. The current Core/Write contracts
remain unchanged until coordinated amendments adopt that boundary.

## 1. Scope and responsibilities

This section defines the intended profile boundary. Structural extraction of
Core and Write is complete; their current normative contracts have not thereby
adopted optional Types or the new definition model. Existing immutable-affiliation,
descriptor, installation and update rules require coordinated semantic amendments
before an implementation can claim the new behavior.

Under the proposed boundary, Core defines the common Resource envelope, references,
revisions, ownership behavior and recognizable constraint errors. A Type reference
is required even when a Scope does not implement the Types profile. Core may enforce native
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
batch. Non-atomic sequence is excluded from that proposed direction. Adopting
changes to the existing Write profiles or moving Events is separate work; this
draft does not direct changes to active implementations. A fixed product catalog
can implement selected domain behavior without advertising this general profile.

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
Explicit unpinned Type input selects the Scope's explicitly chosen installed exact
default for that Type identity and resolves to that pin before commit. Without a
selected default, the write refuses before acquisition (§7.2).
An omitted Type on update preserves the existing exact affiliation. Supplying a
Type reference replaces that reference as a whole, rather than merging its identity
and revision members.
A guarded ordinary update may explicitly replace the Type reference of a Bead or
Link. It may accompany targeted property edits or explicit full replacement;
complete-result validation does not require every request to replace all properties.
The resulting properties and affected graph must satisfy all applicable constraints,
or the change fails atomically. A Link Type change that adds the Link to or removes
it from its source Bead's owned set also creates a new source revision atomically
with the Link revision (§5.7). Mutation request syntax, precise affected-Link checks
and other ownership transitions still require the coordinated Write contract.

A successful change to either the Type identity or its pinned definition revision
creates a new revision of the Bead or Link, even when properties and metadata are
unchanged. Affiliation carries meaning and participates in change detection. Earlier
Resource revisions retain their exact affiliations and recorded owned-Link state.
Supplying the same resolved reference does not, by itself, constitute a Type change;
ordinary no-op and revision-precondition rules still apply. Properties-only updates
never implicitly move the Type pin. Atomic batch may compose retyping with other
changes; retyping is not a batch-only primitive.

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
emerges; it is not needed to complete the current profile. Referenced schema resources
and their resolution bindings are retained immutably with the Type revision (§3.12).
The closure's representation and installation mechanics remain to define; embedding
a schema does not eliminate that obligation.

The representation boundary is:

| Information | Authoritative representation |
| --- | --- |
| An instance's affiliation | Distinguished `type` field, pinned to a definition Bead revision under this profile |
| The definition Bead's own affiliation | Its own `type` field; Type metatype and bootstrap candidate in §§2.1–2.3 |
| Direct conformance declarations | Owned ConformsTo Links, recorded with the source definition revision |
| Properties schema and other constraints | Fields in the definition Bead's `properties`; candidate schema linked from §2.1 |
| Later review of a declaration | An independent Activity referencing the declaration Link revision, when the shared Provenance V2 mechanism is supported |

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
Their `$ref` factoring is repository authoring. Published schema closure and reference
bindings must be immutable for the Type revision (§3.12); their encoding and lifecycle
operations remain to specify. The [schema notes](README.md)
record the starting descriptor and the candidate changes.

| Descriptor property | Candidate structure and meaning |
| --- | --- |
| `description` | Optional semantic documentation; canonical identity comes from the Bead ID |
| `propertiesSchema` | Required embedded JSON Schema applying to described instances' properties |
| `schemaResources` | Proposed URI-keyed map of retained referenced schema resources; part of this exact descriptor, optional when empty |
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

For these semantic checks, registered exact definitions and their retained pinned
conformance closure are trusted local dependencies, including definitions whose
canonical IDs belong to another Scope (§7.2). Resolve the recorded definitions and
declarations locally, preserving their identities and exact revisions. This permits
category and conformance validation without an online fetch; it does not infer
anything about arbitrary external graph endpoints or grant publication authority.
This is the common endpoint rule for registered exact Type definitions, not an
exemption reserved for ConformsTo (§5.1). The candidate ConformsTo descriptor uses
`scope: either` for its category-preserving pairs, allowing same- and cross-origin
definitions whose exact state is accepted locally. Registration does not redefine
`scope: same` or bypass any explicit endpoint-Scope restriction. Unregistered or
arbitrary external endpoints remain opaque; accepting definitions does not grant
permission to mutate their origin.

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
it would prohibit the permitted explicit T@2 → T@1 conformance as an identity
self-loop. Every inherited promise still applies, and exact-revision cycles remain
prohibited (§§3.8, 4). This corrects the earlier illustrative suggestion to set
`acyclic: true` directly on ConformsTo. Source-pin operation details and installation
mechanics remain open; registered exact definition endpoint checks follow the common
rule in §5.1.
Stored target pins are an intrinsic ConformsTo semantic requirement, not a generic
endpoint pin-mode constraint added to the descriptor language.

### 2.3 Literal graph and bootstrap candidate

The [foundation graph](definitions.json) contains eight
illustrative definition Beads and four owned declarations: BeadType→Type,
LinkType→Type, task→issue and blocks→dependency. All affiliations and declaration
targets pin revisions. Schema copies match the adjacent artifacts.

Type, BeadType, LinkType and ConformsTo are the intrinsic bootstrap definitions.
They are supplied as a shared exact bootstrap graph: implementations initialize
from the same published stable identities, revision tokens and definition content.
Trusted initialization installs that graph; ordinary Scope operations cannot update
or remove its intrinsic definitions. This is an explicit trusted bootstrap boundary,
not permission for ordinary clients to assign revisions.
The candidate affiliates all three metatype definitions with BeadType; BeadType
therefore pins itself. These definition-reference dependencies are not conformance
cycles. This supersedes the earlier lone self-typed Type seed. Publishing and trusted
initialization of the exact graph resolves these bootstrap dependencies without
pretending ordinary create can know its future opaque revision. An intrinsic upgrade
publishes a coherent new exact graph and retains earlier versions so existing pins
keep their meaning; it does not overwrite content at an existing exact identity.

The fixture's IDs and revision tokens remain illustrative placeholders, not the
production publication. Production namespace, publication artifact and upgrade
activation details remain to finalize. No particular hashing or revision-allocation
algorithm is selected for ordinary writes. The shared bootstrap direction does not
reopen ordinary client mutation of intrinsic definitions.

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

Distinct Types may accept the same JSON shape while assigning it different meanings.
A Decision and a Requirement may both require title and body; that does not make
them the same Type or establish conformance between them. Conformance preserves the
declared shared structural and semantic contract; it need not add a required property.
Changing between same-shape Types still changes affiliation under §2.

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
schema or semantic contradiction. The schema baseline and required-vocabulary
handling are specified in §3.12. The bounded mandatory contradiction-checking floor
is specified in §3.13. Outside its provable cases, admission reports unknown rather
than inventing a contradiction; standard instance validation is not a proof that a
schema is satisfiable.

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

An open properties object may contain application extension data, including a
property named `kind`. Such a property does not select affiliation, infer conformance,
or substitute for fields required by the actual Type. A particular Type may define
that property's meaning explicitly; this profile does not reserve it as a second
Type discriminator. Deliberate property restrictions in individual schemas, including
the definition-descriptor schemas, still apply.

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
not be mistaken for overriding a parent's closed-record rule. Standard 2020-12
composition applies (§3.12). The following finite examples validate every inherited
and local schema unchanged against the same complete properties object. They do not
merge property declarations or change the scope of any closure keyword. The retained
reference-binding representation remains separate work. These closed-root examples
require the Core amendment listed in [the profile delta inventory](README.md#changes-from-the-current-descriptor);
adopted Core currently requires open instance-properties roots.

**Open Product, then an additional requirement.** Product allows extensions:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "price": {
      "type": "number",
      "minimum": 0
    }
  },
  "required": [
    "name",
    "price"
  ],
  "additionalProperties": true
}
```

ApprovedProduct's local schema adds the required approval code:

```json
{
  "type": "object",
  "properties": {
    "approvalCode": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "approvalCode"
  ],
  "additionalProperties": true
}
```

`{"name":"Pump","price":25,"approvalCode":"A-17"}` passes both. Removing
approvalCode fails the local schema; changing price to -1 fails Product. Validating
both unchanged is equivalent here to placing the two schemas as separate `allOf`
branches. Neither branch overrides the other.

**A closed Product prevents that extension.** Change only Product's
`additionalProperties` to false. The same complete instance now fails Product because
it contains approvalCode. Removing that field fails ApprovedProduct instead. A child
cannot reopen the inherited Product schema by declaring its own properties open.

**An independently closed child must permit inherited names.** This local schema
is also insufficient, even while Product stays open:

```json
{
  "type": "object",
  "properties": {
    "approvalCode": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "approvalCode"
  ],
  "additionalProperties": false
}
```

It rejects name and price as additional properties. `allOf` does not merge the parent's
property declarations into the child's `properties`. The child can instead explicitly
permit those names:

```json
{
  "type": "object",
  "properties": {
    "name": true,
    "price": true,
    "approvalCode": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "approvalCode"
  ],
  "additionalProperties": false
}
```

The `true` entries permit the inherited names locally; Product still checks that name
is a string and price is a nonnegative number. The approved Pump passes, but a negative
price or an extra supplier property fails. This is explicit independent validation,
not a special rule for flattening schemas. It does not select any cross-schema
`unevaluatedProperties` relocation or rewriting scheme.

[Executable composition cases](schema-composition-cases.json) contain the complete
schemas and positive/negative instances, including the closed-Product variant. They
exercise ordinary 2020-12 behavior; they do not decide Type satisfiability in general.

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

The write/read model distinguishes four categories:

| Category | Selected rule |
| --- | --- |
| Ordinary writable properties | The caller may supply changes, subject to validation and authorization |
| Service-managed read-only properties | The service supplies or recomputes values; they may change in a new Resource revision but remain fixed within each recorded revision |
| Caller-at-create, initialization-only properties | The caller supplies the initial value; it remains unchanged across revisions. Attempts to change it are rejected |
| Live observations | Values outside revision-covered properties that may change independently of a Resource revision |

Properties replacement supplies the complete new **ordinary writable** property set.
It preserves initialization-only values and rejects attempts to change them. The
service supplies or recomputes its read-only fields, then validates the complete
resulting properties object against the exact Type and all inherited requirements.
A mandatory ordinary writable `approvalCode` still cannot be omitted: the service
must not silently preserve an omitted writable field and turn replacement into a
merge. Creation likewise validates the completed result after caller-at-create and
service-supplied fields are available.

A client knowing only Product cannot assume it can create or replace an
ApprovedProduct. It must satisfy the actual caller-writable requirements and operation
contract. Reading and preserving unfamiliar writable fields can help, but does not
establish that an arbitrary change will be valid. Conformance does not make a generated
field caller-writable or relax complete-result validation.

This selects the replacement model, not a property-annotation syntax or a qualified
implementation. The [Issue draft](../../types/issue/issue.md#34-observed-write-surfaces)
records a writable-subset replacement surface; its illustrative `id`/`status` projection
does not prove generic create/replacement correctness. The categories and replacement
behavior are selected; property-annotation syntax, the designation of individual fields,
and initialization-only behavior under retyping remain open. This decision does not
assign enforcement semantics to JSON Schema `readOnly` or invent an `initOnly` keyword.
Signing mechanisms remain with the shared provenance review. A signature of a completed
revision would cover its stable service-supplied values; a signature of the caller's
proposal concerns different content. Live observations are outside revision content.
This distinction selects no signing wire shape, verification mechanism or trust policy.
Adopting the selected replacement model requires the coordinated Write operation and
input-schema contract; this draft does not silently amend current Write.

**Live observations are separate from revision-covered properties.** Values such as
a current heartbeat that can change independently of a Resource revision must be
represented outside its immutable properties. A later observation cannot rewrite the
properties of an existing pinned revision. Stable generated properties, by contrast,
are part of the recorded state and are covered by that revision. The observation
representation, discovery and read operations remain to specify with Core; this draft
adds no `volatile` bag or other new envelope field.

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
validation and matching use registered exact local dependencies, even when their
canonical IDs belong to another Scope; they do not require a fresh network fetch.
An opportunistic cache entry alone is not an accepted definition (§7.2).

A Type may reach both C@1 and C@2 through different paths. It then promises both,
not whichever is newer. If their requirements conflict, the Type cannot fulfill
its declarations.

Conformance must be acyclic. Reject a direct self-reference or an indirect chain
that returns to the same exact definition revision. Check the complete conformance
graph before accepting a Type for use. Multiple paths to a shared ancestor are
not, by themselves, a cycle; diamond conformance remains permitted. This rule
concerns conformance declarations, not recursive references within a JSON Schema.
An inherited ancestor requirement is identified by its originating exact definition
and location within that definition. Reaching it through several paths applies that
same requirement once. C@1 and C@2 remain distinct origins even if their property
text happens to be equal. Restrictions introduced by distinct conformance declarations
remain distinct requirements; shared ancestry must not erase their tightening
qualifiers or evidence. Location/qualifier encoding and diagnostic presentation remain
to specify. This declaration-level rule is separate from §5.3's rule that each
instance Link counts once within a given arity constraint.

Explicit T@2 → T@1 conformance is permitted: T@2 promises every requirement and
meaning of T@1. This is not an exact-revision self-cycle. A chain returning to the
same exact revision still fails, and neither revision age nor shared identity
creates conformance without an explicit accepted declaration.

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
identity and bootstrap publication mechanics remain open; §2 supplies a candidate
properties schema and seed definition.

A declaration's exact Link Type must already be accepted before the declaration
is used to admit a candidate Type. The candidate cannot use an unproven relationship
to establish its own authority. For example, a proposed specialized Link Type S@1
cannot establish conformance to ConformsTo@1 solely through a declaration itself
typed by the unaccepted S@1. Mutually dependent unaccepted specializations cannot
justify one another this way, even without a cycle among their declared target
edges. Exact target-edge acyclicity alone is insufficient.

A new specialization can instead declare its conformance through the built-in
ConformsTo Type; once accepted, it can supply the Link Type for later declarations.
This specifies the logical admission dependency, not a transaction-start-only rule
or a batch/import ordering syntax. The trusted intrinsic bootstrap in §2.3 remains
a distinct boundary. Its metatype reference loops, and recursive JSON Schemas, are
not prohibited by this grounded-declaration requirement.

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
recording an independent Activity does not. These use shared provenance mechanisms
when supported, not a parallel Type-specific envelope. Provenance supplies evidence
about a claim, not proof that its semantic promises hold. Shared provenance schema
and operation adoption remains separate owner work; this profile does not invent
an inception property on Type definitions or require the full Activity workflow
before defining conformance.

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

### 3.12 Schema baseline and immutable references

Properties schemas use JSON Schema 2020-12 and its standard validation rules.
This baseline applies to every schema resource in the retained closure, including
embedded resources and separately retained reference targets. The top-level resource
uses 2020-12 when `$schema` is omitted; embedded resources without a dialect declaration
inherit the enclosing dialect. An explicit dialect must name
`https://json-schema.org/draft/2020-12/schema`; another URI is refused under the current
candidate contract. `$schema` is allowed only at schema-resource roots, not arbitrary
subschema positions. Objects used as `const`, `enum` or example data are not schema
resources merely because they contain a key spelled `$schema`. The descriptor's root
shape check alone does not enforce these closure-wide rules. Standard validation,
applicator and unevaluated-keyword semantics must not be silently ignored. Boolean schemas retain
their standard meanings; syntactically valid `false` does not establish an inhabitable
Type.

This profile requires syntactic `format` validation for the standard 2020-12 formats,
including date-time, URI and email. This is an explicit profile requirement beyond
the default annotation behavior of the standard dialect. A Type relying on an unknown
or unsupported format is refused at admission, even if the underlying validator would
silently ignore it. Implementations must not claim support based only on a library
option that leaves some required formats unchecked. Format checking does not establish
resource existence, email deliverability or remote content validity and performs no
network verification. See [JSON Schema Validation §7.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-7.2).

The current standard-dialect artifacts establish the required baseline vocabularies;
they do not provide a custom-extension negotiation mechanism. A derived/custom
meta-schema URI is not implicitly accepted merely because an implementation recognizes
it or supports its extensions. Extension presentation remains open. Any future supported
extension presentation must retain the baseline and determine required vocabulary
support from the applicable meta-schema's declarations. An unsupported vocabulary
marked required must cause refusal; it cannot be ignored to admit a definition. Under JSON Schema, `$vocabulary` has this role in
a meta-schema, not as an ordinary instance-schema switch. Unknown nonassertion
annotations carry no enforced meaning unless a defined supported vocabulary supplies
it. See [JSON Schema Core §§8.1.1–8.1.2](https://json-schema.org/draft/2020-12/json-schema-core#section-8.1).
This required-vocabulary refusal is binding, but does not select an extension-capability
syntax. See also [schema-resource rules](https://json-schema.org/draft/2020-12/json-schema-core#section-9.3.2).

Each exact Type revision binds a complete retained closure of the schema resources
needed to interpret its embedded properties schema, including the reference-resolution
bindings. Validation resolves references from that immutable closure using the standard
schema semantics. A schema URL is not permission to fetch a newer document during
validation. Missing required resources or unresolved references cannot be treated as
valid constraints. The same Type revision must not change meaning when a publisher
changes content at a referenced URL or when the network is unavailable.

The definition descriptor contains both `propertiesSchema` and a referenced-schema
map, proposed as `schemaResources`. This map is immutable with the Type revision;
validation needs neither separate Schema Beads nor a separately mutable sidecar. It
contains the exact resources needed for offline evaluation of that definition's root.
Each inherited definition retains its own root and map; conformance does not merge
independent maps or let a child overwrite an ancestor's reference bindings.

Candidate encoding: `schemaResources` is an object keyed by absolute, fragment-free retrieval URIs,
with JSON Schema objects or booleans as values. It may be omitted when empty. Keys
establish retrieval locations; schema `$id`, fragments, anchors and relative references
keep their standard 2020-12 meanings. An anonymous root with relative external
references exposes a remaining base-binding question; this draft does not invent a
base from the Type identity or permit live fetching to fill the gap. Internal fragment
references and roots with explicit schema bases are unaffected. Missing references or
conflicting resource-identity bindings refuse admission. Embedded `$id` resources are already carried by their
containing schema and need not be duplicated in the map. Exact spelling and
serialization are review syntax; self-contained immutable descriptor state is selected.

For example, a definition can retain this complete root/reference pair (both use the
baseline dialect by omission):

```json
{
  "propertiesSchema": {
    "$id": "https://example.org/schemas/product",
    "type": "object",
    "properties": { "price": { "$ref": "price" } }
  },
  "schemaResources": {
    "https://example.org/schemas/price": { "type": "number", "minimum": 0 }
  }
}
```

Recursive schema references are not prohibited merely for being recursive, and their evaluation follows the standard. This baseline
neither proves author-stated semantics nor promises complete static satisfiability or
contradiction detection for arbitrary schemas.

### 3.13 Bounded contradiction checking at admission

Admission must run the following finite checks over the local and inherited contracts.
They establish contradictions, not satisfiability. Collect unconditional conjuncts:
the schema itself, its `allOf` branches and statically bound `$ref` targets from the
retained map. Follow each exact schema location once; recursive references do not
by themselves constitute a contradiction. Do not treat `anyOf`, `oneOf`, conditional
branches, `not`, dynamic-reference alternatives or example data as unconditional
conjuncts. The floor does not require a general solver for those constructs.

For the complete properties object, and for its direct properties required by a
collected object contract, perform these checks. Deeper property-path expansion is
not part of this bounded floor: recursive data schemas do not require unbounded
static expansion.

| Required check | A proof of contradiction |
| --- | --- |
| Boolean schema | An unconditional `false` schema applies to the value |
| Primitive Type intersection | The intersection of direct `type` constraints is empty; `integer` overlaps `number` and is its subset |
| Required property forbidden | A required name has an unconditional `false` property schema, or an applicable object conjunct has `additionalProperties:false`, no `patternProperties`, and no declaration of that name in its own `properties` |
| Numeric bounds | The allowed primitive types are exclusively numeric and the strongest direct lower bound exceeds the weakest upper bound, or equals it with either bound exclusive |
| String/array/object sizes | The allowed primitive types are exclusively the respective kind and direct `minLength` exceeds `maxLength`, `minItems` exceeds `maxItems`, or `minProperties` exceeds `maxProperties` |
| Required object names | The union of required names exceeds an applicable direct `maxProperties` |
| Graph bounds | For the same governed population, effective minimum exceeds effective maximum under §5.3 |

The complete properties value is an object under the Resource contract. Only when
a value is restricted to objects do required-name and object-closure proofs establish
its impossibility; a permitted non-object value must not be discarded. Required
property schemas are checked using applicable `properties` entries from the
unconditional object conjuncts; optional property contradictions alone do not make
the object impossible. A closed object's own declaration list matters: `allOf`
does not merge `properties` lists. The bounded additional-properties check excludes
`patternProperties` rather than guessing whether a pattern covers the required name.
If another primitive kind can still satisfy a scalar constraint, a contradiction
for just one kind is insufficient to refuse the definition.

The mandatory result is **proved contradiction** or **not established by this floor**.
The latter is unknown, not a proof of validity, compatibility or inhabitation. An
implementation may reject additional contradictions when it can establish them
soundly and explain the applicable requirements; a heuristic suspicion is not a
proof. Regardless of the static result, every concrete instance is fully validated
against all applicable schemas and graph constraints. Authors remain responsible
for semantic promises that mechanical checks cannot establish. This does not change
the rule that an actually impossible contract is invalid; it bounds mandatory
mechanical detection rather than promising a complete decision procedure.

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

The initial profile has conformance only; it introduces no separate compatibility
relation or compatibility-family promise. Explicit T@2 conformance to T@1 is permitted and
makes T@2 satisfy the exact T@1 contract through the ordinary conformance rule. It
supplies no reverse promise. An exact conformance pin never silently matches another
revision through SemVer, age or nominal identity.

### 4.1 Proposed informational version label

An optional descriptor `version` may carry SemVer syntax, such as `2.1.0`.
The author supplies it; the immutable Bead revision remains the exact identity of
recorded content. It is not an alias, matching rule, installation selection rule,
conformance proof or automatic upgrade instruction. Compatibility must include
meaning and behavior as well as structure (dollars versus cents, for example).
The [SemVer specification](https://semver.org/) requires a declared public contract;
this profile treats the label as informational and supplies no SemVer compatibility
or migration guarantee. Syntax checking alone cannot establish that an author's version
increment is truthful.

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
those still pin exact revisions; explicit unpinned author input resolves once to
the Scope-selected installed exact default before commit; without one the write
refuses before acquisition (§7.2). Constraint selectors
may intentionally remain identity-wide and do not consult that write default.
Nominal-only query filtering is a distinct operation; it must not accidentally
acquire conformance matching just because both accept Type references.

The Memory proposal illustrates the distinction: Association is an authorable Link
Type, and Guidance, AppliesTo, Supports, Challenges and Supersedes conform to it.
A conformance-aware Association selector includes conformers, while a nominal-only
Association selector does not. Either predicate may separately select an exact
revision or match identity-wide as described above. A fixed product may
compile its supplied membership table; a closed enumeration is not the general
profile's definition of conformance membership.

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
array). Bead endpoint arms may impose Type requirements with `same`, `cross` or
`either` Scope selection. These spellings remain candidate syntax. Scope eligibility
and the availability of trusted Type facts are separate checks. A general
external `resource` arm is opaque and carries no Type requirement. Link endpoints
are not enabled by this Type-profile syntax; their admissibility is a Core question.

**Registered exact Type definitions can satisfy endpoint Type constraints across
origins for any Link Type.** Use the locally accepted definition's exact state and
retained dependency closure to check its Bead-Type affiliation/conformance. This is
the same trusted dependency resolution used for Types (§7.2), not a network request
or permission to mutate the definition. IDs and their Scope classification do not
change. A `same` condition still excludes cross-Scope endpoints; registration alone
cannot bypass it. ConformsTo's candidate pairs therefore use `either` rather than
silently ignoring a `same` condition.

**Arbitrary external graph resources remain opaque.** The Scope may inspect reference
syntax and addressing, but does not fetch to establish remote Type, existence,
content or immutability. A specific Type constraint on a cross-Scope endpoint can
succeed only from accepted exact definition state; an unregistered foreign Bead or
web resource is not proved conforming by its URI or presence in a cache. Wildcard
Bead arms and opaque `resource` arms impose no Type check; `resource` arms carry
no `types` member. The generic descriptor schema permits typed `cross`/`either`
arms, but property-shape validation alone cannot establish the required registration
and exact-state facts. A checked foreign-definition endpoint must explicitly pin the
exact definition revision. An unpinned foreign endpoint cannot use this checked path,
even if only one revision is retained or a local Type-write default is selected.
Ordinary local floating endpoints remain supported. An opaque external reference can
still match a wildcard/opaque arm where allowed; it does not gain a checked Type claim.
Reference classification/canonicalization still needs precise Core rules.

Arity, uniqueness and acyclicity apply across the combined family, not separately
per alternative. One Link matching multiple alternatives counts once per rule.
No generic endpoint `pinned`/`floating`/`either` restriction is added now; both
reference forms remain possible, subject to any intrinsic domain semantics.
A pin on an external endpoint does not establish that the resource exists or is immutable.

Domain semantics can narrow the generic permissions. For example, the Memory
product proposal permits local Issue→Memory, Memory→Issue and Memory→Memory
Association pairs; each specialization retains its narrower pairs. Supports and
Challenges require an author-selected exact target, while Supersedes permits current
or exact targets. Those intrinsic domain meanings do not introduce a generic
pin-mode descriptor field. The selected Memory product admits only same-Scope graph
endpoints; broader exploratory BDP examples do not widen that product contract.

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
Registered exact definition endpoints follow §5.1's common local validation rule;
arbitrary external resources remain opaque and their Type is not remotely validated.

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

Valid Types and graphs can be read without implementing Write. A writing server
without an atomic operation capable of constructing a required-minimum graph may
be unable to create that graph or express some valid transitions. It must reject
an invalid single write rather than relax the minimum. This does not require batch,
ban positive minima, or promise that every valid Type is constructible through every
server's supported write operations. Creating or changing a Bead to a Type with a
positive minimum creates an obligation on the resulting Bead. Deleting that Bead removes its own obligation,
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

A conforming Bead Type also inherits the ownership declarations of its Bead-Type
ancestors. Each local or inherited `ownsOutgoing` selector imposes an ownership
obligation. The effective owned set includes the matches of all those selectors:
a union of required ownership, not an intersection of selectors. A narrower local
selector cannot remove an inherited obligation. In the foundation graph, the BeadType
and LinkType **definition Beads** are affiliated with BeadType, which conforms to Type;
their owned declarations therefore match Type's inherited selector. This does not let
Link-Type descriptors declare `ownsOutgoing` for the Link instances they describe.

After ownership selection, group `ownedLinks` by each Link's **actual nominal Link
Type identity**, without its Type revision. Every selected Link appears once, even
when several inherited/local selectors or conformance paths select it. A conforming
specialization is grouped under its own nominal identity, not under each ancestor
selector. Wildcard selectors create no wildcard key. An empty owned set is `{}`;
there are no empty buckets for selectors that currently match no Links.

These projection rules require a coordinated Core amendment: adopted Core's explicitly
declared ownership keys and empty-entry convention are not silently changed by this
profile. The literal fixture uses the proposed grouping and empty-set shape. Exact
Link records retain their own Type revision pins; grouping does not erase those pins
or reinterpret historical owned snapshots.

Creating, modifying or deleting a matching owned Link has the source-revision
effects required by Core ownership semantics. Conformance establishes membership;
it does not grant authorization or bypass other constraints. A Link outside the
selected family is not owned by this declaration, though another ownership rule
may apply. Historical Bead revisions retain their recorded owned-Link state;
current matching rules must not reinterpret old revision contents.

An explicit Link Type change may make the Link enter or leave its source Bead's
owned set. Either transition creates a new source Bead revision atomically with
the new Link revision, even when the Link's properties are unchanged. The new source
revision records the resulting owned set; earlier source snapshots and Link revisions
remain unchanged. Both additions and removals are source changes: evaluating only
whether the new Type is owned would miss removal from the old owned set. If the
complete resulting state fails validation or a required revision precondition, neither
revision commits. This rule supplies no automatic repair or cascading transformation.

When the source Bead itself is explicitly retyped, recompute its current owned
set from its existing outgoing Links using the new Type's effective ownership rules.
Record that resulting set in the new Bead revision. The Link revisions remain
unchanged unless those Links are explicitly edited in the same atomic change.
Validate the complete resulting graph; an invalid result rejects the change atomically.
Earlier Bead snapshots and Link revisions remain unchanged. This is a change to the
Bead's recorded ownership, not an implicit rewrite or repair of its outgoing Links.

Endpoint movement and the pre-/post-mutation meaning of a pinned source reference
remain explicitly deferred for further design; no pre-/post-mutation interpretation
is selected. These ownership decisions do not specify the exact number
of revisions produced per Resource by a multi-operation batch. Ownership selector
syntax and exact-definition evolution remain open alongside the other matching and
lifecycle decisions. Registering a new definition alone
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
| Replace ordinary writable properties while a service read-only field is required | Service supplies/recomputes that field, preserves init-only values, then validates the complete result |
| An update or replacement attempts to change an initialization-only value | Reject; initialization-only values remain unchanged across revisions; retyping behavior remains open |
| Service read-only value changes as part of a new revision | Record the new value in that revision; earlier revision contents remain unchanged |
| Replacement omits mandatory caller-writable approvalCode | Reject; do not preserve omitted writable data as an implicit merge |
| A live heartbeat changes while an exact Resource revision is read | Do not alter that revision's properties; observation data belongs outside revision-covered properties |
| Two inherited ownership selectors match the same Link | Include the Link once under its actual nominal Link Type identity |
| Owned Link conforms to ConformsTo but has its own specialized nominal Type | Group under the specialization's identity, preserving the Link's exact Type pin |
| No outgoing Links are selected as owned | Project ownedLinks as an empty object, not empty buckets per selector |
| Registered global definition is available in local Type inventory | Preserve canonical origin identity/authority; do not treat retained declarations as new local writes |
| Bead or Link changes only its Type identity; properties/metadata are equal | New Resource revision; prior exact affiliation and owned snapshot remain unchanged |
| Type identity stays constant but its pinned definition revision changes | New Resource revision; no semantic no-op based only on equal properties |
| Update omits Type; a newer definition is registered | Preserve the existing exact affiliation |
| Type identity has installed r1 and r2; Scope explicitly selects r1 as its default | An explicitly unpinned write selects and stores r1, regardless of origin current state |
| Install r3 while r1 remains the selected default | Future explicitly unpinned writes still select r1 |
| Explicitly change the local default from r1 to r2 | Future unpinned selections use r2; existing pins and omitted-Type updates remain unchanged |
| Write supplies explicit r1 while the local default is r2 | Use requested r1 if admitted and valid; do not substitute r2 |
| An alias resolves to an unpinned Type identity | Write selection uses that identity's explicit local default; alias creation/repointing does not select or promote a default |
| An alias resolves to an exact Type revision | Preserve that requested pin rather than replacing it with the local default |
| Identity-wide query or constraint is evaluated after a write-default change | Matching is unchanged; it does not resolve through the write default |
| Unpinned Type input has no selected local default, even with one installed revision or automatic installation enabled | Refuse before acquisition; caller can provide an admitted exact pin or explicitly select a default |
| Link Type change makes an unowned Link enter its source's owned set | Commit new Link and source revisions atomically; preserve earlier snapshots |
| Link Type change makes an owned Link leave its source's owned set | Commit new Link and source revisions atomically; new owned set omits the Link, earlier source snapshots retain it |
| Link Type ownership transition fails validation or a required guard | Commit neither revision; no automatic repair or partial owned-set change |
| Source Bead changes Type with a different effective ownership selection | Its new Bead revision records the recomputed set of existing outgoing Links; unchanged Links gain no new revisions |
| Source-Bead retyping also explicitly edits an outgoing Link | Apply the explicit Link change atomically and validate the complete resulting graph; ownership recomputation alone does not mint Link revisions |
| Unaccepted S@1 uses a declaration typed S@1 to establish its own ConformsTo membership | Reject the circular justification; the declaration's exact Link Type must already be accepted before use |
| Two unaccepted ConformsTo specializations justify each other through their own Link Types | Reject that justification even if declared target edges form no cycle |
| S@1 establishes conformance through accepted built-in ConformsTo, then is used for a later declaration | Admission dependency is grounded; all remaining validation and ownership requirements still apply |
| Trusted metatype reference loop or recursive JSON Schema | Not rejected merely by the grounded-declaration rule; respective bootstrap/schema rules remain applicable |
| Properties schema omits its root dialect declaration | Evaluate under the 2020-12 baseline |
| Properties schema explicitly selects a conflicting dialect | Reject; do not silently evaluate under a different dialect |
| A string constrained by standard date-time, URI or email format is syntactically invalid | Reject the instance; format is enforced, not merely recorded as an annotation |
| Type relies on an unknown or unsupported format that a validator silently ignores | Refuse the Type rather than claim successful validation |
| Syntactically valid URI names a nonexistent external resource | Format checking alone does not reject on existence or fetch the resource |
| A schema resource in the retained closure declares a different dialect | Refuse, including an embedded resource with its own `$id`; do not treat `$schema` in literal/example data as a dialect declaration |
| A Type names a custom derived meta-schema URI | No implied acceptance; extension presentation remains open under the current standard-dialect-only contract |
| Required property is constrained to number by one contract and integer by another | Do not report an empty Type intersection; integer values satisfy both |
| Optional property has disjoint string/number requirements and omission is allowed | Do not reject the Type as uninhabitable merely because the property cannot be supplied |
| Required p permits string or object; its schema requires x and has maxProperties zero | Do not reject merely because the object alternative is impossible: p="ok" remains valid |
| Contradiction lies outside the mandatory finite floor and is not otherwise proved | Report static result unknown; enforce full validation on every concrete instance |
| Standard meta-schema requires an unsupported baseline vocabulary | Refuse the definition; ignoring its asserted requirements is not validation |
| Ordinary schema contains an unknown annotation | Do not invent assertion semantics; adding `$vocabulary` to an ordinary schema is not a required-extension negotiation mechanism |
| Publisher changes bytes at a referenced schema URL after Type revision acceptance | Continue using that revision's retained exact closure and bindings; no newer remote substitution |
| Required referenced schema resource is missing from the retained closure | Do not validate as though the missing requirement succeeded or fall back to live newer content |
| Recomputed owned set or other final graph constraints make source-Bead retyping invalid | Reject atomically; leave prior affiliation, owned snapshots and Link revisions unchanged |
| Supplied Type resolves to the already stored exact reference and no other state changes | No Type change by itself; ordinary no-op rules apply after revision preconditions |
| Stale guarded retyping would otherwise be a no-op | Reject the stale guard without mutation |
| Retyping plus targeted property edit leaves unrelated properties present | Preserve those properties; validate the complete resulting record and affected graph atomically |
| Replacement omits an actual Type's required caller-writable property | Reject atomically; do not retain the missing writable property as a hidden merge |
| Decision and Requirement use the same property shape | Keep distinct Type identities and meanings; schema equality does not infer conformance |
| Open instance schema receives an undeclared kind property | Treat it as extension data; do not dispatch affiliation or substitute it for required fields |
| Association family versus nominal-only Association selection | Family includes conformers; nominal-only excludes them; revision selection remains a separate exact/identity-wide choice |
| Memory product uses compiled fixed Type definitions | Does not by itself claim the optional BDP Types profile or an installable definition format |
| Registered exact definition and pinned conformance closure have IDs in another Scope | Validate and match from retained accepted local dependencies; preserve original IDs and exact pins |
| Registry is offline while the complete accepted exact closure is retained | Type/category/conformance checks need no online fetch |
| Publisher changes its current definition after an exact closure was registered | Keep validating the retained exact closure; do not substitute new remote state or adjacency |
| An unregistered foreign definition happens to be in an opportunistic cache | Cache presence alone does not establish admission for use |
| Required exact declaration/definition is unavailable locally | Do not accept the missing contract as satisfied or fall forward to a newer revision |
| Registered global definition is used for local validation | Does not grant authority to mutate its origin or change its canonical Scope |
| Any Link crosses origins but its applicable descriptor permits only same-Scope endpoints | Registration alone does not bypass that restriction; reject the incompatible endpoint selection |
| Any Link uses a cross/either arm to reference a registered exact global definition with the required Type | Permit that endpoint match from retained accepted facts; apply all remaining Link constraints and authorization |
| Same arm names an unregistered foreign Bead claiming the required Type | Do not accept the Type claim or fetch remote content to make the check pass |
| Typed foreign endpoint has no explicit revision, but its definition is registered and has a local write default | Refuse the checked endpoint match; do not infer a pin from the write default |
| Exact foreign definition endpoint satisfies its Type requirement but its arm requires same-Scope | Refuse; exact registration does not bypass Scope restriction |
| Auto-install is requested only by caller, or enabled only by Scope | Refuse automatic installation; both conditions are required |
| One requested dependency fails graph registration | Register none of the newly requested graph; preserve pre-existing registrations; cached bytes remain unregistered |
| A referenced schema is changed in a later Type revision | Old instance pins continue using their old root and schemaResources map |
| Arbitrary external Bead or web resource shares a registry's host or URI pattern | No trusted-definition inference or general endpoint-Type validation |
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
| Cross/either Bead endpoint arm asks for a specific Type | Shape is allowed; matching requires admitted exact definition facts for a cross-Scope endpoint, never an arbitrary remote fetch |
| External resource changes or disappears | No remote validation guarantee; stored reference remains a reference |
| Cycle alternates between endpoint arms or sibling Link Types and includes a Link subject to acyclicity | Reject at commit using the declaring family across all arms/revisions |
| Batch temporarily creates a cycle then removes it | May commit if final graph satisfies all constraints |
| An @1-only cycle exists at A→B→A; independent @2 C→D adopts acyclicity | Allow C→D; old Links do not acquire the promise implicitly |
| Add @2 C→A where A is in that old cycle but no path returns to C | Allow: the constrained Link itself is not in a cycle |
| Add an @1 Link that completes a cycle through an existing constrained @2 Link | Reject; old Type usage cannot evade the existing Link's promise |
| Link endpoints use differing revisions of the same identity in a cycle | Pins do not evade identity-based acyclicity |
| T@2 explicitly declares conformance to T@1 | Permitted with all T@1 promises; no reverse or age-based compatibility is inferred |
| Two paths reach the same requirement location in C@1 | Apply that originating exact requirement once; retain restrictions contributed by distinct declarations |
| Paths reach the same location in C@1 and C@2 | Apply both exact-version requirements; text equality does not merge their identities |
| Type is retired after instances pin it | Refuse new affiliations; continue validating existing-instance updates and retained reads/history against its exact contract |
| Selected local write default is retired | Remove or replace that default; do not silently choose another installed revision |
| Intrinsic bootstrap graph is upgraded | Retain previous exact graph versions for existing pins; no ordinary client edit or same-pin content replacement |
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

The shared design already selects exact affiliations, Type-to-Type conformance,
conjunctive schemas, correlated endpoint alternatives and the mixed-revision cases
in §5. Do not treat their implementation or wire propagation as a new product choice.
The remaining decisions are narrower:

| Area | Selected rule | Decision or contract work still needed |
| --- | --- | --- |
| Retyping and affected graph | Guarded explicit whole-reference replacement; complete-result validation; Type-only changes version; Link retyping entering/leaving ownership atomically revises the source; source-Bead retyping recomputes its owned set without implicit Link revisions; history stays immutable | Precise floating-endpoint revalidation and endpoint/pinned-source transitions; which checks defer to commit and revision production across batch members; coordinated Core/Write requests and diagnostics |
| Schema admission | JSON Schema 2020-12 validation and syntactic format enforcement; unknown/unsupported formats and required vocabularies refuse; immutable descriptor-contained schema map; inherited schemas all apply; bounded contradiction floor (§§3.12–3.13) | Map serialization/binding details, extension presentation and defined semantic annotations; no complete satisfiability proof |
| Exact conformance closure | Exact target pins, no exact-revision cycles; ancestor requirements deduplicated by originating exact definition/location; distinct declaration restrictions retained | Concrete location/qualifier representation and diagnostics; distinct from once-per-instance-Link counting |
| Constraint evolution | §§5.4, 5.6 and 5.8 select local activation with cross-revision family populations and per-Link acyclicity | Precise inherited-declaration activation and selector/diagnostic syntax; no Scope-wide minimum over installed definitions |
| Definition resolution | Registered exact global definitions satisfy endpoint Type checks for any Link, with explicit endpoint pins and Scope restrictions intact; arbitrary external resources remain opaque | Installation operation mechanics, Scope classification and inventory/read projection; locally retained available inventory does not rewrite origin identity/authority |
| Bootstrap and declaration admission | Shared published exact intrinsic graph loaded by trusted initialization; prior versions retained on upgrade; no client mutation; declaration Link Type accepted before use | Production namespace/publication artifact, upgrade activation and operation/batch/import admission ordering |
| Availability and lifecycle | Atomic requested-graph registration; automatic installation requires Scope and caller opt-in; explicit local default; retirement preserves existing use/history and removes/replaces retired defaults | Registration/retirement granularity, operation/permission contracts and physical-removal retention |
| Revision compatibility | Conformance only initially, including explicit same-identity revision conformance; none inferred from age/SemVer; no migration guarantee | Optional version-label publication semantics |
| Property write/read boundary | Replacement covers ordinary writable fields, preserves init-only values, rejects changes to them, and completes service read-only fields before validation; live observations are separate | Field designation/annotation syntax, init-only retyping, observation representation and shared signing/provenance contracts |
| Definition representation | Descriptor fields plus owned ConformsTo Links; candidate schemas and final-state seed | Final field requiredness and selector syntax; installable graph creation/preservation format remains §7.1 work |

Issue/Dependency exercises workflow-sensitive properties, classification-to-Type
translation, computed/live observations, ownership and optional graph constraints.
Replacement of ordinary writable properties, preservation of initialization-only
values and service completion before validation are selected (§3.6); field designation,
annotation syntax and initialization-only retyping remain to specify. Live observations remain outside revision-covered properties. Memory exercises reusable
content, same-shape semantic Types, informational Link families and pinned citations.
Their product contracts are requirements for the shared model, not automatic
precedent for every domain.

Shared History/provenance owns recovery and attribution operations. The accepted
product Inception/revert direction is recorded in the
[decision register](https://github.com/gastownhall/beads/issues/7656) and
[Provenance V2 proposal](https://github.com/gastownhall/beads/issues/7510); it is not
an adopted BDP Type-profile wire shape. A recovery operation validates the state
it actually produces. Restoring properties and metadata does not imply rollback of
Type affiliation, endpoints or other Links, nor rewrite earlier owned snapshots.
Exact recovery admission and field selection belong to the shared operation contract.
A Type-definition recovery/retention policy is still needed before claiming support.

The [earlier completion list](https://github.com/gastownhall/bdp/blob/cbd59b601875ec5c20dd189c22a95ccad4b33390/docs/design/types-completion-decisions-20261014.md)
is historical planning material, not an additional normative source or a current
list of undecided rules. The current open decisions are recorded in this section.

### 7.0 Local authoring and availability

Successful creation of a valid Type-definition Bead makes that exact definition
revision available for explicit exact references in the Scope. Unpinned use still
requires a separately selected local default (§7.2). There is no separate local
activation/publish step in this proposal. Validate the definition and required
conformance closure before acceptance. Ordinary Bead operations and specialized
CLI commands must enforce the same rules. A new definition revision does not
upgrade existing affiliations or activate graph constraints on old instances.
Registry identity, publication authority and retirement are selected in §§7.2–7.3.
Physical retention/removal details and bootstrap publication mechanics remain lifecycle work;
the portable import/export format is a separate design exercise.

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

For the general extensible Types system described here, the intended distribution
model keeps only bootstrap definitions intrinsic and supplies common ordinary
Types through retained registry graphs. Pre-installation mechanics remain open.
Foundation binary upgrade/version coordination does not permit ordinary clients
to revise intrinsic definitions.

That distribution direction does not require every Beads release to implement the
general system. The selected Memory V1 product may supply a fixed catalog and compiled
validation without user-installed Types or a public commitment to Type-definition
representation. It must preserve accepted Type identities, meanings and historical
interpretation. Its fixed implementation does not by itself advertise this optional
BDP Types profile or make every supplied product Type an intrinsic bootstrap Type.

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

**Registered exact definitions are trusted local dependencies.** Once accepted,
the locally retained exact definition and its pinned conformance dependency closure
supply the semantic input for Type validation, category checks and conformance
matching, even when their globally addressed IDs belong to another Scope. Follow
the exact recorded owned declarations and target pins; do not consult live remote
adjacency or substitute a publisher's newer revision. No online fetch is needed for
these checks when the required accepted closure is retained. Missing required exact
dependencies cannot be treated as satisfied or replaced with current state.

This trust is the Scope's admission of an exact definition for use, not a claim
that a signature was verified or that every author-stated semantic promise was
mechanically proved. The admission/verification mechanisms still need specification.
It neither changes the definition's canonical ID or Scope nor grants authority to
mutate the origin. It is a specific definition-resolution rule, not a promise to
validate arbitrary external Beads, Links or web resources. Mere cache presence,
alias resolution or a well-formed foreign URI does not establish this accepted status.

Registration of a requested dependency graph is atomic: accept the requested graph
only when every required definition, exact conformance dependency and schema resource
has passed admission. On failure, none of the newly requested graph is registered;
pre-existing registrations remain unchanged. Retrieved bytes may remain in a cache,
but cache presence is not registration or permission to use them. This selects the
registration boundary, not a new shared Core transaction or transport API.

The Scope's Type inventory includes locally retained available definitions, including
registered definitions whose canonical IDs belong to another Scope. This is distinct
from its ordinary local graph inventory: availability does not rewrite IDs, transfer
publication authority, or make installed copies newly created local Beads/Links.
Mere cache entries are not admitted Type inventory. Inventory can distinguish retained
availability from eligibility for new affiliation, including retirement; no response
fields or lifecycle commands are selected here. Exact inventory/read projection and
the install/register/publish/create/delete/uninstall operation boundaries remain to
specify. Authoritative retained declarations keep their original Scope identities and
recorded owned-source context; inventory exposure is not a new receiving-Scope write.

The selected acquisition modes are:

| Mode | Behavior |
| --- | --- |
| Require registration (default) | Refuse use of a Type not registered for the Scope; do not automatically install it. |
| Automatic installation (explicit mode) | Only after input resolves to an exact revision (explicit pin or selected local default), acquire and validate that Type and its required graph, then validate the instance. Unpinned input without a selected default refuses before acquisition. Installation never selects/promotes a default; retrieval or failed validation does not admit an unvalidated instance. |
| Unvalidated use | Not supported initially. A possible future mode would need an explicit persisted indication that a Bead/Link was not validated; it must not silently claim ordinary Types-profile validation. No representation or bypass mechanism is selected. |

Automatic installation requires both Scope authorization and an explicit caller
request for that operation. Either condition alone is insufficient; the default is
require-registration. This is the initial policy and may be revised separately in the
future. Operation syntax and the permission-management surface remain to specify. The
precise registration granularity (identity versus exact revision/closure) remains
open; identity recognition must not be confused with possessing and validating the
exact definition required by a stored pin. Cache population alone does not authorize
use. Registry discovery and absolute-ID routing do not imply automatic installation.
For each Type identity, the Scope explicitly chooses an installed exact revision
as the default for future explicitly unpinned Type writes. Resolving such input
selects that local default, not the origin's current revision or whichever revision
was most recently installed. The resulting stored affiliation is an exact pin.
Installing another revision alone leaves the selected default unchanged. An explicit
change of default affects future unpinned selections; it does not move existing
Resource affiliations, change their historical meaning, or alter an update that
omits Type. Explicitly pinned input names its requested revision independently of
the default and remains subject to normal availability and validation rules.

Alias resolution first produces the canonical Type reference. A pinned alias target
retains its pin; an unpinned alias target uses the default for that canonical identity
when used as write input. Creating or changing an alias does not promote a revision
to default. Identity-wide constraints and queries still match as specified in §4.2;
they do not resolve through this write default.

Without a selected local exact default, explicitly unpinned Type input cannot
resolve and the write is refused before acquisition, even in automatic-installation
mode. Installation never selects or promotes a default. This remains true when only
one revision is installed: the implementation must not guess from installation order, revision-token
ordering, a sole installed revision or origin availability. A caller can supply an
explicit admitted exact pin or explicitly select a default before using unpinned input.

The operation/permission contract for selecting a default, including initial selection,
remains to specify. No first-install automatic selection or fallback is introduced.
This refusal is a consequence of requiring explicit local selection, not a new
Type-discovery or installation mechanism.

Acceptance cases: two Scopes installing the same graph preserve exact Type equality;
registry outage does not break use of retained definitions; conflicting exact copies
fail; unauthorized local publication under an imported registry identity fails;
an authorized routed origin update follows ordinary write rules; an explicit local fork
has a new identity; obtaining a newer publisher revision leaves existing pins intact.
Installed replicas' exposure through Scope reads/listing, distribution format,
authority verification and physical retention/removal behavior remain to specify. In
particular, accepted local availability does not turn a globally addressed replica
into an in-Scope resource. Semantic resolution of its registered exact definition
and pinned conformance closure is selected above. The remaining integration work is
operation-level resolution and replica exposure, not whether admitted exact
definitions may satisfy Type checks on any Link's endpoints. Ordinary endpoint opacity in
§5 continues to govern arbitrary external graph resources.

### 7.3 Retirement and retained use

Retirement stops new affiliations with the retired definition; it does not destroy
that definition or invalidate instances already affiliated with it. Existing instances
remain readable and may be updated while retaining their exact Type affiliation,
subject to its unchanged validation and graph requirements. Retained historical
revisions keep their interpretation. Retirement is not an automatic migration or a
relaxation of the retired contract.

A local default that selects a retired definition must be removed or explicitly
replaced with an eligible installed exact definition. Removing it leaves unpinned
writes without a default, which refuse under §7.2; retirement does not silently
promote the newest or sole remaining revision. Explicit pins cannot bypass the
prohibition on new affiliations.

Physical removal waits until retention obligations permit it, including the exact
definitions, schemas and declaration states required by existing instances and retained
history. Retirement is not erasure. The operation/permission model, retirement granularity,
and physical removal/retention policy remain to specify. This rule does not choose
recovery semantics for a deleted identity, rewrite previous revisions, or restore
retired definitions automatically.

### 7.4 Local aliases for canonical references

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

Design selection, adopted protocol, and runtime qualification are separate states.
The following table describes this draft; it does not mark current Core/Write or
Beads behavior as implementing its proposed semantics.

| Item | Design state | Remaining adoption or evidence |
| --- | --- | --- |
| Optional Scope-wide Types boundary | Selected direction (§1) | Coordinated canonical Core/Write and discovery amendment |
| Exact affiliations and explicit retyping | Selected for Beads and Links; whole-reference replacement, Type-only revisions, atomic source revision for Link ownership transitions, and recomputed owned set on source-Bead retyping (§§2, 5.7) | Wire/schema propagation, affected-Link/endpoint transition and batch revision details, runtime qualification |
| Conformance, structural and semantic | Selected foundation (§3), 2020-12 validation and format enforcement, refusal of unsupported required extensions and immutable schema closure; read/write responsibilities distinguished | Bounded floor qualification, map/extension and origin-location representation, semantic annotations; exact format-support qualification |
| Constraint matching and populations | Pair unions, inherited conjunction, exact/identity-wide selectors and identity-based populations selected (§§4.2, 5) | Final selector syntax, inherited activation and local transition/availability checks; arbitrary external-resource validation excluded |
| Arity, uniqueness and acyclicity | Transaction-final checks and the mixed-revision cases selected (§5) | General graph validator, atomic mutation and exact-source qualification NYI |
| Definition representation | Definition Beads, descriptor fields and owned ConformsTo Links; shared exact trusted bootstrap selected; candidate schemas/seed present (§2) | Production bootstrap publication, lifecycle operations and resolution qualification |
| Property write/read boundary | Writable replacement, init-only preservation/change refusal, service read-only completion and separate live observations selected (§3.6) | Field designation/annotation syntax, init-only retyping, observation representation, shared Write adoption and provenance-owned signing mechanisms |
| Conformance graph operations | Owned historical declaration authority, tightening-only specialization and already-accepted declaration Link Types selected | Core amendment for nominal-identity grouping/empty-set projection, source-pin/traversal/admission-ordering operation contract, performance and historical-query qualification |
| Acceptance cases (§6) | Written review cases | Property/example checks cover only their documented shape/finite-graph subset; runtime cases remain unqualified |
| Shared provenance and recovery | Shared owners and accepted product direction identified (§7) | Shared schema/operation adoption; no parallel Types implementation |
| Fixed Memory product | Separate product proposal; fixed catalog/compiled validation need not expose Type definitions | Native catalog, properties/history, pins, mutation and release evidence tracked in Beads #7656 |
| General Type lifecycle and packaging | Authority, retained meaning, atomic registration, Scope/caller auto-install opt-in, explicit local defaults and retirement with preserved use selected (§7) | Operation syntax/permissions, registration/retirement granularity, physical retention/removal, bootstrap publication and portable format |

Continue through focused branches and coordinated, bounded amendments against current
BDP and Beads sources, with acceptance cases and explicit implementation status. Do
not merge accumulated design work as an implicit runtime migration. The structural
Core/Write split is complete; their semantic propagation is separate from finishing
this draft. Pending batch, lifecycle Event and interchange proposals do not become
adopted wire contracts through references in this document.
