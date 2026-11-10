# Authoring a plan area

A cheat-sheet for writing your area's plan in BLL (bead/link language).
Worked examples: `core/plan.md` and `types/plan.md`.

## The area shape (Donna, 2026-11-09)

Every area has the same three stages, and each stage is split by the same three facets:

```
plan: all {
  spec:        all { bdp  go  cli }     // bdp = the protocol; go and cli begin after it
  conformance: all { bdp  go  cli }     // one suite per facet
  impl:        all { … }                // outside the spec; depends on spec subnodes
}
```

- **Nesting is composition, not build order.** A parent's state is `all(children)`. The build
  order is the `after(...)` edges, which run node to node and cross the tree.
- **A spec is syntax plus semantics.** Semantics is the bulk. Syntax is a projection onto a
  language that already exists: JSON Schema for data shapes, OpenAPI for operations. Do not
  add nodes that build a new description language.
- **Cross-area edges come last.** Settle your own area first; the edges between areas are
  found together afterwards, so nobody is blocked on a whole area.

## Layout
- One directory per area: `core/`, `types/`, `corelib/`, … The directory name is the base path.
- Canonical filename `plan.md`. An area that fits on a screen or two nests its levels in that
  one file (`core/plan.md`, `types/plan.md`).
- When a child grows its own structure, move its body out: a peer file `<name>.md` if it
  stays flat, a directory `<name>/plan.md` if it grows. The parent still declares the child
  (title and deps); the child's file holds just that child's children.

## BLL
```
id: all { … }        composite — its state is all(children)
id: after(a, b)      depends-on edges — after = a,b COMPLETE (subtree done), not a stream drain
/// field: value     metadata above a node (title, repos, …), one field per line
seq { a; b; c }      sugar → all { a; b: after(a); c: after(b) }
```

## Begin and complete
`after(x)` means x is complete. Two habits keep that from blocking work that could start:

- **Pin the edge to the subnode you need**, not the whole stage. The Go spec needs the data
  model and the primitives, so it says `after(spec/bdp/data-model, spec/bdp/primitives)` and
  can begin while the rest of the BDP spec is still being written.
- **A completion gate is a child node.** When a node can start early but cannot *finish* until
  something else is done, give it a child that waits on the gate:

  ```
  reference: all {
    build:      after(spec/bdp/data-model, spec/bdp/primitives)
    conformant: after(build, conformance/bdp)
  }
  ```

  `reference` begins with `build` and is complete only when conformance passes. In a diagram
  the first kind of edge is drawn faint (begin-after) and the gate bold (must-complete); see
  `graph-style.md`.

## IDs and references
IDs are hierarchical paths; the base is the directory (`spec/bdp/primitives` under `core/` is
`core/spec/bdp/primitives`). A bare reference resolves its first segment by **layered
lookup**, in order:

1. **Siblings in the same block** — the children of the `all { … }` you are writing in (in a
   body file, the children of the node that file elaborates). Inside `core`'s
   `spec: all { bdp: all { … } }`, `after(data-model)` → `core/spec/bdp/data-model`.
2. **The area's own nodes, by path from the area root.** Anywhere in `core/plan.md`,
   `after(spec/bdp/primitives)` → `core/spec/bdp/primitives`.
3. **Absolute from the plan root** when the first segment is an area name (`core`, `types`,
   `corelib`, `memory`, `packs`): `core/spec/bdp/primitives` resolves the same from anywhere.
4. **Another plan** when the first segment is a plan name (`bdp`, `lumen`): from the Lumen
   plan, `bdp/core/spec/bdp/callables` is the BDP node. Plans reference ids, never import files.

**No shadowing (hard invariant).** A bare name that resolves at more than one layer is an
ERROR — the generator refuses it rather than silently pick. Area names and plan names are
reserved as a bare first segment: the facet node `bdp` is always written with its stage
(`spec/bdp`, `conformance/bdp`), never bare. Write siblings unprefixed; never self-qualify
with your own area name.

## The one rule: single source
Author only the graph source — the structure and the `///` metadata. The diagram, the
tree, and the per-node bead docs are GENERATED; never write them by hand. A node's title
lives once, at its declaration.

## Keep it shallow
One level beyond the area shape is plenty for now. We're learning the format and the work
together — don't go deep.
