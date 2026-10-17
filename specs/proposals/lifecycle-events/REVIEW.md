# Draft review and validation status

October 17, 2026. Draft publication only; semantic and main-landing holds remain.
Base: PR159 `d7197e97a29bff8f075028419afad05388e2e655`.

## Council

Native Codex review completed and confirmed its four findings repaired:
commit-time graph constraints preserved; reverse current owned-state agreement
under fixture facts; duplicate-member case independently discriminating; lifecycle
scenario count assertions. Type-change wording now records settled Types direction
and pending wire propagation, with complete-result versus replacement distinction.
No remaining native draft-publication blocker. Actual Claude review is running;
**the full council is pending**, not passed. Gemini excluded as Donna requested.

## Local checks

Passed: 20 semantic-carrier shape/count/deduplication vectors; Biome 2.5.7 checks for the new JSON;
local Markdown links; unchanged pending Memory row; byte-unchanged current Core
and distribution schema bundles; git diff whitespace checks. Python 3.14.5,
jsonschema 4.26.0, referencing 0.37.0. The documented uv commands run offline once
those dependencies are cached.

These are review-artifact checks, not runtime/conformance tests. No engines,
installed Go workflows, History server or independent implementation were run.
Full workspace CI/build/typecheck/smoke/evidence suites were not run for these
proposal-only additions. Host Node v26.0.0/pnpm11.25.0 differ from the CI pins
v24.16.0/11.20.0; JSON formatting used the repository's exact Biome 2.5.7.

The current workflow selects PRs to main and pushes to main/codex-vickie branches.
This draft initially targets the PR159 branch, so hosted CI may be absent; check
and report the actual exact-head status after publication. Focused checks above
are not a substitute for all CI at adoption/landing. Exact final heads/check
results and council disposition will be reported on the PR/bus/tracker.
