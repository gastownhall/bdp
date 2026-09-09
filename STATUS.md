# Status

This repository holds the BDP v0 **draft**. Per the specification's own
status section, until the draft is adopted it is not a conformance target.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | yes | sealed two-target evidence cohort — packaged, self-certified in-process, and honestly not-applicable capability-gated rows recorded per target in the artifact, which carries the authoritative counts — verified in CI |
| Read+Update profile | draft — sequence/idempotency envelope schemas and problem rows still pending | not yet realized |
| Transactional profile (batch, receipts, Events, snapshots, changefeed) | draft — several normative schema and problem artifacts still pending | not yet realized |

Evidence discipline: conformance claims live only in the committed cohort
artifact (`docs/design/evidence/read-cohort/read-v1.json`; law in
`packages/conformance/matrices/README.md`), verified by `pnpm
evidence:verify`. Runner reports keep `claimEligible` false by construction.
New semantics enter the contract with conformance rows, or they don't enter.

The numeric model ruled 2026-09-08 (gastownhall/bdp#21) enters as four
unclaimed metadata rows (`packages/conformance/catalog/numeric-model-v1.json`)
plus vectors in `fixtures/numeric-model/`; it changes no bundle definition,
and the sealed Read cohort is untouched — a lockstep test finds no
non-round-tripping number literal in any sealed Read artifact (NM8 in
`docs/design/numeric-model-decisions.md`).
