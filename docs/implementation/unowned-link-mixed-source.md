# Live administration of an unowned Link on a mixed-ownership source

Ownership is declared per `(source Bead Type, selected Link Type)` pair, including
an explicit wildcard. A source may own a different Link Type without owning the
selected Link. The ordinary evaluator derives `owned` from that exact pair and
builds a new source version only when `owned` is true. See `docs/specs/bdp.md`
Owned Links and the Link creation/deletion endpoint revision rule, and
`resource-evaluator.ts` ownership/source-recipe selection.

The live Link administrative branch already uses the same descriptor pair to
select its owned-Link implementation. Its additional refusal merely because
`source.ownedLinks` contained any records was broader than that rule. Removing
that refusal lets the existing unowned correction/tombstone path run; it does
not widen the separately selected owned-Link path or introduce an API.

The focused regression replaces the obsolete refusal assertion with two real
correction/tombstone cases. Their source owns two complete first-class Links of
a different Type; selected and owned Links carry distinct opaque pins. Both
cases preserve the complete source record/revision/owned set, target record,
owned Link records and receipts, unrelated retained Events, and retained source,
target and owned versions. Only the selected version enters the erasure ledger;
its receipt becomes erased and same-key replay stays retained. Normal reopen
preserves the result. Tombstoning the selected Link's last version still withholds
that subject's graph facts; a different Link does not revive erased subject facts.

Two new fault cases throw before the erasure commit and compare the complete
native state before/after, including the still-live selected Link and all owned
originals. The two positive cases fail on the original refusal; all four selected
new cases pass with the two-line production removal. Unrelated already-passed
Link tests and historical crash cohorts are not replayed for ownership. This is
source-level administrative regression coverage, not a new installed/full-profile
qualification or a change to specification, capacity, timing or permissions.
