# BDP Types

Work-in-progress BDPv0.1 design specification, reconciled October 22, 2026. This document records
agreed design rules and explicit open decisions for an optional, Scope-wide Types profile. It is not yet
an adopted protocol specification, an installable definition format, or a claim
that Beads implements these rules. The [current BDP specifications](../../README.md)
remain the protocol authority until coordinated amendments land. Landing this
document on the v0.1 integration branch makes the evolving design available for collaboration; it does
not adopt its candidate wire shapes or require implementation of unfinished rules.

The [Issue and Dependency draft](../../types/issue/issue.md) and
[Memory draft](https://github.com/gastownhall/bdp/blob/21fa91d3e189bff3832bd977c3d6be49f2b5d93c/specs/types/memory/memory.md)
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

For a guided introduction, read the [Type definitions](../../types/type-system/type-system.md#overview-informative)
and their [worked example](../../types/type-system/type-system.md#a-worked-example-informative).
The [canonical Types CLI companion](../../../docs/cli-design/types-cli.md) separates
command presentation from the detailed semantic rules in this profile.

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

Activation must establish that promise for the live and retained Resource revisions
covered by the Scope's Types claim, including their exact affiliations and required
retained definition closure. There is no prospective grandfather boundary for older
covered records. If an older record lacks the required exact affiliation or its
meaning cannot be established from retained definitions, refuse activation rather
than guess a pin or rewrite history. A Scope may remain Core-only; a fresh qualifying
Scope is another option. This selects the activation obligation, not a migration
operation or a requirement to advertise general application History.

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

### 1.1 Descriptor specification and profile rules

The [Type descriptor specification][descriptor-spec] defines the abstract format
of Type, BeadType and LinkType descriptors and the abstract Refines field format:
field shapes, requiredness, defaults, local shape restrictions and concise normative
field meanings. This profile defines how those declarations are interpreted and
enforced together: affiliation, conformance, schema composition, graph constraint
populations, revision effects, admission, lifecycle and conditional write obligations.
The descriptor does not need to restate those detailed rules. The profile also
selects the intrinsic bootstrap values (§§2.2–2.3); these use the descriptor format
and do not create a second abstract field inventory.

Both documents are normative parts of the **proposed design**, not adopted BDP
behavior. Each rule has one detailed home; a field summary references that rule
instead of independently redefining it. Disagreement is a specification defect to
repair, not an implementation choice or a rule that one document silently wins.
Markdown authoring syntax does not determine the scope of the Type system.

The working descriptor is now deliberately colocated at
`specs/types/type-system/type-system.md` in BDP. Trish owns the descriptor and
profile correspondence. This handoff ends the temporary authoring placement in
`donnabox/memory-beads`; its exact source commit and original-byte digest remain
recorded in the artifact README. The original document and its history are
preserved. The local descriptor and this profile jointly specify the proposed
v0.1 design; relocation does not adopt that design into released Core/Write.

The [local JSON schemas and literal graph](README.md) are candidate machine-readable
companions and review fixtures. They do not independently redefine the descriptor
or prove enforcement of the profile. They remain here during the authoring trial;
no generated-code or lossless Markdown conversion claim is made. A notation unable
to preserve a rule must report that limitation, not drop the requirement.

The descriptor's immutable source and original-byte digest are recorded in
[the artifact README](README.md#source-and-status). Subsequent local changes require
descriptor/profile/schema correspondence review at the exact candidate commit;
the origin digest is not a digest of the amended local document.

[descriptor-spec]: ../../types/type-system/type-system.md

## 2. Definitions, identity and affiliation

A Type definition has a stable identity, an immutable revision, a properties
schema, and semantic promises. It describes Bead or Link instances. Its schema
applies to the instance's `properties`, not to the whole common Resource envelope.
Within this profile, a Type definition is represented as a Bead. The instance's
Type reference is interpreted as a Bead reference to that definition; its identity
and revision identify the definition Bead and the selected Bead revision. The
abstract definition fields are specified in the [descriptor specification][descriptor-spec];
§§2.1–2.3 define their interpretation and bootstrap. Unresolved choices remain
marked for review.

Affiliation remains the distinguished `type` field on each Bead and Link; it is
not represented by a Link to the definition Bead. Following ordinary incident
Links does not implicitly follow this field into the Type graph. A Type-definition
Bead may participate in explicit graph Links like other Beads, but an instance's
reference to it does not create an edge, ownership or access permission.

The selected common affiliation carrier is an absolute HTTP(S) Type identity URI
string or an object containing exactly `uri` (that URI) and `revision` (a nonempty
opaque revision token). This does not admit relative references or document-local
bindings as stored Type identities. Core-only carrying does not interpret the
reference as this profile's definition language. Coordinated Core/Write schema
and operation propagation is separate from selecting this representation.

An instance saved or returned under the Types profile pins its exact Type definition revision.
Explicit unpinned Type input selects the Scope's explicitly chosen installed exact
default for that Type identity and resolves to that pin before commit. Without a
selected default, the write refuses before acquisition (§7.2).
An omitted Type on update preserves the existing exact affiliation. Supplying a
Type reference replaces that reference as a whole, rather than merging its identity
and revision members.
An ordinary update may explicitly replace the Type reference of a Bead or Link,
subject to ordinary optional Write revision guards and other applicable preconditions.
Retyping introduces no additional mandatory revision guard. The Type replacement
may accompany targeted property edits or explicit full replacement;
complete-result validation does not require every request to replace all properties.
The resulting properties and affected graph must satisfy all applicable constraints,
or the change fails atomically. A committed Link Type change that changes its source
Bead's recorded owned set also revises the source atomically with the Link (§5.7).
For a batch these are changes between the prior and final published states, not
each temporary operation state. The coordinated Write contract must carry this
meaning and revalidate affected incident Links against the final atomic graph
(§5.5). Correcting either endpoint preserves the Link's identity under the
selected endpoint-mutation rule (§5.7); coordinated common request/result binding
remains required. An explicit endpoint pin retains its literal Reference meaning
and is not an owner-membership witness.

A published change to either the Type identity or its pinned definition revision
creates a new revision of the Bead or Link, even when properties and metadata are
unchanged. Affiliation carries meaning and participates in change detection. Atomic
batches stage operations and publish at most one new revision per affected Resource,
according to the complete final revision-covered state (§5.7). Earlier
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
names and shapes belong to the [descriptor specification][descriptor-spec] and
its candidate schemas; the detailed rules below govern their interpretation. Ordinary
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
| Direct conformance declarations | Owned Refines Links, recorded with the source definition revision |
| Properties schema and other constraints | Fields in the definition Bead's `properties`; candidate schemas indexed in [the artifact README](README.md) |
| Later review of a declaration | An independent Activity referencing the declaration Link revision, when the shared Provenance V2 mechanism is supported |

The current direction uses Type-to-Type conformance for reusable structural and
semantic promises. A separate Capability entity is not required by the rules
below; it should be introduced only if a distinct requirement warrants it.
"Capability" in Scope feature discovery is not this Type conformance relation.

### 2.1 Type, BeadType and LinkType

Use the Type, BeadType and LinkType definitions in the
[descriptor specification][descriptor-spec]. This section governs their category
interpretation and admission; it does not maintain a second field inventory.

The descriptor **is the definition Bead's properties object**. Consequently the
properties schema of Type is the common descriptor schema; there is no additional
independent descriptor-schema layer. The envelope supplies identity, revision,
affiliation, recorded owned state, metadata and revision provenance.

Own affiliation answers what this definition Bead is; outgoing Refines Links
answer what the instances it defines must satisfy. In particular LinkType's
conformance to Type is between two Bead Types, not cross-kind conformance.
A definition's category is determined by the effective Type set of its **own
`type` affiliation**: the exact affiliated Type plus that Type's conformance closure.
It is not determined by adding the types that the definition itself declares
conformance to. There is no second writable `describes` discriminator. Admission must
reject an affiliation whose effective Type set includes both categories. For example,
D affiliated with BeadType may specialize the LinkType metatype: D is a Bead-Type
definition whose instances are Link-Type definitions, not an ambiguously categorized D. The common Type is abstract: direct instances of Type are refused. Usable
definitions affiliate with BeadType, LinkType, or a refinement of exactly one
category. The common descriptor's optional `abstract` boolean defaults to false.
True prohibits direct affiliation with that exact definition; it is a direct-use
policy, not an inherited prohibition on concrete refinements. The intrinsic Type
definition sets it to true; BeadType and LinkType remain usable metatypes.

Candidate [schemas and their validation limits](README.md) accompany the descriptor.
The BeadType and LinkType schemas each include the common Type schema and add
their category restrictions.
Their `$ref` factoring is repository authoring. Published schema closure and reference
bindings must be immutable for the Type revision (§3.12). Open descriptor extension
bags do not imply that unknown semantics are understood or enforced.

Type owns Refines; BeadType and LinkType inherit this behavior. That governs
**definition Beads**. A descriptor's own `ownsOutgoing` instead governs the instances
it describes. Neither rule synthesizes affiliation edges in the ordinary graph.
Passing a properties schema does not establish semantic compatibility, valid
conformance closure, supported constraints, category agreement or admission for use.

### 2.2 The Refines Link Type

**Naming and artifact correspondence.** Refines is the selected name for the
Type-to-Type relationship, distinct from the Memory Conformance claim family.
The working descriptor, adjacent schemas and literal candidate graph use Refines
and `refines.properties.schema.json` consistently. Historical source commits keep
their original ConformsTo names. Renaming these proposed artifacts supplies no
stored-identity migration, compatibility alias or production bootstrap publication.

The intrinsic bootstrap **Refines** is defined by a Bead affiliated with LinkType.
The following selected seed values instantiate the descriptor format. Its endpoint
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
exemption reserved for Refines (§5.1). The candidate Refines descriptor uses
`scope: either` for its category-preserving pairs, allowing same- and cross-origin
definitions whose exact state is accepted locally. Registration does not redefine
`scope: same` or bypass any explicit endpoint-Scope restriction. Unregistered or
arbitrary external endpoints remain opaque; accepting definitions does not grant
permission to mutate their origin.

Endpoint eligibility does not grant write authority. A descriptor arm that can match
a registered foreign definition does not authorize revising that definition or its
owned declarations. Retained origin declarations preserve their original identities,
Scopes and exact owned-source context; exposing or admitting their retained semantic
closure is distinct from creating new receiver-Scope Links. The precise source-Scope
and pinned-owned-source operation seam remains deferred (§5.7); this distinction
adds no endpoint restriction bypass.

The descriptor supplies the abstract Refines field format; the intrinsic seed
selects the values discussed here. Its
structural and semantic promise is interpreted by §§3.1–3.9; exact-revision DAG
validation belongs to §3.8, and recorded source ownership/declaration admission
belongs to §3.10. Common Link revision provenance applies; later Activities may
reference an exact declaration revision when the shared mechanism is supported.

The [Refines properties schema](refines.properties.schema.json)
is an open object with no required relationship-specific fields. No conditional
membership, confidence or method semantics are invented. No arbitrary maximum is added. Across Refines and every accepted specialization,
one source definition state may contain at most one direct declaration to a given
exact target definition revision. Duplicates refuse atomically rather than being
silently deduplicated. Different exact revisions of the same parent identity are
permitted and impose all of their requirements. This is an intrinsic exact-target
rule, not the generic identity-based `unique` flag. Additional evidence may refer
to the existing declaration without adding another direct relationship.

General identity-based `acyclic` (§5.8) and exact-revision conformance cycle checks
are different. The example deliberately does not turn on the general constraint:
it would prohibit the permitted explicit T@2 → T@1 conformance as an identity
self-loop. Every inherited promise still applies, and exact-revision cycles remain
prohibited (§§3.8, 4). This corrects the earlier illustrative suggestion to set
`acyclic: true` directly on Refines. Source-pin operation details and installation
mechanics remain open; registered exact definition endpoint checks follow the common
rule in §5.1.
Stored target pins are an intrinsic Refines semantic requirement, not a generic
endpoint pin-mode constraint added to the descriptor language.

### 2.3 Literal graph and bootstrap candidate

The candidate trusted seed establishes these exact affiliation relationships:

| Definition Bead | Own affiliation | Direct conformance |
| --- | --- | --- |
| Type | BeadType | None |
| BeadType | BeadType | Type |
| LinkType | BeadType | Type |
| Refines | LinkType | None |
| issue / task | BeadType | task declares issue |
| dependency / blocks | LinkType | blocks declares dependency |

The [foundation graph](definitions.json) contains eight
illustrative definition Beads and four owned declarations: BeadType→Type,
LinkType→Type, task→issue and blocks→dependency. All affiliations and declaration
targets pin revisions. Schema copies match the adjacent artifacts.

Type, BeadType, LinkType and Refines are the intrinsic bootstrap definitions.
They are supplied as a shared exact bootstrap graph: implementations initialize
from the same published stable identities, revision tokens and definition content.
Trusted initialization installs that graph; ordinary Scope operations cannot update
or remove its intrinsic definitions. This is an explicit trusted bootstrap boundary,
not permission for ordinary clients to assign revisions.
The candidate marks Type abstract and affiliates all three metatype definitions with BeadType; BeadType
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
is not automatically an enforced constraint. A general executable vocabulary for such declarations is deferred initially.
Descriptive annotations impose no new checks; required unsupported semantics refuse.

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
| Caller-initialized, initialization-only properties | The caller supplies the initial value; it remains unchanged while the applicable Type contract requires that policy. Attempts to change it during that period are rejected |
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

The common descriptor's optional `propertyAccess` object maps exact JSON Pointer
paths, relative to instance `properties`, to `writable`, `init-only`, or
`service-managed`. It is separate from JSON Schema so value schemas can be reused
with different write policies, including schemas authored outside BDP. Paths
initially traverse object members; arrays are whole values for policy designation.
This does not remove Write's existing array insertion/append, replacement or removal
operations. Per-element policy, wildcards and conditional path languages are deferred.

Omission adds no local restriction; where no applicable policy restricts a property,
it is ordinarily writable. Local and inherited restrictions all apply, with the
tightest compatible rule winning. A local writable declaration cannot override an
inherited initialization-only or service-managed restriction. Incompatible caller
and service supplier requirements refuse rather than selecting a parent. Parent
object replacement cannot bypass an applicable child-path restriction. Unsupported
modes or malformed JSON Pointers refuse admission; syntactic pointer validation does
not prove path applicability, array traversal or runtime enforcement. Numeric object
member names alone are not evidence of array traversal.

Caller-supplied service-managed fields refuse rather than being silently ignored or
accepted through an equality exception. Replacement supplies the caller-writable
set; the service completes its own fields before complete-result validation.

When retyping introduces an initialization-only policy, preserve an existing value
and validate it against the destination definition; an incompatible value refuses
the transition. Do not convert or explicitly replace that existing value in the
retype. If absent, its first value may be supplied during the transition. When
leaving the last applicable contract imposing initialization-only, preserve the
value during departure; later writes follow the destination contract. Inherited
policies remain applicable. This introduces no hidden lifetime identity invariant.
Meaning that cannot be checked mechanically remains the author's responsibility.

These policies do not reinterpret JSON Schema `readOnly` or introduce an `initOnly`
keyword. The [Issue draft](../../types/issue/issue.md#34-observed-write-surfaces)
records existing writable-subset behavior; it does not prove general enforcement.

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

A specialized Link Type that conforms to the base Refines Link Type must
preserve this same promise. The initial descriptor defines no general executable qualifier language.
Descriptive evidence remains permitted; a definition requiring unsupported
additional enforcement semantics refuses admission rather than being silently
accepted. A future executable extension requires an explicit supported mechanism.
A consumer recognizing the base relationship can rely on the base promise; that
does not imply it can validate additional requirements it does not understand.

### 3.10 Conformance declarations are owned Links

Direct conformance declarations are represented by owned Refines Links from
one Type-definition Bead to another. The source declares conformance to the exact
pinned target definition revision. Conforming specializations of Refines also
participate, under the tightening-only rule in §3.9 and transitive ownership
matching in §5.7. The name here describes the selected relationship; production
identity and bootstrap publication mechanics remain open; §2 supplies a candidate
properties schema and seed definition.

A declaration's exact Link Type must already be accepted before the declaration
is used to admit a candidate Type. The candidate cannot use an unproven relationship
to establish its own authority. For example, a proposed specialized Link Type S@1
cannot establish conformance to Refines@1 solely through a declaration itself
typed by the unaccepted S@1. Mutually dependent unaccepted specializations cannot
justify one another this way, even without a cycle among their declared target
edges. Exact target-edge acyclicity alone is insufficient.

A new specialization can instead declare its conformance through the built-in
Refines Type; once accepted, it can supply the Link Type for later declarations.
This specifies the logical admission dependency, not a transaction-start-only rule
or a batch/import ordering syntax. The trusted intrinsic bootstrap in §2.3 remains
a distinct boundary. Its metatype reference loops, and recursive JSON Schemas, are
not prohibited by this grounded-declaration requirement.

The authoritative declarations for T@r are the Link records captured in that
exact Type-definition Bead revision's owned-Link state. Creating, modifying or
deleting a declaration has Core ownership revision effects on its source, measured
at final atomic publication (§5.7). Temporary edits in a batch do not publish
intermediate declaration or definition revisions. Older
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
changing it. A published edit of the declaration itself creates owner revision effects;
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

Refines is a bounded first use of relationships between definition Beads. It
is selected for this draft so we can evaluate ordinary Link editing, declaration
provenance, specialization and graph display together. It is not a decision to
represent every constraint as a Link. Link constraints remain descriptor fields;
possible later reuse of the pattern is a hypothesis to test.

A general Bead/Link viewer can display an exposed Type hierarchy using the actual
Refines Links without understanding their semantic contract. This is a benefit
of the representation, not a claim that today's `bd graph` is qualified against
this future catalog. A current-state view and the exact historical hierarchy of
T@r are different views; the latter requires §3.10's recorded-state traversal.
Instance traversal does not implicitly enter either hierarchy through `type`.

Evaluation should cover editing and retracting declarations, recording later
reviews without altering history, displaying specialized Refines Links, and
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
it or supports its extensions. A general executable extension mechanism is deferred. Any future supported
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

The effective baseline is 2020-12 whether `$schema` is written or omitted.
Implementations supply the standard 2020-12 meta-schema resources; every Type
definition need not carry copies. This provisioning is independent of whether
`$schema` is written. The literal fixture retains some explicit standard copies
for review, but their presence is not a per-definition requirement. Application
schema resources and their exact reference bindings remain retained with each
Type revision and do not permit live retrieval during validation.

The definition descriptor contains both `propertiesSchema` and a referenced-schema
map, proposed as `schemaResources`. This map is immutable with the Type revision;
validation needs neither separate Schema Beads nor a separately mutable sidecar. It
contains the exact referenced application-schema resources needed for offline
evaluation of that definition's root. The standard meta-schema baseline is
implementation-supplied as specified above.
Each inherited definition retains its own root and map; conformance does not merge
independent maps or let a child overwrite an ancestor's reference bindings.

Candidate encoding: `schemaResources` is an object keyed by absolute, fragment-free retrieval URIs,
with JSON Schema objects or booleans as values. It may be omitted when empty. Keys
establish retrieval locations; schema `$id`, fragments, anchors and relative references
keep their standard 2020-12 meanings. Relative external references require an explicit applicable absolute schema `$id`
that establishes their base. Do not invent a base from the Type identity or the
descriptor's download location, or fetch live content to fill the gap. Internal
fragment-only references remain permitted without a root `$id`; standard nested
resource and base resolution semantics are unchanged. Missing references or
conflicting resource-identity bindings refuse admission. Embedded `$id` resources are already carried by their
containing schema and need not be duplicated in the map. Exact spelling and
serialization are review syntax; self-contained immutable descriptor state is selected.

For example, a definition can retain this application root/reference pair (both use the
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
the schema itself, its `allOf` branches and statically resolvable `$ref` targets.
Resolve each reference in its originating exact Type definition's schema environment:
internal fragments and anchors, embedded `$id` resources, and that definition's retained
`schemaResources` map, using standard base resolution. Never merge different definitions'
maps or resolve an ancestor's reference through the child's bindings. An exact schema
location includes the originating definition identity and revision as well as the
resource/location within it. Follow each such location once; recursive references do
not by themselves constitute a contradiction. Do not treat `anyOf`, `oneOf`, conditional
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
| Graph bounds | The candidate's own local/inherited declarations, proved to govern the same counted set, direction and endpoint population, have effective minimum exceeding effective maximum (§§5.2–5.4) |

The static graph-bound check uses only the candidate's local and inherited declarations
whose governed populations are proved identical. It does not collect every revision of
a Link Type merely because an identity-wide selector could match it. For example,
Assignment@1's maximum two cannot statically defeat a candidate requiring three Links
that may instead use Assignment@2 with maximum five, absent an applicable inherited
requirement. Runtime activation and final-state validation remain governed by §§5.2–5.4.

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

Separately from the refusal floor, implementations must warn about the simple direct
optional-property case in §3.2: collected unconditional object schemas declare the
same optional property with disjoint direct `type` constraints. Report that supplying
it is impossible while omission remains permitted; do not refuse the whole Type for
that reason. Use the same number/integer overlap rule. This bounded warning obligation
does not require complete analysis of optional properties under arbitrary applicators,
conditions or semantic constraints.

The mandatory result is **proved contradiction** or **not established by this floor**.
The latter is unknown, not a proof of validity, compatibility or inhabitation. An
implementation may reject additional contradictions when it can establish them
soundly and explain the applicable requirements; a heuristic suspicion is not a
proof. Regardless of the static result, every concrete instance is fully validated
against all applicable schemas and graph constraints. Authors remain responsible
for semantic promises that mechanical checks cannot establish. This does not change
the rule that an actually impossible contract is invalid; it bounds mandatory
mechanical detection rather than promising a complete decision procedure.

### 3.14 Complete exact definition reads

The exact definition Bead revision, its descriptor properties and its complete
recorded owned state are the definition authority. A successful exact read returns
that complete record, including its own exact metatype affiliation, retained
application-schema resources and recorded Refines Link records. Each Link retains
its own identity, revision, exact Link-Type affiliation and endpoints as recorded;
reading an owner revision does not rewrite an unpinned source into an exact pin.
Link and owner revisions remain independently addressed, not a shared token.

Interpretation traverses the accepted finite dependency closure using exact
references and each definition revision's recorded owned declarations (§3.10),
never live incident adjacency or a publisher's latest state. Distinct revisions of
one parent remain distinct requirements. Closure traversal is a sequence of exact
reads, not a requirement to recursively inline the entire graph. Metatype-reference
loops still require visited-exact-reference tracking; they are not Refines cycles.

Initial complete-record reads use explicit operational byte/count admission bounds,
not a new owned-state pagination protocol or invented semantic maxima on Refines,
Memory or every Type. Admission must reject an oversized state before acceptance.
Tightening configuration must preserve promised complete reads of accepted states
or refuse the configuration change; it must not strand definitions or truncate
ordinary records. The exact budgets and coordinated Core read/admission contract
remain source and implementation work.

A Types-supporting Scope must provide authorized narrow exact reads of the
definitions retained for interpretation, including intrinsic definitions and
registered foreign definitions with their original identity, Scope and recorded
ownership context. This does not require exposing general application History or
inserting retained foreign copies into ordinary local graph inventory. Readability
alone grants neither creation/affiliation permission nor a promise of inclusion in
ordinary product Type lists. Category, abstractness and authorization rules still
apply; BeadType and LinkType remain usable metatypes under §2.1.
The [Types-local exact lookup candidate](exact-definition-read.md) now pairs with
the staged [common read binding](../core/type-definition-read.md) and its native
schema helpers. Complete intrinsic example wrappers and exact-pair fixture walks
provide finite source correspondence, not adopted transport or provider qualification.
This section does not adopt History for every
Resource. A lookup miss does not authorize fetch-and-register.

Current authorization applies. Missing, unavailable or undisclosable required exact
state cannot be represented as a successful complete contract, replaced with current
state or silently reconstructed from adjacency. Authorized errors must preserve
normal disclosure rules. No additional legacy HTTP descriptor compatibility view
is required; internal consumers must use the complete representation. This does not
waive old exact meanings, retention obligations or native Issue/Dependency behavior.

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

The descriptor selects the optional `version` field. Published labels may repeat across definition revisions. Exact references use
revision tokens; a label is not an exact selector. No version-range resolution
or compatibility guarantee is introduced.

### 4.2 Exact and identity-wide Type selectors

A pinned constraint `Product@r1` matches nominal affiliation with that exact
revision or transitive conformance to that exact revision. Product@r2 does not
match merely because it has the same identity, a higher version or a SemVer label.
An unpinned constraint `Product` matches any revision of that identity, or a Type
whose exact conformance closure includes any revision of that identity. It never
means “resolve latest each time validation runs.” The predicate is stable even
though future incompatible revisions can satisfy it by identity. Use a pin when
the relationship relies on a particular structural/semantic contract.

This selector rule does not change storage of affiliations or Refines targets:
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
match at least one pair, and both endpoints must match **that same pair**. Within each side, the common Type selector is either `{"anyOf": [...]}` with a
nonempty list of distinct Type references, or `{"any": true}` for no Type
restriction. It is the same shape used by participation and ownership.
Each anyOf entry may be a floating Type reference or `{uri, revision}`;
matching follows §4.2. These selector pins identify **Type references**. They do not
introduce a generic endpoint pin-mode field; the checked foreign-definition path
below separately requires an explicit endpoint revision pin.

```text
Refines:
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
common selector). Bead endpoint arms may impose Type requirements with `same`, `cross` or
`either` Scope selection. These spellings remain candidate syntax. Scope eligibility
and the availability of trusted Type facts are separate checks. A general
external `resource` arm is opaque and carries no Type requirement. Link endpoints
are not enabled by this Type-profile syntax; their admissibility is a Core question.

**Registered exact Type definitions can satisfy endpoint Type constraints across
origins for any Link Type.** The endpoint must itself be a registered Type-definition
Bead, referenced at an explicit exact revision. Registering the Type of an ordinary
foreign Bead does not establish that Bead's claimed affiliation or validate its state.
Use the locally accepted endpoint definition's exact state and
retained dependency closure to check its Bead-Type affiliation/conformance. This is
the same trusted dependency resolution used for Types (§7.2), not a network request
or permission to mutate the definition. IDs and their Scope classification do not
change. A `same` condition still excludes cross-Scope endpoints; registration alone
cannot bypass it. The Refines candidate pairs therefore use `either` rather than
silently ignoring a `same` condition.

**Arbitrary external graph resources remain opaque.** The Scope may inspect reference
syntax and addressing, but does not fetch to establish remote Type, existence,
content or immutability. A specific Type constraint on a cross-Scope endpoint can
succeed only from accepted exact definition state; an unregistered foreign Bead or
web resource is not proved conforming by its URI or presence in a cache. Wildcard
Bead arms and opaque `resource` arms impose no Type check; `resource` arms carry
no `types` member. The generic descriptor schema permits typed `cross`/`either`
arms, but property-shape validation alone cannot establish the required registration
and exact-state facts. The endpoint on this checked path is the registered definition
Bead itself, and its reference must explicitly pin that exact definition revision. An unpinned foreign endpoint cannot use this checked path,
even if only one revision is retained or a local Type-write default is selected.
Ordinary local floating endpoints remain supported. An opaque external reference can
still match a wildcard/opaque arm where allowed; it does not gain a checked Type claim.
Reference classification/canonicalization still needs precise Core rules.

Arity, uniqueness and acyclicity apply across the combined family, not separately
per alternative. One Link matching multiple alternatives counts once per rule.
No generic endpoint `pinned`/`floating`/`either` descriptor field is added now. Both
reference forms remain possible where permitted, subject to intrinsic domain semantics
and the explicit-pin requirement for the checked foreign-definition path above.
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
and incoming/outgoing direction explicitly. The descriptor uses a common Type selector in each participation declaration,
with explicit min/max fields; enforcement and diagnostics remain to qualify.

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

### 5.5 Validate arity and endpoint Type eligibility at transaction commit

Arity and endpoint Type eligibility are checked against the complete final staged
graph of an atomic transaction. Temporary arity or endpoint Type-pair violations
are permitted between its operations. Later operations see earlier staged changes;
other clients do not see an invalid intermediate state. Commit succeeds only if
all affected incident Links and applicable arity requirements are valid. Otherwise
the entire transaction rolls back, including owned-Link/source revision effects.
A single-operation write must also leave a valid committed graph; an invalid
incident Link causes atomic refusal rather than automatic repair.

For an AssignedIssue requiring exactly one Assignment, a batch may create the new
Assignment before deleting the old one (temporarily two), or delete the old one
first (temporarily zero). Either ordering can commit if its final state satisfies
all applicable constraints. A batch may likewise build the Beads and Links of a
required graph segment before the arity check.

For a Link permitting A→A or B→B, a batch may retype both floating endpoints
from A to B even though one staged intermediate state has B→A. Revalidate that
Link using the final endpoint affiliations. An exact endpoint pin continues to
name its original revision; retyping current state does not retarget that pin.
A remaining invalid endpoint pair refuses the entire transaction.

Syntax, authorization, ordinary revision guards, property write-policy checks
and exact-reference resolution are not generally deferred or waived. In particular,
this rule does not permit temporarily setting prohibited properties. Pair-wise
uniqueness and declared directed acyclicity also validate at commit (§§5.6 and 5.8).
The self-link identity check (§5.9), forward-reference allocation and pinned-source
revision mechanics remain separate; this decision does not select their timing.

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
owned set. A transition that remains in the final published state creates a new
source Bead revision atomically with the new Link revision, even when the Link's
properties are unchanged. The new source
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

An atomic batch stages its operations and validates the final graph before publishing
at most one new revision per affected Resource. The owner's final revision captures
the final exact Link records, with the nominal grouping and deduplication above.
Several owned-Link edits, including an interleaved explicit owner edit, do not publish
intermediate owner captures. Compare the owner's complete prior and final
revision-covered state: an unchanged owner gets no new revision even if another
Resource changes. Retyping away and back does not itself force a revision when the
complete final state is unchanged.

If the complete final revision-covered state is unchanged and there are no other
durable effects, the successful batch retains Resource revisions and emits no
lifecycle Event. Its idempotency/retry outcome is still recorded; that successful
outcome is distinct from an aborted transaction. Identity allocation and create-then-delete
are not automatically no-ops: non-reuse obligations remain. Common Write owns the
corresponding result, provenance, guard and recovery contract; this profile does not
invent intermediate published revisions to preserve an earlier result shape.

This publication model does not waive ordinary authorization, revision guards,
protected-input checks or exact-reference resolution. Only constraints already
defined on the transaction-final graph receive that treatment (§5.5). An attempted
prohibited property edit followed by an undo still refuses. Each Resource's opaque
revision token retains its Resource-qualified meaning. No transaction-wide token,
cross-Resource token equality or inequality, automatic endpoint repin or cascading
transformation is required.

Donna's [endpoint-identity ruling](https://github.com/gastownhall/bdp/issues/59#issuecomment-6457645585)
selects correction of either source or target without replacing the Link's identity.
The Link's own Resource kind and Scope remain fixed. The resulting endpoints and
affected graph must satisfy the applicable exact contracts and ordinary authorization,
Reference resolution and optional revision guards. This permits no new endpoint kind,
Scope restriction bypass or authority to mutate a foreign origin.

For a source correction from A to B, compare the initially and finally owned Link
state under the respective sources' accepted exact Type authority. If A initially
owns the Link, its final capture loses that Link; if B finally owns it, its final
capture gains the Link's complete final record. Publish the effective Link change
and every affected owner change atomically, with at most one new revision per
Resource. If the source identity stays the same, compare that owner's complete
initial and final capture once. Target correction can change a Link record captured
by its source; the incoming citation does not itself version the target. Failure
commits none of these changes. The complete common Write result must account for
all actual induced owner outcomes; this profile does not choose a new result field.

Earlier Link revisions and owner captures retain their recorded endpoints and
exact Type affiliations. A supplied endpoint pin identifies that exact Bead revision
under the common Reference contract; neither a new owner revision nor its owned
capture silently replaces that pin or makes it float. Ownership selectors use the
shared anyOf/any shape. Common CLI/Core/Write/schema/Event incorporation is required
before claiming endpoint-edit service support. Exact-definition evolution and
operation-level lifecycle details remain separate. Registering a new definition
alone does not rewrite an existing Resource revision or silently change its affiliation.

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

The Refines intrinsic DAG over exact definition revisions remains distinct from
this identity-based constraint (§2.2). No blanket acyclicity is imposed on generic
Dependency or substituted for existing scheduler/hierarchy rules.

### 5.9 Self-links and inherited prohibitions

`linkConstraints.allowSelf` is independent of pair uniqueness and acyclicity.
Apply it across all endpoint alternatives. A false value prohibits a Link whose
source and target identify the same Resource. Compare canonical endpoint identities,
ignoring endpoint revision selectors: A→A, A@1→A@2 and A→A@1 are all self-links.
Alias resolution and identity canonicalization precede this comparison; this rule
does not define new URL normalization or fetch external endpoint content. Precise
reference classification/canonicalization remains an existing Core dependency
(§5.1), shared with identity-based arity, uniqueness and acyclicity. This rule
does not select an interim admission or refusal policy.

An omitted value or true adds no local prohibition. All applicable inherited
prohibitions remain binding: a child cannot use true or omission to override an
ancestor's false. If any applicable declaration prohibits self-links, the proposed
Link must have distinct endpoint identities. Installing a newer definition alone
does not alter existing affiliations or impose its prohibition on old Links.
Activation follows the Link's exact affiliation and its effective conformance
closure. A prohibition on an unrelated sibling revision or an unused installed
revision does not activate for that Link. Creating or explicitly retyping a Link
under a prohibiting definition must satisfy
that requirement. Endpoint eligibility, ownership and other graph rules still apply.

This is a per-Link identity check. Its timing is separate from §5.5's selected
final-graph checks for arity and endpoint Type eligibility and the final aggregate
uniqueness/acyclicity checks; no new self-link-update timing is selected.
A server must not commit a Link violating an applicable self-link prohibition.

`allowSelf: false` alone permits A→B→A: it rejects self-links without prohibiting
longer cycles. Conversely `allowSelf: true` does not waive an inherited or local
acyclicity requirement, which also rejects length-one cycles. Uniqueness alone
only limits duplicate ordered pairs; it does not prohibit the first self-link.

Refines must continue permitting explicit T@2→T@1 declarations. The intrinsic
Refines definition therefore adds no identity self-link prohibition; its exact
revision cycle check still rejects T@1→T@1 and indirect exact-revision cycles.
A Refines specialization may tighten eligibility (§3.9), including a self-link
prohibition. The intrinsic relation permits T@2→T@1; a stricter specialization
need not admit every pair admitted by the intrinsic relation.
No generic endpoint pin-mode or selected-set cycle constraint is added by this rule.

## 6. Concrete acceptance cases

These are design acceptance cases, not claims of implemented or executed tests.
Product/ApprovedProduct are illustrative and do not add shipping domain Types.

| Case | Required interpretation |
| --- | --- |
| Replace ordinary writable properties while a service read-only field is required | Service supplies/recomputes that field, preserves init-only values, then validates the complete result |
| An update or replacement attempts to change an initialization-only value | Reject; initialization-only values remain unchanged while their applicable contract requires it; retyping follows §3.6 |
| Service read-only value changes as part of a new revision | Record the new value in that revision; earlier revision contents remain unchanged |
| Replacement omits mandatory caller-writable approvalCode | Reject; do not preserve omitted writable data as an implicit merge |
| A live heartbeat changes while an exact Resource revision is read | Do not alter that revision's properties; observation data belongs outside revision-covered properties |
| Two inherited ownership selectors match the same Link | Include the Link once under its actual nominal Link Type identity |
| Owned Link conforms to Refines but has its own specialized nominal Type | Group under the specialization's identity, preserving the Link's exact Type pin |
| No outgoing Links are selected as owned | Project ownedLinks as an empty object, not empty buckets per selector |
| Registered global definition is available in local Type inventory | Preserve canonical origin identity/authority; do not treat retained declarations as new local writes |
| Bead or Link changes only its Type identity; properties/metadata are equal | New Resource revision; prior exact affiliation and owned snapshot remain unchanged |
| Type identity stays constant but its pinned definition revision changes | New Resource revision; no semantic no-op based only on equal properties |
| Update omits Type; a newer definition is registered | Preserve the existing exact affiliation |
| Type identity has installed r1 and r2; Scope explicitly selects r1 as its default | An explicitly unpinned write selects and stores r1, regardless of origin current state |
| Install r3 while r1 remains the selected default | Future explicitly unpinned writes still select r1 |
| Explicitly change the local default from r1 to r2 | Future unpinned selections use r2; existing pins and omitted-Type updates remain unchanged |
| Write supplies explicit r1 while the local default is r2 | Use requested r1 if admitted and valid; do not substitute r2 |
| A retained in-Scope Bead alias is admitted as Type input and resolves to an unpinned Type identity | Write selection uses that identity's explicit local default; alias creation/repointing does not select or promote a default |
| An explicit canonical Reference names an exact Type revision | Preserve that requested pin rather than replacing it with the local default; a pinned alias is outside the initial alias contract |
| A foreign, Link or exact-revision alias is requested | Outside the initial alias contract; use the canonical Reference directly (§7.4) |
| Identity-wide query or constraint is evaluated after a write-default change | Matching is unchanged; it does not resolve through the write default |
| Unpinned Type input has no selected local default, even with one registered revision | Refuse before acquisition; caller can provide an admitted exact pin or explicitly select a default |
| Link Type change makes an unowned Link enter its source's owned set | Commit new Link and source revisions atomically; preserve earlier snapshots |
| Link Type change makes an owned Link leave its source's owned set | Commit new Link and source revisions atomically; new owned set omits the Link, earlier source snapshots retain it |
| Link Type ownership transition fails validation or a required guard | Commit neither revision; no automatic repair or partial owned-set change |
| Source Bead changes Type with a different effective ownership selection | Its new Bead revision records the recomputed set of existing outgoing Links; unchanged Links gain no new revisions |
| Source-Bead retyping also explicitly edits an outgoing Link | Apply the explicit Link change atomically and validate the complete resulting graph; ownership recomputation alone does not mint Link revisions |
| One batch changes two owned Links or edits the same owned Link repeatedly | Publish at most one revision per affected Resource; a changed owner records one final capture with final exact Link records and nominal grouping |
| A Link's source is corrected from owning Bead A to owning Bead B | Keep the Link identity; atomically publish its final record, A's capture without it and B's capture with it; retain all earlier editions |
| A Link's source correction leaves or enters ownership at only one boundary | Revise only sources whose final recorded state changes; do not invent another owner effect |
| An owned Link's target is corrected to another admitted Reference | Keep Link identity; publish its effective change and changed source capture atomically; the citation does not itself version either target |
| Endpoint correction makes the final graph invalid or fails ordinary authorization/guards | Refuse the complete atomic decision; leave Link and all affected owner revisions/captures unchanged |
| Explicit owner edits are interleaved with owned-Link edits | Publish one complete final owner state, not intermediate definition revisions or captures |
| Staged Link/retyping changes restore the complete prior state and cause no other durable effects | Keep original Resource and owner revisions; emit no lifecycle Event; retain the successful retry outcome |
| A batch attempts a protected property edit, then restores the old value | Refuse; final-state publication does not make prohibited authored input legal |
| A Scope has older covered records with URI-only affiliations or missing required retained definitions | Refuse the Types activation claim; do not guess old pins, rewrite history or grandfather those records |
| Unaccepted S@1 uses a declaration typed S@1 to establish its own Refines membership | Reject the circular justification; the declaration's exact Link Type must already be accepted before use |
| Two unaccepted Refines specializations justify each other through their own Link Types | Reject that justification even if declared target edges form no cycle |
| S@1 establishes conformance through accepted built-in Refines, then is used for a later declaration | Admission dependency is grounded; all remaining validation and ownership requirements still apply |
| Trusted metatype reference loop or recursive JSON Schema | Not rejected merely by the grounded-declaration rule; respective bootstrap/schema rules remain applicable |
| Properties schema omits its root dialect declaration | Evaluate under the 2020-12 baseline |
| Properties schema explicitly selects a conflicting dialect | Reject; do not silently evaluate under a different dialect |
| A string constrained by standard date-time, URI or email format is syntactically invalid | Reject the instance; format is enforced, not merely recorded as an annotation |
| Type relies on an unknown or unsupported format that a validator silently ignores | Refuse the Type rather than claim successful validation |
| Syntactically valid URI names a nonexistent external resource | Format checking alone does not reject on existence or fetch the resource |
| A schema resource in the retained closure declares a different dialect | Refuse, including an embedded resource with its own `$id`; do not treat `$schema` in literal/example data as a dialect declaration |
| A Type names a custom derived meta-schema URI | Refuse under the initial standard-dialect-only contract; general executable extensions are deferred |
| Required property is constrained to number by one contract and integer by another | Do not report an empty Type intersection; integer values satisfy both |
| Optional property has disjoint string/number requirements and omission is allowed | Do not reject the Type as uninhabitable merely because the property cannot be supplied |
| Required p permits string or object; its schema requires x and has maxProperties zero | Do not reject merely because the object alternative is impossible: p="ok" remains valid |
| Contradiction lies outside the mandatory finite floor and is not otherwise proved | Report static result unknown; enforce full validation on every concrete instance |
| Standard meta-schema requires an unsupported baseline vocabulary | Refuse the definition; ignoring its asserted requirements is not validation |
| Ordinary schema contains an unknown annotation | Do not invent assertion semantics; adding `$vocabulary` to an ordinary schema is not a required-extension negotiation mechanism |
| Publisher changes bytes at a referenced schema URL after Type revision acceptance | Continue using that revision's retained exact closure and bindings; no newer remote substitution |
| A retained schema is retrieved under one URI and declares a different canonical `$id` | The difference alone is valid; preserve standard retrieval/base/identity semantics, not a blanket key-equals-id rule |
| Two retained resources establish conflicting contents for the same canonical schema identity in one definition environment | Refuse the conflicting binding; a map key cannot override the conflict |
| D is affiliated with BeadType and declares conformance to the LinkType metatype | Do not classify D as ambiguous merely from that outgoing declaration; category follows D's own affiliation's effective Type set |
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
| Any Link uses a cross/either arm whose endpoint is itself a registered global Type-definition Bead, explicitly pinned and satisfying the required Type | Permit that endpoint match from retained accepted facts; apply all remaining Link constraints and authorization |
| Same arm names an ordinary foreign Bead whose claimed Type definition is registered | Do not accept the Bead's Type claim or fetch remote content to make the check pass |
| Typed foreign endpoint names a registered Type-definition Bead without an explicit revision pin; that definition identity has a local write default | Refuse the checked endpoint match; do not infer a pin from the write default |
| Exact foreign definition endpoint satisfies its Type requirement but its arm requires same-Scope | Refuse; exact registration does not bypass Scope restriction |
| Instance use/import names an unregistered exact Type | Refuse; neither stored definition bytes nor a caller request implicitly registers it |
| One requested dependency fails graph registration | Register none of the newly requested graph; preserve pre-existing registrations; cached bytes remain unregistered |
| A referenced schema is changed in a later Type revision | Old instance pins continue using their old root and schemaResources map |
| Arbitrary external Bead or web resource shares a registry's host or URI pattern | No trusted-definition inference or general endpoint-Type validation |
| Core Scope uses a Type reference whose target is not a Bead | Not invalid merely for that reason; the applicable typing profile defines its interpretation |
| Instance is stored under this Types profile | Its Type reference pins an exact revision of a Type-definition Bead |
| Author a Type's JSON Schema and graph constraints | Store them as descriptor properties; separate Schema/Constraint Beads are not required |
| Change a descriptor constraint field | Create a new definition revision; older revisions retain their field values and recorded owned conformance state |
| A Bead represents a Link-Type definition | The definition is a Bead; its described instances are Links; no cross-kind conformance follows |
| Traverse an instance's ordinary incident Links | Its distinguished type field creates no implicit Link into the Type graph |
| T@3 owns a Refines declaration targeting A@2; A@2 owns one targeting B@1 | T@3's closure includes those exact revisions even after A changes |
| Delete or edit a conformance declaration | Apply source ownership revision effects; preserve the declaration in historical owner revisions |
| Someone publishes an assertion outside T's authoritative owned set | It does not change T's conformance contract |
| Record a later review as an Activity whose subject is the declaration Link revision | Preserve the declaration and owner revision; the Activity is independent |
| Specialized Refines Link has valid tightening-only semantics | Include it in conformance and ownership through transitive Link-Type conformance |
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
| `allowSelf: false` with A→A, A@1→A@2 or A→A@1 | Reject: revisions do not distinguish endpoint identity |
| `allowSelf: false` with A→B and B→A, without acyclicity | Allow if other constraints hold; a longer cycle is not a self-link |
| Parent forbids self-links; child says true or omits allowSelf | Reject a self-link; the inherited prohibition still applies |
| allowSelf omitted or true, with no inherited prohibition or acyclicity | No self-link prohibition from this field; other admission rules still apply |
| allowSelf true with inherited acyclic true | Reject self-links and other forbidden cycles; true does not override acyclicity |
| A Refines specialization declares allowSelf false | Tightening-only rules apply: that specialization rejects same-identity endpoints; intrinsic Refines still permits T@2→T@1 |
| Refines T@2→T@1 versus T@1→T@1 | No identity-based self prohibition; accept the former if otherwise valid, reject the latter as an exact-revision cycle |
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
| Create a valid definition Bead in a repository of definitions | Store the definition without implicitly registering the Type it describes for instantiation |
| Explicitly register an exact definition with its complete admitted closure | Make that exact revision eligible, subject to abstractness, retirement and ordinary authorization; existing instances and defaults do not move |
| Import instances while a required exact Type is not registered | Refuse atomically; import does not fetch-and-register missing Types |
| Atomic A→A to B→B endpoint retyping passes through B→A | Accept only if all affected incident Links satisfy final endpoint Type eligibility; exact pins remain unchanged |
| Exact definition read after its owned Refines Links change | Return its complete recorded owned state and schema bytes, never current adjacency |
| New operational size limits would strand an accepted exact definition | Preserve its promised complete reads or reject the configuration change; never truncate the record |
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
| Retyping, endpoint correction and affected graph | Explicit whole-reference replacement under applicable Write preconditions; complete-result validation; published Type-only changes version; endpoint correction preserves Link identity; changed initial/final ownership captures commit atomically; batch publishes at most one final revision per affected Resource, with net-zero rules in §5.7; history stays immutable | Coordinated Core/Write/schema, complete owner results, provenance and Event propagation and qualification; no extra mandatory guard. Literal pins gain no owner-membership or automatic-repin meaning |
| Schema admission | JSON Schema 2020-12 validation and syntactic format enforcement; unknown/unsupported formats and required vocabularies refuse; immutable descriptor-contained schema map; inherited schemas all apply; bounded contradiction floor (§§3.12–3.13) | Implementation-supplied baseline, explicit application bases and retained map selected; general executable extensions deferred; no complete satisfiability proof |
| Exact conformance closure | Exact target pins, no exact-revision cycles; ancestor requirements deduplicated by originating exact definition/location; distinct declaration restrictions retained | Concrete location/qualifier representation and diagnostics; distinct from once-per-instance-Link counting |
| Constraint evolution | §§5.4, 5.6, 5.8 and 5.9 select local activation with cross-revision family populations, per-Link acyclicity and exact-affiliation self-link activation | Precise inherited-declaration activation and selector/diagnostic syntax; no Scope-wide minimum over installed definitions |
| Definition resolution | Registered exact global definitions satisfy endpoint Type checks for any Link, with explicit endpoint pins and Scope restrictions intact; arbitrary external resources remain opaque | Installation operation mechanics, Scope classification and inventory/read projection; locally retained available inventory does not rewrite origin identity/authority |
| Complete exact definition reads | Full records within operational admission bounds; exact retained closure; narrow definition access without mandatory full application History; no legacy view obligation (§3.14) | Staged common read/admission/discovery/error binding exists; exact-candidate correspondence, operational budgets and runtime qualification remain |
| Bootstrap and declaration admission | Shared published exact intrinsic graph loaded by trusted initialization; prior versions retained on upgrade; no client mutation; declaration Link Type accepted before use | Production namespace/publication artifact, upgrade activation and operation/batch/import admission ordering |
| Availability and lifecycle | Truthful Scope-wide activation covers live/retained records without grandfathering (§1); explicit atomic exact-graph registration distinct from definition presence; initial use/import requires existing registration; explicit local default; retirement preserves existing use/history | Activation enforcement and exact source correspondence; concrete registration/retirement verbs, permissions, broader acquisition and physical-removal retention deferred |
| Revision compatibility | Conformance only initially, including explicit same-identity revision conformance; none inferred from age/SemVer; no migration guarantee | Reusable informational labels selected; no version-range resolution |
| Property write/read boundary | Replacement covers ordinary writable fields, preserves init-only values, rejects changes to them, and completes service read-only fields before validation; live observations are separate | PropertyAccess and init-only retyping selected; nested-policy enforcement qualification, observation representation and shared signing/provenance contracts remain |
| Definition representation | [Descriptor specification][descriptor-spec] plus owned Refines Links; candidate schemas and final-state seed | Concrete abstract/propertyAccess fields and common selector shapes selected; installable graph creation/preservation format remains §7.1 work |
| Descriptor/profile correspondence | Accepted ownership division (§1.1); disagreement is a specification defect | Deliberate BDP relocation and immutable origin recorded; exact-candidate descriptor/schema/fixture correspondence and source qualification; no silent precedence |
| Endpoint identity dependency | Self-link comparison shares canonical endpoint identity with arity, uniqueness and acyclicity (§5.9) | Existing Core reference classification/canonicalization work (§5.1); no new interim policy selected |

Issue/Dependency exercises workflow-sensitive properties, classification-to-Type
translation, computed/live observations, ownership and optional graph constraints.
Replacement of ordinary writable properties, preservation of initialization-only
values and service completion before validation are selected (§3.6); propertyAccess and initialization-only retyping are selected above. Enforcement
and complete domain correspondence remain to qualify. Live observations remain outside revision-covered properties. Memory exercises reusable
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

### 7.0 Local authoring and explicit registration

Creating or storing a valid Type-definition Bead does **not** register the Type it
describes for instantiation. A Scope may be a repository of definitions without
supporting instances of every represented Type. It needs support for the metatypes
used to represent those definitions, independently of registering the Types they
describe. Definition presence, an alias, a cache entry or a sealed authoring
candidate supplies no implicit registration authority.

Registration is an explicit acceptance action for an exact definition revision and
its complete required dependency closure. Concrete verbs, request shapes,
permissions and broader acquisition/lifecycle mechanics remain separate work.
Registration does not waive abstractness, retirement or ordinary creation checks.
A new or edited definition does not upgrade existing affiliations, select a local
default or activate graph constraints on old instances. Unpinned use additionally
requires an explicitly selected eligible local default (§7.2). Ordinary Bead
operations and specialized CLI commands must preserve these distinctions.

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
Registration means explicit acceptance for use in this Scope, not mere definition
presence or an opportunistic cache entry. Local creation, copying, retrieval and
publication do not supply that status implicitly. Acquisition and registration are
distinct boundaries even if a future authorized operation combines them.

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

Initial instance use and data import require already-registered exact definitions
and complete required closure. A missing required registration causes atomic refusal
with an authorized diagnostic. Import does not automatically acquire, install or
register definitions, and cache population alone does not authorize use. Accepting
one exact revision does not admit future revisions of that identity.

Broader entry/exit lifecycle and any optional acquisition-and-registration operation
remain deferred. Earlier automatic-installation proposals are not selected initial
behavior. Registry discovery, aliases and absolute-ID routing do not imply automatic
installation. Unvalidated use is not supported initially; no bypass or persisted
unvalidated representation is selected.

For each Type identity, the Scope explicitly chooses an installed exact revision
as the default for future explicitly unpinned Type writes. Resolving such input
selects that local default, not the origin's current revision or whichever revision
was most recently installed. The resulting stored affiliation is an exact pin.
Installing another revision alone leaves the selected default unchanged. An explicit
change of default affects future unpinned selections; it does not move existing
Resource affiliations, change their historical meaning, or alter an update that
omits Type. Explicitly pinned input names its requested revision independently of
the default and remains subject to normal availability and validation rules.

Under the initial alias contract (§7.4), a retained alias resolves to an unpinned
canonical in-Scope Bead identity. When admitted as Type input, that identity uses
its explicit local exact default. An explicit canonical pinned Reference instead
retains the requested pin independently of the default. Foreign, Link and
exact-revision alias targets remain deferred. Creating or changing an alias does
not select a default or change stored affiliations. Identity-wide constraints and
queries still match as specified in §4.2; they do not resolve through this write default.

Without a selected local exact default, explicitly unpinned Type input cannot
resolve and the write is refused before acquisition. Definition acquisition or
registration never implicitly selects or promotes a default. This remains true when only
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

Retirement initially targets an exact definition revision. It stops new affiliations
with that retired revision; it does not destroy
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
history. Retirement is not erasure. The operation/permission model and physical removal/retention policy remain
to specify. An identity-wide convenience operation is separate future work. This rule does not choose
recovery semantics for a deleted identity, rewrite previous revisions, or restore
retired definitions automatically.

### 7.4 Local aliases for canonical references

The initial cut retains aliases to unpinned in-Scope Bead identities. The broader
direction of aliases to foreign Resources, Links or exact revisions is deferred in
[issue299](https://github.com/gastownhall/bdp/issues/299), not rejected permanently.
It is not required to finish the current profile. Use canonical References directly
for those targets, including exact Type References where required.

Alias presence or resolution supplies no registration, publication authority or
permission to use a Type. At use, resolve the retained alias and apply the normal
availability, authorization and validation rules. Stored instance Type affiliation
remains an exact canonical pin, never a mutable alias. Repointing an alias cannot
change stored affiliations, select a local default or rewrite other canonical
references. The initial target cutline does not add acquisition or installation.

The earlier CLI's `beads/PATH` and `links/PATH` shorthand is historical context,
not a protocol-required namespace. The accepted direction lets each Scope define
its sub-Scope namespace without mandatory Resource-kind URL prefixes; a path alone
does not establish Resource kind. Alias placement, collision handling, revision
overrides and lookup precedence remain coordinated Core/Write/CLI work. No new
`types/` prefix, relocation rule or alias wire shape is selected here.

The current canonical BDP alias contract's in-Scope Bead target restriction supplies
the starting point. Its historical `alias/` placement is not a new mandatory URL
prefix. Common namespace and alias operation details stay with coordinated
Core/Write/CLI source; the deferred expansion does not silently amend
[Core](../core/core.md), [Write](../write/write.md), or active Write work.

## 8. Readiness and landing

Design selection, adopted protocol, and runtime qualification are separate states.
The following table describes this draft; it does not mark current Core/Write or
Beads behavior as implementing its proposed semantics.

| Item | Design state | Remaining adoption or evidence |
| --- | --- | --- |
| Optional Scope-wide Types boundary | Selected direction with truthful live/retained activation and no grandfather boundary (§1) | Coordinated canonical Core/Write, discovery and activation-enforcement amendment |
| Exact affiliations, explicit retyping and endpoint correction | Selected for Beads and Links; whole-reference replacement, published Type-only revisions, identity-preserving Link endpoint correction, atomic final ownership changes and at most one final revision per affected Resource per batch, including net-zero rules (§§2, 5.7) | Common CLI/Core/Write/schema/complete-owner-results/provenance/Event propagation and runtime qualification |
| Conformance, structural and semantic | Selected foundation (§3), 2020-12 validation and format enforcement, refusal of unsupported required extensions and immutable schema closure; read/write responsibilities distinguished | Implementation-supplied baseline and explicit schema bases selected; bounded floor/warning and exact format-support qualification remain; executable extensions deferred |
| Constraint matching and populations | Pair unions, inherited conjunction, exact/identity-wide selectors and identity-based populations selected (§§4.2, 5) | Common selector shape selected; inherited activation and local transition/availability checks; arbitrary external-resource validation excluded |
| Arity, endpoint Type eligibility, uniqueness, acyclicity and self-links | Transaction-final arity/eligibility and aggregate checks with mixed-revision cases selected; self-link prohibition is an independent per-Link endpoint check (§§5.5–5.9) | General graph validator, atomic mutation and exact-source qualification NYI; self-link cases are written requirements, not runtime evidence |
| Definition representation and descriptor split | Descriptor owns abstract fields/local meanings; profile owns detailed enforcement (§1.1); shared exact bootstrap selected; candidate schemas/seed present (§2) | Working descriptor deliberately relocated into BDP from exact `01beba80`; original source PR3/bytes/digest recorded in the artifact README. Exact-candidate correspondence and focused artifact qualification remain required; prior evidence retains its historical scope. Production bootstrap publication, lifecycle operations and resolution qualification remain open |
| Property write/read boundary | Writable replacement, init-only preservation/change refusal, service read-only completion and separate live observations selected (§3.6) | PropertyAccess and init-only retyping selected; enforcement, observation representation, shared Write adoption and provenance-owned signing mechanisms remain |
| Conformance graph operations | Owned historical declaration authority, tightening-only specialization and already-accepted declaration Link Types selected | Core amendment for nominal-identity grouping/empty-set projection, source-pin/traversal/admission-ordering operation contract, performance and historical-query qualification |
| Acceptance cases (§6) | Written review cases | Property/example checks cover only their documented shape/finite-graph subset; runtime cases remain unqualified |
| Exact definition read boundary | Complete records, retained exact closure and operational admission bounds selected; narrow definition access independent of full application History (§3.14) | Common binding and intrinsic read examples are authored; actual retained-read, authorization and bound qualification remain; no new pagination or legacy compatibility obligation |
| Shared provenance and recovery | Shared owners and accepted product direction identified (§7) | Shared schema/operation adoption; no parallel Types implementation |
| Fixed Memory product | Separate product proposal; fixed catalog/compiled validation need not expose Type definitions | Native catalog, properties/history, pins, mutation and release evidence tracked in Beads #7656 |
| General Type lifecycle and packaging | Authority, retained meaning, explicit atomic registration separate from definition presence, already-registered initial use/import, explicit local defaults and retirement with preserved use selected (§7) | Operation syntax/permissions, exact registration/retirement enforcement, physical retention/removal, bootstrap publication and portable format |

Continue through focused branches and coordinated, bounded amendments against current
BDP and Beads sources, with acceptance cases and explicit implementation status. Do
not merge accumulated design work as an implicit runtime migration. The structural
Core/Write split is complete; their semantic propagation is separate from finishing
this draft. Pending batch, lifecycle Event and interchange proposals do not become
adopted wire contracts through references in this document.
