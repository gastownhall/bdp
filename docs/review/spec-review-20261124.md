# BDP spec review — Donna, 2026-11-24

This branch stages Donna's manual review of the Core + pack specs. Edit the
source files in VSCode and leave inline review notes using the `>DB` convention
(a line beginning with `>` plus your marker, inside a prose block — see
`specs/AGENTS.md`). A note is temporary; it's removed when answered. Lydia
processes the notes into rulings / changes.

Based on `main` @ 47eefaa (identical to `bdp-core-0.2.3-rc1` for these files —
nothing in flight touches them).

## Review targets
1. `specs/src/core/core.lumen` + `specs/src/bdp.md`
2. `specs/src/packs/issue/issue.lumen` + `docs/cli-design/bdp-cli.md`
3. `specs/src/packs/stdlib/stdlib.lumen`
4. `specs/src/packs/memory/memory.lumen`
