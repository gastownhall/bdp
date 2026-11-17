# core.lumen — the Beads Protocol (BDP) Core, authored as Lumen

This single Lumen source is THE Core spec. The toolchain projects it DETERMINISTICALLY to the JSON Schema bundle and the OpenAPI catalog (both shipped as part of this specification), plus the generated Markdown reference, Go interfaces, and the canonical CLI. The Markdown under specs/generated/ is generated from this file, never hand-written.

Source of record: gastownhall/bdp @ main. Owner: the spec owner (Lumen + BDP).

## What BDP is

- provenance — who changed a resource, how, and when.
- revision history — every resource is versioned; prior revisions are addressable.
- streaming — one convention for reading a sequence: the three pull forms (windowed · bulk · live) over a single cursor.
- export & change notification — one representation serves both the bulk backup (export) and the live changefeed.
- an overlay system — types, operations, and channels described as resources, so any BDP implementation can distribute them.
- a collection — a standard library of useful types, operations, and channels (a separate spec, layered ON core).

## §0. Design decisions (current — the newer ruling wins)

Recorded as decisions so the design does not read as drift. These reflect the model CLOSED 2026-11-16; where an older dated ruling conflicts, this list wins (the archaeology lives in git history).

1. NOMINAL types on the Lumen surface. Every named shape is a `type` with identity — the protocol is a vocabulary of named concepts, not structural shorthand. (`schema` — transparent, structural — is for app modeling, not this spec.) ON THE WIRE a Resource still carries only `type` (a path); identity is a source-language concern, erased on the wire.
2. ONE reference world. `ref<T>` (a typed, phantom `ResourceId`) is the only way one resource names another; the pin lives in `rev`. `AbsoluteUri` survives only for non-ref URIs (a Problem `type`, a Principal `id`).
3. `ref<T>` is by-REFERENCE; `rep<T>` is by-VALUE — the representation a read returns. `get` turns one into the other.
4. `kind` is NOT stored — it is `type.id`, the single-`is` refinement path (`type Task is Issue` ⇒ "issue/task"). Single inheritance is what makes the path a unique tree.
5. `Bead<T>` is a MARKER: refining it puts the subtype's fields into `body` (the firewall). Refining `Resource` directly adds a new resource CATEGORY. Content is a BARE Resource (media-type `type`, raw `body`).
6. `union` is for CLOSED value-level sum types only; kind hierarchies are OPEN single-`is` refinement.
7. Dispatch is IMPLICIT — a request routes to its target resource (a bead takes CRUD, an Operation takes `call`, a Channel takes `pull`/`push`). No dispatch table.
8. ERROR MODEL. A data primitive returns its success value directly and faults with a Problem (an HTTP status). `Result<T,E>` / `Outcome<T,E>` are `call`'s ALONE — the declared success/failure of a user Operation. Writes return a pinned ref; reads return a rep; `delete` returns the tombstone Rev.
9. The primitives are a SUBSET a service may offer; discovery advertises which, and how each behaves. Built-in data primitives are NOT Operations.
10. `committedAt` and `inception` are SERVER-supplied on write, never request input; a Request's `provenance` is the caller's part only.

OPEN / parked (not in this file): the scheduler (deadline, timeout, graceful cancel + compensation); the `/sys/` scheme beyond `/sys/changes`; capability discovery; full filter / query / search / count / graph (corelib capabilities, advertised, not base); aliases & Transfer; the `canceled` HTTP status; delete-and-bring-back; the deferred TYPES pass (BeadValueSchema ⇄ ElementRef).

# 1. RESOURCES

A BDP store holds versioned RESOURCES. A resource has an identity, a type, and a body; you NAME one with `ref<T>` and FETCH it as `rep<T>`. This section builds that vocabulary bottom-up: version tokens, scope, identity, the reference/ representation pair (and `get`), revision pinning, the authority/type pair, the universal Resource shape, then metadata and provenance.

## 1.1  Identity — revisions, scope, ResourceId

### `Rev`

A resource-version token — opaque by definition; compared for exact equality only, never inspected.

> **Normative.** The revision changes EXACTLY when the resource's state changes; a write that would leave the state unchanged mints no new revision (and produces no event).

```lumen
type Rev is string
```

### `Digest`

A content-addressed rev (sha256 / commit) — a Rev that is a digest.

> **Normative.** `Digest is Rev`, so a digest satisfies any `rev: Rev`; there is no Rev-vs-Digest split on the wire.

```lumen
type Digest is Rev
```

### `BdpScope`

The URL of a BDP scope (a store).

```lumen
type BdpScope = AbsoluteUri
```

### `Scope`

The namespace an `id` resolves in. Absent ⇒ the current (local) BDP scope.

> **Normative.** A Scope is exactly one of — absent (the local BDP scope); a BdpScope URL (another BDP store, `id` relative to it); or the literal `"uri"` (NOT a BDP scope — `id` is an absolute URI whose scheme resolves it).

```lumen
type Scope =
    BdpScope
  | "uri"
```

### `ResourceId`

The identity of a resource — a scope, an id within it, and an optional revision. The wire URL is the projection (scope URL ⊕ id).

| Member | Type | Description |
|---|---|---|
| `scope?` | `Scope` | The namespace the `id` resolves in; absent ⇒ local. |
| `id` | `string` | The id, relative to `scope` (or the absolute URI when `scope` is `"uri"`). |
| `rev?` | `Rev` | The specific revision; absent ⇒ the current one. |

## 1.2  References & representations — ref<T>, rep<T>, and `get`

You NAME a resource with a reference and you READ it into a representation. `get` is the primitive that turns the first into the second.

### `ResourceRef`

A reference to a resource is just its id.

```lumen
type ResourceRef = ResourceId
```

### `ref`

A typed (phantom) reference — the by-REFERENCE form. `T` is checker-only and erases on the wire (a `ref` is a `ResourceId`).

```lumen
type ref<T> = ResourceRef
```

### `rep`

A typed (phantom) representation — the by-VALUE form: the resolved, point-in-time value of the resource a `ref<T>` points to; what a read returns. Possibly projected by a `selector`, always as-of one revision. `T` is checker-only.

```lumen
type rep<T> = Resource
```

### `get`

Safe point read — resolve a `ref` to the current representation, or a pinned revision when the ref pins `rev` (or `?revision=`). An optional `selector` projects the result (which gets its own cacheable identity). Faults 404/410 when absent or erased.

> **Normative.** `get` is SAFE and has no declared failure — it returns a `rep<Resource>` or faults with a Problem. A `selector`-projected read is a partial representation, cacheable under its own query-string identity.

> **Normative.** A resource outside the caller's authorization view is reported EXACTLY as a missing one — identical status, on every operation and every stream. A service never reveals that a hidden resource exists, including through an error only a hidden resource could cause.

| Parameter | Type | Description |
|---|---|---|
| `resource` | `ref<Resource>` |  |
| `selector?` | `selector` |  |

**Returns** `rep<Resource>`

## 1.3  Revision pinning — pinned<T> / unpinned<T>

Every resource is versioned; a reference either pins one exact revision or floats to the current one.

### `pinned`

A reference pinned to one exact revision (`rev` present).

> **Normative.** A pin is a local Rev or an external Digest; since `Digest is Rev`, both satisfy `rev: Rev`.

```lumen
type pinned<T>   is ref<T> { rev: Rev }
```

### `unpinned`

An unpinned reference (`rev` absent) — floats to the current revision.

```lumen
type unpinned<T> is ref<T> { rev: null }
```

## 1.4  Types on a resource — the (authority, type) pair

A resource's TYPE is a PATH, fully qualified by the authority that names it. (The overlay that DEFINES types — TypeBead / TypeDef — is §2.1.)

### `PathString`

A slash-delimited path — `"issue/task"` (a bead kind) or `"text/plain"` (a content media type).

> **Normative.** Two first path segments are RESERVED — `bdp` (the protocol's own fixed routes) and `sys` (in-band system resources, e.g. `/sys/changes`).

```lumen
type PathString = string
```

### `Authority`

The resource that NAMES a `type` — a package (for a bead) or a registry like IANA (for content). A ResourceRef, so the pin lives in its `rev`.

> **Normative.** The pair (authority, type) fully qualifies a type. The authority is PINNED (its `rev` = the resolved digest/semver), so the type a resource was born against is frozen at inception and replays identically.

> **Normative.** `authority` MAY be caller-supplied (accepted as given); when absent on a write it is SERVER-RESOLVED from `type` — an installed DEFAULT PACKAGE (the standard types) is consulted BEFORE a registry like IANA, and a `type` that resolves to neither is ad-hoc (authority absent / duck-typed). A service SHOULD cache the well-known media types so content resolution need not reach IANA.

```lumen
type Authority = ResourceRef
```

### `PackageRef`

A pinned reference to a Package resource — an Authority that is a package (a bead's authority).

```lumen
type PackageRef = ref<PackageBead>
```

## 1.5  The Resource shape

### `Resource`

The universal shape of a versioned resource — bead or not. Only `id`, `type` and `body` are always present; the rest is optional.

> **Normative.** Refining `Resource` directly adds top-level envelope fields — a new resource CATEGORY (contrast `Bead<T>`, whose refinements go into `body`).

| Member | Type | Description |
|---|---|---|
| `id` | `ResourceId` | The resource's identity. |
| `authority?` | `Authority` | Who names `type` — a package (bead) or a registry like IANA (content). Absent ⇒ ad-hoc / duck-typed. |
| `type` | `PathString` | The type PATH, resolved within `authority`'s namespace. |
| `body` | `any` | The content — raw for a bare resource; narrowed to a schema by `Bead<T>`. |
| `metadata?` | `Metadata` | Opaque per-resource sidecar the protocol does not interpret. |
| `provenance?` | `Provenance` | Who caused this revision, how its period began, and when. |
| `createdAt?` | `Timestamp` | The resource's birth time, denormalized onto every revision. |
| `storageClass?` | `StorageClass` | How the resource is kept — durable, ephemeral, or intrinsic. |

## 1.6  Metadata & provenance

### `Metadata`

Opaque, open per-resource (or per-call) sidecar — DATA the protocol does not interpret.

```lumen
type Metadata = { ...: any }
```

### `Provenance`

Who took part in the change that made a revision, how the Resource's present period began, and when. `previousRevision` is the before-image pointer — the basis for compensation — and rides in the post-image, so a ChangeEvent carries it for free.

> **Normative.** Provenance is DATA, not evidence — Core does not claim it is true. It describes ONE change and is not copied forward (the sole exception is `inception`). `committedAt` and `inception` are server-supplied, never caller input; a request that changes nothing records none, and one request that mints several revisions records provenance on EACH. A service MUST NOT invent a principal to fill an absent role; a caller cannot supply `basis` (`channel-authenticated` is service-assigned only, and `authority` then names that service).

| Member | Type | Description |
|---|---|---|
| `principals` | `[ Principal ]` | The principals who took part in the change. May be empty for observed or baseline revisions. |
| `inception` | `"create" \| "import" \| "revive" \| "unknown"` | How the Resource's present period began — freshly created, imported, revived after a delete, or unknown. |
| `committedAt` | `Timestamp` | When this revision committed; server-supplied, never request input. |
| `previousRevision?` | `Rev` | The before-image pointer — the basis for compensation. Null on create; structural lineage, often known even when the principals are not. |
| `message?` | `string` | An optional free-text note describing the change. |
| `metadata?` | `Metadata` | Per-revision opaque data (DATA, open). |

### `Principal`

An identity that took part in a change — a person, agent or service account. A role grants no permission; authorization is a separate decision.

| Member | Type | Description |
|---|---|---|
| `id` | `AbsoluteUri` | The principal's identity URI. Need not be resolvable. |
| `displayName?` | `string` | A saved human label — never identity, never a matching key. |
| `roles?` | `[ string ]` | Open set of roles this principal played in the change (initiator, contributor, submitter, …). A role grants no permission. |
| `basis` | `IdentityBasis` | How the service established this identity. |
| `authority?` | `AbsoluteUri` | The service that channel-authenticated this identity. |

### `IdentityBasis`

How a service established a principal's identity.

> **Normative.** OPEN union — a reader MUST tolerate an unrecognized basis. New authentication bases are added without a breaking change.

| Variant | Payload | Description |
|---|---|---|
| `"writer-supplied"` | — | The writer asserted the identity; the service did not verify it. |
| `"channel-authenticated"` | — | The channel authenticated the identity when the change arrived. |
| `"unknown"` | — | The basis is not recorded. |

### `StorageClass`

How a Resource is kept. Durable is replicated and exported; ephemeral is local and never exported; intrinsic is computed by the service, not stored (capability beads are intrinsic).

> **Normative.** A scope whose resources are not `Durable { versioned: true }` relaxes its write refs from `pinned` to `unpinned` (no revisions to pin), advertised in discovery.

| Variant | Payload | Description |
|---|---|---|
| `Durable` | `{ versioned: bool }` | Replicated and exported; `versioned` ⇒ prior revisions are retained and addressable. |
| `Ephemeral` | — | Local and never exported. |
| `Intrinsic` | — | Computed by the service, not stored. |

### `Timestamp`

RFC 3339 date-time; uppercase `T` and `Z`.

```lumen
type Timestamp is string
```

### `AbsoluteUri`

Any absolute URI — a Problem `type`, a Principal `id`; need not resolve. NOT a resource reference (those are `ref<T>`).

```lumen
type AbsoluteUri is string
```

### `SemVer`

A semantic-version string (a package's declared version).

```lumen
type SemVer is string
```

# 2. BEADS

A BEAD is a Resource whose body is TYPED and whose authority (when present) is a package. `Bead<T>` is the marker that narrows two envelope fields; refining it puts the subtype's fields under `body` — the FIREWALL. The four definitional bead kinds (Type, Channel, Operation, Package) are how BDP describes and distributes types, operations, and channels: the overlay system.

### `Bead`

A bead is a Resource whose body is typed, and whose authority (when present) is a package.

> **Normative.** `Bead` is the MARKER. Refining it (directly or transitively) narrows `body` to the subtype's schema — the FIREWALL: a bead's domain fields live under `body`, never alongside the envelope. `Bead<T>` narrows exactly two fields: `authority` to a package ref, `body` to `T`.

> **Normative.** The authority DISCRIMINATES bead vs content — a package ref (versioned, pinned) ⇒ bead; a registry ref (IANA, stable) ⇒ content. `authority` is still optional, so a bead MAY be duck-typed (authority absent).

| Member | Type | Description |
|---|---|---|
| `authority?` | `PackageRef` | Narrowed to a package ref; still optional (a duck-typed bead omits it). |
| `body` | `T` | The typed body — the firewall. Narrows `Resource.body` (`any` → `T`). |

Content is a BARE Resource — no narrowing: `type` is a media type named by a registry, `body` is raw bytes/text. (See the worked examples at the end.)

## 2.1  Types — the kind system, TypeBead & the value-schema

```
PATH = CHAIN. Bead subtypes use SINGLE inheritance; the `is` chain builds the
element path, which IS `type.id`, which IS `kind`:
  type Issue is Bead  { … }   → "issue"
  type Task  is Issue { … }   → "issue/task"
Only ONE `is` parent is allowed — that is what makes the path (a tree) unique.
```

- additive: a child has all parent fields plus its own
- narrowing-only override: narrow a type, or optional→required; never widen or drop — preserves substitutability (ref<Issue> may hold a Task)
- a same-named child field must be a narrowing, else a diagnostic
- `abstract?` on a TypeDef ⇒ not directly instantiable (a bead must use a leaf)

RESOLVER (Types-layer capability, NOT core): walk the pinned path base→leaf and merge per the rules — the path IS the plan. A pinned authority ⇒ the effective schema is immutable and cacheable. A cross-package parent is a `refines` ref the resolver follows across authorities.

CROSS-MODULE: a foreign name never enters the path. A cross-module `is` makes the child a LOCAL root whose `refines` holds a resolved ref (identity carries a ref, not a name). Within a module kind == schema-ancestry; across modules kind stays local and "is-a" is a `refines`-graph query (a capability), not a kind-prefix scan.

REFINEMENT vs UNION: refinement (`is`) = OPEN kind hierarchy, path-addressed; `union` = CLOSED value-level sum type.

### `TypeBead`

A bead whose body is a type definition — the type of a type.

```lumen
type TypeBead = Bead<TypeDef>
```

### `TypeDef`

The body of a TypeBead — one node in the single-`is` refinement tree.

> **Normative.** A type's element path is parent-path ⊕ its own name. A same-package parent is the path prefix (implicit); `refines` is set only for a cross-package parent. The Types resolver flattens the chain base→leaf per the §2.1 inheritance rules.

| Member | Type | Description |
|---|---|---|
| `refines?` | `TypeRef` | Cross-package parent only; a same-package parent is the path prefix. Null + no prefix ⇒ root. |
| `abstract?` | `bool` | True ⇒ not directly instantiable; a bead must use a leaf. |
| `properties` | `namedDeclarations` | The body's declared properties; inherited ones merge per the rules. |

### `namedDeclarations`

A list of named, typed declarations with required-ness — the shape of a record (a parameter list, a Type's property definitions).

```lumen
type namedDeclarations = [ { name: string, schema: BeadValueSchema, required: bool } ]
```

### `BeadValueSchema`

A type written DOWN as a value — the ref-preserving type representation. (A `schema` has no identity, so a type-as-value is a `schema`.)

> **Normative.** On EXPORT a BeadValueSchema lowers to a JSON Schema document (and an OpenAPI contract) for external consumers; the exported/wire form is byte-identical to the pre-BeadValueSchema JSON Schema, so the v0.2.0 freeze is NOT reopened. Only genuinely open DATA uses `{ ...: any }`; a written-down TYPE uses this.

```lumen
type BeadValueSchema =
    Scalar  { of: "string" | "number" | "bool" | "bytes" }
  | Literal { value: any }
  | Nominal { name: string, base: BeadValueSchema, refinement?: { ...: any } }
  | Record  { fields: [ { name: string, type: BeadValueSchema, required: bool } ], open: bool }
  | DU      { arms: [ { tag: string, payload?: BeadValueSchema } ] }
  | Union   { options: [ BeadValueSchema ] }
  | Array   { element: BeadValueSchema }
  | Set     { element: BeadValueSchema, on?: [ LocalName ] }
  | TypeRef { to: TypeRef }                                  // TYPES-PASS: was `to: Kind`
  | Opaque  { jsonSchema: JsonSchema }
```

### `LocalName`

A short identifier token for a view or a well-known name; leading letter.

```lumen
type LocalName is string
```

### `JsonSchema`

A JSON Schema document — the lowered/exported form of a type-as-value for external (non-BDP) consumers.

| Member | Type | Description |
|---|---|---|
| `text` | `string` |  |

--- element references (how one overlay element names another) ---

### `ElementRef`

A bundled reference to a package element — a package authority plus the element's relative path.

> **Normative.** `authority` is OPTIONAL — a same-package (relative) reference omits it, as `refines` does within a package. A resource's OWN type is this pair unbundled into its `authority` + `type` envelope fields; ElementRef is the standalone / cross-package form.

| Member | Type | Description |
|---|---|---|
| `authority?` | `PackageRef` | The package that names the element; absent ⇒ relative to the current package. |
| `path` | `ElementPath` | The element's package-relative path. |

### `ElementPath`

A package-relative element path (the single-`is` chain).

```lumen
type ElementPath = PathString
```

### `TypeRef`

A reference to a type element.

```lumen
type TypeRef      = ElementRef
```

### `OperationRef`

A reference to an operation element.

```lumen
type OperationRef = ElementRef
```

### `ChannelRef`

A reference to a channel element.

```lumen
type ChannelRef   = ElementRef
```

## 2.2  Channels & the streaming model — pull, push

A CHANNEL carries a sequence of events; `pull` reads it and `push` writes it. A read of any sequence (a channel, a scope listing, a resource's history, an export) is a `source<T>` — and BDP offers ONE streaming convention over it.

### `ChannelBead`

A bead whose body is a channel descriptor.

```lumen
type ChannelBead = Bead<Channel>
```

### `Channel`

The body of a ChannelBead — its two event schemas, direction, and delivery characteristics.

> **Normative.** `direction` and the two schemas are mutually constraining — `source` ⟺ pullSchema set & pushSchema null; `sink` ⟺ pushSchema set & pullSchema null; `duplex` ⟺ both set.

> **Normative.** A Channel bead's revision does NOT change when events arrive — the bead is not the stream. Appended events ride the channel's own stream, never the changefeed.

| Member | Type | Description |
|---|---|---|
| `pushSchema?` | `BeadValueSchema` | What `push` accepts; null on a source (pull-only). |
| `pullSchema?` | `BeadValueSchema` | What `pull` delivers; null on a sink (push-only). |
| `direction` | `"source" \| "sink" \| "duplex"` | The advertised facet — source · sink · duplex. |
| `retention` | `Retention` | How far back a cursor can resume. |
| `cardinality` | `"single" \| "broadcast"` | Delivery cardinality — single or broadcast. |

### `Retention`

How far back a cursor can resume; below the floor a cursor faults `cursor-expired` and the reader resyncs (list-bootstrap + follow from head).

| Variant | Payload | Description |
|---|---|---|
| `Forever` | — |  |
| `Window` | `{ by: "time" \| "count" \| "size", amount: number }` |  |
| `Compacted` | `{ window?: Retention }` |  |

--- the streaming model: source<T>, the three forms, cursors, windows --- A `source<T>` is a finite, resumable, ordered sequence of `T`. Four reads produce one: `pull` (a Channel), `list` (a scope's current resources), `revisions` (one resource's history), `export` (a scope backup). A reader consumes it in one of THREE transport forms (the `--format` / Accept arm):

```
  | form     | wire                   | valid on            |
  | windowed | application/json        | pull · list · export | one request → one Page (default)
  | bulk     | application/jsonl       | pull · list · export | whole source, one T per line
  | live     | text/event-stream       | pull only (live)     | follow the source as it grows
```

### `Ordinal`

An event's position in its stream; monotone within one Channel.

```lumen
type Ordinal is number
```

### `Cursor`

Opaque, transport-independent resume token, bound to one stream and the selection it came from; refused elsewhere. Also the point an export is cut at.

```lumen
type Cursor is string
```

### `Transport`

The transport projection a caller selects (the `--format` arm): windowed JSON pages, bulk JSONL, or live SSE. `sse` is valid only on a live source (pull); a snapshot (list/export) refuses it.

```lumen
type Transport = "json" | "jsonl" | "sse"
```

### `ReadRequest`

The input to a streaming read (`pull` / `list` / `revisions`) — where to resume, how much, the transport, and per-item shaping. `after` (a cursor) xor `from` (a fresh ordinal) are mutually exclusive. The target is the op's first parameter, not restated here.

| Member | Type | Description |
|---|---|---|
| `after?` | `Cursor` | Resume at an opaque cursor (exact). |
| `from?` | `Ordinal` | Start at a known ordinal (xor `after`). |
| `limit?` | `number` | Cap the window size. |
| `format?` | `Transport` | The transport form. |
| `filter?` | `ListFilter` | Filter the stream. |
| `select?` | `selector` | Project each event. |

### `Page`

One finite page of a stream — the windowed floor every service offers: one request, one page, nothing held open.

| Member | Type | Description |
|---|---|---|
| `items` | `[ any ]` | The items in this window (a Channel's E — ChangeEvent for the changefeed; items generally). |
| `cursor` | `Cursor` | Where to resume; opaque, bound to this stream + selection. |
| `head?` | `bool` | Caught up to the live edge? |

### `pull`

Read a Channel — the changefeed (well-known `/sys/changes`) or a declared stream — as a source of its `pullSchema` events. `--format` picks the transport (json windowed / jsonl bulk / sse live); one Cursor spans all three.

> **Normative.** Valid on a `source`/`duplex` channel; a `sink`-only channel faults `channel-not-pullable`. Faults `cursor-expired` below the retention floor.

| Parameter | Type | Description |
|---|---|---|
| `channel` | `unpinned<ChannelBead>` |  |
| `request` | `ReadRequest` |  |

**Returns** `Page`

### `push`

Write a Channel — consume a source of events (the channel's `pushSchema` type) and append them in order. The dual of `pull`, and the channel analog of scope `import`: skip-and-report under a PushStrategy, idempotent re-push. `jsonl` body (bulk); `sse` is pull-only.

> **Normative.** Valid on a `sink`/`duplex` channel; a `source`-only channel faults `channel-not-pushable`. A terminal (closed/failed) channel faults; a `single` channel caps the batch at one.

| Parameter | Type | Description |
|---|---|---|
| `channel` | `unpinned<ChannelBead>` |  |
| `source` | `source<any>` |  |
| `strategy?` | `PushStrategy` |  |

**Returns** `PushReport`

### `PushStrategy`

How `push` handles a rejected event or a re-push — the event analog of ImportStrategy (distinct: events, not resources).

| Member | Type | Description |
|---|---|---|
| `dedup?` | `bool` |  |
| `dryRun?` | `bool` |  |

### `PushReport`

What `push` reports — counts and any skipped/rejected events by ordinal.

| Member | Type | Description |
|---|---|---|
| `pushed` | `number` |  |
| `skipped` | `number` |  |
| `conflicts` | `[ { ordinal: Ordinal, reason: string } ]` |  |

## 2.3  Operations — call, cancel

An OPERATION is a DECLARED callable. `call` invokes it (sync or async); it is the ONLY primitive with the rich Outcome (a user Operation has a declared success/failure in its signature; the data primitives do not).

### `OperationBead`

A bead whose body is an operation descriptor.

```lumen
type OperationBead = Bead<Operation>
```

### `Operation`

The body of an OperationBead — the call contract, the implementation, and the behavioural guarantees.

> **Normative.** The effect markers (`pure`/`safe`/`idempotent`/`atomic`) are three-valued — present = a KNOWN guarantee, absent = UNKNOWN. `pure` ⟹ `safe`; `pure:true` + `safe:false` is a rejectable contradiction. The Lumen surface callable keywords lower to these fields (`fn` ⇒ pure).

| Member | Type | Description |
|---|---|---|
| `signature` | `Signature` | The call contract. |
| `implementation?` | `any` | The mounted AST. Present ⇒ STORED (ships in the pack) · absent ⇒ INTRINSIC (native). |
| `pure?` | `bool` | Known to neither read nor write external state. |
| `safe?` | `bool` | Known not to write (reads allowed); pure ⟹ safe. |
| `idempotent?` | `bool` | Known to be idempotent. |
| `atomic?` | `bool` | Known to commit as a single transaction. DEFERRED to the scheduler. |

### `Signature`

An operation's call contract — its interface, kept separate from the implementation and the effect markers.

| Member | Type | Description |
|---|---|---|
| `parameters?` | `namedDeclarations` | The input record — named, typed, required-flagged parameter declarations. |
| `success?` | `BeadValueSchema` | The success type (T). |
| `failure?` | `BeadValueSchema` | The declared failure type (E). |
| `async?` | `"no" \| "optional" \| "required"` | Async disposition — sync-only · caller-picks · async-only. |
| `creates?` | `bool` | Whether a successful call mints a resource → 201 + Location. |

--- the call protocol: correlation, request/reply, result/outcome/problem ---

### `Cause`

A correlation token naming the cause of a call — the cause-tree back-pointer.

```lumen
type Cause       is string
```

### `Frame`

A correlation token naming the calling frame — the call-tree back-pointer (diagnostic-tier).

```lumen
type Frame       is string
```

### `Transaction`

A correlation token shared across one commit.

```lumen
type Transaction is string
```

### `IdempotencyKey`

Caller-chosen key that makes a retried write safe to collapse onto the first effect.

```lumen
type IdempotencyKey is string
```

### `Request`

What a caller sends to `call`. `arguments` is a name/value list whose shape the Operation's `parameters` dictate.

| Member | Type | Description |
|---|---|---|
| `arguments` | `[ { name: string, value: any } ]` | The positional-by-name arguments, shaped by the Operation's `parameters`. |
| `async` | `bool = false` | Request async disposition (default sync). |
| `causedBy?` | `Cause` | The cause that triggered this call (correlation). |
| `calledBy?` | `Frame` | The calling frame (correlation, diagnostic-tier). |
| `provenance?` | `Provenance` | The caller's part of provenance only (principals/message/metadata); never server fields. |
| `idempotencyKey` | `IdempotencyKey` | Collapses a retried call onto the first effect. |
| `metadata?` | `Metadata` | Opaque per-call sidecar. |

### `Reply`

What a `call` returns — flat, no context wrapper. `outcome` keeps the domain `Result` nested in `Outcome`.

> **Normative.** The `outcome`'s `T` and `E` are those DECLARED by the target Operation's signature (`success` / `failure`); the envelope itself carries `Outcome<any, any>` and is narrowed only at the call site.

| Member | Type | Description |
|---|---|---|
| `outcome` | `Outcome<any, any>` | What happened — the domain Result or a non-domain fate. |
| `cause` | `Cause` | The cause this call ran under (correlation). |
| `frame` | `Frame` | The frame this call ran under (correlation). |
| `transaction?` | `Transaction` | The commit this call belonged to, if any. |
| `metadata?` | `Metadata` | Opaque per-reply sidecar. |

### `Result`

A callable's own verdict — succeeded with a value, or failed with its DECLARED error.

| Variant | Payload | Description |
|---|---|---|
| `success` | `{ value: T }` | Succeeded, carrying the value. |
| `failure` | `{ error: E }` | Failed with the DECLARED error (E). |

### `Outcome`

What happened to an invocation — the domain Result, or a non-domain fate.

> **Normative.** The non-domain set (`fault` · `canceled`) is OPEN — a reader MUST tolerate an unrecognized arm. This is the ONE sanctioned open union: the evolution surface for invocation fates (a closed union cannot gain arms). A domain failure is `Result.failure`; a non-domain failure is `fault`.

> **Normative.** A PRESENT `outcome` means the invocation is SETTLED, whichever arm it holds; a transient state (running/waiting) is NOT an arm. Each arm is an OPEN record — a reader MUST ignore a member it does not know. Only `success` means the operation went as intended.

| Variant | Payload | Description |
|---|---|---|
| `Result<T, E>` | — | The domain Result — success \| failure. |
| `fault` | `{ problem: Problem }` | An undeclared failure (NOT an E) — carries a Problem. |
| `canceled` | `{ reason?: string }` | kill -9 — runs no compensation. `timed_out` is a cancel reason, with the scheduler. |

### `Problem`

An RFC 9457 problem document — what a `fault` carries, and the body of a failing response from the data primitives.

| Member | Type | Description |
|---|---|---|
| `type` | `AbsoluteUri` | A URI naming the problem kind. |
| `title` | `string` | A short human summary. |
| `status` | `number` | The HTTP status code. |
| `code` | `string` | A stable, machine-readable problem code. |
| `retry` | `"never" \| "after-state-change" \| "after-delay"` | Whether a retry can help. |
| `detail?` | `string` | An optional human detail. |
| `instance?` | `AbsoluteUri` | An optional URI for the specific occurrence. |

### `AsyncResult`

The async result of one `call` — a handle you show for the record and `cancel` to kill. References a one-and-done source Channel that fires the Reply on settlement.

| Member | Type | Description |
|---|---|---|
| `operation` | `ref<OperationBead>` | The operation that was called. |
| `cause` | `Cause` | The cause this call ran under (queryable while pending, before `reply`). |
| `frame` | `Frame` | The frame this call ran under (queryable while pending). |
| `request` | `Request` | The original request. |
| `reply?` | `Reply` | The settlement, once it arrives (absent while pending). |
| `replyChannel` | `ref<ChannelBead>` | The one-and-done source Channel that fires the Reply on settlement. |

### `AsyncResultBead`

A bead whose body is an async-call handle.

```lumen
type AsyncResultBead = Bead<AsyncResult>
```

### `call`

Invoke an Operation. Sync (default) returns the Outcome directly (200 / 201+Location when `creates` / 409 on a declared failure / Problem status on `fault`). `?mode=async` returns 202 + the AsyncResult at Location; settle later. The ONLY primitive with the rich Outcome.

| Parameter | Type | Description |
|---|---|---|
| `operation` | `ref<OperationBead>` |  |
| `request` | `Request` |  |

**Returns** `Reply`

### `cancel`

kill -9 on a running AsyncResult — writes `reply.outcome = canceled`. Runs NO compensation (that is the scheduler's graceful path); its effects stay findable via `causedBy`.

| Parameter | Type | Description |
|---|---|---|
| `asyncResult` | `unpinned<AsyncResultBead>` |  |

**Returns** `pinned<AsyncResultBead>`

## 2.4  Packages

A PACKAGE is the authority that names a bead's type — a versioned bundle of overlay elements (type / operation / channel defs) and file assets.

### `PackageBead`

A bead whose body is a package.

```lumen
type PackageBead = Bead<PackageDef>
```

### `PackageDef`

The body of a PackageBead — its declared version and its elements.

> **Normative.** A package IS a resource; its canonical identity is its own `id` ({ scope:"uri", id:<url>, rev:<pin> }) — exactly what beads stamp as their `authority`. It is NOT restated in the body.

| Member | Type | Description |
|---|---|---|
| `semVer` | `SemVer` | The version this package declares; refs pin to a resolved one via their `rev`. |
| `elements` | `{ ...: Resource }` | Elements keyed by package-relative path; value = ANY resource — bead defs AND file assets. |

# 3. PRIMITIVES — the uniform set

Dispatch is implicit: a request routes to the target resource. Beads take client CRUD (create/put/patch/delete/list/revisions); the three model-specific primitives live with their models (§1.2 `get`, §2.2 `pull`/`push`, §2.3 `call`/`cancel`). This section is the UNIFORM write/read surface over any resource, then the export & change-notification cluster.

```
Conformance tiers (advertised per-scope, not the floor):
  minimal / read-only = get + list + changefeed pull + discovery
  full                = + create/put/patch/delete + call/cancel + export/import
```

Error model: a data primitive returns its success value and faults with a Problem. Writes return a pinned ref; reads a rep; `delete` a tombstone Rev. (Ruling §0.8.)

## 3.1  Write & read the resource store — create, put, patch, delete, list, revisions

### `IdRoot`

A prefix-rooted auto-id proposal (the server mints the leaf).

| Member | Type | Description |
|---|---|---|
| `prefix` | `string` |  |

### `Id`

An exact caller-proposed id.

| Member | Type | Description |
|---|---|---|
| `id` | `string` |  |

### `create`

Admit a new Bead. Caller-proposed id optional; fail-if-exists. Returns the created resource's pinned `ref` (rev = the minted revision); its URL in `Location`.

> **Normative.** `create` input is CLOSED — an envelope member Core does not define is REFUSED, not ignored (this does not reach inside `body`/`metadata`, which Core does not interpret). An id already in use, or used and retired, is refused with `identity-taken`.

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` |  |
| `requestedId?` | `IdRoot \| Id` | caller-proposed identity (no rev yet) |
| `type` | `PathString` | the bead's type PATH |
| `authority?` | `PackageRef` | caller MAY supply; absent ⇒ server-resolves from `type` |
| `body` | `{ ...: any }` | the bead's body — owned ref<T> props live here |
| `metadata?` | `Metadata` |  |

**Returns** `pinned<Resource>`

### `put`

Upsert / remember — idempotent full-state write. Create-or-replace; the lifecycle effect (create vs update) is what the changefeed reports. Returns the written pinned `ref` (rev = the new revision).

> **Normative.** A full-state write that changes nothing SUCCEEDS, keeps the revision, records no provenance, and produces no event; the reply carries no `transaction`.

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<Resource>` |  |
| `type` | `PathString` |  |
| `authority?` | `PackageRef` | caller MAY supply; absent ⇒ server-resolves from `type` |
| `body` | `{ ...: any }` |  |
| `metadata?` | `Metadata` |  |
| `ifRevision?` | `Rev` |  |

**Returns** `pinned<Resource>`

### `patch`

JSON Patch limited to /body and /metadata. Optional `--if-revision` (If-Match) gives optimistic concurrency; a stale revision faults `revision-mismatch`. Returns the patched resource's pinned `ref`. (JSON Patch is the base format; a richer patch format is an advertised capability.)

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<Resource>` |  |
| `patch` | `JsonPatch` |  |
| `ifRevision?` | `Rev` |  |

**Returns** `pinned<Resource>`

### `delete`

Retire a Resource, minting a final (tombstone) revision. Idempotent. Inbound references are owned by other beads' revisions, so they may dangle; a service that enforces referential integrity faults when inbound references pin it (advertised, not base). Returns the tombstone Rev, not a representation.

> **Normative.** Delete is NOT erasure — a deleted resource's id stays accounted for, its tombstone revision is kept with the delete's provenance (naming the last live as `previousRevision`), and the id is never reused. Delete touches exactly ONE resource and does nothing else; it changes no identifier and no kind.

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<Resource>` |  |
| `ifRevision?` | `Rev` |  |

**Returns** `Rev`

### `list`

A collection of CURRENT resources in a scope, as a source<rep<Resource>>. `where` is a ListFilter (the flat low bar every service supports); the full `filter`/`query` is a corelib capability. Snapshot — `--format json|jsonl`, no `sse`.

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` |  |
| `where?` | `ListFilter` |  |
| `select?` | `selector` |  |
| `request?` | `ReadRequest` |  |

**Returns** `source<rep<Resource>>`

### `revisions`

The history of ONE resource — id-targeted like `get`, list-shaped like `list`. `select` controls payload (ids-only vs full representations). Snapshot.

| Parameter | Type | Description |
|---|---|---|
| `resource` | `unpinned<Resource>` |  |
| `select?` | `selector` |  |
| `request?` | `ReadRequest` |  |

**Returns** `source<rep<Resource>>`

--- read-shaping & patch bodies (shared by the reads above) ---

### `selector`

A read projection over a representation — include/omit subtrees (JSON Pointer) and expand. Query-string, so a projected read has its own cacheable identity; `type`/`id` are never dropped.

| Member | Type | Description |
|---|---|---|
| `include?` | `[ JsonPointer ]` |  |
| `omit?` | `[ JsonPointer ]` |  |
| `expand?` | `[ LocalName ]` |  |

### `JsonPointer`

A JSON Pointer (RFC 6901) into a representation.

```lumen
type JsonPointer is string
```

### `JsonPatchOp`

One RFC 6902 operation. In `patch`, paths are limited to /body and /metadata.

| Member | Type | Description |
|---|---|---|
| `op` | `"add" \| "remove" \| "replace" \| "move" \| "copy" \| "test"` |  |
| `path` | `string` |  |
| `value?` | `any` |  |
| `from?` | `string` |  |

### `JsonPatch`

An ordered list of JSON Patch operations — the `patch` body, and a change-event patch payload.

```lumen
type JsonPatch = [ JsonPatchOp ]
```

### `ListFilter`

The low-bar list filter — a flat conjunction (AND) of simple field conditions, exactly the query-string-expressible set. The baseline every service supports; the full boolean/traversal `filter` is a corelib capability (query), not base.

```lumen
type ListFilter = [ listCondition ]
```

### `listCondition`

One flat field condition. `isKind` matches against the kind-path (`type.id`): `prefix` ⊑ (the "is it an issue(-ish)?" test), `exact` =.

| Variant | Payload | Description |
|---|---|---|
| `compare` | `{ field: FieldPath, op: "eq"\|"ne"\|"lt"\|"le"\|"gt"\|"ge"\|"in", value: any }` |  |
| `matches` | `{ field: FieldPath, pattern: string, using: "substring"\|"glob"\|"regex" }` |  |
| `has` | `{ field: FieldPath }` |  |
| `missing` | `{ field: FieldPath }` |  |
| `contains` | `{ field: FieldPath, value: any }` |  |
| `containsAny` | `{ field: FieldPath, values: [ any ] }` |  |
| `excludes` | `{ field: FieldPath, value: any }` |  |
| `isKind` | `{ kind: RelativeId, match: "exact" \| "prefix" = "prefix" }` |  |

### `FieldPath`

A field path as a segment array (disambiguates dotted keys); selector/patch keep JSON Pointer.

```lumen
type FieldPath = [ string ]
```

### `RelativeId`

A kind-path as a local id segment, relative to the scope (the target for isKind's prefix/exact match).

```lumen
type RelativeId is string
```

## 3.2  Export & change notification — the changefeed, then export/import

The live and bulk faces of the same thing: the CHANGEFEED streams every commit as a ChangeEvent; EXPORT serializes the same representations as a backup. Both carry a cut Cursor so a consumer resumes the feed from where a backup ends.

--- the changefeed: /sys/changes + ChangeEvent --- Each Scope has one built-in changefeed Channel (source; pullSchema = ChangeEvent) at the well-known id `/sys/changes`. Its events are what create/put/patch/delete commit; read it with `pull`.

### `ChangeEvent`

Core's report of one committed change to one Resource, as a top-level DU on lifecycle (a relationship change is an Updated to its source bead). `subject.rev` is the new (or tombstone) revision. Provenance rides in the post-image where there is one and is explicit where there is not.

> **Normative.** One commit produces exactly ONE event per resource changed, however many times the request touched it; a failed request and a no-change request produce NO event. An event is durable WITH its change — never committed without its event, never published for a change that did not commit. A change that arrives by replication MUST still appear on the changefeed. The full (post-image) encoding is required of every service; the patch encoding is optional (a reader that meets a patch it cannot apply re-reads the resource).

| Variant | Payload | Description |
|---|---|---|
| `Created` | — |  |
| `Updated` | — |  |
| `Deleted` | — |  |

### `ChangeEnvelope`

Fields common to every change arm; spread into each. `subject.rev` IS the new (or tombstone) revision — there is no separate revision field.

| Member | Type | Description |
|---|---|---|
| `ordinal` | `Ordinal` | Position in the changefeed, assigned on append. |
| `at` | `Timestamp` | When the change committed. |
| `subject` | `ResourceId` | The changed resource — { scope, id, rev }; `rev` is the new (or tombstone) revision. |
| `subjectKind?` | `PathString` | The subject's kind path, denormalized (derived from `type.id`). |
| `subjectType?` | `ref<TypeBead>` | The subject's type bead. |
| `transaction` | `Transaction` | Shared across one commit. |
| `cause?` | `Cause` | The cause this change ran under. |
| `causedBy?` | `Cause` | The parent cause — the cause-tree back-pointer. |
| `frame?` | `Frame` | The calling frame (diagnostic-tier). |
| `calledBy?` | `Frame` | The call-tree back-pointer (diagnostic-tier). |

### `Created`

A resource admitted. Full post-image; its provenance IS the representation's provenance.

| Member | Type | Description |
|---|---|---|
| `representation` | `rep<Resource>` |  |

### `Updated`

A resource changed. `content` is the orthogonal ENCODING axis — `full` carries a post-image (provenance rides in it), `patch` is a delta with explicit provenance.

| Member | Type | Description |
|---|---|---|
| `content` | `ChangeContent` |  |

### `Deleted`

A resource retired — the TOMBSTONE. No post-image, so provenance is explicit; `subject.rev` is the tombstone revision.

| Member | Type | Description |
|---|---|---|
| `provenance` | `Provenance` |  |

### `ChangeContent`

The change payload for Updated — full-vs-patch, the ENCODING axis (orthogonal to lifecycle).

| Variant | Payload | Description |
|---|---|---|
| `full` | `{ representation: rep<Resource> }` | a post-image; provenance rides in it |
| `patch` | `{ patch: JsonPatch, provenance: Provenance }` | a PATCH delta; no post-image → provenance explicit |

--- the export format (JSON Lines: begin, representations, end) --- A begin record, one Resource record per line (literally the result of `get` — a full representation, or every revision under `--revisions`), then an end record. A reader REFUSES a file that ends without the end record.

### `ExportRecord`

One line of an export.

```lumen
type ExportRecord = ExportBegin | rep<Resource> | ExportEnd
```

### `ExportBegin`

The opening line — the Scope and the cursor the export was cut at (where a consumer resumes the changefeed). Told apart from a Resource line by `kind`.

| Member | Type | Description |
|---|---|---|
| `kind` | `"export-begin"` |  |
| `scope` | `AbsoluteHttpUrl` |  |
| `cursor` | `Cursor` |  |

### `ExportEnd`

The closing line — a count of the Resource records, so a truncated file (one ending without this line) is detectable and never taken for whole.

| Member | Type | Description |
|---|---|---|
| `kind` | `"export-end"` |  |
| `count` | `number` |  |

### `export`

Bulk read of a scope as JSONL — current state by default; `--revisions` emits every revision in order (a true backup: createdAt, every committedAt, the previousRevision chain survive). Selection ⊆ ListFilter. Reads from the authoritative revision store, so it is a backup even when the live changefeed is compacted. Consistent as of a cut Cursor.

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` |  |
| `where?` | `ListFilter` |  |
| `select?` | `selector` |  |
| `revisions?` | `bool` |  |

**Returns** `source<ExportRecord>`

### `ImportStrategy`

How `import` merges — strategy and id remap.

| Member | Type | Description |
|---|---|---|
| `dedup?` | `bool` |  |
| `allowStale?` | `bool` |  |
| `dryRun?` | `bool` |  |
| `idRoot?` | `string` |  |

### `ImportReport`

What `import` reports — counts and any skipped/conflicted records.

| Member | Type | Description |
|---|---|---|
| `imported` | `number` |  |
| `skipped` | `number` |  |
| `conflicts` | `[ { id: ref<Resource>, reason: string } ]` |  |

### `import`

The bulk WRITE path — put/create under If-Match with id remap; a history file is replayed in commit order to rebuild the chain (history-restore), else it sets current state. Not a filter op.

| Parameter | Type | Description |
|---|---|---|
| `scope` | `Scope` |  |
| `source` | `source<ExportRecord>` |  |
| `strategy?` | `ImportStrategy` |  |

**Returns** `ImportReport`

## 3.3  The primitive set & conformance tiers (a map, not a re-definition)

Each primitive is DEFINED once, at its anchor. This is the index.

```
  | primitive  | target     | defined in | tier    |
  | get        | resource   | §1.2       | minimal |
  | list       | scope      | §3.1       | minimal |
  | pull       | channel    | §2.2       | minimal (changefeed) |
  | create     | scope      | §3.1       | full    |
  | put        | resource   | §3.1       | full    |
  | patch      | resource   | §3.1       | full (advertised) |
  | delete     | resource   | §3.1       | full    |
  | revisions  | resource   | §3.1       | full    |
  | call       | operation  | §2.3       | full    |
  | cancel     | asyncResult| §2.3       | full    |
  | push       | channel    | §2.2       | full    |
  | export     | scope      | §3.2       | full    |
  | import     | scope      | §3.2       | full    |
```

Well-known resources (addressed by convention): /sys/changes — the scope's changefeed Channel (source; pullSchema = ChangeEvent)

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
    storageClass: Durable { versioned: true } }
  // kind (derived) = type.id = "issue/task"
```

```
--- a content resource on the wire (text/plain) — a bare Resource ---
  { id:        { id: "assets/readme.txt", rev: "r1" },                 // scope absent ⇒ local
    authority: { scope: "uri", id: "https://www.iana.org/assignments/media-types" },
    type:      "text/plain",
    body:      "Hello, world.\n",                                      // raw, flat — no firewall
    metadata: {}, provenance: { … }, createdAt: "2026-11-02T09:00:00Z",
    storageClass: Durable { versioned: true } }
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

The lowering is DETERMINISTIC and structure-preserving: a Lumen declaration and its JSON Schema are the same shape. The ONE thing that does not round-trip is NOMINAL IDENTITY — two structurally-equal `type`s are distinct in Lumen but identical in JSON Schema (which is structural). So the map is an isomorphism on STRUCTURE; identity is the quotient it factors out. On the wire a Resource carries only `type` (a path), never its Lumen type name.

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
  OPEN union (Outcome, IdentityBasis)  same oneOf, NO closed/unevaluated gate —
                                      a reader MUST tolerate an unrecognized arm
  ref<T>                            { "$ref": "#/…/ResourceRef" }   (T erases)
  rep<T>                            { "$ref": "#/…/Resource" }      (T erases)
  pinned<T> / unpinned<T>           ResourceRef with "rev" required / null
  Bead<T>                           Resource with "body" = T's schema
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
--- normative & context → prose / headers ----------------------------------
  /// normative: …        one numbered MUST / SHOULD / MAY line in the generated
                          reference, plus an x-normative note on the lowered schema/op.
  BDP-* context           lowers to request/reply HEADERS (Appendix B), never to
                          the URL or body — the body carries the value, the headers
                          the context.
```

# Appendix D. HTTP binding (harvested from the prose Core, §12 / §13.2)

Status caveat: in the prose only create-on-Scope, the `call` form, and `failure ⇒ 409` are HARD-ruled; the other status codes are settled here.

```
--- request context (headers — never the URL or body) ---------------------
  BDP-Cause        a bare cause token
  BDP-Provenance   the caller's provenance part, as JSON (ASCII, escaped)
  BDP-Metadata     per-request metadata, as JSON
  Rules: ONE header per member; each appears AT MOST ONCE; header names use
  hyphens, never underscores. The three together have a floor of 4096 bytes a
  Scope MUST accept (its max is advertised); oversize ⇒ `request-too-large`,
  never truncated. A browser EventStream reader sends no request context —
  allowed, since every member is optional.
```

```
--- reply context (response headers) ---------------------------------------
  BDP-Cause        always present
  BDP-Transaction  present ONLY where the request made exactly one commit
  BDP-Metadata     per-reply metadata
  The body is the value alone; the context rides in the headers.
```

```
--- content types ----------------------------------------------------------
  application/json              a value / one windowed page
  application/jsonl             bulk stream (pull / list / export; push / import body)
  text/event-stream            live pull (SSE); the SSE event id IS the cursor, so a
                               reconnect's `Last-Event-ID` resumes exactly as `after`
  application/json-patch+json  the `patch` body (RFC 6902; paths /body and /metadata)
  application/problem+json     every failing body (RFC 9457 Problem)
```

```
--- status codes -----------------------------------------------------------
  200  get / put / patch / list / revisions / pull success; call → outcome success
  201  create success, and a call whose Operation `creates` — Location: the new URL
  202  call ?mode=async — Location: the AsyncResult URL; body: no outcome yet
  409  call → a DECLARED failure (ruled); also some Problems (e.g. revision-mismatch)
  412  stale If-Match on put / patch / delete (Precondition Failed)
  405  pull / push on the wrong channel direction; patch where a Scope offers no PATCH
  410  get of a pruned / erased resource; pull below the retention floor (cursor-expired)
  4xx/5xx  any fault — the body is the Problem, carried at the Problem's own status
```

```
--- Problem codes (RFC 9457 `code`) ----------------------------------------
  malformed-request · invalid-parameter · unauthenticated · forbidden ·
  resource-not-found · resource-pruned · resource-erased · revision-mismatch ·
  identity-taken · validation-failed · type-not-installed · cursor-expired ·
  request-too-large · limit-exceeded · rate-limited · temporarily-unavailable ·
  capability-not-supported · callable-not-found · callable-unavailable ·
  mode-not-supported · mode-refused
```

# Appendix E. Conformance — what a Core service MUST provide

A conformance suite is built from this spec, not from any implementation. Each `/// normative:` line above is a conformance point; the list below gathers the store-wide guarantees (harvested from the prose Core §10).

1. A stable identity per resource — never reused, never changed; opaque local part.
2. A type per resource — the (authority, type) pair, frozen at inception.
3. A body and metadata it stores and does NOT interpret.
4. A storage class per resource — Durable { versioned } | Ephemeral | Intrinsic.
5. A revision per resource that changes EXACTLY when its state changes.
6. History where offered — prior revisions addressable; offered or not, discoverable.
7. A transaction marker shared by everything committed together.
8. A cause minted ONCE per incoming request, stamped on every effect it sets off.
9. A durable change record per resource per commit — none for a failed or no-change request.
10. Provenance saved with the change, immutable, never invented.
11. A changefeed at /sys/changes carrying every commit (replication included).
12. An export consistent with itself, with the cursor that matches it.
13. An authorization view — a hidden resource reads EXACTLY as a missing one.
14. Deletion that does not erase — the id stays accounted for, the tombstone is kept.

Discovery advertises, per scope: the primitives offered; whether history / PATCH / push are offered; which storage classes `create` accepts; which invocation modes are refused; the max request-context size; and where the changefeed is. A request that needs an un-offered capability is refused `capability-not-supported`; an optional feature is never half-present.
