# Shadow test routes

These routes are an additive PR1 experiment based on candidate `c1a89eb0c2fe207ee56d80345a863d2e184c1d1f`. They do not replace `pnpm test`, change CI gates or timeouts, retire tests, qualify an arbitrary provider, or establish the five-minute target/ten-minute maximum. Existing full CI remains broader and authoritative. No Go/Beads product pin or production admission/evidence rule changes here.

Use repository-pinned Node24.22.1 and pnpm11.20.0. Install workspace dependencies with `pnpm install --frozen-lockfile` before running routes. A new worktree needs package-local dependency links; linking only a different checkout's root node_modules is insufficient. These commands are implemented package scripts:

```sh
# No target/service execution: validate complete explicit file accounting and routing negatives.
pnpm test:routing:shadow

# Current reference/SDK/CLI boundary, including shared mechanics.
# The complete route includes the existing emitted CLI process test and therefore needs dist.
pnpm build
pnpm test:current:shadow

# A bounded exact-file subset needs only the selected tests' prerequisites.
pnpm test:current:shadow -- packages/protocol/src/historical-update-values.test.ts packages/client/src/historical-update.test.ts

# Artifact tests: existing Node generator/schema controls, routing controls, Python classifier tests.
pnpm test:artifacts:shadow

# Explicit historical/mixed-purpose route; may require built children and the existing pinned bd setup.
# This command preserves its tests' prerequisites and refusal behavior. It does not install tools.
pnpm test:legacy:shadow
```

`--` is an optional argument separator. Each following argument must name an exact file assigned to that route; arbitrary Vitest flags or out-of-route files are refused. With no file arguments, the runner executes every assigned source file using its recorded runner. Failures and interruption remain unsuccessful. No implicit empty selection passes. Artifact freshness remains checked separately by the existing `openapi:check`, `markdown:check`, schema-fragment and editorial checks; the new artifact test route alone does not replace those checks or the existing specification CI job. Packed smoke and readiness preflight likewise remain existing separate commands and gates.

## What the routes mean

| Category | Scope and limitations |
| --- | --- |
| 1. Artifact consistency | `artifact` entries use Node's test runner or Python, separately from Vitest. They check authored/generated carriers, routing or classification; passing does not establish server behavior. Existing literal artifact tests inside Vitest remain individually accounted for in the conservative route rather than silently relabeled as provider conformance. |
| 2. Arbitrary-provider conformance | No route or claim is introduced. A future thin provider fixture/lifecycle adapter and independently authored public-boundary cases still need implementation. The old cumulative conformance runner is not reinterpreted as a current Core/Write kit. |
| 3. Reference/current | Explicit canonical CLI units, retained-v01 store/contract tests, retained SDK/value tests and seven current reference HTTP files. The current reference uses its actual explicit configuration and code, but HTTP fixtures, all-access principals, source aliases and private setup make this reference evidence. Complete requirements coverage has not been established. |
| 3. Historical/mixed-purpose | `legacy` conservatively retains all other inventoried suites, including cumulative/private installed behavior, readiness/adapter tests, schema/harness suites and mixed-purpose files not yet promoted. This routing label does not mean every assertion is obsolete or exclusively historical. Promotion requires reviewing imports, obligations, execution conditions and oracles. |
| Shared mechanics | Entries explicitly marked `shared` execute in both current and legacy Vitest routes. This declared overlap is intentional; every file still has one manifest assignment. It is not independent implementation evidence. |

The two new Vitest configurations inherit the existing source aliases **and existing setupFiles unchanged** from `vitest.config.ts`. The ambient counted historical admission mock therefore remains present in shadow Vitest execution. This experiment neither removes it from pure/current tests nor makes it an unconditional production grant; leak controls and unmocked installed-admission witnesses stay in the original full route. Isolating that setup requires a later dependency/obligation review. Running a shadow route cannot confer a public startup/cohort qualification.

## Complete file accounting and fail-closed changes

`scripts/test-routing-manifest.json` records one explicit lane, runner and classification reason per inventoried file. `scripts/test-routing.mjs` compares it against Git's tracked and nonignored new files. Test suffixes include `.test.*` and `.node-test.*` JavaScript/TypeScript forms; the existing Python editorial-classifier test is explicitly included. A new unassigned test, stale entry, duplicate assignment, invalid lane/runner or empty executable lane refuses route selection. The checker prints source-file totals from the actual manifest; these are not hardcoded case counts or coverage claims.

The current and legacy configurations use exact manifest paths, not a broad exclusion or naming fallback that silently sends new tests to a cheaper route. New files must be deliberately classified. The routing guard is invoked by these shadow commands, not newly added to CI; until cutover, unchanged full CI still discovers the broader existing Vitest patterns and runs its other explicit checks. The evidence-generation script/configuration is separate and unchanged; it is not an ordinary test-source suffix and is not launched by these routes. Shell example syntax and standalone editorial/generator commands also remain existing separate specification checks.

To update the manifest, review the new file's actual boundary and prerequisites, add its exact path/runner/lane/reason, and run routing checks plus an appropriately bounded affected route. Do not declare a suite current merely because it avoids the old bd binary. Keep historical source pins and evidence scope intact. Do not modify a Beads consumer pin, launch a product campaign, suppress `BDP_REQUIRE_BD_MATRIX`, or bypass startup/cohort admission to make a route pass.

## Exit facts still needed

Before CI cutover: map required current obligations to cases, review shared/import closures and mixed-purpose classifications, compare old full versus proposed route coverage, separate packed current/legacy observations without losing exports/installation/real process assertions, retain genuine crash and cleanup tests, and measure complete required-check makespan including cold tool setup. Relevant extended checks still block affected changes and full extended/legacy checks also run nightly and before releases after that policy is implemented. This PR does not implement scheduling, observation reuse, cached CI results, performance gates or historical retirement.
