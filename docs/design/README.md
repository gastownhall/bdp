# BDP implementation design

These documents describe the planned Node/TypeScript reference implementation
of the Bead Protocol. They are non-normative. If a design document conflicts
with the [BDP v0 draft](../specs/bdp.md), the protocol draft governs and the
design document must be corrected.

Terminology: "Gate 0" is this project's name for the pre-implementation
decision gate — a numbered list of design items ("item N") resolved before
code — and "Wave N" names the delivery waves that follow. Both numbering
schemes appear throughout these historical design records; the items and
waves are internal sequencing labels, not protocol concepts.

- [Requirements](./requirements.md) records product, protocol, quality, and
  operational requirements with stable identifiers.
- [Architecture](./architecture.md) defines the modules, interfaces, seams, and
  repository layout.
- [Component specifications](./component-specifications.md) defines the
  responsibilities and acceptance criteria for `bdp`, `bdptest`, `bdpbd`, and
  the conformance kit.
- [Client interface and Scope port](./client-scope-port-interface.md) records
  the Gate 0 item 9 design finding: the current interface hypothesis, the
  closed typed-result and discriminated-failure surface gaps that Gate 0
  items 4 and 5 must close, the parallel item-9 work that proceeds today,
  and the testable contract-suite and Wave 2 freeze evidence milestones the
  eventual port must meet.
- [W1 Read+Update wire decisions](./w1-read-update-decisions.md) records the
  numbered decisions (D1–D40) behind the drafted Read+Update sequence
  envelopes, alias targets, idempotency contract, durability and recovery
  rules, and problem rows — each with its context, options, tradeoffs,
  recommendation, and the specification sentence that depends on it — and
  the findings of review councils 9 and 12 folded into them. D1–D32 are
  ruled or ratified (2026-09-08; D29 ruled C, cross-packet X1 ruled B, and
  D31 ruled B, all applied); D33–D40 ruled or ratified 2026-09-08. Council 13 separately exposes the cross-profile admission gap T62 in the Transactional packet.
- [W1 Transactional packet](./w1-transactional-packet.md) records, for the
  Transactional profile, the normative text, schema definitions, fixtures,
  and unclaimed conformance rows the draft lacked — the owned-Link delta,
  batch envelopes, Mutation Receipts and the Transactional problem table,
  transaction-level idempotency and `sequence` on a Transactional Scope,
  and version erasure on the changefeed — as numbered decisions (T1–T48
  and the cross-packet X1–X4), with review council 10 folded and every
  shared name reconciled against the Read+Update wire. All of T1–T48 and
  X1–X4 are ruled or ratified (2026-09-08; T47 ruled (b)), and the packet
  was applied the same day to the specification, the bundle,
  `fixtures/transactional/`, and `packages/conformance/catalog/transactional-v1.json`;
  its apply record lists what landed where, the ruled sentences it
  amended, T49 (locator-only alias receipt contract, ruled option 1), and the apply-time judgment calls T50–T61,
  initially applied provisionally. T50–T56 recommendation A (including amended T56)
  was ratified 2026-09-09; T57 option B selects regression work using #24's existing
  canonicalizer after authorized integration, unimplemented here. T58–T61 were
  subsequently ratified A. T62a/b and T65 were ruled A and materialized 2026-09-09;
  the [latest ACK record](w1-transactional-packet.md#ratification-and-materialization-of-t58-through-t65-2026-09-09)
  records the direct retry rules and the supported persistent Event consumer
  erasure-handling contract.
  Council 13 exposed T62–T64 for admission identity,
  withheld allocation projection, and live erasure delivery.

- [`w1-transactional-council13.md`](w1-transactional-council13.md) — three-seat apply review, verified finding dispositions and correction-pass validation. T49/T63/T64 are ACKed and materialized; T50–T56 recommendation A (including amended T56) is ratified 2026-09-09; T57 option B selects a still-unimplemented canonicalization-check follow-up using #24. T58–T61 are ratified A; T62a/b and T65 are ruled A and materialized 2026-09-09. T65 scopes the supported persistent Event consumer claim to existing changefeed/ledger integration, recovery and cleanup; History H12 and RP1 stay separate. No merge clearance.

These design documents are drafts until their open decisions are resolved and
their review findings have been addressed.

Operator ACK update 2026-09-08: the Transactional packet records T49 option 1,
T63(a) and T64(a) applied; T50–T61 remain provisional, and T62 still needs its
observable duplicate-response contract after the PostgreSQL feasibility check.

Ratification update 2026-09-09: Donna ACKed recommendation A for T50–T53;
see the packet's [dated ratification record](w1-transactional-packet.md#ratification-of-t50-through-t53-2026-09-09).
This supersedes the preceding dated update only for those four provisional
statuses. T54–T61, T62's two retry choices and T65 retain their current holds;
no implementation, evidence or readiness/merge permission changes.

Subsequent ACK update 2026-09-09: Donna ACKed T54–T57 as A/A/A/B; the
[dated follow-up record](w1-transactional-packet.md#ratification-and-follow-up-for-t54-through-t57-2026-09-09)
ratifies T54–T56 and selects reuse of #24's existing canonicalizer for later
regression work under T57. That work is not implemented here. T58–T61 remain
provisional, T62's two retry choices and T65 remain open, and RP1 stays separate.
Subsequent operator batches contain eight decisions; no remaining choice is
selected by that scheduling preference.

Latest ACK update 2026-09-09: Donna ACKed T58–T61 = A, T62a/b = A and
T65 = A; RP1 was the separately handled eighth recommendation. The
[materialization record](w1-transactional-packet.md#ratification-and-materialization-of-t58-through-t65-2026-09-09)
supersedes all earlier pending statuses for those seven Transactional decisions.
T57 implementation and independent final review/integration/evidence work remain;
the new catalog obligations are unclaimed, with no runtime or merge grant.
