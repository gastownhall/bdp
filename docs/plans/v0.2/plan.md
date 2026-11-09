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
  done: after(graph/plan, types/plan, corelib/plan, memory/plan, packs/plan)
}
```
