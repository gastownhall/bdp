# Status

This repository holds the BDP v0 **draft**. Per the specification's own
status section, until the draft is adopted it is not a conformance target.

| Surface | Specified | Validated |
| --- | --- | --- |
| Read profile | yes | sealed two-target evidence cohort — packaged, self-certified in-process, and honestly not-applicable capability-gated rows recorded per target in the artifact, which carries the authoritative counts — verified in CI |
| Read+Update profile | draft — sequence request/response envelopes, mutation results, singleton request records, the two alias targets (`put-alias` and `delete-alias`, with their alias result, sequence membership, the alias-path uniqueness invariant, alias spellings in Resource records, and alias authorization), idempotency-key syntax and qualification, duplicate handling with linearizable admission claims, dependency normalization, replay re-authorization, outcome retention, durability and recovery, and twelve problem rows drafted in the specification and schema bundle (83 definitions) with thirteen illustrative fixture files (189 validated bodies) and 78 unclaimed catalog rows; review council 9 folded (decisions D21–D31 and revisions); on 2026-09-08 D29 ruled C and applied, cross-packet X1 ruled B and applied as D32 (D9 superseded), and D31 ruled B — alias mutation joins the profile — and applied as D33–D37; review council 12 folded the same day (D38–D40; amendments under D26, D35, D36, and D37; the `alias-path-taken` row); D1–D37, D39, and D40 are ruled or ratified, and D38 (alias spellings in Resource records, applied provisionally as option (b)) in `docs/design/w1-read-update-decisions.md` is the only open decision | not yet realized — no manifest, fixture realization, runner, or evidence exists for any Read+Update row |
| Transactional profile (batch, receipts, Events, snapshots, changefeed) | draft — applied 2026-09-08 from `docs/design/w1-transactional-packet.md` after decisions T1–T48 and X1–X4 were ruled or ratified: the owned-Link delta, batch envelopes and the endpoint/status matrix, Mutation Receipts (five closed representations) and the Transactional problem table (three rows; direct and receipt contexts closed), transaction-level idempotency and `sequence` on a Transactional Scope, and version erasure on the changefeed with the erasure ledger are drafted in the specification and schema bundle (52 Transactional definitions; 135 in all, the sealed Read definitions byte-identical) with ten illustrative fixture files (nine exchange fixtures, 51 validated bodies, plus seven `sha-256-jcs` digest vectors) and 113 unclaimed catalog rows, ten of which retire the Read+Update rows the profile contradicts through the catalog's new `retires` member; T47 ruled (b) — a failed receipt is retained for at least `retention.receipt`, then forgotten whole, never expired; T49 (the alias targets' Transactional contract: receipt, Scope history, changefeed appearance, and `batch` membership) is open and teed up for the operator, applied nowhere; T50–T61 are apply-time judgment calls applied provisionally, recorded in the packet's apply record. Known gaps of the draft: no RFC 8785 serializer exists in the repository, so the digest vectors are reproduced from their recorded serializations and the canonicalization is not recomputed (T57); the I-JSON contract beyond the number model — unpaired surrogates, duplicate member names — is unstated on this branch pending gastownhall/bdp#23 (T56); and the packet's section 7 residuals (snapshot stream continuation, the synchronous wait bound, minimum-position wait, Event correlation across sources, the administrative erasure surface, receipt page URL stability, owned Links and Selectors, cross-implementation rows, `bdptest` controls, the `406` code, `ETag` on receipts and groups, per-Resource set diagnostics, discovery `ETag` semantics, and the ledger's size) stand | not yet realized — no manifest, fixture realization, runner, or evidence exists for any Transactional row |

Evidence discipline: conformance claims live only in the committed cohort
artifact (`docs/design/evidence/read-cohort/read-v1.json`; law in
`packages/conformance/matrices/README.md`), verified by `pnpm
evidence:verify`. Runner reports keep `claimEligible` false by construction.
New semantics enter the contract with conformance rows, or they don't enter.

Evidence binding (decision D29 in `docs/design/w1-read-update-decisions.md`,
ruled C on 2026-09-08): the sealed Read cohort binds the schema bundle as
it was at `0b7d86e7`, and under the ruling what the seal attests is the
Read-reachable projection of the bundle. At this head that projection is
unchanged: every definition reachable from `readDiscovery` and the other
Read definitions is byte-identical to the bundle at `0b7d86e7`; the
`validation` limits group the Read+Update draft had added to the shared
`advertisedLimits` was withdrawn into `readUpdateAdvertisedLimits`, and the
definitions the draft adds are reachable from no Read definition. The gate
that recomputes the projection's digest is a separate PR; until it lands,
`pnpm evidence:verify` checks the `schema` binding's shape without
recomputing it, and no re-seal is claimed or required for this head.

Open protocol questions are tracked in the specification's "Open protocol
questions" section; contributions there are welcome.
