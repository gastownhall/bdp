# spec/nolinks — the no-links BDP spec line

This branch carries `specs/bdp.lumen` with the **`Link` resource removed** (§0 ruling 12,
2026-11-13). It is the spec the implementation fleet builds against while the change is
reviewed; it does **not** touch `main`.

## What changed
Two rulings, both on this branch:

**Ruling 12 — Links removed.** A relationship is an **owned `ref<T>` property on the source
bead** — part of the source's revision state — not a `Link`. Removed: the `Link` type,
`LinkType`, the `link` kind, the `link` create endpoints (`source` / `target`), the
`incident-links-exist` delete fault. `representation` is `Bead | Generic`. A relationship
change is an `update` to its source bead.

**Ruling 13 — one reference world (review pass, 2026-11-13).** `ref<T>` (the 3-part
`ResourceId`, typed) is the only way one resource names another. The URI / pinned-URI
`Reference` and `PinnedReference` are removed; `AbsoluteUri` survives only for non-ref URIs
(Problem type, Principal id). `ResourceId.scope`/`rev` are now optional; ref variants are
refinements (`pinned` / `unpinned` / `inscope` / `crossscope` / `webscope`). Also from the
review: `id<T>`→`ref<T>`; `ResourceIdentity` dropped (ops return a `ref`); `batch`→`apply`
(batch = sugar) and `eval` added; `Web`→`Generic`; `resource` is a `type`; Result arms
`success`/`failure`.

## Deliberately NOT in this change (kept as designed / parked)
- The **edges projection, families, traversal and referential-integrity constraints** stay
  the **graph corelib capability** (advertised, not base) — exactly where the base spec
  already parks `query / search / count / graph`.
- The **expression language** behind `eval` (set/traversal operators, predicates) is the
  query corelib capability; the base accepts an opaque `Expression`. It is being designed on
  the sister `donnabox/lumen @ spec/nolinks` branch.

## Informal pin
- Base: `gastownhall/bdp` @ `f4913ebb` (main at branch creation).
- Sister: `donnabox/lumen` @ branch `spec/nolinks` — the Lumen language line (query algebra,
  quote forms, the predicate layer) the no-links model leans on.
- Pinning is informal: these two cross-references, no lockfile.
