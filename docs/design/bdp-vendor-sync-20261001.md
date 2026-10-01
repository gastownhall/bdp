# BDP vendored contract comparison — 2026-10-01

This is a dated artifact comparison, not a runtime conformance claim or a
feature plan. BDP owns the abstract model and protocol; see the
[repository authority boundary](../../README.md#architecture-and-design-authority).

## Sources checked

| Repository | Branch | Verified remote commit |
| --- | --- | --- |
| `gastownhall/bdp` | `main` | `182f1fcf8a01d896976bff3c9e3fb87c596c6ca6` |
| `donnabox/beads` | `codex/janet-graph-help-playtest-20261001` (PR72 source) | `9a17ee9d1659aa88f247a9bd06c4284bf5ea30ba` |
| `versioned-beads/beads` | `integration` | `93a6d606bc371f9d0160d36daed437f0fe1db04b` |

Donna's fork's `main` does not contain the BDP wire vendor directory; the
active graph branch above is the comparison target. Jim's fork uses
`integration` as its default branch. BDP PR57 at
`1304104a9af1b67f485ffc24dd7ff717334bc6e0` changes only a blog document.

## Results

- Neither Beads tree contains a full copy of `docs/specs/bdp.md`. The vendor
  directory is `internal/httpapi/bdpwire/schema/`: schema, selected source
  inputs, fixtures, examples, derived Read artifacts, and provenance.
- All **26 files** in that directory have identical Git blob IDs between
  the two Beads branches.
- All **10 directly copied upstream files** match current BDP `main`
  byte for byte: the schema, four fixtures (reference domain, both Read
  fixtures, and History wire), Read catalog and matrix, and three TypeScript
  inputs (`schema-read-projection`, `read-values`, and `history-values`).
- The recorded spec blob, `2532f6f7a1761ba3954894bcdb5070675f4c8d36`, is
  also the blob on current BDP `main`. All **13 vendored JSON examples**
  match the cited ranges of that spec as JSON values.
- The two derived Read files and provenance match between forks. Their
  recorded source inputs match upstream; regeneration was not run.
- The three Beads design documents (`BDP_BEAD_GRAPH_PLAN.md`,
  `BDP_GRAPH_ARCHITECTURE.md`, and `BDP_GRAPH_CLI_AND_STORAGE_SPEC.md` in
  `engdocs/`) are also identical between the two branches. They are Beads
  implementation designs, not copies of the BDP specification.

## What is behind

Both provenance files name BDP commit
`53bdbd03136875f952af184fce7b3c7af8f74e96`, which is 76 commits behind the
checked `main`. The spec and directly vendored contract artifacts have not
changed across that interval. A newer repository commit alone is therefore
not evidence that the vendored contract needs updating.

The Beads architecture document also cites the older `19923f5b` Read adoption
as historical evidence; the vendor `PROVENANCE` file carries the actual
current artifact pin. These dates and pins should not be confused with
independent versions of the model.

No contract-content drift was found in this scan. Runtime behavior, coverage
of additional protocol profiles, and semantic alignment of implementation
designs with the spec were not audited. No Beads files were changed.
