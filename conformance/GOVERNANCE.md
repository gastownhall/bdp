# Conformance Governance: plumbing `core.lumen` normative changes through the gate

Adopted 2026-11-23. Governs `core.lumen` conformance plumbing.

**Scope: `core.lumen` only** — the packs stay looser by design, and this strict interlock does not
bind them.

This doc has two halves under two owners. **Part I — the adopted policy** (owned by Lydia, the
interlock merge gate): what the obligation is and how it is enforced. **Part II — the gate contract**
(owned by Connie, the conformance-suite lead): the operational mechanics a spec author must know
*before* CI, so the gate's rejections are learned up front rather than discovered after a red run.

---

# Part I — The adopted policy

**The principle.** Every `/// normative:` line in `core.lumen` is a conformance obligation, and no change to `core.lumen` may add or alter one without CI accounting for it — just as the wire surface already is. The surface gate alone cannot enforce this: a change can add binding requirements with no change to the generated OpenAPI, pass that gate green, and leave the requirements untested. Most normative lines are behavioural, not wire rows, so a surface-keyed gate structurally cannot see them.

**The reader is the conformance point.** Where `core.lumen` says a reader or service *refuses* something, the obligation is on the reader — the party that must reject bad input — not on the writer. A test that only checks a well-behaved writer never exercises the guarantee the line makes.

**How an obligation is accounted for.** Each `/// normative:` line is tracked as an obligation, and each resolves to exactly one of three states:

- **surface-bearing** — it maps to a wire operation or fault the surface gate already covers; nothing new is needed.
- **behavioural** — it is a guarantee with no distinct wire status (for example, *`cancel` runs no compensation*, or *`Ephemeral` is never exported*); it needs a behavioural test against the implementation.
- **waived** — it is a registered waiver: a skipped test carrying a tracking-issue id, so the obligation sits on the ledger as *known-uncovered* rather than silently missing.

The ledger records each obligation's state, not a count. A new normative line that resolves to none of the three is what this policy catches. Part II is the mechanism.

**Two enforcement states, and the condition that moves between them.** The gate runs **report-only** by default: it lists every obligation and flags any new normative line that has no resolution, but blocks nothing. Under `BDP_GATE_STRICT` it runs **blocking**: that same unresolved obligation fails CI. Blocking turns on once the coverage backlog is cleared — and clearing it is continuing work, behavioural cases and implementation landing over time, not a dated milestone. The gate flips when the backlog reaches zero, whenever that is; until then it reports, and coverage fills.

**The ledger catches drift in both directions.** Mapping normative lines against the wire surface catches a normative line with no test (the gap above) *and* a declared wire fault with no normative line defining it (a status the surface counts but the spec does not ground). The second is the ongoing fault-table work. One ledger is the single source of truth for both. Part II §8 names the model: *grounded*, *reachable* and *obliged* are three separate properties, and a declared-but-not-obliged row is a surface defect, not a coverage gap.

**A watcher's exit code is not a verdict.** When CI or a merge gate reads a watcher's result, the exit code alone does not certify the obligations passed. Confirm the watched head matches the PR head and the completed-check count is the full set: a *cancelled* run reads as not-pending and passes for success, and the absence of a pending signal is not a pass.

**Roles and scope.** Lydia owns this policy and gates `core.lumen` merges; Connie owns the conformance suite, its behavioural cases, and the gate contract (Part II); Donna rules the policy. It governs `core.lumen` only — the packs are looser by design — and it lives next to the gate it governs.

---

# Part II — The gate contract

**Authored by Connie (conformance-suite lead).** Derived from the gate code at `gastownhall/bdp` main
`07ca0bed`, 2026-11-24 — the pin where the figures below are measured, with #428/#434/#435/#437/#432/#438
all landed. The fault-table rulings have moved the denominator in steps: 54 → 47 (ruling D, #437) → 48
(`import/400`, #432) → 50 (`patch/400` + `delete/400`, #438), and it is still moving — read §7 for how to
re-derive the current figures rather than trusting this date. Everything lives under `conformance/`.
Written for a spec author who needs to know **what the gate will reject**, so they learn it before CI
rather than after.

## 1. Only a `problem = [...]` edit moves the denominator

`denominator()` parses `specs/generated/openapi/core.openapi.json` into
`SurfaceId::Op(op)` and `SurfaceId::Fault(op, status)` — **50 rows** (13 ops + 37 faults).

- Params are **not** in the surface model.
- D.8 (the prose status table) is **never parsed**.

So declaring params, or adding a D.8 status row, cannot move the denominator. Only editing a
`problem = [...]` array can. Touching one requires coordinating the re-pin.

**A worked instance.** Ruling D (#437) was the first live case: it edited seven `problem = [...]`
arrays to undeclare the `413`/`414` rows and the denominator moved, while the D.8 prose reframe in the
same PR moved nothing — the gate never parses D.8. `import/400` in #432 was the second: the array
edit moved the denominator 47 → 48, its eight new params moved nothing. `patch/400` and `delete/400` in
#438 were the third and fourth, taking it to 50 — their rule landed in D.8's `400`-row prose, which the
gate never parses, so again only the `problem = [...]` edits moved anything.

## 2. Two pins, one commit

| pin | location |
|---|---|
| `EXPECTED_SURFACE` — op→fault-status membership | `conformance/gate/src/lib.rs` |
| `SCOPE_INDEPENDENT_ROWS` | `conformance/gate/tests/gate.rs` |

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

**`/// normative:`** — parsed anchored on the first non-whitespace token (`trim_start()` then
`starts_with`), **not** on column 0, because obligations inside a type body are indented. The anchor
cuts both ways against a naive `grep`: an unanchored `grep -c '/// normative:'` over-counts by 2 (it
sweeps in the two self-documentation lines — the file documents that very annotation using it), while a
column-anchored `grep -c '^/// normative:'` under-counts by 2 (it misses the two indented obligations).
The gate's own count is `grep -cE '^[[:space:]]*/// normative:'`. Two literal fragments
(`SELF_DOCUMENTATION_FRAGMENTS` in `conformance/gate/src/lib.rs`) exclude the self-documentation, and
the test asserts they are **absent from the parse and still present in the file**, so it cannot rot.
**85 obligations.**

**A worked instance.** The author of gastownhall/bdp#432 reported the obligation count going
**81 → 87**. The anchored parse gives **79 → 85**: the *delta* was right, the absolute was two high,
because the unanchored `grep` had picked up the two self-documentation lines. That is the fourth time
this file has produced that exact off-by-two — three times for the suite lead, once for an independent
author. The file documents its own annotation using that annotation, so the over-count is a property of
the file's shape rather than of anyone's carelessness.

## 6. The silent trap: the obligation ledger is report-only

Rewording, adding or removing a `/// normative:` line shifts the registered/unregistered partition.
Reworded registered text moves to `pending`, and `pending <= 12` is allowed — so **CI stays green
while registrations go stale.**

This already happened: **#434 merged carrying 3 stale registrations** because the texts were reworded
after they were extracted, and nothing failed.

**Any spec PR touching `/// normative:` lines must list them.** There are 19 registered obligations.

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

**70 tests green** on `07ca0bed`; coverage **30/50**, uncovered 20; ledger **85 / 19 registered / 66
backlog / 0 pending** — unchanged across #438, because #438 moved the fault surface, not the obligation
ledger: the two are independent, and `patch/400` + `delete/400` added no `/// normative:` lines. These
figures are a snapshot of one command, not an authority: re-derive the ledger and coverage blocks with
`cd conformance && cargo test -p bdp-gate -- --nocapture` and read the numbers here as its illustration
— the same move as citing `EXPECTED_SURFACE` over a line number. They shift with the surface; the next
fault-row PR moves them again.

**What `30/50` does and does not say.** *Covered* means a case exercised the row, not that the
obligation is discharged. A row is `(op, status)`: `op/patch/fault/400` has two independent producers —
a non-array patch document, and `If-None-Match` on an op whose capability record carries no `ifAbsent` —
so breaking either leaves the figure at 30/50 while the other case still holds the row covered. A row can
even read covered for the *wrong* reason: `op/patch/fault/422` once showed covered by a case sending a
body D.8 names under `400`, which never touched a capability bound at all — the status alone could not
show it, and a single-subject suite could not catch it (it surfaced on an independent multi-backend grid;
the fix makes the cases assert the D.9 `code`, not the status, and `patch/422` is now honestly
uncovered). Of the 20 uncovered rows, **12** wait on `import`/`pull`/`push` being implemented (3 `op/*` +
9 faults); the other **8** are faults on implemented primitives.

`BDP_GATE_STRICT=1` additionally fails on uncovered rows **and** the ledger backlog. It is expected to
fail today — 20 rows, 66 obligations — so do not chase it. The STRICT flip is not close, and the
"third category" of unreachable rows was never what stood in its way.

## 8. Three levels, not two

A row can be:

1. **grounded** — the spec says the fault exists
2. **reachable** — a conformance case can construct the trigger
3. **obliged** — *this party* must produce it

They are routinely conflated, in both directions, including by the gate's own evidence strings. The
`413`/`414` rows were grounded and declared but **not obliged** — the spec says the URL-byte limit is
imposed by intermediaries, not the origin, so no origin-side case could force one at any length. That
made them a denominator defect rather than a coverage gap.

**Resolved at `b56281ed`.** Ruling D (#437) has now undeclared all seven of those rows, so this example
is discharged — they are no longer in the denominator (54 → 47, then 48 with #432's `import/400`, then 50 with #438's `patch/400` + `delete/400`). The three-level principle above is
unchanged; only the status of its worked example moved. It is the principle executed, not revised.
