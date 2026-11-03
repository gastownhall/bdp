# Shadow CI impact selection

`scripts/ci-impact-selection.mjs` emits a deterministic review input for the
[testing policy](plans/bdp-stabilization.md#testing-and-cost-discipline). It does
not execute selected target suites, change their required gates, remove tests,
qualify coverage, measure the CI budget, or reuse a prior result. Existing full CI remains
required and authoritative. This foundation is based on PR345 source
`63f746e8980e06256dcc5119673f2b0f7972bf89`, including its explicit routing manifest.

Every valid selection retains **artifact, current and packed** baseline families.
Explicit owner paths add storage, transport or lifecycle extended families;
registered test changes add test-framework coverage. Legacy tests also select
historical-full; shared test changes select every extended family. Protocol,
schema/specification, fixture, configuration and tooling inputs select broader
coverage. Unclassified paths, paths absent from the supplied source inventory,
renames/copies, deletions, type changes and unmerged/unknown-to-Git statuses select all
extended families. Malformed input refuses to produce a successful selection.
All `docs/` paths select broader coverage, including historical shims and design
text consumed by legacy tests. This does not make `docs/specs/bdp.md` current
normative authority. Only the explicit known root documents (`README.md`,
`STATUS.md`, `CONTEXT.md`) retain baseline-only selection. Top-level `specs/`
remains broad. These conservative prefixes do not discover actual imports.

These are conservative explicit path rules, **not a filename-derived semantic or
transitive import closure**. The owner-path lists are deliberately small; unknown
runtime modules fall back to broader checks. A selection's family names are not
yet qualified command bindings or a complete requirement-to-case map. Before CI
cutover, review actual source/import/obligation closure and old-to-new coverage,
qualify current/legacy packed observations and measure cold runner makespan,
including dependency/tool setup. Do not shorten today's full CI timeout or gates.
Full historical/extended coverage must run nightly and before releases when that
scheduling is qualified; this patch implements no scheduler or workflow cutover.

## Inputs and fail-closed integration

The selector validates the existing routing manifest against the complete
tracked/nonignored source-name inventory using the same test-suffix inference.
A missing, stale or unassigned test fails before selection. Every explicit owner
path must also exist in the supplied inventory; real batch owners include
`batch-contract.ts`, `batch-evaluate.ts` and `batch-recovery.ts`. Changed records are
Git NUL-delimited name/status entries; both old and new rename/copy paths are
preserved. Main and manual invocations select broader coverage, even with no diff.
An empty explicit pull-request comparison still selects every baseline family;
missing comparison input is not treated as a trustworthy empty PR diff.

The routing manifest includes the selector's exact artifact Node control file,
`scripts/ci-impact-selection.node-test.mjs`. The controls assert its exact
presence against the real manifest and verify fail-closed behavior when it is
absent; neither control repairs the row. The ordinary routing check also enforces
complete accounting. There is no production manifest override or permissive
fallback. Specification CI runs the selector's own Node controls beside that
cheap routing check; it does not execute selected target suites.

Use repository-pinned Node 24.22.1:

```sh
node scripts/ci-impact-selection.mjs --event pull-request --base BASE_SHA --head HEAD_SHA
node scripts/ci-impact-selection.mjs --event main --base BASE_SHA --head HEAD_SHA
node scripts/ci-impact-selection.mjs --event manual
node --test scripts/ci-impact-selection.node-test.mjs
```

Refs resolve to exact commits before the Git comparison. Pull-request comparison
uses the merge base of target base/head through head, excluding target-only
changes; main/manual explicit comparisons retain the supplied base-to-head range.
Output records the explicit event, selector source commit, resolved target base
(`base` and `targetBase`), comparison `mergeBase` (null outside PR mode), head,
actual/expected Node and declared package manager, selector/manifest/lock/package hashes and a path-name inventory
hash. Digest bytes and inventory paths are validated. Working-tree dirtiness is
explicit and uses NUL-delimited Git porcelain records. The path inventory hash
covers names, not content. Toolchain metadata does not prove the invoked package-manager binary
or runner environment. These inputs are intentionally incomplete: they are **not
a verified reusable result**, cache key contract or conformance receipt. Future
reuse needs identical relevant suite/dependency/toolchain/artifact inputs,
including commit-dependent outputs, actual merge composition and a short actual
main installation/executable check. Unknown or changed inputs require rerunning.
No consumer contract pin or historical source-bound receipt is rewritten.
