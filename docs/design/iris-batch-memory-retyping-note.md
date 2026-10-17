> Nonnormative planning/review background. Proposed contract authority is under specs/proposals/interchange; no runtime or landing authorization.

# Batch V2 Memory retyping and shared Inception dependencies

Design coordination, October 17, 2026. Source implementation remains paused.

## Exact design artifacts

- Public bounded [BDP #152](https://github.com/gastownhall/bdp/issues/152) covers operation subsets/errors, not the complete local batch decision record or adopted Type-change wire. The original broad local discussion is not published by this citation.
- Current [interchange contract](../../specs/proposals/interchange/interchange.md) and [implementation plan awaiting review](iris-memory-interchange-plan.md).

BDP batch == bd batch is the target: one JSON operations envelope, six individual Bead/Link create/update/delete operations for Go V2, existing name/@name identity bindings, one Scope and all-or-nothing publication. No set operations, parameterized procedures or per-member subprocesses. Native storage may implement these semantics without a BDP client/server dependency.

## Retyping: selected direction versus frozen wire propagation

Donna’s explicit [Bead Type-update ruling](../../specs/proposals/interchange/interchange.md#settled-bead-type-update-behavior) applies generally to BDP Beads: normal update may change Type, and must validate both resulting properties and affected Links against the new Type’s constraints or fail atomically. The narrower native Memory path below is a delivery cutline, not a restriction on this BDP rule.

Rechecked current BDP main `8d6671ed19b0c0406428ccc2d2161768d01e8b9b` on October 17. Its [Resource rules](https://github.com/gastownhall/bdp/blob/8d6671ed19b0c0406428ccc2d2161768d01e8b9b/specs/profiles/core/core.md#L333) explicitly make Bead Type immutable. The [schema](https://github.com/gastownhall/bdp/blob/8d6671ed19b0c0406428ccc2d2161768d01e8b9b/specs/profiles/core/bdp-v0.schema.json) shares updateBeadMembers between singleton and batch; it accepts propertiesChange, metadataChange, expectedRevision and revisionProvenance, with no Type-change member. Therefore the checked format does NOT support same-ID retyping. Multiple operations do not fix this. Delete/create is not a substitute: canonical identity cannot be reassigned and retained history must survive.

Native bd batch at Janet’s starting base `703bb13e91aa2cab2092443319139006d74242c8` is a different existing implementation: line-oriented close/update/create/dep-add/dep-remove against Issue transactions. Its update keys are status/priority/title/assignee/force. Direct mode wraps the dispatch in transact; the proxied path uses runBatchProxiedServer. This source inspection establishes neither generic Memory support nor installed qualification of the proposed batch V2.

The selected Types direction already permits atomic affiliation changes: Types §2 specifies whole Type-reference replacement validated with resulting properties and applicable constraints; omission preserves affiliation. Donna confirmed this is settled, not a new product question. For the selected Memory-family path, one ordinary guarded update may change Type together with necessary property edits. Validate the complete resulting Type/properties pair as one operation. Targeted edits preserve untouched fields; only explicit full replacement requires the caller to supply all mandatory fields. Preserve ID/history; never require a transient invalid Memory state or use delete/create. Keep the exact future field names open until Trish/Vickie reconcile the shared operation contract. The selected direction must propagate consistently into Core/Write and both singleton/batch wire schemas; no private JSON field is silently added under the old contract. This is propagation/qualification work, not a request to re-decide Type mutability and not something #152 alone implements. Native Memory does not wait for that protocol propagation. Exact current implementation evidence remains Trish-owned.

A batch can compose that future operation with other valid operations, but does not supply its missing primitive. Preserve Types §§5.5–5.8: arity, pair uniqueness and declared directed acyclicity validate at transaction commit and may be temporarily violated between operations. Syntax, authorization and revision preconditions remain enforced; property, endpoint and reference checks are not automatically deferred. These selected final-state rules do not require a generalized constraint engine for the fixed Memory relationships. Other affected-Link repair/ownership-transition boundaries remain owner work.

The native mutation boundary must, inside one transaction:

1. Resolve current identity, exact revision guard and permitted within-Memory affiliation change; refuse Issue↔Memory conversion.
2. Validate the complete target-Type properties using the shared validator and retain deliberate unknown/open-field semantics.
3. Recheck affected live floating incoming/outgoing Links against resulting endpoint membership and correlated pairs. Exact pinned references retain their historical affiliation and meaning. Refuse invalidating retyping unless a separately specified supported composition resolves it.
4. Apply owned-source effects exactly as shared History rules require. Changing an incoming target does not alone mint its source or target an extra revision; do not synthesize Link changes when none occurred.
5. Publish Resource state, retained versions, truthful provenance and effects together, or roll back all changes and allocations. Exercise concurrent stale guards, invalid required fields, invalid floating Links and injected failures.

The same validator and mutation path should serve native singleton and native batch. Embedded/shared-server parity is required. A native within-Memory update can ship before broader BDP/bd batch alignment if Janet selects that cutline; Memory must not wait for a BDP runtime or full Transactional-profile conformance. Current BDP also has incompatible fixed endpoint/pin and deletion rules; batch equality cannot conceal those pending shared contract changes.

## Shared Inception: accepted decision

Donna adopted the [single-field Inception/revert decision](https://github.com/gastownhall/beads/issues/7510#issuecomment-6242419971). It supersedes the unadopted origin/entry design and original-origin correction proposal. Inception is shared revision provenance for Beads and Links, not a Memory property. See the [owning interchange note](../../specs/proposals/interchange/interchange.md#shared-inception-design-update--october-17-2026) for the open enum and update/revert behavior.

The minimum importer preserves exact originals and pins, adds a current-operation import head with `import-insert`, and retains atomic admission and retry/result handling. Unknown historical cause stays unknown; no backfill into retained originals. A repeated retained invocation returns the same result; populated-store import/upsert still refuses. No origin/entry objects, correction operation, admission descriptor, signature or Activity is a prerequisite.

`bd revert` is the selected new SAME-ID revision operation over retained properties/metadata, with current provenance and a selected-revision reference. Deleted-to-live sets Inception to `revert`; live-to-live preserves it. It does not implicitly roll back Type/endpoints or revive other Links. Shipping `bd restore` retains pre-compaction Issue-content recovery. Required shared History and undelete outcomes remain independent of broader provenance expansion.

Schema/CLI propagation, actual catalog identities and runtime qualification remain owner work. This documentation reconciliation does not restart implementation or release main-landing holds.
