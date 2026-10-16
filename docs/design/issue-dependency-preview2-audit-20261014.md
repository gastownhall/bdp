# Issue and Dependency: Preview 2 source audit, October 14, 2026

This is evidence for the proposed domain Type specification, not a change to Preview 2 or a release approval. The proposed model has lowercase `issue` and `dependency` base Types; `task`, `bug`, etc. conform to `issue`, and `blocks`, `parent-child`, etc. conform to `dependency`. The implementation will translate its native classification columns into intrinsic Type affiliations rather than exposing `issue_type` and `dep_type` as proposed properties. Those are **proposed changes**; the audited build does not implement them.

## Exact source and binary

- Live GitHub `donnabox/beads:release/preview2-integration`, independently queried for this audit: `b6f7115adfd6b3da0055b8576c152d8d9456518a`.
- Exact source checkout: `/Users/dbox/repos/wt/janet/preview2-types-effective-display-20261014`; `git rev-parse HEAD` matches b6 and `git status --short` was empty when inspected.
- Source tree: `828a2ec229ac10d78e9683f1dbf446118d51cc44`.
- Delivered binary: `/Users/dbox/repos/beads-preview2-pr106-playground/bin/bd`; independently rehashed SHA256 `0d42c7079cb510dfc4e5d368017cceca09a8181b3f4e41b1e6e49c8014c4174c`.
- Build provenance: `/Users/dbox/repos/beads-preview2-pr106-playground/reference/provenance.json`; it explicitly says `release_approved: false`.
- Frozen qualification root: `/Users/dbox/.local/state/janet/qualify-p2-types-effective-display-20261014`. The local receipt reports exact-source, installed embedded/shared-server tests; this audit did **not** rerun those tests or independently requalify the candidate.
- Janet's latest local handoff records qualified PR106 staged into integration at October 14 16:17 Pacific, then a manual-feedback hold at 17:02. The remote `context/janet/preview2-oct10-session-handoff.md` was read but is stale at Oct10/PR84; it was not used as the current source pin. Older PR94 and PR97 builds were not used.

No shared database, playground, source checkout, runtime configuration, or release ref was changed. The binary was hashed, not executed against a workspace. All source citations below are immutable b6 links.

## Type inventory: human selectors are not installed definitions

The build installs **six nominal definitions**: two Bead Types (`preview-issue`, `preview-memory`) and four Link Types (`preview-dependency`, `preview-related`, `example-follows`, `example-cites`). The actual Related URL is `types/preview-related`; its human selector is `preview-related-memory`.

`bd types` human output instead lists usable command selectors: 14 Bead choices without custom additions (13 Issue classifications plus Memory), and 22 Link choices (19 Dependency kinds plus three informational Types). `--json` and `--details` expose actual installed definitions. This is deliberate, not evidence that Task and Bug already have nominal graph identities.

[Installed six-definition inventory](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/informational_types.go#L28); [human versus installed inventory](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_types.go#L72).

**The two “related” concepts are distinct.** `--type related` selects native Dependency kind `related`, hence `types/preview-dependency` with `dep_type:"related"`, Issue-only endpoints, pair uniqueness and source ownership. `--type preview-related-memory` (also `preview-related`) selects the standalone informational descriptor `types/preview-related`, Issue-or-Memory endpoints, independent multiedges and optional `note`; only Memory sources own it. Do not collapse these in the proposed Type namespace, and do not rename established Dependency `related` to solve the collision. Stable qualified identities must distinguish it from Memory's Related contract.

[Selector resolution](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_links.go#L115); [effective display names](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_types.go#L97).

The installed Issue and Dependency descriptors do not supply `propertiesSchema`. Their descriptions and native writers encode the effective payload contract. Descriptors carry unversioned string Type URLs; current record `revision` identifies the instance revision, not the Type definition. Task/Bug nominal conformance and pinned Type affiliations remain proposed.

[Issue and Dependency descriptors](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/schema.go#L71); [IssueRecord representation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/types.go#L85).

## Full Issue field inventory

The native `types.Issue` struct has **56 serialized field names**. That is not a claim that all 56 appear on every read, are writable, or belong in proposed BDP `properties`. Most use `omitempty`; omission often means the Go zero value rather than an independently optional/null schema contract. Identity, attribution, relationship, storage and view fields require deliberate placement.

The graph projection is the native Issue object with `dependencies` removed (represented as owned Links), `metadata` moved to the envelope, and comments not hydrated. It does not cherry-pick a small authored-properties DTO. Fields unsupported by the graph writer normally stay absent/zero. Ordinary `show --json` uses a richer detail DTO; `--graph-json` uses the graph envelope.

[current graph projection](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go#L245); [ordinary detail projection](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_details.go#L17).

In the table, **C/U** means admitted by graph generic create/update property input; **C** means create only; **special** means a named graph operation; **native** means represented by the wider native product but not admitted by the graph generic property writer. “Snapshot” describes serialization by the existing native history mechanism, not a proposed guarantee that the field is writable. The normal history recorder loads the native Issue with labels and lease overlay, adds dependencies, then serializes it.

[history snapshot assembly](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/issueops/version_history.go#L640); [stored columns and lease overlay](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/sqlbuild/sqlbuild.go#L45).

| Native JSON field | Native representation / source | Preview 2 graph writing and projection | History participation |
|---|---|---|---|
| [`id`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L22) | Stored identity | Allocated at create; also currently repeated in properties | Stable identity in snapshot |
| [`title`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L26) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`description`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L27) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`design`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L28) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`acceptance_criteria`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L29) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`notes`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L30) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`spec_id`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L31) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`status`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L34) | Stored workflow string | Create defaults/open or named workflow; generic properties update rejects | Snapshot |
| [`priority`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L35) | Stored int | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`issue_type`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L36) | Stored string classification | C via --type or property; generic update rejects; PROPOSED intrinsic Type mapping | Snapshot; classification has no separate definition revision |
| [`is_blocked`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L41) | Persisted derived readiness projection | Not generic writable; standard full loader does not populate it; journal snapshots do | Journal-specific; ordinary durable snapshot omits false |
| [`assignee`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L44) | Stored string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`owner`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L45) | Stored attribution/ownership string | Creator defaults; not admitted as generic properties input; native patch permits edits | Snapshot |
| [`estimated_minutes`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L46) | Stored *int | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`created_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L49) | Stored timestamp | Writer-generated; read-only on graph create/update | Snapshot |
| [`created_by`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L50) | Stored creator string | Derived from caller actor by CLI; not generic property input | Snapshot |
| [`updated_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L51) | Stored timestamp | Writer-managed; heartbeat deliberately does not change it | Snapshot |
| [`started_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L52) | Stored nullable timestamp | Lifecycle-managed | Snapshot |
| [`closed_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L53) | Stored nullable timestamp | Close/reopen lifecycle-managed | Snapshot |
| [`close_reason`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L54) | Stored string | Close operation input; not generic property writer | Snapshot |
| [`closed_by_session`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L55) | Stored string | Lifecycle/native patch field; not graph generic writer | Snapshot |
| [`lease_expires_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L63) | Stored in separate node-local leases row | Special claim/heartbeat/reclaim; live read overlay | Captured when durable snapshot minted; subsequent heartbeat creates no revision |
| [`heartbeat_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L64) | Stored in separate node-local leases row | Special heartbeat writes timestamp; NOT computed at query time | Captured when durable snapshot minted; subsequent heartbeat creates no revision |
| [`lease_granted_node`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L73) | Stored in separate node-local leases row | Lease writer managed; live read overlay | Captured when durable snapshot minted; refresh/backfill creates no revision |
| [`due_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L102) | Stored *time.Time | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`defer_until`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L103) | Stored nullable timestamp | Native patch field; graph todo/claim lifecycle may manage; not generic properties | Snapshot |
| [`external_ref`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L106) | Stored *string | C/U; scalar/patch/replacement subject to native writer policy | Snapshot; no-op does not mint a new revision |
| [`source_system`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L107) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`metadata`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L112) | Stored JSON | Separate graph metadata envelope; metadata flags/patch | Native snapshot retains; graph history moves to envelope |
| [`compaction_level`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L115) | Stored int | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`compacted_at`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L116) | Stored *time.Time | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`compacted_at_commit`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L117) | Stored *string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`original_size`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L118) | Stored int | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`labels`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L137) | Hydrated labels table | C plus special label commands; not generic property update | Included in snapshot |
| [`dependencies`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L138) | Hydrated relation rows | Removed from graph properties; source-owned Link representations | Included in native snapshot; separately mapped owned graph Links |
| [`comments`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L139) | Separate comments feed | Not hydrated in graph properties; separate commands/detail view | Not part of normal Issue durable snapshot |
| [`sender`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L142) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`ephemeral`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L143) | Stored persistence marker | Graph create explicitly refuses ephemeral Issue | Native snapshot excludes active wisp/no-history plane |
| [`no_history`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L144) | Stored persistence marker | Graph create explicitly refuses no-history Issue | Native snapshot excludes active wisp/no-history plane |
| [`wisp_type`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L145) | Stored WispType | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`storage_class`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L153) | Stored marker with effective-class interpretation | Graph create requires versioned storage; not generic properties | Marker serialized when present; plane/history admission separately controls minting |
| [`pinned`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L158) | Stored bool | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`is_template`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L159) | Stored bool | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`bonded_from`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L162) | Struct lineage field; not in canonical SQL Issue column loader | No graph generic writing; normal graph read does not hydrate it | No claim of ordinary snapshot persistence from struct declaration alone |
| [`await_type`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L165) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`await_id`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L166) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`timeout`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L167) | Stored time.Duration | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`waiters`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L168) | Stored []string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`source_formula`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L171) | Struct source-tracing field; not in canonical SQL Issue column loader | No graph generic writing; normal graph read does not hydrate it | No claim of ordinary snapshot persistence from struct declaration alone |
| [`source_location`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L172) | Struct source-tracing field; not in canonical SQL Issue column loader | No graph generic writing; normal graph read does not hydrate it | No claim of ordinary snapshot persistence from struct declaration alone |
| [`mol_type`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L175) | Stored MolType | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`work_type`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L178) | Stored WorkType | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`event_kind`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L181) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`actor`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L182) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`target`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L183) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |
| [`payload`](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L184) | Stored string | Native/specialized field; graph generic create/update refuses | Snapshot when hydrated/present; no independent generic-write support implied |

`ContentHash`, `RowVersion`, routing/prefix fields, `WispPlaneOverride`, and `IsLitePartial` are `json:"-"` and are **not** additional JSON properties. Native row_lock/revision is a partial equality token; graph detail output replaces it with the graph revision. Do not specify these tokens as interchangeable.

[native concurrency caveats](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L75); [graph revision replacement](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_details.go#L50).

## Exact generic property surfaces

**Create (13 names):** `title`, `description`, `priority`, `issue_type`, `design`, `acceptance_criteria`, `notes`, `spec_id`, `assignee`, `labels`, `estimated_minutes`, `external_ref`, `due_at`. Metadata is supplied separately; owner/creator are CLI defaults; graph storage validates a slightly wider internal CreateRequest, which is not proof that arbitrary property keys are accepted by CLI.

[create classification/defaults](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue.go#L105); [create property whitelist](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue.go#L261); [storage create whitelist](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go#L21).

**Update/patch/replacement (11 names):** `title`, `description`, `design`, `acceptance_criteria`, `notes`, `spec_id`, `assignee`, `priority`, `estimated_minutes`, `external_ref`, `due_at`. Status, classification, owner, labels, and lease values are not generic graph update properties. Some have separate workflow surfaces; native `IssuePatch` supports more than this adapter.

**Important replacement seam:** current graph Issue `--replace-properties` operates on that writable 11-field projection, not on every key emitted by current Issue reads. Omitted title/priority fails; omitted nullable estimate/external-ref/due clears to null; omitted other writable strings clears to empty. Unrecognized or system fields fail. It preserves the nonwritable underlying fields through the native patch writer. This is narrower than the proposed general “complete properties replacement” contract and must be explicitly reconciled before treating Issue as a generic managed Type.

[update whitelist](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue_update.go#L162); [writable-projection patch and clearing rules](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue_properties_patch.go#L41); [replacement becomes root patch](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_memory_properties_patch.go#L87); [wider native patch surface](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/issueops/issueops.go#L118).

Existing validation facts worth preserving: title is nonempty and at most **500 bytes** (error wording says characters, but code uses byte length); priority is integer 0–4; estimate is nullable nonnegative integer and graph SQL admission caps at signed 32-bit maximum; spec_id has a 1024-rune storage bound; external_ref uses 255-rune field bound. Due timestamps are normalized for existing storage before comparison. These are current product constraints, not newly designed BDP limits.

[title/priority/estimate validation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L383); [storage representability bounds](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_field_representation.go#L14); [due/no-op semantics](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_update.go#L28).

### Creation authority is surface-specific

Graph CLI create derives `created_by` from `getActorWithGit()` and owner from `getOwner()`; they are not accepted caller keys in `--properties`. Graph storage's bounded CreateRequest requires zero/unset timestamps, and native insertion fills created_at/updated_at with current time. This does **not** prove they are universally immutable or server-authenticated across the entire native product: the wider native insertion/import path accepts supplied nonzero timestamps and normalizes them to UTC, and its create cloning preserves CreatedBy/Owner. Native update's public IssuePatch also permits owner and closed_by_session, unlike this graph adapter. Provenance V2's authenticated-actor rule remains proposed, not established by these defaults.

[Graph caller defaults](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue.go#L156); [graph create whitelist](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go#L35); [native timestamp normalization](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/issueops/create.go#L680); [native patch fields](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/issueops/issueops.go#L118).

## Live versus derived: heartbeat is the decisive example

The `heartbeat_at` timestamp is **not computed during a query**. Heartbeat explicitly writes the ephemeral, ignored, node-local `leases` table and extends `lease_expires_at`. It deliberately does not stamp Issue `updated_at`, mint durable Issue History, or change graph revision. Current graph reads join those live values into Issue properties. Therefore two current reads can return different lease fields under the same graph revision; exact historical reads instead use retained snapshot bytes.

The history recorder currently loads the Issue with lease overlay when minting a durable version, so a historical snapshot may contain the values observed then. That does not make every heartbeat a versioned update. The graph current/retained consistency check explicitly substitutes retained lease fields while comparing the other fields.

A “seconds since heartbeat,” expired/not-expired, or stale decision is a different kind of value: derived from stored timestamps plus a clock/policy. It should not be conflated with the stored timestamp itself. This audit does not pick the proposed representation or decide whether any such change should cause a revision at query time.

[heartbeat write contract](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/issueops/lease.go#L288); [graph heartbeat retains revision](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_lease.go#L15); [live-overlay consistency exception](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go#L285); [historical projection](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/history_exact.go#L305).

The richer `IssueDetails` output has other computed/view fields: `parent`, `dependency_count`, `dependent_count`, `comment_count`, `comments_omitted`, `unresolvable_dependencies`, `unresolvable_dependents`, `epic_total_children`, `epic_closed_children`, and `epic_closeable`, plus hydrated dependent/comment collections and a projected revision. These are detail-view results, not extra fields in the 56-field Issue struct or proof of authored properties. The readiness `is_blocked` field is a persisted derived projection carried specifically by journal snapshots, while regular Issue loaders leave it out.

[detail DTO and computed fields](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L1243); [journal readiness projection](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L37).

## Classifications and custom definitions

Current built-in Issue classifications are `bug`, `feature`, `task`, `epic`, `chore`, `decision`, `message`, `molecule`, `gate`, `spike`, `story`, `milestone`, plus internal `event`. The last is not in AllIssueTypes but is accepted by built-in/custom validation. The CLI's nine core work Types and four system Types reflect these 13. Specialized molecule/gate/event commands are not all enabled by Preview 2 merely because a selector is displayed.

Custom Issue names resolve from the custom_types table if nonempty, otherwise the types.custom config row, **unioned with YAML types.custom**. Names are trimmed/deduplicated. Graph creation refuses configured infrastructure Types and nonversioned storage. The proposed nominal-Type translation must handle custom names and their configuration sources; hard-coding only the 13 built-ins would regress current product behavior. No conclusion here says config itself is an immutable Type definition.

[classification constants/validation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L774); [core/system descriptions](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/types.go#L16); [custom composition rule](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/issueops/config_helpers.go#L345); [infra refusal](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issues.go#L76).

### Existing subtype meaning and description conventions

These classification descriptions and conventions should be carried forward as existing product behavior, not replaced with invented subtype schemas:

| Classification | Established purpose | Recommended description sections |
|---|---|---|
| task | General work item; default | Acceptance Criteria |
| bug | Bug report or defect | Steps to Reproduce; Acceptance Criteria |
| feature | New feature or enhancement | Acceptance Criteria |
| chore | Maintenance or housekeeping | None built-in |
| epic | Large body of work spanning multiple Issues | Success Criteria (Acceptance Criteria accepted as equivalent) |
| decision | Architecture decision record | Decision; Rationale; Alternatives Considered |
| spike | Timeboxed investigation | Goal; Findings |
| story | User story describing a feature from the user's perspective | Acceptance Criteria |
| milestone | Marks completion of related Issues; contains no work itself | None built-in |
| message | Message between agents/users | None built-in |
| molecule | Molecule root for swarm coordination | None built-in |
| gate | Async coordination gate | None built-in |
| event | Audit-trail event used by set-state | None built-in |

`RequiredSections()` calls these **recommended** sections. `bd lint` checks them; ordinary native create checks only when `--validate` or `validation.on-create=error|warn` requests it. Error mode rejects, warn mode reports but admits. `lint.sections.<type>` adds configured requirements rather than replacing built-ins. Matching is case-insensitive heading-text containment, not a Markdown parser; nonempty `acceptance_criteria` satisfies the Acceptance/Success Criteria requirement without a heading. Graph Preview 2 create routes through its own whitelist and does not admit `--validate`; its code does not call LintIssue. Therefore these are not unconditional schema admission requirements of the audited graph Type.

[Type purposes](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/types.go#L16); [section definitions](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L866); [native optional validation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/create.go#L275); [lint interpretation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/validation/template.go#L111); [graph create whitelist](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_issue.go#L37).

Epic classification also selects native epic-progress computation and epic workflows; gate classification affects native work-view handling. These established behaviors are additional evidence that classification is not merely a display label. The audit does not claim every subtype has special fields or that every native command is admitted in Preview 2. [Epic detail computation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/workapi/detail.go#L296); [graph epic workflow](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/issue_epic.go#L17).

Current built-in status strings are `open`, `in_progress`, `blocked`, `deferred`, `closed`, `pinned`, `hooked`. Custom statuses have behavior categories active/wip/done/frozen. Do not turn the proposed Issue status schema into a closed built-in-only enum without settling custom-status support.

[built-in and custom statuses](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L576).

## Dependency contract and proposed mapping

Native Dependency JSON contains `id`, `issue_id`, `depends_on_id`, `type`, `created_at`, `created_by`, `metadata`, `thread_id`. Native endpoints can have wider storage forms; the current graph projection requires **distinct live local durable Issues and unpinned endpoints**. Its envelope is `id/type/revision/source/target/properties/metadata/attribution`; current `properties` contains only `{ "dep_type": KIND }`, common metadata must be `{}`, native thread_id must be empty. Nonempty native metadata or thread IDs make the row exceed the preview contract. Generic property update is restricted to informational Links, not Dependency.

Under the accepted proposal, native `type`/current `dep_type` maps to the intrinsic nominal Link Type; removing dep_type leaves the currently supported Dependency authored-property record empty. Native metadata/thread support is a separate future product decision, not permission to invent replacements in this draft. Creation attribution belongs to the common representation, not a new Dependency-specific semantic field.

[native Dependency fields](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L1171); [admission and pair uniqueness](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/dependencies.go#L39); [projection restrictions](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/dependencies.go#L221); [property-write Type restriction](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/informational.go#L216).

Direction is source=dependent (`issue_id`), target=prerequisite (`depends_on_id`): `bd dep add A B` means A depends on B, so B blocks A. Parent-child uses child→parent. Preserve that polarity even though a Type named `blocks` can tempt a reader into the opposite direction.

Exactly one native Dependency can occupy an ordered Issue pair, **across kinds**. Reasserting the same pair/kind is an exact graph no-op; a different kind conflicts. A different explicit Link ID for an already allocated pair also conflicts. This is not a generic graph multiedge ban. Dependency creation/deletion changes source-owned state and records the source Issue revision atomically; the target is not versioned just because it is targeted. The limit 1000 in preview owned declarations is a disposable admission budget, not a proposed enduring Issue rule.

The 19 built-in kinds are:

`blocks`, `parent-child`, `conditional-blocks`, `waits-for`, `related`, `discovered-from`, `replies-to`, `relates-to`, `duplicates`, `supersedes`, `authored-by`, `assigned-to`, `approved-by`, `attests`, `tracks`, `until`, `caused-by`, `validates`, `delegated-from`.

Custom Dependency kinds need only a nonempty UTF-8 string up to **32 bytes** in the graph native-dependency adapter. Unknown kinds have no scheduling/hierarchy effect. **Both current graph `bd dep add` and `bd link create` CLI routes restrict to built-ins** through `runGraphPreviewAddDependency`; the storage adapter is wider. The generic CLI Link selector also rejects unknown kinds. Current help claiming any <=32-byte kind is accepted on the dependency shortcut is stale relative to these code gates. Do not claim custom Dependency creation is available through this graph CLI. [CLI kind gate](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_workflow.go#L125); [selector gate](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/cmd/bd/graph_preview_links.go#L151).

Readiness and cycles are not uniform across the family:

- `blocks`, `parent-child`, `conditional-blocks`, `waits-for` affect ready-work calculation.
- Hard blocking classification excludes `parent-child`.
- The combined static scheduling-cycle set is `blocks`, `conditional-blocks`, `parent-child`; `waits-for` is deliberately outside it because its gate concerns children.
- Native waits-for metadata has `gate`, optional `spawner_id`, optional `also_blocks`; this richer native metadata is **not supported by the current graph Dependency projection**, which requires `{}`. The base Type must not be assigned blanket blocks/cycle behavior that contradicts these subtype differences. Do not assume a generic custom Type conforming to `blocks` already triggers legacy scheduling; that is an implementation gap to specify.

[all kinds and scheduling distinctions](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/types/types.go#L1391); [custom kind validation](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/dependencies.go#L186); [Dependency descriptor and pair rule](https://github.com/donnabox/beads/blob/b6f7115adfd6b3da0055b8576c152d8d9456518a/internal/storage/graphstore/schema.go#L85).

## Requirements driven by this audit

1. Distinguish authored stored properties, server-managed durable properties, live node-local overlays, and computed views. ReadOnly alone does not answer revision or historical-read semantics.
2. Define a replacement contract that can accommodate generated/read-only fields without silently claiming the existing writable-subset behavior is generic whole-object replacement.
3. Translate built-in and custom issue/dependency classifications to nominal Type IDs with explicit write/read migration; preserve old native JSON compatibility where required.
4. Preserve directional and ordered-pair uniqueness semantics across the dependency conformance family. Establish whether custom conformers inherit scheduler behavior through conformance or need operator registration.
5. Keep transient heartbeat and independently updated comment feeds from accidentally becoming mutable historical revision bodies.
6. Keep native config-driven custom statuses/types separate from immutable Type-definition promises until their lifecycle is designed.
7. Existing Preview 2 descriptors do not provide complete schemas. The draft should publish schemas derived from field/write inventories and label unresolved live/view placement, not pretend `bd types --json` already supplies them.

## Limitations and checks performed

Read-only source audit at exact b6; live branch verification, clean local HEAD confirmation, delivered binary SHA256 verification, provenance and handoff inspection. No builds, tests, database reads/writes, or CLI workflows were executed. Tests cited or reported in Janet's receipts are prior evidence, not rerun here. Native fields outside the graph create/update boundary were classified from struct/SQL loader/write facade, not exhaustively traced through every native specialized command. In particular `bonded_from`, `source_formula`, and `source_location` are serializable struct fields absent from the canonical Issue SQL loader; the report deliberately does not infer persistence from their Go tags.
