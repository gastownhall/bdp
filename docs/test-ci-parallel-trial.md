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
| `realbd` | `apps/bdpbd/src/read-matrix.test.ts` |
| `other` | Every other Vitest file, including all historical, shared and current files |

The runner validates complete routing-manifest accounting and compares its
Vitest entries to actual `vitest list --config vitest.config.ts --filesOnly
--json` discovery. The four groups must equal that inventory exactly once.
Missing, duplicate, stale and new unassigned files refuse execution. A newly
accounted ordinary file enters `other`; removing a dedicated heavyweight file
requires an explicit partition change.

Execution uses the unchanged full `vitest.config.ts`, aliases,
`read-conformance-mock.ts` setup, isolation/concurrency and test/hook timeouts.
There is no test-name filter or current-only setup. After each successful process,
actual JSON `testResults` file names must equal the entire requested group.
Missing, duplicated, overmatched, escaped or failed files refuse success.
Existing pending cases are reported rather than removed or newly skipped.

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
| Full `pnpm test` | Exact union of four regression jobs, same full Vitest config |
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
`b9eaf3d8`; that added control was not part of the frozen trial timing. Perf
controls must be added by actual path when their source is integrated; do not
import nonexistent files. Preserve the selector/perf workflows' own CI control
steps when those changes land, without dispatching the selector. Rerun the
complete Node/current inventory control before promotion is published.

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
success, including all four matrix jobs. Failure, cancellation, unexpected skip
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

The ten pure controls check partition completeness, observed-file accounting,
old command coverage, complete Node/current execution and required-job
aggregation. Ruby/Psych syntax parsing checks the workflow locally. Local
promotion validation does not rerun the expensive full Go campaign or establish
new hosted timing. The successful frozen trial remains the execution evidence;
normal reviewed receiving and hosted CI must qualify the promoted wiring.
