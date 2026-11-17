# BDP baseline + branch-sprawl reconciliation — for Donna's review (2026-11-13 overnight)

**Branch:** `spec/baseline-v0.2` (off `spec/core-v0.2`). Nothing here touches `main`, the blessed pin
`spec/nolinks` @ `b555931c`, or anyone else's branch. The baseline file added here (`specs/bdp.lumen`) is a
copy of the blessed spec, placed on the core-v0.2 line so you can review "the baseline out of core-v0.2" as
one concrete thing. `specs/core.lumen` is left in place (untouched) pending your retire decision.

---

## TL;DR — the recommendation

**The baseline IS `specs/bdp.lumen` (the blessed spec @ `spec/nolinks` b555931c).** It is already a complete,
well-structured single source: the current no-links / ref-unified / patch / success-failure model, inline
`/// bdp` + `/// openapi` binding on every operation, and it projects to JSON Schema / OpenAPI / Go / reference
/ CLI. There is no reconciliation authoring to do — the "sprawl" is **three parallel single-source efforts**,
and two of them are superseded.

**The sprawl = three consolidated-spec lines, not one:**

| line | file | lines | model | verdict |
|---|---|---|---|---|
| `spec/nolinks` @ b555931c (pin) | `bdp.lumen` | 588 | **current** (no-links, ref, patch, success/failure) | **← BASELINE** |
| `spec/core-v0.2` | `core.lumen` | 965 | old (Link, `update`, incident-links) | RETIRE (salvage prose) |
| `melinda/bdp-lumen-toolchain` | `core.lumen` | 674 | old | RETIRE file, **KEEP the toolchain** |

core.lumen predates the no-links surgery (2026-11-13) and the ref-unification; its model is superseded.
melinda's branch additionally carries a **working `.lumen` → generated `.md` toolchain** (`tools/lumen/`,
`build-spec.sh`, a CI workflow) — that infra is the single-source mechanism *working* and should be kept and
**repointed at `bdp.lumen`**.

---

## What to do with every live BDP spec branch

**Keep / promote**
- `spec/nolinks` @ b555931c — the blessed baseline (`bdp.lumen`). Fleet pin. Becomes the trunk's source.
- `spec/kind-model` — the kinds thrust WIP (off nolinks). Continues as the kinds twin-branch.
- `melinda/bdp-lumen-toolchain` — **salvage the toolchain** (`tools/lumen/`, `build-spec.sh`, `.github/workflows/
  lumen-spec.yml`); retire its `core.lumen`. Repoint generation at `bdp.lumen`.

**Retire (superseded by the consolidation)**
- `spec/core-v0.2` — old-model `core.lumen` + generated `core.md`. Salvage prose (below), then retire.
- `spec/base-representation` — a one-commit restratification history note; fold the note into history/, close.

**Audit-then-close (pre-consolidation profile markdown — `specs/profiles/{core,write,events}/*.md`)**
These predate the 2026-11-12 consolidation; their *decisions* may or may not be reflected in `bdp.lumen`.
Audit each against bdp.lumen before closing — do NOT blind-close (design could be un-folded):
- `britt/events-complete-level`, `britt/discovery-events-capability`, `britt/events-opt-in-families` → check vs §8
  (change events / changefeed) + the advertised-capability model.
- `britt/revision-provenance-metadata`, `eva/revision-provenance-metadata-rebase` → check vs §5 (Provenance) +
  ruling 9 (committedAt/inception server-supplied).
- `britt/link-deletion-policy`, `eva/parked-remove-owned-links` → largely MOOT under no-links (ruling 12); confirm + close.
- `britt/batch-alias-members` → `apply` covers batch (ruling 13); aliases are parked (Transfer profile). Confirm + close.
- `eva/parked-bundle-migration` → explicitly parked; confirm scope + close or keep parked.
- `codex/trish-core-history-*` (2026-11-01) → history/citation preservation; fold into history/, close.

**Feeds a thrust (don't close — it's live design input)**
- `trish/types-v0.2-spec` (+24, `types.md` + descriptors) + `trish/types-v0.2-frontmatter` — the **Types profile**
  design (type descriptors, callable properties). This is direct input to the **kinds** thrust (the type system).
  Reconcile INTO the kinds twin-branches, don't discard.
- `wren/markdown-bead-dsl` — the markdown-bead authoring format; orthogonal, keep as its own small track.

---

## The baseline = `bdp.lumen` — why (not core.lumen)

1. **Model.** bdp.lumen is the blessed model (you blessed spec/nolinks; it's the fleet pin). core.lumen still has
   `Link`, `update`, `incident-links-exist` — the pre-no-links world. Non-negotiable: the baseline must be no-links.
2. **Structure.** bdp.lumen already has the inline `/// openapi`/`/// bdp` binding (compact one-line records per op)
   and projects to every backend. It is NOT missing structure. core.lumen's only structural edge is *more verbose
   prose*, not more capability.
3. **Single-source.** bdp.lumen is explicitly "THE spec … supersedes the prose/profile split" (its header). Adopting
   it as the baseline IS the single-source consolidation you asked for.

## core.lumen salvage candidates (fold into bdp.lumen as enhancement, your call — NOT done here)

core.lumen is more *narrated*. Worth considering to fold into bdp.lumen (it's terser on prose):
- `## Overview` and `## Cross-op semantics` narrative sections (bdp.lumen opens straight into §0 rulings + schemas).
- Fuller multi-line per-operation `description:` prose (bdp.lumen's are compact).
- The multi-line `/// openapi` block style (readability vs bdp.lumen's one-line records) — a presentation choice.
None of these change the model; they're readability enhancements. I did NOT fold them — that's your taste call,
and it belongs in the baseline review, not an overnight guess.

---

## Decisions I need from you

1. **Confirm baseline = `bdp.lumen`** (retire the two `core.lumen` lines). If yes, I: establish bdp.lumen as the
   canonical file on the trunk, move core.lumen → `specs/history/`, salvage melinda's toolchain pointed at bdp.lumen.
2. **Trunk branch name + home.** Make `spec/core-v0.2` the trunk (rename/retarget to carry bdp.lumen), or keep
   `spec/nolinks` as the trunk and retire core-v0.2? ("out of core-v0.2" suggests you want core-v0.2 to be the home.)
3. **Prose salvage** — fold core.lumen's Overview / Cross-op narrative + fuller descriptions into bdp.lumen, or keep
   bdp.lumen lean?
4. **Toolchain** — adopt melinda's `.lumen`→`.md` generator as the official single-source mechanism (repointed at bdp.lumen)?
5. **Profile-branch audit** — want me to run the audit-then-close pass on the britt/eva branches (confirm no un-folded
   design before closing), or leave them for their owners?

Once 1–2 are settled, the trunk is clean and the twin-branch thrusts (kinds first) fan out from it.
