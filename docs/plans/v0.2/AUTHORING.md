# Authoring a plan area

A cheat-sheet for writing your area's plan in BLL (bead/link language).
Worked example: `graph/` — read `graph/plan.md` plus `graph/dsls.md`, `core.md`,
`capability.md`, `identity.md`.

## Layout
- One directory per area: `types/`, `corelib/`, … The directory name is the base path.
- Canonical filename `plan.md`. A sub-area that stays flat is a peer file `<name>.md`;
  one that grows its own structure becomes a directory `<name>/plan.md`.
- One level per file. `plan.md` declares its direct children (each with a title and its
  deps); each child you elaborate gets its own body file holding just that child's children.

## BLL
```
id: all { … }        composite — its state is all(children)
id: after(a, b)      depends-on edges
/// field: value     metadata above a node (title, repos, …), one field per line
seq { a; b; c }      sugar → all { a; b: after(a); c: after(b) }
```

## IDs and references
- IDs are hierarchical paths; the base is the directory. `foo` under `types/` is `types/foo`.
- A reference is relative to your area; a reference whose first segment is an area name
  (`graph`, `types`, `corelib`, `memory`, `packs`) is absolute. So you depend on the graph
  area with `graph/core/primitives`, and on a local node with `validator/foo`.
- Area names are reserved — don't name a local node after one.

## The one rule: single source
Author only the graph source — the structure and the `///` metadata. The diagram, the
tree, and the per-node bead docs are GENERATED; never write them by hand. A node's title
lives once, at its declaration (the parent declares the node; its own file holds its children).

## Keep it shallow
One level beyond the archetype is plenty for now. We're learning the format and the work
together — don't go deep.
