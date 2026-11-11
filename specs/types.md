---
status: draft
intended-status: normative
version: "0.2"
---

# Beads Protocol — Types

Working draft v0.2.

Types is the Beads Protocol's optional interpretation layer. [Core](core.md) is raw data
access: it stores and returns Beads and Links, knows that every Resource names a Type and that
some Beads are type beads, callables or event sources, but interprets none of it. Types defines
what those beads mean — the type system, the descriptor that governs a Resource's `properties`,
the declaration shapes for callables and event sources, the representation a `get` returns for
each, and the rules a store applies above Core's raw access. A service that uses only Core's six
primitives needs nothing here; a service that wants typed Beads, constraints, callables or
streams reads this document.

## 1. About this draft

### 1.1 Status markers

Each section carries a status line. **ruled** — the design authority has decided it.
**proposed** — a first design, not yet ruled. **carried** — carried from v0.1 Types, still
in force. **open** — named but undecided. No line means carried.

### 1.2 Two layers

Types reads in two layers, and they are meant to be separable:

- The **built-in declaration shapes** (sections 6–7): the type bead, Callable, EventSource
  and AsyncResult shapes, and what `get` returns for each. A service that offers the six
  primitives and a handful of callables implements these **without** the rest.
- The **type system** (sections 2–5): user-defined types, nominal conformance, refinement,
  and the descriptor constraints that govern instances. A service needs this only when it
  defines its own types or constrains its graph.

Exact affiliation with a well-known Type lives in the built-in layer. `refines` — declaring
a Type that specializes another — is the single opt-in into the full type system.

### 1.3 Conformance

Status: proposed.

Conformance cases are required for **ruled** and **carried** sections and land as each
**proposed** section is ruled: the specification may run ahead of an implementation, and it
may not run ahead of its conformance suite. The suite meant is the **live conformance kit**,
which grows as sections are ruled; the frozen historical catalogs stay pinned as they are
and are not governed by this rule. (Mirrors Core §1.4.)

## 2. Type beads and affiliation

Status: carried.

Every Resource names a Type through its distinguished `type` field (Core's data model): an
absolute HTTP(S) identity URI, or a closed object `{ "uri": URI, "revision": TOKEN }` that
pins an exact definition revision. Affiliation is this field, never a Link; following a
Resource's incident Links does not follow `type` into the type graph, and a Resource's
reference to its definition Bead creates no edge, ownership or permission.

A Type definition is itself a Bead. Its `properties` object **is** its descriptor (section 3).
Under Types, a stored or returned instance pins its exact Type definition revision; an
explicit unpinned Type input resolves through the Scope's installed exact default before
commit, and refuses if there is none. A later published change to either the Type identity
or its pinned revision mints a new instance revision, even when properties are unchanged.

Two metatypes classify definitions: **BeadType** governs Bead instances, **LinkType** governs
Link instances. Both are Bead Types. A definition's category is fixed by the effective Type
set of its own `type` affiliation; a definition affiliating with both categories is refused.
The common **Type** is abstract (direct instances refused); usable definitions affiliate with
BeadType, LinkType, or a refinement of exactly one.

## 3. The descriptor

Status: carried.

The descriptor is an open JSON object except for the reserved names below. Its
`propertiesSchema` validates an instance's `properties`, never the Resource envelope.

**Common fields** (both categories):

| Field | Shape | Meaning |
| --- | --- | --- |
| `description` | text | Human explanation; identity comes from the definition Bead's id, not this. |
| `title` | text | Short human label; uniform across type beads, callables and event sources. |
| `propertiesSchema` | Draft 2020-12 schema or boolean | Local constraints on instance `properties`. Absence adds none; ancestors still apply. |
| `schemaResources` | map of absolute URI → schema | External schemas this descriptor's `$ref`s depend on, retained by value with this edition for exact offline resolution (§3.1). |
| `version` | SemVer text | Informational author label; not a revision, default or compatibility proof. |
| `abstract` | boolean, default false | True forbids direct affiliation with this exact definition, not its refinements. |
| `final` | boolean, default false | True forbids any Type from refining this definition. Pairs with `abstract` (Lumen's `final` / `abstract`). |
| `propertyAccess` | map of JSON Pointer → `writable` \| `init-only` \| `read-only` | Member write policy, independent of value schema (§3.2). |

**Category-specific:** BeadType adds `incoming`, `outgoing` (participation constraints —
`{ linkTypes, min?, max? }` bounding incident Link families) and `ownsOutgoing` (the outgoing
families instances own). LinkType adds `linkConstraints` (section 5). BeadType prohibits
`linkConstraints`; LinkType prohibits the three BeadType fields.

A **Type reference** is an absolute HTTP(S) URI (identity across revisions) or
`{ "uri", "revision" }` (an exact edition). A **selector** is `{ "anyOf": [ref, …] }` (a union)
or `{ "any": true }` (no restriction). The descriptor reserves `id`, `revision`, `type`,
`ownedLinks`, `refines`, `source`, `target` and similar envelope names; they cannot be
smuggled into the open object.

### 3.1 schemaResources

A `propertiesSchema` may `$ref` other schemas by absolute URI. `schemaResources` maps each
such URI to the schema's value, captured with this definition edition so interpretation is
exact and offline: a later change to the external schema at its address does not change what
this revision means. Absence supplies no external resources.

### 3.2 propertyAccess

`propertyAccess` governs **who** may write a property, independent of its value schema.
`writable` — the client may set and change it. `init-only` — set at creation, immutable after.
`read-only` — the client may not write it; the service owns the value and may change it (so it
is read-only *to the client*, not immutable — unlike `init-only`, which freezes after creation). The mode governs the writer, not whether
a change mints a revision: any actual value change — by client or service, including a
read-only one — mints a new revision (the revision is the ETag, over the whole
representation). A metadata change revisions it too; there is no field, in `properties` or
`metadata`, that changes without minting a revision.

### 3.3 Local contribution and the effective schema

Status: **proposed** (pinned with Lydia for M6).

`propertiesSchema` holds only the definition's **local** structural contribution — its own
record body, plus any **inline** shape written directly in a conformance list (`is T, { … }`,
whose anonymous fields have no definition to point a Link at, so they live here). A **named**
parent's fields are never copied in; the parent rides in the definition's owned Refines Links
(section 4), which carry the nominal identity. Parents must share the definition's category
(§4); inline shapes are structural and exempt.

A definition's **effective** (validation) schema is `allOf(` its local `propertiesSchema`, the
effective schema of each Refines target `)`, computed by **walking the owned Refines Links on
read** — never materialized into the stored descriptor. A change to a parent's fields then flows
to every refiner for free, and the stored shape stays a single source of truth, matching the
conformance law (`type X is T` holds iff every X-value satisfies `v is T` — the Link is that
law's carrier, the structural obligation its consequence). Each field carries `x-definedBy`
naming the definition it came from (an inline shape's fields are the definition's own,
`x-definedBy` = the definition). Two parents whose fields disagree make the effective `allOf`
unsatisfiable, so the type is uninhabited — a checker concern, separate from this shape.

A store **may** expose a derived *resolved* schema (the materialized `allOf`, `x-definedBy`
preserved per field) for readers that do not walk the graph — explicitly marked derived,
regenerated on read, never the stored source of truth.

## 4. Conformance: Refines and owned Links

Status: carried. Owned Links **ruled to stay** (design authority, 2026-11-11).

Direct conformance is declared by an **owned Refines Link** from one definition Bead to
another, pinning the exact target definition revision. The authoritative declarations for a
definition revision are the Link representations captured in that revision's owned-Link state;
there is no separately writable `conformsTo` field. Conformance resolves by exact revision at
every step — follow the captured Link, its pinned Link Type, its pinned target, then that
target's captured owned declarations — so a definition's contract is historical, not read off
live adjacency. Creating or editing a declaration has owner-revision effects on its source.

A conforming Type may only tighten: it may add properties and requirements, never relax an
ancestor's. Both endpoints of a Refines Link are definition Beads whose described instance
kinds must agree (no BeadType-to-LinkType conformance).

> The replacement for owned Links is deferred to a later version; v0.2 does not close without
> at least a plan for it (Core §15). Until then they stand as v0.1 defines them.

## 5. Links and link constraints

Status: **ruled** (shape — multiplicity in the edge, `{min, max}`, `reflexive`; design
authority 2026-11-11); details proposed. `linkConstraints` is the LinkType descriptor's
required closed object. Multiplicity lives on the endpoints, inside each edge.

```json
"linkConstraints": {
  "unique":    false,
  "acyclic":   false,
  "reflexive": true,
  "edgeConstraints": [
    {
      "source": { "types": { "anyOf": [ { "uri": ".../issue", "revision": "issue-1" } ] },
                  "scope": "same", "multiplicity": { "min": 0 } },
      "target": { "types": { "anyOf": [ { "uri": ".../issue", "revision": "issue-1" } ] },
                  "scope": "same", "multiplicity": { "min": 0, "max": 1 } }
    }
  ]
}
```

- **`edgeConstraints`** (required, non-empty, distinct) — the union of allowed typed edges.
  Each is a `{ source, target }` pair; an instance is admitted if it matches any one pair.
  This is `edge(S, T)`: `S` and `T` are the endpoints' `types` selectors.
- Each **endpoint** carries `types` (a selector, or the opaque form `{ "resourceKind": "resource" }`
  for an external resource), `scope` (`same` \| `cross` \| `either`, its Scope relation to the
  storing Scope), and **`multiplicity`** `{ "min", "max"? }` — how many family Links the endpoint
  bears; omitted `max` is unbounded. This is the Kleene arity of `edge(S*, T?)`, projected:
  `*`→`{min:0}`, `?`→`{min:0,max:1}`, `+`→`{min:1}`, `1`→`{min:1,max:1}`.
- **`unique`** (boolean) — ordered endpoint-pair uniqueness across the family.
- **`acyclic`** (boolean) — directed acyclicity of the family (a per-Link promise).
- **`reflexive`** (boolean) — `true` permits self-links (equal source and target identities,
  ignoring revision); `false` prohibits them.

Markers and graph constraints apply to the **combined family**, not per edge alternative. A
local `false` or omission never disables an inherited restriction. Constraints are validated
at transaction commit against the final atomic graph.

This is the whole of the structural layer. Lumen's `edge(S, T)`, its Kleene arity and its
markers are the **source form**; every one of them projects onto a field here at M6. BDP's
type system is nominal — Types are Beads, affiliation is `type`, conformance is Refines — and
carries no structural type constructor of its own.

## 6. Built-in declaration shapes

Status: **proposed** (new; the surface moved from Core per the design authority, 2026-11-11).
These are the declarations Core stores but does not interpret. A `get` on any of them returns
the representation and never invokes or subscribes.

### 6.1 Callable

A Bead is a **Callable** when its Type is the well-known Callable Type or refines it — a
callable is a value `(P) -> R` whose return `R` is Core's `Outcome<T, E>` (Core §4.4). The
declaration, in its `properties` (beside common `title` / `description`, §3):

| Field | Shape | Meaning |
| --- | --- | --- |
| `parameters` | `[ { name, schema, required?, default?, description? } ]` | Argument contract (`P`). Core treats a call's `arguments` as opaque JSON; Types checks them against this. |
| `resultSchema` | schema | The `T` — the value of Core's `success` arm. |
| `errorSchema` | schema | The `E` — the declared `failure` arm (ran to completion, bad result in contract). |
| `modes` | `[ "sync" \| "async" ]` | Advertised invocation modes; omitted means `sync`. The caller chooses with Core's `mode`; the two refusals (`mode-not-supported`, `mode-refused`) are Core's. |

Checking a call's `arguments` against `parameters`, and its result against the declared
schemas, is a Types-layer rule above Core (section 8). **Attribution is not a declaration
field:** a call's principals arrive in Core's request-context provenance and flow through the
call to every revision it mints; whether a callable may add principals of its own is open
(Core item 12).

The return is Core's `Outcome<T, E>`; a declaration supplies `T` and `E` and nothing more.
Core's `fault` arm (a Problem, for a call that could not run to completion) is a **system arm** —
a callable never declares, narrows or omits it, and new arms come only from Core. (Arm names:
`success` / `failure` / `fault` — ruled, Donna 2026-11-11. `success` and `failure` are
*declared* outcomes that ran to completion; `fault` is the *undeclared* case — a call that did
not run to completion, including one that never started or timed out — carrying a Problem. Core
uses the same names (`Result<T, E>` = `success`{value} | `failure`{error}, Core §4.4).)

**Kinds.** A callable is a **function** or a **command** — nominal refinements of Callable (the
same move as bead / link refining resource), declared by refining the matching well-known Type
(section 9). (The pure kind is named `function` provisionally — its final name is open, item 5;
`read-only` now names a property mode, §3.2, and is not reused here.)

- **function** — the call takes **no write capability**: it may read, but mutates nothing, so it
  is repeatable and usable where a read is. That contract — no write capability — is exactly what
  makes Lumen's `function` pure, so BDP `function` and Lumen `function` coincide in both
  directions. A call that mutates any state is a `command`, never a function. A function carries
  neither `idempotent` nor `atomic`: being pure, it is inherently repeatable and transaction-free.
- **command** — effectful. A command may declare `idempotent` (retrying is safe) and `atomic`
  (the invocation's changes commit in one transaction — Core §5.9, open item 37).

(Lumen's `formula` — a reactive, recomputing callable — is a language kind only; it is not
modeled as a BDP callable kind.)

### 6.2 EventSource

A Bead is an **EventSource** when its Type is the well-known EventSource Type or refines it.
The bead is not the stream; its events do not change its revision.

| Field | Shape | Meaning |
| --- | --- | --- |
| `eventSchema` | schema | One event's shape. The changefeed's declaration names Core's change-event schema; other streams' event content is opaque to Core. |
| `eventRetention` | `{ window, minCursorLifetime? }` | Retention statement; the behaviour (hard failure below the floor, held cursor good for a stated minimum) is Core's. |
| `cardinality` | `single` \| `broadcast` | Reader model; the two values' meaning and the no-competing-readers rule are Core's. |

### 6.3 AsyncResult

Status: **proposed**. The transformation from a callable's declaration to the shape of its
result bead is Types' (design authority: "the transformation on the async result").

AsyncResult is a well-known, refinable Type; a result bead's `properties` are
`{ context, outcome? }`. The transformation is one line: the result bead holds Core's
**`Reply<T, E>`** for the same `T` and `E` the callable declared — the Reply the same call
would have returned synchronously. A result bead names its callable through a **`ResultOf`** owned Link
(source the result bead, target the Callable pinned to its revision at admission); following
it reaches the declaration edition. A declaration names a refinement of AsyncResult as the
Type of its result beads.

## 7. GET representations and the rules

Status: **proposed**.

Core returns a Resource's representation — `id`, `kind`, `type`, `revision`, storage class,
`properties`, `metadata` — and interprets none of it. Types defines, per well-known kind, how
to read that representation:

- **Type bead** → a definition: the descriptor is its `properties` (sections 2–5).
- **Callable** → a declaration (§6.1); `get` never invokes.
- **EventSource** → a declaration (§6.2); `get` never subscribes.
- **AsyncResult bead** → a Reply in the declared result / error shapes (§6.3).

## 8. Type-check rules

Status: **proposed**.

A Types-aware layer above Core MAY refuse a `create`, `update` or `call` whose instance,
arguments or result violate the governing descriptor or declaration, with Core's problem
codes `validation-failed` and `type-not-installed` and Core's Problem carrier. Core itself
checks nothing. Whether Core alone requires anything of a `type` it cannot resolve is open
(Core item 30).

**Type-declared delete effects.** Status: **ruled** (design authority, 2026-11-11). The
`delete` primitive only deletes; it consults no Type. It refuses with `incident-links-exist`
while a live Link is attached — a Core structural rule, not Type-driven. The fuller delete
(several Beads, attached Links, cascade, dry run) is a **core-library callable**. So v0.1's
`typeEffects` re-home: cascade and endpoint policy move to that callable; a "may not delete
while X" Type constraint becomes a **Types refusal rule**, checked above Core. A definition
Bead that carries owned Refines Links is subject to the same `incident-links-exist` refusal;
its owned declarations are removed first, or through the delete callable. v0.1 `typeEffects`
are retired, not carried.

## 9. Well-known Types

Status: carried (pattern) / **proposed** (new identities).

Well-known Types are named by **fixed HTTPS URLs used as identity, not location**, under
`https://github.com/gastownhall/bdp/types/…`, with opaque publication revisions; any service
may serve a copy of the type bead. This is the existing v0.1 pattern (Type, BeadType, LinkType,
Refines under `…/type-system/`), extended:

| Type | Role | Status |
| --- | --- | --- |
| `Type`, `BeadType`, `LinkType`, `Refines` | the type system | carried |
| `Callable` | §6.1 | proposed |
| `Function`, `Command` (refine `Callable`) | §6.1 kinds (pure name provisional) | proposed |
| `EventSource` | §6.2 | proposed |
| `AsyncResult` | §6.3 | proposed |
| `ResultOf` (Link Type) | result bead → callable | proposed |

Core names these identities; Types defines their shapes. The exact well-known base is a
placeholder pending the registry agreement with Core (Core item 23).

## 10. Conformance kit, projection and open items

Status: **proposed**.

**Projection to Core.** Types sits entirely above Core's raw data access. Core stores and
returns representations; Types interprets them. Nothing in Types changes a primitive's
behaviour; it adds the refusals of section 8 and the readings of section 7.

**Kit divergences from v0.1** (marked, kit untouched): a final revision on every `delete`
(Core §5.6), and provenance as principals-and-roles in place of a single `actor` (Core §3.2).
The JSON-Schema-expressible sub-suite is flagged so `propertiesSchema` validates on the same
oracle that proves cross-implementation parity.

**Open items.** Ruled 2026-11-11: `{min, max}` multiplicity; `reflexive`; delete-stays-bare;
Outcome arms `success`/`failure`/`fault`; `Refines` kept (layer split with Lumen `is`); the pure
callable kind = no write capability (its name is open, item 5); `service-managed` property mode
renamed `read-only`.

1. Alias resolution in `get` — whether it leaves `get` for a core-library callable or is an
   identity-layer concern; Core cannot read a bead's type-governed `properties`. Melinda has a
   stake (it decides her callable surface). Design authority to rule.
2. Whether a callable may add principals of its own (Core item 12).
3. **Reference modeling** — representing a reference internally as a `(scope, id, version)`
   triple (the URI, with ETag / `?revision=`, is the web-edge encoding), to simplify scope-local
   references. A Core identity-model convention (with Eva); no wire change — the `type`-is-a-URI
   rule holds at the edge.
4. **`atomic` carriage** — how a service-carried callable gets its single transaction (and
   pack-supplied callables) is Core §5.9 open item 37; the Command `atomic` property points there.
5. **Callable-kind name** — the pure, no-write-capability kind is provisionally `function`
   (Lumen-aligned); Donna wants a better name. `query` is the CQRS option but collides with BDP's
   graph query.
