# Plan: Core Intrinsics

Area `corelib/` — owner Melinda. The built-in callables (the memcpy "Intrinsic" sense): the
generic, domain-independent intrinsic callables built on core's call mechanism. **Reshaped
2026-11-10** into the standard area shape — **spec, conformance, implementation**, each split by
facet into **bdp** (the protocol), **go** and **cli** — to match `core/` and `types/`. BLL only;
diagram, tree and bead-docs are generated.

**Composition versus dependency.** The nesting below is composition — a parent's state is
`all(children)`. The build order is the `after(...)` edges, which run node to node and cross the
tree; they are not the parent/child structure.

**Syntax versus semantics.** An intrinsic is mostly semantics — what the callable does. Its
syntax is the two projections core already defines: the operation is an **OpenAPI** operation,
its request/response shapes are **JSON Schema** (the query predicate is a JSON-AST, a
JSON-Schema-shaped value — no new DSL).

**Begin versus complete.** Edges are pinned to the subnode a node needs, so work begins early;
a node that can start early but cannot *finish* until a gate is done gets a child on the gate.

## Plan

```
plan: all {

  // Specs — the intrinsics are BDP operations over core's primitives; go and cli begin after bdp
  spec: all {

    /// title: BDP spec — the intrinsic callables, as OpenAPI operations over core's primitives
    bdp: all {
      /// title: Query — JSON-AST admission, pure evaluator, bounded snapshot reader, exact count
      query: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/storage)
      /// title: List — JSON-AST predicates for Bead and Link lists, count-only
      list: after(query)
      /// title: Batch — grouped operations over the call mechanism; the Batch adapter
      batch: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/execution)
      /// title: Versions — list retained Resource versions, compare two versions
      versions: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/storage)
    }

    /// title: Go spec — the Go API surface for the intrinsics
    go: all {
      /// title: Go design doc — the intrinsic Go APIs, over core's Go surface
      design-doc: after(spec/bdp/query, core/spec/go/design-doc)
    }

    /// title: CLI spec — the intrinsic commands (query, list, batch, versions; count/graph are modes)
    cli: all {
      /// title: Canonical CLI — the intrinsic commands
      canonical-cli: after(spec/bdp/query, core/spec/cli/canonical-cli)
    }
  }

  // Conformance — one suite per facet
  conformance: all {
    /// title: BDP conformance — the intrinsic cases
    bdp: after(spec/bdp)
    /// title: Go conformance
    go: after(spec/go, conformance/bdp)
    /// title: CLI conformance
    cli: after(spec/cli, conformance/bdp)
  }

  // Implementation — outside the spec; depends on spec subnodes and on core's reference
  impl: all {
    /// title: Go implementation — the Go intrinsics and the evaluation providers (Lumen/dolt)
    go: after(spec/go, spec/bdp/query, core/spec/bdp/openapi, conformance/go)
    /// title: CLI implementation
    cli: after(spec/cli, conformance/cli)
  }
}
```

## Where the old `graph/` edges went (confirmed)

Eva's mechanical remap (graph→core, agent-memory `b87d64e`) is verified faithful and kept:
`dsls/callable→openapi`, `capability/callables→callables`, `correlation→execution` (batch),
`storage-class→storage` (versions), and `views` dropped with query's old `views` edge pointed at
`storage` (sound — query is a bounded snapshot read and `storage` holds that cursor).

## Open — placed by Melinda, for the planning-day review (2026-11-10 / 11)

Draft placements, mirroring `core/`; to settle with Donna in review:
- **impl is `go` + `cli`, no `reference`.** corelib is intrinsics *over* core, not the protocol
  reference, so it has no reference-implementation node. Open: should `impl/go` carry an edge to
  core's Go implementation? Eva's lean, which I share — `core/impl/go` (the Go intrinsics build on
  core's Go impl), *not* `core/impl/reference` (whose job is to prove the protocol spec). Donna to
  confirm in review.
- **The evaluation providers live in `impl/go`.** The provider interface + the Lumen Rust glue
  (cgo) + the dolt lowering (the evaluation-model design is in Melinda's memory) are corelib's impl substance;
  kept as one `impl/go` node for now rather than drilled — a candidate to expand in review.
- **The deeper Expressions dependency is not yet edged.** query/list hang off the expression
  evaluation model (Lumen) + the AST and type rules (Trish's Types area). Those cross-area edges
  (to `types/` and the Lumen plan) are found *after* the area settles (AUTHORING: cross-area
  edges come last) — to add in review once the Types + Lumen-expression nodes are named.
- **go/cli specs are one node each**, mirroring core; they split as the bdp intrinsic spec firms.
