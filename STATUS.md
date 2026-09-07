# Status

This repository holds the BDP v0 **draft**. Per the specification's own
status section, until the draft is adopted it is not a conformance target.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | yes | sealed two-target evidence cohort — packaged, self-certified in-process, and honestly not-applicable capability-gated rows recorded per target in the artifact, which carries the authoritative counts — verified in CI |
| Read+Update profile | draft — sequence request/response envelopes, mutation results, singleton request records, idempotency-key syntax and qualification, duplicate handling, dependency normalization, replay re-authorization, outcome retention, durability and recovery, and eleven problem rows drafted in the specification and schema bundle with illustrative fixtures and 48 unclaimed catalog rows; review council 9 folded (decisions D21–D31 and revisions), pending the operator's rulings on the provisional decisions in `docs/design/w1-read-update-decisions.md` | not yet realized — no manifest, fixture realization, runner, or evidence exists for any Read+Update row |
| Transactional profile (batch, receipts, Events, snapshots, changefeed) | draft — several normative schema and problem artifacts still pending | not yet realized |

Evidence discipline: conformance claims live only in the committed cohort
artifact (`docs/design/evidence/read-cohort/read-v1.json`; law in
`packages/conformance/matrices/README.md`), verified by `pnpm
evidence:verify`. Runner reports keep `claimEligible` false by construction.
New semantics enter the contract with conformance rows, or they don't enter.

Known gap (decision D29 in `docs/design/w1-read-update-decisions.md`): the
sealed Read cohort binds the schema bundle as it was at `0b7d86e7`. The
Read+Update draft since added definitions to that bundle, one of them — the
`validation` limits group — reachable from `readDiscovery`, and the gate
checks the `schema` binding's shape without recomputing it against the
current bundle. The cohort therefore proves the Read surface against the
bundle it was sealed with, not the current one; re-sealing or a recomputing
gate rule is the operator's call.

Open protocol questions are tracked in the specification's "Open protocol
questions" section; contributions there are welcome.
