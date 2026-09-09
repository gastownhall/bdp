# Beads implementation evidence — conversation input

This folder is **additional data for the BDP conversation, not spec text**.
Everything in it is non-normative and carries `authority: non-normative`
front matter. It exists so the data-model open questions can be worked
against shipped-code evidence from the beads side, and so the editors can see
how the implementation tracks currently map themselves onto BDP's layering.

## Contents

- **`beads-kernel-charter.md`** — a draft proposal (written for the beads
  canonical-API governance process) to charter BDP as the beads kernel
  specification: a kernel/domain/substrate ownership table, six mechanisms
  connecting kernel and domain (descriptors, named queries, operations,
  projections, profiles, filter dialects), a specification stack
  (S0 kernel law → S1 Work Item profile → S2 deployment profiles), and a
  five-delta sequencing plan. Included here for context: it shows how the
  implementation side proposes to consume this spec.
- **`link-identity-position.md`** — a position paper answering four of
  bdp.md's open-question clusters (scopes, cardinality/duplicates, rewiring,
  non-Bead endpoints) with beads implementation evidence, and proposing one
  clarifying amendment to selected law (the "never derives a Link's identity
  from that tuple" sentence — deterministic allocation as scope policy). Its
  core evidence is the `bd` dependency-id history (gastownhall/beads#4259):
  random per-clone Link ids on a uniqueness-keyed table broke Dolt merge
  unrecoverably, and deterministic derivation was the repair.

## Provenance

Drafted 2026-08-01 on the beads maintainer side, grounded in: the beads Go
implementation (gastownhall/beads, main), the Gas City infra-objects-on-beads
migration, the Plane-on-beads adapter (its ADR-0002), the bts-rs Rust
implementation and its performance work, and the gasworks public API surface.
Rev 1 of each document was adversarially reviewed by four independent
reviewers (citation verification, a spec-editor lens, a ratifier/consumer
lens, and a red team); rev 2 incorporates all blocker/major findings —
including a corrected convergence argument and an honest reframing of what
touches selected law.

## Reading caveats

- Code citations use `file:line` against beads-side repositories and working
  trees; they are not dereferenceable from this repository. Spec citations
  are anchored to section names and verbatim quotes (the spec's line numbers
  move too fast to cite).
- The documents refer to beads-side working tracks by window name/number:
  **w55** = Gas City infra objects on beads, **w57** = canonical beads API
  governance (owner of the `/v0/beads/*` surface-A ratification process),
  **w59** = bts-rs (Rust implementation).
- "Surface A/B/C/D" is the beads-side inventory of the four existing HTTP
  API surfaces; the charter's §5 stack diagram shows where each sits
  relative to BDP.
