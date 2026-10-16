---
status: draft
intended-status: normative
version: 0
---

# BDP Write

This document depends on [Core and Read](../core/core.md), including its
status, requirement-language rules, shared model and inherited Read obligations.
It preserves the existing Read+Update and Transactional profiles: Write is a
document name, not a new advertised profile. `sequence` remains non-atomic;
`batch` remains atomic. The [conformance index](../../conformance.md) is shared.

<!-- protocol-text -->

<a id="part-ii--readupdate"></a>

## Part III — Read+Update

Part III inherits the Data Model and the Read profile, adding
single-operation atomic writes, aliases, ordered non-atomic sequence and durable
per-operation retry semantics. Each successful member commits independently.
Every mutation applies to exactly one Scope. No later profile is needed to
interpret a request, result or failure in this part.

### Read+Update discovery

Read+Update adds required `operations` and `aliases` navigation members to
Read discovery and advertises `profile: "read-update"`. It inherits the
optional History capability. Its discovery schema is the closed
`readUpdateDiscovery` definition: `bdpVersion`, `profile`, `scope`, `beads`,
`links`, `types`, `operations`, and `aliases` are required; `limits`,
`maximumEndpointMultiplicity`, `order`, and `historicalResolution` are optional
under their inherited contracts. These are the only admitted members.

A minimum Read+Update discovery representation adds its Operation
Directory and its alias root:

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

### Read+Update schema and limits

The normative bundle defines `readUpdateDiscovery`,
`readUpdateOperationDirectory`, the singleton and sequence requests and
responses, inline mutation/alias results, and `readUpdateProblem`. Its
`readUpdateAdvertisedLimits` definition is closed and uses the shared limit
primitives. It admits exactly `page`, `request`, `resource`, `selector`,
`patch`, `sequence`, `validation`, and `retention`; the `retention` object
admits only `idempotency` and the pagination `maximumSnapshotLifetime`.
Advertised bounds are binding.

### Operation Directory and singleton targets

The discovered `operations/` Resource is a directory of the generic mutation
targets available under the Scope's profile. `GET operations/` returns names
and relative target URLs as a JSON object, so clients follow the directory
rather than construct paths.

A Read+Update Scope's directory contains exactly eight singleton
targets — the six Resource targets plus `put-alias` and `delete-alias` —
and `sequence`:

```json
{
  "createBead": "create-bead",
  "updateBead": "update-bead",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLink": "update-link",
  "deleteLink": "delete-link",
  "putAlias": "put-alias",
  "deleteAlias": "delete-alias",
  "sequence": "sequence"
}
```

Concretely, each Read+Update singleton target accepts `POST` with an
`application/json` body containing its operation record with `operation`
and `name` removed — the bundle defines `createBeadRequest`,
`updateBeadRequest`, `deleteBeadRequest`, `createLinkRequest`,
`updateLinkRequest`, `deleteLinkRequest`, `putAliasRequest`, and
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

### Creation and identity allocation

A Resource's canonical ID is established at creation and never changes. A
creator MAY supply the local ID — one or more safe segments, so a memorable
or hierarchical name is identity from birth — or omit it, in which case the
authority allocates one. An authority-allocated local ID is a single opaque
segment, and for a Bead never one that is a live alias path under
[Aliases](../core/core.md#aliases): hierarchy is a
creator affordance, and an authority MUST NOT encode
meaning into segments it mints. A supplied spelling that is not already
canonical — a leading or trailing separator, an empty segment, or a
noncanonical encoding — is rejected, never normalized: trimming would mint
an identity the creator did not write.

### Mutation revisions and guards

Every successful create — and every update that changes `properties`,
common `metadata`, or, for a Bead whose Type owns outgoing Link Types,
its owned Links —
produces a fresh opaque Resource revision. A client compares revisions only for
equality and must not derive meaning from their spelling. If applying an
update leaves both `properties` and common `metadata` equal, under the JSON
value-comparison rules of RFC 6902 Section 4.6, to their values immediately
before that operation, then the operation retains the existing revision. A change to either value is one Resource
transition, with one new revision.

An explicit update or deletion may supply `expectedRevision`: the revision
observed by an earlier read or mutation result. The authority applies the
operation only if the Resource still has that revision. A mismatch fails the
individual operation without changing state. Omitting `expectedRevision` applies the change
to the Resource's current state.

Creation already requires the allocated or supplied identity to be absent.
Update and deletion already require their target to exist.

### Retained-address guards

Retained-address survival under [Revisions](../core/core.md#revisions) does not grant a
valid current `expectedRevision` guard.

### Revision allocation failures

An ordinary collision may be solved with a safe
alternative candidate. Positive persistent, repair-required allocation failure
uses write-only `revision-allocation-unsafe` / conflict / 409 / after-state-change;
transient inability to inspect safety uses existing 503 / unavailable /
after-delay. Before admission the failure is direct; after admission it follows
the member's permanent failure and retained-failure rules. Do not re-execute retained duplicates, reset deadlines, disable
otherwise available reads or fabricate pruning of retained state. No condition-
specific identity information is disclosed by the allocation problem.

### Attribution on mutations

BDP v0 does not expose an authority-attested actor in mutation results.

Attribution is **per version**: it is supplied with a write (the
`revisionProvenance` input on every version-minting operation — creating,
updating, and an owned-Link deletion that mints the source's fresh version),
immutable for the version it accompanies, and a later version may carry
different attribution. An operation that mints more than one version records
its one attribution on every version it mints: creating or updating an owned
Link versions both the Link and its source, and both carry it; deleting an
owned Link mints no Link version (deletion never does) and versions only the
source, which carries it. It is outside `properties`, never part of the
`properties` view, and takes no part in the semantic no-op comparison: a
write whose `properties` and common `metadata` changes are both no-ops mints
no revision and records no new provenance and retains the existing version’s
entire envelope.

### Property changes

A **Property Change** is an ordered
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to
one JSON object. A Resource update can apply one to `properties`, one to
common `metadata`, or both atomically. Each path is a JSON Pointer relative
to its selected object. BDP v0 admits only `add`, `replace`, and
`remove`. Operations within each array
execute in order, with RFC 6902 object and array semantics. `replace` and
`remove` require their targets to exist. `move`, `copy`, and `test` are not
part of BDP v0.

Assigning JSON `null` and removing a member are distinct operations. The
patch must yield a JSON object. The authority validates the complete
`properties` result — not merely its changed members — against every effective
Type contract; `metadata` has no Type schema. An update that leaves both
objects unchanged is a no-op. Advertised limits bound the combined patch
operation count, the path size and depth, and the resulting representation
size.

### Property-change values

BDP represents each change as a bounded
[RFC 6902 JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html) applied to
one Resource object. `propertiesChange` targets `properties` and
`metadataChange` targets common `metadata`; each JSON Pointer is relative to
its own complete object. A Resource update supplies at least one of these
arrays and may supply both in the same atomic operation. An omitted array
leaves its object unchanged. A change admits only `add`, `replace`, and
`remove`. The other patch operations — `move`, `copy`, and `test` — are
excluded from BDP v0. Operations execute in array order. `add` has RFC 6902
object replacement and array insertion/append semantics. `replace` and
`remove` fail when the target does not exist. A root-pointer `replace` with
`{}` clears either object, including common `metadata`.

```json
{
  "operation": "updateBead",
  "bead": "beads/task-42",
  "expectedRevision": "opaque-revision",
  "propertiesChange": [
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
  ],
  "metadataChange": [
    { "op": "add", "path": "/reviewedBy", "value": "agent:planner" }
  ]
}
```

This distinguishes assigning JSON `null` from removing a member. Applying the
properties patch must yield a JSON object satisfying every effective Type
schema. The metadata patch must yield a JSON object. If both results equal
their respective preceding objects under RFC 6902 Section 4.6 JSON
comparison, the operation is a no-op. It preserves the
Resource revision. Number equality in that
comparison, and the admissibility of every number literal a change carries,
are defined under [Revisions](../core/core.md#revisions).

### Explicit Bead operations

```text
[label:] CreateBead(
  id?,
  type,
  properties = {},
  metadata = {},
  revisionProvenance?
) -> BeadState
```

If `id` is omitted, the authority allocates one. If `id` is supplied, its
canonical Resource URL must never previously have been committed for any
Resource in the logical Scope. Deletion does not make it available again.

```text
UpdateBead(
  bead,
  propertiesChange?,
  metadataChange?,  // at least one change array is required
  expectedRevision?,
  revisionProvenance?
) -> BeadState
```

```text
DeleteBead(
  bead,
  expectedRevision?
) -> DeletionResult
```

`bead` may be a durable Bead ID or a sequence-local Bead reference.
Deleting a Bead removes it from the live data model; the implementation is
not required to physically erase it. `DeleteBead` fails if any live Link is
incident upon (attached to) the Bead when the operation is reached. A client must explicitly remove the incident Links before deleting the Bead.
In a sequence those removals commit separately; an interleaving write can
add a Link before the Bead deletion is reached, causing that member to fail.

### Explicit Link operations

```text
[label:] CreateLink(
  id?,
  type,
  source,
  target,
  properties = {},
  metadata = {},
  revisionProvenance?
) -> LinkState
```

If `id` is omitted, the authority allocates one. If `id` is supplied, its
canonical Resource URL must never previously have been committed in the
logical Scope. `source` and `target` may refer to Beads created earlier
in the same sequence. Each is a Reference and either may be
pinned; whether an endpoint is in-Scope or out-of-Scope derives from its
`uri` alone.

```text
UpdateLink(
  link,
  propertiesChange?,
  metadataChange?,  // at least one change array is required
  expectedRevision?,
  revisionProvenance?
) -> LinkState
```

```text
DeleteLink(
  link,
  expectedRevision?,
  revisionProvenance?   // recorded on the owning source's fresh version, if any
) -> DeletionResult
```

`link` may be a durable Link ID or a sequence-local Link reference.

### Alias mutation model

A reference written using an alias is resolved to the canonical Bead URL
when the authority admits the write; stored and served references are
always canonical, so aliases never appear in Resource data. Which mutation
members admit an alias spelling, and when the authority resolves it, is
defined under [Alias targets](#alias-targets). Alias creation,
repointing, and deletion are mutation surface: the Read+Update profile
defines the two alias targets, `put-alias` and `delete-alias`, under
[Alias targets](#alias-targets), and the Transactional profile inherits
them. A put creates the alias or repoints an existing
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
[Aliases](../core/core.md#aliases); `target` is a canonical in-Scope Bead reference or,
in a sequence, a local reference bound by an
earlier Bead creation. Alias operations are protocol-level operations on
the Scope's alias table rather than Resource operations: they mint no
version and stage no Resource state. When one is reached it follows the
check order under [Validation and results](#validation-and-results),
identifier uniqueness first, so a put whose path is taken and whose
target is unknown answers the uniqueness fault. The Read+Update profile
defines their wire form under [Alias targets](#alias-targets).

<a id="batch-local-resource-references"></a>

### Sequence-local Resource references

Read+Update supports bindings between separately committed members of one
`sequence`, with no isolation from interleaving work.

A creation operation may declare an optional sequence-local label:

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

- is unique within its containing sequence;
- may name only a preceding Resource-creation operation;
- denotes the created Resource's identity;
- is not a variable or an operation-result object;
- supports no property access or arbitrary expression evaluation; and
- is not persisted as part of the Resource.

In a Read+Update sequence, the creation commits before the binding becomes
available, and later members use the durable identity; on a retry, the
creation's retained or expired disposition supplies that same identity.

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
every Resource's durable state, under [Aliases](../core/core.md#aliases).

### Operation record schema

Read+Update sequence members use `operation`, optional create-member `name`,
per-member `idempotencyKey`, the six Resource operation definitions and the
two alias definitions under [Alias targets](#alias-targets). Singleton targets
remove `operation`, `name` and body-level `idempotencyKey`; the HTTP target
supplies the operation and its `Idempotency-Key` field supplies the key.

The normative bundle shares `<operation>Members` definitions between its
singleton request and sequence definitions. The request entry points are
`createBeadRequest`, `updateBeadRequest`, `deleteBeadRequest`,
`createLinkRequest`, `updateLinkRequest`, `deleteLinkRequest`,
`putAliasRequest` and `deleteAliasRequest`. Sequence entry points and examples
are defined under [Sequence request envelope](#sequence-request-envelope).

`id` appears on both creation records because identity and Type are both
immutable. Omitting `id` asks the authority to allocate it. Omitting `type` is
never permitted. `properties` and common `metadata` each default to an empty
object when omitted at creation; the resulting record exposes both.

`bead` and `link` contain a durable local ID, an absolute canonical Resource
URL, or, in a sequence, an `@label` of the required Resource kind. `source`
and `target` are endpoint references accepting those same local Bead
spellings, an absolute out-of-Scope URI, or a Pinned Reference.
The authority performs reference resolution, canonicalization, label
resolution, and Resource-kind validation. A durable relative endpoint
reference resolves against the canonical Scope URL, not against the request
URL or the containing Link URL, and must name a live Bead. An absolute endpoint reference outside
the Scope is accepted as an opaque external reference, subject to the Link
Type's external-endpoint policy. Such an endpoint is not kind-checked or
dereferenced. Either endpoint may be supplied as a Pinned Reference under
[Sequence-local Resource references](#batch-local-resource-references).
Neither case mutates an endpoint Bead or changes its revision — unless
the Link's type is owned by the source Bead's declared Type, in which
case the source's revision changes and the target's never does.

The singleton target for an operation accepts the corresponding record with
`operation` and `name` removed. The target URL supplies the meaning of
`operation`, and a sequence supplies the meaning of `name`. Thus sequence and
singleton request bodies share one field vocabulary.

Version-minting operation inputs accept the operation-local
`revisionProvenance` member; History adds agent/message recording
requirements under [History context on mutation
results](#history-context-on-mutation-results). It is never a carrier-wide
override.

### JSON mutation admission

String and object violations are carrier syntax rejected before execution
with `malformed-request`. Inadmissible numbers instead follow the
`validation-failed` admission rule under [Numeric admission](#numeric-admission).

### Numeric admission

An authority MUST refuse at
admission a `properties` document — supplied whole or through a Property
Change — that contains an inadmissible literal at any depth: nothing
changes, and the operation fails as the write profiles' `validation-failed`
with a diagnostic naming the offending member. The Read profile has no
mutation targets, so that refusal is a mutation-profile obligation defined
with those profiles.

### Installed Type contracts

Before an authority uses a Type to
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

### Descriptor installation for mutation

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

Installation resolves the complete transitive reference
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

### Type validation and diagnostics

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
[Read+Update problem details](#readupdate-problem-details). An authority that bounds the list
advertises `validation.diagnostics` and `validation.diagnosticBytes` in its
discovery document's `limits` — a Read+Update or Transactional document,
since a Read discovery document does not carry the group. An uninhabitable
installed contract may therefore remain describable while every attempted
Resource value fails validation. Union endpoint constraints, minimum
multiplicity, and tuple-uniqueness rules are not part of BDP v0.

Configured request, properties and diagnostic limits must be jointly feasible:
an authority must retain the first complete required diagnostic without
truncating a required properties-relative JSON Pointer. It must qualify the
installed diagnostic metadata and emitted location provenance against those
bounds before serving the configuration. A still-replayable retained diagnostic
list constrains subsequent configuration: the authority must refuse an
incompatible lower bound or retain a sufficient bound through lawful expiry.
It must not truncate or reformat a retained list to fit a new configuration.

### Aggregate-constraint enforcement

Authorities MUST produce serializable outcomes when concurrent mutations
could cross a maximum.

A policy
replacement is atomic and serialized relative to mutations. Tightening is
rejected when the live graph already violates the proposed maximum. Each Read+Update singleton or sequence member observes the
policy current at that member's execution point. A replacement changes the
discovery representation and its `ETag`, but it does not invalidate active
reads or change a Type Descriptor.

### Mutation authorization

Mutation authorization is operation-local and atomic. When each operation is
reached, its policy observes the authenticated principal, the operation
pre-state, and the proposed post-state. Authorization View changes do
not create a new idempotency namespace: the principal-bound disposition
remains durable and cannot execute again. A retained Read+Update
disposition is re-authorized for disclosure when it is replayed, under
[Duplicate keys and retained dispositions](#duplicate-keys-and-retained-dispositions).

### Validation and results

Read+Update validates each singleton or sequence member independently and
returns its inline postimage, deleted identity, alias result, or problem.
A mutation of an owned Link is a mutation of two Resources: the inline
postimage (or deleted identity) remains the Link's, and the same response
member additionally reports the source Bead's resulting `revision`. Its full
postimage is available at its own URL. The envelope member carrying that
secondary revision is `sourceRevision`, under [Mutation results](#mutation-results).

When each operation is reached, the authority validates its resulting
state before evaluating the next operation. It checks:

- identifier uniqueness;
- reference resolution and Resource kind;
- liveness, exact declared-Type match, kind, and effective-Type constraints for
  in-Scope Link endpoints;
- Link-Type external-endpoint policy, syntactic validity, and opaque
  handling of out-of-Scope endpoint URIs;
- immutable-member rules;
- Type and properties-schema constraints, and the admissibility of every
  number literal under [Revisions](../core/core.md#revisions);
- applicable Scope aggregate constraints;
- authorization;
- expected revisions;
- absence of live incident Links when deleting a Bead; and
- advertised service limits.

At commit, the authority also ensures that concurrent mutations cannot
jointly violate those invariants. An implementation may use a Scope writer,
serializable transactions, predicate or advisory locks, constraint rows, or
an equivalent retry protocol. BDP specifies the observable serializable
result rather than the mechanism.

Any failure leaves that operation's state unchanged; it does not roll back
earlier successful sequence members. Domain-specific
transitions such as `claim-ready` are not generic BDP operations.

Creation and update results include the durable Resource ID, the canonical
Resource URL, the opaque revision, and the complete resulting state. Deletion
results include the deleted Resource identity. A successful named creation
binds its durable identity for later members in the sequence.

### Schema validity and mutation admission

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

### Mutation limits

Omission of a mutation bound does not permit partial mutation, silent
truncation or a non-normative failure response.

- `patch.operations` bounds the combined operation count of `propertiesChange`
  and `metadataChange` in one Resource update; `patch.pathBytes` and
  `patch.pathDepth` bound each path in either patch;
- `sequence.operations` bounds members in one Read+Update sequence;
- `validation.diagnostics` counts entries in, and `validation.diagnosticBytes`
  counts UTF-8 bytes of, the serialized `diagnostics` list a
  `validation-failed` problem carries under
  [Read+Update problem details](#readupdate-problem-details); the group is mutation surface: it
  is not advertised by a Read discovery document, and a Read+Update authority that omits diagnostics beyond a bound MUST
  advertise it;
- `retention.idempotency` is the minimum interval for which an authority retains
  an idempotency-key disposition after its terminal outcome, under
  [Outcome retention](#outcome-retention).

### Read+Update sequence target

The Read+Update profile exposes `operations/sequence` as a
convenience carrier for the six single-Resource operations and the two alias
operations under [Alias targets](#alias-targets). A sequence is ordered and partially committing.

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

A create member may supply `name`, using
`[A-Za-z][A-Za-z0-9_-]*` syntax. A later member
may use `@name` wherever the created Resource's ID of that kind is accepted.
The binding becomes available only after the create commits — or, on a
retry, when the creating member's retained or expired disposition supplies
the identity it allocated. A reference that is forward, unknown, or of the
wrong Resource kind is decidable from the request text and is rejected
before execution. A reference to a creating member whose
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
execution with a direct problem response. Sequence responses are inline results. Retrying a member with the same idempotency key and
semantic operation returns its retained disposition. Using that key for
different semantics is an idempotency conflict.

The sequence carrier itself does not use an `Idempotency-Key` HTTP field;
its member keys are authoritative, and a sequence request that carries the
field is rejected before execution with `malformed-request`. The envelopes,
key rules, duplicate handling, and retention rules in the subsections below
complete the carrier. The resolved decisions and their alternatives are recorded in
`docs/design/w1-read-update-decisions.md`. Implementations use the wire
contracts here; the decision history supplies no alternate wire behavior.

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
      "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } }
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
      "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } }
    },
    {
      "idempotencyKey": "w1-task-42-close",
      "operation": "updateBead",
      "bead": "beads/task-42",
      "expectedRevision": "opaque-task-revision",
      "propertiesChange": [
        {
          "op": "replace",
          "path": "/status",
          "value": "closed"
        }
      ],
      "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } }
    }
  ]
}
```

The envelope is closed. Before key lookup or execution, its JSON text must
also satisfy the protocol's Unicode-scalar string/member-name and decoded
member-name uniqueness rules; violations are carrier syntax
`malformed-request`. `operations` is bounded by `sequence.operations`
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
before execution with `malformed-request`.
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
and its members as `sequenceCreateBead`, `sequenceUpdateBead`,
`sequenceDeleteBead`, `sequenceCreateLink`, `sequenceUpdateLink`,
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
instead:

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
`GET` of its URL would now return it: `id`, `type`, `revision`, the version's
`revisionProvenance` when one was recorded, `properties`, and, for a Bead
whose Type owns outgoing Link Types, `ownedLinks`. A semantic no-op update,
defined under [Mutation revisions and
guards](#mutation-revisions-and-guards), succeeds with outcome `updated` and
the retained revision. `deleted` carries `deleted`, the identity record of
the removed Resource, and no Resource record: `resourceKind`, `bead` or
`link`, and `resource`, holding the absolute canonical `id`, the immutable
`type`, and `revision`, the Resource's final live revision. Deletion mints no
version: the identity's `revision` is the revision the Resource had when it
was deleted, never a newly minted one, The bundle defines the identity record
as `deletedIdentity`, over `resourceKind` and `resourceIdentity`. When the
mutated Link's type is owned by its source Bead's declared Type, the result
additionally carries `source`, the source Bead's absolute canonical URL, and
`sourceRevision`, the source Bead's resulting revision, on creation, update,
and deletion alike; a deletion returns the Link's identity and no Link
record, so `source` is the only member that names the source Bead whose
revision `sourceRevision` reports. On a semantic no-op update
`sourceRevision` is the source's unchanged current revision. The source's
full postimage is available at its own URL. `source` and `sourceRevision` are
absent from every other result, and each is present exactly when the other
is. That is the only secondary revision any result reports: putting or
deleting an alias mints no version and moves no revision — the target Bead's
revision is unchanged by alias mutation, and the alias result defined under
[Alias targets](#alias-targets) carries none. A result is closed. The bundle
defines `mutationResult`; a singleton target returns it as the body of a `200
OK` response, under [Operation Directory and singleton
targets](#operation-directory-and-singleton-targets).

#### Alias targets

The Read+Update profile defines two alias targets, `put-alias` and
`delete-alias`, keyed by alias path beneath the fixed `alias/` root defined
under [Aliases](../core/core.md#aliases); the Transactional profile inherits both.
Each is a singleton target under
[Operation Directory and singleton targets](#operation-directory-and-singleton-targets)
and a sequence member with its own `idempotencyKey`; the operation
discriminators are `putAlias` and `deleteAlias`.

A **put** creates an alias or repoints an existing one to exactly one
canonical in-Scope Bead URL; repointing is the same operation, not a second
one. Its record carries `alias`, the alias named by its local spelling
`alias/{alias-path}` or by its absolute alias URL, and `target`, one
canonical in-Scope Bead reference — a durable local ID, an absolute canonical
Bead URL, or, in a sequence, a `@name` bound by an earlier creation of a Bead
in the same sequence. A **delete** removes the alias; its record carries
`alias` alone, and the path is reusable afterwards, as [Aliases](../core/core.md#aliases)
says. Neither record carries `expectedRevision`, since an alias has no
revision, nor `revisionProvenance`, since attribution is per version and
alias mutation mints none; neither binds a `name`, since neither creates a
Resource.

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
reference does under [Read+Update problem details](#readupdate-problem-details). Canonical Bead
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
[Alias resolution](../core/core.md#alias-resolution) never follows one. A put or delete
the principal may not perform fails with `forbidden`. Alias operations
are authorized as mutations of the Beads they touch: a put requires that
the principal may write the proposed target Bead, and a repoint or a
delete additionally that it may write the alias's current target; when
the current target is not visible to the principal, the alias itself is
`resource-not-found`, disclosing nothing.
These alias mutation authorization rules are distinct from retry identity
comparison within a principal's key namespace under
[Idempotency keys](#idempotency-keys); comparison grants no permission to
perform an alias mutation or disclose a retained Resource.

Alias mutation mints no version: an alias is a locator, not part of any
Bead's durable state, so the target Bead's revision is unchanged by a put
or a delete, and a repoint changes the revision of neither the former nor
the new target. Aliases are not members of the Bead record or of its
`properties`, carry no revision, and are not Resources.

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
[Scope discovery and human documentation](../core/core.md#scope-discovery-and-human-documentation),
and the bundle's `readUpdateDiscovery` requires it.

An alias spelling — `alias/{alias-path}` or the absolute alias URL — is
admitted wherever a canonical in-Scope Bead reference is: as the `bead`
subject of an update or a deletion and as a Link endpoint `source` or
`target`, bare or as the `uri` of a Pinned Reference, in a singleton and
in a sequence member alike. The authority resolves it to the alias's
current target when the member is reached — exactly as a `@name` binding
is resolved when its member is reached, so an alias put earlier in the
same sequence is what a later member observes — and stores and serves the
canonical Bead URL, as [Aliases](../core/core.md#aliases) requires: a reference resolved
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
        "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
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
        "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
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
Problem Details shape under [Read+Update problem details](#readupdate-problem-details) — `type`,
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
[Problem details](../core/core.md#problem-details) even mid-sequence. Members that reached
a durable disposition before it stay retained, the faulting member's claim
is cleared, and the client resubmits, exactly as after an authority crash
under [Durability and recovery](#durability-and-recovery).

#### Idempotency keys

An idempotency key is a case-sensitive ASCII token matching
`[A-Za-z0-9_-]{1,256}` — written identically as a sequence member's `idempotencyKey` and as the
value of a singleton request's `Idempotency-Key` field, without quoting,
padding, or whitespace. A key outside the profile is rejected before
execution with `malformed-request`, as is a singleton request that omits
the field or carries it more than once: the authority rejects a repeated
`Idempotency-Key` field rather than choosing an occurrence. The client
mints keys; the authority never allocates, normalizes, or case-folds them,
and compares them byte-exactly.

A key identifies one semantic mutation within one **idempotency namespace**:
the pair of the canonical Scope URL and the authenticated principal, an
anonymous principal counting as one principal. The authenticated principal is
the identity authentication established for the request, as the authority
identifies it across restart, failover, and credential rotation; it is not
the carried `revisionProvenance.actor.id`, which is data under [Carried
attribution](../core/core.md#carried-attribution) and takes no part in the namespace. Keys
presented by other principals, in other Scopes, or to other authorities are
unrelated. Anonymous principals share one namespace, so an authority that
admits anonymous mutation exposes every anonymous key to every anonymous
client: such an authority SHOULD require authentication for mutation, and an
anonymous client SHOULD mint unguessable keys. Authorization View changes do
not create a new namespace: the principal-bound disposition remains retained
and cannot execute again, though its disclosure is re-authorized on every
replay under [Duplicate keys and retained
dispositions](#duplicate-keys-and-retained-dispositions). The namespace is
shared by every mutation carrier in the profile: a sequence member and a
singleton request that present the same key in the same namespace present the
same key.

The **semantic identity** of a member is its operation kind — from
`operation`, or from the singleton target — plus its normalized operation
record. Before comparison the authority resolves and canonicalizes durable
references, resolves each `@name` reference to the identity its creating
member bound — taken from that member's fresh, retained, or expired
disposition, never from the spelling — expands creation defaults so omitted
`properties` and omitted common `metadata` each compare as `{}`, preserves
the order of each change array and every other array, ignores JSON object
member order, and excludes `idempotencyKey` and `name`, and compares the
normalized records under the JSON value-equality rules of RFC 6902 Section
4.6. A reference that resolves to no identity because its creating member
failed and allocated none is normalized to one distinguished unbound marker
rather than to its spelling, so renaming a label never changes an identity. A
transient creator yields no identity to compare: the dependent member is
answered transiently before any comparison, under [Duplicate keys and
retained dispositions](#duplicate-keys-and-retained-dispositions). Opaque
external URIs and Pinned References are compared byte-exactly as written, a
pinned `uri` spelled by `@name` or by alias having first resolved as the bare
spelling does; `expectedRevision` and `revisionProvenance` are members of the
record and therefore of its identity. The authority MUST retain the original
alias locators and their canonical targets or recorded misses with the
member’s disposition and in any successful tombstone. An alias locator
recorded with the original member retains its recorded canonical Bead target
or recorded miss on retry, including equivalent canonical spellings of that
locator and its use in another reference slot. A repoint or deletion
therefore changes no identity for that locator. A previously unrecorded alias
locator is resolved in the current retry member turn through a store lookup,
without filtering the alias by the principal’s Authorization View. Its
canonical Bead target participates only in comparison with the original
identity; retained-Resource disclosure still requires current authorization
under [Duplicate keys and retained
dispositions](#duplicate-keys-and-retained-dispositions). A direct canonical
reference compares without alias resolution. A missing alias has unresolved
identity specific to its canonical locator: two distinct missing locators are
not equal merely because both miss, and this identity differs from the
failed-creator unbound marker. An originally recorded miss remains a miss
even if that alias is later assigned. Retry-time witnesses are transient
comparison input: they change neither the original retained metadata and
disposition nor a successful tombstone's identity, creator binding or
retention. Each retry resolves an originally unrecorded locator anew. The
authority may store the normalized record or an internal fingerprint; BDP
does not require a public request-hash algorithm.

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

Resolving a new alias locator for key comparison is an operation within the
existing principal-bound idempotency namespace. It is not an alias GET or a
permission to put or delete an alias under [Alias targets](#alias-targets).
The comparison can distinguish equality from conflict against that namespace's
original target; equality still does not authorize disclosure of a retained
Resource. Other authenticated principals' keys remain unrelated, and the
shared anonymous namespace caveat under [Idempotency keys](#idempotency-keys)
continues to apply.

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
compact tombstone — the key, the semantic identity's fingerprint, the original
alias locators and their recorded targets or misses, and, for
a creation that allocated an identity, that identity and its Resource kind,
through which a later `@name` reference still resolves — for the lifetime
of the logical Scope, exactly as it retains the identity non-reuse
guarantee under [Scopes and identity](../core/core.md#scopes-and-identity). Distinct successful
keys, including semantic no-ops, can therefore grow tombstone storage without
adding Resource revisions. Presenting an expired key with the same semantic identity
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
`idempotency-expired` in its base surface. When `historicalResolution` is advertised, the History surface additionally
reports positively evidenced `revision-reorganized` under its subject-history
gate and preserves retained old addresses. This is not an exposed epoch and
does not weaken logical-Scope identity/tombstone preservation.

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
[Scopes and identity](../core/core.md#scopes-and-identity), at a different canonical Scope
URL: a client MUST NOT treat a restored Scope as a transparent continuation
of the old key namespace.

An authority crash is not a client disconnection. When the authority fails
mid-sequence, members that reached a durable disposition stay retained, the
member in flight is recovered as an abandoned claim, and unstarted members
are never executed by recovery: the authority does not resume a sequence.
The client resubmits the sequence; retained dispositions answer the
committed members, and the remaining members execute in order.

### Read+Update problem details

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
| `revision-allocation-unsafe` | `conflict` | 409 | `after-state-change` |

`revision-allocation-unsafe` is write-only,
as defined under [Revision allocation failures](#revision-allocation-failures), including direct pre-admission and
permanent admitted failures; it supplies no History read diagnosis.

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
  contract, the resulting `properties` or `metadata` is not a JSON object,
  a `replace` or `remove` names a missing target, an in-Scope endpoint fails an effective endpoint constraint or
  describes the wrong Resource category, or an out-of-Scope endpoint violates
  the Link Type's external-endpoint policy, or the source's resulting owned
  set would exceed the owning Type's declared `max`, or an alias put's
  `target` is not a canonical Bead reference — an alias, a Link, or an
  external URI — under [Alias targets](#alias-targets). The problem MUST
  carry `diagnostics`: a nonempty, bounded array of `{ type?, schemaLocation?,
  instanceLocation?, document?, message }` entries. When the failure is an effective
  Type contract, every entry names the failing effective Type in `type` and
  the failed keyword in `schemaLocation` — the absolute keyword location,
  the contract schema's `$id` plus a JSON Pointer fragment, as JSON Schema
  output defines it; an owned-set overflow names the owning Bead Type and
  its descriptor's `ownsOutgoing` entry — and, when the failure lies within
  `properties`, `instanceLocation`, a JSON Pointer within `properties`. For
  every other cause `type` and `schemaLocation` are absent, `message` names
  the cause, and `instanceLocation`, when present, is a JSON Pointer relative
  to the failing document. The optional `document` is `properties` or
  `metadata`; omission means `properties`. A metadata failure MUST carry
  `document: "metadata"`, and its message names metadata. An empty pointer
  denotes that document's root. A numeric failure in an unapplied `properties`
  or `metadata` patch may omit `instanceLocation` rather than identify a
  postimage position that is not yet known. A request-body pointer does not
  identify a position in that document. `type` and `schemaLocation` are
  present together or not at all. `validation.diagnostics` and `validation.diagnosticBytes` bound the
  list: an authority that omits entries beyond a bound MUST advertise that
  bound, keeps at least one entry in evaluation order, and sets
  `diagnosticsTruncated` to `true`; an authority that advertises neither
  returns the complete list. No other code carries `diagnostics` or
  `diagnosticsTruncated`.
- `type-not-installed`: the declared Type's contract closure is not
  installed, under
  [Descriptor resolution and installation](../core/core.md#descriptor-resolution-and-installation).
- `identity-taken`: a supplied `id` whose canonical Resource URL was ever
  committed in the logical Scope, including a deleted one. Canonical Bead
  segments and alias paths share one uniqueness namespace under
  [Alias targets](#alias-targets): an alias put whose path is the
  `{id-path}` of a canonical Bead URL ever committed in the logical Scope,
  a deleted one included, fails the same way, while a Bead creation whose
  supplied `id` has the `{id-path}` of a live alias is `alias-path-taken`. This is
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
- `revision-allocation-unsafe`: a positively established persistent,
  repair-required allocation conflict, with the direct pre-admission and retained
  admitted-failure handling under [Revision allocation failures](#revision-allocation-failures); transient inspection
  failure remains `temporarily-unavailable`.
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
spelling names no live alias. An alias
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
carrier syntax and are rejected before execution with `malformed-request`.
The Read+Update profile adds `415` and `422` to the permitted `status`
values. The bundle defines `readUpdateProblemCode`, `readUpdateProblem`
(with the member-level `retryAfter` under
[Sequence response envelope](#sequence-response-envelope)),
`validationDiagnostic`, and `validationDiagnostics`.

### Sequence problem envelopes

A syntactically admitted sequence still returns
`200 OK`. Each failed member contains the same Problem Details shape with its
would-be `status`, its zero-based `operationIndex`, and, when the member
declared one, its `operationName`. Sequence-member `status` is required
because the enclosing HTTP status is `200 OK`. The member status locates the
failed operation's ordinary direct response. This locates the failure without
creating a separate sequence-only taxonomy.

### Read+Update consistency

Read+Update has no durable Mutation Receipts and no BDP Events.

Read+Update returns an authoritative mutation postimage, but it does not
promise that a later request routed to another replica observes it. It adds
no exposed Scope epoch, Authorization View token or Scope position.

### Mutation command preconditions

BDP mutation POSTs address operation command targets, not selected Resource
representations: no selected representation of the operation target is read
or modified by executing the command. Under the method and
selected-representation boundary in
[RFC 9110 section 13.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.1),
HTTP conditional fields on these commands do not guard payload-named
Resources or aliases. `expectedRevision` remains
the explicit Resource revision guard. This assigns no blanket exemption for
unsafe HTTP methods and does not change conditions on canonical Resource
GET or HEAD requests. A read-side `412 Precondition Failed` is not the
write-side `409 revision-mismatch`.

On mutation POSTs to operation command targets, authorities MUST ignore the
`BDP-Minimum-Scope-Position`, `BDP-Scope-Epoch`, and
`BDP-Authorization-View` request fields. Their presence, absence, completeness,
and field values do not impose a minimum-position barrier or affect command
identity. Ordinary HTTP field syntax and transport, header, and body bounds
still apply, as do authorization, idempotency, carrier validation, and
`expectedRevision`. This rule applies to mutation POSTs under this profile and
cumulative profiles. It does not change conditions on reads.

### Read+Update HTTP field support

When cross-origin access is enabled, the CORS policy MUST allow the
`Idempotency-Key` request field. Mutation responses expose applicable Read
response fields, including `Retry-After`, under the inherited CORS rules.

### Mutation response media negotiation

The inherited bodyless `406 Not Acceptable` response applies before durable
admission, key binding or state change for a new mutation submission.
Unsupported mutation request content is `415` `unsupported-media-type`,
distinct from response negotiation. Existing authentication, authorization
and ordinary admission-control refusals retain their order and non-disclosure
rules.

### History context on mutation results

Native versions minted under advertised History MUST carry `committedAt`,
`agent`, and `message` in `revisionProvenance` on complete mutation
postimages. The read representation and provenance rules are defined under
[Immutable change context](../core/core.md#immutable-change-context).

For native versions, commit time is the authority-observed mutation commit instant,
not admission, import or editable Inception time. Independently committed sequence members carry
their respective commit instants. Imported original time is present only with
available provenance; otherwise it is undetermined. This promises neither an
accurate/authenticated clock nor global chronology. Extra import provenance stays internal, not a second protocol envelope.

Each version-minting operation may carry optional `revisionProvenance` input,
the closed `revisionProvenanceInput` object with optional `actor` (the same
`{ id, basis }` shape), `agent` (nonempty string or null), and `message`
(string or null). Omitted members mean undetermined; null explicitly records
known absence. Callers supply no timestamp. Actor omission records no actor
on a newly minted version; it does not copy the prior actor. The member
appears on create/update Bead and Link, owned-capable deleteLink, including
their sequence forms; alias operations and deleteBead, which mint no version,
gain no input. It is operation- local, never a shared carrier-wide override.
Preserve it in semantic mutation identity so different recorded inputs cannot
replay as the same request. Apply the existing protocol-default
normalization: an omitted input and an empty object both mean no actor and
undetermined agent and message; explicit null remains distinct. Context
remains excluded from Resource no-op comparison.

Copy the originating operation's agent/message states to every version it actually
mints, including owned Link and source. Sequence operations may have distinct inputs
and independently committed times.
Changing only context never creates a version. No-ops retain the old revision and
context; deletion without a minted version creates no context-only record. An owned
Link deletion records new context on its newly versioned source only. Existing
attribution fan-out and all authorization, erasure and retained-copy duties apply.

### Read+Update conformance

Read+Update acceptance includes all Read obligations and the mutation,
sequence, alias, revision, idempotency, recovery, validation and HTTP
obligations defined in this part. The shared conformance index records their
case identifiers. Its later-profile rows add no requirement to Read+Update.

<a id="part-iii--transactional"></a>

## Part IV — Transactional

Part IV inherits the Data Model, Read and Read+Update and adds atomic
multi-operation mutation and replication. It defines exposed history fences,
durable receipts and complete committed change groups. The operation
directory and singleton, sequence and error envelopes have the explicit
Transactional forms defined here; clients use the advertised profile to
select those forms.

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

Each Scope history has an opaque,
unguessable **Scope epoch**. The epoch remains stable across ordinary restart
and failover that preserve identical committed history. It changes whenever
restore, destructive reinitialization, or authority replacement may discard,
rewrite, or replace history. The epoch is not part of canonical Scope or
Resource identity. Retained Resource-version addresses follow [Revisions](../core/core.md#revisions).
Every other history-dependent token remains fenced by that epoch, including
Scope positions, transaction identifiers, snapshots and handles, read and Event
cursors, changefeed checkpoints, minimum-read barriers, receipts, and the
idempotency-key namespace and its bound dispositions. Individual token contracts
still apply. Cached representations retain their epoch and Authorization View
bindings under Authorization views. An epoch change in the same logical Scope
preserves canonical Scope and Resource URLs. Prior-epoch uses retain their own
handling: a prior-epoch idempotency key is unbound in the new namespace, so a
submission under the new epoch executes anew rather than replaying its prior
disposition. Read/Read+Update do not gain exposed epoch fields.

Within one epoch, every effectful committed Mutation Transaction occupies
one opaque **Scope position** in one total order that the authority defines,
except the locator-only alias mutations defined under
[Transactional alias mutations](#transactional-alias-mutations), which
occupy no position.
A position is unique within its epoch, and clients compare it only for
equality. Clients must not perform arithmetic or lexical ordering on its
spelling. Each epoch has a distinguished genesis position. Every later
change group identifies both its own position and its immediately preceding
position.

A read or snapshot observes one prefix of this order. A Resource revision
names one state of one Bead or Link, while a Scope position names one
committed transaction. The two kinds of token are independent, even when an
implementation derives them from related internal counters.

### Authorization fences

Each view has an opaque, equality-only **Authorization View token**. The
token remains stable across restarts and failover that preserve the same
projection. It changes whenever a grant, revocation, policy replacement, or
other authority change may alter that projection. Snapshot handles, read and
Event cursors, changefeed checkpoints, minimum-read barriers, and cached
representations are bound to both the Scope epoch and the Authorization View
token. A token change requires a fresh snapshot. BDP v0 does not require
incremental authorization-policy Events. The token is not a credential, and
possessing or replaying it does not grant access to that view.

### History fences and actor identity

BDP v0 does not expose an authority-attested actor in receipts, Events or
change groups.

Scope epoch, Authorization View, and position
fields are projection and ordering fences. None of them identifies or
attests the principal.

### Transactional discovery

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

`scopeEpoch`, `authorizationView`, `headPosition`, and
`minimumReplayPosition` describe, in order: the current incarnation of the
authority history, the read projection the server selected, the projected
head, and the oldest position still legal as an exclusive Scope-changefeed
cursor. The client cannot supply or widen `authorizationView`. Another
principal, or a changed policy, may receive a different value at the same
canonical Scope URL. Individual snapshots and receipts carry their exact
expiry. Discovery may pre-advertise applicable retention through the optional
`limits` object.

### Discovery profile membership

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
resolution: an authority without aliases
omits the member, and a client MUST NOT construct alias URLs for an
authority that does not advertise it. The optional
`order` member names the collection order under
[Collection retrieval and selection](../core/core.md#collection-retrieval-and-selection);
omission means the `canonical-uri` baseline. The optional `historicalResolution`
member advertises [Historical resolution](../core/core.md#historical-resolution) in every profile;
it is distinct from the Transactional Scope-history fence members.

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
| `historicalResolution` | optional | optional | optional |

### Profile schema inventory

The discovery and Read definitions, Read+Update definitions and Transactional
definitions share the one normative bundle. They include every
profile's discovery and operation directory, request/result/problem shapes,
and the Transactional Events, batch/set operations, receipts, change groups,
changefeed pages and snapshot manifests. Schema availability alone is not implementation or conformance evidence.

### Transactional limits

- `transaction.operations`, `transaction.examinedResources`,
  `transaction.matchedResources`, `transaction.mutatedResources`, and
  `transaction.inducedEvents` are counts, while `transaction.duration` is an
  ISO 8601 duration; and
- `retention.idempotency`, `retention.receipt`,
  `retention.maximumSnapshotLifetime`, and `retention.replay` are ISO 8601
  durations.

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
rejects `retention.idempotency` under the paragraph below.

On a Transactional Scope a key's disposition is retained by its receipt — a
completed transaction's for the rest of the epoch and a failed
transaction's for at least `retention.receipt` — so `retention.idempotency`
is a Read+Update-only member: a Transactional discovery document MUST NOT
advertise it, `retention.receipt` bounds how long detailed outcomes and
failed receipts remain, and the bundle's `transactionalAdvertisedLimits`
rejects the member. `page.defaultItems` and `page.maximumItems` also count
the result entries of a Mutation Receipt and its pages, every entry
counting as one.

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
pending receipt. Either way, it never executes again. For direct carriers,
handing a duplicate a receipt presupposes established semantic equality. A
request that encounters an unresolved reservation follows the bounded
comparison rules below. Reusing the key for a different semantic request is
an idempotency conflict. Once a mutation is admitted, client disconnection
does not decide the outcome. The authority commits or rolls back, and it
records one terminal receipt. Retrying returns
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
declaration order, of its operations' semantic identities under [Idempotency
keys](#idempotency-keys): each is the operation kind plus its normalized
record — durable references canonicalized, protocol defaults expanded, array
order preserved, member order ignored, `name` and the carrier excluded,
`expectedRevision` and `revisionProvenance` included, opaque URIs and pins
compared byte-exactly, and the records compared under RFC 6902 Section 4.6.
In a batch, a `@label` reference is normalized to the creating operation's
zero-based index when that operation supplies no `id`, and to the supplied
identity's canonical URL when it does — never to the label's spelling, so
renaming a label is not a semantic change, and never to an allocated
identity, which does not exist before commit. In a sequence, a `@name`
reference is normalized to the identity its creating member bound, as in
Read+Update. A one-operation batch, the equivalent singleton request, and the
equivalent sequence member therefore present one semantic request, and any of
them retrieves the receipt the others created.

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
normalized request identity or the durable unresolved dependency form below,
the `pending` Mutation Receipt with its `transaction` identity, and its own
exclusive ownership of the execution together or not at all, so that a crash
leaves a key either unknown with
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

When a sequence member depends on an authority-allocated creation whose
identity is not yet committed, admission MUST durably reserve that member's
key and pending receipt together with all other unknown member keys in the
same atomic admission step. Its unresolved dependency form pins each reference
to the particular creator attempt and operation slot, not merely to a reusable
key or the spelling of a label. It preserves all other normalized semantic
fields. This is internal admission state, not a new receipt representation,
prospective durable Resource identity, or additional component of final
semantic equality. Atomic admission does not combine the sequence's separately
committing member executions into one transaction.

When its creator commits, the authority atomically records the binding fact
with the creator's effects and terminal disposition; a dependent resolves only
against that pinned fact. A permanently failed creator resolves its reference
to the existing unbound marker and the dependent retains its own
`binding-unavailable` failure. The authority MUST preserve enough pinned
resolution state to resolve or retract every dependent even if the creator's
failed receipt is later forgotten and its key reused. A terminal dependent's
normalized identity is immutable: a later creator attempt cannot rebind it.
On a later presentation of the dependent, a successful new creator supplies
an identity that conflicts with the retained unbound marker; another permanent
creator failure normalizes to the same unbound marker when the remaining fields
match. A pending or transient creator instead uses
the nonwaiting sequence projection below. Binding, retraction, and commit
check the same exclusive attempt ownership; a stale execution cannot resolve
or commit a replacement attempt's work.

A direct singleton or batch that encounters an unresolved reservation MUST
reject an already provable semantic mismatch with `409`
`idempotency-conflict`. Otherwise it MUST wait for comparison to become
possible, within one finite authority-selected comparison budget. The wait
MUST NOT hold a database transaction open. This budget is separate from
`transaction.duration`, which bounds admitted execution; it adds no
discovery member. Once the reservation resolves, ordinary canonical
comparison returns the existing receipt or the conflict. Until equality is
established, this caller MUST NOT receive the owner's pending receipt,
execute a second mutation, or retract the owner's reservation. If comparison
remains unresolved at the deadline, return direct `503`
`temporarily-unavailable` with `retry: after-delay`; the response SHOULD
carry `Retry-After` when a useful delay is known. This timeout creates no
receipt and leaves the owner's state intact. Current authorization and
non-disclosure apply at response delivery; this is not a direct
`idempotency-in-progress` or a minimum-position `catch-up-timeout`.

If that unresolved reservation is retracted while the explicit direct
request is waiting, the request MAY compete for fresh admission in the same
Scope epoch, under current authorization and within the same overall finite
deadline. It executes only after winning a new reservation for its own
request; it inherits neither the previous attempt's ownership, receipt
identity, nor unresolved dependency form. Another winner returns it to
ordinary comparison. Retraction or a change of owner MUST NOT reset the
deadline. Deadline exhaustion returns the same direct `503`
`temporarily-unavailable`, `retry: after-delay`, with the same `Retry-After`
guidance. If the Scope epoch changes, the authority MUST stop this waiting
comparison or admission attempt with that same `503`; the client must
refresh Scope discovery and present a fresh request before competing in the
new epoch. This permission applies only to a still-present explicit request
that has not joined a proven-equal execution. It neither resumes an
abandoned sequence tail nor changes the direct transient-abort response to
an already admitted execution and its joined duplicates.

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
A completed Resource creation's expired projection MUST carry exactly one of
these forms; every other operation's expired projection MUST omit `allocated`. Here a Resource creation is an operation that
allocated a Resource identity. An alias put is not one even when its alias
result says `created`; its expired sequence projection omits `allocated`.
`resource-erased` member problems reject
`pointer` just as direct problems do.
A member newly admitted by this carrier executes under its own pending
receipt and exclusive ownership; the in-flight projection below applies only
to an execution this carrier did not admit. The unresolved admission and
direct-carrier comparison rules above preserve this ownership distinction. The projections
are:

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
  member problem carrying, for a `completed` Resource creation, the extension
  member `allocated` — the disclosed `id` and `type`, or exactly
  `{ withheld: true }`, projected from the receipt under
  [Mutation Receipt responses](#mutation-receipt-responses); and
- a member whose `@name` creator's receipt is `failed` fails with
  `binding-unavailable` in its own `failed` receipt, retained as every
  failed receipt is; a member whose creator's receipt is `pending`, or
  whose creator was answered transiently in this request, fails
  transiently with `idempotency-in-progress`, consults no key state,
  executes nothing, retains nothing, and holds no key — a pending receipt
  newly owned by this attempt and recorded for it at admission is retracted
  and its key unbound, as after a transient abort — exactly as Read+Update
  releases the member's claim;
  a member whose creator's receipt has expired resolves the binding
  through the receipt's `allocated` identity.

These sequence projections take precedence over static semantic comparison:
a member owned by another pending execution remains `idempotency-in-progress`,
and a dependent of a pending or transient creator consults no dependent key,
even if an immutable field could establish a mismatch. Renaming labels does
not change this projection. When the creator provides a stable binding and the
member becomes eligible for retained comparison, ordinary equality or conflict
applies. A transient dependent releases only a reservation newly owned by this
attempt; it MUST NOT retract another owner's receipt or retained outcome.
Sequences do not acquire the direct carrier's comparison wait or retry after
retraction.

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
identity or permits the creation to execute again. These disclosure rules
preserve the unresolved-admission and duplicate-response contract above without
changing its semantic identity.

The Read+Update dispositions therefore keep their meanings inside the
sequence envelope and lose their direct forms: on a Transactional Scope a
pending key is joined rather than refused, an expired key returns its
expired receipt rather than `410`, and a failed disposition is a receipt
with a URL of its own, retained for at least `retention.receipt`, rather
than an inline disposition. The conformance rows those direct forms bind
are retired for a Transactional Scope under
[Transactional conformance rows](../../conformance.md#transactional-conformance-rows).

### Transaction-local Resource references

An atomic batch uses the same `@name` spelling and kind checks as
[Sequence-local Resource references](#sequence-local-resource-references), but
the binding denotes staged identity before commit and is unique within the
Mutation Transaction. Only the atomic batch supplies isolation and rollback.

### Atomic operation extensions

The six explicit Resource operations use the same inputs and effects as
Read+Update. A Bead or Link target, or a Link endpoint, may additionally name
an earlier staged creation in the same Mutation Transaction. For an atomic
cascade a client explicitly deletes incident Links earlier in the same batch.

### Transactional revision visibility

No-op detection is operation-local. An update followed by a later reverse
update in the same ordered transaction is two state transitions. Each
transition receives its own revision and Event, and both become visible
atomically in one change group after commit.

In an atomic batch, a revision mismatch fails the complete Mutation
Transaction. Resources created earlier in that transaction need no revision
guard, because no external mutation can intervene before commit.

### Transactional validation and results

Each operation validates its resulting staged state before the next operation,
using [Validation and results](#validation-and-results) and additionally checking
set cardinality where applicable. At commit, concurrent transactions cannot
jointly violate the invariants. Any failure rolls back the complete Mutation
Transaction. Deletion results carry transaction metadata, and the transaction
result maps every local label to its allocated durable identity.

### Transactional aggregate-policy observation

A Transactional mutation observes either the complete old policy set or the
complete new one; policy replacement is serialized relative to mutations.

### Set authorization and retained receipts

A set Selector ranges only over Resources visible in the request's
Authorization View. If any selected Resource is not writable, the complete
transaction fails; the authority never silently filters an unwritable subset.
Detailed receipt results are re-authorized when they are later read.

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
and path rules apply unchanged.

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
  revisionProvenance?
) -> UpdatedResources
```

```text
DeleteWhere(
  collection,
  selector,
  cardinality?,
  revisionProvenance?
) -> DeletedResourceIdentities
```

The inherited patch limits apply to each member update of a set update.

`UpdateWhere.change` applies only to each selected Resource's `properties`.
It leaves `metadata` unchanged. To change metadata, use the Resource update
operations, including `UpdateBead` or `UpdateLink` operations in a batch.

Embedded Selectors MUST conform to the complete bounded Selector grammar before
key lookup. Invalid body Selector grammar is `400` `malformed-request` with a
`pointer` to the original Selector member. Read query Selectors retain their
`400` `invalid-parameter` behavior. Fixed Selector source-byte, depth and node
capacity is an admission control for an unknown key, not a retained execution
failure. Existing equal outcomes and conflicting keys take precedence over
those capacity checks. A fresh over-limit request is `413` `limit-exceeded`
before execution, without a receipt or key binding. The body diagnostic names
the member with `pointer` and the bound with `limit` (`selector.bytes`,
`selector.depth` or `selector.nodes`); this does not require those fields on
Read query capacity responses. JSON-body Selector strings are not URL-decoded.

Selection and mutation occur atomically at one serialization point. The
Selector is evaluated when its operation is reached, so it observes the
effects of preceding operations in the same Mutation Transaction. A
`revisionProvenance` supplied to a set mutation fans out exactly as the
corresponding singleton operations would record it: on every version
`UpdateWhere` mints (each selected Resource's new version, and the source
Bead's fresh version for each selected owned Link), and, for `DeleteWhere`,
on the fresh source versions of any owned Links it deletes — deletion mints
no version for the deleted Resources themselves.

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

### Operation discovery across profiles

When the Scope's profile supports mutation, `operations` identifies an
Operation Directory rather than a collection of transactions. Its named
children depend on the claimed profile. Only the Transactional profile
includes `batch`, which executes an ordered Mutation Transaction.

### Transactional operation directory and singletons

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
POST operations/update-bead
POST operations/delete-bead
POST operations/create-link
POST operations/update-link
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
  "updateBead": "update-bead",
  "deleteBead": "delete-bead",
  "createLink": "create-link",
  "updateLink": "update-link",
  "deleteLink": "delete-link",
  "putAlias": "put-alias",
  "deleteAlias": "delete-alias",
  "sequence": "sequence",
  "updateWhere": "update-where",
  "deleteWhere": "delete-where",
  "batch": "batch"
}
```

In the Transactional profile, each of the six Resource singleton targets
accepts the members
defined by its operation record, excluding the batch-only `operation`
discriminator and `name` label. The request executes as a one-operation
Mutation Transaction. It returns the same Mutation Receipt shape with a
one-element `results` array; the two set
targets `update-where` and `delete-where` return it with a `matched` entry
followed by one entry per selected Resource, under
[Mutation Receipt responses](#mutation-receipt-responses). The alias targets return a one-entry Mutation Receipt under
[Transactional alias mutations](#transactional-alias-mutations), without
Scope history or replicated alias state.
Transactional singleton requests require
`Idempotency-Key` and cannot use `@label` references.

Within the Transactional profile, the singleton and batch forms have identical
allocation, patch, validation, authorization, idempotency, concurrency, event,
and deletion semantics. The Read+Update profile preserves the existing
`create-bead`, `update-bead`, `delete-bead`, `create-link`,
`update-link`, and `delete-link` target names and their operation
request records, adds the alias targets `put-alias` and `delete-alias`
under [Alias targets](#alias-targets), and adds `sequence`. Each
Read+Update singleton requires an `Idempotency-Key` HTTP field. It returns
its final Resource postimage, deleted identity, alias result, or direct
problem inline rather than a Mutation Receipt.
Read+Update does not include the set-oriented `update-where` or `delete-where`
targets, which require selection and mutation at one serialization point. It
also does not include `batch`.

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
`operation` discriminator selects `createBead`, `updateBead`,
`deleteBead`, `createLink`, `updateLink`, `deleteLink`,
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
sequence members.

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
   unpaired surrogate, duplicate member names after escape decoding, an absent, repeated, or invalid `Idempotency-Key`, a body outside
   `batchRequest`, a forward, unknown, or duplicate label, a label used
   where the other Resource kind is required, a noncanonical local ID
   spelling, or a supplied `id` beneath the wrong fixed root is `400`
   `malformed-request`. Invalid complete grammar of an embedded Selector is
   also `400` `malformed-request` before key lookup. Its problem carries the
   original Selector member's `pointer`; other syntax problems SHOULD carry
   `pointer`, an RFC 6901
   JSON Pointer into the request body naming the offending member;
3. the principal — an unauthenticated request is `401` `unauthenticated`,
   and a principal that may not submit mutations to the Scope is `403`
   `forbidden`;
4. the key — a key bound, for this Scope, epoch, and principal, to a
   different normalized request is `409` `idempotency-conflict`, and the
   earlier request's outcome is unaffected; a key bound to the same
   normalized request is answered with its receipt, pending or terminal,
   under [Mutation Transactions](#mutation-transactions), after successful
   response-media negotiation; unacceptable `Accept` instead yields the
   shared bodyless `406` without altering the receipt. Nothing below is
   evaluated for that duplicate. An unresolved reservation uses that
   section's bounded comparison and same-epoch retraction rules; unproven
   equality never returns a receipt or admits a second execution;
5. admission controls for an unknown key — fixed embedded Selector source-byte,
   depth or node capacity is checked before execution and response-media
   negotiation. An excess is `413` `limit-exceeded`, with the original member
   `pointer` and dotted Selector `limit`, without a receipt or key binding.
   An `operations` count above
   `transaction.operations` is `413` `limit-exceeded` with `limit`
   `transaction.operations`, a rate limit is `429` `rate-limited`, and an
   authority that cannot admit is `503` `temporarily-unavailable`; and
6. response negotiation for an otherwise acceptable new submission —
   unacceptable `Accept` yields the shared bodyless `406` before durable
   admission or key binding.

Every refusal above creates no receipt and binds no key. Apart from the
HTTP-native bodyless `406`, these are direct problems. A syntactically
invalid request therefore never consults key state, and a retained or
pending duplicate negotiates its receipt representation before limits and
rate limits are evaluated, so that a retry that only wants its outcome is
never refused for the capacity its original consumed.

A request is admitted when the authority has durably recorded, in one step,
the key, the normalized request identity, the `pending` Mutation Receipt
with its `transaction` identity, and its own ownership of the execution,
under [Mutation Transactions](#mutation-transactions). From that point
client disconnection, a transport failure, and a bodyless `500` decide
nothing: the transaction commits or fails on its own, the receipt records
which, and every successful representation returned to that request or to an
identical retry is a Mutation Receipt. The shared bodyless
response-negotiation refusal can suppress that representation without
changing its outcome. The execution has one transient-abort exception. A
transient abort after admission — a serialization conflict the authority
does not retry, or a component it cannot reach — retracts the pending
receipt and unbinds the key in one durable step and is answered, to the
original request and to every joined duplicate, with a direct `503`
`temporarily-unavailable` that SHOULD carry `Retry-After`; the retracted
receipt's URL then answers the uniform `404`, and a retry under the same key
executes as a new mutation. Every other execution failure after admission is
permanent and is reported inside a `failed` receipt, never as a direct problem.

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
[Transactional alias mutations](#transactional-alias-mutations).

The Transactional mutation surface answers as follows; a row's statuses are
exhaustive for that target and method, apart from the shared bodyless `406`
negotiation refusal, GET/HEAD conditional `304` and `412`, and the bodyless
`500` an unexpected internal fault produces anywhere. The HTTP-native
exceptions follow [Conditional reads and HEAD](../core/core.md#conditional-reads-and-head)
and do not add BDP problem codes.

| Target | Method | Response |
| --- | --- | --- |
| `batch`, the six Resource singleton targets, the two set targets, and the two alias targets | `POST` | `200` terminal receipt; `202` pending receipt; direct `400`, `401`, `403`, `409`, `413`, `415`, `429`, `503` |
| `sequence` | `POST` | `200` envelope of [Sequence response envelope](#sequence-response-envelope), pending members included as problems; direct `400`, `401`, `403`, `413`, `415`, `429`, `503`, plus only the pre-admission `409` `revision-allocation-unsafe` exception below; never a sequence-level `202` receipt |
| the same targets | any other method | `405`, `Allow: POST` — plus `OPTIONS` when cross-origin access is enabled, in which case `OPTIONS` is answered by the CORS rules rather than `405` — and no BDP Problem body |
| `operations/` | `GET`, `HEAD` | `200` Operation Directory; `400` `malformed-request` for malformed minimum fields; `401`, `403`, `429`, `503` |
| `operations/` | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| a receipt URL `receipts/{token}` | `GET`, `HEAD` | `200` receipt in its current representation; `400` `malformed-request` for malformed minimum fields; `401`; `404` for an unknown token, another principal's receipt, a retracted receipt, a forgotten failed receipt, or a prior epoch's receipt; `409` `foreign-view` or `410` `cursor-expired` for incompatible minimum-position context; `429`, `503` |
| a receipt page URL | `GET`, `HEAD` | `200` page; `400` `malformed-request` for malformed minimum fields; `401`; `404` under the same non-disclosure rule; `409` `foreign-view` or `410` `cursor-expired` for incompatible minimum-position context; `410` `cursor-expired` after the receipt's detail expired; `429`, `503` |
| a receipt or page URL | any other method | `405`, `Allow: GET, HEAD` (`OPTIONS` as above) |
| the `receipts` root | any method | `400` `malformed-request` for `GET` and `HEAD` with malformed minimum fields, otherwise `404` `resource-not-found` for those methods; `405` with `Allow: GET, HEAD` otherwise |

The sequence's direct `409` exception applies only when an actual, positively
established persistent, repair-required allocation failure is known before
carrier admission, under [Revisions](../core/core.md#revisions). This exception introduces no
new broad allocation preflight, comparison wait or member-order bypass, and
MUST NOT prevent replay of available retained duplicate outcomes. An ordinary
operation/member allocation failure discovered after admission follows the
failed-receipt and sequence projection rules: the carrier returns `200` with
the member problem, not a direct `409`. Pending-key and dependent-member
nonwaiting precedence remains unchanged. Transient inability to establish
allocation safety remains `503`, not this persistent-conflict exception.

Normal HTTP receiving checks, including the closed minimum-field syntax under
[Transactional HTTP consistency](#transactional-http-consistency), precede receipt
or page lookup. An authenticated malformed minimum tuple receives the same
`400 malformed-request` whether the receipt or page exists or is disclosable.
Once those receiving checks pass, the following non-disclosure ordering applies.

On a receipt or page read, authentication is decided first, then the
principal and epoch non-disclosure rule, then the request's minimum-position
context and consistency wait, then page expiry, then the representation.
An incompatible view returns `409` `foreign-view`; an expired context
returns `410` `cursor-expired`; a failed catch-up wait returns `503`
`catch-up-timeout`, under the shared consistency rules. These checks never
let a caller who may not see the receipt learn about its pages or history.

### Batch operation record schema

Version-minting operation inputs additionally accept operation-local
`revisionProvenanceInput` as the `revisionProvenance` member under [Immutable
change context](../core/core.md#immutable-change-context). This applies equally to
singleton, sequence, set and batch compositions, never carrier-wide context.

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
    { "$ref": "#/$defs/updateBead" },
    { "$ref": "#/$defs/deleteBead" },
    { "$ref": "#/$defs/createLink" },
    { "$ref": "#/$defs/updateLink" },
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
    "revisionActor": {
      "type": "object",
      "required": ["id", "basis"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "basis": { "enum": ["writer-supplied", "unknown"] }
      },
      "additionalProperties": false
    },
    "revisionProvenanceInput": {
      "type": "object",
      "properties": {
        "actor": { "$ref": "#/$defs/revisionActor" },
        "agent": { "anyOf": [{ "type": "string", "minLength": 1 }, { "type": "null" }] },
        "message": { "type": ["string", "null"] }
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
    "metadata": {
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
        "metadata": { "$ref": "#/$defs/metadata" },
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
      },
      "additionalProperties": false
    },
    "updateBead": {
      "type": "object",
      "required": ["operation", "bead"],
      "anyOf": [{ "required": ["propertiesChange"] }, { "required": ["metadataChange"] }],
      "properties": {
        "operation": { "const": "updateBead" },
        "bead": { "$ref": "#/$defs/resourceReference" },
        "propertiesChange": { "$ref": "#/$defs/change" },
        "metadataChange": { "$ref": "#/$defs/change" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" },
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
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
        "metadata": { "$ref": "#/$defs/metadata" },
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
      },
      "additionalProperties": false
    },
    "updateLink": {
      "type": "object",
      "required": ["operation", "link"],
      "anyOf": [{ "required": ["propertiesChange"] }, { "required": ["metadataChange"] }],
      "properties": {
        "operation": { "const": "updateLink" },
        "link": { "$ref": "#/$defs/resourceReference" },
        "propertiesChange": { "$ref": "#/$defs/change" },
        "metadataChange": { "$ref": "#/$defs/change" },
        "expectedRevision": { "$ref": "#/$defs/expectedRevision" },
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
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
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
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
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
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
        "revisionProvenance": { "$ref": "#/$defs/revisionProvenanceInput" }
      },
      "additionalProperties": false
    }
  }
}
```

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
executes as new, under [Mutation Transactions](#mutation-transactions).

A receipt may inline every result or the first bounded page. Large
set-operation results continue through immutable pages of that same receipt.
BDP does not create a second result abstraction, and it never silently
truncates affected Resources.

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
        "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
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
        "revisionProvenance": { "actor": { "id": "agent:planner", "basis": "writer-supplied" } },
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
under [Revisions](../core/core.md#revisions), produces an `updated` entry carrying the
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

An already issued receipt-page URL MUST remain usable across ordinary
restart or failover in the same Scope epoch while the receipt detail remains
available, preserving its recorded entry boundaries and applying current
authorization and erasure projection. The authority retains or reconstructs
the pagination identity; restart alone is not early cursor expiry. This
preserves detail expiry, failed-receipt forgetting, retraction, and prior-epoch
non-disclosure. Temporary inability to serve available detail is a service
failure, not permission to discard the handle or execute the transaction
again.

Receipt and receipt-page representations MUST omit `ETag` and `Last-Modified`
initially and retain `Cache-Control: private, no-store`. This includes receipt
representations returned by mutations as well as reads. GET/HEAD still applies
[Conditional reads and HEAD](../core/core.md#conditional-reads-and-head); execution identity
and retained facts are not HTTP validators.

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
are non-Resource execution facts under this same rule.
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
`resource-erased` disclosure under [Reads after deletion](../core/core.md#reads-after-deletion)
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
[Read+Update problem details](#readupdate-problem-details) defines them for the Read+Update rows.
A `failed` receipt's problem describes the rejected request, not a
committed version, and lies outside erasure; an authority that nonetheless
quoted a committed version's content in `detail` or a diagnostic scrubs it
as a store would.

### Transactional problem details

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
  [Reads after deletion](../core/core.md#reads-after-deletion).
- `catch-up-timeout`: a read carrying `BDP-Minimum-Scope-Position` could
  not be served at or after that position within the authority's wait
  bound, under
  [HTTP consistency, caching, and CORS fields](../core/core.md#http-consistency-caching-and-cors-fields).

On a Transactional Scope every code occurs
in one of two contexts, and the bundle closes each context to its codes. A *direct* code is served as a
direct problem response: every Read code, `unsupported-media-type`,
`idempotency-conflict`, `event-history-expired`, `catch-up-timeout`, and
`revision-allocation-unsafe` for the positive persistent pre-admission failure
under [Revisions](../core/core.md#revisions). A *receipt* code occurs inside a `failed` Mutation Receipt, where the problem
carries the code's `status` as the failure's would-be direct status:
`validation-failed`, `type-not-installed`, `identity-taken`,
`alias-path-taken`, `revision-mismatch`, `incident-links-exist`,
`aggregate-constraint-violation`, `cardinality-violated`,
`revision-allocation-unsafe` for a permanent allocation failure discovered after
admission, and `binding-unavailable` — a sequence member on a Transactional Scope whose
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

### Mutation response negotiation

For a new mutation submission this refusal occurs before durable
admission, key binding, receipt creation, or state change. For a retained or
pending duplicate it occurs after successful key comparison and before
returning the receipt representation; it MUST NOT change, rerun, or renew
the retained transaction or receipt. Ordinary admission-control refusals for
an unknown key precede negotiation of an otherwise acceptable submission.
Unsupported mutation request content remains `415` `unsupported-media-type`,
distinct from response negotiation.

### Events and Event Sources

> **Transactional contract.**
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
- **updated** — the mutable properties or common metadata of a Bead or Link changed, or an
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
  metadata: JsonObject             // newly emitted Events: {} when empty
  revisionProvenance?: RevisionProvenance   // the created version's carried attribution
  source?: Reference
  target?: Reference
}

UpdatedData { previousRevision: Revision revision: Revision change?:
PropertyChange // changes properties metadataChange?: PropertyChange //
changes common metadata ownedLink?: OwnedLinkChange revisionProvenance?:
RevisionProvenance // the new version's carried attribution }

OwnedLinkChange {
  operation: created | updated | deleted
  link: LinkState                // created: the owned Link's complete record
      | OwnedLinkDelta           // updated: the owned Link's own delta
      | ResourceIdentity         // deleted: id, type, and final live revision
}

OwnedLinkDelta { id: URI // the owned Link's canonical URL type: TypeId
previousRevision: Revision // the Link's revisions, not the source's
revision: Revision change?: PropertyChange // changes the Link's properties
metadataChange?: PropertyChange // changes the Link's common metadata
revisionProvenance?: RevisionProvenance // the Link's new version's carried
attribution }

ResourceIdentity {
  id: URI                        // the canonical Resource URL
  type: TypeId
  revision: Revision
}

DeletedData {
  revision: Revision
}
```

A newly emitted `created` Event carries `metadata`, including `{}` when
empty. A previously retained Event may lack the member; replay preserves
that Event's bytes and does not synthesize a new Event or revision. The
schema admits this historical form so old Event records remain readable.

An owned-Link change produces an `updated` Event on the source Bead with
its fresh revision; its delta carries `ownedLink` in place of `change` and
`metadataChange`. Otherwise, at least one of `change` and `metadataChange`
is present; both may be present for one atomic Resource update. An updated
owned-Link delta follows the same rule. No single
operation changes both a Bead's `properties` and one of its owned Links, and
every owned-Link mutation mints its own source version, so a Mutation
Transaction that changes both — or that changes two owned Links of one
source — produces one `updated` Event per transition, each with its own
`previousRevision` and `revision`, in operation order.

`ownedLink.operation` names the transition, and `ownedLink.link` is the delta
of that transition, never a snapshot. For `created`, it is the owned Link's
complete record: exactly the record the Link serves at its own URL after the
transition, because creation is the delta from absence, so its `revision` is
the Link's fresh revision and its `revisionProvenance`, when present, is the
Link's own. For `updated`, it is the owned Link's delta — the Link's `id` and
`type`, its `previousRevision` and fresh `revision`, the committed `change`
and/or `metadataChange`, and the Link's new version's `revisionProvenance`
when one was recorded — the same delta the Link's own `updated` fact carries,
so that neither fact carries the Link's properties in full. For `deleted`, it
is the deleted Link's identity — `id`, `type`, and its final live `revision`
— because deletion mints no Link version and a deleted Event does not retain
properties. `previousRevision` and `revision` at the Event level are the
source Bead's. `revisionProvenance` at the Event level, when present, is the
source's new version's carried attribution. An operation that mints both a
Link version and a source version records its one attribution on both, so a
`created` or `updated` delta whose Link record or Link delta carries
`revisionProvenance` carries the same value at the Event level, and a delta
whose Link record or Link delta carries none carries none.

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

A no-op owned-Link update — one whose resulting `properties` and `metadata`
both equal, under the RFC 6902 Section 4.6 comparison, their respective values
immediately before it — retains the Link's revision and emits no Event, and
it does not version the source: there is no transition for the source's
version to cover. An omitted change leaves its corresponding value unchanged.

A consumer that holds the source's record at `previousRevision` advances it
to `revision` by applying `ownedLink` to the entry keyed by `link.type` in
the record's `ownedLinks` member: for `created`, inserting `link` in
ascending code-unit order of `id`; for `updated`, locating the entry whose
`id` equals `link.id` and whose `revision` equals `link.previousRevision`,
applying `link.change` to its `properties` when present and
`link.metadataChange` to its `metadata` when present, leaving each omitted
value unchanged, and setting its `revision` to `link.revision` and its
`revisionProvenance` to `link.revisionProvenance`, removing that member when
the delta carries none; for `deleted`, removing the entry whose `id` equals
`link.id`; then setting the record's `revision` to the Event's `revision` and
its `revisionProvenance` to the Event's `revisionProvenance`, removing the
member when the Event carries none. A consumer whose held revision is not
`previousRevision`, or whose held entry is not at `link.previousRevision`, is
not positioned to apply the delta; it re-reads the record or resumes from a
snapshot. Replicas do not need the delta at all: the containing change
group's `changes` member carries the source Bead's complete postimage,
`ownedLinks` inline, beside the Link's own postimage or tombstone.

`CreatedData` contains the complete initial properties and metadata, because
creation is the delta from absence to the initial state; previously retained
Events may omit metadata as described above. For a Link, it also contains the
Link's source and target endpoint references. `UpdatedData` contains the
committed Property Change for properties and/or metadata — or the owned-Link
change — rather than a resulting state snapshot.
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
change itself, under [Owned Links](../core/core.md#owned-links), not by these
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
[Collection retrieval and selection](../core/core.md#collection-retrieval-and-selection) —
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

### History context in receipts and Events

Native versions minted under advertised History MUST carry `committedAt`,
`agent`, and `message` in `revisionProvenance` wherever their complete
version record is returned: current and historical reads, mutation
postimages, retained receipt postimages and retained history rows.
Created/updated Event data, including an updated owned-Link delta, carries
the context of the version it names. No context is synthesized on tombstones,
deleted identities, aliases, References or properties views. These metadata
requirements do not establish full Memory compatibility.

### Transactional revision and History extensions

A semantic no-op emits no `updated` Event. A change to properties or common
metadata is one Resource transition with one new revision and one `updated`
Event. A deleted identity's revision is the same final live revision reported
by the Scope changefeed tombstone and `DeletedData.revision`.

Revision allocation failures after Transactional admission follow the complete
transaction rollback and retained-failure rules. Under advertised History,
all versions in one atomic transaction share the authority-observed commit
instant; independently committed sequence members retain their own instants.
Context does not alter Event-time meaning. The operation-local context inputs
also apply to set operations and batch members, with fan-out to every version
actually minted. No carrier-wide override is introduced.

### Transactional Resource Event view

`view=events` is valid for
a Bead or Link only in the Transactional profile and is defined under **Event
replay and live observation**. Read and Read+Update do not expose it.

### Events after Resource deletion

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

### Transactional HTTP consistency

Transactional Scope-bounded responses carry:

```http
BDP-Scope-Epoch: opaque-scope-epoch
BDP-Authorization-View: opaque-authorization-view
BDP-Scope-Position: opaque-position-42
```

On reads, a Transactional client requests a minimum visible position by sending those
same epoch and view fields plus:

```http
BDP-Minimum-Scope-Position: opaque-position-42
```

If any of these three request fields is present on a read, the request MUST
contain exactly one nonempty value for each field, using the
[Event-ID and checkpoint character profile](#event-id-and-checkpoint-character-profile). Missing,
repeated, or lexically invalid values MUST return `400 malformed-request`
after ordinary transport, target/method, and authentication/authorization checks,
but before any owner read or target-existence lookup. All three absent means
no minimum is requested. Lexical validity does not establish that a position
identity is known or supported; existing semantic consistency decisions remain.

This receiving refusal observes no projected prefix and MUST NOT report
`BDP-Scope-Epoch`, `BDP-Authorization-View`, or `BDP-Scope-Position`. It MUST NOT
become a conditional `304` or `412`, a negotiation `406`, or an SSE stream.
Earlier ordinary target/method and Origin-policy refusals remain unchanged.
HEAD retains the corresponding GET response metadata and sends no body.

The authority then does one of three things: it returns a representation at
that position or later, it waits or routes to an eligible replica, or it
returns the normative foreign-view, cursor-expired, or catch-up-timeout
problem. It never reports success with an older position.

Transactional mutation POSTs follow the shared
[mutation command preconditions](#mutation-command-preconditions): copied read
minimum fields impose no barrier or command-identity input. This does not change
minimum controls on reads, including subsequent Mutation Receipt GET or HEAD
requests.

SSE responses use `Cache-Control: no-store, no-transform`.
Intermediaries must not cache or transform the stream.

### Transactional Resource read context

Every Transactional Scope-bounded read reports the Scope epoch, Authorization
View token, and position of the transaction-consistent projected prefix it
observed. It reports them through the fields defined under
[Transactional HTTP consistency](#transactional-http-consistency). Read and Read+Update use Resource
revisions, entity tags, and snapshot-preserving pagination without exposing
Scope-history tokens.

### Transactional conditional reads

A `304` is not delivery or application of a change group or erasure record
and MUST NOT advance a client's durable checkpoint.

Scope epoch/view, minimum-position and erasure/expiry checks MUST precede any
conditional shortcut. Required current Scope context remains required on
304 and 412 responses.

The inherited HEAD rules also cover `changes/`, Scope `events/`, Resource
`view=events`, snapshot handles/streams and receipt/page URLs. For acceptable
SSE, HEAD returns the response metadata and ends without frames; it MUST NOT
remain open merely to stream events. HEAD acknowledges neither delivery nor
application and creates no mutation transaction.

### Transactional HTTP field support

The inherited [Mutation command preconditions](#mutation-command-preconditions)
also apply here: HTTP conditional fields on operation command targets do not
guard newly produced receipts.

When cross-origin access is enabled, the CORS policy MUST allow `Last-Event-ID`
and the Transactional minimum-position fields, and MUST expose the three
Transactional response fields under the inherited CORS rules.

### Scope snapshots

> **Transactional/Replication only — Transactional profile.**
>
> Implementations of the Read and Read+Update profiles may skip this entire section.

The discovered `snapshot` target creates one logical read-only snapshot
using safe `GET` semantics. HEAD on this creation target returns the
corresponding response metadata and decision without a usable snapshot
handle. That parity does not require materializing or retaining an
undisclosed snapshot body or handle; internal allocation is an
implementation detail. HEAD does not renew existing handles. Ordinary HTTP
HEAD metadata omissions apply, while all BDP-required context and cache
fields remain required. A later GET independently creates its own manifest.
This differs from GET/HEAD refetch of a manifest `id`, whose identity and
expiry remain fixed as specified below:

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

The manifest's `id` MUST support GET and HEAD while the snapshot handle
remains valid. GET retrieves the same manifest, including its identity,
anchor, checkpoint, expiry, erasure ledger, and initial stream pages; it MUST
NOT create a replacement snapshot or extend `expiresAt`. The authority retains
or reconstructs that manifest. Existing epoch/view validity and erasure fences
apply. An authorized expired or no-longer-available snapshot handle returns
`410 cursor-expired`; an unknown or undisclosable target retains uniform
`404 resource-not-found`. Actual service inability before the promised expiry
is a service failure, not an expiration diagnosis.

The following snapshot table summarizes the existing scoped response laws
and shared HTTP failures. It does not exclude ordinary applicable failures,
including authentication and rate limiting.

| Snapshot target | Method | Response |
| --- | --- | --- |
| discovered creation target | GET, HEAD | `200` snapshot manifest metadata/body as appropriate; ordinary authentication, authorization, request, consistency, and service failures |
| manifest `id` or supplied stream continuation | GET, HEAD | `200` the retained manifest or stream page; `404 resource-not-found` for an unknown/undisclosable target; `410 cursor-expired` for an authorized expired/unavailable handle, including timed or erasure expiry; ordinary epoch/view, minimum-position, and service failures |
| either target | other methods | `405`, `Allow: GET, HEAD`, with CORS `OPTIONS` handled under the shared rules |

The shared native `406`, conditional `304`/`412`, and bodyless `500` rules
apply. No conditional shortcut bypasses a snapshot fence. HEAD has the
lifecycle and body rules under [Conditional reads and HEAD](../core/core.md#conditional-reads-and-head).

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
view to appear. Every owned Link inlined in a
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
- `start=now` to deliberately observe only future groups; when
  `text/event-stream` is the accepted media type and the request also carries
  a reconnect checkpoint in `Last-Event-ID`, that checkpoint governs instead.

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
visible `revision`. Newly committed
upserts include `metadata`, including `{}` when empty. A previously retained
change group may contain a pre-metadata record; serving it preserves its
original record representation, as with previously retained Events. A tombstone has the same shape whether the Resource
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
`Last-Event-ID` overrides the original `after` value or `start=now` intent;
replay begins exclusively after that checkpoint. A checkpoint supplied
for changefeed reconnect, whether through `Last-Event-ID` or `after`, MUST
be the client's durable checkpoint under the atomic-application rule above.
An SSE implementation's remembered last-event ID records transport progress,
not durable application; the client MUST NOT let an unapplied last-event ID
override its durable checkpoint on reconnect. One conforming implementation
uses an SSE reader with client-controlled reconnects: it disables automatic
reconnection and opens each fresh request with its durable checkpoint in
`after` and no `Last-Event-ID` header. This is an implementation example,
not a separate transport requirement. A stale, unavailable,
foreign-epoch, or foreign-view checkpoint fails explicitly and requires a new
snapshot. The authority never advances it silently to
`minimumReplayPosition`. Existing caught-up streams cross an erasure
publication only under [Version erasure](#version-erasure);
reconnections retain the expiry rule even if the interrupted stream had
been eligible.

### Event replay and live observation

> **Transactional contract.**
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

- Newly emitted `created` carries `revision`, the complete initial `properties` and common
  `metadata` (`{}` when empty), and the
  created version's `revisionProvenance` when one was recorded. For a
  Link it also carries the `source` and `target` endpoint references, with a
  stored pin preserved byte-identically.
- `updated` carries `previousRevision`, `revision`, either `ownedLink` or at
  least one of `change` and `metadataChange`, and the new version's
  `revisionProvenance` when one was recorded. `change` targets `properties`;
  `metadataChange` targets common `metadata`. Both may appear for one atomic
  Resource update and use the same committed Property Change representation
  accepted by singleton DML. `ownedLink` carries one owned-Link transition
  of the source Bead: `operation` is `created`, `updated`, or `deleted`, and
  `link` is the owned Link's complete record for the first, its own delta —
  `id`, `type`, `previousRevision`, `revision`, `change` and/or
  `metadataChange`, and `revisionProvenance`
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

Event Sources do not deliver erasure records. Event-Source replay alone
therefore does not establish that retained version content has been
reconciled with erasure obligations. Retaining such content from Event data
does not exempt a store from the [Version erasure](#version-erasure) rules.

A persistent Event consumer claiming protocol-backed erasure handling MUST
integrate the existing Scope changefeed and snapshot erasure ledger as its
supported acquisition and reconciliation route. It applies projected erasure
records to its retained copies and, for this changefeed/ledger integration,
follows the existing durable-checkpoint, disconnect, replay-expiry, and
Authorization View recovery rules, including a fresh snapshot and its ledger
when required. Event delivery alone is not that claim. This requirement scopes
the supported erasure-handling claim; it neither prohibits other storage
deployments nor exempts any store, cache, or replica
from the every-store erasure duty. It adds no erasure Event, discovery member,
or subscription API. History capability and lifecycle choices remain separate.

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
reconnects automatically and sends the last event ID recorded by the user agent
in the `Last-Event-ID` request header. BDP treats that header as the exclusive replay
cursor for a live request. Because the reconnect uses the original URL, a
`Last-Event-ID` header overrides its original `after` query parameter. The
query parameter selects an initial cursor. The standard header advances it on
automatic reconnect. Clients never submit Events as mutation operations.

The receipt's `effectPosition` and the change group's Event ordinals identify
the Events a mutation produced. Mutation Receipts carry no separate Event
range. Event IDs, checkpoints, caching, and expired-cursor failures use the
cross-cutting contracts defined above.

### Version erasure

Version content includes its retained `revisionProvenance`, including every
returned row, Event or receipt copy that carries it. [History recovery,
imports and assurance](../core/core.md#history-recovery-imports-and-assurance) binds all
History profiles; the Transactional rules below remain independently
mandatory where applicable.

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
oracle that [Reads after deletion](../core/core.md#reads-after-deletion) closes. Within a
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
[Reads after deletion](../core/core.md#reads-after-deletion). An erasure does not rotate
the Scope epoch: every token anchored at or after the erasure position
remains exactly as valid as it was.

Each `erasures` entry carries `subject`, the canonical Resource URL;
`revision`, the erased version's token; and `digest`, an object with `scheme`
and `value`. BDP v0 defines exactly one scheme, `sha-256-jcs`: `value` is the
lowercase hexadecimal SHA-256 of the RFC 8785 (JCS) serialization of the
erased version's complete Resource record — the record the authority served
for that revision, `revisionProvenance` and `ownedLinks` included and the
`links` aggregate excluded — with JCS's ES6 number serialization and its
UTF-16 code-unit member ordering. Under the current Resource contract this
record includes common `metadata`, even when it is `{}`. A digest already
committed for a pre-metadata version remains bound to that version's original
pre-projection record, which lacked the member. Projecting `{}` for a later
History read does not rewrite that version or its erasure digest;
verification of that historical digest uses the retained original record,
never the later compatibility projection. A
consumer holding only a projected record cannot reproduce that historical
digest from that record alone; verification requires the original retained
bytes. Current reads do not provide proof of the pre-projection form. Under the number model of
[Revisions](../core/core.md#revisions) every admitted number is a binary64 value, so every
record has exactly one canonical serialization and one digest, and
implementations agree on it without a BDP-specific canonicalization rule.
Digest computation never gates erasure: an authority that cannot serialize a
version under JCS has committed a value outside the data contract, which is
its own conformance failure; it erases the content all the same, emits the
record with the digest it computes over its best canonical serialization, and
reports the escape out of band, and the mismatch a replica then reports is
the correct audit signal for a record that escaped the contract, never a
reason to hold the content.

The **erased content** of a version is its record less its lineage marker —
everything but `id`, `type`, and `revision`: `properties`, common `metadata`,
`revisionProvenance`, a Link's `source`, `target`, and pin, and a source
Bead's inline owned-Link records. The lineage marker, the erasure record, and
the digest survive erasure everywhere; the erased content survives nowhere.

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
content-free delta form for each changed object: `change` is exactly one
`replace` at the root pointer `""` whose `value` is the successor's complete
`properties` when properties changed, and `metadataChange` is the same root
replacement with the successor's complete common `metadata` when metadata
changed. An atomic update of both objects carries both replacements, and
`previousRevision` is the erased revision. The successor MUST differ in the durable state that determines its
revision — `properties`, common `metadata`, and, for a Bead, its complete inline owned-Link
set — or the group tombstones the Resource instead. An owned-set change
can mint a source Bead revision with unchanged Bead properties.

The root-replacement deltas above apply to a successor produced by a
property or common-metadata correction. For the owning Bead's successor induced by an owned
Link's correction or deletion, its `updated` fact instead carries only
`ownedLink`, never a direct object delta. An owned Link's property or
common-metadata correction uses the corresponding content-free root
replacement in its own `updated` fact and in the nested owned-Link delta of
the source's fact; deletion uses the
identity-only deleted transition. The source's new postimage carries the
complete resulting owned set. These are the exclusive owned-Link and direct-object delta
forms, not permission to rewrite an erased version in place or expose its
partial content.

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

In each view that receives the erasure record, an already admitted SSE stream
that has emitted every complete group through the head immediately preceding P
may cross the erasure fence at P. The authority MUST serialize that eligibility check, the advance of
`minimumReplayPosition`, and publication of the complete erasure group as
one ordered publication step. Only such caught-up streams in a view receiving
the erasure record receive the complete group at P; their server-side stream
position then advances to P.
No queued, not-yet-published pre-P group may be handed to the transport
after this step. Publication orders complete frames at the authority
boundary; it does not make network delivery instantaneous or revoke bytes
already handed to the transport. A stream in such a view still needing any
pre-P group is fenced and closed, and its client must acquire a fresh
snapshot. This exception belongs to the existing admitted stream, never to
a new finite read, stream admission, or reconnect.

Backpressure does not permit holding the fence open while an old queue
drains: a stream in a view receiving the erasure record that needs unpublished
pre-P content is closed instead. Views that never received the record retain
their checkpoints and see only the identifier-free projection advance; this
publication rule introduces no erasure-triggered closure in those views.
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
finite reads and reconnects retain the erasure fence in both race outcomes.

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

### History and Transactional erasure

Where
Transactional erasure applies, its permanent projected ledger, containing-version
erasure, same-group live successor/tombstone, pre-erasure checkpoint expiry and
snapshot recovery rules remain mandatory.

Controlled retained copies include old groups, Events and receipt postimages.
Where the Transactional erasure contract applies, its existing changefeed and
snapshot-ledger route remains required.

### Receipt and finite-feed HTTP validators

Finite Scope changefeed pages and finite Event pages, both Scope `events/`
and Resource `view=events`, MUST omit `ETag` and `Last-Modified` initially.
Their continuation and Scope-position contracts remain the observation
protocol; a transaction, group checkpoint, or subject revision is not a
whole-page HTTP validator. SSE has no per-group HTTP validator or new
group-addressing URL. Receipt/page validator omission
is specified under [Mutation Receipt responses](#mutation-receipt-responses).
Canonical Resource, Type Descriptor, and discovery ETags remain unchanged;
these decisions assign no snapshot or discovery validator details.

The following observation table summarizes the existing scoped response laws
and shared HTTP failures. It does not exclude ordinary applicable failures,
including authentication and rate limiting.

| Observation target | Method | Response |
| --- | --- | --- |
| `changes/`, Scope `events/`, Resource `view=events` | GET, HEAD | `200` finite JSON or acceptable SSE metadata/stream as defined by the endpoint; ordinary authorization, query, cursor, epoch/view, minimum-position, erasure/history-expiry, and service failures; shared bodyless `406`, conditional `304`/`412`, or internal-fault `500` when applicable |
| the same targets | other methods | `405`, `Allow: GET, HEAD`, with CORS `OPTIONS` handled under the shared rules |

[Conditional reads and HEAD](../core/core.md#conditional-reads-and-head) governs ordering and
bodylessness; [Transactional conditional reads](#transactional-conditional-reads)
governs required current Scope metadata and the absence of checkpoint
advancement on `304` or HEAD. Finite responses retain their authorization
cache policy; SSE retains `Cache-Control: no-store, no-transform`.

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

### Transactional conformance

Transactional acceptance includes both lower profiles and this part's
atomicity, ordering, receipts, Events, replication, erasure and recovery
obligations. The shared conformance index records the applicable case
identifiers without granting implementation or qualification claims.

