# What is left in `specs/`, and what each remaining resident waits on

**Status:** inventory, not a ruling. Written 2026-11-23, after `specs/history/` and the three
`obsolete-*` files left `specs/`. The goal it serves is Donna's: "Two top level directories.
`src` and `generated`. Period."

Nothing here proposes a deletion. For each resident this records what it *is* — live,
superseded, generated or provenance — and the one question whose answer unblocks it. Several
are load-bearing in ways that are not visible from the file tree, so the evidence is cited.

## Already out

| was | now | why |
|---|---|---|
| `specs/history/` (41 files) | `docs/history/` | provenance; pure renames, byte-identical |
| `specs/obsolete-core.md` | `docs/history/obsolete-core.md` | `specs/AGENTS.md` still cites it ("harvest only, do not cite") |
| `specs/obsolete-bdp.lumen` | deleted | zero references anywhere in the repo |
| `specs/obsolete-bdp-linkmodel.lumen` | deleted | zero references anywhere in the repo |

## The two keepers

**`src/`** — authoring sources: `core/core.lumen`, `packs/{issue,memory,ops,stdlib}/`,
`bdp.md`, `bdppacks.md`, plus `CHANGELOG.md`, `HISTORY.md` and the two `core/review-*.md`
documents. One of the two permitted directories.

**`generated/`** — five schema bundles, `core.md`, `openapi/core.openapi.json`, four callable
catalogs. Checked by `scripts/check-generated.py`. The other permitted directory.

### Two of their paths are published interface, not internal layout

These two are pinned at build time by the conformance gate, which lives in a **different
repository**. Moving or renaming either breaks that build:

- `specs/generated/openapi/core.openapi.json`
- `specs/src/core/core.lumen`

This matters beyond "don't touch them". Everything else in this inventory is internal layout,
free to move once someone rules on it; these two are a **published interface with an external
consumer**, so they are not at the disposal of a future `specs/` reorganization even inside
`src/` and `generated/`. Any later tidying within the two keeper directories — splitting
`core.lumen`, renaming the generated OpenAPI document, introducing a version segment — is a
breaking change to another repository's build, not a local refactor. Treat a change to either
path as requiring that repository's agreement first.

Neither path is moved, renamed or repointed by the change this inventory accompanies, and
neither appears anywhere in `docs/design/spec-path-map.json`.

*Provenance of this entry:* relayed to me by the session coordinating this work, which recorded
the full constraint in `specs/AGENTS.md` under "Paths another repository depends on". That
section is **not** present at this branch's base (`aa439827`) — it lives on the unmerged
`lydia/fix-resource-self-cycle` branch (PR #407) — so the constraint is recorded here as
relayed, not as read from the tree. Whoever reads this after #407 merges should prefer the
`specs/AGENTS.md` text, which names the pinning repository and gate.

## Blocked behind the protocol ref-map ruling

These four cannot move until it is settled whether `packages/protocol` keeps implementing the
v0/v0.1 profile wire protocol or is re-authored against the v0.2.3 primitive surface. A
parallel session measured that question and found neither "repoint" nor "alias shim" is
implementable — 0 of protocol's 35 `#/$defs/` targets exist in the generated bundle, and no
generated def accepts protocol's wire payloads. That is a rewrite decision, not a path edit.

### `profiles/` — LIVE
Holds the schemas that are still validated against:
`core/bdp-v0.1.schema.json` is a `CORE_BUNDLE` in `scripts/check-spec-editorial.py`,
byte-twinned with `packages/protocol/schemas/bdp-v0.1.schema.json`;
`types/types-v1.schema.json`, `write/id-root-v1.schema.json` and
`write/delete-modes-v1.schema.json` are its `FEATURE_BUNDLES`.
The prose `core/core.md`, `write/write.md`, `types/types.md` and `events/events.md` are
exactly the four entries of `PROTOCOL_SPECIFICATION_PATHS` in
`packages/conformance/test-support/spec-source.ts`, which the conformance catalogs cite by
path. `transfer/transfer.md` and `callables/callables.md` are live design.

**Waits on:** the ref-map ruling above. Nothing under `profiles/` can move before it.

### `conformance.md` — LIVE, load-bearing
Eight `docs/design/spec-path-map.json` anchors own it; `spec-layout.test.ts` link-checks it as
one of its seven `documents`. `packages/conformance/test-support/historical-citation-source.ts`
pins a *vendored snapshot copy* at 51,973 bytes / sha256 `5bcfe0b2…`; the live file is 53,220
bytes, so the live text is deliberately free to drift from that pin. It is the v0.1 conformance
prose for the v0.1 profiles.

**Waits on:** `profiles/`, plus the conformance re-keying that would follow.

### `openapi/` — GENERATED (a second generated tree)
`scripts/generate-openapi.mjs` writes `bdp-v0.1.openapi.json`, `coverage.md` and `commands.md`
from the profile appendices; `pnpm openapi:check` and `scripts/openapi.node-test.mjs` verify
them. `README.md` here is authored, not generated. Its v0.2 successor already exists at
`specs/generated/openapi/core.openapi.json`.

**Waits on:** `profiles/` — it is generated *from* that prose, so it retires with it.

*Noticed in passing:* `scripts/check-spec-editorial.py:134` lists
`specs/openapi/bdp-v0.1.tooling.openapi.json`, which does not exist. Harmless today (set
membership only, never opened), but stale.

### `types/` — mixed
- `type-system/type-system.md` is **already marked superseded**: it is in
  `check-spec-editorial.py`'s `SUPERSEDED` set, so canonical documents are forbidden to link
  to it. It is nonetheless still cited by `specs/types.md` and several `profiles/types/`
  documents. **Waits on:** dropping those citations from live documents — then it is a
  `git mv` to `docs/history/`.
- `issue/callables.md` and `issue/issue-callables-preview-1.schema.json` are **generated** by
  `scripts/generate-issue-callables.py` (the script emits the §10 text verbatim). This makes a
  third generated tree. Meanwhile `specs/src/packs/issue/` and
  `specs/generated/callables/issue.callables.json` exist as the v0.2 Issue-callable artifacts.
  **Waits on:** which of the two is authoritative. Nobody has ruled, and two Issue-callable
  artifacts coexist today.

## Needs only a ruling from Donna — no code blocks these

### `types.md` — LIVE DRAFT, the one piece of unfinished work here
Frontmatter: `status: draft`, `intended-status: normative`, `version: "0.2"`.
`specs/README.md:16` says: "A v0.2 rework is underway as fresh top-level documents:
Types — v0.2 draft (status: draft). The v0.1 Types profile above remains the source of the
Types schema, OpenAPI and kit until the v0.2 sections are ruled." **Must not be deleted.**

**Waits on:** whether v0.2 Types is authored in Lumen (so it becomes a `src/` `.lumen` source)
or stays authored prose like `src/bdp.md` (so it becomes `src/types.md`).

### `deferred.md` — LIVE register
Cited by all five profile documents (`core`, `write`, `types`, `transfer`, `events`) and by
three `docs/plans/` documents. It is the open-items register: a record of what is deliberately
*not* specified.

**Waits on:** whether an open-items register counts as specification. If not, its home is
`docs/`. Mechanical cost: five profile links plus three plans.

### `formats/` — LIVE authoring conventions
`README.md`, `markdown-openapi.md` and `markdown-type-definitions.md` are the three
`AUTHORING_DOCS` that `check-spec-editorial.py` link-checks on every run;
`generate-openapi.mjs:844` names `specs/formats/markdown-openapi.md` as the convention its
output declares. Also here: `markdown-json-schema.md`, `markdown-json-schema-v0.5.md`,
`lumendoc-markdown-reference.md`.

**Waits on:** where authoring conventions live. They are neither spec text nor generated
output, so either `docs/` (they document the toolchain) or `specs/src/formats/` (they are the
authoring contract *for* `src/`). Cost after the ruling: update `AUTHORING_DOCS` and one string
in `generate-openapi.mjs`.

### `README.md` — LIVE entry point
An `ENTRY_POINTS` document in `check-spec-editorial.py`; its links are checked on every run. It
is the `specs/` front door, currently indexing both the v0.1 profiles and the v0.2 drafts.

**Waits on:** does "two directories, period" forbid a `README.md` at `specs/`? Either it
survives as the single permitted loose file — an index is not a directory — or it folds into the
root `README.md`.

### `AGENTS.md` — LIVE authoring instructions
Covers `src/core/core.lumen`, `src/bdp.md` and `generated/core.md`. Cited only by
`specs/src/HISTORY.md`. Its subject matter is entirely inside `src/`.

**Waits on:** the same `README.md` question. If no loose file may sit at `specs/`, this is a
mechanical `git mv` to `specs/src/AGENTS.md`.

## Retire once confirmed

### `BASELINE-NOTES.md` — PROVENANCE, stale
A dated branch-triage note ending in "Decisions I need from you", items 1–5 — several since
answered (the baseline is now `src/core/core.lumen`; the toolchain question is settled). Cited
only by `specs/src/HISTORY.md`. No code touches it.

Its three `history/` mentions are narrative, not links. Line 89's now-stale `specs/history/`
was **left as written**: rewriting a dated note's record of a past proposal would falsify it.
That is the one `specs/history` string remaining in the repository, and it is deliberate.

**Waits on:** Donna confirming items 1–5 are closed. Then `git mv` to `docs/history/`.

### `package.lumen` — SUPERSEDED orphan, the clearest removal candidate
The Package pack authored as Lumen. **No script reads it.** The five generated bundles come
from `src/core/core.lumen` plus `src/packs/{issue,memory,ops,stdlib}/` — and there is no
`src/packs/package/`. The only mention anywhere in the repository is
`specs/src/HISTORY.md:34`, which records that the Memory and Issue packs moved to `src/packs/`;
`package.lumen` did not. The live Package design is `experimental/packs.md`.

**Waits on:** one question — is `package.lumen` superseded by `experimental/packs.md`, or is it
an unmigrated authoring source that belongs at `src/packs/package/`? Either answer resolves it
immediately.

## Summary of what blocks what

| resident | status | blocked by |
|---|---|---|
| `src/`, `generated/` | keep | — (but `src/core/core.lumen` and `generated/openapi/core.openapi.json` are cross-repo pinned published interface — not freely movable even within the keepers) |
| `profiles/` | live | protocol ref-map ruling |
| `conformance.md` | live | `profiles/`, then conformance re-keying |
| `openapi/` | generated | `profiles/` |
| `types/type-system/` | superseded | dropping live citations |
| `types/issue/` | generated | which Issue-callable artifact is authoritative |
| `types.md` | live draft | Lumen or prose for v0.2 Types |
| `deferred.md` | live register | is a register specification? |
| `formats/` | live conventions | where conventions live |
| `README.md` | live entry point | may a loose file sit at `specs/`? |
| `AGENTS.md` | live instructions | same as `README.md` |
| `BASELINE-NOTES.md` | provenance | confirm its items 1–5 are closed |
| `package.lumen` | superseded orphan | superseded, or unmigrated? |
