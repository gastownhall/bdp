# `conformance/` — the BDP wire-level conformance gate (Rust)

**Pin:** core spec **v0.2.3** = `gastownhall/bdp` #405 @`7aaecec2` (draft; re-pin to the #405 **merge**
commit when it lands). This is the lockstep merge gate for the Beads Protocol.

## What this is

A native Rust, wire-level, **black-box** conformance suite: cases run over HTTP against a single
in-memory reference endpoint. It is its own **self-contained** cargo workspace — one `cargo build`
/ `cargo test`, mainstream deps, no Node, DB, or network — so it stays green on `main`. The gate's
purpose: a spec change that alters a wire shape **with no covering case fails CI and cannot merge**
(`fail-if-no-coverage`).

## The tier-1 gate (`gate/`)

- **Denominator** — `bdp_gate::denominator()` parses the pinned v0.2.3 OpenAPI catalog (vendored at
  `gate/spec/core.openapi.json`) into the tier-1 coverage surface: every primitive operation plus
  each of its declared `>=400` fault statuses. The v0.2.3 surface is **52 rows** (13 ops + 39 faults).
- **Cases** — `gate/tests/gate.rs` drives a `RemoteScope` against `Server(InMemScope)` over loopback
  HTTP. Each case records the `SurfaceId`s it covers (e.g. `op/get`, `op/get/fault/404`).
- **Two signals.** A case expected to pass that FAILS always fails the gate (a real wire-level
  regression). Uncovered denominator rows are reported and, under `BDP_GATE_STRICT=1`, fail the gate
  (`fail-if-no-coverage`) — kept non-blocking while tier-1 is filled in, flipped to blocking once the
  surface is covered.

**Current coverage: 7/52** — `op/{create,get,put,delete}` + `create/fault/409`, `get/fault/404`,
`get/fault/410`. The remaining rows are uncovered for concrete, recorded reasons:

- **Reference doesn't implement the op** (over the wire): `pull`, `push`, `call`, `cancel`,
  `revisions`, and `list`/`export`/`import` are not routed by the vendored `bdp-protocol` Server yet
  (they round-trip as `not_implemented`).
- **Reference semantics don't produce the fault**: e.g. `delete` is idempotent in InMemScope, so
  `op/delete/fault/404` isn't producible against it.
- **Protocol-level faults need raw HTTP** (malformed/`400`, `406`, `415`, `405`) rather than the
  typed client — a later case family.

These are what the gate exists to make visible. Growing coverage = extending the reference's routed
surface and adding cases; the denominator is fixed by the spec.

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
    spec/core.openapi.json  #   pinned v0.2.3 OpenAPI (the denominator source)
    src/lib.rs        #   denominator(): OpenAPI -> 52-row coverage surface
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
