# Required full regression CI in parallel

This candidate promotes the measured full-regression partition into the existing
`.github/workflows/ci.yml` and removes `ci-parallel-trial.yml`. It retains the
complete-change classifier, specification gates and aggregate `verify` job.
No suite, assertion, provider obligation, real-bd fixture or evidence gate is
retired. There is no impact-based selection, successful-result reuse or adoption
of the shadow current/legacy Vitest routes.

## Receiving evidence and timing limits

The [successful full trial 41573748099](https://github.com/gastownhall/bdp/actions/runs/41573748099)
ran source `1fb94710` with 236 disjoint full-config Vitest files, 10415 passing
cases and 1 existing pending case. Baseline and all four regression jobs passed.
The observed interval from earliest job start through last completion, including
cold setup, was 415 seconds; the initial queue was 3 seconds separately. The
five trial jobs totaled 1331 seconds (22 minutes 11 seconds) of runner job time.
Wall time and aggregate job time measure different costs; no aggregate compute
saving is guaranteed. This is one actual hosted observation, not a guarantee
for future runs. The five-minute
target remains unmet. Each required job now has a ten-minute maximum; timeouts
remain failures and are not permission to shorten test or hook budgets.

The tested source included main `3cf7f9f4`: the fast-uri 3.1.9 dependency/security
transition and atomic crash witnesses. Earlier stack ancestors include the
packed-smoke work and PR345 verifier observation reuse. This promotion changes
workflow placement and controls, preserving those tested partition/job fragments.
It is a local promotion candidate until reviewed and published; the new workflow
wiring itself has not yet run on a hosted runner.

## Full-config partitions

Each implementation/regression job installs pinned Node 24.22.1 and pnpm 11.20.0,
performs a frozen install and builds its own checkout. Jobs share no installations,
builds, reports or test results. pnpm and Go action caches are not enabled in
these measured fragments. Registry/network and hosted-image caches are outside
this experiment's control; retain that limit with actual hosted timings.

| Job/group | Files selected |
| --- | --- |
| `read-update-matrix` | `apps/bdptest/src/read-update-matrix.test.ts` |
| `transactional-matrix` | `apps/bdptest/src/transactional-matrix.test.ts` |
| `transactional-set-receipts` | `apps/bdptest/src/transactional-set-receipts.test.ts` |
| `realbd` | `apps/bdpbd/src/read-matrix.test.ts` |
| `other` | Every other Vitest file, including all historical, shared and current files |

The runner validates complete routing-manifest accounting and compares its
Vitest entries to actual `vitest list --config vitest.config.ts --filesOnly
--json` discovery. The five groups must equal that inventory exactly once.
Missing, duplicate, stale and new unassigned files refuse execution. A newly
accounted ordinary file enters `other`; removing a dedicated heavyweight file
requires an explicit partition change.

Execution uses the unchanged full `vitest.config.ts`, aliases,
`read-conformance-mock.ts` setup, isolation/concurrency and test/hook timeouts.
There is no test-name filter or current-only setup. After each successful process,
actual JSON `testResults` file names must equal the entire requested group.
Missing, duplicated, overmatched, escaped or failed files refuse success.
Each requested file and its group must contain at least one actually passing
assertion; an all-pending file is refused even when Vitest labels it passed.
Individual pending cases are still reported rather than pinned by count. This
file-execution guard does not prove a complete semantic-obligation census or
detect every newly skipped individual case.

Only `realbd` installs Go 1.26.10 and `libicu-dev`, builds the existing
`github.com/steveyegge/beads/cmd/bd@v1.0.5` fixture binary, and performs both
original text and exact JSON identity checks. It requires the real matrix with
`BDP_REQUIRE_BD_MATRIX=1` and its explicit absolute binary. Other groups do not
install Go or select that file. This preserves a repository fixture obligation;
it does not authorize a Beads product campaign or change a consumer pin.

## Required-command crosswalk

| Previous serial CI command/check | Required destination |
| --- | --- |
| Node/pnpm version checks, frozen install | Implementation baseline and every regression job |
| Full `pnpm test` | Exact union of five regression jobs, same full Vitest config |
| Go setup, ICU, pinned bd source install and both identity checks | `realbd` only |
| `pnpm format:check`, `pnpm lint`, `pnpm check:boundaries` | Implementation baseline |
| OpenAPI and Markdown generation/parity/test commands | Implementation baseline and preserved specification job |
| Editorial Python controls, shell syntax, fragment distribution and canonical-document checks | Implementation baseline and preserved specification job |
| `pnpm test:routing:shadow` | Implementation baseline and specification; accounting remains shadow-only |
| `pnpm typecheck`, `pnpm build` | Implementation baseline; build also repeated per regression job |
| `pnpm test:cli:built`, `pnpm e2e:ready:preflight`, original full `pnpm smoke` | Implementation baseline |
| `pnpm evidence:verify`, accepting only exit 2 as absent evidence | Implementation baseline; unchanged gate policy and full checkout history |
| Complete-change classification | Preserved `changes` job |
| Aggregate success/failure decision | Preserved `verify` job, now also requiring the regression matrix |

The baseline additionally retains the tested `pnpm smoke:current`, pure
partition controls and actual full-config inventory check. Every Node/current
manifest entry executes through the existing built Node command with explicit
additional files; the repeated emitted CLI invocation is retained from the
successful trial. Its control fails if a new Node/current entry is missing.
The provider-kit Node control is included after the ordinary merge of main
`b9eaf3d8`. Reviewed selector `efa45aa0` and perf `ca12a784` are also ordinarily
merged. The selector's own controls remain in specification CI; perf's own
controls run immediately after baseline build, and its actual Node entry is
also in the complete current-Node command. No selector dispatch or result reuse
is adopted. These added controls were not part of the frozen trial timing; the
combined subject requires fresh normal hosted receiving before publication.

## Activation and fail-closed aggregation

The original pull-request/push branch activation remains unchanged. There is no
path filter or temporary manual-only workflow. Both the implementation baseline
and regression matrix depend on `changes` and run whenever its editorial output
is not exactly `true`. Matrix fail-fast is false so one failure does not cancel
the other groups' observations. Available JSON reports are uploaded on failure;
an uploaded artifact is not a passing result.

`verify` runs with `always()` and depends on `changes`, `specification`,
`implementation` and `regression`. It requires the classifier and specification
to succeed. Only an exact editorial classification permits both implementation
and regression to be skipped. Every other change requires both results to be
success, including all five matrix jobs. Failure, cancellation, unexpected skip
or missing results fail verification. Pure controls execute this actual shell
aggregation with positive cases and every invalid individual result.

## Focused local validation

```sh
node --test scripts/ci-regression-groups.node-test.mjs
node scripts/ci-regression-groups.mjs --check
pnpm test:routing:shadow
pnpm exec biome lint scripts/ci-regression-groups.mjs scripts/ci-regression-groups.node-test.mjs
pnpm exec biome format scripts/ci-regression-groups.mjs scripts/ci-regression-groups.node-test.mjs
```

The ten pure controls and an actual two-file Vitest JSON control check partition completeness, observed-file accounting,
old command coverage, complete Node/current execution and required-job
aggregation. Ruby/Psych syntax parsing checks the workflow locally. Local
promotion validation does not rerun the expensive full Go campaign or establish
new hosted timing. The successful frozen trial remains the execution evidence;
normal reviewed receiving and hosted CI must qualify the promoted wiring.

## Transactional critical-path split

Incoming run 41576615416 canceled the transactional job at its ten-minute job
limit; it did not report a failing test assertion. The runtime source and full
Vitest configuration were unchanged from the successful trial. To reduce that
critical path without reducing coverage, the original 68 cases are physically
partitioned into 40 retained matrix cases and 28 set/receipt cases. Their private
observation helper is shared as source; it retains the original fresh-directory,
installed-child, principal and cleanup behavior. The complete same-run verifier
`describe` and its `beforeAll` remain together in the new file. Vitest's existing
per-file isolation remains unchanged.

A one-time normalized AST statement-multiset comparison preserved in the
receiving receipt binds all 111 original non-import
statements at source `49dafb14865c6a596f692cdfd3205369a55596b4`, including
callbacks, tables, fixtures, hooks and timeouts. The pre/post full-config collected
68 names also match the frozen actual trial report. This is a physical move, not
new result reuse or removal of genuine execution. New collection contains 237
Vitest files; the manifest gains one legacy row and preserves all prior rows.

The frozen report's summed case durations split as 195586 ms for the moved
28 and 195063 ms for the retained 40. Those are historical case durations, not
new hosted job timings; setup, duplicated per-file module loading and the
`beforeAll` still cost work. Five regression jobs need a fresh hosted cold run
before any timing claim. Total compute may increase even if wall time improves.

The focused local receiving run executed both files together with the unchanged
full config: 68 passed, zero failed/pending, and the exact original expanded-name
multiset matched the frozen report (40 retained, 28 moved). Local duration was
117.79 seconds; file durations were approximately105 and112seconds. This is a
local observation with an already built checkout, not cold hosted CI evidence.
The11 partition controls,8 routing controls, build and typecheck also passed.
