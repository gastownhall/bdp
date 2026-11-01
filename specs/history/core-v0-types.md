# Historical v0 Core Type material

**Historical source only.** This preserves the older cumulative profile guide,
Type-descriptor and inventory material removed from the active Core reading path
at Donna's request. It is not the selected v0.1 contract, a new Type format or a
provider-conformance claim. Use [retained Core](../profiles/core/retained-core.md),
[common affiliations](../profiles/core/affiliations.md) and the separate
[Types profile](../profiles/types/types.md) for the selected source.

Original source: [Core at 692d801231c78e12b456d8c5213bdf137a6b534d](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md).
The excerpts below retain the original wording and examples. Relative links are
rebased to that immutable original source to preserve their historical context.
No old rule here overrides a later selected clause or changes a frozen v0 artifact.

## Legacy conformance profiles

Original Core lines 88–179.

## Conformance profiles and reading guide

A **service** is an HTTP deployment that exposes one or more Scopes. An
**authority** serves a Scope and enforces the obligations of its advertised
profile; the Transactional part additionally defines its history-ordering role. BDP defines three cumulative
profiles per Scope. A service may host Scopes at different profiles, but one
Scope has one advertised profile at a time. Claiming a higher profile claims
every lower profile:

| Profile | What it adds | What its implementer may ignore |
| --- | --- | --- |
| **Read** | Scope discovery and safe retrieval of canonical Bead and Link Resource records | All mutation sections and every Transactional/Replication sidebar |
| **Read+Update** | Read plus the six single-Resource targets, the two alias targets, and an ordered, non-atomic `sequence` carrier | Set mutation, atomic `batch`, Scope history, receipts, snapshots, Events, and changefeed replication |
| **Transactional** | The complete transaction and replication contract | Nothing |

The four parts across Core/Read and Write separate the shared data model from the three cumulative
protocol profiles. Part I defines the Data Model, Part II defines Read,
Part III adds Read+Update, and Part IV adds Transactional. The Data Model
is common to every profile; it is not a separately advertised profile. Each
profile part defines its operation semantics, HTTP surface, errors and
conformance obligations. A later part may strengthen an inherited contract
or change a response envelope only where it says so explicitly. A lower
profile does not depend on a higher profile's definitions. The profile
overview here is a navigation guide, not an additional source of requirements.

The Read profile exposes no BDP mutation target. It also does not inherit
transaction, receipt, snapshot, changefeed, or replication obligations merely
because those facilities exist in a higher profile.

The optional complete [History capability](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md#historical-resolution) is available
on every profile; it changes no profile enum and adds no mutation or replication
requirement to Read. Its obligations apply only when advertised.

The minimum Read profile consists of:

- the canonical Scope response and its `service-desc` discovery document;
- the Bead, Link and Type inventories at their discovered navigation URLs;
- individual canonical Bead and Link Resource reads;
- paginated Bead and Link collection retrieval with the structural predicates
  and bounded Selector defined below;
- the `properties` view for a Bead or Link; and
- the incident Link `links` view for an in-Scope Bead.

The `include=links` aggregate, Resource Event views, Scope Events, receipts,
snapshots, changefeeds, and every mutation target are outside the minimum
Read profile. A higher cumulative profile inherits the complete minimum Read
surface. A product-specific readiness endpoint does not satisfy this surface.
Readiness remains client-owned domain behavior, computed from generic Bead
and Link reads.

The Read+Update profile defines `create-bead`,
`update-bead`, `delete-bead`, `create-link`,
`update-link`, and `delete-link` operation URLs and request-record
shapes, and adds the two alias targets, `put-alias` and `delete-alias`,
defined under [Alias targets](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/write/write.md#alias-targets). It does
not introduce collection `POST` or direct Resource `PUT`/`PATCH`/`DELETE`.
Each singleton request is individually atomic. The profile additionally
requires `sequence`, an ordered carrier for those same six operations and
the two alias operations. A sequence never reorders or parallelizes its
members, but it takes no sequence-wide lock. That means unrelated requests may interleave
between members, successful members remain committed after a later failure,
and independent members continue after a failure. The profile does not
include `UpdateWhere`, `DeleteWhere`, or `batch`.

Creation members in a sequence may bind a sequence-local name. A later member
may use that name as its Bead or Link identity, including as a Link endpoint.
The binding exists only when the earlier creation succeeds. A member that
uses an unavailable binding fails normally, and later independent members
still run. Because unrelated mutations may interleave, a bound Resource may
change or be deleted before a later member uses it. Sequence-local binding is
convenience, not isolation.

Every Read+Update mutation member has its own idempotency key. Repeating the
same semantic member with the same key returns its retained outcome rather
than executing it again. Reusing the key for different semantics is a
conflict. Creates and updates return the complete Resource postimage and an
opaque revision. Deletes return the canonical deleted identity. An alias
put or delete returns the absolute alias URL and, for a put, the canonical
target, and mints no revision.
`expectedRevision` remains optional for updates and deletes, and it produces
a conflict on mismatch. Read+Update has no durable Mutation Receipts and no
BDP Events.

In the profile name, **Update** denotes this complete single-Resource write
set: creation, properties change, and deletion. It does not mean only
modification of an existing Resource.

The `batch` name always means the Transactional profile's ordered,
all-or-nothing Mutation Transaction. Read+Update aggregation is named
`sequence`. It has the separately committing, per-operation result and retry
behavior defined below, and it never redefines BDP `batch`.


## Legacy descriptor summary

Original Core lines 206–221.

Domain types do not extend BDP's operation vocabulary. A Type Descriptor
contributes only a nominal Type ID, an optional JSON Schema over
`properties`, conformance to other Types, and, for a Link Type, constraints
on in-Scope source and target Beads. It cannot declare custom operations,
queries, views, or Events. Concepts such as `Task`, `Bug`, `Feature`,
`Chore`, `Epic`, `Decision`, and `WorkItem` are modeled as separate nominal
Bead Types. They are not a secondary discriminator on one generic Type.
Domain workflows such as readiness, claiming, or closing are client
responsibilities expressed through the fixed generic BDP reads and
mutations.

Installing, replacing, and governing Type Descriptors are administrator or
operator concerns. BDP v0 consumes installed descriptors, but it deliberately
does not define a client-facing Type-installation protocol. That protocol and
Type evolution belong in a follow-on specification.


## Legacy ownership descriptor

Original Core lines 436–478.

A Bead Type MAY declare that certain outgoing Link Types are **owned**:
each owned Link — target, pin, and properties — is part of the source
Bead's own versioned state. Ownership is declared per
(Bead Type, Link Type) pair in the owning Bead Type's descriptor —
`ownsOutgoing`, an object keyed by owned Link Type URL whose values are
`{ label?, max }` — and never on the Link Type, so the same Link Type may
be owned by one Bead Type and unowned by another. Nothing is owned by
default, only Bead Types may own, and keying by Link Type URL declares
each pair at most once by construction. Each declaration MUST carry
`max`, the largest owned set the Type permits.
`label` is documentation for display and SDK projection, like `name`: it
appears only in the Type Descriptor and MUST NOT appear in any Resource
record — the `ownedLinks` member is keyed by Link Type URL alone.

`ownsOutgoing` MAY also contain the **wildcard entry** `"*"`, whose
value is exactly `{ max }`: it declares every outgoing Link Type not
listed explicitly as owned. A Type whose relationship vocabulary is open
cannot declare ownership type by type — a Memory Bead relates to other
Beads through Link Types it does not enumerate, and every one of those
outgoing references must version with its source
([gastownhall/beads#5877](https://github.com/gastownhall/beads/issues/5877),
R17 and R22) — and the wildcard is how such a Type owns what it makes.
The wildcard MAY be the only entry. Explicit entries take precedence for
the Link Types they name: an explicitly declared Link Type is governed
by its own entry — its own `max` bounds that type and its `label`, if
any, describes it — and the wildcard governs every other outgoing Link
Type. The wildcard's `max` bounds the Bead's whole owned set: every
owned Link of the Bead across every owned Link Type, the explicitly
declared types' Links included, so a Bead never carries more owned Links
than the wildcard's `max`, whatever its explicit entries permit. An
explicitly declared entry's `max` therefore MUST NOT exceed the
wildcard's `max` in the same descriptor — the excess could never be
reached — and a descriptor that declares one is invalid: descriptor
validation refuses it, and the Type is not installed. That rule compares
two members, which the schema bundle cannot express; it is a
descriptor-validation rule beyond the schema, and a descriptor the
bundle accepts can still fail it. The
wildcard entry carries no `label`: it names no Link Type. The wildcard
changes no other rule of ownership: nothing is owned by default, only
Bead Types may own, every mutation of an owned Link versions the source,
an incoming Link never versions its target, and `label` never appears in
a record.


## Legacy Type model

Original Core lines 546–687.

The descriptor, effective-contract and installation model below is inherited v0
input, not a requirement that Core-only v0.1 providers implement Types. Its complete
extraction/profile composition remains a gate. In that inherited model, a Type ID
identifies a Type Descriptor describing either Beads or Links, never both.

A Type Descriptor identifies a JSON Schema for the Resource's `properties`
record. The generic Bead or Link structure is BDP law; it is not redeclared
by each Type. A Resource's complete `properties` value must satisfy its
Type's schema when that Type publishes one. Schemas are optional for
progressive interoperability. Clients may operate without fetching them,
while services still validate writes and diagnose violations.

A Type may declare that it **conforms to** zero or more Types of the same
Resource kind. If Type `A` conforms to Type `B`, a Resource declared as `A`
also satisfies the contract of `B` and may be used where `B` is accepted.
Conformance is transitive, acyclic, and never crosses the Bead/Link
boundary. Direct parents are unordered, and a repeated ancestor reached
through multiple paths contributes its contract only once.

For example:

```text
Task -> Issue
```

A Task still has one declared Type. Its **effective Types** are its declared
Type plus the transitive closure of the Types to which it conforms — that
is, every Type reachable through its conformance declarations. Its
properties must satisfy every effective Type's schema. This is **multiple
conformance**, not ordered inheritance: there is no parent precedence or
override rule. The effective contract is the intersection of all applicable
contracts. A contradictory combination accepts no Resource rather than
selecting a winning parent.

Type identity, conformance, and descriptor publication are separate
concerns. In the inherited v0 descriptor model, a Type ID identifies one
immutable semantic contract; this is not an immutable v0.1 instance affiliation.
Changing its Resource category, conformance graph, properties constraints, or Link endpoint constraints requires a new
Type ID. Referenced schemas and Types are part of that semantic contract and
must preserve their meaning at their existing IDs. Human-readable
documentation may improve without changing the contract.

Type IDs are globally scoped absolute URLs. A service SHOULD cache every
Type Descriptor it successfully resolves.

BDP publishes no universal root Bead or Link Type IDs. The descriptor's
`describes` member distinguishes the Resource category, and `conformsTo`
contains only domain-defined Type relationships. Category collection and
selection use the distinct Bead and Link roots rather than a synthetic root
Type.

#### Effective Type contracts

The same composition rules apply to Bead Types and Link Types. A Resource has
one declared Type, but the declared Type may list multiple direct parents. Its
effective Type set is the declared Type plus the transitive `conformsTo`
closure — the declared Type, its parents, their parents, and so on. Every
direct parent must describe the same Resource category as its child. The graph
must be acyclic. A diamond-shaped graph contributes a shared ancestor only
once.

There is no parent order, overriding, or field-level conflict resolution. The
effective properties contract is the intersection of every `propertiesSchema`
in the effective Type set. That means a properties object is valid only if it
validates against all of them. A derived Type's schema describes only its
additional constraints and does not restate its parents' schemas. A tool may
represent the effective schema as an `allOf` over the resolved schemas, for
example:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "allOf": [
    { "$ref": "https://work.example/schemas/issue-properties-v1" },
    { "$ref": "https://audit.example/schemas/auditable-properties-v1" },
    { "$ref": "https://work.example/schemas/task-properties-v1" }
  ]
}
```

This is a semantic valid-set intersection — a rule about which values count as
valid — not a requirement that a service prove syntactic JSON Schema
subsumption. If the schemas contradict one another, the effective contract is
uninhabitable — no value can satisfy it — and all writes of that Type fail
validation. An authority reports contradictions it detects. It is not required
to prove that an arbitrary schema intersection is satisfiable.

In the v0 baseline, the root object described by every `propertiesSchema` is
open. A root-level `additionalProperties` or `unevaluatedProperties` member is
therefore omitted or `true`. A root-level `false` or schema-valued restriction
is invalid for BDP. Nested objects may be closed independently. This lets
independent Type contracts compose without one parent rejecting another
parent's properties. A successful Resource read returns the complete stored
properties object, including properties not declared by any effective schema,
and an update preserves every untouched property.

#### Link endpoint constraints

Link endpoint constraints compose through the same effective Type closure, and
they apply only to in-Scope endpoints. Every `conformsTo` entry on the
corresponding endpoint across the declared Link Type and all its effective
parent Types is required. A local source Bead is valid only when its effective
Type set contains every source requirement. The target rule is identical and
is never directionally swapped. This is an intersection: an endpoint requiring
both `WorkItem` and `Auditable` accepts only a Bead that conforms to both.
Union constraints are not part of the v0 baseline. An out-of-Scope endpoint
is opaque and neither satisfies nor fails `conformsTo` requirements.

Each endpoint constraint additionally declares its **external-endpoint
policy** through optional `external`: `none` rejects an out-of-Scope reference
at creation, `opaque` admits any external URI, and `bead` expresses the
author's intent to cite an external Bead and requires an admitted absolute
HTTP(S) URL. An absent member means `opaque`. No path spelling, including
`beads/`, proves that an external target is a Bead. For `bead`, the authority
validates the HTTP(S) URL requirement, not the remote Resource's actual kind,
Type, existence or continuing availability; it MUST NOT claim such verification
from a URL shape. No remote fetch is required or implied. This remains declared
creation-time intent, not a cross-Scope integrity or lifecycle guarantee.
Opaque external equality and Reference pin handling remain unchanged.

Maximum endpoint multiplicity is different: it is a Scope-owned aggregate
policy, because checking it means inspecting other Links. [Scope aggregate constraints](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md#scope-aggregate-constraints) defines its
semantics and the optional discovery representation.

The descriptor deliberately does not restate generic BDP operations. The BDP
project MAY publish one generated
[OpenAPI 3.1 description](https://spec.openapis.org/oas/v3.1.2.html) for each
protocol version as non-normative tooling. That document describes the generic
profile surface and open Resource `properties`. It is derived from this
specification and the normative schema bundle.

A conforming Scope or Type Descriptor is not required to publish another
OpenAPI document. Domain Types constrain `properties` without redefining the
generic operations. If describing one deployment required a different API
surface, that would be evidence of a BDP uniformity defect. It would not be a
reason to create a second normative operation description.

A Type Descriptor cannot add an operation, query, view, Event Type, or
protocol method. Domain-specific behavior belongs in clients that interpret
nominal Types and use BDP's generic surface. It is not an extension advertised
by a Type or Scope.


## Legacy Type inventory and descriptors

Original Core lines 1168–1327.

### Types and Type Descriptors

The following descriptor/HTTP examples are inherited v0 staging input. The
selected v0.1 [common affiliation](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/affiliations.md) does not require Core-only
definition interpretation; the narrow exact-definition binding is in [the selected lookup](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/type-definition-read.md).
Type inventory/lifecycle and actual profile composition remain separate gates.

The discovered `types` navigation URL serves an inventory of the Bead and
Link Type Descriptors that the Scope advertises as known. It supports generic tooling,
lets clients preload schemas, and reveals which contracts the service can
validate. It is not a closed-world claim: it does not assert that no other
Type exists.
The response is paginated, and it follows the same authoritative continuation
and snapshot rules as the Bead and Link collections. Each page is an object
containing `items` and `next`; each item is exactly the Type summary `{id,
name, describes}`.

```http
GET /acme/types/ HTTP/1.1
Host: beads.example
Accept: application/json
```

```json
{
  "items": [
    {
      "id": "https://work.example/types/task",
      "name": "Task",
      "describes": "bead"
    },
    {
      "id": "https://work.example/types/assigned-to",
      "name": "Assigned To",
      "describes": "link"
    }
  ],
  "next": null
}
```

Each `id` is the Type Descriptor URL. A descriptor may be hosted inside or
outside the Scope. The inventory says that the Scope knows the Type. It does
not relocate or rename the descriptor. Inventory entries are summaries; the
globally scoped descriptor URL names the complete contract. A mutation
authority inventories a Type only after it has installed the contract closure
that it will use for validation.

A Type ID is the absolute URL of its Type Descriptor. `GET` of that URL returns
a self-contained JSON descriptor and may use ordinary HTTP caching and entity
tags. For example:

```http
GET /types/task HTTP/1.1
Host: work.example
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
ETag: "task-type-1"
Link: <https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json#/$defs/typeDescriptor>; rel="describedby"; type="application/schema+json"
```

A Bead Type Descriptor contains the common Type members:

```json
{
  "id": "https://work.example/types/task",
  "name": "Task",
  "description": "A unit of work that can be completed.",
  "describes": "bead",
  "conformsTo": [
    "https://work.example/types/issue"
  ],
  "propertiesSchema": "https://work.example/schemas/task-properties-v1"
}
```

A Link Type Descriptor is the same contract plus `source` and `target`
endpoint constraints. This `assigned-to` Link Type accepts any Issue as its
source and any Person as its target:

```json
{
  "id": "https://work.example/types/assigned-to",
  "name": "Assigned To",
  "description": "Associates a work item with the person responsible for it.",
  "describes": "link",
  "conformsTo": [],
  "propertiesSchema": "https://work.example/schemas/assigned-to-properties-v1",
  "source": {
    "conformsTo": [
      "https://work.example/types/issue"
    ]
  },
  "target": {
    "conformsTo": [
      "https://people.example/types/person"
    ]
  }
}
```

The descriptor members have these meanings:

- `id` is the absolute canonical Type ID used by Resources;
- `name` is a required nonempty human-readable name and does not establish
  identity;
- `description` is optional human-readable documentation;
- `describes` is exactly `bead` or `link` and must agree with every Resource
  declaring the Type;
- `conformsTo` contains the direct parent Type IDs, in no significant order,
  and is always an array;
- `propertiesSchema`, when present, is the absolute URL of a JSON Schema for
  the Resource's `properties` object — not for its generic BDP record; and
- for a Link Type, `source.conformsTo` and `target.conformsTo` list Types that
  the corresponding in-Scope endpoint Bead must satisfy. Every listed Type is
  required, and an empty list accepts any in-Scope Bead at that endpoint. An
  out-of-Scope endpoint is opaque and is not checked against these lists; and
- for a Bead Type, `ownsOutgoing`, when present, declares the outgoing
  Link Types the Type owns: an object keyed by owned Link Type URL whose
  values are `{ label?, max }`, under
  [Owned Links](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md#owned-links). `max` is the required bound on
  the owned set, and `label` is display documentation, like `name`: it
  appears only in the descriptor and never in any Resource record. The
  key MAY also be the wildcard `"*"`, whose value is exactly `{ max }`:
  it owns every outgoing Link Type not named explicitly, its `max` bounds
  the whole owned set, and explicit entries take precedence for the types
  they name, under [Owned Links](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md#owned-links). A Link Type Descriptor
  must not carry `ownsOutgoing`. An explicitly declared entry's `max`
  MUST NOT exceed the wildcard's `max` in the same descriptor, since the
  wildcard's `max` bounds the whole owned set: such a descriptor is
  invalid and is not installed — a descriptor-validation rule beyond the
  schema bundle, which cannot compare the two members — under
  [Owned Links](https://github.com/gastownhall/bdp/blob/692d801231c78e12b456d8c5213bdf137a6b534d/specs/profiles/core/core.md#owned-links).

Descriptor objects and endpoint-constraint objects are closed: no members are
allowed except those defined above. An `ownsOutgoing` entry is closed the same
way: `{ label?, max }` under a Link Type URL, `{ max }` under the wildcard.
Type-ID arrays contain unique Type URLs and
may be empty where this specification permits an unconstrained endpoint.

The canonical `typeDescriptor` definition exists only in the single BDP v0
schema bundle at `specs/profiles/core/bdp-v0.schema.json#/$defs/typeDescriptor`. The
specification prose above and that schema definition must remain aligned.
This section therefore does not carry a second inline schema copy.

#### Descriptor resolution and installation

A client may dereference a Type ID directly using ordinary Web retrieval and
caching. A BDP service SHOULD retain any descriptor it successfully resolves so
globally shared and well-known Type IDs do not require repeated network access.
This recommendation does not require a read-only service to resolve every Type
that appears in data before it can return the Resource record.

Every BDP properties schema uses JSON Schema 2020-12. An omitted `$schema` is
interpreted as that dialect. A schema declaring another dialect is invalid for
BDP v0. `$id`, `$ref`, anchors, and the declared vocabularies have their Draft
2020-12 meanings.


## Legacy collection inventory columns

Original Core lines 1621–1631.

| Parameter | Beads | Links | Types | Meaning |
| --- | --- | --- | --- | --- |
| `type` | yes | yes | no | Exact nominal Type identity, ignoring definition pin |
| `conformsTo` | yes | yes | no | Effective conformance to the named Type ID |
| `source` | no | yes | no | Exact source reference URI |
| `target` | no | yes | no | Exact target reference URI |
| `endpoint` | no | yes | no | Source or target reference URI equals the supplied URI |
| `selector` | yes | yes | no | Bounded Selector over each candidate record |
| `limit` | yes | yes | yes | Maximum records in this page |
| `cursor` | yes | yes | yes | Opaque continuation supplied by `next` |



## Legacy Read discovery

Original Core lines 991–1026.

The Read discovery document requires `bdpVersion`, `profile`, `scope`,
`beads`, `links`, and `types`. The optional `limits`,
`maximumEndpointMultiplicity`, `order`, and `historicalResolution` members
apply under their contracts. `aliases` appears exactly when the authority
serves alias resolution; a client MUST NOT construct alias URLs otherwise.
An omitted `order` means `canonical-uri`. These are the only members admitted
by the closed `readDiscovery` definition.

A minimum Read discovery representation may use arbitrary inventory paths:

```json
{
  "bdpVersion": "0",
  "profile": "read",
  "scope": "https://beads.example/acme/",
  "beads": "https://beads.example/acme/inventory/items",
  "links": "https://beads.example/acme/inventory/relations",
  "types": "https://beads.example/acme/catalog"
}
```

`scope` is the canonical Scope identity. It is also the base for resolving
references. `bdpVersion` MUST equal `"0"` for a BDP v0 Scope. A client that
does not implement the advertised value stops rather than guessing
compatibility. `profile` is required and is exactly `"read"`,
`"read-update"`, or `"transactional"`. It advertises the Scope's highest
supported cumulative profile. It is a single value rather than an array
because each higher profile claims every lower profile.
The `beads`, `links` and `types` members are absolute HTTP(S) navigation
URLs for their inventories. They MUST be beneath the canonical Scope URL,
but need not equal any fixed suffix. Inventory membership does not derive
from an item's URL prefix. `aliases`, when present, names an in-Scope alias
base, which may equal `scope`; it does not grant arbitrary paths alias
semantics without a binding. The operation directory is likewise discovered.
Clients MUST NOT synthesize these URLs from the Scope or a Resource path.


## Legacy Read conformance

Original Core lines 2136–2141.

Read acceptance covers discovery, canonical records and References, Types,
properties and incident-Link views, selection, pagination, HTTP behavior,
limits and non-disclosure. Optional History obligations apply only when that
complete capability is advertised. The shared conformance index records
case identifiers and evidence requirements; profile tags select only Read
obligations for a Read implementation.
