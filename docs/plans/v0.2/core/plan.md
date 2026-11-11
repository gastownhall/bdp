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
      /// title: Storage — what a store must keep; split so events need only the early half
      storage: all {
        /// title: Record shape — what is stored for a bead and for a link
        record-shape: after(spec/bdp/data-model)
        /// title: Storage class — durable, ephemeral, intrinsic
        storage-class: after(spec/bdp/data-model)
        /// title: Identity ledger — ids used and retired, never reused
        identity-ledger: after(spec/bdp/identity)
        /// title: Revision token — what marks one revision of a record
        revision-token: after(record-shape)
        /// title: Transaction and cause — what a store records for each
        transaction-and-cause: after(spec/bdp/execution)
        /// title: Change log — the ordered record of changes that events are read from
        change-log: after(transaction-and-cause, revision-token)
        /// title: Retention and cursor — how long changes are kept, and where a reader resumes
        retention-and-cursor: after(change-log)
        /// title: Export boundary — what an export contains and where it cuts
        export-boundary: after(change-log)
      }
      /// title: Identity — the alias model, resolution, link identity, annotations
      identity: after(data-model)
      /// title: Provenance — attribution and lineage
      provenance: after(identity)
      /// title: Callables — declaration, sync and async call, AsyncResult
      callables: after(primitives)
      /// title: Events — event sources, pull, replay
      events: after(primitives, storage/storage-class, storage/revision-token, storage/transaction-and-cause)
      /// title: Revision history — read at a revision, list revisions, the previous revision on events
      history: after(storage/revision-token, storage/change-log, events)
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
    /// title: Revision history in storage — built once for beads and links, in Phase 3; unowned
    history: after(spec/bdp/history, reference/build)
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
| `graph/core/storage-class` | `core/spec/bdp/storage/storage-class` | Storage is split into eight subnodes (Donna, 2026-11-10). |
| `graph/core/views` | dropped | Not a spec concept. Snapshot and stream are ways of reading the data model and the cursor. |
| `graph/core/capability-decl` | `core/spec/bdp/capability-decl` | |
| `graph/capability/callables` | `core/spec/bdp/callables` | |
| `graph/capability/event-source` | `core/spec/bdp/events` | |
| `graph/identity/aliases`, `links`, `annotations` | `core/spec/bdp/identity` (links also in `data-model`) | One level for now; they come back as subnodes when identity is drilled. |
| `graph/provenance` | `core/spec/bdp/provenance` | Inside the BDP spec, as Donna asked. |
| `graph/bindings` | inside `core/impl/go` | A generator is implementation, and it now reads the OpenAPI projection. |
| `graph/go-apis` | `core/spec/go` and `core/impl/go` | |
| `graph/head`, `graph/storage` | `core/impl/reference` | The landed head and its persistence are the reference implementation. |

## Ruled since the first review

- **Storage is split (Donna, 2026-11-10).** Donna had named storage as "circularly dependent
  on bdp spec and potentially go spec". Asked whether to keep one node, split it, or make it
  a fourth facet, she chose the split. `events` depended on all of storage while half of
  storage could only be settled once events were; the split removes that circle.
- **Owned Links are removed (Donna, 2026-11-10).** "Go ahead and remove it now. There is no
  reason to keep it around. We will come up with a replacement if we actually need one." A
  Link is an ordinary Resource with its own revision; a Bead's revision captures no Links.
  The removal is part of `spec/bdp/data-model` (the Core and Write text) and reaches Types,
  the conformance cases and the reference implementation. No node is added for it. In the
  v0.1 text a Type definition's conformance declarations are owned Links. Asked what should
  replace them, Donna: "the link can exist and it is structurally sound." So a declaration
  stays a Link, an ordinary one, and nothing replaces it. The Types text is Trish's to rewrite.
- **Where v0.2 text lives (Donna, 2026-11-10).** "Main should always carry the current
  version directly under specs. I am fine to keep previous versions as history but I would
  like then NOT under the specs directory." Every `spec/` node in this plan is therefore an
  edit to the existing files under `specs/` on main. There is no separate v0.2 tree. For
  the earlier version Donna proposed release branches ("Maybe we just keep release
  branches?"); `release/sprint1` already exists. That is a proposal, not yet firm.
- **The spec may lead the reference implementation; conformance may not lag (Donna,
  2026-11-10).** Asked whether spec text may merge on main ahead of the reference
  implementation: "A is fine for this week. I think the reference implementation thing may
  give way to a different approach. Conformance suites HAVE to match." So for this week a
  `spec/bdp` node can merge before `impl/reference` catches up, and a spec change brings its
  conformance cases with it. The edges above already say this for the first half
  (`impl/reference/build` begins after the spec). They do not yet say the second: today
  `conformance/bdp` waits for all of `spec/bdp`. Whether that edge should be drawn per
  subnode, and what replaces `impl/reference` if it gives way, are not ruled.

## Open — placed by Eva, not ruled by Donna

Donna reviewed the shape down to the BDP spec's first level. These placements are mine and
are on the list for the planning days (2026-11-10 and 11).

- **Revision history.** Donna, 2026-11-10: history "wasn't fully implemented. It seems that's
  a large work item that we need to account for happening." It is accounted for here as two
  nodes, `spec/bdp/history` and `impl/history`. The placement is mine. Donna on when: leave
  upstream's history support as it is until it can be done "once against both beads and links
  at the same time", and "It should probably be part of stage 3." So the first two phases ship
  without history, and `impl/history` is Phase 3 work. This plan has no phase nodes, so the
  edge does not show that; `impl/history` sits beside the reference implementation so that it
  does not hold it up. Not ruled: who builds it (upstream's versioned-beads work,
  gastownhall/beads#6379, is switched off and unfinished), and its size.
- **The two halves of storage.** `events` now waits only on the early half. The late half
  (change log, retention and cursor, export boundary) is finished together with `events`; no
  edge is drawn either way between them.
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
