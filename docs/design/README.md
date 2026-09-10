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
- [Owned-Link wildcard decisions](./owned-wildcard-decisions.md) records the
  numbered judgments (OW1–OW8) taken while transcribing the 2026-09-08
  wildcard ownership ruling — what the wildcard's `max` bounds, the closed
  `{ max }` entry, the present-plus-declared `ownedLinks` rule, row
  profiles, the evidence posture, and the runtime lag — each with its
  context, options, recommendation, and the specification sentence that
  depends on it.

- [Numeric-model decisions](./numeric-model-decisions.md) records the
  numbered judgments (NM1–NM11) taken while transcribing the 2026-09-08
  numeric-model ruling — signed zero, the precise round-trip rule, depth and
  carriers, the rule's scope, the vectors, row profiles, where the rule is
  stated, the evidence posture, the runtime lag, never-admitted data, and
  the ledger collision — each with its context, options, recommendation,
  and the artifacts that depend on it.
- [Read schema projection gate](./read-projection-gate.md) records the
  2026-09-08 rulings that the sealed Read cohort binds the digest of a
  projection of the schema bundle (D29 = C) and that the projection is the
  sealed definition set by name, not the Read-reachable closure (RP1); the
  projection rule, the derived roots as coverage check, the re-seal trigger,
  and the binding-format migrations of the sealed artifact.
- [Owned-Link wildcard runtime review](./owned-wildcard-runtime-review.md) records
  the Read parser and reference-adapter draft, verification, council findings
  and dispositions, and the remaining conformance integration obligations.

- [Read erasure-pointer correction](./read-erasure-pointer-correction.md) records
  the bounded hardening, review dispositions and historical evidence boundary;
  prerequisite integration and a genuine successor cohort remain required.

- [W1 Read+Update wire decisions](./w1-read-update-decisions.md) records the
  numbered decisions (D1–D40) behind the drafted Read+Update sequence
  envelopes, alias targets, idempotency contract, durability and recovery
  rules, and problem rows — each with its context, options, tradeoffs,
  recommendation, and the specification sentence that depends on it — and
  the findings of review councils 9 and 12 folded into them. D1–D32 are
  ruled or ratified (2026-09-08; D29 ruled C, cross-packet X1 ruled B, and
  D31 ruled B, all applied); D33–D40 ruled or ratified 2026-09-08; no decision is open.

These design documents are drafts until their open decisions are resolved and
their review findings have been addressed.

- [History resolution packet](./history-profile-packet.md) records all 38 ACKed
  History answer units, their normative/wire materialization work and explicit
  deferred extensions. Semantic ballot closure is separate from implementation
  and conformance.
  Its [review record](./history-profile-review.md) records the completed `143832b8`
  council, seven bounded clarifications, and the successor’s remaining final-head
  review gate. Both are non-normative and claim no History
  implementation or conformance.
