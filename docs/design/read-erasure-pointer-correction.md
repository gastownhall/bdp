# Read erasure-pointer correction

Prepared 2026-09-08 on main baseline `0b7d86e7cfec47f88cd1ec22314a73f39763bcf8`.
This is a bounded implementation correction, pending council review and
integration. It grants no new profile capability or conformance claim.

[Reads after deletion](../specs/bdp.md#reads-after-deletion) already prohibits
condition-specific pointers on `resource-erased`. The inherited `readProblem`
schema rejects `archivedAt` but previously admitted `pointer` through its open
RFC 9457 extension surface. The existing `read.disclosure.gone` executable
request likewise checked only `archivedAt` under an assertion named `no-pointer`.

Both schema mirrors now reject a present `pointer` specifically when the code
is `resource-erased`, regardless of its value. Ordinary extensions such as
`traceId` remain valid and preserved by the parser. This is a known-member
guard, not a general classifier for arbitrary extension semantics. Problem
codes, statuses, retry mappings and all 26 definition names are unchanged.
No Read+Update or Transactional envelope is edited on this baseline.

The existing manifest request now checks `/pointer` under `no-pointer` and
retains the `/archivedAt` prohibition as `no-archived-at`. No catalog scenario
is added; all 40 scenario IDs remain. A runner regression consumes those actual
shipped assertions and injects pointer-bearing response bodies independently
of the schema/parser, including a null pointer. Separate parser/schema cases
reject string, object and null pointers while accepting a harmless extension.

## Validation and evidence boundary

Node 24.16.0 / pnpm 11.20.0; dependencies installed offline from the frozen
lockfile. The regressions first reproduced four failures against the old
schema/manifest. After correction:

- Focused parser/schema/runner/manifest checks: **189 passed**.
- Full suite: **1,270 passed across 44 files, no skips**, including the isolated
  public `bdpbd` matrix with `/opt/homebrew/bin/bd` verified as 1.0.5, Homebrew
  build, schema version 1.
- Typecheck, lint, format, dependency boundaries, build, packaged E2E preflight
  (7 tests), offline installed-package smoke and diff whitespace checks passed.
- `evidence:verify` failed with exit 1 because its manifest input is uncommitted.
  This was the observed dirty-input refusal, not a passed or bypassed evidence gate.
- After committing implementation `208d2ed`, the current base-main verifier
  passed its historical cohort: 74 target-row instances, run head `0a928bac`,
  evidence commit `4795f8e`. This does not establish fresh observations for the
  changed schema/manifest. The planned successor requirement remains.
- Independent native review of the full seven-file correction found zero
  Critical, High, Medium or Low issues. This is not full council clearance.

The schema and manifest bytes/digests change. `readProblem` is among the sealed
Read definitions, so the planned projection gate also requires a changed
projection binding; the unchanged definition-name list does not avoid resealing.
After integration with the approved Read prerequisites, commit the actual run
inputs and obtain the planned genuine successor two-target Read cohort, with
fresh observations, its prescribed evidence ancestry and independent final
review before any new grant or merge. Historical artifact bytes and capability
constants are untouched. These local checks do not rehash or reseal old results.

Full preparation logs are in `/tmp/janet-resume/read-erasure-pointer-*.log`.
