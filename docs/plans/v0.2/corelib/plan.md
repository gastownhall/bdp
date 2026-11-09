# Plan: Core Intrinsics

Area `corelib/` — owner Melinda. The built-in callables (the memcpy "Intrinsic" sense):
the generic, domain-independent intrinsic callables built on the call mechanism. One
level only; BLL only (diagram/tree/bead-docs are generated).

## Plan

```
plan: all {
  /// title: Query — JSON-AST admission, pure graph evaluator, bounded snapshot reader, exact count
  query: after(graph/dsls/callable, graph/capability/callables, graph/core/views)
  /// title: List — JSON-AST predicates for Bead and Link lists, count-only
  list: after(query)
  /// title: Batch — grouped operations over the call mechanism; the Batch adapter
  batch: after(graph/dsls/callable, graph/capability/callables, graph/core/correlation)
  /// title: Versions — list retained graph Resource versions, compare two versions
  versions: after(graph/dsls/callable, graph/capability/callables, graph/core/views, graph/core/storage-class)
}
```
