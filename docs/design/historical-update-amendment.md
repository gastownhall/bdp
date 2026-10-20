# Historical-base Update: carrier proposal and implementation crosswalk

Status: reviewable sister amendment for [Beads #7719](https://github.com/gastownhall/beads/issues/7719), October 19, 2026. Donna approved the behavior; the concrete encodings labeled **proposed** below require review. This is prose and illustrative schema only. No executable schema, SDK, server, Beads source, capability, runtime pin or release branch is changed by this PR.

Base: BDP [PR172 at 8dc9aef8097c5e1be94fdf94842b98771e92351a](https://github.com/gastownhall/bdp/commit/8dc9aef8097c5e1be94fdf94842b98771e92351a), stacked on the Preview3 integration source b12665d64c2aaf6172bd1cdab409cef31ef28f44. PR172 remains a separate frozen dependency. Its ordinary empty arrays and four nonempty Event forwarding guards are retained. Its tests are not qualification of this amendment.

## Approved semantics and bounded ownership

`UpdateBead` accepts optional `fromRevision`, a nonempty opaque token selecting an exact retained live version of the ordinary target identity. Source-only requests are valid. Source supplies editable properties/common metadata, explicit patches follow, and current Type/endpoints/owned state remain current. Current guard and historical source are independent; no mandatory recovery guard is added. Live equal-result sourcing is the ordinary no-op. Recovery after an authorized deletion creates a fresh live revision under the existing identity; no other Link is revived. Ordinary deleted GET behavior remains unchanged.

Donna's new decision supersedes older `bd revert` and default-last-live proposals: CLI is ordinary `bd update ID --from-revision TOKEN`, with spelling/aliases owned by Janet's speclet. Shipping `bd restore` retains its pre-compaction Issue meaning. Historical Link recovery is excluded; the accepted shared terminal-deletion direction across Beads/Links is a dependency with separately qualified writer coverage, not a license to recover Links here.

Janet owns product sequencing, existing lifecycle wiring, all format/generation/build/test/backend runners and integration. Trish owns this three-document sister amendment. Core and Write proposed amendment sections contain the behavioral rules; this packet specifies carrier choices and their unimplemented crosswalk. No general provenance sources/completeness redesign, Event activation, import/export, Type CRUD, migration or new remote admission is included.

## Proposed request schema delta

The sole new request member is `updateBeadMembers.properties.fromRevision`, referencing existing `revision`. Add a third presence alternative to `updateBeadMembers.anyOf`; preserve both existing patch-array alternatives and their `ordinaryUpdateChange` references. Do not change `updateLinkMembers`, `updateWhere.change` or emitted nonempty `change` definitions.

```json
{
  "properties": {
    "fromRevision": { "$ref": "#/$defs/revision" }
  },
  "anyOf": [
    { "required": ["propertiesChange"], "properties": { "propertiesChange": true } },
    { "required": ["metadataChange"], "properties": { "metadataChange": true } },
    { "required": ["fromRevision"], "properties": { "fromRevision": true } }
  ]
}
```

This is a delta, not a complete replacement schema. Existing required `bead`, member properties, discriminators, `allOf` and `unevaluatedProperties: false` remain. `updateBeadRequest` keeps durable target references; `sequenceUpdateBead` and `updateBeadOperation` inherit the member with their existing idempotency/discriminator rules. The Transactional inline appendix must agree. No URL, alternate identity, empty token, `null`, default source or local-label token is admitted. An ordinary sequence-local target remains subject to ordinary resolution; it grants no right to source another identity or use a revision not retained by that operation's execution context.

Examples are proposed requests, not command transcripts:

```json
{"bead":"beads/a","fromRevision":"source-R1"}
```

```json
{"bead":"beads/a","fromRevision":"source-R1","expectedRevision":"current-R7","metadataChange":[{"op":"add","path":"/reviewed","value":true}]}
```

Tokens here are illustrative opaque values. Implementations allocate real tokens with the existing revision-safety law; token spelling, timestamps and local storage ordinals establish no terminal/current identity.

## Proposed History terminal carrier

The smallest useful guard carrier is a new optional `currentState` member on the authorized `historyVersionsPage`, independent of page items and historical source selection. A recovery-enabled authority includes it when authorized to disclose the actual observed current state. Existing providers/legacy data may lack it; omission is unavailable knowledge, never evidence of live, deleted or nonexistent state. No new discovery member/version is selected by this packet; capability exposure must be decided with coordinated schema/provider adoption, not from parser support.

```text
HistoryCurrentState =
  { state: "live", revision: Revision }
  | { state: "deleted", revision: Revision }
```

Both objects are closed and require both members; `revision` uses the existing nonempty opaque revision schema. The page's canonical `subject` binds identity. No new terminal-token class or syntax exists. `currentState` refers to the same selected enumeration snapshot as the page; continuation must not silently refresh it. It can be stale when a later Update executes. Only its revision is suitable as a current guard, and a later race remains subject to the ordinary mismatch behavior.

The terminal deletion is a real retained version, not an invented wrapper around the last live token. Proposed closed exact terminal shape:

```text
HistoryDeletedRecord {
  id: AbsoluteCanonicalResourceURL
  revision: Revision                // actual deletion version D
  state: "deleted"
  previousRevision: Revision        // actual last-live predecessor R7, not D
  revisionProvenance?: RevisionProvenance
}
```

No `properties`, `metadata`, `type`, endpoints or owned payload are present. Resource kind comes from the canonical target URL, not a caller-supplied conversion. A newly native History terminal must carry the existing required truthful native context group; optional provenance above preserves truthful absence for legacy terminal evidence rather than manufacturing attribution. If there is no actual terminal version, this record cannot be synthesized.

Proposed History rows become a union of the existing live `historyVersionRow` and a closed terminal row containing `revision`, `lineage`, `state: "deleted"`, `previousRevision` and optional `revisionProvenance`. The terminal row has no `body` member; complete terminal evidence is not a complete live Resource body. Terminal revisions participate in authority ordering/window enumeration without inferring lineage from token values. A historical source must select the live branch, not a terminal row.

Exact History reads would return the matching live-record or deleted-record union for their canonical Resource kind. The ordinary current GET is unchanged. No terminal is smuggled through `historicalBeadRecord` as an empty Bead or through a Resource-not-found response as success. The owning parser/client must expose the new union explicitly. Existing History status/header/authorization/erasure rules continue; current-state descriptor and terminal-row disclosure each need their actual permissions, not merely source-body access. Unauthorized page rows may be omitted under existing whole-row rules, and unauthorized current-state disclosure omits `currentState` rather than leaking it through metadata. Subject denial retains uniform refusal.

A deletion version D is an addressable piece of retained evidence and is distinct from disappearance of that evidence through retention/erasure. Repeated deletion cannot fabricate a second D. Exact recovery from a removed, erased or unknown source refuses with the existing substantiated diagnosis; missing terminal evidence cannot be patched by using R7 as D.

## Proposed narrow result/provenance mapping

A newly minted historical Update result uses the ordinary `updated` complete live postimage. Its immutable `revisionProvenance` gains an authority-produced `historicalUpdate` member:

```text
HistoricalUpdateContext {
  fromRevision: Revision            // exact same-subject content source R1
  previousRevision: Revision        // actual replaced live R7 or terminal D
}
```

The object is closed, both members required, using the existing revision definition. The enclosing live record's canonical `id` binds both addresses to the same subject; this is not a cross-subject reference. The member is absent on ordinary writes and on a retained live no-op. It is not accepted in `revisionProvenanceInput`, not caller-spoofable, not copied from source context and not a general derivation/source-list facility. The actual current operation actor/time/agent/message follow existing writer/authority rules; the historical source is not relabeled as the writer. Controlled copies remain subject to erasure/disclosure rules; a source citation creates no retention hold.

The only additional Inception output is the already selected optional open-string `inception` member in that same envelope: `create`, `import-insert`, `import-upsert`, `revert`, `unknown` are known values, not a closed enum authorizing those operations. Live updates preserve the current cause; a recovery uses `revert`. Missing legacy cause stays unknown. Import/upsert implementation is not included. Clients cannot set or overwrite it through historical source, property/metadata patches or provenance input.

This is a candidate minimal encoding, not an adoption of the broader sources/completeness proposal. A reviewer may choose a different shared carrier, provided the approved current/source/predecessor distinctions and no-op law remain intact. Existing closed provenance schemas/SDK unions must change together before any encoder emits these members.

Deletion results currently identify the final live revision and explicitly say deletion mints no version. The terminal dependency must reconcile that text, the shared delete writer and Events atomically. Proposed result extension is an optional `terminal: HistoryDeletedRecord` beside the unchanged `deleted` final-live identity, permitted only for deletion and required for a newly produced terminal under the selected extension. This preserves the meaning of existing `deleted.resource.revision` and exposes D separately; it never changes R7's meaning by silently reusing that field. No new outcome discriminator is needed. Alias deletion remains unversioned. The exact requiredness/exposure cutline is a review gate, not silently activated by this draft.

Transactional receipt result entries need the corresponding terminal detail and existing redaction rules. A historical recovery is an `updated` operation result, but its presence effect is not a patch against a live R7. Proposed observation mapping uses the existing `created` presence fact for D-to-live and a truthful new complete live postimage; effectful live-to-live uses `updated` with the actual R7-to-result delta. Do not add an Event type or publish Event capability here. Terminal deletion facts and owned-Link deletion deltas must retain both actual final-live predecessor and terminal revision where required; their existing field names must be reconciled explicitly rather than relabeled by a renderer. These observation/result schema amendments remain review gates in the crosswalk below.

## Native Issue editable-field crosswalk

Core properties are generic JSON, but a native Issue is not an arbitrary property bag. Initial recovery scope is Beads, not an authorization to bypass native Issue writer ownership or convert backing. The following is an adapter proposal based on the existing selected graph `UpdateIssueRequest`, not a new native contract.

| Native/graph field | Historical behavior proposal | Required owner handling |
| --- | --- | --- |
| `title`, `description`, `design`, `acceptance_criteria`, `notes` | Source only if represented as editable in the selected complete record | Use ordinary validation; notes replacement retains the overwrite fence. Do not interpret sourced notes as append instructions. |
| `priority`, `assignee` | Source through admitted native fields | Preserve zero and empty semantics, active-assignment transfer authorization and current guard. Source access cannot force a transfer. |
| `estimated_minutes`, `external_ref`, `spec_id`, `due_at` | Source only through each existing admitted representation | Preserve presence/null/clear bounds; estimate null is not silently admitted when ordinary writer refuses it. Current whole-second due-date representation remains. |
| Common metadata object | Source exact object, then explicit metadata edits | Existing complete-object/numeric/duplicate-key rules and atomic native writer. No mapping to arbitrary SQL columns. |
| Status, Issue subtype and any scalar not admitted by the selected graph adapter | No automatic generic copying | Separate native-domain mapping/review required before support; fail historical mode if required editable content cannot be faithfully represented. Do not quietly omit supported-domain requirements or reinterpret graph Type. |
| Labels, parent, Dependencies and other Link/owned structure | Never replay from a historical payload | Retain current graph under existing native ownership. No old Dependency/Link resurrection. |
| Native ID, backing key, created/updated/closed timestamps, leases, claim/coordination state, content hash, row version, participation generation and store ordinals | Never historical editable content | Preserve/regenerate at the existing native writer; never remint a native version in a second graph writer. Original initialization facts remain immutable. |
| Actor/time/current predecessor/history source/Inception | Current-operation facts, as above | Existing native recorder and graph retained mapping commit exactly once under the transaction owner. Missing legacy facts remain missing. |

Before native integration Janet must bind this table to the exact complete Issue projection, field names and ordinary mutation API. Scalar source availability does not establish legal mutation. A generic-only helper can prepare independent composition, but it must not claim native Issue recovery qualification. No change to ordinary Issue or Dependency behavior is implied.

## Closed schema, SDK and writer crosswalk

All paths below are actual repository paths at the pinned source. This table identifies required follow-up; no executable path is edited by this prose PR.

| Path / owning definition | Required amendment / acceptance |
| --- | --- |
| `specs/profiles/core/bdp-v0.schema.json` and `packages/protocol/schemas/bdp-v0.schema.json` | Keep byte agreement; add request member/presence alternative; add terminal/current-state/result/provenance definitions and unions only after carrier review. Retain all closed-object rejection and existing numeric/reference vocabulary. |
| Write inline Transactional schema (`write.md`, `updateBead`) | Add the same selector and source-only presence alternative; retain discriminators and target rules. Do not extend UpdateLink/UpdateWhere. |
| `updateBeadMembers` → `updateBeadRequest`, `sequenceUpdateBead`, `updateBeadOperation` | Singleton/sequence/batch inherit exact selector. Reject null/empty/foreign-shape selector, provenance spoofing, source-only Link input and no-selector/no-array input. |
| `revisionProvenance`, `revisionProvenanceInput`, live/historical record roots | Output-only narrow historical context/Inception, preserve native context group and legacy absence. Inputs still reject authority-assigned members. |
| `historyVersionsPage`, `historyVersionRow`, historical record roots | Current-state snapshot union, explicit terminal rows/records, no Resource body fabrication; authorize descriptors/rows/exact terminal reads independently. |
| `mutationResultMembers`, `deletedIdentity`, Transactional result definitions and Event/replication shapes | Preserve existing final-live identity meaning; explicit terminal detail, no-op unchanged, actual current-to-result effects; do not count a deletion terminal or owned-source revision twice. |
| `packages/protocol/src/read-update-values.ts` | `ReadUpdateInputs.updateBead.fromRevision?: string`; typed presence/parser/schema parity. Semantic request identity preserves selector, not its display spelling. |
| `packages/protocol/src/read-update-preflight.ts` | Selector is an opaque revision, not an identity/reference slot; target keeps existing whole-carrier Scope preflight and local-name laws. |
| `packages/protocol/src/history-values.ts` and `packages/protocol/src/index.ts` | Explicit terminal/current-state/provenance types and parsers; exact-read union distinguishes terminal from complete live record. Do not let legacy Bead-only helpers cast a terminal as a Bead. |
| `packages/client/src/read-update.ts`, `read-update-transport.ts` | Serialize/validate through existing operation, retain key/receipt/unknown-outcome handling. No read-then-replace fallback. |
| `packages/client/src/history-session.ts` | Expose actual authorized terminal/current descriptor and exact-live/terminal union; retain stable page continuation and error rules. |
| `packages/server/src/resource-evaluator.ts`, `transaction-store.ts`, `transaction-sequence.ts`, `transaction-batch.ts` | One lifecycle writer resolves exact source/current state, applies independent guard, composes/validates and atomically commits; sequence and batch keep distinct atomicity. Schema acceptance alone must not silently execute from current content. |
| Beads graphstore lifecycle/native recorder and CLI | Janet assigns existing-file wiring after frozen Type/Cleo/PR114 handshakes. New-files-only preparation does not release those paths. Exact native/property mapping and generation/retention implications precede integration. |

The existing Read+Update problem-code enum already includes the five History `revision-*` codes, `resource-pruned`, `resource-erased`, `revision-mismatch`, and ordinary validation/unavailability codes. Reuse their defined status/retry/disclosure predicates; introduce no invented terminal error vocabulary. Malformed selector, unavailable exact source, unauthorized state and stale current guard are distinct conditions, but evaluation precedence must follow the existing non-disclosure law. Never infer positive pruning, reorganization or non-participation from a missing row. Preserve the `revision-unretained` missing-state carrier and erased-extension prohibitions when those diagnoses apply.

## Acceptance cases and qualification boundary

1. R7 from R1, source-only and with explicit patches: exact composed result, actual predecessor R7, separate source R1, immutable R1/R7.
2. Equal live final content, including patches undoing historical differences: authorization/source/guard/validation still run; no new revision/context/Event or owned-state mutation.
3. D from prior delete and recovery from R1: current descriptor reports real D, guard compares D, new live revision uses same allocation and `revert`; prior terminal/live history remains.
4. Wrong identity/kind, terminal source, missing/pruned/erased/incomplete/unrepresentable source, unauthorized source/current/terminal descriptor, stale guard and ordinary guard omission: truthful admission/refusal with no fallback or oracle.
5. Protected/init-only/native fields, metadata absence/null, notes/assignee/nullable estimate/date rules, current Type constraints and incident/owned graph: valid final state or atomic refusal, never broad historical structural rollback.
6. Real current update/delete/retype race and source retention/erasure at acquisition/commit; injected failures: one atomic outcome, no partial payload/history/provenance/Events.
7. Retained idempotency success/no-op/failure replay and changed selector conflict; source removed after retained success does not re-execute. Lost response remains unknown until ordinary resolution.
8. Exact parity across admitted singleton/sequence/batch/native/SDK/CLI paths, current versus historical fields in output, and no implicit Link recovery. Unsupported paths refuse honestly.
9. Closed schemas reject extra fields, wrong terminal/live union and caller-produced authority context; unchanged ordinary empty arrays and nonempty emitted deltas remain valid/invalid as before.

No test is reported executed. Janet owns focused shared-reference, embedded/server, installed CLI and combined-source qualification. PR172, PR114, pure Types, storage Types and Cleo results retain their original subjects; none transfers automatically to this amendment. Remaining gates are carrier review, complete schema/SDK/reference/native mapping, exact-source implementation and independent qualification, then authorized Preview3 integration. No main/default/runtime pin move or full profile-conformance claim follows.
