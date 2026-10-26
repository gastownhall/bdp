# BDP specifications

> **This directory is the ONLY source of truth for BDP specifications.**
> If a requirement is not defined under `specs/`, it is not part of the BDP
> specification. No issue, PR discussion, design note, old monolith, vendored copy,
> test or implementation outside this directory can add to or override it.

Use the applicable specification at the **named branch, commit or release**.
The `specs/` tree on a design branch contains proposed changes; its existence
does not amend an older implementation target or establish adoption. Within that
tree, respect each document's status: a WIP Types or domain draft does not silently
replace the current Core/Write contract. Conflicts between documents or between
prose and schemas must be resolved in the owning specification, not by selecting
whichever copy or implementation is convenient.

Material elsewhere is non-normative and may be stale or wrong about the contract.
Implementation reports and test results are evidence of observed behavior, not
additional requirements. Publication, adoption, implementation and release
qualification are separate milestones.

## Specification status

**Evidence snapshot: October 16, 2026.** This table summarizes design and evidence
recorded at the frozen BDP main baseline `8d6671ed19b0c0406428ccc2d2161768d01e8b9b` and the separately identified
domain drafts and source snapshots. Test observations retain their original
source/build identities; they are not new observations of the frozen main commit.
This is not a certification of the latest `bd` release or of ongoing implementation
branches. Reference implementation means this repository's
`bdp` client, `bdptest` server and `bdpbd` adapter; `bd` means the Beads product.
Serving BDP through `bdpbd` is distinct from native BDP support in `bd`.

| Specification | Design stage | Reference implementation | Implementation in `bd` |
| --- | --- | --- | --- |
| [Core and Read](profiles/core/core.md) | Current BDP v0 draft: shared model, existing Type contract, discovery and reads. | **Read evidence verified**, including both packaged and in-process self-certified cases, for `bdptest` and `bdpbd`; see [Read evidence](../STATUS.md). This does not qualify every optional capability. | **Read via adapter**, against pinned [`bd` 1.0.5](../docs/design/evidence/bd-baseline/README.md). Native BDP serving and other `bd` builds are not established by that result. |
| [Write: Read+Update](profiles/write/write.md#part-iii--readupdate) | Current BDP v0 draft; depends on Core/Read. | **Partial / in progress:** client and runtime components exist; complete served-profile qualification remains open. See [implementation evidence](../STATUS.md). | Existing native commands can write Issues and Dependencies; **BDP Read+Update conformance is not established**. |
| [Write: Transactional](profiles/write/write.md#part-iv--transactional) | Current BDP v0 draft; extends Read+Update. | **Partial / in progress:** wire, runtime components and tests exist; no complete Transactional capability claim. Active work remains on Vickie's branches. | **Not qualified** for this BDP profile. A native batch operation alone does not establish BDP atomicity, receipts, Events or recovery behavior. |
| Optional History — within [Core/Read](profiles/core/core.md) and [Write](profiles/write/write.md) | Specified in the current draft; optional across the profiles, not a separate document. | **Partial:** historical-read client and controlled fixture walkthrough exist. A History server/adapter and full capability qualification are not established by the cited baseline. | **Not qualified** for BDP History. Native journals/history are not evidence of the full protocol contract. |
| [Types profile](profiles/types/types.md) | **WIP design:** optional profile, Type Beads and conformance. Does not yet replace Core's existing Type contract. | Candidate schemas, literals and offline checks only; **profile implementation not established**. The existing Type Descriptor implementation is a different contract. | **Proposed profile not established.** Existing built-in Types and isolated groundwork do not implement its installation, versioning, conformance and migration contract. See [readiness](profiles/types/types.md#8-readiness-and-landing). |
| [Issue/Dependency library](types/issue/issue.md) | **WIP design:** preserves existing domain semantics while specifying the proposed Type representation. | Existing Issue/Dependency Read projection is exercised; **this proposed library is not qualified**. Property-schema checks do not establish runtime admission. | **Existing domain behavior, partial mapping:** Preview 2 CLI classification shims are recorded; the new Type graph and full mapping are not qualified. Planned Preview 3 work is not a completion claim. See [domain readiness](types/issue/issue.md#10-ready--pending--nyi). |
| [Memory library](types/memory/memory.md) | **WIP seven-Bead/nine-Link review catalog:** Decision and Procedure removed; Scenario retained. Selected Evaluation with exact subject references, evaluation-owned claims and identity-lifetime subject-group binding retained. [Publication scope and historical-artifact boundary](types/memory/README.md); original review in [PR143](https://github.com/gastownhall/bdp/pull/143), with the [accepted-cut source receipt](../docs/design/memory-catalog-reduction-20261025.json). No adoption claim. | Historical schemas, literals and offline cases remain separately identified; **this publication supplies no runtime qualification**. | **Existing precursor:** [Preview 2 source](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/schema.go#L53) defines title/body Memory and [informational Links](https://github.com/donnabox/beads/blob/703bb13e91aa2cab2092443319139006d74242c8/internal/storage/graphstore/informational_types.go). Current product candidates and exact qualification remain in [Beads7656](https://github.com/gastownhall/beads/issues/7656); this historical source is not new runtime evidence. |
| [Conformance index](conformance.md) | Current draft's shared requirement/case index; applies by advertised profile. | **Read executable evidence exists.** Catalog entries for other profiles are not proof those profiles passed. See [evidence rules](../packages/conformance/matrices/README.md). | Not a separate product feature. Only the named targets, builds, cases and qualifications in a recorded run are covered. |

The endpoint pin-only UpdateLink amendment has schema/SDK carrier checks, not
reference-runtime mutation/Event qualification. Its current implementation
boundaries, including the reference evaluator's explicit refusal and Beads'
owned-source deferral, are recorded in the
[review packet](../docs/design/endpoint-pin-repin-20261020.md).

**Not qualified / not established** means sufficient evidence is absent here; it
does not assert that every underlying feature is missing. In this inventory,
**NYI** is reserved for a specifically identified unimplemented feature. Update a
status when there is evidence, citing the implementation revision and its validation limits;
do not promote a row because a date passed, a PR exists or a schema check passed.

[STATUS.md](../STATUS.md) owns the detailed evidence summary and coverage counts.
The Read cohort includes packaged observations and **in-process self-certified
cases**; the latter do not establish black-box conformance of the packaged target.
Its observed source is `e5f7d0c43c151426350ceededdc77fe7e372db9b`; the editorial
split did not rerun or relabel that cohort. See the
[sealed report](../docs/design/evidence/read-cohort/read-v1.json) and
[pinned bd baseline](../docs/design/evidence/bd-baseline/README.md). That baseline's
binary identity check is a separate local check, not a CI certification of every
`bd` installation.

## Branch and authority boundary

This section records project process, not protocol requirements;
[BDP #59](https://github.com/gastownhall/bdp/issues/59) owns the current policy.

Further specification merges to `main` are on hold. Trish and Melinda integrate
design work into `codex/trish-spec-integration`; Memory PR143 targets that branch.
Vickie continues against her existing branch/specification without a rebase or a
merge of our new designs. Her completed work and this design branch will be
reconciled explicitly before the hold ends. This supersedes the earlier landing
note in [Types §8](profiles/types/types.md#8-readiness-and-landing) that suggests
starting new design work from main. The hold is a coordination agreement, not
an installed GitHub branch-protection rule.

## Files and supporting artifacts

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
