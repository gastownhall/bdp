# Full regression parallel CI trial

This temporary workflow measures the full regression workload in parallel. The
existing `.github/workflows/ci.yml` remains unchanged and authoritative. No suite,
assertion, provider obligation, evidence gate or existing job is retired. There is
no impact-based selection, successful-result reuse, new evidence claim or CI
cutover. Every trial job has a 20-minute limit while measurement is pending.

The candidate starts from the packed-smoke candidate `aac663de` (including the
PR345 verifier reuse and PR349 smoke stack) and ordinarily merges main
`58e7b55e`, including the landed Type descriptor work. These ancestors are not
new changes authored by this trial. The trial's own files are the partition
runner, its Node controls, this document, its temporary workflow and one artifact
accounting row.

## Full-config partitions

Each regression job installs pinned Node 24.22.1 and pnpm 11.20.0, performs a frozen
install and builds its own checkout. They do not share installations, builds,
reports or test results. pnpm and Go action caches are not enabled for this cold
trial. Registry/network and hosted-image caches are outside this experiment's
control; record that limit with actual hosted timings.

| Job/group | Files selected |
| --- | --- |
| `read-update-matrix` | `apps/bdptest/src/read-update-matrix.test.ts` |
| `transactional-matrix` | `apps/bdptest/src/transactional-matrix.test.ts` |
| `realbd` | `apps/bdpbd/src/read-matrix.test.ts` |
| `other` | Every other Vitest file, including all historical, shared and current files |

The runner first validates complete routing-manifest accounting, then compares
its Vitest entries to `vitest list --config vitest.config.ts --filesOnly --json`.
The union of the four groups must equal that actual full-config inventory exactly
once. Missing, duplicate, stale and new unassigned files refuse execution. A new
explicitly accounted ordinary file enters `other`; removing a dedicated file
requires an explicit trial update.

Execution uses the unchanged full `vitest.config.ts`, its existing aliases and
`read-conformance-mock.ts` setup, default isolation/concurrency and unchanged test
and hook timeouts. There is no test-name filter or current-only setup. File
arguments are filters in Vitest, so after a successful process the runner compares
the actual JSON `testResults` file names to the entire requested group. Missing,
duplicate, overmatched, escaped or failed files refuse success. Existing pending
cases are reported, not removed or newly skipped. The old full CI still runs.

The real-bd job alone installs Go 1.26.10 and `libicu-dev`, builds the existing
`github.com/steveyegge/beads/cmd/bd@v1.0.5` fixture binary and performs both existing
text and exact JSON build-identity checks. Its matrix environment requires the
real test (`BDP_REQUIRE_BD_MATRIX=1`) and names the absolute binary. No other
trial job installs Go or executes that matrix. This is the existing repository
fixture obligation, not a Beads product campaign or consumer-pin change.

## Authoritative-command crosswalk

| Existing CI command/check | Trial destination |
| --- | --- |
| Node/pnpm version checks, frozen install | Baseline and every regression job |
| Full `pnpm test` | Exact union of four regression jobs, same full Vitest config |
| Go setup, ICU install, pinned bd source install and both identity checks | `realbd` job only |
| `pnpm format:check`, `pnpm lint`, `pnpm check:boundaries` | Baseline |
| `pnpm openapi:check`, `pnpm test:openapi`, `pnpm markdown:check`, `pnpm test:markdown` | Baseline |
| Specification/editorial Python controls, shell syntax, fragment distribution and canonical-document checks | Baseline, plus unchanged authoritative specification job |
| `pnpm test:routing:shadow` | Baseline; adds only the new pure control's artifact row |
| `pnpm typecheck`, `pnpm build` | Baseline; build also repeated in each regression job |
| `pnpm test:cli:built`, `pnpm e2e:ready:preflight`, old full `pnpm smoke` | Baseline |
| `pnpm evidence:verify` with only exit 2 admitted as absent evidence | Baseline, unchanged gate policy and full checkout history |
| Complete-change editorial classification and authoritative aggregate verify | Existing authoritative CI; trial always runs full groups when activated |

Additional baseline work runs `pnpm smoke:current`, every current Node control
through the existing built Node entry with additional file arguments (including
the repeated emitted CLI entry), the new
pure partition controls and actual full-config inventory check. No command uses
a previously successful job as a substitute. Trial matrix jobs use fail-fast
false, so one failing group does not cancel observation of the others. Individual
job results remain required to evaluate this experiment; an artifact upload is
not a passing result.

## Activation and measurement boundary

Only PRs targeting main or pushes to main that change the trial workflow,
partition runner or its control file activate the temporary workflow. An explicit
manual dispatch is also available. Documentation/accounting-only changes do not
start another automatic campaign. The existing CI activation is unchanged.

Each actual job must complete successfully. Inspect Actions job/step durations
for frozen install, build, real-bd setup, full Vitest and baseline smoke/control
cost. Per-file Vitest JSON reports are retained as diagnostic artifacts even on
failure when available; stale report files are removed before execution. File
counts are execution accounting, not a complete semantic-obligation census or
reusable provenance attestation. No cold hosted time has yet been measured by
this local candidate, and local checks do not establish the ten-minute goal.

Promotion is a later reviewed change, only after the actual cold trial proves
all job durations within ten minutes and the command/coverage mapping remains
intact. It may move these exact job fragments into authoritative CI and remove
the temporary workflow. This candidate performs neither action. If the `other`
group or baseline still dominates, measure it and propose a bounded split; do not
shorten timeouts, suppress failures, weaken assertions or silently retire suites.

## Focused local checks

```sh
node --test scripts/ci-regression-groups.node-test.mjs
node scripts/ci-regression-groups.mjs --check
pnpm test:routing:shadow
pnpm typecheck
pnpm build
```

A group run is `node scripts/ci-regression-groups.mjs --run GROUP`. The real-bd
variant additionally requires the explicit required-matrix environment and the
verified pinned executable; local trial qualification does not require running
that expensive external fixture. Pure controls independently exercise partition
loss/duplicates/new-file admission and observed-file omissions/overmatches/failures.
