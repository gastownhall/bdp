# Plan: BDP v0.2

The v0.2 bring-up, tied across its five areas. Authored in markdown-plan.
The base path is the directory; the canonical plan filename is plan.md, so a
directory's plan is `<dir>/plan`.

Every area has the same shape (Donna, 2026-11-09): **spec, conformance, implementation**, each
split by facet into **bdp**, **go** and **cli**. `core/` (called `graph/` until 2026-11-09),
`types/` and `corelib/` are in that shape; `memory/` and `packs/` carry it as a skeleton.
Cross-area edges are found once each area is settled.

## Plan

```
plan: all {
  core/plan
  types/plan
  corelib/plan
  memory/plan
  packs/plan
  /// title: Core and Events profile conformance — the R/S cases for Core and Events, admitted against a landed reference implementation
  core-events-conformance: after(core/impl/reference)
  /// title: Requirements traceability — R1–R31 and S1–S16 mapped to plan nodes and conformance
  traceability: after(core-events-conformance, types/conformance)
  done: after(core/plan, types/plan, corelib/plan, memory/plan, packs/plan, core-events-conformance, traceability)
}
```

## Open

- `core-events-conformance` was added at the root before areas had their own conformance
  nodes. It now overlaps `core/conformance/bdp` passing against `core/impl/reference`. It is
  kept and re-pointed here; folding it is the roll-up's call (Britt, then Donna).
