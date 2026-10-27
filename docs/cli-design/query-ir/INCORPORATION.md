# Read/Query incorporation map

October 26, 2026. Author coordination notes for PR310; not another normative source.
This contribution is based on `7f2d6afc97278a459333d3957424dba50fe223e9`, following
Donna's autonomous dinner/movie authoring authorization. Sybil confirmed the new
files and separate author worktree. Existing held protocol/schema/pin bytes and
consumer/runtime sources are unchanged.

## New source homes

| Home | Role |
| --- | --- |
| [Core Query candidate](../../../specs/profiles/core/query.md) | One semantic source, selected rulings versus author proposals, profile/result/admission obligations |
| [Resource projection candidate](../../../specs/profiles/core/resource-projection.md) | Accepted shared current/exact/List Resource projection target |
| [CLI/AST explanation](../query-ir.md) | Surface correspondence, draft grammar and integration questions |
| [Design schema](query.schema.json) | Proposed AST shape, independent of held distribution schema |
| [Cases](cases.json), [fixtures](fixtures.json), [four examples](EXAMPLES.md) | Authored positive/refusal and lowering obligations |
| [Explore the graph](../overview/02-explore-graph.md) | Informative linear overview, no early revision/pin teaching |

The schema spelling, profile names, logical request wrapper and initial static
admission restrictions are author proposals. They are not automatically adopted
because the underlying semantics were accepted. Original AST-less JSONPath
alternatives remain research inputs; they are not the selected starting wire form.

## Bounded changes for the shared entry editor

Sybil owns `bdp-cli.md` and its assembly. Apply these changes deliberately rather
than copying the entire entry from another worktree:

1. Link overview02 into the agreed narrative before CRUD03. Its fixture adds
   csv-plan/csv-format/csv-review/csv-encoding and four Links, leaving CRUD's
   csv-draft/csv-checks/csv-context creation story untouched. See fixtures.overview
   for exact values. The two authoring sections use the same selected Scope.
2. Shared output and Show/List summaries currently say masks are display-only.
   The accepted target is server Resource projection on current GET, exact GET,
   and List items. Preserve native views/validators and explicitly amend the
   current exact-History revision-only query restriction. Do not imply a display
   adapter already implements this native capability.
3. Existing List reference exposes the retained bounded `--selector JSONPATH`.
   Preserve its current meaning and obligations. Add the new structured predicate
   and AST route only with its selected transport/discovery and capability binding.
   Do not turn raw Selectors into graph source or silently remove the Core minimum.
4. Existing List/native protocol has no exact count request. Add the shared
   service result mode for List/Query, with distinct edition count before paging.
   Avoid page-length counts or an implicit client full-scan fallback. Final flag
   conflict rules and request routing remain explicit incorporation work.
5. Graph/Query command reference needs exact argument/file input spelling,
   command-kind assertions, graph component projection targets, and common
   response/error/continuation binding. Selected expressions are not proof of a
   final parser grammar or implemented route.
6. `versions` is the accepted dedicated subject History GET view. Its retained
   summaries and native continuation are separate from exact historical Resource
   GET and ordinary List masks. Preserve Kind assertions and actual capability
   qualification. No historical List population or ordinary List pager is added.
7. The entry's later shared write-flag grammar accepts a local number or `=TOKEN`
   for `--if-revision`/`--from-revision`. Earlier Scope/reference and read helper
   text still calls the explicit guard flag literal-only. Overview05 follows the
   newer grammar and strips the exact-token marker before transport. Reconcile
   those helper paragraphs with the selected bracketed-URL selector syntax and
   removal of standalone `--revision` and `json:` Reference escapes. Native
   protocol revision tokens/query decoding remain unchanged.
8. The ordinary-read contrast in `exact-definition-read.md` also has an old
   standalone read revision flag. Its owner should change that example to a
   suffix/bracketed URL without changing exact Type-definition interpretation
   intent, origin, authority, or the native lookup operation.

## Protocol/schema/discovery work outside this patch

The new Core modules need explicit front-door inclusion when accepted. The held
Core monolith, canonical/distribution schema, registry, service descriptors,
capability identifiers, request endpoints, generated clients, pins and release
versions are not updated here. Trish's composition review should check Type-family
authority and Reference interpretation against these nodes. Actual implementation
and provider conformance remain separate work with their existing ownership.

No broader runtime change is necessary to review this draft. JSON Schema and
static admission checks validate only the proposed artifacts. The case ledger's
expected query results, response completeness, HTTP behavior, and backend
equivalence remain unexecuted obligations.

An actual [Claude review and disposition](review/README.md) accounts for projection
schema/full-record conflicts, input/endpoint acquisition boundaries, profile
admission and case gaps. Review recommendations that would change Donna's
unavailable-data semantics or remove selected sort/count targets were not adopted.
The initial historical-root/external-graph limits are visible author proposals.
Staged Memory witness-graph composition remains an explicitly unimplemented IR
result extension, rather than a claimed replacement for every domain facade.
