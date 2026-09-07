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
  numbered provisional decisions (D1–D31) behind the drafted Read+Update
  sequence envelopes, idempotency contract, durability and recovery rules,
  and problem rows — each with its context, options, tradeoffs,
  recommendation, and the specification sentence that depends on it — and
  the review-council findings folded into them, for the operator to rule on
  one at a time.
- [W1 Transactional packet](./w1-transactional-packet.md) proposes, for the
  Transactional profile, the normative text, schema definitions, fixtures,
  and unclaimed conformance rows the draft still lacks — the owned-Link
  delta, batch envelopes, Mutation Receipts and the Transactional problem
  table, transaction-level idempotency and `sequence` on a Transactional
  Scope, and version erasure on the changefeed — as numbered provisional
  decisions (T1–T48 and the cross-packet X1–X4), with review council 10
  folded and every shared name reconciled against the Read+Update wire. It
  is packet-only: nothing in it changes the specification, the bundle, the
  fixtures, or the catalogs until the operator rules and it is applied.

These design documents are drafts until their open decisions are resolved and
their review findings have been addressed.
