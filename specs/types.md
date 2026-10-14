# BDP Types

Design draft, October 14, 2026. This document records agreed design rules and
explicit open decisions for an optional, Scope-wide Types profile. It is not yet
an adopted protocol specification, an installable definition format, or a claim
that Beads implements these rules. The [current BDP specification](../docs/specs/bdp.md)
remains the protocol authority until coordinated amendments land.

The [Issue and Dependency draft](types/issue.md) and [Memory draft](types/memory.md)
provide requirements and acceptance scenarios. Their existing flat-Type assumptions
must be reconciled with the conformance model here; this document does not silently
reinterpret their endpoint lists. The earlier [Type lifecycle exploration](../docs/design/type-lifecycle-preview2.md)
is background. Where it conflicts, this document records the current design
position, including that representing definitions as Beads remains undecided.

## 1. Scope and responsibilities

Core defines the common Resource envelope, references, revisions, ownership
behavior and recognizable constraint errors. A Type reference is required even
when a Scope does not implement the Types profile. Core may enforce native
constraints without resolving a Type definition.

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
Exact definition syntax and the rules relating Bead and Link Types remain open.

An instance saved under the Types profile pins its exact Type definition revision.
Explicit floating Type input resolves before commit; an omitted Type on update
preserves the existing exact affiliation. Supplying a Type reference replaces
that reference as a whole, rather than merging its identity and revision members.
An explicit change of Type or Type revision must validate with the resulting
properties and other applicable constraints, or the change fails atomically.

Definitions are designed abstractly here. Whether Types or other reusable
contracts are represented as Beads, and how their bootstrap works, is undecided.
Earlier assumptions that Type identity/revision necessarily comes from a Bead
wrapper are not requirements of this draft.

The current direction uses Type-to-Type conformance for reusable structural and
semantic promises. A separate Capability entity is not required by the rules
below; it should be introduced only if a distinct requirement warrants it.
"Capability" in Scope feature discovery is not this Type conformance relation.

## 3. Conformance in plain language

If **ApprovedProduct conforms to Product**, every valid ApprovedProduct must also
be a valid Product, with the same meanings for shared fields. The reverse need
not hold. Conformance is directional. It describes the effective definition,
including all inherited requirements, not the author's local schema in isolation.

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

Full properties replacement, such as Beads `--replace-properties`, supplies the
whole new properties object. If `approvalCode` is mandatory, omitting it fails.
The server must not silently retain it and turn replacement into a merge.
A client knowing only Product cannot assume it can create or replace an
ApprovedProduct. Reading and preserving unfamiliar fields can help, but does not
establish that an arbitrary change will be valid.

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

## 5. Concrete acceptance cases

These are design acceptance cases, not claims of implemented or executed tests.
Product/ApprovedProduct are illustrative and do not add shipping domain Types.

| Case | Required interpretation |
| --- | --- |
| T conforms to C | Every valid T record satisfies C's structure and semantics |
| C requires title; T omits title from its local schema | Effective T still requires title |
| C permits optional note; T requires note | Valid narrowing, subject to inherited behavioral promises |
| C requires note; T's local schema makes it optional | Effective T still requires note |
| C is open; T adds mandatory approvalCode | Permitted if all inherited constraints are satisfied |
| C forbids approvalCode; T requires it | Impossible effective definition; invalid |
| C permits extra string values; T adds string approvalCode | Allowed by that extra-property restriction |
| C accepts price as number; T requires integer | Structural narrowing, not a string/number-style contradiction |
| C requires string price; T requires numeric price | Impossible effective definition; invalid |
| C means dollars; T reinterprets the same price as cents | Invalid semantic conformance, even with identical schemas |
| C permits numeric price; T requires nonnegative price | Read conformance can hold; a negative write to T fails |
| C explicitly promises an operation that T refuses under the same conditions | Invalid behavioral conformance |
| Update only ApprovedProduct.title | Preserve approvalCode; validate complete resulting state |
| Replace ApprovedProduct properties with a Product-only object lacking mandatory approvalCode | Reject atomically; do not merge missing properties back in |
| T@1 reaches C@1 and C@2 | Both exact definitions apply; neither supersedes the other |
| A@1 directly conforms to A@1 | Reject the direct conformance cycle |
| A@1 conforms to B@2, which conforms to A@1 | Reject the indirect conformance cycle |
| A@1 and B@1 both reach C@1 without a path back | Shared ancestry is not a cycle; diamond conformance is permitted |
| A newer revision of an inherited definition appears | Existing T revision retains its original exact promises |
| A required transitive definition is unavailable | Do not accept the Type for use with incomplete conformance knowledge |
| New Type revision adds a mandatory field | May break old-data acceptance even if conformance to a parent remains valid |

## 6. Decisions still needed

Conformance questions to work through next:

- Repeated paths and deterministic closure identity; conformance cycles are forbidden.
- Same-name optional fields with disjoint permitted values: omission can satisfy
  both schemas. Decide whether to allow this with a diagnostic or reject the
  conflicting declarations. The earlier recommendation was not an operator ruling.
- Cross-kind conformance: which declarations are allowed between definitions for
  Bead and Link instances? No automatic cross-kind membership is selected.
- Exact pinned versus floating conformance queries and constraint matching.
  Keep nominal affiliation matching distinct from inherited conformance matching.
- Schema dialect/composition details and semantic annotations; minimum mandatory
  checks versus author responsibility, without claiming complete satisfiability
  or semantic proofs.

Other Type-system work:

- Definition representation, bootstrap, IDs and revision availability; whether
  definitions are Beads; installation, removal, packaging and retention.
- Endpoint AND/OR expressions and their wire representation. An endpoint accepting
  Issue OR Memory differs from a Type promising both contracts. NOT remains
  unselected; an unresolved definition must not be treated as proven nonmembership.
- Ownership, maximum counts, ordered-pair uniqueness and other graph constraints.
- Explicit affiliation changes, migrations, floating endpoint revalidation and
  operation behavior during transitions.
- Compatibility families and publication claims, including semantic changes.

Issue/Dependency exercises pair uniqueness, workflow-sensitive metadata and
ownership. Memory exercises reusable content, heterogeneous endpoints, pinned
citations and reference availability. Use these as requirements, not automatic
precedent. Keep their domain semantics and the Provenance V2 proposal intact while
reviewing shared Type mechanisms.

## 7. Readiness and landing

| Item | Status |
| --- | --- |
| Optional Scope-wide Types boundary | Agreed design; canonical integration pending |
| Conformance rules in §3 and distinctions in §4 | Agreed design foundation; detailed syntax/checks open |
| Acceptance cases in §5 | Written for review; implementation qualification NYI |
| Definition wire schema, bootstrap and lifecycle | Not yet specified |
| Constraint expression syntax and matching | Not yet specified |
| Beads CLI/storage implementation of this draft | Not established by this document |

Develop here on the isolated design branch. Land coordinated, bounded amendments
against current BDP and Beads sources, with acceptance cases and explicit
implementation status. Do not merge the accumulated design branch as an implicit
runtime migration. Core/Write document extraction and changes to active Write work
are not prerequisites for finishing the Types and Memory designs.
