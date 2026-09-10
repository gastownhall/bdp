# BDP implementation status

The specification remains a draft. Runtime claims require the evidence gates below.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | Foundation #29 plus shared negotiation, conditional-response and HEAD implementation; 49 executable scenarios | Genuine successor cohort: 89 applicable passes and nine justified N/A outcomes across both targets; all three new HTTP scenarios are packaged observations |
| Read+Update profile | D1–D40 ruled; singleton/sequence/alias wire, idempotency, retention and recovery contracts from #19 are integrated; 84 mirrored schema definitions at the #19 wire milestone | Illustrative wire and catalog checks only; no Read+Update runtime, executable manifest or capability claim |
| Transactional profile | Approved #20 batch, receipt, Event, snapshot and shared HTTP contracts integrated; 139 mirrored definitions across profiles | Wire/catalog checks and T57 canonicalization regressions; shared Read HTTP implementation and genuine successor observations complete. No Transactional runtime capability claim |
| History capability | All 38 decisions recorded in merged #25; separate owning wire materialization reviewed, awaiting its own integration and evidence | No advertised capability or runtime evidence |

The Read cohort was genuinely generated from
`8912f1de30bdafaf87d8a1caeb591abe777c8102` and committed with its matching
capability constant at `ded0d3b2b4b82399cf27282cb1e49beb71b79fb0`. The
reference target contributes 36 packaged and 11 self-certified passes; the
bd target contributes 34 packaged and eight self-certified passes. Their
remaining two and seven slots are explicitly not applicable. Eight uncovered
qualifications remain recorded in the artifact. The earlier #29 cohort is
historical provenance.
The five foundation source ancestries, including #24, remain preserved.
The approved ordered 27-definition Read seal and independent current-byte
checks remain enforced; coverage checks never choose digest inputs.

Read+Update additions must preserve the sealed Read projection. The current
wire integration introduces no write capability grant: every applicable
Read+Update obligation needs its own actual observations before admission.
The HTTP/client and durable local reference runtime are the next implementation
wave under the approved authentication, recovery and operational defaults.

Evidence claims live only in `docs/design/evidence/read-cohort/read-v1.json`,
verified by `pnpm evidence:verify` under `packages/conformance/matrices/README.md`.
Runner reports keep `claimEligible` false by construction. Generic client and
fixture-publisher checks are not independent target-authorship evidence;
optional CORS/absent-limit branches retain their documented limits.

G1–G5 evidence boundary (2026-09-10): the genuine successor runs bind the
current 49-plan Read manifest, catalog and observer sources, including shared
negotiation, conditional-response and HEAD observations. The HTTP fixture
family remains illustrative; Read observations do not establish Transactional
mutation, retention/replay, concurrency or persistent-consumer erasure behavior.
All 2,064 tests in 60 files pass with zero skips after generation and rebuild.
The evidence verifier accepts 89 rows under the unchanged named Read projection.
