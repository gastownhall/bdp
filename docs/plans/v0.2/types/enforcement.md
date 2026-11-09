# types/enforcement

Body of the enforcement node — interpreting a descriptor to check a bead or link.
Interpretation is optional: carrying a type affiliation does not by itself require a
descriptor engine.

```
all {
  /// title: Interpretation — an optional descriptor engine reads a definition
  interpretation: after(type-desc/property-schema)
  /// title: Constraints — the rules a definition imposes, enforced on write and refinement-aware
  constraints: after(interpretation, refines)
}
```
