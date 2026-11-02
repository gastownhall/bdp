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

The approved behavior above is not contingent on re-voting it. The following concrete transport choices were proposals in174 and remain unselected in this working draft:

| Choice | Narrow option | Broader option / tradeoff | Recommendation for review |
| --- | --- | --- | --- |
| Feature admission | Optional capability, with `fromRevision` presence a rejectable extension discriminator on existing Update target. | Widen every Write provider's ordinary Update contract; imposes retained-source/recovery requirements globally. | Optional extension; same precedent as id-root, no new profile or framework. |
| Deletion evidence D | Genuine feature-owned terminal-state revision, separate from base final-live Resource revision R7; narrow authorized terminal read preserves ordinary deleted GET. | Deleted Resource edition added to full History/exact-read/result/Event unions; revises the current no-deleted-edition contract. | Narrow terminal evidence; never use R7 as D. |
| Current-state/terminal navigation | Explicit feature-owned `?view=terminal` read of the canonical Bead; no full History advertisement implied. | Full History versions `currentState` and exact terminal-record union, requiring complete History duties. | Narrow read for this implementation; full History composition can be selected separately. |
| Source/predecessor result | Output-only narrow context with exact `fromRevision` and actual `previousRevision`; live no-op retains existing context. | Broader Provenance V2 source/completeness or native wrapper adoption. | Narrow context, with explicit output binding/closed schema before emission. |
| Recovery observation | Existing created presence fact for absent-to-live, while operation result remains updated. | Emit an updated fact implying a live predecessor, or invent a new Event kind. | Truthful created presence fact under advertised Events; final field/schema mapping still needed. |

An optional capability can preserve base Write: Core already requires explicit rejectable feature selection; id-root uses grammar-owned field presence without a new profile, endpoint or media. A base closed receiver refuses an unknown `fromRevision` instead of dropping it. New closed output fields still require their own explicitly selected binding; input extensibility alone does not permit silently widening Resource, History or result envelopes.

## Schema, SDK, terminal and CLI crosswalk

| Current owner | Required coherent correspondence once the carrier is selected |
| --- | --- |
| Write `updateBeadMembers` and ordinary/batch arms | Add opaque `fromRevision` only in the selected extended grammar; source-only admitted; absent selector preserves original ordinary input rules. No UpdateLink/alias/Query/sequence adoption. |
| Feature discovery/detail and HTTP selection | Exact capability/version and rejectable request discriminator; explicit supported operation composition and no fallback. Do not claim full History merely because retained-source lookup exists internally. |
| Core Resource/provenance and selected extended record roots | Separate actual writer facts, current predecessor and historical source; output-only context cannot be caller spoofed. Closed base roots keep their meaning. |
| Deletion state and direct result | Preserve existing `deleted.resource.revision` as final-live R7; D uses an explicitly distinct selected terminal carrier. No alias terminal or fabricated full deleted Resource body. |
| History/exact/versions carrier | Any selected terminal branch is explicit and body-free; actual kind/native facts, authorization, ordering/continuation and erasure rules apply. Full History changes require a coordinated complete binding rather than native wrapper copying. |
| Retained store/recovery | Durable D, authoritative baseline and immutable source; format opt-in/compatibility explicit. No old capture migration/reseed inferred. Strict recovery verifier must accept only genuine admitted recovery transitions. |
| SDK/request parser/preflight/journal | Source token is not a Reference or guard; preserve exact bytes, same-subject resolution, feature intent, changed-key semantics and complete retained outcome. |
| Canonical CLI | `bd update ID --from-revision REV`; product alias `--from_revision` is the same option. Resolve numeric adapter ordinals only using authoritative support; exact token input is explicit. Initial Bead scope; no implicit Link recovery, `bd revert` or changed `bd restore`. |
| Batch | Explicitly select supported composition or refuse before effects. No singleton loop, per-member schema ambiguity, partial group or inferred format compatibility. |

## Required acceptance boundaries

Review exact R1/currentR7/guardR7 and R1/deletedD/guardD separately; source-only and edits; entire-envelope no-op; Type/protected/owned preservation; independent missing last-current baseline; source unavailable/erased/unauthorized/wrong identity; current races; retention/erasure before commit; rollback and durable successful/failed/no-op replay; unknown transport outcomes; literal terminal token and no Link resurrection. Parser/schema fixtures do not prove these behaviors. Actual applicable provider/SDK/installed CLI tests and separate landed-source qualification retain their own subjects.
