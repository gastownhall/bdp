# Reference performance observations

This runner measures the actual built Core + ordinary Write reference through
loopback HTTP, using canonical target/Host routing and explicit credentials.
It exercises sequential Bead and Link creation, guarded updates, point reads,
complete native collection pagination, graceful close/reopen, and byte-exact
original-key replay after independent updates. Functional or cleanup failures
exit nonzero. These are reference observations, separate from provider
conformance, artifact consistency, reliability campaigns and ordinary CI.

Use Node 24.22.1 and pnpm 11.20.0 from the repository pins:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec node scripts/perf/reference-trends.mjs --output /tmp/reference-small.json
pnpm exec node scripts/perf/reference-trends.mjs --scale medium --output /tmp/reference-medium.json
```

The bounded default `small` creates 20 Beads and 19 Links; `medium` creates 100
Beads and 99 Links. Page sizes are 7 and 17 respectively. Each run uses a fresh
owned local temporary store, one sequential pass, 128-byte property payloads,
5s HTTP timeouts and a 120s cooperative run deadline. SIGINT/SIGTERM abort HTTP
and trigger owned service/store cleanup. An external workflow timeout remains
the hard bound if synchronous storage work stops the event loop. No caller
store, Go tool, Beads executable, optional profile or private timing hook is used.

JSON records exact Git HEAD, porcelain dirty status, tracked diff digest,
untracked file digests, lock/build digests, actual toolchain versions, host,
workload, raw operation latencies, memory checkpoints and logical store file
bytes. Build before every run: the emitted reference digest is recorded, but the
runner cannot prove a preexisting build corresponds to source. Keep reports
outside the worktree so reports do not become source inputs to later runs.
When invoking Node directly, `npm_execpath` may identify the pinned pnpm entry;
`pnpm exec` supplies its invoking version through `npm_config_user_agent`;
plain Node otherwise checks the `pnpm` executable on PATH. The JSON records
which version source was used. Wrong pinned
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
infrastructure errors. Trend-only means absence of numeric performance gates;
it does not permit ignoring functional failures. Ordinary CI is unchanged.
