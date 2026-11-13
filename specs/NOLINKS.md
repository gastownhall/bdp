# spec/nolinks — the no-links BDP spec line

This branch carries `specs/bdp.lumen` with the **`Link` resource removed** (§0 ruling 12,
2026-11-13). It is the spec the implementation fleet builds against while the change is
reviewed; it does **not** touch `main`.

## What changed
A relationship is no longer a resource. An **edge is an owned `id<T>` property on the source
bead** — part of the source's revision state — not a `Link`. Removed: the `Link` type,
`LinkType`, the `link` kind, the `link` create endpoints (`source` / `target`), and the
`incident-links-exist` delete fault. `representation` is now `Bead | Web`. A relationship
change is an `update` to its source bead.

## Deliberately NOT in this change (kept as designed / parked)
- The **edges projection, families, traversal and referential-integrity constraints** stay
  the **graph corelib capability** (advertised, not base) — exactly where the base spec
  already parks `query / search / count / graph`.
- The broader reference unification (collapsing `Reference` / `id<T>` / `ResourceId`) is out
  of scope here; references are spelled `id<T>` per the prior ruling.

## Informal pin
- Base: `gastownhall/bdp` @ `f4913ebb` (main at branch creation).
- Sister: `donnabox/lumen` @ branch `spec/nolinks` — the Lumen language line (query algebra,
  quote forms, the predicate layer) the no-links model leans on.
- Pinning is informal: these two cross-references, no lockfile.
