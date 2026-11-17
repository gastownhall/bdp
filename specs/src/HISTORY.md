---
title: Spec tree — merge map
status: drafting
owner: lydia
---

# Spec tree — merge map (where the old content lives)

The new structure (`specs/src/` + `specs/generated/`) is set up. **No content was changed —
this was pure moves + stubs.**

## What moved
- `specs/bdp.lumen` → **`specs/src/core/core.lumen`** — the current **normative formal** spec.
  - Source: branch `spec/tier2-sweep` @ `b21db743` (649 lines), which **descends from
    `spec/baseline-v0.2`** — i.e. your v0.2 line, continued by the tier-2 sweep.
  - *(Don't confuse with the old `specs/core.lumen` — that's the superseded Core-profile file.)*
  - If you'd rather start from a different version, the one-liners:
    - `baseline-v0.2`: `git show spec/baseline-v0.2:specs/bdp.lumen`
    - PR #397 (`6ccf6e43`): `git show lydia/bdp-lumen-spec:specs/bdp.lumen`

## New stubs (yours to fill)
- `specs/src/bdp.md` — Protocol narrative.
- `specs/src/bdppacks.md` — Types & Packages narrative.

Both cite `core/core.lumen` by `form-id` and get their prose cherry-picked from the history below.

## Historical specs to merge prose from (still at `specs/`, untouched)
| file | size | what it is |
|---|---|---|
| `core.md` | 116 KB | the big Markdown reference (prose) — **primary source** for `bdp.md` / `bdppacks.md` |
| `core.lumen` | 47 KB | the OLD Core-profile formal (superseded by `core/core.lumen`) — reference |
| `conformance.md` | 53 KB | conformance prose |
| `deferred.md` | 21 KB | deferred / open items |
| `package.lumen` · `issue.lumen` · `memory.lumen` | — | pack / domain formal specs |
| `profiles/` · `types/` · `formats/` · `openapi/` · `generated/` · `history/` | — | supporting dirs |
| `BASELINE-NOTES.md` · `AGENTS.md` · `README.md` | — | notes |

## Flags
- Moving `bdp.lumen` → `core/core.lumen` **changes the path Melinda's `bdp-lumen-toolchain`
  expects** (it projects `specs/bdp.lumen`). This reorg is on branch `lydia/spec-tree`, so the
  active branches are untouched — but coordinate with Melinda before merging anywhere shared.
- The formal Protocol / Pack / Core split stays deferred; `core/core.lumen` holds all of it for now.
