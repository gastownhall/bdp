# types/conformance

Body of the conformance node — declaring Types support and proving it. This area
owns the Types cases and their re-key; the suite runs over the wire, so it waits on
the graph area's head.

```
all {
  /// title: Declaration — how a service advertises Types support and its level
  declaration: after(enforcement, catalog)
  /// title: Matrix re-key — port the v0 Types matrix to the canonical definitions
  re-key: after(declaration)
  /// title: Suite — the Types cases the vendored kit carries into beads
  suite: after(re-key, graph/head)
}
```
