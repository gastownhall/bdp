# `conformance/` — the BDP wire-level conformance gate (Rust)

**Pin:** core spec @`ca298b04` (v0.2.2). This is the lockstep merge gate for the Beads Protocol.

## What this is

A native Rust, wire-level, **black-box** conformance suite: cases run over HTTP against a single
in-memory reference endpoint. It is its own **self-contained** cargo workspace — one `cargo build`
/ `cargo test`, mainstream deps, no Node, DB, or network — so it stays green on `main`. The gate's
purpose: a spec change that alters a wire shape **with no covering case fails CI and cannot merge**
(`fail-if-no-coverage`, landing in a follow-up).

This first PR is the **pin-agnostic** slice: the reference endpoint plus an end-to-end liveness
test. The spec-denominated cases (derived from the spec surface via lumendoc) land next.

## Not the TypeScript `packages/conformance`

The existing `packages/conformance` is the Sprint-1 **TypeScript** suite. This Rust `conformance/`
does not path-collide with it. The intended shape: **one language-neutral case corpus**, re-derived
against the v0.2.2 model, with Rust + TS as two runners over it. Whether the two coexist / supersede
/ reuse is an open ruling, not settled by this PR.

## Layout

```
conformance/
  Cargo.toml          # the gate workspace
  reference/          # bdp-ref: the ONE green endpoint (InMemScope over HTTP)
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
green gate (done here). The alternative is a purpose-built minimal reference authored in-tree. If
that is preferred, `vendor/` is the only thing that swaps — nothing above it changes.

## Run

```
cargo test -p bdp-ref        # builds + runs the liveness round-trip (the gate's first check)
cargo run -p bdp-ref         # serves the reference at 127.0.0.1:8787 (BDP_REF_ADDR to override)
```
