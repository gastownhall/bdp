# Conformance Governance: plumbing `core.lumen` normative changes through the gate

Adopted 2026-11-23. Governs `core.lumen` conformance plumbing.

**Scope: `core.lumen` only** — the packs stay looser by design, and this strict interlock does not
bind them.

## The gap this closes — PR #428 is the live example

The tier-1 gate's denominator is the **OpenAPI wire surface** — 54 rows (13 ops + 41 faults), read
**live** from `specs/generated/openapi/core.openapi.json` (`bdp_gate::denominator()`). It is lockstep on
the **wire**: move an op or a fault status and the denominator moves with it; under `BDP_GATE_STRICT`
an uncovered row fails CI (`fail-if-no-coverage`).

A `/// normative:` line is **not** that denominator. Ruling-1's **PR #428 added 12 new `/// normative:`
lines and the OpenAPI/JSON-Schema projections regenerated to NO diff** — so the denominator didn't move
and **the gate stayed green**, while 12 binding requirements entered core with zero coverage obligation.
A green gate there proves the *wire surface* is unchanged; it says nothing about whether the new
normative points are tested.

The gap is real because most of ruling-1's promotions are **behavioural, not wire-surface**: "`cancel`
runs no compensation", "`Ephemeral` is never exported", "`Rev` is opaque", "`displayName` is never a
matching key" — none is an op or fault row, so the surface-keyed gate structurally cannot see them.

## Principle

**Every `/// normative:` line in `core.lumen` is a conformance obligation**, and no `core.lumen` change
may add or alter one without CI accounting for it — exactly as the wire surface is already accounted for.

## Mechanism — extends what exists, stands up no new checker

The gate already derives the wire surface two independent ways and asserts they agree: `denominator()`
(from the generated OpenAPI) and `source_surface()` (from `core.lumen`'s `/// openapi =` annotations).
Mirror that for normative points:

1. **`normative_surface()`** — parse every `/// normative:` line in `core.lumen` into a
   normative-obligation ledger (today: 81 rows). The second denominator.
2. **Each obligation resolves to exactly one of:**
   - **surface-bearing** — maps to a tier-1 OpenAPI row already in `denominator()`. Coverage is the
     existing wire case; no new machinery.
   - **behavioural** — a semantic guarantee with no distinct wire status (`cancel` no-compensation,
     `Ephemeral` never-exported, `Rev` opaque). Needs a **tier-2 behavioural case** exercising the
     guarantee against the subject.
   - **waived** — a registered waiver: an `XFAIL` carrying a tracking-issue id, so the obligation is on
     the ledger as *known-uncovered*, never silently absent.

   Each obligation records its resolution the way a case records its `SurfaceId`s today.
3. **The gate blocks** (under the same `BDP_GATE_STRICT` flag that governs tier-1) a `core.lumen` change
   that adds a `/// normative:` resolving to none of the three.

## Rollout — reuse the tier-1 staging exactly

Tier-1 is **non-blocking** today (STRICT off) while coverage fills in, then flips to blocking once the
surface is covered. Same for the normative ledger:

- **Phase 0 (now):** `normative_surface()` reports the ledger (surface-bearing + behavioural + waived).
  Non-blocking.
- **Phase 1:** a new `/// normative:` must register a resolution (case or waiver-with-issue).
  Report-only — nothing blocked, but an unregistered addition shows in the gate output and at review.
- **Phase 2:** flip to blocking (STRICT) once the backlog is burned down.

## Free dividend — it catches the inverse drift too

A full **normative ⇄ surface cross-map** catches both directions:

- **normative → no surface/case** — the new gap, PR #428.
- **surface → no normative producer** — the gate already documents **18 of 41 fault rows declared with
  no normative line naming their producer** ("the denominator counts rows the spec does not define").
  That is the open fault-table rulings. The cross-map ledger becomes the interlock's single source of
  truth for BOTH drifts.

## Roles & placement

- **Lydia** gates core merges (the interlock); **Connie** owns the suite and authors behavioural cases;
  **Britt** coordinates rollout; **Audrey** oversees; **Donna** rules this policy and its scope.
- **Scope: `core.lumen` only.** Packs are looser by design; this strict interlock does not bind them.
- **Home:** this doc (`conformance/GOVERNANCE.md`) lives next to the gate it governs, with a one-line
  pointer from the fleet `RULES.md`. The policy lives with the mechanism it governs.

## First application — PR #428

#428 is the first change under this policy. Before it merges, its 12 new normative points register their
resolution:

- **#5 (`sse` on a snapshot → 400) and #9 (`after` + `from` → 400) are surface-bearing** — and notably
  they do NOT add surface rows (hence the no-diff): they supply **normative PRODUCERS for 400 rows that
  already existed but were ungrounded** (`list/400`, `export/400`, read-400). So they partly discharge
  the ungrounded-fault problem — the inverse-drift remedy, in the same PR.
- **The other ~10 are behavioural** → register as **waived-with-issue**, tracked for Connie's lane. The
  *"Bind cancel in the conformance suite"* work already in flight closes one.

This keeps #428's coverage ledger honest instead of silently diluting it.
