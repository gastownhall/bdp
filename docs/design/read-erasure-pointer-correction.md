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
schema/manifest in a filtered run: four failed, two passed, and 152 unrelated
tests filtered/skipped. After correction:

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

The base-main verifier checks the earlier run-head-to-evidence-commit window;
it does not compare the recorded manifest/schema bindings with all current input
bytes. Its historical pass therefore remains distinct from current conformance.
The schema and manifest bytes/digests change. `readProblem` is among the sealed
Read definitions, so the planned projection gate also requires a changed
projection binding; the unchanged definition-name list does not avoid resealing.
After integration with the approved Read prerequisites, commit the actual run
inputs and obtain the planned genuine successor two-target Read cohort, with
fresh observations, its prescribed evidence ancestry and independent final
review before any new grant or merge. Historical artifact bytes and capability
constants are untouched. These local checks do not rehash or reseal old results.

## Coverage and successor integration

The existing `bdptest` fixture constructs an erased Problem without either
location member. An applicable packaged run can observe that absence in the actual
HTTP response; it does not by itself prove that every invalid body would be
rejected. The injected runner regression establishes detection of forbidden
members separately, and the parser/schema regressions establish their own
rejection behavior. The current `bdpbd` fixture lacks `disclosure-v1`, so this
scenario is honestly not applicable there. The historical artifact records the
`bdptest` row as packaged, not self-certified in-process; the separate
`read.disclosure.gate` lifecycle row has different provenance. Actual successor
outcomes must be observed, not copied from these historical results.

**Operator update 2026-09-09:** the separate RP1 coverage-check judgment is now
ACKed. The already ruled named Read projection remains fixed. Pending
[#24 at 87de37f](https://github.com/gastownhall/bdp/blob/87de37f673f83ec54989fdff4891bacc05730ea6/docs/design/read-projection-gate.md)
binds that projection; the whole-schema digest remains provenance because later
profile definitions and top-level metadata can change without changing Read.
Do not replace this rule with a current whole-schema digest pin. The ACK resolves
the coverage judgment, not prerequisite integration, successor observations,
readiness or merge authorization.

A separate successor-gate audit must address current catalog/manifest/per-target
fixture binding. The [pinned #24 verifier](https://github.com/gastownhall/bdp/blob/87de37f673f83ec54989fdff4891bacc05730ea6/packages/conformance/src/cohort-verification.ts#L363-L374)
still compares those digests across segments, not against all corresponding current
bytes. An assertion-only manifest
change can preserve IDs, capabilities, lifecycle classification and schema roots;
a schema projection check alone need not detect it. Audit this witness and the
appropriate current-input comparisons while preserving the historical ancestry
window and the named schema projection. No gate patch, evidence artifact change
or capability-constant update is part of this correction.

## Reproduction recipe

The commands below are a **proposed reproducible recipe**, not a transcript of
commands newly executed for this documentation fold. Use Node 24.16.0 and pnpm
11.20.0, an already populated dependency store for offline installation, and a
verified accepted `bd` 1.0.5 executable. The example uses the author's Homebrew
path; substitute the path to an accepted binary on another machine. The test
checks its JSON and text identities. Start from the repository in an isolated
checkout so restoring old inputs cannot overwrite ongoing work:

```sh
git worktree add --detach ../bdp-read-pointer-repro 0246156308d08eab39b21872056fb88e12586037
cd ../bdp-read-pointer-repro
node --version
pnpm --version
pnpm install --offline --frozen-lockfile
pnpm build
/opt/homebrew/bin/bd version --json
/opt/homebrew/bin/bd --version
pnpm exec vitest run packages/protocol/src/read-values.test.ts packages/protocol/src/schema-bundle.test.ts packages/conformance/src/runner.test.ts packages/conformance/src/executable-manifest.test.ts --reporter=verbose
BDP_REQUIRE_BD_MATRIX=1 BDP_BD_MATRIX_EXECUTABLE=/opt/homebrew/bin/bd pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:boundaries
pnpm e2e:ready:preflight
npm_config_offline=true pnpm smoke
pnpm evidence:verify
git diff --check
```

At this frozen revision, the final evidence command verifies the historical cohort,
not a genuine successor. Do not run evidence generation or edit historical bindings
to make this recipe appear to establish new conformance.

To reproduce the filtered red comparison in the same isolated checkout, retain
the new tests and restore only the old schema mirrors and manifest. Run these
steps individually: the filtered test command is expected to exit nonzero, and
the final restore returns the inputs to the frozen correction.

```sh
git restore --source=0b7d86e7cfec47f88cd1ec22314a73f39763bcf8 --worktree -- schemas/bdp-v0.schema.json packages/protocol/schemas/bdp-v0.schema.json packages/conformance/matrices/read-v1.json
pnpm exec vitest run packages/protocol/src/read-values.test.ts packages/protocol/src/schema-bundle.test.ts packages/conformance/src/runner.test.ts --reporter=verbose -t 'rejects erasure pointers|observes erasure pointer disclosure'
git restore --source=0246156308d08eab39b21872056fb88e12586037 --worktree -- schemas/bdp-v0.schema.json packages/protocol/schemas/bdp-v0.schema.json packages/conformance/matrices/read-v1.json
git diff --check
```

The recorded four failures refer to the filtered regression selection above.
Running all tests against the old inputs would also fail the updated structural
extension-branch expectation; that is a different selection, not a fifth failure
omitted from the recorded filtered run. Local preparation logs were supplemental
session diagnostics, not durable evidence artifacts; the recipe provides the
portable reproduction path.

## 2026-09-09 — final Claude review and documentation fold

Reviewed implementation head: `0246156308d08eab39b21872056fb88e12586037`.
Claude reported **0 Critical, 1 High, 3 Medium, 4 Low**. The earlier native
zero-finding report above remains its historical result and was never full
council clearance. Independent adjudication adopted three documentation findings
(M2, L5, L6: one Medium, two Low), qualified H1/M3, and retained M4/L7 as optional
coverage suggestions and L8 as information. This author fold is not independent
clearance of its resulting text.

| Finding | Disposition |
| --- | --- |
| H1 — historical evidence gate passes changed inputs | Partly accepted as a known gate limitation and separate successor audit. The historical pass and genuine successor hold were already recorded. Clarified the window/current-binding distinction and assertion-only manifest witness; rejected a whole-schema pin that contradicts RP1. No gate or evidence edit. |
| M2 — unqualified STATUS headline | Accepted. STATUS now qualifies historical verification and links this correction's integration hold. |
| M3 — target coverage cannot prove negative detection | Partly accepted as coverage clarification. Packaged absence observations remain meaningful; injected regressions establish negative detection separately, and bdpbd's missing disclosure capability remains honest N/A. No production control surface or invented successor result. |
| M4 — schema assertions for disclosure requests | Optional improvement, not a defect in the narrow guard; deferred from this documentation fold. Any adoption must preserve independent explicit-assertion regressions instead of letting schema rejection mask their absence. |
| L5 — ephemeral log reference | Accepted. Added a durable proposed command recipe and filtered-red provenance without claiming new executions. |
| L6 — missing design index link | Accepted. Added this correction to the index; unrelated index cleanup is outside scope. |
| L7 — erased retry assertion | Optional coverage improvement, deferred. A future schema assertion already covers the fixed retry mapping; no new protocol choice is needed. |
| L8 — name-based guard cannot classify arbitrary semantic extensions | Informational; the boundary remains explicit. No closed extension allowlist or weakened disclosure law. |

This fold changes only STATUS, the design index, and this note. Optional assertions,
tests, runtime code, schemas, catalog IDs, gate implementation, evidence and
capability constants are unchanged. Parent inspection and independent final-text review completed with zero Critical,
High, Medium or Low findings. That review checked the three-document scope,
reproduction recipe, links and evidence boundaries; it ran no tests. Integration,
changed-head council requirements and genuine successor evidence remain separate work.
