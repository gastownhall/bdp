# `tools/lumen` — building `core.lumen` inside the BDP repo

**Goal (Donna, 2026-11-11):** the BDP repo builds `specs/core.lumen` into its
projected artifacts — the OpenAPI catalog, the JSON Schema bundle, and the rendered
reference — **standalone, with no reference to the private `lumen` repo** and **no
extra build machinery** (no Rust toolchain, no cargo, no network fetch at build time).

## Approach: vendor the binary, not the source

The Lumen grammar and backends live in the private `lumen` repo. We do **not** copy
that source here — that would fork the grammar (the fleet's "no second grammar" rule).
Instead we vendor the **compiled `lumen` binary**, which is an *artifact* of the one
canonical grammar, into `tools/lumen/bin/`. BDP CI runs it; it never sees Lumen source.

```
tools/lumen/
  bin/
    lumen-darwin-arm64        # vendored binary, per target
    lumen-linux-x64
  lumen.sha256                # checksum of each vendored binary
  VERSION                     # the lumen commit/tag each binary was built from
  lumen                       # shim: picks the binary for the host target, execs it
  build-spec.sh               # runs the shim over specs/core.lumen → artifacts
  README.md                   # this file
```

### The binary contract

`lumen` is invoked as a pure file-in / files-out projector. No daemon, no config
outside flags. Proposed CLI (to confirm with Lydia/Rachel):

```
lumen build specs/core.lumen \
  --emit openapi=build/openapi.yaml \
  --emit jsonschema=build/schema.bundle.json \
  --emit reference=build/reference.html \
  --emit markdown=build/reference.md
lumen --version          # prints the lumen commit SHA + tag the binary was built from
```

Each `--emit <backend>=<path>` runs one backend. Backends are the registered set
(markdown done upstream; openapi, jsonschema, go, cli stubbed). Exit non-zero on a
parse or projection error, with a diagnostic on stderr.

### Provenance — "which grammar built this OpenAPI?"

Every vendored binary must be auditable back to a Lumen commit:

- `tools/lumen/VERSION` records the lumen tag + commit SHA the binaries were built from.
- `tools/lumen/lumen.sha256` pins each binary's checksum; CI verifies before running.
- `lumen --version` must print that same SHA, so a binary and its VERSION can't drift.

### Target coverage

A binary is per-OS/arch. We vendor the targets we actually use — `darwin-arm64` for
local dev, `linux-x64` for CI — and `tools/lumen/lumen` is a two-line shim that selects
by `uname`. Add targets as needed; never vendor one target and assume it runs elsewhere.

### Keeping binaries out of git history

A committed binary bloats history on every re-vendor. Two options, pick one:

1. **git-LFS** for `tools/lumen/bin/*` — truest "no machinery" (the binary is just
   there after checkout), at the cost of an LFS dependency.
2. **Pinned release asset** — keep `VERSION` + `lumen.sha256` in git, fetch the binary
   from a `lumen` release by that checksum in a one-line CI prestep. Clean history, one
   download step. (Still no Lumen *source* reference.)

Default recommendation: **git-LFS**, since Donna asked for no build/fetch machinery.

## The hand-off from the private repo

The binary is built **in the private `lumen` repo** (by Lydia/Rachel's release step)
and its artifact is dropped here. BDP never references Lumen source; the only coupling
is the checked-in binary + its recorded provenance. Re-vendoring = replace the binaries,
bump `VERSION` and `lumen.sha256`. This should become a scripted step on the `lumen`
side that publishes the per-target binaries + checksum for a tagged release.

## Interim: a stand-in so the pipeline is green now

**Blocker:** the real binary does not exist yet. The Rust `lumen-backends` crate is
green only in a scratchpad and is gated on Rachel's document-AST parser merging before
`lumen` can emit a binary carrying the backends.

So the pipeline is bootstrapped with a **stand-in** `lumen` that honors the same CLI
contract and emits the same artifacts, then swapped for the real binary with zero
change to `build-spec.sh` or CI:

- today: markdown + HTML reference (the preview renderer already does this);
- to build next, in the stand-in: **openapi** and **jsonschema** emitters driven by the
  `/// openapi = {…}` and `/// jsonschema = {…}` metadata already in `core.lumen` — this
  also proves the file carries enough metadata to drive a *complete* OpenAPI;
- package the stand-in as a single self-contained executable (zipapp / shiv / PyInstaller)
  so there is no Python dependency in CI, matching "no extra build machinery."

The stand-in is clearly marked temporary and reports `--version: standin-<date>` so it
can never be mistaken for a real grammar-backed build.

## Open questions (for Donna / Lydia / Rachel)

1. Final `lumen` CLI surface — flag names, one-emit-per-invocation vs a manifest.
2. Release shape on the `lumen` side: who builds the per-target binaries, and does a
   `lumen` tag publish them as assets (for the LFS-vs-release-asset choice above)?
3. Where artifacts land in the repo: `build/` (gitignored, CI-only) vs a committed
   `specs/generated/` so reviewers see the OpenAPI/JSON Schema diffs.
4. Which targets to vendor beyond darwin-arm64 + linux-x64.
