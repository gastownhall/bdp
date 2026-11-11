# Plan: Packs

Area `packs/` — blocked on Types Infra.

A skeleton only: the area shape every area shares (spec, conformance, implementation, each by
facet), with no content yet. The nodes are unelaborated leaves, so the area cannot read as
done. The one real edge is the old one: packs wait on Types. It is still a whole-area edge and
gets pinned to Types subnodes when the pack nodes are written.

## Plan

```
plan: all {

  spec: all {
    /// title: BDP spec — the pack format and the first packs
    bdp: after(types/plan)
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
