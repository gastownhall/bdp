# Status

This repository holds the BDP v0 **draft**. Per the specification's own
status section, until the draft is adopted it is not a conformance target.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | yes | sealed two-target evidence cohort — packaged, self-certified in-process, and honestly not-applicable capability-gated rows recorded per target in the artifact, which carries the authoritative counts — verified in CI, with the Read schema projection — the sealed definition set of the schema bundle, by name — recomputed by the gate so a change to any sealed definition closes the cohort until re-sealed while later-profile definitions and bundle metadata do not |
| Read+Update profile | draft — sequence/idempotency envelope schemas and problem rows still pending | not yet realized |
| Transactional profile (batch, receipts, Events, snapshots, changefeed) | draft — several normative schema and problem artifacts still pending | not yet realized |

Evidence discipline: conformance claims live only in the committed cohort
artifact (`docs/design/evidence/read-cohort/read-v1.json`; law in
`packages/conformance/matrices/README.md`), verified by `pnpm
evidence:verify`, which also recomputes the Read schema projection the cohort
binds (D29 = C; by RP1 the sealed definition set of the schema bundle, by
name): a change to any sealed definition forces a re-seal; a definition the
seal does not name, or the bundle's top-level metadata, does not. Runner
reports keep `claimEligible` false by construction.
New semantics enter the contract with conformance rows, or they don't enter.

Open protocol questions are tracked in the specification's "Open protocol
questions" section; contributions there are welcome.
