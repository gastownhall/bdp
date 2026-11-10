# Plan: Core Intrinsics

Area `corelib/` — owner Melinda. The built-in callables (the memcpy "Intrinsic" sense):
the generic, domain-independent intrinsic callables built on the call mechanism. One
level only; BLL only (diagram/tree/bead-docs are generated).

**Edges re-pointed 2026-11-09 (Eva, mechanical).** The `graph/` area became `core/` and its
nodes moved, so the cross-area paths below changed; the four nodes and their meaning did not.
One of the moves is a judgment for Melinda to confirm: the dropped `views` node is replaced by
`core/spec/bdp/storage`, which holds the cursor a snapshot read is bounded by. This area is
not yet in the shared shape (spec, conformance, implementation, each by facet); that reshape
is Melinda's.

## Plan

```
plan: all {
  /// title: Query — JSON-AST admission, pure graph evaluator, bounded snapshot reader, exact count
  query: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/storage)
  /// title: List — JSON-AST predicates for Bead and Link lists, count-only
  list: after(query)
  /// title: Batch — grouped operations over the call mechanism; the Batch adapter
  batch: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/execution)
  /// title: Versions — list retained graph Resource versions, compare two versions
  versions: after(core/spec/bdp/openapi, core/spec/bdp/callables, core/spec/bdp/storage)
}
```
