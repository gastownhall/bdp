# Historical-base Bead Update and recovery: current-contract crosswalk

This receiving draft applies the approved [Beads7719 decisions](https://github.com/gastownhall/beads/issues/7719) to current BDP. It starts at main `a0d72b6d45dd8d3059bf3cc64b22382f43b8162e`. It does not merge [historical PR174](https://github.com/gastownhall/bdp/pull/174) or treat that proposal's carrier choices as rulings. The initial subject is a Bead. Historical Link recovery remains outside this change.

The approved product delivery is [Beads141](https://github.com/donnabox/beads/pull/141), merge `b6d0493baf7c0a52f68df5a943158290e3b75878`, as recorded in7719. Its native and CLI wrappers are implementation correspondence, not automatic BDP schema adoption or current BDP provider qualification.

## Three independent revision roles

| Role | Live example | Recovery example | Meaning |
| --- | --- | --- | --- |
| Content source | R1 | R1 | Exact retained authorized live revision of this same Bead, selected by `fromRevision`. |
| Actual predecessor | R7 | D | Actual state replaced by this decision; D is genuine deletion evidence, not the last-live token. |
| Optional current guard | expected R7 | expected D | Independent current-state condition; source R1 supplies no guard proof. |

Guard omission retains ordinary Update behavior; no mandatory recovery guard is introduced. Tokens are opaque, never inferred from ordering, timestamps or spelling. There is no latest, nearest or default-last-live source fallback.

## Editable-field allowlist

The historical source contributes only ordinary editable document state. Explicit edits apply afterward in the same transaction. A location is eligible only when the existing selected writer admits it; an unclassified/protected location is not made editable by this feature.

| Plane / field | Source treatment | Current authority |
| --- | --- | --- |
| `properties` | Historical values at ordinary editable locations supply the base, then explicit property edits apply. | Current Type/property policy; immutable, initialization-only and service-managed locations preserve their authoritative current values/rules. |
| Common `metadata` | Historical ordinary editable common metadata supplies the base, then explicit metadata edits apply. | Current complete-object, numeric, protected-field and ordinary mutation policy; it is not arbitrary native SQL state. |
| `id`, Resource kind, owning Scope, allocation | Never copied or reallocated. | Original identity/allocation and current target resolution. |
| `type`, exact definition selection | Never implicitly sourced. | Current accepted affiliation and selected Type meaning, acquired independently after deletion. An explicit ordinary Type edit retains its own admission rules. |
| `ownedLinks`, incident graph, Link endpoints/pins | Never replayed from source. | Actual current graph and ordinary final-state constraints. Recovery creates no Links and does not resurrect deleted membership. |
| Revision, actor/time/agent/message/provenance envelope | Never copied as facts of the new operation. | Actual current writer and newly minted revision; source and actual predecessor are separately represented. A live no-op returns the entire old envelope unchanged. |
| Protected/initialization facts and service-managed state | Historical editable base cannot override them. | Independently established authoritative current/last-current baseline; regeneration only where existing rules permit it. |
| Inception | Live edits preserve current presence cause; recovery follows accepted `revert` direction. | Output encoding remains subject to the carrier selection below; no import operation is selected. |

Source acquisition must explicitly authorize the exact complete editable content consumed, including authoritative absence where composition depends on it. It need not acquire unused historical owned-Link captures or old protected structure. Missing editable content cannot be guessed, truncated or replaced with current values or another revision. This operation-local acquisition does not imply a partial successful History Resource. Source authorization is independent of current-write/terminal permission and follows ordinary nondisclosure gates.

A source's readable body and a guardable D do not establish the last-current protected baseline. The provider must independently establish all required identity, Type/definition, immutable and initialization facts through commit. An authorized exact predecessor may supply them only if positively bound by the current authority; a convenient R1 or latest retained body is no substitute. Missing, erased, pruned, malformed, unauthorized or unavailable required facts cause atomic refusal with the existing truthful diagnosis.

## Native Issue correspondence

The exact integrated [native engineering crosswalk](https://github.com/donnabox/beads/blob/b6d0493baf7c0a52f68df5a943158290e3b75878/engdocs/GRAPH_NATIVE_HISTORICAL_UPDATE.md) remains a native adapter boundary:

| Native member | Approved native composition boundary |
| --- | --- |
| `title`, `description`, `design`, `acceptance_criteria`, `priority` | Ordinary string/priority setters, including admitted empty values and P0. |
| `estimated_minutes`, `external_ref`, `spec_id`, `due_at` | Existing exact nullable/scalar, set/clear, bounds and whole-second representations. |
| `assignee` | Existing assignment/unassignment and transfer authorization; a revision guard cannot override it. |
| `notes` | Source supplies notes base; append follows it, preserving overwrite/force fences and append intent. |
| Top-level common metadata | Source then explicit ordinary metadata edits under canonical I-JSON and writer rules. |
| `status`, `issue_type`, `owner`, unadmitted scheduling/gate/molecule/message/event fields | No generic historical copy. Changed unadmitted members require an explicit native-domain mapping or refusal. |
| Labels, parent, Dependencies, endpoints and owned structure | Preserve actual current membership; deleted-to-live never reconstructs them from retained payloads. |
| `created_at`, `created_by`, `source_system`, `source_formula`, `source_location`, `storage_class` | Retain independently established last-current initialization facts. |
| Operation/derived facts, leases, readiness, compaction, node-local state, ordinals | Ordinary native owner alone decides; no generic snapshot overwrite or fabricated deletion ordinal. |
| Future/unclassified serialized member | Changed values refuse until the reviewed native crosswalk is extended. |

This table does not require a generic BDP reference implementation to import Beads domain code or expose native wrappers. Native `attribution`, `previousVersion`, duplicate `version`, `terminal_versions`, private participation generations and local ordinals are not selected BDP wire spellings.

## Atomicity, no-op and retained outcomes

Source authorization/availability, independent guard, explicit composition, current final validation and commit are one authoritative decision. Retention and erasure fences apply at acquisition and commit. Account cumulative source/current/baseline inputs under real bounds; do not obtain a successful partial source by truncation. All content, identity, history, ownership and applicable Event effects commit together or none do.

A live equal-result Update preserves the entire original envelope, revision and prior historical context. It emits no lifecycle Event or new provenance-only version. Admission/source/guard/final validation and durable no-reexecution state still apply. Deleted-to-live changes presence and creates a new same-ID live revision even if its editable values equal an earlier record. It retains deletion/history evidence and revives no Link.

Freeze the selected source and feature intent in semantic request identity. A changed selector with the same key conflicts. A retained success/no-op replays its original complete outcome under current disclosure/erasure rules without reacquiring a later source or executing again. Lost response means uncertain disposition until ordinary same-key recovery; no read-then-replace, new key or client-side reconstruction fallback is permitted.

## Carrier selection requiring a concrete ruling

The approved behavior above is not contingent on re-voting it. Donna selected optional discoverable capability (47 A), body-free terminal VERSION in the identity's committed-state lineage (48 B), narrow authorized current terminal-state read without requiring a full History rollout (49), durable source/predecessor context only through explicitly selected feature results/views with base Resource unchanged (50 A), and permitted explicit initial refusal of batch composition (51 B). Accepted source/guard/atomicity behavior is not reopened. Donna also selected exact complete editable source content actually consumed plus an independently authorized current protected baseline (78 B).

| Choice | Narrow option | Broader option / tradeoff | Recommendation for review |
| --- | --- | --- | --- |
| Feature admission — SELECTED47 A | Optional discoverable capability; `fromRevision` presence selects its extended Update request. | Mandatory Write widening was not selected. | Exact URI/version and media/closed-wrapper binding are specified in Write. |
| Deletion evidence D — SELECTED48 B | Genuine body-free terminal version D follows actual final-live R7 in one identity's committed-state lineage; recovery R8 follows D. | Separate state-token model A was not selected. No full History rollout is required by B. | `expectedRevision` on selected historical Update guards actual current R7 or D. Base deletion result keeps R7 and ordinary deleted GET stays404; never fabricate D from R7. |
| Current-state/terminal navigation — SELECTED49 narrow read | Canonical Bead `?view=terminal` plus selected feature Accept returns `{terminal:TERMINAL_VERSION}` for actual current deletion D. | It is not full History or a current live Resource read; live/unknown/undisclosable current terminals receive uniform404. | Closed body-free terminal/view schema; HEAD/auth/conditional parity. Full History composition remains separately unselected, not patched with an unrepresentable fallback. |
| Source/predecessor result — SELECTED50 A | Durable exact source/actual-predecessor context through explicitly selected feature results/views; base Resource unchanged. | Broader Provenance V2 and native wrapper adoption were not selected. | Feature wrapper/context schemas reuse unchanged base result/Resource roots. |
| Initial batch composition — SELECTED51 B | Explicit refusal is permitted and advertised as `atomicBatch:false`. | Co-advertised individual capabilities alone do not prove joint support. | `true` requires a complete explicitly implemented joint binding. |
| Event / full-History composition — unselected binding | Preserve actual live→deleted and deleted→live transitions; actual predecessor D differs from content source R1, with unchanged base fields. | New terminal/history/Event carriers cannot be inferred from native/private facts or a permissive schema. | Initial reference advertises neither full History nor Events. Any advertised combination requires its complete reviewed terminal/version correlation and exact unions. |
| Source admission granularity — SELECTED78 B | Require the exact complete editable source content actually consumed, with explicit source authorization and an independently authorized current protected baseline. | Unused historical owned-Link captures and old protected structure are not required. This is not a successful partial History Resource. | No guessing missing editable values, truncation, current-value or alternate-revision fallback. Source permission is independent of current-write/terminal permission; ordinary nondisclosure gates apply. |

An optional capability can preserve base Write: Core already requires explicit rejectable feature selection; id-root uses grammar-owned field presence without a new profile, endpoint or media. A base closed receiver refuses an unknown `fromRevision` instead of dropping it. New closed output fields still require their own explicitly selected binding; input extensibility alone does not permit silently widening Resource, History or result envelopes.

## Schema, SDK, terminal and CLI crosswalk

| Current owner | Required coherent correspondence once the carrier is selected |
| --- | --- |
| Write `updateBeadMembers` and ordinary/batch arms | Add opaque `fromRevision` only in the selected extended grammar; source-only admitted; absent selector preserves original ordinary input rules. No UpdateLink/alias/Query/sequence adoption. |
| Feature discovery/detail and HTTP selection | Exact capability/version and rejectable request discriminator; explicit supported operation composition and no fallback. Do not claim full History merely because retained-source lookup exists internally. |
| Core Resource/provenance and selected extended record roots | Separate actual writer facts, current predecessor and historical source; output-only context cannot be caller spoofed. Closed base roots keep their meaning. |
| Deletion state and direct result | Body-free terminal version D has actual predecessor R7 and no live Resource body. A base-media delete keeps existing `deleted.resource.revision` as final-live R7; D persists atomically even for base clients and is exposed through selected narrow view. No dedicated feature delete-result wrapper is required initially. |
| Narrow terminal and separate History composition | `GET canonical-bead?view=terminal` plus feature Accept returns current terminal wrapper; live/unknown/undisclosable404. It supplies D to SDK/HTTP callers without full History; initial CLI journeys may obtain D through this read before literal `--if-revision D`. No new terminal CLI verb or automatic versions fallback is selected. Full History remains unsupported until a coordinated terminal exact-read/row/window/lineage/provenance binding is reviewed. |
| Retained store/recovery | Durable D, authoritative baseline and immutable source; format opt-in/compatibility explicit. No old capture migration/reseed inferred. Strict recovery verifier must accept only genuine admitted recovery transitions. |
| SDK/request parser/preflight/journal | Source token is not a Reference or guard; preserve exact bytes, same-subject resolution, feature intent, changed-key semantics and complete retained outcome. |
| Canonical CLI | `bd update ID --from-revision REV`; product alias `--from_revision` is the same option. Resolve numeric adapter ordinals only using authoritative support; exact token input is explicit. Initial Bead scope; no implicit Link recovery, `bd revert` or changed `bd restore`. |
| Batch | Explicitly select supported composition or refuse before effects. No singleton loop, per-member schema ambiguity, partial group or inferred format compatibility. |

## Required acceptance boundaries

Review exact R1/currentR7/guardR7 and R1/deletedD/guardD separately; source-only and edits; entire-envelope no-op; Type/protected/owned preservation; independent missing last-current baseline; source unavailable/erased/unauthorized/wrong identity; current races; retention/erasure before commit; rollback and durable successful/failed/no-op replay; unknown transport outcomes; literal terminal token and no Link resurrection. Parser/schema fixtures do not prove these behaviors. Actual applicable provider/SDK/installed CLI tests and separate landed-source qualification retain their own subjects.
