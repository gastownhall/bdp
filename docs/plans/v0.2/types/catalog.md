# types/catalog

Body of the catalog node — the registry of type definitions a scope knows.

```
all {
  /// title: Registry — the set of type definitions held in a scope
  registry: after(type-desc)
  /// title: Discovery — advertising and resolving types within a scope
  discovery: after(registry)
  /// title: Reference library — seed descriptors (e.g. Issue) shipped as a baseline
  reference-library: after(registry)
}
```
