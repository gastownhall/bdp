# core.lumen — the Beads Protocol (BDP) Core, authored as Lumen

This single Lumen source is the Core spec. The toolchain projects it deterministically to the JSON Schema bundle and the OpenAPI catalog (both shipped as part of this specification), plus the generated Markdown reference, Go interfaces, and the canonical CLI. The Markdown under specs/generated/ is generated from this file, never hand-written.

Source of record: gastownhall/bdp @ main. Owner: the spec owner (Lumen + BDP). Version: 0.2.3 — see specs/src/CHANGELOG.md. Pre-1.0 draft; the changelog marks what moved so an implementer tracking the spec in parallel can diff against it.

## What BDP is

- provenance — who changed a resource, how, and when.
- revision history — every resource is versioned; prior revisions are addressable.
- streaming — one convention for reading a sequence: the three pull forms (windowed · bulk · live) over a single cursor.
- export & change notification — one representation serves both the bulk backup (export) and the live changefeed.
- an overlay system — types, operations, and channels described as resources, so any BDP implementation can distribute them.
- a collection — a standard library of useful types, operations, and channels (a separate spec, layered on core).

## §0. Design decisions (current — the newer ruling wins)

Recorded as decisions so the design does not read as drift. These reflect the model closed 2026-11-16; where an older dated ruling conflicts, this list wins (the archaeology lives in git history).

1. nominal types on the Lumen surface. Every named shape is a `type` with identity — the protocol is a vocabulary of named concepts, not structural shorthand. (`schema` — transparent, structural — is for app modeling, not this spec.) on the wire a Resource still carries only `type` (a path); identity is a source-language concern, erased on the wire.
2. one reference world. `ref<T>` (a typed, phantom `ResourceId`) is the only way one resource names another; the pin lives in `rev`. `AbsoluteUri` survives only for non-ref URIs (a Problem `type`, a Principal `id`).
3. `ref<T>` is by-reference; `T` itself is by-value — the representation a read returns. `get` turns a `ref<T>` into a `T`.
4. `kind` is NOT stored — it is `type.id`, the single-`is` refinement path (`type Task is Issue` ⇒ "issue/task"). Single inheritance is what makes the path a unique tree.
5. A `Resource { fields }` refinement puts the subtype's fields into `body` — the firewall is the default: `Resource { fields } ≡ Resource<XBody>`. A "bead" is just a Resource whose authority is a package; content is a Resource with a media-type `type` and a raw `body`.
6. `union` is for closed value-level sum types only; kind hierarchies are open single-`is` refinement.
7. Dispatch is implicit — a request routes to its target resource (a bead takes CRUD, an Operation takes `call`, a Channel takes `pull`/`push`). No dispatch table.
8. error model. A data primitive returns its success value directly and faults with a Problem (an HTTP status). `Result<T,E>` / `Outcome<T,E>` are `call`'s alone — the declared success/failure of a user Operation. Writes return a pinned ref; reads return a resource; `delete` returns the tombstone Rev.
9. The primitives are a subset a service may offer, with `get` and discovery the mandatory floor; discovery advertises which others, and how each behaves. Built-in data primitives are NOT Operations.
10. `committedAt` and `inception` are server-supplied on write, never request input; a Request's `provenance` is the caller's part only.

open / parked (not in this file): the scheduler (deadline, timeout, graceful cancel + compensation); the `/sys/` scheme beyond `/sys/changes`; capability discovery; full filter / query / search / count / graph (corelib capabilities, advertised, not base); Transfer; the `canceled` HTTP status; the deferred types pass (BeadSchema ⇄ PackageElementRef).

# 1. Resources

A BDP store holds versioned resources. A resource has an identity, a type, and a body; you name one with `ref<T>` and fetch it as a `T`. This section builds that vocabulary bottom-up: the id decoder ring (scope) and version tokens, identity, the reference/representation pair (and `get`), revision pinning, the universal Resource shape, the authority/type pair, then metadata and provenance.

## 1.1  Identity — the id decoder ring (scope), revision tokens, ResourceId

Read this first. Every resource is named by an id, and `scope` is the decoder ring that says how to read that id. The revision tokens and the assembled ResourceId follow from it.

<a id="BdpScope"></a>

### `BdpScope`

The URL of a BDP scope (a store).

```lumen
type BdpScope = AbsoluteUri
```

<a id="Scope"></a>

### `Scope`

The decoder ring for every id — the namespace an `id` resolves in, and so how to read the `id`. The one place the three readings are defined; everything that carries an id is read through this.

> **Normative.** A Scope is exactly one of —

```lumen
type Scope =
    null
  | BdpScope
  | "uri"
```

| Alternative | Description |
|---|---|
| `null` |  |
| `BdpScope` | The URL of a BDP scope (a store). |
| `"uri"` |  |

<a id="Rev"></a>

### `Rev`

A resource-version token — opaque by definition; compared for exact equality only, never inspected.

> **Normative.** A `Rev` is opaque: compared for equality only, never parsed or inspected.

> **Normative.** The revision changes exactly when the resource's state changes; a write that would leave the state unchanged mints no new revision (and produces no event).

```lumen
type Rev is string
```

<a id="Digest"></a>

### `Digest`

A content-addressed rev (sha256 / commit) — a Rev that is a digest.

> **Normative.** `Digest is Rev`, so a digest satisfies any `rev: Rev`; there is no Rev-vs-Digest split on the wire.

```lumen
type Digest is Rev
```

<a id="ResourceId"></a>

### `ResourceId`

The identity of a resource — a scope, an id within it, and an optional revision. The wire URL is the projection (scope URL ⊕ id).

```lumen
type ResourceId {
  scope?: Scope
  id:     string
  rev?:   Rev
}
```

| Member | Type | Description |
|---|---|---|
| `scope?` | `Scope` | How to read the `id` — see [Scope](#Scope), the decoder ring. Absent on the wire ≡ the `null` arm (local). |
| `id` | `string` | The id, relative to `scope` (or the absolute URI when `scope` is `"uri"`). |
| `rev?` | `Rev` | The specific revision; absent ⇒ the current one. |

## 1.2  References & representations — ref<T>, rep<T>, and `get`

You name a resource with a `ref<T>` and read it into a `rep<T>` — the representation (the envelope around a `body: T`, §1.4). `get` turns the first into the second. `T` is the resource's BODY type: `ref<Issue>` references the resource whose body is `Issue`.

<a id="ResourceRef"></a>

### `ResourceRef`

A reference to a resource is just its id.

```lumen
type ResourceRef = ResourceId
```

<a id="ref"></a>

### `ref`

A typed (phantom) reference — the by-reference form. `T` is the referenced resource's BODY type; it is checker-only and erases on the wire (a `ref` is a `ResourceId`).

```lumen
type ref<T> = ResourceRef
```

<a id="get"></a>

### `get`

Safe point read — resolve a `ref<T>` to the current representation `rep<T>`, or a pinned revision when the ref pins `rev` (or `?revision=`). An optional `selector` projects the result (which gets its own cacheable identity). Faults 404/410 when absent or erased.

> **Normative.** `get` is safe and has no declared failure — it returns a `rep<T>` (the by-value representation of the referenced resource) or faults with a Problem. A `selector`-projected read is a partial representation, cacheable under its own query-string identity.

> **Normative.** A resource outside the caller's authorization view is reported exactly as a missing one — identical status, on every operation and every stream. A service never reveals that a hidden resource exists, including through an error only a hidden resource could cause.

```lumen
fn get<T>(
    resource:  ref<T>,
    selector?: selector
  ) -> rep<T>
```

| Parameter | Type | Description |
|---|---|---|
| `resource` | `ref<T>` | The reference to resolve — current revision, or the pinned one when `rev` is set (or `?revision=`). |
| `selector?` | `selector` | Optional projection; a projected read gets its own cacheable identity. |

**Returns** `rep<T>`

## 1.3  Revision pinning — pinned<T> / unpinned<T>

Every resource is versioned; a reference either pins one exact revision or floats to the current one.

<a id="pinned"></a>

### `pinned`

A reference pinned to one exact revision (`rev` present).

> **Normative.** A pin is a local Rev or an external Digest; since `Digest is Rev`, both satisfy `rev: Rev`.

```lumen
type pinned<T>   is ref<T> { rev: Rev }
```

<a id="unpinned"></a>

### `unpinned`

An unpinned reference (`rev` absent) — floats to the current revision.

```lumen
type unpinned<T> is ref<T> { rev: null }
```

## 1.4  The representation — rep<T> — and the kind markers

```
A resource splits cleanly in two: a uniform protocol ENVELOPE and a typed BODY.
`rep<T>` is the on-wire REPRESENTATION — the envelope around a `body: T`. A
domain type (`Issue`, `TypeDef`, `rel<…>`) is written as a plain record — the
body ALONE — and the envelope is applied by `rep<T>` at the point of use:
    type Issue is Bead { title: string, status: string }   // Issue IS the body
    get(ref<Issue>) -> rep<Issue>                           // { id, …, body: Issue }
There is no firewall rule and no envelope-field magic: the fields a type writes
ARE its body, and nothing nests them — `rep<T>` does, explicitly, once. So the
wire is root-addressed with no remapping: a selector / filter / patch names
`/body/status`, `/type`, `/metadata/…` literally. The CLI MAY sugar the `/body`
prefix away; the wire does not.
```

<a id="rep"></a>

### `rep`

The representation of a versioned resource — the protocol envelope around a typed `body: T`. The by-value form a read returns; `ref<T>` is the by-reference form. `Resource` is `rep<any>`, an untyped representation.

> **Normative.** The envelope members are fixed and closed — a domain type contributes only `body`, never a new envelope member. `id`, `type` and `body` are always present; the rest is optional. On a representation `id.rev` is the resolved revision; a reference floats to the current revision when its `rev` is absent.

> **Normative.** A TOMBSTONE — the final revision [delete](#delete) mints — carries `retired: true` and a `null` body, so it is an untyped [Resource](#Resource) (`rep<any>`), never a typed representation. It is a real, pinnable revision: it appears in [revisions](#revisions) (which yields `Resource`) and resolves through a pinned reference. A live revision has `retired` absent or false and a non-null body. An UNPINNED read of a retired resource faults `410 Gone`; the tombstone is still reachable by pinning its `rev`, so retirement is observable, not merely an error. `retired` is SERVICE-MANAGED — minted only by `delete`, refused on `create` and ignored on `put`, and read-only to `patch` ([patch](#patch)); a write can neither forge nor clear a tombstone. A pinned `get<T>` of a tombstone revision therefore yields the untyped tombstone `rep<any>` (`body: null`), NOT a `rep<T>`; `get`'s effective return is `rep<T>` OR a tombstone `rep<any>`, and a typed client checks `retired` before relying on `body: T`.

```lumen
type rep<T> = {
  id:            ResourceId
  authority?:    Authority
  type:          PathString
  body:          T
  metadata?:     Metadata
  provenance?:   Provenance
  createdAt?:    Timestamp
  storageClass?: StorageClass
  retired?:      bool
}
```

| Member | Type | Description |
|---|---|---|
| `id` | `ResourceId` | The resource's identity (scope + id); on a representation `rev` is the resolved revision, on a reference the optional pin. |
| `authority?` | `Authority` | Who names `type` — a package (bead) or a registry like IANA (content). Absent ⇒ ad-hoc / duck-typed. |
| `type` | `PathString` | The type path, resolved within `authority`'s namespace. |
| `body` | `T` | The typed body — the domain payload. `any` for an untyped `Resource`; a record for a bead; raw bytes/text for a content resource. |
| `metadata?` | `Metadata` | Opaque per-resource sidecar the protocol does not interpret. |
| `provenance?` | `Provenance` | Who caused this revision, how its period began, and when. |
| `createdAt?` | `Timestamp` | The resource's birth time, denormalized onto every revision. |
| `storageClass?` | `StorageClass` | How the resource is kept — durable, ephemeral, or intrinsic. |
| `retired?` | `bool` | True on a tombstone — the final, retired revision ([delete](#delete)); its `body` is `null`. Absent or false on a live revision. |

<a id="Resource"></a>

### `Resource`

An untyped representation — `rep<any>`. Used where the body type is unknown or open (a mixed listing, a generic read).

```lumen
type Resource = rep<any>
```

<a id="Bead"></a>

### `Bead`

A vacuous kind marker — a body type tagged `is Bead` is a package-authored record. It adds no members; it marks intention, lets a signature demand a bead (`ref<Bead>`), and carries the enforcement that a bead body is a record under a package authority. It is the implicit ROOT of a bead's kind path and contributes NO path segment: `type Issue is Bead` ⇒ kind `"issue"`.

```lumen
type Bead {}
```

<a id="Content"></a>

### `Content`

A vacuous kind marker — a body type tagged `is Content` is a registry-named (media-type) resource with an opaque body (bytes / text). The complement of `Bead`; a root marker, no path segment.

```lumen
type Content {}
```

## 1.5  Types on a resource — the (authority, type) pair

A resource's type is a path, fully qualified by the authority that names it. (The overlay that defines types — TypeDef — is §2.1.)

<a id="PathString"></a>

### `PathString`

A slash-delimited path — `"issue/task"` (a bead kind) or `"text/plain"` (a content media type).

> **Normative.** Two first path segments are reserved — `bdp` (the protocol's own fixed routes and artifacts, e.g. `/bdp/openapi`) and `sys` (in-band system resources, e.g. `/sys/changes`).

> **Normative.** A bare `-` segment is reserved everywhere as the ACTION FENCE: in any path the segment `-` separates a (possibly slash-bearing) resource id on its left from a protocol action or projection on its right (`/{id}/-/revisions`, `/-/list`). The fence is matched on the RAW path, before percent-decoding, and is the LAST `/-/` in the path; the segment(s) to its right are validated against the closed, fence-free set of protocol actions (a right side that is not a known action faults `404`). No resource-id segment may be a bare `-`: a literal hyphen-only segment inside an id MUST be percent-encoded (`%2D`), and a write that would mint an id with an unencoded bare `-` segment is refused — so a crafted `%2D` never forges the fence and the id/action split is deterministic.

```lumen
type PathString = string
```

<a id="Authority"></a>

### `Authority`

The resource that names a `type` — a package (for a bead) or a registry like IANA (for content). A ResourceRef, so the pin lives in its `rev`.

> **Normative.** The pair (authority, type) fully qualifies a type. The authority is pinned (its `rev` = the resolved digest/semver), so the type a resource was born against is frozen at inception and replays identically.

> **Normative.** `authority` MAY be caller-supplied (accepted as given); when absent on a write it is server-resolved from `type` — an installed default package (the standard types) is consulted before a registry like IANA, and a `type` that resolves to neither is ad-hoc (authority absent / duck-typed). A service SHOULD cache the well-known media types so content resolution need not reach IANA.

```lumen
type Authority = ResourceRef
```

<a id="PackageRef"></a>

### `PackageRef`

A pinned reference to a Package resource — an Authority that is a package (a bead's authority).

```lumen
type PackageRef = ref<PackageDef>
```

## 1.6  Metadata & provenance

<a id="Metadata"></a>

### `Metadata`

Opaque, open per-resource (or per-call) sidecar — data the protocol does not interpret.

```lumen
type Metadata = { ...: any }
```

<a id="Provenance"></a>

### `Provenance`

Who took part in the change that made a revision, how the Resource's present period began, and when. `previousRevision` is the before-image pointer — the basis for compensation — and rides in the post-image, so a ChangeEvent carries it for free.

> **Normative.** Provenance is data, not evidence — Core does not claim it is true. It describes one change and is not copied forward (the sole exception is `inception`). `committedAt` and `inception` are server-supplied, never caller input; a request that changes nothing records none, and one request that mints several revisions records provenance on each. A service MUST NOT invent a principal to fill an absent role; a caller cannot supply `basis` (`channel-authenticated` is service-assigned only, and `authority` then names that service).

```lumen
type Provenance = {
  principals:        [ Principal ],
  inception:         "create" | "import" | "unknown",
  committedAt:       Timestamp,
  previousRevision?: Rev,
  message?:          string,
  metadata?:         Metadata
}
```

| Member | Type | Description |
|---|---|---|
| `principals` | `[ Principal ]` | The principals who took part in the change. May be empty for observed or baseline revisions. |
| `inception` | `"create" \| "import" \| "unknown"` | How the Resource's present period began — freshly created, imported, or unknown. Under `permanent` a deleted identity is terminal and never reused; under `reusable` a retired id MAY be reminted per the scope's id model ([IdModel](#IdModel)). |
| `committedAt` | `Timestamp` | When this revision committed; server-supplied, never request input. |
| `previousRevision?` | `Rev` | The before-image pointer — the basis for compensation. Null on create; structural lineage, often known even when the principals are not. |
| `message?` | `string` | An optional free-text note describing the change. |
| `metadata?` | `Metadata` | Per-revision opaque data (data, open). |

<a id="Principal"></a>

### `Principal`

An identity that took part in a change — a person, agent or service account. A role grants no permission; authorization is a separate decision.

```lumen
type Principal = {
  id:           AbsoluteUri,
  displayName?: string,
  roles?:       [ string ],
  basis:        IdentityBasis,
  authority?:   AbsoluteUri
}
```

| Member | Type | Description |
|---|---|---|
| `id` | `AbsoluteUri` | The principal's identity URI. Need not be resolvable. |
| `displayName?` | `string` | A saved human label — never identity, never a matching key. |
| `roles?` | `[ string ]` | Open set of roles this principal played in the change (initiator, contributor, submitter, …). A role grants no permission. |
| `basis` | `IdentityBasis` | How the service established this identity. |
| `authority?` | `AbsoluteUri` | The service that channel-authenticated this identity. |

<a id="IdentityBasis"></a>

### `IdentityBasis`

How a service established a principal's identity.

> **Normative.** Open union — a reader MUST tolerate an unrecognized basis. New authentication bases are added without a breaking change.

```lumen
type IdentityBasis = union {
  "writer-supplied"
  "channel-authenticated"
  "unknown"
}
```

| Variant | Payload | Description |
|---|---|---|
| `"writer-supplied"` | — | The writer asserted the identity; the service did not verify it. |
| `"channel-authenticated"` | — | The channel authenticated the identity when the change arrived. |
| `"unknown"` | — | The basis is not recorded. |

<a id="StorageClass"></a>

### `StorageClass`

How a Resource is kept — whether it is persisted, not whether it is versioned (that is the scope's revision model). Durable is replicated and exported; ephemeral is local and never exported; intrinsic is computed by the service, not stored (capability beads are intrinsic).

> **Normative.** Export (the primitive) includes only `Durable` resources; `StorageClass` is per-resource, so a `Durable` scope MAY hold individual `Ephemeral` resources, and an `Ephemeral` resource is local state that is NEVER included in an export stream; `Intrinsic` is computed by the service, not stored.

> **Normative.** Whether revisions are kept is a SCOPE-WIDE property, not per-resource: a scope's `revisionModel` ([RevisionModel](#RevisionModel), advertised in discovery) is `versioned` (mints revisions; write refs `pinned`) or `unversioned` (mints none; write refs relax to `unpinned`). StorageClass is orthogonal — it says only whether a resource is persisted.

```lumen
type StorageClass = union {
  Durable
  Ephemeral
  Intrinsic
}
```

| Variant | Payload | Description |
|---|---|---|
| `Durable` | — | Replicated and exported (persisted). Whether its revisions are kept is the scope's `revisionModel`, not a property of the resource. |
| `Ephemeral` | — | Local and never exported. |
| `Intrinsic` | — | Computed by the service, not stored. |

<a id="Timestamp"></a>

### `Timestamp`

RFC 3339 date-time; uppercase `T` and `Z`.

> **Normative.** A `Timestamp` is RFC 3339 with an uppercase `T` and `Z`.

```lumen
type Timestamp is string
```

<a id="AbsoluteUri"></a>

### `AbsoluteUri`

Any absolute URI — a Problem `type`, a Principal `id`; need not resolve. NOT a resource reference (those are `ref<T>`).

```lumen
type AbsoluteUri is string
```

<a id="SemVer"></a>

### `SemVer`

A semantic-version string (a package's declared version).

```lumen
type SemVer is string
```

<a id="integer"></a>

### `integer`

A whole number — JSON `number` restricted to an integer value. Distinct from `number` (which admits fractions) so a typed or generated client maps it to an integer type (e.g. i64); on the wire it is an integer-valued JSON number. Use `integer` for counts, bounds, positions and priorities; keep `number` for genuinely fractional values (a score, a ratio).

```lumen
type integer is number
```

## 1.7  Relationships — a relationship is a resource

```
A relationship between two resources is not a construct of its own: it is a
Resource (a bead) whose body implicitly carries two endpoints and the
relationship's own properties, with its own identity, revision history and
provenance. There is no separate edge or link type. A relationship type is
declared with the `rel<F, T>` form and refined with `is`, e.g.
`type Dependency is unique acyclic rel<Issue, Issue> { note?: string }` and
`type Blocks is Dependency`.
```

<a id="rel"></a>

### `rel`

The relationship construct and its declaration form. `rel<F, T>` is a `Bead` body type that carries `source` (type F, the owning endpoint that asserts the relationship) and `target` (type T), plus the relationship type's own properties; its resource is `rep<rel<F, T>>`. A relationship type is declared `type X is <modifiers> rel<F, T> { <edge-fields> }` — a nominal refinement whose trailing record extends the body; a bare `<modifiers> rel<F, T>` is the same shape without the nominal identity. The declared name is the body type; `ref<X>` references the relationship, `rep<X>` is its representation.

> **Normative.** A relationship IS a resource (a bead — its authority is a package): it has its own identity, revision history and provenance. Body is implicit — `source`/`target` are not written, and the `{ <edge-fields> }` are ordinary body properties, not a second "edge metadata" bag. Changing a property mints a new revision of the relationship itself; creating or deleting a relationship does NOT touch either endpoint's revision. A relationship is a valid reference target, and its endpoints MAY themselves be relationships.

> **Normative.** Nothing distinguishes a relationship but its structural `source`/`target` pair — a bare `ref<T>` in any other body field is data, not a relationship; an edge is a declared relationship type, never an incidental reference. Referential integrity follows the KIND of reference: `source`/`target` are STRUCTURAL (a scope cascades an endpoint's retirement to the relationship, or restricts the retirement while it stands — a relationship never outlives a structural endpoint); a reference that only points AT a resource (a note, an annotation) is SOFT (it tolerates a retired target and resolves to its tombstone). Deletion is the resource tombstone ([delete](#delete)) — a terminal revision that keeps the id and history; a true destroy (purge) is a separate, rare operation, not a base primitive.

> **Normative.** `unique` is the optional uniqueness modifier — `unique rel<F, T>` keys the relationship by its natural key (`source`, `target`) and derives its id deterministically, so the same logical relationship resolves to one id in every replica. Without `unique`, each takes a surrogate id and several over the same pair coexist as distinct resources. The natural key is (concrete `type`, `source`, `target`): at most one relationship of a GIVEN concrete type per pair, while different concrete types over the same pair (e.g. `Blocks` and `Related` over A→B) coexist as distinct resources with distinct ids. Re-typing a relationship is therefore a delete + create (a new id), not a same-id mutation. Graph modifiers constrain the relation as a whole — `acyclic` (a DAG), `symmetric`, `reflexive`; the default is irreflexive and `acyclic` implies it. Reachability and traversal through relationships are a corelib surface, not Core.

```lumen
type rel<F, T> is Bead { source: ref<F>, target: ref<T>, ...: any }
```

## 1.8  Computed properties — derived, and revision-transparent

`computed` is a body-property modifier, NOT a type — it sits with the access-mode family, whose one other member is `serviceManaged`. A field marked `computed` is DERIVED — a pure function of the store's authored state, not authored input — and carries one rule: a derived value leaves no trace in the revision stream. It never contributes to the revision (a change in a computed value alone mints no new Rev and emits no ChangeEvent — the state-unchanged rule already excludes it), it is excluded from any content hash, and it surfaces read-only (a write that sets it is ignored, never authored). Its storage is unspecified — recompute on read, or cache — provided the authoritative value stays the function of authored state and the cache never appears in the revision stream. Core declares only the category and this contract; the derivation itself is supplied by a pack, never by Core.

> **Open** — the exact grammar by which `computed` and the access-mode > modifiers attach to a field is settled with that modifier family in the > Lumen scrub.

# 2. Beads

```
A bead is a resource whose body is a package-defined record and whose authority
is that package. A bead type is written as the BODY alone, tagged `is Bead`:
`type Issue is Bead { title: string, status: string }` — `Issue` IS the body
record, and its resource is `rep<Issue>` (§1.4). `Bead` is a vacuous kind marker
(intention + static enforcement), the implicit root of the kind path, adding no
path segment. "Content" (`is Content` — a media-type `type`, an opaque `body`)
is the complement; the marker also carries the authority intention (a package
ref ⇒ bead; a registry ref like IANA ⇒ content), and `authority` is optional, so
a bead MAY be duck-typed. The four definitional bead kinds (Type, Channel,
Operation, Package) are how BDP describes and distributes types, operations, and
channels — the overlay system; each is a `Bead` body type whose resource is a
`rep<…>`, with no separate `…Bead` wrapper type.
```

Content is a bare Resource — no narrowing: `type` is a media type named by a registry, `body` is raw bytes/text. (See the worked examples at the end.)

## 1.9  Aliases — a second name that overlays the scope root

An alias is a second name for a resource. It is itself a resource — an `Alias` bead parked in the reserved `sys/aliases/` namespace — so it is bound, read, repointed and removed with the ordinary primitives, and keeps its own history. No alias-specific operation exists. Aliases are present only when the scope advertises the `aliases` capability ([AliasCaps](#AliasCaps)).

<a id="Alias"></a>

### `Alias`

A named pointer — a second name for a resource. The alias's own id is the name, under the reserved `sys/aliases/` root; its `target` names the resource the name stands for.

> **Normative.** An `Alias` is an ordinary Bead at `sys/aliases/{name}`. It is managed entirely through the existing primitives — `put` binds or repoints it, `delete` removes it, `get` reads it, and `list` over `sys/aliases` (filtered on `target`) enumerates the names that point at a resource. Repointing mints a revision, so an alias carries its own history. `target` is a SOFT reference: a deleted target is not rewritten, so an unpinned alias then resolves to the target's tombstone and faults `410 Gone`.

> **Normative.** THE OVERLAY (resolution, not an operation). When the scope advertises `aliases`, id resolution gains one step: a bare scope-root id that names an `Alias` resolves THROUGH it to the alias's `target` before the operation runs. So `get`, `put`, `patch` and `delete` on an alias name act on the TARGET, and a read returns the target's `id`/`rev` — the alias leaves no trace in the result. The primitives are unchanged; only id resolution carries the extra hop. The binding itself is addressed directly at `sys/aliases/{name}`, never through the overlay, so `delete sys/aliases/{name}` removes the name while `delete {name}` deletes the target. Because a dereferenced read never reveals that a name was an alias, the two interrogations are explicit: a `get` on `sys/aliases/{name}` (present ⇒ it is an alias) and the filtered `list` (the names that point at a target).

> **Normative.** SINGLE HOP, SAME SCOPE. `target` names a resource in the alias's own scope and MUST NOT name another `Alias` — binding an alias whose target is a live alias is refused `invalid-target`, so chains and cycles are unrepresentable. The overlay resolves by TRANSPARENT REWRITE (no `3xx`): `GET {name}` is served as `GET {target}` and the reply carries `Content-Location: /{target}` naming the target's canonical id (a cache still keys on the request target URI, not on this header; an unsafe request invalidates the named URI per RFC 9111 §4.4). The reverse lookup — `list sys/aliases` filtered on `target` — matches `target` against the canonical id string.

> **Normative.** UNIQUENESS. A scope-root name is held by AT MOST ONE claimant — a resource OR an alias, never both. `create` (or an id-rooted `put`) at a name that is a live alias is refused `identity-taken`; binding an `Alias` whose name is a live resource id is refused likewise; and the id a server mints for an unrequested `create` avoids live alias names exactly as it avoids live ids. The guarantee spans both claim paths at once.

```lumen
type Alias is Bead {
  target: ref<any>
}
```

| Member | Type | Description |
|---|---|---|
| `target` | `ref<any>` | The resource this name stands for — a SOFT, SINGLE-HOP reference to a resource in the SAME scope; never another alias (no chains) and never a foreign scope. Tolerates a retired target (resolves to its tombstone). |

## 2.1  Types — the kind system, TypeDef & the value-schema

```
path = chain. Bead subtypes use single inheritance; the `is` chain builds the
element path, which is `type.id`, which is `kind`:
  type Issue is Bead  { … }   → "issue"
  type Task  is Issue { … }   → "issue/task"
Only one `is` parent is allowed — that is what makes the path (a tree) unique.
A kind / type-path PREFIX test is SEGMENT-bounded: a prefix matches only at a `/`
boundary (or the whole path), so `issue` matches `issue` and `issue/task` but NOT
`issuecomment`. Naive string-prefix matching false-matches siblings — a real bug,
and it governs every capability query (`dependency/ready-affecting/*`) and `is-a` test.
A segment is the type NAME kebab-cased (PascalCase/camelCase → kebab): `Issue` → "issue",
`IssueComment` → "issue-comment", `HardBlocking` → "hard-blocking", `ReadyAffecting` →
"ready-affecting" — matching the dependency types and the cli-flag convention; NOT
lowercase-run-together ("issuecomment" is wrong).
```

- additive: a child has all parent fields plus its own
- narrowing-only override: narrow a type, or optional→required; never widen or drop — preserves substitutability (ref<Issue> may hold a Task)
- a same-named child field must be a narrowing, else a diagnostic
- `abstract?` on a TypeDef ⇒ not directly instantiable (a bead must use a leaf)

resolver (Types-layer capability, NOT core): walk the pinned path base→leaf and merge per the rules — the path is the plan. A pinned authority ⇒ the effective schema is immutable and cacheable. A cross-package parent is a `refines` ref the resolver follows across authorities.

cross-module: a foreign name never enters the path. A cross-module `is` makes the child a local root whose `refines` holds a resolved ref (identity carries a ref, not a name). Within a module kind == schema-ancestry; across modules kind stays local and "is-a" is a `refines`-graph query (a capability), not a kind-prefix scan.

refinement vs union: refinement (`is`) = open kind hierarchy, path-addressed; `union` = closed value-level sum type.

<a id="TypeDef"></a>

### `TypeDef`

A type-definition bead body — one node in the single-`is` refinement tree. Its resource is `rep<TypeDef>`.

> **Normative.** A type's element path is parent-path ⊕ its own name. A same-package parent is the path prefix (implicit); `refines` is set only for a cross-package parent. The Types resolver flattens the chain base→leaf per the §2.1 inheritance rules.

```lumen
type TypeDef is Bead {
  refines?:   TypeRef
  abstract?:  bool
  properties: [ PropertyDeclaration ]
}
```

| Member | Type | Description |
|---|---|---|
| `refines?` | `TypeRef` | Cross-package parent only; a same-package parent is the path prefix. Null + no prefix ⇒ root. |
| `abstract?` | `bool` | True ⇒ not directly instantiable; a bead must use a leaf. |
| `properties` | `[ PropertyDeclaration ]` | The body properties of resources of this type; inherited properties merge per the §2.1 rules. |

<a id="PropertyDeclaration"></a>

### `PropertyDeclaration`

One property in a type's body — its name, its type, and its access mode. `computed` marks a derived, revision-transparent property (see §1.8); `serviceManaged` is the sibling write-access mode. Property optionality rides the property's `type`.

> **Normative.** At most one access mode applies. `computed` ⇒ derived and revision-transparent (never authored, never advances the revision, hash-excluded, surfaces read-only). `serviceManaged` ⇒ set by the service, never a writer. All absent ⇒ an ordinary authored property. A read-only member (`computed` or `serviceManaged`) supplied on a write (`create` / `put`) is IGNORED, never faulted — so a `get` → `put` round-trip of a whole representation is safe.

```lumen
type PropertyDeclaration = {
  name:            string,
  type:            BeadSchema,
  computed?:       bool,
```

| Member | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `type` | `BeadSchema` |  |
| `computed?` | `bool` |  |

<a id="ParameterDeclaration"></a>

### `ParameterDeclaration`

One parameter of an operation — its name, its type, and whether it is required. A default value is NOT a core concern; it is a CLI surface hint carried outside the protocol.

```lumen
type ParameterDeclaration = {
  name:      string,
  type:      BeadSchema,
  required?: bool
}
```

| Member | Type | Description |
|---|---|---|
| `name` | `string` |  |
| `type` | `BeadSchema` |  |
| `required?` | `bool` |  |

<a id="BeadSchema"></a>

### `BeadSchema`

A type written down as a value — the ref-preserving type representation. (A `schema` has no identity, so a type-as-value is a `schema`.)

> **Normative.** On export a BeadSchema lowers to a JSON Schema document (and an OpenAPI contract) for external consumers; the exported/wire form is byte-identical to the pre-BeadSchema JSON Schema, so the v0.2.0 freeze is NOT reopened. Only genuinely open data uses `{ ...: any }`; a written-down type uses this.

```lumen
type BeadSchema =
    Scalar  { of: "string" | "number" | "bool" | "bytes" }
  | Literal { value: any }
  | Nominal { name: string, base: BeadSchema, refinement?: { ...: any } }
  | Record  { fields: [ { name: string, type: BeadSchema, required: bool } ], open: bool }
  | DU      { arms: [ { tag: string, payload?: BeadSchema } ] }
  | Union   { options: [ BeadSchema ] }
  | Array   { element: BeadSchema }
  | Set     { element: BeadSchema, on?: [ LocalName ] }
  | TypeRef { to: TypeRef }
  | JsonSchema { text: string }
```

| Alternative | Description |
|---|---|
| `Scalar { of: "string" \| "number" \| "bool" \| "bytes" }` |  |
| `Literal { value: any }` |  |
| `Nominal { name: string, base: BeadSchema, refinement?: { ...: any } }` |  |
| `Record { fields: [ { name: string, type: BeadSchema, required: bool } ], open: bool }` |  |
| `DU { arms: [ { tag: string, payload?: BeadSchema } ] }` |  |
| `Union { options: [ BeadSchema ] }` |  |
| `Array { element: BeadSchema }` |  |
| `Set { element: BeadSchema, on?: [ LocalName ] }` |  |
| `TypeRef { to: TypeRef }` | A reference to a type element. |
| `JsonSchema { text: string }` |  |

<a id="LocalName"></a>

### `LocalName`

A short identifier token for a view or a well-known name; leading letter.

```lumen
type LocalName is string
```

**element references (how one overlay element names another)**

<a id="PackageElementRef"></a>

### `PackageElementRef`

A bundled reference to a package element — a package authority plus the element's relative path.

> **Normative.** `authority` is OPTIONAL — a same-package (relative) reference omits it, as `refines` does within a package. A resource's own type is this pair unbundled into its `authority` + `type` envelope fields; PackageElementRef is the standalone / cross-package form.

```lumen
type PackageElementRef {
  authority?: PackageRef
  path:       ElementPath
}
```

| Member | Type | Description |
|---|---|---|
| `authority?` | `PackageRef` | The package that names the element; absent ⇒ relative to the current package. |
| `path` | `ElementPath` | The element's package-relative path. |

<a id="ElementPath"></a>

### `ElementPath`

A package-relative element path (the single-`is` chain).

```lumen
type ElementPath = PathString
```

Open: could `TypeRef` / `OperationRef` / `ChannelRef` collapse into one `packref<T>`?

<a id="TypeRef"></a>

### `TypeRef`

A reference to a type element.

```lumen
type TypeRef      = PackageElementRef
```

<a id="OperationRef"></a>

### `OperationRef`

A reference to an operation element.

```lumen
type OperationRef = PackageElementRef
```

<a id="ChannelRef"></a>

### `ChannelRef`

A reference to a channel element.

```lumen
type ChannelRef   = PackageElementRef
```

## 2.2  Channels & the streaming model — pull, push

A channel carries a sequence of events; `pull` reads it and `push` writes it. A read of a sequence is one of two natures: a LIVE feed (`pull` a channel) is a `source<T>`; a FINITE cut (a scope listing, a resource's history, an export) is a `snapshot<T>`. BDP offers one streaming convention over both; the nature decides which transport forms are valid (see the streaming model below).

<a id="Channel"></a>

### `Channel`

A channel-descriptor bead body — its two event schemas, direction, and delivery characteristics. Its resource is `rep<Channel>`.

> **Normative.** `direction` and the two schemas are mutually constraining — `source` ⟺ pullSchema set & pushSchema null; `sink` ⟺ pushSchema set & pullSchema null; `duplex` ⟺ both set.

> **Normative.** A Channel bead's revision does NOT change when events arrive — the bead is not the stream. Appended events ride the channel's own stream, never the changefeed.

```lumen
type Channel is Bead {
  pushSchema?: BeadSchema
  pullSchema?: BeadSchema
  direction:   "source" | "sink" | "duplex"
  retention:   Retention
  cardinality: "single" | "broadcast"
}
```

| Member | Type | Description |
|---|---|---|
| `pushSchema?` | `BeadSchema` | What `push` accepts; null on a source (pull-only). |
| `pullSchema?` | `BeadSchema` | What `pull` delivers; null on a sink (push-only). |
| `direction` | `"source" \| "sink" \| "duplex"` | The advertised facet — source · sink · duplex. |
| `retention` | `Retention` | How far back a cursor can resume. |
| `cardinality` | `"single" \| "broadcast"` | Delivery cardinality — single or broadcast. |

<a id="Retention"></a>

### `Retention`

How far back a cursor can resume; below the floor a cursor faults `cursor-expired` and the reader resyncs (list-bootstrap + follow from head).

```lumen
type Retention = union {
  Forever
  Window    { by: "time" | "count" | "size", amount: integer }
  Compacted { window?: Retention }
}
```

| Variant | Payload | Description |
|---|---|---|
| `Forever` | — | Every event is resumable; the stream is never trimmed. |
| `Window` | `{ by: "time" \| "count" \| "size", amount: integer }` | Resumable within a trailing window, bounded by time, count, or size. |
| `Compacted` | `{ window?: Retention }` | Compacted to latest-per-key; an optional window bounds the compacted tail. |

--- the streaming model: two natures, three encodings, cursors, windows --- A read of an ordered, resumable sequence of `T` has one of two NATURES, and the nature — not the reader — decides which transport encodings are valid:

```
  • `source<T>`   = a LIVE feed: a changefeed or declared stream, `pull`ed from a
                    Channel. It has a live edge that keeps growing.
  • `snapshot<T>` = a FINITE cut: `list` (a scope's current resources), `revisions`
                    (one resource's history), `export` (a scope backup), and the
                    stdlib `query`. Taken as of a cursor; nothing follows it.
```

A reader consumes either in one of three transport encodings — each a typed projection the nature declares support for (the `--format` / Accept arm):

| encoding | type | wire | valid on | notes |
|---|---|---|---|---|
| windowed | page<T> | application/json | source · snapshot | one request → one Page<T> |
| bulk | jsonl<T> | application/jsonl | source · snapshot | the whole sequence, T/line |
| live | sse<T> | text/event-stream | source only | follow the feed as it grows |

`page<T>` and `jsonl<T>` are PULL/drainable, so they fit either nature. `sse<T>` is the only PUSH encoding — it follows a live edge — so it is LIVE-ONLY: a `source` may select it; a `snapshot` has nothing to follow and the encoding is not in its support set (so the invalid cell is unrepresentable in the type, not merely a runtime fault; the `400` survives only as the raw-wire guard for a client that hand-forges `?format=sse`). `page<T>` is NOT a new type — it is the existing `Page` window ([Page](#Page)) parameterized on `T` (shorthand for `Page<T>`).

```
One Cursor spans all three encodings of a `source`: page in json, catch up in jsonl,
hand the same cursor to sse to go live.
The transport enum is `Transport`, the response window is `Page`, and the request
bundle is `ReadRequest` — ONE request type, shared by every read; its valid `format`
set is DERIVED from the nature (a `source` admits `sse`, a `snapshot` does not).
RESOLVED (return unified): the WINDOWED reads — `pull` (source) / `list` · `revisions` ·
the stdlib `query` (snapshot) — wire-return a `Page` window `{ items, cursor, head? }`.
The nature is the logical sequence; `Page` is its one-request window, the universal read
envelope, so `list`/`query` return a Page, NOT a bare array. `export` is the one
exception: a bulk BACKUP, it is a `jsonl` stream self-framed by `ExportBegin`/`ExportEnd`,
not a Page. `cursor`
resumes AFTER its last item (exclusive, opaque; null/absent once `head`). With `limit`
absent a read returns the whole current set in one Page, BOUNDED by the service's
advertised `maxLimit` — a larger set returns `maxLimit` items + a resume `cursor`, never
unbounded. One Cursor spans the page / jsonl / sse transports.
```

<a id="Ordinal"></a>

### `Ordinal`

An event's position in its stream; monotone within one Channel.

```lumen
type Ordinal is integer
```

<a id="Cursor"></a>

### `Cursor`

Opaque, transport-independent resume token, bound to one stream and the selection it came from; refused elsewhere. Also the point an export is cut at.

```lumen
type Cursor is string
```

<a id="Transport"></a>

### `Transport`

The transport encoding a caller selects (the `--format` arm): `page` (windowed JSON pages), `jsonl` (bulk JSON-lines), or `sse` (live SSE). The token mirrors the typed projection — `page<T>` / `jsonl<T>` / `sse<T>`. `page` is the windowed encoding; `jsonl` is the bulk encoding, offered by the bulk reads (`export`, `pull`, stdlib `query`) but NOT the windowed resource reads `list`/`revisions` (which are `page`-only); `sse` is valid only on a `source` (a live feed, `pull`), and a `snapshot` (list/query/revisions/export) does not carry it in its support set.

> **Normative.** `sse` transport is valid ONLY on a live source (pull); a snapshot read (list/query/revisions/export) refuses `format=sse` and faults `400`.

> **Normative.** `list` and `revisions` are `page`-only — they refuse `format=jsonl` (and `sse`) and fault `400`; the windowed resource reads return a `Page` ([Page](#Page)), and `jsonl` serves the bulk reads (`export`, `pull`, stdlib `query`), not them.

```lumen
type Transport = "page" | "jsonl" | "sse"
```

<a id="ReadRequest"></a>

### `ReadRequest`

The input to a streaming read — where to resume, how much, the transport, and per-item shaping. ONE request type for every read, `source` ([pull](#pull)) and `snapshot` ([list](#list) / [revisions](#revisions) / [export](#export) / stdlib `query`) alike; the valid `format` set is DERIVED from the read's nature (a `source` admits `sse`, a `snapshot` does not). `after` (a cursor) xor `from` (a fresh ordinal) are mutually exclusive. The target is the op's first parameter, not restated here.

> **Normative.** Supplying both `after` and `from` is malformed and faults `400`.

> **Normative.** A service offering a read MUST HONOR the floor controls it accepts — not merely declare them: `after` (resume from the cursor), `limit` (window the result), and `format` (encode in the selected transport) — and MUST fault `400` on a malformed value. Silently ignoring a resume cursor or a transport selector — returning the whole set from the start, or the default encoding, as if the param were absent — is NON-CONFORMANT (the silent-failure class, like a dropped `where`). A declared floor param is a promise to act on it.

```lumen
type ReadRequest = {
  after?:  Cursor,
  from?:   Ordinal,
  limit?:  integer,
  format?: Transport,
  filter?: Filter,
  select?: selector
}
```

| Member | Type | Description |
|---|---|---|
| `after?` | `Cursor` | Resume at an opaque cursor (exact). |
| `from?` | `Ordinal` | Start at a known ordinal (xor `after`). |
| `limit?` | `integer` | Cap the window size. |
| `format?` | `Transport` | The transport encoding (`page`/`jsonl`/`sse`); `sse` only on a `source`. |
| `filter?` | `Filter` | Filter the stream. |
| `select?` | `selector` | Project each event. |

<a id="Page"></a>

### `Page`

One finite page of a stream — the windowed floor every service offers: one request, one page, nothing held open.

```lumen
type Page<T> = {
  items:  [T],
  cursor: Cursor,
  head?:  bool
}
```

| Member | Type | Description |
|---|---|---|
| `items` | `[T]` | The items in this window (the stream's element type `T` — `ChangeEvent` for the changefeed, `Resource` for a `list`). |
| `cursor` | `Cursor` | Where to resume; opaque, bound to this stream + selection. |
| `head?` | `bool` | Caught up to the live edge? |

<a id="pull"></a>

### `pull`

Read a Channel — the changefeed (well-known `/sys/changes`) or a declared stream — as a `source<T>` (a LIVE feed) of its `pullSchema` events. `--format` picks the transport (`page` windowed / `jsonl` bulk / `sse` live); one Cursor spans all three. `sse` is valid here because `pull` is the one live-feed read.

> **Normative.** Valid on a `source`/`duplex` channel; a `sink`-only channel faults `channel-not-pullable`. Faults `cursor-expired` below the retention floor.

> **Normative.** A channel is a resource (`rep<Channel>`, [Channel](#Channel)), so its absence and retirement resolve as `get`'s do: `pull` of an ABSENT channel faults `404` (`resource-not-found`), and `pull` of a RETIRED channel faults `410` (`resource-erased`) — distinct from `cursor-expired`, the other `410` (below the retention floor). Offering `pull` advertises the operation, not a channel inventory; which channels exist is discovered per-channel.

```lumen
fn pull(
    channel: unpinned<Channel>,
    request: ReadRequest
  ) -> Page<any>
```

| Parameter | Type | Description |
|---|---|---|
| `channel` | `unpinned<Channel>` | The channel to read — the changefeed or a declared stream. |
| `request` | `ReadRequest` | Where to resume, how much, and the transport (see [ReadRequest](#ReadRequest)). |

**Returns** `Page<any>` — One finite page of a stream — the windowed floor every service offers: one request, one page, nothing held open.

<a id="push"></a>

### `push`

Append one or more events to a Channel. The pusher offers a batch and the channel accepts what it can take now — `push` is non-blocking: it accepts a prefix, defers the rest under backpressure, and the pusher re-offers from `acceptedThrough + 1`. The pusher owns the pump. A keyed event (carrying a pusher-assigned `ordinal`) is idempotent — a re-push is a benign no-op. `jsonl` body (bulk).

> **Normative.** Valid on a `sink`/`duplex` channel; a `source`-only channel faults `channel-not-pushable`. A terminal (closed/failed) channel faults; a `single`-cardinality channel caps the batch at one.

> **Normative.** Append is idempotent on `(channel, ordinal)`. A keyed event — one carrying a pusher-assigned `ordinal` — is first-write-wins and immutable: a re-push of that ordinal is a benign no-op success, reported `Deduped`, never a fault. A single logical writer per channel makes pusher-assigned ordinals collision-free. An event with no `ordinal` is appended and the channel assigns one, reported `Accepted`.

> **Normative.** Backpressure rides the acknowledgement, not a reverse stream. The channel accepts a prefix of the batch up to its current admission `credit` (advertised as `window` in discovery), marks the remainder `Deferred`, and returns `acceptedThrough` (the high-water ordinal) with `credit` (how many more it will take now) and an optional `retryAfter`. The pusher holds the deferred tail and re-offers from `acceptedThrough + 1` after `retryAfter`; because re-offer is idempotent, the pusher tracks no per-event acknowledgement. The channel initiates nothing — it only annotates each pusher-initiated call.

> **Normative.** Backpressure — a `PushAck` carrying `credit: 0` and a deferred tail — is soft and temporal, not an error. It is distinct from `limit-exceeded` (422), the hard rejection of a request that exceeds a static capability bound (e.g. `maxBatch`), fixed by shrinking the request.

```lumen
command push(
    channel: unpinned<Channel>,
    events:  [PushEvent<any>]
  ) -> PushAck
```

| Parameter | Type | Description |
|---|---|---|
| `channel` | `unpinned<Channel>` | The channel to append to — must accept writes (`sink`/`duplex`). |
| `events` | `[PushEvent<any>]` | One or more events to append, in order; each the channel's `pushSchema` type. A keyed event carries a pusher-assigned `ordinal`. |

**Returns** `PushAck` — What [push](#push) returns — the high-water ordinal accepted, a per-event result, and the backpressure signal (`credit` + optional `retryAfter`). A short `results` with `credit: 0` and a deferred tail is normal flow, not an error.

Single-writer assumption (v0.2): a channel has one logical writer, so pusher-assigned ordinals are collision-free and `(channel, ordinal)` idempotency needs no strategy. A multi-writer channel (ordinals not collision-free) would reintroduce a fault-vs-skip push strategy — an additive, non-breaking extension, out of scope for v0.2.

<a id="PushEvent"></a>

### `PushEvent`

One event offered to [push](#push). `body` is the payload (the channel's `pushSchema` type — which MAY be any value, not only a record, so `body: T` is deliberately unconstrained); `ordinal`, when present, is the pusher-assigned position that makes the append idempotent (keyed). Absent, the channel assigns the ordinal.

```lumen
type PushEvent<T> = {
  ordinal?: Ordinal,
  body:     T
}
```

| Member | Type | Description |
|---|---|---|
| `ordinal?` | `Ordinal` | The pusher-assigned position, for a keyed (idempotent) append; absent, the channel assigns one. |
| `body` | `T` | The event payload — the channel's `pushSchema` type. |

<a id="PushAck"></a>

### `PushAck`

What [push](#push) returns — the high-water ordinal accepted, a per-event result, and the backpressure signal (`credit` + optional `retryAfter`). A short `results` with `credit: 0` and a deferred tail is normal flow, not an error.

```lumen
type PushAck = {
  acceptedThrough: Ordinal,
  results:         [PushResult],
  credit:          integer,
  retryAfter?:     integer
}
```

| Member | Type | Description |
|---|---|---|
| `acceptedThrough` | `Ordinal` | The high-water ordinal durably appended by this call; the pusher re-offers from `acceptedThrough + 1`. |
| `results` | `[PushResult]` | Per offered event, in order — appended, deduped (idempotent re-push), or deferred under backpressure. |
| `credit` | `integer` | How many more events the channel will accept right now (admission credit); `0` means hold and retry. |
| `retryAfter?` | `integer` | How long to wait before re-offering the deferred tail (seconds; maps to HTTP `Retry-After`). |

<a id="PushResult"></a>

### `PushResult`

The fate of one offered event.

```lumen
type PushResult = union {
  Accepted { ordinal: Ordinal }
  Deduped  { ordinal: Ordinal }
  Deferred
}
```

| Variant | Payload | Description |
|---|---|---|
| `Accepted` | `{ ordinal: Ordinal }` | Appended at this ordinal. |
| `Deduped` | `{ ordinal: Ordinal }` | Already present at this ordinal (idempotent re-push) — a benign no-op. |
| `Deferred` | — | Not accepted on this call (backpressure); re-offer after `retryAfter`. |

## 2.3  Operations — call, cancel

An operation is a declared callable. `call` invokes it (sync or async); it is the only primitive with the rich Outcome (a user Operation has a declared success/failure in its signature; the data primitives do not).

<a id="Operation"></a>

### `Operation`

An operation-descriptor bead body — the call contract, the implementation, and the behavioural guarantees. Its resource is `rep<Operation>`.

> **Normative.** The effect markers (`pure`/`safe`/`idempotent`/`atomic`) are three-valued — present = a known guarantee, absent = unknown. `pure` ⟹ `safe`; `pure:true` + `safe:false` is a rejectable contradiction. The Lumen surface callable keywords lower to these fields (`fn` ⇒ pure).

```lumen
type Operation is Bead {
  signature:       Signature
  implementation?: any
  pure?:           bool
  safe?:           bool
  idempotent?:     bool
  atomic?:         bool
}
```

| Member | Type | Description |
|---|---|---|
| `signature` | `Signature` | The call contract. |
| `implementation?` | `any` | The mounted AST. Present ⇒ stored (ships in the pack) · absent ⇒ intrinsic (native). |
| `pure?` | `bool` | Known to neither read nor write external state. |
| `safe?` | `bool` | Known not to write (reads allowed); pure ⟹ safe. |
| `idempotent?` | `bool` | Known to be idempotent. |
| `atomic?` | `bool` | Known to commit as a single transaction. deferred to the scheduler. |

Open: define `fn` / `command` at the core level, or leave it to the upper layers (packs induce it)?

<a id="Signature"></a>

### `Signature`

An operation's call contract — its interface, kept separate from the implementation and the effect markers.

```lumen
type Signature {
  parameters?: [ ParameterDeclaration ]
  success?:    BeadSchema
  failure?:    BeadSchema
  async?:      "no" | "optional" | "required"
  creates?:    bool
}
```

| Member | Type | Description |
|---|---|---|
| `parameters?` | `[ ParameterDeclaration ]` | The input record — the operation's parameter declarations. |
| `success?` | `BeadSchema` | The success type (T). |
| `failure?` | `BeadSchema` | The declared failure type (E). |
| `async?` | `"no" \| "optional" \| "required"` | Async disposition — sync-only · caller-picks · async-only. |
| `creates?` | `bool` | Whether a successful call mints a resource → 201 + Location. |

**the call protocol: correlation, request/reply, result/outcome/problem**

<a id="Cause"></a>

### `Cause`

A correlation token shared down a causal chain — minted at an initiating (often detached) call and propagated unchanged to every call it sets off; `causedBy` points at the parent cause. Correlates all of one initiation's work. See bdp.md §6.

```lumen
type Cause       is string
```

<a id="CallId"></a>

### `CallId`

A correlation token naming one call — a node in the call tree; `calledBy` points at the parent call. Distinct from `Cause` (correlation to an initiation) and `Transaction` (the atomic commit). Diagnostic-tier.

```lumen
type CallId      is string
```

<a id="Transaction"></a>

### `Transaction`

A correlation token naming one atomic commit — shared by every change that commits together. Propagated by enlistment, not unconditionally (Required / RequiresNew / detach); crossing a scope forces a new one. See bdp.md §6.

```lumen
type Transaction is string
```

<a id="IdempotencyKey"></a>

### `IdempotencyKey`

Caller-chosen key that makes a retried write safe to collapse onto the first effect.

```lumen
type IdempotencyKey is string
```

<a id="Request"></a>

### `Request`

What a caller sends to `call`. `arguments` is a name/value list whose shape the Operation's `parameters` dictate.

```lumen
type Request = {
  arguments:      [ { name: string, value: any } ],
  async:          bool = false,
  causedBy?:      Cause,
  calledBy?:      CallId,
  provenance?:    Provenance,
  idempotencyKey: IdempotencyKey,
```

| Member | Type | Description |
|---|---|---|
| `arguments` | `[ { name: string, value: any } ]` | The positional-by-name arguments, shaped by the Operation's `parameters`. |
| `async` | `bool = false` | Request async disposition (default sync). |
| `causedBy?` | `Cause` | The cause that triggered this call (correlation). |
| `calledBy?` | `CallId` | The parent call — its CallId (correlation, diagnostic-tier). |
| `provenance?` | `Provenance` | The caller's part of provenance only (principals/message/metadata); never server fields. |
| `idempotencyKey` | `IdempotencyKey` | Collapses a retried call onto the first effect. |

<a id="Reply"></a>

### `Reply`

What a `call` returns — flat, no context wrapper. `outcome` keeps the domain `Result` nested in `Outcome`.

> **Normative.** The `outcome`'s `T` and `E` are those declared by the target Operation's signature (`success` / `failure`); the envelope itself carries `Outcome<any, any>` and is narrowed only at the call site.

```lumen
type Reply = {
  outcome:      Outcome<any, any>,
  cause:        Cause,
  callId:       CallId,
  transaction?: Transaction,
  metadata?:    Metadata
}
```

| Member | Type | Description |
|---|---|---|
| `outcome` | `Outcome<any, any>` | What happened — the domain Result or a non-domain fate. |
| `cause` | `Cause` | The cause this call ran under (correlation). |
| `callId` | `CallId` | This call's id (correlation). |
| `transaction?` | `Transaction` | The commit this call belonged to, if any. |
| `metadata?` | `Metadata` | Opaque per-reply sidecar. |

<a id="Result"></a>

### `Result`

A callable's own verdict — succeeded with a value, or failed with its declared error.

```lumen
type Result<T, E> = union {
  success { value: T }
  failure { error: E }
}
```

| Variant | Payload | Description |
|---|---|---|
| `success` | `{ value: T }` | Succeeded, carrying the value. |
| `failure` | `{ error: E }` | Failed with the declared error (E). |

<a id="Outcome"></a>

### `Outcome`

What happened to an invocation — the domain Result, or a non-domain fate.

> **Normative.** The non-domain set (`fault` · `canceled`) is open — a reader MUST tolerate an unrecognized arm. This is the one sanctioned open union: the evolution surface for invocation fates (a closed union cannot gain arms). A domain failure is `Result.failure`; a non-domain failure is `fault`.

> **Normative.** A present `outcome` means the invocation is settled, whichever arm it holds; a transient state (running/waiting) is NOT an arm. Each arm is an open record — a reader MUST ignore a member it does not know. Only `success` means the operation went as intended.

> **Normative.** Wire encoding — `Result` and `Outcome` lower to an INTERNALLY-TAGGED JSON object with a `kind` discriminator: `{ "kind": "success", "value": T }` · `{ "kind": "failure", "error": E }` · `{ "kind": "fault", "problem": Problem }` · `{ "kind": "canceled", "reason"?: string }`. The HTTP status aligns (200 success · 409 the domain failure · the Problem's own status for a fault · 202 for an async `AsyncResult`), but `kind` is explicit in the body so a reader never infers the arm from the status alone.

```lumen
type Outcome<T, E> = union {
  Result<T, E>
  fault { problem: Problem }
  canceled { reason?: string }
}
```

| Variant | Payload | Description |
|---|---|---|
| `Result<T, E>` | — | The domain Result — success \| failure. |
| `fault` | `{ problem: Problem }` | An undeclared failure (NOT an E) — carries a Problem. |
| `canceled` | `{ reason?: string }` | Kill -9 — runs no compensation. `timed_out` is a cancel reason, with the scheduler. |

<a id="Problem"></a>

### `Problem`

An RFC 9457 problem document — what a `fault` carries, and the body of a failing response from the data primitives.

> **Normative.** `type`, `title`, `status`, `detail` and `instance` are the RFC 9457 standard members; `code` and `retry` are BDP EXTENSION members (RFC 9457 permits extension members). `type` is a stable, machine-readable problem-type URI identifier (`tag:bdp.dev,2026:problem/<code>`, one per `code` — Appendix D.9), not a bare token. A `tag:` URI (RFC 4151) identifies without being dereferenceable, which RFC 9457 §3.1.1 permits.

> **Normative.** The fault model. Every primitive returns its declared value on success or faults with a Problem — delivered out of band as the HTTP non-2xx response (RFC 9457), never part of the declared return type; a fault is orthogonal to the value. Only `call` additionally carries a declared failure (`Outcome.failure`, HTTP 409) — an operation's own "no". The data primitives have none: a read returns a `rep` or faults. A Problem is the universal fault channel, not the `E` of a `Result`.

> **Normative.** The HTTP status line is the NORMATIVE status of a fault; `Problem.status` is a copy that MUST equal it, and where the two disagree the HTTP status governs — a conformance assertion about a fault's status reads the HTTP status line, not the body member.

```lumen
type Problem = {
  type:      AbsoluteUri,
  title:     string,
  status:    integer,
  code:      string,
  retry:     "never" | "after-state-change" | "after-delay",
  detail?:   string,
  instance?: AbsoluteUri,
  ...: any
}
```

| Member | Type | Description |
|---|---|---|
| `type` | `AbsoluteUri` | A URI naming the problem kind. |
| `title` | `string` | A short human summary. |
| `status` | `integer` | The HTTP status code. |
| `code` | `string` | A stable, machine-readable problem code. |
| `retry` | `"never" \| "after-state-change" \| "after-delay"` | Whether a retry can help. |
| `detail?` | `string` | An optional human detail. |
| `instance?` | `AbsoluteUri` | An optional URI for the specific occurrence. |

<a id="AsyncResult"></a>

### `AsyncResult`

The async result of one `call` — a handle you show for the record and `cancel` to kill. References a one-and-done source Channel that fires the Reply on settlement.

```lumen
type AsyncResult is Bead {
  operation:    ref<Operation>,
  cause:        Cause,
  callId:       CallId,
  request:      Request,
  reply?:       Reply,
  replyChannel: ref<Channel>
}
```

| Member | Type | Description |
|---|---|---|
| `operation` | `ref<Operation>` | The operation that was called. |
| `cause` | `Cause` | The cause this call ran under (queryable while pending, before `reply`). |
| `callId` | `CallId` | This call's id (queryable while pending). |
| `request` | `Request` | The original request. |
| `reply?` | `Reply` | The settlement, once it arrives (absent while pending). |
| `replyChannel` | `ref<Channel>` | The one-and-done source Channel that fires the Reply on settlement. |

Note (resolved): as a bead (below) this inherits provenance/createdAt/metadata from the envelope. `cause`/`callId` are kept at top-level (queryable while `reply` is absent), per your "would you query it while pending?" note.

<a id="call"></a>

### `call`

Invoke an Operation. Sync (default) returns the Outcome directly (200 / 201+Location when `creates` / 409 on a declared failure / Problem status on `fault`). `?mode=async` returns 202 + the AsyncResult at Location; settle later. The only primitive with the rich Outcome.

> **Normative.** Dispatch rule — `call` is a primitive and may fault with a `Problem` like any primitive. A PRE-dispatch failure (unresolvable `operation`, malformed `request`, unauthorized, idempotency-key mismatch) faults as a `Problem` with NO `Outcome`: the operation never ran and nothing is recorded. A POST-dispatch failure rides the `Outcome` (`Result.failure` → 409; `fault { problem }` → the Problem's status; `canceled`). So a bare `Problem` means the call could not run; a `Problem` inside `Outcome.fault` means the operation ran and faulted — the recorded `AsyncResult.reply` is the witness that it dispatched.

> **Normative.** Addressing — an INTRINSIC operation (implementation absent, [Operation](#Operation)) is addressed by its well-known element path (e.g. `issue/claim`); `operation: ref<Operation>` resolves to that path, and the client does NOT materialize an Operation bead first. A stored operation (implementation present) is an ordinary resolvable bead.

```lumen
fn call(
    operation: ref<Operation>,
    request:   Request
  ) -> Reply
```

| Parameter | Type | Description |
|---|---|---|
| `operation` | `ref<Operation>` | The operation to invoke (see [Operation](#Operation)). |
| `request` | `Request` | The call input — arguments, idempotency key, and cause (see [Request](#Request)). |

**Returns** `Reply` — What a `call` returns — flat, no context wrapper. `outcome` keeps the domain `Result` nested in `Outcome`.

<a id="cancel"></a>

### `cancel`

Kill -9 on a running AsyncResult — writes `reply.outcome = canceled`. Runs no compensation (that is the scheduler's graceful path); its effects stay findable via `causedBy`.

> **Normative.** `cancel` settles an async result as `canceled` and runs NO compensation; effects already produced stay findable via `causedBy`.

```lumen
command cancel(
    asyncResult: unpinned<AsyncResult>
  ) -> pinned<AsyncResult>
```

| Parameter | Type | Description |
|---|---|---|
| `asyncResult` | `unpinned<AsyncResult>` | The running async handle to stop (see [AsyncResult](#AsyncResult)). |

**Returns** `pinned<AsyncResult>` — The async result of one `call` — a handle you show for the record and `cancel` to kill. References a one-and-done source Channel that fires the Reply on settlement.

## 2.4  Packages

A package is the authority that names a bead's type — a versioned bundle of overlay elements (type / operation / channel defs) and file assets.

<a id="PackageDef"></a>

### `PackageDef`

A package bead body — its declared version and its elements. Its resource is `rep<PackageDef>`.

> **Normative.** A package is a resource; its canonical identity is its own `id` ({ scope:"uri", id:<url>, rev:<pin> }) — exactly what beads stamp as their `authority`. It is NOT restated in the body.

```lumen
type PackageDef is Bead {
  semVer:   SemVer
  elements: { ...: Resource }
}
```

| Member | Type | Description |
|---|---|---|
| `semVer` | `SemVer` | The version this package declares; refs pin to a resolved one via their `rev`. |
| `elements` | `{ ...: Resource }` | Elements keyed by package-relative path; value = any resource — bead defs and file assets. |

# 3. Primitives — the uniform set

Dispatch is implicit: a request routes to the target resource. Beads take client CRUD (create/put/patch/delete/list/revisions); the three model-specific primitives live with their models (§1.2 `get`, §2.2 `pull`/`push`, §2.3 `call`/`cancel`). This section is the uniform write/read surface over any resource, then the export & change-notification cluster.

```
--- the HTTP route table (relative to a scope's base URL) ---
Each primitive's `openapi.pathItem` (resource / scope / channel / operation /
asyncResult) resolves to a concrete route below. The URL space has three parts:
  • an id space — a resource is `/{id}`, where {id} is a free, slash-bearing string;
  • noun roots — `/sys/*` for in-band system RESOURCES (addressed and read with
    `get`, e.g. `/sys/changes`, `/sys/capabilities`) and `/bdp/*` for the protocol's
    own fixed routes & artifacts (`/bdp/openapi` — static artifacts only);
  • the ACTION FENCE `/-/` — a bare `-` segment separates a resource id (left) from a
    protocol action or projection (right). The fence (NOT a `:verb` suffix) is what
    carries actions, because an id is a free string: a `:` has URL-reference scheme
    ambiguity and the fleet's ids already bear colons (timestamp ids). At the scope
    root the left side is empty, so `/-/list`, `/-/create` are scope actions.
    The fence is parsed on the RAW path (pre-decode) as the LAST `/-/`; the right
    side is validated against the closed, fence-free action set (else 404), and an
    id with a literal `-`-only segment is percent-encoded (`%2D`) — a write minting
    an unencoded bare `-` segment is refused — so no `%2D` forges the fence.
So `GET /` is free to be the discovery signpost, and nothing collides with an id.
```

```
  primitive   method  route                      notes
  discovery   GET     /                          → ServiceDescriptor (the signpost; links mirrored in a Link header)
  discovery   GET     /sys/capabilities          live, per-deployment Capabilities (a `get` on a /sys bead)
  discovery   GET     /bdp/openapi               the static OpenAPI contract (RFC 8631 service-desc)
  get         GET     /{id}                      ?include=/?omit=/?expand= (or ?select=) projection; ?revision= time-travel
  list        GET     /-/list                    scope list → Page (moved off the bare root)
  create      POST    /-/create                  body = the rep (body: any); fail-if-exists → identity-taken
  put         PUT     /{id}                      If-Match (OCC) · If-None-Match:* (create-if-absent) · ?precondition= (state guard)
  patch       PATCH   /{id}                      json-patch+json body · If-Match · ?precondition=
  delete      DELETE  /{id}                      If-Match · ?precondition=
  revisions   GET     /{id}/-/revisions          the resource's history → Page
  call        POST    /{opPath}/-/call           +?mode=async → 202 + AsyncResult Location
  cancel      POST    /{asyncResultId}/-/cancel  {asyncResultId} = the async Location
  pull        GET     /{channel}                 a Channel, e.g. /sys/changes (changefeed)
  push        POST    /{channel}                 append jsonl to a sink/duplex Channel
  export      GET     /-/export                  bulk scope serialization → JSONL (scope action)
  import      POST    /-/import                  bulk load ← JSONL → ImportAck (resumable; scope action)
```

```
`push` is NOT the stdlib `batch`: it appends to a Channel. A read whose query string
overruns the URL budget MAY re-send under the fence as a body-form POST (`/-/list`,
`/{id}/-/get`) carrying the `ReadRequest`, and an over-budget write guard MAY spill to
`POST /{id}/-/{put|patch|delete}` carrying an `Envelope` — body-form spill is OPTIONAL
and advertised (a minimal scope rejects over-budget with `request-too-large`). See Appendix D.
```

Discovery, not tiers (§3.3): a scope advertises WHICH primitives it offers, à la carte. The mandatory floor is `get`, the `GET /` ServiceDescriptor, and a readable `/sys/capabilities`; every other primitive is present iff advertised. A request for an un-offered primitive is refused `capability-not-supported`.

Discovery ALSO serves the connected packs' overlay: the TYPE definitions (their property declarations + cli hints — cli.alias / cli.positional / cli.default / cli.edge) and the OPERATION signatures (parameters + each op's declared domain-error set), so a client renders the available typed commands from discovery alone, with no out-of-band pack knowledge.

```
Shape — the capabilities document is { scope, base, repModel, defaultType?,
capabilities (the primitives + call), packs[] }. (No top-level `operations` list —
`packs[].operations` is authoritative; the flat bare-path back-compat list is dropped.)
`defaultType` is the scope's deployment default concrete
type for a bare `create` (a per-scope RUNTIME fact, NOT a pack hint); absent ⇒ a bare
create with no --type faults, listing the creatable types.
Each pack is { name, version?, cli?{ mount }, types[], operations[] }:
  type = { type (kind-path), bead, abstract, extends?, summary?, properties[
           { name, type, required, computed?, cli?{ alias, flag, positional, default } } ],
           (`computed: true` marks a derived read-only property, so a client can omit
            EMPTY computed collections by default without guessing — §5 shaping)
           edgeFlags[ { flag, summary?, op, self, other, args? } ] (type-level cli.edge,
           lowered — one `create` flag that also invokes an edge op; named `edgeFlags`
           to disambiguate from a `dep edges` op; see bdp-cli.md) }
  op   = { path (call-by-path), kind ("command" | "fn"), summary?, parameters[
           { name, type, required, cli?{ … } } ], errors[] (the Result E set), returns }
`cli.alias` is the bare short letter ("s" → the CLI renders -s); `cli.positional` is
a 0-based slot; `cli.default` is a JSON value; `cli.flag` overrides the long flag name
(presentational only — e.g. `estimatedMinutes` renders `--estimate`; the property name
is unchanged). An op `path` splits on "/" into nested
subcommands (`issue/dep/add` → `bdp issue dep add`). The generic CRUD verbs
(create/show/list/update/delete/get) are the UNIVERSAL primitives the CLI knows
intrinsically — it parameterises `create <type>` from the type's properties + cli
hints; the catalog's `operations` are the pack callables, rendered as typed verbs
(not duplicated per-type). An abstract type (e.g. `issue`) is not directly
instantiable: with no explicit `--type`, `create` takes the scope's
advertised `defaultType` (the deployment default; a client `$BDP_DEFAULT_TYPE` may
override), else it lists the subtypes. A pack MUST NOT declare a default type — there
is no `cli.defaultType` catalog hint; the default is a scope/client fact ONLY, and the
feature is discouraged (prefer an explicit `--type`).
```

Command placement — a pack sets `cli.mount` (where its commands attach to the aggregate `bd` tree: "/" = top-level so `bd ready`, a prefix like "issue" → `bd issue …`; default the pack name), and an operation sets `cli.name` (its command name, overriding the path-derived default; may contain spaces to nest, e.g. `issue/dep/add` → "dep add"). So `issue/ready` with `cli.name:"ready"` under a top-level pack renders `bd ready`, while the call-by-path (`bdp call issue/ready`) always works. `cli.mount` is the SINGLE placement choice — "/" renders the pack's commands flat with NO namespaced form, a prefix renders them only under that prefix; a pack does not get both. The call-by-path (`bdp call issue/ready`) is the invariant long form — for scripting, and for disambiguating a `cli.name` collision between two "/"-mounted packs. `--help` is rendered from the catalog (summaries, parameters, defaults, error sets).

```
Static catalog — the pack overlay MAY be checked in and rendered offline. Its
canonical form is the `packs` member VERBATIM: `{ packs: [ … ] }` (well-known
`catalog.json`), byte-identical to `/sys/capabilities`.`packs`, so a client slices
`.packs` off a live doc to produce one and renders typed commands from either
source by the same path. ONLY the pack overlay is static — it is the versioned,
deployment-independent part (type defs + op signatures + cli hints), and each pack
MAY carry its `version` (SemVer) so a checked-in catalog pins exact pack versions
for reproducible build-time codegen. The scope-level fields (scope / base /
repModel / capabilities) are per-deployment RUNTIME facts a live endpoint supplies
and are NOT part of the static catalog: rendering offline, a client assumes the
full primitive floor, and a live `capabilities` later narrows which generic verbs
apply. From this the CLI bootstraps — or build-time codegens typed, statically-
checked commands — when it cannot reach a live endpoint.
```

Error model: a data primitive returns its success value and faults with a Problem. Writes return a pinned ref; reads a rep; `delete` a tombstone Rev. (Ruling §0.8.)

## 3.1  Write & read the resource store — create, put, patch, delete, list, revisions

<a id="IdRoot"></a>

### `IdRoot`

A prefix-rooted auto-id proposal (the server mints the leaf).

```lumen
type IdRoot {
  prefix: string
}
```

| Member | Type | Description |
|---|---|---|
| `prefix` | `string` | The id prefix to mint under; the server appends the leaf segment. |

<a id="Id"></a>

### `Id`

An exact caller-proposed id.

```lumen
type Id {
  id: string
}
```

| Member | Type | Description |
|---|---|---|
| `id` | `string` | The exact id the caller proposes. |

<a id="create"></a>

### `create`

Admit a new Bead at `POST /-/create` (under the action fence; the bare root `GET /` is the ServiceDescriptor). Caller-proposed id optional; fail-if-exists → `identity-taken` (409). Returns the created resource's pinned `ref` (rev = the minted revision); its URL in `Location`. (Create-if-absent at a known id is `put` with `ifAbsent` / `If-None-Match: *`, not `create`.)

> **Normative.** `create` input is closed — an envelope member Core does not define is refused, not ignored (this does not reach inside `body`/`metadata`, which Core does not interpret). An id already in use, used and retired, or — when `aliases` is advertised — held by a live alias ([Alias](#Alias)), is refused with `identity-taken`; an unrequested server-minted id likewise avoids live alias names.

```lumen
command create(
```

<a id="put"></a>

### `put`

Upsert / remember — idempotent full-state write. Create-or-replace; the lifecycle effect (create vs update) is what the changefeed reports. Returns the written pinned `ref` (rev = the new revision).

> **Normative.** `put` replaces resource state wholesale (a full-state write), NOT a merge.

> **Normative.** A full-state write that changes nothing succeeds, keeps the revision, records no provenance, and produces no event; the reply carries no `transaction`.

> **Normative.** WRITE GUARDS ARE PRECONDITIONS, NEVER BODY. A guard rides the request line (a header or the query string), never the payload — so a `put` body stays exactly the resource representation and a `patch` body stays exactly the JSON Patch, unwrapped and correctly typed. Three guards, carried by `put`, `patch` and `delete` (`put` also carries the second): (1) `ifRevision` → `If-Match: "<Rev>"` (the `Rev` as a double-quoted strong entity-tag, RFC 9110 §8.8.3), the optimistic-concurrency / revision guard — a stale value makes no change and faults `revision-mismatch` (412); (2) `ifAbsent` → `If-None-Match: *`, create-if-absent — the write applies only if nothing is there, else faults `identity-taken` (409 — the same status as a `create` collision, so a client has one id-taken handler) (`put` only); (3) `precondition` → `?precondition=<Filter>`, a STATE guard — the write applies only if the current resource satisfies the Filter, else faults `precondition-failed` (412). The state guard is the same flat-AND [Filter](#Filter) grammar `list` uses, projected onto the query string exactly like a read filter. A guard too large for the URL budget MAY spill to an OPTIONAL, advertised `query`-tier body-form (`POST /{id}/-/{put|patch|delete}`, media type `application/vnd.bdp.envelope+json`) carrying an [Envelope](#Envelope) — `{ precondition?, representation }` for put (the FULL representation, never a bare body), `{ precondition?, patch }` for patch, `{ precondition? }` for delete — the one place an envelope appears; the `If-Match`/`If-None-Match` guards keep riding their headers, and a scope that does not advertise spill rejects an over-budget guard with `request-too-large`. See Appendix D. There is no revision-keyed read cursor: streaming reads resume by `after` (Cursor) xor `from` (Ordinal); a specific revision is read by `get` under `?revision=`.

```lumen
idempotent command put(
    resource:    unpinned<any>,
    type:        PathString,
    authority?:  PackageRef,
    body:        any,
    metadata?:   Metadata,
    ifRevision?: Rev,
    ifAbsent?:   bool,
    precondition?: Filter
  ) -> pinned<any>
```

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<any>` | The resource to write (its id; `rev` ignored — `put` targets the current resource). |
| `type` | `PathString` | The bead's type path. |
| `authority?` | `PackageRef` | The package that names `type`. Caller may supply; absent, the server resolves it from `type`. |
| `body` | `any` | The full new body — `put` replaces state wholesale (`any` at core; typed `body: T` at the pack level). On the wire the request payload is the full representation (`type` + `authority?` + this `body` + `metadata?`); the guards below are request metadata, never part of it. |
| `metadata?` | `Metadata` | Optional open sidecar the protocol does not interpret. |
| `ifRevision?` | `Rev` | Revision guard → `If-Match`. Apply only if this matches the current revision. |
| `ifAbsent?` | `bool` | Create-if-absent guard → `If-None-Match: *`. Apply only if no resource exists at the id; else `identity-taken` (409). |
| `precondition?` | `Filter` | State guard → `?precondition=`. Apply only if the current resource satisfies this Filter; else `precondition-failed`. Rides the query string, not the body. |

**Returns** `pinned<any>`

Note: a separate id proposal was folded into the `resource` ref. The guards (ifRevision/ifAbsent/precondition) are request metadata — headers and the query string — so the body is only ever the resource. See the guard rule above.

<a id="patch"></a>

### `patch`

JSON Patch over the resource representation, ROOT-addressed (`/body/…`, `/metadata/…`, `/type`, `/authority`). The immutable envelope (`/id`, `/provenance`, `/createdAt`, `/retired`) and any property declared `computed` or `serviceManaged` are read-only — a patch that touches one faults. Guards ride the request line (`If-Match` for `ifRevision`; `?precondition=` for a state guard), so the body stays exactly the JSON Patch. Returns the patched resource's pinned `ref`. (JSON Patch is the base format; a richer patch format is an advertised capability.)

> **Normative.** A patch whose path names an envelope member (`/id`, `/provenance`, `/createdAt`, `/retired`), the whole-document root (`""`), or a property declared `computed` or `serviceManaged` faults — for ANY JSON Patch operation, and for the `from` pointer of `move`/`copy` — whatever the implementation's patch document contains.

```lumen
command patch(
    resource:    unpinned<any>,
```

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<any>` | The resource to patch (its current revision). |

Resolved: `type` / `authority` are mutated by patching `/type` / `/authority` at root — no distinct arguments. Root-addressing means a layout change never changes this signature.

<a id="delete"></a>

### `delete`

Retire a Resource, minting a final (tombstone) revision. Idempotent. Inbound references are owned by other beads' revisions, so they may dangle; a service that enforces referential integrity faults when inbound references pin it (advertised, not base). Returns the tombstone Rev, not a representation.

> **Normative.** Wire body — a bare `Rev` return (`delete`, and any `-> Rev` callable such as `removeDependency`) lowers to a minimal self-describing object `{ "rev": <Rev> }`, NOT a raw JSON string; the `ETag` header mirrors it.

> **Normative.** Delete is not erasure — a deleted resource's id stays accounted for, and its tombstone revision is kept with the delete's provenance (naming the last live as `previousRevision`). Keeping that tombstone revision is revision-dependent, so it relaxes under `unversioned` ([RevisionModel](#RevisionModel)); the id accounting does not relax with it. Delete touches exactly one resource and does nothing else; it changes no identifier and no kind.

> **Normative.** Whether the retired id may be minted again is the scope's declared id model ([IdModel](#IdModel)), not a property of `delete`: under `permanent` the id is never reused, under `reusable` it may be. These are three separate obligations — id accounting, the tombstone revision, and id permanence — and only the second is revision-dependent.

> **Normative.** `delete` is idempotent on an EXISTING resource, not total. Deleting a resource that is already retired is the idempotent case: it returns the same tombstone `Rev` and does not fault, which is why `delete` alone among the writes declares no `410`. Deleting an id that NEVER existed is a different case and faults `404`, because an absent target is not a resource to retire: there is nothing for `delete` to act on, and the declared `404` has no other producer. Retiring an id is a consequence of retiring a resource, never a way to reserve or deny one — so `delete` MUST NOT mint a tombstone for an id it did not retire. That prohibition stands on the sentence before it and not on any implementation's behaviour; note only as a consequence of violating it that under `permanent` ([IdModel](#IdModel)) a minting `delete` would let any caller able to delete permanently spend any id in the space, since `create` at that id would then fault `identity-taken` for ever.

> **Normative.** `delete`'s idempotency is UNCONDITIONAL; only its `404`'s reachability varies, and it varies with whether the scope can tell the two cases apart. A `permanent` scope retains a record of every retirement (the retired-id accounting, [IdModel](#IdModel)) and MUST fault `404` for an id that never existed. A `reusable` scope retains no such record — and keeps no tombstone revision either, since `reusable` ⇒ `unversioned` ([ScopeCapabilities](#ScopeCapabilities)) — so for it "already retired" and "never existed" are the same state: it answers the idempotent success, and its `404` is simply unreachable, exactly as a write's `410` is unreachable under `reusable`. Idempotency sits on the unconditional side because a fault that no scope can produce costs nothing, while a guarantee that varies by model forces every client to learn a scope's models before it can act. It is NOT justified by retry safety, and must not be read as making a `delete` retry safe.

> **Normative.** A write that TARGETS a retired resource faults `410 Gone`, so `put` and `patch` both declare it alongside `get`. It is distinct from its two neighbours: a never-retired missing id is `404`, and CLAIMING a spent id is `identity-taken` (409). On `put` the 409 is the **`ifAbsent` guard's** fault, never the operation's — every `put` is id-rooted (`PUT /{id}`), so rooting cannot discriminate and the guard is what does: a bare `put` targets the resource, so a retired target is `410`, while a `put` under `If-None-Match: *` asserts the id is free, so a spent id is `409` — the same status as a `create` collision, keeping one id-taken handler for the claiming path. Updating what is gone and claiming an identity that is spent are different faults, and on `put` the guard is what tells them apart. `put` declares no `404` because an absent id is not an error for it: `put` creates. Like `get`'s 410, a write's 410 is reachable only under `permanent`; under `reusable` a retired id is simply absent, so the write sees `404` or creates.

> **Normative.** Delete does not rewrite any other resource, so inbound references may dangle. A reference that pins a revision (`rev` present) still resolves — revisions are immutable, and a deleted resource's history is kept — so only an unpinned inbound reference dangles: resolving it (`get`) returns the current state, now the tombstone, and faults `410 Gone`. Enforcing referential integrity (faulting a delete whose target still has inbound pins) is an advertised capability, not base.

```lumen
idempotent command delete(
    resource:    unpinned<any>,
```

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<any>` | The resource to retire (its current revision). |

Cascade and dry-run are NOT flags on the core primitive — they live in the stdlib facade deleteResource (0.2.3 ruling: `bd delete` has one wire manifestation, and the richer shape goes to stdlib), keeping `delete` minimal and the core wire frozen. 0.2.4 may fold the facade's generic shape back into `delete`.

`delete` returns the bare tombstone `Rev`, not a pinned ref — intentionally breaking the "writes return a pinned ref" symmetry, because a tombstone has no typed representation to return (`retired: true`, `body: null`); the tombstone is reachable by pinning that `Rev`.

> **Open** — the CLIENT side of the recycled-id retry. A `reusable` scope must now > advertise a guard on `delete` ([IdModel](#IdModel)), so the mechanism is always > there; what is not yet stated is whether a client retrying a `delete` under `reusable` > MUST use it. Offering a guard does not oblige anyone to reach for it, and an unguarded > retry stays unsafe: A deletes X, the response is lost, B legitimately takes the freed > id, and A's retry destroys B's resource — reporting success, so A cannot learn it from > the result. `delete`'s idempotency makes the STATUS stable, never the effect. The > obligation would sit beside the reference rule in [IdModel](#IdModel). Note that on a > `reusable` scope the guard is the ONLY such instrument: the parallel safety net for a > reference, a pinned revision, does not exist there, because `reusable` requires > `unversioned` ([ScopeCapabilities](#ScopeCapabilities)). That makes the question sharper, not > softer — there is nothing else for a careful client to reach for.

<a id="list"></a>

### `list`

A collection of current resources in a scope, as a snapshot<Resource> (a FINITE cut). `where` is a Filter (the flat low bar every service supports); the full boolean/traversal `query` is a stdlib capability (query). Snapshot — `--format page` only; `jsonl` and `sse` fault `400` (a windowed resource read, not a bulk stream).

```lumen
fn list(
    scope:   Scope,
```

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` | The scope to list. |

Resolved: yes — put / patch / delete accept a state guard, carried as a `precondition` Filter on the request line (`?precondition=`), NOT in the body; it reuses this flat-AND `Filter` grammar and faults `precondition-failed`. See the guard rule on `put`.

<a id="revisions"></a>

### `revisions`

The history of one resource — id-targeted like `get`, list-shaped like `list`. `select` controls payload (ids-only vs full representations). Snapshot — `--format page` only; `jsonl` and `sse` fault `400`.

```lumen
fn revisions(
    resource: unpinned<any>,
    select?:  selector,
    request?: ReadRequest
  ) -> snapshot<Resource>
```

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<any>` | The resource whose history to read. |
| `select?` | `selector` | Projection per revision — ids-only vs full representations. |
| `request?` | `ReadRequest` | Streaming controls — resume cursor, limit, transport (`page` only). |

**Returns** `snapshot<Resource>` — An untyped representation — `rep<any>`. Used where the body type is unknown or open (a mixed listing, a generic read).

**read-shaping & patch bodies (shared by the reads above)**

<a id="selector"></a>

### `selector`

A read projection over a representation — include/omit subtrees (JSON Pointer) and expand. Query-string, so a projected read has its own cacheable identity; `type`/`id` are never dropped.

> **Normative.** Query-string encoding — the three fields lower to the baseline params `?include=`, `?omit=` (comma-separated JSON Pointers) and `?expand=` (comma-separated names), matching the CLI `--include` / `--omit` / `--expand` flags; a leading `/` on a pointer is optional. `?select=<URL-encoded selector JSON>` is the complete form (the CLI `--select` shorthand), accepted for tooling and for a pointer that contains a literal comma. `type`/`id` are never dropped.

```lumen
type selector {
  include?: [ JsonPointer ],
  omit?:    [ JsonPointer ],
  expand?:  [ LocalName ]
}
```

| Member | Type | Description |
|---|---|---|
| `include?` | `[ JsonPointer ]` | Keep only these subtrees (JSON Pointer); everything else is dropped. |
| `omit?` | `[ JsonPointer ]` | Drop these subtrees; everything else is kept. |
| `expand?` | `[ LocalName ]` | Expand these named references inline instead of leaving them as refs. |

<a id="JsonPointer"></a>

### `JsonPointer`

A JSON Pointer (RFC 6901) into a representation.

```lumen
type JsonPointer is string
```

<a id="JsonPatchOp"></a>

### `JsonPatchOp`

One RFC 6902 operation. In `patch`, paths are root-addressed over the rep (`/body`, `/metadata`, `/type`, `/authority`; the rest is read-only).

```lumen
type JsonPatchOp = {
  op:     "add" | "remove" | "replace" | "move" | "copy" | "test",
  path:   string,
  value?: any,
  from?:  string
}
```

| Member | Type | Description |
|---|---|---|
| `op` | `"add" \| "remove" \| "replace" \| "move" \| "copy" \| "test"` | The RFC 6902 operation to perform. |
| `path` | `string` | The target location, as a JSON Pointer. |
| `value?` | `any` | The value, for `add` / `replace` / `test`. |
| `from?` | `string` | The source location, for `move` / `copy`. |

<a id="JsonPatch"></a>

### `JsonPatch`

An ordered list of JSON Patch operations — the `patch` body, and a change-event patch payload.

```lumen
type JsonPatch = [ JsonPatchOp ]
```

<a id="Envelope"></a>

### `Envelope`

The query-tier body-form envelope — the ONE place a write guard rides a body. Used only when an over-budget `precondition` (or representation) spills to `POST /{id}/-/{put|patch|delete}`; the direct `put`/`patch`/`delete` verbs never carry it. Media type `application/vnd.bdp.envelope+json`.

> **Normative.** Support is OPTIONAL and advertised ([ScopeCapabilities](#ScopeCapabilities) `bodyFormSpill`); a scope that does not offer it rejects an over-budget guard with `request-too-large`. Exactly one payload member by verb — `representation` for `put` (the FULL representation `{ type, authority?, body, metadata? }`, never a bare body), `patch` for `patch` (the raw RFC 6902 array carried as a JSON value governed by THIS envelope's media type, not `application/json-patch+json`), and none for `delete`. `precondition` is the optional state-guard Filter; the `If-Match` / `If-None-Match` guards keep riding their headers even in body-form.

```lumen
type Envelope = {
  precondition?:   Filter,
  representation?: any,
  patch?:          JsonPatch
}
```

| Member | Type | Description |
|---|---|---|
| `precondition?` | `Filter` | The state-guard Filter (the `?precondition=` guard, relocated to the body when over-budget). |
| `representation?` | `any` | For `put` — the full representation to write (`{ type, authority?, body, metadata? }`). |
| `patch?` | `JsonPatch` | For `patch` — the RFC 6902 JSON Patch array, as a JSON value inside this envelope. |

<a id="Filter"></a>

### `Filter`

The low-bar list filter — a flat conjunction (and) of simple field conditions, exactly the query-string-expressible set. The baseline every service supports; the full boolean/traversal predicate is a stdlib capability (`query`, query), not base.

```lumen
type Filter = [ listCondition ]
```

<a id="listCondition"></a>

### `listCondition`

One flat field condition. `isType` matches against the type-path (`type.id`): `prefix` ⊑ (the "is it an issue(-ish)?" test), `exact` =.

> **Normative.** Field paths are root-addressed `FieldPath` ARRAYS (`["body","status"]`, `["metadata","x"]`, `["type"]`) — the array disambiguates a key that itself contains a dot, and the first segment selects the root member (`body`/`metadata`/`type`/`authority`), consistent with root-addressed `patch`/`selector`. NOT a dotted string.

> **Normative.** Wire encoding — every protocol DU is INTERNALLY-TAGGED with a `kind` discriminator = the arm name in kebab-case (the convention of [Outcome](#Outcome), [ChangeEvent](#ChangeEvent)), NEVER externally-tagged (`{"compare":{…}}`). A condition is `{"kind":"compare","field":["body","status"],"op":"eq","value":…}`; a flat `Filter` is a JSON array of them. list and the stdlib `query` share this one encoding. On the query string the baseline floor every scope accepts is the URL-encoded JSON of this `Filter` array — for both `?where=` (list) and `?precondition=` (the write state guard). For `?where=` ONLY, a scope MAY ALSO advertise ([ListCaps](#ListCaps) `compactFilter`) a compact `field op value` dialect (comma-separated conditions, `/`-separated field paths) for the common `compare`/`has`/`missing` subset — a human-typable convenience, never required, with the gnarly arms (`matches`, `contains*`, array-valued `in`) staying JSON or going to the stdlib `query`. `?precondition=` is JSON-only — it is machine-generated, never the compact dialect.

> **Normative.** v0 `compare` is LEXICAL (string) comparison — a numeric `lt`/`le`/`gt`/`ge` on a value like `priority` orders as text (`"10" < "2"`). Typed comparison by the field's declared type (now that `integer` and `number` are distinguished) is a follow-up, to land consistently across `list` and `query`.

```lumen
type listCondition = union {
  compare     { field: FieldPath, op: "eq"|"ne"|"lt"|"le"|"gt"|"ge"|"in", value: any }
  matches     { field: FieldPath, pattern: string, using: "substring"|"glob"|"regex" }
  has         { field: FieldPath }
  missing     { field: FieldPath }
  contains    { field: FieldPath, value: any }
  containsAny { field: FieldPath, values: [ any ] }
  excludes    { field: FieldPath, value: any }
  isType      { type: RelativeId, match: "exact" | "prefix" = "prefix" }
}
```

| Variant | Payload | Description |
|---|---|---|
| `compare` | `{ field: FieldPath, op: "eq"\|"ne"\|"lt"\|"le"\|"gt"\|"ge"\|"in", value: any }` | Compare a field to a value with a scalar operator (or set membership, `in`). |
| `matches` | `{ field: FieldPath, pattern: string, using: "substring"\|"glob"\|"regex" }` | Match a field's text against a pattern (substring, glob, or regex). |
| `has` | `{ field: FieldPath }` | The field is present. |
| `missing` | `{ field: FieldPath }` | The field is absent. |
| `contains` | `{ field: FieldPath, value: any }` | A list field contains the value. |
| `containsAny` | `{ field: FieldPath, values: [ any ] }` | A list field contains any of the values. |
| `excludes` | `{ field: FieldPath, value: any }` | A list field does not contain the value. |
| `isType` | `{ type: RelativeId, match: "exact" \| "prefix" = "prefix" }` | Match the type-path (`type.id`) by prefix (the "is it an issue?" test) or exact. |

<a id="FieldPath"></a>

### `FieldPath`

A field path as a segment array (disambiguates dotted keys); selector/patch keep JSON Pointer.

```lumen
type FieldPath = [ string ]
```

<a id="RelativeId"></a>

### `RelativeId`

A type-path as a local id segment, relative to the scope (the target for isType's prefix/exact match).

```lumen
type RelativeId is string
```

## 3.2  Export & change notification — the changefeed, then export/import

The live and bulk faces of the same thing: the changefeed streams every commit as a ChangeEvent; export serializes the same representations as a backup. Both carry a cut Cursor so a consumer resumes the feed from where a backup ends.

--- the changefeed: /sys/changes + ChangeEvent --- Each Scope has one built-in changefeed Channel (source; pullSchema = ChangeEvent) at the well-known id `/sys/changes`. Its events are what create/put/patch/delete commit; read it with `pull`.

<a id="ChangeEvent"></a>

### `ChangeEvent`

Core's report of one committed change to one Resource — Created / Updated / Deleted — or an operation-frame boundary (CallEnter / CallLeave) for an unsafe call. A top-level DU on lifecycle (a relationship change is an Updated to the relationship resource). `subject.rev` is the new (or tombstone) revision. Provenance rides in the post-image where there is one and is explicit where there is not.

> **Normative.** One commit produces exactly one event per resource changed, however many times the request touched it; a failed request and a no-change request produce no resource event. An event is durable with its change — never committed without its event, never published for a change that did not commit. A change that arrives by replication MUST still appear on the changefeed. The full (post-image) encoding is required of every service; the patch encoding is optional (a reader that meets a patch it cannot apply re-reads the resource).

> **Normative.** CallEnter / CallLeave bound an operation's frame on the feed — the open carries the operation, the close its outcome. They are emitted for an UNSAFE or unspecified operation only (the `safe` marker on [Operation](#Operation) is the gate); a safe operation makes no change and leaves no frame — its boundaries are read from the Request/Reply pair, which already carries the same callId / cause / transaction and the outcome. So an unsafe operation that changes nothing is still visible — its enter and leave bracket no resource events — while a read leaves the feed untouched.

```lumen
type ChangeEvent = union {
  Created
  Updated
  Deleted
  CallEnter
  CallLeave
}
```

| Variant | Payload | Description |
|---|---|---|
| `Created` | — | A resource admitted. Full post-image; its provenance is the representation's provenance. |
| `Updated` | — | A resource changed. `content` is the orthogonal encoding axis — `full` carries a post-image (provenance rides in it), `patch` is a delta with explicit provenance. |
| `Deleted` | — | A resource retired — the tombstone. No post-image, so provenance is explicit; `subject.rev` is the tombstone revision. |
| `CallEnter` | — | An operation frame opened — the open boundary of an unsafe call on the changefeed. Carries the operation; its callId / cause / transaction ride the envelope. |
| `CallLeave` | — | An operation frame closed — the close boundary of an unsafe call. Carries the outcome (success / failure / fault / canceled, with the value); its callId / cause / transaction ride the envelope. |

<a id="ChangeEnvelope"></a>

### `ChangeEnvelope`

Fields common to EVERY arm — position, time, and the correlation tokens. No subject: a resource arm adds that via [ResourceChange](#ResourceChange); a frame arm (CallEnter / CallLeave) has none.

```lumen
type ChangeEnvelope = {
  ordinal:      Ordinal,
  at:           Timestamp,
  transaction:  Transaction,
  cause?:       Cause,
  causedBy?:    Cause,
  callId?:      CallId,
  calledBy?:    CallId
}
```

| Member | Type | Description |
|---|---|---|
| `ordinal` | `Ordinal` | Position in the changefeed, assigned on append. |
| `at` | `Timestamp` | When the event committed. |
| `transaction` | `Transaction` | The commit this event belongs to — and, for a read's frame, the OCC snapshot the operation saw. Always present. |
| `cause?` | `Cause` | The cause this event ran under. |
| `causedBy?` | `Cause` | The parent cause — the cause-tree back-pointer. |
| `callId?` | `CallId` | The call this event belongs to — its CallId (its own, for a frame arm) (diagnostic-tier). |
| `calledBy?` | `CallId` | The parent call — the call-tree back-pointer (diagnostic-tier). |

<a id="ResourceChange"></a>

### `ResourceChange`

What the resource arms (Created / Updated / Deleted) add to [ChangeEnvelope](#ChangeEnvelope) — the subject and its denormalized type. A frame arm carries none of these.

```lumen
type ResourceChange = {
  ...ChangeEnvelope,
  subject:           ResourceId,
  subjectType?:      PathString,
  subjectAuthority?: Authority
}
```

| Member | Type | Description |
|---|---|---|
| `subject` | `ResourceId` | The changed resource — { scope, id, rev }; `rev` is the new (or tombstone) revision. |
| `subjectType?` | `PathString` | The subject's type path (= its kind, `type.id`), denormalized for filtering. |
| `subjectAuthority?` | `Authority` | Who names the subject's type — the package or registry, denormalized. Absent ⇒ ad-hoc. |

<a id="Created"></a>

### `Created`

A resource admitted. Full post-image; its provenance is the representation's provenance.

```lumen
type Created = {
  ...ResourceChange,
  representation: Resource
}
```

| Member | Type | Description |
|---|---|---|
| `representation` | `Resource` | The full post-image of the new resource; its provenance is the change's provenance. |

<a id="Updated"></a>

### `Updated`

A resource changed. `content` is the orthogonal encoding axis — `full` carries a post-image (provenance rides in it), `patch` is a delta with explicit provenance.

```lumen
type Updated = {
  ...ResourceChange,
  content: ChangeContent
}
```

| Member | Type | Description |
|---|---|---|
| `content` | `ChangeContent` | The change payload — a full post-image or a patch delta (see [ChangeContent](#ChangeContent)). |

<a id="Deleted"></a>

### `Deleted`

A resource retired — the tombstone. No post-image, so provenance is explicit; `subject.rev` is the tombstone revision.

```lumen
type Deleted = {
  ...ResourceChange,
  provenance: Provenance
}
```

| Member | Type | Description |
|---|---|---|
| `provenance` | `Provenance` | Explicit provenance for the retirement — there is no post-image to carry it. |

<a id="CallEnter"></a>

### `CallEnter`

An operation frame opened — the open boundary of an unsafe call on the changefeed. Carries the operation; its callId / cause / transaction ride the envelope.

```lumen
type CallEnter = {
  ...ChangeEnvelope,
  operation: ref<Operation>
}
```

| Member | Type | Description |
|---|---|---|
| `operation` | `ref<Operation>` | The operation whose frame opened. |

<a id="CallLeave"></a>

### `CallLeave`

An operation frame closed — the close boundary of an unsafe call. Carries the outcome (success / failure / fault / canceled, with the value); its callId / cause / transaction ride the envelope.

```lumen
type CallLeave = {
  ...ChangeEnvelope,
  outcome: Outcome<any, any>
}
```

| Member | Type | Description |
|---|---|---|
| `outcome` | `Outcome<any, any>` | How the call settled — the domain Result or a non-domain fate, with its value. |

<a id="ChangeContent"></a>

### `ChangeContent`

The change payload for Updated — full-vs-patch, the encoding axis (orthogonal to lifecycle).

```lumen
type ChangeContent = union {
  full  { representation: Resource }
  patch { patch: JsonPatch, provenance: Provenance }
}
```

| Variant | Payload | Description |
|---|---|---|
| `full` | `{ representation: Resource }` | a post-image; provenance rides in it |
| `patch` | `{ patch: JsonPatch, provenance: Provenance }` | a PATCH delta; no post-image → provenance explicit |

--- the export format (JSON Lines: begin, representations, end) --- A begin record, one Resource record per line (literally the result of `get` — a full representation, or every revision under `--revisions`), then an end record. A reader refuses a file that ends without the end record.

<a id="ExportRecord"></a>

### `ExportRecord`

One line of an export. The export is a strict in-order serialization, so a record's POSITION in the stream is its ordinal — the resume key a resumable `import` acks against ([import](#import)). No ordinal field is added to the record: its position carries it, anchored on import by the request's `fromOrdinal` when the stream is chunked across requests. `ExportBegin` carries the changefeed cut the export was taken at.

```lumen
type ExportRecord = ExportBegin | Resource | ExportEnd
```

| Alternative | Description |
|---|---|
| `ExportBegin` | The opening line — the Scope and the cursor the export was cut at (where a consumer resumes the changefeed). Told apart from a Resource line by `kind`. |
| `Resource` | An untyped representation — `rep<any>`. Used where the body type is unknown or open (a mixed listing, a generic read). |
| `ExportEnd` | The closing line — a count of the Resource records, so a truncated file (one ending without this line) is detectable and never taken for whole. |

<a id="ExportBegin"></a>

### `ExportBegin`

The opening line — the Scope and the cursor the export was cut at (where a consumer resumes the changefeed). Told apart from a Resource line by `kind`.

> **Normative.** `partial: true` marks an export that is NOT a faithful backup — a current-state projection (the op's `where`/`select` applied), whose bodies may be narrowed and whose resource set may be filtered. A true backup omits `partial`: the default current-state export with no `where`/`select`, and every `--revisions` export. A consumer reads `partial` from this opening line before applying any record; [import](#import) REFUSES a `partial` stream as a source (`400`), since a projected export cannot faithfully seed or restore a scope.

```lumen
type ExportBegin = {
  kind:   "export-begin",
  scope:  AbsoluteHttpUrl,
  cursor: Cursor,
  partial?: bool
}
```

| Member | Type | Description |
|---|---|---|
| `kind` | `"export-begin"` | The discriminator that tells a begin line from a resource line. |
| `scope` | `AbsoluteHttpUrl` | The scope this export covers. |
| `cursor` | `Cursor` | The cut the export was taken at — where a consumer resumes the changefeed. |
| `partial?` | `bool` | Present and `true` only when this export is a projection, not a faithful backup (the op's `where`/`select` was applied to a current-state read). Omitted ⇒ complete and unprojected, so an unlabelled stream is byte-identical to one taken without the field. |

<a id="ExportEnd"></a>

### `ExportEnd`

The closing line — a count of the Resource records, so a truncated file (one ending without this line) is detectable and never taken for whole.

> **Normative.** The completed read is the truncation conformance point: a whole export — a one-shot reader's entire file, or a resumable import AT the call that consumes `ExportEnd` (the ack bearing `complete`) — MUST end with an `ExportEnd`, and a reader that takes a whole export lacking it refuses it (`400`). An intermediate resume chunk is a PREFIX by design: it is acked (`acceptedThrough`, not `complete`) and re-offered from, never refused for want of a terminator.

> **Normative.** A reader refuses (`400`) an `ExportEnd` whose `count` disagrees with the Resource records it closes over — this is what tells a whole file from two exports concatenated (each ending in its own `ExportEnd`), which the implicit record-ordinal (stream position) cannot distinguish.

```lumen
type ExportEnd = {
  kind:  "export-end",
  count: integer
}
```

| Member | Type | Description |
|---|---|---|
| `kind` | `"export-end"` | The discriminator that marks the closing line. |
| `count` | `integer` | The number of resource records — lets a reader detect a truncated file. |

<a id="export"></a>

### `export`

Bulk read of a scope — a `jsonl` BACKUP STREAM (`ExportBegin`, one resource line each, `ExportEnd`); `export` is the one read that is not windowed, so `format` other than `jsonl` faults `400`. Current state by default, `--revisions` emits every revision in order (a true backup: createdAt, every committedAt, the previousRevision chain survive). Selection ⊆ Filter. Reads from the authoritative revision store, so it is a backup even when the live changefeed is compacted. Consistent as of a cut Cursor.

> **Normative.** `export` honors only `after`, `limit` and `format` of `request` ([ReadRequest](#ReadRequest)); `request.filter`, `request.select` and `request.from` are rejected `400` — filtering and projection are the op's own `where`/`select`, and a snapshot resumes by cut `Cursor`, not a fresh ordinal. The success media type is `application/jsonl` — `export` is jsonl-native, self-framed by `ExportBegin`/`ExportEnd`; `format` other than `jsonl` (including `page`) faults `400`, since a backup is a stream, not a windowed `Page`.

> **Normative.** `where`/`select` are the op's projection and are legal ONLY on a current-state export. A `--revisions` (history) export REFUSES either (`400`): a true backup is neither filtered nor projected, so every revision and the `previousRevision` chain survive intact. A current-state export that carries `where`/`select` IS a projection, not a faithful backup, so its `ExportBegin` sets `partial: true` ([ExportBegin](#ExportBegin)); an unprojected current-state export, and every `--revisions` export, omits `partial`.

> **Normative.** `select` is honored iff the scope advertises it ([ExportCaps](#ExportCaps) `selector`), exactly as `get`/`list`/`pull` advertise their own selector per-op — selector support MAY differ across reads. A scope advertising `selector: false` faults a `select` request `400` (`invalid-parameter`): the capability is advertised, so a client reads it and omits `select` rather than being refused.

```lumen
fn export(
    scope:      Scope,
    where?:     Filter,
    select?:    selector,
    revisions?: bool,
    request?:   ReadRequest
  ) -> snapshot<ExportRecord>
```

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` | The scope to back up. |
| `where?` | `Filter` | Restrict the export to matching resources — current-state only; refused `400` on a `--revisions` export, and setting it marks the result `partial` (see [Filter](#Filter), [ExportBegin](#ExportBegin)). |
| `select?` | `selector` | Project each exported resource — current-state only; refused `400` on a `--revisions` export, and setting it marks the result `partial` ([ExportBegin](#ExportBegin)). Honored iff the scope advertises [ExportCaps](#ExportCaps) `selector`; a scope advertising `selector: false` faults `400`. |
| `revisions?` | `bool` | Emit every revision in order (a true backup) instead of current state. A `--revisions` export refuses `where`/`select` (`400`) and never sets `partial`. |
| `request?` | `ReadRequest` | Streaming controls — resume cursor, limit, and the transport (`jsonl` only — `export` is a bulk backup stream, not a windowed read). See [ReadRequest](#ReadRequest). |

**Returns** `snapshot<ExportRecord>` — One line of an export. The export is a strict in-order serialization, so a record's POSITION in the stream is its ordinal — the resume key a resumable `import` acks against ([import](#import)). No ordinal field is added to the record: its position carries it, anchored on import by the request's `fromOrdinal` when the stream is chunked across requests. `ExportBegin` carries the changefeed cut the export was taken at.

<a id="ImportStrategy"></a>

### `ImportStrategy`

How `import` merges — strategy and id remap.

```lumen
type ImportStrategy = {
  dedup?:      bool,
  allowStale?: bool,
  dryRun?:     bool,
  idRoot?:     string
}
```

| Member | Type | Description |
|---|---|---|
| `dedup?` | `bool` | Skip a record already present instead of faulting (idempotent re-import). |
| `allowStale?` | `bool` | Admit a record whose revision is behind the store's current one. |
| `dryRun?` | `bool` | Validate and report, but write nothing. |
| `idRoot?` | `string` | Remap incoming ids under this id-root prefix. |

<a id="ImportConflict"></a>

### `ImportConflict`

One rejected import record. Keyed on its stream `ordinal` (always present, always unique); `id` and `revision` are optional context, absent when the record was malformed before its id could be read.

> **Normative.** A conflict is keyed on the stream `ordinal`, never on `id`. An id-keyed list cannot represent two distinct records that fail at one id, nor a record malformed before its id is parsed (which has no id to key on); the stream ordinal is the only total, always-present key, so `id`/`revision` ride as optional context when known. This is a property of what the list must represent, independent of any implementation.

```lumen
type ImportConflict = {
  ordinal:   Ordinal,
  id?:       ref<any>,
  revision?: Rev,
  reason:    string
}
```

| Member | Type | Description |
|---|---|---|
| `ordinal` | `Ordinal` | The stream ordinal of the rejected record — its position in the export. |
| `id?` | `ref<any>` | The resource id, when the record parsed far enough to carry one. |
| `revision?` | `Rev` | The record's revision, when known — context for a revision conflict. |
| `reason` | `string` | Why the record was rejected. |

<a id="ImportReport"></a>

### `ImportReport`

The import tally — counts and any conflicted records. It is the `tallies` of the final [ImportAck](#ImportAck) (the call that consumes `ExportEnd`); the old terminal whole-batch report folds here. Also returned directly by pack ops that summarize a bulk load.

```lumen
type ImportReport = {
  imported:  integer,
  skipped:   integer,
  conflicts: [ ImportConflict ]
}
```

| Member | Type | Description |
|---|---|---|
| `imported` | `integer` | How many records were written. |
| `skipped` | `integer` | How many records were skipped as already present (content `dedup`). |
| `conflicts` | `[ ImportConflict ]` | Rejected records ([ImportConflict](#ImportConflict)) — each keyed by stream ordinal, with id/revision as context. |

<a id="ImportResult"></a>

### `ImportResult`

The fate of one offered export record, in stream order — mirrors [PushResult](#PushResult) with an added hard-reject arm. The record is identified by its stream ordinal (its position in the export).

```lumen
type ImportResult = union {
  Accepted   { ordinal: Ordinal }
  Deduped    { ordinal: Ordinal }
  Deferred
  Conflicted { ordinal: Ordinal, id?: ref<any>, revision?: Rev, reason: string }
}
```

| Variant | Payload | Description |
|---|---|---|
| `Accepted` | `{ ordinal: Ordinal }` | Applied (written) at this ordinal. |
| `Deduped` | `{ ordinal: Ordinal }` | A benign no-op — EITHER an idempotent resume re-offer (ordinal ≤ `acceptedThrough`), OR a content `dedup` skip (the resource is already present). Two distinct mechanisms, one fate (see the import normative notes). |
| `Deferred` | — | Not processed on this call (backpressure); re-offer the tail from `acceptedThrough + 1` after `retryAfter`. |
| `Conflicted` | `{ ordinal: Ordinal, id?: ref<any>, revision?: Rev, reason: string }` | Hard per-record reject — the record was PROCESSED (it counts toward `acceptedThrough`) but not applied; resume never re-offers it. Carries the [ImportConflict](#ImportConflict) shape (same `ordinal` key, same optional id/revision context), so the per-record fate and the folded [ImportReport](#ImportReport) tally never disagree on what a conflict is. |

<a id="ImportAck"></a>

### `ImportAck`

What [import](#import) returns — the push-style acknowledgement for a resumable, backpressured bulk load, mirroring [PushAck](#PushAck). `acceptedThrough` is the high-water record ordinal PROCESSED by this call; the importer re-offers the deferred tail from `acceptedThrough + 1`. The call that consumes `ExportEnd` sets `complete: true` and carries the final `tallies`; a one-shot (non-resumable) import returns a single ack already `complete`.

```lumen
type ImportAck = {
  acceptedThrough: Ordinal,
  credit:          integer,
  retryAfter?:     integer,
  results:         [ImportResult],
  complete?:       bool,
  tallies:         ImportReport
}
```

| Member | Type | Description |
|---|---|---|
| `acceptedThrough` | `Ordinal` | The high-water record ordinal PROCESSED (applied-or-rejected) by this call; the importer re-offers from `acceptedThrough + 1`. |
| `credit` | `integer` | How many more records the scope will accept right now (admission credit); `0` means hold and retry. |
| `retryAfter?` | `integer` | How long to wait before re-offering the deferred tail (seconds; maps to HTTP `Retry-After`). |
| `results` | `[ImportResult]` | Per offered record, in stream order — applied, deduped, deferred, or conflicted. |
| `complete?` | `bool` | Present and `true` on the call that consumed `ExportEnd` — the import is whole. |
| `tallies` | `ImportReport` | The folded tally ([ImportReport](#ImportReport)) — authoritative on the final (`complete`) ack. |

<a id="ImportId"></a>

### `ImportId`

A caller-minted token identifying one resumable import across its requests. Opaque to the scope; its only job is to correlate a resumed batch with the `acceptedThrough` the scope is tracking, and to keep concurrent imports into one scope from crossing.

```lumen
type ImportId is string
```

<a id="import"></a>

### `import`

The bulk write path — put/create under If-Match with id remap; a history file is replayed in commit order to rebuild the chain (history-restore), else it sets current state. Not a filter op. Push-style and resumable: the importer sends the records, the scope accepts a prefix and defers the rest under backpressure, acks `acceptedThrough`, and the importer re-offers the deferred tail from `acceptedThrough + 1`. Resume is an advertised capability ([ImportCaps](#ImportCaps) `window`); a minimal scope keeps one-shot import (one ack, already `complete`).

> **Normative.** `import` is a bulk WRITE (put/create), not a filter/read; a history file is replayed in commit order (history-restore), otherwise it sets current state.

> **Normative.** `import` REFUSES (`400`) a stream whose opening `ExportBegin` carries `partial: true` ([ExportBegin](#ExportBegin)) — a projected or filtered export is not a faithful source and cannot seed or restore a scope. The refusal is read off the first record, before any resource is applied.

> **Normative.** Import is RESUMABLE over ABSOLUTE record ordinals. A record's ordinal is `fromOrdinal + its index` in the delivered `records` array (`fromOrdinal` omitted ⇒ `1`), so the stream position survives chunking across requests even though each array restarts at index 0; `importId` names the session the scope keys `acceptedThrough` on, and a one-shot import omits both. `import` is non-blocking: the scope processes a prefix up to its current admission `credit` (advertised as `window`), marks the remainder `Deferred`, and returns `acceptedThrough` (the high-water ordinal PROCESSED) with `credit` and an optional `retryAfter`. The importer holds the deferred tail and re-offers from `acceptedThrough + 1` (`fromOrdinal = acceptedThrough + 1`); a record whose absolute ordinal is `≤ acceptedThrough` is a benign no-op reported `Deduped`, never a fault. This resume-idempotency is the model's own, not the caller's strategy.

> **Normative.** `acceptedThrough` is the last PROCESSED record — applied OR rejected — NOT the last success. A `Conflicted` record counts toward `acceptedThrough`, so resume SKIPS it and never re-offers it; a dropped-and-resumed import converges to the same per-record fates as one uninterrupted call.

> **Normative.** TWO idempotencies ride import and MUST NOT be conflated. Resume-idempotency is protocol-level: a re-offered ordinal ≤ `acceptedThrough` is a no-op, independent of content. Content `dedup` ([ImportStrategy](#ImportStrategy)) is a merge strategy: a record whose resource is already present is skipped. Both surface as `Deduped`, but the first is keyed on the stream ordinal and the second on resource presence — they coincide only by accident.

> **Normative.** Backpressure — an `ImportAck` carrying `credit: 0` and a deferred tail — is soft and temporal, not an error, exactly as [push](#push). It is distinct from `limit-exceeded` (422), the hard rejection of a request that exceeds a static capability bound, fixed by shrinking the request. `dryRun` ([ImportStrategy](#ImportStrategy)) is inherently one-shot — nothing durable is written, so nothing can be resumed — and returns a single `complete` ack.

> **Normative.** `import` is CALLER-DRIVEN exactly as [push](#push) is pusher-driven — the caller DELIVERS the records in the request body; the scope reads nothing from a caller-supplied source and issues no call back to the caller. Backpressure rides the `ImportAck` (`credit`/`acceptedThrough`), and the caller re-offers the deferred tail as the next request: there is no service-initiated pull, and no stream, cursor or channel reference is handed to the scope to drain.

> **Normative.** Across a chunked (resumed) import, `ExportBegin` appears only in the FIRST batch (`fromOrdinal = 1`) and `ExportEnd` only in the final batch (the one that earns `complete`); intermediate batches carry neither. A TOMBSTONE record (`retired: true`, `body: null`, [rep](#rep)) is applied by MINTING the tombstone revision in commit order — history-restore replays a `delete` at that point, not a `create`/`put` of a null body — and a current-state import of a tombstone leaves the id retired.

```lumen
command import(
    scope:        Scope,
    records:      [ExportRecord],
    strategy?:    ImportStrategy,
    importId?:    ImportId,
    fromOrdinal?: Ordinal
  ) -> ImportAck
```

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` | The scope to import into. |
| `records` | `[ExportRecord]` | The export records to apply — `ExportBegin`, the `Resource`s, `ExportEnd` (see [ExportRecord](#ExportRecord)) — in stream order. The caller SENDS this batch in the request, as [push](#push) sends its `events`; a resumed call re-offers the deferred tail from `acceptedThrough + 1`. |
| `strategy?` | `ImportStrategy` | How to merge, and whether to remap ids (see [ImportStrategy](#ImportStrategy)). |
| `importId?` | `ImportId` | The resumable-import session this batch belongs to — minted by the caller, constant across every request of one import. Omit for a one-shot (single-request) import. The scope keys `acceptedThrough` on it, so concurrent imports and re-offers never cross. |
| `fromOrdinal?` | `Ordinal` | The absolute stream ordinal of `records[0]`; `records[i]` is ordinal `fromOrdinal + i`. Omit ⇒ `1` (a fresh import). A resumed batch sets it to `acceptedThrough + 1`; a value `≤ acceptedThrough` re-offers already-processed records (reported `Deduped`). |

**Returns** `ImportAck` — What [import](#import) returns — the push-style acknowledgement for a resumable, backpressured bulk load, mirroring [PushAck](#PushAck). `acceptedThrough` is the high-water record ordinal PROCESSED by this call; the importer re-offers the deferred tail from `acceptedThrough + 1`. The call that consumes `ExportEnd` sets `complete: true` and carries the final `tallies`; a one-shot (non-resumable) import returns a single ack already `complete`.

## 3.3  Discovery & capabilities — the primitive set, advertised à la carte

```
  Each primitive is defined once, at its anchor; this is the index, plus the
  discovery contract that lets a caller NEVER GUESS what a scope offers.
```

| primitive | target | defined in |
|---|---|---|
| get | resource | §1.2 |
| list | scope | §3.1 |
| pull | channel | §2.2 |
| create | scope | §3.1 |
| put | resource | §3.1 |
| patch | resource | §3.1 |
| delete | resource | §3.1 |
| revisions | resource | §3.1 |
| call | operation | §2.3 |
| cancel | asyncResult | §2.3 |
| push | channel | §2.2 |
| export | scope | §3.2 |
| import | scope | §3.2 |

```
  NO TIERS. A scope advertises WHICH primitives it offers, à la carte, through a
  well-known discovery resource. `get` and discovery are the mandatory floor;
  every other primitive is present iff advertised. A request for an un-offered
  primitive is refused `capability-not-supported`; an optional feature is never
  half-present. Call / cancel (operations) and the stdlib packs (apply = batch,
  eval = query) advertise under their own packages, not core.
```

```
  Well-known resources (addressed by convention):
    /sys/changes       — the scope's changefeed Channel (source; pullSchema = ChangeEvent)
    /sys/capabilities  — the scope's discovery resource: `get` it for the scope's
                         `Capabilities` (below). With `get` and the `GET /`
                         ServiceDescriptor, it is the floor.
```

<a id="ServiceDescriptor"></a>

### `ServiceDescriptor`

The bounded discovery signpost returned by `GET /` (a scope's base URL) — a THIN envelope that names the protocol and LINKS to the rest, never embedding it. With `get` and `/sys/capabilities`, it is the mandatory floor.

> **Normative.** `GET /` returns a ServiceDescriptor, not the scope's resource collection — the scope list moved to `/-/list`. The fixed well-known paths ARE the floor and ARE load-bearing: a client MAY hardcode `GET /`, `GET /sys/capabilities` and `GET /bdp/openapi`. The `links` (and their `Link`-header mirror, RFC 8288) are an OPTIONAL relation-following convenience over those paths — the body is authoritative; the `Link` header is a hint and MAY relocate the `base`.

```lumen
type ServiceDescriptor = {
  version:   SemVer,
  revision?: Rev,
  scope?: BdpScope,
  base?:  AbsoluteHttpUrl,
  links:  ServiceLinks
}
```

| Member | Type | Description |
|---|---|---|
| `version` | `SemVer` | The BDP protocol version this scope speaks — a full SemVer (e.g. `"0.2.3"`); negotiation reads `major.minor.patch`. |
| `revision?` | `Rev` | The exact spec commit/tag this scope was built against — finer-grained provenance, diagnostic only, never used for compatibility. |
| `scope?` | `BdpScope` | The scope's identity, echoed for confirmation. Absent on a base URL that fronts no single scope. |
| `base?` | `AbsoluteHttpUrl` | The scope's base URL, echoed so a client can confirm the origin it reached. |
| `links` | `ServiceLinks` | Typed links to the rest of the service. See [ServiceLinks](#ServiceLinks). |

<a id="ServiceLinks"></a>

### `ServiceLinks`

The discovery link set — RFC 8631 web-service link relations to the service's other resources. A relation's absence means the service does not offer it. Mirrored in the `Link` header.

> **Normative.** Relations — `service-desc` → `/bdp/openapi` (the static OpenAPI contract) and `service-meta` → `/sys/capabilities` (live, per-deployment capabilities) are the RFC 8631 registered relations (the OpenAPI location is advertised the traditional way, `Link: </bdp/openapi>; rel="service-desc"`); `service-doc` → human documentation. The changefeed is NOT an IANA relation, so it uses the BDP extension relation URI `tag:bdp.dev,2026:rel/changes` → `/sys/changes` (a bare `changes` token is never emitted in the `Link` header). The split is deliberate: `/bdp/openapi` is the STATIC contract, `/sys/capabilities` is LIVE per-deployment state.

```lumen
type ServiceLinks = {
  serviceDesc?: AbsoluteHttpUrl,
  serviceMeta?: AbsoluteHttpUrl,
  serviceDoc?:  AbsoluteHttpUrl,
  changes?:     AbsoluteHttpUrl
}
```

| Member | Type | Description |
|---|---|---|
| `serviceDesc?` | `AbsoluteHttpUrl` | RFC 8631 `service-desc` — the machine contract (the OpenAPI document, `/bdp/openapi`). |
| `serviceMeta?` | `AbsoluteHttpUrl` | RFC 8631 `service-meta` — the scope's live `Capabilities` (`/sys/capabilities`). |
| `serviceDoc?` | `AbsoluteHttpUrl` | RFC 8631 `service-doc` — human-readable documentation. |
| `changes?` | `AbsoluteHttpUrl` | `changes` (BDP extension relation `tag:bdp.dev,2026:rel/changes`) — the scope's changefeed Channel (`/sys/changes`). |

<a id="Capabilities"></a>

### `Capabilities`

What a scope advertises through discovery — read it by `get` on the well-known `/sys/capabilities` resource. Its primitive capabilities are partitioned by package (`core` is the base; other packages advertise their own), à la carte: a primitive is supported iff its capability is present. Scope-wide traits that are not per-primitive live in `scope`.

> **Normative.** Every scope offers `get` and a readable `/sys/capabilities`. A caller reads it once and relies on it: a primitive is supported iff its capability is present; a request that needs an un-offered primitive is refused `capability-not-supported` (the enforce side of this advertisement), and an optional feature is never half-present.

```lumen
type Capabilities = {
  core:   CoreCapabilities,
  scope:  ScopeCapabilities,
  packs?: { ...: any }
}
```

| Member | Type | Description |
|---|---|---|
| `core` | `CoreCapabilities` | The base (`core`) package's advertised primitive capabilities — what every BDP caller can use by name. |
| `scope` | `ScopeCapabilities` | Scope-wide traits that are neither per-primitive nor pack-specific — storage classes and the revision model. |
| `packs?` | `{ ...: any }` | Other packages' advertised capabilities, keyed by package path (the query / batch / domain packs). The package system fills these in; `core` is the base. |

<a id="CoreCapabilities"></a>

### `CoreCapabilities`

The `core` package's advertised primitives, à la carte — a primitive is supported iff its field is present, and its value carries that primitive's limits. `get` is always present (the floor). Each NUMERIC limit record advertises a dual with `limit-exceeded` (422), enforced by the shrink test (§D.8); a BOOLEAN capability advertised `false` is not such a dual — requesting the option it governs declines `400` (`invalid-parameter`), not `422`. These are the core primitives that advertise in the core record; `call` and `cancel` (operations) advertise under their own packages, not here (§3.3).

> **Normative.** An advertised capability value GOVERNS behaviour; it is not decorative. A scope MUST act on what it advertises — honour an option it advertises support for, and decline the request `400` when it advertises `false` — and MUST NOT silently ignore the parameter and return an unqualified success. A discovery flag a client cannot rely on to predict the outcome is a conformance defect, not a nicety.

```lumen
type CoreCapabilities = {
  get:        GetCaps,
  list?:      ListCaps,
  pull?:      PullCaps,
  create?:    CreateCaps,
  put?:       PutCaps,
  patch?:     PatchCaps,
  delete?:    DeleteCaps,
  revisions?: RevisionsCaps,
  export?:    ExportCaps,
  import?:    ImportCaps,
  push?:      PushCaps
}
```

| Member | Type | Description |
|---|---|---|
| `get` | `GetCaps` | Always present — point reads are the floor. See [GetCaps](#GetCaps). |
| `list?` | `ListCaps` | Present iff `list` is offered. See [ListCaps](#ListCaps). |
| `pull?` | `PullCaps` | Present iff the `pull` OPERATION is offered — this advertises the operation, not a channel inventory. Which channels exist (the changefeed, and any declared streams) is discovered per-channel; a changefeed-only scope offering `pull` is complete. See [PullCaps](#PullCaps). |
| `create?` | `CreateCaps` | Present iff `create` is offered. See [CreateCaps](#CreateCaps). |
| `put?` | `PutCaps` | Present iff `put` is offered. See [PutCaps](#PutCaps). |
| `patch?` | `PatchCaps` | Present iff `patch` is offered. See [PatchCaps](#PatchCaps). |
| `delete?` | `DeleteCaps` | Present iff `delete` is offered. See [DeleteCaps](#DeleteCaps). |
| `revisions?` | `RevisionsCaps` | Present iff prior revisions are addressable (`revisions`); offered only by a `versioned` scope. See [RevisionsCaps](#RevisionsCaps). |
| `export?` | `ExportCaps` | Present iff `export` is offered. See [ExportCaps](#ExportCaps). |
| `import?` | `ImportCaps` | Present iff `import` is offered. See [ImportCaps](#ImportCaps). |
| `push?` | `PushCaps` | Present iff `push` is offered. See [PushCaps](#PushCaps). |

<a id="ScopeCapabilities"></a>

### `ScopeCapabilities`

A scope's scope-wide traits — the capabilities that are neither per-primitive nor pack-specific. Storage classes, the revision model, and whether aliases are supported live here.

> **Normative.** THE SCOPE-WIDE TRAITS DO NOT COMBINE FREELY. `versioned` ([RevisionModel](#RevisionModel)) with `reusable` ([IdModel](#IdModel)) is FORBIDDEN, and a scope MUST NOT advertise that pair. Such a scope would keep a tombstone revision and then re-admit the id, so [revisions](#revisions) at that id would answer with the history of TWO unrelated resources — contradicting its own definition, "the history of one resource" — and the `previousRevision` chain, the basis for compensation, would walk across the boundary into a resource the caller never named. A pinned `get` under `?revision=` would likewise resolve one id to two different resources. The prohibition is a consequence of what a revision chain MEANS, not of any implementation's behaviour. So `versioned` ⇒ `permanent`, and equivalently `reusable` ⇒ `unversioned`. The other three combinations are legal and each has its own read of `delete`'s `404` ([delete](#delete)): `versioned`+`permanent`, `unversioned`+`permanent`, `unversioned`+`reusable`.

```lumen
type ScopeCapabilities = {
  storageClasses: [StorageClass],
  revisionModel:  RevisionModel,
  idModel:        IdModel,
  aliases?:       AliasCaps,
  bodyFormSpill?: bool
}
```

| Member | Type | Description |
|---|---|---|
| `storageClasses` | `[StorageClass]` | Which persistence classes the scope can honor — a set over `Durable` / `Ephemeral`. A resource whose class is not honored cannot be hosted. `Intrinsic` is universal and never appears here. |
| `revisionModel` | `RevisionModel` | Whether the scope mints revisions, scope-wide. See [RevisionModel](#RevisionModel). |
| `idModel` | `IdModel` | Whether a retired id is permanently spent, scope-wide. See [IdModel](#IdModel). |
| `aliases?` | `AliasCaps` | Present iff the scope supports alias resources and the scope-root overlay. See [Alias](#Alias), [AliasCaps](#AliasCaps). |
| `bodyFormSpill?` | `bool` | Present and `true` iff the scope accepts the OPTIONAL body-form spill ([Envelope](#Envelope)) for an over-budget read or write guard; absent/false ⇒ an over-budget request is refused `request-too-large`. There is no advertised URL-byte budget — intermediaries, not the origin, impose the limit, so a client is reactive to `414`/`431`/`400`-by-length regardless. |

<a id="AliasCaps"></a>

### `AliasCaps`

Advertised for `aliases` — its presence signals that `Alias` resources under `sys/aliases/` and the scope-root overlay are active. An alias is always single-hop and same-scope (no chains); any further limits (e.g. a cap on aliases per target) ride here.

```lumen
type AliasCaps = { ...: any }
```

<a id="RevisionModel"></a>

### `RevisionModel`

A scope's revision model — a scope-wide trait, stated outright (no implicit default).

> **Normative.** `versioned` ⇒ the scope mints revisions; write refs are `pinned`, pinned-revision (time-travel) `get` resolves, and the changefeed carries revisions. It also constrains the id model: `versioned` REQUIRES `permanent`, since a revision chain may not span two resources under one id ([ScopeCapabilities](#ScopeCapabilities)). `unversioned` ⇒ the scope mints no revisions; `rev` is absent everywhere, write refs relax to `unpinned`, and every revision-dependent behaviour relaxes scope-wide. `unversioned` leaves the id model free — both `permanent` and `reusable` are legal with it.

```lumen
type RevisionModel = "versioned" | "unversioned"
```

<a id="IdModel"></a>

### `IdModel`

A scope's id model — a scope-wide trait, stated outright (no implicit default). Whether an id retired by `delete` is permanently spent or may be minted again.

> **Normative.** `permanent` ⇒ a retired id is never reused. An unpinned inbound reference to it resolves to the tombstone and faults `410 Gone`; `create` at that id faults `identity-taken`, and so does a `put` under `ifAbsent`, which asserts the id is free; a bare `put` instead TARGETS the retired resource and faults `410` — rooting cannot discriminate, since every `put` is id-rooted, so the guard is what does ([put](#put)). Where the scope is also `versioned`, a client that wants to read what the resource WAS pins a revision; the id alone only reaches the tombstone. `reusable` ⇒ a retired id MAY be minted again, and REQUIRES `unversioned` ([ScopeCapabilities](#ScopeCapabilities)). `get` of a retired id faults `404`, a later `create` at that id succeeds, and an unpinned inbound reference MAY therefore resolve to an UNRELATED resource. Pinning is NOT the remedy here and must not be offered as one: a `reusable` scope mints no revisions, so there is no pinned form of the reference to hold. On such a scope a reference cannot be made to survive a delete at all, and a client that needs one must carry identity the scope's ids do not supply.

> **Normative.** The id model is declared, never inferred, and a scope states it outright like its revision model. `permanent` is not a floor every provider can hold: a scope projecting an existing system whose id allocation it does not control is expected to state `reusable` rather than claim a guarantee it cannot keep. Stating `reusable` is conformant; claiming `permanent` and reusing an id is not.

> **Normative.** A scope declaring `reusable` and offering `delete` MUST advertise `precondition` ON `delete` — `precondition` true in [DeleteCaps](#DeleteCaps). It cannot discharge this with `ifRevision`: `reusable` requires `unversioned` ([ScopeCapabilities](#ScopeCapabilities)), so no revision exists for `If-Match` to carry, and `precondition` is the only guard such a scope can offer at all. That it pins by CONTENT rather than by revision is what makes the requirement reachable: a projection with no revision identity can still satisfy it. The guard must be on `delete` specifically, not merely somewhere among the writes — the hazard is a `delete` RETRY against a recycled id, so a scope guarding `put` while leaving `delete` unguarded would satisfy a looser rule and remain unsafe. Without a guard a client has no safe way to retry a `delete` at all, and cannot learn that from a failure, because the unsafe retry SUCCEEDS.

```lumen
type IdModel = "permanent" | "reusable"
```

<a id="GetCaps"></a>

### `GetCaps`

Limits advertised for `get`.

```lumen
type GetCaps = {
  selector: bool
}
```

| Member | Type | Description |
|---|---|---|
| `selector` | `bool` | Whether a `select` projection is honored on a read. |

<a id="ListCaps"></a>

### `ListCaps`

Limits advertised for `list`.

```lumen
type ListCaps = {
  conditions: [ConditionKind],
  selector:   bool,
  sort:       bool,
  compactFilter: bool,
  maxLimit?:  integer
}
```

| Member | Type | Description |
|---|---|---|
| `conditions` | `[ConditionKind]` | The list-condition operators the low-bar filter supports. |
| `selector` | `bool` | Whether a `select` projection is honored. |
| `sort` | `bool` | Whether server-side sort is offered. |
| `compactFilter` | `bool` | Whether the compact `?where=` dialect is accepted, in addition to the URL-encoded JSON Filter floor every scope accepts. |
| `maxLimit?` | `integer` | The maximum page size, when capped. |

<a id="ConditionKind"></a>

### `ConditionKind`

One operator in the low-bar `list` filter. The richer filter / query language is a corelib (query-pack) capability, not core.

```lumen
type ConditionKind = "compare" | "matches" | "has" | "missing" | "contains" | "containsAny" | "excludes" | "isType"
```

<a id="PullCaps"></a>

### `PullCaps`

Limits advertised for `pull` (the changefeed and declared streams).

```lumen
type PullCaps = {
  sse:      bool,
  jsonl:    bool,
  filter:   bool,
  selector: bool
}
```

| Member | Type | Description |
|---|---|---|
| `sse` | `bool` | Whether live `sse` transport is offered. |
| `jsonl` | `bool` | Whether bulk `jsonl` transport is offered. |
| `filter` | `bool` | Whether a `where` filter is honored on the stream. |
| `selector` | `bool` | Whether a `select` projection is honored on each item. |

<a id="CreateCaps"></a>

### `CreateCaps`

Limits advertised for `create`.

```lumen
type CreateCaps = {
  serverAllocatesId: bool,
  clientProposedId:  bool
}
```

| Member | Type | Description |
|---|---|---|
| `serverAllocatesId` | `bool` | Whether the server will allocate the id (no `requestedId`). |
| `clientProposedId` | `bool` | Whether a caller-proposed id (`requestedId`) is honored. |

<a id="PutCaps"></a>

### `PutCaps`

Limits advertised for `put` — which write guards it honors. The `precondition` operator set is ⊆ [ListCaps](#ListCaps) `conditions`.

```lumen
type PutCaps = {
  ifRevision:   bool,
  ifAbsent:     bool,
  precondition: bool
}
```

| Member | Type | Description |
|---|---|---|
| `ifRevision` | `bool` | Whether the `ifRevision` (If-Match) guard is honored. |
| `ifAbsent` | `bool` | Whether the `ifAbsent` (If-None-Match: *) create-if-absent guard is honored. |
| `precondition` | `bool` | Whether the `?precondition=` state guard is honored. |

<a id="PatchCaps"></a>

### `PatchCaps`

Limits advertised for `patch`. The `precondition` operator set is ⊆ [ListCaps](#ListCaps) `conditions`.

```lumen
type PatchCaps = {
  ifRevision:   bool,
  precondition: bool
}
```

| Member | Type | Description |
|---|---|---|
| `ifRevision` | `bool` | Whether the `ifRevision` (If-Match) precondition is honored. |
| `precondition` | `bool` | Whether the `?precondition=` state guard is honored. |

<a id="DeleteCaps"></a>

### `DeleteCaps`

Limits advertised for `delete`. The `precondition` operator set is ⊆ [ListCaps](#ListCaps) `conditions`.

```lumen
type DeleteCaps = {
  ifRevision:   bool,
  precondition: bool
}
```

| Member | Type | Description |
|---|---|---|
| `ifRevision` | `bool` | Whether the `ifRevision` (If-Match) precondition is honored. |
| `precondition` | `bool` | Whether the `?precondition=` state guard is honored. |

<a id="RevisionsCaps"></a>

### `RevisionsCaps`

Presence advertises that prior revisions are addressable (`revisions`); offered only by a `versioned` scope.

```lumen
type RevisionsCaps = { }
```

<a id="ExportCaps"></a>

### `ExportCaps`

Limits advertised for `export`.

```lumen
type ExportCaps = {
  revisions: bool,
  selector:  bool
}
```

| Member | Type | Description |
|---|---|---|
| `revisions` | `bool` | Whether the export can include prior revisions (history), not only the current state. |
| `selector` | `bool` | Whether a `select` projection is honored on the export — advertised per-op, as `get`/`list`/`pull` advertise their own. |

<a id="ImportCaps"></a>

### `ImportCaps`

Limits advertised for `import`.

```lumen
type ImportCaps = {
  historyRestore: bool,
  window?:        integer
}
```

| Member | Type | Description |
|---|---|---|
| `historyRestore` | `bool` | Whether importing prior revisions (history restore) is honored. |
| `window?` | `integer` | The admission window — how many export records the scope will accept before backpressure, when bounded. Its PRESENCE advertises resumable/backpressured import ([ImportAck](#ImportAck)); absent ⇒ one-shot import only (a single `complete` ack, no resume). Mirrors [PushCaps](#PushCaps) `window`. |

<a id="PushCaps"></a>

### `PushCaps`

Limits advertised for `push`.

```lumen
type PushCaps = {
  maxBatch?: integer,
  window?:   integer
}
```

| Member | Type | Description |
|---|---|---|
| `maxBatch?` | `integer` | The maximum number of events accepted in one batch, when capped. |
| `window?` | `integer` | The admission window — how many events the channel will take before backpressure, when bounded. |

# Appendix A. Worked examples (wire representations)

```
--- authoring (Lumen) ---
  type Issue is Bead  { title: string, status: "open" | "closed" }   // → "issue"
  type Task  is Issue { estimate?: number }                          // → "issue/task"
  type Bug   is Issue { severity: "low" | "high" }                   // → "issue/bug"
  type Memory     { statement: string }
  type Spec       is Memory     { status: "draft" | "accepted" }     // → "memory/spec"
  type Constraint is Memory     { applies: "always" | "conditional" }// → "memory/constraint"
  type Policy     is Constraint { enforcement: "advisory" | "block" }// → "memory/constraint/policy"
```

```
--- a bead on the wire (a task) ---
  { id:        { id: "4821", rev: "r7" },                              // scope absent ⇒ local
    authority: { scope: "uri", id: "https://pkg.gastownhall.dev/beads", rev: "sha256:9f…" },
    type:      "issue/task",
    body:      { title: "Wire the changefeed", status: "open", estimate: 3 },   // firewalled
    metadata: {}, provenance: { … }, createdAt: "2026-11-16T18:04:12Z",
    storageClass: Durable }
  // kind (derived) = type.id = "issue/task"
```

```
--- a content resource on the wire (text/plain) — a bare Resource ---
  { id:        { id: "assets/readme.txt", rev: "r1" },                 // scope absent ⇒ local
    authority: { scope: "uri", id: "https://www.iana.org/assignments/media-types" },
    type:      "text/plain",
    body:      "Hello, world.\n",                                      // raw, flat — no firewall
    metadata: {}, provenance: { … }, createdAt: "2026-11-02T09:00:00Z",
    storageClass: Durable }
```

# Appendix B. The `///` backend metadata vocabulary

```
One namespaced record per backend; the single top-level key is the namespace —
no dotted keys. `title:`/`description:` are plain strings consumed by every
backend. Backends: schema bundle, OpenAPI, Go, reference, CLI.
  bdp        — protocol markers: { kind = "primitive", primitive = "get", id = "<uri>" }
  openapi    — projection control: { operationId, method, pathItem, tags, params,
               paramGroups, request, success, problem, responses, responseHeaders }
  jsonschema — base-type refinements: { format }, { pattern }, { minLength }, { closed }
  doc        — reference-rendering mode: { style = "http" | "rpc" }
  normative  — a conformance statement, lowered to a numbered MUST/SHOULD line.
```

requestContext → BDP-Cause / BDP-Provenance / BDP-Metadata request headers; replyContext → BDP-Cause / BDP-Transaction / BDP-Metadata reply headers.

# Appendix C. Lowering — Lumen → JSON Schema & OpenAPI (the isomorphism)

The lowering is deterministic and structure-preserving: a Lumen declaration and its JSON Schema are the same shape. The one thing that does not round-trip is nominal identity — two structurally-equal `type`s are distinct in Lumen but identical in JSON Schema (which is structural). So the map is an isomorphism on structure; identity is the quotient it factors out. On the wire a Resource carries only `type` (a path), never its Lumen type name.

```
--- types → JSON Schema ----------------------------------------------------
  Lumen                             JSON Schema
  --------------------------------  ---------------------------------------------
  ## Name                           a named schema (component; $id = Name)
  /// description: …                "description"
  /// jsonschema = { k = v }        merged as keyword k (format / pattern / …)
  type X is string                  { "type": "string" }  (+ refinements)
  type X is number                  { "type": "number" }
  type X = Y                        { "$ref": "#/…/Y" }         (transparent alias)
  type X { a: T, b?: U }            { "type":"object", "properties":{a,b},
                                      "required":["a"], "additionalProperties":false }
  b?   (optional field)             omitted from "required"
  { ...: any }                      { "type":"object", "additionalProperties":true }
  [ T ]                             { "type":"array", "items": T }
  "open" | "closed"                 { "enum": ["open","closed"] }
  A | B            (type union)     { "oneOf": [A, B] }
  = v              (default)        "default": v
  type X is Y { … }  (refinement)   { "allOf": [ {$ref Y}, {narrowing} ] }
                                      — flattened to the narrowed schema by the resolver
  union { Tag {f} … }  (closed DU)  { "oneOf": [ {tagged arm}, … ],
                                      "discriminator": { "propertyName": "<tag>" } }
  union { Ref  Tag {…} }  (mixed)   oneOf of the $ref'd schema + the tagged arms
  open union (Outcome, IdentityBasis)  same oneOf, no closed/unevaluated gate —
                                      a reader MUST tolerate an unrecognized arm
  ref<T>                            { "$ref": "#/…/ResourceRef" }   (T erases)
  pinned<T> / unpinned<T>           ResourceRef with "rev" required / null
  Resource { fields }               Resource with "body" = the fields' schema (firewall)
```

```
--- operations → OpenAPI ---------------------------------------------------
  A `## op` carrying /// bdp = { kind = "primitive" } + /// openapi = { … }
  lowers to one path item + operation:
```

```
  /// openapi key         OpenAPI
  ----------------------  -------------------------------------------------------
  method                  the HTTP method
  pathItem                the path (resource / scope / channel / operation / asyncResult)
  operationId, tags       operationId, tags
  params { in = query }   a query parameter        (e.g. ?revision=, ?mode=)
  params { in = header }  a header parameter       (If-Match, Accept)
  request { contentType } requestBody media type   (json-patch+json, jsonl)
  success { status }      the 2xx response; body = the op's return type
  problem { status:[…] }  each 4xx/5xx response; body = Problem (application/problem+json)
  responses [ … ]         explicit per-status responses (call: 200 / 201 / 409 / 202)
  responseHeaders         response headers         (Location)
  fn   (pure / safe)      a safe method (GET-shaped); no state change
  command                 a mutating method
```

```
  Counting the fault surface — read BOTH response forms. Twelve of the thirteen
  primitives declare their 4xx/5xx rows through `problem { status = [ … ] }`, and
  `call` alone uses `responses [ … ]`, because its statuses carry distinct bodies.
  A counter that reads only the shorthand silently drops `call`'s 409 — its only
  >=400 row — and undercounts the surface by one (51 where the answer is 52). The
  explicit form is NOT an inconsistency to normalize away: the shorthand asserts
  "this status carries a Problem", and `call/409` does not.
```

```
  So `call/409` is the ONLY >=400 response in this binding whose body is not a
  Problem: it is `application/json` + `Reply`, against `application/problem+json`
  + `Problem` everywhere else. A conformance case for it asserts a Reply, and the
  response content type is the discriminator — machine-checkable, no prose needed.
  A second non-Problem >=400 response would make this a class rather than an
  exception, and should be ruled on rather than assumed Problem-shaped.
```

```
--- normative & context → prose / headers ----------------------------------
  /// normative: …        one numbered MUST / SHOULD / MAY line in the generated
                          reference, plus an x-normative note on the lowered schema/op.
  BDP-* context           lowers to request/reply headers (Appendix B), never to
                          the URL or body — the body carries the value, the headers
                          the context.
```

# Appendix D. The HTTP/BDP binding

BDP is an HTTP protocol; this binding is normative. core.lumen is the home of all normative material, HTTP included (bdp.md is the overview / transclusion shell). The route table in §13.1 and the per-primitive `openapi` annotations lower to a generated OpenAPI document (`/bdp/openapi`); this appendix states the parts that span operations — the URL space, discovery, write guards, read projection, headers, status codes and Problem codes.

```
--- D.1 the URL space & the action fence -----------------------------------
  Three parts (see [[core.lumen#PathString]] and the §13.1 route table):
    • an ID space — a resource is `/{id}`, {id} a free, slash-bearing string.
    • noun roots — `/sys/*` in-band system RESOURCES (get-addressable beads:
      `/sys/changes`, `/sys/capabilities`, `/sys/aliases/*`); `/bdp/*` the
      protocol's own fixed routes & artifacts (`/bdp/openapi` — static only).
    • the ACTION FENCE `/-/` — a bare `-` segment separates a resource id
      (left) from a protocol action or projection (right): `/{id}/-/revisions`,
      `/{opPath}/-/call`, `/{asyncResultId}/-/cancel`; at the scope root the
      left side is empty, so `/-/list`, `/-/create`.
  The fence, not a `:verb` suffix, carries actions: an id is a free string, a
  `:` has URL-reference scheme ambiguity, and real-world ids already bear colons.
  PARSE: match the fence on the RAW path (pre-decode) as the LAST `/-/`; validate
  the right side against the closed, fence-free action set (else 404). No id segment
  may be a bare `-`: a literal hyphen-only segment is percent-encoded (`%2D`) and a
  write minting an unencoded one is refused, so `%2D` never forges the fence.
  Scope bulk actions `export`/`import` ride the fence too: `GET /-/export`,
  `POST /-/import`. `/bdp/*` holds static artifacts only.
```

```
--- D.2 discovery (the floor) ----------------------------------------------
  GET /                → ServiceDescriptor ([[core.lumen#ServiceDescriptor]]) —
                         a thin signpost: { bdp, scope?, base?, links }. The
                         `links` repeat in a `Link` header (RFC 8288).
  GET /sys/capabilities → the scope's live Capabilities (a `get` on a bead).
  GET /bdp/openapi     → the static OpenAPI contract.
  The fixed paths ARE load-bearing: a client MAY hardcode `GET /`,
  `GET /sys/capabilities`, `GET /bdp/openapi`. Relations are an OPTIONAL convenience
  mirroring them, in `links` and a `Link` response header (RFC 8288, body authoritative):
  `service-desc` → `/bdp/openapi` and `service-meta` → `/sys/capabilities` are the
  RFC 8631 registered relations (the OpenAPI location is advertised the traditional way,
  `Link: </bdp/openapi>; rel="service-desc"`); `service-doc` → docs; the changefeed uses
  the BDP extension relation `tag:bdp.dev,2026:rel/changes` → `/sys/changes` (never a bare
  `changes` token). The mandatory floor is `get`, `GET /`, and a readable `/sys/capabilities`.
```

```
--- D.3 write guards (PRECONDITIONS — request line, never the body) --------
  A guard says what must be true to proceed; it is request metadata, carried
  by a header or the query string, NEVER the payload. So a `put` body is only
  ever the resource and a `patch` body only ever the JSON Patch. Four guards:
    create    fail-if-exists is create's nature → `identity-taken` (409).
    If-Match: "<Rev>"   revision / OCC guard (put/patch/delete) → stale ⇒
                        `revision-mismatch` (412). `<Rev>` in any header is the
                        double-quoted strong entity-tag (RFC 9110 §8.8.3).
    If-None-Match: *    create-if-absent (put) → present ⇒ `identity-taken` (409 —
                        one id-taken status, shared with create).
    ?precondition=<Filter>  STATE guard (put/patch/delete) → the current
                        resource must satisfy the flat-AND [[core.lumen#Filter]]
                        (the same grammar `list.where` uses, projected onto the
                        query string) → fails ⇒ `precondition-failed` (412).
  A `precondition` too large for the URL budget MAY spill to an OPTIONAL, advertised
  ([[core.lumen#ScopeCapabilities]] `bodyFormSpill`) `query`-tier body-form
  (`POST /{id}/-/{put|patch|delete}`, media type `application/vnd.bdp.envelope+json`,
  body = [[core.lumen#Envelope]]: `representation` for put — the FULL rep, never a bare
  body — `patch` for patch, `precondition?` throughout) — the ONE place a write envelope
  appears; the `If-Match`/`If-None-Match` guards keep riding their headers. A scope that
  does not advertise spill refuses an over-budget guard with `request-too-large`.
  Direct `DELETE` has no body and carries its guard on the request line; an over-budget
  delete guard MAY still use the advertised POST spill (an `Envelope` with `precondition`
  only, no body).
```

```
--- D.4 reads: projection & the POST spillover -----------------------------
  `get` `?include=/?omit=/?expand=` (or the full `?select=`), and `list` `?where=`
  + the selector params, project onto the query string (the selector lowers to the
  CLI-matching params; the flat-AND Filter lowers to URL-encoded JSON, or an advertised
  compact dialect), giving a projected read its own cacheable URL. When the query string
  overruns the URL budget, the read MAY re-send under the fence as a body-form carrying
  the `ReadRequest`: where `bodyFormSpill` is advertised a service answers `POST`
  (`/-/list`, `/{id}/-/get`) and MAY answer the draft HTTP `QUERY` method. A body-form
  read is SAFE and app-idempotent (it mutates nothing); it is not cached by default, so
  a client prefers the query-string form when it fits. There is NO advertised URL-byte
  budget: the limit is imposed by intermediaries (proxies/CDNs/browsers), not the origin,
  so a client reacts to `414`/`431`/`400`-by-length (and MAY spill proactively above a
  conservative built-in threshold) regardless of what the origin would accept.
```

```
--- D.5 request context (headers — never the URL or body) ------------------
  BDP-Cause        a bare cause token
  BDP-Provenance   the caller's provenance part, as JSON (ASCII, escaped)
  BDP-Metadata     per-request metadata, as JSON
  Rules: one header per member; each appears at most once; header names use
  hyphens, never underscores. The three together have a floor of 4096 bytes a
  Scope MUST accept (its max is advertised); oversize ⇒ `request-too-large`,
  never truncated. A browser EventStream reader sends no request context —
  allowed, since every member is optional.
```

```
--- D.6 reply context (response headers) -----------------------------------
  BDP-Cause        always present
  BDP-Transaction  present only where the request made exactly one commit
  BDP-Metadata     per-reply metadata
  Link             discovery relations (RFC 8288), mirroring `links` — on `GET /` and,
                   for `service-desc`, advertisable on any response
  ETag             the resource's `Rev` as a STRONG entity-tag, double-quoted
                   (`ETag: "<Rev>"`), so `If-Match: "<Rev>"` is a conformant ETag check
  Content-Location the canonical id of the returned representation — on an alias rewrite
                   (it names the target) and on a body-form (POST-tunneled) read/write.
                   A cache keys on the REQUEST target URI, not on this header; an unsafe
                   request invalidates the named URI per RFC 9111 §4.4
  Location         the new URL on `create` / a creating `call` / an async accept
  The body is the value alone; the context rides in the headers.
```

```
--- D.7 content types ------------------------------------------------------
  application/json              a value / one windowed page; a ServiceDescriptor
  application/jsonl             bulk stream (pull / list / export; push / import body)
  text/event-stream            live pull (SSE); the SSE event id is the cursor, so a
                               reconnect's `Last-Event-ID` resumes exactly as `after`
  application/json-patch+json  the direct `patch` body (RFC 6902). REQUIRED means
                               PRESENT-OR-FAULT: a direct `patch` whose `Content-Type` names
                               another media type, OR OMITS THE HEADER, faults `415`. Absence
                               is not the lenient case — a requirement that bites only when
                               you declare something else can be evaded by declaring nothing,
                               and an omission must never downgrade a guarantee. The
                               guarantee here is that RFC 7396 merge-patch is never silently
                               applied; one mistake gets one fault, so a wrong OR missing
                               media type is `415` rather than 415-or-422 depending on which
                               way the client erred.
  application/vnd.bdp.envelope+json  the OPTIONAL body-form spill body ([[core.lumen#Envelope]]):
                               a POST `/{id}/-/{put|patch|delete}` carrying an over-budget guard
  application/problem+json     every failing body (RFC 9457 Problem)
```

```
--- D.8 status codes -------------------------------------------------------
  200  get / put / patch / list / revisions / pull success; call → outcome success
  201  create success, and a call whose Operation `creates` — Location: the new URL
  202  call ?mode=async — Location: the AsyncResult URL; body: no outcome yet
  400  `malformed-request` / `invalid-parameter` / `validation-failed` — a malformed or
       invalid request. Shapes that reach it. A BAD BODY (`malformed-request`): unparseable
       JSON, a patch that is not a JSON-Patch array, a truncated export. AN INVALID PARAMETER
       VALUE (`invalid-parameter`) — INCLUDING A DECLARED OPTION THE SCOPE DOES NOT SUPPORT,
       advertised at no finer granularity: a filter sub-operator (`in` / `glob` / `regex`)
       under an advertised kind, a `select` on a read whose caps carry no `selector`, a per-op
       `filter` with no advertisement, an import `idRoot`. BDP deliberately does not advertise
       support at this sub-capability granularity — a client sends and may be declined rather
       than discovery carrying every sub-option — so a missing advertisement does not change
       the fault, only a client's ability to predict it: the option is IN the operation's
       vocabulary and simply unsupported, so it declines `invalid-parameter`, not malformed.
       ("Declared" means the operation's SIGNATURE — the normative source for an input; a
       signature-declared option is subject to this rule even where the op's `openapi`
       annotation omits it, that omission being a declaration divergence the drift check
       catches, not a behaviour exemption.)
       A VALIDATION FAILURE (`validation-failed`): a well-formed body whose values violate a
       declared constraint — excluded from `422` by the shrink test (shrinking a bad value does
       not fix it) and from `409` (no identity conflict). Or A WRITE GUARD THE OPERATION DOES
       NOT DEFINE (`malformed-request`) — `If-None-Match: *` on `patch` or `delete`, whose
       [[core.lumen#PatchCaps]] and [[core.lumen#DeleteCaps]] carry no `ifAbsent` field at all
       (only [[core.lumen#PutCaps]] does): an out-of-vocabulary guard is not an advertised
       option carrying a bad value, it is an input the operation does not have. The line is
       drawn by VOCABULARY, not by whether a caps field advertises the option: an input IN the
       operation's vocabulary — advertised `false`, OR unsupported with no advertisement at that
       granularity — is a decline it can state (`invalid-parameter`, or `validation-failed` for
       a constraint breach); only an input OUTSIDE the vocabulary is `malformed-request`.
       DISTINCT from `422` (a request exceeding an advertised capability bound —
       `limit-exceeded` — fixed by shrinking). `malformed-request`, `invalid-parameter` and
       `validation-failed` all resolve here.
  409  call → a declared failure (ruled); any id collision — `create` fail-if-exists OR
       `put` + `If-None-Match: *` (`identity-taken`); also some Problems
  412  a failed guard on put / patch / delete — a stale `If-Match` (`revision-mismatch`)
       or a `precondition` the resource does not satisfy (`precondition-failed`). A
       present `If-None-Match: *` collision is NOT 412: it is `identity-taken` (409).
  413  CLIENT-REACTIVE, never origin-declared (`request-too-large`): a request refused as too
       large. NO operation declares it — ruling D undeclared it from `put`/`patch`/`delete` —
       because the threshold it would fire at is advertised nowhere. The URL-guard budget is
       undeclared, and the request-context max promised in D.5 has no capability field to carry
       it, while D.5's 4096-byte floor is a size a Scope MUST ACCEPT. A client handles this
       reactively; no portable conformance case can construct the boundary.
  414  CLIENT-REACTIVE, never origin-declared: the read's query string exceeds the URL budget —
       retry as a body-form POST. NO operation declares it — ruling D undeclared it from
       `get`/`list`/`revisions`/`export` — because the limit is imposed by intermediaries
       (proxies/CDNs/browsers), not the origin, so the origin is not the conformance point and
       cannot be made to emit one at any length; intermediaries may instead surface it as `431`
       or a length-related `400`.
  415  a direct `patch` body whose media type is not `application/json-patch+json` (a
       body-form patch under `application/vnd.bdp.envelope+json` is exempt)
  422  `limit-exceeded` — a request exceeding an advertised capability bound (a batch over
       `maxBatch`, or a guard past a scope limit). MEMBERSHIP TEST: a fault belongs at 422
       IFF shrinking the request fixes it; a well-formed body that is simply unusable (a
       projected export offered as a restore source) is 400, not 422.
  404  `resource-not-found` — `get` of an absent resource, or `pull` of an absent channel; an unknown action to the right of the `/-/` fence
  405  `channel-not-pullable` / `channel-not-pushable` — pull / push on the wrong channel
       direction; `capability-not-supported` — patch where a Scope offers no patch, or any
       un-offered primitive (an un-offered primitive is declined here, never 501)
  410  `resource-erased` — `get` of an erased resource, or `pull` of a retired channel; `cursor-expired` — `pull` below the retention floor
  4xx/5xx  any fault — the body is the Problem, carried at the Problem's own status
```

```
--- D.9 Problem codes (BDP extension member `code`; stable `type` URIs) -----
  `code`/`retry` are BDP extension members, not RFC 9457 core; each code has a stable
  problem-type URI `tag:bdp.dev,2026:problem/<code>` carried in the Problem `type` member.
  malformed-request · invalid-parameter · unauthenticated · forbidden ·
  resource-not-found · resource-erased · revision-mismatch ·
  precondition-failed · identity-taken · validation-failed · type-not-installed ·
  cursor-expired · request-too-large · limit-exceeded · rate-limited ·
  temporarily-unavailable · capability-not-supported · callable-not-found ·
  callable-unavailable · mode-not-supported · mode-refused ·
  channel-not-pullable · channel-not-pushable
```

# Appendix E. Conformance — what a Core service MUST provide

A conformance suite is built from this spec, not from any implementation. Each `/// normative:` line above is a conformance point; the list below gathers the store-wide guarantees (harvested from the prose Core §10).

These guarantees are NOT unconditional, and reading them as such is a known trap: a guarantee naming a primitive binds a store only where that primitive is offered, and one naming a revision or a retired id is conditioned by the scope's declared models ([ScopeCapabilities](#ScopeCapabilities)). The conditions are written into the entries below that carry them. A suite that derives an unconditional obligation from this list will fail a conformant store on a guarantee its declared models never promised.

So the count of this list is not its shape. Fourteen entries, and FIVE of them are conditional: 1, 5 and 14 bind only under a model the scope declares, while 6, 12 and 14 bind only where the primitive is offered (14 carries both gates). The remaining nine bind every store. Do not partition this list as "eleven unconditional and three gated" — that count is only reachable by reading "unconditional" as "not model-conditioned", which silently drops the offering gate on 6 and 12.

A suite CITING any of the five is not thereby testing it — the citation must carry the GATE the entry names, or the case asserts against scopes the guarantee was never addressed to. A case whose precondition is that one of these guarantees is false is testing the relaxation, which is sound, and is not evidence about the guarantee.

1. A stable identity per resource — never changed, and under `permanent` ([IdModel](#IdModel)) never reused; opaque local part. Under `reusable` a retired id MAY be minted again, which is what that model declares.
2. A type per resource — the (authority, type) pair, frozen at inception.
3. A body and metadata it stores and does NOT interpret.
4. A storage class per resource — Durable | Ephemeral | Intrinsic; whether revisions are kept is the scope's revisionModel, not a per-resource field.
5. Under `versioned` ([RevisionModel](#RevisionModel)), a revision per resource that changes exactly when its state changes. Under `unversioned` no revision is minted and `rev` is absent everywhere, so this guarantee is vacuous rather than violated.
6. History where offered — prior revisions addressable; offered or not, discoverable.
7. A transaction marker shared by everything committed together.
8. A cause minted once per incoming request, stamped on every effect it sets off.
9. A durable change record per resource per commit — none for a failed or no-change request.
10. Provenance saved with the change, immutable, never invented.
11. A changefeed at /sys/changes carrying every commit (replication included).
12. Where `export` is offered, an export consistent with itself, with the cursor that matches it.
13. An authorization view — a hidden resource reads exactly as a missing one.
14. Where `delete` is offered, deletion that does not erase — under `permanent` the id stays accounted for, and where the scope is also `versioned` the tombstone revision is kept. A `reusable` scope retains neither record ([delete](#delete)); that is the declared model, not a breach of this guarantee.

Discovery advertises, per scope: the primitives offered; whether history / patch / push are offered; which storage classes `create` accepts; which invocation modes are refused; the max request-context size; and where the changefeed is. A request that needs an un-offered primitive is refused `capability-not-supported`; an optional feature is never half-present (an advertised-false option is declined at 400, not here).
