# Versioned Types as Beads — Preview 2 design

Updated October 8, 2026. Owner: Trish. Product decisions: Donna.
Plan of record: [BDP #59](https://github.com/gastownhall/bdp/issues/59).
Delivery: [PR60](https://github.com/gastownhall/bdp/pull/60).
[Decision packet](type-preview2-decision-packet.md).

**Status:** consolidated design proposal incorporating the operator's positions;
not an adopted BDP amendment or an implemented feature. Types-as-Beads is the
model developed by this document. Its exact bootstrap, wire representation,
administrative policy and remaining decisions are explicitly open below.
The Type document is mandatory for Monday October 12 EOD Pacific; implementation
is optional and awaits separate product decisions. Canonical BDP v0 remains
`docs/specs/bdp.md` until an approved amendment or follow-on specification defines the new contract
and its conformance boundary.

## 1. Purpose, authority and decisions

Users need to add Bead and Link Types, evolve their definitions, and remove them
from use. Existing instances and relationships must remain intelligible while
that happens. Requiring a completely new nominal Type for every contract change
makes ordinary evolution difficult; silently changing an existing contract makes
stored data ambiguous. The design separates stable identity, immutable exact
versions and compatible evolution within a major-version family.

BDP owns the shared abstract model, meaning, protocol and observable validation
outcomes. Beads owns CLI spellings, storage, acquisition and operator workflows.
The [README authority boundary](../../README.md#architecture-and-design-authority)
applies. Implementation behavior does not silently become BDP semantics.

| Position | Status in this design |
| --- | --- |
| Types are represented by versioned Beads, including Types describing Links | Model requested for this complete write-up; exact bootstrap/placement/publication design open |
| Beads and Links retain a distinguished intrinsic Type field | Agreed direction; it is not replaced by an ordinary Link |
| Nominal Type affiliation stays stable while its exact definition pin can evolve | Working model; cross-identity reclassification remains outside this proposal |
| Each new-model resource version stores an exact Type definition pin | Agreed; legacy absent-pin interpretation and exact wire/address form open |
| Writes may explicitly select pinned or floating Types; omission on update preserves the existing exact pin | Agreed; resolution authority/timing and retry details open |
| Properties and explicit Type selection can change atomically | Agreed per-resource resulting-state validation; no arbitrary graph-repair guarantee inferred |
| Floating nominal filters match identity; pinned filters match identity plus exact version | Agreed; neither filter means conformance or a major-version range |
| Exact Type versions freeze structure and semantics | Agreed; all contract-bearing dependencies must have fixed meaning |
| Within a major family, preserve both old data and old consumers' structural and semantic guarantees | Agreed; SemVer is the candidate designation, not yet an approved encoding or enforcement mechanism |
| Authors can design extensibility using open records, optional fields and explicit tolerance rules | Agreed approach; additions still must satisfy both compatibility guarantees |
| Installation, removal, graph integrity, migration and packaging details | Decision ledger below; recommendations are not additional rulings |

## 2. Identity, versions and Type affiliation

Four things must remain distinct: a resource's identity, its resource version,
its nominal Type identity, and the exact Type definition governing that version.
A fifth concept, the compatibility family, groups definition versions that honor
the guarantees in section 4. It is not an exact definition address.

The following notation is explanatory, not a proposed wire format:

```text
Invoice                         stable Type identity; represented by a Type Bead
  definition a [family 1]       immutable structure and meaning
  definition b [family 1]       compatible successor to a
  definition c [family 2]       potentially breaking successor

invoice-123 / state x  -> Invoice / definition a
invoice-123 / state y  -> Invoice / definition b   (explicit adoption)
```

Publishing b changes neither state x nor any instance still using a. Producing
state y changes the stored affiliation explicitly. Publishing c does not grant
permission to cross the major boundary; that migration policy remains open.

An exact definition version freezes its complete structure and semantics. A
compatibility family preserves prior guarantees while allowing compatible
recognition or use of extension points. Different exact versions may have
identical contracts; a documentation edit does not force instance adoption.
Human SemVer labels, opaque resource revisions, concurrency guards and exact
historical addresses must not be conflated. D03/D05 must bind any label to an
immutable definition and specify who may mint it and how conflicts are detected.

A generic reader consuming complete resource records can traverse Beads and Links
and compare nominal Type identity without interpreting Type definitions. Validation or domain interpretation needs
the appropriate definition and supported semantics. Returning an unfamiliar Type
Bead as data does not imply the reader can execute its validation rules.
Constructing those records is a separate obligation: deriving ownedLinks entries
or reconstructing records from events may require the exact pinned definition or
sufficient retained projection evidence. A materialized complete record need not
force its recipient to perform that lookup. D09/D12 must define read/reconstruction
outcomes when required evidence is unavailable, including the Read-profile errors.

Legacy records without definition pins remain a separate, named transition
problem. No retained record is rewritten, no old pin is guessed, and absence is
not declared corruption merely because the new model uses exact pins. D02/D03/D12
must define legacy matching and how later resource versions enter the new model.

## 3. Types as Beads

### Representation and rationale

A Type is represented by a Bead with stable identity and versioned definition
content. Each retained Type Bead version provides one immutable definition. Its
contract-bearing content includes the described resource category, property
constraints, field and overall semantics, conformance requirements, endpoint
requirements for Link Types, and ownership declarations for Bead Types.
This lists conceptual content, not new descriptor member names.

A Type Bead describing Links is itself a **Bead**. The instances it describes
are Links. Its own affiliation names the metatype governing Type definitions;
the instance Links' affiliation names the Link definition it provides. Links
remain non-endpoints under the existing model. The intrinsic Type field works
on both Beads and Links without introducing a dependency on typed affiliation
Links or making Links into valid endpoints.

Using Beads gives Type definitions the same identity, version and history model
as ordinary data. It also permits ordinary graph relationships involving the
Type Bead, subject to normal rules. An affiliation is nevertheless an intrinsic
dependency, not an ordinary incident Link. Deletion and retention cannot rely
solely on incident-Link checks to find the resources using a definition.

The alternative, separately versioned descriptors, still needs identity,
compatibility, dependency closure, availability and administration. The Bead
representation reuses existing concepts; it does not eliminate those obligations.

### Metatype and finite bootstrap

The Type of a Type Bead is a distinguished metatype. An intrinsic, built-in
bootstrap definition is acceptable; the system need not discover an infinite
chain of definitions before it can understand its first Type. The concrete
identity, initial self-reference/seed arrangement and initialization procedure
remain D01 decisions. No self-typing wire convention is specified here.

The metatype can itself have versions. A Type definition retains its exact
metatype affiliation just as any other Bead retains its Type pin. Publishing a
new metatype version does not reinterpret old definitions. An implementation
must support the required vocabulary and semantics before admitting definitions
that use it. Bead versioning is not a mechanism for automatically installing new
validator capabilities or executing arbitrary code.
Two conditions are distinct: possessing the exact metatype definition and supporting
the semantics it requires. Supplying a missing definition does not supply executable
validator capability. D01/D11 must specify the bootstrap's addressability, retention
and packaging, while D07/D12 must distinguish missing installable artifacts from
unsupported semantics. These are not mutually exclusive resource/capability models.

### Publication authority, placement and availability

Editing a Type Bead, publishing its definition, installing that definition into
a Scope, and admitting it for instance use are distinct actions. Ordinary Bead
operations do not imply unrestricted permission to change validation policy.
The exact authorization and admission boundaries remain D01/D07 decisions.
Affiliation is outside the existing authorization-view closure over owned Links.
D01/D09 must specify whether a reader of instances can also read their definitions,
and what interpretation/reconstruction remains possible when it cannot. A provider's
internal validation access need not equal the caller's permission to fetch a Type
Bead. Do not silently broaden access to either definitions or instances.

Type Beads might live in a dedicated Scope or share a data Scope. This is open;
no identity-URI rewrite or special repository layout follows merely from choosing Beads.
Globally recognizable identity and coherent exact definitions across Scopes are
required regardless of placement. Different local defaults or installed versions
are not themselves inconsistent; different contract content under the same
claimed exact identity is. Local installed artifacts may satisfy a globally
named definition without validation-time network lookup.

Exact meaning does not guarantee continued availability. The existing retention
baseline remains in force until explicitly amended. Generic deletion, hiding,
deactivation and erasure of Type Beads need separate treatment for intrinsic
users, dependent Types, historical records and replicated evidence (section 7).

## 4. Compatibility families and semantic versioning

### October 8 ruling — both compatibility guarantees within a major family

The guarantees below quantify over everything the earlier/later **contracts permit**,
not merely instances currently stored in a Scope. An empty store cannot make an
incompatible definition compatible. Family qualification is not a deployment-local
data audit.

For every earlier definition A and later definition B within one major family:

1. **Existing-data acceptance:** every A-valid instance remains valid under B
   without transforming its data or changing the meaning previously guaranteed
   for that data. Explicitly changing the affiliation pin is not a payload transform.
2. **Preservation of earlier contracts:** every B-valid instance satisfies the
   structural and semantic guarantees consumers of A are entitled to rely on.
   Extension tolerance must be part of A's contract, not assumed retrospectively.

Both are required. The promise applies to every earlier family member, not only
the immediate predecessor. It covers Bead and Link contracts, including units,
relationships, conformance and ownership obligations; it is not schema equality.
It protects documented guarantees, not incidental assumptions made by a consumer
in contradiction to the contract. Earlier conforming consumers must remain correct
for later valid data under their earlier obligations; a successor cannot silently
require them to reject formerly tolerated extensions, reinterpret values, or adopt
new behavior to remain conforming. This spells out the consumer side of guarantee 2,
rather than reducing semantic compatibility to an instance-schema comparison.

For an unchanged representation and validation context, requiring structural
acceptance in both directions means the accepted instance sets are equal. That
is intentional: compatible versions may use different schema text, improve
explanation, recognize existing extension space, or enable clients to make more
use of it, but cannot newly reject an old valid value or admit a value the earlier
contract prohibited. Semantic preservation is an additional obligation. Thus a change to the set of valid payloads is breaking;
changes to schema spelling or recognition of already constrained extension space
need not be. Publisher-reserved rights do not waive either guarantee. Any proposal
to narrow an earlier unconstrained extension area is subject to the same universal
check, not an exception adopted here.

These promises do not bypass exact-affiliation predicates, independent Scope
policies, authorization, concurrency guards or capability checks. They do not
make adoption implicit or prove that a missing definition is available.

### Author-designed extension points

Authors can use familiar JSON Schema techniques—open records, optional fields,
and constrained extension areas—to leave room for compatible evolution. BDP sets
the compatibility obligation rather than prescribing a universally extensible
schema. A consumer's handling of unknown fields/values and absent optional fields
must also be part of the semantic contract.

For example, A can permit an optional map of display labels, with arbitrary keys
and string values, where unrecognized entries are ignored by consumers and all
entries remain uninterpreted display text. B can document a previously unnamed
key and a client can choose to display it. If B preserves every previously valid
string and its meaning, and does not require the key, both guarantees can hold.
This is use of a deliberately available extension point.

In contrast, making an optional field required invalidates old data. Adding a
new value to a previously closed enum breaks old contractual expectations. Even
adding an optional field can fail if older open records permitted arbitrary
values at that name and B now rejects or reinterprets those values. Open records
are useful extension machinery, not proof that every additive edit is compatible.

| Change from A to B | Old-data acceptance | Earlier-consumer guarantees | Same-family conclusion |
| --- | --- | --- | --- |
| Add paused to a closed open/closed enum | Preserved | Violated | Breaking |
| Remove closed from that enum, otherwise preserving meaning | Violated | Preserved for remaining valid values | Breaking |
| Require a formerly optional property | Generally violated | Must also review semantics | Breaking |
| Dollars become cents with the same numeric schema | Shape preserved, old meaning changed | Violated | Breaking |
| reviewed-by becomes approved-by with unchanged Link shape | Shape preserved, old meaning changed | Violated | Breaking |
| Recognize an already-permitted optional display-label key without further constraints or meaning changes | Preserved | Preserved | Compatible |
| Add an optional typed field at a name where A permits values that B rejects | Violated, even if no such value is currently stored | Insufficient to rescue the first guarantee | Breaking |
| Improve documentation without changing any guarantee | Preserved | Preserved | Compatible; exact version can still differ |

### Role and limits of SemVer

SemVer's major/minor/patch designation is the candidate way to communicate family
membership and compatible evolution. The accepted requirement here is the pair
of guarantees, not a finalized version-label grammar, range syntax or patch/minor
classification algorithm. A semantic change such as dollars-to-cents cannot be
made compatible by calling it a patch or a bug fix. Published exact definitions
remain immutable even when their claims turn out to be mistaken.

A major boundary permits us to identify breaking evolution, but does not choose
how an instance migrates across it. Whether one stable Type identity spans major
families is the working direction; allowed cross-major adoption, data transforms
and graph repair still need D02/D06/D10 decisions. The existing floating nominal
filter spans the identity's versions and families; it must not promise one shared
contract across that entire result.

A SemVer designation is distinct from a Bead revision and needs an exact binding
and publication authority. Neither a label, a schema check nor a signature proves
arbitrary semantic compatibility. D05 must define assertion authority, evidence,
structural checks, handling of false claims and withdrawal of trust. Withdrawing
trust changes current admission policy; it must not silently rewrite a retained
definition or pretend a historically made assertion never existed.
A published family designation, actual satisfaction of its compatibility obligation,
and an authority's current acceptance of evidence are distinct facts. D05/D06 must
choose whether any family predicate means declared membership or trusted contract
satisfaction, and what claim withdrawal does to matching and existing graph validity.
No silent removal from a declared partition, or automatic invalidation of existing
Links, is selected here. T26 includes these outcomes explicitly.

### Compatibility versus conformance

Compatibility-family membership and conformance are separate concepts. The
former promises both directions above between ordered family members. Conformance
to a contract expresses satisfaction of that contract and need not establish that
all its old data is accepted by the conforming definition.

One candidate mechanism uses exact `(Type identity, definition version)` nodes
and intersected structural contracts. It must not confuse B conforming to earlier
A with a nominal self-cycle. Same/different-identity relations, transitivity,
version diamonds and deduplication require D04/D05 decisions. Intersecting two
contracts cannot express a widening that the old contract forbids; assigning a
later version number cannot override that restriction. No latest-wins rule or
one-version-per-identity restriction is silently adopted.

## 5. Affiliation inputs, storage and matching

### October 8 ruling — explicit affiliation updates

Every resource version committed under the new model carries an exact Type
binding. Authoring convenience does not weaken stored precision. A write may
explicitly provide an exact selection or a floating identity selection. Omission
on an existing-resource update preserves its exact stored pin, including when a
newer compatible definition exists. Explicit floating selection requests selection
of the currently chosen definition; it is not merely an identity assertion.
Resolution and resulting-state validation still occur when selection ultimately
lands on the existing exact pin. That selection adds no affiliation change; if the
entire resulting durable state is unchanged, the operation is a semantic no-op.

| Surface / input | Shared meaning | Remaining detail |
| --- | --- | --- |
| Create with an exact Type selection | Validate and store that exact definition | Binding/address representation and unavailable outcomes |
| Create with a floating Type selection | Resolve to one definition, validate and store the exact pin | Selection authority and resolution point |
| Update omitting Type selection | Keep the existing exact pin | Ordinary validation and availability policy |
| Update explicitly selecting an exact Type | Adopt that definition with the resulting properties, or reject unchanged | Cross-major policy, capability and graph checks |
| Update explicitly selecting a floating Type | Resolve and explicitly adopt the chosen definition, or reject unchanged | Meaning of current, family selection and replay binding |
| Floating nominal Type filter | Match the Type identity across definitions and major families | Legacy absent-pin treatment |
| Pinned nominal Type filter | Match the exact identity/definition pair | Pin representation and legacy transition |

Properties and explicit Type selection may be changed in one operation. Validate
the resulting state under the selected definition and commit both or neither;
do not require the intermediate properties to satisfy both definitions. An
actual pin change is durable state even when properties are unchanged: revisions,
guards, events, history, snapshots and replicas must observe it. Exact event and
record schemas remain D03/D12. Re-selecting the already stored exact pin adds no
affiliation change; ordinary property/owned-state change rules still apply.

This does not authorize arbitrary multi-resource transactions or bulk adoption.
D08/D12 must specify selection timing for singletons, sequence members and bulk
carriers, and how idempotent replay preserves any selection it already committed.
An actual affiliation change produces new state; a request spelling alone does not.
A client-facing command is not automatically a transaction boundary. CLI spellings
such as update --bead-type or --link-type remain Beads decisions.

### Requirements are not nominal filters

Each constraint location needs its own fixed matching contract:

| Location | Distinctions to settle |
| --- | --- |
| conformsTo | Exact required contract versus a nominal/family predicate; closure/evidence and version diamonds |
| Link source/target requirements | Exact declared affiliation versus satisfaction of a required contract; which endpoint state is examined |
| ownsOutgoing | Identity, exact-version or conformance matching; explicit/wildcard membership and bounds |
| Scope aggregate counts, including linkConformsTo | Which versions qualify, counting across legacy/new records, and admission checks |
| Conformance queries and saved selectors | Matching semantics, available evidence, record-shape compatibility and trust policy |

A pinned requirement for A's **contract** could accept B through an approved
compatibility/conformance rule. A requirement for **exact declared affiliation A**
would not. Same-family guarantees make the first practical but do not make the
second true. No reference grammar is selected by this distinction.

Contract-bearing parents, schemas, metatypes and requirement definitions must
have fixed meaning. A fixed identity predicate can intentionally match future
versions without resolving a floating validation contract. Similarly, a family
predicate can be fixed while future definitions are evaluated under its rules;
declared membership versus trusted satisfaction and withdrawal still need design. Pinning a top-level definition while dynamically
resolving its governing meaning would violate immutability.

## 6. Links, ownership and graph validity

Link definitions evolve using the same Type Bead model and compatibility rules.
For example, broadening assigned-to endpoints from Person to Actor may accept old
Links while admitting Organization targets an old contract forbade. That is not
same-family compatibility unless the earlier contract already allowed it.
Type affiliation adoption is distinct from changing a Link's source/target pin;
existing endpoint repinning rules are not changed by this design.

Compatibility reduces relationship breakage where requirements concern preserved
contracts. It does not resolve every exact-affiliation requirement, independent
Scope policy or cross-major change. D06 must choose whether validity is checked
at creation/write time, continuously across affected writes, or against an
explicit historical state, and how to repair or refuse incompatible operations.
A fixed predicate can change truth as its floating endpoint changes. A historical
resource version does not itself supply a whole historical graph snapshot.
Current endpoint provenance pins do not automatically select historical validation.

Consider Invoice A and an incoming approval Link requiring A. An explicit change
to breaking Invoice C might satisfy C while invalidating the Link. Updating the
Link first might fail against A. If the Link is owned, its source is another
resource whose state must be accounted for. Per-resource atomic properties-plus-
Type adoption does not solve this connected case. D06/D10 must define a practical
repair boundary or refusal policy, with honest limits for each protocol profile.
No cross-authority atomic repair or remote validation is implied; external Link
endpoints remain opaque unless a separate amendment changes that rule.

Ownership declarations are part of the contract. Changing Type versions can
alter aggregate membership or bounds; changing an owned Link's affiliation can
change the source's complete versioned owned-Link record. Source guards, version
effects and retained serialization need explicit rules. Identity-keyed ownership
can be a fixed nominal predicate while each owned Link retains its own exact Type
pin; those ideas are not inherently contradictory. Exact-version ownership may
instead move a Link between explicit and wildcard buckets and change its bound.

Existing aggregate limits also need review: creating or adopting a Link that
adds/drops a conformance relation can affect applicable counts. Publishing a
new definition alone does not change the closure of an already pinned instance.
Additional minimum counts, cycles, uniqueness and lifecycle-transition rules
remain unapproved extensions. A transition across two Type definitions needs a
choice of governing contract; a pin alone does not answer it.

## 7. Installation, updates, removal, migration and packaging

A Type's administrative lifecycle consists of distinct actions. Publishing a
version does not install it everywhere; installation does not select it as a
default; selecting a default does not migrate instances. The following is the
complete decision surface, not an invented command set.

| Action | Shared BDP obligation/direction | Still to decide |
| --- | --- | --- |
| Author/publish | New immutable definition under stable identity; no rebinding of existing exact meaning | Publisher authority, governance, labeling, Type Bead operation admission |
| Install | Validate supported definition and complete contract closure before mutation admission; retain local exact artifacts | Atomic catalog admission, conflict/idempotence outcomes, administrative surface |
| Choose default | Select what explicit floating authoring input resolves to | Per-Scope versus publisher policy, family bounds, concurrent publication and replay |
| Adopt | Explicit new instance version; resulting-state validation; property/affiliation atomicity | Cross-major rules, affected graph boundary, owned-source guards |
| Deactivate/hide | Distinguish admission for new uses from discovery and access to retained exact contracts | Create/read/edit/delete/reactivate outcomes, errors and trust withdrawal |
| Purge/erase | Never silently rebind an exact identity; preserve existing retention duties unless expressly amended | Legal/operational erasure policy, dependency handling, replica/changefeed/disclosure effects |
| Migrate/rollback | Preserve historical resource versions; transformations and adoption explicit | Planning/execution boundary, concurrent changes, partial/bulk results, coordinated repairs; rollback is a new change, not history rewriting |
| Package | Portable exact meaning and a resolvable dependency closure | Standard interchange scope, concrete bundle, transport, trust and supported vocabulary limits |

A generic Type Bead delete cannot ignore intrinsic affiliations or dependent
Types. Deactivation must not silently reinterpret stored values. Under existing
retention duties, required artifacts remain while live or retained records need
them. Any erasure exception must specify what dependent reads, writes and deletion
can still do. Otherwise removing a source definition can prevent owned-Link
removal, which prevents deleting the source: an administrative dead end.

Large explicit adoption jobs create resource versions and event/changefeed traffic
even when properties are byte-identical; owned-Link adoption can also version source
aggregates. Retention, snapshots and replication therefore have material costs.
Publishing a definition or improving its documentation does not require such a job.
D09/D10 must bound those effects and decide whether to provide resumable adoption
plans, ordering/coordinated repair, concurrency guards and partial-result reporting.
A singleton-only migration cannot promise an ordering that solves every connected
incompatible change; no bulk/transaction primitive is selected by this discussion.

The baseline remains bounded, offline validation from installed artifacts, with
no mutation-time fetch or automatic execution of package-provided migrations.
Data integrity hashes do not establish publisher authority or semantic correctness.
Beads chooses caches, storage transactions, acquisition transport, concrete signing
tools and operator UX. A shared interchange format would require its own BDP
scope decision; no archive extension, executable hook or new CLI is selected here.

## 8. Decision ledger

Confirmed positions above constrain these decisions; open cells are not
implementation permission. Donna rules on shared behavior; Beads owners choose
realization. Every included behavior needs a chosen outcome or explicit deferral
before the document is presented as a settled specification.

| ID / topic | BDP decision needed | Beads realization after that decision | Proposed review direction |
| --- | --- | --- | --- |
| D01 / Types as Beads | Types-as-Beads is the model developed here; decide exact metatype/bootstrap, publication rights, placement, definition visibility, bootstrap resource/capability treatment and generic-operation admission | Catalog representation and operator permissions | Use Bead identity/history with a distinguished intrinsic affiliation field and finite intrinsic bootstrap; do not equate editing a definition with installing it |
| D02 / identity | Define stable Type identity, category stability, identity-URI/location rules and legacy `types/` identities/absent pins without rewriting retained records | Mapping of legacy descriptors without breaking references | Preserve existing identities; do not silently move them to `beads/` |
| D03 / version addressing | Exact discriminator and historical addressing; cross-authority version identity/minting authority and divergence detection; token meaning, absent pins, retention and unavailable outcomes | Persistence/indexing and lookup | Choose an exact durable binding; no invented revision-to-version conversion |
| D04 / closure | Freeze contract-bearing dependencies; distinguish exact contracts from fixed nominal/family predicates; distinguish conformance cycles, recursive schema references and metatype bootstrap; define bounded resolution/evaluation and integrity evidence | Offline validator and bounded acquisition | Complete closure installed before admission, with no validation-time network |
| D05 / compatibility | Both acceptance and semantic substitution within a major family are confirmed; define family encoding, same/different-identity conformance, claim evidence, issuer authority, declared/trusted matching and withdrawal | Validation and explanatory diagnostics | Explicit contract evidence, never version-order inference; distinguish false semantic claims from schema failures |
| D06 / Link integrity | Choose current/historical endpoint validation, incompatible-adoption behavior, ownership matching and limits, source-version effects and external bounds | Transactional incident checks and repair UX | Preserve local integrity and make any graph repair explicit |
| D07 / installation | Define installed/admissible state, atomicity, idempotent reinstall, same-version conflict and concurrent admission | Operator interface, permissions, cache and catalog transaction | Same exact closure is idempotent; conflicting content under one definition version is rejected; partial installation grants no admission |
| D08 / updates | Publication/default selection versus instance adoption; ordinary edits; documentation-only changes; retry binding | Selection defaults, publication/update workflow | Publication leaves instances alone; resolve convenience selections once per admitted operation; retain resolved pins across replay |
| D09 / removal | Deactivation vs catalog visibility vs physical purge; existing reads/edits/deletion; reactivation; existing retention duties, erasure amendments and replica/changefeed effects; pinned-parent dependencies | Operator checks, inventory flags and collection | Withdraw future use separately; retain dependencies of live/retained data subject to explicit erasure policy. Decide whether pinned old instances remain editable/deletable and which closure-dependent checks still apply |
| D10 / migration | Definition adoption vs changing Type identity; transforms, validation, history/provenance, concurrent guards, coordinated parent/child adoption, atomicity and rollback | Plan/preview/execute/report UX and storage migration | Explicit guarded adoption; no rewriting retained states. Type-identity conversion remains outside the working model unless separately approved |
| D11 / packaging | Portable identity/meaning, exact closure agreement, dependency conflicts and accepted publication authority; decide whether shared interchange is in scope | Bundle/manifest serialization, import/export, distribution transports, trust configuration, signature mechanisms and limits | Consider an offline bundle of one or more definitions plus complete dependencies. Hashes establish integrity, not publisher authority |
| D12 / surfaces | Protocol discriminator forms, version discovery, identity/version matching in filters and Scope multiplicity policies, errors and old-client behavior | CLI names/flags, output, database schema and rollout | Specify shared outcomes first; do not assign new commands or overload Issue `--type` here |


## 9. Acceptance cases

These are design cases, not executed tests. Confirmed outcomes express only the
positions above; other rows identify choices still needing one outcome or explicit
deferral. D01–D12 remain the stable decision identifiers.

| Case | Given / action | Expected outcome to approve | Decisions |
| --- | --- | --- | --- |
| T01 | Install a new Bead definition with its complete closure | Becomes discoverable/admissible atomically; existing data unchanged | D01–D04, D07 |
| T02 | Install a Link definition referencing missing or wrong-kind endpoint contracts | Refuse admission without a partially installed usable Type | D04, D07 |
| T03 | Reinstall the same exact definition/closure; then try different content under the same version | First is idempotent; second refuses without replacing the original | D03, D07 |
| T04 | Create using an unpinned authoring selection while another definition is published | One exact pin recorded and reported; selection timing and retry outcome fixed | D03, D08, D12 |
| T05 | Publish definition B while current and retained instances use A | Those instances retain their exact meaning and A binding | D03, D04, D08 |
| T06 | Update a Bead or Link pinned to A after B publication, omitting Type selection | Confirmed October 8: the exact A pin remains; no implicit adoption | D08 |
| T07 | A permits only open/closed; B adds paused | B cannot qualify for the same family: old-data acceptance holds but old-contract substitution fails | D05 |
| T08 | Amount changes dollars→cents with identical schema | Same-family compatibility fails on meaning; a major-boundary migration may need an explicit value transformation | D05, D10 |
| T09 | Link meaning changes reviewed-by→approved-by without shape changes | Same-family compatibility fails on meaning; identical shape does not authorize substitution | D05 |
| T10 | Endpoint adopts a definition that no longer meets an incident Link requirement | Chosen reject/atomic-repair/invalid-Link policy applies with an explicit concurrency boundary | D06, D10 |
| T11 | Link has an endpoint pin to an old Bead state while current state has evolved | Validation uses exactly the chosen state; provenance-only pin is never silently treated as historical resolution | D03, D06 |
| T12 | Deactivate an in-use Type, then create, read, edit, delete and reactivate | Separate, explicit outcomes for all operations; no implicit artifact deletion | D07–D09 |
| T13 | Purge a definition referenced by live or retained data; exercise an erasure exception | Dependency/retention decision enforced; never rebound content; specified unavailable outcomes | D03, D09 |
| T14 | Explicitly adopt B with a stale resource guard or a transform that violates a Link contract | No unintended partial effects; history/provenance and chosen transaction scope preserved | D06, D10 |
| T15 | Import/export a multi-Type closure with schema dependencies, duplicate/conflicting versions and invalid hashes | Deterministic identity/content round trip for valid input; bounded refusal for conflicts, incomplete closure or bad integrity | D04, D07, D11 |
| T16 | Well-hashed package has an unauthorized publisher, a forbidden conformance cycle or exceeds limits | Refuse according to explicit trust and bound rules; digest success does not imply trust. Recursive schema references are not automatically forbidden | D04, D05, D11 |
| T17 | Open existing four/six-Type stores and inspect them with an old client | No read-time installation or silent identity rewrite; separately specified storage/client transition | D02, D03, D12 |
| T18 | Bootstrap a Type Bead and follow parent-definition pins, including a same-identity predecessor | Bootstrap terminates; closure identity and cycle rules distinguish definitions; no unpinned semantic dependency | D01, D03–D05 |
| T19 | Bead adopts a definition adding/removing explicit or wildcard ownership of existing outgoing Links | Chosen identity/version/conformance matching, aggregate membership and retained representation are explicit; no unrecorded ownership transition | D03, D06, D10 |
| T20 | Bead adopts a definition lowering an owned-Link bound below its current count | Chosen integrity policy applies; both explicit and wildcard limits evaluated | D06, D10 |
| T21 | Owned Link adopts a new Type definition while the source is concurrently edited | Required source guard, source/Link version effects and atomicity are explicit; old aggregate remains interpretable | D03, D06, D10 |
| T22 | A conformance diamond reaches two versions of one stable Type identity | Chosen intersection/conflict policy is deterministic; exact-pair deduplication and same-identity predecessor conformance remain coherent; no latest-wins selection | D04, D05 |
| T23 | Link with an external endpoint adopts a definition changing external policy from opaque to none/bead | Chosen admission/refusal outcome is explicit; no remote dereference or cross-authority atomicity is inferred | D06, D10 |
| T24 | Definition adoption encounters authored properties not mentioned by the new definition | Current open-root/preserve-untouched rules remain unless expressly amended; any transformation/removal is explicit, not schema-driven stripping | D08, D10 |
| T25 | Delete a resource whose Type is inactive or whose closure is unavailable after erasure | State which guards, liveness/ownership checks and unavailable outcomes apply; neither automatic cascade nor ID-only bypass is inferred | D03, D06, D09 |
| T26 | Withdraw or discover a false compatibility assertion after resources have relied on it | Specify future admissions, existing data, retained evidence, declared/trusted family matching, resulting graph validity and discovery/diagnostics separately; no silent rewriting of old definitions or automatic semantic proof | D05, D09 |
| T27 | Read legacy current/retained records without definition pins, then edit the current record into a successor | Defined absent-pin handling and mapping; retained record stays unchanged; new-model successor has a decided exact binding | D02, D03, D08 |
| T28 | Copy a pinned instance between authorities; receiver lacks its definition or has divergent bytes for the claimed version | Agreed version minting/identity and conflict detection; no silent rebinding or request-time fetch; defined missing-definition behavior | D03, D04, D07, D11 |
| T29 | Query type/conformsTo and apply maximumEndpointMultiplicity to instances using two versions of one Type | Identity-versus-version matching and aggregate counting are explicit, stable and consistent with conformance | D05, D06, D12 |
| T30 | Install an unsupported schema dialect/required vocabulary, closed-root schema, or invalid explicit/wildcard ownership bounds | Existing v0 validation refusals preserved unless specifically amended; partial installation grants no mutation admission | D04, D07, D12 |
| T31 | Parent and child definitions evolve together; an old pinned parent is then deactivated or purged | Explicit publication/adoption ordering and transaction boundary; fixed child closure cannot drift; dependency/retention policy applies | D04, D08–D10 |
| T32 | Proposed Type-definition erasure propagates to a replica that holds dependent instances | Explicitly amend/map current erasure records, changefeed, disclosure and dependent-data rules; no resurrection, silent rebinding or unannounced weakening of retention | D03, D09, D12 |
| T33 | Propose B in A's major family; B rejects an A-valid instance or changes its meaning without transformation | Confirmed family rule: B cannot qualify within that family; publication enforcement and cross-major treatment remain open | D05 |
| T34 | Propose B in A's major family; a B-valid instance violates A's documented structural or semantic guarantees | Confirmed family rule: B cannot qualify within that family; identical schemas alone do not establish compatibility | D05 |
| T35 | B adds an optional typed field whose name A allowed as an arbitrary extension; A permits an incompatible value whether or not any stored instance uses it | Same-family compatibility fails universally if B rejects or reinterprets any A-permitted value; a clean or empty Scope does not rescue it | D05 |

| T36 | Create/read a definition for a Link Type as a Type Bead | The definition resource is a Bead; its described instances are Links with intrinsic Type affiliation and Bead endpoints | D01, D02 |
| T37 | Publish a Type Bead version under a newer metatype | Existing definitions retain their metatype pins; a reader may return data without supporting new validation semantics; admission requires supported semantics under the chosen bootstrap policy | D01, D04, D07 |
| T38 | Update only the affiliation pin while properties are identical | New resource state is observable in revision/history/events; it is not a property no-op; owned-Link source effects remain D06 | D03, D06, D08, D12 |
| T39 | Apply pinned and floating nominal filters over instances using two definitions and two major families | Pinned matches exact affiliation; floating matches the nominal identity across all versions/families, without claiming homogeneous meaning | D03, D12 |
| T40 | An earlier open contract permits optional string-valued display labels at arbitrary keys; a successor documents one key while preserving every value and its display-label meaning | Both guarantees can hold; clients may recognize more of a preexisting extension space without schema narrowing or semantic reinterpretation | D05 |
| T41 | A declared compatible successor meets A's contract but a Link explicitly requires exact affiliation A | Compatibility does not establish exact-pin equality; exact affiliation and contract satisfaction must have separate semantics | D05, D06 |
| T42 | Publish C compatible with B but violating an older A in the same major family | C cannot qualify for that family; the promise applies to every earlier member, not merely the immediate predecessor | D05 |
| T43 | B keeps the schema but requires earlier conforming consumers to reject formerly tolerated extension data or reinterpret its meaning | B fails the earlier-consumer guarantee; unchanged schema is insufficient | D05 |
| T44 | Explicit floating selection resolves to the already-stored pin and the resulting properties/owned state are unchanged | Resolution/validation occurs; no affiliation change and no new durable state/event solely because the selection was explicit | D08, D12 |
| T45 | Import a definition whose metatype artifact is available but whose required semantics are unsupported | Availability and validator capability are separate; no automatic code installation; D07/D12 must specify the unsupported outcome separately from a missing artifact | D01, D04, D07, D11, D12 |
| T46 | Read or reconstruct a retained version after its Type is deactivated, hidden or unavailable | D09/D12 distinguish retained materialized records, required definition/projection evidence, caller access and Read-profile failure outcomes; do not silently broaden authorization | D01, D09, D12 |
| T47 | Reuse an old exact-value selector comparing @.type to a string for retrieval and set mutation over new-model records | D12 must define the chosen representation's compatibility or explicit transition; no silent selector rewrite/under-selection. Dedicated nominal filters retain their agreed identity semantics | D03, D12 |

## 10. Verified baseline and implementation readiness

Remote heads checked October 8 for this consolidated rewrite:

| Source | Exact head |
| --- | --- |
| Canonical BDP main | `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6` |
| PR60 before consolidation | `7b6c959c4f8739adc8b2659c86a3caed694b1429` |
| Beads integration | `356275a13290064fe903ace31984c14d1b9f7ad4` |
| CLI PR102 (open) | `94d880d4b7bdb87468281c1a7453b94387aacb2e` |

Current [BDP Types](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#types)
bind one immutable semantic contract to a Type ID. Resource type is immutable;
contract changes require another identity. Versioned affiliation intentionally
requires a coordinated specification change. The current
[uniformity section](https://github.com/gastownhall/bdp/blob/182f1fcf8a01d896976bff3c9e3fb87c596c6ca6/docs/specs/bdp.md#the-uniformity-principle)
already defers Type administration/evolution to a follow-on specification. Current BDP uses JSON Schema 2020-12, open-root property
schemas, closed descriptor objects, supported vocabularies, cross-member bounds
checks and bounded installed closure resolution. None of those constraints is
silently waived. Generic Reference pins record provenance; current in-Scope Link
endpoints must be live Beads and external endpoints are opaque.

BDP retains exact artifacts while live or retained representations depend on them
and at least Type ID/fingerprint for the logical Scope lifetime. This proposal
does not authorize weakening retention or reusing identities. Type-definition
erasure needs explicit mapping to the existing retained-history/changefeed rules.

At the refreshed Beads integration head, the
[Type readers](https://github.com/versioned-beads/beads/blob/356275a13290064fe903ace31984c14d1b9f7ad4/internal/storage/graphstore/types_read.go),
[installed-set checks](https://github.com/versioned-beads/beads/blob/356275a13290064fe903ace31984c14d1b9f7ad4/internal/storage/graphstore/informational_types.go)
and [technical reference](https://github.com/versioned-beads/beads/blob/356275a13290064fe903ace31984c14d1b9f7ad4/docs/reference/graph-preview.md)
still show the fixed four/six-descriptor catalog, immutable initialized bindings,
no arbitrary Type installation, and no read-time installation into old workspaces.
This targeted source refresh is not a runtime test or full repository audit.
`--type` remains Issue classification; graph Type selectors are distinct.
The October 1 [vendor comparison](bdp-vendor-sync-20261001.md) remains historical.

| Capability | Design state | Runtime evidence / Preview 2 |
| --- | --- | --- |
| Authority boundary | Agreed and recorded | Documentation only; mandatory |
| Fixed Type catalog/discovery | Existing behavior | Observed in current source; release qualification belongs to Janet |
| Types as Beads/metatype | Coherent model; D01–D04 details open | NYI for proposed lifecycle; document mandatory, implementation optional |
| Exact stored affiliation / explicit atomic adoption | Shared positions recorded; wire/profile details open | Proposed versioned behavior NYI |
| Both structural and semantic family guarantees | Confirmed obligation; encoding/evidence/enforcement open | NYI; schema success is not semantic proof |
| Matching, conformance and Link/ownership integrity | Distinctions and failure cases documented; D05/D06/D12 open | Proposed versioned behavior NYI |
| Arbitrary installation, removal, migration, packaging | Lifecycle surface and choices documented | NYI; no implementation selected |
| Acceptance cases | 47 design cases; some settled principles, remaining outcomes conditional | Not executed runtime tests |
| Review and publication | Council evidence linked from decision packet | Not product/Review Team/release acceptance |

## 11. Amendment and publication gates

The publication vehicle remains a decision: an amendment/versioned successor or
a follow-on specification with an explicit relationship to v0. Neither can claim
that new affiliation behavior already conforms to unchanged v0 rules. Select the
conformance/version boundary, shared vocabulary and migration/client obligations
before normative adoption; a companion document must identify which baseline
rules it supersedes rather than create competing authority.

After product decisions, the chosen specification change must reconcile at least:
the Beads/Links immutable-member rules; Types and descriptor identity;
Reference pin semantics versus Type definition addressing; descriptor schema;
`conformsTo`, endpoint requirements and `ownsOutgoing`/`ownedLinks`; resource records, creation/update and
mutation results; revision/no-op detection and expectedRevision guards;
ownedLinks derivation and Read-profile problem outcomes; collection Type
filters/discovery and saved selectors for both retrieval and set mutation;
event/change/history and
snapshot representations; closure installation, retention and problem outcomes.
The current string-valued Type discriminator must not be silently widened in
only one artifact. Keeping the existing identity string plus separate version
information and widening the discriminator have different selector consequences;
neither representation is selected. Existing exact-value Selector semantics and
pin-transparent dedicated endpoint filters provide a precedent to assess, not an
automatic Type encoding decision. Canonical schema, prose, fixtures and client handling move
together in a reviewed amendment with an explicit compatibility boundary.

Two completion criteria are deliberately separate:

- **Preview 2 design/specification draft (the requested candidate target):** all
  D01–D12 decisions carry recorded dispositions; each included behavior has one
  expected outcome in its cases; deferred behaviors are explicitly out of scope;
  source/evidence and ready/NYI tables are refreshed; review findings are disposed;
  CLI owner acknowledges the seam; release owner accepts this bounded document
  at a named commit. Until those records exist, this is review material only.
- **Adopted normative Type specification (not promised by this draft):** in addition,
  reconcile canonical prose and schema definitions, problem/discovery surfaces,
  examples/fixtures, conformance-matrix rows with honest unimplemented status,
  and old-client transition behavior; obtain Review Team and product acceptance.
  This is required before implementation may claim the new model as BDP law.

No normative file is changed by this draft. The chosen home is BDP's design
directory until adoption; the canonical specification remains `docs/specs/bdp.md`.
Moving or incorporating the draft later must leave one authority and clear links. The
normative publication must reconcile the existing follow-on-specification pointer
and add a discoverable Type-evolution ledger entry if appropriate; the current
ledger has no such entry. This is a future addition, not an existing artifact.

[CLI PR102](https://github.com/versioned-beads/beads/pull/102) stays owned by
its release lane. Coordinate these seams through #59 and the agent bus:

- Its current "Type immutable" language means the existing whole binding;
  a future stable identity with a changeable pin needs deliberate wording.
- Its arbitrary installed-Bead authoring row is NYI and depends on installation
  and validation decisions here. Do not promote it because this draft exists.
- Its metadata and Type-specific lifecycle proposals need their own BDP product
  rulings; this document does not approve them by association.
- CLI defaults, listing/filtering of Type versions and operator messages must
  expose the decided semantics without claiming HTTP Type mutation support.

No changes to PR102, the manual playground, Jim's History work, shared databases,
or the existing graph CLI are authorized by this contribution. If implementation
is later selected, its bounded PR must cite #59 and coordinate tests and release
integration with Janet. Monday's document must remain deliverable if that slice
is cut. See the decision packet for dates and publication acceptance gates.
