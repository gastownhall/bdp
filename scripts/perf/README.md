# Reference performance observations

This runner measures the actual built Core + ordinary Write reference through
loopback HTTP, using canonical target/Host routing and explicit credentials.
It exercises sequential Bead and Link creation, guarded updates, point reads,
complete native collection pagination, graceful close/reopen, and byte-exact
original-key replay after independent updates. Functional or cleanup failures
exit nonzero. These are reference observations, separate from provider
conformance, artifact consistency and reliability campaigns. Ordinary CI runs
the committed functional/lifecycle controls after build, with no performance
thresholds; the weekly/manual workflow retains the raw measurement series.

Use Node 24.22.1 and pnpm 11.20.0 from the repository pins:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec node scripts/perf/reference-trends.mjs --output /tmp/reference-small.json
pnpm exec node scripts/perf/reference-trends.mjs --scale medium --output /tmp/reference-medium.json
```

The bounded default `small` creates 20 Beads and 19 Links; `medium` creates 100
Beads and 99 Links. Page sizes are 7 and 17 respectively. Each repetition uses a fresh
owned local temporary store, one sequential pass and 128-byte property payloads.
The default is five repetitions; `--repetitions N` accepts 1 through 10. All
repetitions share one process, so JIT/module/cache state carries forward. No raw
series is excluded or aggregated. A single repetition at sub-millisecond scale
is especially sensitive to shared-runner noise and cannot establish a trend.
The whole invocation uses 5s HTTP timeouts and a 120s cooperative run deadline. SIGINT/SIGTERM abort HTTP
and trigger owned service/store cleanup. An external workflow timeout remains
the hard bound if synchronous storage work stops the event loop. No caller
store, Go tool, Beads executable, optional profile or private timing hook is used.

JSON records exact Git HEAD, porcelain dirty status, tracked diff digest,
untracked file digests, lock and reference-entry digests, toolchain version
provenance, host/image, workload, raw operation latencies, memory checkpoints and logical store file
bytes. `builtReferenceEntrySha256` covers only `dist/reference.js`, one entry
in its transitive runtime graph; it does not identify the complete measured
build. Build before every run: the runner cannot prove a preexisting build
corresponds to source. Git diff hashing uses raw Buffer bytes, bounded to 8MiB
per Git command with a 10s command timeout. Oversized/unavailable metadata fails
before a report is emitted; the 120s cooperative workload deadline starts only
after the source/toolchain preflight is complete. Keep reports
outside the worktree so reports do not become source inputs to later runs.
When invoking Node directly, `npm_execpath` may identify the pinned pnpm entry;
`pnpm exec` supplies its invoking version through `npm_config_user_agent`;
plain Node otherwise checks the `pnpm` executable on PATH. Other package
managers and non-pnpm entry basenames are refused. User-agent provenance is
environment metadata, not an independent identity proof of the parent process.
The JSON records which version source was used. Wrong pinned
versions fail before provisioning. A startup/argument/build error may precede
JSON creation; the workflow retains console output and fails either way.

Memory includes both driver and reference in one process. Store bytes are
logical file sizes, not allocated blocks or write amplification. Timing includes
HTTP/body decoding but excludes subsequent assertions. Cold first observations
are retained; there is no JIT/cache stabilization or disk-cache eviction claim.
Compare raw runs only with their host/toolchain/source/workload context. There
are no regression thresholds, performance SLA, fabricated baseline, or numeric
pass claims. The earlier local `historical-update-cost-experiment.json` receipt compared
format5/7 with 100/1000 versions and 1024-byte payloads; it informed keeping
reopen and closed-store observations explicit. Its timings are design inputs,
not a baseline or comparable measurements for this different public-HTTP
workload. See the [governing plan](../../docs/plans/bdp-stabilization.md).

The separate `Reference performance trends` workflow runs weekly on main and
manually, uploads JSON and console artifacts, and fails on workload/cleanup or
infrastructure errors. It pins ubuntu-24.04 and records runner image metadata;
both scales are attempted even when one fails, and any failure fails the job.
Trend-only means absence of numeric performance gates;
it does not permit ignoring functional failures. No ordinary CI budget cutover or numeric performance gate is selected.

Run the real-reference controls after build:

```sh
pnpm exec node --test scripts/perf/reference-trends.node-test.mjs
```

These current-lane controls verify both default series, raw repetition tags,
removed fresh stores, late SIGTERM at the ordinary closed-checkpoint diagnostic,
invalid scale/repetition bounds and package-manager provenance refusals. They
observe owned-store presence before the control removes its own fallback root.
The SIGSTOP/SIGTERM/SIGCONT boundary control is POSIX-only.

## pnpm entry provenance

The pinned [setup action's installer](https://github.com/pnpm/action-setup/blob/b906affcce14559ad1aafd4ab0e942779e9f58b1/src/install-pnpm/run.ts)
selects plain `pnpm@11.20.0` with `standalone:false`. That
[package's metadata](https://registry.npmjs.org/pnpm/11.20.0) declares
`bin/pnpm.mjs`; `bin/pnpm.cjs` is an older-Corepack compatibility shim. Both are
JavaScript entries executed by the pinned Node. This change does not qualify
the distinct `@pnpm/exe` native distribution.

RUN supplies `npm_execpath`; plain EXEC without an inherited entry supplies
only the pnpm user agent.
The runner resolves a supplied entry before validating its basename and executing
its version probe, and records `toolchain.pnpmEntrypoint` (null in metadata-only
EXEC). Other package managers and spoofed non-pnpm entry paths still refuse.
This is tool provenance, not a cryptographic package-identity attestation.

In RUN contexts the real-reference controls resolve the actual installed pnpm
package's declared bin, including when their parent used the `.cjs` shim. This
keeps the positive/lifecycle cases sensitive to the genuine `.mjs` installation
shape rather than a fake pnpm executable or a filename-only fixture. EXEC checks
exercise the distinct user-agent-only route. The full packed Node command still
requires its explicit package-manager packing context; plain EXEC alone does
not supply that context.
