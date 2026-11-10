# Plan: Memory UDT + callables

Area `memory/` — owner TBD. Memories-as-beads + reference links.

A skeleton only: the area shape every area shares (spec, conformance, implementation, each by
facet), with no content yet. The nodes are unelaborated leaves, so the area cannot read as
done. Content lands once Types is stable; the cross-area edges are found then.

## Plan

```
plan: all {

  spec: all {
    /// title: BDP spec — the memory bead type, its reference links, its callables
    bdp
    /// title: Go spec
    go: after(spec/bdp)
    /// title: CLI spec
    cli: after(spec/bdp)
  }

  conformance: all {
    /// title: BDP (protocol) conformance
    bdp: after(spec/bdp)
    /// title: Go conformance
    go: after(spec/go, conformance/bdp)
    /// title: CLI conformance
    cli: after(spec/cli, conformance/bdp)
  }

  impl: all {
    /// title: Go implementation
    go: after(spec/go, conformance/go)
    /// title: CLI implementation
    cli: after(spec/cli, conformance/cli)
  }
}
```
