# `conformance/` — the BDP wire-level conformance gate (Rust)

**Pin:** core spec **v0.2.3** = `gastownhall/bdp` `main` @`aa439827` (the #405 **merge** commit, where
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

**Current coverage: 17/54**, across three case families:

- **Typed happy-path** — `op/{create,get,put,patch,delete}` (the primitives the Server routes and
  InMemScope implements).
- **Typed semantic faults** — `create/409`, `get/404`, `get/410`, `patch/404`, `patch/412`,
  `delete/412` (triggered through the typed `RemoteScope`).
- **Raw-HTTP protocol faults** — `get/400`, `create/400`, `put/400`, `delete/400`, `patch/422`
  (crafted malformed requests via `bdp_protocol::http::send`, exercising the Server's wire validation
  that the well-formed client never reaches).

The remaining 37 rows are uncovered for concrete, recorded reasons — and splitting them shows the
next decision:

- **~20 rows need the reference to route/implement 8 more primitives** — `list`, `export`, `import`,
  `pull`, `push`, `call`, `cancel`, `revisions` are not routed by the vendored `bdp-protocol` Server
  ("unmapped in the spike" → 501), and `RemoteScope` has no client method for them. Covering them
  means **forking the vendored crates** (reopening the vendor-vs-purpose-built question below) or
  improving upstream `bdp-protocol`/`bdp-inmem` and re-vendoring.
- **~16 rows are faults on routed ops** reachable with more raw-HTTP probing (content negotiation
  `406`/`415`, specific `409`/`422` conditions) — or not producible against InMemScope at all (e.g.
  `delete` is idempotent, so `delete/404` never fires).
  - **`patch/415` is a REFERENCE gap, not a case gap.** It is the entire 52-vs-51 delta against v0.2.2
    (the "`patch` is root-addressed" change pins the request to `application/json-patch+json`), and
    `vendor/bdp-protocol` performs **no server-side content-type check at all** — the client sends the
    right type, the Server never validates it. Covering it is one check in the patch route, not a new
    case. Deliberately left uncovered-with-reason until the vendor-vs-upstream question below is ruled:
    a local edit to a vendored crate would become a divergence to unwind if the ruling is "upstream".

Growing coverage = extending the reference's routed surface and adding cases; the denominator is
fixed by the spec.

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
  vendor/             # reference-implementation crates (see below)
```

## `vendor/` — the reference implementation

`vendor/` holds four crates copied in so the gate builds with **no out-of-tree source**:

- `bdp-primitives` — the `BdpScope` trait + wire types.
- `bdp-jsonpatch` — the RFC-6902 subset used by `patch`.
- `bdp-protocol` — the framework-free HTTP `Server` + the `RemoteScope` client (`impl BdpScope`).
- `bdp-inmem` — the in-memory scope the reference serves.

**Open decision (flagged for review):** vendoring these existing crates is the simplest path to a
green gate. The alternative is a purpose-built minimal reference authored in-tree; if preferred,
`vendor/` is the only thing that swaps.

## Run

```
cargo test -p bdp-gate                   # denominator asserts + wire cases + coverage report
cargo test -p bdp-gate -- --nocapture    # also print the covered/uncovered surface
BDP_GATE_STRICT=1 cargo test -p bdp-gate # fail-if-no-coverage (blocking)
cargo test -p bdp-ref                    # the liveness round-trip
cargo run  -p bdp-ref                    # serve the reference at 127.0.0.1:8787 (BDP_REF_ADDR)
```
