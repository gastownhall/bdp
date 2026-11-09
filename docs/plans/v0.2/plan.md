# Plan: BDP v0.2

The v0.2 bring-up, tied across its five areas. Authored in markdown-plan.
The base path is the directory; the canonical plan filename is plan.md, so a
directory's plan is `<dir>/plan`.

## Plan

```
plan: all {
  graph/plan
  types/plan
  corelib/plan
  memory/plan
  packs/plan
  /// title: Core and Events profile conformance — the R/S cases for Core and Events, admitted against a landed graph
  core-events-conformance: after(graph/head)
  /// title: Requirements traceability — R1–R31 and S1–S16 mapped to plan nodes and conformance
  traceability: after(core-events-conformance, types/conformance)
  done: after(graph/plan, types/plan, corelib/plan, memory/plan, packs/plan, core-events-conformance, traceability)
}
```
