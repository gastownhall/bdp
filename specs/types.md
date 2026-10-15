# BDP Types

Design draft, October 14, 2026. This document records agreed design rules and
explicit open decisions for an optional, Scope-wide Types profile. It is not yet
an adopted protocol specification, an installable definition format, or a claim
that Beads implements these rules. The [current BDP specification](../docs/specs/bdp.md)
remains the protocol authority until coordinated amendments land.

The [Issue and Dependency draft](types/issue.md) and [Memory draft](types/memory.md)
provide requirements and acceptance scenarios. Issue/Dependency now proposes
classification Types conforming to issue/dependency. Memory still contains older
flat-Type assumptions and needs explicit reconciliation; this document does not
silently reinterpret its endpoint lists. The earlier [Type lifecycle exploration](../docs/design/type-lifecycle-preview2.md)
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

## 5. Endpoint constraints and arity

These rules apply within the separate Bead-Type and Link-Type worlds under the
same structural and semantic conformance principles. Cross-kind conformance is
forbidden. Examples below are conceptual, not selected wire syntax.

### 5.1 Endpoint eligibility starts with OR

A Link Type may constrain its source and target independently. The baseline is an
explicit OR-list: an endpoint qualifies by having, or transitively conforming to,
one of the specified definitions. Explicit AND, NOT and exact-only matching are
deferred. Pinned versus floating definition selectors still need precise syntax
and matching rules.

For example:

```text
AnnotationLink source: Issue | Memory
ReviewLink conforms to AnnotationLink
ReviewLink source: Memory | Activity

Effective ReviewLink source:
    (Issue | Memory) & (Memory | Activity)
```

Every inherited constraint applies. A local declaration cannot widen or override
one. Omitting a local constraint retains the inherited requirement. A broader
local declaration is accepted with a warning explaining that the inherited
restriction still applies; it is not rejected merely for being broader. The
warning is diagnostic, not permission to accept an invalid endpoint.

If Issue, Memory and Activity have no conformance relationships, Memory qualifies,
but Activity alone does not. A Type conforming to both Issue and Activity also
qualifies. Do not simplify this expression to a nominal list containing only
Memory. Provably impossible effective requirements are distinct from harmless
local underspecification and follow the invalid-definition rule in §3.2.

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
Availability, remote validation and floating-endpoint revalidation still require
explicit rules, rather than guessing conformance from an unresolved reference.

The agreed direction is also to share the arity allowance across revisions of
the declaring Link-Type identity, rather than letting a new definition pin create
another allowance. Evolution when those exact revisions specify different limits
remains OPEN: Assignment@1 maximum one and Assignment@2 maximum two cannot be
resolved by silently choosing latest. This draft does not yet select activation,
coexistence or migration rules for that case.

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
endpoint or reference check. Pair-wise uniqueness is separately selected for
commit-time validation in §5.6. Other graph checks remain separate design work.

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
cycle, hierarchy, endpoint, properties or authorization checks.

This is an optional declared constraint, not a universal prohibition of parallel
Links. Wire syntax and constraint evolution across definition revisions still
need the shared decisions already identified for graph constraints. No new
allowance follows merely from a different child Type or endpoint revision pin.

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

## 6. Concrete acceptance cases

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
| Definition revisions declare different limits for the same nominal Link Type | Evolution policy remains unresolved; do not invent separate allowances or latest-wins behavior |
| Distinct blocks and parent-child Links have the same ordered pair under dependency uniqueness | They share the constraint population; cannot both remain at commit |
| Endpoint pins differ for the same source/target identities | Same uniqueness pair; no extra slot |
| Reverse the source/target pair | Different uniqueness key; independent workflow constraints still apply |
| A Link outside the dependency family uses the occupied pair | This dependency uniqueness declaration does not prohibit it |
| Batch creates a replacement pair Link before deleting the old Link | Temporary duplicate allowed; final duplicate rolls back the complete transaction |
| issue owns dependency; custom-blocker transitively conforms to dependency | Matching outgoing custom-blocker Links are owned without individual registration in the ownership list |
| Create, modify or delete such an owned Link | Apply Core source-revision effects atomically; no subtype opt-out |
| Read a historical Issue revision after new definitions are registered | Preserve its recorded owned set; do not recompute history using current rules |

## 7. Decisions still needed

Conformance questions to work through next:

- Repeated paths and deterministic closure identity; conformance cycles are forbidden.
- Exact pinned versus floating conformance queries and constraint matching.
  Keep nominal affiliation matching distinct from inherited conformance matching.
- Schema dialect/composition details and semantic annotations; minimum mandatory
  checks versus author responsibility, without claiming complete satisfiability
  or semantic proofs.

Other Type-system work:

- Definition representation, bootstrap, IDs and revision availability; whether
  definitions are Beads; installation, removal, packaging and retention.
- Endpoint OR-list wire syntax, inherited conjunction and warning details. Explicit
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

The [completion decision list](../docs/design/types-completion-decisions-20261014.md)
collects unresolved questions and consistency work, including Memory updates held
for user review. It supplies no additional normative rules.

## 8. Readiness and landing

| Item | Status |
| --- | --- |
| Optional Scope-wide Types boundary | Agreed design; canonical integration pending |
| Conformance rules in §3 and distinctions in §4 | Agreed design foundation; detailed syntax/checks open |
| Endpoint composition and arity in §5 | Agreed design direction; cross-revision evolution and detailed syntax open |
| Acceptance cases in §6 | Written for review; implementation qualification NYI |
| Definition wire schema, bootstrap and lifecycle | Not yet specified |
| Constraint expression syntax and matching | Not yet specified |
| Beads CLI/storage implementation of this draft | Not established by this document |

Develop here on the isolated design branch. Land coordinated, bounded amendments
against current BDP and Beads sources, with acceptance cases and explicit
implementation status. Do not merge the accumulated design branch as an implicit
runtime migration. Core/Write document extraction and changes to active Write work
are not prerequisites for finishing the Types and Memory designs.
