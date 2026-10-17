> Nonnormative format follow-through to Donna’s accepted product decision. No schema/runtime or landing authorization.

# Shared Inception — accepted single-field decision

October 17, 2026. [Durable decision receipt](https://github.com/gastownhall/beads/issues/7510#issuecomment-6242419971); [Provenance V2 proposal](https://github.com/gastownhall/beads/issues/7510).

Donna and Polly replaced the earlier origin/entry recommendation with one shared `revisionProvenance.inception` open enum for Beads and Links: how this identity’s current period of presence in this Scope began. Values include `create`, `import-insert`, `import-upsert` (INSERT branch only, if supported), `revert`, and `unknown`. Ordinary edits and upsert updates of live identities preserve it. Missing historical cause stays unknown; retained original versions are never backfilled.

## Import follow-through

- The initial fresh-destination, identity-preserving profile records `import-insert` on its new heads. Exact original versions, provenance and pins remain unchanged. Current importer/time observations do not authenticate or invent source history.
- Staged validation and atomic publication remain required. A retained retry of the same invocation/package/policy returns its original disposition without another head/Event. Conflicting reuse or unsupported populated-store import refuses. The enum does not add upsert support.
- Ordinary source-version/result correlation and bounded receipt/recovery semantics still apply. No separate origin/entry objects, portable Inception admission descriptors or original-origin correction mechanism are prerequisites.
- Optional Activity reports and signatures are not required for import or Inception. No preview migration or runtime restart follows from this decision. Shared schema/CLI encoding and minimum import-transition propagation remain owner work.

## Revert and shipping restore

`bd revert` creates a new SAME-ID revision using the named retained revision’s properties and metadata, with current-operation provenance and a reference to the selected revision. Earlier History and terminal deletion remain. Live-to-live preserves Inception; deleted-to-live sets `revert`. Other deleted Links are not automatically recreated; no implicit Type/endpoint rollback is selected. Shipping `bd restore` retains its pre-compaction Issue-content recovery meaning.

## Superseded review

The [prior format review](https://github.com/gastownhall/bdp/blob/92afb8e93ba0292fe37e4b2ec28ac35790132d03/docs/design/iris-inception-format-review.md) is retained as historical review of an unadopted design. Its origin/entry, original-origin correction and extra admission-descriptor requirements are superseded. Earlier council evidence remains bound to its exact source, not proof of adoption or implementation of either design. Use the accepted decision above for current planning.

The [owning WIP interchange proposal](../../specs/proposals/interchange/interchange.md#shared-inception-design-update--october-17-2026) and [delivery plan](iris-memory-interchange-plan.md) are reconciled; Go implementation remains paused for Donna’s plan review.
