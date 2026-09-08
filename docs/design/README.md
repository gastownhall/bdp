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
- [Read schema projection gate](./read-projection-gate.md) records the
  2026-09-08 rulings that the sealed Read cohort binds the digest of a
  projection of the schema bundle (D29 = C) and that the projection is the
  sealed definition set by name, not the Read-reachable closure (RP1); the
  projection rule, the derived roots as coverage check, the re-seal trigger,
  and the binding-format migrations of the sealed artifact.

These design documents are drafts until their open decisions are resolved and
their review findings have been addressed.
