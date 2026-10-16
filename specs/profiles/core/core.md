---
status: draft
intended-status: normative
version: 0
---

<a id="bead-protocol-bdp"></a>

# Bead Protocol (BDP) — Core and Read

This document is the draft specification for Bead Protocol version 0
(BDP v0). The complete specification is intended to become normative after
review and after validation against real implementations.

This file contains the shared Data Model and Read contract. The companion
[Write specification](../write/write.md) contains Read+Update and Transactional.
The [shared conformance index](../../conformance.md) applies according to each
Scope's advertised profile. Core is a document name, not a new discovery value.

## Status and conformance

The Core/Read and Write documents and shared conformance index form a single
draft with one status. Its Data Model,
JSON representations, HTTP interface, Event model, examples, and schemas are
all under review together, and all of them are intended to become normative.
Until the draft is adopted, it is not a conformance target. The requirement
language states the intended BDP v0 contract.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** in this document are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) when, and only when, they appear
in all capitals, as specified by
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html).

The discovery value `bdpVersion: "0"` names this complete protocol version.
It is not a feature level, and it is not a floating compatibility range. A
client MUST inspect Scope discovery and MUST NOT assume compatibility with a
version it does not implement. A service MUST NOT advertise version `0` for
behavior that changes the meaning of a v0 operation, representation, or
invariant. The normative schemas and extension points in this specification
determine where additional members are allowed; no implicit minor-version
rule decides that.

Examples are illustrative, and they must remain consistent with the
requirements they demonstrate. Explicitly excluded features are not part of the BDP v0 contract.

The `https://beads.example/` authority is reserved for deployment examples in
this draft. Production deployments use their own canonical Scope URL. They
must not treat example URIs as globally assigned Resource identities.

The BDP v0 protocol-identifier prefix is
`https://github.com/gastownhall/bdp/`. It assigns these well-known identifiers:

- normative schema bundle:
  `https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json`;
- problem-family prefix: `https://github.com/gastownhall/bdp/problems/`.

These URIs are protocol identities; dereferenceability is not required for
their use or comparison. In other words, they work as identifiers even if
nothing can be fetched at those addresses. The normative schema artifact is
`specs/profiles/core/bdp-v0.schema.json` in this repository.
Conformance validators MUST load it without network retrieval.

This provisional prefix knowingly occupies path space that GitHub controls.
It does not assert that GitHub serves protocol artifacts at those paths. The
project accepts the hosting and reassignment risk while the draft namespace
is provisional. Implementations compare these identifiers exactly and
MUST NOT depend on dereferencing them.

The project may replace this prefix consistently across all draft artifacts
before the first BDP v0 release. If it does, every pre-release implementation
MUST rewrite persisted draft identifiers, fixtures, and generated artifacts
before claiming v0 conformance. Pre-release identities carry no stability
promise. Once v0 is released, its published identifiers remain stable even if
the source repository moves. A later authority requires an explicitly
versioned protocol migration; implementations MUST NOT silently rewrite
persisted v0 identifiers to follow repository relocation.

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

The optional complete [History capability](#historical-resolution) is available
on every profile; it changes no profile enum and adds no mutation or replication
requirement to Read. Its obligations apply only when advertised.

The minimum Read profile consists of:

- the canonical Scope response and its `service-desc` discovery document;
- the discovered `beads/`, `links/`, and `types/` inventories;
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
defined under [Alias targets](../write/write.md#alias-targets). It does
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

## The uniformity principle

The Bead Protocol (BDP) is a set of norms over the most widely adopted
protocols and formats of the Web. BDP applies these norms *uniformly*. That
reduces the overhead of Bead implementations, and it lets generic clients
work with Beads without a domain-specific protocol surface.

This uniformity principle applies both to accessing a given collection of
Beads and to using uniform formats and operations across different Bead
Types.

Put more directly, if you know how to work with *one* Bead Type, you know how
to work with *all* Bead Types.

Within one conformance profile, one common operation vocabulary, one
representation envelope, and one set of operation semantics apply to all
Beads and Links. A higher or lower profile changes availability and
guarantees only where its profile definition says so. Types may vary the
validity constraints on individual representations and Links, and
authoritative graph Scopes may vary aggregate constraints. But neither
changes how generic requests and responses are formed or interpreted. A
generic client does not need a Type Descriptor to make a request or parse a
response. It may consult the descriptor to predict whether a requested state
will be accepted. Scope membership is discoverable through uniform generic
mechanisms rather than domain-specific operations.

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

BDP is a specific protocol that adheres to an abstract data model. The data
model does not restrict the underlying implementation. An implementation
might use file directories, relational or non-relational databases, or
repositories.

## Part I — Data Model

<a id="bead-data-model"></a>

The shared data model defines the state a generic client can observe: Scope
and Resource identity, typed Beads and Links, properties and metadata, opaque
revisions and References. Every protocol profile uses this model. Its
representations do not require clients to understand how a store creates or
changes that state. State may originate from any store. The shared model names
Read-profile wire members where it constrains them; Part II defines their
representations and retrieval.

### Scopes and identity

A **BDP Scope** contains Beads and Links. It is the boundary within which BDP
interprets local identifiers and evaluates selections. Every Bead and Link
belongs to exactly one Scope. URI path hierarchy does not create
nested Scopes. A Scope exists only when it is identified by its own root BDP
description, and the URI spaces owned by different Scopes do not overlap.

A local Bead ID begins with the fixed `beads/` segment, and a local Link ID
begins with the fixed `links/` segment. Each then contains one or more safe
URI-path segments that form opaque identity within its Scope. Protocol
resolution against the canonical Scope URL produces one absolute canonical
Resource URL. That URL is immutable. Once committed, it is never reassigned
to an unrelated Resource in the lifetime of the logical Scope, including
after deletion or replacement of the serving authority. To back that up, an implementation
preserves a compact identity tombstone, a durable allocation record, or an
equivalent non-reuse guarantee. A restore that cannot preserve that guarantee
creates a different logical Scope and therefore uses a different canonical
Scope URL.

At a protocol boundary, BDP v0 assigns Beads and Links to exactly those two
fixed top-level paths. The segments following `beads/` or `links/` are
identity. They do not imply containment, collection membership, or a child
Scope: `beads/foo/bar` implies nothing at `beads/foo`, and both may exist as
unrelated Beads. No other Scope-relative path acquires Bead or Link
semantics, except the alias root defined below. Multiple roots of either
kind, and a root that mixes Beads and Links, are deferred beyond v0. The
protocol accepts documented local reference spellings as input, but it
emits absolute canonical Resource URLs.

#### Aliases

An **alias** is a repointable name for one in-Scope Bead, beneath the fixed
`alias/` root: one or more safe segments under the same grammar as local
IDs, so whether a URI names canonical identity or an alias is decidable
from its spelling alone. An alias is not a Resource: it has no
representation, no revision, and no collection membership. It targets a
canonical Bead URL only — an alias MUST NOT target another alias, so
resolution is always exactly one step. Unlike canonical segments, alias
paths are repointable and, after deletion, reusable: an alias is a locator
and carries no identity promise.

Alias paths and canonical Bead segments share one uniqueness namespace in the
Scope. An alias is not part of a Bead record or its `properties`, and changing
an alias changes no Bead revision. Serving alias resolution is Read surface,
advertised through the `aliases` discovery member.

Beads and Links are both **Resources**: each has identity, a representation,
and uniform operations. Authorization is separate from identity and typing.
So possessing a Resource or Type identifier does not grant permission to
read, mutate, or traverse it.

### Beads and Links

A **Bead** is the unit of shared state in this model: one identified,
typed thing — a task, a bug, a decision, a memory — whose content is a
JSON `properties` and common `metadata` documents and, when its Type owns outgoing Link
Types, the owned Links made from it. Beads are what people and agents read,
create, and update, and every change to either document produces a new
named version of it.

A **Link** is a first-class directed relationship — one Issue depends on
another, a memory cites a source, a task is assigned to a person. At least
one of its two endpoints is a Bead in the Link's own Scope; the other may
instead reference something outside it. Links are not
authored inside either endpoint: a Link has its own identity, its own
type, and its own `properties` and common `metadata`, and creating or deleting one never changes
the Beads it connects — except that a source whose Type owns the Link's
type is versioned by every owned-Link mutation and inlines the owned
Links' records as derived data, under [Owned Links](#owned-links). Beads and Links together form a graph, and a bounded, owned
graph is called a **Scope** (defined under
[Scopes and identity](#scopes-and-identity) below).

A **Bead** is a node in a Beads graph:

```text
Bead {
  id: BeadId
  type: BeadTypeId
  properties: JsonObject
  metadata: JsonObject  // common, Type-independent; {} when empty
  revisionProvenance?  // carried per version; data, not evidence
  ownedLinks?   // owned-Links plane; owning Types only
}
```

A **Link** is a first-class directed relationship whose `source` and
`target` each carry a Reference:

```text
Link {
  id: LinkId
  type: LinkTypeId
  source: Reference
  target: Reference
  properties: JsonObject
  metadata: JsonObject  // common, Type-independent; {} when empty
  revisionProvenance?  // carried per version; data, not evidence
}
```

For a Bead, `id` and `type` are immutable. For a Link, `id`, `type`,
`source`, and `target` are immutable. `properties` and common `metadata` may be updated, and a
Bead's `ownedLinks` plane changes only through its owned Links.
Assigning a new value to an immutable member is not an update. Because a
Link's endpoints are immutable, repointing or re-pinning an owned
Link is a delete-and-create pair, each of which versions the source.
Deleting a Resource and creating another Resource are distinct
operations.

Every Link has independent Resource identity. Its `type`, `source`, and
`target` describe it but do not identify it. BDP v0 permits multiple Links
to share the same Link `type`, `source`, and `target` tuple; endpoint
comparison uses the reference URI alone.
Maximum multiplicity constraints may independently limit how many Links can
share either endpoint. BDP v0 does not define a tuple-uniqueness constraint.

A URI-valued Bead or Link property is ordinary JSON data. BDP does not infer
a Link merely because a property contains a URI.

Each endpoint is either an **in-Scope endpoint** or an **out-of-Scope
endpoint**. An in-Scope endpoint MUST identify a live Bead in
the Link's Scope. The authority emits its absolute canonical Bead URL.

An out-of-Scope endpoint is an absolute URI outside the canonical Scope
URL. BDP treats it as an opaque reference: the target MAY be a Bead, another
kind of Resource, or nothing currently dereferenceable. The authority does
not dereference it. It does not infer its kind or Type, does not subject it
to in-Scope endpoint-Type or aggregate constraints, does not expose Bead
operations or incident Link traversal for it, and does not make its
lifecycle part of the Scope's integrity guarantees. External endpoint
equality is exact URI equality. BDP defines no cross-authority
canonicalization. At least one endpoint
of every BDP v0 Link MUST be an in-Scope Bead. A Scope therefore cannot own
a Link between two opaque external URIs. A future cross-Scope indexing
profile may define ownership, lifecycle, authorization, and duplicate
handling for such Links without weakening the v0 rule.

<a id="references"></a>

A **Reference** is how anything in BDP points at anything. It is a URI —
or a **Pinned Reference**: the URI plus the revision it was made against.

```text
Reference = URI
          | PinnedReference

PinnedReference {
  uri: URI
  revision   // opaque nonempty string
}
```

The URI is always the complete identity. Whether a Reference is in-Scope or
out-of-Scope is derived from it, never declared: a URI that resolves to (an
alias of) the canonical Scope URL claims an in-Scope Bead, and the
authority MUST reject it unless it is the Bead's canonical spelling; every
other URI is an opaque external reference. The pin is recorded provenance —
the revision the Reference was made against — with one law for every
Reference: the authority stores and echoes the `revision` token
byte-identically, compares it only for equality, and applies no semantic
validation to it in BDP v0. The `uri` follows the ordinary reference
rules — an in-Scope spelling is canonicalized like any other reference; an
external URI is preserved byte-identically like any other external
reference. An in-Scope pin's token is opaque and unvalidated in v0;
validating or resolving one against retained history arrives with
historical resolution. An external pin's token belongs to a namespace this
Scope does not own and is never validated or dereferenced.

Reference equality, incident traversal, and multiplicity use the URI
alone; a pin adds no identity component. References do not carry the
endpoint Bead's declared Type: readers that need endpoint Types use the
read views, and an authority validates endpoint Types against the
identified Beads themselves.

A Reference exists where this specification defines one — a Link
endpoint, or a member it names as a Reference. A URI or a Pinned
Reference that appears as a value inside `properties` is not one: it is
authored data, which the authority does not validate, canonicalize,
resolve, or traverse, and it is not an edge of the graph. A Type that
wants graph semantics for a reference — versioning with its source,
validation at admission, closure under views — declares an owned Link
Type for it, under an explicit `ownsOutgoing` entry or the wildcard, and
the reference is a Link.

#### Owned Links

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

Every mutation of an owned Link versions the source Bead. Because a
Link's `id`, `type`, `source`, `target`, and pin are immutable, the only
mutations that exist are creation, deletion, and property update;
repointing or re-pinning an owned Link remains a delete-and-create pair,
each of which versions the source. An incoming Link never versions its
target, whatever its type, so reverse projections such as cited-by remain
computed views. An owned Link remains a first-class Link with its own URL
and its own revision: a caller addresses, reads, and updates it there
like any other Link. Its entire state — target, pin, and properties — is
covered by the source's revision as well. That is what ownership means.

To say it as plainly as possible: there is no reference entity in the
model, and no second graph. An owned Link is an ordinary first-class
Link whose Link Type the source's Bead Type owns under `ownsOutgoing` —
by an explicit entry or through the wildcard — and a Scope's Links are
the only edges there are. Owned Links appear on
the links collection and in incident-Link views exactly like every other
Link. The `ownedLinks` member defined below inlines those same Links: it
is derived data, never writable directly and never a rival edge set —
create, delete, or update the owned Links, and the member follows.

A Bead whose Type owns outgoing Link Types carries an **ownedLinks**
member in its record: entries keyed by Link Type URL, each valued by the
array of that Link Type's owned Links' complete records — for each owned
Link, exactly the record it serves at its own URL, its `type` equal to
the entry's key and its `source` equal to the containing Bead — in
ascending code-unit order of the Links' canonical `id`s. The member
carries one entry for each owned Link Type actually present on the Bead
— at least one owned Link of that type exists — plus an entry, possibly
empty, for each explicitly declared Link Type; a Link Type owned only
through the wildcard has an entry exactly when an owned Link of that
type is present. The wildcard `"*"` is never a key: the member is keyed
by Link Type URL alone. The member is present, possibly empty, for every
Bead whose Type carries `ownsOutgoing`, and absent for Beads whose Type
owns nothing. The record
read always serves the member, because the Bead's revision covers it: a
reader holding a revision can always see everything that revision
covers, owned-Link properties included. The `properties` view remains
the authored JSON document alone.

Because the member is covered, it is never authorization-filtered. An
Authorization View that projects a Bead projects its owned Links and
their in-Scope target Beads: a view is closed over owned Links, and
hiding a Bead from a view therefore requires hiding every Bead that owns
a Link to it. The latitude to withhold incident Links from a visible
Bead applies to its incoming Links and to unowned Links, never to a
visible source's owned Links. For a wildcard owner the consequence is
stated plainly, because it is the price of inline, revision-covered
references: such a Bead owns every outgoing Link it makes, so a Bead
that owns a Link to a Bead hidden from a view is hidden from that view
too — a Memory that cites a hidden Bead is hidden with it.

The posture in one sentence: owned Links are outgoing, bounded, inline,
and versioned; incident Links are unbounded, a view, and version
nothing.

### Types

Every Bead and Link has exactly one immutable **declared Type**. The Type ID
identifies a **Type Descriptor** Resource. A Type Descriptor describes
either Beads or Links. One Type cannot describe both.

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
concerns. The Type ID on a Bead or Link is immutable and identifies one
immutable semantic contract. Changing its Resource category, conformance
graph, properties constraints, or Link endpoint constraints requires a new
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
policy** through the optional `external` member: `none` rejects an
out-of-Scope reference at that endpoint when the Link is created, `opaque`
admits any external URI, and `bead` admits an external URI only when it is
bead-shaped — a canonical HTTP(S) URL whose path contains a `beads/{id}`
tail. An absent member means `opaque`. The `bead` policy is validated,
declared intent about creation time, not an ongoing guarantee: the external
target can stop being a Bead through exogenous means, and the authority
never dereferences it to find out. A reference remains a claim about the
time it was written.

Maximum endpoint multiplicity is different: it is a Scope-owned aggregate
policy, because checking it means inspecting other Links. [Scope aggregate constraints](#scope-aggregate-constraints) defines its
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

### Scope aggregate constraints

A Type Descriptor owns constraints that can be validated from one Resource
and its in-Scope endpoints: properties schemas and endpoint effective-Type
requirements. Constraints that inspect other Resources belong to the Scope,
not to the globally identified Type contract.

BDP v0 defines one optional aggregate policy shape:

```text
MaximumEndpointMultiplicity {
  linkConformsTo: LinkTypeId
  endpoint: source | target
  max: PositiveInteger
}
```

For one in-Scope Bead and one named endpoint, this policy counts the live
Links in the Scope whose effective Link Types contain `linkConformsTo` and
whose named endpoint equals that Bead. The count includes Links declared as
different conforming child Types. If several policies apply, the smallest
maximum wins. An out-of-Scope endpoint is never counted or constrained.

Discovery MAY contain `maximumEndpointMultiplicity`, an unordered array of
records using the three members above:

```json
{
  "maximumEndpointMultiplicity": [
    {
      "linkConformsTo": "https://work.example/types/parent-child",
      "endpoint": "source",
      "max": 1
    }
  ]
}
```

An absent member or an empty array means that the Scope defines no such
policies. The administrative mechanism remains outside BDP. Minimum multiplicity, tuple uniqueness, acyclicity, and other aggregate
graph policies are deferred.

### Revisions

A Resource revision is an opaque token for one version of that Resource.
Clients compare revisions only for equality and must not derive meaning from
their spelling. A revision covers its properties and metadata and, for an
owning Bead, its owned-Link state. HTTP entity tags may represent revisions.

JSON value comparison is over **exact decimal values**. Two JSON numbers are the
same value if and only if the decimal values their literals denote are
equal, whatever their spelling: `1.0`, `1`, and `1e0` are one value, and
`9007199254740993` and `9007199254740992` are two. So that no two
conforming peers can disagree about a no-op, and so that a token one peer
derives from content verifies against bytes another canonicalized, BDP
makes the interoperability rule of
[RFC 7493 Section 2.2](https://www.rfc-editor.org/rfc/rfc7493.html#section-2.2)
mandatory: a number literal is **admissible** if and only if converting
its exact decimal value to the nearest IEEE 754 binary64 value and
serializing that value back in its shortest round-trip form — the
ECMAScript `Number::toString` form that
[RFC 8785 Section 3.2.2.3](https://www.rfc-editor.org/rfc/rfc8785.html#section-3.2.2.3)
adopts — yields a literal denoting the same exact decimal value. `1e300`
and its expanded form are admissible; `-0.0` denotes zero, is admissible,
and is the same value as `0`; `9007199254740993` and a decimal of twenty
significant digits are not admissible. On every admitted value the exact-decimal model and
the binary64 model agree by construction. A revision-token scheme that
derives tokens from content MUST declare, by name, the number model it
serializes under: `sha256-jcs` means RFC 8785 serialization with numbers
as binary64 under its Section 3.2.2.3, and is exact over admitted values
by construction; a scheme over exact decimals is a different scheme with a
different name.

The protocol projection may represent revisions as HTTP entity tags.

Whenever a store retains a Resource version across restore, destructive reinitialization or
authority replacement, its existing address remains bound to exactly that state.
An advertised History resolver MUST serve the requested token unchanged when
that state is authorized and serviceable. Token-scheme changes and internal mappings MUST NOT rebind an old
address or silently return a new revision. Lack of disposition evidence means
unknown, not loss inferred from token spelling. Retained-address survival grants no current write authority.
Erased content is not eligible for successful resolution.

Allocation MUST NOT bind an existing retained address to different state. No
mandatory registry or lifetime-unique-token construction is prescribed: a
content-derived scheme may reuse a token for the same state consistently with
the existing revision laws.

### Actor attribution

BDP v0 does not expose an authority-attested actor in Resource records. The
authenticated principal is an input to authorization, not protocol data. An
implementation may retain private audit records, and a domain Type may define
ordinary actor-related properties. But neither is a generic BDP attribution
guarantee — and neither is the carried `revisionProvenance` member defined
next. Standardizing principal identity, delegation, impersonation, privacy,
and attestation is deferred.

### Carried attribution

Every Bead and Link record MAY carry a **`revisionProvenance`** member: a
common, generic member in a common place, so that no Type has to declare
attribution as a domain property. It is **data, not evidence**: the protocol
transports it and attests nothing, and a generic client MUST NOT treat any
value of it as an authority claim about who acted. A future
authority-attested form, if one arrives, is a distinct member with a distinct
name; `revisionProvenance` never becomes it.

```text
RevisionProvenance {
  actor?: {
    id        // nonempty opaque string naming who the version is attributed to
    basis     // "writer-supplied" | "unknown"
  }
  committedAt? // optional version time value state
  agent?       // optional agent value state
  message?     // optional message value state
}
```

`basis` records the realization's basis for the value, not a BDP guarantee,
and v0 defines exactly two: `writer-supplied` — the principal was supplied by
the writer of that version, as written; `unknown` — the principal is carried
from data whose relationship to this version the realization cannot establish
(an imported record; a creator recorded where the writer of the current
version was not). There is deliberately no basis that asserts authentication:
a value meaning "the authority verified this principal" would be an authority
claim, which this member never carries — that vocabulary belongs to the
future attested member. If `revisionProvenance.actor` is present, both `id`
and `basis` are required. An absent actor means no actor was recorded; time
or other provenance fields do not imply an actor. Missing `basis` inside a
present actor is invalid. The former top-level `attribution` and
`changeContext` shapes are not accepted aliases. Attribution is immutable for
the version it accompanies. It is outside `properties`, never part of the
`properties` view. The actor is absent when no attribution was recorded; the
envelope is absent when no revision provenance was recorded. Principal
identifiers SHOULD be namespaced opaque strings — for example `agent:…`,
`human:…`, `svc:…` — so agents, humans, and service accounts coexist without
a global identity system; BDP mandates no namespace and compares principals
only for byte equality.

<a id="part-i--read"></a>

## Part II — Read

Part II defines the complete minimum Read protocol over the shared Data Model,
with optional capabilities identified locally. It requires canonical records,
opaque revisions and consistent pagination. It introduces no exposed epoch,
transaction, checkpoint or replica-bootstrap snapshot.

### Authorization views

For every request, the authority binds the authenticated principal, or an
anonymous principal, to exactly one opaque **Authorization View** of the
Scope. The client cannot name, widen, or combine views through request data.
Different principals may share a view only when the authority considers
their read projections equivalent. The canonical Scope, Bead, and Link URLs
remain identity, and they do not vary by view.

An Authorization View is a closed projection of the Scope. Every read,
Selector, incident Link view and
representation for the request observes that same projection. A Link is
visible only when the Link and every in-Scope endpoint Bead are visible. An
out-of-Scope endpoint is opaque and does not independently gate Link
visibility. A visible Bead need not expose hidden incident Links — a latitude
confined to incoming and unowned Links: a visible source's owned Links,
covered by its revision, are never withheld, and the view includes their
in-Scope targets, under [Owned Links](#owned-links). The
authority still evaluates referential integrity, Scope aggregate
constraints, deletion safety, and other Scope invariants against its
complete authoritative state. A non-disclosing constraint failure may
withhold the hidden Resources that caused it.

### Selection

BDP selection operates over exactly one collection in one Scope:

```text
Beads
Links
```

The candidate values are conceptually:

```text
{ id, type, properties, metadata }
```

and:

```text
{ id, type, source, target, properties, metadata }
```

Singular paths under `metadata` select common metadata independently of
`properties`; a property named `metadata` remains under `properties.metadata`.

A **Selector** uses a bounded profile of
[RFC 9535 JSONPath](https://www.rfc-editor.org/rfc/rfc9535.html) filter
expressions. It supports:

- singular paths relative to one candidate Resource;
- JSON literals and existence tests;
- `==`, `!=`, `<`, `<=`, `>`, and `>=`; and
- `&&`, `||`, and `!`.

It does not support joins, graph traversal, projection, aggregation,
recursive descent, nested filters, functions, regular expressions,
path-to-path comparisons, or selection of nested values. A Selector always
selects complete top-level Resources.

For example:

```text
$[?@.type == "https://work.example/types/task" && @.properties.status == "closed"]
```

The identity-bearing candidate members `id` and `type` contain absolute
canonical URLs. `source` and `target` are References: a local
canonical Bead URL, an opaque external URI, or a Pinned Reference.
A Selector compares stored values exactly. BDP does not reinterpret or
normalize arbitrary JSONPath string literals as identifiers, so callers use
the stored spelling in Selector expressions; the dedicated `source`,
`target`, and `endpoint` collection filters compare by reference URI and are
the pin-transparent way to select by endpoint.

Selection returns the complete matching Resources:

```text
Select(
  scope,
  collection,
  selector
) -> Resources
```

Pagination and ordering are protocol concerns. They do not change which
Resources satisfy a Selector.

### BDP JSON and HTTP Protocol

Every JSON text BDP admits or emits follows the number model defined under
[Revisions](#revisions) — exact-decimal equality with binary64 round-trip
admission —
which combines with the I-JSON string and object rules below to give every
Resource record exactly one RFC 8785 canonical serialization. Every JSON text BDP admits or
emits uses Unicode scalar values in strings and object member names; an
unpaired surrogate, including one produced by an escape, is invalid, and
an object MUST NOT carry duplicate member names after escape decoding.
Invalid request string/object syntax is rejected with `malformed-request`. An authority adapting an existing store MUST map
or refuse values outside this data contract before serving them as BDP
Resources. Every
instant BDP emits is an RFC 3339 `date-time` written with uppercase `T` and
`Z`, and the bundle's `dateTime` definition validates the calendar and the
clock, not merely the punctuation; a client accepts the lowercase forms
RFC 3339 permits.

### Scope discovery and human documentation

The optional `historicalResolution` discovery member is defined under
[Historical resolution](#historical-resolution).

Every BDP Scope has one absolute canonical Scope URL ending in `/`. That URI
is the base for resolving local IDs and durable relative references. This
holds even when a request reached the Scope through an alias or redirect. An
ordinary `GET` of the Scope URI MUST return a successful response carrying a
registered
[`service-desc` link relation](https://www.rfc-editor.org/rfc/rfc8631.html)
to the machine-readable JSON discovery document. The `Link` field is the
normative machine discovery mechanism. A client never interprets the Scope
response body as discovery metadata.

The Scope response MAY be `204 No Content`. It MAY instead be `200 OK` with a
useful human-readable representation such as HTML or Markdown. That
representation MAY visibly link to the same service descriptor and MAY
advertise separate human documentation with `service-doc`. But neither a body
nor a repository-style `README.md` is required for BDP conformance.

A minimal Scope response is:

```http
GET /acme/ HTTP/1.1
Host: beads.example

HTTP/1.1 204 No Content
Link: <bdp.json>; rel="service-desc"; type="application/json"
```

If a service supplies an HTML landing page, it SHOULD link visibly to the
discovery document and any human documentation it advertises. A BDP client
follows `service-desc`. It never depends on scraping the human page.

```http
GET /acme/bdp.json HTTP/1.1
Host: beads.example
Accept: application/json
```

The Read discovery document requires `bdpVersion`, `profile`, `scope`,
`beads`, `links`, and `types`. The optional `limits`,
`maximumEndpointMultiplicity`, `order`, and `historicalResolution` members
apply under their contracts. `aliases` appears exactly when the authority
serves alias resolution; a client MUST NOT construct alias URLs otherwise.
An omitted `order` means `canonical-uri`. These are the only members admitted
by the closed `readDiscovery` definition.

A minimum Read discovery representation is:

```json
{
  "bdpVersion": "0",
  "profile": "read",
  "scope": "https://beads.example/acme/",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/"
}
```

`scope` is the canonical Scope identity. It is also the base for resolving
references. `bdpVersion` MUST equal `"0"` for a BDP v0 Scope. A client that
does not implement the advertised value stops rather than guessing
compatibility. `profile` is required and is exactly `"read"`,
`"read-update"`, or `"transactional"`. It advertises the Scope's highest
supported cumulative profile. It is a single value rather than an array
because each higher profile claims every lower profile.
BDP v0 fixes one Bead root and one Link root per Scope. The `beads` and
`links` members are absolute HTTP(S) navigation URLs for those roots. In
canonical local IDs, the fixed roots are still exactly `beads/` and `links/`.
The advertised URLs are the collection URLs that correspond to those roots,
and they are the only top-level paths under which this Scope assigns Bead and
Link semantics. The collection URL itself is a Resource. A service MUST NOT
advertise an additional Bead or Link root, mix both Resource kinds beneath
one root, or let the fixed roots of separately described Scopes overlap.
For the canonical Scope URL `S`, `beads` MUST equal the URL produced by
resolving `beads/` against `S`, `links` MUST equal `links/` resolved against
`S`, and `types` MUST equal `types/` resolved against `S`. When present,
`aliases` MUST equal `alias/` resolved against `S`.

A local Bead ID has the form `beads/{id-path}`, and a local Link ID has the
form `links/{id-path}`. In both, `{id-path}` contains one or more nonempty
segments. Those segments are opaque identity: they do not define containment
or child Scopes. Empty, `.`, and `..` segments, controls, backslashes,
queries, fragments, scheme-relative references, and encoded `/` or `\`
separators are invalid. A service decodes percent escapes exactly once and
rejects invalid UTF-8. It emits unreserved characters literally, and emits
all required percent escapes with uppercase hexadecimal digits. It compares
decoded segments exactly, without Unicode normalization.

For example, both `beads/task-42` and
`beads/projects/alpha/tasks/task-42` are valid local Bead IDs. The second
form does not imply that `projects`, `alpha`, or `tasks` is a container or
Scope. A Link ID follows the same rule beneath `links/`, such as
`links/assigned-to/81`.

An input Resource reference may use that canonical local spelling or the
absolute canonical URL. The authority resolves a local reference against
`scope` and canonicalizes it. Before lookup, it verifies that the first
segment is the fixed root for the required Resource kind. A relative endpoint
reference therefore must identify a live Bead in this Scope. An absolute
endpoint reference outside `scope` remains opaque. Resolution never mutates
an endpoint Bead.

Discovery-document members defined by this specification are fixed BDP
vocabulary. Scope, Resource, Type, schema,
discovery navigation, and pagination `next` members are HTTP(S) URLs. BDP
permits arbitrary absolute URIs only for opaque external endpoint
references. BDP schemas assert this distinction with JSON Schema patterns. Schema-aware tooling may additionally
use JSON Schema `format` annotations, but format behavior is not the sole
enforcement mechanism. BDP v0 does not duplicate navigation through
BDP-specific HTTP link relations. `service-desc` is the one required machine
entry relation. Optional `service-doc` and `describedby` uses keep their
registered Web meanings.

### Normative schema bundle

BDP v0 publishes one normative JSON Schema 2020-12 bundle at
`specs/profiles/core/bdp-v0.schema.json`. Every public discovery, request, success, Resource, collection and problem envelope is a named entry beneath that bundle's
`$defs`. Shared primitive and record definitions occur once in the same
bundle. Every public envelope closes its protocol-owned members while leaving
Resource `properties` open for effective Type contracts.

The bundle's canonical `$id` is
`https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json`. The
repository artifact at that path is normative. Conformance validators load
the complete bundle without network retrieval. Generated language types
derive from that same artifact. BDP v0 does not publish independently
versioned schema fragments whose references could resolve to a mixed protocol
version.

### Advertised limits

The Read discovery document's `limits` uses the closed `advertisedLimits`
definition. Its Read-applicable groups are `page`, `request`, `resource`,
`selector`, and `retention.maximumSnapshotLifetime`; the schema admits no
`validation` group. Schema acceptance of a limit does not expose its capability.

The discovery document MAY contain a `limits` object. The object is optional
so that a small implementation can expose a conforming profile without
predicting every operational bound. Omission means only that the bound is not
pre-advertised; it does not mean infinite capacity and does not permit silent
truncation or a non-normative failure response.

When present, `limits` is divided into capability groups. A group is relevant
only when the advertised profile exposes that capability. Each advertised
value is a binding positive integer or ISO 8601 duration:

- `page.defaultItems` and `page.maximumItems` count Resource records;
- `request.targetBytes` counts octets in the encoded HTTP request target, and
  `request.bodyBytes` counts octets in the representation body;
- `resource.representationBytes` and `resource.propertiesBytes` count UTF-8
  bytes in the corresponding JSON serialization; metadata is covered by the
  complete representation bound, not by the properties-only bound;
- `selector.bytes` counts UTF-8 bytes of the decoded Selector string: after
  percent-decoding for query parameters, or JSON string decoding for a
  Selector in a request body, without additional URL decoding;
  `selector.depth` and `selector.nodes` count parsed Selector structure;
- `retention.maximumSnapshotLifetime` bounds the lifetime of a pagination
  continuation when advertised.

Fields and groups not advertised carry no implicit numeric value. A client
may use advertised values for request planning. Conformance tests may probe
them and require the server to enforce the advertised boundary consistently.
For example:

```json
{
  "limits": {
    "page": {
      "defaultItems": 50,
      "maximumItems": 200
    },
    "request": {
      "targetBytes": 2048,
      "bodyBytes": 65536
    }
  }
}
```

### Types and Type Descriptors

The discovered `types/` Resource is an inventory of the Bead and Link Type
Descriptors that the Scope advertises as known. It supports generic tooling,
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
  [Owned Links](#owned-links). `max` is the required bound on
  the owned set, and `label` is display documentation, like `name`: it
  appears only in the descriptor and never in any Resource record. The
  key MAY also be the wildcard `"*"`, whose value is exactly `{ max }`:
  it owns every outgoing Link Type not named explicitly, its `max` bounds
  the whole owned set, and explicit entries take precedence for the types
  they name, under [Owned Links](#owned-links). A Link Type Descriptor
  must not carry `ownsOutgoing`. An explicitly declared entry's `max`
  MUST NOT exceed the wildcard's `max` in the same descriptor, since the
  wildcard's `max` bounds the whole owned set: such a descriptor is
  invalid and is not installed — a descriptor-validation rule beyond the
  schema bundle, which cannot compare the two members — under
  [Owned Links](#owned-links).

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

### Resource records

Every successful `GET` of a Bead or Link returns one self-contained Resource
record. Both immutable and mutable state appear in the record, together with
the current opaque revision. The target URL still identifies the Resource.
But including `id` makes saved responses, logs, collection members, and
browser inspection self-describing.

A Bead record is:

```json
{
  "id": "https://beads.example/acme/beads/task-42",
  "type": "https://work.example/types/task",
  "revision": "opaque-task-revision",
  "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
  "properties": {
    "title": "Specify BDP mutation",
    "status": "open"
  },
  "metadata": {}
}
```

A Link record is:

```json
{
  "id": "https://beads.example/acme/links/assigned-to-81",
  "type": "https://work.example/types/assigned-to",
  "revision": "opaque-link-revision",
  "source": "https://beads.example/acme/beads/task-42",
  "target": "https://beads.example/acme/beads/person-7",
  "properties": {
    "since": "2026-08-04"
  },
  "metadata": {}
}
```

`id` and `type` are always absolute canonical URLs in responses. A Bead whose
Type owns outgoing Link Types additionally carries its `ownedLinks` member —
one entry per owned Link Type present on the Bead and one, possibly empty,
per explicitly declared Link Type, keyed by the Link Type URL and never by
the wildcard `"*"`, valued by the owned Links' complete records in ascending
code-unit order of their canonical `id`s — on every record read; the member
is absent for Beads whose Type owns nothing. Link `source` and `target` are
References as defined under [Beads and Links](#beads-and-links): an in-Scope
endpoint's `uri` is the Bead's absolute canonical URL, an out-of-Scope
endpoint's `uri` is its opaque absolute URI, and either may be a Pinned
Reference. `revision` is protocol metadata rather than mutable Bead or Link
state, and so is `revisionProvenance`: when present it is the per-version
carried attribution defined under [Carried
attribution](#carried-attribution), beside `revision` and outside
`properties`. [Immutable change context](#immutable-change-context) defines
the optional History time, agent and message fields in that same envelope;
none authenticates the actor. Common `metadata` is a mutable,
Type-independent JSON object on both Resource kinds. It is distinct from
Type-validated `properties` and from per-version `revisionProvenance`.
Successful reads always expose `metadata`: `{}` means no members are set. A
retained pre-metadata version that lacks the member is projected with
`metadata: {}` on reads without rewriting stored bytes or minting a revision;
a later metadata update starts from that empty object. `id`, `type`,
`revision`, and, for Links, `source` and `target` are returned on every
successful read. That does not mean they are accepted as update targets. An
implementation may store local identifiers internally. That choice does not
alter the response spelling.

A pinned endpoint is represented the same way for both reference classes.
For example, pinning an external target:

```json
{
  "uri": "https://github.example/issues/123",
  "revision": "8f0e2b"
}
```

and pinning an in-Scope Bead:

```json
{
  "uri": "https://beads.example/acme/beads/task-42",
  "revision": "opaque-task-revision"
}
```

Collection and selection responses contain these same records directly,
rather than wrapping them in a second `href`/`value` envelope.

### Resource views

Optional revision-specific reads and versions pages are defined under
[Historical resolution](#historical-resolution).

The default `GET` of a Bead or Link URL returns its complete Resource record.
BDP-owned query parameters select a derived view, or request one bounded
aggregate anchored at that same Resource URL:

```text
GET {resource}?view=properties
GET {bead}?view=links&direction=inbound|outbound|both
GET {bead}?include=links&direction=inbound|outbound|both&limit={count}
```

`view=properties` is valid for both Beads and Links and returns exactly the
complete stored `properties` object:

```http
GET /acme/beads/task-42?view=properties HTTP/1.1
Host: beads.example
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json
ETag: "opaque-task-revision"

{
  "title": "Specify BDP mutation",
  "status": "open"
}
```

The properties view includes declared and undeclared properties. It is never
a schema-filtered projection. Its entity tag represents the same Resource
revision returned in the complete record. `view=links` is valid only for a
Bead and is defined under **Incident Link reads**.

#### Optional incident-Link aggregate

This aggregate is outside the minimum Read profile.

`include=links` is valid only for a Bead. It returns the ordinary complete
Bead record with a `links` member. That member contains the first paginated
page of the same result exposed by `view=links`:

```json
{
  "id": "https://beads.example/acme/beads/task-42",
  "type": "https://work.example/types/task",
  "revision": "opaque-task-revision",
  "properties": {
    "title": "Specify BDP mutation",
    "status": "open"
  },
  "links": {
    "items": [
      {
        "id": "https://beads.example/acme/links/assigned-to-81",
        "type": "https://work.example/types/assigned-to",
        "revision": "opaque-link-revision",
        "source": "https://beads.example/acme/beads/task-42",
        "target": "https://beads.example/acme/beads/person-7",
        "properties": {
          "since": "2026-08-04"
        }
      }
    ],
    "next": "https://beads.example/acme/beads/task-42?view=links&direction=both&cursor=opaque-cursor"
  }
}
```

The default Bead `GET` remains bounded and does not include Links. The
aggregate request always embeds at most one page. A client follows `next`
into the Link view rather than requesting another aggregate page. `direction`
defaults to `both`, and `limit` bounds the embedded page. `include=links`
cannot be combined with `view` or `cursor`. The entity tag of an aggregate
response represents the entire aggregate response. It can therefore change
when its embedded Link page changes, even if the Bead's `revision` does not.

Using a query parameter avoids placing protocol-owned child names beneath a
hierarchical Resource ID. BDP reserves `view`, `include`, and the parameters
defined for each view or aggregate on Bead and Link URLs. An unsupported
view, include, or parameter that is not defined for the selected request is
an error, not an instruction to ignore that parameter.

### Alias resolution

When discovery advertises `aliases`, a `GET` or `HEAD` of an alias URL —
`alias/{alias-path}` resolved against the canonical Scope URL — returns
`307 Temporary Redirect` with `Location` set to the target's absolute
canonical Bead URL and no body. Resolution is redirect-only: an authority
MUST NOT serve a Resource representation at an alias URL, which would give
one Resource a second address. `HEAD` makes resolution a body-less
primitive. The status is temporary by design: aliases repoint.

An unknown alias, an alias URL carrying a query or fragment, and any alias
URL at an authority that does not advertise `aliases` return the same `404`
`resource-not-found` used for unknown Resources, under the same
authorization projection: aliases are not an enumeration oracle. Alias
resolution never follows chains, because an alias targets only a canonical
Bead URL. The redirect target is subject to ordinary Resource authorization
when the client follows it; resolution itself asserts nothing about the
target's readability.

### Reads after deletion

History-specific reads follow [Historical resolution](#historical-resolution).

After a Bead or Link is deleted, ordinary `GET`, `view=properties`, and, for a
Bead, `view=links` return the same `404` `resource-not-found` problem used for
an unknown or non-visible identity. BDP does not require an authority to reveal
whether the Resource once existed.

To a caller authorized for the subject's retained history — the same single
authorization that gates `410` disclosure everywhere — an authority MAY
instead disclose why a valid-shaped address has nothing behind it. Two
sibling `410` conditions are Read-profile codes in the closed problem
table: `resource-pruned` (removed by deliberate lifecycle policy) and
`resource-erased` (content that must not exist). A
`resource-pruned` problem MAY carry one `archivedAt` member — a Reference,
possibly pinned, naming where the content went — recorded and echoed like
any Reference and never validated or dereferenced by the serving authority;
its presence within an authorized disclosure is authority policy. A
`resource-erased` problem carries no condition-specific extension members
beyond its ordinary problem members: even a pointer would disclose what
erasure exists to remove. To every other caller both
conditions remain the uniform `404`; the disclosure vocabulary is
never an enumeration oracle. The non-reuse rule remains internal: a
filesystem-backed implementation may retain only a compact allocation marker
or tombstone and need not serve it as a Resource representation.

### Incident Link reads

A Bead record does not embed its incident Links. A client selects the Link
view directly on the Bead URL and supplies a direction:

```http
GET /acme/beads/task-42?view=links&direction=outbound HTTP/1.1
Host: beads.example
Accept: application/json
```

```http
GET /acme/beads/task-42?view=links&direction=inbound HTTP/1.1
Host: beads.example
Accept: application/json
```

```http
GET /acme/beads/task-42?view=links&direction=both HTTP/1.1
Host: beads.example
Accept: application/json
```

`direction` is `inbound`, `outbound`, or `both`, and defaults to `both` when
omitted. `inbound` selects Links whose `target` is the Bead. `outbound`
selects Links whose `source` is the Bead. `both` selects their union. The
response is a paginated `items` array of complete Link records plus a `next`
URL. The initial request may supply `limit`. Subsequent requests follow
`next`. As with collection pagination, that continuation walks one logical
snapshot and an expired cursor is an error rather than a silent restart
against newer state. Only an in-Scope Bead has this view. An opaque
out-of-Scope endpoint does not.

BDP does not append `/links` to the Bead URL. Local IDs may contain multiple
path segments, so `beads/task-42/links` could already be the ID of a different
Bead. A suffix subpath would require BDP to reserve and visibly mangle a
control segment such as `/-/` or `/.bdp/` throughout the local-ID grammar. The
`view` query parameter avoids that collision while keeping the request visibly
anchored at the Bead. The Link collection still owns Link identity. The Bead's
Link view is only a derived read.

### Collection retrieval and selection

An ordinary `GET` of a discovered collection returns a paginated `items` array
and a `next` URL. The `beads/` and `links/` collections return complete
Resource records; the `types/` collection returns Type summaries.

Every collection response — filtered or not, including the Bead `links`
view — is produced in one total order over the selected set, stable across
the pages of one logical snapshot (the same snapshot the cursor rules
bind). The order is an authority property named by the `order` discovery
member, not per-request behavior: a caller cannot request a different
order in BDP v0, and query-relevance ranking is consumer policy, never
authority behavior. The baseline order every authority MUST support is
`canonical-uri` — ascending lexicographic comparison, by Unicode code
unit, of each item's absolute canonical `id`. It is total, cheap, and
implementation-neutral. An authority advertising no `order` member serves
the baseline; an authority MUST NOT serve any order it does not advertise.
Two conformant authorities serving the same selected set under the same
advertised order return the same item sequence. The
collections accept these structural predicates:

| Parameter | `beads/` | `links/` | `types/` | Meaning |
| --- | --- | --- | --- | --- |
| `type` | yes | yes | no | Exact Type ID |
| `conformsTo` | yes | yes | no | Effective conformance to the named Type ID |
| `source` | no | yes | no | Exact source reference URI |
| `target` | no | yes | no | Exact target reference URI |
| `endpoint` | no | yes | no | Source or target reference URI equals the supplied URI |
| `selector` | yes | yes | no | Bounded Selector over each candidate record |
| `limit` | yes | yes | yes | Maximum records in this page |
| `cursor` | yes | yes | yes | Opaque continuation supplied by `next` |

Different predicates are combined with logical AND. Within `endpoint`, source
and target are combined with logical OR. A parameter may occur at most once in
BDP v0; repeated parameters are errors rather than implicit unions. Type IDs
are absolute URLs. The structural `source`, `target`, and `endpoint`
parameters may use a canonical local Bead ID, its absolute canonical URL, or
an absolute out-of-Scope URI. The authority normalizes local Bead references
before comparison. External URI comparison is exact. This convenience does not
apply inside a Selector string.

An unsupported collection query parameter or any repeated collection query
parameter returns the `invalid-parameter` Problem: family `request`, HTTP
status `400`, and retry disposition `never`. The authority MUST NOT ignore an
unsupported parameter or choose one value from a repeated parameter.

The `selector` value is the bounded JSONPath Selector defined under
[Selection](#selection). It is percent-encoded in the request target:

```http
GET /acme/links/?selector=%24%5B%3F%40.source%20%3D%3D%20%22https%3A%2F%2Fbeads.example%2Facme%2Fbeads%2Ftask-42%22%20%7C%7C%20%40.target%20%3D%3D%20%22https%3A%2F%2Fbeads.example%2Facme%2Fbeads%2Ftask-42%22%5D HTTP/1.1
Host: beads.example
Accept: application/json
```

The decoded Selector is:

```text
$[?@.source == "https://beads.example/acme/beads/task-42" || @.target == "https://beads.example/acme/beads/task-42"]
```

The structural predicates and Selector decide the complete matching set before
pagination, but only within the request's Authorization View. A cursor
continues one logical projected snapshot: every page belongs to the same
selected set, authorization projection, and Resource revisions as the initial
request. The server-generated `next` URL is authoritative. It carries the
opaque cursor plus any parameters needed to continue that snapshot. `next` is
`null` after its final page. In Read and Read+Update, the opaque cursor itself
carries or indexes the authorization-projection fence. Clients neither inspect
it nor need a separate Authorization View field. If the authority can no
longer continue the snapshot, or if the request no longer belongs to that
projection, it returns an expired- or foreign-view-cursor problem rather than
silently restarting against newer state.

Selector candidate records use the same absolute canonical identity spelling
as responses. BDP does not parse or rewrite JSONPath string literals that
happen to look like local identifiers. That means JSONPath equality is
ordinary string equality, and selector behavior stays independent of request
spelling aliases.

Collection responses do not accept Resource `view` or `include` parameters.
Their `items` are always complete Resource records. In particular, a Bead
collection cannot embed each Bead's incident Links. Clients select Links from
`links/` or use the Link view on one Bead. Services may advertise a maximum
encoded request-target length and Selector complexity, but must not silently
interpret a truncated Selector. Ordinary `GET` semantics make simple
selections browser-debuggable and compatible with conditional requests without
requiring the newer `QUERY` method or a request body on `GET`. The
authorization-dependent `private, no-store` rule remains binding.

### Historical resolution

History is an optional complete capability available with the Read profile.
A cumulative profile inherits it without requiring it. It is not a separate profile. Discovery advertises it only as
`historicalResolution: { "version": 1 }`, the closed `historyCapability`
definition. Absence means it is not advertised. An authority MUST implement
all applicable requirements in this section before advertising it, for both
canonical Bead and Link URLs. A profile, a retained store, or a schema parser
alone supplies no capability claim. No advance age/count retention guarantee,
aggregate participation count/class, retention hold, or generic persistent-
consumer erasure acquisition is advertised by this member.

Here **subject-history authorization** means the same single retained-history
authorization defined under [Reads after deletion](#reads-after-deletion), evaluated
in the current request's Authorization View. “History-authorized” refers to that
same gate. It is independent of permission to disclose a complete historical record
or a whole metadata row; no second retention-disclosure permission is introduced.

#### History discovery and views

Existing page limits apply to versions pages. The fixed 64-item bound on
missing-state diagnostics is defined under
[Historical diagnoses and missing state](#historical-diagnoses-and-missing-state).

History provides full-record `revision` retrieval and a separate `view=versions`
operation on canonical Bead and Link URLs. The query combinations below are
exhaustive. Neither operation adds alias query semantics or a historical
`include=links` aggregate.

```text
GET {resource}?revision={token}
GET {resource}?view=versions[&limit={count}][&cursor={cursor}]
```

#### Immutable change context

`revisionProvenance` is the single immutable version envelope outside
`properties` and common `metadata`. Its optional `actor` is the carried
attribution defined above, including truthful absence and
`writer-supplied|unknown`; grouping the fields does not authenticate the
actor. Read does not require History, a timestamp, an actor, or this
envelope. Shared schemas permit absent provenance and actor-only provenance
for legacy and non-History versions.

Native versions under advertised History MUST carry `committedAt`, `agent`, and
`message` in this envelope on current/historical complete record reads and retained
history rows. No provenance is synthesized on deleted identities, aliases,
References or properties views. These requirements do not establish full Memory
compatibility.

The closed envelope permits only `actor`, `committedAt`, `agent`, and `message`.
The last three fields are an all-or-none group, independently of actor presence.
`committedAt` is `{ "state": "present", "value": <RFC 3339 date-time> }` or
`{ "state": "undetermined" }`. Agent and message are each a closed
`{ "state": "present", "value": <string> }` or `{ "state": "absent" }` or
`{ "state": "undetermined" }`; a present agent identity is nonempty, while an
intentionally empty message is valid. Absence, uncertainty and a recorded value
are distinct; never fabricate legacy metadata. Sources, source completeness,
Activity records and terminal deletion versions are not introduced here.

#### Historical authorization

Historical success requires the current whole-record/owned-state permission
defined below. Missing-state refusals use subject-history authorization
independently of reconstruction. Historical identity/relationship permission
grants no target body access and does not relax the current-plane closure
under [Authorization views](#authorization-views).

#### Exact historical reads

`GET` or `HEAD canonical-resource?revision=token` selects exactly one
nonempty opaque revision. Query components follow the existing form-query
convention (`URLSearchParams`): decode percent escapes once and decode `+` as
space. A literal plus in a token MUST be encoded as `%2B`; a space may be encoded
as `%20` or `+`. Percent-encoded reserved characters and Unicode are data, not
checkpoint-token syntax. Repeated or
empty `revision`, any additional query member (including `view`, `include`,
selection or pagination), and unsupported History queries on a non-advertising
authority fail as `invalid-parameter`. Alias queries retain uniform
`resource-not-found` / 404 and gain no History semantics. Normal authentication
and non-disclosure precedence applies before condition-specific disclosure.

A successful exact read returns the ordinary complete Resource record with
exactly the requested `id` and `revision`, carried attribution and change
context when recorded, and the complete historical owned-Link state. Use
`historicalBeadRecord` or `historicalLinkRecord`; the Bead shape excludes the
`links` aggregate. Never substitute current/nearest state, load inline Links
from today's graph, fill missing values from another revision, or rewrite
bound values under an old token. A historical owned Link and its source
retain their separate revision addresses. No witness envelope, new digest
scheme or extra current-scheme mapping is part of this capability.

Success requires current permission to disclose the whole requested historical
record, including its complete owned state. Historical target closure requires
current target visibility OR explicit current permission to disclose that
historical target identity and relationship. Source access alone supplies
neither permission, and disclosure of an identity/relationship grants no target
body access. Failed success authorization returns uniform `resource-not-found`,
not a partial record or invented retention diagnosis. A deleted subject may
have authorized retained history; historical permission does not restore its
current visibility. Current-plane owned-source/hidden-target closure and the
incident-Link deletion refusal remain unchanged. The alternative Memory
surviving-citation lifecycle is deferred.

#### Historical diagnoses and missing state

Ordinary non-History reads use the discretionary disclosure under
[Reads after deletion](#reads-after-deletion). History requires substantiated
Gone-with-reason for removed cited versions, the five subject-history-gated
Read diagnoses, and authorized deleted-subject versions pages. It preserves
uniform unauthorized 404 and creates no partial/current Resource success.

The five `revision-*` Read diagnoses in [Problem details](#problem-details)
apply only to History requests and require current subject-history authorization.
Unauthorized callers receive uniform `resource-not-found`, without evidence,
window or participation disclosure. In particular, the Bead-history gate for
`revision-unretained` MUST NOT depend on reconstructing the absent owned state.
Permission denial is never evidence of incompleteness. These gates also apply
to independent Link history under the selected complete Resource capability.

- `revision-unknown`: no retained state or substantiated disposition for this
  syntactically valid requested token. It is responder-relative uncertainty,
  not evidence of tampering, pruning or guaranteed synchronization repair.
- `revision-unretained`: positive version knowledge but missing reconstruction
  pieces. It carries required `missing`, a `historyMissing` object with `items`
  and `complete`. No Resource or partial Resource accompanies it.
- `revision-reorganized`: positive evidence that history replacement lost this
  address; authority replacement or unfamiliar token spelling alone is insufficient.
- `revision-not-tracked`: positive evidence of subject non-participation;
  absence of records or an expired participation marker is insufficient.
- `revision-unrepresentable`: positive knowledge that an existing bound BDP
  value cannot be faithfully served under its declared representation/numeric
  contract. Missing bytes, unknown provenance, private-tool limitations and
  backend outage are insufficient. No condition-specific payload is added.
  Missing reconstruction remains Unretained; erasure and non-disclosure take
  precedence; temporary I/O remains ordinary service failure. Repair may make
  the original valid representation serviceable, never change that version's
  values under the same address.

A missing item is exactly one of `{ "kind": "record" }` for an unavailable
whole record, `{ "kind": "property", "pointer": "/properties/name" }`
for a missing property location (JSON Pointer in the complete Resource record),
or `{ "kind": "owned-links", "type": "https://example.test/types/cites" }`
for a missing owned-Type set. Omitting `type` in the last form identifies the
whole unavailable owned plane. A property pointer may instead locate properties
inside a historical inline Link. Do not invent nested locations when the whole
component is unavailable. No item contains missing content values. Missing
items are unique and limited to 64 per response. `complete: false` explicitly
means a bounded or not fully established inventory; an omitted location is not
thereby present. A complete inventory must contain at least one item. An empty,
incomplete inventory is permitted when the remaining locations cannot be
established; that persistent uncertainty is not automatically a temporary error.

On this History surface, removal of a cited historical version MUST leave its
address answering Gone with its substantiated reason to a history-authorized
caller: existing `resource-pruned` / `resource-erased`, or `revision-reorganized`
for positively evidenced replacement loss. Preserve sufficient positive
disposition evidence to fulfill that duty; no expiry exception was selected.
Existing pruning/erasure status and retry rules and optional `archivedAt` remain
unchanged. Ordinary non-History Read retains [Reads after deletion](#reads-after-deletion)'s
separate discretionary disclosure. Do not derive pruning from missing evidence
or expire required Gone evidence with participation knowledge.

No History refusal carries a window or `mayChangeAfterSync`; clients use the
versions operation for a retained window. `resource-erased` retains its prohibition
on condition-specific extensions. The new diagnoses' `after-state-change` advice
requires changed state or a newly constructed request, not endless polling, a
sync promise or a promised repair mechanism. Temporary service failures remain
`temporarily-unavailable` / 503 / `after-delay`.

#### Retained versions pages

`GET canonical-resource?view=versions` returns `historyVersionsPage`. `HEAD`
has the corresponding GET status and headers without a body. Permitted query
members are one each of `view=versions`, optional positive integer `limit`, and
optional nonempty opaque `cursor`; other/repeated members are `invalid-parameter`.
Use the existing advertised `limits.page` defaults and maximum; without them the
initial default is 100 items and maximum is 1000. A requested limit above the
applicable maximum follows the existing `limit-exceeded` rule. Limits bound
pages, never retention. Continuations are absolute same-subject URLs carrying
`view=versions` and `cursor`, with any applicable `limit` preserved.

The page contains `subject` (the canonical Resource URL), `population` fixed
to `all-retained`, `participation` (`tracked`, `not-tracked`, or
`undetermined`), `window`, `items`, and `next` (an absolute continuation URL
or null). Each row contains opaque `revision`, `lineage` (`current` or
`replaced`), stored `body` state (`complete` or `incomplete`), and the actual
retained `revisionProvenance` when recorded. Rows contain no properties,
owned payload, timestamp- order claim or protocol position. Metadata absence
is truthful legacy absence, not redaction of known metadata into unknown.
Authorize the subject-history surface and every whole row's revision,
attribution and context before including it; otherwise omit that row. Row
permission grants no Resource body permission.

`window` contains `newest` and `oldest` revision bounds (both null for an empty
window) and `complete`. Bounds refer to the selected enumeration snapshot, not
merely this page. `complete: true` asserts positive knowledge that the window
covers the responder's entire authorized retained population at that snapshot;
false makes no such assertion. Every bound, completeness claim, continuation
and other metadata is authorization-relative and reveals no omitted-row count.
Positive retained state establishes `tracked`. `not-tracked` requires positive
non-participation evidence; lacking such evidence is `undetermined`. The latter
two states have no rows, null bounds and no continuation. There is no permanent
participation-marker promise; required Gone and erasure evidence is unaffected.

Enumerate every version in the selected retained window, newest authority-order
first, including retained replaced versions and positively evidenced non-erased
incomplete versions. Establish a stable authority order before the snapshot,
including restore/import cases; never derive it from token spelling, claimed
time or an exposed store ordinal. Replaced and current membership is explicit,
not ancestry inferred from display order. Omit erased versions and records that
are only pruning/reorganization disposition evidence. A complete stored record
that is unrepresentable remains a complete retained member: stored completeness
does not promise successful serviceability. Listing any version promises neither
future body availability nor permission to read its body. Authorized deleted-
subject enumeration remains available without reviving the subject.

Pagination continues one stable enumeration snapshot under the existing profile,
authorization and erasure fences. A continuation must make meaningful progress;
it cannot silently select a newer snapshot. There is no minimum cursor lifetime.
Actual expiry uses `cursor-expired`; temporary failure serving a valid unexpired
snapshot is ordinary service failure. Neither a cursor nor enumeration holds
Resource bodies in retention.

#### Historical HTTP metadata

Historical responses remain `Cache-Control: private, no-store`. A successful
exact Resource response uses the authority's existing Resource-revision ETag
projection, including its collision-safe encoding for opaque tokens, rather
than assuming that every token can simply be quoted. No universal new validator
encoding is selected here. [Conditional reads and HEAD](#conditional-reads-and-head)
continues to apply; authorization precedes evaluation, and conditional responses
retain applicable navigation metadata. HEAD performs GET's complete decision and
returns no body; use GET to distinguish the typed diagnoses that share a status.
No diagnostic response headers or bulk-check endpoint are introduced.

On exact historical success, `BDP-History-Lineage` is `current` or `replaced`,
identifying this version's membership in the responder's recorded lineage.
The `version-history` Link relation targets that subject's `view=versions`
operation whose population is explicitly `all-retained`. Preserve authorized,
known direct `predecessor-version` and `successor-version` relations within each
recorded lineage, including retained replaced records. Multiple direct targets
are permitted. `latest-version` may name the authorized current authority version.
Omit any relation for which no truthful authorized target is known. Never link
r3 directly to r4 merely because r1→r2→r3 was restored to r1 and r4 was then
minted; never call the next surviving entry a direct successor through a gap.
The relations state local knowledge, not global freshness or a notification SLA.

Relation identity disclosure is authorized independently of whole-row metadata;
a truthful authorized target may be absent from the page because its whole row
cannot be shown. Relation presence implies neither membership/count nor target
body permission. No current target is invented for a deleted or undisclosable
current Resource. The History lineage header and these Link values follow the
same authorization and HEAD/conditional metadata rules. If cross-origin BDP access
is enabled, the CORS policy MUST expose `BDP-History-Lineage` when the History
capability is advertised, in addition to the fields required under
[HTTP consistency, caching, and CORS fields](#http-consistency-caching-and-cors-fields).

#### History recovery, imports and assurance

Every History implementation enforces applicable erasure
decisions on every controlled retained copy before further serving and preserves
required erasure evidence across local recovery. This includes context, inline
owned content, indexes, caches and any other controlled retained copies. Retaining an old address never permits
serving erased content. A non-owning reference is not embedded target content;
no new retention propagation, target rewrite or wire hold follows.

Before importing a retained copy into visibility, positively establish its
origin/version identity and erasure status from authoritative evidence appropriate
to that origin, and apply known erasures. Unestablishable status requires rejection
or discard, not publication, identity laundering or permanent unmanaged quarantine.
Restored local copies obey the same cleanup duty. No new HTTP import endpoint or
extra import provenance fields are defined. Realizations must make their proof
mechanism reviewable and test it through controlled admission/recovery/read cases.

Plain History claims the responder's behavior, not erasure delivery to arbitrary
downloaded copies. A deployment may document and test a specific consumer
acquisition/recovery route and claim only that scoped assurance, proving controlled-
copy cleanup before further publication. This does not exempt any obligated store
or advertise generic BDP replication. Generic pre-removal administrative reports,
preview endpoints, minimum retention promises, exact-byte witnesses, sync hints,
extra scheme mappings, erased-row enumeration, bulk checks and the alternative
surviving-citation lifecycle remain deferred. Local policy/tooling is allowed;
none weakens required Gone evidence, erasure or incident-Link refusal.

### Problem details

Except for the `405` method rejections and unexpected internal `500`
responses defined below, every unsuccessful BDP response uses RFC 9457
Problem Details. BDP defines a small set of stable problem-type families. The
required `code` member identifies the exact normative condition within its
family. Each code fixes its HTTP status and retry disposition. The Read
profile uses this closed table:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `malformed-request` | `request` | 400 | `never` |
| `invalid-parameter` | `request` | 400 | `never` |
| `unauthenticated` | `authentication` | 401 | `after-state-change` |
| `forbidden` | `authorization` | 403 | `after-state-change` |
| `resource-not-found` | `not-found` | 404 | `after-state-change` |
| `resource-pruned` | `gone` | 410 | `never` |
| `resource-erased` | `gone` | 410 | `never` |
| `foreign-view` | `conflict` | 409 | `after-state-change` |
| `cursor-expired` | `gone` | 410 | `after-state-change` |
| `request-too-large` | `size` | 413 | `never` |
| `limit-exceeded` | `size` | 413 | `never` |
| `rate-limited` | `rate-limit` | 429 | `after-delay` |
| `temporarily-unavailable` | `unavailable` | 503 | `after-delay` |
| `revision-unknown` | `not-found` | 404 | `after-state-change` |
| `revision-unretained` | `conflict` | 409 | `after-state-change` |
| `revision-reorganized` | `gone` | 410 | `after-state-change` |
| `revision-not-tracked` | `conflict` | 409 | `after-state-change` |
| `revision-unrepresentable` | `conflict` | 409 | `after-state-change` |

The five History `revision-*` Read rows have the evidence, missing-state and
authorization contracts in
[Historical diagnoses and missing state](#historical-diagnoses-and-missing-state).

Problem `type` is the BDP v0 problem-family prefix
`https://github.com/gastownhall/bdp/problems/` followed by the table's family
suffix. In addition to the RFC 9457 members, every BDP problem contains
`code` and `retry`. In the Read profile, `retry` is exactly `never`,
`after-state-change`, or `after-delay`. `after-state-change` requires the
caller to refresh state or construct a new request. `after-delay` responses
SHOULD carry `Retry-After` when the authority can state a useful delay.
`resource-pruned` and `resource-erased` are the authorization-gated
disclosure conditions defined under
[Reads after deletion](#reads-after-deletion): they are served only to
callers authorized for the subject's retained history, and a
`resource-pruned` problem MAY carry the `archivedAt` Reference defined
there. Unauthorized callers receive the uniform `404`
`resource-not-found` for the same address.

A direct problem uses its code's HTTP status. Its RFC 9457 `status` member is
optional, but when present it MUST match the HTTP status. RFC 9457 extension
members are allowed. The Read family model, required fields, status mapping, and retry table are
closed. An implementation advertising the `read`
profile MUST support `GET` and `HEAD` for application requests. It MUST NOT
assign application semantics to `OPTIONS`. When it enables cross-origin
access, it MUST answer `OPTIONS` according to the CORS rules below. It MUST
respond with `405 Method Not Allowed` to `OPTIONS` when cross-origin access
is not enabled and to every other method. Every such `405` MUST include
`Allow: GET, HEAD`, plus `OPTIONS` when cross-origin access is enabled, and
MUST NOT include a BDP Problem body. These are HTTP-native rejections rather
than members of the Read problem-code table.
Implementations advertising later cumulative profiles MUST retain `GET` and
`HEAD` support. Those profiles define their additional methods and `Allow`
values. In every profile, an otherwise valid request whose `Accept` field
accepts none of the endpoint's successful response media types MUST receive
a bodyless `406 Not Acceptable`, with no BDP problem code, family, or retry
member. Existing authentication, authorization/non-disclosure, and other ordinary
failures retain their handling; negotiation MUST NOT expose a hidden target
or recursively renegotiate an error representation. Missing `Accept` permits
the endpoint's default. Ordinary HTTP media-range matching, specificity, and
quality weights apply, including `q=0` exclusions; an endpoint selects an acceptable supported
representation when one exists.
An implementation MUST respond to an unexpected
internal server fault with a body-less `500 Internal Server Error`, MUST NOT
include a BDP Problem body, and MUST keep internal fault details off the
wire. A future revision may assign a BDP Problem mapping for those faults.
This draft deliberately does not.

### HTTP consistency, caching, and CORS fields

Individual Resource responses use HTTP `ETag` for the opaque Resource
revision. Pagination continuations preserve their own stable result.

Scope-bounded representations that depend on authorization use
`Cache-Control: private, no-store`. If an implementation enables
cross-origin BDP access, its CORS policy MUST allow every BDP-defined
non-safelisted request field used by its advertised profile. It MUST also allow the applicable HTTP conditional
request fields: `If-Match`, `If-None-Match`, `If-Modified-Since`, and
`If-Unmodified-Since`. It MUST expose `Link`, `ETag`, `Retry-After`,
and `Cache-Control` when applicable. History response-field exposure is defined
under [Historical HTTP metadata](#historical-http-metadata). Ordinary CORS
rules still govern `Accept` and `Content-Type` values. Type Descriptors hosted outside a Scope keep ordinary HTTP caching
semantics.

### Conditional reads and HEAD

No conditional response permits retaining or reusing content that the erasure
rules require removing.

GET and HEAD preconditions follow [RFC 9110 section 13.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2).
Normal authentication, authorization/non-disclosure, query and cursor checks,
and applicable History erasure/expiry checks MUST precede any conditional not-modified shortcut. An ordinary refusal is not
replaced by `304`. A successful read whose HTTP condition selects
`304 Not Modified`, or a read whose precondition fails with
`412 Precondition Failed`, MUST be bodyless and MUST NOT carry a BDP Problem
body. Applicable cache fields remain required on these responses.

Omitting optional validators does not permit ignoring HTTP preconditions.
For an otherwise successful existing representation without an entity tag,
`If-None-Match: *` yields `304`, a specific `If-Match` entity tag fails with
`412`, and `If-Match: *` passes. A specific `If-None-Match` entity tag cannot
match an absent entity tag. Combined conditions retain HTTP precedence:
`If-Match` is evaluated before `If-None-Match`; date conditions obey their
HTTP availability, validity, and precedence rules. Omission of a
`Last-Modified` field does not itself establish whether a modification date
is available. No new modification-date or validator construction scheme is
assigned here.

HEAD retains the corresponding GET authorization, query, cursor, media
negotiation, and precondition decision and MUST send no response body. This includes canonical Resource, collection, view and pagination URLs. Ordinary HTTP
HEAD metadata rules, including permitted omissions, apply; BDP's explicitly
required context/cache fields remain required. This clarifies the existing
cumulative GET/HEAD requirement, not a new method policy.

### Read conformance

Read acceptance covers discovery, canonical records and References, Types,
properties and incident-Link views, selection, pagination, HTTP behavior,
limits and non-disclosure. Optional History obligations apply only when that
complete capability is advertised. The shared conformance index records
case identifiers and evidence requirements; profile tags select only Read
obligations for a Read implementation.
