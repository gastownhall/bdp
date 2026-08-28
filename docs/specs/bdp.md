---
status: draft
intended-status: normative
version: 0
---

# Bead Protocol (BDP)

This document is the draft specification for Bead Protocol version 0 (BDP v0).
The complete specification is intended to become normative after review and
implementation validation.

## Status and conformance

The entire document is a single draft with one status. Its Bead Data Model,
JSON representations, HTTP interface, Event model, examples, and schemas are
all under review together and are all intended to become normative. Until the
draft is adopted, it is not a conformance target. Requirement language states
the intended BDP v0 contract.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** in this document are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) when, and only when, they appear
in all capitals, as specified by
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.html) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.html).

The discovery value `bdpVersion: "0"` names this complete protocol version; it
is not a feature level or a floating compatibility range. A client MUST inspect
Scope discovery and MUST NOT assume compatibility with a version it does not
implement. A service MUST NOT advertise version `0` for behavior that changes
the meaning of a v0 operation, representation, or invariant. The normative
schemas and extension points in this specification, rather than an implicit
minor-version rule, determine where additional members are allowed.

This draft is co-designed against other beads-related tools, infrastructure,
and stores, including a primary implementation vehicle that is not yet
public. At the baseline reviewed for this draft, that implementation
intentionally provides a `bd`-compatible Issue/Dependency model and
command-oriented API. Its data and storage schemas are deliberately
malleable. They describe current implementation state and migration work, not
a candidate BDP contract.

The primary design evidence BDP takes from that implementation is its process
and cache model: workspace authority, transaction boundaries, revisions and
watermarks, snapshot bootstrap, ordered change propagation, local
materialization, cache catch-up, and concurrency behavior. Its existing
Issue/Dependency, command, and wire surfaces are Work Item profile or
compatibility inputs rather than selected generic BDP behavior.

Implementation work there is expected to expose protocol pressure and provide
conformance evidence, but neither its storage schemas nor incidental
implementation-language choices define BDP. The current `bd`
implementation and the compatibility code that mirrors it are later migration,
compatibility, and subsumption targets; they supply requirements and failure
evidence but are not design authorities for the new data model or protocol.

Examples are illustrative and must remain consistent with the requirements they
demonstrate. Text explicitly identified as an open question, deferred feature,
storage design, or implementation history is not part of the intended BDP v0
contract unless and until the draft resolves it.

The `https://beads.example/` authority is reserved for deployment examples in
this draft. Production deployments use their own canonical Scope URL; they must
not treat example URIs as globally assigned Resource identities.

The BDP v0 protocol-identifier prefix is
`https://github.com/gastownhall/bdp/`. It assigns these well-known identifiers:

- normative schema bundle:
  `https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json`;
- problem-family prefix: `https://github.com/gastownhall/bdp/problems/`; and
- External Reference sentinel:
  `https://github.com/gastownhall/bdp/types/external-reference`.

These URIs are protocol identities; dereferenceability is not required for
their use or comparison. The normative schema artifact will be housed in this
open source repository at `schemas/bdp-v0.schema.json`, and conformance
validators MUST load it without network retrieval.

This provisional prefix knowingly occupies GitHub-controlled path space; it
does not assert that GitHub serves protocol artifacts at those paths. The
project accepts the hosting and reassignment risk while the draft namespace is
provisional. Implementations compare these identifiers exactly and MUST NOT
depend on dereferencing them.

The project may replace this prefix consistently across all draft artifacts
before the first BDP v0 release. If it does, every pre-release implementation
MUST rewrite persisted draft identifiers, fixtures, and generated artifacts
before claiming v0 conformance; pre-release identities carry no stability
promise. Once v0 is released, its published identifiers remain stable even if
the source repository moves. A later authority requires an explicitly
versioned protocol migration; implementations MUST NOT silently rewrite
persisted v0 identifiers to follow repository relocation.

## Conformance profiles and reading guide

BDP defines three cumulative profiles per Scope. A service may host Scopes at
different profiles, but one Scope has one advertised profile at a time. Claiming
a higher profile claims every lower profile:

| Profile | What it adds | What its implementer may ignore |
| --- | --- | --- |
| **Read** | Scope discovery and safe retrieval of canonical Bead and Link Resource records | All mutation sections and every Transactional/Replication sidebar |
| **Read+Update** | Read plus the six single-Resource targets and an ordered, non-atomic `sequence` carrier | Set mutation, atomic `batch`, Scope history, receipts, snapshots, Events, and changefeed replication |
| **Transactional** | The complete transaction and replication contract | Nothing |

The **Transactional** profile includes BDP's replication machinery. Throughout
this document, material exclusive to that profile is set off as a sidebar:

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip the marked section or
> construct. It imposes no requirement on those lower profiles.

The absence of such a sidebar does not silently settle an obligation that this
draft still lists as open. The profile definitions below and explicit profile
notes determine lower-profile behavior; sidebars identify material that is
safely ignorable.

The Read profile exposes no BDP mutation target and does not inherit
transaction, receipt, snapshot, changefeed, or replication obligations merely
because those facilities exist in a higher profile.

The minimum Read profile consists of:

- the canonical Scope response and its `service-desc` discovery document;
- the discovered `beads/`, `links/`, and `types/` inventories;
- individual canonical Bead and Link Resource reads;
- paginated Bead and Link collection retrieval with the structural predicates
  and bounded Selector defined below;
- the `properties` view for a Bead or Link; and
- the incident-Link `links` view for an in-Scope Bead.

The `include=links` aggregate, Resource Event views, Scope Events, receipts,
snapshots, changefeeds, and every mutation target are outside the minimum Read
profile. A higher cumulative profile inherits the complete minimum Read
surface. A product-specific readiness endpoint does not satisfy this surface:
readiness remains client-owned domain behavior computed from generic Bead and
Link reads.

The Read+Update profile retains the existing `create-bead`,
`update-bead-properties`, `delete-bead`, `create-link`,
`update-link-properties`, and `delete-link` operation URLs and request-record
shapes rather than introducing collection `POST` or direct Resource
`PUT`/`PATCH`/`DELETE`. Each singleton request is individually atomic. The
profile additionally requires `sequence`, an ordered carrier for those same six
operations. A sequence never reorders or parallelizes its members, but it takes
no sequence-wide lock: unrelated requests may interleave between members,
successful members remain committed after a later failure, and independent
members continue after a failure. It does not include `UpdateWhere`,
`DeleteWhere`, or `batch`.

Creation members in a sequence may bind a sequence-local name. A later member
may use that name as its Bead or Link identity, including as a Link endpoint.
The binding exists only when the earlier creation succeeds. A member that uses
an unavailable binding fails normally; later independent members still run.
Because unrelated mutations may interleave, a bound Resource may change or be
deleted before a later member uses it. Sequence-local binding is convenience,
not isolation.

Every Read+Update mutation member has its own idempotency key. Repeating the
same semantic member with the same key returns its retained outcome rather than
executing it again; reusing the key for different semantics is a conflict.
Creates and updates return the complete Resource postimage and opaque revision;
deletes return the canonical deleted identity. `expectedRevision` remains
optional for updates and deletes and produces a conflict on mismatch.
Read+Update has no durable Mutation Receipts or BDP Events.

In the profile name, **Update** denotes this complete single-Resource write set:
creation, properties change, and deletion. It does not mean only modification
of an existing Resource.

The `batch` name always means the Transactional profile's ordered,
all-or-nothing Mutation Transaction. Read+Update aggregation is named
`sequence` and has the separately committing, per-operation result and retry
behavior defined below; it never redefines BDP `batch`.

## The uniformity principle

The Bead Protocol (BDP) is a set of norms over the most widely adopted
protocols and formats of the Web. BDP applies these norms *uniformly* to reduce
the overhead of Bead implementations and to let generic clients work with
Beads without a domain-specific protocol surface.

This uniformity principle applies both to accessing a given collection of
Beads and to using uniform formats and operations across different Bead Types.

Put more directly, if you know how to work with *one* Bead Type, you know how to
work with *all* Bead Types.

Within one conformance profile, one common operation vocabulary,
representation envelope, and set of operation semantics apply to all Beads
and Links. A higher or lower profile changes availability and guarantees only
where its profile definition says so. Types may vary the validity constraints
on individual representations and Links; authoritative graph Scopes may vary
aggregate constraints. Neither changes how generic requests and responses are
formed or interpreted. A generic client does not need a Type Descriptor to make
a request or parse a response; it may consult the descriptor to predict whether
a requested state will be accepted. Scope membership is discoverable through
uniform generic mechanisms rather than domain-specific operations.

Domain types do not extend BDP's operation vocabulary. A Type Descriptor
contributes only a nominal Type ID, an optional JSON Schema over `properties`,
conformance to other Types, and, for a Link Type, constraints on in-Scope
source and target Beads. It cannot declare custom operations, queries, views,
or Events. Concepts such as `Task`, `Bug`, `Feature`, `Chore`, `Epic`,
`Decision`, and `WorkItem` are modeled as separate nominal Bead Types, not as a
secondary discriminator on one generic Type. Domain workflows such as
readiness, claiming, or closing are client responsibilities expressed through
the fixed generic BDP reads and mutations.

Installing, replacing, and governing Type Descriptors are administrator or
operator concerns. BDP v0 consumes installed descriptors but deliberately does
not define a client-facing Type-installation protocol. That protocol and Type
evolution belong in a follow-on specification.

BDP is a specific protocol that adheres to an abstract data model. The data
model does not restrict the underlying implementation, which might use file
directories, relational or non-relational databases, or repositories.

## Bead Data Model

This section defines Bead state and the complete Transactional-profile
operations that may change it. It is independent of storage, URLs, HTTP
methods, and wire payloads. The Read profile exercises only its state model;
the Read+Update profile selects the single-Resource operation records and
executes them singly or through its non-atomic sequence carrier without
inheriting transaction, history, receipt, Event, or replication guarantees.
Later sections project these profiles into JSON and HTTP.

### Scopes and identity

A **BDP Scope** contains Beads and Links and is the boundary within which BDP
interprets local identifiers, evaluates selections, and commits atomic
mutations. Every Bead and Link belongs to exactly one Scope, and every mutation
applies to exactly one Scope. URI path hierarchy does not create nested Scopes:
a Scope exists only when identified by its own root BDP description, and the URI
spaces owned by different Scopes do not overlap.

A local Bead ID begins with the fixed `beads/` segment and a local Link ID
begins with the fixed `links/` segment. Each then contains one or more safe
URI-path segments that form opaque identity within its Scope. Protocol
resolution against the canonical Scope URI produces one absolute canonical
Resource URL. That URL is immutable and, once committed, is never reassigned to
an unrelated Resource in the lifetime of the logical Scope, including after
deletion or a Scope-epoch change. An implementation preserves a compact
identity tombstone, durable allocation record, or equivalent non-reuse
guarantee. A restore that cannot preserve that guarantee creates a different
logical Scope and therefore uses a different canonical Scope URL.

At a protocol boundary, BDP v0 assigns Beads and Links to exactly those two
fixed top-level paths. The segments following `beads/` or `links/` are identity;
they do not imply containment, collection membership, or a child Scope. No
other Scope-relative path acquires Bead or Link semantics. Multiple roots of
either kind and a root that mixes Beads and Links are deferred beyond v0. The
protocol accepts documented local reference spellings as input but emits
absolute canonical Resource URLs.

Beads and Links are both **Resources**: each has identity, a representation,
and uniform operations. Authorization is separate from identity and typing.
Possessing a Resource or Type identifier does not grant permission to read,
mutate, or traverse it.

### Scope history

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip Scope epochs, commit
> positions, change groups, and the history-ordering rules in this section.

BDP v0 assigns one logical mutation authority to a Scope history at a time.
High-availability implementations may have multiple processes or storage
replicas only when they present one serialized history under that authority.
In this specification, replication means consuming an authority's snapshot and
changefeed into a cache or materialized replica; it does not mean independently
writable replicas, offline divergent histories, or multi-authority merge.

Each Scope history has an opaque, unguessable **Scope epoch**. The epoch remains
stable across ordinary restart and failover that preserve identical committed
history. It changes whenever restore, destructive reinitialization, or authority
replacement may discard, rewrite, or replace history. Epoch fences revisions,
positions, snapshots, cursors, and receipts; it is not part of canonical Scope
or Resource identity. Restoring the same logical Scope therefore preserves its
canonical Scope and Resource URLs while rejecting every history-dependent token
from the prior epoch.

Within one epoch, every effectful committed Mutation Transaction occupies one
opaque **Scope position** in one authority-defined total order. A position is
unique within its epoch and clients compare it only for equality. Clients must
not perform arithmetic or lexical ordering on its spelling. Each epoch has a
distinguished genesis position, and every later change group identifies both
its position and its immediately preceding position.

A read or snapshot observes one prefix of this order. A Resource revision names
one state of one Bead or Link; a Scope position names one committed transaction.
The tokens are independent even when an implementation derives them from
related internal counters.

### Authorization views

For every request, the authority binds the authenticated principal or an
anonymous principal to exactly one opaque **Authorization View** of the Scope.
The client cannot name, widen, or combine views through request data. Different
principals may share a view only when the authority considers their read
projections equivalent. The canonical Scope, Bead, and Link URLs remain
identity and do not vary by view.

An Authorization View is a closed projection of the Scope. Every read,
Selector, incident-Link view, snapshot, changefeed, Event Source, and
representation for the request observes that same projection. A Link is visible
only when the Link and every in-Scope endpoint Bead are visible. An out-of-Scope
endpoint is opaque and does not independently gate Link visibility. A visible
Bead need not expose hidden incident Links. The authority still evaluates
referential integrity, Scope aggregate constraints, deletion safety, and other
Scope invariants against its complete authoritative state; a non-disclosing
constraint failure may withhold the hidden Resources that caused it.

Each view has an opaque equality-only **Authorization View token**. The token
remains stable across restarts and failover that preserve the same projection.
It changes whenever a grant, revocation, policy replacement, or other authority
change may alter that projection. Snapshot handles, read and Event cursors,
changefeed checkpoints, minimum-read barriers, and cached representations are
bound to both the Scope epoch and Authorization View token. A token change
requires a fresh snapshot; BDP v0 does not require incremental
authorization-policy Events. The token is not a credential, and possessing or replaying it
does not grant access to that view.

Mutation authorization is operation-local and atomic. When each operation is
reached, its policy observes the authenticated principal, staged pre-state, and
proposed post-state. A set Selector ranges only over Resources visible in the
request's Authorization View. If any selected Resource is not writable, the
complete transaction fails; the authority never silently filters an unwritable
subset. Authorization View changes do not create a new idempotency namespace:
the principal-bound disposition remains durable and cannot execute again.
Detailed receipt results are re-authorized when later read.

### Actor attribution

BDP v0 does not expose an authority-attested actor in Resources, mutation
results, receipts, Events, or change groups. The authenticated principal is an
authorization input, not protocol data. An implementation may retain private
audit records, and a domain Type may define ordinary actor-related properties,
but neither is a generic BDP attribution guarantee. Standardizing principal
identity, delegation, impersonation, privacy, and attestation is deferred.
Scope epoch, Authorization View, and position fields are projection and
ordering fences; none identifies or attests the principal.

### Beads and Links

A **Bead** is a node in a Beads graph:

```text
Bead {
  id: BeadId
  type: BeadTypeId
  properties: JsonObject
}
```

A **Link** is a first-class directed relationship with two endpoint references:

```text
Link {
  id: LinkId
  type: LinkTypeId
  source: EndpointReference
  target: EndpointReference
  properties: JsonObject
}
```

For a Bead, `id` and `type` are immutable. For a Link, `id`, `type`, `source`,
and `target` are immutable. Only `properties` may be updated. Assigning a new
value to an immutable member is not an update; deletion and creation of another
Resource are distinct operations.

Every Link has independent Resource identity. Its `type`, `source`, and
`target` describe it but do not identify it. BDP v0 permits multiple Links to
share the same Link `type`, `source.id`, and `target.id` tuple. Endpoint `type`
is validated metadata and is not an additional tuple component. Maximum
multiplicity constraints may independently limit how many Links can share
either endpoint; v0 does not define a tuple-uniqueness constraint.

A URI-valued Bead or Link property is ordinary JSON data. BDP does not infer a
Link merely because a property contains a URI.

Each endpoint is either an **in-Scope endpoint** or an **out-of-Scope
endpoint**. An in-Scope endpoint `id` may use a durable local Bead ID, its
absolute canonical URL, or a transaction-local Bead reference introduced by an
earlier creation operation. It MUST identify a live Bead in the Link's Scope.
The authority emits its absolute canonical Bead URL.

An out-of-Scope endpoint MUST be an absolute URI outside the canonical Scope
URI and its `type` MUST be
`https://github.com/gastownhall/bdp/types/external-reference`, the BDP v0
External Reference sentinel. BDP treats the `id` as an opaque reference: the
target MAY be a Bead, another kind of Resource, or nothing currently
dereferenceable. The authority does not dereference it, infer its kind or Type,
subject it to in-Scope endpoint-Type or aggregate constraints, expose Bead
operations or incident-Link traversal for it, or make its lifecycle part of
the Scope's integrity guarantees. External endpoint equality is exact `id`
equality; BDP defines no cross-authority canonicalization. At least one endpoint
of every BDP v0 Link MUST be an in-Scope Bead. A Scope therefore cannot own a
Link between two opaque external URIs. A future cross-Scope indexing profile
may define ownership, lifecycle, authorization, and duplicate handling for
such Links without weakening the v0 rule.

Every canonical endpoint reference has two required members and, for external
references only, one optional member:

```text
EndpointReference {
  id: URI
  type: BeadTypeId | ExternalReferenceSentinel
  revision?   // opaque nonempty string; External Reference endpoints only
}
```

For an in-Scope endpoint, `id` is the Bead's absolute canonical URL and `type`
is its exact immutable declared Type; an in-Scope endpoint carries exactly
those two members and MUST NOT carry `revision`. The authority MUST reject a
mismatched pair. For an out-of-Scope endpoint, `id` is the opaque absolute URI
and `type` is the External Reference sentinel; it MAY additionally carry the
opaque `revision` citation defined under
[Local Resource references](#local-resource-references). A sentinel paired
with an in-Scope ID, or any other Type paired with an out-of-Scope ID, is
invalid. Endpoint equality, incident traversal, and multiplicity use `id`;
`type` is validated metadata and `revision` is preserved citation data —
neither adds another identity component.

The External Reference sentinel is protocol vocabulary, not a Type Descriptor.
It cannot be installed, declared by a Bead, used in a Type conformance graph,
or treated as an assertion about the Resource identified by an external URI.

Repeating a local Bead's declared Type in the endpoint is deliberate. Because
that Type is immutable, an implementation may use the supplied value to route
directly to Type-specific storage and may index or denormalize it with the Link.
The value is still untrusted request data: the authority MUST verify it against
the identified Bead before committing the Link.

### Types

Every Bead and Link has exactly one immutable **declared Type**. The Type ID
identifies a **Type Descriptor** Resource. A Type Descriptor describes either
Beads or Links; one Type cannot describe both.

A Type Descriptor identifies a JSON Schema for the Resource's `properties`
record. The generic Bead or Link structure is BDP law and is not redeclared by
each Type. A Resource's complete `properties` value must satisfy its Type's
schema when that Type publishes one. Schemas are optional for progressive
interoperability: clients may operate without fetching them, while services
still validate writes and diagnose violations.

A Type may declare that it **conforms to** zero or more Types of the same
Resource kind. If Type `A` conforms to Type `B`, a Resource declared as `A`
also satisfies the contract of `B` and may be used where `B` is accepted.
Conformance is transitive, acyclic, and never crosses the Bead/Link boundary.
Direct parents are unordered, and a repeated ancestor reached through multiple
paths contributes its contract only once.

For example:

```text
Task -> Work Item
```

A Task still has one declared Type. Its **effective Types** are its declared
Type plus the transitive closure of the Types to which it conforms. Its
properties must satisfy every effective Type's schema. This is **multiple
conformance**, not ordered inheritance: there is no parent precedence or
override rule. The effective contract is the intersection of all applicable
contracts. A contradictory combination accepts no Resource rather than
selecting a winning parent.

Type identity, conformance, and descriptor publication are separate concerns.
The Type ID on a Bead or Link is immutable and identifies one immutable
semantic contract. Changing its Resource category, conformance graph,
properties constraints, or Link endpoint constraints requires a new Type ID.
Referenced schemas and Types are part of that semantic
contract and must preserve their meaning at their existing IDs. Human-readable
documentation may improve without changing the contract.

Type IDs are globally scoped absolute URLs. A service SHOULD cache every Type
Descriptor it successfully resolves. Before an authority uses a Type to
validate a mutation, it MUST retain a pinned local copy of the descriptor and
its complete contract closure: transitive `conformsTo` descriptors, endpoint
Type requirements, properties schemas, and every transitively referenced
schema resource. It MUST validate that installed copy without network access
from the admitted request. Installation occurs through an administrative
mechanism outside BDP v0 and completes before request admission; a generic BDP
mutation never triggers descriptor installation or network I/O.

The pinned contract closure is immutable for that Type ID. An authority never
refreshes it automatically and never substitutes different contract-bearing
content at the same ID. It retains the exact installed artifacts and an
internal integrity fingerprint; BDP v0 does not require a standardized public
contract digest. A later fetch that differs may update separable human
documentation, but it cannot replace the pinned validation contract. If the
authority cannot install a complete valid closure, the Type remains unavailable
for mutation validation. The authority retains the artifacts while any live or
retained historical representation refers to them and retains at least the Type
ID and fingerprint for the lifetime of the logical Scope.

BDP publishes no universal root Bead or Link Type IDs. The descriptor's
`describes` member distinguishes the Resource category; `conformsTo` contains
only domain-defined Type relationships. Category collection and selection use
the distinct Bead and Link roots rather than a synthetic root Type.

### Scope aggregate constraints

A Type Descriptor owns constraints that can be validated from one Resource and
its in-Scope endpoints: properties schemas and endpoint effective-Type
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

For one in-Scope Bead and named endpoint, this policy counts live Links in the
Scope whose effective Link Types contain `linkConformsTo` and whose named
endpoint equals that Bead. The count includes Links declared as different
conforming child Types. If several policies apply, the smallest maximum wins.
An out-of-Scope endpoint is never counted or constrained. Authorities MUST
produce serializable outcomes when concurrent mutations could cross a maximum.

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

An absent member or empty array means that the Scope defines no such policies.
The administrative mechanism remains outside BDP. A policy replacement is
atomic and serialized relative to mutations; tightening is rejected when the
live graph already violates the proposed maximum. A Transactional mutation
observes either the complete old or complete new policy set. Each Read+Update
singleton or sequence member observes the policy current at that member's
execution point. A replacement changes the discovery representation and its
`ETag` but does not invalidate active reads or change a Type Descriptor.

Minimum multiplicity, tuple uniqueness, acyclicity, and other aggregate graph
policies are deferred.

### Property changes

A **Property Change** is an ordered
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to one
JSON `properties` object. BDP v0 admits only `add`, `replace`, and `remove`.
Paths are JSON Pointers relative to `properties`; operations execute in order
with RFC 6902 object and array semantics. `replace` and `remove` require their
targets to exist. `move`, `copy`, and `test` are not part of BDP v0.

Assigning JSON `null` and removing a member are distinct operations. The patch
must yield a JSON object, and the authority validates that complete result—not
merely changed members—against every effective Type contract. Advertised limits
bound patch operation count, path size and depth, and resulting representation
size.

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

A single mutation is a one-operation Mutation Transaction. BDP does not define
nested transactions or interactive `begin`, `commit`, and `rollback`
operations.

The authority serializes committed transactions into the Scope order. It must
produce serializable outcomes for in-Scope endpoint liveness, Scope aggregate
constraints, deletion safety, Type contracts, and every other Scope invariant,
without prescribing a particular storage isolation level.

An admitted mutation's `idempotencyKey` identifies its complete semantic
request within the canonical Scope URI, Scope epoch, and authenticated
principal. The authority normalizes local references, expands protocol defaults,
preserves operation and array order, ignores JSON object member order, and
excludes delivery-only metadata before comparing requests. It may store that
normalized request or an internal versioned fingerprint; BDP does not require a
public request-hash algorithm.

Concurrent requests with the same key and semantic request join one execution.
A duplicate may wait for the terminal response or receive the same pending
receipt; it never executes again. Reusing the key for a different semantic
request is an idempotency conflict. Once admitted, client disconnection does not
decide the outcome: the authority commits or rolls back and records one terminal
receipt. Retrying returns that same outcome, including authority-allocated IDs.

### Local Resource references

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

A later operation may refer to the created Resource by prefixing the label with
`@`:

```text
CreateLink(
  type: "assigned-to",
  source: { id: @newTask, type: "https://work.example/types/task" },
  target: { id: "person-42", type: "https://people.example/types/person" },
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

In a Read+Update sequence the creation commits before the binding becomes
available, and later members use the durable identity. In a Transactional batch
the binding denotes staged identity before commit. Both use the same `@name`
spelling and kind checks; only Transactional supplies isolation and rollback.

Resource references are kind-checked. A Link reference cannot be used where a
Bead reference is required. Only Resource identity is bindable; revisions,
properties, timestamps, query results, and other operation-result data are not.

A durable relative reference is resolved against the canonical Scope URI and
normalized to an absolute canonical URL before use. It must remain beneath the
fixed `beads/` or `links/` root required by the reference's Resource kind. An
endpoint `id` that is relative therefore always denotes an in-Scope endpoint
and must identify a live Bead whose declared Type equals the accompanying
`type`. An endpoint `id` that is an absolute URI outside the canonical Scope
instead requires the External Reference sentinel and is handled as opaque.

An External Reference endpoint may carry an optional opaque endpoint
`revision` member citing the state of the external Resource the reference was
made against. On the wire it is a nonempty JSON string; that structural rule
is the only validation an authority applies. The member is a citation pin,
not a constraint: an authority stores and echoes it byte-identically,
compares it only for equality, and performs no semantic validation,
dereferencing, or interpretation — the cited Resource is outside the
authority's Scope. It is unrelated to the containing
Link's own `revision` and to `expectedRevision` guards, and it does not
participate in Link identity or endpoint tuple comparison. An in-Scope
endpoint must not carry a `revision` member in BDP v0; citation of in-Scope
historical states is deferred with historical resolution.

Creating or deleting a Link does not mutate an in-Scope endpoint Bead or change
its Resource revision.

### Explicit Bead operations

```text
[label:] CreateBead(
  id?,
  type,
  properties = {}
) -> BeadState
```

If `id` is omitted, the authority allocates one. If supplied, its canonical
Resource URL must never previously have been committed for any Resource in the
logical Scope; deletion does not make it available again.

```text
UpdateBeadProperties(
  bead,
  change,
  expectedRevision?
) -> BeadState
```

```text
DeleteBead(
  bead,
  expectedRevision?
) -> DeletionResult
```

`bead` may be a durable Bead ID or a transaction-local Bead reference.
Deleting a Bead removes it from the live data model; it does not require
physical erasure by the implementation. `DeleteBead` fails if any live Link is
incident upon the Bead when the operation is reached. A client that wants
cascade behavior must explicitly delete the incident Links earlier in the same
Mutation Transaction.

### Explicit Link operations

```text
[label:] CreateLink(
  id?,
  type,
  source,
  target,
  properties = {}
) -> LinkState
```

If `id` is omitted, the authority allocates one. If supplied, its canonical
Resource URL must never previously have been committed in the logical Scope.
`source.id` and `target.id` may refer to Beads created earlier in the same
Mutation Transaction. Their accompanying `type` values MUST equal the Types on
those creation operations. An out-of-Scope endpoint instead pairs its absolute
URI `id` with the External Reference sentinel.

```text
UpdateLinkProperties(
  link,
  change,
  expectedRevision?
) -> LinkState
```

```text
DeleteLink(
  link,
  expectedRevision?
) -> DeletionResult
```

`link` may be a durable Link ID or a transaction-local Link reference.

### Revisions

Every successful create and every update that changes `properties` produces a
fresh opaque Resource revision. A client compares revisions only for equality
and must not derive meaning from their spelling. If applying an update produces
a `properties` value equal under the JSON value-comparison rules of RFC 6902
Section 4.6 to the value immediately before that operation, the operation
retains the existing revision and emits no `updated` Event.

No-op detection is operation-local. An update followed by a later reverse
update in the same ordered transaction is two state transitions: each receives
its own revision and Event, and both become visible atomically in one change
group after commit.

An explicit update or deletion may supply the revision observed by an earlier
read or mutation result as `expectedRevision`. The authority applies the
operation only if the Resource still has that revision. A mismatch fails the
complete Mutation Transaction. Omitting `expectedRevision` applies the change
to the Resource's current state.

Creation already requires the allocated or supplied identity to be absent.
Update and deletion already require their target to exist. Resources created
earlier in the same transaction need no revision guard because no external
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

It does not support joins, graph traversal, projection, aggregation, recursive
descent, nested filters, functions, regular expressions, path-to-path
comparisons, or selection of nested values. A Selector always selects complete
top-level Resources.

For example:

```text
$[?@.type == "https://work.example/types/task" && @.properties.status == "closed"]
```

Identity-bearing candidate members `id` and `type` contain absolute canonical
URLs. `source` and `target` are endpoint objects; their `id` members contain a
local canonical Bead URL or an opaque external URI, and their `type` members
contain the declared Bead Type or External Reference sentinel. A Selector
compares those strings exactly. BDP does not reinterpret or normalize arbitrary
JSONPath string literals as identifiers; callers use the stored spelling in
Selector expressions.

The same Selector semantics drive retrieval and set mutation:

```text
Select(
  scope,
  collection,
  selector
) -> Resources
```

Pagination and ordering are protocol concerns and do not change which
Resources satisfy a Selector.

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
  cardinality?
) -> UpdatedResources
```

```text
DeleteWhere(
  collection,
  selector,
  cardinality?
) -> DeletedResourceIdentities
```

Selection and mutation occur atomically at one serialization point. The
Selector is evaluated when its operation is reached and therefore observes the
effects of preceding operations in the same Mutation Transaction.

An optional cardinality record constrains the number of selected Resources:

```text
cardinality: { min: 1, max: 1 }
cardinality: { max: 100 }
cardinality: { min: 1 }
```

Both bounds are inclusive nonnegative integers. Omitted cardinality bounds add
no client constraint; the authority may still enforce operational limits
whether or not it pre-advertised them. If the matched count falls outside a
supplied range, the complete transaction fails.

BDP v0 deliberately does not add an expected-member-set guard. A set mutation
means “mutate the complete set matching at this operation's serialization
point.” A client that intends to mutate specific previously observed Resources
uses explicit operations with `expectedRevision` instead.

A service may advertise limits on Selector size and depth, Resources examined
or matched, Resources mutated, Events induced, and transaction duration.
Exceeding a limit fails the operation without changing anything. A set
mutation must never silently mutate only one page of results.

When a desired mutation exceeds an advertised transaction or Event-expansion
limit, a client may divide it into separate transactions. Each chunk is atomic,
but the complete multi-transaction job is not: other work may interleave and a
later chunk may fail after earlier chunks committed. BDP v0 defines no generic
server-side bulk job that restores cross-chunk atomicity. Domain or
administrator bulk facilities are outside BDP, and an implementation MUST NOT
relax changefeed completeness or omit Events to admit an oversized mutation.

For example, this operation deletes every Link incident upon `task-42`:

```text
DeleteWhere(
  Links,
  $[?@.source.id == "https://beads.example/acme/beads/task-42" || @.target.id == "https://beads.example/acme/beads/task-42"]
)
```

### Validation and results

> **Transactional/Replication constructs within this section.**
>
> Cross-operation staged validation, serializable aggregate-invariant outcomes,
> complete-transaction rollback, and ordered transaction results apply only to
> the Transactional profile. Read+Update validates each singleton or sequence
> member independently and returns its inline postimage, deleted identity, or
> problem.

When each operation is reached, the authority validates its resulting staged
state before evaluating the next operation:

- identifier uniqueness;
- reference resolution and Resource kind;
- liveness, exact declared-Type match, kind, and effective-Type constraints for
  in-Scope Link endpoints;
- sentinel pairing, syntactic validity, and opaque handling of out-of-Scope
  endpoint URIs;
- immutable-member rules;
- Type and properties-schema constraints;
- applicable Scope aggregate constraints;
- authorization;
- expected revisions and cardinality;
- absence of live incident Links when deleting a Bead; and
- advertised service limits.

At commit it also ensures that concurrent transactions cannot jointly violate
those invariants. An implementation may use a Scope writer, serializable
transactions, predicate or advisory locks, constraint rows, or an equivalent
retry protocol; BDP specifies the observable serializable result rather than
the mechanism.

Any failure rolls back the complete Mutation Transaction. Domain-specific
transitions such as `claim-ready` are not generic BDP operations.

Creation and update results include the durable Resource ID, canonical Resource
URL, opaque revision, and complete resulting state. Deletion results include
the deleted Resource identity and transaction metadata. The transaction result
maps every local label to its allocated durable Resource identity.

### Mutation receipts

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip durable Mutation
> Receipts, receipt pagination, and lost-response recovery through receipts.

Every admitted mutation has one durable **Mutation Receipt**. Its synchronous
response is the receipt representation; the normal case requires no follow-up
read. The receipt records the terminal outcome, transaction identity,
Authorization View in which it executed, `requiredPosition`, optional
`effectPosition`, and ordered operation results. `requiredPosition` is the
Scope position that view must observe before relying on the outcome.
`effectPosition` is present exactly when the mutation produced a change group.

The receipt remains independently readable so a client can resolve a lost
response, a pending duplicate, or a paginated result. An identical retry returns
the same receipt identity and disposition. Receipt access is principal-bound;
possessing its URL does not grant access. The authority re-authorizes detailed
results on every later read, so a grant change may redact or deny detail without
changing the terminal disposition. When the authority advertises receipt
retention, it binds how long detailed outcomes remain. After the applicable
interval it may discard bulky result data, but
it retains a compact key, request-identity, and disposition tombstone for the
rest of the Scope epoch. A later retry returns an outcome-expired result and
never executes the mutation as new.

A receipt may inline every result or the first bounded page. Large set-operation
results continue through immutable pages of that same receipt; BDP does not
create a second result abstraction and never silently truncates affected
Resources.

### Events and Event Sources

> **Transactional/Replication contract in this draft.**
>
> The complete Event ordering, transaction framing, and Event Source guarantees
> below are required only by the Transactional profile. Read and Read+Update do
> not publish or expose BDP Events.

An **Event** is an immutable authority-generated record of a committed fact.
Each Event has an immutable ID that is unique within exactly one **Event
Source**. An Event is not required to be an independently addressable Resource;
its Event Source is a Resource.

Every Bead and Link is an Event **subject** and has an associated
Resource-scoped Event Source. The subject and Event Source have distinct
identities and may have different lifetimes. An Event Source may remain
observable after its subject is deleted, subject to retention policy.

Resource-scoped Event Sources are deterministic projections of semantic Events
inside the Scope's committed change groups, not independently committed logs.
Each Event has a stable ordinal within its change group. Its source-local opaque
ID and cursor are stable functions of the group checkpoint, ordinal, and
projection. An implementation may materialize or index a projection without
changing its contents or order.

The model defines five domain-independent Event Types:

- **created** — a Bead or Link began to exist;
- **updated** — the mutable properties of a Bead or Link changed;
- **deleted** — a Bead or Link ceased to exist;
- **linked** — a Link became incident upon a Bead; and
- **unlinked** — a Link ceased to be incident upon a Bead.

Events are the observation-side duals of singleton DML operations. A Resource
read or snapshot bootstrap conveys current state; an Event conveys the committed
delta that advances previously observed state. Every Event identifies its
subject by immutable `id` and `type` and carries the transaction in which the
fact committed.

The lifecycle Event deltas are:

```text
CreatedData {
  revision: Revision
  properties: JsonObject
  source?: EndpointReference
  target?: EndpointReference
}

UpdatedData {
  previousRevision: Revision
  revision: Revision
  change: PropertyChange
}

DeletedData {
  revision: Revision
}
```

`CreatedData` contains the complete initial properties because creation is the
delta from absence to the initial state. For a Link, it also contains its
source and target endpoint references. `UpdatedData` contains the committed
Property Change rather than a resulting properties snapshot.
`DeletedData.revision` is the Resource's final live revision. Deleted Events do
not retain the Resource's properties.

An Event uses the same `EndpointReference` form as canonical Link state,
including a stored external `revision` citation, which propagates
byte-identically. An in-Scope reference carries the Bead's immutable declared
Type; an out-of-Scope reference carries the External Reference sentinel,
which makes no claim about what the URI identifies.

The graph Event delta is:

```text
LinkDeltaData {
  endpoint: source | target
  link: TypedLinkReference
  source: EndpointReference
  target: EndpointReference
}
```

The typed Link reference contains only immutable `id` and `type`. `linked` and
`unlinked` Events contain no Bead or Link properties. Carrying the Type of each
in-Scope endpoint allows a consumer to understand an unlink after the Link is
no longer readable without asserting a Type for an opaque external reference.

A Link-scoped Event Source reports `created`, `updated`, and `deleted` facts
about that Link. A Bead-scoped Event Source reports:

- `created`, `updated`, and `deleted` facts about the Bead;
- `linked` and `unlinked` facts when a Link becomes or ceases to be incident
  upon the Bead; and
- `updated` facts whose subject is an incident Link when that Link's mutable
  properties change.

Link creation produces a `created` fact about the Link and a `linked` fact at
each in-Scope endpoint Bead. Link deletion produces a `deleted` fact about the
Link and an `unlinked` fact at each in-Scope endpoint Bead. No Bead-scoped fact
or Event Source exists for an opaque out-of-Scope endpoint. A wider Event Source
may cover a collection, graph Scope, or complete service.

For a self-Link, the one endpoint Bead receives two graph facts in the same
group: one whose `endpoint` is `source` and one whose `endpoint` is `target`.
Both count against the transaction's Event-expansion limit. These derived facts
and the incident-Link view do not mutate the Bead or advance its Resource
revision.

Events describe data-model facts, not protocol methods. Full replacement and
partial update therefore produce the same abstract `updated` Event when they
change a Resource's properties. A failed or rolled-back transaction produces
no observable Events.

For Event purposes, `UpdateWhere` and `DeleteWhere` expand over their selected
Resources as the corresponding singleton operations. Each affected Resource
produces exactly the Event facts that its singleton update or deletion would
produce, including incident-Link facts at in-Scope endpoint Beads. A zero-match
operation produces no Events. All Events induced by one Mutation Transaction
carry that transaction's identity and become observable together only after
commit.

An authority MUST enforce a finite maximum number of Events that one Mutation
Transaction may induce and MAY advertise it through `limits`. If a set mutation
would exceed that limit,
the complete transaction fails before commit. This semantic expansion does
not require an implementation to update or delete Resources one at a time; an
authority remains free to use set-oriented storage operations so long as it
emits the same committed facts.

### Change groups and replication

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip Change Groups,
> postimages, tombstones, projection advances, and replica reconstruction.

Every successful transaction that induces at least one Event produces exactly
one immutable authority Scope **Change Group** at one new Scope position. The
authority commits the Resource state, group, and Mutation Receipt atomically. A
failed or admitted no-effect mutation produces no group and no new position;
its receipt reports the current `requiredPosition` and omits `effectPosition`.

The group delivered to a client is the deterministic projection for its
Authorization View. It carries every state transition needed to advance that
view. If the transaction has no visible effect, the authority still emits an
identifier-free projection advance at the same position so a replica can prove
contiguous catch-up without learning hidden Resource or transaction identities.
This reveals the cadence of hidden transactions; avoiding that side channel
requires a different, separately identified per-view order and is not part of
BDP v0. An authority MUST NOT reject an otherwise valid Scope transaction only
because one view's derived transition is too large to deliver. If it cannot
represent that transition within advertised projection limits, it rotates that
view token and requires affected clients to install a fresh snapshot.

A change group contains:

```text
ChangeGroup {
  scopeEpoch: ScopeEpoch
  authorizationView: AuthorizationViewToken
  position: ScopePosition
  previousPosition: ScopePosition
  projectionAdvance: Boolean
  transaction?: TransactionId
  changes: StateChange*
  eventCount: Integer
  events: Event*
}
```

For an ordinary visible group, `projectionAdvance` is false and `transaction`
is present. `changes` is the replica-oriented projection. It contains a
complete canonical postimage and Resource revision for each Bead or Link whose
final projected state is live, or an identity-bearing tombstone for each
Resource that leaves the projection. An authorization-projection tombstone does
not assert that the underlying Resource was deleted. Multiple operations on one
Resource normalize to its final projected postimage or tombstone. Consumers
apply the complete array atomically; its internal order has no semantic effect.

For an invisible group, `projectionAdvance` is true, `transaction` is absent,
and `changes` and `events` are empty. No Resource, Type, Link endpoint, actor,
or transaction identifier from the hidden group crosses the authorization
boundary.

`eventCount` equals the number of entries in `events`. `events` is the
application-facing ordered fact sequence. It preserves operation order and
assigns each Event its stable authority-group ordinal. A projected Event list
may therefore contain ordinal gaps where intervening facts are hidden; it never
renumbers visible facts. One normalized state-change entry may correspond to
several Events, as when ordered updates touch one Resource more than once or
Link lifecycle facts project to its endpoint Beads. Event-expansion limits also
bound change-group size.

BDP v0 does not require a public cryptographic group digest. Epoch, position,
and previous position detect replay gaps, duplicates, reordering, and history
replacement. An implementation may advertise an integrity extension.

### Snapshots and strict reads

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip snapshot bootstrap,
> snapshot/changefeed rendezvous, minimum-position reads, and the strict
> replica-freshness contract in this section.

A first-class Scope **Snapshot** contains the complete live Bead and Link state
visible in one Authorization View at one transaction-consistent Scope epoch and
position. One immutable snapshot manifest anchors separate typed Bead and Link
page streams to the same handle, view, position, and expiry. A small Scope may
inline both complete streams. A replica stages all pages and publishes the
replacement atomically only after both streams finish; ordinary collection
queries are not a replication bootstrap.

The snapshot checkpoint is the precise exclusive position from which Scope
changefeed replay begins. Until the snapshot's advertised expiry, the authority
retains every later projected group required to continue from that checkpoint.
A cursor presented too late, from another Scope epoch, or from another
Authorization View fails explicitly and never silently skips history. BDP v0
assumes a global retention window rather than per-client retention pins.

Ordinary reads are strict by default. Each observes one transaction-consistent
prefix of its Authorization View that can be linearized during the request and
reports its Scope epoch, view token, and visible position. A client may require
a minimum checkpoint bound to that same view. A replica that is behind must
route, wait, or fail explicitly; it must not return older state as if current.
Weaker consistency modes, if added, require explicit client selection.

### Deferred model features

Endpoint Type unions, minimum multiplicity, tuple-uniqueness constraints,
acyclicity, and additional aggregate graph policies are deferred beyond BDP
v0. They are not implicit authority behavior.

## BDP JSON and HTTP Protocol

This section projects the Bead Data Model into concrete JSON values and HTTP
interactions. A Scope claims one cumulative conformance profile, defined under
[Conformance profiles and reading guide](#conformance-profiles-and-reading-guide).
Unless a requirement is explicitly assigned to a lower profile, the complete
protocol requirements in this section describe the Transactional profile. The
protocol uses one small, uniform surface:

- the Transactional profile can express every mutation through a Scope-level
  `batch` target;
- Read+Update and Transactional Scopes retain the same generic
  single-Resource operation targets for callers that do not need a batch;
- ordinary `GET` reads remain Resource-oriented;
- bounded selection uses that shared expression model in a collection `GET`;
  and
- snapshots and the Scope changefeed provide lossless replica bootstrap and
  catch-up, while Event Sources provide application-facing observation.

### Scope discovery and human documentation

Every BDP Scope has one absolute canonical Scope URI ending in `/`. That URI is
the base used to resolve local IDs and durable relative references, even when a
request reached the Scope through an alias or redirect. An ordinary `GET` of
the Scope URI MUST return a successful response carrying a registered
[`service-desc` link relation](https://www.rfc-editor.org/rfc/rfc8631.html) to
the machine-readable JSON discovery document. The `Link` field is the normative
machine discovery mechanism; a client never interprets the Scope response body
as discovery metadata.

The Scope response MAY be `204 No Content`, or it MAY be `200 OK` with a useful
human-readable representation such as HTML or Markdown. That representation
MAY visibly link to the same service descriptor and MAY advertise separate
human documentation with `service-doc`, but neither a body nor a repository-style
`README.md` is required for BDP conformance.

A minimal Scope response is:

```http
GET /acme/ HTTP/1.1
Host: beads.example

HTTP/1.1 204 No Content
Link: <bdp.json>; rel="service-desc"; type="application/json"
```

If a service supplies an HTML landing page, it SHOULD link visibly to the
discovery document and any human documentation it advertises. A BDP client
follows `service-desc`; it never depends on scraping the human page.

```http
GET /acme/bdp.json HTTP/1.1
Host: beads.example
Accept: application/json
```

Discovery membership is profile-specific. `bdpVersion`, `profile`, `scope`,
`beads`, `links`, and `types` are required in every profile. `operations` is
required in Read+Update and Transactional and prohibited in Read. The history,
receipt, snapshot, changefeed, and Event members are required only in
Transactional and prohibited in both lower profiles. The optional `limits` and
`maximumEndpointMultiplicity` members may appear in any profile when their
contracts apply.

| Member | Read | Read+Update | Transactional |
| --- | --- | --- | --- |
| `bdpVersion`, `profile`, `scope` | required | required | required |
| `beads`, `links`, `types` | required | required | required |
| `operations` | prohibited | required | required |
| `scopeEpoch`, `authorizationView`, `headPosition`, `minimumReplayPosition` | prohibited | prohibited | required |
| `receipts`, `snapshot`, `changes`, `events` | prohibited | prohibited | required |
| `limits`, `maximumEndpointMultiplicity` | optional | optional | optional |

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

A minimum Read+Update discovery representation adds only its Operation
Directory:

```json
{
  "bdpVersion": "0",
  "profile": "read-update",
  "scope": "https://beads.example/acme/",
  "beads": "https://beads.example/acme/beads/",
  "links": "https://beads.example/acme/links/",
  "types": "https://beads.example/acme/types/",
  "operations": "https://beads.example/acme/operations/"
}
```

The Transactional-profile discovery representation adds the authority-history
and replication surface:

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
  "receipts": "https://beads.example/acme/receipts/",
  "snapshot": "https://beads.example/acme/snapshot",
  "changes": "https://beads.example/acme/changes/",
  "events": "https://beads.example/acme/events/"
}
```

`scope` is the canonical Scope identity and reference-resolution base.
`bdpVersion` MUST equal `"0"` for a BDP v0 Scope. A client that does not
implement the advertised value stops rather than guessing compatibility.
`profile` is required and is exactly `"read"`, `"read-update"`, or
`"transactional"`. It advertises the Scope's highest supported cumulative
profile; it is a single value rather than an array because each higher profile
claims every lower profile.
`scopeEpoch`, `authorizationView`, `headPosition`, and
`minimumReplayPosition` describe the current authority history incarnation,
server-selected read projection, projected head, and oldest position still
legal as an exclusive Scope-changefeed cursor. The client cannot supply or
widen `authorizationView`; another principal or changed policy may receive a
different value at the same canonical Scope URL. Individual snapshots and
receipts carry their exact expiry; discovery may pre-advertise applicable
retention through the optional `limits` object.

BDP v0 fixes one Bead root and one Link root per Scope. The `beads` and `links`
members are absolute HTTP(S) navigation URLs for those roots. In canonical
local IDs, the fixed roots are still exactly `beads/` and `links/`; the
advertised URLs are the collection URLs that correspond to those roots and the
only top-level paths under which this Scope assigns Bead and Link semantics.
The collection URL itself is a Resource. A service MUST NOT advertise an
additional Bead or Link root, mix both Resource kinds beneath one root, or let
the fixed roots of separately described Scopes overlap.
For the canonical Scope URL `S`, `beads` MUST equal the URL produced by
resolving `beads/` against `S`, `links` MUST equal `links/` resolved against
`S`, and `types` MUST equal `types/` resolved against `S`.

A local Bead ID has the form `beads/{id-path}` and a local Link ID has the form
`links/{id-path}`, where `{id-path}` contains one or more nonempty segments.
Those segments are opaque identity: they do not define containment or child
Scopes. Empty, `.`, and `..` segments, controls, backslashes, queries,
fragments, scheme-relative references, and encoded `/` or `\` separators are
invalid. A service decodes percent escapes exactly once, rejects invalid UTF-8,
emits unreserved characters literally and all required percent escapes with
uppercase hexadecimal digits, and compares decoded segments exactly without
Unicode normalization.

For example, both `beads/task-42` and
`beads/projects/alpha/tasks/task-42` are valid local Bead IDs. The latter does
not imply that `projects`, `alpha`, or `tasks` is a container or Scope. A Link
ID follows the same rule beneath `links/`, such as `links/assigned-to/81`.

An input Resource reference may use that canonical local spelling or the
absolute canonical URL. The authority resolves a local reference against
`scope`, canonicalizes it, and verifies that its first segment is the fixed root
for the required Resource kind before lookup. A relative endpoint `id`
therefore must identify a live Bead in this Scope and its `type` must match that
Bead's declared Type. An absolute endpoint `id` outside `scope` remains opaque
and requires the External Reference sentinel as its `type`. Resolution never
mutates an endpoint Bead.

When the Scope's profile supports mutation, `operations` identifies an
Operation Directory rather than a collection of transactions. Its named
children depend on the claimed profile. Only the Transactional profile includes
`batch`, which executes an ordered Mutation Transaction.

Discovery-document members and Operation Directory members defined by this
specification are fixed BDP vocabulary. Scope, Resource, Type, schema,
discovery navigation, and pagination `next` members are HTTP(S) URLs. BDP
permits arbitrary absolute URIs only for opaque external endpoint identities
represented with the External Reference sentinel. BDP schemas assert this
distinction with JSON Schema patterns; schema-aware tooling may additionally
use JSON Schema `format` annotations, but format behavior is not the sole
enforcement mechanism. BDP v0 does not duplicate navigation through
BDP-specific HTTP link relations. `service-desc` is the one required machine
entry relation; optional `service-doc` and `describedby` uses retain their
registered Web meanings.

### Advertised limits

The discovery document MAY contain a `limits` object. The object is optional so
a small implementation can expose a conforming profile without predicting
every operational bound. Omission means only that the bound is not
pre-advertised; it does not mean infinite capacity and does not permit silent
truncation, partial mutation, or a non-normative failure response.

When present, `limits` is divided into capability groups. A group is relevant
only when the advertised profile exposes that capability, and each advertised
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
- `transaction.operations`, `transaction.examinedResources`,
  `transaction.matchedResources`, `transaction.mutatedResources`, and
  `transaction.inducedEvents` are counts, while `transaction.duration` is an
  ISO 8601 duration; and
- `retention.idempotency`, `retention.receipt`,
  `retention.maximumSnapshotLifetime`, and `retention.replay` are ISO 8601
  durations.

Fields and groups not advertised carry no implicit numeric value. A client may
use advertised values for request planning; conformance tests may probe them
and require the server to enforce the advertised boundary consistently.

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
collection, sequence, snapshot, change-group, Event-page, receipt, result-page,
and problem envelope is a named entry beneath that bundle's `$defs`. Shared
primitive and record definitions occur once in the same bundle, and every
public envelope closes its protocol-owned members while leaving Resource
`properties` open for effective Type contracts.

The bundle's canonical `$id` is
`https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json`. The repository
artifact at that path is normative. Conformance validators load the complete
bundle without network retrieval, and generated language types derive from
that same artifact. BDP v0 does not publish independently versioned schema
fragments whose references could resolve to a mixed protocol version.

The discovery and Read definitions in the bundle are part of the Read
implementation gate. Each later profile's definitions gate that profile's
implementation wave, and the packaging question closes only when the complete
reviewed BDP v0 bundle exists.

### Problem details

Except for the `405` method rejections and unexpected internal `500` responses
defined below, every unsuccessful BDP response uses RFC 9457 Problem Details.
BDP defines a small set of stable problem-type families; the required `code`
member identifies the exact normative condition within its family. Each code
fixes its HTTP status and retry disposition. The Read profile uses this closed
table:

| Code | Family suffix | HTTP status | Retry |
| --- | --- | --- | --- |
| `malformed-request` | `request` | 400 | `never` |
| `invalid-parameter` | `request` | 400 | `never` |
| `unauthenticated` | `authentication` | 401 | `after-state-change` |
| `forbidden` | `authorization` | 403 | `after-state-change` |
| `resource-not-found` | `not-found` | 404 | `after-state-change` |
| `foreign-view` | `conflict` | 409 | `after-state-change` |
| `cursor-expired` | `gone` | 410 | `after-state-change` |
| `request-too-large` | `size` | 413 | `never` |
| `limit-exceeded` | `size` | 413 | `never` |
| `rate-limited` | `rate-limit` | 429 | `after-delay` |
| `temporarily-unavailable` | `unavailable` | 503 | `after-delay` |

Problem `type` is the BDP v0 problem-family prefix
`https://github.com/gastownhall/bdp/problems/` followed by the table's family
suffix. In addition to the RFC 9457 members, every BDP problem contains `code`
and `retry`. In the Read profile, `retry` is exactly `never`,
`after-state-change`, or `after-delay`. `after-state-change` requires the
caller to refresh state or construct a new request. `after-delay` responses
SHOULD carry `Retry-After` when the authority can state a useful delay.
Mutation-only dispositions and problem codes are defined with their profiles;
Read does not publish them early.

A direct problem uses its code's HTTP status. Its RFC 9457 `status` member is
optional, but when present it MUST match the HTTP status. RFC 9457 extension
members are allowed. A syntactically admitted sequence still returns `200 OK`;
each failed member contains the same Problem Details shape with its would-be
`status`, zero-based `operationIndex`, and, when the member declared one,
`operationName`. Sequence-member `status` is required because the enclosing
HTTP status is `200 OK`; the member status locates the failed operation's
ordinary direct response. This locates failure without creating a different
sequence-only taxonomy.

The Read family model, required fields, status mapping, and retry table are
closed. Completing the code table for every remaining normative later-profile
failure is part of that profile's schema-bundle and conformance work before the
affected profile is implemented. An implementation advertising the `read`
profile MUST support `GET` and `HEAD` for application requests. It MUST NOT
assign application semantics to `OPTIONS`. When it enables cross-origin access,
it MUST answer `OPTIONS` according to the CORS rules below. It MUST respond with
`405 Method Not Allowed` to `OPTIONS` when cross-origin access is not enabled and
to every other method. Every such `405` MUST include `Allow: GET, HEAD`, plus
`OPTIONS` when cross-origin access is enabled, and MUST NOT include a BDP Problem
body. These are HTTP-native rejections rather than members of the Read
problem-code table.
Implementations advertising later cumulative profiles MUST retain `GET` and
`HEAD` support; those profiles define their additional methods and `Allow`
values. Unacceptable response media types and unsupported request media types
remain explicit Read conformance work; this draft does not assign their BDP
problem codes in the Read table above. An implementation MUST respond to an
unexpected internal server fault with a body-less `500 Internal Server Error`,
MUST NOT include a BDP Problem body, and MUST keep internal fault details off the
wire. Assigning a future BDP Problem mapping for those faults remains explicit
Read conformance work.

### HTTP consistency, caching, and CORS fields

Read and Read+Update do not expose Scope epochs, Authorization View tokens, or
Scope positions. Their individual Resource responses use HTTP `ETag` for the
opaque Resource revision, and pagination continuations preserve their own
logical snapshot. Read+Update returns an authoritative mutation postimage but
does not promise that a later request routed to another replica observes it.

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

The authority returns a representation at that position or later, waits or
routes to an eligible replica, or returns the normative foreign-view,
cursor-expired, or catch-up-timeout problem. It never reports success with an
older position.

Scope-bounded representations that depend on authorization use
`Cache-Control: private, no-store`. If an implementation enables cross-origin
BDP access, its CORS policy MUST allow every BDP-defined non-safelisted request
field used by its advertised profile, including `Idempotency-Key`,
`Last-Event-ID`, and the Transactional minimum-position fields when applicable.
It MUST expose `Link`, `ETag`, `Retry-After`, `Cache-Control`, and the three
Transactional response fields when applicable. Ordinary CORS rules still
govern `Accept` and `Content-Type` values. Type Descriptors hosted outside a
Scope retain ordinary HTTP caching semantics. SSE responses use
`Cache-Control: no-store, no-transform`; intermediaries must not cache or
transform the stream.

### Event-ID and checkpoint character profile

Every serialized Event ID and Scope checkpoint is a case-sensitive ASCII token
matching `[A-Za-z0-9_-]{1,256}`. The authority emits the token identically in a
JSON value, URL query, HTTP field, SSE `id`, and `Last-Event-ID`; clients compare
the decoded values exactly and never apply case folding or Unicode
normalization. Whitespace, padding, percent signs, control characters, and all
non-ASCII characters are forbidden.

`genesis` is the reserved distinguished initial Scope checkpoint. It is never
assigned to an Event or later position. The restricted alphabet is a wire
profile, not a requirement that the value decode as base64url; implementations
may encode UUIDs, ULIDs, hashes, counters, or other native identities into it.

### Resource records

Every successful `GET` of a Bead or Link returns one self-contained Resource
record. Both immutable and mutable state appear in the record, together with
the current opaque revision. The target URL still identifies the Resource, but
including `id` makes saved responses, logs, collection members, and browser
inspection self-describing.

A Bead record is:

```json
{
  "id": "https://beads.example/acme/beads/task-42",
  "type": "https://work.example/types/task",
  "revision": "opaque-task-revision",
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
  "source": {
    "id": "https://beads.example/acme/beads/task-42",
    "type": "https://work.example/types/task"
  },
  "target": {
    "id": "https://beads.example/acme/beads/person-7",
    "type": "https://people.example/types/person"
  },
  "properties": {
    "since": "2026-08-04"
  }
}
```

`id` and `type` are always absolute canonical URLs in responses. Link `source`
and `target` are endpoint objects. An in-Scope endpoint has exactly two
members: the Bead's absolute canonical URL and exact declared Type. An
out-of-Scope endpoint has its opaque absolute URI and the BDP v0 External
Reference sentinel, and may additionally carry the optional opaque endpoint
`revision` member defined under **Local Resource references**. `revision` is protocol metadata rather than mutable Bead or Link
state. `id`, `type`, `revision`, and, for Links, `source` and `target` are
returned on every successful read. They are not thereby accepted as update
targets. An implementation may store local identifiers internally; that choice
does not alter the response spelling.

For example, an opaque external target citing a specific external state is
represented as:

```json
{
  "id": "https://github.example/issues/123",
  "type": "https://github.com/gastownhall/bdp/types/external-reference",
  "revision": "8f0e2b"
}
```

Collection and selection responses contain these same records directly rather
than wrapping them in a second `href`/`value` envelope.

Every Transactional Scope-bounded read reports the Scope epoch, Authorization
View token, and position of the transaction-consistent projected prefix it
observed through the fields defined under **HTTP consistency, caching, and CORS
fields**. Read and Read+Update use Resource revisions, entity tags, and
snapshot-preserving pagination without exposing Scope-history tokens.

### Resource views

The default `GET` of a Bead or Link URL returns its complete Resource record.
BDP-owned query parameters select a derived view or request one bounded
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

The properties view includes declared and undeclared properties; it is never a
schema-filtered projection. Its entity tag represents the same Resource
revision returned in the complete record. `view=links` is valid only for a
Bead and is defined under **Incident Link reads**. `view=events` is valid for a
Bead or Link only in the Transactional profile and is defined under **Event
replay and live observation**. Read and Read+Update do not expose it.

`include=links` is valid only for a Bead. It returns the ordinary complete Bead
record with a `links` member containing the first paginated page of the same
result exposed by `view=links`:

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
        "source": {
          "id": "https://beads.example/acme/beads/task-42",
          "type": "https://work.example/types/task"
        },
        "target": {
          "id": "https://beads.example/acme/beads/person-7",
          "type": "https://people.example/types/person"
        },
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
aggregate request always embeds at most one page; a client follows `next` into
the Link view rather than requesting another aggregate page. `direction`
defaults to `both`, and `limit` bounds the embedded page. `include=links`
cannot be combined with `view` or `cursor`. The entity tag of an aggregate
response represents the entire aggregate response and can therefore change
when its embedded Link page changes even if the Bead's `revision` does not.

Using a query parameter avoids placing protocol-owned child names beneath a
hierarchical Resource ID. BDP reserves `view`, `include`, and the parameters
defined for each view or aggregate on Bead and Link URLs. An unsupported view,
include, or parameter that is not defined for the selected request is an error
rather than an instruction to ignore that parameter.

### Reads after deletion

After a Bead or Link is deleted, ordinary `GET`, `view=properties`, and, for a
Bead, `view=links` return the same `404` `resource-not-found` problem used for
an unknown or non-visible identity. BDP does not require an authority to reveal
whether the Resource once existed. The non-reuse rule remains internal: a
filesystem-backed implementation may retain only a compact allocation marker
or tombstone and need not serve it as a Resource representation.

In the Transactional profile, an authorized `view=events` may remain readable
at that canonical URL while its Event Source is retained. That history does not
make the deleted subject readable again. When the Event Source is no longer
retained, an authority may return `410` `event-history-expired` only to a
principal authorized for that subject's retained history and only when its
policy permits disclosing that the history elapsed. Unknown identities and
identities outside the caller's authorization projection always return the
same `404` `resource-not-found`; `410` is not an identity-enumeration oracle.

### Types and Type Descriptors

The discovered `types/` Resource inventories the Bead and Link Type
Descriptors that the Scope advertises as known. It supports generic tooling,
schema preloading, and discovery of the contracts the service can validate. It
is not a closed-world claim that no other Type exists.
The response is paginated with the same authoritative continuation and
snapshot rules as Bead and Link collections. Each page is an object containing
`items` and `next`; each item is exactly the Type summary `{id, name,
describes}`.

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
outside the Scope. The inventory says that the Scope knows the Type; it does
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
    "https://work.example/types/work-item"
  ],
  "propertiesSchema": "https://work.example/schemas/task-properties-v1"
}
```

A Link Type Descriptor is the same contract plus `source` and `target`
endpoint constraints. This `assigned-to` Link Type accepts any Work Item as its
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
      "https://work.example/types/work-item"
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
- `conformsTo` contains the unordered direct parent Type IDs and is always an
  array;
- `propertiesSchema`, when present, is the absolute URL of a JSON Schema for
  the Resource's `properties` object, not its generic BDP record; and
- for a Link Type, `source.conformsTo` and `target.conformsTo` list Types that
  the corresponding in-Scope endpoint Bead must satisfy. Every listed Type is
  required; an empty list accepts any in-Scope Bead at that endpoint. An
  out-of-Scope endpoint is opaque and is not checked against these lists.

Descriptor objects and endpoint-constraint objects are closed: no members are
allowed except those defined above. Type-ID arrays contain unique Type URLs and
may be empty where this specification permits an unconstrained endpoint.

The canonical `typeDescriptor` definition exists only in the single BDP v0
schema bundle at `schemas/bdp-v0.schema.json#/$defs/typeDescriptor`. The
specification prose above and that schema definition must remain aligned; this
section does not carry a second inline schema copy.

#### Descriptor resolution and installation

A client may dereference a Type ID directly using ordinary Web retrieval and
caching. A BDP service SHOULD retain any descriptor it successfully resolves so
globally shared and well-known Type IDs do not require repeated network access.
This recommendation does not require a read-only service to resolve every Type
that appears in data before it can return the Resource record.

An authority that validates mutations has the stronger obligation defined by
the data model: before admitting a request that uses a Type, it MUST install and
pin that Type's complete contract closure. Resolution may be an administrative
operation outside BDP v0, but it finishes before request admission and holds no
graph transaction or Resource locks while performing network I/O. A mutation
that names an unavailable Type fails as `type-not-installed`; the mutation does
not initiate installation. Validation, retry, replay, and recovery use only the
pinned local copy. Administrative limits bound descriptor count and size,
closure depth, schema count and size, reference depth, retrieval time, and
compiled-validator resources.

Every BDP properties schema uses JSON Schema Draft 2020-12. An omitted
`$schema` is interpreted as that dialect; a schema declaring another dialect is
invalid for BDP v0. `$id`, `$ref`, anchors, and the declared vocabularies have
their Draft 2020-12 meanings. Installation resolves the complete transitive
reference closure and stores every referenced schema resource locally;
validation never performs an implicit fetch. An authority MUST implement every
required vocabulary in an installed schema or reject the installation. The
JSON Schema `format` vocabulary remains annotation unless a separate BDP rule
gives a particular format assertion semantics.

The installed artifacts and an internal integrity fingerprint are retained as
one immutable validation closure. A service MUST NOT automatically replace any
contract-bearing descriptor or schema at the same Type ID, even if an HTTP
cache entry changes. BDP v0 does not standardize a public digest or require
semantic-equivalence analysis across differently serialized schemas.

#### Effective Type contracts

The same composition rules apply to Bead Types and Link Types. A Resource has
one declared Type, but the declared Type may list multiple direct parents. Its
effective Type set is the declared Type plus the transitive `conformsTo`
closure. Every direct parent must describe the same Resource category as its
child, the graph must be acyclic, and a diamond-shaped graph contributes a
shared ancestor only once.

There is no parent order, overriding, or field-level conflict resolution. The
effective properties contract is the intersection of every
`propertiesSchema` in the effective Type set: a properties object is valid
only if it validates against all of them. A derived Type's schema describes
only its additional constraints and does not restate its parents' schemas. A
tool may represent the effective schema as an `allOf` over the resolved
schemas, for example:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "allOf": [
    { "$ref": "https://work.example/schemas/work-item-properties-v1" },
    { "$ref": "https://audit.example/schemas/auditable-properties-v1" },
    { "$ref": "https://work.example/schemas/task-properties-v1" }
  ]
}
```

This is a semantic valid-set intersection, not a requirement that a service
prove syntactic JSON Schema subsumption. If the schemas contradict one another,
the effective contract is uninhabitable and all writes of that Type fail
validation. An authority reports contradictions it detects but is not required
to prove that an arbitrary schema intersection is satisfiable.

During bootstrap, the root object described by every `propertiesSchema` is
open. A root-level `additionalProperties` or `unevaluatedProperties` member is
therefore omitted or `true`; a root-level `false` or schema-valued restriction
is invalid for BDP. Nested objects may be closed independently. This lets
independent Type contracts compose without one parent rejecting another
parent's properties. A successful Resource read returns the complete stored
properties object, including properties not declared by any effective schema,
and an update preserves every untouched property.

#### Link endpoint constraints

Link endpoint constraints compose through the same effective Type closure and
apply only to in-Scope endpoints. Every `conformsTo` entry on the corresponding
endpoint across the declared Link Type and all its effective parent Types is
required. A local source Bead is valid only when its effective Type set contains
every source requirement; the target rule is identical and is never
directionally swapped. This is an intersection: an endpoint requiring both
`WorkItem` and `Auditable` accepts only a Bead that conforms to both. Union
constraints are not part of the bootstrap model. An out-of-Scope endpoint is
opaque and neither satisfies nor fails these requirements.

Maximum endpoint multiplicity is instead a Scope-owned aggregate policy because
it inspects other Links. The data-model section defines its semantics and the
optional discovery representation.

A service validates a Resource by checking its generic Bead or Link record,
resolving the declared descriptor and effective Type set, rejecting category
mismatches, and applying the effective properties contract. For a Link, it also
applies the effective endpoint constraints to each in-Scope endpoint and then
evaluates applicable Scope aggregate constraints.

A client may skip all descriptor and schema reads and still parse, display,
and attempt to mutate any Resource. The authority performs validation and
diagnoses invalid writes. A Type whose complete closure is unavailable or
invalid is not installed and a mutation naming it fails as `type-not-installed`.
A Resource validation failure returns a bounded diagnostic list identifying the
failing effective Type and schema location; discovery advertises the diagnostic
count and byte limits. An uninhabitable installed contract may therefore remain
describable while every attempted Resource value fails validation. Union
endpoint constraints, minimum multiplicity, and tuple-uniqueness rules are not
part of BDP v0.

The descriptor deliberately does not restate generic BDP operations. The BDP
project MAY publish one generated
[OpenAPI 3.1 description](https://spec.openapis.org/oas/v3.1.2.html) for each
protocol version as non-normative tooling. That document describes the generic
profile surface and open Resource `properties`; it is derived from this
specification and the normative schema bundle.

A conforming Scope or Type Descriptor is not required to publish another
OpenAPI document. Domain Types constrain `properties` without redefining the
generic operations. If describing one deployment required a different API
surface, that would be evidence of a BDP uniformity defect rather than a reason
to create a second normative operation description.

A Type Descriptor cannot add an operation, query, view, Event Type, or
protocol method. Domain-specific behavior belongs in clients that interpret
nominal Types and use BDP's generic surface; it is not an extension advertised
by a Type or Scope.

### Read+Update sequence target

The Read+Update and Transactional profiles expose `operations/sequence` as a
convenience carrier for the six single-Resource operations. It is deliberately
not named `batch`: a sequence is ordered and partially committing, while BDP
`batch` is the Transactional profile's all-or-nothing Mutation Transaction.

A sequence contains one or more operation members. Each member carries its own
`idempotencyKey` and one of the six singleton operation records. The authority
validates the carrier and operation-record syntax before starting, then:

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
The binding becomes available only after the create commits. A reference to a
forward, unknown, failed, or wrong-kind binding makes that member fail; it does
not prevent later independent members from running.
Bindings are confined to one sequence request and do not add isolation: an
interleaving request may update or delete the committed Resource before a later
member uses it.

The response preserves declaration order and contains one terminal result or
problem for every member. A syntactically admitted sequence returns `200 OK`
even when some members fail; per-member dispositions carry partial success. A
carrier or operation-record syntax error is rejected before execution with a
direct problem response. Sequence responses are not durable Mutation Receipts.
Retrying a member with the same idempotency key and semantic operation returns
its retained disposition; using that key for different semantics is an
idempotency conflict.

The sequence carrier itself does not use an `Idempotency-Key` HTTP field; its
member keys are authoritative. The normative request and response envelope
definitions, key syntax and qualification, duplicate-join behavior, and finite
outcome-retention rules remain schema/problem artifacts that MUST be authored
and reviewed before the Read+Update implementation wave. This semantic
decision does not authorize an implementation to invent those wire details.

### Batch operation target

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section. A
> BDP `batch` target belongs only to the Transactional profile and always means
> the ordered, all-or-nothing operation defined here.

A Read or Read+Update Scope MUST NOT advertise or accept a target as BDP
`batch`. In particular, the Read+Update profile does not weaken `batch`
into independent or partially successful operations under the same protocol
name.

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
      "source": {
        "id": "@newTask",
        "type": "https://work.example/types/task"
      },
      "target": {
        "id": "beads/person-7",
        "type": "https://people.example/types/person"
      },
      "properties": {}
    }
  ]
}
```

`name` is the wire spelling of the model's transaction-local label. In a
Resource-reference member, a string beginning with `@` refers to the Resource
created by the preceding operation with that name. It denotes only Resource identity;
it is not an expression and cannot be followed by a property or result path.

Labels match `[A-Za-z][A-Za-z0-9_-]*` and are unique within the batch. The
service rejects forward references, unknown names, duplicate names, and
Resource-kind mismatches. A durable local ID whose relative spelling begins
with `@` must be supplied as its absolute Resource URL in a batch, avoiding any
ambiguity with a transaction-local reference. Singleton operations do not
accept transaction-local references.

Before idempotency comparison or execution, durable relative Resource
references are resolved against the canonical Scope URI and normalized to
absolute canonical URLs. JSON object member order and equivalent accepted local
versus absolute spellings therefore do not cause a false idempotency conflict;
operation order, array order, member presence, and JSON values remain semantic.

### Operation record schema

> **Transactional/Replication constructs within this section.**
>
> The batch wrapper, `updateWhere`, and `deleteWhere` definitions apply only to
> Transactional. Read+Update `sequence` uses the `operation` discriminator,
> optional create-member `name`, per-member `idempotencyKey`, and only the six
> single-Resource definitions. Singleton targets remove `operation`, `name`,
> and body-level `idempotencyKey` as described below.

Every object in a batch conforms to the bundle's operation definition. The
following non-normative drafting sketch previews the eight-record
Transactional union; it has no independent `$id`. The `operation`
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
    "endpointReference": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id": { "$ref": "#/$defs/resourceReference" },
        "type": { "$ref": "#/$defs/typeId" },
        "revision": { "type": "string", "minLength": 1 }
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
        "properties": { "$ref": "#/$defs/properties" }
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
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" }
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
        "source": { "$ref": "#/$defs/endpointReference" },
        "target": { "$ref": "#/$defs/endpointReference" },
        "properties": { "$ref": "#/$defs/properties" }
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
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" }
      },
      "additionalProperties": false
    },
    "deleteLink": {
      "type": "object",
      "required": ["operation", "link"],
      "properties": {
        "operation": { "const": "deleteLink" },
        "link": { "$ref": "#/$defs/resourceReference" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" }
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
        "cardinality": { "$ref": "#/$defs/cardinality" }
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
        "cardinality": { "$ref": "#/$defs/cardinality" }
      },
      "additionalProperties": false
    }
  }
}
```

`id` appears on both creation records because identity and Type are both
immutable. Omitting `id` asks the authority to allocate it; omitting `type` is
never permitted. `properties` defaults to an empty object when omitted.

`bead` and `link` contain a durable local ID, an absolute canonical Resource
URL, or, in a batch only, an `@label` of the required Resource kind. `source`
and `target` are `EndpointReference` objects whose `id` accepts those same
local Bead spellings or an absolute out-of-Scope URI and whose `type` is always
an absolute URL. The authority performs reference resolution,
canonicalization, label resolution, and Resource-kind validation. A durable
relative endpoint `id` resolves against the canonical Scope URI rather than the
request or containing Link URL and must name a live Bead whose declared Type
equals the supplied `type`. An absolute endpoint `id` outside the Scope is
accepted only with the BDP v0 External Reference sentinel; it remains opaque
and is not kind-checked or dereferenced, and only that sentinel form may
supply the optional endpoint `revision` citation under
[Local Resource references](#local-resource-references) — an in-Scope
endpoint reference carrying `revision` is rejected. Neither case mutates an
endpoint Bead or changes its revision.

The singleton target for an operation accepts the corresponding record with
`operation` and `name` removed. Their meanings are supplied by the target URL
and a batch, respectively. Thus the batch schema and singleton request bodies
share one field vocabulary.

### Property-change values

BDP represents a Property Change as a bounded
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to the
Resource's `properties` object. It admits only `add`, `replace`, and `remove`;
`move`, `copy`, and `test` are excluded from BDP v0. Operations execute in array
order. `add` has RFC 6902 object replacement and array insertion/append
semantics; `replace` and `remove` fail when the target does not exist. JSON
Pointer evaluation is relative to the complete `properties` value.

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
Section 4.6 JSON comparison, the operation is a no-op: it preserves the Resource
revision and emits no `updated` Event.

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
  "selector": "$[?@.source.id == \"https://beads.example/acme/beads/task-42\" || @.target.id == \"https://beads.example/acme/beads/task-42\"]",
  "cardinality": {
    "max": 1000
  }
}
```

`collection` is exactly `beads` or `links`. A cardinality object may contain
inclusive `min`, `max`, or both. Set mutation is never paginated: the service
either mutates the complete matched set atomically or fails before commit.
Selectors are evaluated against canonical response-shaped candidates, so
identity literals inside Selector strings use absolute canonical URLs. BDP v0
does not define `expectedMembers`; callers that intend to mutate previously
observed identities use explicit operations with `expectedRevision`.

The candidate collection contains only Resources visible in the request's
Authorization View. Cardinality is measured over that projected match. If any
matched Resource is not writable, the operation fails atomically rather than
filtering that Resource out. The authority nevertheless evaluates global graph
constraints against complete authoritative state and may return a
non-disclosing conflict when hidden state prevents the mutation.

The incident-Link deletion can compose with explicit Bead deletion in the same
transaction:

```json
{
  "operations": [
    {
      "operation": "deleteWhere",
      "collection": "links",
      "selector": "$[?@.source.id == \"https://beads.example/acme/beads/task-42\" || @.target.id == \"https://beads.example/acme/beads/task-42\"]",
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
representation. A successful batch contains one result per operation in
declaration order:

```json
{
  "id": "https://beads.example/acme/receipts/receipt-7",
  "status": "completed",
  "idempotencyKey": "client-generated-opaque-key",
  "scopeEpoch": "opaque-scope-epoch",
  "authorizationView": "opaque-authorization-view",
  "requiredPosition": "opaque-position-43",
  "effectPosition": "opaque-position-43",
  "transaction": "opaque-transaction-id",
  "results": [
    {
      "name": "newTask",
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/beads/task-104",
        "type": "https://work.example/types/task",
        "revision": "opaque-task-revision",
        "properties": {
          "title": "Specify BDP mutation",
          "status": "open"
        }
      }
    },
    {
      "outcome": "created",
      "resource": {
        "id": "https://beads.example/acme/links/assigned-to-81",
        "type": "https://work.example/types/assigned-to",
        "revision": "opaque-link-revision",
        "source": {
          "id": "https://beads.example/acme/beads/task-104",
          "type": "https://work.example/types/task"
        },
        "target": {
          "id": "https://beads.example/acme/beads/person-7",
          "type": "https://people.example/types/person"
        },
        "properties": {}
      }
    }
  ],
  "next": null,
  "expiresAt": "2026-09-04T19:12:45Z"
}
```

Created and updated results carry complete postimages and revisions. Deleted
results carry the deleted canonical identity. An admitted no-effect mutation
reports the current `requiredPosition` and omits `effectPosition`. A pending
duplicate uses the same receipt `id` with `status` equal to `pending`; the client
may wait, repeat the original request, or read that receipt until it becomes
terminal.

`authorizationView` records the view under which the operation executed. A
later policy change does not create a new idempotency namespace or permit the
mutation to run again. Reading the receipt after such a change returns its
unchanged identity and disposition but re-authorizes the detailed `results` and
problem information under the caller's current view. Its recorded
`requiredPosition` remains evidence about the original view and is not a valid
minimum-read checkpoint for the replacement view.

When all results fit within the advertised bound, the original response contains
them and `next` is `null`; no follow-up request is required. Otherwise it
contains the first page and an absolute `next` URL for another immutable page of
the same receipt. The transaction creates that result atomically, pages never
truncate or recompute it, and receipt retention determines result availability.

If an operation fails after admission, the synchronous response is the terminal
Mutation Receipt with `status` equal to `failed` and one problem value
identifying the failing operation by zero-based index and, when present,
`name`. It contains no committed operation results because the complete
transaction is rolled back. Retrying returns that same failed receipt. Request
syntax and authentication failures that occur before admission return a direct
problem response and do not create receipts. Exact HTTP statuses and receipt
problem schemas remain part of wire-contract closure.

### Incident Link reads

A Bead record does not embed its incident Links. A client selects the Link view
directly on the Bead URL and supplies a direction:

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
omitted. `inbound` selects Links whose `target.id` is the Bead; `outbound`
selects Links whose `source.id` is the Bead; and `both` selects their union. The
response is a paginated `items` array of complete Link records plus a `next`
URL. The initial request may supply `limit`; subsequent requests follow `next`.
As with collection pagination, that continuation walks one logical snapshot
and an expired cursor is an error rather than a silent restart against newer
state.
Only an in-Scope Bead has this view; an opaque out-of-Scope endpoint does not.

BDP does not append `/links` to the Bead URL. Local IDs may contain multiple
path segments, so `beads/task-42/links` could already be the ID of a different
Bead. A suffix subpath would require BDP to reserve and visibly mangle a control
segment such as `/-/` or `/.bdp/` throughout the local-ID grammar. The `view`
query parameter avoids that collision while keeping the request visibly
anchored at the Bead. The Link collection still owns Link identity; the Bead's
Link view is only a derived read.

### Collection retrieval and selection

An ordinary `GET` of a discovered collection returns a paginated `items` array
and a `next` URL. The `beads/` and `links/` collections return complete
Resource records; the `types/` collection returns Type summaries. The
collections accept these structural predicates:

| Parameter | `beads/` | `links/` | `types/` | Meaning |
| --- | --- | --- | --- | --- |
| `type` | yes | yes | no | Exact Type ID |
| `conformsTo` | yes | yes | no | Effective conformance to the named Type ID |
| `source` | no | yes | no | Exact source endpoint ID |
| `target` | no | yes | no | Exact target endpoint ID |
| `endpoint` | no | yes | no | Source or target ID equals the supplied ID |
| `selector` | yes | yes | no | Bounded Selector over each candidate record |
| `limit` | yes | yes | yes | Maximum records in this page |
| `cursor` | yes | yes | yes | Opaque continuation supplied by `next` |

Different predicates are combined with logical AND. Within `endpoint`, source
and target are combined with logical OR. A parameter may occur at most once in
BDP v0; repeated parameters are errors rather than implicit unions. Type IDs
are absolute URLs. The structural `source`, `target`, and `endpoint` parameters
may use a canonical local Bead ID, its absolute canonical URL, or an absolute
out-of-Scope URI. The authority normalizes local Bead references before
comparison; external URI comparison is exact. This convenience does not apply
inside a Selector string.

An unsupported collection query parameter or any repeated collection query
parameter returns the `invalid-parameter` Problem: family `request`, HTTP status
`400`, and retry disposition `never`. The authority MUST NOT ignore an
unsupported parameter or choose one value from a repeated parameter.

The `selector` value is the same JSONPath Selector string accepted by
`updateWhere` and `deleteWhere`; it is percent-encoded in the request target:

```http
GET /acme/links/?selector=%24%5B%3F%40.source.id%20%3D%3D%20%22https%3A%2F%2Fbeads.example%2Facme%2Fbeads%2Ftask-42%22%20%7C%7C%20%40.target.id%20%3D%3D%20%22https%3A%2F%2Fbeads.example%2Facme%2Fbeads%2Ftask-42%22%5D HTTP/1.1
Host: beads.example
Accept: application/json
```

The decoded Selector is:

```text
$[?@.source.id == "https://beads.example/acme/beads/task-42" || @.target.id == "https://beads.example/acme/beads/task-42"]
```

The structural predicates and Selector decide the complete matching set before
pagination, but only within the request's Authorization View. A
cursor continues one logical projected snapshot: every page belongs to the same
selected set, authorization projection, and Resource revisions as the initial
request. The server-generated `next` URL is authoritative and carries the
opaque cursor plus any parameters needed to continue that snapshot. `next` is
`null` after its final page. In Read and Read+Update, the opaque cursor itself
carries or indexes
the authorization-projection fence; clients neither inspect it nor need a
separate Authorization View field. If the authority can no longer continue the
snapshot, or if the request no longer belongs to that projection, it returns an
expired- or foreign-view-cursor problem rather than silently restarting against
newer state.

Selector candidate records use the same absolute canonical identity spelling as
responses. BDP does not parse or rewrite JSONPath string literals that happen to
look like local identifiers. This makes JSONPath equality ordinary string
equality and keeps selector behavior independent of request spelling aliases.

Collection responses do not accept Resource `view` or `include` parameters;
their `items` are always complete Resource records. In particular, a Bead
collection cannot embed each Bead's incident Links. Clients select Links from
`links/` or use the Link view on one Bead. Services may advertise a maximum
encoded request-target length and Selector complexity, but must not silently
interpret a truncated Selector. Ordinary `GET` semantics make simple
selections browser-debuggable and compatible with conditional requests without
requiring the newer `QUERY` method or a request body on `GET`; the
authorization-dependent `private, no-store` rule remains binding.

### Operation Directory and singleton targets

> **Transactional/Replication entries within this section.**
>
> Read+Update uses the six single-Resource entries plus `sequence`.
> `update-where`, `delete-where`, `batch`, one-operation transaction
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
POST operations/sequence
POST operations/update-where
POST operations/delete-where
POST operations/batch
```

`GET operations/` returns these names and relative target URLs as a JSON
object, allowing a client to follow the directory rather than construct paths.
For a Transactional Scope the response is:

```json
{
  "createBead": "create-bead",
  "updateBeadProperties": "update-bead-properties",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLinkProperties": "update-link-properties",
  "deleteLink": "delete-link",
  "sequence": "sequence",
  "updateWhere": "update-where",
  "deleteWhere": "delete-where",
  "batch": "batch"
}
```

A Read Scope does not advertise `operations` and has no BDP Operation
Directory. A Read+Update Scope's directory contains exactly the six singleton
targets plus `sequence`:

```json
{
  "createBead": "create-bead",
  "updateBeadProperties": "update-bead-properties",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLinkProperties": "update-link-properties",
  "deleteLink": "delete-link",
  "sequence": "sequence"
}
```

In the Transactional profile, each singleton target accepts the members defined
by its operation record, excluding the batch-only `operation` discriminator and
`name` label. It executes as a one-operation Mutation Transaction and returns
the same Mutation Receipt shape with a one-element `results` array.
Transactional singleton requests require `Idempotency-Key` and cannot use
`@label` references.

Within the Transactional profile, the singleton and batch forms have identical
allocation, patch, validation, authorization, idempotency, concurrency, event,
and deletion semantics. The Read+Update profile preserves the existing
`create-bead`, `update-bead-properties`, `delete-bead`, `create-link`,
`update-link-properties`, and `delete-link` target names and their operation
request records, and adds `sequence`. Each Read+Update singleton requires an
`Idempotency-Key` HTTP field and returns its final Resource postimage, deleted
identity, or direct problem inline rather than a Mutation Receipt. Read+Update
does not include the set-oriented `update-where` or `delete-where` targets,
which require selection and mutation at one serialization point, and it does
not include `batch`.

BDP v0 does not additionally define `POST` on collections or `PUT`, `PATCH`, or
`DELETE` on individual Resource URLs. BDP v0 also does not add a POST-based read
selector fallback: services enforce bounded GET request-target and Selector
limits, may pre-advertise them through `limits`, and a future version may add
another read carrier if implementation evidence requires it.

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
  "beads": {
    "items": [
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
        "source": {
          "id": "https://beads.example/acme/beads/task-42",
          "type": "https://work.example/types/task"
        },
        "target": {
          "id": "https://beads.example/acme/beads/person-7",
          "type": "https://people.example/types/person"
        },
        "properties": {}
      }
    ],
    "next": null
  }
}
```

Each non-null `next` is an absolute server-generated URL bound to the snapshot
identity, stream kind, Scope epoch, Authorization View, position, and expiry.
Bead and Link streams may be paged independently but never move to a newer
anchor. The authority keeps the snapshot continuable through `expiresAt`;
inability to serve a page before then is a service failure, not an
expired-cursor result. A client stages all pages and exposes the replacement
generation atomically only after both streams end.

`checkpoint` is the opaque epoch-qualified value supplied as the exclusive
`after` cursor to the Scope changefeed. The authority retains every group after
`scopePosition` through `expiresAt`. Collection cursors remain query snapshots
and do not substitute for this complete projected Scope snapshot.

### Scope changefeed

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section.

The discovered `changes/` Resource is the lossless replication suffix. A client
supplies exactly one explicit starting intent:

- `after={checkpoint}` to continue exclusively after a snapshot or previously
  applied group;
- the distinguished genesis checkpoint to request complete history when it is
  still retained; or
- `start=now` to deliberately observe only future groups.

Omitting both is an error; it never means “start at whatever history remains.”
A finite JSON read returns only complete change groups:

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

`changes` contains the final canonical postimages needed to advance the
Authorization View, and identity-bearing tombstones for Resources that leave
it. For an underlying deletion, a tombstone contains `resourceKind`, absolute
`id`, immutable `type`, and final live `revision`; for any other projection
removal within a stable view it contains the last values visible in that view
and does not assert underlying deletion. A grant or revocation instead changes
the view token and requires a fresh snapshot. At most one normalized `changes`
entry exists per affected Resource.
`events` retains its visible semantic operation order and every Event's
zero-based authority-group `ordinal`, including gaps left by hidden facts;
consumers do not derive application Events from postimages.

When a transaction has no visible effect, the group is instead an
identifier-free projection advance:

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
  "events": []
}
```

It omits `transaction` and all Resource-derived values. It deliberately reveals
that an authority transaction occupied the position, but nothing about its
identity or contents.

The client applies an entire group atomically and advances its durable cursor
only to that group's `checkpoint`. `observedHeadPosition` is the projected Scope
head observed for the finite read, allowing a client to recognize catch-up even
when `groups` is empty. A page and an SSE message never split a group.

Accepting `text/event-stream` on the same Resource delivers one complete group
per SSE message. The SSE `id` is the group's checkpoint, `event` is
`change-group`, and `data` is the complete JSON group. On automatic reconnect,
`Last-Event-ID` overrides the original `after` value. A stale, unavailable,
foreign-epoch, or foreign-view checkpoint fails explicitly and requires a new
snapshot; the authority never advances it silently to
`minimumReplayPosition`.

### Event replay and live observation

> **Transactional/Replication contract in this draft.**
>
> Read and Read+Update implementations may skip this section. Its complete
> cursor, replay, SSE, and transaction-framing contract is required only by the
> Transactional profile.

The discovered `events/` Resource is the application-facing Scope Event Source.
A Resource-scoped Event Source is selected with `view=events` directly on the
Bead or Link URL. These are deterministic projections of Events already
committed inside Scope change groups; they are not independent logs and are not
the lossless replication changefeed. An Event is visible only when its fact is
part of the projected transition: `created` and `linked` references are visible
in the post-state, `deleted` and `unlinked` references were visible in the
pre-state, and `updated` references are visible in both. Its cursor is bound to
that view, and a changed view token requires a new snapshot or Event-Source
start according to the source's retention contract. A finite read returns
Events in source order:

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
        "source": {
          "id": "https://beads.example/acme/beads/task-42",
          "type": "https://work.example/types/task"
        },
        "target": {
          "id": "https://beads.example/acme/beads/person-7",
          "type": "https://people.example/types/person"
        }
      }
    }
  ],
  "next": "https://beads.example/acme/beads/task-42?view=events&after=event-105"
}
```

`after` is an exclusive opaque cursor whose spelling is the ID of an Event in
that Event Source. Omitting it starts at the earliest retained Event. `next`
continues after the last returned Event and is `null` when the read reached the
Source's current end. Event IDs and ordering have meaning only within their
Event Source. Each ID is stable for the Event's change-group checkpoint,
ordinal, and source projection.

Every Event record contains source-local `id`, stable change-group `ordinal`,
one of the five model-defined `type` values, the `source` URL, the affected
Resource `subject` and `subjectType`, an opaque `transaction` identifier, an
RFC 3339 `time`, and a Type-specific `data` object. Event data contains deltas
rather than Resource snapshots:

- `created` carries `revision` and the complete initial `properties`. For a
  Link it also carries `source` and `target` endpoint references. An in-Scope
  reference carries the Bead's declared Type and exactly `id` and `type`; an
  out-of-Scope reference carries the External Reference sentinel and
  preserves a stored endpoint `revision` citation byte-identically.
- `updated` carries `previousRevision`, `revision`, and `change`. `change` uses
  the same committed Property Change representation accepted by singleton DML.
- `deleted` carries only `revision`, meaning the final live Resource revision.
- `linked` and `unlinked` carry `endpoint`, a typed `link` reference, and the
  `source` and `target` endpoint references. They occur only in an in-Scope
  endpoint Bead's Event Source.

No Event carries a Bead properties snapshot other than that Bead's own
`created` Event. `linked` and `unlinked` carry no Resource properties at all.
`data.endpoint` is `source` or `target` and states how the Link was incident
upon the in-Scope Bead whose Event Source is being read.

The Scope-level Event Source contains the committed Events visible across the
request's Authorization View. A Resource-scoped source contains the subset
required by the abstract model. All visible Events produced by one Mutation
Transaction carry the same
`transaction` value and become visible together after commit. A self-Link
projects two endpoint Events into its Bead source, one for `source` and one for
`target`. Individual Event delivery is intended for application observation;
replicas consume the containing Scope change group atomically.

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

The SSE `id` and `event` fields repeat the JSON Event's `id` and `type`; `data`
contains the complete JSON Event record. A blank line terminates each SSE
event. The server may also send SSE comment lines as keepalives and a `retry`
field to suggest a reconnection delay.

Native browser [`EventSource`](https://html.spec.whatwg.org/dev/server-sent-events.html)
reconnects automatically and sends the most recently processed SSE `id` in the
`Last-Event-ID` request header. BDP treats that header as the exclusive replay
cursor for a live request. Because the reconnect uses the original URL, a
`Last-Event-ID` header overrides its original `after` query parameter. The
query parameter selects an initial cursor; the standard header advances it on
automatic reconnect. Clients never submit Events as mutation operations.

The receipt's `effectPosition` and the change group's Event ordinals replace an
unframed Event range in Mutation Receipts. Event IDs, checkpoints, caching, and
expired-cursor failures use the cross-cutting contracts defined above.

### Normative conformance matrix

BDP v0 publishes one machine-readable, black-box conformance matrix. Cases are
tagged by cumulative profile so an implementation runs only the Read,
Read+Update, or Transactional obligations it advertises. Tests exercise public
HTTP behavior and consume the normative schema bundle; they do not inspect an
implementation's storage or internal server interfaces.

The matrix covers, where applicable:

- discovery, client rejection of unsupported discovered versions and profiles,
  canonical references, Resource
  reads, collection selection, pagination, Type inventory, and incident Links;
- malformed input, schema failures, authorization projections, limits,
  problem codes, and retry dispositions;
- singleton mutation, revisions, idempotency, strict sequence order, local
  bindings, partial failure, and allowed request interleaving;
- Transactional ordering, atomicity, set mutation, receipts, Events, snapshot
  and changefeed agreement, disconnect recovery, expiry, restore, and
  Authorization View changes; and
- cross-implementation client/server combinations, including the reference
  implementations and every shipping product claiming the applicable profile.

The decision and coverage categories are normative. The question closes when
the reviewed matrix, fixtures, and expected results exist in the repository;
until then the affected implementation wave lacks complete acceptance evidence.

### Open protocol questions

This ledger records the protocol questions raised against the draft and their
current state, in dependency order. The 15 questions below carry recorded
decisions or explicit artifact gates; entries marked pending remain open. A
separate joint product/protocol decision selected
`https://github.com/gastownhall/bdp/` as the provisional v0 protocol-identifier
prefix, with the release-stability rule stated above.

1. **Resolved 2026-08-08:** the required discovery member is `profile`, whose
   value is `read`, `read-update`, or `transactional` and names the highest
   cumulative profile. Minimum Read comprises Scope discovery; the Bead, Link,
   and Type inventories; individual Bead and Link reads; paginated collection
   retrieval and bounded selection; the Resource `properties` view; and the
   Bead `links` view. It excludes `include=links`, Resource and Scope Events,
   receipts, snapshots, changefeeds, and mutation targets. Product readiness
   remains client-owned behavior over those generic reads.
2. **Decision recorded 2026-08-08; wire artifacts pending before mutation:**
   Read+Update supplies individually atomic singleton
   mutations plus strictly declaration-ordered `sequence`. A sequence does not
   reorder or parallelize members, but takes no sequence-wide lock and permits
   unrelated requests to interleave; successes remain committed, failures do
   not stop independent later members, and successful creates may bind local
   IDs for later members. Each member has its own idempotency key and inline
   result, revisions are opaque, `expectedRevision` is optional, and the
   profile has neither durable Mutation Receipts nor BDP Events. Transactional
   `batch` remains the distinct atomic carrier. The sequence envelopes and
   complete per-member idempotency contract must be authored and reviewed
   before the Read+Update implementation wave.
3. **Resolved 2026-08-08:** the required machine-discovery mechanism is the
   Scope response's registered `service-desc` Link field. A `200` Scope body
   may contain HTML, Markdown, or another human representation and may link to
   the descriptor, but machines do not scrape it. Discovery JSON and Operation
   Directory members are fixed BDP vocabulary; v0 defines no BDP-specific HTTP
   link relations.
4. **Resolved 2026-08-08:** discovery may omit `limits`. When present, its
   capability-specific groups use the names and units defined under Advertised
   limits, and every advertised value is binding. An absent object, group, or
   field means that bound was not pre-advertised, not that capacity is
   unlimited; implementations must still fail normatively rather than silently
   truncate or partially apply work.
5. **Read artifact recorded 2026-08-12; later-profile definitions pending:**
   BDP v0 uses one normative JSON Schema 2020-12 bundle containing every public
   envelope and shared definition. Conformance and generated types consume that
   same offline artifact. The bundle now contains discovery and Read
   definitions, including paginated `types/` and closed Type Descriptor shapes.
   Later-profile definitions gate their corresponding waves. This question
   closes when the complete reviewed bundle exists.
6. **Read table recorded 2026-08-12; later-profile rows pending:** BDP uses a
   small set of RFC 9457 problem families plus a normative `code`, fixed status,
   and `retry` disposition. The Read profile table is closed. Direct problem
   `status` is optional but, when present, must match the HTTP status; extension
   members are allowed. Unsupported and repeated collection query parameters
   use `invalid-parameter`, family `request`, status `400`, and retry `never`.
   Sequence-member problems add required member `status`, index, and optional
   name. This question closes when every normative failure is present in the
   reviewed code table and schema bundle.
7. **Resolved 2026-08-08:** only Transactional exposes Scope epoch,
   Authorization View, visible position, and minimum-position HTTP fields. Read
   and Read+Update use Resource `ETag`s and snapshot-preserving cursors without
   cross-replica read-after-write guarantees. Scope data is private/no-store;
   enabled CORS allows every supported BDP request field and exposes the
   required response and retry fields; SSE is no-store/no-transform.
8. **Resolved 2026-08-08:** Event IDs and checkpoints are case-sensitive,
   1–256 character ASCII tokens restricted to `[A-Za-z0-9_-]`; `genesis` is the
   reserved initial checkpoint. The identical token is safe in JSON, queries,
   HTTP fields, SSE `id`, and `Last-Event-ID`.
9. **Resolved 2026-08-08:** deleted, unknown, and non-visible Resources return
   the same `404` `resource-not-found` response for ordinary, properties, and
   incident-Link reads. Non-reuse remains an internal obligation. Transactional
   Event history may outlive its deleted subject for its retention period.
10. **Resolved 2026-08-08:** authority-attested actor attribution is excluded
    from BDP v0. Authentication remains an authorization input; private audit
    records and domain actor properties are not generic BDP guarantees.
11. **Resolved 2026-08-08:** BDP defines no universal root Bead or Link Type.
    `describes` supplies Resource category, and `conformsTo` contains only
    domain-defined Type relationships.
12. **Resolved 2026-08-08:** per-Scope and per-Type OpenAPI publication is not a
    conformance requirement. The BDP project may publish one generated,
    non-normative OpenAPI document per protocol version; the specification and
    schema bundle remain authoritative.
13. **Decision recorded 2026-08-08; artifact pending:** one portable black-box
    matrix is cumulative by profile and covers positive, negative, concurrency,
    disconnect, expiry, restore, authorization-view, and cross-implementation
    behavior. This question closes when its reviewed machine-readable matrix,
    fixtures, and expected results exist.
14. **Resolved 2026-08-08:** discovery optionally carries the unordered
    `maximumEndpointMultiplicity` array. Absence or an empty array means no such
    policy. Administrative replacement is atomic relative to mutations and may
    not introduce an already-violated maximum; reads remain valid and discovery
    changes its `ETag`.
15. **Resolved 2026-08-08:** every v0 Link has at least one in-Scope Bead
    endpoint. A future cross-Scope indexing profile may define ownership and
    lifecycle for Links whose endpoints are both external.

Implementation proceeds Read-first. Later-profile work begins only when its
schema, problem, and conformance artifacts are reviewed; implementation
evidence feeds corrections back into this draft rather than silently defining
wire behavior.

### Deferred companion work and implementation evidence

This subsection is a non-normative development ledger. It records required
follow-on work so moving the specification does not silently discard it:

- Define a separate administrator/operator specification for installing,
  pinning, inventorying, replacing, and evolving Type Descriptor contract
  closures. Core BDP clients do not receive those powers.
- Defer the non-normative mapping appendix for the `bd` domain until a working
  implementation of `bd ready` exists. Harvest the example from working code
  rather than inventing a second domain model in this specification.
- Build a Node/TypeScript `bdp` client with the obvious generic protocol
  surface and a `bd` subcommand, a deterministic `bdptest` server for client
  conformance testing, and a `bdpbd` server that adapts the current `bd` CLI.
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
