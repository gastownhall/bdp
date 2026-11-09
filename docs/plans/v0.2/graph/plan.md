# Plan: Generic Graph Model

Area `graph/` — owner Eva. One level only: the sub-areas of the graph generalization
and the bring-up phases, with their dependencies. Each sub-area (`dsls`, `core`,
`capability`, `identity`) expands into its own file — a peer `<name>.md` if it stays
flat, a `<name>/plan.md` directory if it grows structure — which we decide as we write it.

Authored in BLL (bead/link language); the diagram, tree, and per-node bead docs are
generated from this source, not written by hand.

## Plan

```
plan: all {
  /// title: Authoring DSLs
  dsls
  /// title: Core — the base representation
  core: after(dsls)
  /// title: Capability beads — callables and event sources
  capability: after(core)
  /// title: Identity and annotation — aliases, links, comments
  identity: after(core)
  /// title: Provenance and attribution
  provenance: after(core)
  /// title: Go APIs
  go-apis: after(core, capability, identity, provenance)
  /// title: BDP head
  head: after(go-apis)
  /// title: Storage
  storage: after(head)
}
```
