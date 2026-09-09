---
status: draft
intended-status: normative
version: 0
---

# Bead Protocol (BDP)

This document is the draft specification for Bead Protocol version 0
(BDP v0). The complete specification is intended to become normative after
review and after validation against real implementations.

## Status and conformance

The entire document is a single draft with one status. Its Bead Data Model,
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

This draft is co-designed against other beads-related tools, infrastructure,
and stores, both public and in-flight pre-release. At the baseline reviewed
for this draft, the primary pre-release implementation intentionally provides
a `bd`-compatible Issue/Dependency model and a command-oriented API. Its data and storage schemas are deliberately
malleable — they are expected to change. They describe current implementation
state and migration work, not a candidate BDP contract.

The primary design evidence BDP takes from that implementation is its process
and cache model: workspace authority, transaction boundaries, revisions and
watermarks, snapshot bootstrap, ordered change propagation, local
materialization, cache catch-up, and concurrency behavior. Its existing
Issue/Dependency, command, and wire surfaces are inputs to the Issue
domain profile or to compatibility work. They are not selected generic BDP behavior.

Implementation work there is expected to expose protocol pressure and to
provide conformance evidence. But neither its storage schemas nor its
incidental implementation-language choices define BDP. The current `bd`
implementation, and the compatibility code that mirrors it, supply
requirements and failure evidence. They are not design authorities for the
BDP data model or protocol.

Examples are illustrative, and they must remain consistent with the
requirements they demonstrate. Some text is explicitly identified as an open
question, deferred feature, storage design, or implementation history. That
text is not part of the intended BDP v0 contract unless and until the draft
resolves it.

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
nothing can be fetched at those addresses. The normative schema artifact will
be housed in this open source repository at `schemas/bdp-v0.schema.json`.
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

In this specification, an **authority** is the logical owner of a Scope
history — the single writer that orders its mutations. A **service** is an
HTTP deployment that exposes one or more Scopes. BDP defines three cumulative
profiles per Scope. A service may host Scopes at different profiles, but one
Scope has one advertised profile at a time. Claiming a higher profile claims
every lower profile:

| Profile | What it adds | What its implementer may ignore |
| --- | --- | --- |
| **Read** | Scope discovery and safe retrieval of canonical Bead and Link Resource records | All mutation sections and every Transactional/Replication sidebar |
| **Read+Update** | Read plus the six single-Resource targets, the two alias targets, and an ordered, non-atomic `sequence` carrier (amended 2026-09-08) | Set mutation, atomic `batch`, Scope history, receipts, snapshots, Events, and changefeed replication |
| **Transactional** | The complete transaction and replication contract | Nothing |

The **Transactional** profile includes BDP's replication machinery.
Throughout this document, material exclusive to that profile is set off as a
sidebar:

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip the marked section or
> construct. It imposes no requirement on those lower profiles.

The absence of such a sidebar does not silently settle an obligation that
this draft still lists as open. Lower-profile behavior is determined by the
profile definitions below and by explicit profile notes. Sidebars identify
material that is safely ignorable.

The Read profile exposes no BDP mutation target. It also does not inherit
transaction, receipt, snapshot, changefeed, or replication obligations merely
because those facilities exist in a higher profile.

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

The Read+Update profile retains the existing `create-bead`,
`update-bead-properties`, `delete-bead`, `create-link`,
`update-link-properties`, and `delete-link` operation URLs and request-record
shapes, and adds the two alias targets, `put-alias` and `delete-alias`,
defined under [Alias targets](#alias-targets) (amended 2026-09-08). It does
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

## Bead Data Model

This section defines Bead state and the complete set of Transactional-profile
operations that may change it. It is independent of storage, URLs, HTTP
methods, and wire payloads. The Read profile exercises only the state model
here. The Read+Update profile selects the single-Resource operation records
and executes them singly or through its non-atomic sequence carrier. It does
so without inheriting transaction, history, receipt, Event, or replication
guarantees. Later sections project these profiles into JSON and HTTP.

The sections of this model are grouped by how much of the protocol a reader
needs. The first group — Beads and Links through Authorization views —
applies to **every** profile, including Read. The second group — Property
changes through Validation and results — describes mutation and applies to
the Read+Update and Transactional profiles. The final group — Scope history
through Snapshots and strict reads — applies only to the Transactional
profile, and each of its sections says so in a banner.

### Beads and Links

A **Bead** is the unit of shared state in this model: one identified,
typed thing — a task, a bug, a decision, a memory — whose content is a
single JSON `properties` document and, when its Type owns outgoing Link
Types, the owned Links made from it. Beads are what people and agents read,
create, and update, and every change to a Bead's properties produces a new
named version of it.

A **Link** is a first-class directed relationship — one Issue depends on
another, a memory cites a source, a task is assigned to a person. At least
one of its two endpoints is a Bead in the Link's own Scope; the other may
instead reference something outside it. Links are not
authored inside either endpoint: a Link has its own identity, its own
type, and its own `properties`, and creating or deleting one never changes
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
  attribution?  // carried per version; data, not evidence
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
  attribution?  // carried per version; data, not evidence
}
```

For a Bead, `id` and `type` are immutable. For a Link, `id`, `type`,
`source`, and `target` are immutable. `properties` may be updated, and a
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
endpoint**. An in-Scope endpoint reference may use a durable local Bead ID,
the Bead's absolute canonical URL, or a transaction-local Bead reference
introduced by an earlier creation operation. It MUST identify a live Bead in
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
Link whose Link Type the source's Bead Type declares in `ownsOutgoing`,
and a Scope's Links are the only edges there are. Owned Links appear on
the links collection and in incident-Link views exactly like every other
Link. The `ownedLinks` member defined below inlines those same Links: it
is derived data, never writable directly and never a rival edge set —
create, delete, or update the owned Links, and the member follows.

A Bead whose Type owns outgoing Link Types carries an **ownedLinks**
member in its record: one entry per declared owned Link Type, keyed by
the Link Type URL, whose value is the array of the owned Links' complete
records — for each owned Link, exactly the record it serves at its own
URL, its `type` equal to the entry's key and its `source` equal to the
containing Bead — in ascending code-unit order of the Links' canonical
`id`s. An entry is present, possibly empty, for every declared owned
type; the member is absent for Beads whose Type owns nothing. The record
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
visible source's owned Links.

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
Type Descriptor it successfully resolves. Before an authority uses a Type to
validate a mutation, it MUST retain a pinned local copy of the descriptor
and its complete contract closure. That closure consists of transitive
`conformsTo` descriptors, endpoint Type requirements, properties schemas,
and every transitively referenced schema resource. It MUST validate that
installed copy without network access from the admitted request.
Installation occurs through an administrative mechanism outside BDP v0, and
it completes before request admission. A generic BDP mutation never triggers
descriptor installation or network I/O.

The pinned contract closure is immutable for that Type ID. An authority
never refreshes it automatically, and it never substitutes different
contract-bearing content at the same ID. It retains the exact installed
artifacts and an internal integrity fingerprint. BDP v0 does not require a
standardized public contract digest. A later fetch that differs may update
separable human documentation, but it cannot replace the pinned validation
contract. If the authority cannot install a complete valid closure, the Type
remains unavailable for mutation validation. The authority retains the
artifacts while any live or retained historical representation refers to
them. It retains at least the Type ID and fingerprint for the lifetime of
the logical Scope.

BDP publishes no universal root Bead or Link Type IDs. The descriptor's
`describes` member distinguishes the Resource category, and `conformsTo`
contains only domain-defined Type relationships. Category collection and
selection use the distinct Bead and Link roots rather than a synthetic root
Type.

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
Authorities MUST produce serializable outcomes when concurrent mutations
could cross a maximum.

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
policies. The administrative mechanism remains outside BDP. A policy
replacement is atomic and serialized relative to mutations. Tightening is
rejected when the live graph already violates the proposed maximum. A
Transactional mutation observes either the complete old policy set or the
complete new one. Each Read+Update singleton or sequence member observes the
policy current at that member's execution point. A replacement changes the
discovery representation and its `ETag`, but it does not invalidate active
reads or change a Type Descriptor.

Minimum multiplicity, tuple uniqueness, acyclicity, and other aggregate
graph policies are deferred.

### Scopes and identity

A **BDP Scope** contains Beads and Links. It is the boundary within which BDP
interprets local identifiers, evaluates selections, and commits atomic
mutations. Every Bead and Link belongs to exactly one Scope, and every
mutation applies to exactly one Scope. URI path hierarchy does not create
nested Scopes. A Scope exists only when it is identified by its own root BDP
description, and the URI spaces owned by different Scopes do not overlap.

A local Bead ID begins with the fixed `beads/` segment, and a local Link ID
begins with the fixed `links/` segment. Each then contains one or more safe
URI-path segments that form opaque identity within its Scope. Protocol
resolution against the canonical Scope URL produces one absolute canonical
Resource URL. That URL is immutable. Once committed, it is never reassigned
to an unrelated Resource in the lifetime of the logical Scope, including
after deletion or a Scope-epoch change. To back that up, an implementation
preserves a compact identity tombstone, a durable allocation record, or an
equivalent non-reuse guarantee. A restore that cannot preserve that guarantee
creates a different logical Scope and therefore uses a different canonical
Scope URL.

A Resource's canonical ID is established at creation and never changes. A
creator MAY supply the local ID — one or more safe segments, so a memorable
or hierarchical name is identity from birth — or omit it, in which case the
authority allocates one. An authority-allocated local ID is a single opaque
segment, and for a Bead never one that is a live alias path under
[Aliases](#aliases) (amended 2026-09-08, council 12): hierarchy is a
creator affordance, and an authority MUST NOT encode
meaning into segments it mints. A supplied spelling that is not already
canonical — a leading or trailing separator, an empty segment, or a
noncanonical encoding — is rejected, never normalized: trimming would mint
an identity the creator did not write.

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

A reference written using an alias is resolved to the canonical Bead URL
when the authority admits the write; stored and served references are
always canonical, so aliases never appear in Resource data. Which mutation
members admit an alias spelling, and when the authority resolves it, is
defined under [Alias targets](#alias-targets). Alias creation,
repointing, and deletion are mutation surface: the Read+Update profile
defines the two alias targets, `put-alias` and `delete-alias`, under
[Alias targets](#alias-targets), and the Transactional profile inherits
them (amended 2026-09-08). A put creates the alias or repoints an existing
one to exactly one canonical in-Scope Bead URL; a delete removes it, and
the path is reusable afterwards. Alias paths and canonical Bead segments
share one uniqueness namespace in the Scope. They share it because the
realizations the alias root fronts share one — in the beads realization,
keys and aliases occupy one project-wide namespace — so the invariant is
imported from the store rather than required by resolution, which
spelling alone decides.
Putting or deleting an alias
mints no version of any Bead: an alias is a locator, not part of the
target's durable state, and it is not a member of the Bead record or of
its `properties`. Serving alias resolution is Read surface, advertised
through the `aliases` discovery member.

Beads and Links are both **Resources**: each has identity, a representation,
and uniform operations. Authorization is separate from identity and typing.
So possessing a Resource or Type identifier does not grant permission to
read, mutate, or traverse it.

### Revisions

Every successful create — and every update that changes `properties` or,
for a Bead whose Type owns outgoing Link Types, its owned Links —
produces a fresh opaque Resource revision. A client compares revisions only for
equality and must not derive meaning from their spelling. If applying an
update produces a `properties` value that is equal, under the JSON
value-comparison rules of RFC 6902 Section 4.6, to the value immediately
before that operation, then the operation retains the existing revision and
emits no `updated` Event.

No-op detection is operation-local. An update followed by a later reverse
update in the same ordered transaction is two state transitions. Each
transition receives its own revision and Event, and both become visible
atomically in one change group after commit.

An explicit update or deletion may supply `expectedRevision`: the revision
observed by an earlier read or mutation result. The authority applies the
operation only if the Resource still has that revision. A mismatch fails the
complete Mutation Transaction. Omitting `expectedRevision` applies the change
to the Resource's current state.

Creation already requires the allocated or supplied identity to be absent.
Update and deletion already require their target to exist. Resources created
earlier in the same transaction need no revision guard, because no external
mutation can intervene before commit.

The protocol projection may represent revisions as HTTP entity tags.

### Selection

BDP selection operates over exactly one collection in one Scope:

```text
Beads
Links
```

The candidate values are conceptually:

```text
{ id, type, properties }
```

and:

```text
{ id, type, source, target, properties }
```

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

The same Selector semantics drive retrieval and set mutation:

```text
Select(
  scope,
  collection,
  selector
) -> Resources
```

Pagination and ordering are protocol concerns. They do not change which
Resources satisfy a Selector.

### Actor attribution

BDP v0 does not expose an authority-attested actor in Resources, mutation
results, receipts, Events, or change groups. The authenticated principal is
an input to authorization, not protocol data. An implementation may retain
private audit records, and a domain Type may define ordinary actor-related
properties. But neither is a generic BDP attribution guarantee — and
neither is the carried `attribution` member defined next.
Standardizing principal identity, delegation, impersonation, privacy, and
attestation is deferred. Scope epoch, Authorization View, and position
fields are projection and ordering fences. None of them identifies or
attests the principal.

### Carried attribution

Every Bead and Link record MAY carry an **`attribution`** member: a
common, generic member in a common place, so that no Type has to declare
attribution as a domain property. It is **data, not evidence**: the
protocol transports it and attests nothing, and a generic client MUST NOT
treat any value of it as an authority claim about who acted. A future
authority-attested form, if one arrives, is a distinct member with a
distinct name; `attribution` never becomes it.

```text
Attribution {
  principal   // nonempty opaque string naming who the version is attributed to
  status      // "claimed" | "unknown"
}
```

`status` records the realization's basis for the value, not a BDP
guarantee, and v0 defines exactly two: `claimed` — the principal was
supplied by the writer of that version, as written; `unknown` — the
principal is carried from data whose relationship to this version the
realization cannot establish (an imported record; a creator recorded
where the writer of the current version was not). There is deliberately
no status that asserts authentication: a value meaning "the authority
verified this principal" would be an authority claim, which this member
never carries — that vocabulary belongs to the future attested member.
Attribution is **per version**: it is supplied with a write (the
`attribution` input on every version-minting operation — creating,
updating, set mutation, and an owned-Link deletion that mints the source's
fresh version), immutable for the version it accompanies, and a later
version may carry different attribution. An operation that mints more than
one version records its one attribution on every version it mints:
creating or updating an owned
Link versions both the Link and its source, and both carry it; deleting an
owned Link mints no Link version (deletion never does) and versions only
the source, which carries it. It is outside `properties`, never part of
the `properties` view, and takes no part in the semantic no-op
comparison: a write whose `properties` are a no-op mints no revision and
records no attribution. The member is absent when no attribution was
recorded. Principal identifiers SHOULD be namespaced opaque strings — for
example `agent:…`, `human:…`, `svc:…` — so agents, humans, and service
accounts coexist without a global identity system; BDP mandates no
namespace and compares principals only for byte equality.

### Authorization views

For every request, the authority binds the authenticated principal, or an
anonymous principal, to exactly one opaque **Authorization View** of the
Scope. The client cannot name, widen, or combine views through request data.
Different principals may share a view only when the authority considers
their read projections equivalent. The canonical Scope, Bead, and Link URLs
remain identity, and they do not vary by view.

An Authorization View is a closed projection of the Scope. Every read,
Selector, incident Link view, snapshot, changefeed, Event Source, and
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

Each view has an opaque, equality-only **Authorization View token**. The
token remains stable across restarts and failover that preserve the same
projection. It changes whenever a grant, revocation, policy replacement, or
other authority change may alter that projection. Snapshot handles, read and
Event cursors, changefeed checkpoints, minimum-read barriers, and cached
representations are bound to both the Scope epoch and the Authorization View
token. A token change requires a fresh snapshot. BDP v0 does not require
incremental authorization-policy Events. The token is not a credential, and
possessing or replaying it does not grant access to that view.

Mutation authorization is operation-local and atomic. When each operation is
reached, its policy observes the authenticated principal, the staged
pre-state, and the proposed post-state. A set Selector ranges only over
Resources visible in the request's Authorization View. If any selected
Resource is not writable, the complete transaction fails. The authority
never silently filters an unwritable subset. Authorization View changes do
not create a new idempotency namespace: the principal-bound disposition
remains durable and cannot execute again. Detailed receipt results are
re-authorized when they are later read, and a retained Read+Update
disposition is re-authorized for disclosure when it is replayed, under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions).

### Property changes

A **Property Change** is an ordered
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to
one JSON `properties` object. BDP v0 admits only `add`, `replace`, and
`remove`. Paths are JSON Pointers relative to `properties`. Operations
execute in order, with RFC 6902 object and array semantics. `replace` and
`remove` require their targets to exist. `move`, `copy`, and `test` are not
part of BDP v0.

Assigning JSON `null` and removing a member are distinct operations. The
patch must yield a JSON object, and the authority validates that complete
result — not merely the changed members — against every effective Type
contract. Advertised limits bound the patch operation count, the path size
and depth, and the resulting representation size.
### Batch-local Resource references

> **Profile distinction.**
>
> Read has no local references. Read+Update supports bindings only between
> separately committed members of one `sequence`, with no isolation from
> interleaving work. Transactional supports the staged references below inside
> one atomic `batch`.

A creation operation may declare an optional transaction-local label:

```text
newTask: CreateBead(...)
```

A later operation may then refer to the created Resource by prefixing the
label with `@`:

```text
CreateLink(
  type: "assigned-to",
  source: @newTask,
  target: "person-42",
  properties: {}
)
```

A local name:

- is unique within its containing sequence or Mutation Transaction;
- may name only a preceding Resource-creation operation;
- denotes the created Resource's identity;
- is not a variable or an operation-result object;
- supports no property access or arbitrary expression evaluation; and
- is not persisted as part of the Resource.

In a Read+Update sequence, the creation commits before the binding becomes
available, and later members use the durable identity; on a retry, the
creation's retained or expired disposition supplies that same identity. In
a Transactional batch, the binding denotes staged identity before commit. Both use the same
`@name` spelling and the same kind checks; only Transactional supplies
isolation and rollback.

Resource references are kind-checked. That means a Link reference cannot be
used where a Bead reference is required. Only Resource identity is bindable;
revisions, properties, timestamps, query results, and other operation-result
data are not.

A durable relative reference is resolved against the canonical Scope URL and
normalized to an absolute canonical URL before use. It must remain beneath
the fixed `beads/` or `links/` root required by the reference's Resource
kind. An endpoint reference that is relative therefore always denotes an in-Scope
endpoint and must identify a live Bead. An endpoint reference that is an
absolute URI outside the canonical Scope is handled as opaque.

Any Reference may be written as a Pinned Reference `{ uri, revision }`,
recording the revision of the target the Reference was made against. On the
wire `revision` is a nonempty JSON string, and that structural rule is the
only validation an authority applies in BDP v0. The pin is provenance, not
a constraint: an authority stores and echoes it byte-identically, compares
it only for equality, and performs no semantic validation, dereferencing,
or interpretation — for an external target because its namespace is not
ours, and for an in-Scope target because validating a past revision
requires historical resolution, which arrives separately. The pin is
unrelated to the containing Link's own `revision` and to
`expectedRevision` guards. It does not participate in Link identity or
Reference comparison.

Creating or deleting a Link does not mutate an in-Scope endpoint Bead or
change that Bead's Resource revision — with one declared exception: when
the Link's type is owned by the source Bead's declared Type, the source's
revision changes. The target's never does. Putting or deleting an alias
mutates no Bead and changes no revision: an alias is a locator outside
every Resource's durable state, under [Aliases](#aliases).

### Explicit Bead operations

```text
[label:] CreateBead(
  id?,
  type,
  properties = {},
  attribution?
) -> BeadState
```

If `id` is omitted, the authority allocates one. If `id` is supplied, its
canonical Resource URL must never previously have been committed for any
Resource in the logical Scope. Deletion does not make it available again.

```text
UpdateBeadProperties(
  bead,
  change,
  expectedRevision?,
  attribution?
) -> BeadState
```

```text
DeleteBead(
  bead,
  expectedRevision?
) -> DeletionResult
```

`bead` may be a durable Bead ID or a transaction-local Bead reference.
Deleting a Bead removes it from the live data model; the implementation is
not required to physically erase it. `DeleteBead` fails if any live Link is
incident upon (attached to) the Bead when the operation is reached. A client
that wants cascade behavior must explicitly delete the incident Links earlier
in the same Mutation Transaction.

### Explicit Link operations

```text
[label:] CreateLink(
  id?,
  type,
  source,
  target,
  properties = {},
  attribution?
) -> LinkState
```

If `id` is omitted, the authority allocates one. If `id` is supplied, its
canonical Resource URL must never previously have been committed in the
logical Scope. `source` and `target` may refer to Beads created earlier
in the same Mutation Transaction. Each is a Reference and either may be
pinned; whether an endpoint is in-Scope or out-of-Scope derives from its
`uri` alone.

```text
UpdateLinkProperties(
  link,
  change,
  expectedRevision?,
  attribution?
) -> LinkState
```

```text
DeleteLink(
  link,
  expectedRevision?,
  attribution?   // recorded on the owning source's fresh version, if any
) -> DeletionResult
```

`link` may be a durable Link ID or a transaction-local Link reference.

### Explicit alias operations

```text
PutAlias(
  alias,
  target
) -> AliasBinding
```

```text
DeleteAlias(
  alias
) -> AliasDeletionResult
```

`alias` is an alias path beneath the `alias/` root under
[Aliases](#aliases); `target` is a canonical in-Scope Bead reference or,
in a sequence or a Mutation Transaction, a local reference bound by an
earlier Bead creation. Alias operations are protocol-level operations on
the Scope's alias table rather than Resource operations: they mint no
version and stage no Resource state. When one is reached it follows the
check order under [Validation and results](#validation-and-results),
identifier uniqueness first, so a put whose path is taken and whose
target is unknown answers the uniqueness fault. The Read+Update profile
defines their wire form under [Alias targets](#alias-targets); the
Transactional profile inherits them, and whether `batch` admits them is
defined with that profile.

### Validation and results

> **Transactional/Replication constructs within this section.**
>
> Cross-operation staged validation, serializable aggregate-invariant outcomes,
> complete-transaction rollback, and ordered transaction results apply only to
> the Transactional profile. Read+Update validates each singleton or sequence
> member independently and returns its inline postimage, deleted identity,
> alias result, or problem. A mutation of an owned Link is a mutation of two Resources: the
> inline postimage (or deleted identity) remains the Link's, and the same
> response member additionally reports the source Bead's resulting
> `revision` — its full postimage is available at its own URL. The envelope
> member carrying that secondary revision is `sourceRevision`, defined under
> [Mutation results](#mutation-results).

When each operation is reached, the authority validates its resulting staged
state before evaluating the next operation. It checks:

- identifier uniqueness;
- reference resolution and Resource kind;
- liveness, exact declared-Type match, kind, and effective-Type constraints for
  in-Scope Link endpoints;
- Link-Type external-endpoint policy, syntactic validity, and opaque
  handling of out-of-Scope endpoint URIs;
- immutable-member rules;
- Type and properties-schema constraints;
- applicable Scope aggregate constraints;
- authorization;
- expected revisions and cardinality;
- absence of live incident Links when deleting a Bead; and
- advertised service limits.

At commit, the authority also ensures that concurrent transactions cannot
jointly violate those invariants. An implementation may use a Scope writer,
serializable transactions, predicate or advisory locks, constraint rows, or
an equivalent retry protocol. BDP specifies the observable serializable
result rather than the mechanism.

Any failure rolls back the complete Mutation Transaction. Domain-specific
transitions such as `claim-ready` are not generic BDP operations.

Creation and update results include the durable Resource ID, the canonical
Resource URL, the opaque revision, and the complete resulting state. Deletion
results include the deleted Resource identity and transaction metadata. The
transaction result maps every local label to its allocated durable Resource
identity.

### Scope history

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip Scope epochs, commit
> positions, change groups, and the history-ordering rules in this section.

BDP v0 assigns one logical mutation authority to a Scope history at a time.
High-availability implementations may have multiple processes or storage
replicas, but only when they present one serialized history under that
authority. In this specification, replication means consuming an authority's
snapshot and changefeed into a cache or materialized replica. It does not
mean independently writable replicas, offline divergent histories, or
multi-authority merge.

Each Scope history has an opaque, unguessable **Scope epoch**. The epoch
remains stable across ordinary restart and failover that preserve identical
committed history. It changes whenever restore, destructive
reinitialization, or authority replacement may discard, rewrite, or replace
history. The epoch fences revisions, positions, snapshots, cursors, and
receipts, but it is not part of canonical Scope or Resource identity.
Restoring the same logical Scope therefore preserves its canonical Scope and
Resource URLs while rejecting every history-dependent token from the prior
epoch.

Within one epoch, every effectful committed Mutation Transaction occupies
one opaque **Scope position** in one total order that the authority defines,
except the locator-only alias mutations defined under
[Transactional alias mutations](#transactional-alias-mutations), which
occupy no position (ruled 2026-09-08, T49).
A position is unique within its epoch, and clients compare it only for
equality. Clients must not perform arithmetic or lexical ordering on its
spelling. Each epoch has a distinguished genesis position. Every later
change group identifies both its own position and its immediately preceding
position.

A read or snapshot observes one prefix of this order. A Resource revision
names one state of one Bead or Link, while a Scope position names one
committed transaction. The two kinds of token are independent, even when an
implementation derives them from related internal counters.

### Mutation Transactions

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip the transaction model,
> cross-operation staging, serializable commit order, and transaction-level
> idempotency rules in this section.

Every mutation executes as part of a **Mutation Transaction**:

```text
MutationTransaction(
  scope,
  idempotencyKey,
  operations
)
```

A Mutation Transaction:

- contains one or more operations;
- applies to exactly one BDP Scope;
- executes atomically, so every operation commits or none do;
- evaluates operations in declaration order;
- makes earlier changes visible to later operations;
- requires every operation to leave the staged state valid before the next
  operation begins;
- emits no observable events until commit; and
- returns operation results in declaration order.

A single mutation is simply a one-operation Mutation Transaction. BDP does
not define nested transactions. It also does not define interactive `begin`,
`commit`, and `rollback` operations.

The authority serializes committed transactions into the Scope order. It must
produce serializable outcomes for in-Scope endpoint liveness, Scope aggregate
constraints, deletion safety, Type contracts, and every other Scope
invariant. That requirement does not prescribe a particular storage isolation
level.

An admitted mutation's `idempotencyKey` identifies its complete semantic
request. That identity is scoped to the canonical Scope URL, the Scope epoch,
and the authenticated principal. Before comparing requests, the authority
normalizes local references, expands protocol defaults, preserves operation
and array order, ignores JSON object member order, and excludes delivery-only
metadata. It may store that normalized request or an internal versioned
fingerprint; BDP does not require a public request-hash algorithm.

Concurrent requests with the same key and the same semantic request join one
execution. A duplicate may wait for the terminal response or receive the same
pending receipt. Either way, it never executes again. Reusing the key for a
different semantic request is an idempotency conflict. Once a mutation is
admitted, client disconnection does not decide the outcome. The authority
commits or rolls back, and it records one terminal receipt. Retrying returns
that same outcome, including authority-allocated IDs.

An idempotency key is the token defined under
[Idempotency keys](#idempotency-keys): the `Idempotency-Key` HTTP field of
a batch or singleton request and the `idempotencyKey` member of a sequence
member carry the same case-sensitive `[A-Za-z0-9_-]{1,256}` token, bare,
compared byte-exactly; a request whose key is absent, repeated, or outside
the grammar is malformed. On a Transactional Scope the key's namespace is
the canonical Scope URL, the Scope epoch, and the authenticated principal —
the Read+Update namespace with the epoch it lacks — and every mutation
carrier feeds that one namespace: a singleton request, a `batch`, and each
member of a `sequence` is a Mutation Transaction with its own durable
Mutation Receipt, and the carrier is delivery metadata that the semantic
comparison excludes.

The semantic identity of a Mutation Transaction is the sequence, in
declaration order, of its operations' semantic identities under
[Idempotency keys](#idempotency-keys): each is the operation kind plus its
normalized record — durable references canonicalized, protocol defaults
expanded, array order preserved, member order ignored, `name` and the
carrier excluded, `expectedRevision` and `attribution` included, opaque
URIs and pins compared byte-exactly, and the records compared under RFC
6902 Section 4.6. In a batch, a `@label` reference is normalized to the
creating operation's zero-based index when that operation supplies no
`id`, and to the supplied identity's canonical URL when it does — never to
the label's spelling, so renaming a label is not a semantic change, and
never to an allocated identity, which does not exist before commit. In a
sequence, a `@name` reference is normalized to the identity its creating
member bound, as in Read+Update. A one-operation batch, the equivalent
singleton request, and the equivalent sequence member therefore present
one semantic request, and any of them retrieves the receipt the others
created.

Concurrent identical requests join one execution and receive the same
receipt identity, pending or terminal. Read+Update refuses a concurrent
duplicate with `idempotency-in-progress` because it has no durable receipt
to hand the duplicate; the Transactional profile joins the duplicate to
the one execution and hands it the pending receipt, which is the same
exactly-once promise made with the profile's own vehicle. A later identical
request returns the retained receipt — with its detail available, expired,
or withheld — and never executes again. A request with the same key and a
different normalized request is refused before admission with `409`
`idempotency-conflict` for as long as the key is bound: for the rest of
the Scope epoch when the earlier transaction completed, whether or not its
detail has expired, and for as long as its failed receipt is retained
otherwise. A new epoch is a new namespace: a key first used under a prior
epoch is unbound, and a retry under the new epoch executes as a new
mutation, which a client that observes a changed `scopeEpoch` MUST treat
as a first execution rather than a replay. Authorization View changes do
not create a new namespace.

Admission is one durable step. The authority records the key, the
normalized request identity, the `pending` Mutation Receipt with its
`transaction` identity, and its own exclusive ownership of the execution
together or not at all, so that a crash leaves a key either unknown with
nothing committed or bound to a receipt. Exactly one execution owns a
pending receipt, and ownership is what a commit checks: the Resource state,
the change group, and the terminal receipt commit atomically only while the
committing execution still owns the receipt, so an execution that lost
ownership — because the authority retracted the receipt, or because
recovery reclaimed it — cannot commit and produces no group. Identities an
execution allocates become durable only with its commit; a retry after a
retraction allocates anew, or reuses a supplied `id`. On restart or
failover, every `pending` receipt without a committed group is retracted
under the transient-abort rule of
[Batch operation target](#batch-operation-target) within
`transaction.duration` when that limit is advertised and within a finite
bound of the authority's choosing otherwise: the authority never resumes an
execution on its own initiative, the client's retry is the recovery path,
and a `pending` receipt older than the bound is a conformance failure.
Every mutation route — each singleton target, the batch target, the
sequence target, and every replica that accepts mutations — consults one
authoritative key state for the namespace; two routes MUST NOT each treat
the same key as unknown.

A `completed` receipt's compact form is retained under its key for the rest
of the Scope epoch: the disposition and the allocated identities outlive the
detail, because exactly-once protects committed effects. A `failed`
receipt — disposition and detail alike — is retained under its key for at
least `retention.receipt` after it becomes terminal when that limit is
advertised, and for a finite interval of the authority's choosing when it
is not; the authority MAY retain it longer. While it is retained, a retry
of the failed transaction returns that same failed receipt. Once the
authority forgets it, its URL answers the uniform `404` as a retracted
receipt's does, and its key is unknown: a later presentation executes as a
new mutation under the guards the request carries — a first execution,
since the failed transaction committed nothing and allocated nothing
durable. A failed receipt never enters `detail` `expired`; that state
belongs to completed receipts. Both profiles therefore keep tombstones for
committed effects only, as [Outcome retention](#outcome-retention) does. A
client that has refreshed its state constructs a new request under a new
key.

On a Transactional Scope the `sequence` target is the carrier defined under
[Read+Update sequence target](#readupdate-sequence-target), and it keeps
its envelope, its member records, its declaration order, its separate
commitment, its lack of isolation, and its `@name` rules unchanged; what
the profile changes is what a member's disposition is. Each member is a
one-operation Mutation Transaction: the sequence's admission admits every
member whose key is unknown, in declaration order, recording a pending
receipt for each — the profile's form of claiming a key — and the members
then execute in order, each committing its own state, change group, and
terminal receipt. The envelope projects each member's receipt into one
entry, and it adds no receipt member. The bundle's
`transactionalSequenceResponse` specializes the shared envelope with
`transactionalSequenceMemberProblem`: its `allocated` extension, permitted
only on `idempotency-expired`, is `sequenceAllocatedIdentity`: exactly
`{ id, type }` when the identity is disclosed or `{ withheld: true }` when
it is withheld, distinct from a receipt's indexed `allocated` array.
A completed creation's expired projection MUST carry exactly one of these
forms; a non-creation projection MUST omit `allocated` (ruled 2026-09-08, T63). `resource-erased` member problems reject
`pointer` just as direct problems do (amended 2026-09-08, council 13).
A member newly admitted by this carrier executes under its own pending
receipt and exclusive ownership; the in-flight projection below applies only
to an execution this carrier did not admit. This ownership distinction does
not resolve the dependent-identity transition left open in T62 (amended
2026-09-08, council 13). The projections are:

- a `completed` receipt with its detail available projects the receipt's
  one result entry in the shape of
  [Sequence response envelope](#sequence-response-envelope), carrying
  `operationIndex` and `operationName` for the present member; an entry
  the current view withholds projects as the `forbidden` member problem of
  [Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions),
  which is not retained; an entry whose version was erased projects as a
  `resource-erased` member problem to a caller authorized for the subject's
  retained history and as `forbidden` to every other caller;
- a `failed` receipt projects its problem as the member problem, with the
  present member's `operationIndex` and `operationName`;
- a `pending` receipt owned by another execution — at this route or
  elsewhere — projects as an `idempotency-in-progress`
  member problem, which MAY carry `retryAfter`; the sequence does not wait,
  executes nothing for the member, and retains nothing, and the pending
  receipt continues to be the key's state;
- a receipt whose detail expired projects as an `idempotency-expired`
  member problem carrying, for a `completed` creation, the extension
  member `allocated` — the disclosed `id` and `type`, or exactly
  `{ withheld: true }`, projected from the receipt under
  [Mutation Receipt responses](#mutation-receipt-responses); and
- a member whose `@name` creator's receipt is `failed` fails with
  `binding-unavailable` in its own `failed` receipt, retained as every
  failed receipt is; a member whose creator's receipt is `pending`, or
  whose creator was answered transiently in this request, fails
  transiently with `idempotency-in-progress`, consults no key state,
  executes nothing, retains nothing, and holds no key — a pending receipt
  recorded for it at admission is retracted and its key unbound, as after
  a transient abort — exactly as Read+Update releases the member's claim;
  a member whose creator's receipt has expired resolves the binding
  through the receipt's `allocated` identity.

The withheld allocation form hides response data, not the retained creation
binding. The authority resolves a dependent's `@name` internally from its
retained execution identity even when the creator projects
`allocated: { withheld: true }`. Each dependent still undergoes ordinary
current authorization independently. An unauthorized dependent returns the
ordinary `forbidden` projection and discloses no hidden identity through its
result or problem extensions. It is not skipped merely because the creator's
identity is withheld. Every retry and every carrier re-authorizes disclosure
against its serving view: a revoked view receives the withheld form; a newly
granted view may receive `{ id, type }`. Neither response changes the retained
identity or permits the creation to execute again. These disclosure rules do
not choose the unresolved-admission or duplicate-response contract still
pending under T62 (ruled 2026-09-08, T63).

The Read+Update dispositions therefore keep their meanings inside the
sequence envelope and lose their direct forms: on a Transactional Scope a
pending key is joined rather than refused, an expired key returns its
expired receipt rather than `410`, and a failed disposition is a receipt
with a URL of its own, retained for at least `retention.receipt`, rather
than an inline disposition. The conformance rows those direct forms bind
are retired for a Transactional Scope under
[Transactional conformance rows](#transactional-conformance-rows).

### Transactional alias mutations

A singleton `put-alias` or `delete-alias` on a Transactional Scope is a
one-operation Mutation Transaction. It requires `Idempotency-Key` and uses
the same principal/Scope/epoch namespace, admission, durable receipt,
concurrent-join, retention, and replay rules as other singleton mutations.
An alias receipt's available `results` contains exactly one alias result:
`operationIndex` `0`, `outcome`, `alias`, and, for a put, `target`, using
[Alias targets](#alias-targets)' existing result vocabulary. It carries no
Resource postimage, deleted Resource identity, or `operationName`. A sequence
projects this result in the existing Read+Update alias member shape, with
the present member's `operationIndex`. Existing alias authorization, conflict
and path rules apply unchanged (ruled 2026-09-08, T49).

Alias mutations occupy no Scope position, induce no Event, and appear in
no change group or snapshot. This is an explicit exception to the Scope
position rule for effectful Mutation Transactions: an alias put or delete
may change locator state while its receipt omits `effectPosition`.
`requiredPosition` remains the ordinary serving-view observation barrier;
it does not certify replication of the alias effect. A completed alias
receipt still protects that committed effect exactly once and, after detail
expiry, carries `allocated: []` because no Resource identity was created.
The alias table remains authority locator state outside Resource history.
A replica resolves an alias through the authority's redirect, not a mirrored
table; offline alias resolution is unavailable. `batch` admits no alias
operation, so atomic create-plus-alias is unavailable. Separate sequence
members retain their separate commitment and lack of isolation.

### Set mutation

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip `UpdateWhere`,
> `DeleteWhere`, set cardinality, and selection-at-serialization semantics.

```text
UpdateWhere(
  collection,
  selector,
  change,
  cardinality?,
  attribution?
) -> UpdatedResources
```

```text
DeleteWhere(
  collection,
  selector,
  cardinality?,
  attribution?
) -> DeletedResourceIdentities
```

Selection and mutation occur atomically at one serialization point. The
Selector is evaluated when its operation is reached, so it observes the
effects of preceding operations in the same Mutation Transaction. An
`attribution` supplied to a set mutation fans out exactly as the
corresponding singleton operations would record it: on every version
`UpdateWhere` mints (each selected Resource's new version, and the source
Bead's fresh version for each selected owned Link), and, for
`DeleteWhere`, on the fresh source versions of any owned Links it deletes
— deletion mints no version for the deleted Resources themselves.

An optional cardinality record constrains the number of selected Resources:

```text
cardinality: { min: 1, max: 1 }
cardinality: { max: 100 }
cardinality: { min: 1 }
```

Both bounds are inclusive nonnegative integers. Omitted cardinality bounds
add no client constraint. The authority may still enforce operational limits
whether or not it pre-advertised them. If the matched count falls outside a
supplied range, the complete transaction fails.

BDP v0 deliberately does not add an expected-member-set guard. A set mutation
means “mutate the complete set matching at this operation's serialization
point.” A client that intends to mutate specific Resources it observed
earlier uses explicit operations with `expectedRevision` instead.

A service may advertise limits on Selector size and depth, Resources examined
or matched, Resources mutated, Events induced, and transaction duration.
Exceeding a limit fails the operation without changing anything. A set
mutation must never silently mutate only one page of results.

When a desired mutation exceeds an advertised transaction or Event-expansion
limit, a client may divide it into separate transactions. Each chunk is
atomic, but the complete multi-transaction job is not: other work may
interleave, and a later chunk may fail after earlier chunks committed. BDP v0
defines no generic server-side bulk job that restores cross-chunk atomicity.
Domain or administrator bulk facilities are outside BDP. An implementation
MUST NOT relax changefeed completeness or omit Events to admit an oversized
mutation.

For example, this operation deletes every Link incident upon `task-42`:

```text
DeleteWhere(
  Links,
  $[?@.source == "https://beads.example/acme/beads/task-42" || @.target == "https://beads.example/acme/beads/task-42"]
)
```

### Mutation receipts

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip durable Mutation
> Receipts, receipt pagination, and lost-response recovery through receipts.

Every admitted mutation has one durable **Mutation Receipt**. Its synchronous
response is the receipt representation, so the normal case requires no
follow-up read. The receipt records the terminal outcome, the transaction
identity, the Authorization View in which it executed, `requiredPosition`, an
optional `effectPosition`, and ordered operation results. `requiredPosition`
is the Scope position that view must observe before relying on the outcome.
`effectPosition` is present exactly when the mutation produced a change
group.

The receipt remains independently readable, so a client can resolve a lost
response, a pending duplicate, or a paginated result. An identical retry
returns the same receipt identity and disposition. Receipt access is
principal-bound: possessing its URL does not grant access. The authority
re-authorizes detailed results on every later read, so a grant change may
redact or deny detail without changing the terminal disposition. When the
authority advertises receipt retention, it binds how long detailed outcomes
remain. After the applicable interval it may discard a completed
transaction's bulky result data, but it retains a compact tombstone — the
key, the request identity, the disposition, and the identities the
transaction allocated — for the rest of the Scope epoch. A later retry
returns an outcome-expired result and never executes the mutation as new.
A failed transaction committed nothing: its receipt is retained, whole, for
at least that interval and may then be forgotten, after which its key
executes as new, under [Mutation Transactions](#mutation-transactions)
(amended 2026-09-08, Transactional apply, T47).

A receipt may inline every result or the first bounded page. Large
set-operation results continue through immutable pages of that same receipt.
BDP does not create a second result abstraction, and it never silently
truncates affected Resources.

### Events and Event Sources

> **Transactional/Replication contract in this draft.**
>
> The complete Event ordering, transaction framing, and Event Source guarantees
> below are required only by the Transactional profile. Read and Read+Update do
> not publish or expose BDP Events.

An **Event** is an immutable authority-generated record of a committed fact.
Each Event has an immutable ID that is unique within exactly one **Event
Source**. An Event is not required to be an independently addressable
Resource, but its Event Source is a Resource.

Every Bead and Link is an Event **subject** and has an associated
Resource-scoped Event Source. The subject and the Event Source have distinct
identities, and they may have different lifetimes. An Event Source may remain
observable after its subject is deleted, subject to retention policy.

Resource-scoped Event Sources are not independently committed logs. They are
deterministic projections of the semantic Events inside the Scope's committed
change groups. Each Event has a stable ordinal within its change group. Its
source-local opaque ID and cursor are stable functions of the group
checkpoint, the ordinal, and the projection. An implementation may
materialize or index a projection without changing its contents or order.

The model defines five domain-independent Event Types:

- **created** — a Bead or Link began to exist;
- **updated** — the mutable properties of a Bead or Link changed, or an
  owned Link of a Bead changed;
- **deleted** — a Bead or Link ceased to exist;
- **linked** — a Link became incident upon a Bead; and
- **unlinked** — a Link ceased to be incident upon a Bead.

Events are the observation-side duals of singleton DML operations. A Resource
read or snapshot bootstrap conveys current state. An Event instead conveys
the committed delta — the change that advances previously observed state.
Every Event identifies its subject by immutable `id` and `type`, and it
carries the transaction in which the fact committed.

The lifecycle Event deltas are:

```text
CreatedData {
  revision: Revision
  properties: JsonObject
  attribution?: Attribution   // the created version's carried attribution
  source?: Reference
  target?: Reference
}

UpdatedData {
  previousRevision: Revision
  revision: Revision
  change?: PropertyChange        // exactly one of change and ownedLink
  ownedLink?: OwnedLinkChange
  attribution?: Attribution      // the new version's carried attribution
}

OwnedLinkChange {
  operation: created | updated | deleted
  link: LinkState                // created: the owned Link's complete record
      | OwnedLinkDelta           // updated: the owned Link's own delta
      | ResourceIdentity         // deleted: id, type, and final live revision
}

OwnedLinkDelta {
  id: URI                        // the owned Link's canonical URL
  type: TypeId
  previousRevision: Revision     // the Link's revisions, not the source's
  revision: Revision
  change: PropertyChange
  attribution?: Attribution      // the Link's new version's carried attribution
}

ResourceIdentity {
  id: URI                        // the canonical Resource URL
  type: TypeId
  revision: Revision
}

DeletedData {
  revision: Revision
}
```

An owned-Link change produces an `updated` Event on the source Bead with
its fresh revision; its delta carries `ownedLink` in place of `change`.
Exactly one of the two members is present in any `updated` delta. No single
operation changes both a Bead's `properties` and one of its owned Links, and
every owned-Link mutation mints its own source version, so a Mutation
Transaction that changes both — or that changes two owned Links of one
source — produces one `updated` Event per transition, each with its own
`previousRevision` and `revision`, in operation order.

`ownedLink.operation` names the transition, and `ownedLink.link` is the
delta of that transition, never a snapshot. For `created`, it is the owned
Link's complete record: exactly the record the Link serves at its own URL
after the transition, because creation is the delta from absence, so its
`revision` is the Link's fresh revision and its `attribution`, when present,
is the Link's own. For `updated`, it is the owned Link's delta — the Link's
`id` and `type`, its `previousRevision` and fresh `revision`, the committed
`change`, and the Link's new version's `attribution` when one was recorded —
the same delta the Link's own `updated` fact carries, so that neither fact
carries the Link's properties in full. For `deleted`, it is the deleted
Link's identity — `id`, `type`, and its final live `revision` — because
deletion mints no Link version and a deleted Event does not retain
properties. `previousRevision` and `revision` at the Event level are the
source Bead's. `attribution` at the Event level, when present, is the
source's new version's carried attribution. An operation that mints both a
Link version and a source version records its one attribution on both, so a
`created` or `updated` delta whose Link record or Link delta carries
`attribution` carries the same value at the Event level, and a delta whose
Link record or Link delta carries none carries none.

`CreatedData` and `DeletedData` carry no owned-Link data. A Bead is created
with an empty owned set for every Link Type its Type owns, and the record's
empty `ownedLinks` entries follow from the Type Descriptor rather than from
the Event: a consumer that reconstructs a record from Events alone cannot
know which empty entries the record carries without the Type Descriptor,
and the canonical record read or the snapshot, not the Event stream, is
where that key set is authoritative. A Bead with a live owned Link cannot
be deleted, so a `deleted` Bead Event never has owned Links to report.

A source Bead's owned-Link `updated` Event is in addition to, not instead
of, the facts the Link mutation already induces: the Link's own `created`,
`updated`, or `deleted` fact, and the `linked` or `unlinked` fact at each
in-Scope endpoint, including the source itself. Within a change group, the
facts induced by one owned-Link operation are ordered: the Link's lifecycle
fact first, then the graph facts at its in-Scope endpoints, source before
target — a self-Link's one endpoint Bead receiving its `source` fact before
its `target` fact — then the source's `updated` fact last. Ordinals are
assigned in that order and never renumbered by projection. A Bead-scoped
Event Source for an owning source therefore reports an owned Link's
property change twice, under two subjects: once as the incident Link's
`updated` fact and once as the source's own `updated` fact carrying the
same delta.

A no-op owned-Link property update — one whose patch yields `properties`
equal, under the RFC 6902 Section 4.6 comparison, to the value immediately
before it — retains the Link's revision and emits no Event, and it does not
version the source: there is no transition for the source's version to
cover.

A consumer that holds the source's record at `previousRevision` advances it
to `revision` by applying `ownedLink` to the entry keyed by `link.type` in
the record's `ownedLinks` member: for `created`, inserting `link` in
ascending code-unit order of `id`; for `updated`, locating the entry whose
`id` equals `link.id` and whose `revision` equals `link.previousRevision`,
applying `link.change` to its `properties`, and setting its `revision` to
`link.revision` and its `attribution` to `link.attribution`, removing that
member when the delta carries none; for `deleted`, removing the entry whose
`id` equals `link.id`; then setting the record's `revision` to the Event's
`revision` and its `attribution` to the Event's `attribution`, removing the
member when the Event carries none. A consumer whose held revision is not
`previousRevision`, or whose held entry is not at `link.previousRevision`,
is not positioned to apply the delta; it re-reads the record or resumes
from a snapshot. Replicas do not need the delta at all: the containing
change group's `changes` member carries the source Bead's complete
postimage, `ownedLinks` inline, beside the Link's own postimage or
tombstone.

`CreatedData` contains the complete initial properties, because creation is
the delta from absence to the initial state. For a Link, it also contains the
Link's source and target endpoint references. `UpdatedData` contains the
committed Property Change — or the owned-Link change — rather than a
resulting state snapshot.
`DeletedData.revision` is the Resource's final live revision. Deleted Events
do not retain the Resource's properties.

An Event uses the same `Reference` form as canonical Link state,
including a stored Pinned Reference, which propagates
byte-identically. A reference makes no claim about what an out-of-Scope URI
identifies.

The graph Event delta is:

```text
LinkDeltaData {
  endpoint: source | target
  link: TypedLinkReference
  source: Reference
  target: Reference
}
```

The typed Link reference contains only the immutable `id` and `type`.
`linked` and `unlinked` Events contain no Bead or Link properties. Carrying
the Link's own Type and both endpoint references lets a consumer understand
an unlink after the Link is no longer readable, without asserting anything
about an opaque external reference.

A Link-scoped Event Source reports `created`, `updated`, and `deleted` facts
about that Link. A Bead-scoped Event Source reports:

- `created`, `updated`, and `deleted` facts about the Bead;
- `linked` and `unlinked` facts when a Link becomes or ceases to be incident
  upon the Bead; and
- `updated` facts whose subject is an incident Link when that Link's mutable
  properties change.

Link creation produces a `created` fact about the Link and a `linked` fact at
each in-Scope endpoint Bead. Link deletion produces a `deleted` fact about
the Link and an `unlinked` fact at each in-Scope endpoint Bead. No
Bead-scoped fact or Event Source exists for an opaque out-of-Scope endpoint.
A wider Event Source may cover a collection, a graph Scope, or a complete
service.

For a self-Link, whose source and target are the same Bead, that one endpoint
Bead receives two graph facts in the same group: one whose `endpoint` is
`source` and one whose `endpoint` is `target`. Both count against the
transaction's Event-expansion limit. These derived facts and the incident
Link view do not mutate the Bead or advance its Resource revision; a
source Bead whose Type owns the Link's type is versioned by the owned
change itself, under [Owned Links](#owned-links), not by these
derived facts.

Events describe data-model facts, not protocol methods. Full replacement and
partial update therefore produce the same abstract `updated` Event when they
change a Resource's properties. A failed or rolled-back transaction produces
no observable Events.

For Event purposes, `UpdateWhere` and `DeleteWhere` expand over their
selected Resources as the corresponding singleton operations. Each affected
Resource produces exactly the Event facts that its singleton update or
deletion would produce, including incident Link facts at in-Scope endpoint
Beads, and the selected Resources expand in ascending code-unit order of
their canonical `id`s — the `canonical-uri` order of
[Collection retrieval and selection](#collection-retrieval-and-selection) —
so that the Events a set operation induces and the entries its Mutation
Receipt reports follow one order that does not depend on the authority's
selection mechanism. A zero-match operation produces no Events. All Events induced by one
Mutation Transaction carry that transaction's identity, and they become
observable together only after commit.

An authority MUST enforce a finite maximum number of Events that one Mutation
Transaction may induce and MAY advertise it through `limits`. If a set
mutation would exceed that limit, the complete transaction fails before
commit. This semantic expansion does not require an implementation to update
or delete Resources one at a time. An authority remains free to use
set-oriented storage operations so long as it emits the same committed facts.

### Change groups and replication

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip change groups,
> postimages, tombstones, projection advances, and replica reconstruction.

Every successful transaction that induces at least one Event produces exactly
one immutable authority Scope **Change Group** at one new Scope position. The
authority commits the Resource state, the group, and the Mutation Receipt
atomically. A failed or admitted no-effect mutation produces no group and no
new position. Its receipt reports the current `requiredPosition` and omits
`effectPosition`.

The group delivered to a client is the deterministic projection for its
Authorization View. It carries every state transition needed to advance that
view. If the transaction has no visible effect, the authority still emits an
identifier-free projection advance at the same position. That lets a replica
prove contiguous catch-up without learning hidden Resource or transaction
identities. This does reveal the cadence of hidden transactions. Avoiding
that side channel requires a different, separately identified per-view order
and is not part of BDP v0. An authority MUST NOT reject an otherwise valid
Scope transaction only because one view's derived transition is too large to
deliver. If it cannot represent that transition within advertised projection
limits, it rotates that view token and requires affected clients to install a
fresh snapshot.

A change group contains:

```text
ChangeGroup {
  scopeEpoch: ScopeEpoch
  authorizationView: AuthorizationViewToken
  checkpoint: Checkpoint
  position: ScopePosition
  previousPosition: ScopePosition
  projectionAdvance: Boolean
  transaction?: TransactionId
  changes: StateChange*
  erasures: ErasureRecord*
  eventCount: Integer
  events: Event*
}

ErasureRecord {
  subject: URI        // the canonical Resource URL
  revision            // the erased version's opaque revision token
  digest {
    scheme            // identifier naming the digest discipline
    value             // the digest bytes, taken before erasure
  }
}
```

For an ordinary visible group, `projectionAdvance` is false and `transaction`
is present. `changes` is the replica-oriented projection. For each Bead or
Link whose final projected state is live, it contains a complete canonical
postimage — the Resource's state after the change — and its Resource
revision. For each Resource that leaves the projection, it contains an
identity-bearing tombstone. An authorization-projection tombstone does not
assert that the underlying Resource was deleted. Multiple operations on one
Resource normalize to its final projected postimage or tombstone. Consumers
apply the complete array atomically; its internal order has no semantic
effect.

An owned-Link mutation changes the state of two Resources, so a group's
`changes` carries both: the owned Link's postimage or tombstone, and the
source Bead's postimage at its fresh revision with the owned set inline.
The two entries describe one graph: the inline record in the source's
postimage and the Link's own postimage are member-for-member equal, and a
consumer verifies that agreement before applying the group, under
[Scope snapshots](#scope-snapshots).

For an invisible group, `projectionAdvance` is true, `transaction` is absent,
and `changes`, `erasures`, and `events` are empty. No Resource, Type, Link endpoint,
actor, or transaction identifier from the hidden group crosses the
authorization boundary.

`eventCount` equals the number of entries in `events`. `events` is the
application-facing ordered fact sequence. It preserves operation order and
assigns each Event its stable authority-group ordinal. A projected Event list
may therefore contain ordinal gaps where intervening facts are hidden, but it
never renumbers visible facts. One normalized state-change entry may
correspond to several Events — for example, when ordered updates touch one
Resource more than once, or when Link lifecycle facts project to its endpoint
Beads. Event-expansion limits also bound change-group size.

BDP v0 does not require a public cryptographic group digest. The epoch, the
position, and the previous position detect replay gaps, duplicates,
reordering, and history replacement. An implementation may advertise an
integrity extension.

### Snapshots and strict reads

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip snapshot bootstrap,
> snapshot/changefeed rendezvous, minimum-position reads, and the strict
> replica-freshness contract in this section.

A first-class Scope **Snapshot** contains the complete live Bead and Link
state visible in one Authorization View at one transaction-consistent Scope
epoch and position. One immutable snapshot manifest anchors separate typed
Bead and Link page streams to the same handle, view, position, and expiry. A
small Scope may inline both complete streams. A replica stages all pages and
publishes the replacement atomically only after both streams finish.
Ordinary collection queries are not a replication bootstrap.

The snapshot checkpoint is the precise exclusive position from which Scope
changefeed replay begins. Until the snapshot's advertised expiry, the
authority retains every later projected group required to continue from that
checkpoint. A cursor presented too late, from another Scope epoch, or from
another Authorization View fails explicitly and never silently skips history.
BDP v0 assumes a global retention window rather than per-client retention
pins.

Ordinary reads are strict by default. Each read observes one
transaction-consistent prefix of its Authorization View that can be
linearized during the request, and it reports its Scope epoch, view token,
and visible position. A client may require a minimum checkpoint bound to that
same view. A replica that is behind must route, wait, or fail explicitly; it
must not return older state as if current. Weaker consistency modes, if
added, require explicit client selection.

### Deferred model features

Endpoint Type unions, minimum multiplicity, tuple-uniqueness constraints,
acyclicity, and additional aggregate graph policies are deferred beyond BDP
v0. They are not implicit authority behavior.
## BDP JSON and HTTP Protocol

This section maps the Bead Data Model onto concrete JSON values and HTTP
interactions. A Scope claims one cumulative conformance profile. Profiles are
defined under
[Conformance profiles and reading guide](#conformance-profiles-and-reading-guide).
Unless a requirement is explicitly assigned to a lower profile, the complete
protocol requirements in this section describe the Transactional profile. The
protocol uses one small, uniform surface:

- the Transactional profile can express every mutation through a Scope-level
  `batch` target;
- Read+Update and Transactional Scopes keep the same generic single-Resource
  operation targets for callers that do not need a batch;
- ordinary `GET` reads remain Resource-oriented;
- bounded selection uses that shared expression model in a collection `GET`;
  and
- snapshots and the Scope changefeed let a replica bootstrap and catch up
  losslessly, while Event Sources provide observation for applications.

Every JSON text BDP admits or emits follows the number model defined under
[Revisions](#revisions) — exact-decimal equality with binary64 round-trip
admission, ruled at gastownhall/bdp#21 and landing with gastownhall/bdp#23 —
which combines with the I-JSON string and object rules below to give every
Resource record exactly one RFC 8785 canonical serialization for
[Version erasure](#version-erasure) to digest. Every JSON text BDP admits or
emits uses Unicode scalar values in strings and object member names; an
unpaired surrogate, including one produced by an escape, is invalid, and
an object MUST NOT carry duplicate member names after escape decoding.
These string and object violations are carrier syntax rejected before
execution with `malformed-request` in every profile. Inadmissible numbers
instead follow the ruled `validation-failed` admission rule under
[Revisions](#revisions). An authority adapting an existing store MUST map
or refuse values outside this data contract before serving them as BDP
Resources (amended 2026-09-08, council 13; T44/T56). Every
instant BDP emits — an Event's `time`, a receipt's or a snapshot's
`expiresAt` — is an RFC 3339 `date-time` written with uppercase `T` and
`Z`, and the bundle's `dateTime` definition validates the calendar and the
clock, not merely the punctuation; a client accepts the lowercase forms
RFC 3339 permits.

### Scope discovery and human documentation

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

Discovery membership is profile-specific: which members appear in the
discovery document depends on the claimed profile. `bdpVersion`, `profile`,
`scope`, `beads`, `links`, and `types` are required in every profile.
`operations` is required in Read+Update and Transactional and prohibited in
Read. The history, receipt, snapshot, changefeed, and Event members are
required only in Transactional and prohibited in both lower profiles. The
optional `limits` and `maximumEndpointMultiplicity` members may appear in any
profile when their contracts apply. The `aliases` member is optional in
Read, where it appears exactly when the authority serves alias resolution,
and required in Read+Update and Transactional, which offer the alias
targets under [Alias targets](#alias-targets) and therefore serve alias
resolution (amended 2026-09-08, council 12): an authority without aliases
omits the member, and a client MUST NOT construct alias URLs for an
authority that does not advertise it. The optional
`order` member names the collection order under
[Collection retrieval and selection](#collection-retrieval-and-selection);
omission means the `canonical-uri` baseline.

| Member | Read | Read+Update | Transactional |
| --- | --- | --- | --- |
| `bdpVersion`, `profile`, `scope` | required | required | required |
| `beads`, `links`, `types` | required | required | required |
| `operations` | prohibited | required | required |
| `scopeEpoch`, `authorizationView`, `headPosition`, `minimumReplayPosition` | prohibited | prohibited | required |
| `receipts`, `snapshot`, `changes`, `events` | prohibited | prohibited | required |
| `limits`, `maximumEndpointMultiplicity` | optional | optional | optional |
| `aliases` | optional | required | required |
| `order` | optional | optional | optional |

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

A minimum Read+Update discovery representation adds its Operation
Directory and its alias root (amended 2026-09-08, council 12):

```json
{
  "bdpVersion": "0",
  "profile": "read-update",
  "scope": "https://beads.example/acme/",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/",
  "operations": "https://beads.example/acme/operations/",
  "aliases": "https://beads.example/acme/alias/"
}
```

The Transactional-profile discovery representation adds the surface for
authority history and replication:

```json
{
  "bdpVersion": "0",
  "profile": "transactional",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "opaque-scope-epoch",
  "authorizationView": "opaque-authorization-view",
  "headPosition": "opaque-position-42",
  "minimumReplayPosition": "opaque-position-17",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/",
  "operations": "https://beads.example/acme/operations/",
  "aliases": "https://beads.example/acme/alias/",
  "receipts": "https://beads.example/acme/receipts/",
  "snapshot": "https://beads.example/acme/snapshot",
  "changes": "https://beads.example/acme/changes/",
  "events": "https://beads.example/acme/events/"
}
```

`scope` is the canonical Scope identity. It is also the base for resolving
references. `bdpVersion` MUST equal `"0"` for a BDP v0 Scope. A client that
does not implement the advertised value stops rather than guessing
compatibility. `profile` is required and is exactly `"read"`,
`"read-update"`, or `"transactional"`. It advertises the Scope's highest
supported cumulative profile. It is a single value rather than an array
because each higher profile claims every lower profile.
`scopeEpoch`, `authorizationView`, `headPosition`, and
`minimumReplayPosition` describe, in order: the current incarnation of the
authority history, the read projection the server selected, the projected
head, and the oldest position still legal as an exclusive Scope-changefeed
cursor. The client cannot supply or widen `authorizationView`. Another
principal, or a changed policy, may receive a different value at the same
canonical Scope URL. Individual snapshots and receipts carry their exact
expiry. Discovery may pre-advertise applicable retention through the optional
`limits` object.

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

When the Scope's profile supports mutation, `operations` identifies an
Operation Directory rather than a collection of transactions. Its named
children depend on the claimed profile. Only the Transactional profile
includes `batch`, which executes an ordered Mutation Transaction.

Discovery-document members and Operation Directory members defined by this
specification are fixed BDP vocabulary. Scope, Resource, Type, schema,
discovery navigation, and pagination `next` members are HTTP(S) URLs. BDP
permits arbitrary absolute URIs only for opaque external endpoint
references. BDP schemas assert this distinction with JSON Schema patterns. Schema-aware tooling may additionally
use JSON Schema `format` annotations, but format behavior is not the sole
enforcement mechanism. BDP v0 does not duplicate navigation through
BDP-specific HTTP link relations. `service-desc` is the one required machine
entry relation. Optional `service-doc` and `describedby` uses keep their
registered Web meanings.

### Advertised limits

The discovery document MAY contain a `limits` object. The object is optional
so that a small implementation can expose a conforming profile without
predicting every operational bound. Omission means only that the bound is not
pre-advertised; it does not mean infinite capacity and does not permit silent
truncation, partial mutation, or a non-normative failure response.

When present, `limits` is divided into capability groups. A group is relevant
only when the advertised profile exposes that capability. Each advertised
value is a binding positive integer or ISO 8601 duration:

- `page.defaultItems` and `page.maximumItems` count Resource records;
- `request.targetBytes` counts octets in the encoded HTTP request target, and
  `request.bodyBytes` counts octets in the representation body;
- `resource.representationBytes` and `resource.propertiesBytes` count UTF-8
  bytes in the corresponding JSON serialization;
- `selector.bytes` counts UTF-8 bytes after percent-decoding, while
  `selector.depth` and `selector.nodes` count parsed Selector structure;
- `patch.operations`, `patch.pathBytes`, and `patch.pathDepth` bound one
  property patch;
- `sequence.operations` bounds members in one Read+Update sequence;
- `validation.diagnostics` counts entries in, and `validation.diagnosticBytes`
  counts UTF-8 bytes of, the serialized `diagnostics` list a
  `validation-failed` problem carries under
  [Problem details](#problem-details); the group is mutation surface: it
  is not advertised by a Read discovery document, and a Read+Update or
  Transactional authority that omits diagnostics beyond a bound MUST
  advertise it (amended 2026-09-08, council 12);
- `transaction.operations`, `transaction.examinedResources`,
  `transaction.matchedResources`, `transaction.mutatedResources`, and
  `transaction.inducedEvents` are counts, while `transaction.duration` is an
  ISO 8601 duration; and
- `retention.idempotency`, `retention.receipt`,
  `retention.maximumSnapshotLifetime`, and `retention.replay` are ISO 8601
  durations.

Fields and groups not advertised carry no implicit numeric value. A client
may use advertised values for request planning. Conformance tests may probe
them and require the server to enforce the advertised boundary consistently.
`retention.idempotency` is the minimum interval for which an authority
retains an idempotency-key disposition after its terminal outcome; the
Read+Update profile binds it under [Outcome retention](#outcome-retention).
The bundle's profile discovery definitions admit only the groups a profile
exposes: the Read discovery document's `limits` is `advertisedLimits`,
which admits no `validation` group; the Read+Update discovery document's
`limits` is `readUpdateAdvertisedLimits`, a closed definition of its own
that shares every limit primitive with `advertisedLimits`, restates the
`page`, `request`, `resource`, `selector`, `patch`, and `sequence` groups
unchanged, carries the `validation` group, and rejects the `transaction`
group and the Transactional `retention.receipt` and `retention.replay`
members, while keeping `retention.idempotency` and the pagination
`retention.maximumSnapshotLifetime`. The Transactional discovery
document's `limits` is `transactionalAdvertisedLimits`, a closed
definition of its own on the same primitives: it carries the `validation`
group as well, since a Transactional authority advertises the same bound,
admits the `transaction` group and the `retention.receipt`,
`retention.maximumSnapshotLifetime`, and `retention.replay` members, and
rejects `retention.idempotency` under the paragraph below (amended
2026-09-08, Transactional apply).

On a Transactional Scope a key's disposition is retained by its receipt — a
completed transaction's for the rest of the epoch and a failed
transaction's for at least `retention.receipt` — so `retention.idempotency`
is a Read+Update-only member: a Transactional discovery document MUST NOT
advertise it, `retention.receipt` bounds how long detailed outcomes and
failed receipts remain, and the bundle's `transactionalAdvertisedLimits`
rejects the member. `page.defaultItems` and `page.maximumItems` also count
the result entries of a Mutation Receipt and its pages, every entry
counting as one.

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

### Normative schema bundle

BDP v0 publishes one normative JSON Schema 2020-12 bundle at
`schemas/bdp-v0.schema.json`. Every discovery, request, success, Resource,
collection, sequence, snapshot, change-group, Event-page, receipt,
result-page, and problem envelope is a named entry beneath that bundle's
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

The discovery and Read definitions in the bundle are complete. Each later
profile's definitions must exist before that profile can be implemented. The
Read+Update definitions — discovery, Operation Directory, singleton
requests, alias requests, sequence request and response, mutation and
alias results, and problems — are drafted in the bundle pending the review
recorded under
[Open protocol questions](#open-protocol-questions). The Transactional
definitions — the Event surface, the batch envelope and its operation
records, the set-operation bodies, Mutation Receipts and their pages, the
Transactional problem shapes, change groups, changefeed pages, snapshot
manifests, and the Transactional discovery document and Operation
Directory — are drafted on the same terms (2026-09-08). The bundle is
finished only when it covers the complete BDP v0 surface.

The bundle validates wire shape, not admission. Checks the schema cannot
express remain the authority's, performed at admission or when the member
is reached: Scope containment of durable references, Resource kind,
`@name` resolution and its kind, ownership — whether `source` and
`sourceRevision` apply to a Link result — correspondence between a result
and its request (`operationIndex`, `operationName`, and the outcome
against the operation), the uniqueness of keys and names within one
sequence, the resolution of an alias spelling to a live alias, and, for
an alias member, whether a put's `target` is a canonical
Bead reference and whether its alias path is taken under
[Alias targets](#alias-targets). A schema-valid request may therefore still
be rejected before execution or fail its member, and schema validity is never a conformance
claim about those checks.

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
Mutation-only dispositions and problem codes are defined with their profiles
rather than in the Read table.

The Read+Update profile inherits the complete Read table unchanged and adds
the rows below. Its direct problems and its sequence-member problems draw
from that union; the family model, the required members, and the three
retry dispositions are the Read profile's:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `unsupported-media-type` | `request` | 415 | `never` |
| `binding-unavailable` | `request` | 400 | `never` |
| `validation-failed` | `validation` | 422 | `never` |
| `type-not-installed` | `validation` | 422 | `after-state-change` |
| `identity-taken` | `conflict` | 409 | `never` |
| `alias-path-taken` | `conflict` | 409 | `after-state-change` |
| `revision-mismatch` | `conflict` | 409 | `after-state-change` |
| `incident-links-exist` | `conflict` | 409 | `after-state-change` |
| `aggregate-constraint-violation` | `conflict` | 409 | `after-state-change` |
| `idempotency-conflict` | `conflict` | 409 | `never` |
| `idempotency-in-progress` | `conflict` | 409 | `after-delay` |
| `idempotency-expired` | `gone` | 410 | `never` |

The Read+Update rows mean:

- `unsupported-media-type`: a mutation-target request whose body media type
  is not `application/json` or is not declared; media-type parameters such
  as `charset` are ignored.
- `binding-unavailable`: a sequence member referenced a sequence-local
  `@name` bound to a creation whose retained disposition is a failure, under
  [Read+Update sequence target](#readupdate-sequence-target). A reference
  that is forward, unknown, or of the wrong Resource kind is carrier syntax
  rejected before execution with `malformed-request`, and a reference to a
  creating member whose disposition in the same request was transient is
  itself transient and fails with `idempotency-in-progress` instead.
- `validation-failed`: the mutation is well-formed but its result is not
  admissible — the resulting `properties` violates an effective Type
  contract or is not a JSON object, a `replace` or `remove` names a missing
  target, an in-Scope endpoint fails an effective endpoint constraint or
  describes the wrong Resource category, or an out-of-Scope endpoint violates
  the Link Type's external-endpoint policy, or the source's resulting owned
  set would exceed the owning Type's declared `max`, or an alias put's
  `target` is not a canonical Bead reference — an alias, a Link, or an
  external URI — under [Alias targets](#alias-targets). The problem MUST
  carry `diagnostics`: a nonempty, bounded array of `{ type?, schemaLocation?,
  instanceLocation?, message }` entries. When the failure is an effective
  Type contract, every entry names the failing effective Type in `type` and
  the failed keyword in `schemaLocation` — the absolute keyword location,
  the contract schema's `$id` plus a JSON Pointer fragment, as JSON Schema
  output defines it; an owned-set overflow names the owning Bead Type and
  its descriptor's `ownsOutgoing` entry — and, when the failure lies within
  `properties`, `instanceLocation`, a JSON Pointer within `properties`. For
  every other cause `type` and `schemaLocation` are absent, `message` names
  the cause, and `instanceLocation` locates it within `properties` when it
  lies there; `type` and `schemaLocation` are present together or not at
  all. `validation.diagnostics` and `validation.diagnosticBytes` bound the
  list: an authority that omits entries beyond a bound MUST advertise that
  bound, keeps at least one entry in evaluation order, and sets
  `diagnosticsTruncated` to `true`; an authority that advertises neither
  returns the complete list. No other code carries `diagnostics` or
  `diagnosticsTruncated`.
- `type-not-installed`: the declared Type's contract closure is not
  installed, under
  [Descriptor resolution and installation](#descriptor-resolution-and-installation).
- `identity-taken`: a supplied `id` whose canonical Resource URL was ever
  committed in the logical Scope, including a deleted one. Canonical Bead
  segments and alias paths share one uniqueness namespace under
  [Alias targets](#alias-targets): an alias put whose path is the
  `{id-path}` of a canonical Bead URL ever committed in the logical Scope,
  a deleted one included, fails the same way, while a Bead creation whose
  supplied `id` has the `{id-path}` of a live alias is `alias-path-taken`
  (amended 2026-09-08, council 12). This is
  inherently an existence signal for the identity the creator chose, hidden
  or deleted alike: the non-reuse guarantee cannot be non-disclosing for a
  supplied spelling, and BDP accepts that one exception to its
  no-enumeration-oracle posture rather than allocate a second identity. An
  alias put is a cheaper existence probe than a creation — it allocates no
  Resource, mints no version, and is deletable — gated only by permission
  to put aliases, which is therefore what that permission grants.
- `alias-path-taken`: a Bead creation whose supplied `id` has the
  `{id-path}` of a live alias, under [Alias targets](#alias-targets). The
  path is held by an alias rather than by a committed identity, so the
  condition clears when the alias is deleted and the retry disposition is
  `after-state-change`, where `identity-taken`'s is `never`.
- `revision-mismatch`: the member's `expectedRevision` is not the Resource's
  current revision.
- `incident-links-exist`: a Bead deletion reached while a live Link is
  incident upon the Bead. A non-disclosing authority withholds the hidden
  Links that caused it.
- `aggregate-constraint-violation`: the mutation would violate a Scope
  aggregate policy — in BDP v0, a maximum endpoint multiplicity.
- `idempotency-conflict`, `idempotency-in-progress`, and
  `idempotency-expired`: the idempotency-key dispositions defined under
  [Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions)
  and [Outcome retention](#outcome-retention).

A member's subject Resource or in-Scope endpoint Bead that does not exist
or is not visible in the request's Authorization View fails with the Read
profile's `resource-not-found`, under the same non-disclosure rule; so does
a subject reference whose spelling is not a canonical reference of the
required kind or that names a Resource of another kind — the subject does
not exist as the required kind — except that a `bead` subject or a Link
endpoint spelled by alias is admitted and resolved under
[Alias targets](#alias-targets), and fails this way only when the
spelling names no live alias (amended 2026-09-08, council 12). An alias
put whose canonical `target`
names a Bead that does not exist or is not visible, and an alias delete
whose alias is unknown, fail the same way: aliases are not an enumeration
oracle. Which code a reference fault takes follows from what the
reference is: a subject reference — `bead`, `link`, or the `alias` member
of an alias record — whose spelling has the wrong root is
`resource-not-found`, since the subject does not exist as the required
kind; an endpoint or target reference of the wrong category — an alias, a
Link, or an external URI as an alias put's `target`, or a Link path as a
Link endpoint — is `validation-failed`; and a value that is not a
reference shape at all — neither a relative path nor an absolute URL
under the local-ID grammar, or a `@name` where none is admitted — is
carrier syntax, `malformed-request`. A member the principal may not perform
fails with `forbidden`, as does the replay of a retained result whose
record the present Authorization View does not project, under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions);
a member that exceeds a `patch` or `resource` limit fails with
`limit-exceeded`. A patch `path` that is not a JSON Pointer and a
reference whose spelling is invalid under the local-ID grammar are
carrier syntax and are rejected before execution with `malformed-request`
(amended 2026-09-08, council 12).
The Read+Update profile adds `415` and `422` to the permitted `status`
values. The bundle defines `readUpdateProblemCode`, `readUpdateProblem`
(with the member-level `retryAfter` under
[Sequence response envelope](#sequence-response-envelope)),
`validationDiagnostic`, and `validationDiagnostics`.

The Transactional profile inherits the Read table and the Read+Update rows
above and adds three rows:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `cardinality-violated` | `conflict` | 409 | `after-state-change` |
| `event-history-expired` | `gone` | 410 | `never` |
| `catch-up-timeout` | `unavailable` | 503 | `after-delay` |

The Transactional rows mean:

- `cardinality-violated`: a set operation's matched count is outside its
  `cardinality`, under [Set mutation](#set-mutation).
- `event-history-expired`: an Event Source's history aged out of the
  retention window, disclosed only to a principal authorized for that
  subject's retained history, under
  [Reads after deletion](#reads-after-deletion).
- `catch-up-timeout`: a read carrying `BDP-Minimum-Scope-Position` could
  not be served at or after that position within the authority's wait
  bound, under
  [HTTP consistency, caching, and CORS fields](#http-consistency-caching-and-cors-fields).

On a Transactional Scope every code occurs in one of two contexts, and the
bundle closes each context to its codes. A *direct* code is served as a
direct problem response: every Read code, `unsupported-media-type`,
`idempotency-conflict`, `event-history-expired`, and `catch-up-timeout`. A
*receipt* code occurs inside a `failed` Mutation Receipt, where the problem
carries the code's `status` as the failure's would-be direct status:
`validation-failed`, `type-not-installed`, `identity-taken`,
`alias-path-taken`, `revision-mismatch`, `incident-links-exist`,
`aggregate-constraint-violation`, `cardinality-violated`,
`binding-unavailable` — a sequence member on a Transactional Scope whose
`@name` creator's receipt is `failed`, under
[Mutation Transactions](#mutation-transactions) — and three Read codes
with these meanings — `forbidden`, operation-local authorization denied
the operation when it was reached, including a selected Resource that is
not writable; `resource-not-found`, `bead`, `link`, or an in-Scope
endpoint does not identify a live Resource visible in the request's
Authorization View, or a durable reference names a Resource of another
kind; and `limit-exceeded`, an advertised or enforced transaction limit —
examined, matched, or mutated Resources, induced Events, or duration — was
crossed after admission. A `failed` receipt never carries
`temporarily-unavailable`: an abort the authority does not retry is
transient and retracts the receipt under
[Mutation Transactions](#mutation-transactions), so no receipt is ever
bound to an outcome a retry could change. Inside a `failed` receipt, `retry`
`never` means the request as written can never succeed, and `retry`
`after-state-change` means a new request under a new key may succeed after
the client refreshes its state; neither means the same key executes again
while the failed receipt is retained. The Read+Update dispositions
`idempotency-in-progress` and `idempotency-expired` are never direct
problems on a Transactional Scope — a pending receipt is joined and an
expired one is returned — and occur only as the sequence-member projections
defined under [Mutation Transactions](#mutation-transactions);
`binding-unavailable` is never a direct problem either, and occurs only in
a sequence member's `failed` receipt and its projection. The bundle defines
`transactionalOnlyProblemCode`, `transactionalProblemCode`,
`directProblemCode`, `receiptProblemCode`, `transactionalProblem`, and
`receiptProblem`; the Transactional profile adds no `status` value beyond
the Read+Update set.

A direct problem uses its code's HTTP status. Its RFC 9457 `status` member is
optional, but when present it MUST match the HTTP status. RFC 9457 extension
members are allowed. A syntactically admitted sequence still returns
`200 OK`. Each failed member contains the same Problem Details shape with its
would-be `status`, its zero-based `operationIndex`, and, when the member
declared one, its `operationName`. Sequence-member `status` is required
because the enclosing HTTP status is `200 OK`. The member status locates the
failed operation's ordinary direct response. This locates the failure without
creating a separate sequence-only taxonomy.

The Read family model, required fields, status mapping, and retry table are
closed. The code table for later-profile failures is completed with each
later profile's schema bundle and conformance material. A profile cannot be
implemented before its table exists. An implementation advertising the `read`
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
values. This draft does not yet assign a BDP problem code for unacceptable
response media types, and the Read table above deliberately omits both that
condition and unsupported request media types; the Read+Update rows above
assign the latter, for mutation targets only, as `unsupported-media-type`.
An implementation MUST respond to an unexpected
internal server fault with a body-less `500 Internal Server Error`, MUST NOT
include a BDP Problem body, and MUST keep internal fault details off the
wire. A future revision may assign a BDP Problem mapping for those faults.
This draft deliberately does not.

### HTTP consistency, caching, and CORS fields

Read and Read+Update do not expose Scope epochs, Authorization View tokens,
or Scope positions. Their individual Resource responses use HTTP `ETag` for
the opaque Resource revision. Pagination continuations preserve their own
logical snapshot. Read+Update returns an authoritative mutation postimage,
but it does not promise that a later request routed to another replica
observes it.

Transactional Scope-bounded responses carry:

```http
BDP-Scope-Epoch: opaque-scope-epoch
BDP-Authorization-View: opaque-authorization-view
BDP-Scope-Position: opaque-position-42
```

A Transactional client requests a minimum visible position by sending those
same epoch and view fields plus:

```http
BDP-Minimum-Scope-Position: opaque-position-42
```

The authority then does one of three things: it returns a representation at
that position or later, it waits or routes to an eligible replica, or it
returns the normative foreign-view, cursor-expired, or catch-up-timeout
problem. It never reports success with an older position.

Scope-bounded representations that depend on authorization use
`Cache-Control: private, no-store`. If an implementation enables cross-origin
BDP access, its CORS policy MUST allow every BDP-defined non-safelisted
request field used by its advertised profile, including `Idempotency-Key`,
`Last-Event-ID`, and the Transactional minimum-position fields when
applicable. It MUST expose `Link`, `ETag`, `Retry-After`, `Cache-Control`,
and the three Transactional response fields when applicable. Ordinary CORS
rules still govern `Accept` and `Content-Type` values. Type Descriptors
hosted outside a Scope keep ordinary HTTP caching semantics. SSE responses
use `Cache-Control: no-store, no-transform`. Intermediaries must not cache or
transform the stream.

### Event-ID and checkpoint character profile

Every serialized Event ID and Scope checkpoint is a case-sensitive ASCII
token matching `[A-Za-z0-9_-]{1,256}`. The authority emits the token
identically in a JSON value, URL query, HTTP field, SSE `id`, and
`Last-Event-ID`. Clients compare the decoded values exactly and never apply
case folding or Unicode normalization. Whitespace, padding, percent signs,
control characters, and all non-ASCII characters are forbidden.

`genesis` is the reserved distinguished initial Scope checkpoint. It is never
assigned to an Event or later position. The restricted alphabet is a wire
profile, not a requirement that the value decode as base64url.
Implementations may encode UUIDs, ULIDs, hashes, counters, or other native
identities into it.

In the Transactional profile, Scope epochs, Authorization View tokens, Scope
positions, transaction identifiers, and receipt tokens use this same
profile, as idempotency keys do in every write profile under
[Idempotency keys](#idempotency-keys), so that every history token is safe
in a JSON value, a URL query, and an HTTP field. Resource revisions are not
covered: a revision is an opaque nonempty string compared only for
equality, and how the protocol projection encodes one as an HTTP validator
is a separate rule.

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
  "attribution": { "principal": "agent:planner", "status": "claimed" },
  "properties": {
    "title": "Specify BDP mutation",
    "status": "open"
  }
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
  }
}
```

`id` and `type` are always absolute canonical URLs in responses. A Bead
whose Type owns outgoing Link Types additionally carries its `ownedLinks`
member — one entry per declared owned Link Type, keyed by the Link Type
URL, valued by the owned Links' complete records in ascending code-unit
order of their canonical `id`s — on
every record read; the member is absent for Beads whose Type owns
nothing. Link
`source` and `target` are References as defined under
[Beads and Links](#beads-and-links): an in-Scope endpoint's `uri` is the
Bead's absolute canonical URL, an out-of-Scope endpoint's `uri` is its
opaque absolute URI, and either may be a Pinned Reference. `revision` is protocol metadata rather than mutable Bead or Link
state, and so is `attribution`: when present it is the per-version carried
attribution defined under [Carried attribution](#carried-attribution),
beside `revision` and outside `properties`. `id`, `type`, `revision`, and, for Links, `source` and `target` are
returned on every successful read. That does not mean they are accepted as
update targets. An implementation may store local identifiers internally.
That choice does not alter the response spelling.

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

Every Transactional Scope-bounded read reports the Scope epoch, Authorization
View token, and position of the transaction-consistent projected prefix it
observed. It reports them through the fields defined under **HTTP
consistency, caching, and CORS fields**. Read and Read+Update use Resource
revisions, entity tags, and snapshot-preserving pagination without exposing
Scope-history tokens.

### Resource views

The default `GET` of a Bead or Link URL returns its complete Resource record.
BDP-owned query parameters select a derived view, or request one bounded
aggregate anchored at that same Resource URL:

```text
GET {resource}?view=properties
GET {bead}?view=links&direction=inbound|outbound|both
GET {resource}?view=events&after={event-id}
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
Bead and is defined under **Incident Link reads**. `view=events` is valid for
a Bead or Link only in the Transactional profile and is defined under **Event
replay and live observation**. Read and Read+Update do not expose it.

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

After a Bead or Link is deleted, ordinary `GET`, `view=properties`, and, for a
Bead, `view=links` return the same `404` `resource-not-found` problem used for
an unknown or non-visible identity. BDP does not require an authority to reveal
whether the Resource once existed.

To a caller authorized for the subject's retained history — the same single
authorization that gates `410` disclosure everywhere — an authority MAY
instead disclose why a valid-shaped address has nothing behind it. Two
sibling `410` conditions are Read-profile codes in the closed problem
table: `resource-pruned` (removed by deliberate lifecycle policy) and
`resource-erased` (content that must not exist); their Transactional
sibling `event-history-expired` (history aged out of the retention window)
remains an Event-Source condition, not a Read-table code. A
`resource-pruned` problem MAY carry one `archivedAt` member — a Reference,
possibly pinned, naming where the content went — recorded and echoed like
any Reference and never validated or dereferenced by the serving authority;
its presence within an authorized disclosure is authority policy. A
`resource-erased` problem carries no condition-specific extension members
beyond its ordinary problem members: even a pointer would disclose what
erasure exists to remove. To every other caller all
three conditions remain the uniform `404`; the disclosure vocabulary is
never an enumeration oracle. The non-reuse rule remains internal: a
filesystem-backed implementation may retain only a compact allocation marker
or tombstone and need not serve it as a Resource representation.

In the Transactional profile, an authorized `view=events` may remain readable
at that canonical URL while its Event Source is retained. That history does not
make the deleted subject readable again. When the Event Source is no longer
retained, an authority may return `410` `event-history-expired` only to a
principal authorized for that subject's retained history and only when its
policy permits disclosing that the history elapsed. Unknown identities and
identities outside the caller's authorization projection always return the
same `404` `resource-not-found`. `410` is therefore not an
identity-enumeration oracle: a caller cannot use it to probe which identities
exist.

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
  appears only in the descriptor and never in any Resource record. A Link
  Type Descriptor must not carry `ownsOutgoing`.

Descriptor objects and endpoint-constraint objects are closed: no members are
allowed except those defined above. Type-ID arrays contain unique Type URLs and
may be empty where this specification permits an unconstrained endpoint.

The canonical `typeDescriptor` definition exists only in the single BDP v0
schema bundle at `schemas/bdp-v0.schema.json#/$defs/typeDescriptor`. The
specification prose above and that schema definition must remain aligned.
This section therefore does not carry a second inline schema copy.

#### Descriptor resolution and installation

A client may dereference a Type ID directly using ordinary Web retrieval and
caching. A BDP service SHOULD retain any descriptor it successfully resolves so
globally shared and well-known Type IDs do not require repeated network access.
This recommendation does not require a read-only service to resolve every Type
that appears in data before it can return the Resource record.

An authority that validates mutations has the stronger obligation defined by
the data model: before admitting a request that uses a Type, it MUST install
and pin that Type's complete contract closure. Resolution may be an
administrative operation outside BDP v0, but it finishes before request
admission. It holds no graph transaction or Resource locks while performing
network I/O. A mutation that names an unavailable Type fails as
`type-not-installed`; the mutation does not initiate installation. Validation,
retry, replay, and recovery use only the pinned local copy. Administrative
limits bound every part of this process: descriptor count and size, closure
depth, schema count and size, reference depth, retrieval time, and
compiled-validator resources.

Every BDP properties schema uses JSON Schema 2020-12. An omitted `$schema` is
interpreted as that dialect. A schema declaring another dialect is invalid for
BDP v0. `$id`, `$ref`, anchors, and the declared vocabularies have their Draft
2020-12 meanings. Installation resolves the complete transitive reference
closure — every schema reached through references, directly or indirectly —
and stores every referenced schema resource locally. Validation never performs
an implicit fetch. An authority MUST implement every required vocabulary in an
installed schema or reject the installation. The JSON Schema `format`
vocabulary remains annotation unless a separate BDP rule gives a particular
format assertion semantics.

The installed artifacts and an internal integrity fingerprint are retained as
one immutable validation closure. A service MUST NOT automatically replace any
contract-bearing descriptor or schema at the same Type ID, even if an HTTP
cache entry changes. BDP v0 does not standardize a public digest or require
semantic-equivalence analysis across differently serialized schemas.

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
policy, because checking it means inspecting other Links. The data-model
section defines its semantics and the optional discovery representation.

A service validates a Resource in stages. It checks the generic Bead or Link
record, resolves the declared descriptor and effective Type set, rejects
category mismatches, and applies the effective properties contract. For a
Link, it also applies the effective endpoint constraints to each in-Scope
endpoint and then evaluates applicable Scope aggregate constraints.

A client may skip all descriptor and schema reads and still parse, display,
and attempt to mutate any Resource. The authority performs validation and
diagnoses invalid writes. A Type whose complete closure is unavailable or
invalid is not installed, and a mutation naming it fails as
`type-not-installed`. A Resource validation failure returns a bounded
diagnostic list identifying the failing effective Type and schema location —
the `diagnostics` member of `validation-failed` under
[Problem details](#problem-details). An authority that bounds the list
advertises `validation.diagnostics` and `validation.diagnosticBytes` in its
discovery document's `limits` — a Read+Update or Transactional document,
since a Read discovery document does not carry the group (amended
2026-09-08, council 12). An uninhabitable
installed contract may therefore remain describable while every attempted
Resource value fails validation. Union endpoint constraints, minimum
multiplicity, and tuple-uniqueness rules are not part of BDP v0.

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

### Read+Update sequence target

The Read+Update and Transactional profiles expose `operations/sequence` as a
convenience carrier for the six single-Resource operations and the two alias
operations under [Alias targets](#alias-targets) (amended 2026-09-08). It is
deliberately not named `batch`. A sequence is ordered and partially committing, while BDP
`batch` is the Transactional profile's all-or-nothing Mutation Transaction.

A sequence contains one or more operation members. Each member carries its own
`idempotencyKey` and one of the eight singleton operation records: the six
Resource records, or the two alias records. The authority
validates the carrier and operation-record syntax before starting, claims
every member's key in declaration order under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions),
and then:

1. starts members strictly in declaration order and never runs them in
   parallel;
2. gives each member an individually atomic terminal outcome before starting
   the next;
3. commits each successful member immediately and never rolls it back because
   a later member fails;
4. continues after a failed member so later independent work can run; and
5. permits unrelated requests to interleave between members, taking no
   sequence-wide transaction, reservation, or lock.

A create member may supply `name`, using the same
`[A-Za-z][A-Za-z0-9_-]*` syntax as a Transactional local label. A later member
may use `@name` wherever the created Resource's ID of that kind is accepted.
The binding becomes available only after the create commits — or, on a
retry, when the creating member's retained or expired disposition supplies
the identity it allocated. A reference that is forward, unknown, or of the
wrong Resource kind is decidable from the request text and is rejected
before execution, as in a batch. A reference to a creating member whose
retained disposition is a failure fails that member permanently; a
reference to a creating member whose disposition in the same request was
transient fails that member transiently, under the envelope rules below.
Neither prevents later independent members from running. Bindings are
confined to one sequence request and do not add isolation: an interleaving
request may update or delete the committed Resource before a later member
uses it.

The response preserves declaration order and contains one terminal result or
problem for every member. A syntactically admitted sequence returns `200 OK`
even when some members fail; the per-member dispositions carry partial
success. A carrier or operation-record syntax error is rejected before
execution with a direct problem response. Sequence responses are not durable
Mutation Receipts. Retrying a member with the same idempotency key and
semantic operation returns its retained disposition. Using that key for
different semantics is an idempotency conflict.

The sequence carrier itself does not use an `Idempotency-Key` HTTP field;
its member keys are authoritative, and a sequence request that carries the
field is rejected before execution with `malformed-request`. The envelopes,
key rules, duplicate handling, and retention rules in the subsections below
complete the carrier. They are drafted for review: the provisional
judgments they embody are recorded, with their alternatives, in
`docs/design/w1-read-update-decisions.md`, and the Read+Update
implementation wave begins only after those rulings land. Nothing here
authorizes an implementation to invent different wire details.

#### Sequence request envelope

A client submits a sequence to the Scope's discovered `sequence` operation
target:

```http
POST /acme/operations/sequence HTTP/1.1
Host: beads.example
Content-Type: application/json
Accept: application/json
```

The body is one object whose only member, `operations`, is an ordered,
nonempty array of members. Each member is one of the six single-Resource
operation records defined under
[Operation record schema](#operation-record-schema), or one of the two
alias records defined under [Alias targets](#alias-targets) — carrying its
`operation` discriminator and, on a creation record, its optional `name` —
plus one required `idempotencyKey`:

```json
{
  "operations": [
    {
      "idempotencyKey": "w1-adr-create",
      "operation": "createBead",
      "name": "adr",
      "type": "https://work.example/types/decision",
      "properties": {
        "title": "Adopt sequence envelopes",
        "status": "proposed"
      },
      "attribution": { "principal": "agent:planner", "status": "claimed" }
    },
    {
      "idempotencyKey": "w1-adr-cite",
      "operation": "createLink",
      "type": "https://work.example/types/cites",
      "source": "@adr",
      "target": {
        "uri": "https://github.example/issues/123",
        "revision": "8f0e2b"
      },
      "properties": {},
      "attribution": { "principal": "agent:planner", "status": "claimed" }
    },
    {
      "idempotencyKey": "w1-task-42-close",
      "operation": "updateBeadProperties",
      "bead": "beads/task-42",
      "expectedRevision": "opaque-task-revision",
      "change": [
        {
          "op": "replace",
          "path": "/status",
          "value": "closed"
        }
      ],
      "attribution": { "principal": "agent:planner", "status": "claimed" }
    }
  ]
}
```

The envelope is closed. Before key lookup or execution, its JSON text must
also satisfy the protocol's Unicode-scalar string/member-name and decoded
member-name uniqueness rules; violations are carrier syntax
`malformed-request` (amended 2026-09-08, council 13). `operations` is bounded by `sequence.operations`
when that limit is advertised; a longer sequence is rejected before
execution with `limit-exceeded`. Two members of one sequence MUST NOT carry
the same `idempotencyKey`; a sequence that repeats a key is rejected before
execution with `malformed-request`, as is one whose `name` values repeat or
whose key or name violates its syntax. `name`, `@name` references, durable
reference spellings, and Pinned References follow the rules under
[Operation record schema](#operation-record-schema), with two differences
that follow from separate commitment. First, a binding exists only once its
creating member has a disposition that names an identity: a fresh `created`
result, a retained `created` result on a retry, or an `idempotency-expired`
disposition, whose tombstone keeps the identity the creation allocated and
its Resource kind under [Outcome retention](#outcome-retention). Second, a
binding that is unavailable at execution fails the member rather than
rejecting the request, and how it fails follows the creator. A `@name`
reference that is forward, unknown, or of the wrong Resource kind is
carrier syntax, decidable from the request text: the sequence is rejected
before execution with `malformed-request`, exactly as a batch rejects it.
A reference to a creating member whose retained disposition is a failure
fails that member with `binding-unavailable`, a retained failure; a
reference to a creating member whose disposition in this request was
transient — `idempotency-in-progress`, `rate-limited`, or
`temporarily-unavailable` — is transient too: the member fails with
`idempotency-in-progress`, the authority consults no key state for it,
executes nothing, retains nothing, and releases its claim on the member's
key, so that a retry after the delay executes the creator and then the
dependent, and a concurrent retry can never poison the dependent member of
the request that first presented the keys. Re-keying a creating member
changes the identity of every member that references its binding: a client
that corrects a creator presents new keys for its dependents as well. The
bundle defines the envelope as `sequenceRequest`
and its members as `sequenceCreateBead`, `sequenceUpdateBeadProperties`,
`sequenceDeleteBead`, `sequenceCreateLink`, `sequenceUpdateLinkProperties`,
`sequenceDeleteLink`, `sequencePutAlias`, and `sequenceDeleteAlias`.

Once the authority has admitted a sequence — validated its carrier and
operation-record syntax and started its first member — client
disconnection does not decide any member's outcome. The authority runs the
remaining members to their terminal dispositions and retains those
dispositions under their keys, so a retry recovers a lost response member
by member. Client disconnection is not an authority failure: an authority
crash, restart, or failover mid-sequence is governed by
[Durability and recovery](#durability-and-recovery).

#### Mutation results

Every successful Read+Update Resource mutation — a creation, update, or
deletion of a Bead or Link, whether submitted to a singleton target or as
a sequence member — produces one **mutation result**; an alias mutation
produces the alias result defined under [Alias targets](#alias-targets)
instead (amended 2026-09-08, council 12):

```text
MutationResult {
  outcome: created | updated | deleted
  resource?         // created, updated: the complete Resource postimage
  deleted?          // deleted: { resourceKind, resource: { id, type, revision } }
  source?           // owned-Link mutations: the source Bead's canonical URL
  sourceRevision?   // owned-Link mutations: the source Bead's resulting revision
}
```

`created` and `updated` carry `resource`, the complete Resource record as a
`GET` of its URL would now return it: `id`, `type`, `revision`, the
version's `attribution` when one was recorded, `properties`, and, for a
Bead whose Type owns outgoing Link Types, `ownedLinks`. A semantic no-op
update, defined under [Revisions](#revisions), succeeds with outcome
`updated` and the retained revision. `deleted` carries `deleted`, the
identity record of the removed Resource, and no Resource record:
`resourceKind`, `bead` or `link`, and `resource`, holding the absolute
canonical `id`, the immutable `type`, and `revision`, the Resource's final
live revision. Deletion mints no version: the identity's `revision` is the
revision the Resource had when it was deleted, never a newly minted one,
and it is the value a [Scope changefeed](#scope-changefeed) tombstone and
`DeletedData.revision` report for the same deletion. The bundle defines
the identity record as `deletedIdentity`, over `resourceKind` and
`resourceIdentity`. When the mutated Link's type is owned by its source
Bead's declared Type, the result additionally carries `source`, the source
Bead's absolute canonical URL, and `sourceRevision`, the source Bead's
resulting revision, on creation, update, and deletion alike; a deletion
returns the Link's identity and no Link record, so `source` is the only
member that names the source Bead whose revision `sourceRevision` reports.
On a semantic no-op update
`sourceRevision` is the source's unchanged current revision. The source's
full postimage is available at its own URL. `source` and `sourceRevision`
are absent from every other result, and each is present exactly when the
other is. That is the only secondary revision any result reports: putting
or deleting an alias mints no version and moves no revision — the target
Bead's revision is unchanged by alias mutation, and the alias result
defined under [Alias targets](#alias-targets) carries none. A result is
closed. The bundle defines
`mutationResult`; a singleton target returns it as the body of a `200 OK`
response, under
[Operation Directory and singleton targets](#operation-directory-and-singleton-targets).

#### Alias targets

The Read+Update profile defines two alias targets, `put-alias` and
`delete-alias`, keyed by alias path beneath the fixed `alias/` root defined
under [Aliases](#aliases); the Transactional profile inherits both (amended
2026-09-08; decision D31 in `docs/design/w1-read-update-decisions.md`).
Each is a singleton target under
[Operation Directory and singleton targets](#operation-directory-and-singleton-targets)
and a sequence member with its own `idempotencyKey`; the operation
discriminators are `putAlias` and `deleteAlias`.

A **put** creates an alias or repoints an existing one to exactly one
canonical in-Scope Bead URL; repointing is the same operation, not a second
one. Its record carries `alias`, the alias named by its local spelling
`alias/{alias-path}` or by its absolute alias URL, and `target`, one
canonical in-Scope Bead reference — a durable local ID, an absolute
canonical Bead URL, or, in a sequence, a `@name` bound by an earlier
creation of a Bead in the same sequence. A **delete** removes the alias;
its record carries `alias` alone, and the path is reusable afterwards, as
[Aliases](#aliases) says. Neither record carries `expectedRevision`, since
an alias has no revision, nor `attribution`, since attribution is per
version and alias mutation mints none; neither binds a `name`, since
neither creates a Resource.

```json
{
  "alias": "alias/adr/sequence-envelopes",
  "target": "beads/decision-7"
}
```

The alias path uses the local-ID grammar: one or more safe segments,
compared exactly as local-ID segments are. `alias` is resolved against the
canonical Scope URL like a durable reference, and it never accepts
`@name`; a spelling that violates the grammar is carrier syntax rejected
before execution with `malformed-request`, and a well-formed spelling
that is not beneath the `alias/` root names no alias and fails with
`resource-not-found` when the member is reached, as a wrong-root subject
reference does under [Problem details](#problem-details). Canonical Bead
segments and alias paths share one
uniqueness namespace in the Scope, a store invariant the authority
enforces when the member is reached: a put whose alias path is the
`{id-path}` of a canonical Bead URL ever committed in the logical Scope —
a deleted one included, since canonical segments are never released —
fails with `identity-taken`, and a Bead creation that supplies an `id`
whose `{id-path}` is a live alias path fails with `alias-path-taken`, a
condition that clears when the alias is deleted. An authority never
allocates a Bead id whose segment is a live alias path. Link segments and
alias paths coexist: `links/foo` and `alias/foo` do not collide, and a
Link creation may supply an `id` whose `{id-path}` is a live alias path.
An alias path in use as an alias is not taken for a put, which repoints
it. Alias operations follow the model's check order under
[Explicit alias operations](#explicit-alias-operations), identifier
uniqueness first, so a put whose path is taken and whose target is
unknown answers the uniqueness fault.
A put whose `target` is a canonical Bead reference naming a Bead that does
not exist or is not visible in the request's Authorization View fails with
`resource-not-found`, and a delete of an unknown alias fails with
`resource-not-found`: aliases are not an enumeration oracle. A put whose
`target` is not a canonical Bead reference — an alias, absolute or local,
a Link, or an external URI — fails with `validation-failed`, carrying one
diagnostic that names the cause: an alias targets a canonical Bead URL
only, so no chain is ever admitted, exactly as
[Alias resolution](#alias-resolution) never follows one. A put or delete
the principal may not perform fails with `forbidden`. Alias operations
are authorized as mutations of the Beads they touch: a put requires that
the principal may write the proposed target Bead, and a repoint or a
delete additionally that it may write the alias's current target; when
the current target is not visible to the principal, the alias itself is
`resource-not-found`, disclosing nothing.

Alias mutation mints no version: an alias is a locator, not part of any
Bead's durable state, so the target Bead's revision is unchanged by a put
or a delete, and a repoint changes the revision of neither the former nor
the new target. Aliases are not members of the Bead record or of its
`properties`, carry no revision, and are not Resources. How alias mutation
appears in Transactional Scope history, receipts, and the changefeed, and
whether `batch` admits alias members, is defined with the Transactional
profile.

Every successful alias mutation produces one **alias result**, closed:

```text
AliasResult {
  outcome: created | updated | deleted
  alias             // the absolute alias URL
  target?           // created, updated: the absolute canonical target Bead URL
}
```

A put reports `created` when the alias path was not in use as an alias and
`updated` when it repointed an existing alias — including a put whose
`target` the alias already had, which changes nothing and reports
`updated`; both carry `alias`, the absolute alias URL, `alias/{alias-path}`
resolved against the canonical Scope URL, and `target`, the absolute
canonical Bead URL the alias now resolves to. A delete reports `deleted`
with `alias` and no `target`. The outcome vocabulary is the mutation
result's own. A singleton alias target returns the alias result as the
body of a `200 OK` response, exactly as a mutation result is returned
under
[Operation Directory and singleton targets](#operation-directory-and-singleton-targets);
a sequence member's entry is the alias result plus `operationIndex`, and
never `operationName`. The bundle defines `aliasResult`,
`putAliasRequest`, `deleteAliasRequest`, `sequencePutAlias`,
`sequenceDeleteAlias`, and `sequenceMemberAliasResult`.

Alias members are sequence members under every rule of this section: keys
are claimed at admission, carrier discipline and static reference checks
apply unchanged, and a put's `target` may name a `@name` bound by an
earlier Bead creation in the same sequence — creating the Bead and then
binding its alias is one sequence — resolving to the identity the
creation allocated, fresh, retained, or expired. A `@name` bound by a Link
creation is of the wrong Resource kind and is rejected before execution.
An alias member's semantic identity is its operation kind plus its
normalized record, under [Idempotency keys](#idempotency-keys): `alias`
canonicalized to the absolute alias URL and `target` resolved to the
canonical Bead URL or to the identity its creating member bound. The same
key with the same semantic identity returns the retained disposition, as
for every singleton, and the same key with a different identity is
`idempotency-conflict`. An alias disposition is retained, replayed, and
tombstoned exactly as a Resource mutation's is: a put or delete commits
state, so its tombstone outlives the retention interval under
[Outcome retention](#outcome-retention), and an alias result discloses no
Resource record, so it is returned as retained, as a `deleted` identity
is. Because every Read+Update Scope offers the alias targets, a
Read+Update authority serves alias resolution and advertises `aliases` in
its discovery document; `aliases` is therefore a required member of the
Read+Update and Transactional discovery documents under
[Scope discovery and human documentation](#scope-discovery-and-human-documentation),
and the bundle's `readUpdateDiscovery` requires it.

An alias spelling — `alias/{alias-path}` or the absolute alias URL — is
admitted wherever a canonical in-Scope Bead reference is: as the `bead`
subject of an update or a deletion and as a Link endpoint `source` or
`target`, bare or as the `uri` of a Pinned Reference, in a singleton and
in a sequence member alike. The authority resolves it to the alias's
current target when the member is reached — exactly as a `@name` binding
is resolved when its member is reached, so an alias put earlier in the
same sequence is what a later member observes — and stores and serves the
canonical Bead URL, as [Aliases](#aliases) requires: a reference resolved
through an alias does not follow a later repoint. An alias spelling that
names no live alias fails with `resource-not-found`, under the same
non-disclosure rule as an unknown Bead, and a `link` subject spelled by
alias is of the wrong kind and fails with `resource-not-found` too, since
an alias resolves to a Bead only. A put's own `target` admits no alias
spelling: an alias target is `validation-failed`, as above. The semantic
identity of a member that spelled a reference by alias records the
resolution rather than the spelling, under
[Idempotency keys](#idempotency-keys).

#### Sequence response envelope

A syntactically admitted sequence returns `200 OK` with one object whose
only member, `results`, holds one entry per member in declaration order.
An entry is the member's mutation result, its alias result under
[Alias targets](#alias-targets), or its problem:

```json
{
  "results": [
    {
      "operationIndex": 0,
      "operationName": "adr",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/adr-104",
        "type": "https://work.example/types/decision",
        "revision": "opaque-adr-revision-1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": {
          "title": "Adopt sequence envelopes",
          "status": "proposed"
        },
        "ownedLinks": {
          "https://work.example/types/cites": []
        }
      }
    },
    {
      "operationIndex": 1,
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/cites-105",
        "type": "https://work.example/types/cites",
        "revision": "opaque-cites-revision-1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/adr-104",
        "target": {
          "uri": "https://github.example/issues/123",
          "revision": "8f0e2b"
        },
        "properties": {}
      },
      "source": "https://beads.example/acme/beads/adr-104",
      "sourceRevision": "opaque-adr-revision-2"
    },
    {
      "type": "https://github.com/gastownhall/bdp/problems/conflict",
      "code": "revision-mismatch",
      "status": 409,
      "retry": "after-state-change",
      "operationIndex": 2,
      "detail": "beads/task-42 is at a different revision"
    }
  ]
}
```

Every entry carries `operationIndex`, the member's zero-based position in
the request's `operations` array, and carries `operationName` exactly when
the member declared `name`. A result entry is the member's mutation result
plus those two members, or its alias result plus `operationIndex` alone,
and it is closed. A problem entry is the Read+Update
Problem Details shape under [Problem details](#problem-details) — `type`,
`code`, `retry`, its required would-be `status`, the other RFC 9457
members, and extension members — plus `operationIndex` and
`operationName`; it never carries `outcome`. A member problem whose
`retry` is `after-delay` MAY carry `retryAfter`, a non-negative integer of
delay-seconds: the member-level counterpart of `Retry-After`, which has no
carrier inside a `200 OK` envelope. The `Retry-After` field applies to
direct problems; a member problem without `retryAfter` gives no hint, and
the client backs off on its own. `results` has exactly as many
entries as `operations`. The bundle defines `sequenceResponse`,
`sequenceMemberResult`, `sequenceMemberAliasResult`, and
`sequenceMemberProblem`.

Failures of the carrier itself — an unauthenticated principal, a body media
type other than `application/json`, malformed or oversized JSON, a member
count above `sequence.operations`, a repeated or invalid key or name, an
invalid operation record, a patch `path` that is not a JSON Pointer, a
stray `Idempotency-Key` field, a rate limit, or an unavailable authority —
are direct problem responses and execute nothing. Every other failure of a
member is a member problem inside a `200 OK` envelope, with one exception:
an unexpected internal fault is the body-less `500` under
[Problem details](#problem-details) even mid-sequence. Members that reached
a durable disposition before it stay retained, the faulting member's claim
is cleared, and the client resubmits, exactly as after an authority crash
under [Durability and recovery](#durability-and-recovery).

#### Idempotency keys

An idempotency key is a case-sensitive ASCII token matching
`[A-Za-z0-9_-]{1,256}` — the character profile under
[Event-ID and checkpoint character profile](#event-id-and-checkpoint-character-profile)
— written identically as a sequence member's `idempotencyKey` and as the
value of a singleton request's `Idempotency-Key` field, without quoting,
padding, or whitespace. A key outside the profile is rejected before
execution with `malformed-request`, as is a singleton request that omits
the field or carries it more than once: the authority rejects a repeated
`Idempotency-Key` field rather than choosing an occurrence. The client
mints keys; the authority never allocates, normalizes, or case-folds them,
and compares them byte-exactly.

A key identifies one semantic mutation within one **idempotency
namespace**: the pair of the canonical Scope URL and the authenticated
principal, an anonymous principal counting as one principal. The
authenticated principal is the identity authentication established for the
request, as the authority identifies it across restart, failover, and
credential rotation; it is not the carried `attribution.principal`, which is
data under [Carried attribution](#carried-attribution) and takes no part in
the namespace. Keys presented by other principals, in other Scopes, or to
other authorities are unrelated. Anonymous principals share one namespace,
so an authority that admits anonymous mutation exposes every anonymous key
to every anonymous client: such an authority SHOULD require authentication
for mutation, and an anonymous client SHOULD mint unguessable keys. Authorization View changes do not create a new
namespace: the principal-bound disposition remains retained and cannot
execute again, though its disclosure is re-authorized on every replay under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions).
The namespace is shared by every mutation carrier in the profile: a
sequence member and a singleton request that present the same key in the
same namespace present the same key.

The **semantic identity** of a member is its operation kind — from
`operation`, or from the singleton target — plus its normalized operation
record. Before comparison the authority resolves and canonicalizes durable
references, resolves each `@name` reference to the identity its creating
member bound — taken from that member's fresh, retained, or expired
disposition, never from the spelling — expands protocol defaults such as an
omitted `properties`, preserves the order of `change` and every other
array, ignores JSON object member order, and excludes `idempotencyKey` and
`name`, and compares the normalized records under the JSON value-equality
rules of RFC 6902 Section 4.6. A reference that resolves to no identity
because its creating member failed and allocated none is normalized to one
distinguished unbound marker rather than to its spelling, so renaming a
label never changes an identity. A transient creator yields
no identity to compare: the dependent member is answered transiently before
any comparison, under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions).
Opaque external URIs and Pinned References are compared byte-exactly as
written, a pinned `uri` spelled by `@name` or by alias having first
resolved as the bare spelling does (amended 2026-09-08, council 12);
`expectedRevision` and `attribution` are members of the record and
therefore of its identity. An alias spelling admitted under
[Alias targets](#alias-targets) normalizes to the canonical Bead URL it
resolved to when the member was reached: the authority records that
resolution with the member's disposition and in its tombstone, and every
later presentation of the key compares against the recorded resolution —
never against the spelling and never against the alias's present target —
so a repoint between a member and its byte-identical retry changes no
identity, exactly as a `@name` reference resolves through its creator's
retained or expired disposition. The authority may store the normalized
record or an internal fingerprint; BDP does not require a public
request-hash algorithm.

#### Duplicate keys and retained dispositions

A member's **disposition** is its mutation result, its alias result, or
its problem, excluding `operationIndex` and `operationName`. When a member reaches its terminal
outcome, the authority retains that disposition under the member's key
unless the disposition is transient. A disposition whose `retry` is
`after-delay` — `rate-limited`, `temporarily-unavailable`, and
`idempotency-in-progress` — is transient and is never retained: the member
was not executed, and a later member presenting the same key executes it.
A member whose `@name` reference names a creating member of the same
request whose disposition was transient is transient by the same rule: it
fails with `idempotency-in-progress`, the authority consults no key state
for it, and its claim is released. Every other disposition, success or
failure, is retained, and a retained failure answers a retry exactly as a
retained success does for as long as it is retained; what outlives the
retention interval differs, under [Outcome retention](#outcome-retention).

A key is **claimed** before it executes, and a claimed key is in flight
until its member reaches a terminal outcome. A sequence claims every
member's unknown key at admission, in declaration order, before its first
member starts; a singleton claims its key before executing. A member whose
key could not be claimed — because it is retained, expired, or in flight
elsewhere — is answered in its turn, as of that turn, under the outcomes
below. Claiming at admission is what makes a concurrent resubmission of an
admitted sequence transient in every member the original will run, so it
can neither execute a member ahead of the original's earlier members nor
retain a disposition the original would contradict. The claims one
carrier makes at admission are one linearizable step relative to
competing admissions: a competing presentation observes all of a
carrier's claims or none of them, so two presentations of one sequence
can never split its keys between them, even for members that depend on
each other through state rather than through `@name`. The claim step
holds no lock past admission; members execute, interleave, and are
answered exactly as before. A client that
has refreshed its state constructs a new request under a new key. A
request rejected before admission — an unauthenticated principal, a
carrier-level rejection — creates no disposition.

Presenting a key produces one of four outcomes, decided in the member's
turn:

1. the key is retained with the same semantic identity: the authority does
   not execute the member and returns the retained disposition, positioned
   with the present member's `operationIndex` and `operationName`;
2. the key is retained with a different semantic identity: the member fails
   with `idempotency-conflict`, nothing executes, and the retained
   disposition is unchanged;
3. the key is in flight — claimed by a request whose member has not
   reached a terminal outcome: the member fails with
   `idempotency-in-progress`, the authority executes nothing and retains
   nothing for the presenting member, and a retry after the delay receives
   the retained disposition once the first presentation has reached a
   retained outcome — a delayed retry may instead find the key still in
   flight, meet a transient disposition of its own, or, after a long delay,
   find the disposition expired; or
4. the key is unknown: the member executes and its disposition is retained.

A retained disposition is returned without re-executing anything. A
retained `created` result therefore always carries the same
authority-allocated identity, and a retained `resource` record is the
postimage at the time of the mutation, not a fresh read.

Returning a retained result discloses a Resource record, so it observes the
present request's Authorization View like every other representation:
before returning a retained `created` or `updated` result the authority
re-authorizes disclosure of the retained record — the record as retained,
whether or not the Resource still exists — against the present view.
When the view no longer projects that record, the member fails with
`forbidden` and discloses nothing retained. That response is not retained:
it replaces neither the disposition nor its semantic identity, it permits
no execution, and a later replay under a view that projects the record
receives the original disposition. Retained problems, `deleted`
identities, and alias results disclose no record and are returned as
retained.

#### Outcome retention

Retention is finite. An authority retains each retained disposition for at
least `retention.idempotency` after the member's terminal outcome when it
advertises that limit, and for a finite interval of its own choosing when it
does not. When the limit is advertised, a client that needs a lost response
MUST retry within it. When it is not, no client-known recovery window
exists: a late retry may be answered by the retained disposition or by
`idempotency-expired`, and a client that needs a recoverable window uses an
authority that advertises one. After the interval the authority MAY discard
the disposition. For a disposition that committed state — `created`,
`updated` including a semantic no-op, or `deleted` — it MUST then retain a
compact tombstone — the key, the semantic identity's fingerprint, and, for
a creation that allocated an identity, that identity and its Resource kind,
through which a later `@name` reference still resolves — for the lifetime
of the logical Scope, exactly as it retains the identity non-reuse
guarantee under [Scopes and identity](#scopes-and-identity); tombstone
storage is therefore bounded by the committed effects, as identity
tombstones already are, and no principal can grow it with requests that
commit nothing. Presenting an expired key with the same semantic identity
fails with `idempotency-expired`; the authority never executes the member
again and never reports the discarded outcome. Presenting an expired key
with a different semantic identity remains `idempotency-conflict`. A
retained failure committed nothing: after the interval the authority MAY
forget it entirely, and a later presentation of its key is unknown and
executes — a first execution, since the failed member had no effect, under
the guards the request carries. A restore that cannot preserve the
tombstones creates a different logical Scope under the rule in that
section. Read+Update exposes no epoch: a client cannot detect a restore
except through a changed canonical Scope URL, and the profile offers no
restore signal beyond `resource-not-found`, `revision-mismatch`, and
`idempotency-expired`.

#### Durability and recovery

A member's mutation, its semantic identity, the identities it allocated,
and its terminal disposition become durable together, as one atomic unit:
an authority MUST NOT commit a mutation without retaining its disposition
under its key, and MUST NOT retain a disposition for a mutation it did not
commit. A crash therefore leaves a key either unknown, with nothing
committed, or retained with its committed outcome — never a committed
Resource behind an unknown key, and never a retained success for work that
was lost.

A sequence claims every member's unknown key at admission and a singleton
claims its key before executing; the claim is the in-flight state that
answers a concurrent duplicate. A claim abandoned by a crash — one whose
member reached no durable disposition — is cleared during restart or
failover, so a retry executes the member once: an authority MUST NOT answer
an abandoned claim with `idempotency-in-progress` indefinitely, and it does
not complete the abandoned member on its own initiative. Every
mutation route — each singleton target, the sequence target, and every
replica that accepts mutations — consults one authoritative key state for
the namespace; two routes MUST NOT each treat the same key as unknown.

Recovery state comprises every retained disposition within its retention
interval, every tombstone, and the resolution of every claim. Restart and
failover that preserve it answer a retry with the retained disposition, or
execute a cleared member once, without a second mutation. A restore that
cannot preserve it creates a different logical Scope under
[Scopes and identity](#scopes-and-identity), at a different canonical Scope
URL: a client MUST NOT treat a restored Scope as a transparent continuation
of the old key namespace.

An authority crash is not a client disconnection. When the authority fails
mid-sequence, members that reached a durable disposition stay retained, the
member in flight is recovered as an abandoned claim, and unstarted members
are never executed by recovery: the authority does not resume a sequence.
The client resubmits the sequence; retained dispositions answer the
committed members, and the remaining members execute in order.

### Batch operation target

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section. A
> BDP `batch` target belongs only to the Transactional profile and always means
> the ordered, all-or-nothing operation defined here.

A Read or Read+Update Scope MUST NOT advertise or accept a target as BDP
`batch`. In particular, the Read+Update profile does not weaken `batch` into
independent or partially successful operations under the same protocol name.

A client submits a Mutation Transaction to the Scope's discovered `batch`
operation target:

```http
POST /acme/operations/batch HTTP/1.1
Host: beads.example
Content-Type: application/json
Accept: application/json
Idempotency-Key: client-generated-opaque-key
```

The target URL establishes the Scope; the request does not repeat it. `batch`
is an execution target, not a collection of transactions. A batch request
carries exactly one required `Idempotency-Key` HTTP field; the JSON body does
not repeat it. The field is subject to the Scope-, epoch-, and
principal-qualified semantics defined for Mutation Transactions.

A completed synchronous submission returns `200 OK` with the complete Mutation
Receipt representation. If an identical concurrent duplicate does not wait for
completion, it returns `202 Accepted` with the same pending receipt identity.
The request body contains one ordered operation list:

```json
{
  "operations": [
    {
      "name": "newTask",
      "operation": "createBead",
      "type": "https://work.example/types/task",
      "properties": {
        "title": "Specify BDP mutation",
        "status": "open"
      }
    },
    {
      "operation": "createLink",
      "type": "https://work.example/types/assigned-to",
      "source": "@newTask",
      "target": "beads/person-7",
      "properties": {}
    }
  ]
}
```

`name` is the wire spelling of the model's transaction-local label. In a
Resource-reference member, a string beginning with `@` refers to the Resource
created by the preceding operation with that name. It denotes only Resource
identity. It is not an expression and cannot be followed by a property or
result path.

Labels match `[A-Za-z][A-Za-z0-9_-]*` and are unique within the batch. The
service rejects forward references, unknown names, duplicate names, and
Resource-kind mismatches. A durable local ID whose relative spelling begins
with `@` must be supplied as its absolute Resource URL in a batch. That avoids
any ambiguity with a transaction-local reference. Singleton operations do not
accept transaction-local references.

Before idempotency comparison or execution, durable relative Resource
references are resolved against the canonical Scope URL and normalized to
absolute canonical URLs. JSON object member order and equivalent accepted
local versus absolute spellings therefore do not cause a false idempotency
conflict. Operation order, array order, member presence, and JSON values
remain semantic.

A batch request body conforms to the bundle's `batchRequest` definition:
exactly one member, `operations`, an array of one or more operation records,
each conforming to `batchOperation` — the closed eight-record union whose
`operation` discriminator selects `createBead`, `updateBeadProperties`,
`deleteBead`, `createLink`, `updateLinkProperties`, `deleteLink`,
`updateWhere`, or `deleteWhere`. Each record composes the operation's
member definition shared with the Read+Update singleton and sequence
records — `createBeadMembers` through `deleteLinkMembers`, plus
`updateWhereMembers` and `deleteWhereMembers` — with the `operation`
discriminator and, on a creation record, the optional `name` label, and it
is closed. A body-level `idempotencyKey`, a per-operation `idempotencyKey`,
or any other undefined member makes the request malformed. The
`Idempotency-Key` HTTP field is required and follows
[Idempotency keys](#idempotency-keys); a request that carries no such
field, more than one, or a value outside the grammar is malformed. `batch` does not admit `putAlias` or `deleteAlias`: alias mutations are
locator-only singleton transactions, including when carried as separate
sequence members (ruled 2026-09-08, T49).

Reference members of operation records take the Read+Update reference
definitions: `bead` and `link` are `resourceReference` — a canonical local
ID, an absolute canonical Resource URL, or an `@label` — and `source` and
`target` are `inputReference`, which additionally admits an absolute
out-of-Scope URI and the Pinned Reference form `inputPinnedReference`
around any of those spellings. A creation record's `id` is
`durableResourceReference`: a canonical local ID or an absolute canonical
URL, never an `@label`; a local ID whose first character is `@` is supplied
as its absolute URL. A Pinned Reference whose `uri` is an `@label` is
accepted: the authority resolves the `uri` to the allocated canonical URL
and stores and echoes the `revision` byte-identically, applying no semantic
validation to it, exactly as for every other pin.

Before admission, the authority decides the request's fate in this order,
and a request that fails one step never reaches the next:

1. request bounds — a request target above `request.targetBytes` or a body
   above `request.bodyBytes` is rejected with `413` `request-too-large`
   before the body is parsed;
2. carrier syntax — a body media type other than `application/json` is
   `415` `unsupported-media-type`; a body that is not well-formed JSON, a string or member name with an
   unpaired surrogate, duplicate member names after escape decoding
   (amended 2026-09-08, council 13), an absent, repeated, or invalid `Idempotency-Key`, a body outside
   `batchRequest`, a forward, unknown, or duplicate label, a label used
   where the other Resource kind is required, a noncanonical local ID
   spelling, or a supplied `id` beneath the wrong fixed root is `400`
   `malformed-request`, whose problem SHOULD carry `pointer`, an RFC 6901
   JSON Pointer into the request body naming the offending member;
3. the principal — an unauthenticated request is `401` `unauthenticated`,
   and a principal that may not submit mutations to the Scope is `403`
   `forbidden`;
4. the key — a key bound, for this Scope, epoch, and principal, to a
   different normalized request is `409` `idempotency-conflict`, and the
   earlier request's outcome is unaffected; a key bound to the same
   normalized request is answered with its receipt, pending or terminal,
   under [Mutation Transactions](#mutation-transactions), and nothing
   below is evaluated; and
5. admission controls for an unknown key — an `operations` count above
   `transaction.operations` is `413` `limit-exceeded` with `limit`
   `transaction.operations`, a rate limit is `429` `rate-limited`, and an
   authority that cannot admit is `503` `temporarily-unavailable`.

Every one of these is a direct problem that creates no receipt and binds no
key. A syntactically invalid request therefore never consults key state, and
a retained or pending receipt is returned before limits and rate limits are
evaluated, so that a retry that only wants its outcome is never refused for
the capacity its original consumed.

A request is admitted when the authority has durably recorded, in one step,
the key, the normalized request identity, the `pending` Mutation Receipt
with its `transaction` identity, and its own ownership of the execution,
under [Mutation Transactions](#mutation-transactions). From that point
client disconnection, a transport failure, and a bodyless `500` decide
nothing: the transaction commits or fails on its own, the receipt records
which, and every response to that request or to an identical retry is a
Mutation Receipt representation — with one exception. A transient abort
after admission — a serialization conflict the authority does not retry, or
a component it cannot reach — retracts the pending receipt and unbinds the
key in one durable step and is answered, to the original request and to
every joined duplicate, with a direct `503` `temporarily-unavailable` that
SHOULD carry `Retry-After`; the retracted receipt's URL then answers the
uniform `404`, and a retry under the same key executes as a new mutation.
Every other failure after admission is permanent and is reported inside a
`failed` receipt, never as a direct problem.

The batch target's responses are:

- `200 OK` with the terminal Mutation Receipt, whose `status` is `completed`
  or `failed`. A failed transaction is a successful representation of its
  receipt; the HTTP status does not repeat the embedded problem's `status`,
  exactly as a syntactically admitted sequence returns `200 OK` around
  failed members. The synchronous response to the original submission is
  this terminal receipt whenever the transaction reaches its terminal
  disposition within the authority's synchronous wait bound, which is never
  longer than `transaction.duration` when that limit is advertised; the
  normal case therefore requires no follow-up read.
- `202 Accepted` with the `pending` Mutation Receipt: to the original
  submission only when the transaction is still executing at the wait
  bound, and to an identical duplicate that the authority answers before
  the transaction is terminal. The response SHOULD carry `Retry-After` and
  MAY carry `Location` equal to the receipt's `id`. The client waits,
  repeats the original request, or reads the receipt until it is terminal.
- A direct problem, from the ordered list above or the transient-abort
  rule, for a request that is not admitted or whose execution was
  retracted.

Receipt representations use `Content-Type: application/json`,
`Cache-Control: private, no-store`, and the three Transactional response
fields as the serving request's own observation under
[Mutation Receipt responses](#mutation-receipt-responses). Singleton
operation targets on a Transactional Scope use exactly these statuses and
rules: the six Resource targets' bodies are the Read+Update singleton
request records `createBeadRequest` through `deleteLinkRequest` — the
operation's members without `operation` and `name`, rejecting `@label` in
bare and pinned forms — and, for the two set targets, `updateWhereRequest`
and `deleteWhereRequest`, the set-operation members without `operation`;
each executes as a one-operation Mutation Transaction and returns its
receipt. The alias targets `put-alias` and `delete-alias` use the same receipt
response and status rules; their bodies remain `putAliasRequest` and
`deleteAliasRequest`. Their locator-only effects are defined under
[Transactional alias mutations](#transactional-alias-mutations)
(ruled 2026-09-08, T49).

The Transactional mutation surface answers as follows; a row's statuses are
exhaustive for that target and method, apart from the bodyless `500` an
unexpected internal fault produces anywhere.

| Target | Method | Response |
| --- | --- | --- |
| `batch`, the six Resource singleton targets, the two set targets, and the two alias targets | `POST` | `200` terminal receipt; `202` pending receipt; direct `400`, `401`, `403`, `409`, `413`, `415`, `429`, `503` |
| `sequence` | `POST` | `200` envelope of [Sequence response envelope](#sequence-response-envelope), pending members included as problems; direct `400`, `401`, `403`, `413`, `415`, `429`, `503`; never a sequence-level `202` receipt (amended 2026-09-08, council 13) |
| the same targets | any other method | `405`, `Allow: POST` — plus `OPTIONS` when cross-origin access is enabled, in which case `OPTIONS` is answered by the CORS rules rather than `405` — and no BDP Problem body |
| `operations/` | `GET`, `HEAD` | `200` Operation Directory; `401`, `403`, `429`, `503` |
| `operations/` | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| a receipt URL `receipts/{token}` | `GET`, `HEAD` | `200` receipt in its current representation; `401`; `404` for an unknown token, another principal's receipt, a retracted receipt, a forgotten failed receipt, or a prior epoch's receipt; `409` `foreign-view` or `410` `cursor-expired` for incompatible minimum-position context; `429`, `503` |
| a receipt page URL | `GET`, `HEAD` | `200` page; `401`; `404` under the same non-disclosure rule; `409` `foreign-view` or `410` `cursor-expired` for incompatible minimum-position context; `410` `cursor-expired` after the receipt's detail expired; `429`, `503` |
| a receipt or page URL | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| the `receipts` root | any method | `404` `resource-not-found` for `GET` and `HEAD`, `405` with `Allow: GET, HEAD` otherwise |

On a receipt or page read, authentication is decided first, then the
principal and epoch non-disclosure rule, then the request's minimum-position
context and consistency wait, then page expiry, then the representation.
An incompatible view returns `409` `foreign-view`; an expired context
returns `410` `cursor-expired`; a failed catch-up wait returns `503`
`catch-up-timeout`, under the shared consistency rules. These checks never
let a caller who may not see the receipt learn about its pages or history
(amended 2026-09-08, council 13).
### Operation record schema

> **Transactional/Replication constructs within this section.**
>
> The batch wrapper, `updateWhere`, and `deleteWhere` definitions apply only to
> Transactional. Read+Update `sequence` uses the `operation` discriminator,
> optional create-member `name`, per-member `idempotencyKey`, the six
> single-Resource definitions, and the two alias definitions under
> [Alias targets](#alias-targets). Singleton targets remove `operation`,
> `name`, and body-level `idempotencyKey` as described below.

Every object in a batch conforms to the bundle's operation definition. The
bundle's `batchOperation` definition is the normative eight-record union,
composed from the same `<operation>Members` definitions the Read+Update
singleton and sequence records use; the sketch below is a non-normative
preview of it and carries no independent `$id`. The `operation`
discriminator selects one of the eight generic operation records:

```json
{
  "title": "BDP batch operation",
  "oneOf": [
    { "$ref": "#/$defs/createBead" },
    { "$ref": "#/$defs/updateBeadProperties" },
    { "$ref": "#/$defs/deleteBead" },
    { "$ref": "#/$defs/createLink" },
    { "$ref": "#/$defs/updateLinkProperties" },
    { "$ref": "#/$defs/deleteLink" },
    { "$ref": "#/$defs/updateWhere" },
    { "$ref": "#/$defs/deleteWhere" }
  ],
  "$defs": {
    "name": {
      "type": "string",
      "pattern": "^[A-Za-z][A-Za-z0-9_-]*$"
    },
    "resourceReference": {
      "type": "string",
      "minLength": 1
    },
    "reference": {
      "oneOf": [
        { "$ref": "#/$defs/resourceReference" },
        { "$ref": "#/$defs/pinnedReference" }
      ]
    },
    "pinnedReference": {
      "type": "object",
      "required": ["uri", "revision"],
      "properties": {
        "uri": { "$ref": "#/$defs/resourceReference" },
        "revision": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": false
    },
    "attribution": {
      "type": "object",
      "required": ["principal", "status"],
      "properties": {
        "principal": { "type": "string", "minLength": 1 },
        "status": { "enum": ["claimed", "unknown"] }
      },
      "additionalProperties": false
    },
    "typeId": {
      "type": "string",
      "format": "uri"
    },
    "properties": {
      "type": "object"
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1
    },
    "change": {
      "type": "array",
      "minItems": 1,
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["op", "path", "value"],
            "properties": {
              "op": { "enum": ["add", "replace"] },
              "path": { "type": "string" },
              "value": true
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "required": ["op", "path"],
            "properties": {
              "op": { "const": "remove" },
              "path": { "type": "string" }
            },
            "additionalProperties": false
          }
        ]
      }
    },
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "cardinality": {
      "type": "object",
      "properties": {
        "min": { "type": "integer", "minimum": 0 },
        "max": { "type": "integer", "minimum": 0 }
      },
      "minProperties": 1,
      "additionalProperties": false
    },
    "createBead": {
      "type": "object",
      "required": ["operation", "type"],
      "properties": {
        "operation": { "const": "createBead" },
        "name": { "$ref": "#/$defs/name" },
        "id": { "$ref": "#/$defs/resourceReference" },
        "type": { "$ref": "#/$defs/typeId" },
        "properties": { "$ref": "#/$defs/properties" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "updateBeadProperties": {
      "type": "object",
      "required": ["operation", "bead", "change"],
      "properties": {
        "operation": { "const": "updateBeadProperties" },
        "bead": { "$ref": "#/$defs/resourceReference" },
        "change": { "$ref": "#/$defs/change" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "deleteBead": {
      "type": "object",
      "required": ["operation", "bead"],
      "properties": {
        "operation": { "const": "deleteBead" },
        "bead": { "$ref": "#/$defs/resourceReference" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" }
      },
      "additionalProperties": false
    },
    "createLink": {
      "type": "object",
      "required": ["operation", "type", "source", "target"],
      "properties": {
        "operation": { "const": "createLink" },
        "name": { "$ref": "#/$defs/name" },
        "id": { "$ref": "#/$defs/resourceReference" },
        "type": { "$ref": "#/$defs/typeId" },
        "source": { "$ref": "#/$defs/reference" },
        "target": { "$ref": "#/$defs/reference" },
        "properties": { "$ref": "#/$defs/properties" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "updateLinkProperties": {
      "type": "object",
      "required": ["operation", "link", "change"],
      "properties": {
        "operation": { "const": "updateLinkProperties" },
        "link": { "$ref": "#/$defs/resourceReference" },
        "change": { "$ref": "#/$defs/change" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "deleteLink": {
      "type": "object",
      "required": ["operation", "link"],
      "properties": {
        "operation": { "const": "deleteLink" },
        "link": { "$ref": "#/$defs/resourceReference" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "updateWhere": {
      "type": "object",
      "required": ["operation", "collection", "selector", "change"],
      "properties": {
        "operation": { "const": "updateWhere" },
        "collection": { "enum": ["beads", "links"] },
        "selector": { "$ref": "#/$defs/selector" },
        "change": { "$ref": "#/$defs/change" },
        "cardinality": { "$ref": "#/$defs/cardinality" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    },
    "deleteWhere": {
      "type": "object",
      "required": ["operation", "collection", "selector"],
      "properties": {
        "operation": { "const": "deleteWhere" },
        "collection": { "enum": ["beads", "links"] },
        "selector": { "$ref": "#/$defs/selector" },
        "cardinality": { "$ref": "#/$defs/cardinality" },
        "attribution": { "$ref": "#/$defs/attribution" }
      },
      "additionalProperties": false
    }
  }
}
```

`id` appears on both creation records because identity and Type are both
immutable. Omitting `id` asks the authority to allocate it. Omitting `type` is
never permitted. `properties` defaults to an empty object when omitted.

`bead` and `link` contain a durable local ID, an absolute canonical Resource
URL, or, in a batch only, an `@label` of the required Resource kind. `source`
and `target` are endpoint references accepting those same local Bead
spellings, an absolute out-of-Scope URI, or a Pinned Reference.
The authority performs reference resolution, canonicalization, label
resolution, and Resource-kind validation. A durable relative endpoint
reference resolves against the canonical Scope URL, not against the request
URL or the containing Link URL, and must name a live Bead. An absolute endpoint reference outside
the Scope is accepted as an opaque external reference, subject to the Link
Type's external-endpoint policy. Such an endpoint is not kind-checked or
dereferenced. Either endpoint may be supplied as a Pinned Reference under
[Batch-local Resource references](#batch-local-resource-references).
Neither case mutates an endpoint Bead or changes its revision — unless
the Link's type is owned by the source Bead's declared Type, in which
case the source's revision changes and the target's never does.

The singleton target for an operation accepts the corresponding record with
`operation` and `name` removed. The target URL supplies the meaning of
`operation`, and a batch supplies the meaning of `name`. Thus the batch schema
and singleton request bodies share one field vocabulary.

### Property-change values

BDP represents a Property Change as a bounded
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to
the Resource's `properties` object. It admits only `add`, `replace`, and
`remove`. The other patch operations — `move`, `copy`, and `test` — are
excluded from BDP v0. Operations execute in array order. `add` has RFC 6902
object replacement and array insertion/append semantics. `replace` and
`remove` fail when the target does not exist. JSON Pointer evaluation is
relative to the complete `properties` value.

```json
{
  "operation": "updateBeadProperties",
  "bead": "beads/task-42",
  "expectedRevision": "opaque-revision",
  "change": [
    {
      "op": "replace",
      "path": "/status",
      "value": "closed"
    },
    {
      "op": "remove",
      "path": "/obsolete"
    },
    {
      "op": "add",
      "path": "/resolution",
      "value": null
    }
  ]
}
```

This distinguishes assigning JSON `null` from removing a member. Applying the
patch must yield a JSON object satisfying every effective Type schema. If the
result equals the immediately preceding `properties` value under RFC 6902
Section 4.6 JSON comparison, the operation is a no-op. It preserves the
Resource revision and emits no `updated` Event.

### Set mutation objects

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section.

Set operations name one collection and carry a bounded JSONPath Selector:

```json
{
  "operation": "updateWhere",
  "collection": "beads",
  "selector": "$[?@.type == \"https://work.example/types/task\" && @.properties.status == \"ready\"]",
  "change": [
    {
      "op": "replace",
      "path": "/status",
      "value": "claimed"
    }
  ],
  "cardinality": {
    "min": 1,
    "max": 1
  }
}
```

```json
{
  "operation": "deleteWhere",
  "collection": "links",
  "selector": "$[?@.source == \"https://beads.example/acme/beads/task-42\" || @.target == \"https://beads.example/acme/beads/task-42\"]",
  "cardinality": {
    "max": 1000
  }
}
```

`collection` is exactly `beads` or `links`. A cardinality object may contain
inclusive `min`, `max`, or both. Set mutation is never paginated: the service
either mutates the complete matched set atomically or fails before commit.
Selectors are evaluated against candidates shaped like canonical responses, so
identity literals inside Selector strings use absolute canonical URLs. BDP v0
does not define `expectedMembers`. Callers that intend to mutate previously
observed identities use explicit operations with `expectedRevision` instead.

The candidate collection contains only Resources visible in the request's
Authorization View. Cardinality is measured over that projected match. If any
matched Resource is not writable, the operation fails atomically rather than
filtering that Resource out. The authority nevertheless evaluates global graph
constraints against complete authoritative state. It may return a
non-disclosing conflict when hidden state prevents the mutation.

The incident Link deletion can compose with explicit Bead deletion in the same
transaction:

```json
{
  "operations": [
    {
      "operation": "deleteWhere",
      "collection": "links",
      "selector": "$[?@.source == \"https://beads.example/acme/beads/task-42\" || @.target == \"https://beads.example/acme/beads/task-42\"]",
      "cardinality": {
        "max": 1000
      }
    },
    {
      "operation": "deleteBead",
      "bead": "beads/task-42",
      "expectedRevision": "opaque-revision"
    }
  ]
}
```

`deleteBead` does not cascade. The preceding `deleteWhere` is the explicit
atomic graph cleanup required before deleting a Bead with incident Links.

### Mutation Receipt responses

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire
> section. Read+Update uses inline singleton and sequence-member dispositions,
> not durable Mutation Receipts.

The response to a completed mutation is its durable Mutation Receipt
representation. A successful batch contains one entry per single-Resource
operation and, for a set operation, a `matched` entry followed by one entry
per selected Resource, in declaration order:

```json
{
  "id": "https://beads.example/acme/receipts/rcpt-7",
  "status": "completed",
  "detail": "available",
  "idempotencyKey": "client-key-0001",
  "scopeEpoch": "epoch-1",
  "authorizationView": "view-a",
  "transaction": "txn-0a1b",
  "requiredPosition": "pos-43",
  "effectPosition": "pos-43",
  "results": [
    {
      "operationIndex": 0,
      "operationName": "decision",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/dec-9",
        "type": "https://work.example/types/decision",
        "revision": "dec-9-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "properties": { "title": "Adopt owned Links", "status": "proposed" },
        "ownedLinks": { "https://work.example/types/cites": [] }
      }
    },
    {
      "operationIndex": 1,
      "operationName": "cite",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/9c1e",
        "type": "https://work.example/types/cites",
        "revision": "9c1e-r1",
        "attribution": { "principal": "agent:planner", "status": "claimed" },
        "source": "https://beads.example/acme/beads/dec-9",
        "target": "https://beads.example/acme/beads/task-42",
        "properties": { "role": "evidence" }
      },
      "source": "https://beads.example/acme/beads/dec-9",
      "sourceRevision": "dec-9-r2"
    },
    {
      "operationIndex": 2,
      "outcome": "updated",
      "resource": {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "task-42-r8",
        "properties": { "title": "Specify BDP mutation", "status": "cited" }
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-14T18:04:12Z"
}
```

For Resource operations:
Created and updated results carry complete postimages — the full Resource
state after the change — and revisions. Deleted results carry the deleted
canonical identity. An admitted no-effect mutation reports the current
`requiredPosition` and omits `effectPosition`. A pending duplicate uses the
same receipt `id` with `status` equal to `pending`. The client may wait,
repeat the original request, or read that receipt until it becomes terminal.

`authorizationView` records the view under which the operation executed. A
later policy change does not create a new idempotency namespace, and it does
not permit the mutation to run again. Reading the receipt after such a change
returns its unchanged identity and disposition, but the detailed `results` and
problem information are re-authorized under the caller's current view. The
recorded `requiredPosition` remains evidence about the original view; it is
not a valid minimum-read checkpoint for the replacement view.

When all results fit within the advertised bound, the original response
contains them and `next` is `null`. No follow-up request is required.
Otherwise the response contains the first page and an absolute `next` URL for
another immutable page of the same receipt. The transaction creates that
result atomically. Pages never truncate or recompute it, and receipt retention
determines how long results stay available.

If an operation fails after admission, the synchronous response is the
terminal Mutation Receipt with `status` equal to `failed`. It carries one
problem value that identifies the failing operation by zero-based
`operationIndex` and, when present, by `operationName`. The receipt
contains no committed operation results because the complete transaction
is rolled back. Retrying returns that same failed receipt. It does so for
as long as the failed receipt is retained, under
[Mutation Transactions](#mutation-transactions). Request syntax and
authentication failures that occur before admission return a direct
problem response and do not create receipts.

Every admitted mutation has one Mutation Receipt at an authority-allocated
URL beneath the discovered `receipts` root — `receipts/{token}`, where the
token is a checkpoint-profile token — and the receipt's `id` is that
absolute URL. `GET` and `HEAD` of the receipt URL return the receipt's
current representation with `200 OK`, `Cache-Control: private, no-store`,
and the Transactional response fields. A receipt URL that does not exist,
that belongs to another principal, that was retracted under
[Mutation Transactions](#mutation-transactions), that named a failed
receipt the authority has since forgotten under the same section, or that
was allocated in another Scope epoch returns the uniform `404`
`resource-not-found`: receipts are principal-bound, and they are not an
enumeration oracle. The `receipts` root is a namespace prefix, not a
Resource: it is discovered so that receipt URLs are recognizably the
authority's and clients never construct them, BDP v0 defines no receipt
listing and no lookup by key, and a `GET` of the root returns `404`
`resource-not-found`. A client resolves a lost response by retrying the
original request with its original key, which returns the receipt.

A receipt's `status` is `pending` until the transaction is terminal and then
exactly one of `completed` or `failed`, forever. Every receipt carries `id`,
`status`, `idempotencyKey`, `scopeEpoch`, `authorizationView`, and
`transaction`, the opaque identity every Event and change group of the
transaction carries. A terminal receipt additionally carries
`requiredPosition` and `detail`, and, when the transaction produced a change
group, `effectPosition`. `detail` states what the representation discloses
beyond the disposition: `available` — the results or the problem are
present; `expired` — the authority discarded a completed transaction's
results under its receipt retention; `withheld` — the caller's current
Authorization View may not see any of them. When `detail` is `available`, a
`completed` receipt carries `results`, `next`, and `expiresAt`, and a
`failed` receipt carries `problem` and `expiresAt`. `expiresAt` is the
instant until which the authority retains what the representation
discloses — a completed receipt's detail, and a failed receipt's disposition
and detail alike; when discovery advertises `retention.receipt`, it MUST be
no earlier than the terminal instant plus that duration. After `expiresAt`
the authority MAY discard a completed receipt's detail and serve the
receipt with `detail` `expired`. What it never discards is a completed
transaction's compact receipt — the key, the normalized request identity,
the disposition, the positions, and, for every creation operation, the
identity it allocated — which it retains for the rest of the Scope epoch,
because exactly-once protects committed effects. An `expired` `completed`
receipt therefore carries `allocated`: one entry per creation operation in
operation order, with the operation's `operationIndex`, its
`operationName` when it declared one, and the allocated `id` and `type` —
the same identities the vanished `created` entries carried and the ones a
later `@name` reference in a sequence still resolves through. An identical
retry after expiry returns the `expired` receipt with `200 OK` and never
executes the mutation again. A failed receipt is forgotten whole rather
than expired: after `expiresAt` the authority MAY forget it — disposition
and detail alike, since the transaction committed nothing and allocated
nothing durable — and MAY retain it longer; a failed receipt never enters
`detail` `expired`, and once it is forgotten its URL answers the uniform
`404` and its key is unknown, so a later presentation executes as new,
under [Mutation Transactions](#mutation-transactions).

`results` is an ordered array of result entries in the vocabulary of
[Mutation results](#mutation-results), with singleton alias results under
[Transactional alias mutations](#transactional-alias-mutations). Each entry carries the zero-based
`operationIndex` of the operation that produced it and, when that operation
declared one, its `operationName`. A single-Resource operation produces
exactly one entry: `created` or `updated`, carrying `resource`, the
complete postimage — the Resource's state immediately after that
operation, which a later operation in the same transaction may supersede —
or `deleted`, carrying `deleted`, the deleted Resource's identity record —
`resourceKind` and `resource`, holding `id`, `type`, and final live
`revision` — the `deletedIdentity` record of
[Mutation results](#mutation-results). A semantic no-op update, defined
under [Revisions](#revisions), produces an `updated` entry carrying the
postimage at the retained revision, and a transaction all of whose
operations are no-ops is an admitted no-effect mutation: it completes,
produces no group, and its receipt omits `effectPosition`. An entry for an
operation on an owned Link additionally carries `source`, the source Bead's
canonical URL, and `sourceRevision`, the source Bead's resulting revision,
on creation, update, and deletion alike; on a no-op update
`sourceRevision` is the source's unchanged revision. A set operation
produces one `matched` entry carrying `count`, the number of Resources it
selected, followed by one `updated` or `deleted` entry per selected
Resource in ascending code-unit order of their canonical `id`s, the order
in which the operation expands under
[Events and Event Sources](#events-and-event-sources); a zero-match
operation produces its `matched` entry with `count` `0` and nothing else.
Entries appear in operation order. `page.maximumItems`, when advertised,
bounds the entries in the receipt's inline `results` and in each page,
every entry counting as one whatever its outcome; when it is not, the
authority applies a bound of its own. When every entry fits within the
bound, `results` holds them all and `next` is `null`; otherwise `results`
holds a prefix and `next` is an absolute URL whose `GET` returns a
`mutationReceiptPage` — `receipt`, the receipt's `id`; `results`, the next
entries; and `next`. Pages are immutable in what they record, never split
an entry, and are served through the same projection as the receipt. After
the receipt's detail expires, a page URL returns `410` `cursor-expired`,
decided after authentication and the receipt's non-disclosure rule.

Every delivery of a receipt — the synchronous response, the response to a
duplicate, a later `GET` or `HEAD`, every page, and the projection of a
member's receipt into a sequence response — is one representation, the
receipt as retained projected under the serving request's current
Authorization View. An entry that carries a Resource record — `created`
or `updated` — is served only when the current view projects that record
as retained, whether or not the Resource still exists or is at that
revision, and the view's closure over owned Links applies: hiding a Bead
hides the entries of every Bead that owns a Link to it and of those Links.
An entry the view does not project is served as `withheld`, carrying only
`operationIndex` and, when present, `operationName`; an `allocated` entry
is re-authorized the same way and carries `withheld` `true` in place of its
identity. Entries that carry no record — `matched` counts, `deleted` and
`erased` identities, and `withheld` entries — and a `failed` receipt's
`problem` are the transaction's own execution facts, disclosed to the
principal when it executed, and are served as retained. Alias result entries
are non-Resource execution facts under this same rule (ruled 2026-09-08, T49).
When a `completed`
receipt's every entry is withheld, the receipt carries `detail` `withheld`
and neither `results`, `next`, nor `allocated`; a `failed` receipt is never
`withheld`. The disposition, `requiredPosition`, and `effectPosition` are
never withheld. Withholding is authorization, never deletion: an entry
whose Resource was since deleted is served like any other when the view
projects its retained record.

A receipt is a store of every version its postimages carry, and
[Version erasure](#version-erasure) reaches it: from the moment the
authority processes the erasure record, on every delivery path and
whatever `expiresAt` promised, an entry whose postimage is an erased
version never carries the content again. To a caller authorized for the
subject's retained history — the one authorization that gates the
`resource-erased` disclosure under [Reads after deletion](#reads-after-deletion)
— the entry is served as `erased`: `operationIndex`, `operationName` when
present, `erased`, the version's lineage marker `{ id, type, revision }`,
and `source` and `sourceRevision` when the operation was on an owned Link.
To every other caller it is the uniform `withheld` entry, so that a receipt
is no more an erasure oracle than a read is.

The three Transactional response fields on a receipt or page response are
the serving request's own observation, never the body's history:
`BDP-Scope-Epoch` and `BDP-Authorization-View` carry the current epoch and
the caller's current view token, and `BDP-Scope-Position` carries the
position the read observed — at or after `effectPosition` on a terminal
receipt served synchronously, honoring `BDP-Minimum-Scope-Position` on a
later read exactly as any read does, and the observed head on a `202`. The
body's `scopeEpoch`, `authorizationView`, `requiredPosition`, and
`effectPosition` are the execution's recorded facts and never change; after
a view rotation the body still names the view under which the transaction
executed, and the recorded `requiredPosition` remains evidence about that
view rather than a checkpoint for the current one.

A `failed` receipt's `problem` is a Problem Details object of the receipt
form. It carries the code's `status` — the HTTP status the failure would
have had as a direct response, required because the enclosing status is
`200 OK` — and `operationIndex`, the zero-based index of the operation
being evaluated when the failure was detected, with `operationName` when
that operation declared one. A failure the authority establishes for the
transaction as a whole rather than at one operation — a `limit-exceeded`
on `transaction.duration`, `transaction.inducedEvents`,
`transaction.examinedResources`, `transaction.matchedResources`, or
`transaction.mutatedResources` counted across operations, or an
`aggregate-constraint-violation` established at commit — omits
`operationIndex` rather than fabricating one. When the authority can locate
the cause within the request, the problem carries `pointer`, an RFC 6901
JSON Pointer into the request body as submitted, so that in a batch it
begins with `/operations/{operationIndex}` and in a singleton it addresses
the record directly. A `limit-exceeded` problem SHOULD carry `limit`, the
dotted name of the crossed limit under `limits`. Exceeding
`transaction.duration` is permanent, not transient: the request as written
does not fit the advertised bound, the receipt fails with `limit-exceeded`
and `limit` `transaction.duration`, and the client divides the work under
new keys. A `validation-failed` problem carries `diagnostics` and, when it
truncated them, `diagnosticsTruncated`, exactly as
[Problem details](#problem-details) defines them for the Read+Update rows.
A `failed` receipt's problem describes the rejected request, not a
committed version, and lies outside erasure; an authority that nonetheless
quoted a committed version's content in `detail` or a diagnostic scrubs it
as a store would.

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

The `selector` value is the same JSONPath Selector string accepted by
`updateWhere` and `deleteWhere`. It is percent-encoded in the request target:

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

### Operation Directory and singleton targets

> **Transactional/Replication entries within this section.**
>
> Read+Update uses the six single-Resource entries, the two alias entries,
> and `sequence`. `update-where`, `delete-where`, `batch`, one-operation transaction
> desugaring, transaction-level idempotency, and Mutation Receipt responses
> apply only to Transactional.

The discovered `operations/` Resource is a directory of the generic mutation
targets available under the Scope's profile. The Transactional profile's
initial children are:

```text
POST operations/create-bead
POST operations/update-bead-properties
POST operations/delete-bead
POST operations/create-link
POST operations/update-link-properties
POST operations/delete-link
POST operations/put-alias
POST operations/delete-alias
POST operations/sequence
POST operations/update-where
POST operations/delete-where
POST operations/batch
```

`GET operations/` returns these names and relative target URLs as a JSON
object. That lets a client follow the directory rather than construct paths.
For a Transactional Scope the response is:

```json
{
  "createBead": "create-bead",
  "updateBeadProperties": "update-bead-properties",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLinkProperties": "update-link-properties",
  "deleteLink": "delete-link",
  "putAlias": "put-alias",
  "deleteAlias": "delete-alias",
  "sequence": "sequence",
  "updateWhere": "update-where",
  "deleteWhere": "delete-where",
  "batch": "batch"
}
```

A Read Scope does not advertise `operations` and has no BDP Operation
Directory. A Read+Update Scope's directory contains exactly eight singleton
targets — the six Resource targets plus `put-alias` and `delete-alias` —
and `sequence` (amended 2026-09-08):

```json
{
  "createBead": "create-bead",
  "updateBeadProperties": "update-bead-properties",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLinkProperties": "update-link-properties",
  "deleteLink": "delete-link",
  "putAlias": "put-alias",
  "deleteAlias": "delete-alias",
  "sequence": "sequence"
}
```

In the Transactional profile, each of the six Resource singleton targets
accepts the members
defined by its operation record, excluding the batch-only `operation`
discriminator and `name` label. The request executes as a one-operation
Mutation Transaction. It returns the same Mutation Receipt shape with a
one-element `results` array (amended 2026-09-08, council 12); the two set
targets `update-where` and `delete-where` return it with a `matched` entry
followed by one entry per selected Resource, under
[Mutation Receipt responses](#mutation-receipt-responses) (amended
2026-09-08, Transactional apply). The alias targets return a one-entry Mutation Receipt under
[Transactional alias mutations](#transactional-alias-mutations), without
Scope history or replicated alias state (ruled 2026-09-08, T49).
Transactional singleton requests require
`Idempotency-Key` and cannot use `@label` references.

Within the Transactional profile, the singleton and batch forms have identical
allocation, patch, validation, authorization, idempotency, concurrency, event,
and deletion semantics. The Read+Update profile preserves the existing
`create-bead`, `update-bead-properties`, `delete-bead`, `create-link`,
`update-link-properties`, and `delete-link` target names and their operation
request records, adds the alias targets `put-alias` and `delete-alias`
under [Alias targets](#alias-targets), and adds `sequence`. Each
Read+Update singleton requires an `Idempotency-Key` HTTP field. It returns
its final Resource postimage, deleted identity, alias result, or direct
problem inline rather than a Mutation Receipt.
Read+Update does not include the set-oriented `update-where` or `delete-where`
targets, which require selection and mutation at one serialization point. It
also does not include `batch`.

Concretely, each Read+Update singleton target accepts `POST` with an
`application/json` body containing its operation record with `operation`
and `name` removed — the bundle defines `createBeadRequest`,
`updateBeadPropertiesRequest`, `deleteBeadRequest`, `createLinkRequest`,
`updateLinkPropertiesRequest`, `deleteLinkRequest`, `putAliasRequest`, and
`deleteAliasRequest` — and one required
`Idempotency-Key` field carrying a key under
[Idempotency keys](#idempotency-keys). A singleton never accepts `@name`,
bare or within a Pinned Reference; the bundle's singleton request
definitions reject the spelling, so it is carrier syntax rejected before
execution with `malformed-request`.
A successful singleton returns `200 OK` whose body is the mutation result
defined under [Mutation results](#mutation-results) — or, for an alias
target, the alias result defined under [Alias targets](#alias-targets) —
and carries no `ETag`
and no `Location`: the operation target is not the Resource's URL, and the
result's `resource.id` and `resource.revision` say what those fields would.
A failed singleton
returns the direct problem at its code's HTTP status; a singleton whose
key is retained, in flight, conflicting, or expired answers exactly as the
corresponding sequence member would, as a direct response. Singleton and
sequence forms share one idempotency namespace, one semantic-identity
rule, and one retention rule. Mutation responses carry
`Cache-Control: private, no-store`. A mutation target responds
`405 Method Not Allowed` with `Allow: POST` to every other method, and the
Operation Directory responds `405` with `Allow: GET, HEAD` to every method
but those two; both follow the Read profile's `405` rule — no BDP Problem
body — and its `OPTIONS` rule: when cross-origin access is enabled,
`OPTIONS` is answered according to the CORS rules rather than with `405`
and joins `Allow`; listing it in `Allow` is not the preflight behavior. The
bundle defines the Read+Update discovery document as `readUpdateDiscovery`
and the directory response above as `readUpdateOperationDirectory`.

BDP v0 does not additionally define `POST` on collections or `PUT`, `PATCH`,
or `DELETE` on individual Resource URLs. BDP v0 also does not add a POST-based
read selector fallback. Services enforce bounded GET request-target and
Selector limits and may pre-advertise them through `limits`. A future version
may add another read carrier if implementation evidence requires it.

### Scope snapshots

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section.

The discovered `snapshot` target creates one logical read-only snapshot using
safe `GET` semantics:

```http
GET /acme/snapshot HTTP/1.1
Host: beads.example
Accept: application/json
```

The response is a manifest anchored to one Scope checkpoint. It contains the
first page of each typed stream and may contain both streams completely:

```json
{
  "id": "https://beads.example/acme/snapshot?snapshot=snapshot-42",
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "opaque-scope-epoch",
  "authorizationView": "opaque-authorization-view",
  "scopePosition": "opaque-position-42",
  "checkpoint": "opaque-checkpoint-42",
  "expiresAt": "2026-08-05T19:22:00Z",
  "erasures": [],
  "beads": {
    "items": [
      {
        "id": "https://beads.example/acme/beads/person-7",
        "type": "https://people.example/types/person",
        "revision": "opaque-person-revision",
        "properties": {
          "name": "Person Seven"
        }
      },
      {
        "id": "https://beads.example/acme/beads/task-42",
        "type": "https://work.example/types/task",
        "revision": "opaque-task-revision",
        "properties": {
          "title": "Specify BDP mutation",
          "status": "open"
        }
      }
    ],
    "next": null
  },
  "links": {
    "items": [
      {
        "id": "https://beads.example/acme/links/assigned-to-81",
        "type": "https://work.example/types/assigned-to",
        "revision": "opaque-link-revision",
        "source": "https://beads.example/acme/beads/task-42",
        "target": "https://beads.example/acme/beads/person-7",
        "properties": {}
      }
    ],
    "next": null
  }
}
```

Each non-null `next` is an absolute URL that the server generates. That URL is
bound to the snapshot identity, the stream kind, the Scope epoch, the
Authorization View, the position, and the expiry. Bead and Link streams may be
paged independently, but they never move to a newer anchor. The authority
keeps the snapshot continuable through `expiresAt`. If the authority cannot
serve a page before then, that is a service failure, not an expired-cursor
result. A client stages all pages, then exposes the replacement generation
atomically only after both streams end.

`checkpoint` is the opaque, epoch-qualified value that is supplied as the
exclusive `after` cursor to the Scope changefeed. The authority retains every
group after `scopePosition` through `expiresAt`. Collection cursors remain
query snapshots. They do not substitute for this complete projected Scope
snapshot.

A snapshot manifest carries `erasures`, the erasure ledger projected for
the manifest's view under [Version erasure](#version-erasure), and a
replica applies those records before it publishes the replacement
generation. A snapshot's two streams describe one authorization projection:
every Link in that projection appears in the `links` stream, and all of
its in-Scope endpoint Beads appear in the `beads` stream. Visibility of a
Bead alone does not require an incoming or unowned Link hidden by that
view to appear (amended 2026-09-08, council 13). Every owned Link inlined in a
Bead record of the `beads` stream also appears as a first-class record in
the `links` stream, member for member. A replica stages both streams
completely and verifies that agreement before it publishes; a snapshot in
which an inline owned Link and its first-class record disagree, or in which
a Link's in-Scope endpoint is absent, is invalid, and the replica discards
it and fetches a new one rather than choosing an authoritative stream. The
same verification applies to a change group: a source Bead's `upsert` and
the `upsert` or `tombstone` of each of its owned Links MUST agree, and a
group whose entries disagree is rejected as an authority fault, never
applied in part. A snapshot anchored before an erasure record's position is
expired by that record in the view that receives it. The bundle defines
the manifest as `snapshotManifest`.

### Version erasure

Retention removals and erasures replicate oppositely, by nature. A store
aging history out of its advertised retention window is a per-store fact: a
replica with a longer window legitimately keeps what the authority dropped,
and retention removals therefore do not propagate. An **erasure** — a
version whose content must not exist — is the opposite: it MUST be applied
by every store, cache, and replica holding the version, and the changefeed
is the vehicle that carries the obligation.

An erasure occupies its own Scope position, carried by the Change Group's
`erasures` member as an **erasure record**: the subject's canonical
Resource URL, the erased `revision`, and a digest of the erased version
record taken before erasure — an object with a `scheme` naming the digest
discipline and a `value` carrying its bytes — so that version lineage
remains verifiable across the hole while the content itself is
unrecoverable. Erasure records induce no Event-Source Events: application
observation of an erased version is the disclosure surface, not the Event
stream, and an erasure-only group carries an empty `events` array.
Erasure records are projected per Authorization View like everything else
a group carries: a view receives the record only when the subject Resource
was observable in that view. A replica confined to a view that never saw
the Resource never held the version's bytes, has nothing to erase, and
learns nothing — such a view sees only the identifier-free projection
advance at that position, so the record cannot become the enumeration
oracle that [Reads after deletion](#reads-after-deletion) closes. Within a
view that receives the record, the obligation is unconditional. The
correction case commits the erasure record and the successor's
`StateChange` in one atomic group at one position. A replica applies an erasure when it
processes the record; a replica that has not yet processed it is behind, in
exactly the strict-read sense, and subject to the same
route-wait-or-fail-explicitly rule as any stale read. Versions are
immutable, so there is no partial in-place erasure: correcting content
means erasing the offending version and committing its corrected successor,
atomically in one change group when both are needed. Reads of an erased
version answer with the `resource-erased` disclosure under
[Reads after deletion](#reads-after-deletion). An erasure does not rotate
the Scope epoch: every token anchored at or after the erasure position
remains exactly as valid as it was (amended 2026-09-08, Transactional
apply, T28).

Each `erasures` entry carries `subject`, the canonical Resource URL;
`revision`, the erased version's token; and `digest`, an object with
`scheme` and `value`. BDP v0 defines exactly one scheme, `sha-256-jcs`:
`value` is the lowercase hexadecimal SHA-256 of the RFC 8785 (JCS)
serialization of the erased version's complete Resource record — the
record the authority served for that revision, `attribution` and
`ownedLinks` included and the `links` aggregate excluded — with JCS's
ES6 number serialization and its UTF-16 code-unit member ordering. Under
the number model of [Revisions](#revisions) every admitted number is a
binary64 value, so every record has exactly one canonical serialization
and one digest, and implementations agree on it without a BDP-specific
canonicalization rule. Digest computation never gates erasure: an
authority that cannot serialize a version under JCS has committed a value
outside the data contract, which is its own conformance failure; it erases
the content all the same, emits the record with the digest it computes
over its best canonical serialization, and reports the escape out of band,
and the mismatch a replica then reports is the correct audit signal for a
record that escaped the contract, never a reason to hold the content.

The **erased content** of a version is its record less its lineage marker
— everything but `id`, `type`, and `revision`: `properties`,
`attribution`, a Link's `source`, `target`, and pin, and a source Bead's
inline owned-Link records. The lineage marker, the erasure record, and the
digest survive erasure everywhere; the erased content survives nowhere.

An erasure group is an ordinary visible group at its own position —
`projectionAdvance` `false`, `transaction` present and minted by the
authority for the administrative act, which has no Mutation Receipt because
erasure is not a BDP operation. An erasure-only group, one that erases
historical versions and commits nothing, carries empty `changes` and
`events`. Because a source Bead's version record inlines its owned Links'
records, erasing an owned Link's version erases every source version that
inlined it: the authority emits one erasure record per erased version in
the same group, and each is applied on its own.

An authority MUST NOT commit an erasure of a Resource's live version
without, in the same group, either the successor's `upsert` postimage or
the Resource's `tombstone`; a replica never holds a live Resource without
content. When the group commits a successor, the successor's `updated`
fact is the delta from a version whose content must not exist, and an
ordinary Property Change — its `remove` and `replace` paths and prior
values — would disclose it. The successor's fact therefore carries the
content-free delta form: `change` is exactly one `replace` at the root
pointer `""` whose `value` is the successor's complete `properties`, and
`previousRevision` is the erased revision. The successor MUST differ in the durable state that determines its
revision — `properties` and, for a Bead, its complete inline owned-Link
set — or the group tombstones the Resource instead. An owned-set change
can mint a source Bead revision with unchanged Bead properties.

The root-replacement `change` above applies to a successor produced by a
property correction. For the owning Bead's successor induced by an owned
Link's correction or deletion, its `updated` fact instead carries only
`ownedLink`, never both delta forms. An owned Link's property correction
uses the content-free root replacement in its own `updated` fact and in
the nested `ownedLink.link.change` of the source's fact; deletion uses the
identity-only deleted transition. The source's new postimage carries the
complete resulting owned set. These are the existing exclusive delta
forms, not permission to rewrite an erased version in place or expose its
partial content (amended 2026-09-08, council 13).

Erasing a live version with a tombstone is an administrative deletion of
the Resource. It is subject to deletion safety — a Bead with a live
incident Link cannot be tombstoned, so the administrator first deletes or
erases those Links — and it induces the ordinary facts of a deletion: the
subject's `deleted` fact, an `unlinked` fact at each in-Scope endpoint of a
deleted Link, and, for an owned Link, the source Bead's fresh version, whose
postimage joins `changes` and whose `updated` fact carries `ownedLink` with
`operation` `deleted` and the Link's identity. Those facts carry the
administrative transaction identity and are subject to the withholding rule
below like every other Event, so that in the common case — every version
of a Link erased with its tombstone — its graph facts are withheld and only
the identity-bearing `deleted` fact is served. A group carrying a
live-version erasure is valid only when its successor `upsert` or
`tombstone` leaves every Link's in-Scope endpoints live, every view closed
over owned Links, and every owning source at a version whose inline owned
set agrees with the Links' first-class records.

A store, cache, or replica that processes an erasure record MUST, for the
named subject and revision:

1. discard the erased content wherever it holds it — the retained version
   record, stored change-group postimages, retained Events, Mutation
   Receipts and receipt pages, retained sequence dispositions, snapshots
   and snapshot pages, caches, and derived indexes — before it makes any
   further state visible;
2. retain the lineage marker, the erasure record, and the digest, so that
   an audit can prove which version once stood at that point without
   recovering it, and a replica SHOULD verify the digest against its held
   copy before discarding it and report a mismatch out of band — a mismatch
   never suspends the obligation;
3. answer reads of that version with the `resource-erased` disclosure to
   callers authorized for the subject's retained history and with the
   uniform `404` `resource-not-found` to every other caller; serve a
   receipt entry whose postimage was the version as `erased` to the former
   and as `withheld` to the latter, under
   [Mutation Receipt responses](#mutation-receipt-responses); and, for a
   tombstoned subject, keep serving the Event-Source cursors and the
   `deleted` fact its lineage marker permits;
4. withhold, from every Event Source it serves, every Event whose `data`
   carries erased content: the `created` or `updated` fact that minted the
   erased revision; the source Bead's `updated` fact whose `ownedLink`
   carries the erased Link version; and a `linked` or `unlinked` fact whose
   endpoint References are erased content — which is the case exactly when
   every version of the Link that carried them is erased, since a Link's
   endpoints are immutable across its versions. A `deleted` fact carries
   only a lineage marker and is never withheld. Withholding removes the
   Event from every projection and leaves its ordinal as a gap exactly as a
   hidden fact does; every served Event's cursor stays valid, a cursor
   whose Event was withheld remains a valid exclusive `after` position, and
   a group's `eventCount` counts the Events it serves;
5. carry the record onward on any changefeed and in every snapshot manifest
   it serves, under [Scope snapshots](#scope-snapshots); and
6. expire, in every view that received the record, every changefeed
   checkpoint and every snapshot anchored before the record's position, as
   the next paragraph requires.

An erasure record committed at position P invalidates, in each view that
receives it, every changefeed checkpoint and every snapshot anchored before
P: `minimumReplayPosition` advances to at least P, a read whose `after`
precedes P fails with `cursor-expired`, a page of a snapshot anchored
before P returns `410` `cursor-expired`, and the manifest's `expiresAt` is
superseded. A replica behind P therefore bootstraps from a fresh snapshot —
anchored at or after P, and so free of the erased content by construction —
rather than replaying the groups that carried it, and no group that
predates an erasure it must apply is ever served to it again. Within a view
that never received the record nothing expires.

An already admitted SSE stream that has emitted every complete group through
the head immediately preceding P may cross the erasure fence at P. The
authority MUST serialize that eligibility check, the advance of
`minimumReplayPosition`, and publication of the complete erasure group as
one ordered publication step. Only such caught-up streams receive the
complete group at P; their server-side stream position then advances to P.
No queued, not-yet-published pre-P group may be handed to the transport
after this step. Publication orders complete frames at the authority
boundary; it does not make network delivery instantaneous or revoke bytes
already handed to the transport. A stream still needing any
pre-P group is fenced and closed, and its client must acquire a fresh
snapshot. This exception belongs to the existing admitted stream, never to
a new finite read, stream admission, or reconnect (ruled 2026-09-08, T64).

Backpressure does not permit holding the fence open while an old queue
drains: a stream needing unpublished pre-P content is closed instead.
Frames already handed to the transport remain ordered before P, and the
receiver applies erasure cleanup to any retained earlier content.
A publication is one complete SSE message, not an acknowledgement that a
client received or applied it. The client advances its durable checkpoint
only after atomically applying the complete group. If disconnection races
publication or application, reconnect uses that durable checkpoint: one
before P is expired and requires resnapshot; one at or after P follows
ordinary exclusive replay. The authority MUST NOT infer application from a
socket write, skip the erasure on the client's behalf, or replay pre-P
content. Partial transmission never authorizes partial application. Thus
finite reads and reconnects retain T28's fence in both race outcomes.

Erasure records are identity-level state, outside fenced history. The
authority keeps every erasure record it has committed — the **erasure
ledger** — for the lifetime of the logical Scope, exactly as it keeps the
identity non-reuse guarantee, and the ledger survives restore, epoch
rotation, and view rotation. Every snapshot manifest carries `erasures`,
the ledger projected for the manifest's view — each record whose subject
was observable in that view — so that a replica installing a replacement
generation, after resnapshot, after a view rotation, or after a restore,
applies the same obligations to everything it retains from before: its
previous generation, retained groups, Events, receipts, indexes, and
caches. After a restore into a new epoch the authority also re-emits the
projected ledger as erasure-only groups at the new epoch's first positions,
before any other group, and no group of the prior epoch is served under the
new one. Epoch rotation never revokes an erasure obligation. A replica that
retains content whose erasure status it cannot establish — content held
under a view or epoch for which it can no longer obtain the ledger — MUST
discard that content.

### Scope changefeed

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section.

The discovered `changes/` Resource is the lossless replication suffix. A
client supplies exactly one explicit starting intent:

- `after={checkpoint}` to continue exclusively after a snapshot or previously
  applied group;
- the distinguished genesis checkpoint to request complete history when it is
  still retained; or
- `start=now` to deliberately observe only future groups.

Omitting both is an error. It never means “start at whatever history
remains.” A finite JSON read returns only complete change groups:

```http
GET /acme/changes/?after=opaque-checkpoint-42 HTTP/1.1
Host: beads.example
Accept: application/json
```

```json
{
  "scope": "https://beads.example/acme/",
  "scopeEpoch": "opaque-scope-epoch",
  "authorizationView": "opaque-authorization-view",
  "after": "opaque-checkpoint-42",
  "observedHeadPosition": "opaque-position-43",
  "groups": [
    {
      "scopeEpoch": "opaque-scope-epoch",
      "authorizationView": "opaque-authorization-view",
      "checkpoint": "opaque-checkpoint-43",
      "position": "opaque-position-43",
      "previousPosition": "opaque-position-42",
      "projectionAdvance": false,
      "transaction": "opaque-transaction-id",
      "eventCount": 1,
      "changes": [
        {
          "operation": "upsert",
          "resourceKind": "bead",
          "resource": {
            "id": "https://beads.example/acme/beads/task-42",
            "type": "https://work.example/types/task",
            "revision": "opaque-task-revision-2",
            "properties": {
              "title": "Specify BDP mutation",
              "status": "closed"
            }
          }
        }
      ],
      "erasures": [],
      "events": [
        {
          "id": "opaque-event-id",
          "ordinal": 0,
          "type": "updated",
          "source": "https://beads.example/acme/events/",
          "subject": "https://beads.example/acme/beads/task-42",
          "subjectType": "https://work.example/types/task",
          "transaction": "opaque-transaction-id",
          "time": "2026-08-05T19:14:02Z",
          "data": {
            "previousRevision": "opaque-task-revision",
            "revision": "opaque-task-revision-2",
            "change": [
              {
                "op": "replace",
                "path": "/status",
                "value": "closed"
              }
            ]
          }
        }
      ]
    }
  ],
  "next": null
}
```

`changes` contains two things: the final canonical postimages needed to
advance the Authorization View, and identity-bearing tombstones for Resources
that leave it. For an underlying deletion, a tombstone contains
`resourceKind`, the absolute `id`, the immutable `type`, and the final live
`revision`. For any other projection removal within a stable view, the
tombstone contains the last values visible in that view and does not assert
underlying deletion. A grant or revocation instead changes the view token and
requires a fresh snapshot. At most one normalized `changes` entry exists per
affected Resource.
`events` retains its visible semantic operation order and every Event's
zero-based authority-group `ordinal`, including gaps left by hidden facts.
Consumers do not derive application Events from postimages.

On the wire, a change group carries `scopeEpoch`, `authorizationView`,
`checkpoint`, `position`, `previousPosition`, `projectionAdvance`,
`transaction`, `eventCount`, `changes`, `erasures`, and `events`. `changes`,
`erasures`, and `events` are always present, and each is empty when the
group carries nothing of its kind; a visible group carries at least one of
the three non-empty. A `changes` entry is either an `upsert` — `operation`
`upsert`, `resourceKind`, and `resource`, the complete canonical Bead or
Link record at its final projected revision, without the `links`
aggregate — or a `tombstone` — `operation` `tombstone`, `resourceKind`,
and `resource` carrying the `id`, the immutable `type`, and the last
visible `revision`. A tombstone has the same shape whether the Resource
was deleted or merely left the view, because an authorization-projection
tombstone does not assert underlying deletion. A projection advance
carries `projectionAdvance` `true`, no `transaction`, `eventCount` `0`, and
three empty arrays. `eventCount` equals the number of entries in `events`
as the group is served. A finite read's `after` is the exclusive checkpoint
the page continues from: the requested `after`, or, for `start=now`, the
head checkpoint the authority observed when it admitted the request. The
bundle defines `changeGroup`, `stateChange`, `erasureRecord`, and the
finite read's page as `changefeedPage`.

When a transaction has no visible effect, the group is instead a projection
advance that carries no identifiers:

```json
{
  "scopeEpoch": "opaque-scope-epoch",
  "authorizationView": "opaque-authorization-view",
  "checkpoint": "opaque-checkpoint-44",
  "position": "opaque-position-44",
  "previousPosition": "opaque-position-43",
  "projectionAdvance": true,
  "eventCount": 0,
  "changes": [],
  "erasures": [],
  "events": []
}
```

It omits `transaction` and all Resource-derived values. It deliberately
reveals that an authority transaction occupied the position, but nothing about
its identity or contents.

The client applies an entire group atomically and advances its durable cursor
only to that group's `checkpoint`. `observedHeadPosition` is the projected
Scope head observed for the finite read. That lets a client recognize
catch-up even when `groups` is empty. A page and an SSE message never split a
group.

Accepting `text/event-stream` on the same Resource delivers one complete group
per SSE message. The SSE `id` is the group's checkpoint, `event` is
`change-group`, and `data` is the complete JSON group. On automatic reconnect,
`Last-Event-ID` overrides the original `after` value. A stale, unavailable,
foreign-epoch, or foreign-view checkpoint fails explicitly and requires a new
snapshot. The authority never advances it silently to
`minimumReplayPosition`. Existing caught-up streams cross an erasure
publication only under [Version erasure](#version-erasure);
reconnections retain the expiry rule even if the interrupted stream had
been eligible (ruled 2026-09-08, T64).

### Event replay and live observation

> **Transactional/Replication contract in this draft.**
>
> Read and Read+Update implementations may skip this section. Its complete
> cursor, replay, SSE, and transaction-framing contract is required only by the
> Transactional profile.

The discovered `events/` Resource is the application-facing Scope Event
Source. A Resource-scoped Event Source is selected with `view=events` directly
on the Bead or Link URL. These are deterministic projections of Events already
committed inside Scope change groups. They are not independent logs, and they
are not the lossless replication changefeed. An Event is visible only when its
fact is part of the projected transition: `created` and `linked` references
are visible in the post-state, `deleted` and `unlinked` references were
visible in the pre-state, and `updated` references are visible in both. Its
cursor is bound to that view. A changed view token requires a new snapshot or
Event-Source start, according to the source's retention contract. A finite
read returns Events in source order:

```http
GET /acme/beads/task-42?view=events&after=event-104 HTTP/1.1
Host: beads.example
Accept: application/json
```

```json
{
  "source": "https://beads.example/acme/beads/task-42?view=events",
  "events": [
    {
      "id": "event-105",
      "ordinal": 0,
      "type": "linked",
      "source": "https://beads.example/acme/beads/task-42?view=events",
      "subject": "https://beads.example/acme/links/assigned-to-81",
      "subjectType": "https://work.example/types/assigned-to",
      "transaction": "opaque-transaction-id",
      "time": "2026-08-04T19:12:45Z",
      "data": {
        "endpoint": "source",
        "link": {
          "id": "https://beads.example/acme/links/assigned-to-81",
          "type": "https://work.example/types/assigned-to"
        },
        "source": "https://beads.example/acme/beads/task-42",
        "target": "https://beads.example/acme/beads/person-7"
      }
    }
  ],
  "next": "https://beads.example/acme/beads/task-42?view=events&after=event-105"
}
```

`after` is an exclusive opaque cursor. Its spelling is the ID of an Event in
that Event Source. Omitting it starts at the earliest retained Event. `next`
continues after the last returned Event and is `null` when the read reached
the Source's current end. Event IDs and ordering have meaning only within
their Event Source. Each ID is stable for the Event's change-group checkpoint,
ordinal, and source projection.

Every Event record contains a source-local `id`, a stable change-group
`ordinal`, one of the five model-defined `type` values, the `source` URL, the
affected Resource `subject` and `subjectType`, an opaque `transaction`
identifier, an RFC 3339 `time`, and a Type-specific `data` object. Event data
contains deltas rather than Resource snapshots:

- `created` carries `revision`, the complete initial `properties`, and the
  created version's `attribution` when one was recorded. For a
  Link it also carries the `source` and `target` endpoint references, with a
  stored pin preserved byte-identically.
- `updated` carries `previousRevision`, `revision`, exactly one of `change`
  and `ownedLink`, and the new version's `attribution` when one was
  recorded. `change` uses the same committed Property Change representation
  accepted by singleton DML. `ownedLink` carries one owned-Link transition
  of the source Bead: `operation` is `created`, `updated`, or `deleted`, and
  `link` is the owned Link's complete record for the first, its own delta —
  `id`, `type`, `previousRevision`, `revision`, `change`, and `attribution`
  when recorded — for the second, and its identity — `id`, `type`, and final
  live `revision` — for the third.
- `deleted` carries only `revision`, meaning the final live Resource
  revision.
- `linked` and `unlinked` carry `endpoint`, a typed `link` reference, and the
  `source` and `target` endpoint references. They occur only in an in-Scope
  endpoint Bead's Event Source.

No Event carries a Bead properties snapshot other than that Bead's own
`created` Event. `linked` and `unlinked` carry no Resource properties at all.
`data.endpoint` is `source` or `target`. It states how the Link was incident
upon the in-Scope Bead whose Event Source is being read.

The Scope-level Event Source contains the committed Events visible across the
request's Authorization View. A Resource-scoped source contains the subset
required by the abstract model. All visible Events produced by one Mutation
Transaction carry the same `transaction` value and become visible together
after commit. A self-Link projects two endpoint Events into its Bead source,
one for `source` and one for `target`. Individual Event delivery is intended
for application observation. Replicas consume the containing Scope change
group atomically.

A client requests live delivery from the same Event Source and initial cursor
by accepting Server-Sent Events:

```http
GET /acme/beads/task-42?view=events&after=event-105 HTTP/1.1
Host: beads.example
Accept: text/event-stream

HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-store, no-transform
```

```text
id: event-106
event: updated
data: {"id":"event-106","ordinal":0,"type":"updated","source":"https://beads.example/acme/beads/task-42?view=events","subject":"https://beads.example/acme/beads/task-42","subjectType":"https://work.example/types/task","transaction":"opaque-transaction-id","time":"2026-08-04T19:14:02Z","data":{"previousRevision":"opaque-task-revision","revision":"opaque-task-revision-2","change":[{"op":"replace","path":"/status","value":"closed"}]}}

```

The SSE `id` and `event` fields repeat the JSON Event's `id` and `type`.
`data` contains the complete JSON Event record. A blank line terminates each
SSE event. The server may also send SSE comment lines as keepalives and a
`retry` field to suggest a reconnection delay.

Native browser [`EventSource`](https://html.spec.whatwg.org/dev/server-sent-events.html)
reconnects automatically and sends the most recently processed SSE `id` in the
`Last-Event-ID` request header. BDP treats that header as the exclusive replay
cursor for a live request. Because the reconnect uses the original URL, a
`Last-Event-ID` header overrides its original `after` query parameter. The
query parameter selects an initial cursor. The standard header advances it on
automatic reconnect. Clients never submit Events as mutation operations.

The receipt's `effectPosition` and the change group's Event ordinals identify
the Events a mutation produced. Mutation Receipts carry no separate Event
range. Event IDs, checkpoints, caching, and expired-cursor failures use the
cross-cutting contracts defined above.

### Normative conformance matrix

BDP v0 publishes one machine-readable, black-box conformance matrix. Cases
are tagged by cumulative profile, so an implementation runs only the Read,
Read+Update, or Transactional obligations it advertises. Tests exercise public
HTTP behavior and consume the normative schema bundle; they do not inspect an
implementation's storage or internal server interfaces.

The matrix covers, where applicable:

- discovery, client rejection of unsupported discovered versions and profiles,
  canonical references, Resource reads, collection selection, pagination,
  Type inventory, and incident Links;
- malformed input, schema failures, authorization projections, limits,
  problem codes, and retry dispositions;
- singleton mutation, revisions, idempotency, strict sequence order, local
  bindings, partial failure, and allowed request interleaving;
- Transactional ordering, atomicity, set mutation, receipts, Events, snapshot
  and changefeed agreement, disconnect recovery, expiry, restore, and
  Authorization View changes; and
- cross-implementation client/server combinations, including the reference
  implementations and every shipping product claiming the applicable profile.

The decision and coverage categories are normative. The matrix, fixtures, and
expected results must exist in the repository for an implementation to claim
complete acceptance evidence.

#### Read+Update conformance rows

The Read+Update rows below were drafted with the profile's wire artifacts.
Each names one obligation and binds the normative text that states it;
none carries an executable plan, a fixture realization, or evidence. The
metadata catalog file `packages/conformance/catalog/read-update-v1.json`
carries the same rows and no manifest binds it, so no runner report can
claim them. The lockstep tests over these artifacts check structure,
table, citation, and example consistency — that the rows mirror this
table, that every citation still appears in its anchored section, that the
bundle's problem branches mirror the code table, and that the illustrative
fixtures validate and align member by member — and establish none of the
behavior the rows describe. The rows become claimable only under the
evidence law in `packages/conformance/matrices/README.md`, and the
Read+Update profile is not realized until every row is proved.

| Row | Obligation |
| --- | --- |
| `read-update.discovery.document` | Read+Update discovery carries `operations` and no Transactional member |
| `read-update.discovery.aliases` | `aliases` is required in Read+Update discovery: every Read+Update Scope offers the alias targets, serves alias resolution, and advertises the member |
| `read-update.discovery.limits` | Read+Update discovery `limits` carries no `transaction` group and no `retention.receipt` or `retention.replay` |
| `read-update.discovery.operation-directory` | The directory lists exactly eight singleton targets — the six Resource targets plus `put-alias` and `delete-alias` — and `sequence` |
| `read-update.singleton.create-bead` | `create-bead` returns the created postimage; omitted `id` is allocated, supplied `id` is honored |
| `read-update.singleton.update-bead-properties` | `update-bead-properties` applies the patch, returns the postimage and fresh revision, and retains the revision on a semantic no-op |
| `read-update.singleton.delete-bead` | `delete-bead` returns the deleted identity, the identity then reads as `404`, and a live incident Link fails it with `incident-links-exist` |
| `read-update.singleton.incident-links-nondisclosure` | A Bead deletion blocked by hidden incident Links fails with `incident-links-exist` and withholds the hidden Links that caused it |
| `read-update.singleton.create-link` | `create-link` resolves endpoint spellings to canonical URLs and echoes a pin byte-identically |
| `read-update.singleton.update-link-properties` | `update-link-properties` returns the Link postimage; an unowned Link's update moves only the Link's own revision and versions no endpoint |
| `read-update.singleton.delete-link` | `delete-link` returns the deleted identity and the Link then reads as `404` |
| `read-update.singleton.owned-link-source-revision` | An effectful owned-Link creation, update, or deletion carries `source` and `sourceRevision` and versions the source; an unowned one carries neither and versions no endpoint |
| `read-update.singleton.owned-link-no-op` | A semantic no-op update of an owned Link retains the Link's revision and attribution and reports the source's unchanged revision in `sourceRevision` |
| `read-update.singleton.attribution` | The `attribution` input is recorded on every version an effectful mutation mints, the owned source's included; a semantic no-op keeps the prior version's revision and attribution |
| `read-update.singleton.expected-revision` | A matching `expectedRevision` applies; a stale one fails with `revision-mismatch` and changes nothing |
| `read-update.singleton.expected-revision-race` | Of two concurrent guarded updates of one Resource, exactly one applies and the other fails with `revision-mismatch` |
| `read-update.singleton.hidden-subject` | A subject or in-Scope endpoint hidden from the request's Authorization View fails with the uniform `resource-not-found`, never `revision-mismatch` or `forbidden` |
| `read-update.singleton.idempotency-key-required` | A missing, malformed, or repeated `Idempotency-Key` field is rejected with `malformed-request` before execution |
| `read-update.singleton.unauthenticated` | An unauthenticated request to a mutation target is rejected with `unauthenticated` before admission and creates no disposition |
| `read-update.singleton.idempotent-retry` | The same key with the same semantic identity returns the retained disposition, including the same allocated identity, without re-execution |
| `read-update.singleton.idempotency-conflict` | The same key with a different semantic identity fails with `idempotency-conflict` and leaves the retained disposition unchanged |
| `read-update.singleton.unsupported-media-type` | A non-JSON or undeclared request body media type is rejected with `unsupported-media-type`; media-type parameters are ignored |
| `read-update.singleton.method-405` | Mutation targets answer other methods with a bodyless `405` and `Allow: POST`; with cross-origin access enabled, `OPTIONS` is answered by the CORS rules and joins `Allow` |
| `read-update.singleton.no-local-bindings` | A singleton request that spells `@name`, bare or within a Pinned Reference, is rejected before execution with `malformed-request` |
| `read-update.singleton.result-headers` | A singleton success carries no `ETag` and no `Location`; `resource.id` and `resource.revision` say what those fields would |
| `read-update.alias.put-creates` | `put-alias` creates an alias to exactly one canonical in-Scope Bead and reports the absolute alias URL and the canonical target with outcome `created` |
| `read-update.alias.put-repoints` | `put-alias` on an existing alias repoints it as the same operation and reports `updated`, a put to the target the alias already has included; resolution then follows the new target |
| `read-update.alias.delete-releases` | `delete-alias` removes the alias and reports `deleted` with no `target`; the alias then resolves as `404`, and the path is reusable by a later put |
| `read-update.alias.uniqueness-invariant` | Alias paths and canonical Bead segments share one uniqueness namespace, checked first: a put on a committed Bead's path, a deleted one included, fails with `identity-taken`, and a Bead creation on a live alias path fails with `alias-path-taken`, a condition that clears when the alias is deleted |
| `read-update.alias.link-coexistence` | Link segments and alias paths coexist: a Link created at `links/foo` beside a live `alias/foo` collides with nothing |
| `read-update.alias.allocation-avoids-aliases` | An authority-allocated Bead id is never a live alias path |
| `read-update.alias.non-canonical-target` | A put whose `target` is an alias, a Link, or an external URI fails with `validation-failed`, carrying one diagnostic that names the cause |
| `read-update.alias.unknown-subject` | An unknown or invisible target, an unknown alias on delete, and an `alias` member beneath the wrong root fail with `resource-not-found`: aliases are not an enumeration oracle |
| `read-update.alias.carrier-syntax` | An `alias` value that violates the grammar or is no reference shape at all is carrier syntax: the sequence is rejected whole with `malformed-request` before any member executes, while a well-formed inadmissible target fails only its member |
| `read-update.alias.authorization` | Alias operations are authorized as mutations of the Beads they touch: a put requires write on the proposed target, a repoint or delete also on the current target, and an invisible current target makes the alias `resource-not-found` |
| `read-update.alias.forbidden` | A put or delete the principal may not perform fails with `forbidden` |
| `read-update.alias.no-version-minted` | Alias mutation mints no version: the target Bead's revision is unchanged by a put, a repoint, or a delete, and an alias result carries no revision |
| `read-update.alias.sequence-binding` | Alias members are sequence members with their own keys: a put's `target` may name a `@name` bound by an earlier Bead creation in the same sequence, a Link-bound `@name` is rejected before execution, an entry is the alias result plus `operationIndex` and never `operationName`, and alias dispositions are retained and replayed as every member's are |
| `read-update.alias.retained-without-reauthorization` | A retained alias disposition discloses no record and is returned as retained, inside a sequence as in a singleton, without replay re-authorization |
| `read-update.alias.reference-resolution` | An alias spelling as a `bead` subject or a Link endpoint resolves to the alias's current target when the member is reached and is stored and served canonical; one naming no live alias, or spelled as a `link` subject, fails with `resource-not-found` |
| `read-update.alias.reference-idempotency` | The semantic identity of a member that spelled a reference by alias records the resolution: a byte-identical retry after a repoint compares against the retained resolution and receives the retained disposition |
| `read-update.sequence.order-and-partial-commit` | Members run strictly in order; a failed member leaves earlier successes committed and later independent members run |
| `read-update.sequence.local-bindings` | A `@name` binding is usable after its creating member commits; a reference to a creating member whose retained disposition is a failure fails only its member with `binding-unavailable` |
| `read-update.sequence.transient-predecessor` | A member whose `@name` creator ended transiently in the same request fails with `idempotency-in-progress`, retains nothing, releases its claim, and later independent members still run |
| `read-update.sequence.expired-creator-binding` | An expired creator still binds `@name` through its tombstone's allocated identity and kind, so an unchanged dependent retry receives its retained disposition rather than a conflict |
| `read-update.sequence.retained-failure` | A retained failure answers a retry exactly as a retained success while retained: a failed creator and its `binding-unavailable` dependent return unchanged, and correcting the creator means new keys for its dependents |
| `read-update.sequence.member-problem-shape` | A member problem carries its would-be `status`, `operationIndex`, and `operationName` when declared, inside a `200 OK` envelope |
| `read-update.sequence.retry-after-hint` | A member problem with `retry: after-delay` MAY carry `retryAfter` delay-seconds; no other member problem carries it |
| `read-update.sequence.carrier-rejection` | An oversized member count, a repeated or invalid key or name, a forward, unknown, or wrong-kind `@name` reference, a malformed later member, a non-JSON-Pointer patch path, or a stray `Idempotency-Key` field is rejected before execution with a direct problem, and nothing executes |
| `read-update.sequence.contextual-validation` | Schema validity is not admission: Scope containment, Resource kind, `@name` kind, ownership, result correspondence, and key and name uniqueness are enforced by the authority, and a wrong-kind durable reference fails with `resource-not-found` |
| `read-update.sequence.idempotent-retry` | A retried sequence returns every retained disposition at the present member's position without re-execution |
| `read-update.sequence.disconnect` | An admitted sequence runs every remaining member to its terminal disposition after the client disconnects, and a retry recovers the lost response member by member |
| `read-update.sequence.internal-fault` | An unexpected internal fault mid-sequence is the body-less `500`; members with durable dispositions stay retained and the faulting member's claim is cleared |
| `read-update.sequence.interleaving` | No sequence-wide lock: an unrelated request completes between two members without waiting, and the later member observes its commit |
| `read-update.idempotency.in-progress` | A concurrent duplicate fails with `idempotency-in-progress` and executes nothing; a retry after the delay receives the retained disposition once the first presentation has one, and may otherwise still find the key in flight, transient, or expired |
| `read-update.idempotency.key-reservation` | A sequence claims every member's unknown key at admission in declaration order, so a concurrent resubmission is transient in every member the original will run and can neither execute ahead of it nor retain a disposition it would contradict |
| `read-update.idempotency.claim-atomicity` | A carrier's admission claims are one linearizable step: a competing presentation observes all of them or none, so identical sequences never split their keys, and no lock outlives admission |
| `read-update.idempotency.concurrent-dependent-retry` | A concurrent retry that meets its creator in flight fails the dependent member transiently and claims nothing, so the first presentation's dependent member commits and retains normally |
| `read-update.idempotency.transient-not-retained` | A transient disposition is never retained: a later presentation of the key executes the member |
| `read-update.idempotency.semantic-identity` | Semantic identity ignores the label, protocol defaults, member order, and local-versus-canonical spelling, and includes pins, attribution, revision guards, and array order |
| `read-update.idempotency.principal-isolation` | A key is scoped to the authenticated principal: another principal's identical key is unknown and executes, and carried `attribution.principal` plays no part |
| `read-update.idempotency.cross-carrier` | A sequence member and a singleton request presenting the same key in the same namespace present the same key and share one semantic identity |
| `read-update.idempotency.authorization-view` | An Authorization View change keeps the key, identity, and disposition retained; a replay re-authorizes disclosure, answers a no-longer-visible retained result with `forbidden`, and executes and replaces nothing |
| `read-update.idempotency.forbidden-retained` | A `forbidden` disposition is retained for the retention interval: a retry after a grant under the same key still answers `forbidden`, and the principal presents a new key |
| `read-update.idempotency.retention-minimum` | When `retention.idempotency` is advertised, a retry within it receives the retained disposition; when it is not, no client-known recovery window exists |
| `read-update.idempotency.expired` | A key whose retained disposition was discarded after the retention interval fails with `idempotency-expired` and never re-executes; the same key with different semantics remains `idempotency-conflict` |
| `read-update.idempotency.expired-failure` | A forgotten failure — retained for the interval, then discarded — leaves its key unknown, so a later presentation executes the member for the first time under its guards, while a committed disposition keeps its tombstone |
| `read-update.idempotency.durable-boundary` | The mutation, its identity, allocated identities, and disposition are one durable unit; after restart or failover a retry receives the retained disposition, and a cleared abandoned claim executes exactly once |
| `read-update.idempotency.crash-mid-sequence` | After an authority crash mid-sequence, committed members stay retained, unstarted members are not executed by recovery, and a resubmission completes the sequence in order |
| `read-update.idempotency.restore` | A restore that loses recovery state is a different logical Scope at a different canonical Scope URL, never a continuation of the old key namespace; Read+Update offers no other restore signal |
| `read-update.problem.table` | Every Read+Update code serializes with its exact family, status, retry disposition, Problem media type, and `private, no-store` protection |
| `read-update.validation.type-contract` | An inadmissible result fails with `validation-failed`, and an uninstalled Type fails with `type-not-installed`, changing nothing |
| `read-update.validation.diagnostics` | A Type-contract `validation-failed` carries `diagnostics` naming the effective Type and absolute keyword location within advertised bounds, and flags omitted entries with `diagnosticsTruncated` |
| `read-update.validation.identity-taken` | A supplied `id` that was ever committed, including a hidden or deleted one, fails with `identity-taken` — the one inherent existence signal, acknowledged as such |
| `read-update.validation.aggregate-constraint` | A mutation that would cross an advertised maximum endpoint multiplicity fails with `aggregate-constraint-violation` |
| `read-update.http.request-too-large` | A request body above the advertised `request.bodyBytes` is rejected with `request-too-large` before execution |
| `read-update.http.cache-no-store` | Every mutation response carries `Cache-Control: private, no-store` |
| `read-update.http.cors-idempotency-key` | With cross-origin access enabled, the CORS policy allows the `Idempotency-Key` request field and exposes `Retry-After` |

#### Transactional conformance rows

The Transactional rows below were drafted with the profile's wire artifacts
and applied from `docs/design/w1-transactional-packet.md` on 2026-09-08.
Each names one obligation and binds the normative text that states it;
none carries an executable plan, a fixture realization, or evidence. The
metadata catalog file `packages/conformance/catalog/transactional-v1.json`
carries the same rows and no manifest binds it, so no runner report can
claim them. The lockstep tests over these artifacts check structure,
table, citation, and example consistency — that the rows mirror this
table, that every citation still appears in its anchored section, that the
bundle's problem branches mirror the code table, and that the illustrative
fixtures under `fixtures/transactional/` validate and align — and
establish none of the behavior the rows describe. The rows become
claimable only under the evidence law in
`packages/conformance/matrices/README.md`, and the Transactional profile is
not realized until every row is proved.

A Transactional claim inherits the Read rows and the Read+Update rows whose
obligations the profile preserves — the Read+Update singleton obligations
are observed through the receipt's one entry — and retires the twelve
Read+Update rows the profile contradicts: the rows bound to Read+Update's
discovery document, limits, and directory shapes, to its inline singleton
result, to its refused, `410`, forgotten, and restore forms of the key
dispositions, and to direct-disposition replay and immediate internal-fault
claim clearing. The retiring row names them in its `retires` member, and the
selection rule excludes a retired row from the claim that retires it:

- `transactional.discovery.document` retires `read-update.discovery.document`
- `transactional.discovery.operation-directory` retires `read-update.discovery.operation-directory`
- `transactional.discovery.limits` retires `read-update.discovery.limits`
- `transactional.discovery.no-idempotency-retention` retires `read-update.idempotency.retention-minimum`
- `transactional.singleton.receipt` retires `read-update.singleton.result-headers`
- `transactional.receipt.reauthorization` retires `read-update.idempotency.authorization-view`
- `transactional.idempotency.concurrent-join` retires `read-update.idempotency.in-progress`
- `transactional.idempotency.expired-detail` retires `read-update.idempotency.expired`
- `transactional.idempotency.failed-retained` retires `read-update.idempotency.expired-failure`
- `transactional.restore.key-namespace` retires `read-update.idempotency.restore`
- `transactional.idempotency.cross-carrier` retires `read-update.singleton.idempotent-retry`
- `transactional.idempotency.durable-admission` retires `read-update.sequence.internal-fault`

The last two retirements preserve cross-carrier replay through receipts and
the bodyless internal-fault response while rejecting the Read+Update-only
direct-disposition and immediate claim-clearing obligations (amended
2026-09-08, council 13).

The alias rows below bind the locator-only Transactional receipt contract
ruled in T49. The Read+Update alias path and operation semantics remain
inherited; the general singleton receipt retirement already replaces their
profile-specific response vehicle.

| Row | Obligation |
| --- | --- |
| `transactional.discovery.document` | Transactional discovery has the exact required history and replication members |
| `transactional.discovery.operation-directory` | The Transactional Operation Directory lists all twelve targets |
| `transactional.discovery.limits` | Transactional discovery may advertise the transaction group and receipt and replay retention |
| `transactional.discovery.no-idempotency-retention` | Transactional discovery never advertises retention.idempotency |
| `transactional.batch.atomic-commit` | A multi-operation batch commits atomically with ordered postimages |
| `transactional.batch.local-references` | Batch-local labels bind staged identity, including as Link endpoints and inside pins |
| `transactional.batch.rollback` | A failing operation rolls back the complete batch into a failed receipt |
| `transactional.batch.label-errors` | Forward, unknown, duplicate, and wrong-kind labels are rejected before admission |
| `transactional.batch.envelope-errors` | A batch without exactly one header key, or with a body or per-operation key, is malformed |
| `transactional.batch.pre-admission-precedence` | Pre-admission checks run bounds, syntax, principal, key, then admission controls, and never consult key state for an invalid request |
| `transactional.batch.transaction-limits` | Advertised transaction limits fail the whole transaction without partial effect |
| `transactional.batch.duration-limit` | Exceeding transaction.duration is a permanent limit-exceeded failure naming the limit, not a transient abort |
| `transactional.batch.deletion-safety` | Deleting a Bead with live incident Links fails the transaction |
| `transactional.batch.owned-link-transitions` | Several owned-Link transitions of one source in one batch mint one source version and one updated Event each, in operation order, each carrying its attribution |
| `transactional.batch.no-op-entries` | A no-op update reports updated at the retained revision, and an all-no-op transaction completes without a group or effectPosition |
| `transactional.batch.revision-guard-race` | Racing guarded updates serialize into one success and one revision-mismatch |
| `transactional.batch.aggregate-constraint-race` | Racing Link creations cannot jointly cross a maximum multiplicity |
| `transactional.set.mutation` | Set mutation mutates the complete matched set and reports flat entries in canonical-uri order |
| `transactional.set.zero-match` | A zero-match set operation reports matched 0 and induces no Events |
| `transactional.set.cardinality` | A matched count outside the supplied cardinality fails the transaction with cardinality-violated |
| `transactional.set.singleton-targets` | The update-where and delete-where singleton targets accept the set-operation body without the discriminator and return receipts |
| `transactional.set.attribution-fanout` | A set mutation's attribution is recorded on every version it mints, owned sources included |
| `transactional.singleton.receipt` | Singleton targets execute one-operation transactions and return receipts under the batch statuses |
| `transactional.singleton.semantics` | A singleton and the equivalent one-operation batch have identical allocation, validation, idempotency, and Event semantics |
| `transactional.receipt.readable` | Receipts are independently readable with GET and HEAD |
| `transactional.receipt.pagination` | Large set results continue through immutable pages bounded by page.maximumItems, every entry counting as one |
| `transactional.receipt.page-expiry` | A page URL returns 410 cursor-expired after detail expiry, decided after authentication and non-disclosure |
| `transactional.receipt.nondisclosure` | Unknown, foreign-principal, retracted, forgotten, and prior-epoch receipt URLs share one 404 |
| `transactional.receipt.root` | The receipts root is a namespace with no listing or key lookup |
| `transactional.receipt.headers` | Receipt responses carry the serving request's observation in the response fields and the execution's facts in the body |
| `transactional.receipt.reauthorization` | A view change withholds record-bearing entries under owned closure without changing the disposition |
| `transactional.receipt.reauthorization-paths` | The synchronous response, a duplicate's response, later reads, pages, and sequence projections share one authorization projection |
| `transactional.receipt.non-record-entries` | Matched counts, deleted and erased identities, withheld entries, and failed problems are served as retained |
| `transactional.receipt.whole-withheld` | A completed receipt whose every entry is withheld reports detail withheld; a failed receipt is never withheld |
| `transactional.receipt.pending-202` | The original submission receives 202 only past the wait bound; a duplicate may receive it any time before terminal |
| `transactional.receipt.deleted-identity` | A deleted entry carries the identity record with the final live revision |
| `transactional.receipt.owned-link-source` | Owned-Link entries carry source and sourceRevision together on creation, update, and deletion |
| `transactional.receipt.problem-shape` | A receipt problem carries the would-be status, the failing operationIndex, and a request-body pointer |
| `transactional.receipt.transaction-level-failure` | A transaction-wide failure omits operationIndex rather than fabricating one |
| `transactional.receipt.validation-diagnostics` | A validation-failed receipt problem carries the Read+Update diagnostics and truncation marker |
| `transactional.receipt.no-transient-failure` | No failed receipt ever carries temporarily-unavailable |
| `transactional.receipt.expiry-allocated` | An expired receipt keeps its disposition, positions, and allocated identities and never re-executes |
| `transactional.receipt.retention-minimum` | expiresAt is no earlier than the terminal instant plus an advertised retention.receipt |
| `transactional.idempotency.concurrent-join` | Concurrent identical requests join one execution and one receipt |
| `transactional.idempotency.conflict` | A reused key with different semantics is refused without execution for as long as the key is bound |
| `transactional.idempotency.semantic-identity` | Semantic identity excludes name and the carrier, normalizes labels to the creator's index or supplied identity, and includes pins, attribution, guards, and order |
| `transactional.idempotency.cross-carrier` | A one-operation batch, the equivalent singleton, and the equivalent sequence member present one semantic request and share one receipt |
| `transactional.idempotency.key-grammar` | Keys are bare checkpoint-profile tokens compared byte-exactly, and an absent, repeated, or invalid key is malformed |
| `transactional.idempotency.expired-detail` | A retry after detail expiry receives the expired receipt with 200 and never re-executes |
| `transactional.idempotency.transient-abort` | A transient abort after admission retracts the pending receipt, unbinds the key, answers 503, and a retry executes anew |
| `transactional.idempotency.failed-retained` | A failed receipt is retained for at least retention.receipt and a retry returns it; once forgotten, its URL answers 404 and its key executes anew |
| `transactional.idempotency.durable-admission` | Admission records key, identity, pending receipt, transaction identity, and ownership as one durable step |
| `transactional.idempotency.ownership-fencing` | A commit succeeds only while the committing execution owns the pending receipt; a fenced execution produces no group |
| `transactional.idempotency.pending-recovery` | After a crash every uncommitted pending receipt is retracted within the bound; an older pending receipt is a conformance failure |
| `transactional.idempotency.one-key-state` | Every mutation route consults one authoritative key state |
| `transactional.sequence.member-transactions` | Each sequence member is a one-operation transaction with its own receipt, admitted in declaration order, in an unchanged envelope |
| `transactional.sequence.completed-projection` | A completed member projects its receipt's one entry in the Read+Update result shape |
| `transactional.sequence.in-flight-projection` | A member whose key is bound to a pending receipt projects a transient idempotency-in-progress problem without waiting or retaining |
| `transactional.sequence.expired-projection` | A member whose receipt detail expired projects idempotency-expired carrying the allocated identity of a creation |
| `transactional.sequence.pending-creator` | A dependent whose creator is pending or transient fails transiently and holds no key |
| `transactional.sequence.failed-creator` | A dependent whose creator's receipt is failed fails with binding-unavailable in its own failed receipt |
| `transactional.sequence.member-reauthorization` | A withheld entry projects as a forbidden member problem and an erased one as resource-erased to an authorized caller |
| `transactional.event.owned-link-delta` | Owned-Link mutations emit source updated Events carrying exactly one ownedLink delta |
| `transactional.event.owned-link-update-delta` | An updated owned-Link transition carries the Link's delta, not its record |
| `transactional.event.owned-link-deleted-identity` | A deleted owned-Link transition carries the Link's identity with its final live revision |
| `transactional.event.fact-order` | One owned-Link operation's facts are ordered lifecycle, graph facts source before target, then the source's updated fact |
| `transactional.event.no-op-owned-update` | A no-op owned-Link update versions neither the Link nor the source and emits no Event |
| `transactional.event.graph-facts` | Link lifecycle produces linked and unlinked facts at every in-Scope endpoint |
| `transactional.event.self-link` | A self-Link's one endpoint receives a source fact and a target fact in the same group |
| `transactional.event.set-expansion-order` | A set operation's induced facts and receipt entries follow canonical-uri order |
| `transactional.event.history-expired` | event-history-expired is disclosed only to a principal authorized for the subject's retained history |
| `transactional.event.cursor-after-withheld` | A cursor naming a withheld Event remains a valid exclusive after position, and eventCount counts served Events |
| `transactional.changefeed.group` | Change groups carry normalized postimages and ordered Events behind one checkpoint |
| `transactional.changefeed.wire-form` | Every group carries changes, erasures, and events; a visible group carries transaction and at least one non-empty array |
| `transactional.changefeed.sse` | SSE delivery frames one complete group per message |
| `transactional.changefeed.start-intent` | A changefeed read without an explicit starting intent is an error |
| `transactional.changefeed.owned-link-agreement` | A group carries the owned Link's and the source's postimages, and their inline and first-class records agree |
| `transactional.changefeed.consistency-fields` | Scope-bounded responses carry epoch, view, and position, and honor minimum positions |
| `transactional.changefeed.catch-up-timeout` | A minimum-position read that cannot be served within the wait bound fails with catch-up-timeout |
| `transactional.changefeed.replay-window` | Late, foreign-epoch, and foreign-view cursors fail explicitly |
| `transactional.changefeed.sse-reconnect` | SSE reconnection resumes from Last-Event-ID without gaps or duplicates |
| `transactional.changefeed.projection-advance` | A hidden transaction projects an identifier-free advance |
| `transactional.changefeed.owned-closure` | Feeds and Event Sources project owned Links with their visible source |
| `transactional.snapshot.rendezvous` | A snapshot checkpoint continues losslessly into the changefeed |
| `transactional.snapshot.closed-projection` | A snapshot is a closed projection whose inline and first-class owned-Link records agree; a disagreeing snapshot is rejected |
| `transactional.snapshot.expiry` | A snapshot stays continuable through expiresAt, and a page it cannot serve before then is a service failure |
| `transactional.snapshot.erasure-ledger` | Every snapshot manifest carries the erasure ledger projected for its view |
| `transactional.erasure.record-digest` | Erasure records propagate with a verifiable sha-256-jcs digest |
| `transactional.erasure.digest-domain` | BDP JSON follows the number model, so every record has one canonical serialization, and digest computation never gates erasure |
| `transactional.erasure.historical-version` | Erasing a historical version commits no state change and induces no Event |
| `transactional.erasure.live-successor` | A live-version erasure commits its successor in the same group; a property correction carries the content-free root-replace delta, an owned-Link-induced source successor carries only `ownedLink`, and the successor differs in the durable state that determines its revision |
| `transactional.erasure.live-tombstone` | A live-version erasure with a tombstone is an administrative deletion under deletion safety, inducing the ordinary facts |
| `transactional.erasure.owned-link-cascade` | Erasing an owned Link's version erases every source version that inlined it, one record each |
| `transactional.erasure.event-withholding` | Event Sources withhold every Event whose data carries erased content, leaving ordinal gaps |
| `transactional.erasure.graph-facts` | Graph facts are withheld exactly when every version of the Link that carried their endpoints is erased; deleted facts never are |
| `transactional.erasure.receipts` | Receipts and pages stop serving an erased postimage at once, serving erased to authorized callers and withheld otherwise |
| `transactional.erasure.replication-invalidation` | An erasure at P expires every checkpoint and snapshot anchored before P in the views that receive it |
| `transactional.erasure.retention-non-propagation` | Retention removals do not propagate; a longer-window replica keeps what the authority dropped, while erasure reaches it |
| `transactional.erasure.restore` | After a restore the ledger is re-emitted at the new epoch's first positions and no prior-epoch group is served |
| `transactional.erasure.unestablishable-content` | A replica destroys retained content whose erasure status it cannot establish |
| `transactional.erasure.view-projection` | An erasure record reaches only views that observed the subject |
| `transactional.erasure.reads` | Reads of an erased version disclose resource-erased without a pointer to authorized callers and 404 to everyone else |
| `transactional.erasure.epoch-unrotated` | An erasure does not rotate the epoch; tokens anchored at or after it stay valid |
| `transactional.http.status-matrix` | Every mutation-surface target answers with exactly the statuses of the matrix |
| `transactional.http.method-405` | Mutation targets answer non-POST methods with 405 and Allow: POST, with enabled CORS OPTIONS answered by the CORS rules |
| `transactional.http.problem-table` | Every Transactional Problem preserves its status, family, code, and retry row |
| `transactional.http.problem-contexts` | Direct and receipt codes are disjoint contexts, and the Read+Update key dispositions never appear as direct problems |
| `transactional.http.internal-fault` | A bodyless 500 or transport failure after admission decides nothing; the receipt records the disposition |
| `transactional.http.disconnect-admitted` | A disconnect after admission does not decide the outcome |
| `transactional.http.timestamps` | Every emitted instant is a valid RFC 3339 date-time with uppercase T and Z |
| `transactional.http.ijson-strings-objects` | Unicode scalar strings and unique decoded member names are checked as carrier syntax before execution |
| `transactional.http.token-profile` | Epochs, view tokens, positions, transaction ids, receipt tokens, and keys use the checkpoint character profile; revisions do not |
| `transactional.restore.epoch-fence` | A restore keeps canonical URLs and fences every prior-epoch token |
| `transactional.restore.key-namespace` | A prior-epoch key is unbound under the new epoch and executes anew, never as a replay |
| `transactional.alias.receipt` | Alias singletons use durable one-entry receipts with the ordinary key and replay rules |
| `transactional.alias.locator-only` | Alias changes occupy no Scope position and appear in no Event, change group or snapshot |
| `transactional.alias.no-batch` | Alias operations are excluded from atomic batch membership |
| `transactional.sequence.withheld-allocation` | An expired creation projects the disclosed identity or exactly withheld true |
| `transactional.sequence.withheld-binding` | Withheld allocation preserves internal binding and independently authorizes every dependent |
| `transactional.erasure.live-publication` | Only already admitted caught-up streams cross the atomic erasure publication fence |
| `transactional.erasure.disconnect-race` | Reconnect uses the atomically applied durable checkpoint and resnapshots when it precedes erasure |

### Open protocol questions

This ledger records the protocol questions raised against the draft and their
current state, in dependency order. The 15 questions below carry recorded
decisions or explicit artifact gates. Entries marked pending remain open. A
separate joint product/protocol decision selected
`https://github.com/gastownhall/bdp/` as the provisional v0
protocol-identifier prefix, with the release-stability rule stated above.

1. **Resolved 2026-08-08:** the required discovery member is `profile`, whose
   value is `read`, `read-update`, or `transactional` and names the highest
   cumulative profile. Minimum Read comprises Scope discovery; the Bead, Link,
   and Type inventories; individual Bead and Link reads; paginated collection
   retrieval and bounded selection; the Resource `properties` view; and the
   Bead `links` view. It excludes `include=links`, Resource and Scope Events,
   receipts, snapshots, changefeeds, and mutation targets. Domain-specific
   readiness computations remain client-owned behavior over those generic
   reads.
2. **Decision recorded 2026-08-08; wire artifacts pending before mutation:**
   Read+Update supplies individually atomic singleton mutations plus strictly
   declaration-ordered `sequence`. A sequence does not reorder or parallelize
   members, but it takes no sequence-wide lock and permits unrelated requests
   to interleave. Successes remain committed, failures do not stop independent
   later members, and successful creates may bind local IDs for later members.
   Each member has its own idempotency key and inline result. Revisions are
   opaque, `expectedRevision` is optional, and the profile has neither durable
   Mutation Receipts nor BDP Events. Transactional `batch` remains the
   distinct atomic carrier. **Wire artifacts drafted 2026-09-07, review
   pending:** the sequence request and response envelopes, mutation
   results, the `sourceRevision` member, key syntax and qualification,
   semantic identity, duplicate handling, and finite outcome retention are
   now drafted under [Read+Update sequence target](#readupdate-sequence-target)
   and [Operation Directory and singleton targets](#operation-directory-and-singleton-targets),
   with schema definitions, fixtures, and unclaimed conformance rows. The
   provisional judgments they rest on are recorded as numbered decisions in
   `docs/design/w1-read-update-decisions.md`. **Council review folded
   2026-09-07:** dependency normalization for transient creators, replay
   re-authorization, the durable boundary and recovery contract under
   [Durability and recovery](#durability-and-recovery), binding metadata in
   tombstones, mandatory Type-contract diagnostics, the recovery-window
   rule, key reservation at admission, static reference errors as carrier
   rejections, tombstones only for committed effects, the member-level
   `retryAfter` hint, and the deferral of alias mutation are applied
   provisionally as decisions D21–D31 and revisions of D3–D6, D10, D13,
   D15–D18, and D20; their ruling followed on 2026-09-08, and D1–D32 are
   now ruled or ratified. **Amended 2026-09-08 (D31
   ruled B):** alias mutation joins the profile — the two alias targets
   `put-alias` and `delete-alias`, their singleton and sequence records,
   the alias result, and the uniqueness namespace shared by alias paths and
   canonical Bead segments are defined under
   [Alias targets](#alias-targets), so the directory holds eight singleton
   targets plus `sequence`; the result shape and the residual judgment
   calls are recorded as decisions D33–D37. **Council 12 folded
   2026-09-08:** `aliases` is required in Read+Update discovery (D37,
   option 2), alias spellings are admitted and resolved in Resource
   records (D38), a Bead creation on a live alias path is
   `alias-path-taken` (D39), alias operations are authorized as mutations
   of the Beads they touch (D40), the admission claim step is one
   linearizable step (D26 clarified), and the D35 and D36 boundaries are
   restated; every decision is ruled (D38 last, 2026-09-08), so the
   Read+Update implementation wave may begin.
3. **Resolved 2026-08-08:** the required machine-discovery mechanism is the
   Scope response's registered `service-desc` Link field. A `200` Scope body
   may contain HTML, Markdown, or another human representation and may link to
   the descriptor, but machines do not scrape it. Discovery JSON and Operation
   Directory members are fixed BDP vocabulary. v0 defines no BDP-specific
   HTTP link relations.
4. **Resolved 2026-08-08:** discovery may omit `limits`. When present, its
   capability-specific groups use the names and units defined under Advertised
   limits, and every advertised value is binding. An absent object, group, or
   field means that bound was not pre-advertised, not that capacity is
   unlimited. Implementations must still fail normatively rather than
   silently truncate or partially apply work.
5. **Read artifact recorded 2026-08-12; later-profile definitions pending:**
   BDP v0 uses one normative JSON Schema 2020-12 bundle containing every
   public envelope and shared definition. Conformance and generated types
   consume that same offline artifact. The bundle now contains discovery and
   Read definitions, including paginated `types/` and closed Type Descriptor
   shapes. **Read+Update definitions drafted 2026-09-07, review pending:**
   the bundle carries the Read+Update discovery and Operation Directory
   shapes, the six singleton request records, the sequence request and
   response envelopes with their member records, results, and problems, the
   mutation result, the idempotency-key type, and the Read+Update Problem
   Details shape. **Tightened 2026-09-07 after council review:** singleton
   requests reject `@name` bindings in bare and pinned forms, patch paths are
   JSON Pointers, `source` accompanies `sourceRevision` on owned-Link results
   and both are rejected on Bead postimages, Type-contract diagnostics are
   mandatory, and `readUpdateAdvertisedLimits` rejects Transactional limit
   groups. **Corrected 2026-09-08 (D29 ruled C):** the `validation` limits
   group is Read+Update surface carried by `readUpdateAdvertisedLimits`
   alone, now a closed definition of its own; `advertisedLimits` and every
   other Read definition are byte-identical to the bundle the Read evidence
   cohort binds at `0b7d86e7`. **Ruled 2026-09-08 (cross-packet X1, option
   B):** a `deleted` result carries the identity record `deletedIdentity` —
   `resourceKind` and `resource: { id, type, revision }`, `revision` the
   final live revision — in place of a URL string, the shape both write
   profiles share; `resourceKind` and `resourceIdentity` are defined with
   it. **Amended 2026-09-08 (D31 ruled B):** the bundle carries
   `putAliasRequest`, `deleteAliasRequest`, `sequencePutAlias`,
   `sequenceDeleteAlias`, `aliasResult`, and `sequenceMemberAliasResult`,
   and `readUpdateOperationDirectory` pins eight singleton targets plus
   `sequence`. **Council 12 folded 2026-09-08:** `readUpdateDiscovery`
   requires `aliases`; `mutationResultMembers` rejects `source` and
   `sourceRevision` on a deleted Bead as on a Bead postimage;
   `validationDiagnostic.instanceLocation` is a `jsonPointer` and
   `schemaLocation` an `absoluteUri`; `readUpdateProblem` gains the
   `alias-path-taken` branch. **Transactional definitions drafted
   2026-09-08 (Transactional apply):** the bundle carries the Event
   surface, the batch envelope and its eight operation records, the
   set-operation bodies, Mutation Receipts and their pages, the
   Transactional problem shapes, change groups, changefeed pages, snapshot
   manifests, and the Transactional discovery document and Operation
   Directory — 55 definitions — pending review, with the judgments they
   rest on recorded in `docs/design/w1-transactional-packet.md` (T1–T48
   ruled or ratified; T49/T63/T64 ruled 2026-09-08; T62 direction selected,
   observable retry contract still open).
   Later-profile definitions gate their corresponding waves. This question
   closes when the complete reviewed bundle exists.
6. **Read table recorded 2026-08-12; later-profile rows pending:** BDP uses a
   small set of RFC 9457 problem families plus a normative `code`, fixed
   status, and `retry` disposition. The Read profile table is closed. Direct
   problem `status` is optional but, when present, must match the HTTP status.
   Extension members are allowed. Unsupported and repeated collection query
   parameters use `invalid-parameter`, family `request`, status `400`, and
   retry `never`. Sequence-member problems add required member `status`,
   index, and optional name. **Read+Update rows drafted 2026-09-07, review
   pending:** eleven rows — `unsupported-media-type`, `binding-unavailable`,
   `validation-failed`, `type-not-installed`, `identity-taken`,
   `revision-mismatch`, `incident-links-exist`,
   `aggregate-constraint-violation`, `idempotency-conflict`,
   `idempotency-in-progress`, and `idempotency-expired` — join the table
   under [Problem details](#problem-details) with a new `validation` family
   and the `415` and `422` statuses, mirrored in the bundle's
   `readUpdateProblem`. **Boundaries completed 2026-09-07 after council
   review:** a transient creator makes its dependent's `binding-unavailable`
   an `idempotency-in-progress`, a replay whose retained record the present
   view does not project is `forbidden`, wrong-kind durable references are
   `resource-not-found`, non-JSON-Pointer patch paths and `@name` in a
   singleton are `malformed-request`, and an owned-set overflow is
   `validation-failed`. **Amended 2026-09-08 (D31 ruled B):** the alias
   targets add no code: a taken alias path, or a creation on a live alias
   path, is `identity-taken`; an unknown or invisible target, or an
   unknown alias on delete, is `resource-not-found`; and an alias or
   non-canonical target is `validation-failed`. **Council 12 folded
   2026-09-08:** a twelfth row, `alias-path-taken` (`conflict`, `409`,
   `after-state-change`), takes the creation-on-a-live-alias-path
   direction (D39, provisional), since that condition clears when the
   alias is deleted; an `alias` member beneath the wrong root is
   `resource-not-found`; and reference faults are scoped by what the
   reference is — a subject, an endpoint or target, or no reference shape
   at all. **Transactional rows drafted 2026-09-08 (Transactional
   apply):** three rows — `cardinality-violated`, `event-history-expired`,
   and `catch-up-timeout` — join the table, and the direct and receipt
   contexts are closed in the bundle's `transactionalProblem` and
   `receiptProblem`. This question closes when every normative failure is present
   in the reviewed code table and schema bundle.
7. **Resolved 2026-08-08:** only Transactional exposes Scope epoch,
   Authorization View, visible position, and minimum-position HTTP fields.
   Read and Read+Update use Resource `ETag`s and snapshot-preserving cursors
   without cross-replica read-after-write guarantees. Scope data is
   private/no-store. Enabled CORS allows every supported BDP request field
   and exposes the required response and retry fields. SSE is
   no-store/no-transform.
8. **Resolved 2026-08-08:** Event IDs and checkpoints are case-sensitive,
   1–256 character ASCII tokens restricted to `[A-Za-z0-9_-]`. `genesis` is
   the reserved initial checkpoint. The identical token is safe in JSON,
   queries, HTTP fields, SSE `id`, and `Last-Event-ID`.
9. **Resolved 2026-08-08:** deleted, unknown, and non-visible Resources return
   the same `404` `resource-not-found` response for ordinary, properties, and
   incident Link reads. Non-reuse remains an internal obligation.
   Transactional Event history may outlive its deleted subject for its
   retention period.
10. **Resolved 2026-08-08:** authority-attested actor attribution is excluded
    from BDP v0. Authentication remains an authorization input. Private audit
    records and domain actor properties are not generic BDP guarantees.
    **Amended 2026-09-02:** a common carried-but-asserted `attribution`
    member exists ([Carried attribution](#carried-attribution)); it is
    data, not evidence, and any future attested form is a distinct member.
11. **Resolved 2026-08-08:** BDP defines no universal root Bead or Link Type.
    `describes` supplies Resource category, and `conformsTo` contains only
    domain-defined Type relationships.
12. **Resolved 2026-08-08:** per-Scope and per-Type OpenAPI publication is not
    a conformance requirement. The BDP project may publish one generated,
    non-normative OpenAPI document per protocol version. The specification
    and schema bundle remain authoritative.
13. **Decision recorded 2026-08-08; artifact pending:** one portable black-box
    matrix is cumulative by profile and covers positive, negative,
    concurrency, disconnect, expiry, restore, authorization-view, and
    cross-implementation behavior. The Read+Update rows drafted under
    [Read+Update conformance rows](#readupdate-conformance-rows) are metadata
    only and claim nothing, as are the Transactional rows drafted under
    [Transactional conformance rows](#transactional-conformance-rows)
    (2026-09-08). This question closes when its reviewed
    machine-readable matrix, fixtures, and expected results exist.
14. **Resolved 2026-08-08:** discovery optionally carries the unordered
    `maximumEndpointMultiplicity` array. Absence or an empty array means no
    such policy. Administrative replacement is atomic relative to mutations
    and may not introduce an already-violated maximum. Reads remain valid,
    and discovery changes its `ETag`.
15. **Resolved 2026-08-08:** every v0 Link has at least one in-Scope Bead
    endpoint. A future cross-Scope indexing profile may define ownership and
    lifecycle for Links whose endpoints are both external.

Implementation proceeds Read-first. Later-profile work begins only when its
schema, problem, and conformance artifacts are reviewed. Implementation
evidence feeds corrections back into this draft rather than silently defining
wire behavior.

### Deferred companion work and implementation evidence

This subsection is a non-normative development ledger. It records required
follow-on work so that it is not silently discarded:

- Define a separate administrator/operator specification for installing,
  pinning, inventorying, replacing, and evolving Type Descriptor contract
  closures. Core BDP clients do not receive those powers.
- Defer the non-normative mapping appendix for the `bd` domain until a working
  implementation of `bd ready` exists. Harvest the example from working code
  rather than inventing a second domain model in this specification.
- Build three pieces: a Node/TypeScript `bdp` client with the obvious generic
  protocol surface and a `bd` subcommand; a deterministic `bdptest` server
  for client conformance testing; and a `bdpbd` server that adapts the
  current `bd` CLI.
- Exercise this complete `bd` compatibility inventory: `bd init`, `bd create`,
  `bd show`, `bd list`, `bd ready`, `bd update`, `bd close`, `bd reopen`,
  `bd delete`, `bd purge`, `bd dep`, `bd query`, `bd config`, `bd count`,
  `bd version`, and `bd stats`. Inventory the exact `dep` and `query`
  subcommands before freezing that adapter surface. Treat true physical purge
  as an administrator concern rather than silently adding it to core BDP.
- Model `task`, `bug`, `feature`, `chore`, `epic`, and `decision` as separate
  nominal Bead Types, with shared contracts expressed through Type
  conformance. Do not introduce a secondary domain-kind discriminator into
  BDP.
- Continue implementing `bdp`, `bdptest`, and `bdpbd`, using those
  implementations to complete the normative conformance matrix.
