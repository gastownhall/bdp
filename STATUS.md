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

Known gap (OW7 in `docs/design/owned-wildcard-decisions.md`; the condition
PR #19's D29 records): the owned-Link wildcard entry changed the schema
bundle after the Read cohort was sealed at `0b7d86e7`, so the cohort's
`bindings.schema` digest no longer matches the current bundle and the
evidence gate checks that binding's shape without recomputing it — the
cohort proves the Read surface against the bundle it was sealed with, and
re-sealing is the operator's call. The wildcard's six conformance rows
(`packages/conformance/catalog/owned-wildcard-v1.json`) are unclaimed
metadata bound to the specification text: no manifest, fixture realization,
runner, or evidence exists for them.

Open protocol questions are tracked in the specification's "Open protocol
questions" section; contributions there are welcome.
