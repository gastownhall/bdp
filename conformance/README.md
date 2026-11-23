# `conformance/` — the BDP wire-level conformance gate (Rust)

**Pin:** core spec **v0.2.3** = `gastownhall/bdp` `main` @`488a2d01` (merged commits, never draft tips; where
`specs/generated/` lands). This is the lockstep merge gate for the Beads Protocol.

## What this is

A native Rust, wire-level, **black-box** conformance suite: cases run over HTTP against a single
in-memory reference endpoint. It is its own **self-contained** cargo workspace — one `cargo build`
/ `cargo test`, mainstream deps, no Node, DB, or network — so it stays green on `main`. The gate's
purpose: a spec change that alters a wire shape **with no covering case fails CI and cannot merge**
(`fail-if-no-coverage`).

## The tier-1 gate (`gate/`)

- **Denominator** — `bdp_gate::denominator()` parses the repo's generated v0.2.3 OpenAPI catalog, read
  **live** from `specs/generated/openapi/core.openapi.json`, into the tier-1 coverage surface: every
  primitive operation plus each of its declared `>=400` fault statuses. The v0.2.3 surface is
  **54 rows** (13 ops + 41 faults). Reading it live is what makes the gate *lockstep*: when the spec's
  wire surface moves, the denominator moves with it (and a unit test tripwires on the row count so the
  change gets reviewed). A frozen vendored copy would silently stop catching spec changes.
- **Generator witness** — `bdp_gate::source_surface()` derives the SAME surface independently, straight
  from the normative `specs/src/core/core.lumen` `/// openapi =` annotations, and a unit test asserts the
  two agree. `check-generated.py` validates the generation pipeline from the source side; this validates
  it from the consumer side, in a different language, sharing no code — so agreement means the generator
  **invents no rows and drops none**, which neither side can establish alone. A divergence is a real
  signal: either `specs/generated/` is stale, or the lowering dropped or invented a response.
- **Two accepted annotation shapes** — anything counting this surface must read both. 12 primitives use
  `problem = { status = [...] }` (shorthand for "these statuses return a `Problem`"); `call` alone uses
  the explicit `responses = [ { status = ..., schema = ... }, ... ]`, which is load-bearing rather than an
  inconsistency — its statuses carry distinct schemas. A counter that knows only the shorthand
  undercounts by one and reports 51 instead of 52.
- **`call/409` is the one `>=400` row that is NOT a `Problem`** — it responds `application/json` with a
  `Reply` (a declared domain failure; the caller branches on the arm), where every other fault row
  responds `application/problem+json`. A case covering it must assert a `Reply`; expecting a Problem
  there fails for the wrong reason and looks like a reference bug. A unit test tripwires on the
  exception, so a second non-Problem row cannot be quietly assumed Problem-shaped.
- **Cases** — `gate/tests/gate.rs` drives a `RemoteScope` against `Server(InMemScope)` over loopback
  HTTP. Each case records the `SurfaceId`s it covers (e.g. `op/get`, `op/get/fault/404`).
- **Two signals.** A case expected to pass that FAILS always fails the gate (a real wire-level
  regression). Uncovered denominator rows are reported and, under `BDP_GATE_STRICT=1`, fail the gate
  (`fail-if-no-coverage`) — kept non-blocking while tier-1 is filled in, flipped to blocking once the
  surface is covered.

**Current coverage: 18/54**, across three case families:

- **Typed happy-path** — `op/{create,get,put,patch,delete}` (the primitives the Server routes and
  InMemScope implements).
- **Typed semantic faults** — `create/409`, `get/404`, `get/410`, `patch/404`, `patch/412`,
  `delete/404`, `delete/412` (triggered through the typed `RemoteScope`).
- **Raw-HTTP protocol faults** — `get/400`, `create/400`, `put/400`, `delete/400`, `patch/415`, `patch/422`
  (crafted malformed requests via `bdp_protocol::http::send`, exercising the Server's wire validation
  that the well-formed client never reaches).

The remaining 36 rows are uncovered for concrete, recorded reasons:

- **~20 rows need the subject to route/implement 8 more primitives** — `list`, `export`, `import`,
  `pull`, `push`, `call`, `cancel`, `revisions` are not routed by the `Server` ("unmapped in the
  spike" → 501), and `RemoteScope` has no client method for them. Fixing the subject is in scope
  (see below), so this is work rather than a blocked decision.
- **The faults on routed ops are NOT reachable by probing — measured, not estimated.** This list
  previously claimed ~14 of them were "reachable with more raw-HTTP probing". That was speculation and
  it was wrong: every candidate was probed against the subject and **none is producible without a
  subject change.** What the probe actually returned:

  | row | probe | observed | why it is not producible |
  |---|---|---|---|
  | `get/406` | `Accept: application/xml` | `200` | no content negotiation; `Accept` is ignored |
  | `put/412` | `If-Match: stale-rev` | `200` | `put` has **no guard parameter in the trait** |
  | `put/409` | `If-None-Match: *` on a live id | `200` | `If-None-Match` is read nowhere |
  | `put/422`, `create/422` | malformed payload | `400` | malformed bodies are rejected at the wire, so these need a *valid-but-unprocessable* body the subject does not distinguish |
  | `patch/400` | non-array, then non-JSON | `422` | both land on `patch/422`, which is already covered; `patch/400` has no producer |
  | `delete/409` | plain delete | `200` | referential integrity is an advertised capability the subject does not claim |

  **Two of those are findings, not merely gaps.** `do_put` never reads `if-match`, and nothing reads
  `if-none-match` — so a client that sends either gets `200` and believes it had a guard. The `If-Match`
  case is a **lost-update vector**: the write proceeds against a stale revision and reports success.
  Both are trait-level (`BdpScope::put` takes no `if_rev`, unlike `patch` and `delete`), so neither is
  fixable from the cases.
- **The write `410` rows are blocked on a capabilities surface, not on effort.** `put/410` and
  `patch/410` are declared, and a write's `410` is reachable **only under `idModel: permanent`**. The
  subject declares no scope-level id model at all, so a case has nothing to key on.
  `get/410` **is** covered, and correctly so: the subject is `versioned`, and `versioned ⇒ permanent`,
  so keying on the tombstone revision cannot be wrong here. **It needs re-keying rather than deleting**
  — its expectation stays true under `permanent`, but asserting it unconditionally claims more than the
  spec grants, and the mechanism (a tombstone *revision*) would be wrong for an `unversioned` +
  `permanent` scope, which discharges the same obligation from retired-id accounting instead.

### Counting honestly

**Coverage counts rows a case TOUCHES. It is not a claim that each row is independently verified.**
Those are different properties, and conflating them is how a suite comes to overstate itself:

- `delete+erased` was **vacuous** — it passed with its seed `put` never having run, because the
  subject minted a tombstone for an id that never existed, so both `op/delete` and
  `op/get/fault/410` were falsely claimed. Fixed in the subject and the case.
- **5 of the covered rows do not depend on the scope at all** (the four malformed-id `400`s and
  `patch/415`): the `Server` produces them in route parsing and media-type validation, before the
  scope is consulted. The anti-vacuity test names that set exactly — see `SCOPE_INDEPENDENT_ROWS`.
- A case that has **never been seen to fail is not yet evidence.** Each fix here was verified
  red-then-green: the fix removed, the case observed failing with the right diagnostic, the fix
  restored.

## Not the TypeScript `packages/conformance`

The existing `packages/conformance` is the Sprint-1 **TypeScript** suite. This Rust `conformance/`
does not path-collide with it. Intended shape: **one language-neutral case corpus**, re-derived
against the v0.2.3 model, with Rust + TS as two runners over it. Coexist / supersede / reuse is an
open ruling, not settled here.

## Layout

```
conformance/
  Cargo.toml          # the gate workspace
  gate/               # the TIER-1 gate
    src/lib.rs        #   denominator(): the generated OpenAPI -> 52-row coverage surface
                      #   (include_str! of ../../specs/generated/openapi/core.openapi.json, LIVE)
    tests/gate.rs     #   wire-level cases + coverage report (BDP_GATE_STRICT to block)
  reference/          # bdp-ref: the ONE green endpoint (InMemScope over HTTP), pin-agnostic
    src/main.rs       #   Server::new(InMemScope).with_public_base(base).serve(listener)
    tests/liveness.rs #   RemoteScope <-> Server over HTTP: a create -> get round-trip
  subject/            # the SUBJECT UNDER TEST — suite-internal, no external contract (see below)
```

## `subject/` — the subject under test

Four crates, **owned here**, which the cases drive:

- `bdp-primitives` — the `BdpScope` trait + wire types.
- `bdp-jsonpatch` — the RFC-6902 subset used by `patch`.
- `bdp-protocol` — the framework-free HTTP `Server` + the `RemoteScope` client (`impl BdpScope`).
- `bdp-inmem` — the in-memory scope the reference serves.

### No external contract

These crates are **suite-internal**. They are owned in `gastownhall/bdp` and they exist to be
measured by the cases next to them. There is **no semver, no published API, and no stability
promise**, and there is no upstream to track or re-vendor from — they change whenever a case needs
them to. `publish = false` enforces the mechanical half of that; this section is the half that
reaches a person before they depend on the wrong thing.

An implementation may copy them and then owns whatever churn follows. **Divergence from any
similarly-named crate elsewhere is expected, not a defect to reconcile.**

The directory was previously called `vendor/`, which was the wrong name: it implied these were
copies tracking an upstream. They are not.

### The subject is implemented from the spec, never from the cases

> The subject is implemented **from the spec, never from the cases**; the cases are derived **from the
> spec, never from the subject**. Two artifacts independently derived from the same normative text
> remain independent even when one hand writes both — the tautology only materialises when one is
> written by reading the other.

This matters more now than it used to. The subject is owned here, so the gate and the thing it
measures share one owner, and that erodes the property that makes a conformance suite worth running:
that something in the loop has **no authorship stake in the artifact it checks**. The rule above
preserves most of that independence under a single owner.

What makes it worth writing down rather than merely intending is that it turns a matter of care into
something **reviewable**. The question at review time is concrete:

> Does this subject change cite normative text, or does it cite a case?

A change justified by *"to make the case pass"* is the failure mode, and it is visible in a diff. So
is a correct change for a case-shaped reason — see the `415` check in `subject/bdp-protocol`, which
cites the media-type clause and flags the one sub-case the spec leaves ambiguous rather than settling
it by appeal to existing behaviour.

**Flagging beats resolving.** When the spec is genuinely ambiguous, the discipline does not tell you
which reading to take — it tells you to take one and *say so*. Record which reading, and why the other
is live, in the code. That is what makes a wrong choice correctable:

> The discipline's value isn't that it makes you right. It's that it makes you **legible when you are
> wrong.**

The `415` check is the worked example. Its first version exempted an absent `Content-Type` on the
narrower reading that the fault clause named only *"another media type"* — and flagged the ambiguity
rather than closing it by appeal to what the code already did. The spec then ruled present-or-fault,
against that reading, and the fix was one condition because the open question was already written down.
Had it instead said *"preserves existing behaviour"*, the gap would have sat there looking deliberate
and the ruling would have had nothing to land on.

This is a different claim from the independence principle above. That one is about **who** checks; this
one is about **why flagging beats resolving** when you cannot check.

**Two limits, so this isn't oversold:**

- It does **not** protect against the spec itself being wrong. That is what the independent
  `core.lumen` witness (`source_surface()`) and cross-lane probing are for. Someone reading only the
  discipline could conclude they are covered when they are not.
- The mechanism is cheap **only when the checker already exists for another reason**. A discipline
  that requires standing up a new checker for each artifact will not hold.

### Fixing the subject is in scope

When a case covers a row the subject does not implement correctly, **fixing the subject is part of
the work**, not a cross-repo request. Two consequences worth stating, because they cut against the
instinct to treat a green run as success:

- A spec change propagates to the subject **only as far as coverage reaches**. The gate grows with
  coverage; it does not hold the spec to implementation speed.
- `not_implemented` is an **`Ok` signal**, not an error (a 501 is converted to it client-side, since
  `RemoteScope` is itself a `BdpScope`). So a case that merely propagates errors passes against a
  subject that implements *nothing*. The harness refuses a `not_implemented` response for any row a
  case claims, rather than trusting each case to remember — see `record()` in `gate/tests/gate.rs`.

## Run

```
cargo test -p bdp-gate                   # denominator asserts + wire cases + anti-vacuity + report
cargo test -p bdp-gate implements_nothing # the anti-vacuity backstop on its own
cargo test -p bdp-gate -- --nocapture    # also print the covered/uncovered surface
BDP_GATE_STRICT=1 cargo test -p bdp-gate # fail-if-no-coverage (blocking)
cargo test -p bdp-ref                    # the liveness round-trip
cargo run  -p bdp-ref                    # serve the reference at 127.0.0.1:8787 (BDP_REF_ADDR)
```
