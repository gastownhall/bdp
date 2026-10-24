# Ordinary object-edit inputs: CLI and Write correspondence

Candidate under existing [#279](https://github.com/gastownhall/bdp/issues/279) and
sole [#59](https://github.com/gastownhall/bdp/issues/59). Base is PR289 snapshot
follow-through `253bda933a55902eefdc68bbcd9e3154dfecd87b`, whose semantic source was
reviewed at `3540595d177c149105d59d607c46473e23add04c`. This is a new paired input
slice, not inherited PR289 qualification, full #279 closure or profile adoption.

The [CLI object modes](../cli-design/object-edits.md) now have a matching
[protocol input contract](../../specs/profiles/write/object-edits.md). Ordinary
updates add explicit `properties`/`metadata` replacement members, exclusive with
corresponding patch members. Replacement, patch and omission remain distinct
intents. Properties and metadata choose modes independently; `type`, guards and
provenance keep their existing meanings. The primary whole-state no-op and
pre/post ownership-result rules from PR289 are unchanged.

A writable-set replacement cannot be faithfully encoded as a literal root patch:
under Types, preserved init-only/service-completed fields and input-policy checks
have different responsibilities. The distinct fields carry that intent. The
request grammar validates object shape; provider admission enforces input policy
and validates the completed result. It must not demand a generated required output
field from the caller or silently accept prohibited supplied input. Core-only
literal replacement remains subject to native constraints. No Type input-schema
endpoint, Type definition edit or runtime enforcement is invented here.

Types authority is Trish PR283@`a2aa88d9b5a0e0d78f48de2967d4ceaa38177876` §3.6.
Existing init-only values survive retyping and departure as specified there;
explicit service-managed input refuses even when equal; protected children cannot
be bypassed through a parent. Metadata is separate. Trish owns actual Types
integration; no Types files or narrow exact-definition read transport are changed.

## Request shape and compiler boundary

Only `updateBeadMembers` and `updateLinkMembers` change in the new schema slot:
add two object members, extend the required-edit alternatives to five, and forbid
replacement+patch per plane. No definitions are added or removed (163 remain).
Singleton/shared batch/inherited sequence shapes all compose those members.
Creation, set-write grammar, endpoint references, Type carrier, output/Event
schemas and new contract/capability binding are unchanged. Sequence remains staging
accounting, not a retained CLI command. Optional six-CRUD batch discovery/support/
refusal/results and the smaller result carrier remain #152 author work.

CLI merge/keyed edits lower to ordinary patches, with strict patch meaning retained.
An absent writable unset may compose add-null/remove only with whole-edit policy
admission and final validation. A renderer must preserve replacement instead of
substituting a root patch. Routine deterministic emission choices are explicit:
merge keys in code-unit order; last keyed set wins without moving its first position;
deduplicated unsets follow all sets in first-occurrence order. These are author
choices for the concrete CLI, not new human rulings or parser execution claims.
Cleo is named in the sidebar, with no interruption request.

## Bounded fanout and validation

The pre-edit construct inventory covers 90 files, separating four existing new-target
source/schema files from held code/fixtures, Types-owned source and live quotations.
New scoped CLI/protocol/correspondence, candidate examples and a test are added.
Old v0 artifact/mirror/runtime/behavior fixtures remain unchanged; PR289's already
accepted stale-test repair is inherited, with no further old-test edit. Active
catalog/source loader and selection guards stay intact. All 569 current quotations
resolve without a catalog change in this slice.

The nine new artifact tests plus the prior nine-file source/artifact/catalog slice
pass **447/447 tests across ten files, zero failures/skips** (Node24.19.0,
Vitest4.1.10). Twenty request cases across Bead/Link singleton, shared batch and
inherited sequence positions provide 120 matrix assertions. Seven CLI/operation
pairs and the illustrative common schema validate structurally; these are paper
pairs, not an executed compiler. Sixteen semantic scenarios remain unexecuted.
No provider/HTTP/installed/hosted or full-suite qualification is claimed.

Mechanical delta checks confirm exactly the two shared definitions and unchanged
envelope/other definitions, strict compilation, mirror equality and held old bytes.
The old schema remains SHA256 `15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327`;
the candidate/mirror is `94de211f886ab57f841107ca45af2c0ab676aca32a4b016ffcae7e6194ce5b7c`.
Twenty-three JSON fences and 177 local file/anchor links resolve, including the
exact Types §3.6 source anchor; four changed TS/JSON files pass Biome and whitespace
checks pass. The correspondence/evidence was added after the 447 run; operation,
schema, test and candidate-fixture inputs are unchanged. Fresh source checks run
against the completed candidate. Any later evidence adjustment is recorded at its actual
source rather than rewriting an older run into a PASS. Full profile factoring,
actual Types composition and Event D1/D2/Type-only ownership encoding remain gates.
Vickie/runtime/product/main pins, `serve`, Experimental and larger campaigns stay held.
