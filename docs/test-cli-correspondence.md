# CLI flag correspondence

`node --test scripts/cli-spec-correspondence.node-test.mjs` checks the authored
[CLI command tables](cli-design/bdp-cli.md) against the actual canonical parser
registration. Required CI runs this check in the specification job, including
editorial changes. It needs the pinned Node 24 toolchain and installed workspace
dependencies; it does not need a build, store, service or credentials.

This is **category 1: artifact consistency**, not interoperability qualification
or reference behavior testing. It compares eight singleton mutations: Bead
create/update/delete, Link create/update/delete, and alias put/delete. Expected
flags come from each authored `Flags` table, including compatibility spellings;
actual flags come from `createCanonicalCommand`, without executing commands.
Missing flags in either direction, duplicates, malformed flag cells, absent or
duplicate scoped headings, and boolean versus value-taking arity fail the check.
There is no generated expected command-tree snapshot or parallel normative JSON.

Inherited `--scope` is checked with each command. The root's exact global option
set and arities are checked separately. `--cli-profile` and `--version` are common
CLI controls; `--config` bootstraps the reference executable. These three are
explicit root-only exceptions to per-command tables. Adding a new root control
requires reviewing this boundary; it cannot silently bypass correspondence.

The check intentionally does not interpret prose, defaults, choices, repeatability,
requiredness, lowering, admission, wire effects or service support. A matching flag
can still have incorrect behavior. Independent CLI parser/runtime tests, installed
CLI-to-service journeys and public HTTP cases remain necessary. Protocol schema
and document projections retain their separate existing checks. The correspondence
gate is one enforced structural boundary, not a proof that the protocol, CLI and
implementation are wholly correct by construction.

When changing a scoped flag, edit the authored table and parser together, then run
this check and the affected independent behavior tests. Expand the scope only with
explicitly reconciled command tables and corresponding negative controls.
