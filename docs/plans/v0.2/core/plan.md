# Plan: Core

Area `core/` — owner Eva. The generic bead-and-link protocol that every other area builds on.
This area was called `graph/` until 2026-11-09; Donna renamed it and reshaped it in her live
review. It follows the same mould as `types/`: **spec, conformance, implementation**, each
split by facet into **bdp** (the protocol), **go** and **cli**.

**Composition versus dependency.** The nesting below is composition — a parent's state is
`all(children)`. The build order is the `after(...)` edges, which run node to node and cross
the tree. They are not the parent/child structure.

**Syntax versus semantics.** The BDP spec is mostly semantics: what a representation means and
what each operation does. Its syntax is two thin projections onto languages that already
exist — JSON Schema for the data shapes, OpenAPI for the operations. This plan builds no new
description languages.

**Begin versus complete.** Edges are pinned to the subnode a node needs, so work can begin
early. Where a node can start early but cannot *finish* until something else is done, the
gate is a child node (see `impl/reference`).

## Plan

```
plan: all {

  // Specs — the BDP spec leads; the Go and CLI specs begin after its keystone
  spec: all {

    /// title: BDP spec — semantics, plus two thin syntax projections
    bdp: all {
      /// title: Data model — beads, links, the rep envelope (the keystone)
      data-model
      /// title: Execution model — transaction, cause, call context, Reply and Outcome
      execution: after(data-model)
      /// title: Primitives — get, create, update, delete, call, pull
      primitives: after(data-model, execution)
      /// title: Storage — storage class, the cursor, retention
      storage: after(data-model)
      /// title: Identity — the alias model, resolution, link identity, annotations
      identity: after(data-model)
      /// title: Provenance — attribution and lineage
      provenance: after(identity)
      /// title: Callables — declaration, sync and async call, AsyncResult
      callables: after(primitives)
      /// title: Events — event sources, pull, replay
      events: after(primitives, storage)
      /// title: Optionality — per-endpoint capability declaration
      capability-decl: after(primitives)
      /// title: JSON Schema projection — the data shapes (the only syntax for representations)
      json-schema: after(data-model)
      /// title: OpenAPI projection — the operations (the only syntax for the primitives)
      openapi: after(primitives)
    }

    /// title: Go spec
    go: all {
      /// title: Go design doc — the Go API surface for the core
      design-doc: after(spec/bdp/data-model, spec/bdp/primitives)
    }

    /// title: CLI spec
    cli: all {
      /// title: Canonical CLI — the core commands
      canonical-cli: after(spec/bdp/data-model, spec/bdp/primitives)
    }
  }

  // Conformance tests — one suite per facet
  conformance: all {
    /// title: BDP (protocol) conformance — the Core and Events cases
    bdp: after(spec/bdp)
    /// title: Go conformance
    go: after(spec/go, conformance/bdp)
    /// title: CLI conformance
    cli: after(spec/cli, conformance/bdp)
  }

  // Implementation — outside the spec; depends on spec subnodes
  impl: all {
    /// title: Reference implementation — the bdp-facet implementation, with its storage
    reference: all {
      /// title: Build — begins once the keystone and the primitives are specified
      build: after(spec/bdp/data-model, spec/bdp/primitives)
      /// title: Conformant — complete only when BDP conformance passes
      conformant: after(build, conformance/bdp)
    }
    /// title: Go implementation — the Go APIs; bindings generated from the OpenAPI projection
    go: after(spec/go, spec/bdp/openapi, conformance/go)
    /// title: CLI implementation
    cli: after(spec/cli, conformance/cli)
  }
}
```

## Where the old `graph/` nodes went

| Old node | Now | Why |
|---|---|---|
| `graph/dsls/json-schema`, `callable`, `eventsource` | `core/spec/bdp/json-schema`, `core/spec/bdp/openapi` | No new DSLs. Syntax is a projection onto JSON Schema and OpenAPI. |
| `graph/dsls/type-def` | `types/spec/bdp/typedef-format` | The type format belongs to Types and stands on its own there. |
| `graph/dsls/bll` | dropped as a node | BLL is the language this plan is written in; it is not v0.2 work. |
| `graph/core/data-model` | `core/spec/bdp/data-model` | |
| `graph/core/primitives` | `core/spec/bdp/primitives` | |
| `graph/core/correlation` | `core/spec/bdp/execution` | Transaction and cause, widened to the call context every intrinsic carries. |
| `graph/core/storage-class` | `core/spec/bdp/storage` | |
| `graph/core/views` | dropped | Not a spec concept. Snapshot and stream are ways of reading the data model and the cursor. |
| `graph/core/capability-decl` | `core/spec/bdp/capability-decl` | |
| `graph/capability/callables` | `core/spec/bdp/callables` | |
| `graph/capability/event-source` | `core/spec/bdp/events` | |
| `graph/identity/aliases`, `links`, `annotations` | `core/spec/bdp/identity` (links also in `data-model`) | One level for now; they come back as subnodes when identity is drilled. |
| `graph/provenance` | `core/spec/bdp/provenance` | Inside the BDP spec, as Donna asked. |
| `graph/bindings` | inside `core/impl/go` | A generator is implementation, and it now reads the OpenAPI projection. |
| `graph/go-apis` | `core/spec/go` and `core/impl/go` | |
| `graph/head`, `graph/storage` | `core/impl/reference` | The landed head and its persistence are the reference implementation. |

## Open — placed by Eva, not ruled by Donna

Donna reviewed the shape down to the BDP spec's first level. These placements are mine and
are on the list for the planning days (2026-11-10 and 11).

- **Storage.** Donna named a storage spec that is "circularly dependent on bdp spec and
  potentially go spec". It sits inside the BDP spec here, as one node. The other choice is a
  fourth facet beside bdp, go and cli.
- **Execution before primitives.** Donna ruled that call context rides in the request and
  response of all six intrinsics, so `primitives` now depends on `execution`. The content of
  `execution` and of async in `callables` is parked until Thursday 2026-11-12.
- **Optionality (`capability-decl`).** Kept as its own node. It could fold under `primitives`.
- **Callables.** Kept as its own node. It could fold into `primitives` as the meaning of `call`.
- **Projection edges.** Drawn model first, projection second. If the schema is written first
  and the meaning layered on it, the two edges flip.
- **Begin versus complete.** Written with pinned edges and one gate child. If more nodes need
  the same gate, it may deserve its own notation.
- **Go and CLI specs** are one node each. They will split as the BDP spec subnodes firm.
