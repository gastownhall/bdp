# BDP implementation status

The specification remains a draft. Runtime claims require the evidence gates below.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | Wildcard ownership, numeric rules, named schema projection and erased-resource pointer correction integrated through foundation #29 | Current two-target cohort: 83 applicable passes, nine justified N/A outcomes; packaged and self-certified provenance and uncovered variants are explicit in the artifact |
| Read+Update profile | D1–D40 ruled; singleton/sequence/alias wire, idempotency, retention and recovery contracts from #19 are integrated; 84 mirrored schema definitions | Illustrative wire and catalog checks only; no Read+Update runtime, executable manifest or capability claim |
| Transactional profile | Approved #20 batch, receipt, Event, snapshot and shared HTTP contracts integrated; 139 mirrored definitions across profiles | Illustrative wire and catalog checks only; shared Read HTTP runtime and fresh observations are required before landing; no Transactional capability claim |
| History capability | All 38 decisions recorded in merged #25; owning wire materialization under council correction | No advertised capability or runtime evidence |

The Read cohort was genuinely generated from
`bcd0dc506f9f8bd3f35e2ddfce2006f288f92215` and committed with its matching
capability constant at `599361130bfaa07c2b5d157f3ecbe44f0691cb9e`.
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

G1–G5 evidence boundary (2026-09-10): the newly specified shared negotiation,
conditional-response and HEAD rules are not attested by the preserved Read
cohort. The HTTP fixture family validates narrated illustrations only. Applicable
Read catalog/manifest assertions and actual runtime observations must be adopted
in a genuine successor cohort before this integration lands.
