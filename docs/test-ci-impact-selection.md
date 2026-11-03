# Shadow CI impact selection

`scripts/ci-impact-selection.mjs` emits a deterministic review input for the
[testing policy](plans/bdp-stabilization.md#testing-and-cost-discipline). It does
not execute suites, change workflows or commands, remove tests, qualify coverage,
measure the CI budget, or reuse a prior result. Existing full CI remains
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
Known documentation Markdown still retains the full baseline. Specification
Markdown is deliberately broad because it can contain embedded schema/operation
contracts. Non-Markdown files under docs are not assumed to be harmless prose.

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
A missing, stale or unassigned test fails before selection. Changed records are
Git NUL-delimited name/status entries; both old and new rename/copy paths are
preserved. Main and manual invocations select broader coverage, even with no diff.
An empty explicit pull-request comparison still selects every baseline family;
missing comparison input is not treated as a trustworthy empty PR diff.

Root must add this exact new row to `scripts/test-routing-manifest.json` when
integrating the new test file (this branch deliberately leaves that existing
manifest untouched):

```json
{
  "path": "scripts/ci-impact-selection.node-test.mjs",
  "runner": "node",
  "lane": "artifact",
  "reason": "Shadow impact selector and metadata controls; no target execution or semantic-closure claim."
}
```

Until that row is integrated, a real CLI invocation correctly fails its inventory
check. The direct controls exercise the exact proposed row as a test-only input;
there is no production manifest override or permissive fallback.

After inventory integration, use repository-pinned Node 24.22.1:

```sh
node scripts/ci-impact-selection.mjs --event pull-request --base BASE_SHA --head HEAD_SHA
node scripts/ci-impact-selection.mjs --event main --base BASE_SHA --head HEAD_SHA
node scripts/ci-impact-selection.mjs --event manual
node --test scripts/ci-impact-selection.node-test.mjs
```

Refs resolve to exact commits before the Git comparison. Output includes the
selector source commit, resolved base/head, actual/expected Node and declared
package manager, selector/manifest/lock/package hashes and a path-name inventory
hash. Working-tree dirtiness is explicit. The path inventory hash covers names,
not content. Toolchain metadata does not prove the invoked package-manager binary
or runner environment. These inputs are intentionally incomplete: they are **not
a verified reusable result**, cache key contract or conformance receipt. Future
reuse needs identical relevant suite/dependency/toolchain/artifact inputs,
including commit-dependent outputs, actual merge composition and a short actual
main installation/executable check. Unknown or changed inputs require rerunning.
No consumer contract pin or historical source-bound receipt is rewritten.
