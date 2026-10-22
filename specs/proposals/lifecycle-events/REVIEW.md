# Per-draft review and check status

October 17, 2026. WIP/draft publication only; owner decisions and main landing held.
All three independent sibling drafts start at PR159
`d7197e97a29bff8f075028419afad05388e2e655`.

## Council scope and this draft's findings

One native Codex + actual Claude council reviewed the THREE-DRAFT SET, not four
repairs in every draft. Gemini was excluded. Original reviewed heads were
batch959c34a, lifecycle6bdc621 and interchange8447dd2. Findings below are scoped
to this draft. The [joint review record](https://github.com/gastownhall/bdp/pull/165)
is retained as `docs/design/iris-joint-council-review-20261017.md` in PR165.

Native finding relevant here: fixture counts and negative controls now catch annotation inconsistencies; this does not model operation causality. No remaining native draft blocker before the subsequent Claude corrections.

Claude H1: per-draft council claims corrected. H3: claims narrowed to shape/annotation consistency; ownership/rollback/no-op/two-source self-Link behavior explicitly unexercised. H4/M8: forbidden cross-transition fixture fields, empty revisions and missing Link-create context now refuse. Import postimage policy remains deliberately OPEN (the update-delta rule does not decide it). M7: proposed one-fact self-Link behavior explicitly replaces old two-incidence-fact behavior; role encoding held. M9/L4/L5: dataset layout, review links and index-conflict disposition fixed.

Initial actual Claude review completed with one publication blocker (H1) and
additional pre-freeze gaps. Focused native and actual Claude repair reviews now
report no remaining draft-publication blocker. This is a draft-publication
disposition, not format-freeze approval, contract adoption or runtime qualification.
Held discovery/wire/import/provenance/authority/limits decisions remain open.

## Artifact checks and limits

Current checks: 29 fixture shape/count-consistency scenarios; new JSON checked with repository Biome2.5.7;
local links, preserved Memory row, unchanged current/distribution schema bytes
and diff whitespace. Source checks are rerun and recorded at each final published
head. Python3.14.5, jsonschema4.26.0, referencing0.37.0. Transfer numeric checks use
Node's specified ECMAScript numeric conversion, not a Python formatting substitute.
No engine/build/installed workflow/History server/runtime or independent interop
qualification is claimed. Full workspace CI/build/typecheck/smoke/evidence suites
were not run for these proposal-only additions. Host Node26.0.0/pnpm11.25.0 differ
from CI pins24.16.0/11.20.0; Biome is exactly2.5.7.

Published staged PRs currently have no hosted checks. The workflow selects PRs to
main and pushes to main or `codex/vickie-*`, excluding our current target/branches.
Focused artifact checks are not equivalent to all CI at adoption/landing.

Independent sibling index edits can textually conflict during ordinary merges.
Resolve deliberately, retaining current rows (especially Melinda's Memory status),
then order new rows batch subsets, lifecycle Events, interchange before Memory.
Append each distinct STATUS section once; do not overwrite another owner row.
