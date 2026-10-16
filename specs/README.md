# BDP specifications

This directory is the **only normative source of truth** for BDP. A draft's
status is explicit; being stored here does not imply adoption, implementation or
release qualification. If text outside this directory disagrees, use the
applicable specification here. Historical proposals and implementation notes
outside this directory are non-normative and may be stale.

| Specification | Location | Status and relationship |
| --- | --- | --- |
| Core and Read | [core.md](profiles/core/core.md) | Current BDP v0 draft: shared model, existing Type contract, discovery and reads |
| Write | [write.md](profiles/write/write.md) | Current BDP v0 draft: Read+Update and Transactional; depends on Core/Read |
| Conformance index | [conformance.md](conformance.md) | Shared current-v0 requirement/case index; applicability remains profile-specific |
| Types profile | [types.md](profiles/types/types.md) | WIP next design; does not yet replace Core's existing Type contract |
| Issue/Dependency library | [issue.md](types/issue/issue.md) | WIP domain design using the proposed Types profile; historical implementation evidence is labeled |
| Memory library | [PR143](https://github.com/gastownhall/bdp/pull/143) | WIP on its own branch at `specs/types/memory/memory.md`; not yet adopted or merged |

The Issue draft links its source audit at an immutable authoring commit. That
audit remains unmerged historical evidence outside this specification tree; it
is not a new normative source or a current-build qualification.

`core`, `write`, and `types` directory names organize documents. This editorial
move does not change discovery values, profile inheritance, operation semantics,
or capability advertisements. In particular Read+Update `sequence` is still
non-atomic and Transactional `batch` is still atomic. Removing the existing
Type contract from Core awaits explicit adoption of the Types profile.

Each profile or domain directory keeps its prose and property schemas together,
along with any definition graph. Future OpenAPI documents belong alongside the
profile they describe (`profiles/core/openapi.yaml`, `profiles/write/openapi.yaml`),
not in a separate protocol tree. No OpenAPI contract has been authored here yet.

The existing [BDP v0 schema bundle](profiles/core/bdp-v0.schema.json) remains one
bundle shared by Core and Write. It lives in Core because both use the same model;
splitting its public definitions is not part of this editorial change. Its `$id`
and all `$defs` are unchanged. `packages/protocol/schemas/bdp-v0.schema.json` is a
byte-identical distribution artifact, verified against this source by tests; edit
the source here and refresh the distribution copy together. It has no independent
normative authority.

The Types [schema notes](profiles/types/README.md) explain the candidate artifacts.
`profiles/types/definitions.json` is an illustrative foundation graph, including
Issue examples, not production bootstrap IDs or an installable package. Test
checkers live in `scripts/` and test datasets in `fixtures/specs/`.

Legacy document links lead to a navigation-only page. Sealed catalogs retain
historical source names and hashes; citation tests assemble the current files in
memory to check their excerpts. That compatibility mechanism is not a second
specification. New requirements and authoring should cite the files here directly.
