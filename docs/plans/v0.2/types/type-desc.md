# types/type-desc

Body of the type-descriptor node — what a type is and how it attaches to a bead or link.

```
all {
  /// title: The type field — nominal typing attaches a type to a bead or link
  type-field: after(graph/core/data-model)
  /// title: Property schema — a type's JSON-valued properties, authored in the type-def format
  property-schema: after(graph/dsls/type-def)
  /// title: Descriptor kinds — one shape for bead types and link types
  kinds: after(type-field, property-schema)
}
```
