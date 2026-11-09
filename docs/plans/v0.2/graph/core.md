# graph/core

Body of the Core node — the base representation.

```
all {
  /// title: Data model — beads, links, the rep envelope
  data-model: after(dsls/json-schema, dsls/type-def)
  /// title: Primitives — get, pull, call, alias/unalias, CRUD
  primitives: after(data-model)
  /// title: transaction and cause
  correlation: after(primitives)
  /// title: Storage class and the cursor
  storage-class: after(data-model)
  /// title: The three views — snapshot, stream, export/import
  views: after(primitives, storage-class)
  /// title: Optionality — per-endpoint capability declaration
  capability-decl: after(primitives)
}
```
