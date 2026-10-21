# G2 incident metadata: proposed normative follow-up

This branch implements Donna’s properties/common-metadata parity direction from the 2026-10-19 operator sheet. It does not rewrite the agreed `docs/specs/bdp.md` baseline (SHA256 `67772742d7d08f48c12196e9789f1859ad2d0e19f133ea65e197b049361f84f8`).

Proposed narrow amendment to the Bead-scoped Event Source incident-Link bullet (currently lines 5588–5590):

> `updated` facts whose subject is an incident Link when that Link’s mutable properties or common metadata change.

The existing effectful/no-op mutation rules determine whether an updated fact exists. Supplying an equal properties patch does not exclude an effectful metadata update. A self-Link contributes each updated fact once to its endpoint Bead source; external endpoints gain no in-Scope source. Scope, Link and owned-Bead facts, Event identity/order, checkpoint and SSE continuation rules are unchanged. S1 retained Snapshot/continuation minimum semantics are outside this change.

This is a separately identified proposed clause amendment, not a claim that the pinned properties-only clause was already metadata-explicit. No profile, installed configuration, release, or main landing is qualified by this document.

## Focused implementation evidence

The isolated candidate is based on `fe57ea2942615d5dbe770b9229d0da25f51bf1a7`. Only endpoint projection and affected finite/SSE tests change; the agreed spec bytes remain unchanged.

Validation used Node 24.16.0 and Vitest 4.1.10. The two affected files produced 77 passes plus one obsolete expected-gap assertion failure; that assertion was changed to verify both endpoints’ successful GET/HEAD metadata Events and its targeted successor passed. The four new metadata cases passed again after explicit typed presence guards replaced new non-null assertions. Thus all 78 affected cases have passing observations across the retained runs, not a claimed single final 78-case green execution. The first preparation failure (invalid external Reference fixture and missing emitted runtime) is preserved separately.

`tsc -b packages/server`, full source/test typecheck, formatting, and `git diff --check` passed. Biome’s combined check remains nonzero for three import-order errors also present in the untouched baseline; baseline/current diagnostic logs are retained. No hook is bypassed.

All test invocations used a 60-second external watchdog and 4MiB per raw log channel; every invocation ended normally with both pipe EOFs, reaped direct child, and no remaining owned process group. These are source/real-listener tests, not a packed-installed G2 cohort, full profile qualification, or S1 evidence. Raw JSON results/stdout/stderr/receipts and failed-source snapshots are retained under `bdp-integration-logs/bdp-product-incident-events-20261020` in the Vickie workspace; this support directory is outside the product commit.
