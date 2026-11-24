# Conformance Governance: plumbing `core.lumen` normative changes through the gate

Adopted 2026-11-23. Governs `core.lumen` conformance plumbing.

**Scope: `core.lumen` only** — the packs stay looser by design, and this strict interlock does not
bind them.

This doc has two halves under two owners. **Part I — the adopted policy** (owned by Lydia, the
interlock merge gate): what the obligation is and how it is staged. **Part II — the gate contract**
(owned by Connie, the conformance-suite lead): the operational mechanics a spec author must know
*before* CI, so the gate's rejections are learned up front rather than discovered after a red run.

---

# Part I — The adopted policy

## The gap this closes — PR #428 is the live example

The tier-1 gate's denominator is the **OpenAPI wire surface**, read **live** from
`specs/generated/openapi/core.openapi.json` (`bdp_gate::denominator()`) — at #428, 54 rows (13 ops + 41
faults). It is lockstep on the **wire**: move an op or a fault status and the denominator moves with it;
under `BDP_GATE_STRICT` an uncovered row fails CI (`fail-if-no-coverage`). (That count is #428-era; the
fault-table rulings have since moved it — read the current figure from Part II §7, dated to the gate pin.)

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

## The conformance point is the reader

Wherever `core.lumen` says a reader or service **refuses** X, the **reader** is the conformance point,
not the writer. An obligation of this shape is grounded against the party that must reject the input,
not the party that must avoid emitting it — a case that only checks a well-behaved writer never
exercises the guarantee the line makes.

## Mechanism — extends what exists, stands up no new checker

The gate already derives the wire surface two independent ways and asserts they agree: `denominator()`
(from the generated OpenAPI) and `source_surface()` (from `core.lumen`'s `/// openapi =` annotations).
Mirror that for normative points:

1. **`normative_surface()`** — parse every `/// normative:` line in `core.lumen` into a
   normative-obligation ledger (today: **79 obligations**; an unanchored `grep` over-counts by two — see
   Part II §5). The second denominator. The ledger pins each obligation's **resolution**, not a
   cardinality.
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

## A watcher's exit code is not a verdict

When a merge gate or CI consumes a watcher run, the watcher's **exit code alone does not certify** the
obligations passed. Before treating a watcher as a green verdict, confirm both: (a) the **watched head
matches the PR head**, and (b) the **completed-context count equals the full obligation set**. A
**CANCELLED** run reads as *not-pending* and will masquerade as success — the absence of a pending
signal is not the presence of a pass.

## Free dividend — it catches the inverse drift too

A full **normative ⇄ surface cross-map** catches both directions:

- **normative → no surface/case** — the new gap, PR #428.
- **surface → no normative producer** — the gate documents the fault rows declared with no normative
  line naming their producer ("the denominator counts rows the spec does not define"). These are the
  open **fault-table rulings** (#2/#3/D), which are progressively grounding or undeclaring those rows,
  so the count is a moving target by design — read the current measured figure from Part II §7 (dated to
  the gate pin), not a number restated here. The cross-map ledger becomes the interlock's single source
  of truth for BOTH drifts.

Part II §8 gives the precise model the ledger classifies these with: a row is **grounded**, **reachable**
and **obliged** as three separate properties, and a denominator defect (declared-but-not-obliged) is a
different thing from a coverage gap.

## Roles & placement

- **Lydia** gates core merges (the interlock) and owns this policy; **Connie** owns the suite, authors
  behavioural cases, and owns the gate contract (Part II); **Britt** coordinates rollout; **Audrey**
  oversees; **Donna** rules this policy and its scope.
- **Scope: `core.lumen` only.** Packs are looser by design; this strict interlock does not bind them.
- **Home:** this doc (`conformance/GOVERNANCE.md`) lives next to the gate it governs, with a one-line
  pointer from the fleet `RULES.md`. The policy lives with the mechanism it governs.

## First application — PR #428

#428 is the first change under this policy. Before it merges, its 12 new normative points register their
resolution:

- **#5 (`sse` on a snapshot → 400) and #9 (`after` + `from` → 400) are surface-bearing** — and notably
  they do NOT add surface rows (hence the no-diff): they supply **normative PRODUCERS for 400 rows that
  already existed but were ungrounded** (`list/400`, `export/400`, read-400). So they partly discharge
  the ungrounded-fault problem — the inverse-drift remedy, in the same PR. (Part II §6 records a gate-side
  caveat on the `after`/`from` evidence: surface-bearing evidence is author-asserted, not machine-checked.)
- **The other ~10 are behavioural** → register as **waived-with-issue**, tracked for Connie's lane. The
  *"Bind cancel in the conformance suite"* work already in flight closes one.

This keeps #428's coverage ledger honest instead of silently diluting it.

---

# Part II — The gate contract

**Authored by Connie (conformance-suite lead).** Derived from the gate code at `gastownhall/bdp` main
`3b7b371a`, 2026-11-24. Everything lives under `conformance/`. Written for a spec author who needs to
know **what the gate will reject**, so they learn it before CI rather than after.

## 1. Only a `problem = [...]` edit moves the denominator

`denominator()` parses `specs/generated/openapi/core.openapi.json` into
`SurfaceId::Op(op)` and `SurfaceId::Fault(op, status)` — **54 rows** (13 ops + 41 faults).

- Params are **not** in the surface model.
- D.8 (the prose status table) is **never parsed**.

So declaring params, or adding a D.8 status row, cannot move the denominator. Only editing a
`problem = [...]` array can. Touching one requires coordinating the re-pin.

## 2. Two pins, one commit

| pin | location |
|---|---|
| `EXPECTED_SURFACE` — op→fault-status membership | `conformance/gate/src/lib.rs:472` |
| `SCOPE_INDEPENDENT_ROWS` | `conformance/gate/tests/gate.rs:1423` |

The gate's own failure text: *"Review the delta, then update EXPECTED_SURFACE and tests/gate.rs
TOGETHER."* **A spec change and its re-pin cannot land separately** — either half alone leaves
`main` red. This is why #435 (spec) and #436 (re-pin) had to land as a single unit.

## 3. The drift gate is blind to params — regen is mandatory

`generated_catalog_matches_the_normative_source()` compares `core.lumen`'s `/// openapi =`
annotations to the generated JSON, **ops and fault rows only**. Adding param annotations without
regenerating `specs/generated/openapi/core.openapi.json` **passes silently** — exactly the
divergence the gate exists to catch.

Require the regenerated JSON and read the diff by hand. Do not trust the green here.

## 4. `SCOPE_INDEPENDENT_ROWS` is asserted in both directions

Current contents: `[("create",400), ("put",400), ("patch",415)]` — rows the protocol layer produces
before the scope is reached.

`no_case_passes_against_a_subject_that_implements_nothing` fails if:

- a row the null scope **produces** is not allowlisted → `VACUOUS CASES`
- a row that **is** allowlisted the null scope no longer produces → stale entry

**Consequence for a new fault row:** *where* the fault is enforced decides which pin it lands in. A
param-validation fault raised in the protocol layer is scope-independent and must be allowlisted; the
same fault raised inside the scope must not be. Either is correct — they just have to agree, and it
should be a deliberate decision.

## 5. `core.lumen` parses anchored on literal text

**The store-wide guarantee list** — parsed from the exact header `// A conformant store keeps:`,
`n. ` opening each item, and a **blank `//` closing the list**. That blank is load-bearing: the
Discovery prose after it must not be swept in as a continuation. Rewrapping is safe (continuations
join with a single space). Changing the header, the numbering form, or dropping the terminator breaks
`the_store_wide_guarantees_have_not_moved`. **14 items pinned.**

**`/// normative:`** — parsed anchored (prefix after `trim_start`), because the file documents that
very annotation using it; an unanchored `grep -c` over-counts by 2. Two literal fragments
(`lib.rs:383`) exclude the self-documentation, and the test asserts they are **absent from the parse
and still present in the file**, so it cannot rot. **79 obligations.**

## 6. The silent trap: the obligation ledger is report-only

Rewording, adding or removing a `/// normative:` line shifts the registered/unregistered partition.
Reworded registered text moves to `pending`, and `pending <= 12` is allowed — so **CI stays green
while registrations go stale.**

This already happened: **#434 merged carrying 3 stale registrations** because the texts were reworded
after they were extracted, and nothing failed.

**Any spec PR touching `/// normative:` lines must list them.** There are 13 registered obligations.

### Known defect in the ledger (gate-side, not spec-side)

The `after`/`from` registration cites evidence `op/pull/fault/400, op/list/fault/400,
op/revisions/fault/400`, but `after`/`from` are declared **only on `pull`** — so for two rows the
evidence named a trigger that cannot reach the op.

`every_surface_bearing_registration_names_real_rows` passed it, because it checks the cited rows are
**real denominator rows**, not that the trigger **reaches** them — and it structurally cannot, since
the surface model has no params. **Surface-bearing evidence is author-asserted, not machine-checked.**
The README must say so, or the green implies a guarantee it never made.

## 7. Running it

Manifest is `conformance/Cargo.toml`, **not** the repo root. `cargo` may need
`~/.rustup/toolchains/stable-aarch64-apple-darwin/bin` on `PATH`.

```
cargo test --manifest-path conformance/Cargo.toml
```

**70 tests green** on `3b7b371a`; coverage **29/54**; ledger **79 / 13 registered / 66 backlog / 0
pending**.

`BDP_GATE_STRICT=1` additionally fails on uncovered rows **and** the ledger backlog. It is expected to
fail today — 25 rows, 66 obligations — so do not chase it. The STRICT flip is not close, and the
"third category" of unreachable rows was never what stood in its way.

## 8. Three levels, not two

A row can be:

1. **grounded** — the spec says the fault exists
2. **reachable** — a conformance case can construct the trigger
3. **obliged** — *this party* must produce it

They are routinely conflated, in both directions, including by the gate's own evidence strings. The
414 rows are grounded and declared but **not obliged** — the spec says the URL-byte limit is imposed
by intermediaries, not the origin, so no origin-side case can force one at any length. That makes
them a denominator defect rather than a coverage gap.
