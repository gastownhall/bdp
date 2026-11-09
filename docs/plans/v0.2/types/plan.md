# Plan: Types Infra

Area `types/` — owner Trish. One level only: the type-system layer that sits on top
of Core — descriptors, refinement, enforcement, and the catalog — with their
dependencies. Each sub-area that grows expands into its own file: a peer `<name>.md`
if it stays flat, a `<name>/plan.md` directory if it grows structure.

The type system builds on the graph area at two points: the `type` field in
`graph/core/data-model`, and the authoring format in `graph/dsls/type-def`.

Authored in BLL (bead/link language); the diagram, tree, and per-node bead docs are
generated from this source, not written by hand.

## Plan

```
plan: all {
  /// title: Type descriptors — the type field, property schema, and descriptor kinds
  type-desc: after(graph/core/data-model, graph/dsls/type-def)
  /// title: Refinement — the Refines relation and subtyping
  refines: after(type-desc)
  /// title: Enforcement — optional interpretation and constraint validation
  enforcement: after(type-desc, refines)
  /// title: Catalog — the type registry, discovery, and reference library
  catalog: after(type-desc)
  /// title: Conformance — Types-profile declaration and matrix re-key
  conformance: after(enforcement, catalog)
}
```
